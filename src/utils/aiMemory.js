/**
 * AI 长期记忆：把用户的学习偏好、常用操作习惯、知识盲区持久化到 localStorage，
 * 每次对话自动注入 system prompt，让 AI 跨会话"记住"用户。
 * 与 mindmap_ai_memory（用户手写的永久指令）互补：本模块由 AI 通过工具自动积累。
 */

const STORAGE_KEY = 'mindmap_ai_longterm_memory'
// 长期记忆只保留真正关键的信息，上限收紧到 30 条，防止鸡肋内容膨胀
const MAX_FACTS = 30

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveAll(facts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(facts.slice(-MAX_FACTS)))
  } catch (e) {
    // 配额溢出：减半重试
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(facts.slice(-Math.floor(facts.length / 2))))
    } catch (e2) {
      console.warn('AI 长期记忆保存失败:', e2)
    }
  }
}

export function getMemoryFacts() {
  return loadAll()
}

export function addMemoryFact(content, type = 'preference', source = 'ai') {
  const text = String(content || '').trim()
  if (!text) return null
  const facts = loadAll()
  const dup = facts.find(f => f.content === text)
  if (dup) return dup
  const fact = {
    id: `fact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content: text.slice(0, 300),
    type,
    source,
    createdAt: new Date().toISOString().slice(0, 10)
  }
  facts.push(fact)
  saveAll(facts)
  return fact
}

export function removeMemoryFact(id) {
  const facts = loadAll()
  const idx = facts.findIndex(f => f.id === id)
  if (idx === -1) return false
  facts.splice(idx, 1)
  saveAll(facts)
  return true
}

export function clearMemoryFacts() {
  saveAll([])
}

const TYPE_LABEL = {
  preference: '用户偏好',
  habit: '使用习惯',
  knowledge: '知识盲区/重点',
  fact: '重要事实'
}

/**
 * 格式化为注入 system prompt 的文本；无记忆返回空字符串
 */
export function formatMemoryText() {
  const facts = loadAll()
  if (facts.length === 0) return ''
  const lines = facts.map(f => {
    const label = TYPE_LABEL[f.type] || '记忆'
    return `- [${label}] ${f.content}`
  })
  return `以下是关于该用户的长期记忆（由历史对话积累），请在响应时自然地遵守这些偏好，无需复述：\n${lines.join('\n')}`
}
