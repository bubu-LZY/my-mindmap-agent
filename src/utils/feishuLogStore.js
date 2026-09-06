/**
 * 飞书远程调用日志存储
 * 专门记录飞书机器人的消息收发和工具调用
 * 30天后自动清除
 */

const LOG_KEY = 'feishu_call_logs'
const LAST_CLEAR_KEY = 'feishu_log_last_clear'
const CLEAR_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000 // 30天
const MAX_ENTRIES = 500

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

export function loadFeishuLogs() {
  checkAutoClear()
  try {
    const data = localStorage.getItem(LOG_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

export function addFeishuLog(type, content, meta = {}) {
  const logs = loadFeishuLogs()
  const entry = {
    id: `feishu_log_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    type,
    content: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    timestamp: new Date().toISOString(),
    ...meta
  }
  logs.push(entry)
  if (logs.length > MAX_ENTRIES) {
    logs.splice(0, logs.length - MAX_ENTRIES)
  }
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(logs))
  } catch {
    logs.splice(0, Math.floor(logs.length / 2))
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(logs))
    } catch {
      // 忽略
    }
  }
  return entry
}

export function clearFeishuLogs() {
  try {
    localStorage.removeItem(LOG_KEY)
    localStorage.setItem(LAST_CLEAR_KEY, Date.now().toString())
  } catch {
    // 忽略
  }
}

export function formatFeishuLogTime(isoString) {
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
