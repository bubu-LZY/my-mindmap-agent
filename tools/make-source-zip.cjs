/**
 * 制作脱敏源码 zip：
 *  - 排除 node_modules / dist / release / .workbuddy / 历史 zip 等大文件或隐私目录
 *  - 仅打包源码 + 配置 + 文档（与 .gitignore 互补）
 *  - 跳过 .gitignore 列出的所有路径
 *
 * 用法：node tools/make-source-zip.cjs [outputPath]
 *        默认输出到 c:\Users\lizhu\Desktop\my-mindmap-agent-source.zip
 */
const fs = require('fs')
const path = require('path')
const archiver = require('archiver')

// .gitignore 的简化版：这里硬编码以避免依赖 git CLI
const IGNORE_PATTERNS = [
  /^node_modules\//,
  /^dist\//,
  /^release\//,
  /^\.workbuddy/,
  /^\.workbuddy-/,
  /^my-mindmap-agent-setup\.zip$/,
  /^my-mindmap-agent-source-[^/]+\.zip$/,
  /^my-mindmap-agent-source\.zip$/,
  /^simple-mind-map-[^/]+\.tgz$/,
  /^AI工具测试对话\.md$/,
  /^对话总结\.md$/,
  /^多窗口多标签改造计划\.md$/,
  /^_probe\.cjs$/,
  /^electron\/_syntax_check_stub_electron\.cjs$/,
  /^electron\/ipc\/_syntax_check_stub_electron\.cjs$/,
  /^tools\/fix-prompt\.ps1$/,
  /^tools\/make-icons\.mjs$/,
  /^tools\/inspect-legacy\.js$/,
  /^tools\/test-[^/]+\.mjs$/,
  /^tools\/api-toolcall-probe\.js$/,
  /^tools\/make-package\.ps1$/,
  /^tools\/make-source-zip\.cjs$/,
  // simple-mind-map 离线源码（已通过 dependencies 走 npm registry）
  /^package\//,
  /\.(log|tmp)$/,
  /^Thumbs\.db$/i,
  /(^|\/)\.DS_Store$/,
  /\.(ldb|ldb-shm|ldb-wal)$/,
]

const isIgnored = (relPath) => IGNORE_PATTERNS.some((re) => re.test(relPath))

async function main() {
  const src = path.resolve(__dirname, '..')
  const output = process.argv[2] || path.resolve(require('os').homedir(), 'Desktop', 'my-mindmap-agent-source.zip')

  if (!fs.existsSync(path.dirname(output))) {
    throw new Error(`输出目录不存在：${path.dirname(output)}`)
  }
  if (fs.existsSync(output)) fs.unlinkSync(output)

  const output_ = fs.createWriteStream(output)
  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.pipe(output_)

  let totalFiles = 0
  let totalBytes = 0

  const walk = (dir, relDir = '') => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      const rel = path.posix.join(relDir, entry.name)
      if (isIgnored(rel)) continue
      if (entry.isDirectory()) {
        walk(full, rel)
      } else if (entry.isFile()) {
        archive.file(full, { name: rel })
        totalFiles++
        totalBytes += fs.statSync(full).size
      }
    }
  }
  walk(src)

  await archive.finalize()
  await new Promise((res, rej) => {
    output_.on('close', res)
    output_.on('error', rej)
  })

  const outSize = fs.statSync(output).size
  console.log(`✅ 已生成：${output}`)
  console.log(`   文件数：${totalFiles}`)
  console.log(`   源码体积（压缩前）：${(totalBytes / 1024 / 1024).toFixed(2)} MB`)
  console.log(`   zip 体积：${(outSize / 1024 / 1024).toFixed(2)} MB`)
}

main().catch((e) => {
  console.error('❌ 打包失败：', e.message)
  process.exit(1)
})