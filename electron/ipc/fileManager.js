const { ipcMain, dialog, app, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const store = require('../utils/store')

// 获取默认保存目录（优先用户指定的保存目录，其次桌面）
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
  return /\.(smm|md|json)$/i.test(name)
}

// 路径安全校验：拒绝空字节注入；破坏性操作（删除/移动/重命名）额外拦截系统关键目录
function assertSafePath(rawPath, opts = {}) {
  const s = typeof rawPath === 'string' ? rawPath : ''
  if (!s.trim()) throw new Error('路径无效')
  if (s.includes('\0')) throw new Error('路径包含非法字符')
  // 只对非空、已解析出根目录的绝对路径做关键目录拦截（相对路径交给上层 join 后再判断）
  const target = path.resolve(s)
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
  return path.normalize(s)
}

// 保存文件（用户手动保存 / 自动保存 / AI 工具链共用）
// overwrite=true：用户保存与自动保存，覆盖原文件（正常保存语义）
// overwrite 缺省：AI 工具保存，目标已存在时自动改名（"文件名 (1)"），避免静默覆盖用户的同名旧文件
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

    if (!overwrite && (await exists(filePath))) {
      filePath = await uniquePath(filePath)
    }

    const fileDir = path.dirname(filePath)
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true })
    }

    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    fs.writeFileSync(filePath, content, 'utf-8')

    return { success: true, filePath }
  } catch (error) {
    return { success: false, error: `${error.message}（写入目标：${filePath || filename}）` }
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

    if (await exists(filePath)) {
      filePath = await uniquePath(filePath)
    }

    const fileDir = path.dirname(filePath)
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true })
    }

    const buffer = Buffer.from(String(base64 || '').replace(/^data:[^;]+;base64,/, ''), 'base64')
    fs.writeFileSync(filePath, buffer)

    return { success: true, filePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 打开/读取文件
ipcMain.handle('open-file', async (event, { filePath }) => {
  try {
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
    const result = await dialog.showOpenDialog({
      defaultPath: fs.existsSync(defaultDir) ? defaultDir : undefined,
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
ipcMain.handle('list-files', () => {
  try {
    const dir = ensureDefaultDir()
    const files = fs.readdirSync(dir)
    const fileList = files
      .filter((file) => /\.(smm|json|xmind)$/i.test(file))
      .map((file) => {
        const filePath = path.join(dir, file)
        const stat = fs.statSync(filePath)
        return {
          name: file,
          path: filePath,
          size: stat.size,
          mtime: stat.mtime
        }
      })
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime))

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
ipcMain.handle('set-save-dir', (event, dirPath) => {
  try {
    if (!dirPath || typeof dirPath !== 'string' || !path.isAbsolute(dirPath)) {
      throw new Error('路径无效')
    }
    if (!fs.existsSync(dirPath)) {
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
    fs.writeFileSync(tmpPath, html, 'utf-8')
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
    return [...dirs.sort(byName), ...files.sort(byName)] // 文件夹在前
  } catch (error) {
    console.error('列出目录失败:', error)
    return []
  }
})

// 读取文件
ipcMain.handle('fs:readFile', async (event, filePath) => {
  try {
    return await fs.promises.readFile(filePath, 'utf8')
  } catch (error) {
    throw new Error('读取文件失败: ' + error.message)
  }
})

// 读取二进制文件（docx/pdf 等，返回 base64 供渲染进程解压解析）
ipcMain.handle('fs:readBinary', async (event, filePath) => {
  try {
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
    if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true })
    return { success: true, path: tmp }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// 重命名
ipcMain.handle('fs:rename', async (event, oldPath, newPath) => {
  try {
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
    if (!fs.existsSync(target)) throw new Error('文件不存在')
    if (fs.statSync(target).isDirectory()) {
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
    if (!fs.existsSync(target)) throw new Error('文件不存在')
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
    if (!fs.existsSync(filePath)) {
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
    const target = await uniquePath(path.normalize(filePath))
    const defaultContent = content || JSON.stringify({ data: { text: '<p><span>中心主题</span></p>', uid: 'root-' + Date.now(), richText: true }, children: [] }, null, 2)
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

    const searchRoots = []
    const addRoot = (p) => {
      if (p && typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p) && !searchRoots.includes(p)) {
        searchRoots.push(p)
      }
    }
    try { addRoot(app.getPath('desktop')) } catch {}
    try { addRoot(app.getPath('documents')) } catch {}
    try { addRoot(app.getPath('downloads')) } catch {}
    addRoot(getDefaultSaveDir())
    addRoot(process.cwd())
    addRoot(path.join(os.homedir(), 'Desktop'))
    if (Array.isArray(opts.dirs)) opts.dirs.forEach(d => addRoot(String(d)))

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
