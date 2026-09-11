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
// meta 里数组字段的条目上限（如子 Agent 明细），防止单个 meta 撑爆配额
const MAX_META_ARRAY = 200
// 写盘合并窗口：这段时间内的所有 addLog 只落一次 localStorage
const PERSIST_DELAY_MS = 800
// 30 天自动清除的检查间隔（过期粒度是天，按小时查一次足够）
const AUTO_CLEAR_CHECK_MS = 60 * 60 * 1000

/**
 * 全量数组常驻内存，localStorage 只作为持久化后端。
 *
 * 原先每条日志都是一次 getItem → JSON.parse 全量 → push → JSON.stringify 全量 → setItem，
 * 1000 条、单条最长 20KB 时就是兆级的同步序列化。一次 Agent 任务几十上百条日志，
 * 主线程被反复占满 —— 这才是任务执行期间界面卡顿的主因，跟日志面板开没开无关。
 * 改成缓存后 addLog 退化为一次数组 push，写盘按 PERSIST_DELAY_MS 合并。
 */
let cache = null
let persistTimer = null
let dirty = false

const redactSensitiveText = (value) => String(value)
  .replace(/(api[_-]?key|authorization|bearer|access[_-]?token|refresh[_-]?token|tenant[_-]?access[_-]?token)\s*[:=]\s*([^\s,;"'}]+)/gi, '$1=<已脱敏>')
  .replace(/\b(sk|rk|ghp|gho|xox[baprs])-[A-Za-z0-9_\-]{16,}/g, '<凭证已脱敏>')
  .replace(/[?&](token|access_token|auth|ticket|encrypted_query_param)=([^&\s]+)/gi, '?$1=<已脱敏>')
  .replace(/\b[A-Za-z]:\\Users\\[^\\\r\n]+(?:\\[^\\\r\n]+)*/g, '<本地路径已脱敏>')
  .replace(/\/Users\/[^/\s]+(?:\/[^\s]+)*/g, '<本地路径已脱敏>')

const redactLogValue = (value, depth = 0, seen = new WeakSet()) => {
  // truncateStr 内部已做脱敏，这里顺带把嵌套字符串也限长：
  // 原先只有 meta 的顶层字符串会被截断，藏在对象/数组深处的长字符串能绕过上限
  if (typeof value === 'string') return truncateStr(value)
  if (Array.isArray(value)) {
    if (seen.has(value) || depth > 6) return '[已省略]'
    seen.add(value)
    const items = value.slice(0, MAX_META_ARRAY).map(item => redactLogValue(item, depth + 1, seen))
    if (value.length > MAX_META_ARRAY) items.push(`…[数组过长，已省略 ${value.length - MAX_META_ARRAY} 项]`)
    return items
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
      // 超过30天，清除日志。缓存与待写盘任务必须一起作废，
      // 否则下一次 flush 会把刚删掉的日志原样写回去
      localStorage.removeItem(LOG_KEY)
      localStorage.setItem(LAST_CLEAR_KEY, now.toString())
      cache = null
      dirty = false
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
    }
  } catch {
    // localStorage 不可用时静默处理
  }
}

/** 取缓存，未加载时从 localStorage 读一次 */
function readCache() {
  if (cache) return cache
  try {
    const data = localStorage.getItem(LOG_KEY)
    const parsed = data ? JSON.parse(data) : []
    cache = Array.isArray(parsed) ? parsed : []
  } catch {
    cache = []
  }
  return cache
}

// 30 天的过期粒度，按小时查一次绰绰有余。
// addLog 不再走 loadLogs，不补这一步的话写路径就永远不会触发自动清除；
// 而读路径在日志面板打开时每帧都会跑一次，每次都查也没意义。
let lastAutoClearCheck = 0
function maybeAutoClear() {
  const now = Date.now()
  if (now - lastAutoClearCheck < AUTO_CLEAR_CHECK_MS) return
  lastAutoClearCheck = now
  checkAutoClear()
}

/** 立即写盘；配额不足时砍掉一半最旧的日志重试 */
function persistNow() {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
  if (!cache) return
  dirty = false
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(cache))
  } catch {
    cache.splice(0, Math.floor(cache.length / 2))
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(cache))
    } catch {
      // 忽略
    }
  }
}

/** 合并写盘：窗口期内的多次 addLog 只落一次 localStorage */
function schedulePersist() {
  dirty = true
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    if (dirty) persistNow()
  }, PERSIST_DELAY_MS)
}

// 关窗或切到后台时补写，否则最后 PERSIST_DELAY_MS 内的日志会随进程一起消失
if (typeof window !== 'undefined') {
  const flushOnHide = () => { if (dirty) persistNow() }
  window.addEventListener('pagehide', flushOnHide)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide()
  })
}

/**
 * 加载所有日志
 * @returns {Array} 日志列表
 */
export function loadLogs() {
  maybeAutoClear()
  return readCache().slice()
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
  maybeAutoClear()
  const logs = readCache()
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
  schedulePersist()
  return entry
}

/**
 * 按对话 ID 加载日志
 * @param {string} conversationId - 对话 ID，为空时返回全部日志
 * @returns {Array} 日志列表
 */
export function loadLogsByConversation(conversationId) {
  maybeAutoClear()
  const allLogs = readCache()
  if (!conversationId) return allLogs.slice()
  return allLogs.filter(log => log.conversationId === conversationId)
}

/**
 * 清除指定对话的日志
 * @param {string} conversationId - 对话 ID
 */
export function clearLogsByConversation(conversationId) {
  const kept = readCache().filter(log => log.conversationId !== conversationId)
  cache = kept
  // 清除是用户主动动作，立刻落盘，不给合并窗口留机会把旧数据写回去
  persistNow()
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
  cache = []
  dirty = false
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
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
