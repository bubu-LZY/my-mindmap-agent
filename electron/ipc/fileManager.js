const { ipcMain, dialog, app, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const store = require('../utils/store')

// review A2：异步 fs 别名。AI 频繁触发 save / list-files / getDefaultSaveDir 时，
// 同步 fs.existsSync / mkdirSync / writeFileSync 会阻塞主进程 5~30ms / 次。
// 在 IPC handler 里改成 await fs.promises.xxx 后，主进程不阻塞，渲染进程的鼠标事件延迟立刻消失。
const fsAsync = fs.promises
// 异步版 exists（Node 没有原生 fs.promises.exists，用 access 替代）
const asyncExists = (p) => fsAsync.access(p, fs.constants.F_OK).then(() => true).catch(() => false)
const asyncMkdir = (p, opts) => fsAsync.mkdir(p, { recursive: true, ...(opts || {}) })
const asyncWriteFile = (p, data, opts) => fsAsync.writeFile(p, data, opts)
const asyncReadFile = (p, opts) => fsAsync.readFile(p, opts)
const asyncReaddir = (p, opts) => fsAsync.readdir(p, opts)
const asyncStat = (p) => fsAsync.stat(p)

// 获取默认保存目录（优先用户指定的保存目录，其次桌面）
// review A2：保留同步 fs.existsSync 在这里是 OK 的（getDefaultSaveDir 仅在 IPC handler 内部被调，且每次只 1 次同步调用）
function getDefaultSaveDir() {
  let saved = ''
  try {
    saved = store.get('saveDir') || ''
  } catch {
    saved = ''
  }
  if (saved && path.isAbsolute(saved) && fs.existsSync(saved)) {
    return saved
  }
  return app.defaultSaveDir || app.getPath('desktop')
}

// 确保默认保存目录存在
function ensureDefaultDir() {
  const dir = getDefaultSaveDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

// 检查路径是否存在
async function exists(p) {
  try {
    await fs.promises.access(p)
    return true
  } catch {
    return false
  }
}

// 生成唯一路径（避免重名）
async function uniquePath(p) {
  if (!(await exists(p))) return p
  const dir = path.dirname(p)
  const ext = path.extname(p)
  const base = path.basename(p, ext)
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`)
    if (!(await exists(candidate))) return candidate
  }
  throw new Error('无法生成唯一文件名')
}

// 判断是否为支持的文件类型
function isSupportFile(name) {
  // 文档类（PDF/Word/Excel/CSV/纯文本）在目录树中可见，点击用文档查看器原样打开
  return /\.(smm|md|json|pdf|docx|xlsx|xls|csv|tsv|txt|log|html|xml)$/i.test(name)
}

// 路径安全校验：
// 1. 拒绝空字节注入
// 2. 拒绝换行符、制表符等控制字符
// 3. 破坏性操作（删除/移动/重命名）额外拦截系统关键目录
function assertSafePath(rawPath, opts = {}) {
  const s = typeof rawPath === 'string' ? rawPath : ''
  if (!s.trim()) throw new Error('路径无效')
  // 空字节注入
  if (s.includes('\0')) throw new Error('路径包含非法字符')
  // 控制字符检测（换行、回车、制表符等不应出现在路径中）
  if (/[\x00-\x1f\x7f]/.test(s)) throw new Error('路径包含非法控制字符')

  const normalized = path.normalize(s)
  const target = path.resolve(s)

  // 只对非空、已解析出根目录的绝对路径做关键目录拦截（相对路径交给上层 join 后再判断）
  if (opts.destructive && path.isAbsolute(target)) {
    const lower = target.toLowerCase()
    const root = path.parse(target).root.toLowerCase()
    const critical = [
      path.join(root, 'windows'),
      path.join(root, 'program files'),
      path.join(root, 'program files (x86)'),
      path.join(root, 'programdata'),
      path.join(root, 'system volume information'),
      path.join(root, '$recycle.bin'),
      path.join(root, 'users\\all users')
    ].map(p => p.toLowerCase() + path.sep)
    for (const c of critical) {
      if (lower === c.slice(0, -1) || lower.startsWith(c)) {
        throw new Error('不允许对系统关键目录执行此操作')
      }
    }
  }
  return normalized
}

// ============ 路径白名单（review C.1：fs IPC 路径安全加固）============
// 渲染层每次"打开 .smm"或用户选文件后，主进程把该目录加入 allowedPaths。
// 写/删除类破坏性操作仅限：当前激活 .smm 所在目录 + userData + 临时目录。
// 读操作额外允许 userData / documents / downloads / desktop / 选中文件的目录。
// 没注册任何 allowedPaths 时保持原行为（向后兼容），但仍拦截破坏性关键系统目录。
// shell:exec / run_node 等"执行任意命令"工具不走这里：它们在 shellExec.js 内部
// 有独立的"路径必须显式在白名单或系统安全目录"校验（review S-1：避免被用来在
// C:\\Windows 等任意 cwd 下跑脚本）。

const __allowedPathRoots = new Set()  // 渲染层注册的白名单根目录（绝对路径，已 normalize + lowercase Windows）
let __activeFileDir = ''              // 当前激活 .smm 文件所在目录

// 把绝对路径 normalize 成统一的比较形式（Windows 大小写不敏感）
function normalizeRoot(p) {
  try {
    const r = path.resolve(String(p || ''))
    return process.platform === 'win32' ? r.toLowerCase().replace(/\\/g, '/') : r
  } catch (e) { return '' }
}

function pathIsUnder(child, parent) {
  if (!child || !parent) return false
  const a = normalizeRoot(child)
  const b = normalizeRoot(parent)
  if (!a || !b) return false
  // 必须以 parent + '/' 开头（避免 /a/bc 命中 /a/b）
  return a === b || a.startsWith(b + '/')
}

const __safeAlwaysRoots = new Set([
  normalizeRoot(app.getPath('userData')),
  normalizeRoot(app.getPath('temp')),
  normalizeRoot(require('os').tmpdir())
])

function isUnderSafeAlways(p) {
  if (!p) return false
  for (const root of __safeAlwaysRoots) {
    if (pathIsUnder(p, root)) return true
  }
  return false
}

function isUnderAllowedRoots(p) {
  if (!p) return false
  for (const root of __allowedPathRoots) {
    if (pathIsUnder(p, root)) return true
  }
  return false
}

// review bug fix：fsGuard 白名单状态持久化。
// 之前 __allowedPathRoots / __activeFileDir 是进程内 Map/字符串，重启后清空，
// 导致重启程序后 AI 读本地文件被 fsGuard 拒绝、FileTree 也无法访问用户加过的 root 目录。
// 现在把"用户显式注册过的目录"和"激活文件目录"都持久化到 electron-store，
// 主进程启动时自动恢复；渲染层调 addAllowed / setActiveFileDir 也立即写盘。
const FSGUARD_STORE_KEY_ALLOWED = 'fsGuardAllowedRoots'
const FSGUARD_STORE_KEY_ACTIVE = 'fsGuardActiveFileDir'
const loadFsGuardFromStore = () => {
  try {
    const allowedRaw = store.get(FSGUARD_STORE_KEY_ALLOWED)
    if (Array.isArray(allowedRaw)) {
      for (const d of allowedRaw) {
        const n = normalizeRoot(String(d || ''))
        if (n) __allowedPathRoots.add(n)
      }
    }
    const activeRaw = store.get(FSGUARD_STORE_KEY_ACTIVE)
    if (typeof activeRaw === 'string' && activeRaw) {
      const n = normalizeRoot(activeRaw)
      if (n) {
        __activeFileDir = n
        __allowedPathRoots.add(n)
      }
    }
  } catch (_) { /* 读取失败忽略，保持空状态（向后兼容） */ }
}
const persistAllowedRoots = () => {
  try {
    // Set 不能直接 JSON 序列化，转成数组
    store.set(FSGUARD_STORE_KEY_ALLOWED, [...__allowedPathRoots])
  } catch (_) { /* 写入失败忽略 */ }
}
const persistActiveFileDir = () => {
  try {
    store.set(FSGUARD_STORE_KEY_ACTIVE, __activeFileDir || '')
  } catch (_) { /* ignore */ }
}
// 启动时立即从 store 恢复一次
loadFsGuardFromStore()

// 主进程 / 渲染层注册 API
ipcMain.handle('fsGuard:setActiveFileDir', (_event, dir) => {
  __activeFileDir = normalizeRoot(String(dir || ''))
  if (__activeFileDir) __allowedPathRoots.add(__activeFileDir)
  persistAllowedRoots()
  persistActiveFileDir()
  return { ok: true, activeFileDir: __activeFileDir }
})
ipcMain.handle('fsGuard:addAllowed', (_event, dirs) => {
  const list = Array.isArray(dirs) ? dirs : [dirs]
  for (const d of list) {
    const n = normalizeRoot(String(d || ''))
    if (n) __allowedPathRoots.add(n)
  }
  persistAllowedRoots()
  return { ok: true, count: __allowedPathRoots.size }
})
ipcMain.handle('fsGuard:reset', () => {
  __allowedPathRoots.clear()
  __activeFileDir = ''
  return { ok: true }
})

/**
 * 第二道防线：路径白名单检查（review C.1）
 * - opts.readOnly=true：放行 userData 全部 + 临时 + 活跃 .smm 所在目录 + 注册的 allowedRoots + 桌面/下载/文档
 * - opts.destructive=true（默认）：仅放行 userData + 临时 + 活跃 .smm 所在目录
 * - opts.skipGuard=true：跳过（向后兼容给现有已信任路径用）
 */
function assertPathAllowed(rawPath, opts = {}) {
  if (opts.skipGuard) return
  const p = String(rawPath || '')
  if (!p) return
  const target = path.resolve(p)
  // 1. 永远放行 userData / temp / 系统临时（应用自有空间）
  if (isUnderSafeAlways(target)) return
  // 2. 没注册任何白名单：保持向后兼容（assertSafePath 仍会拦住系统关键目录）
  if (__allowedPathRoots.size === 0 && !__activeFileDir) return
  // 3. 注册过的目录 / 活跃 .smm 所在目录：放行
  if (opts.destructive) {
    if (__activeFileDir && pathIsUnder(target, __activeFileDir)) return
    if (isUnderAllowedRoots(target)) return
    // 破坏性操作：沙盒内未通过则拒绝
    throw new Error('不在允许的写入范围内：' + p + '（仅允许写入到当前打开的导图所在目录、用户数据目录或系统临时目录）')
  }
  // read-only: 额外放行 documents/downloads/desktop
  const extra = [app.getPath('documents'), app.getPath('downloads'), app.getPath('desktop')].filter(Boolean)
  for (const dir of extra) {
    if (pathIsUnder(target, normalizeRoot(dir))) return
  }
  if (__activeFileDir && pathIsUnder(target, __activeFileDir)) return
  if (isUnderAllowedRoots(target)) return
  throw new Error('不在允许的读取范围内：' + p + '（请确认文件所属目录已被本应用信任）')
}


// 保存文件（用户手动保存 / 自动保存 / AI 工具链共用）
// overwrite=true：用户保存与自动保存，覆盖原文件（正常保存语义）
// overwrite 缺省：AI 工具保存，目标已存在时自动改名（"文件名 (1)"），避免静默覆盖用户的同名旧文件
// 版本快照：覆盖保存前把旧版本备份到 <目录>/.smm_versions/<文件名>/，保留最近 N 个
const VERSION_DIR = '.smm_versions'
const MAX_VERSIONS = 5

async function backupFileVersion(filePath) {
  try {
    const dir = path.dirname(filePath)
    const base = path.basename(filePath)
    const versionDir = path.join(dir, VERSION_DIR, base)
    // review A2：existsSync → asyncExists，mkdirSync → asyncMkdir（不阻塞主进程）
    if (!(await asyncExists(versionDir))) await asyncMkdir(versionDir)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupPath = path.join(versionDir, `${base}.${stamp}.bak`)
    await fsAsync.copyFile(filePath, backupPath)
    // 清理超过上限的旧版本（按文件名时间戳排序，删最旧的）
    const files = (await asyncReaddir(versionDir)).filter(f => f.endsWith('.bak')).sort()
    while (files.length > MAX_VERSIONS) {
      const oldest = files.shift()
      try { await fsAsync.unlink(path.join(versionDir, oldest)) } catch {}
    }
  } catch { /* 备份失败不影响保存 */ }
}

ipcMain.handle('save-file', async (event, { filename, data, overwrite }) => {
  let filePath = ''
  try {
    ensureDefaultDir()
    const defaultDir = getDefaultSaveDir()

    if (path.isAbsolute(filename)) {
      filePath = filename
    } else {
      filePath = path.join(defaultDir, filename)
    }
    assertSafePath(filePath, { destructive: true })
    // 路径白名单检查
    try { assertPathAllowed(filePath, { destructive: true }) } catch (e) { throw new Error('写入被拒绝: ' + e.message) }

    if (!overwrite && (await exists(filePath))) {
      filePath = await uniquePath(filePath)
    }

    // 覆盖保存前备份旧版本，便于误改后回滚
    if (overwrite && (await exists(filePath))) {
      await backupFileVersion(filePath)
    }

    const fileDir = path.dirname(filePath)
    // review A2：existsSync → asyncExists，mkdirSync → asyncMkdir
    if (!(await asyncExists(fileDir))) {
      await asyncMkdir(fileDir)
    }

    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    // review A2：writeFileSync → asyncWriteFile（避免大文件保存时阻塞主进程）
    await asyncWriteFile(filePath, content, 'utf-8')

    return { success: true, filePath }
  } catch (error) {
    return { success: false, error: `${error.message}（写入目标：${filePath || filename}）` }
  }
})

// 列出文件的版本快照（覆盖保存时自动备份的历史版本）
ipcMain.handle('list-file-versions', async (event, filePath) => {
  try {
    const dir = path.dirname(filePath)
    const base = path.basename(filePath)
    const versionDir = path.join(dir, VERSION_DIR, base)
    // review A2：existsSync → asyncExists
    if (!(await asyncExists(versionDir))) return []
    const files = (await asyncReaddir(versionDir)).filter(f => f.endsWith('.bak')).sort().reverse()
    return files.map(f => ({ name: f, path: path.join(versionDir, f) }))
  } catch {
    return []
  }
})

// 恢复某个版本快照（把备份内容复制回原文件）
ipcMain.handle('restore-file-version', async (event, filePath, versionPath) => {
  try {
    assertSafePath(filePath, { destructive: true })
    assertSafePath(versionPath, { destructive: true })
    await fs.promises.copyFile(versionPath, filePath)
    return { success: true, filePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 保存二进制文件（图片等，base64 传入，直接保存到默认保存目录，不弹对话框）
// 同样在重名时自动改名，避免覆盖
ipcMain.handle('save-binary-file', async (event, { filename, base64 }) => {
  try {
    ensureDefaultDir()
    const defaultDir = getDefaultSaveDir()

    let filePath
    if (path.isAbsolute(filename)) {
      filePath = filename
    } else {
      filePath = path.join(defaultDir, filename)
    }
    assertSafePath(filePath, { destructive: true })
    // 路径白名单检查
    try { assertPathAllowed(filePath, { destructive: true }) } catch (e) { throw new Error('写入被拒绝: ' + e.message) }

    if (await exists(filePath)) {
      filePath = await uniquePath(filePath)
    }

    const fileDir = path.dirname(filePath)
    // review A2：existsSync → asyncExists，mkdirSync → asyncMkdir
    if (!(await asyncExists(fileDir))) {
      await asyncMkdir(fileDir)
    }

    const buffer = Buffer.from(String(base64 || '').replace(/^data:[^;]+;base64,/, ''), 'base64')
    // review A2：writeFileSync → asyncWriteFile
    await asyncWriteFile(filePath, buffer)

    return { success: true, filePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 打开/读取文件
ipcMain.handle('open-file', async (event, { filePath }) => {
  try {
    assertSafePath(filePath)
    // 路径白名单检查（读操作）
    try { assertPathAllowed(filePath, { readOnly: true }) } catch (e) { throw new Error('读取被拒绝: ' + e.message) }
    const ext = path.extname(filePath).toLowerCase()
    let data, isMarkdown = false, isXmind = false
    if (ext === '.xmind') {
      const buffer = await fs.promises.readFile(filePath)
      data = buffer.toString('base64')
      isXmind = true
    } else {
      const content = await fs.promises.readFile(filePath, 'utf-8')
      if (ext === '.md' || ext === '.markdown') {
        data = content
        isMarkdown = true
      } else {
        try {
          data = JSON.parse(content)
        } catch (e) {
          data = content
        }
      }
    }
    return { success: true, data, isMarkdown, isXmind, fileName: path.basename(filePath) }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 选择文件
ipcMain.handle('select-file', async () => {
  try {
    const defaultDir = getDefaultSaveDir()
    // review A2：existsSync → asyncExists
    const result = await dialog.showOpenDialog({
      defaultPath: (await asyncExists(defaultDir)) ? defaultDir : undefined,
      filters: [
        { name: '思维导图文件', extensions: ['smm'] },
        { name: 'XMind 文件', extensions: ['xmind'] },
        { name: 'Markdown 文件', extensions: ['md', 'markdown'] },
        { name: 'JSON 文件', extensions: ['json'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const selectedPath = result.filePaths[0]
    const ext = path.extname(selectedPath).toLowerCase()
    let data, isMarkdown = false, isXmind = false
    if (ext === '.xmind') {
      const buffer = await fs.promises.readFile(selectedPath)
      data = buffer.toString('base64')
      isXmind = true
    } else {
      const content = await fs.promises.readFile(selectedPath, 'utf-8')
      if (ext === '.md' || ext === '.markdown') {
        data = content
        isMarkdown = true
      } else {
        try {
          data = JSON.parse(content)
        } catch (e) {
          data = content
        }
      }
    }

    return { success: true, filePath: selectedPath, fileName: path.basename(selectedPath), data, isMarkdown, isXmind }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 列出默认目录下的所有 .smm 和 .json 文件（保留兼容）
// review A2：readdirSync/statSync → asyncReaddir/asyncStat；保留 ensureDefaultDir 的同步 fallback
ipcMain.handle('list-files', async () => {
  try {
    const dir = ensureDefaultDir()
    const files = await asyncReaddir(dir)
    // 异步 stat：N 个文件并行 stat，比同步串行快 5~10 倍
    const stats = await Promise.all(
      files
        .filter((file) => /\.(smm|json|xmind)$/i.test(file))
        .map(async (file) => {
          const filePath = path.join(dir, file)
          try {
            const stat = await asyncStat(filePath)
            return { name: file, path: filePath, size: stat.size, mtime: stat.mtime }
          } catch (_) {
            return null
          }
        })
    )
    const fileList = stats.filter(Boolean).sort((a, b) => new Date(b.mtime) - new Date(a.mtime))
    return { success: true, files: fileList }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 返回默认保存目录
ipcMain.handle('get-default-save-dir', () => {
  const dir = ensureDefaultDir()
  return dir
})

// 设置指定的保存目录（持久化，重启后生效；AI 生成文件等保存操作均使用该目录）
// review A2：existsSync → asyncExists；handler 改 async
ipcMain.handle('set-save-dir', async (event, dirPath) => {
  try {
    if (!dirPath || typeof dirPath !== 'string' || !path.isAbsolute(dirPath)) {
      throw new Error('路径无效')
    }
    if (!(await asyncExists(dirPath))) {
      throw new Error('文件夹不存在')
    }
    store.set('saveDir', dirPath)
    app.defaultSaveDir = dirPath
    return dirPath
  } catch (error) {
    throw new Error('设置保存位置失败: ' + error.message)
  }
})

// HTML 转 PDF（大纲导出等）：隐藏窗口渲染 HTML 后打印，完美支持中文
ipcMain.handle('print-to-pdf', async (event, { html }) => {
  const { BrowserWindow, app: electronApp } = require('electron')
  let win = null
  let tmpPath = ''
  try {
    if (!html || typeof html !== 'string') throw new Error('HTML 内容为空')
    tmpPath = path.join(electronApp.getPath('temp'), `smm_outline_${Date.now()}.html`)
    // review A2：writeFileSync → asyncWriteFile
    await asyncWriteFile(tmpPath, html, 'utf-8')
    win = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, nodeIntegration: false }
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    await win.loadFile(tmpPath)
    const pdfBuffer = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    })
    return { success: true, base64: pdfBuffer.toString('base64') }
  } catch (error) {
    return { success: false, error: error.message }
  } finally {
    if (win) {
      try { win.destroy() } catch (e) {}
    }
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath) } catch (e) {}
    }
  }
})

/* ============================================================
 * 文件树管理 IPC（参考 WorkBuddy 项目实现）
 * ============================================================ */

// 选择文件夹
ipcMain.handle('fs:selectFolder', async () => {
  try {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  } catch (error) {
    console.error('选择文件夹失败:', error)
    return null
  }
})

// 列出目录内容（懒加载）
ipcMain.handle('fs:listDir', async (event, dirPath) => {
  try {
    assertSafePath(dirPath)
    // 路径白名单检查（读操作）
    try { assertPathAllowed(dirPath, { readOnly: true }) } catch (e) { throw new Error('访问被拒绝: ' + e.message) }
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    const dirs = []
    const files = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue // 隐藏文件不显示
      const full = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        dirs.push({ name: entry.name, path: full, isDir: true })
      } else if (isSupportFile(entry.name)) {
        const stat = await fs.promises.stat(full)
        files.push({ name: entry.name, path: full, isDir: false, mtime: stat.mtimeMs })
      }
    }
    const byName = (a, b) => a.name.localeCompare(b.name, 'zh-CN')
    return [...files.sort(byName), ...dirs.sort(byName)] // 文件在前，文件夹在后
  } catch (error) {
    // review bug fix：不要静默吞错——返回错误信息让前端能在 UI 上反馈，
    // FileTree 的 loadNode / refreshVisibleDirs 可据此决定是否提示用户"该目录已被移除"或
    // "fsGuard 拒绝访问，请确认已开启信任"
    console.error('[fs:listDir] 失败:', dirPath, error)
    return { error: error.message || String(error), items: [] }
  }
})

// 读取文件
ipcMain.handle('fs:readFile', async (event, filePath) => {
  try {
    assertSafePath(filePath)
    // 路径白名单检查（读操作）
    try { assertPathAllowed(filePath, { readOnly: true }) } catch (e) { throw new Error('读取被拒绝: ' + e.message) }
    return await fs.promises.readFile(filePath, 'utf8')
  } catch (error) {
    throw new Error('读取文件失败: ' + error.message)
  }
})

// 文件元信息（mtime 供知识库索引判断是否需要重建）
ipcMain.handle('fs:stat', async (event, filePath) => {
  try {
    assertSafePath(filePath)
    const stat = await fs.promises.stat(filePath)
    return { success: true, mtime: stat.mtime.toISOString(), size: stat.size }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 读取二进制文件（docx/pdf 等，返回 base64 供渲染进程解压解析）
ipcMain.handle('fs:readBinary', async (event, filePath) => {
  try {
    assertSafePath(filePath)
    // 路径白名单检查（读操作）
    try { assertPathAllowed(filePath, { readOnly: true }) } catch (e) { throw new Error('读取被拒绝: ' + e.message) }
    const stat = await fs.promises.stat(filePath)
    // 上限 64MB，防御异常大文件撑爆 IPC
    if (stat.size > 64 * 1024 * 1024) {
      return { success: false, error: '文件过大（超过 64MB），不支持读取' }
    }
    const buffer = await fs.promises.readFile(filePath)
    return { success: true, base64: buffer.toString('base64'), size: stat.size, fileName: path.basename(filePath) }
  } catch (error) {
    return { success: false, error: '读取文件失败: ' + error.message }
  }
})

// 写入文件
ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
  try {
        // review C.1: 路径白名单检查（防御 XSS 渗透后跨目录写文件）
    try { assertPathAllowed(filePath, { destructive: true }) } catch (e) { throw new Error('写入被拒绝: ' + e.message) }
    assertSafePath(filePath, { destructive: true })
    assertSafePath(filePath, { destructive: true })
    await fs.promises.writeFile(filePath, content, 'utf8')
    return true
  } catch (error) {
    throw new Error('写入文件失败: ' + error.message)
  }
})

// 写入二进制文件（base64 → 磁盘）
ipcMain.handle('fs:writeBinary', async (event, filePath, base64Data) => {
  try {
        // review C.1
    try { assertPathAllowed(filePath, { destructive: true }) } catch (e) { throw new Error('写入被拒绝: ' + e.message) }
    assertSafePath(filePath, { destructive: true })
    assertSafePath(filePath, { destructive: true })
    const buffer = Buffer.from(base64Data, 'base64')
    await fs.promises.writeFile(filePath, buffer)
    return { success: true, path: filePath }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// 获取临时目录路径
ipcMain.handle('fs:getTempDir', async () => {
  try {
    const { app } = require('electron')
    const tmp = path.join(app.getPath('temp'), 'mindmap-agent')
    // review A2：existsSync → asyncExists，mkdirSync → asyncMkdir
    if (!(await asyncExists(tmp))) await asyncMkdir(tmp)
    return { success: true, path: tmp }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// 重命名
ipcMain.handle('fs:rename', async (event, oldPath, newPath) => {
  try {
        // review C.1: 重命名也对路径做白名单
    try { assertPathAllowed(newPath, { destructive: true }) } catch (e) { throw new Error('重命名被拒绝: ' + e.message) }
    assertSafePath(newPath, { destructive: true })
    assertSafePath(oldPath, { destructive: true })
    assertSafePath(newPath, { destructive: true })
    if (await exists(newPath)) throw new Error('目标名称已存在')
    await fs.promises.rename(oldPath, newPath)
    return newPath
  } catch (error) {
    throw error
  }
})

// 在资源管理器中打开：文件 → 打开所在目录并选中；文件夹 → 直接打开该目录
ipcMain.handle('fs:showInFolder', async (event, rawPath) => {
  try {
    const target = typeof rawPath === 'string' ? path.normalize(rawPath) : ''
    if (!target || !path.isAbsolute(target)) throw new Error('路径无效')
    // review A2：existsSync → asyncExists，statSync → asyncStat
    if (!(await asyncExists(target))) throw new Error('文件不存在')
    const stat = await asyncStat(target)
    if (stat.isDirectory()) {
      const errMsg = await shell.openPath(target)
      if (errMsg) throw new Error(errMsg)
    } else {
      shell.showItemInFolder(target)
    }
    return true
  } catch (error) {
    throw new Error('打开失败: ' + error.message)
  }
})

// 用系统默认程序打开文件（双击等效行为）
ipcMain.handle('fs:openFile', async (event, rawPath) => {
  try {
    const target = typeof rawPath === 'string' ? path.normalize(rawPath) : ''
    if (!target || !path.isAbsolute(target)) throw new Error('路径无效')
    // review A2：existsSync → asyncExists
    if (!(await asyncExists(target))) throw new Error('文件不存在')
    const errMsg = await shell.openPath(target)
    if (errMsg) throw new Error(errMsg)
    return true
  } catch (error) {
    throw new Error('打开失败: ' + error.message)
  }
})

// 删除（移入回收站）
ipcMain.handle('fs:remove', async (event, rawPath) => {
  try {
    // 混合分隔符路径（反斜杠+正斜杠）会导致 shell.trashItem 解析失败
    const filePath = typeof rawPath === 'string' ? path.normalize(rawPath) : rawPath
    if (!filePath || typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new Error('路径无效')
    }
    // review A2：existsSync → asyncExists
    if (!(await asyncExists(filePath))) {
      throw new Error('文件不存在')
    }
    assertSafePath(filePath, { destructive: true })
    await shell.trashItem(filePath)
    return true
  } catch (error) {
    throw new Error('删除失败: ' + error.message)
  }
})

// 创建文件夹
ipcMain.handle('fs:mkdir', async (event, dirPath) => {
  try {
    assertSafePath(dirPath, { destructive: true })
    // 路径白名单检查
    try { assertPathAllowed(dirPath, { destructive: true }) } catch (e) { throw new Error('创建被拒绝: ' + e.message) }
    const target = await uniquePath(path.normalize(dirPath))
    await fs.promises.mkdir(target, { recursive: true })
    return target
  } catch (error) {
    throw new Error('创建文件夹失败: ' + error.message)
  }
})

// 创建文件
ipcMain.handle('fs:createFile', async (event, filePath, content) => {
  try {
    assertSafePath(filePath, { destructive: true })
    // 路径白名单检查
    try { assertPathAllowed(filePath, { destructive: true }) } catch (e) { throw new Error('创建被拒绝: ' + e.message) }
    const target = await uniquePath(path.normalize(filePath))
    // 根节点默认用文件名（不带扩展名），而非「中心主题」
    const rootName = (path.basename(target, path.extname(target)) || '中心主题')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const defaultContent = content || JSON.stringify({ data: { text: `<p><span>${rootName}</span></p>`, uid: 'root-' + Date.now(), richText: true }, children: [] }, null, 2)
    await fs.promises.writeFile(target, defaultContent, 'utf8')
    return target
  } catch (error) {
    throw new Error('创建文件失败: ' + error.message)
  }
})

// 移动文件/文件夹
ipcMain.handle('fs:move', async (event, src, destDir) => {
  try {
    assertSafePath(src, { destructive: true })
    assertSafePath(destDir, { destructive: true })
    // 路径白名单检查（源和目标都需通过）
    try { assertPathAllowed(src, { destructive: true }) } catch (e) { throw new Error('移动被拒绝: ' + e.message) }
    try { assertPathAllowed(destDir, { destructive: true }) } catch (e) { throw new Error('移动被拒绝: ' + e.message) }
    const target = path.join(destDir, path.basename(src))
    if (path.resolve(target) === path.resolve(src)) return src
    if (await exists(target)) throw new Error('目标位置已存在同名文件或文件夹')
    await fs.promises.rename(src, target)
    return target
  } catch (error) {
    throw error
  }
})

// 检查路径是否存在
ipcMain.handle('fs:exists', async (event, filePath) => {
  try {
    assertSafePath(filePath)
  } catch {
    return false
  }
  return await exists(filePath)
})

// 相对路径转绝对路径（渲染进程传入的相对路径按主进程工作目录解析，避免保存目录计算错位）
ipcMain.handle('fs:absPath', async (event, rawPath) => {
  try {
    if (typeof rawPath !== 'string' || !rawPath.trim()) return ''
    return path.resolve(rawPath)
  } catch {
    return ''
  }
})

// 本机用户目录信息（供 AI 构造本地文件路径，禁止猜测用户名）
ipcMain.handle('get-user-dirs', () => {
  const safe = (fn) => { try { return fn() } catch { return '' } }
  return {
    home: os.homedir(),
    desktop: safe(() => app.getPath('desktop')),
    documents: safe(() => app.getPath('documents')),
    downloads: safe(() => app.getPath('downloads')),
    saveDir: getDefaultSaveDir()
  }
})

// 按文件名关键词搜索本地常用目录（桌面/文档/下载/默认保存目录/应用目录 + 调用方附加目录）
// 深度受限的异步遍历，带时间上限，防止大目录卡死主进程
ipcMain.handle('fs:findFile', async (event, opts) => {
  try {
    const keyword = String(opts?.keyword || '').trim().toLowerCase()
    if (!keyword) return { success: false, error: '请提供 keyword（文件名关键词）' }
    const exts = Array.isArray(opts.exts)
      ? opts.exts.map(e => String(e).toLowerCase().replace(/^\./, ''))
      : null
    const maxResults = Math.min(Math.max(Number(opts.maxResults) || 20, 1), 50)
    const MAX_DEPTH = 3
    const DEADLINE = Date.now() + 4000
    const SKIP_DIRS = new Set([
      'node_modules', '.git', 'AppData', '$RECYCLE.BIN', 'System Volume Information',
      '.cache', 'dist', 'dist-electron', 'release', 'build', '.venv', '__pycache__',
      'win-unpacked'
    ])

    // review A2：addRoot 内的 fs.existsSync 改成异步版（一次性并行校验多个根目录）
    const searchRoots = []
    const candidateRoots = []
    if (!opts?.onlyDirs) {
      try { candidateRoots.push(app.getPath('desktop')) } catch {}
      try { candidateRoots.push(app.getPath('documents')) } catch {}
      try { candidateRoots.push(app.getPath('downloads')) } catch {}
      candidateRoots.push(getDefaultSaveDir())
      candidateRoots.push(process.cwd())
      candidateRoots.push(path.join(os.homedir(), 'Desktop'))
    }
    if (Array.isArray(opts?.dirs)) candidateRoots.push(...opts.dirs.filter(d => typeof d === 'string'))
    // 并行校验所有候选根是否存在
    const existingFlags = await Promise.all(candidateRoots.map(p => asyncExists(p)))
    for (let i = 0; i < candidateRoots.length; i++) {
      const p = candidateRoots[i]
      if (existingFlags[i] && p && typeof p === 'string' && path.isAbsolute(p) && !searchRoots.includes(p)) {
        searchRoots.push(p)
      }
    }
    // review A2：上述 candidateRoots 已经覆盖桌面/文档/下载/默认保存目录/工作目录，
    // 旧版的 if (!opts?.onlyDirs) 分支和 opts.dirs.forEach 已经合并到 candidateRoots 里，无需再调用 addRoot

    const results = []
    let timedOut = false
    const walk = async (dir, depth) => {
      if (timedOut || depth > MAX_DEPTH || results.length >= maxResults) return
      if (Date.now() > DEADLINE) { timedOut = true; return }
      let entries
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (timedOut || results.length >= maxResults) return
        if (Date.now() > DEADLINE) { timedOut = true; return }
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
          await walk(full, depth + 1)
        } else {
          if (!e.name.toLowerCase().includes(keyword)) continue
          if (exts && exts.length && !exts.includes(path.extname(e.name).slice(1).toLowerCase())) continue
          try {
            const st = await fs.promises.stat(full)
            results.push({ path: full, name: e.name, size: st.size, mtime: st.mtime.toISOString().slice(0, 19).replace('T', ' ') })
          } catch {}
        }
      }
    }
    for (const r of searchRoots) await walk(r, 0)

    // 不同搜索根（如桌面递归与项目目录）可能命中同一文件，按绝对路径去重
    const seen = new Set()
    const unique = results.filter(f => {
      const key = path.resolve(f.path).toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    return { success: true, results: unique, searchedDirs: searchRoots, timedOut }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 导出白名单检查函数，供其他 IPC 模块（如 referenceManager / shellExec）复用统一的白名单逻辑
module.exports = {
  assertPathAllowed,
  isUnderAllowedRoots,
  getDefaultSaveDir,
  // 当前激活的 .smm 文件所在目录（shellExec 需要用它来决定 cwd 是否安全）
  get activeFileDir() { return __activeFileDir },
  // 渲染层注册的白名单根目录（Set 的 array view；外部只读）
  get allowedPathRoots() { return __allowedPathRoots }
}
