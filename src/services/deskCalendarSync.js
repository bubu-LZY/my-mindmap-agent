/**
 * desktop_todo_Calendar 复习计划同步服务
 *
 * 同步范围：仅 my-mindmap agent「复习计划」中的复习周期任务（日历端标题带 [MM复习] 前缀），
 * 用户/其他 AI 自己创建的日历任务一律不参与同步。
 *
 * 冲突仲裁：以「状态最后变更时间」为准的最后写入胜出（LWW）。
 * 典型场景——10:00 在本端勾选完成，10:01 取消勾选：取消动作的时间戳更新，
 * 因此同步时判定"未完成"为最新状态并推给对方，不会把误触的完成状态留在对端。
 *
 * 时间戳取自本地 cycle.statusUpdatedAt 与日历任务的 updatedAt（旧版日历无该字段时
 * 回退 completedAt；未完成且无 updatedAt 时按 0 处理，必然输给带时间戳的一端）。
 */

import {
  getReviewPlan,
  getReviewSyncEntries,
  getCycleStatusByKey,
  markCycleCompleted,
  markCycleUncompleted,
  setCycleStatusFromRemote
} from '../utils/reviewPlan'

const CONFIG_KEY = 'MINDMAP_DESK_CALENDAR_SYNC'
// desktop_todo_Calendar 内置 MCP 默认端口为 17804（AppConfig.McpPort）
const DEFAULT_MCP_URL = 'http://127.0.0.1:17804/mcp'
// 唯一前缀：只认由 my-mindmap agent 推送的任务，避免把用户/其他 AI 自己建的复习任务误识别。
const REVIEW_TITLE_PREFIX = '[MM复习]'
const LEGACY_REVIEW_TITLE_PREFIX = '[复习]'
// 启用同步后的自动同步周期：每小时一次
const SYNC_INTERVAL_MS = 60 * 60 * 1000

const normalizeReviewTitle = (title) => {
  let t = String(title || '').trim()
  if (t.startsWith(REVIEW_TITLE_PREFIX)) t = t.slice(REVIEW_TITLE_PREFIX.length).trim()
  else if (t.startsWith(LEGACY_REVIEW_TITLE_PREFIX)) t = t.slice(LEGACY_REVIEW_TITLE_PREFIX.length).trim()
  return t
}

let enabled = false
let authToken = ''
let mcpUrl = DEFAULT_MCP_URL
let pollTimer = null
let notifyTimer = null
let running = false
let lastTaskMap = {}
let lastSyncAt = 0
let lastError = ''

const loadConfig = () => {
  try {
    const cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}')
    return {
      enabled: !!cfg.enabled,
      taskMap: cfg.taskMap && typeof cfg.taskMap === 'object' ? cfg.taskMap : {},
      token: cfg.token || '',
      lastSyncAt: Number(cfg.lastSyncAt) || 0
    }
  } catch { return { enabled: false, taskMap: {}, token: '', lastSyncAt: 0 } }
}

const saveConfig = () => {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({
    enabled,
    token: authToken,
    taskMap: lastTaskMap,
    lastSyncAt
  }))
}

// 通知 UI（复习面板的「立即同步桌面」按钮）同步开关/Token 已变化
const notifyConfigChanged = () => {
  try {
    window.dispatchEvent?.(new CustomEvent('desk-calendar-sync-changed'))
  } catch { /* 忽略 */ }
}

// 把 ISO 字符串 / 毫秒数 / 秒数统一成毫秒时间戳
const parseTs = (value) => {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') {
    if (!isFinite(value) || value <= 0) return 0
    // 秒级时间戳（10 位）按秒处理，其余按毫秒
    return value < 1e11 ? value * 1000 : value
  }
  const t = Date.parse(String(value))
  return isFinite(t) ? t : 0
}

/**
 * 取日历任务的状态变更时间戳。
 * updatedAt 优先（完成与取消完成都会刷新）；旧版日历没有该字段时回退 completedAt。
 */
const remoteStatusTs = (task) => {
  const updated = parseTs(task?.updatedAt)
  if (updated > 0) return updated
  return parseTs(task?.completedAt)
}

const callMcp = async (method, params) => {
  if (!authToken) throw new Error('未配置 desktop todo calendar Token')
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now()
    })
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const loadMcpServerConfig = async () => {
  try {
    const servers = await window.electronAPI?.mcp?.list?.() || []
    const target = servers.find(s => /desktop.?todo|desk.?todo|desktop_todo/i.test(`${s?.name || ''} ${s?.id || ''}`))
    if (target?.url) mcpUrl = target.url
    if (target?.headers?.Authorization) {
      const m = String(target.headers.Authorization).match(/Bearer\s+(.+)/i)
      if (m) authToken = m[1].trim()
    }
  } catch (e) {
    // 保留默认值
  }
}

const toolsCall = async (name, args) => {
  const data = await callMcp('tools/call', { name, arguments: args })
  if (data?.error) throw new Error(data.error.message || 'MCP error')
  const result = data?.result
  if (!result) return null
  if (result.isError) {
    const text = result.content?.[0]?.text || 'calendar error'
    throw new Error(text)
  }
  try { return JSON.parse(result.content?.[0]?.text || 'null') } catch { return result.content?.[0]?.text }
}

export const isDeskCalendarSyncEnabled = () => {
  const cfg = loadConfig()
  enabled = cfg.enabled
  authToken = cfg.token
  lastTaskMap = cfg.taskMap
  lastSyncAt = cfg.lastSyncAt
  if (enabled) setTimeout(startSync, 0)
  return enabled
}

export const getDeskCalendarToken = () => {
  return loadConfig().token || ''
}

export const setDeskCalendarSyncEnabled = (value, token = '') => {
  enabled = !!value
  const cfg = loadConfig()
  if (token) authToken = String(token).trim()
  else authToken = cfg.token
  lastTaskMap = cfg.taskMap
  lastSyncAt = cfg.lastSyncAt
  saveConfig()
  notifyConfigChanged()
  if (enabled) {
    // 启用时优先读取 MCP 配置（url + Authorization），保持一致
    loadMcpServerConfig().then(() => startSync())
  } else {
    stopSync()
  }
  return enabled
}

// 单独保存连接 Token（不改变同步开关状态）。开关开启时用新 Token 重启同步。
export const setDeskCalendarToken = (token) => {
  const cfg = loadConfig()
  authToken = String(token || '').trim()
  enabled = cfg.enabled
  lastTaskMap = cfg.taskMap
  lastSyncAt = cfg.lastSyncAt
  saveConfig()
  notifyConfigChanged()
  if (enabled && authToken) startSync()
  return authToken
}

export const getDeskCalendarSyncStatus = () => ({ enabled, running, lastTaskMap })

// 供 UI 展示的同步元信息（上次同步时间、最近一次错误）
export const getDeskCalendarSyncMeta = () => {
  const cfg = loadConfig()
  return {
    enabled,
    running,
    lastSyncAt: lastSyncAt || cfg.lastSyncAt || 0,
    lastError,
    hasToken: !!authToken,
    linkedCount: Object.keys(lastTaskMap || {}).length
  }
}

// 接收 desktop_todo_Calendar 主动推送的勾选状态（走 my-mindmap agent 本地 HTTP 服务）
export const initDeskCalendarStatusListener = () => {
  if (typeof window === 'undefined') return
  window.electronAPI?.deskCalendar?.onStatus?.((payload) => {
    if (!payload) return
    const title = normalizeReviewTitle(payload.title || '')
    const date = String(payload.date || '')
    const targetCompleted = !!payload.isCompleted
    const remoteTs = parseTs(payload.updatedAt)
    const items = getReviewPlan()
    for (const item of items) {
      for (const c of item.cycles || []) {
        if (c.reviewDate !== date) continue
        if (normalizeReviewTitle(item.nodeText || item.fileName || '') !== title) continue
        const localTs = Number(c.statusUpdatedAt) || 0
        // 时间戳仲裁：本端更新的话忽略这次推送，避免把用户刚做的操作回退
        if (remoteTs > 0 && localTs > remoteTs) return
        if (targetCompleted && !c.completed) markCycleCompleted(item.id, c.cycle)
        else if (!targetCompleted && c.completed) markCycleUncompleted(item.id, c.cycle)
        return
      }
    }
  })
}

/**
 * 响应来自 desktop_todo_Calendar 的查询请求（经主进程本地 HTTP 服务转发）。
 * 目前只提供复习计划快照，供对方做时间戳仲裁后回写；HTTP 层已做 Token 鉴权。
 */
export const initDeskCalendarQueryListener = () => {
  if (typeof window === 'undefined') return
  const api = window.electronAPI?.deskCalendar
  if (!api?.onQuery || !api?.sendQueryResponse) return
  api.onQuery((payload) => {
    if (!payload?.id) return
    try {
      if (payload.action === 'review-plan') {
        api.sendQueryResponse(payload.id, { tasks: getReviewSyncEntries() })
        return
      }
      api.sendQueryResponse(payload.id, null, `未知操作：${payload.action || ''}`)
    } catch (e) {
      api.sendQueryResponse(payload.id, null, e?.message || '查询复习计划失败')
    }
  })
}

/**
 * 手动触发一次全量同步（供「立即同步桌面」按钮与 AI 工具调用）。
 * 即使自动同步开关关闭，只要 Token 已配置也会执行一次。
 */
export const runDeskCalendarSyncOnce = async () => {
  if (running) return { success: false, message: '同步正在进行中，请稍后再试' }
  // 优先读取 MCP 配置（url + Authorization），与本地 token 保持一致，避免两处冲突
  await loadMcpServerConfig()
  const cfg = loadConfig()
  if (!authToken) authToken = cfg.token
  enabled = cfg.enabled
  lastTaskMap = cfg.taskMap
  if (!authToken) return { success: false, message: '未配置 desktop todo calendar 连接，请先在设置中粘贴 MCP JSON 配置' }
  running = true
  try {
    const stats = await syncAll()
    lastError = ''
    return {
      success: true,
      message: `同步完成：新增 ${stats.added}、更新 ${stats.updated}、拉取 ${stats.pulled}、删除 ${stats.deleted}`,
      stats
    }
  } catch (e) {
    lastError = e?.message || String(e)
    return { success: false, message: `同步失败：${lastError}` }
  } finally {
    running = false
  }
}

/**
 * 勾选/取消勾选某个复习周期时触发的即时同步：
 * 先读取对方同一任务的状态与时间戳，比对后把最新的状态写到落后的一方。
 * 仅处理这一条复习任务，不影响其他任务；未开启同步或未配置 Token 时静默跳过。
 */
export const syncReviewCycleToDeskCalendar = async (itemId, cycleNum) => {
  if (!enabled) return { success: false, skipped: true, message: '未开启同步' }
  // 优先读取 MCP 配置，与本地 token 保持一致
  await loadMcpServerConfig()
  const cfg = loadConfig()
  if (!authToken) authToken = cfg.token
  if (!authToken) return { success: false, skipped: true, message: '未配置连接' }
  const key = `${itemId}::${cycleNum}`
  const local = getCycleStatusByKey(key)
  if (!local) return { success: false, skipped: true, message: '复习周期不存在' }

  try {
    const calendarId = await ensureCalendarTask(local)
    if (!calendarId) return { success: false, message: '日历任务创建失败' }
    const remote = await fetchCalendarTask(calendarId)
    if (!remote) return { success: false, message: '未找到日历任务' }

    const decision = resolveConflict(local, remote)
    if (decision.action === 'push') {
      await applyRemoteCompletion(calendarId, local.completed, remote)
      return { success: true, action: 'push', completed: local.completed }
    }
    if (decision.action === 'pull') {
      setCycleStatusFromRemote(itemId, cycleNum, remote.isCompleted, remoteStatusTs(remote))
      return { success: true, action: 'pull', completed: !!remote.isCompleted }
    }
    return { success: true, action: 'none', completed: local.completed }
  } catch (e) {
    lastError = e?.message || String(e)
    return { success: false, message: lastError }
  }
}

// ===== 同步主流程 =====

const startSync = () => {
  stopSync()
  if (!enabled) return
  window.addEventListener?.('review-plan-changed', onReviewPlanChanged)
  runSyncOnce()
  // 每小时自动同步一次，保证长时间不操作也能对齐两端状态
  pollTimer = setInterval(runSyncOnce, SYNC_INTERVAL_MS)
}

const stopSync = () => {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  if (notifyTimer) clearTimeout(notifyTimer)
  notifyTimer = null
  window.removeEventListener?.('review-plan-changed', onReviewPlanChanged)
}

const onReviewPlanChanged = (event) => {
  if (!enabled || !authToken) return
  const detail = event?.detail
  // 同步回写引起的变更：不再反向触发，否则两端会互相触发形成回环
  if (detail && detail.type === 'remote') return
  // 勾选/取消勾选：只同步这一条，做到点一下就立刻对齐，避免全量扫描
  if (detail && detail.type === 'toggle' && detail.itemId && detail.cycle) {
    syncReviewCycleToDeskCalendar(detail.itemId, detail.cycle)
    return
  }
  // 新增/删除/改期等：防抖后走全量
  if (notifyTimer) clearTimeout(notifyTimer)
  notifyTimer = setTimeout(() => { notifyTimer = null; runSyncOnce() }, 600)
}

const runSyncOnce = async () => {
  if (running) return
  if (!authToken) return
  running = true
  try {
    await syncAll()
    lastError = ''
  } catch (e) {
    // 日历未启动/未连接时静默，等待下个轮询周期
    lastError = e?.message || String(e)
  } finally {
    running = false
  }
}

/**
 * 仲裁：谁的"状态最后变更时间"更新，就以谁为准。
 * 时间戳相同（极少见）时以本端为准，保证用户刚做的操作不会被回退。
 */
const resolveConflict = (local, remote) => {
  const localCompleted = !!local.completed
  const remoteCompleted = !!remote.isCompleted
  if (localCompleted === remoteCompleted) return { action: 'none' }
  const localTs = Number(local.statusUpdatedAt) || 0
  const remoteTs = remoteStatusTs(remote)
  if (remoteTs > localTs) return { action: 'pull', completed: remoteCompleted }
  return { action: 'push', completed: localCompleted }
}

// 只写差异：避免在已一致的任务上产生无意义的写操作与时间戳刷新
const applyRemoteCompletion = async (calendarId, completed, remote) => {
  if (!!remote.isCompleted === !!completed) return
  await toolsCall(completed ? 'complete_task' : 'uncomplete_task', { id: calendarId })
}

// 按 id 精确取一条日历任务
const fetchCalendarTask = async (calendarId) => {
  const data = await toolsCall('query_tasks', { range: 'all' })
  const tasks = Array.isArray(data?.tasks) ? data.tasks : []
  return tasks.find(t => t?.id === calendarId) || null
}

/**
 * 保证本端复习周期在日历上有对应任务，返回日历任务 id。
 * 先查已建立的映射，再按「日期::标题」匹配，都没有才新建。
 */
const ensureCalendarTask = async (entry) => {
  const title = `${REVIEW_TITLE_PREFIX}${entry.title || '复习任务'}`
  const mapped = lastTaskMap[entry.key]
  if (mapped) return mapped

  const data = await toolsCall('query_tasks', { range: 'all' })
  const tasks = Array.isArray(data?.tasks) ? data.tasks : []
  const base = normalizeReviewTitle(title)
  const existing = tasks.find(t => t?.id && t?.date === entry.date && normalizeReviewTitle(t.title) === base)
  if (existing) {
    lastTaskMap[entry.key] = existing.id
    saveConfig()
    return existing.id
  }
  const created = await toolsCall('add_task', { title, date: entry.date, isImportant: false })
  if (!created?.id) return null
  lastTaskMap[entry.key] = created.id
  saveConfig()
  return created.id
}

const syncAll = async () => {
  await loadMcpServerConfig()
  const entries = getReviewSyncEntries()
  const stats = { added: 0, updated: 0, pulled: 0, deleted: 0 }

  let tasks = []
  try {
    const data = await toolsCall('query_tasks', { range: 'all' })
    tasks = Array.isArray(data?.tasks) ? data.tasks : []
  } catch (e) {
    throw new Error('无法连接 desktop_todo_Calendar 或 Token 无效，请确认日历已运行并检查 Token')
  }

  const byId = new Map()
  const byKey = new Map()
  for (const t of tasks) {
    if (!t?.id || !t?.date || !t?.title) continue
    byId.set(t.id, t)
    byKey.set(`${t.date}::${normalizeReviewTitle(t.title)}`, t)
  }

  const validKeys = new Set()
  for (const entry of entries) {
    validKeys.add(entry.key)
    const title = `${REVIEW_TITLE_PREFIX}${entry.title || '复习任务'}`
    const calKey = `${entry.date}::${normalizeReviewTitle(title)}`

    let calendarId = lastTaskMap[entry.key]
    let remote = calendarId ? byId.get(calendarId) : null
    // 映射失效（任务被外部删掉）时按日期+标题重新挂接
    if (!remote) {
      remote = byKey.get(calKey) || null
      if (remote) calendarId = remote.id
    }

    if (!remote) {
      const created = await toolsCall('add_task', { title, date: entry.date, isImportant: false })
      if (created?.id) {
        lastTaskMap[entry.key] = created.id
        byId.set(created.id, created)
        stats.added++
        if (entry.completed) {
          await toolsCall('complete_task', { id: created.id })
        }
      }
      continue
    }

    lastTaskMap[entry.key] = remote.id

    // 复习日期或标题变化：先对齐基础信息，再仲裁状态
    const dateChanged = String(remote.date || '') !== String(entry.date)
    const titleChanged = String(remote.title || '') !== String(title)
    if (dateChanged || titleChanged) {
      await toolsCall('update_task', { id: remote.id, date: entry.date, title })
      stats.updated++
    }

    // 时间戳仲裁：本端更新则推给日历，对端更新则拉回本端
    const decision = resolveConflict(entry, remote)
    if (decision.action === 'push') {
      await applyRemoteCompletion(remote.id, entry.completed, remote)
      stats.updated++
    } else if (decision.action === 'pull') {
      setCycleStatusFromRemote(entry.itemId, entry.cycle, !!remote.isCompleted, remoteStatusTs(remote))
      stats.pulled++
    }
  }

  // 复习项/复习周期被删除时，移除对应的日历任务
  for (const key of Object.keys(lastTaskMap)) {
    if (validKeys.has(key)) continue
    try {
      await toolsCall('delete_task', { id: lastTaskMap[key] })
      stats.deleted++
    } catch (e) { /* 已被删除则忽略 */ }
    delete lastTaskMap[key]
  }

  lastSyncAt = Date.now()
  saveConfig()
  await cleanupDuplicateCalendarTasks()
  return stats
}

// 清理同一天标题重复的历史任务（早期版本可能重复推送过）
const cleanupDuplicateCalendarTasks = async () => {
  try {
    const data = await toolsCall('query_tasks', { range: 'all' })
    const tasks = Array.isArray(data?.tasks) ? data.tasks : []
    const groups = new Map()
    for (const t of tasks) {
      if (!t?.id || !t?.date || !t?.title) continue
      const hasPrefix = t.title.startsWith(REVIEW_TITLE_PREFIX) || t.title.startsWith(LEGACY_REVIEW_TITLE_PREFIX)
      if (!hasPrefix) continue
      const key = `${t.date}::${normalizeReviewTitle(t.title)}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(t)
    }
    for (const items of groups.values()) {
      if (items.length <= 1) continue
      const rank = (t) => {
        if (t.title.startsWith(REVIEW_TITLE_PREFIX)) return 0
        if (t.title.startsWith(LEGACY_REVIEW_TITLE_PREFIX)) return 1
        return 2
      }
      items.sort((a, b) => rank(a) - rank(b) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
      const keep = items[0]
      for (const t of items.slice(1)) {
        // 保留映射指向的任务，避免把正在使用的那条删掉
        if (Object.values(lastTaskMap).includes(t.id)) continue
        try { await toolsCall('delete_task', { id: t.id }) } catch (e) { /* 忽略 */ }
      }
      if (keep && !keep.title.startsWith(REVIEW_TITLE_PREFIX)) {
        try {
          await toolsCall('update_task', { id: keep.id, title: `${REVIEW_TITLE_PREFIX}${normalizeReviewTitle(keep.title)}` })
        } catch (e) { /* 忽略 */ }
      }
    }
  } catch (e) { /* 清理失败不影响主流程 */ }
}
