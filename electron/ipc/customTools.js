const { ipcMain, app, shell, BrowserWindow, Notification } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')
const store = require('../utils/store')

// 默认自定义工具执行超时（30 秒）。单个工具执行超时不抛错，返回失败结果让 AI 自主换路径；防止用户工具 hang 住导致整个批处理永久挂着（render 端 invoke 无超时机制）。
const CUSTOM_TOOL_DEFAULT_TIMEOUT_MS = 30000

const TOOL_DIR_NAME = 'custom-tools'
const SPEC_FILE_NAME = 'custom-tools-spec.md'
const OVERRIDE_KEY = 'customToolsOverrides'

let toolCache = new Map() // id -> { manifest, dir }

const readOverrides = () => store.get(OVERRIDE_KEY, {}) || {}

const getUserToolDir = () => path.join(app.getPath('userData'), TOOL_DIR_NAME)

const getBundledToolDir = () => {
  try {
    // app.getAppPath() 在打包后指向 resources/app.asar 或 resources/app 目录
    // 开发环境指向项目根目录
    const baseDir = app.getAppPath()
    const dir = path.join(baseDir, TOOL_DIR_NAME)
    if (fs.existsSync(dir)) return dir
    // 兜底：从 __dirname 往上找两层（electron/ipc → electron → 根目录）
    const candidate = path.join(__dirname, '..', '..', TOOL_DIR_NAME)
    if (fs.existsSync(candidate)) return candidate
  } catch (e) {
    // ignore
  }
  return ''
}

// 递归扫描目录，找出所有包含 tool.json 的子目录（即工具目录）
// 支持嵌套结构：一个集合文件夹下可以放多个子工具，每个子工具有自己的 tool.json
const findToolDirsRecursive = (baseDir, results, seen) => {
  let entries = []
  try { entries = fs.readdirSync(baseDir, { withFileTypes: true }) } catch (e) { return }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = path.join(baseDir, entry.name)
    const key = path.resolve(dir)
    if (seen.has(key)) continue
    // 检查该目录下是否有 tool.json：有则视为工具目录
    if (fs.existsSync(path.join(dir, 'tool.json'))) {
      seen.add(key)
      results.push(dir)
    }
    // 无论当前目录是不是工具，都继续递归扫描子目录
    // （允许工具目录下还有子目录，也允许集合目录嵌套）
    findToolDirsRecursive(dir, results, seen)
  }
}

const listToolDirs = () => {
  const dirs = [getUserToolDir(), getBundledToolDir()].filter(Boolean)
  const toolDirs = []
  const seen = new Set()
  for (const base of dirs) {
    findToolDirsRecursive(base, toolDirs, seen)
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
  // 安全审计：自定义工具在主进程执行任意 JS，记录执行来源便于事后审计
  console.log(`[自定义工具审计] 执行工具: ${id}`)
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
  // 软超时：不抛 JS 错误、返回明确的失败结果让 AI 自主换路径，避免工具 hang 住整批处理
  const timeoutMs = CUSTOM_TOOL_DEFAULT_TIMEOUT_MS
  let __execTimer
  const __timeoutPromise = new Promise((resolve) => { __execTimer = setTimeout(() => resolve({ success: false, code: 'CUSTOM_TOOL_TIMEOUT', message: '自定义工具执行超时（' + Math.round(timeoutMs / 1000) + ' 秒）：' + id + '。请检查工具实现或拆分任务。' }), timeoutMs) })
  const __execPromise = Promise.resolve().then(() => execute(args || {}, context))
  const result = await Promise.race([__execPromise, __timeoutPromise]).catch((err) => ({ success: false, code: 'CUSTOM_TOOL_EXEC_ERROR', message: '自定义工具执行异常：' + ((err && err.message) || String(err)) }))
  try { clearTimeout(__execTimer) } catch (__e) {}
  // 原 await execute 行被替换
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
  const targetResolved = path.resolve(target)
  for (const file of (files || [])) {
    const rel = String(file.relativePath || '').replace(/\\/g, '/')
    if (!rel) continue
    // 安全加固：防止路径遍历（Zip Slip）—— 拒绝含 .. 的相对路径，确保写入后仍在 target 内
    if (rel.includes('..')) {
      throw new Error('文件路径包含非法字符（..），导入已取消')
    }
    const dest = path.join(target, rel)
    const destResolved = path.resolve(dest)
    if (!destResolved.startsWith(targetResolved + path.sep) && destResolved !== targetResolved) {
      throw new Error('文件路径越界，导入已取消')
    }
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

