const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')

const projectDir = process.cwd()
const outPath = path.join(projectDir, 'my-mindmap-agent-source.zip')
const excludeDirs = new Set([
  'node_modules', 'dist', 'release', '.git',
  '.workbuddy', '.trae', '.trae-cn', '.vscode'
])

async function main() {
  const zip = new JSZip()
  let fileCount = 0

  function walk(dir, rel) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const name = e.name
      if (rel === '' && excludeDirs.has(name)) continue
      const full = path.join(dir, name)
      const relPath = rel ? rel + '/' + name : name
      if (e.isDirectory()) {
        walk(full, relPath)
      } else if (e.isFile()) {
        if (name.toLowerCase().endsWith('.zip')) continue
        zip.file(relPath, fs.readFileSync(full))
        fileCount++
      }
    }
  }

  walk(projectDir, '')
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  })
  fs.writeFileSync(outPath, buf)
  console.log('DONE:', outPath)
  console.log('Files:', fileCount)
  console.log('Size MB:', (buf.length / 1024 / 1024).toFixed(2))
}

main().catch((e) => { console.error(e); process.exit(1) })
