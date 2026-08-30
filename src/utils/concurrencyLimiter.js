/**
 * AI API 并发动态降级控制器
 *
 * 目标：多节点批量调用 AI 时，默认最多 10 路并行；检测到限频错误（HTTP 429 / rate limit）
 * 后按跳跃式步长降级 10 → 8 → 6 → 5 → 4 → 2 → 1，限频解除后按 1 → 2 → 4 → 5 → 6 → 8 → 10 回升。
 *
 * 规则：
 * - 触发限频后，等待当前已发出的请求全部完成，再按新的并发数从队列取后续任务（不中断已运行请求）。
 * - 失败重试采用指数退避。
 * - 每个实例独立维护并发档位，可被「AI 背诵改写 / 全文挖空 / 全局背诵改写」等批量流程复用。
 */

// 并发档位序列（降序）：降级时索引增大（向右走），恢复时索引减小（向左走）
// 保留 5 作为旧默认档位，避免历史调用在缺省 maxConcurrency 时行为回退。
const LEVELS = [10, 8, 6, 5, 4, 2, 1]

// 判断一个错误是否为「限频」类错误
function isRateLimitError(err) {
  const msg = String((err && err.message) || '').toLowerCase()
  return (
    msg.includes('429') ||
    msg.includes('rate') ||
    msg.includes('too many') ||
    msg.includes('rate limit') ||
    msg.includes('限流') ||
    msg.includes('限频') ||
    msg.includes('并发') ||
    msg.includes('quota') ||
    msg.includes('throttl')
  )
}

// 判断错误是否为「超时 / 网络中断」类（API error: 0 等）
function isNetworkError(err) {
  const msg = String((err && err.message) || '')
  return (
    msg.includes('API error: 0') ||
    msg.includes('Failed to fetch') ||
    msg.includes('timeout') ||
    msg.includes('超时') ||
    msg.includes('abort') ||
    msg.includes('network') ||
    msg.includes('网络')
  )
}

export class ConcurrencyLimiter {
  /**
   * @param {object} options
   * @param {number} options.maxConcurrency 初始/最大并发（默认 5，支持最高 10，必须是 LEVELS 中的值）
   * @param {number} options.maxRetries     单任务失败重试次数（默认 2，指数退避）
   * @param {Function} options.onLevelChange 并发档位变化回调 (newLevel) => void
   * @param {Function} options.log          日志函数 (msg) => void
   */
  constructor(options = {}) {
    const max = Number(options.maxConcurrency) || 5
    this.maxLevel = LEVELS.includes(max) ? max : 5
    // 当前档位索引：从 maxLevel 对应索引开始
    this.levelIndex = LEVELS.indexOf(this.maxLevel)
    if (this.levelIndex < 0) this.levelIndex = LEVELS.length - 1
    this.maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : 2
    this.onLevelChange = options.onLevelChange || (() => {})
    this.log = options.log || (() => {})
    // 连续成功计数（用于恢复档位）
    this.consecutiveSuccess = 0
  }

  get currentLevel() {
    return LEVELS[this.levelIndex]
  }

  // 降级（限频/网络错误时）：LEVELS 为降序 [5,4,2,1]，降级 = 索引增大（向右走），最低 1
  _degrade() {
    const prev = this.currentLevel
    if (this.levelIndex < LEVELS.length - 1) {
      this.levelIndex += 1
      this.consecutiveSuccess = 0
    }
    const next = this.currentLevel
    if (next !== prev) {
      this.log(`并发降级：${prev} → ${next}`)
      this.onLevelChange(next)
    }
    return next
  }

  // 恢复：连续成功达标后，索引减小（向左走），最高回到 maxLevel 对应档位
  _recordSuccess() {
    const prev = this.currentLevel
    this.consecutiveSuccess += 1
    // 连续 3 批成功才回升一档，避免抖动
    if (this.consecutiveSuccess >= 3 && this.levelIndex > LEVELS.indexOf(this.maxLevel)) {
      this.levelIndex -= 1
      this.consecutiveSuccess = 0
      const next = this.currentLevel
      this.log(`并发恢复：${prev} → ${next}`)
      this.onLevelChange(next)
    }
    return this.currentLevel
  }

  _recordRateLimit() {
    this._degrade()
  }

  _recordNetworkError() {
    this._degrade()
  }

  /**
   * 批量执行任务：按当前并发档位分块，逐块 Promise.all 执行。
   * 触发限频后，等待当前块完成再按新档位继续（不打断已运行请求）。
   *
   * @param {Array} tasks 任务数组（每个元素会传给 taskFn）
   * @param {Function} taskFn (task) => Promise<any>  单个任务执行函数，抛错视为失败
   * @param {object} options
   * @param {Function} options.onProgress ({ done, total, percent }) => void
   * @param {Function} options.isAborted () => boolean  用户取消检测，返回 true 立即中断
   * @param {Function} options.onTaskDone (task, result) => void  单任务成功回调（即时应用）
   * @param {Function} options.onTaskFail (task, error) => void  最终失败回调
   * @returns {Promise<Array>} 成功结果数组
   */
  async runAll(tasks, taskFn, options = {}) {
    const { onProgress, isAborted, onTaskDone, onTaskFail } = options
    const results = []
    let done = 0
    const total = tasks.length
    const report = () => {
      if (onProgress) onProgress({ done, total, percent: total ? Math.round((done / total) * 100) : 100 })
    }

    let idx = 0
    while (idx < tasks.length) {
      if (isAborted && isAborted()) {
        const err = new Error('已停止')
        err.aborted = true
        throw err
      }
      const concurrency = this.currentLevel
      const chunk = tasks.slice(idx, idx + concurrency)
      const chunkPromises = chunk.map(task => this._runWithRetry(task, taskFn, isAborted))
      const chunkResults = await Promise.all(chunkPromises)

      let hasRateLimit = false
      let hasNetwork = false
      chunkResults.forEach((r, i) => {
        if (r.success) {
          results.push(r.data)
          if (onTaskDone) onTaskDone(chunk[i], r.data)
        } else {
          if (isRateLimitError(r.error)) hasRateLimit = true
          if (isNetworkError(r.error)) hasNetwork = true
          if (onTaskFail) onTaskFail(chunk[i], r.error)
        }
        done += 1
      })
      report()

      if (hasRateLimit) {
        this._recordRateLimit()
        // 退避等待：限频后先等一段时间再继续
        await this._sleep(1000)
      } else if (hasNetwork) {
        this._recordNetworkError()
        await this._sleep(600)
      } else {
        this._recordSuccess()
      }

      idx += chunk.length
    }

    return results
  }

  // 单任务执行 + 指数退避重试
  async _runWithRetry(task, taskFn, isAborted) {
    let lastErr = null
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (isAborted && isAborted()) {
        const err = new Error('已停止')
        err.aborted = true
        return { success: false, error: err }
      }
      try {
        const data = await taskFn(task)
        return { success: true, data }
      } catch (e) {
        lastErr = e
        const shouldRetry = attempt < this.maxRetries && (isRateLimitError(e) || isNetworkError(e))
        if (!shouldRetry) break
        // 指数退避：500ms * 2^attempt
        await this._sleep(500 * Math.pow(2, attempt))
      }
    }
    return { success: false, error: lastErr || new Error('任务失败') }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// 便捷工厂：创建一个默认 5 路并发的限频控制器
export function createLimiter(options = {}) {
  return new ConcurrencyLimiter(options)
}

export { LEVELS, isRateLimitError, isNetworkError }
