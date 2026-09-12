/*
 * 生成 GitHub Pages 上的「在线体验」目录。
 *
 *   node tools/build-web-demo.cjs [--dist dist] [--out site/webapp]
 *
 * 做三件事：
 *   1. 把 vite 构建产物 dist/ 拷到发布目录
 *   2. 放入浏览器桥接层 tools/web-demo/bridge.js
 *   3. 在 index.html 的模块脚本之前插入 <script src="./bridge.js">（classic script 先于 module 执行），
 *      让在线版在缺少 electronAPI 时也能跑起同一份前端界面
 *
 * bridge.js 在 Electron 中检测到已有 window.electronAPI 会直接返回，因此桌面版不受影响；
 * 这里只在发布产物上注入，不改动 dist/ 与打包进安装包的 index.html。
 */
const fs = require('fs')
const path = require('path')

const argv = process.argv.slice(2)
const getArg = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const root = path.resolve(__dirname, '..')
const distDir = path.resolve(root, getArg('--dist', 'dist'))
const outDir = path.resolve(root, getArg('--out', 'site/webapp'))
const bridgeSrc = path.join(__dirname, 'web-demo', 'bridge.js')

if (!fs.existsSync(distDir)) {
  console.error(`[web-demo] 找不到构建产物：${distDir}，请先执行 vite build`)
  process.exit(1)
}

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
fs.cpSync(distDir, outDir, { recursive: true })

fs.copyFileSync(bridgeSrc, path.join(outDir, 'bridge.js'))

const indexPath = path.join(outDir, 'index.html')
let html = fs.readFileSync(indexPath, 'utf8')

const TAG = '<script src="./bridge.js"></script>'
if (html.includes('bridge.js')) {
  console.log('[web-demo] index.html 已包含 bridge.js，跳过注入')
} else {
  const marker = /<script\s+type="module"[^>]*><\/script>/
  if (!marker.test(html)) {
    console.error('[web-demo] index.html 中找不到模块脚本标签，无法注入 bridge.js')
    process.exit(1)
  }
  html = html.replace(marker, (m) => `${TAG}\n    ${m}`)
  fs.writeFileSync(indexPath, html)
  console.log('[web-demo] 已注入 bridge.js')
}

console.log(`[web-demo] 完成：${outDir}`)
