// 由 build/icon.svg 生成各平台应用图标：build/icon.png(1024) + icon.ico(Windows) + icon.icns(macOS)
// 依赖 sharp(矢量转 png) 与 png2icons(png 转 ico/icns)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import png2icons from 'png2icons'

const dir = path.dirname(fileURLToPath(import.meta.url))
const buildDir = path.resolve(dir, '..', 'build')
mkdirSync(buildDir, { recursive: true })

const svg = readFileSync(path.join(buildDir, 'icon.svg'))

const png = await sharp(svg, { density: 384 }).resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
writeFileSync(path.join(buildDir, 'icon.png'), png)
console.log('[gen-icons] build/icon.png (1024x1024)')

const ico = png2icons.createICO(png, png2icons.BICUBIC, 0, false)
writeFileSync(path.join(buildDir, 'icon.ico'), ico)
console.log('[gen-icons] build/icon.ico')

const icns = png2icons.createICNS(png, png2icons.BICUBIC, 0)
writeFileSync(path.join(buildDir, 'icon.icns'), icns)
console.log('[gen-icons] build/icon.icns')

console.log('[gen-icons] done')
