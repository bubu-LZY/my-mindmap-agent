const { ipcMain, app, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile, fork } = require('child_process')
const store = require('../utils/store')

const TOOL_DIR_NAME = 'custom-tools'
const SPEC_FILE_NAME = 'skills-mcp-tools.md'
const OVERRIDE_KEY = 'customToolsOverrides'

// 子进程执行器源码：打包进 asar 后，主进程可直接读；运行前再写入临时目录并 fork，
// 避免 child_process 直接 fork asar 内脚本的兼容性问题。
const WORKER_SOURCE = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, 'customToolWorker.cjs'), 'utf8')
  } catch (e) {
    return ''
  }
})()

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

// 子进程 RPC：文件读写 / PowerShell 仍回到主进程执行，并在这里做路径白名单校验。
const handleToolRpc = async (method, params, { assertAllowedFile }) => {
  if (method === 'file.writeText') {
    assertAllowedFile(params?.filePath)
    await fs.promises.writeFile(String(params.filePath), String(params?.content ?? ''), 'utf8')
    return { success: true, filePath: params.filePath }
  }
  if (method === 'file.readText') {
    assertAllowedFile(params?.filePath)
    return await fs.promises.readFile(String(params.filePath), 'utf8')
  }
  if (method === 'file.exists') {
    try {
      assertAllowedFile(params?.filePath)
      await fs.promises.access(String(params.filePath))
      return true
    } catch {
      return false
    }
  }
  if (method === 'shell.powerShell') {
    const timeoutMs = Math.min(Math.max(Number(params?.options?.timeoutMs) || 30000, 1000), 120000)
    return await new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', String(params?.script || '')], {
        timeout: timeoutMs,
        windowsHide: true
      }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message))
        else resolve({ success: true, stdout: String(stdout || ''), stderr: String(stderr || '') })
      })
    })
  }
  throw new Error('未知 RPC 方法：' + method)
}

const executeTool = async (id, args = {}, meta = {}) => {
  const item = getTool(id)
  if (!item) throw new Error(`未找到自定义工具：${id}`)
  // 安全审计：自定义工具在独立子进程执行，记录执行来源便于事后审计
  console.log(`[自定义工具审计] 执行工具: ${id}`)
  const scriptPath = path.join(item.dir, 'tool.js')
  if (!fs.existsSync(scriptPath)) throw new Error('工具缺少 tool.js')
  const source = fs.readFileSync(scriptPath, 'utf8')
  if (!WORKER_SOURCE) throw new Error('自定义工具执行器缺失，无法启动隔离子进程')

  const allowedRoots = [
    app.getPath('userData'),
    app.getPath('temp'),
    app.getPath('documents'),
    app.getPath('downloads'),
    app.getPath('desktop'),
    String(meta.currentFilePath || '') ? path.dirname(String(meta.currentFilePath)) : ''
  ].filter(Boolean)
  const assertAllowedFile = (filePath) => {
    if (!filePath || typeof filePath !== 'string') throw new Error('filePath 无效')
    const target = path.resolve(filePath)
    const inside = allowedRoots.some((root) => {
      const rel = path.relative(path.resolve(root), target)
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    })
    if (!inside) {
      throw new Error('自定义工具只能访问用户数据目录、临时目录、常用文档目录或当前文件所在目录')
    }
  }

  const timeoutMs = Math.min(Math.max(Number(item.manifest.timeoutMs) || 30000, 1000), 120000)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmct-'))
  const tmpToolFile = path.join(tmpDir, 'tool.mjs')
  const tmpWorkerFile = path.join(tmpDir, 'worker.cjs')
  fs.writeFileSync(tmpToolFile, source, 'utf8')
  fs.writeFileSync(tmpWorkerFile, WORKER_SOURCE, 'utf8')
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) {} }

  const contextMeta = {
    appVersion: app.getVersion(),
    userDataDir: app.getPath('userData'),
    currentFilePath: String(meta.currentFilePath || ''),
    currentFileName: String(meta.currentFileName || ''),
    allowShell: item.manifest.powershell === true
  }

  return await new Promise((resolve) => {
    let settled = false
    let child = null
    let timer = null
    const finish = (val) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try { child?.kill() } catch (e) {}
      cleanup()
      resolve(val)
    }
    timer = setTimeout(() => finish({ success: false, message: `自定义工具执行超时（${timeoutMs}ms）` }), timeoutMs)

    try {
      // Electron 主进程里 fork 会把子进程用 Electron 二进制拉起，必须显式置
      // ELECTRON_RUN_AS_NODE=1 让其以纯 Node 运行（否则子进程拿不到 process.send）。
      child = fork(tmpWorkerFile, [], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      })
    } catch (e) {
      finish({ success: false, message: e?.message || String(e) })
      return
    }

    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'rpc') {
        handleToolRpc(msg.method, msg.params, { assertAllowedFile })
          .then((result) => { try { child.send({ type: 'rpc-result', id: msg.id, ok: true, result }) } catch (e) {} })
          .catch((e) => { try { child.send({ type: 'rpc-result', id: msg.id, ok: false, error: (e && e.message) || String(e) }) } catch (e2) {} })
      } else if (msg.type === 'result') {
        if (msg.ok) {
          let result = null
          try { result = JSON.parse(msg.payload) } catch (e) { result = msg.payload }
          if (typeof result === 'string') finish({ success: true, message: result })
          else if (result && typeof result === 'object') finish(result)
          else finish({ success: true, message: '工具执行完成', data: result })
        } else {
          finish({ success: false, message: msg.error || '自定义工具执行失败' })
        }
      }
    })
    child.on('error', (err) => finish({ success: false, message: err?.message || String(err) }))
    child.on('exit', (code) => {
      if (!settled) finish({ success: false, message: `自定义工具进程异常退出（code=${code}）` })
    })

    child.send({ type: 'run', args, contextMeta, tmpFile: tmpToolFile })
  })
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
