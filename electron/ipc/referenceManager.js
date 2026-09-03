const { ipcMain, app } = require('electron')
const fs = require('fs')
const path = require('path')

// 支持的文件扩展名
const SUPPORTED_EXTENSIONS = /\.(smm|json|md|xmind)$/i
const SCAN_FILE_EXTENSIONS = /\.(smm|json|md|xmind|pdf|docx|pptx|xlsx|xls|csv|tsv|txt|log|html|xml)$/i

// 最大扫描深度
const MAX_SCAN_DEPTH = 5

// 最大返回节点数
const MAX_NODES = 500

/**
 * 获取默认保存目录
 */
function getDefaultSaveDir() {
  return app.defaultSaveDir || 'C:\\我的mindmap'
}

/**
 * 归一化根目录列表：rootPath 可为字符串或字符串数组。
 * 空值回退到默认保存目录。结果去重。
 */
function normalizeRootDirs(rootPath) {
  const dirs = []
  if (Array.isArray(rootPath)) {
    dirs.push(...rootPath.filter(p => typeof p === 'string' && p))
  } else if (typeof rootPath === 'string' && rootPath) {
    dirs.push(rootPath)
  }
  if (dirs.length === 0) {
    dirs.push(getDefaultSaveDir())
  }
  return [...new Set(dirs.filter(d => typeof d === 'string' && d))]
}

/**
 * 递归扫描目录，收集支持的文件（异步实现，避免启动重建索引时同步阻塞主进程）
 * @param {string} dir 目录路径
 * @param {number} depth 当前深度
 * @param {number} maxDepth 最大深度
 * @param {Array} results 结果数组
 */
async function scanDir(dir, depth = 0, maxDepth = MAX_SCAN_DEPTH, results = [], extRegex = SUPPORTED_EXTENSIONS) {
  if (depth > maxDepth) return results

  let entries
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return results
  }

  for (const entry of entries) {
    // 跳过隐藏目录和 node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await scanDir(fullPath, depth + 1, maxDepth, results)
    } else if (entry.isFile() && extRegex.test(entry.name)) {
      const stat = await fs.promises.stat(fullPath)
      results.push({
        name: entry.name,
        path: fullPath,
        parentName: path.basename(dir),
        size: stat.size,
        mtime: stat.mtime
      })
    }
  }
  return results
}

/**
 * 去除富文本节点携带的 HTML 标签，得到纯文本（引用显示用）
 */
function stripHtmlTags(html) {
  if (!html || typeof html !== 'string') return ''
  if (!html.includes('<')) return html.trim()
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ({
      amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' '
    }[e] || ' '))
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 从 JSON 数据中递归提取节点
 * @param {Object} data 思维导图数据
 * @param {string} filePath 文件路径
 * @param {string} fileName 文件名
 * @param {number} depth 当前深度
 * @param {Array} results 结果数组
 */
function extractNodesFromData(data, filePath, fileName, depth = 0, results = []) {
  if (!data || depth > 5 || results.length >= MAX_NODES) return results

  // 适配不同数据结构
  const root = data.root || data
  if (!root) return results

  const walk = (node, currentDepth = 0) => {
    if (!node || results.length >= MAX_NODES) return
    const text = stripHtmlTags(node.data?.text || '')
    const uid = node.data?.uid || node.uid || ''
    if (text && uid) {
      // 截断显示文本
      const displayName = text.length > 50 ? text.substring(0, 50) + '...' : text
      results.push({
        name: displayName,
        fullPath: text,
        filePath,
        fileName,
        nodeUid: uid,
        isNode: true
      })
    }
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        walk(child, currentDepth + 1)
      }
    }
  }

  walk(root, depth)
  return results
}

/**
 * 简单的 Markdown 转思维导图节点列表
 */
function extractNodesFromMarkdown(content, filePath, fileName) {
  const lines = content.split('\n')
  const results = []
  let nodeId = 0

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/)
    if (match) {
      const text = match[2].trim()
      const displayName = text.length > 50 ? text.substring(0, 50) + '...' : text
      results.push({
        name: displayName,
        fullPath: text,
        filePath,
        fileName,
        nodeUid: `md-${nodeId++}`,
        isNode: true
      })
    }
    if (results.length >= MAX_NODES) break
  }
  return results
}

// ============ IPC Handlers ============

/**
 * 扫描文件列表
 * 返回默认保存目录下所有支持的文件
 */
ipcMain.handle('ref:scanFiles', async (event, rootPath) => {
  try {
    const dirs = normalizeRootDirs(rootPath)
    const fileMap = new Map()
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue
      const files = await scanDir(dir, 0, MAX_SCAN_DEPTH, [], SCAN_FILE_EXTENSIONS)
      for (const f of files) {
        if (!fileMap.has(f.path)) fileMap.set(f.path, f)
      }
    }
    const files = [...fileMap.values()]
    // 按修改时间排序
    files.sort((a, b) => new Date(b.mtime) - new Date(a.mtime))
    return { success: true, files }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

/**
 * 扫描文件并提取所有节点
 * 用于 # 节点引用模式
 * 导图文件（.smm/.json/.xmind）优先，MD 文档标题靠后，避免导图节点被 MD 标题挤掉
 */
ipcMain.handle('ref:scanNodes', async (event, rootPath) => {
  try {
    const dirs = normalizeRootDirs(rootPath)
    const fileMap = new Map()
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue
      const files = await scanDir(dir)
      for (const f of files) {
        if (!fileMap.has(f.path)) fileMap.set(f.path, f)
      }
    }
    const files = [...fileMap.values()].sort((a, b) => {
      // 导图文件优先，其余按修改时间
      const aMap = /\.(smm|json|xmind)$/i.test(a.name)
      const bMap = /\.(smm|json|xmind)$/i.test(b.name)
      if (aMap !== bMap) return aMap ? -1 : 1
      return new Date(b.mtime) - new Date(a.mtime)
    })
    const allNodes = []

    for (const file of files) {
      if (allNodes.length >= MAX_NODES) break
      try {
        const content = await fs.promises.readFile(file.path, 'utf-8')
        if (file.name.endsWith('.md')) {
          const mdNodes = extractNodesFromMarkdown(content, file.path, file.name)
          allNodes.push(...mdNodes)
        } else {
          // JSON 或 SMM 格式
          const data = JSON.parse(content)
          extractNodesFromData(data, file.path, file.name, 0, allNodes)
        }
      } catch {
        // 跳过解析失败的文件
      }
    }

    return { success: true, nodes: allNodes.slice(0, MAX_NODES) }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

/**
 * 读取文件内容
 */
ipcMain.handle('ref:readFile', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' }
    }
    const content = await fs.promises.readFile(filePath, 'utf-8')
    let data
    let type = 'json'

    if (filePath.endsWith('.md')) {
      type = 'markdown'
      data = content
    } else {
      try {
        data = JSON.parse(content)
        type = 'json'
      } catch {
        type = 'text'
        data = content
      }
    }

    return { success: true, data, type, fileName: path.basename(filePath) }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

/**
 * 检查文件是否存在
 */
ipcMain.handle('ref:fileExists', async (event, filePath) => {
  try {
    return { success: true, exists: fs.existsSync(filePath) }
  } catch {
    return { success: true, exists: false }
  }
})
