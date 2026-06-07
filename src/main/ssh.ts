import { Client } from 'ssh2'
import { CancelledError, FlowError, TimeoutError } from './errors'
import type { Ctx } from './flow'
import type { SshCreds } from '@shared/types'

function splitLines(buf: Buffer): string[] {
  return buf
    .toString()
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
}

function mapSshError(e: unknown): FlowError {
  const err = e as { code?: string; level?: string; message?: string }
  const code = err?.code
  const level = err?.level
  const msg = String(err?.message ?? e)
  if (code === 'ECONNREFUSED') return new FlowError('SSH 连接被拒绝：请确认盒子已开启 SSH(dropbear) 且端口正确。')
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH')
    return new TimeoutError('SSH 连接超时：请检查 IP 是否正确、是否同网段、盒子是否在线。')
  if (code === 'ENOTFOUND') return new FlowError('无法解析主机地址，请检查 IP。')
  if (level === 'client-authentication' || /authentication/i.test(msg))
    return new FlowError('SSH 认证失败：用户名或密码不正确（OpenWrt 默认用户名 root）。')
  return new FlowError('SSH 错误：' + msg)
}

export interface SshRunResult {
  code: number | null
  output: string
}

/**
 * 经 ssh2 连接并执行单条命令，stdout/stderr 实时流式回日志。
 * - 取消：abort 时 conn.end()
 * - LAN 工具不校验 host key（不传 hostVerifier）
 * - tryKeyboard 兼容 Dropbear 的 keyboard-interactive
 * - expectDisconnect：reboot 类命令会让对端重置连接，已开始执行则视为成功
 */
export function sshRun(
  creds: SshCreds,
  command: string,
  ctx: Ctx,
  opts: { expectDisconnect?: boolean } = {}
): Promise<SshRunResult> {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let settled = false
    let execStarted = false
    let output = ''

    function onAbort(): void {
      finish(() => reject(new CancelledError()))
    }
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      ctx.signal.removeEventListener('abort', onAbort)
      try {
        conn.end()
      } catch {
        /* ignore */
      }
      fn()
    }

    if (ctx.signal.aborted) return onAbort()
    ctx.signal.addEventListener('abort', onAbort, { once: true })

    conn.on('ready', () => {
      ctx.emitLog('success', `SSH 已连接：${creds.username}@${creds.host}:${creds.port}`)
      ctx.emitLog('cmd', command)
      conn.exec(command, (err, stream) => {
        if (err) return finish(() => reject(new FlowError('SSH 执行失败：' + err.message)))
        execStarted = true
        stream
          .on('close', (code: number | null) => finish(() => resolve({ code, output })))
          .on('data', (d: Buffer) => {
            output += d.toString()
            splitLines(d).forEach((l) => ctx.emitLog('info', l))
          })
        stream.stderr.on('data', (d: Buffer) => {
          output += d.toString()
          splitLines(d).forEach((l) => ctx.emitLog('warn', l))
        })
      })
    })

    conn.on('keyboard-interactive', (_name, _instr, _lang, _prompts, cb) => cb([creds.password]))

    conn.on('error', (e) => {
      if (execStarted && opts.expectDisconnect) return finish(() => resolve({ code: 0, output }))
      finish(() => reject(mapSshError(e)))
    })

    conn.connect({
      host: creds.host,
      port: creds.port,
      username: creds.username,
      password: creds.password,
      tryKeyboard: true,
      readyTimeout: 10000,
      keepaliveInterval: 5000
    })
  })
}

// ===== 高层流程 =====

/** 测试 SSH 连接并取设备信息（类比 ADB 的检测设备） */
export async function runSshTest(creds: SshCreds, ctx: Ctx): Promise<{ info: string }> {
  ctx.emitStatus({ phase: 'sshconnecting' })
  const r = await sshRun(creds, "cat /etc/openwrt_release 2>/dev/null; echo '----'; uname -a", ctx)
  ctx.emitStatus({ phase: 'idle' })
  const info = r.output.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
  return { info }
}

async function sshReboot(creds: SshCreds, ctx: Ctx, label: string): Promise<void> {
  ctx.emitStatus({ phase: 'sshexec' })
  ctx.emitLog(
    'info',
    `${label}：通过 SSH 执行 reboot update（注意：OpenWrt 的 busybox 会忽略 update 参数，实际等价于普通重启；能否进入对应模式取决于是否插好可引导 U 盘 + 盒子 u-boot 的 USB 优先引导）`
  )
  await sshRun(creds, 'reboot update', ctx, { expectDisconnect: true })
  ctx.emitStatus({ phase: 'done' })
  ctx.emitLog('success', `${label} 指令已下达，盒子正在重启。`)
}

/** 进入线刷/更新模式（SSH） */
export async function runSshRecovery(creds: SshCreds, ctx: Ctx): Promise<void> {
  await sshReboot(creds, ctx, '进入线刷/更新模式 (SSH)')
}

/** U 盘启动（SSH） */
export async function runSshUsbBoot(creds: SshCreds, ctx: Ctx): Promise<void> {
  await sshReboot(creds, ctx, 'U 盘启动 (SSH)')
}
