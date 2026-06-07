import { spawn } from 'node:child_process'
import { adbPath, adbDir } from './paths'
import { CancelledError, TimeoutError } from './errors'

export interface AdbResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface RunAdbOptions {
  signal?: AbortSignal
  /** 每读到一行 stdout/stderr 实时回调（用于流式日志） */
  onLine?: (stream: 'out' | 'err', line: string) => void
  /** 单条命令超时（毫秒）；超时则杀进程并以 TimeoutError reject */
  timeoutMs?: number
}

/**
 * 调用打包内置的 adb，流式读取输出。
 * 不经过 shell，参数以数组传入，天然防注入；windowsHide 避免黑框闪烁。
 * - 用户取消(signal abort) → reject(CancelledError)，并兜底 SIGKILL 确保进程退出
 * - 命令超时 → reject(TimeoutError)
 */
export function runAdb(args: string[], opts: RunAdbOptions = {}): Promise<AdbResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(adbPath(), args, {
      cwd: adbDir(), // 保证 Windows 下 adb.exe 能找到同目录 DLL
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let cmdTimer: NodeJS.Timeout | undefined

    // SIGTERM 后若进程未及时退出，2.5s 后强制 SIGKILL（Windows 上映射为 TerminateProcess）
    const scheduleHardKill = () => {
      const t = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }, 2500)
      t.unref?.()
    }

    function onAbort(): void {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      scheduleHardKill()
      finish(() => reject(new CancelledError()))
    }

    const cleanup = () => {
      if (cmdTimer) clearTimeout(cmdTimer)
      opts.signal?.removeEventListener('abort', onAbort)
    }

    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      action()
    }

    const onTimeout = () => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      scheduleHardKill()
      finish(() => reject(new TimeoutError(`命令超时: adb ${args.join(' ')}`)))
    }

    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort()
        return
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      cmdTimer = setTimeout(onTimeout, opts.timeoutMs)
    }

    const feed = (buf: Buffer, stream: 'out' | 'err') => {
      const text = buf.toString()
      if (stream === 'out') stdout += text
      else stderr += text
      if (opts.onLine) {
        for (const line of text.split(/\r?\n/)) {
          const t = line.trim()
          if (t) opts.onLine(stream, t)
        }
      }
    }

    child.stdout?.on('data', (b: Buffer) => feed(b, 'out'))
    child.stderr?.on('data', (b: Buffer) => feed(b, 'err'))
    child.on('error', (err) => finish(() => reject(err)))
    child.on('close', (code) => finish(() => resolve({ code, stdout, stderr })))
  })
}
