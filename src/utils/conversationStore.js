import { storage } from './storage.js'

/**
 * 对话管理工具
 * 管理对话历史、永久记忆、当前对话状态
 * 使用 localStorage 持久化存储
 */

const MAX_CONVERSATIONS = 30

/**
 * 生成唯一 ID
 */
function genId() {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 加载所有对话
 * @returns {Array} 对话列表，按更新时间倒序
 */
export function loadConversations() {
  try {
    const raw = storage.get('ai_conversations', [])
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/**
 * 保存对话列表
 * @param {Array} conversations 对话列表
 */
function saveConversations(conversations) {
  try {
    // 只保留最近 MAX_CONVERSATIONS 个
    const trimmed = conversations.slice(0, MAX_CONVERSATIONS)
    storage.set('ai_conversations', trimmed)
  } catch (e) {
    console.error('保存对话列表失败:', e)
  }
}

/**
 * 创建新对话
 * @returns {Object} 新对话对象
 */
export function createConversation() {
  return {
    id: genId(),
    title: '新对话',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

/**
 * 获取当前对话 ID
 * @returns {string|null}
 */
export function getCurrentConversationId() {
  return storage.get('ai_current_conversation')
}

/**
 * 设置当前对话 ID
 * @param {string} id 对话 ID
 */
export function setCurrentConversationId(id) {
  if (id) {
    storage.set('ai_current_conversation', id)
  } else {
    storage.remove('ai_current_conversation')
  }
}

/**
 * 保存或更新对话
 * @param {Object} conversation 对话对象
 */
export function saveConversation(conversation) {
  if (!conversation || !conversation.id) return
  const conversations = loadConversations()
  const index = conversations.findIndex(c => c.id === conversation.id)
  conversation.updatedAt = Date.now()
  if (index >= 0) {
    conversations[index] = conversation
  } else {
    conversations.unshift(conversation)
  }
  // 按更新时间倒序排列
  conversations.sort((a, b) => b.updatedAt - a.updatedAt)
  saveConversations(conversations)
}

/**
 * 删除对话
 * @param {string} id 对话 ID
 */
export function deleteConversation(id) {
  const conversations = loadConversations().filter(c => c.id !== id)
  saveConversations(conversations)
  if (getCurrentConversationId() === id) {
    setCurrentConversationId(null)
  }
}

/**
 * 清空所有对话历史
 */
export function clearAllConversations() {
  saveConversations([])
  setCurrentConversationId(null)
}

/**
 * 根据 ID 加载对话
 * @param {string} id 对话 ID
 * @returns {Object|null}
 */
export function getConversationById(id) {
  const conversations = loadConversations()
  return conversations.find(c => c.id === id) || null
}

/**
 * 加载永久记忆
 * @returns {string} 记忆内容
 */
export function loadMemory() {
  return storage.get('ai_memory', '')
}

/**
 * 保存永久记忆
 * @param {string} memory 记忆内容
 */
export function saveMemory(memory) {
  storage.set('ai_memory', memory || '')
}

/**
 * 自动生成对话标题（取第一条用户消息前20字）
 * @param {Object} conversation 对话对象
 * @returns {string} 标题
 */
export function generateTitle(conversation) {
  const firstUserMsg = conversation.messages?.find(m => m.role === 'user')
  if (firstUserMsg) {
    const text = typeof firstUserMsg.content === 'string'
      ? firstUserMsg.content
      : ''
    return text.slice(0, 20) + (text.length > 20 ? '...' : '')
  }
  return '新对话'
}
