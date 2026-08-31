/**
 * 艾宾浩斯遗忘曲线复习计划管理
 * 5 个记忆周期：1天、3天、7天、15天、31天（适配工作节奏的低频复习方案）
 */

const REVIEW_KEY = 'MINDMAP_REVIEW_PLAN'
const REMINDER_KEY = 'MINDMAP_REVIEW_REMINDER'

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
  const div = document.createElement('div')
  div.innerHTML = html
  return (div.innerText || div.textContent || '').trim()
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
  const needs = CYCLES.some(c => !item.cycles.find(o => o.cycle === c.cycle && o.label === c.label))
  if (!needs) return item
  const start = item.createdDateTs || Date.now()
  item.cycles = CYCLES.map(c => {
    const old = item.cycles.find(o => o.label === c.label)
    const ts = start + c.ms
    return {
      cycle: c.cycle,
      label: c.label,
      reviewDate: formatDate(ts),
      reviewDateTs: ts,
      completed: old ? !!old.completed : false,
      completedDate: old && old.completed ? (old.completedDate || null) : null
    }
  })
  return item
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

// 保存复习计划
function saveReviewPlan(list) {
  try {
    localStorage.setItem(REVIEW_KEY, JSON.stringify(list))
    return true
  } catch (e) {
    console.error('[复习计划] 保存失败:', e)
    return false
  }
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
      completedDate: null
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
  return item
}

// 按 ID 移除
export function removeById(id) {
  const list = getReviewPlan().filter(item => item.id !== id)
  saveReviewPlan(list)
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
  if (removed > 0) saveReviewPlan(remaining)
  return removed
}

// 按节点 uid 删除复习计划项，返回删除数量
export function removeByNodeUid(nodeUid) {
  if (!nodeUid) return 0
  const list = getReviewPlan()
  const remaining = list.filter(item => item.nodeUid !== nodeUid)
  const removed = list.length - remaining.length
  if (removed > 0) saveReviewPlan(remaining)
  return removed
}

// 清空全部复习计划，返回删除数量
export function clearReviewPlan() {
  const list = getReviewPlan()
  if (list.length > 0) saveReviewPlan([])
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

// 标记某个复习周期为已完成
export function markCycleCompleted(id, cycleNum) {
  const list = getReviewPlan()
  const item = list.find(i => i.id === id)
  if (item) {
    const c = item.cycles.find(c => c.cycle === cycleNum)
    if (c) {
      c.completed = true
      c.completedDate = formatDate(Date.now())
    }
  }
  saveReviewPlan(list)
}

// 标记某个复习周期为未完成
export function markCycleUncompleted(id, cycleNum) {
  const list = getReviewPlan()
  const item = list.find(i => i.id === id)
  if (item) {
    const c = item.cycles.find(c => c.cycle === cycleNum)
    if (c) {
      c.completed = false
      c.completedDate = null
    }
  }
  saveReviewPlan(list)
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
