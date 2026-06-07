// electron-builder afterPack 钩子：
// 1) 校验打包产物里确实含有 adb（防止在未预取二进制的机器上打出缺 adb 的损坏包）
// 2) 非 Windows 平台补齐可执行位
// 3) macOS 上对内置二进制做 ad-hoc 签名，避免 arm64 上未签名二进制被 SIGKILL 而无法 spawn
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

module.exports = async function afterPack(context) {
  const platform = context.electronPlatformName // 'darwin' | 'win32' | 'linux'
  const isMac = platform === 'darwin'
  const isWin = platform === 'win32'

  const resourcesDir = isMac
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources')

  const adbDir = path.join(resourcesDir, 'adb')
  const adbBin = path.join(adbDir, isWin ? 'adb.exe' : 'adb')

  if (!fs.existsSync(adbBin) || fs.statSync(adbBin).size === 0) {
    throw new Error(
      `[afterPack] 打包产物缺少 adb：${adbBin}\n非 Windows 平台请先运行 "npm run fetch-adb -- <mac|linux>" 再打包。`
    )
  }

  if (!isWin) {
    for (const f of ['adb', 'fastboot']) {
      const p = path.join(adbDir, f)
      if (fs.existsSync(p)) fs.chmodSync(p, 0o755)
    }
  }

  if (isMac) {
    for (const f of ['adb', 'fastboot']) {
      const p = path.join(adbDir, f)
      if (fs.existsSync(p)) {
        try {
          execFileSync('codesign', ['--force', '--sign', '-', p], { stdio: 'inherit' })
        } catch (e) {
          console.warn(`[afterPack] codesign ${f} 失败（忽略，可能影响 arm64 运行）：${e.message}`)
        }
      }
    }
  }

  console.log(`[afterPack] adb 资源校验通过：${adbBin}`)
}
