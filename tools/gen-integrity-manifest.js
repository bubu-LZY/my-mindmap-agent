/**
 * 生成前端资源完整性清单（防篡改）
 *
 * 在 vite build 之后、electron-builder 打包之前运行：
 * 计算 dist 目录下每个文件的 SHA256，生成 dist/.integrity-manifest.json。
 * 该 manifest 会被打进 asar；主进程加载外部 resources/app-dist 前，
 * 用这份清单校验外部文件哈希，不匹配则回退包内资源，防止外部目录被篡改注入恶意 JS。
 *
 * 用法：node tools/gen-integrity-manifest.js
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const distDir = path.join(__dirname, '..', 'dist')
const manifestName = 'integrity-manifest.json'

if (!fs.existsSync(distDir)) {
  console.error('[integrity] dist 目录不存在，请先执行 vite build')
  process.exit(1)
}

// 递归遍历 dist，计算每个文件的 SHA256
function walk(dir, base = '') {
  const entries = {}
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const rel = path.join(base, name).replace(/\\/g, '/')
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      Object.assign(entries, walk(full, rel))
    } else if (name !== manifestName) {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
      entries[rel] = hash
    }
  }
  return entries
}

const files = walk(distDir)
const manifest = {
  version: require('../package.json').version,
  generatedAt: Date.now(),
  files
}

fs.writeFileSync(path.join(distDir, manifestName), JSON.stringify(manifest, null, 2))
console.log(`[integrity] 已生成完整性清单：${Object.keys(files).length} 个文件`)
