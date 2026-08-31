/**
 * 持久记忆（review #1）：跨会话保存用户偏好、事实、上下文
 *
 * 数据结构：
 *   {
 *     items: [
 *       {
 *         id, content, category, source: 'auto'|'manual', createdAt, lastUsedAt, useCount, enabled
 *       }
 *     ]
 *   }
 *
 * 类别（category）: preference | fact | context | instruction
 *
 * 容量控制：
 * - 总条数上限 200，超过按 LRU (lastUsedAt) 淘汰
 * - 单条 content 上限 500 字
 * - 去重：简单相同前缀 hash 命中则更新而非新增
 *
 * 入口：手动管理（设置页）/ AI 工具调用（add_memory / search_memory / list_memory）
 */

const STORAGE_KEY = 'mm_agent_persistent_memory'
const MAX_ITEMS = 200
const MAX_CONTENT_LEN = 500

function safeParse(raw) {
  try { return JSON.parse(raw) || { items: [] } } catch (e) { return { items: [] } }
}

function loadAll() {
  try {
    if (typeof localStorage === 'undefined') return { items: [] }
    return safeParse(localStorage.getItem(STORAGE_KEY))
  } catch (e) {
    return { items: [] }
  }
}

function saveAll(state) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (e) {
    // 存储空间不足：先按 LRU 删一半再写
    state.items = state.items.slice(-Math.floor(state.items.length / 2))
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch (e2) {}
  }
}

function genId() {
  return 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
}

// 简单 hash 用于去重：以 stripped prefix + content 摘要
function fingerprint(content) {
  return String(content).trim().slice(0, 80)
}

/**
 * 增加一条记忆
 * @param {string} content 内容（<=500 字）
 * @param {'preference'|'fact'|'context'|'instruction'} category
 * @param {'auto'|'manual'} source
 * @returns {{success, id?, item?, error?}}
 */
export function addMemory(content, category = 'preference', source = 'manual') {
  const text = String(content || '').trim().slice(0, MAX_CONTENT_LEN)
  if (!text) return { success: false, error: '记忆内容不能为空' }
  const validCategory = ['preference', 'fact', 'context', 'instruction'].includes(category) ? category : 'preference'
  const validSource = source === 'auto' ? 'auto' : 'manual'

  const state = loadAll()
  const fp = fingerprint(text)
  // 去重：命中已有 fingerprint 则更新
  const existing = state.items.find(it => fingerprint(it.content) === fp)
  const now = Date.now()
  if (existing) {
    existing.content = text
    existing.category = validCategory
    existing.lastUsedAt = now
    existing.useCount = (existing.useCount || 0) + 1
    saveAll(state)
    return { success: true, id: existing.id, item: existing, dedup: true }
  }
  // 容量控制：超 LRU 淘汰
  if (state.items.length >= MAX_ITEMS) {
    state.items.sort((a, b) => (a.lastUsedAt || a.createdAt) - (b.lastUsedAt || b.createdAt))
    state.items.splice(0, state.items.length - MAX_ITEMS + 1)
  }
  const item = {
    id: genId(),
    content: text,
    category: validCategory,
    source: validSource,
    createdAt: now,
    lastUsedAt: now,
    useCount: 1,
    enabled: validSource === 'manual'  // 自动沉淀默认禁用，需用户在管理页打开
  }
  state.items.push(item)
  saveAll(state)
  return { success: true, id: item.id, item }
}

/**
 * 列出所有记忆项
 */
export function listMemory(opts = {}) {
  const state = loadAll()
  let items = state.items
  if (opts.category) items = items.filter(it => it.category === opts.category)
  if (opts.enabledOnly) items = items.filter(it => it.enabled !== false)
  // 按 lastUsedAt 倒序
  items = items.slice().sort((a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt))
  if (opts.limit) items = items.slice(0, opts.limit)
  return { success: true, items, total: state.items.length }
}

/**
 * 删除一条记忆
 */
export function deleteMemory(id) {
  const state = loadAll()
  const before = state.items.length
  state.items = state.items.filter(it => it.id !== id)
  saveAll(state)
  return { success: state.items.length !== before, removed: before - state.items.length }
}

/**
 * 切换 enabled
 */
export function toggleMemory(id, enabled) {
  const state = loadAll()
  const item = state.items.find(it => it.id === id)
  if (!item) return { success: false, error: '记忆项不存在' }
  item.enabled = !!enabled
  item.lastUsedAt = Date.now()
  saveAll(state)
  return { success: true, item }
}

/**
 * 搜索记忆（review #1：BM25 简化版）
 * - 关键词命中任意 token 即可
 * - 命中后增加 useCount + 更新 lastUsedAt（让 LRU 偏好常用）
 */
export function searchMemory(query, limit = 8) {
  const q = String(query || '').trim()
  if (!q) return { success: true, items: [], query: '' }
  const tokens = q.toLowerCase().split(/\s+/).filter(t => t.length >= 2)
  if (tokens.length === 0) return { success: true, items: [], query: q }
  const state = loadAll()
  // 简化评分：每个 token 命中 +1；category 偏好 fact/preference +0.5
  const scored = []
  for (const item of state.items) {
    if (item.enabled === false) continue
    const content = String(item.content || '').toLowerCase()
    let score = 0
    for (const t of tokens) {
      if (content.includes(t)) score += 1
    }
    if (score > 0) {
      if (item.category === 'preference' || item.category === 'fact') score += 0.5
      scored.push({ item, score })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, limit)
  // 更新命中项的 lastUsedAt + useCount
  const now = Date.now()
  for (const { item } of top) {
    item.lastUsedAt = now
    item.useCount = (item.useCount || 0) + 1
  }
  if (top.length) saveAll(state)
  return { success: true, items: top.map(t => t.item), query: q }
}

/**
 * 清空全部记忆（仅手动调用）
 */
export function clearMemory() {
  saveAll({ items: [] })
  return { success: true }
}

/**
 * 导出/导入（批量管理用）
 */
export function exportMemory() {
  return loadAll()
}
export function importMemory(state) {
  if (!state || !Array.isArray(state.items)) return { success: false, error: '格式不正确' }
  const cur = loadAll()
  const items = state.items.slice(0, MAX_ITEMS)
  cur.items = items
  saveAll(cur)
  return { success: true, count: items.length }
}
