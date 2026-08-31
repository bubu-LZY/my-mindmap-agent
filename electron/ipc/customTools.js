const { ipcMain, app, shell, BrowserWindow, Notification } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')
const store = require('../utils/store')

// 默认自定义工具执行超时（30 秒）。单个工具执行超时不抛错，返回失败结果让 AI 自主换路径；防止用户工具 hang 住导致整个批处理永久挂着（render 端 invoke 无超时机制）。
const CUSTOM_TOOL_DEFAULT_TIMEOUT_MS = 30000

// 自定义工具与渲染层导图编辑的「请求-响应」桥接：
// 工具脚本（主进程内执行）调用 context.mindmap.* 时，内部用 webContents.send 把请求发给
// 渲染层，渲染层执行对应导图操作后用 ipcRenderer.send 把结果回传。主进程用 pendingRequests
// 按 reqId 匹配并 resolve 响应，让工具看起来像同步调用导图 API。
const pendingRequests = new Map() // reqId -> { resolve, reject, timer }
let __mmReqSeq = 0

function sendMindmapRequest(payload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const wins = BrowserWindow.getAllWindows().filter(w => w && !w.isDestroyed())
    if (!wins.length) {
      reject(new Error('当前没有可用的应用窗口（请确认桌面应用已启动并打开主窗口）'))
      return
    }
    const reqId = `mmreq_${Date.now()}_${++__mmReqSeq}`
    const timer = setTimeout(() => {
      if (pendingRequests.has(reqId)) {
        pendingRequests.delete(reqId)
        reject(new Error('导图操作超时（' + Math.round(timeoutMs / 1000) + ' 秒）：' + (payload && payload.kind || '') + '。请确认已打开一个导图文件。'))
      }
    }, timeoutMs)
    pendingRequests.set(reqId, { resolve, reject, timer })
    try {
      // 只把请求发给可见的主窗口，避免误投到隐藏的托盘窗口
      const win = wins.find(w => w.isVisible && w.isVisible()) || wins[0]
      win.webContents.send('customTools:mindmapRequest', { reqId, payload })
    } catch (e) {
      pendingRequests.delete(reqId)
      clearTimeout(timer)
      reject(e)
    }
  })
}

// 渲染层调用结果回传入口
ipcMain.on('customTools:mindmapResponse', (_event, msg) => {
  if (!msg || !msg.reqId || !pendingRequests.has(msg.reqId)) return
  const { resolve, reject, timer } = pendingRequests.get(msg.reqId)
  pendingRequests.delete(msg.reqId)
  try { clearTimeout(timer) } catch (e) {}
  if (msg.error) reject(new Error(msg.error))
  else resolve(msg.result)
})

// 封装给工具调用的 context.mindmap API
// 提供 listNodes / getNodeText / setNodeText / applyTextStyle / save 等高频操作；
// 全部基于上面 sendMindmapRequest 与渲染层 simple-mind-map 实例通信。
const mindmapContextApi = {
  /**
   * 列出当前打开文件的所有节点（包含 uids、文本、层级、子节点数）
   * @returns {Promise<{success:boolean, nodes:Array, total:number, fileName:string}>}
   */
  async listNodes() {
    try {
      return await sendMindmapRequest({ kind: 'listNodes' }, 30000)
    } catch (e) {
      return { success: false, error: e.message }
    }
  },
  /**
   * 获取指定节点的纯文本（不含富文本标签）。uid 可省略——省略时返回根节点
   * @param {string} [uid]
   */
  async getNodeText(uid) {
    try {
      return await sendMindmapRequest({ kind: 'getNodeText', uid }, 15000)
    } catch (e) {
      return { success: false, error: e.message }
    }
  },
  /**
   * 替换节点的富文本 HTML。等价于 mindMap.execCommand('SET_NODE_TEXT', node, html, true, false)
   * @param {string} uid
   * @param {string} html
   */
  async setNodeText(uid, html) {
    if (!uid || typeof html !== 'string') return { success: false, error: 'uid 与 html 必填' }
    try {
      return await sendMindmapRequest({ kind: 'setNodeText', uid, html }, 15000)
    } catch (e) {
      return { success: false, error: e.message }
    }
  },
  /**
   * 对节点文本应用样式动作（粗体 / 斜体 / 删除线 / 下划线 / 颜色 / 高亮 等）
   * @param {object} args { uid?, textRegex?, textContains?, action: 'bold'|'italic'|'strikethrough'|'underline'|'color:xxx'|'highlight:xxx', preview? }
   *   - uid 指定单个节点；否则按 textRegex/textContains 过滤全部节点
   * @returns {Promise<{success:boolean, matched:number, changed:number}>}
   */
  async applyTextStyle(args) {
    const opts = args || {}
    if (!opts.action) return { success: false, error: 'action 必填' }
    try {
      return await sendMindmapRequest({ kind: 'applyTextStyle', opts }, 30000)
    } catch (e) {
      return { success: false, error: e.message }
    }
  },
  /**
   * 把当前导图保存到磁盘（等价于用户点保存按钮）。
   * @returns {Promise<{success:boolean, filePath?:string}>}
   */
  async save() {
    try {
      return await sendMindmapRequest({ kind: 'save' }, 30000)
    } catch (e) {
      return { success: false, error: e.message }
    }
  },
  /** 当前打开的文件信息 */
  async currentFile() {
    try {
      return await sendMindmapRequest({ kind: 'currentFile' }, 5000)
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
}

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
    },
    // 导图编辑 API（按需走 IPC 与渲染层 simple-mind-map 通信）：
    // 工具可读取/修改当前打开的导图节点文本与样式。例如：
    //   const { nodes } = await context.mindmap.listNodes()
    //   await context.mindmap.applyTextStyle({ textRegex: /^([^：:]+)/, action: 'bold' })
    mindmap: mindmapContextApi
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

