// 从 CHANGELOG.md 抽出指定版本的小节，作为 GitHub Release 的发布说明。
// 用法: node tools/extract-changelog.cjs [version]   （省略版本时取 package.json 的 version）
// 说明：发布说明只从仓库内的 CHANGELOG 取，不读取任何本地临时文件，CI 与本地行为一致。
const fs = require('fs')
const path = require('path')

const version = (process.argv[2] || require(path.join(__dirname, '..', 'package.json')).version).replace(/^v/i, '')
const file = path.join(__dirname, '..', 'CHANGELOG.md')
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const start = lines.findIndex((line) => new RegExp(`^##\\s*\\[?v?${escaped}\\]?`).test(line))

if (start === -1) {
  console.error(`CHANGELOG.md 中未找到版本 ${version} 的小节`)
  process.exit(1)
}

let end = lines.length
for (let i = start + 1; i < lines.length; i++) {
  if (/^##\s/.test(lines[i])) { end = i; break }
}

const body = lines.slice(start + 1, end).join('\n').trim()
if (!body) {
  console.error(`CHANGELOG.md 中版本 ${version} 的小节内容为空`)
  process.exit(1)
}
process.stdout.write(body + '\n')
