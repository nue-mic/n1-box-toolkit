import { runAdb } from './adb'
import { bootImgPath } from './paths'
import { CancelledError, FlowError } from './errors'
import {
  MODEL_TAG,
  type Model,
  type LogLevel,
  type OpStatus,
  type RetrySettings,
  type DetectResult,
  type FlashPayload,
  type RecoveryPayload,
  type UsbBootPayload,
  type DetectPayload
} from '@shared/types'

// 供主进程从 './flow' 统一导入
export { CancelledError, FlowError } from './errors'

export interface Ctx {
  signal: AbortSignal
  emitLog: (level: LogLevel, text: string) => void
  emitStatus: (s: OpStatus) => void
}

const CONNECT_TIMEOUT_MS = 20000
// 检测/U盘启动时的连接重试：盒子 adbd 握手偶发不稳，连上后常先短暂 offline，需多次 disconnect+reconnect
const DETECT_MAX_TRIES = 8
const DETECT_RETRY_INTERVAL_MS = 1500

// 用 getprop 探测设备信息（比 `adb devices -l` 的 model 字段可靠：第三方 ROM 下 ro.product.device 多半仍为 q201/p230）
const PROP_CMD =
  'echo "device=$(getprop ro.product.device)"; ' +
  'echo "model=$(getprop ro.product.model)"; ' +
  'echo "name=$(getprop ro.product.name)"; ' +
  'echo "android=$(getprop ro.build.version.release)"; ' +
  'echo "board=$(getprop ro.board.platform)"'

interface StepResult {
  text: string
  code: number | null
}

const FAIL_KEYWORDS = [
  'adbd cannot run as root',
  'no space left',
  'permission denied',
  'no such file',
  'read-only file system',
  'cannot stat',
  'failed to copy',
  'protocol failure',
  'device not found',
  'device offline'
]

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new CancelledError())
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new CancelledError())
      },
      { once: true }
    )
  })
}

/** 从 `adb devices` 输出中解析某 IP 设备的连接状态 */
function parseAdbState(out: string, ip: string): 'device' | 'offline' | 'unauthorized' | 'none' {
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes(ip)) continue
    if (/\bunauthorized\b/i.test(line)) return 'unauthorized'
    if (/\boffline\b/i.test(line)) return 'offline'
    if (/\bdevice\b/i.test(line)) return 'device'
  }
  return 'none'
}

/** 从 getprop / devices 文本判定型号（q201→T1, p230→N1） */
function modelFromText(t: string): Model | 'unknown' {
  if (new RegExp(MODEL_TAG.t1, 'i').test(t)) return 't1'
  if (new RegExp(MODEL_TAG.n1, 'i').test(t)) return 'n1'
  return 'unknown'
}

/** 取设备信息文本里的有效行用于展示 */
function infoLines(t: string): string {
  return t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /=/.test(l) && !/=\s*$/.test(l))
    .join('  |  ')
}

/** 执行一条 adb 命令，命令本身与每行输出都实时进日志；前后检查取消；返回输出与退出码 */
async function step(ctx: Ctx, args: string[], opts: { timeoutMs?: number } = {}): Promise<StepResult> {
  if (ctx.signal.aborted) throw new CancelledError()
  ctx.emitLog('cmd', `adb ${args.join(' ')}`)
  const r = await runAdb(args, {
    signal: ctx.signal,
    timeoutMs: opts.timeoutMs,
    onLine: (stream, line) => ctx.emitLog(stream === 'err' ? 'warn' : 'info', line)
  })
  if (ctx.signal.aborted) throw new CancelledError()
  return { text: `${r.stdout}\n${r.stderr}`, code: r.code }
}

/** 对“必须成功否则会变砖/无意义”的关键命令做失败拦截 */
function assertOk(label: string, r: StepResult): void {
  const low = r.text.toLowerCase()
  const hit = FAIL_KEYWORDS.find((k) => low.includes(k))
  if ((r.code !== null && r.code !== 0) || hit) {
    const why = hit ? `（${hit}）` : r.code !== null ? `（退出码 ${r.code}）` : ''
    throw new FlowError(`${label}失败${why}，已中止，未继续后续写入/重启操作。`)
  }
}

/** 连接并等待设备 online（处理 offline：disconnect 后重连重试） */
async function ensureOnline(ctx: Ctx, ip: string, settings: RetrySettings): Promise<void> {
  const max = settings.infiniteRetry ? Infinity : Math.max(1, settings.maxRetries)
  let attempt = 0
  for (;;) {
    attempt++
    await step(ctx, ['connect', ip], { timeoutMs: CONNECT_TIMEOUT_MS })
    const out = await step(ctx, ['devices'])
    const state = parseAdbState(out.text, ip)
    if (state === 'device') return
    if (state === 'unauthorized') {
      throw new FlowError('设备未授权：请在盒子上允许此电脑的 ADB 调试后重试。')
    }
    if (attempt >= max) {
      throw new FlowError(
        state === 'offline'
          ? `设备一直处于 offline：已重试 ${attempt} 次。请确认盒子已开机、ADB 调试已开启，或重启盒子后再试。`
          : `连接失败：IP(${ip}) 上未发现 adb 设备（已重试 ${attempt} 次）。请检查 IP、网络是否同网段。`
      )
    }
    ctx.emitStatus({ phase: 'retrying', attempt, maxAttempts: settings.infiniteRetry ? null : max })
    ctx.emitLog('warn', `设备${state === 'offline' ? ' offline' : '未就绪'}，第 ${attempt} 次重试...`)
    if (state === 'offline') await step(ctx, ['disconnect', ip])
    await delay(settings.retryIntervalMs, ctx.signal)
  }
}

/**
 * 连接并轮询设备状态，缓解盒子 adbd 握手不稳导致的偶发 offline。
 * device/unauthorized 立即返回；offline/未就绪则 disconnect 后重连重试，直到成功或用尽次数。
 * 用于「检测设备」「U盘启动」等无 RetrySettings 的一次性连接场景。
 */
async function connectWithRetry(
  ctx: Ctx,
  ip: string,
  maxTries = DETECT_MAX_TRIES,
  intervalMs = DETECT_RETRY_INTERVAL_MS
): Promise<{ state: ReturnType<typeof parseAdbState>; out: StepResult }> {
  let out!: StepResult
  let state: ReturnType<typeof parseAdbState> = 'none'
  for (let i = 1; i <= maxTries; i++) {
    await step(ctx, ['connect', ip], { timeoutMs: CONNECT_TIMEOUT_MS })
    out = await step(ctx, ['devices'])
    state = parseAdbState(out.text, ip)
    if (state === 'device' || state === 'unauthorized') return { state, out }
    if (i < maxTries) {
      ctx.emitLog('warn', `设备${state === 'offline' ? ' offline' : '未就绪'}，第 ${i}/${maxTries} 次重连...`)
      if (state === 'offline') await step(ctx, ['disconnect', ip])
      await delay(intervalMs, ctx.signal)
    }
  }
  return { state, out }
}

/** 复刻 run.bat 的 :ADB + :second —— 连接、开 root、(重试至 online)、remount，返回识别到的型号 */
async function prepareRoot(
  ctx: Ctx,
  ip: string,
  settings: RetrySettings,
  requireModel?: Model
): Promise<Model | 'unknown'> {
  ctx.emitStatus({ phase: 'connecting', model: requireModel })
  await step(ctx, ['kill-server'])
  await ensureOnline(ctx, ip, settings)

  ctx.emitStatus({ phase: 'verifying', model: requireModel })
  const props = await step(ctx, ['shell', PROP_CMD])
  const detected = modelFromText(props.text)
  ctx.emitLog('info', '设备信息：' + infoLines(props.text))

  if (requireModel) {
    if (detected === requireModel) {
      ctx.emitLog('success', `型号匹配：${detected.toUpperCase()}`)
    } else if (settings.skipModelCheck) {
      ctx.emitLog(
        'warn',
        `⚠ 型号校验已跳过（实测=${detected === 'unknown' ? '未知' : detected.toUpperCase()}，目标=${requireModel.toUpperCase()}）。请自行确保盒子确为 ${requireModel.toUpperCase()}，否则可能变砖！`
      )
    } else {
      throw new FlowError(
        `型号不匹配：实测 ${detected === 'unknown' ? '未知（可能已刷第三方系统）' : detected.toUpperCase()}，目标 ${requireModel.toUpperCase()}。若确认是该机型，可在「高级设置」勾选「跳过型号校验」后强制刷写。`
      )
    }
  }

  ctx.emitStatus({ phase: 'rooting', model: requireModel })
  await step(ctx, ['shell', 'setprop', 'service.phiadb.root', '1'])
  await step(ctx, ['shell', 'setprop', 'service.adb.root', '1'])
  await step(ctx, ['kill-server'])

  ctx.emitStatus({ phase: 'retrying', model: requireModel })
  await ensureOnline(ctx, ip, settings)

  ctx.emitStatus({ phase: 'remount', model: requireModel })
  await step(ctx, ['remount'])
  return detected
}

/** T1/N1 降级：复刻 :T1X / :N1X */
export async function runFlash(p: FlashPayload, ctx: Ctx): Promise<void> {
  await prepareRoot(ctx, p.ip, p.settings, p.model)

  ctx.emitStatus({ phase: 'verifying', model: p.model })
  const verify = await step(ctx, ['shell', PROP_CMD])
  if (modelFromText(verify.text) !== p.model && !p.settings.skipModelCheck) {
    throw new FlowError('写入前型号二次校验失败，已中止写入（确认机型可在「高级设置」勾选「跳过型号校验」）。')
  }

  const img = p.customBootImg || bootImgPath(p.model)
  ctx.emitStatus({ phase: 'pushing', model: p.model })
  ctx.emitLog('info', `使用镜像：${img}`)
  const pushed = await step(ctx, ['push', img, '/sdcard/boot.img'])
  assertOk('推送 boot.img', pushed)

  ctx.emitStatus({ phase: 'writing', model: p.model })
  const dd = await step(ctx, ['shell', 'dd', 'if=/sdcard/boot.img', 'of=/dev/block/boot'])
  assertOk('写入 boot 分区(dd)', dd)
  await step(ctx, ['shell', 'rm', '-f', '/sdcard/boot.img'])

  ctx.emitStatus({ phase: 'rebooting', model: p.model })
  await step(ctx, ['reboot'])

  ctx.emitStatus({ phase: 'done', model: p.model })
  ctx.emitLog('success', `🎉 ${p.model.toUpperCase()} 降级完成，盒子正在重启。重启后可使用 reboot update 进入线刷模式。`)
}

/** 线刷模式：完整 root 准备后 reboot update（复刻 run.bat 选项 3 / UPDATEX） */
export async function runRecovery(p: RecoveryPayload, ctx: Ctx): Promise<void> {
  await prepareRoot(ctx, p.ip, p.settings)
  ctx.emitStatus({ phase: 'recovery' })
  await step(ctx, ['reboot', 'update'])
  ctx.emitStatus({ phase: 'done' })
  ctx.emitLog('success', '已发送进入线刷(recovery) 指令，盒子将重启进入 update 模式。')
}

/** U 盘启动：快速连接后 shell reboot update（复刻 U盘启动.BAT） */
export async function runUsbBoot(p: UsbBootPayload, ctx: Ctx): Promise<void> {
  ctx.emitStatus({ phase: 'connecting' })
  await step(ctx, ['kill-server'])
  const { state } = await connectWithRetry(ctx, p.ip)
  if (state !== 'device') {
    throw new FlowError(`连接失败/设备未就绪：请检查 IP(${p.ip}) 与网络，或先在「检测设备」确认能连上。`)
  }
  ctx.emitStatus({ phase: 'usbboot' })
  await step(ctx, ['shell', 'reboot', 'update'])
  ctx.emitStatus({ phase: 'done' })
  ctx.emitLog('success', '已发送 U 盘启动(reboot update) 指令。')
}

/** 检测设备：连上 adb 即视为成功，打印型号与系统版本，不再因型号非 q201/p230 而失败 */
export async function detectDevice(p: DetectPayload, ctx: Ctx): Promise<DetectResult> {
  ctx.emitStatus({ phase: 'connecting' })
  await step(ctx, ['kill-server'])
  const { state, out } = await connectWithRetry(ctx, p.ip)

  if (state !== 'device') {
    ctx.emitStatus({ phase: 'idle' })
    const msg =
      state === 'offline'
        ? '设备 offline（adb 未就绪）：请确认盒子已开机、ADB 调试已开启，稍后重试。'
        : state === 'unauthorized'
          ? '设备未授权：请在盒子上允许此电脑的 ADB 调试。'
          : `未发现 adb 设备（IP ${p.ip}）：请检查 IP、是否同网段、盒子是否在线。`
    ctx.emitLog('warn', msg)
    return { ok: false, model: 'unknown', raw: out.text, error: msg }
  }

  // 已连接 → 取设备信息，无论型号是否 q201/p230 都算成功
  const props = await step(ctx, ['shell', PROP_CMD])
  const model = modelFromText(props.text)
  ctx.emitStatus({ phase: 'idle' })
  ctx.emitLog('success', `已连接 ✓  ${infoLines(props.text)}`)
  ctx.emitLog(
    model === 'unknown' ? 'warn' : 'success',
    model === 'unknown'
      ? '型号非 q201/p230（可能已刷第三方系统）。连接正常，可直接发起 adb 操作；如需降级请在「高级设置」勾选「跳过型号校验」。'
      : `识别机型：${model.toUpperCase()}`
  )
  return { ok: true, model, raw: props.text }
}
