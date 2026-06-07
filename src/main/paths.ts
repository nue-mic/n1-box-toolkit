import { app } from 'electron'
import path from 'node:path'
import type { Model } from '@shared/types'

// 平台目录名（dev 模式下 resources/adb/<platformDir>/）
const platformDir = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
// adb 可执行文件名
const adbBin = process.platform === 'win32' ? 'adb.exe' : 'adb'

// dev 模式下的 resources 根目录：__dirname = <root>/out/main，向上两级回到工程根
function devResourcesRoot(): string {
  return path.join(__dirname, '..', '..', 'resources')
}

/**
 * adb 可执行文件的绝对路径。
 * - 打包后：extraResources 已把 resources/adb/<平台> 映射为 <resources>/adb，故直接 process.resourcesPath/adb/<bin>
 * - 开发时：resources/adb/<平台>/<bin>
 */
export function adbPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'adb', adbBin)
  }
  return path.join(devResourcesRoot(), 'adb', platformDir, adbBin)
}

/** adb 所在目录（Windows 下需要同目录的 DLL，spawn 时设为 cwd 更稳妥） */
export function adbDir(): string {
  return path.dirname(adbPath())
}

/** 内置 boot.img 路径（全平台通用） */
export function bootImgPath(model: Model): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'boot', model, 'boot.img')
  }
  return path.join(devResourcesRoot(), 'boot', model, 'boot.img')
}
