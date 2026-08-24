const { ipcMain, app, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')
const store = require('../utils/store')

const TOOL_DIR_NAME = 'custom-tools'
const SPEC_FILE_NAME = 'custom-tools-spec.md'
const OVERRIDE_KEY = 'customToolsOverrides'

let toolCache = new Map() // id -> { manifest, dir }

const readOverrides = () => store.get(OVERRIDE_KEY, {}) || {}

const getUserToolDir = () => path.join(app.getPath('userData'), TOOL_DIR_NAME)

const getBundledToolDir = () => {
  try {
    return path.join(process.cwd(), TOOL_DIR_NAME)
  } catch (e) {
    return ''
  }
}

const listToolDirs = () => {
  const dirs = [getUserToolDir(), getBundledToolDir()].filter(Boolean)
  const toolDirs = []
  const seen = new Set()
  for (const base of dirs) {
    let entries = []
    try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch (e) { continue }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const dir = path.join(base, entry.name)
      const key = path.resolve(dir)
      if (seen.has(key)) continue
      seen.add(key)
      toolDirs.push(dir)
    }
  }
  return toolDirs
}

const readManifest = (dir) => {
  try {
    const raw = fs.readFileSync(path.join(dir, 'tool.json'), 'utf8')
    const manifest = JSON.parse(raw)
    if (!manifest || !manifest.id) return null
    return manifest
  } catch (e) {
    return null
  }
}

const loadTools = () => {
  toolCache.clear()
  const overrides = readOverrides()
  for (const dir of listToolDirs()) {
    const manifest = readManifest(dir)
    if (!manifest) continue
    const patched = { ...manifest, ...(overrides[String(manifest.id)] || {}) }
    toolCache.set(String(manifest.id), { manifest: patched, dir })
  }
  return [...toolCache.values()].map(({ manifest, dir }) => ({
    ...manifest,
    dir,
    hasScript: fs.existsSync(path.join(dir, 'tool.js'))
  }))
}

const updateTool = (id, patch) => {
  const item = getTool(id)
  if (!item) throw new Error(`未找到自定义工具：${id}`)
  const overrides = readOverrides()
  overrides[String(id)] = {
    ...(overrides[String(id)] || {}),
    ...(patch || {})
  }
  store.set(OVERRIDE_KEY, overrides)
  toolCache.delete(String(id))
  return getTool(id)
}

const getTool = (id) => {
  if (!toolCache.has(String(id))) loadTools()
  return toolCache.get(String(id)) || null
}

const executeTool = async (id, args = {}, meta = {}) => {
  const item = getTool(id)
  if (!item) throw new Error(`未找到自定义工具：${id}`)
  const scriptPath = path.join(item.dir, 'tool.js')
  if (!fs.existsSync(scriptPath)) throw new Error('工具缺少 tool.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  // 自定义工具规范使用 ESM；Electron/Node 对 .js 文件默认按 CommonJS 解析，
  // 直接 import 会遇到 "Unexpected token 'export'"。复制为 .mjs 后动态导入即可兼容 ESM。
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmct-'))
  const tmpFile = path.join(tmpDir, 'tool.mjs')
  fs.writeFileSync(tmpFile, source, 'utf8')
  let mod
  try {
    mod = await import(`${pathToFileURL(tmpFile).href}?v=${Date.now()}`)
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) {}
  }
  const execute = mod.execute || mod.default?.execute || mod.default
  if (typeof execute !== 'function') throw new Error('tool.js 必须导出 execute 函数')
  const context = {
    app: {
      version: app.getVersion(),
      userDataDir: app.getPath('userData')
    },
    file: {
      currentFilePath: String(meta.currentFilePath || ''),
      currentFileName: String(meta.currentFileName || '')
    },
    http: {
      fetch: globalThis.fetch
    }
  }
  const result = await execute(args || {}, context)
  if (typeof result === 'string') return { success: true, message: result }
  if (result && typeof result === 'object') return result
  return { success: true, message: '工具执行完成', data: result }
}

const getSpecPath = () => {
  const candidates = [
    path.join(process.cwd(), 'docs', SPEC_FILE_NAME),
    path.join(__dirname, '..', '..', 'docs', SPEC_FILE_NAME)
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return ''
}

const ensureUserToolDir = () => {
  const dir = getUserToolDir()
  try { fs.mkdirSync(dir, { recursive: true }) } catch (e) {}
  return dir
}

const sanitizeFolderName = (name) => String(name || 'custom_tool').replace(/[\\/:*?"<>|]/g, '_').trim() || 'custom_tool'

const importFolder = async ({ folderName, files }) => {
  const base = ensureUserToolDir()
  const safeName = sanitizeFolderName(folderName)
  let target = path.join(base, safeName)
  let suffix = 2
  while (fs.existsSync(target)) {
    target = path.join(base, `${safeName}-${suffix}`)
    suffix++
  }
  fs.mkdirSync(target, { recursive: true })
  for (const file of (files || [])) {
    const rel = String(file.relativePath || '').replace(/\\/g, '/')
    if (!rel) continue
    const dest = path.join(target, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const buf = Buffer.from(file.base64 || '', 'base64')
    fs.writeFileSync(dest, buf)
  }
  loadTools()
  return { ok: true, dir: target }
}

ipcMain.handle('customTools:list', async () => loadTools())
ipcMain.handle('customTools:update', async (e, id, patch) => updateTool(id, patch || {}))
ipcMain.handle('customTools:call', async (e, id, args, meta) => {
  return executeTool(id, args || {}, meta || {})
})
ipcMain.handle('customTools:openDir', async () => {
  const dir = ensureUserToolDir()
  const err = await shell.openPath(dir)
  return { ok: !err, error: err || '', dir }
})
ipcMain.handle('customTools:getSpec', async () => {
  const specPath = getSpecPath()
  if (!specPath) return { ok: false, error: '未找到编写规范文件' }
  return { ok: true, path: specPath, content: fs.readFileSync(specPath, 'utf8') }
})
ipcMain.handle('customTools:saveSpec', async () => {
  const specPath = getSpecPath()
  if (!specPath) return { ok: false, error: '未找到编写规范文件' }
  const dir = ensureUserToolDir()
  const target = path.join(dir, SPEC_FILE_NAME)
  fs.copyFileSync(specPath, target)
  return { ok: true, path: target }
})
ipcMain.handle('customTools:importFolder', async (e, payload) => importFolder(payload || {}))

module.exports = {}
