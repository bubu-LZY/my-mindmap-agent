/**
 * 引用服务
 * 提供文件扫描、节点提取、引用链接解析与构建功能
 *
 * 引用协议格式：
 *   文件引用: mindmap-file:<文件绝对路径>
 *   节点引用: mindmap-node:<文件绝对路径>:<节点uid>
 */

// ============ 链接协议常量 ============
export const FILE_PROTOCOL = 'mindmap-file:'
export const NODE_PROTOCOL = 'mindmap-node:'

// ============ 链接构建 ============

/**
 * 构建文件引用链接
 * @param {string} filePath 文件绝对路径
 * @returns {string} mindmap-file:<filePath>
 */
export function buildFileLink(filePath) {
  return `${FILE_PROTOCOL}${filePath}`
}

/**
 * 构建节点引用链接
 * @param {string} filePath 文件绝对路径
 * @param {string} nodeUid 节点 UID
 * @returns {string} mindmap-node:<filePath>:<nodeUid>
 */
export function buildNodeLink(filePath, nodeUid) {
  return `${NODE_PROTOCOL}${filePath}:${nodeUid}`
}

// ============ 链接解析 ============

/**
 * 解析引用链接
 * @param {string} href 链接 href
 * @returns {{ type: 'file'|'node'|null, filePath: string, nodeUid: string|null }}
 */
export function parseReferenceLink(href) {
  if (!href || typeof href !== 'string') {
    return { type: null, filePath: '', nodeUid: null }
  }

  if (href.startsWith(FILE_PROTOCOL)) {
    const filePath = href.substring(FILE_PROTOCOL.length)
    return { type: 'file', filePath, nodeUid: null }
  }

  if (href.startsWith(NODE_PROTOCOL)) {
    const data = href.substring(NODE_PROTOCOL.length)
    // 用最后一个冒号分割，因为文件路径中可能也包含冒号（如 Windows 盘符）
    const sepIdx = data.lastIndexOf(':')
    if (sepIdx === -1) {
      return { type: 'file', filePath: data, nodeUid: null }
    }
    const filePath = data.substring(0, sepIdx)
    const nodeUid = data.substring(sepIdx + 1)
    return { type: 'node', filePath, nodeUid }
  }

  return { type: null, filePath: '', nodeUid: null }
}

/**
 * 判断链接是否为引用链接
 */
export function isReferenceLink(href) {
  if (!href || typeof href !== 'string') return false
  return href.startsWith(FILE_PROTOCOL) || href.startsWith(NODE_PROTOCOL)
}

// ============ 文件扫描 ============

/**
 * 扫描文件列表
 * @param {string} rootPath 根目录路径（可选，默认使用保存目录）
 * @returns {Promise<Array<{name, path, parentName}>>}
 */
export async function scanFiles(rootPath) {
  if (!window.electronAPI?.refScanFiles) {
    console.warn('引用文件扫描 IPC 不可用')
    return []
  }
  const result = await window.electronAPI.refScanFiles(rootPath)
  if (!result.success) {
    console.error('文件扫描失败:', result.error)
    return []
  }
  return result.files || []
}

/**
 * 扫描所有文件的节点
 * @param {string} rootPath 根目录路径（可选）
 * @returns {Promise<Array<{name, fullPath, filePath, fileName, nodeUid, isNode}>>}
 */
export async function scanNodes(rootPath) {
  if (!window.electronAPI?.refScanNodes) {
    console.warn('引用节点扫描 IPC 不可用')
    return []
  }
  const result = await window.electronAPI.refScanNodes(rootPath)
  if (!result.success) {
    console.error('节点扫描失败:', result.error)
    return []
  }
  return result.nodes || []
}

// ============ 文件读取 ============

/**
 * 读取文件内容
 * @param {string} filePath 文件路径
 * @returns {Promise<{success, data, type, fileName}>}
 */
export async function readFile(filePath) {
  if (!window.electronAPI?.refReadFile) {
    return { success: false, error: '文件读取 IPC 不可用' }
  }
  return await window.electronAPI.refReadFile(filePath)
}

/**
 * 检查文件是否存在
 * @param {string} filePath 文件路径
 * @returns {Promise<boolean>}
 */
export async function fileExists(filePath) {
  if (!window.electronAPI?.refFileExists) {
    return false
  }
  const result = await window.electronAPI.refFileExists(filePath)
  return result.exists
}

// ============ 搜索过滤 ============

/**
 * 过滤文件列表
 * @param {Array} files 文件列表
 * @param {string} query 搜索关键词
 * @param {number} limit 最大返回数量
 * @returns {Array}
 */
export function filterFiles(files, query, limit = 30) {
  if (!query) return files.slice(0, limit)
  const lowerQuery = query.toLowerCase()
  return files
    .filter(f => f.name.toLowerCase().includes(lowerQuery))
    .slice(0, limit)
}

/**
 * 过滤节点列表
 * @param {Array} nodes 节点列表
 * @param {string} query 搜索关键词
 * @param {number} limit 最大返回数量
 * @returns {Array}
 */
export function filterNodes(nodes, query, limit = 30) {
  if (!query) return nodes.slice(0, limit)
  const lowerQuery = query.toLowerCase()
  return nodes
    .filter(n =>
      n.fullPath?.toLowerCase().includes(lowerQuery) ||
      n.fileName?.toLowerCase().includes(lowerQuery)
    )
    .slice(0, limit)
}

/**
 * 获取文件显示名称（去掉扩展名）
 * @param {string} fileName 文件名
 * @returns {string}
 */
export function getDisplayName(fileName) {
  return fileName.replace(/\.(smm|json|md)$/i, '')
}
