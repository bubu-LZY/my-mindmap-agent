/**
 * AI 助手运行日志存储
 * - 记录用户发送的消息和 AI 返回的内容
 * - 每30天自动清除一次
 */

const LOG_KEY = 'ai_assistant_logs'
const LAST_CLEAR_KEY = 'ai_log_last_clear'
const CLEAR_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000 // 30天
const MAX_ENTRIES = 1000
// 单条日志内容上限：工具结果可能携带整棵导图内容，不限制会迅速耗尽 localStorage 配额
const MAX_ENTRY_CONTENT = 20 * 1024

const redactSensitiveText = (value) => String(value)
  .replace(/(api[_-]?key|authorization|bearer|access[_-]?token|refresh[_-]?token|tenant[_-]?access[_-]?token)\s*[:=]\s*([^\s,;"'}]+)/gi, '$1=<已脱敏>')
  .replace(/\b(sk|rk|ghp|gho|xox[baprs])-[A-Za-z0-9_\-]{16,}/g, '<凭证已脱敏>')
  .replace(/[?&](token|access_token|auth|ticket|encrypted_query_param)=([^&\s]+)/gi, '?$1=<已脱敏>')
  .replace(/\b[A-Za-z]:\\Users\\[^\\\r\n]+(?:\\[^\\\r\n]+)*/g, '<本地路径已脱敏>')
  .replace(/\/Users\/[^/\s]+(?:\/[^\s]+)*/g, '<本地路径已脱敏>')

const redactLogValue = (value, depth = 0, seen = new WeakSet()) => {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (Array.isArray(value)) {
    if (seen.has(value) || depth > 6) return '[已省略]'
    seen.add(value)
    return value.map(item => redactLogValue(item, depth + 1, seen))
  }
  if (value && typeof value === 'object') {
    if (seen.has(value) || depth > 6) return '[已省略]'
    seen.add(value)
    const output = {}
    for (const [key, item] of Object.entries(value)) {
      if (/apiKey|accessToken|refreshToken|authorization|cookie|password/i.test(key)) output[key] = '<已脱敏>'
      else output[key] = redactLogValue(item, depth + 1, seen)
    }
    return output
  }
  return value
}

function truncateStr(s, max = MAX_ENTRY_CONTENT) {
  if (typeof s !== 'string') return s
  const redacted = redactSensitiveText(s)
  if (redacted.length <= max) return redacted
  return redacted.slice(0, max) + `…[内容过长已截断，原始长度 ${redacted.length} 字符]`
}

/**
 * 检查并执行自动清除（如果距离上次清除已超过30天）
 */
function checkAutoClear() {
  try {
    const lastClear = localStorage.getItem(LAST_CLEAR_KEY)
    const now = Date.now()

    if (!lastClear) {
      // 首次使用，记录时间，不清除（可能没有日志）
      localStorage.setItem(LAST_CLEAR_KEY, now.toString())
      return
    }

    const lastClearTime = parseInt(lastClear, 10)
    if (now - lastClearTime > CLEAR_INTERVAL_MS) {
      // 超过30天，清除日志
      localStorage.removeItem(LOG_KEY)
      localStorage.setItem(LAST_CLEAR_KEY, now.toString())
    }
  } catch {
    // localStorage 不可用时静默处理
  }
}

/**
 * 加载所有日志
 * @returns {Array} 日志列表
 */
export function loadLogs() {
  checkAutoClear()
  try {
    const data = localStorage.getItem(LOG_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

/**
 * 写入一条结构化日志事件（review #11）
 * - level: 'debug' | 'info' | 'warn' | 'error'，默认 'info'
 * - event: 自定义事件名（如 'chat_request' / 'tool_call'）
 * - durationMs: 本事件持续毫秒（仅当存在）
 * - 通过把字段塞进 meta 对象，让现有 addLog 调用方无需改动
 */
export function addLogEvent(level, event, content, extraMeta = {}, conversationId = null) {
  const meta = { ...(extraMeta || {}) }
  if (level) meta.level = level
  if (event) meta.event = event
  // durationMs 由调用方在 extraMeta 里传；不在这里硬塞
  return addLog('info', content, meta, conversationId)
}

/**
 * 工具调用结构化日志（review #11）
 * - level: 通常 info；失败 error
 * - event: 固定 'tool_call'
 * - extraMeta: 调用方传 { toolName, args, durationMs, result, error, ... }
 */
export function addToolLog(level, content, extraMeta = {}, conversationId = null) {
  const meta = { ...(extraMeta || {}), event: 'tool_call' }
  if (level) meta.level = level
  return addLog('tool', content, meta, conversationId)
}

/**
 * 添加一条日志
 * @param {string} type - 日志类型: 'send' | 'receive' | 'error' | 'info' | 'tool_call' | 'tool_result' | 'tool_error'
 * @param {string} content - 日志内容
 * @param {object} meta - 额外元数据 { model, toolCalls, toolName, toolArgs, result, error, etc }
 * @param {string|null} conversationId - 关联的对话 ID
 * @returns {object} 创建的日志条目
 */
export function addLog(type, content, meta = {}, conversationId = null) {
  const logs = loadLogs()
  // 限制 meta 中超长字符串字段（如工具返回的 result / toolArgs）
  const safeMeta = {}
  for (const [k, v] of Object.entries(meta || {})) {
    if (typeof v === 'string') {
      safeMeta[k] = truncateStr(v)
    } else {
      safeMeta[k] = redactLogValue(v)
    }
  }
  const entry = {
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    type,        // 'send' | 'receive' | 'error' | 'info' | 'tool_call' | 'tool_result' | 'tool_error'
    content: truncateStr(typeof content === 'string' ? content : JSON.stringify(content, null, 2)),
    timestamp: new Date().toISOString(),
    conversationId,  // 关联日志与对话
    ...safeMeta
  }
  logs.push(entry)
  // 限制最大条数
  if (logs.length > MAX_ENTRIES) {
    logs.splice(0, logs.length - MAX_ENTRIES)
  }
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(logs))
  } catch {
    // 存储空间不足时，删除旧日志
    logs.splice(0, Math.floor(logs.length / 2))
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(logs))
    } catch {
      // 忽略
    }
  }
  return entry
}

/**
 * 按对话 ID 加载日志
 * @param {string} conversationId - 对话 ID，为空时返回全部日志
 * @returns {Array} 日志列表
 */
export function loadLogsByConversation(conversationId) {
  checkAutoClear()
  try {
    const data = localStorage.getItem(LOG_KEY)
    const allLogs = data ? JSON.parse(data) : []
    if (!conversationId) return allLogs
    return allLogs.filter(log => log.conversationId === conversationId)
  } catch {
    return []
  }
}

/**
 * 清除指定对话的日志
 * @param {string} conversationId - 对话 ID
 */
export function clearLogsByConversation(conversationId) {
  try {
    const data = localStorage.getItem(LOG_KEY)
    const allLogs = data ? JSON.parse(data) : []
    const filtered = allLogs.filter(log => log.conversationId !== conversationId)
    localStorage.setItem(LOG_KEY, JSON.stringify(filtered))
  } catch {
    // 忽略
  }
}

/**
 * 清除所有日志
 */
export function clearLogs() {
  try {
    localStorage.removeItem(LOG_KEY)
    localStorage.setItem(LAST_CLEAR_KEY, Date.now().toString())
  } catch {
    // 忽略
  }
}

/**
 * 格式化时间戳为可读字符串
 * @param {string} isoString - ISO 时间字符串
 * @returns {string} 格式化后的时间
 */
export function formatLogTime(isoString) {
  try {
    const d = new Date(isoString)
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    const s = String(d.getSeconds()).padStart(2, '0')
    return `${h}:${m}:${s}`
  } catch {
    return ''
  }
}

/**
 * 格式化完整日期时间
 * @param {string} isoString - ISO 时间字符串
 * @returns {string} 格式化后的日期时间
 */
export function formatLogDateTime(isoString) {
  try {
    const d = new Date(isoString)
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const da = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    const s = String(d.getSeconds()).padStart(2, '0')
    return `${mo}-${da} ${h}:${m}:${s}`
  } catch {
    return ''
  }
}
