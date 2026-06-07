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

interface StepResult {
  text: string
  code: number | null
}

// 写入/挂载类命令失败的兜底关键字（adb shell 退出码在部分版本不可靠，结合 stderr 兜底）
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

function parseModel(raw: string): Model | 'unknown' {
  if (raw.includes(MODEL_TAG.t1)) return 't1'
  if (raw.includes(MODEL_TAG.n1)) return 'n1'
  return 'unknown'
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

/** 复刻 run.bat 的 :ADB + :second —— 连接、开 root、重试循环、remount，返回识别到的型号 */
async function prepareRoot(
  ctx: Ctx,
  ip: string,
  settings: RetrySettings,
  requireModel?: Model
): Promise<Model> {
  ctx.emitStatus({ phase: 'connecting', model: requireModel })
  await step(ctx, ['kill-server'])
  await step(ctx, ['connect', ip], { timeoutMs: CONNECT_TIMEOUT_MS })
  const first = await step(ctx, ['devices', '-l'])
  const detected = parseModel(first.text)
  if (detected === 'unknown') {
    throw new FlowError(`连接失败或未识别盒子型号。请检查 IP(${ip})、网络是否同网段、盒子是否已开启 ADB 调试。`)
  }
  if (requireModel && detected !== requireModel) {
    throw new FlowError(
      `型号不匹配：实际检测到 ${detected.toUpperCase()}(${MODEL_TAG[detected]})，但你选择了 ${requireModel.toUpperCase()}。已中止以防刷错。`
    )
  }
  const model: Model = detected
  ctx.emitLog('success', `已连接，识别型号：${model.toUpperCase()}`)

  ctx.emitStatus({ phase: 'rooting', model })
  await step(ctx, ['shell', 'setprop', 'service.phiadb.root', '1'])
  await step(ctx, ['shell', 'setprop', 'service.adb.root', '1'])
  await step(ctx, ['kill-server'])

  // 重试循环（原 :second 标签为无限循环，这里支持配置/无限）
  const max = settings.infiniteRetry ? Infinity : Math.max(1, settings.maxRetries)
  let attempt = 0
  for (;;) {
    attempt++
    ctx.emitStatus({
      phase: 'retrying',
      attempt,
      maxAttempts: settings.infiniteRetry ? null : max,
      model
    })
    await delay(settings.retryIntervalMs, ctx.signal)
    await step(ctx, ['connect', ip], { timeoutMs: CONNECT_TIMEOUT_MS })
    const out = await step(ctx, ['devices', '-l'])
    if (parseModel(out.text) !== 'unknown') {
      ctx.emitLog('success', `重连成功（第 ${attempt} 次）`)
      break
    }
    if (attempt >= max) {
      throw new FlowError(`重连失败：已重试 ${attempt} 次，盒子仍未就绪。可在设置中调高次数或开启“无限重试”。`)
    }
    ctx.emitLog('warn', `第 ${attempt} 次重连未就绪，${(settings.retryIntervalMs / 1000).toFixed(0)}s 后重试...`)
  }

  ctx.emitStatus({ phase: 'remount', model })
  await step(ctx, ['remount'])
  return model
}

/** T1/N1 降级：复刻 :T1X / :N1X */
export async function runFlash(p: FlashPayload, ctx: Ctx): Promise<void> {
  await prepareRoot(ctx, p.ip, p.settings, p.model)

  ctx.emitStatus({ phase: 'verifying', model: p.model })
  const verify = await step(ctx, ['devices', '-l'])
  if (parseModel(verify.text) !== p.model) {
    throw new FlowError('写入前型号二次校验失败，已中止写入。')
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
  await step(ctx, ['connect', p.ip], { timeoutMs: CONNECT_TIMEOUT_MS })
  const out = await step(ctx, ['devices', '-l'])
  if (parseModel(out.text) === 'unknown') {
    throw new FlowError(`连接失败：请检查 IP(${p.ip}) 与网络是否同网段。`)
  }
  ctx.emitStatus({ phase: 'usbboot' })
  await step(ctx, ['shell', 'reboot', 'update'])
  ctx.emitStatus({ phase: 'done' })
  ctx.emitLog('success', '已发送 U 盘启动(reboot update) 指令。')
}

/** 仅检测设备型号 */
export async function detectDevice(p: DetectPayload, ctx: Ctx): Promise<DetectResult> {
  ctx.emitStatus({ phase: 'connecting' })
  await step(ctx, ['kill-server'])
  await step(ctx, ['connect', p.ip], { timeoutMs: CONNECT_TIMEOUT_MS })
  const raw = await step(ctx, ['devices', '-l'])
  const model = parseModel(raw.text)
  ctx.emitStatus({ phase: 'idle' })
  if (model === 'unknown') {
    ctx.emitLog('warn', '未识别到斐讯盒子（型号关键字 q201/p230 未出现）。')
    return { ok: false, model, raw: raw.text }
  }
  ctx.emitLog('success', `识别成功：${model.toUpperCase()}`)
  return { ok: true, model, raw: raw.text }
}
