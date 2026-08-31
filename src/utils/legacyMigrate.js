/**
 * 旧版本数据迁移（渲染进程侧）。
 * 旧版应用目录为 mindmap-mubu，更新到 mind-map-ai-agent 后 localStorage 隔离，
 * 通过主进程只读解析旧 leveldb，把 AI 长期记忆、对话历史、文件根目录等
 * 映射合并到新版键名。全程不删除新版已有数据，合并按内容/id 去重。
 */

const MIGRATED_KEY = 'mindmap_legacy_migrated'

function parseJSON(text) {
  try {
    const v = JSON.parse(text)
    return v
  } catch {
    return null
  }
}

function safeGet(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true } catch { return false }
}

function tsToDate(ts) {
  const n = Number(ts)
  if (n > 0) {
    try { return new Date(n).toISOString().slice(0, 10) } catch { /* ignore */ }
  }
  return new Date().toISOString().slice(0, 10)
}

/** 旧分文件 AI 记忆数组 [{text,timestamp}] → 新全局记忆 [{id,content,type,source,createdAt}]，按内容去重追加 */
function migrateLongtermMemory(items) {
  const KEY = 'mindmap_ai_longterm_memory'
  const facts = parseJSON(safeGet(KEY) || '[]') || []
  const existing = new Set(facts.map(f => f.content))
  let added = 0
  const pending = []
  for (const it of items) {
    if (!/^ZMIND_AI_MEMORY(_\d+)?$/.test(it.name)) continue
    if (it.name === 'ZMIND_AI_MEMORY') {
      // 旧全局记忆为纯文本指令，迁到永久记忆键（新版用户手写记忆）
      const text = String(it.value || '').trim()
      if (text && !safeGet('mindmap_ai_memory')) safeSet('mindmap_ai_memory', text)
      continue
    }
    const arr = parseJSON(it.value)
    if (!Array.isArray(arr)) continue
    for (const m of arr) {
      const content = String(m && m.text || '').trim()
      if (!content || existing.has(content)) continue
      existing.add(content)
      pending.push({
        id: `fact_legacy_${Date.now()}_${pending.length}_${Math.random().toString(36).slice(2, 8)}`,
        content: content.slice(0, 300),
        type: 'fact',
        source: 'legacy',
        createdAt: tsToDate(m.timestamp)
      })
    }
  }
  if (pending.length) {
    facts.push(...pending)
    safeSet(KEY, JSON.stringify(facts.slice(-100)))
    added = pending.length
  }
  return added
}

/** 旧对话（type: user/ai）→ 新对话（role: user/assistant），追加到对话历史末尾 */
function migrateConversations(items) {
  const KEY = 'mindmap_ai_conversations'
  const list = parseJSON(safeGet(KEY) || '[]')
  if (!Array.isArray(list)) return 0
  const existingIds = new Set(list.map(c => c.id))
  const legacy = []
  const history = items.find(i => i.name === 'ZMIND_AI_CHAT_HISTORY')
  const historyArr = history ? parseJSON(history.value) : null
  const toNewMessages = (msgs) => (Array.isArray(msgs) ? msgs : [])
    .map(m => ({
      id: m.id || `msg_legacy_${Math.random().toString(36).slice(2, 10)}`,
      role: m.type === 'ai' ? 'assistant' : 'user',
      content: String(m.content || '')
    }))
    .filter(m => m.content || m.role === 'user')
  const pushConversation = (conv) => {
    if (!conv || existingIds.has(conv.id)) return
    existingIds.add(conv.id)
    legacy.push(conv)
  }
  if (Array.isArray(historyArr)) {
    for (const c of historyArr) {
      if (!c || !Array.isArray(c.messages) || c.messages.length === 0) continue
      const messages = toNewMessages(c.messages)
      if (messages.length === 0) continue
      const ts = Number(c.timestamp) || Date.now() - 86400000
      pushConversation({
        id: c.id,
        title: String(c.preview || (messages.find(m => m.role === 'user') || {}).content || '旧版对话').slice(0, 40),
        messages,
        createdAt: ts,
        updatedAt: ts
      })
    }
  }
  const current = items.find(i => i.name === 'ZMIND_AI_CHAT_CURRENT')
  const currentArr = current ? parseJSON(current.value) : null
  if (Array.isArray(currentArr) && currentArr.length > 0) {
    const messages = toNewMessages(currentArr)
    if (messages.length > 0) {
      const firstUser = messages.find(m => m.role === 'user')
      const id = `legacy_current_${Date.now()}`
      pushConversation({
        id,
        title: String((firstUser && firstUser.content) || '旧版对话').slice(0, 40),
        messages,
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now() - 3600000
      })
    }
  }
  if (legacy.length) {
    // 旧对话放列表尾部，不打断新版最近的对话
    list.push(...legacy)
    safeSet(KEY, JSON.stringify(list.slice(0, 30)))
  }
  return legacy.length
}

/** 仅当新键为空时直迁的简单键映射 */
const DIRECT_KEYS = [
  ['ZMIND_FOLDER_ROOTS', 'MINDMAP_FOLDER_ROOTS'],
  ['smm_cloze_versions', 'smm_cloze_versions'],
  ['SIMPLE_MIND_MAP_CLOZE_STATE', 'SIMPLE_MIND_MAP_CLOZE_STATE']
]

function migrateDirectKeys(items) {
  let added = 0
  for (const [oldKey, newKey] of DIRECT_KEYS) {
    if (safeGet(newKey)) continue
    const it = items.find(i => i.name === oldKey)
    if (!it || it.value === '' || it.value === '[]' || it.value === '{}') continue
    if (safeSet(newKey, it.value)) added++
  }
  return added
}

/**
 * 启动迁移入口。在应用 mount 前调用，带 5 秒超时保护，
 * 任何失败都不阻塞启动，且不写完成标记（下次启动重试）。
 */
export async function runLegacyMigration() {
  try {
    if (safeGet(MIGRATED_KEY)) return
    const api = window.electronAPI
    if (!api || typeof api.legacyStorageRead !== 'function') return
    const result = await Promise.race([
      api.legacyStorageRead(),
      new Promise(resolve => setTimeout(() => resolve(null), 5000))
    ])
    if (!result) return
    if (result.found && Array.isArray(result.items) && result.items.length > 0) {
      const mem = migrateLongtermMemory(result.items)
      const convs = migrateConversations(result.items)
      const direct = migrateDirectKeys(result.items)
      console.log(`[旧版数据迁移] 记忆 ${mem} 条，对话 ${convs} 个，直迁键 ${direct} 个`)
    }
    safeSet(MIGRATED_KEY, new Date().toISOString())
  } catch (e) {
    console.warn('旧版数据迁移失败(将在下次启动重试):', e)
  }
}
