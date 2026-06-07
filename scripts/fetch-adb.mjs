// 下载 Google 官方 platform-tools，把对应平台的 adb 提取到 resources/adb/<平台>/
// 用法: node scripts/fetch-adb.mjs [win|mac|linux]   不带参数则按当前系统自动判断
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const URLS = {
  win: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
  mac: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
  linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip'
}

const FILES = {
  // 新版 adb(1.0.41+)动态链接 libwinpthread-1.dll，缺它 adb.exe 无法启动 → 必须一并提取
  win: ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'libwinpthread-1.dll', 'fastboot.exe'],
  mac: ['adb', 'fastboot'],
  linux: ['adb', 'fastboot']
}

function detectTarget() {
  const arg = process.argv[2]
  if (arg) return arg
  return process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
}

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('重定向次数过多'))
    https
      .get(url, (res) => {
        const { statusCode, headers } = res
        if (statusCode && statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume()
          return resolve(download(headers.location, redirects + 1))
        }
        if (statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${statusCode} for ${url}`))
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      })
      .on('error', reject)
  })
}

async function main() {
  const target = detectTarget()
  if (!URLS[target]) {
    console.error(`未知目标: ${target}（可选 win|mac|linux）`)
    process.exit(1)
  }
  const outDir = path.join(ROOT, 'resources', 'adb', target)
  mkdirSync(outDir, { recursive: true })

  console.log(`[fetch-adb] 目标平台 = ${target}`)
  console.log(`[fetch-adb] 下载 ${URLS[target]}`)

  // 带重试，缓解 dl.google.com 在 CI 上的偶发超时
  let buf
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      buf = await download(URLS[target])
      break
    } catch (e) {
      lastErr = e
      console.warn(`[fetch-adb] 第 ${attempt}/3 次下载失败：${e.message}`)
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000 * attempt))
    }
  }
  if (!buf) throw lastErr || new Error('下载失败')
  console.log(`[fetch-adb] 已下载 ${(buf.length / 1048576).toFixed(1)} MB，解压中...`)

  const zip = new AdmZip(buf)
  const wanted = new Set(FILES[target])
  let count = 0
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const name = entry.entryName.replace(/\\/g, '/')
    const base = name.split('/').pop()
    if (name.startsWith('platform-tools/') && base && wanted.has(base)) {
      const dest = path.join(outDir, base)
      writeFileSync(dest, entry.getData())
      if (target !== 'win') chmodSync(dest, 0o755)
      console.log(`[fetch-adb]  + ${base}`)
      count++
    }
  }
  if (count === 0) throw new Error('未在压缩包中找到 adb，可能 platform-tools 目录结构有变')
  console.log(`[fetch-adb] 完成：写入 ${count} 个文件 → ${outDir}`)
}

main().catch((e) => {
  console.error('[fetch-adb] 失败:', e.message)
  process.exit(1)
})
