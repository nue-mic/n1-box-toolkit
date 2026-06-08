/**
 * 电脑端烧录工具下载 —— 从自建 Release 代理拉取 USB_Burning_Tool 套装。
 *
 * 设计要点：
 *  1) 走与 updater.ts 同样的 PROXY_BASES 多域名 fallback，规避国内 GitHub 限流。
 *  2) 流式下载到用户选定路径 (默认 OS Downloads 目录)，实时回调进度。
 *  3) 跨平台：非 Windows 直接返回错误（USB_Burning_Tool 只有 Windows）。
 *  4) 工具元数据 hardcode：版本/路径/大小/适用机型固定在编译时，简化无服务端逻辑。
 */
import { app, dialog, net, shell, type BrowserWindow } from 'electron'
import { createWriteStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { BurningTool, BurningToolProgress, BurningToolDownloadResult } from '@shared/types'

const PROXY_BASES = [
  'https://gh-raw.966788.xyz',
  'https://gh-raw.988669.xyz',
  'https://gh-raw.s03.qzz.io',
  'https://gh-raw.s04.qzz.io',
  'https://gh-raw.s05.qzz.io',
  'https://gh-raw.s06.qzz.io',
  'https://gh-raw.s07.qzz.io'
]
const RELEASE_KEY = 'n1-box-releases'
const TAG = 'tools-burning-v1'
const UA = 'N1-OneKey-BurningTool'
const CONNECT_TIMEOUT_MS = 20000
const STALL_TIMEOUT_MS = 30000

/** 工具清单（编译时固定）。新增版本只需追加项 + 上传到对应 Release tag。 */
export const BURNING_TOOLS: BurningTool[] = [
  {
    id: 'v2.2.0-n1-t1',
    label: 'v2.2.0',
    recommended: true,
    forBoxes: 'N1 / T1 推荐 (S805 / S905L)',
    description: '社区主流套装，含修改版 UsbRomDrv.dll，解决烧录 98% 卡死。配套使用说明在 zip 内。',
    fileName: 'USB_Burning_Tool-v2.2.0-N1-T1-bundle.zip',
    size: 8499585
  },
  {
    id: 'v3.1.0-new',
    label: 'v3.1.0',
    recommended: false,
    forBoxes: '较新机型 (S905X3 / S922 等)',
    description: '官方 v3.1.0 安装器。N1/T1 一般用不上，老盒子上易出现「无法识别设备」。',
    fileName: 'USB_Burning_Tool-v3.1.0.exe',
    size: 26528070
  }
]

function toolById(id: string): BurningTool | undefined {
  return BURNING_TOOLS.find((t) => t.id === id)
}

function defaultSavePath(fileName: string): string {
  return path.join(app.getPath('downloads'), fileName)
}

/** 多域名 fallback：拿到第一个能用的下载流 */
async function openDownloadStream(
  toolFileName: string
): Promise<{ res: Response; ctrl: AbortController }> {
  let lastErr: unknown
  for (const base of PROXY_BASES) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT_MS)
    try {
      const url = `${base}/${RELEASE_KEY}/${TAG}/${toolFileName}`
      const res = await net.fetch(url, {
        headers: { 'User-Agent': UA },
        signal: ctrl.signal
      })
      clearTimeout(t)
      if (res.ok && res.body) {
        return { res, ctrl }
      }
      lastErr = new Error(`HTTP ${res.status} @ ${base}`)
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        // 资源级错误（404/403），换域名也没用
        throw new Error(`代理返回 ${res.status}（资源可能尚未上传）`)
      }
    } catch (e) {
      clearTimeout(t)
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('所有代理域名均不可用')
}

export async function listBurningTools(): Promise<BurningTool[]> {
  return BURNING_TOOLS
}

export async function downloadBurningTool(
  win: BrowserWindow | null,
  toolId: string,
  onProgress: (p: BurningToolProgress) => void
): Promise<BurningToolDownloadResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: '电脑端 USB Burning Tool 仅 Windows 可用' }
  }
  const tool = toolById(toolId)
  if (!tool) return { ok: false, error: '未知的工具 id：' + toolId }

  // 让用户选保存路径（默认 Downloads/<filename>），可改名 / 取消
  const dialogResult = await dialog.showSaveDialog(win || undefined as never, {
    title: '保存烧录工具',
    defaultPath: defaultSavePath(tool.fileName),
    filters: tool.fileName.endsWith('.zip')
      ? [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
      : [{ name: 'Windows 安装器', extensions: ['exe'] }]
  })
  if (dialogResult.canceled || !dialogResult.filePath) {
    return { ok: false, cancelled: true }
  }
  const dest = dialogResult.filePath

  // 下载（多域名 fallback）
  let res: Response, ctrl: AbortController
  try {
    ;({ res, ctrl } = await openDownloadStream(tool.fileName))
  } catch (err) {
    return { ok: false, error: '建立下载失败：' + (err instanceof Error ? err.message : String(err)) }
  }

  const total = tool.size || Number(res.headers.get('content-length')) || 0
  const out = createWriteStream(dest)
  const reader = res.body!.getReader()
  let transferred = 0
  let lastPct = -1
  let streamErr: Error | null = null
  let watchdog: ReturnType<typeof setTimeout> | undefined

  const arm = (): void => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(() => ctrl.abort(), STALL_TIMEOUT_MS)
  }
  out.on('error', (e: Error) => {
    streamErr = e
    try {
      ctrl.abort()
    } catch {
      /* ignore */
    }
  })

  try {
    arm()
    for (;;) {
      if (streamErr) throw streamErr
      const { done, value } = await reader.read()
      if (done) break
      arm()
      const buf = Buffer.from(value)
      if (!out.write(buf)) {
        await new Promise<void>((resolve, reject) => {
          out.once('drain', resolve)
          out.once('error', reject)
        })
      }
      transferred += buf.length
      const percent = total ? Math.floor((transferred / total) * 100) : 0
      if (percent !== lastPct) {
        lastPct = percent
        onProgress({ toolId, percent, transferred, total, path: dest })
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve())
      out.once('error', reject)
    })
    if (streamErr) throw streamErr
  } catch (err) {
    try {
      out.destroy()
    } catch {
      /* ignore */
    }
    await unlink(dest).catch(() => {})
    return { ok: false, error: '下载失败：' + (err instanceof Error ? err.message : String(err)) }
  } finally {
    if (watchdog) clearTimeout(watchdog)
  }

  // 完整性校验：用 size 严格比对（Release 上传后大小固定）
  if (total && transferred !== total) {
    await unlink(dest).catch(() => {})
    return { ok: false, error: `下载不完整（${transferred}/${total} 字节）` }
  }

  let actualSize = 0
  try {
    actualSize = (await stat(dest)).size
  } catch {
    /* ignore */
  }

  return { ok: true, path: dest, size: actualSize || transferred }
}

/** 在文件管理器中显示已下载的工具 */
export function revealBurningTool(filePath: string): void {
  if (!filePath) return
  shell.showItemInFolder(filePath)
}
