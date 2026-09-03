/**
 * Desk Studio Calendar 同步服务
 * 通过对方内置的 MCP 服务（http://127.0.0.1:17804/mcp）进行双向状态同步：
 * - 把 my-mindmap agent 的复习计划推送到日历（标题带 [复习] 前缀）。
 * - 轮询日历任务完成状态，回写到 my-mindmap agent 的复习周期。
 * 删除日历任务不会删除 my-mindmap agent 的复习计划（仅同步勾选状态）。
 */

import {
  getReviewPlan,
  markCycleCompleted,
  markCycleUncompleted
} from '../utils/reviewPlan'

const CONFIG_KEY = 'MINDMAP_DESK_CALENDAR_SYNC'
const DEFAULT_MCP_URL = 'http://127.0.0.1:17802/mcp'
// 唯一前缀：只认由 my-mindmap agent 推送的任务，避免把用户/其他 AI 自己建的复习任务误识别。
const REVIEW_TITLE_PREFIX = '[MM复习]'
const LEGACY_REVIEW_TITLE_PREFIX = '[复习]'

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

const loadConfig = () => {
  try {
    const cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}')
    return { enabled: !!cfg.enabled, taskMap: cfg.taskMap && typeof cfg.taskMap === 'object' ? cfg.taskMap : {}, token: cfg.token || '' }
  } catch { return { enabled: false, taskMap: {}, token: '' } }
}

const saveConfig = () => {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ enabled, token: authToken, taskMap: lastTaskMap }))
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
  if (enabled) setTimeout(startSync, 0)
  return enabled
}

export const getDeskCalendarToken = () => {
  return loadConfig().token || ''
}

export const setDeskCalendarSyncEnabled = (value, token = '') => {
  enabled = !!value
  if (token) authToken = String(token).trim()
  else if (!authToken) authToken = loadConfig().token
  lastTaskMap = loadConfig().taskMap
  saveConfig()
  if (enabled) startSync()
  else stopSync()
  return enabled
}

export const getDeskCalendarSyncStatus = () => ({ enabled, running, lastTaskMap })

// 接收 desktop_todo_Calendar 主动推送的勾选状态（走 my-mindmap agent 本地 HTTP 服务）
export const initDeskCalendarStatusListener = () => {
  if (typeof window === 'undefined') return
  window.electronAPI?.deskCalendar?.onStatus?.((payload) => {
    if (!payload) return
    const title = normalizeReviewTitle(payload.title || '')
    const date = String(payload.date || '')
    const targetCompleted = !!payload.isCompleted
    const items = getReviewPlan()
    for (const item of items) {
      for (const c of item.cycles || []) {
        if (c.reviewDate !== date) continue
        if (normalizeReviewTitle(item.nodeText || item.fileName || '') !== title) continue
        if (targetCompleted && !c.completed) markCycleCompleted(item.id, c.cycle)
        else if (!targetCompleted && c.completed) markCycleUncompleted(item.id, c.cycle)
        return
      }
    }
  })
}

// 手动触发一次同步（供 AI 工具调用）。即使自动同步开关关闭，只要 Token 已配置也会执行一次。
export const runDeskCalendarSyncOnce = async () => {
  if (running) return { success: false, message: '同步正在进行中，请稍后再试' }
  const cfg = loadConfig()
  authToken = cfg.token
  enabled = cfg.enabled
  if (!authToken) return { success: false, message: '未配置 desktop todo calendar Token，请先在设置中填写' }
  running = true
  try {
    await loadMcpServerConfig()
    await pushDueReviewPlans()
    await pullCompletionStatus()
    await cleanupDuplicateCalendarTasks()
    await deleteRemovedReviewPlans()
    return { success: true, message: '复习计划同步完成（已去重并同步状态）' }
  } catch (e) {
    return { success: false, message: `同步失败：${e?.message || e}` }
  } finally {
    running = false
  }
}

const startSync = () => {
  stopSync()
  if (!enabled) return
  window.addEventListener?.('review-plan-changed', notifyReviewPlanChanged)
  runSyncOnce()
  // 每天自动同步 4 次（6 小时一次），其余依赖 review-plan-changed 事件即时触发
  pollTimer = setInterval(runSyncOnce, 6 * 60 * 60 * 1000)
}

const stopSync = () => {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  if (notifyTimer) clearTimeout(notifyTimer)
  notifyTimer = null
  window.removeEventListener?.('review-plan-changed', notifyReviewPlanChanged)
}

const notifyReviewPlanChanged = () => {
  if (!enabled || !authToken) return
  if (notifyTimer) clearTimeout(notifyTimer)
  notifyTimer = setTimeout(() => { notifyTimer = null; runSyncOnce() }, 600)
}

const runSyncOnce = async () => {
  if (running) return
  running = true
  try {
    await loadMcpServerConfig()
    await pushDueReviewPlans()
    await pullCompletionStatus()
    await cleanupDuplicateCalendarTasks()
    await deleteRemovedReviewPlans()
  } catch (e) {
    // 日历未启动/未连接时静默，等待下个轮询周期
  } finally {
    running = false
  }
}

const deleteRemovedReviewPlans = async () => {
  const currentIds = new Set(getReviewPlan().map(i => i.id))
  const removedKeys = Object.keys(lastTaskMap).filter(key => !currentIds.has(key.split('::')[0]))
  if (!removedKeys.length) return
  for (const key of removedKeys) {
    const calendarId = lastTaskMap[key]
    try { await toolsCall('delete_task', { id: calendarId }) } catch (e) {}
    delete lastTaskMap[key]
  }
  saveConfig()
}

const buildReviewItems = () => {
  return getReviewPlan()
}

const pushDueReviewPlans = async () => {
  const items = buildReviewItems()
  if (!items.length) return
  // 拉取日历已有任务，建立「日期::归一化标题」→ 任务对象 映射，
  // 用于去重、补齐 lastTaskMap（已有任务也能同步状态）、并回写完成状态。
  let calendarByKey = new Map()
  let calendarById = new Map()
  try {
    const data = await toolsCall('query_tasks', { range: 'all' })
    for (const t of Array.isArray(data?.tasks) ? data.tasks : []) {
      if (!t?.id || !t?.date || !t?.title) continue
      const key = `${t.date}::${normalizeReviewTitle(t.title)}`
      calendarByKey.set(key, t)
      calendarById.set(t.id, t)
    }
  } catch (e) {
    // 查询失败时回退为仅按本地映射去重
  }
  // 同步所有复习周期（含过去、未来、已完成），把任务与状态全部推送到日历。
  const tasksToAdd = []
  const tasksToUpdate = []
  for (const item of items) {
    for (const c of item.cycles || []) {
      const key = `${item.id}::${c.cycle}`
      const title = `${REVIEW_TITLE_PREFIX}${item.nodeText || item.fileName || '复习任务'}`
      const calKey = `${c.reviewDate}::${normalizeReviewTitle(title)}`
      const existing = calendarByKey.get(calKey)
      if (existing) {
        lastTaskMap[key] = existing.id
        tasksToUpdate.push({ key, calendarId: existing.id, completed: !!c.completed, existingCompleted: !!existing.isCompleted })
        continue
      }
      if (lastTaskMap[key]) {
        const mapped = calendarById.get(lastTaskMap[key])
        if (mapped) {
          tasksToUpdate.push({ key, calendarId: mapped.id, completed: !!c.completed, existingCompleted: !!mapped.isCompleted })
          continue
        }
      }
      tasksToAdd.push({ key, date: c.reviewDate, title, completed: !!c.completed })
    }
  }
  let added = 0
  let failed = 0
  for (const t of tasksToAdd.slice(0, 500)) {
    try {
      const created = await toolsCall('add_task', { title: t.title, date: t.date, isImportant: false })
      if (created && created.id) {
        lastTaskMap[t.key] = created.id
        added++
        if (t.completed) {
          try { await toolsCall('complete_task', { id: created.id }) } catch (e) {}
        }
      }
    } catch (e) {
      failed++
    }
  }
  // 双向同步：my-mindmap agent 的完成状态 → desktop_todo_Calendar
  for (const u of tasksToUpdate) {
    try {
      if (u.completed !== u.existingCompleted) {
        if (u.completed) await toolsCall('complete_task', { id: u.calendarId })
        else await toolsCall('uncomplete_task', { id: u.calendarId })
      }
    } catch (e) {}
  }
  saveConfig()
  if (tasksToAdd.length > 0 && added === 0 && failed > 0) {
    throw new Error('无法连接 desktop_todo_Calendar 或 Token 无效，请确认日历已运行并检查 Token')
  }
}

const cleanupDuplicateCalendarTasks = async () => {
  const data = await toolsCall('query_tasks', { range: 'all' })
  const tasks = Array.isArray(data?.tasks) ? data.tasks : []
  const groups = new Map()
  for (const t of tasks) {
    if (!t?.id || !t?.date || !t?.title) continue
    const base = normalizeReviewTitle(t.title)
    const hasPrefix = t.title.startsWith(REVIEW_TITLE_PREFIX) || t.title.startsWith(LEGACY_REVIEW_TITLE_PREFIX)
    if (!hasPrefix && !t.title.includes('复习')) continue
    const key = `${t.date}::${base}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  for (const items of groups.values()) {
    if (items.length <= 1) continue
    // 只清理「同一天、去掉复习前缀后内容相同」且至少一条带我们前缀的任务
    if (!items.some(t => t.title.startsWith(REVIEW_TITLE_PREFIX) || t.title.startsWith(LEGACY_REVIEW_TITLE_PREFIX))) continue
    // 优先保留 [MM复习]，其次 [复习]，再按创建时间最早
    const rank = (t) => {
      if (t.title.startsWith(REVIEW_TITLE_PREFIX)) return 0
      if (t.title.startsWith(LEGACY_REVIEW_TITLE_PREFIX)) return 1
      return 2
    }
    items.sort((a, b) => rank(a) - rank(b) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    const keep = items[0]
    for (const t of items.slice(1)) {
      try { await toolsCall('delete_task', { id: t.id }) } catch (e) {}
    }
    // 若保留下来的不是 [MM复习]，更新其标题为 [MM复习] 前缀，统一后续识别
    if (keep && !keep.title.startsWith(REVIEW_TITLE_PREFIX)) {
      try { await toolsCall('update_task', { id: keep.id, title: `${REVIEW_TITLE_PREFIX}${normalizeReviewTitle(keep.title)}` }) } catch (e) {}
    }
  }
}

const pullCompletionStatus = async () => {
  const entries = Object.entries(lastTaskMap)
  if (!entries.length) return
  const data = await toolsCall('query_tasks', { range: 'all' })
  const tasks = Array.isArray(data?.tasks) ? data.tasks : []
  const byId = new Map(tasks.map(t => [t.id, t]))
  for (const [key, calendarId] of entries) {
    const t = byId.get(calendarId)
    if (!t) continue
    const [itemId, cycleStr] = key.split('::')
    const cycle = Number(cycleStr)
    const item = getReviewPlan().find(i => i.id === itemId)
    if (!item) continue
    const c = (item.cycles || []).find(x => x.cycle === cycle)
    if (!c) continue
    if (t.isCompleted && !c.completed) markCycleCompleted(itemId, cycle)
    else if (!t.isCompleted && c.completed) markCycleUncompleted(itemId, cycle)
  }
}
