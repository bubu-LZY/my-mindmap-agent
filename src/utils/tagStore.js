/**
 * 收藏标签管理
 * 目录树中任意文件（思维导图 / PDF / Word / Excel / CSV / TXT / MD 等）都可在指定位置添加标签，
 * 标签可带一条可选备注；在「标签模式」侧栏以列表展示，点击跳转到对应文件对应位置。
 *
 * 数据独立存 localStorage（MINDMAP_TAGS），与复习计划/搜索/导图数据完全隔离。
 *
 * 标签条目结构：
 * {
 *   id: string,          // 唯一 ID
 *   tag: string,         // 标签名（必填）
 *   note: string,        // 备注（可选，可为空）
 *   filePath: string,    // 文件绝对路径
 *   fileName: string,    // 文件名
 *   fileType: string,    // 'smm' | 'pdf' | 'docx' | 'xlsx' | ... 或 'doc'
 *   // —— 定位信息（至少一项）——
 *   nodeUid: string,     // 思维导图节点 uid（节点级定位）
 *   nodeText: string,    // 节点纯文本（列表展示用）
 *   page: number|null,   // PDF 页码
 *   scrollTop: number|null, // 文档滚动位置（非 PDF 文档）
 *   createdAt: number    // 创建时间戳
 * }
 */

const TAG_KEY = 'MINDMAP_TAGS'

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/')
}

// 获取所有标签（按创建时间倒序，最新在前）
export function getTags() {
  try {
    const raw = localStorage.getItem(TAG_KEY)
    const list = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) return []
    return list
  } catch {
    return []
  }
}

function saveTags(list) {
  try {
    localStorage.setItem(TAG_KEY, JSON.stringify(list))
    return true
  } catch (e) {
    console.error('[标签] 保存失败:', e)
    return false
  }
}

// 添加标签（同文件同位置重复添加时返回 null，提示已存在）
export function addTag(payload) {
  const list = getTags()
  const item = {
    id: genId(),
    tag: String(payload.tag || '').trim(),
    note: String(payload.note || '').trim(),
    filePath: payload.filePath || '',
    fileName: payload.fileName || '',
    fileType: payload.fileType || 'doc',
    nodeUid: payload.nodeUid || '',
    nodeText: payload.nodeText || '',
    page: payload.page != null ? Number(payload.page) : null,
    scrollTop: payload.scrollTop != null ? Number(payload.scrollTop) : null,
    createdAt: Date.now()
  }
  if (!item.tag) return null
  if (!item.filePath) return null

  // 去重：同一文件 + 同一位置 + 同一标签名才视为重复（允许同位置加不同标签）
  const dup = list.some(t =>
    normalizePath(t.filePath) === normalizePath(item.filePath) &&
    t.tag === item.tag &&
    ((item.nodeUid && t.nodeUid === item.nodeUid) ||
      (item.page != null && t.page === item.page) ||
      (item.scrollTop != null && t.scrollTop === item.scrollTop) ||
      (!item.nodeUid && item.page == null && item.scrollTop == null && !t.nodeUid && t.page == null && t.scrollTop == null))
  )
  if (dup) return null

  list.unshift(item)
  saveTags(list)
  return item
}

// 按 ID 删除
export function removeTagById(id) {
  const list = getTags()
  const remaining = list.filter(t => t.id !== id)
  if (remaining.length !== list.length) saveTags(remaining)
  return remaining
}

// 编辑标签（改名/备注）
export function updateTag(id, { tag, note }) {
  const list = getTags()
  const item = list.find(t => t.id === id)
  if (!item) return null
  if (tag != null) item.tag = String(tag).trim()
  if (note != null) item.note = String(note).trim()
  saveTags(list)
  return item
}

// 按文件路径删除全部标签，返回删除数量
export function removeTagsByFilePath(filePath) {
  if (!filePath) return 0
  const target = normalizePath(filePath)
  const list = getTags()
  const remaining = list.filter(t => normalizePath(t.filePath) !== target)
  const removed = list.length - remaining.length
  if (removed > 0) saveTags(remaining)
  return removed
}

// 获取某文件路径下的所有标签
export function getTagsByFilePath(filePath) {
  if (!filePath) return []
  const target = normalizePath(filePath)
  return getTags().filter(t => normalizePath(t.filePath) === target)
}

/**
 * 路径重映射：文件/目录被移动或重命名后同步标签 filePath（复用复习计划的语义）
 */
export function remapTagPaths(oldPath, newPath) {
  if (!oldPath || !newPath) return 0
  const norm = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '')
  const o = norm(oldPath)
  const n = norm(newPath)
  if (!o || !n || o.toLowerCase() === n.toLowerCase()) return 0
  const lo = o.toLowerCase()
  const list = getTags()
  let changed = 0
  list.forEach(item => {
    const fp = norm(item.filePath || '')
    const lfp = fp.toLowerCase()
    const lenAligned = lfp.length === fp.length && lo.length === o.length
    let next = null
    if (lfp === lo) {
      next = n
    } else if (lenAligned && lfp.startsWith(lo + '/')) {
      next = n + fp.slice(o.length)
    }
    if (next) {
      item.filePath = next
      item.fileName = next.split('/').pop() || item.fileName
      changed++
    }
  })
  if (changed > 0) saveTags(list)
  return changed
}

// 检测并清理文件已删除的孤儿标签
export async function removeOrphanTags() {
  const list = getTags()
  if (list.length === 0) return []
  const exists = window.electronAPI?.fs?.exists
  if (typeof exists !== 'function') return []

  const orphans = []
  const remaining = []
  for (const item of list) {
    if (!item.filePath) { remaining.push(item); continue }
    let ok = true
    try { ok = await exists(item.filePath) } catch { ok = false }
    if (ok) remaining.push(item)
    else orphans.push(item)
  }
  if (orphans.length > 0) saveTags(remaining)
  return orphans
}
