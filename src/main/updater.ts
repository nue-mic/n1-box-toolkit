/**
 * 自动更新 — 基于 electron-updater 6.x + 自建 GitHub Release 代理（多域名 fallback）。
 *
 * 设计要点：
 *  1) Windows NSIS 走 electron-updater 的 NsisUpdater（成熟、可靠的静默 /S 安装与重启流程，
 *     彻底替代旧版自实现 cmd.bat helper —— 旧版在 tasklist|find 管道下卡死过线上用户）。
 *  2) 数据源仍走自建代理 JSON API（`/${RELEASE_KEY}/latest`），规避 GitHub API 国内限流；
 *     用自定义 Provider 把代理 JSON 翻译成 electron-updater 期望的 UpdateInfo。
 *  3) 多域名 fallback：所有 JSON / YAML 请求都遍历 PROXY_BASES，主域名挂了自动切换。
 *  4) 下载链接 = JSON 给的完整 absolute URL（含 token），electron-updater 的 newUrlFromBase
 *     遇到 absolute URL 会忽略 baseUrl 直接用 —— 这就让我们绕过了 generic provider 的单 URL 限制。
 *  5) verifyUpdateCodeSignature 显式返回 null：当前 setup.exe 未做代码签名，强行让 updater
 *     接受所有签名（A2 方案，待将来购买签名证书后再撤掉）。
 */
import { app, net } from 'electron'
import path from 'node:path'
import { NsisUpdater, Provider } from 'electron-updater'
import {
  parseUpdateInfo,
  resolveFiles as resolveFilesUtil,
  type ProviderRuntimeOptions
} from 'electron-updater/out/providers/Provider'
import type { UpdateInfo as EuUpdateInfo, ProgressInfo, ResolvedUpdateFileInfo } from 'electron-updater'
import type { UpdateInfo, UpdateProgress, OpResult } from '@shared/types'

// 多域名代理列表（主优先、失败自动切换）。与 docs/三方对接 文档保持一致
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
const UA = 'N1-OneKey-Updater'
const HTTP_TIMEOUT_MS = 12000

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

/** 多域名 fallback 拉取 —— 5xx/429/网络错误切换，4xx（非 429）直接失败 */
async function proxyFetch(suffix: string): Promise<Response> {
  let lastErr: unknown
  for (const base of PROXY_BASES) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS)
    try {
      const res = await net.fetch(base + suffix, {
        headers: { 'User-Agent': UA },
        signal: ctrl.signal
      })
      clearTimeout(t)
      if (res.ok) return res
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new Error(`代理返回 ${res.status}`) // 资源级错误，换域名也没用
      }
      lastErr = new Error(`HTTP ${res.status} @ ${base}`) // 5xx / 429 → 切换
    } catch (e) {
      clearTimeout(t)
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('所有代理域名均不可用')
}

/** 用绝对 URL（不经代理 base 拼接）直接拉取一个资源，仍然带 UA 与超时 */
async function fetchAbsolute(url: string): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS)
  try {
    const res = await net.fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
  } finally {
    clearTimeout(t)
  }
}

/**
 * 自定义 Provider：先调 JSON API 列出资产，再 fetch 其中的 latest.yml，
 * 把 file.url 替换为代理给出的完整 absolute 下载 URL。
 */
class ProxyProvider extends Provider<EuUpdateInfo> {
  private latestRelease: ProxyRelease | null = null

  constructor(runtimeOptions: ProviderRuntimeOptions) {
    super(runtimeOptions)
  }

  /** 客户端可读：本次 release body（changelog markdown） */
  get releaseBody(): string {
    return this.latestRelease?.body || ''
  }

  async getLatestVersion(): Promise<EuUpdateInfo> {
    // 1) 拉 JSON 元数据
    const jsonRes = await proxyFetch(`/${RELEASE_KEY}/latest`)
    const rel = (await jsonRes.json()) as ProxyRelease
    this.latestRelease = rel

    // 2) 找 latest.yml（v1.0.9+ 起 CI 才上传；老版本 release 缺这个，会抛错由上层友好提示）
    const yamlAsset = rel.assets.find((a) => /^latest\.yml$/i.test(a.name))
    if (!yamlAsset) {
      throw new Error(
        '该 release 缺少 latest.yml —— 可能是 v1.0.8 及之前的老版本未启用专业更新机制。请前往 GitHub Releases 手动下载新版本安装。'
      )
    }

    // 3) 用代理 download URL 拉 latest.yml 文本
    const ymlText = await (await fetchAbsolute(yamlAsset.download)).text()

    // 4) 用 electron-updater 内置 yaml 解析
    const updateInfo = parseUpdateInfo(ymlText, 'latest.yml', new URL(yamlAsset.download))

    // 5) 改写 file.url 为代理的完整下载 URL —— newUrlFromBase 遇到绝对 URL 会跳过 baseUrl 拼接
    //    blockmap 会用相同 base + '.blockmap' 推导，所以我们也必须保证 blockmap asset 在 release 里
    for (const fi of updateInfo.files || []) {
      const asset = rel.assets.find((a) => a.name === fi.url || a.name === path.basename(fi.url))
      if (asset) {
        // 让 sha512 不依赖文件名校验：electron-updater 用 files[].sha512 直接对比下载内容
        ;(fi as { url: string }).url = asset.download
      }
    }
    // path（deprecated 但回退路径仍用得着）
    if (updateInfo.path) {
      const pa = rel.assets.find((a) => a.name === updateInfo.path)
      if (pa) (updateInfo as { path: string }).path = pa.download
    }

    // release body → releaseNotes，让 UI 直接读取 ui.releaseNotes 即可
    if (!updateInfo.releaseNotes && rel.body) {
      ;(updateInfo as { releaseNotes?: string }).releaseNotes = rel.body
    }

    return updateInfo
  }

  resolveFiles(updateInfo: EuUpdateInfo): ResolvedUpdateFileInfo[] {
    // baseUrl 不重要（file.url 已是 absolute），随便填一个合法 URL 让 newUrlFromBase 不报错
    return resolveFilesUtil(updateInfo, new URL(PROXY_BASES[0] + '/' + RELEASE_KEY + '/'))
  }

  /** 没有 blockmap 时返回空数组，electron-updater 会自动回退到全量下载 */
  override async getBlockMapFiles(_baseUrl: URL, _oldVersion: string, _newVersion: string): Promise<URL[]> {
    if (!this.latestRelease) return []
    const blockmap = this.latestRelease.assets.find((a) => /\.blockmap$/i.test(a.name))
    if (!blockmap) return []
    return [new URL(blockmap.download)]
  }
}

// 全局单例
let updaterInstance: NsisUpdater | null = null
let proxyProvider: ProxyProvider | null = null

function ensureUpdater(): NsisUpdater {
  if (updaterInstance) return updaterInstance

  // 构造时给一个 generic url 占位，setFeedURL 会创建一个临时 GenericProvider；下一行立即覆盖
  const u = new NsisUpdater({ provider: 'generic', url: PROXY_BASES[0] + '/' + RELEASE_KEY })

  // 注入自定义 Provider（electron-updater 没有公开 hook，只能用内部成员；
  // 6.x 的 clientPromise / createProviderRuntimeOptions 名称稳定，未来升级时关注）
  const internals = u as unknown as {
    clientPromise: Promise<Provider<EuUpdateInfo>>
    createProviderRuntimeOptions: () => ProviderRuntimeOptions
  }
  proxyProvider = new ProxyProvider(internals.createProviderRuntimeOptions())
  internals.clientPromise = Promise.resolve(proxyProvider)

  // 跳过代码签名校验 —— 当前 setup.exe 未签名（A2 方案）。将来买证书后删除此行恢复严格校验。
  u.verifyUpdateCodeSignature = () => Promise.resolve(null)

  u.autoDownload = false // 不自动下载，等用户点"一键更新"
  u.autoInstallOnAppQuit = false
  u.allowDowngrade = false
  u.allowPrerelease = false

  // 把 electron-updater 内部日志统一接到 console（便于打包后查日志）
  u.logger = {
    info: (m) => console.log('[updater]', m),
    warn: (m) => console.warn('[updater]', m),
    error: (m) => console.error('[updater]', m)
  }

  updaterInstance = u
  return u
}

/** 检查更新：对外接口形状与旧版兼容，UI 无需大改 */
export async function checkUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  if (process.platform !== 'win32') {
    return { ok: false, current, hasUpdate: false, error: '当前仅 Windows 支持自动更新' }
  }
  try {
    const u = ensureUpdater()
    const result = await u.checkForUpdates()
    if (!result || !result.updateInfo) return { ok: true, current, hasUpdate: false }

    const ui = result.updateInfo
    const latest = ui.version
    const hasUpdate = !!latest && cmpVersion(latest, current) > 0
    const notes =
      typeof ui.releaseNotes === 'string'
        ? ui.releaseNotes
        : proxyProvider?.releaseBody || ''

    // 资产仅供 UI 显示（文件名 / 大小）；实际下载由 electron-updater 接管
    const mainFile = ui.files?.[0]
    const asset = mainFile
      ? {
          name: path.basename(new URL(mainFile.url).pathname),
          url: mainFile.url,
          size: mainFile.size || 0,
          sha512: mainFile.sha512
        }
      : undefined

    return { ok: true, current, latest, hasUpdate, notes, asset }
  } catch (err) {
    return { ok: false, current, hasUpdate: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 一键更新：electron-updater 下载（差量优先） → 静默 NSIS 安装 → 自动重启新版 */
export async function downloadUpdate(onProgress: (p: UpdateProgress) => void): Promise<OpResult> {
  if (process.platform !== 'win32') return { ok: false, error: '当前仅 Windows 支持自动更新' }
  if (!app.isPackaged) return { ok: false, error: '开发模式不支持自更新（execPath 是 Electron 本体）' }

  const u = ensureUpdater()

  // 进度事件转发
  const onP = (info: ProgressInfo): void => {
    onProgress({
      percent: Math.floor(info.percent || 0),
      transferred: Math.floor(info.transferred || 0),
      total: Math.floor(info.total || 0)
    })
  }
  u.on('download-progress', onP)

  try {
    // 二次确认有更新（避免下载链接过期 / 上一次 check 的结果与此时不一致）
    const r = await u.checkForUpdates()
    if (!r || !r.updateInfo) return { ok: false, error: '没有可用更新' }
    if (cmpVersion(r.updateInfo.version, app.getVersion()) <= 0) {
      return { ok: false, error: '已是最新版本' }
    }

    await u.downloadUpdate()
  } catch (err) {
    u.off('download-progress', onP)
    return { ok: false, error: '下载失败：' + (err instanceof Error ? err.message : String(err)) }
  }
  u.off('download-progress', onP)

  try {
    // isSilent=true → NSIS /S 静默安装；isForceRunAfter=true → 安装完自启动新版
    // electron-updater 内部会先 emit 'before-quit-for-update' → close all windows → spawn 安装器 → app.exit
    u.quitAndInstall(true, true)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: '启动安装失败：' + (err instanceof Error ? err.message : String(err)) }
  }
}
