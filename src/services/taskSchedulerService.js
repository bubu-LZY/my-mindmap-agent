/**
 * AI 定时任务调度器服务
 * 封装 preload API，供 Vue 组件调用
 *
 * 使用方式：
 *   import { taskSchedulerService } from '../services/taskSchedulerService'
 *   await taskSchedulerService.create({ name, prompt, datetime, cycle, enabled })
 */

// 获取 Electron preload 暴露的 taskScheduler API
const getApi = () => window.electronAPI?.taskScheduler

export const taskSchedulerService = {
  /**
   * 检查定时任务 API 是否可用
   * 在浏览器模式（npm run dev）下不可用，需使用 npm run electron:dev
   * @returns {boolean}
   */
  isAvailable() {
    return !!getApi()
  },

  /**
   * 创建定时任务
   * @param {Object} task - 任务对象
   * @param {string} task.name - 任务名称
   * @param {string} task.prompt - AI 提示词
   * @param {string} task.datetime - 触发时间 "YYYY-MM-DD HH:mm"
   * @param {string} task.cycle - 周期: 'once' | 'daily' | 'weekly' | 'monthly'
   * @param {boolean} [task.enabled=true] - 是否启用
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async create(task) {
    return await getApi().create(task)
  },

  /**
   * 删除定时任务
   * @param {string} taskId - 任务 ID
   * @returns {Promise<{ success: boolean }>}
   */
  async delete(taskId) {
    return await getApi().delete(taskId)
  },

  /**
   * 更新定时任务
   * @param {Object} task - 更新后的任务对象（需包含 taskId）
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async update(task) {
    return await getApi().update(task)
  },

  /**
   * 列出 Windows Task Scheduler 中所有本应用的计划任务
   * @returns {Promise<string[]>} 任务 ID 列表
   */
  async list() {
    return await getApi().list()
  },

  /**
   * 获取 electron-store 中存储的所有任务元数据
   * @returns {Promise<Object>} 以 taskId 为键的任务元数据对象
   */
  async getAll() {
    return await getApi()?.getAll() || {}
  },

  /**
   * 同步本地存储与 Windows Task Scheduler
   * @param {Array} tasks - 本地任务列表
   * @returns {Promise<{ success: boolean, synced: number, created: number, deleted: number }>}
   */
  async syncAll(tasks) {
    // tasks 是 Vue 响应式 Proxy 数组（含不可克隆的 handler/内部符号），
    // 直接经 IPC 传给主进程会抛 "An object could not be cloned"。
    // 先深拷贝为纯 JSON 对象再调用。
    let plain
    try {
      plain = JSON.parse(JSON.stringify(Array.isArray(tasks) ? tasks : []))
    } catch (e) {
      plain = Array.isArray(tasks) ? tasks.map(t => ({ ...t })) : []
    }
    return await getApi().syncAll(plain)
  },

  /**
   * 注册定时任务触发回调
   * 当 Windows Task Scheduler 启动应用时，main.js 会发送 task:scheduledTrigger 事件
   * @param {Function} callback - 回调函数，参数为 taskId
   * @returns {Function|undefined} 注销函数，组件卸载时调用
   */
  onScheduledTrigger(callback) {
    return getApi()?.onScheduledTrigger(callback)
  }
}
