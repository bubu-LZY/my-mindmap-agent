/**
 * AI 定时任务调度器 IPC 模块
 * 使用 Windows Task Scheduler (schtasks.exe) 创建和管理定时 AI 任务
 *
 * 任务流程：
 * 1. 用户在前端创建定时任务（包含 AI 提示词、执行周期等）
 * 2. 本模块通过 schtasks.exe 在 Windows 计划任务中注册定时任务
 * 3. 到达触发时间时，Windows 启动应用并传入 --scheduled-task=<taskId> 参数
 * 4. main.js 检测到该参数后，通过 IPC 向渲染进程发送 task:scheduledTrigger 事件
 * 5. 渲染进程收到事件后，取出对应任务的 AI 提示词并发送给 AI 对话面板
 */

const { ipcMain } = require('electron')
const { execFile } = require('child_process')
const path = require('path')
const store = require('../utils/store')

// ============ 常量 ============

// Windows Task Scheduler 可执行文件路径
const SCHTASKS_EXE = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'schtasks.exe'
)

// 任务名称前缀，用于区分本应用创建的计划任务
const TASK_PREFIX = 'MindMapAI_'

// electron-store 中存储任务元数据的键名
const STORE_KEY = 'scheduled_tasks'

// ============ 工具函数 ============

/**
 * 解析日期时间字符串为 schtasks 所需的格式
 * @param {string} dtStr - 日期时间字符串，格式 "YYYY-MM-DD HH:mm"
 * @returns {{ date: string, time: string, day: number } | null}
 *   date: "YYYY/MM/DD" 格式（schtasks /sd 参数）
 *   time: "HH:mm" 格式（schtasks /st 参数）
 *   day: 日期中的天数（用于 monthly 周期）
 */
function parseDateTime(dtStr) {
  if (!dtStr) return null
  // 兼容 datetime-local 的 "YYYY-MM-DDTHH:mm" 格式
  const normalized = String(dtStr).replace('T', ' ')
  const m = normalized.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/)
  if (!m) return null
  return {
    date: `${m[1]}/${m[2]}/${m[3]}`,
    time: `${m[4]}:${m[5]}`,
    day: parseInt(m[3], 10)
  }
}

/**
 * 生成唯一任务 ID
 * 格式：时间戳 + 随机字符串，确保全局唯一
 */
function generateTaskId() {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`
}

// 任务 ID 白名单：generateTaskId 产物天然满足；校验防止渲染层被攻破后
// 通过 taskId 携带引号等字符注入 schtasks /tr 参数执行任意命令
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

// 项目根目录（dev 模式下触发命令需要附加应用路径）
const APP_ROOT = path.resolve(__dirname, '..', '..')

// schtasks 统一执行选项：超时防止进程挂起导致 IPC 永久阻塞（按钮永远停在"创建中..."）
const EXEC_OPTS = { windowsHide: true, timeout: 15000 }
const QUERY_OPTS = { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 * 10 }

/**
 * 提取 schtasks 报错中有用的信息（err.message 首行是命令行，无诊断价值）
 */
function briefExecError(err) {
  const raw = ((err && err.stderr) || (err && err.message) || String(err)).toString()
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const useful = lines.find(l => !l.startsWith('Command failed:')) || lines[0] || 'schtasks 执行失败'
  return useful.slice(0, 200)
}

function isValidTaskId(taskId) {
  return typeof taskId === 'string' && TASK_ID_RE.test(taskId)
}

/**
 * 从 electron-store 获取所有任务元数据
 * @returns {Object} 以 taskId 为键的任务元数据对象
 */
function getAllStoredTasks() {
  try {
    return store.get(STORE_KEY) || {}
  } catch {
    return {}
  }
}

/**
 * 将任务元数据保存到 electron-store
 * @param {Object} tasks - 以 taskId 为键的任务元数据对象
 */
function saveAllStoredTasks(tasks) {
  store.set(STORE_KEY, tasks)
}

/**
 * 存储单个任务的元数据
 * @param {Object} task - 任务对象 { taskId, name, prompt, datetime, cycle, enabled }
 */
function storeTaskMetadata(task) {
  const tasks = getAllStoredTasks()
  tasks[task.taskId] = {
    taskId: task.taskId,
    name: task.name,
    prompt: task.prompt,
    datetime: task.datetime,
    cycle: task.cycle,
    enabled: task.enabled !== false,
    createdAt: tasks[task.taskId]?.createdAt || Date.now(),
    updatedAt: Date.now()
  }
  saveAllStoredTasks(tasks)
}

/**
 * 删除单个任务的元数据
 * @param {string} taskId - 任务 ID
 */
function removeTaskMetadata(taskId) {
  const tasks = getAllStoredTasks()
  delete tasks[taskId]
  saveAllStoredTasks(tasks)
}

// ============ Windows Task Scheduler 操作 ============

/**
 * 调用 schtasks.exe 创建计划任务
 * @param {Object} task - 任务对象 { taskId, name, prompt, datetime, cycle, enabled }
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
function createScheduledTask(task) {
  return new Promise(resolve => {
    if (!isValidTaskId(task.taskId)) {
      resolve({ success: false, error: '无效的任务 ID（仅允许字母、数字、下划线、连字符）' })
      return
    }
    const dt = parseDateTime(task.datetime)
    if (!dt) {
      resolve({ success: false, error: '无效的日期时间格式: ' + task.datetime })
      return
    }

    // 一次性任务如果触发时间已经过去，直接拒绝创建系统任务。
    // Windows 对“过去时间”的 once 任务会在创建后立即补触发，表现为用户没到点却莫名执行。
    if (task.cycle === 'once') {
      const [y, m, d] = dt.date.split('/').map(Number)
      const [hh, mm] = dt.time.split(':').map(Number)
      const triggerTime = new Date(y, m - 1, d, hh, mm, 0, 0)
      if (triggerTime.getTime() <= Date.now()) {
        resolve({
          success: false,
          error: '一次性任务的触发时间已过去，请重新选择未来时间后再创建/保存'
        })
        return
      }
    }

    // 如果任务被禁用，不创建计划任务，但元数据必须保留（否则禁用=任务消失）
    if (task.enabled === false) {
      try {
        storeTaskMetadata(task)
      } catch (e) {
        resolve({ success: false, error: '任务元数据保存失败: ' + e.message })
        return
      }
      resolve({ success: true, skipped: true })
      return
    }

    const taskName = TASK_PREFIX + task.taskId
    const exePath = process.execPath
    // dev 模式（electron . 启动）下 execPath 是裸 electron.exe，必须附加项目根路径，
    // 否则定时触发时启动的是 Electron 默认应用而非本项目
    const trigger = process.defaultApp
      ? `"${exePath}" "${APP_ROOT}" --scheduled-task=${task.taskId}`
      : `"${exePath}" --scheduled-task=${task.taskId}`

    // 基础参数：/create 创建，/f 强制覆盖同名任务
    const args = ['/create', '/tn', taskName, '/tr', trigger, '/f']

    // 根据周期设置计划类型和触发参数
    switch (task.cycle) {
      case 'daily':
        args.push('/sc', 'daily', '/st', dt.time, '/sd', dt.date)
        break
      case 'weekly':
        // weekly: 每周指定时间执行，/d * 表示每天（相当于 daily 的周版本）
        args.push('/sc', 'weekly', '/st', dt.time, '/sd', dt.date, '/d', 'MON')
        break
      case 'monthly':
        // monthly: 每月指定日期和时间执行
        args.push('/sc', 'monthly', '/st', dt.time, '/sd', dt.date, '/d', String(dt.day))
        break
      default:
        // once: 仅执行一次
        args.push('/sc', 'once', '/st', dt.time, '/sd', dt.date)
    }

    execFile(SCHTASKS_EXE, args, EXEC_OPTS, (err) => {
      if (err) {
        resolve({ success: false, error: briefExecError(err) })
        return
      }
      // 系统任务创建成功后存储元数据；写盘失败也必须 resolve，
      // 否则 IPC 永久挂起、前端按钮永远停在"创建中..."
      try {
        storeTaskMetadata(task)
      } catch (e) {
        resolve({ success: false, error: '任务元数据保存失败: ' + e.message })
        return
      }
      resolve({ success: true })
    })
  })
}

/**
 * 仅删除 Windows 计划任务，不动本地元数据
 * 用于"先删后建"的更新/同步流程：创建失败时元数据仍保留，任务不会凭空消失
 * @param {string} taskId - 任务 ID
 * @returns {Promise<boolean>} schtasks 是否执行成功（任务不存在视为成功）
 */
function removeSystemTask(taskId) {
  return new Promise(resolve => {
    if (!isValidTaskId(taskId)) {
      resolve(false)
      return
    }
    execFile(
      SCHTASKS_EXE,
      ['/delete', '/tn', TASK_PREFIX + taskId, '/f'],
      EXEC_OPTS,
      (err) => resolve(!err)
    )
  })
}

/**
 * 调用 schtasks.exe 删除计划任务
 * @param {string} taskId - 任务 ID
 * @returns {Promise<{ success: boolean }>}
 */
async function deleteScheduledTask(taskId) {
  if (!isValidTaskId(taskId)) {
    // 非法 ID 一律拒绝执行 schtasks，防止命令注入；同时清理可能残留的元数据
    try {
      removeTaskMetadata(taskId)
    } catch {}
    return { success: false, error: '无效的任务 ID' }
  }
  // 删除系统计划任务（任务不存在不算失败）
  await removeSystemTask(taskId)
  // 删除本地元数据；写盘异常必须返回而非抛出，保证 IPC 一定有响应
  try {
    removeTaskMetadata(taskId)
  } catch (e) {
    return { success: false, error: '任务元数据删除失败: ' + e.message }
  }
  return { success: true }
}

/**
 * 更新计划任务（先删除系统任务再创建，元数据在创建成功后才覆盖）
 * @param {Object} task - 更新后的任务对象
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function updateScheduledTask(task) {
  // 仅移除系统任务、保留元数据：创建失败时旧配置仍保留在列表中，任务不会凭空消失
  await removeSystemTask(task.taskId)
  return createScheduledTask(task)
}

/**
 * 列出 Task Scheduler 中所有 MindMapAI_ 前缀的任务
 * @returns {Promise<string[]>} 任务 ID 列表（已去除前缀）
 */
function listScheduledTasks() {
  return new Promise(resolve => {
    execFile(
      SCHTASKS_EXE,
      ['/query', '/fo', 'csv', '/nh'],
      QUERY_OPTS,
      (err, stdout) => {
        if (err) {
          resolve([])
          return
        }
        // 解析 CSV 输出，筛选出本应用创建的任务
        const tasks = stdout
          .split('\n')
          .filter(line => line.includes(TASK_PREFIX))
          .map(line => {
            const m = line.match(/"?(MindMapAI_[^",]+)"?/)
            return m ? m[1].substring(TASK_PREFIX.length) : null
          })
          .filter(Boolean)
        resolve(tasks)
      }
    )
  })
}

/**
 * 同步存储的任务与 Task Scheduler 中的任务
 * - 删除 Task Scheduler 中存在但本地存储中不存在的孤立任务
 * - 创建本地存储中存在但 Task Scheduler 中缺失的任务
 * @param {Array} tasks - 本地存储的任务列表
 * @returns {Promise<{ success: boolean, synced: number, created: number, deleted: number }>}
 */
async function syncAllTasks(tasks) {
  const existingIds = await listScheduledTasks()
  const localIds = tasks.map(t => t.taskId)

  let deletedCount = 0
  let createdCount = 0
  const failures = []

  // 删除孤立的计划任务（Task Scheduler 中有但本地没有）
  for (const id of existingIds) {
    if (!localIds.includes(id)) {
      await removeSystemTask(id)
      deletedCount++
    }
  }

  // 创建或更新本地存储的任务
  for (const task of tasks) {
    if (task.enabled !== false && task.datetime) {
      // 仅删除系统任务（保留元数据），再创建新任务；
      // 创建失败时元数据仍在，任务不会从列表消失
      await removeSystemTask(task.taskId)
      const result = await createScheduledTask(task)
      if (result.success && !result.skipped) {
        createdCount++
      } else if (!result.success) {
        failures.push(`「${task.name}」: ${result.error || '创建失败'}`)
      }
    } else {
      // 禁用的任务从 Task Scheduler 中删除（元数据保留）
      await removeSystemTask(task.taskId)
    }
  }

  // 任一任务创建失败都如实报告，不再假报"同步完成"
  if (failures.length > 0) {
    return {
      success: false,
      synced: tasks.length,
      created: createdCount,
      deleted: deletedCount,
      failed: failures.length,
      error: failures.join('；').slice(0, 300)
    }
  }
  return {
    success: true,
    synced: tasks.length,
    created: createdCount,
    deleted: deletedCount,
    failed: 0
  }
}

// ============ IPC 事件注册 ============

function registerTaskSchedulerIpc() {
  /**
   * 创建定时任务
   * @param {Object} task - { taskId, name, prompt, datetime, cycle, enabled }
   */
  ipcMain.handle('task:create', async (event, task) => {
    if (!task || typeof task !== 'object') {
      return { success: false, error: '无效的任务参数' }
    }
    // 如果没有提供 taskId，自动生成
    if (!task.taskId) {
      task.taskId = generateTaskId()
    }
    return createScheduledTask(task)
  })

  /**
   * 删除定时任务
   * @param {string} taskId - 要删除的任务 ID
   */
  ipcMain.handle('task:delete', async (event, taskId) => {
    return deleteScheduledTask(taskId)
  })

  /**
   * 更新定时任务（先删后建）
   * @param {Object} task - 更新后的任务对象
   */
  ipcMain.handle('task:update', async (event, task) => {
    return updateScheduledTask(task)
  })

  /**
   * 列出 Task Scheduler 中所有本应用的任务
   * 返回任务 ID 列表
   */
  ipcMain.handle('task:list', async () => {
    return listScheduledTasks()
  })

  /**
   * 获取 electron-store 中存储的所有任务元数据
   * 返回以 taskId 为键的对象
   */
  ipcMain.handle('task:getAll', async () => {
    return getAllStoredTasks()
  })

  /**
   * 同步本地存储与 Task Scheduler
   * @param {Array} tasks - 本地任务列表
   */
  ipcMain.handle('task:syncAll', async (event, tasks) => {
    return syncAllTasks(tasks || [])
  })
}

// ============ 命令行参数处理 ============

/**
 * 检查命令行参数中是否包含 --scheduled-task 标志
 * 支持 --scheduled-task=<taskId> 和 --scheduled-task <taskId> 两种格式
 * @returns {string | null} 任务 ID（如果找到），否则返回 null
 */
function handleScheduledTaskArgs() {
  // 优先检查 --scheduled-task=<taskId> 格式
  const eqArg = process.argv.find(arg => arg.startsWith('--scheduled-task='))
  if (eqArg) {
    return eqArg.split('=')[1]
  }

  // 再检查 --scheduled-task <taskId> 格式
  const idx = process.argv.indexOf('--scheduled-task')
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1]
  }

  return null
}

// ============ 模块导出 ============

module.exports = {
  registerTaskSchedulerIpc,
  handleScheduledTaskArgs,
  // 导出内部函数供测试或其他模块使用
  createScheduledTask,
  deleteScheduledTask,
  removeSystemTask,
  updateScheduledTask,
  listScheduledTasks,
  syncAllTasks,
  getAllStoredTasks,
  parseDateTime,
  generateTaskId,
  TASK_PREFIX
}

// 自动注册 IPC 事件
registerTaskSchedulerIpc()
