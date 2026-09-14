/**
 * 艾宾浩斯遗忘曲线复习计划管理
 * 5 个记忆周期：1天、3天、7天、15天、31天（适配工作节奏的低频复习方案）
 */

import { textFromHtmlInert } from './inertDom'
import { shrinkLogsForStorage } from './logStore'

const REVIEW_KEY = 'MINDMAP_REVIEW_PLAN'
const REMINDER_KEY = 'MINDMAP_REVIEW_REMINDER'

// 通知同步服务：复习计划发生变化（添加/删除/勾选/取消勾选）
// detail 用于区分变更类型：{ type: 'toggle', itemId, cycle } 表示单条勾选，同步服务只需同步这一条；
// 其余（新增/删除/改期）不带 type，由同步服务走防抖后的全量同步。
const notifyReviewPlanChanged = (detail) => {
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('review-plan-changed', { detail: detail || null }))
    }
  } catch { /* 忽略 */ }
}

// 复习计划写盘失败时广播：存储配额不足/存储不可用时，调用方无法把失败反馈给用户，
// 由 UI（复习面板）监听后明确提示，避免「勾了像没勾、数据其实丢了」。
const notifyReviewPlanSaveFailed = () => {
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('review-plan-save-failed'))
    }
  } catch { /* 忽略 */ }
}

// 每日复习提醒配置：{ enabled, time: 'HH:mm', feishu: bool, wechat: bool }
export function getReminderConfig() {
  try {
    const raw = localStorage.getItem(REMINDER_KEY)
    const cfg = raw ? JSON.parse(raw) : null
    if (cfg && typeof cfg === 'object') {
      return {
        enabled: cfg.enabled !== false,
        time: /^\d{2}:\d{2}$/.test(String(cfg.time)) ? cfg.time : '09:00',
        feishu: !!cfg.feishu,
        wechat: !!cfg.wechat
      }
    }
  } catch { /* 损坏数据回退默认 */ }
  return { enabled: false, time: '09:00', feishu: false, wechat: false }
}

export function saveReminderConfig(cfg) {
  try {
    localStorage.setItem(REMINDER_KEY, JSON.stringify({
      enabled: !!(cfg && cfg.enabled),
      time: /^\d{2}:\d{2}$/.test(String(cfg?.time)) ? cfg.time : '09:00',
      feishu: !!(cfg && cfg.feishu),
      wechat: !!(cfg && cfg.wechat)
    }))
    return true
  } catch {
    return false
  }
}

// 5 个记忆周期（毫秒）
export const CYCLES = [
  { cycle: 1, label: '1天', ms: 1 * 24 * 60 * 60 * 1000 },
  { cycle: 2, label: '3天', ms: 3 * 24 * 60 * 60 * 1000 },
  { cycle: 3, label: '7天', ms: 7 * 24 * 60 * 60 * 1000 },
  { cycle: 4, label: '15天', ms: 15 * 24 * 60 * 60 * 1000 },
  { cycle: 5, label: '31天', ms: 31 * 24 * 60 * 60 * 1000 }
]

// 日期格式化为 YYYY-MM-DD
export function formatDate(date) {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + day
}

// 获取今天日期字符串
export function getToday() {
  return formatDate(new Date())
}

// 生成唯一 ID
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

// 去除 HTML 标签，提取纯文本
export function stripHtmlTags(html) {
  if (!html || typeof html !== 'string') return ''
  if (!html.includes('<')) return html.trim()
  return textFromHtmlInert(html).trim()
}

// 从节点实例提取纯文本
// simple-mind-map 的 Node 实例数据在 nodeData 上（无 .data 属性），必须走 getData()
export function extractNodeText(node) {
  if (!node) return ''
  let text = ''
  if (typeof node.getData === 'function') {
    text = node.getData('text')
  }
  if (!text) {
    text = node.nodeData?.text ?? node.data?.text ?? node.text ?? ''
  }
  return stripHtmlTags(text)
}

// 旧周期数据（9周期）迁移到新周期（5周期）：按 label 匹配保留完成状态，复习时间从创建时间重算
function migrateItem(item) {
  if (!item || !Array.isArray(item.cycles)) return item
  // 补齐状态变更时间戳：老数据没有该字段，用完成日期兜底（无法还原精确时刻，取当天 0 点），
  // 未完成的老周期记为 0，表示"很久没变过"，在同步仲裁中必然输给带时间戳的一端。
  item.cycles.forEach(c => {
    if (typeof c.statusUpdatedAt !== 'number' || !isFinite(c.statusUpdatedAt) || c.statusUpdatedAt <= 0) {
      c.statusUpdatedAt = c.completed && c.completedDate ? (parseDateMs(c.completedDate) || 0) : 0
    }
  })
  // 已被用户在日历里删掉的周期不再补回来，否则「删除」是删不掉的（下一轮读取就复活）
  const skipped = new Set(Array.isArray(item.skippedCycles) ? item.skippedCycles : [])
  const wanted = CYCLES.filter(c => !skipped.has(c.cycle))
  const needs = wanted.some(c => !item.cycles.find(o => o.cycle === c.cycle && o.label === c.label))
  if (!needs) return item
  const start = item.createdDateTs || Date.now()
  item.cycles = wanted.map(c => {
    const old = item.cycles.find(o => o.label === c.label)
    const ts = start + c.ms
    return {
      cycle: c.cycle,
      label: c.label,
      reviewDate: formatDate(ts),
      reviewDateTs: ts,
      completed: old ? !!old.completed : false,
      completedDate: old && old.completed ? (old.completedDate || null) : null,
      statusUpdatedAt: old ? (old.statusUpdatedAt || 0) : 0
    }
  })
  return item
}

// 'YYYY-MM-DD' → 当天 00:00 的毫秒时间戳（仅用于老数据兜底）
function parseDateMs(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim())
  if (!m) return 0
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  return isFinite(t) ? t : 0
}

// 获取所有复习计划
export function getReviewPlan() {
  try {
    const data = localStorage.getItem(REVIEW_KEY)
    const list = data ? JSON.parse(data) : []
    if (!Array.isArray(list)) return []
    return list.map(migrateItem)
  } catch {
    return []
  }
}

/**
 * 保存复习计划。
 *
 * 不能只 try/catch 后返回 false —— 调用方全都忽略返回值，存储写不进去时
 * 用户勾选会「看起来成功、实际丢失」，同步服务随后还会把旧状态推回日历。
 * 因此分级处理：直接写 → 让日志（可重建的调试数据）让位后重试 → 仍失败就
 * 广播事件让 UI 明确提示用户。
 */
function saveReviewPlan(list) {
  let payload = ''
  try {
    payload = JSON.stringify(list)
  } catch (e) {
    console.error('[复习计划] 序列化失败:', e)
    notifyReviewPlanSaveFailed()
    return false
  }
  const write = () => {
    try {
      localStorage.setItem(REVIEW_KEY, payload)
      return true
    } catch (e) {
      return false
    }
  }
  if (write()) return true
  // 配额不足：日志是可重建的调试数据，复习计划不是——先给日志瘦身再重试一次
  try { shrinkLogsForStorage() } catch (e) { /* 忽略 */ }
  if (write()) return true
  console.error('[复习计划] 保存失败：本地存储空间不足或被禁用，本次修改可能丢失')
  notifyReviewPlanSaveFailed()
  return false
}

// 计算从当前时间开始的 5 个复习日期
export function calculateReviewDates(startTime = Date.now()) {
  return CYCLES.map(c => {
    const reviewTime = startTime + c.ms
    return {
      cycle: c.cycle,
      label: c.label,
      reviewDate: formatDate(reviewTime),
      reviewDateTs: reviewTime,
      completed: false,
      completedDate: null,
      statusUpdatedAt: 0
    }
  })
}

// 添加节点到复习计划
export function addToReviewPlan(nodeData) {
  const list = getReviewPlan()
  const startTime = Date.now()
  const cycles = calculateReviewDates(startTime)

  const item = {
    id: genId(),
    nodeUid: nodeData.nodeUid || '',
    nodeText: nodeData.nodeText || '',
    parentText: nodeData.parentText || '',
    filePath: nodeData.filePath || '',
    fileName: nodeData.fileName || '',
    createdDate: formatDate(startTime),
    createdDateTs: startTime,
    cycles: cycles
  }

  list.push(item)
  saveReviewPlan(list)
  notifyReviewPlanChanged()
  return item
}

// 去掉标题前缀（[MM复习] / [复习]），与日历同步配对用的规范化保持一致
const stripReviewPrefix = (title) => {
  let t = String(title || '').trim()
  if (t.startsWith('[MM复习]')) t = t.slice('[MM复习]'.length).trim()
  else if (t.startsWith('[复习]')) t = t.slice('[复习]'.length).trim()
  return t
}

/**
 * 删除某个复习周期（用「日期 + 标题」定位），供桌面日历回写「用户在日历里删掉了这条复习任务」。
 *
 * 定位用的键与两端同步配对完全一致（日期 + 去前缀标题），所以两边对「同一条复习任务」的
 * 理解始终一致。一个复习项的所有周期都被删完时，整条复习项也一并移除——只留一个没有周期的
 * 空壳，复习面板里会显示成一条永远不会出现的待办。
 *
 * @returns {number} 实际删除的周期数（0 表示没有匹配到）
 */
export function removeCyclesByDateAndTitle(dateText, title) {
  const date = String(dateText || '').trim()
  const base = stripReviewPrefix(title)
  if (!date || !base) return 0

  const list = getReviewPlan()
  const next = []
  let removed = 0
  for (const item of list) {
    if (stripReviewPrefix(item.nodeText || item.fileName || '') !== base) {
      next.push(item)
      continue
    }
    const cycles = Array.isArray(item.cycles) ? item.cycles : []
    const gone = cycles.filter(c => (c.reviewDate || formatDate(c.reviewDateTs)) === date)
    if (!gone.length) {
      next.push(item)
      continue
    }

    removed += gone.length
    const kept = cycles.filter(c => !gone.includes(c))
    if (kept.length === 0) {
      // 所有周期都被删完：整条复习项一并移除，否则会剩一个永远没有待办的空壳
      continue
    }

    // 关键：把删掉的周期号记下来。复习计划有个「按 5 个标准周期补齐」的迁移逻辑，
    // 不记这一笔的话，下一轮读取就会把刚删掉的周期原样重建出来（现象就是「删不掉」）。
    const skipped = new Set(Array.isArray(item.skippedCycles) ? item.skippedCycles : [])
    gone.forEach(c => skipped.add(c.cycle))
    item.skippedCycles = Array.from(skipped).sort((a, b) => a - b)
    item.cycles = kept
    next.push(item)
  }

  if (removed > 0) {
    saveReviewPlan(next)
    // type='remote'：这是日历端发起的删除，同步服务收到后不再反向触发一次推送，避免两端来回触发
    notifyReviewPlanChanged({ type: 'remote' })
  }
  return removed
}

// 按 ID 移除
export function removeById(id) {
  const list = getReviewPlan().filter(item => item.id !== id)
  saveReviewPlan(list)
  notifyReviewPlanChanged()
}

// 统一路径分隔符为 /，便于跨平台比较
function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/')
}

// 获取某个文件路径下的所有复习计划项
export function getReviewItemsByFilePath(filePath) {
  if (!filePath) return []
  const target = normalizePath(filePath)
  return getReviewPlan().filter(item => normalizePath(item.filePath) === target)
}

/**
 * 路径重映射：文件/目录被移动或重命名后，同步复习计划中的 filePath
 * oldPath 可以是文件或目录（目录时同步其下所有文件的条目），返回更新条数
 * 路径比较不区分大小写（Windows 文件系统语义），但保留条目原始大小写重建路径
 */
export function remapReviewPaths(oldPath, newPath) {
  if (!oldPath || !newPath) return 0
  const norm = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '')
  const o = norm(oldPath)
  const n = norm(newPath)
  if (!o || !n || o.toLowerCase() === n.toLowerCase()) return 0
  const lo = o.toLowerCase()
  const list = getReviewPlan()
  let changed = 0
  list.forEach(item => {
    const fp = norm(item.filePath || '')
    // 大小写折叠可能改变个别字符长度（如土耳其 İ），长度不一致时跳过前缀匹配防错位
    const lfp = fp.toLowerCase()
    const lenAligned = lfp.length === fp.length && lo.length === o.length
    let next = null
    if (lfp === lo) {
      next = n
    } else if (lenAligned && lfp.startsWith(lo + '/')) {
      next = n + fp.slice(o.length)
    }
    if (next) {
      item.filePath = next
      item.fileName = next.split('/').pop() || item.fileName
      changed++
    }
  })
  if (changed > 0) saveReviewPlan(list)
  return changed
}

// 按文件路径删除复习计划项，返回删除数量
export function removeByFilePath(filePath) {
  if (!filePath) return 0
  const target = normalizePath(filePath)
  const list = getReviewPlan()
  const remaining = list.filter(item => normalizePath(item.filePath) !== target)
  const removed = list.length - remaining.length
  if (removed > 0) { saveReviewPlan(remaining); notifyReviewPlanChanged() }
  return removed
}

// 按节点 uid 删除复习计划项，返回删除数量
export function removeByNodeUid(nodeUid) {
  if (!nodeUid) return 0
  const list = getReviewPlan()
  const remaining = list.filter(item => item.nodeUid !== nodeUid)
  const removed = list.length - remaining.length
  if (removed > 0) { saveReviewPlan(remaining); notifyReviewPlanChanged() }
  return removed
}

// 清空全部复习计划，返回删除数量
export function clearReviewPlan() {
  const list = getReviewPlan()
  if (list.length > 0) { saveReviewPlan([]); notifyReviewPlanChanged() }
  return list.length
}

/**
 * 检测并清理文件已被删除（含应用未运行时外部删除）的孤儿复习计划项
 * 返回被清理的孤儿项信息数组（调用方据此提醒用户）
 */
export async function removeOrphanReviewItems() {
  const list = getReviewPlan()
  if (list.length === 0) return []
  const exists = window.electronAPI?.fs?.exists
  // 无文件系统能力时跳过检测（避免误删）
  if (typeof exists !== 'function') return []

  // 逐项异步检查文件是否存在，记录「判定为不存在」的项的稳定标识（nodeUid 优先）+ 当时旧路径
  const missing = new Map()
  for (const item of list) {
    const fp = item.filePath || ''
    if (!fp) continue
    let ok = true
    try {
      ok = await exists(fp)
    } catch (e) {
      ok = false
    }
    if (!ok) {
      const key = item.nodeUid || normalizePath(fp).toLowerCase()
      missing.set(key, normalizePath(fp).toLowerCase())
    }
  }
  if (missing.size === 0) return []

  // 写回前重读最新数据：若某项 filePath 已与判定时的旧路径不同（说明在异步窗口内被 remap 过），
  // 则视为文件被移动/重命名而非删除，保留之，避免竞态覆盖导致复习计划被误删。
  const latest = getReviewPlan()
  const orphans = []
  const remaining = []
  for (const item of latest) {
    const fp = item.filePath || ''
    if (!fp) {
      remaining.push(item)
      continue
    }
    const key = item.nodeUid || normalizePath(fp).toLowerCase()
    const stale = missing.get(key)
    if (stale && normalizePath(fp).toLowerCase() === stale) {
      orphans.push(item)
    } else {
      remaining.push(item)
    }
  }

  if (orphans.length > 0) {
    saveReviewPlan(remaining)
  }
  return orphans
}

// 检查节点是否已在复习计划中
export function isInReviewPlan(nodeUid) {
  return getReviewPlan().some(item => item.nodeUid === nodeUid)
}

// 获取指定日期的复习任务
export function getReviewItemsByDate(dateStr) {
  const list = getReviewPlan()
  const results = []
  list.forEach(item => {
    item.cycles.forEach(c => {
      if (formatDate(c.reviewDateTs) === dateStr) {
        results.push({
          ...item,
          currentCycle: c
        })
      }
    })
  })
  return results
}

// 获取今日复习任务
export function getTodayReviewItems() {
  return getReviewItemsByDate(getToday())
}

// 获取所有有复习任务的日期（去重排序）
export function getAllReviewDates() {
  const list = getReviewPlan()
  const dateSet = new Set()
  list.forEach(item => {
    item.cycles.forEach(c => {
      dateSet.add(formatDate(c.reviewDateTs))
    })
  })
  return Array.from(dateSet).sort()
}

// 标记某个复习周期为已完成（用户主动操作：写入当前时间为状态变更时间）
export function markCycleCompleted(id, cycleNum) {
  return writeCycleStatus(id, cycleNum, true, Date.now(), 'user')
}

// 标记某个复习周期为未完成（用户主动操作：写入当前时间为状态变更时间）
export function markCycleUncompleted(id, cycleNum) {
  return writeCycleStatus(id, cycleNum, false, Date.now(), 'user')
}

/**
 * 统一的状态写入：completed + 变更时间戳 + 完成日期
 * 用户勾选与同步回写都走这里，保证 statusUpdatedAt 永不缺失。
 */
function writeCycleStatus(id, cycleNum, completed, ts, source) {
  const list = getReviewPlan()
  const item = list.find(i => i.id === id)
  if (!item) return null
  const c = item.cycles.find(c => c.cycle === cycleNum)
  if (!c) return null
  const stamp = typeof ts === 'number' && isFinite(ts) && ts > 0 ? ts : Date.now()
  c.completed = !!completed
  c.completedDate = completed ? formatDate(stamp) : null
  // 单调保护：同步回写时若远端时间戳比本地旧，不回退本地时间戳，
  // 否则会出现"本地刚勾选 → 被远端旧状态覆盖时间戳 → 下次仲裁误判"。
  c.statusUpdatedAt = Math.max(stamp, Number(c.statusUpdatedAt) || 0)
  saveReviewPlan(list)
  // source='remote' 表示这次写入来自同步回写，同步服务收到后不再反向触发一次同步，避免来回触发。
  notifyReviewPlanChanged(
    source === 'remote'
      ? { type: 'remote', itemId: id, cycle: cycleNum }
      : { type: 'toggle', itemId: id, cycle: cycleNum }
  )
  return c
}

/**
 * 供同步服务回写：带上远端给出的时间戳做仲裁后写入。
 * 只在远端确实更新时才写（本地更新的话调用方不会调这个）。
 */
export function setCycleStatusFromRemote(id, cycleNum, completed, remoteTs) {
  return writeCycleStatus(id, cycleNum, completed, remoteTs, 'remote')
}

/**
 * 同步用的扁平快照：每个复习周期一条，携带状态时间戳。
 * 只暴露同步必需的字段，不泄漏整份计划数据。
 */
export function getReviewSyncEntries() {
  return getReviewPlan().flatMap(item =>
    (item.cycles || []).map(c => ({
      key: `${item.id}::${c.cycle}`,
      itemId: item.id,
      cycle: c.cycle,
      date: c.reviewDate || formatDate(c.reviewDateTs),
      title: item.nodeText || item.fileName || '',
      completed: !!c.completed,
      statusUpdatedAt: Number(c.statusUpdatedAt) || 0
    }))
  )
}

/**
 * 按 key（itemId::cycle）读取某个复习周期的当前状态与时间戳。
 */
export function getCycleStatusByKey(key) {
  const [id, cycleStr] = String(key || '').split('::')
  if (!id) return null
  const cycleNum = Number(cycleStr)
  const item = getReviewPlan().find(i => i.id === id)
  if (!item) return null
  const c = (item.cycles || []).find(x => x.cycle === cycleNum)
  if (!c) return null
  return {
    key,
    itemId: id,
    cycle: cycleNum,
    date: c.reviewDate || formatDate(c.reviewDateTs),
    title: item.nodeText || item.fileName || '',
    completed: !!c.completed,
    statusUpdatedAt: Number(c.statusUpdatedAt) || 0
  }
}

/**
 * 清除所有已完成的周期状态（复习总览的「清除所有已完成」）。
 * 统一走这里，避免调用方直接改字段导致 statusUpdatedAt 缺失、同步仲裁失准。
 */
export function clearAllCycleCompletion() {
  const list = getReviewPlan()
  const now = Date.now()
  let changed = 0
  list.forEach(item => {
    (item.cycles || []).forEach(c => {
      if (c.completed) {
        c.completed = false
        c.completedDate = null
        c.statusUpdatedAt = now
        changed++
      }
    })
  })
  if (changed > 0) {
    saveReviewPlan(list)
    notifyReviewPlanChanged()
  }
  return changed
}

// 获取复习计划统计
export function getReviewStats() {
  const list = getReviewPlan()
  const today = getToday()
  let todayTotal = 0
  let todayCompleted = 0
  let todayUncompleted = 0

  list.forEach(item => {
    item.cycles.forEach(c => {
      if (formatDate(c.reviewDateTs) === today) {
        todayTotal++
        if (c.completed) {
          todayCompleted++
        } else {
          todayUncompleted++
        }
      }
    })
  })

  return {
    total: list.length,
    todayTotal,
    todayCompleted,
    todayUncompleted
  }
}
