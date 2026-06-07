import { app, net } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { UpdateInfo, UpdateAsset, UpdateProgress, OpResult } from '@shared/types'

// 仓库（与 package.json repository 保持一致），GitHub Releases API 数据源
const REPO = 'mia-clark/n1-box-toolkit'
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const UA = 'N1-OneKey-Updater' // GitHub API 要求带 User-Agent，否则 403

interface GhAsset {
  name: string
  browser_download_url: string
  size: number
  digest?: string | null
}
interface GhRelease {
  tag_name: string
  name?: string
  body?: string
  assets: GhAsset[]
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

/** 选当前平台的安装包资产。Windows = *-setup-*.exe（优先），否则任意 .exe */
function pickAsset(assets: GhAsset[]): UpdateAsset | undefined {
  if (process.platform !== 'win32') return undefined
  const m = assets.find((a) => /setup.*\.exe$/i.test(a.name)) || assets.find((a) => /\.exe$/i.test(a.name))
  if (!m) return undefined
  // GitHub 资产 digest 形如 "sha256:abcdef..."，取冒号后的十六进制
  const sha256 = m.digest && m.digest.startsWith('sha256:') ? m.digest.slice(7) : undefined
  return { name: m.name, url: m.browser_download_url, size: m.size, sha256 }
}

/** 检查更新：拉 releases/latest，对比当前版本，返回版本/changelog/资产信息 */
export async function checkUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  try {
    const res = await net.fetch(API_LATEST, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) {
      return { ok: false, current, hasUpdate: false, error: `GitHub API 返回 ${res.status}` }
    }
    const rel = (await res.json()) as GhRelease
    const latest = (rel.tag_name || '').replace(/^v/i, '')
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

/** 流式下载并实时回调进度；若资产带 sha256 则校验完整性 */
async function downloadFile(asset: UpdateAsset, dest: string, onProgress: (p: UpdateProgress) => void): Promise<void> {
  const res = await net.fetch(asset.url, { headers: { 'User-Agent': UA } })
  if (!res.ok || !res.body) throw new Error(`下载响应 ${res.status}`)
  const total = asset.size || Number(res.headers.get('content-length')) || 0
  const hash = crypto.createHash('sha256')
  const out = createWriteStream(dest)
  const reader = res.body.getReader()
  let transferred = 0
  let lastPct = -1
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const buf = Buffer.from(value)
      hash.update(buf)
      await new Promise<void>((resolve, reject) => out.write(buf, (e) => (e ? reject(e) : resolve())))
      transferred += buf.length
      const percent = total ? Math.floor((transferred / total) * 100) : 0
      if (percent !== lastPct) {
        lastPct = percent
        onProgress({ percent, transferred, total })
      }
    }
  } finally {
    out.close()
  }
  if (asset.sha256) {
    const got = hash.digest('hex').toLowerCase()
    if (got !== asset.sha256.toLowerCase()) {
      throw new Error('文件校验失败（sha256 不匹配），已中止安装。')
    }
  }
}

/**
 * 写 helper 批处理并以独立进程启动，然后退出本应用：
 *   1) 轮询等待当前进程(PID)退出（否则 exe 被锁，安装器无法覆盖）
 *   2) 静默安装 setup.exe /S（覆盖安装到同目录）
 *   3) 启动新版（路径=覆盖前的 execPath，覆盖后不变）
 *   4) 删除自身
 */
async function launchInstaller(setupPath: string): Promise<void> {
  const pid = process.pid
  const exe = process.execPath
  const bat = path.join(app.getPath('temp'), `n1-update-${pid}.bat`)
  const script = [
    '@echo off',
    'chcp 65001 >nul',
    ':wait',
    `tasklist /FI "PID eq ${pid}" 2>nul | find "${pid}" >nul`,
    'if not errorlevel 1 (',
    '  timeout /t 1 /nobreak >nul',
    '  goto wait',
    ')',
    `"${setupPath}" /S`,
    `start "" "${exe}"`,
    'del "%~f0"'
  ].join('\r\n')
  await writeFile(bat, script, 'utf-8')
  const child = spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  // 给 helper 起一会儿，再退出自身让它接管
  setTimeout(() => app.quit(), 500)
}
