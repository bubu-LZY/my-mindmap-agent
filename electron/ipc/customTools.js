const { ipcMain, app, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const TOOL_DIR_NAME = 'custom-tools'
const SPEC_FILE_NAME = 'custom-tools-spec.md'

let toolCache = new Map() // id -> { manifest, dir }

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
  for (const dir of listToolDirs()) {
    const manifest = readManifest(dir)
    if (!manifest) continue
    toolCache.set(String(manifest.id), { manifest, dir })
  }
  return [...toolCache.values()].map(({ manifest, dir }) => ({
    ...manifest,
    dir,
    hasScript: fs.existsSync(path.join(dir, 'tool.js'))
  }))
}

const getTool = (id) => {
  if (!toolCache.has(String(id))) loadTools()
  return toolCache.get(String(id)) || null
}

const executeTool = async (id, args = {}) => {
  const item = getTool(id)
  if (!item) throw new Error(`未找到自定义工具：${id}`)
  const scriptPath = path.join(item.dir, 'tool.js')
  if (!fs.existsSync(scriptPath)) throw new Error('工具缺少 tool.js')
  const moduleUrl = pathToFileURL(scriptPath).href
  const mod = await import(`${moduleUrl}?v=${Date.now()}`)
  const execute = mod.execute || mod.default?.execute || mod.default
  if (typeof execute !== 'function') throw new Error('tool.js 必须导出 execute 函数')
  const context = {
    app: {
      version: app.getVersion(),
      userDataDir: app.getPath('userData')
    },
    file: {
      currentFilePath: '',
      currentFileName: ''
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

ipcMain.handle('customTools:list', async () => loadTools())
ipcMain.handle('customTools:call', async (e, id, args) => {
  return executeTool(id, args || {})
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

module.exports = {}
