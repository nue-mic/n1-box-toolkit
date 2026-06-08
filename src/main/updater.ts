import { app, net } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { UpdateInfo, UpdateAsset, UpdateProgress, OpResult } from '@shared/types'

// 自建的 GitHub Release 代理（国内可达、规避 GitHub API 限流）。多域名互为备用，主域名优先、失败自动切换。
const PROXY_BASES = [
  'https://gh-raw.966788.xyz',
  'https://gh-raw.988669.xyz',
  'https://gh-raw.s03.qzz.io',
  'https://gh-raw.s04.qzz.io',
  'https://gh-raw.s05.qzz.io',
  'https://gh-raw.s06.qzz.io',
  'https://gh-raw.s07.qzz.io'
]
const RELEASE_KEY = 'n1-box-releases' // 服务方分配的配置键，对应仓库 mia-clark/n1-box-toolkit
const UA = 'N1-OneKey-Updater'
const CHECK_TIMEOUT_MS = 12000 // 单域名 JSON 请求超时
const CONNECT_TIMEOUT_MS = 20000 // 下载建连超时
const DOWNLOAD_STALL_MS = 30000 // 下载看门狗：连续 30s 无数据则判定卡死并中止

// 三方代理返回的数据结构（见对接文档 §4）
interface ProxyAsset {
  name: string
  size: number
  download: string // 经代理的完整下载地址（含令牌，若有）
  content_type?: string
}
interface ProxyRelease {
  tag: string
  name?: string
  prerelease?: boolean
  body?: string
  assets: ProxyAsset[]
}

/** 语义化版本比较：a>b 返回正，a<b 负，相等 0 */
function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

/** 选当前平台的安装包资产。Windows = *-setup-*.exe（优先），否则任意 .exe。三方无 sha256，故不带校验和 */
function pickAsset(assets: ProxyAsset[]): UpdateAsset | undefined {
  if (process.platform !== 'win32') return undefined
  const m = assets.find((a) => /setup.*\.exe$/i.test(a.name)) || assets.find((a) => /\.exe$/i.test(a.name))
  if (!m) return undefined
  return { name: m.name, url: m.download, size: m.size }
}

/** 多域名 fallback 拉取 JSON：主域名优先，5xx/429/网络错误切换备用域名；4xx（资源级）直接失败不重试 */
async function proxyFetchJson<T>(suffix: string): Promise<T> {
  let lastErr: unknown
  for (const base of PROXY_BASES) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS)
    let res: Response
    try {
      res = await net.fetch(base + suffix, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: ctrl.signal
      })
    } catch (e) {
      clearTimeout(t)
      lastErr = e
      continue // 网络错误/超时 → 试下一个域名
    }
    clearTimeout(t)
    if (res.ok) return (await res.json()) as T
    // 4xx（非 429）是资源级错误（Key/版本不存在），换域名结果相同 → 直接失败
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      throw new Error(`代理返回 ${res.status}`)
    }
    lastErr = new Error(`HTTP ${res.status} @ ${base}`) // 5xx/429 → 切换备用域名
  }
  throw lastErr instanceof Error ? lastErr : new Error('所有代理域名均不可用')
}

/** 检查更新：经三方代理取 latest，对比当前版本，返回版本/changelog/资产信息 */
export async function checkUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  try {
    const rel = await proxyFetchJson<ProxyRelease>(`/${RELEASE_KEY}/latest`)
    const latest = (rel.tag || '').replace(/^v/i, '')
    const hasUpdate = !!latest && cmpVersion(latest, current) > 0
    return {
      ok: true,
      current,
      latest,
      hasUpdate,
      notes: rel.body || '',
      asset: pickAsset(rel.assets || [])
    }
  } catch (err) {
    return { ok: false, current, hasUpdate: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 一键更新：下载安装包 → 校验 → 启动静默安装 helper → 退出自身（覆盖安装后自动重启新版） */
export async function downloadUpdate(onProgress: (p: UpdateProgress) => void): Promise<OpResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: '当前仅 Windows 支持一键更新。' }
  }
  if (!app.isPackaged) {
    return { ok: false, error: '开发模式不支持自更新（execPath 为 Electron 本体）。请打包后测试。' }
  }

  // 重新取一次，确保下载链接新鲜
  const info = await checkUpdate()
  if (!info.ok) return { ok: false, error: info.error || '检查更新失败' }
  if (!info.hasUpdate || !info.asset) return { ok: false, error: '没有可用更新，或未找到匹配的安装包资产。' }

  const dest = path.join(app.getPath('temp'), info.asset.name)
  try {
    await downloadFile(info.asset, dest, onProgress)
  } catch (err) {
    return { ok: false, error: '下载失败：' + (err instanceof Error ? err.message : String(err)) }
  }

  try {
    await launchInstaller(dest)
  } catch (err) {
    return { ok: false, error: '启动安装失败：' + (err instanceof Error ? err.message : String(err)) }
  }
  return { ok: true }
}

/**
 * 流式下载并实时回调进度（多域名 fallback）。
 * 健壮性：建连阶段逐域名超时切换；下载阶段无数据看门狗(防挂起)；监听写入流 'error'(防未捕获崩溃)；
 * 背压处理(drain)；三方无 sha256 → 用 size 严格校验完整性；任何失败都清理半成品并抛回上层。
 */
async function downloadFile(asset: UpdateAsset, dest: string, onProgress: (p: UpdateProgress) => void): Promise<void> {
  // 从 download 地址提取路径，便于在备用域名上重试
  const u = new URL(asset.url)
  const suffix = u.pathname + u.search

  let res: Response | null = null
  let ctrl: AbortController | null = null
  let lastErr: unknown
  for (const base of PROXY_BASES) {
    const c = new AbortController()
    const ct = setTimeout(() => c.abort(), CONNECT_TIMEOUT_MS)
    try {
      const r = await net.fetch(base + suffix, { headers: { 'User-Agent': UA }, signal: c.signal })
      clearTimeout(ct)
      if (r.ok && r.body) {
        res = r
        ctrl = c
        break
      }
      lastErr = new Error(`HTTP ${r.status} @ ${base}`)
    } catch (e) {
      clearTimeout(ct)
      lastErr = e
    }
  }
  if (!res || !ctrl) throw lastErr instanceof Error ? lastErr : new Error('下载连接失败（所有域名不可用）')

  const total = asset.size || Number(res.headers.get('content-length')) || 0
  const out = createWriteStream(dest)
  const reader = res.body!.getReader() // 上方 fallback 仅在 r.body 存在时选用，必非 null
  let transferred = 0
  let lastPct = -1
  let streamErr: Error | null = null
  let watchdog: ReturnType<typeof setTimeout> | undefined

  const arm = (): void => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(() => ctrl!.abort(), DOWNLOAD_STALL_MS)
  }
  out.on('error', (e: Error) => {
    streamErr = e
    try {
      ctrl!.abort()
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
        onProgress({ percent, transferred, total })
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
    throw err
  } finally {
    if (watchdog) clearTimeout(watchdog)
  }

  // 完整性校验：三方代理无 sha256，改用 size 严格比对
  if (total && transferred !== total) {
    await unlink(dest).catch(() => {})
    throw new Error(`下载不完整（${transferred}/${total} 字节），已中止安装。`)
  }
}

/**
 * 写 helper 批处理并以独立进程启动，然后退出本应用：
 *   1) 轮询等待当前进程退出（PID + 镜像名双重校验，避免 PID 复用误判）
 *   2) 静默安装 setup.exe /S（覆盖安装到同目录）；失败则记录日志并仍重启旧版，避免静默吞错
 *   3) 启动新版（路径 = 覆盖前 execPath，覆盖后不变）
 *   4) 删除自身
 */
async function launchInstaller(setupPath: string): Promise<void> {
  const pid = process.pid
  const exe = process.execPath
  const exeName = path.basename(exe)
  const bat = path.join(app.getPath('temp'), `n1-update-${pid}.bat`)
  const logFile = path.join(app.getPath('temp'), `n1-update-${pid}.log`)
  const script = [
    '@echo off',
    'chcp 65001 >nul',
    ':wait',
    `tasklist /FI "PID eq ${pid}" /FI "IMAGENAME eq ${exeName}" 2>nul | find /I "${exeName}" >nul`,
    'if not errorlevel 1 (',
    '  timeout /t 1 /nobreak >nul',
    '  goto wait',
    ')',
    `"${setupPath}" /S`,
    'if errorlevel 1 (',
    `  echo [update] silent install failed errorlevel=%errorlevel% > "${logFile}"`,
    `  start "" "${exe}"`,
    '  del "%~f0"',
    '  exit /b 1',
    ')',
    `start "" "${exe}"`,
    'del "%~f0"'
  ].join('\r\n')
  await writeFile(bat, script, 'utf-8')
  const child = spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  // 给 helper 起一会儿，再退出自身让它接管
  setTimeout(() => app.quit(), 800)
}
