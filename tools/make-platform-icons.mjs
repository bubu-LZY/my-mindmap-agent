// 生成 macOS / Linux 打包所需的图标：build/icon.png（1024x1024）。
// electron-builder 会用它生成 .icns（mac）以及 Linux 桌面图标各尺寸。
// 源图 electron/icons/icon.png 目前是 256x256，这里放大到 1024 —— 若以后拿到更大的源图，
// 直接替换源图后重跑本脚本即可（输出的 build/icon.png 需要一并提交，CI 不依赖本脚本）。
// 用法: node tools/make-platform-icons.mjs
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'electron', 'icons', 'icon.png')
const OUT_DIR = path.join(ROOT, 'build')
const OUT = path.join(OUT_DIR, 'icon.png')
const SIZE = 1024

async function main() {
  const meta = await sharp(SRC).metadata()
  if ((meta.width || 0) < SIZE) {
    console.log(`提示：源图 ${meta.width}x${meta.height}，将放大到 ${SIZE}x${SIZE}（有条件时建议提供 ${SIZE} 以上的源图）`)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  await sharp(SRC)
    .resize(SIZE, SIZE, { fit: 'contain', kernel: 'lanczos3' })
    .png()
    .toFile(OUT)
  console.log('✅ 已生成:', OUT)
}

main().catch((err) => {
  console.error('❌ 图标生成失败:', err)
  process.exit(1)
})
