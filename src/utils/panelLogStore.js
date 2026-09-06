/**
 * 三方面板（定时任务/飞书/微信）运行日志存储
 * - 与 AI 对话运行日志（logStore.js）同构：条目结构、导出格式、30 天自动清除、条数上限一致
 * - 按来源 source 隔离：'task' | 'feishu' | 'wechat'
 */

const LOG_KEY = 'panel_run_logs'
const LAST_CLEAR_KEY = 'panel_log_last_clear'
const CLEAR_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000 // 30天
const MAX_ENTRIES = 1000
// 单条日志内容上限：工具结果可能携带整份文件内容，不限制会迅速耗尽 localStorage 配额
const MAX_ENTRY_CONTENT = 20 * 1024

export const PANEL_LOG_SOURCES = ['task', 'feishu', 'wechat']

function truncateStr(s, max = MAX_ENTRY_CONTENT) {
  if (typeof s !== 'string' || s.length <= max) return s
  return s.slice(0, max) + `…[内容过长已截断，原始长度 ${s.length} 字符]`
}

function checkAutoClear() {
  try {
    const lastClear = localStorage.getItem(LAST_CLEAR_KEY)
    const now = Date.now()
    if (!lastClear) {
      localStorage.setItem(LAST_CLEAR_KEY, now.toString())
      return
    }
    const lastClearTime = parseInt(lastClear, 10)
    if (now - lastClearTime > CLEAR_INTERVAL_MS) {
      localStorage.removeItem(LOG_KEY)
      localStorage.setItem(LAST_CLEAR_KEY, now.toString())
    }
  } catch {
    // localStorage 不可用时静默处理
  }
}

function loadAll() {
  checkAutoClear()
  try {
    const data = localStorage.getItem(LOG_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

function saveAll(logs) {
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
}

/**
 * 按来源加载日志
 * @param {string} source 'task' | 'feishu' | 'wechat'
 */
export function loadPanelLogs(source) {
  return loadAll().filter(log => log.source === source)
}

/**
 * 添加一条面板日志
 * @param {string} source 面板来源
 * @param {string} type 'send' | 'receive' | 'error' | 'info' | 'tool_call' | 'tool_result' | 'tool_error'
 * @param {string} content 日志内容
 * @param {object} meta 额外元数据（同 logStore：model/toolName/toolArgs/result/error 等）
 */
export function addPanelLog(source, type, content, meta = {}) {
  if (!PANEL_LOG_SOURCES.includes(source)) return null
  const logs = loadAll()
  const safeMeta = {}
  for (const [k, v] of Object.entries(meta || {})) {
    safeMeta[k] = typeof v === 'string' ? truncateStr(v) : v
  }
  const entry = {
    id: `plog_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    source,
    type,
    content: truncateStr(typeof content === 'string' ? content : JSON.stringify(content, null, 2)),
    timestamp: new Date().toISOString(),
    ...safeMeta
  }
  logs.push(entry)
  if (logs.length > MAX_ENTRIES) {
    logs.splice(0, logs.length - MAX_ENTRIES)
  }
  saveAll(logs)
  return entry
}

/**
 * 清空指定来源的日志
 */
export function clearPanelLogs(source) {
  saveAll(loadAll().filter(log => log.source !== source))
}

/**
 * 格式化时间戳为 HH:MM:SS（与 AI 对话日志一致）
 */
export function formatPanelLogTime(isoString) {
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
