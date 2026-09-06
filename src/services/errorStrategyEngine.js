/**
 * 智能错误解读与策略搜索引擎
 *
 * 核心思想：不是硬编码"遇到400就去tools"，而是语义化分析错误信息，
 * 从策略库中匹配可能的修复方案，按优先级尝试，记录结果，越用越准。
 *
 * 策略库设计：
 *   - 每条策略有：匹配模式（关键词/正则）、优先级、动作、副作用、成功率统计
 *   - 新错误出现时，按匹配度从高到低尝试
 *   - 尝试成功 → 提升该策略优先级 + 记录到记忆
 *   - 尝试失败 → 降低优先级，试下一个
 */

// ============================================================
//  策略库（可扩展）
// ============================================================
//
// 每条策略定义：
//   id:          唯一标识
//   name:        策略名称（日志显示用）
//   description: 策略描述
//   match:       匹配函数 (errorInfo) => number — 返回匹配度 0-1，越高越可能是这个问题
//   action:      'retry_no_tools' | 'retry_base64' | 'retry_ocr' | 'retry_file_id_format' | 'report_error'
//   priority:    基础优先级（数字越大越先试）
//   sideEffect:  副作用描述（会修改什么状态）
//   oneShot:     是否只允许试一次（true=试过不行就不再试这个策略）

const STRATEGY_LIBRARY = [
  // ---------- 多模态相关 ----------
  {
    id: 'vision_no_tools',
    name: '去除 tools 参数重试',
    description: '很多视觉模型不支持 function calling，去掉 tools 参数后重试',
    category: 'vision',
    match: (info) => {
      const msg = info.message?.toLowerCase() || ''
      // 高匹配度：明确说不支持 tools / function_call / 工具调用
      if (/tools.*not.*support|不支持.*tool|function.?call.*not.*support|不支持.*函数调用/.test(msg)) return 0.95
      if (/parameter.*tool|tool.*parameter|参数.*tool/.test(msg)) return 0.85
      // 中匹配度：400/422 + 多模态请求 + 第一次失败
      if (info.statusCode && ['400', '422'].includes(info.statusCode) && info.isVisionRequest && !info.triedNoTools) return 0.5
      return 0
    },
    action: 'retry_no_tools',
    priority: 90,
    sideEffect: '清除本轮工具调用，去掉 tools 参数',
    oneShot: true
  },
  {
    id: 'vision_file_id_format',
    name: '切换文件引用格式重试',
    description: '不同厂商文件引用格式不同（file_id / input_image / image_url / file），切换格式重试',
    category: 'vision',
    match: (info) => {
      const msg = info.message?.toLowerCase() || ''
      if (/content\.type.*非法|type.*not.*support.*image|不支持.*image_url|input_image/.test(msg)) return 0.9
      if (/file.*format.*not.*support|文件格式.*不支持/.test(msg) && info.isImage) return 0.6
      return 0
    },
    action: 'retry_file_format',
    priority: 85,
    sideEffect: '切换消息中文件/图片的引用格式',
    oneShot: true
  },
  {
    id: 'vision_base64_fallback',
    name: '从 files API 降级为 base64 直发',
    description: 'files API 上传失败时，改用 base64 直接嵌入消息',
    category: 'vision',
    match: (info) => {
      const msg = info.message?.toLowerCase() || ''
      if (/file.*upload.*fail|上传.*失败|files.*error|file.*not.*support/.test(msg)) return 0.8
      if (info.failedOnFilesApi) return 0.9
      return 0
    },
    action: 'retry_base64',
    priority: 80,
    sideEffect: '图片改为 base64 嵌入消息体',
    oneShot: true
  },
  {
    id: 'vision_local_ocr',
    name: '降级为本地 OCR',
    description: '云端多模态彻底失败时，使用本地 PaddleOCR 识别后用纯文本发送',
    category: 'vision',
    match: (info) => {
      // 保底策略：只要是多模态请求失败且有图片，匹配度就有 0.3
      if (info.isVisionRequest && info.hasImages) return 0.3
      // 如果已经试了好几个策略还没成，这个策略优先级提高
      if (info.triedStrategies && info.triedStrategies.length >= 2 && info.hasImages) return 0.7
      return 0
    },
    action: 'retry_ocr',
    priority: 30,
    sideEffect: '本地 OCR 识别图片，转为纯文本请求',
    oneShot: true
  },

  // ---------- 通用错误 ----------
  {
    id: 'rate_limit_retry',
    name: '限流后延迟重试',
    description: '遇到 429 限流，等待后自动重试',
    category: 'general',
    match: (info) => {
      if (info.statusCode === '429') return 0.95
      if (/rate.*limit|too many request|请求过多|限流/.test(info.message?.toLowerCase() || '')) return 0.85
      return 0
    },
    action: 'retry_after_delay',
    priority: 95,
    sideEffect: '延迟 2-5 秒后用相同参数重试',
    oneShot: false // 可以多次重试（带退避）
  },
  {
    id: 'auth_error',
    name: '鉴权失败',
    description: 'API Key 无效或过期，直接报错让用户检查配置',
    category: 'general',
    match: (info) => {
      if (info.statusCode === '401' || info.statusCode === '403') return 0.9
      if (/unauthorized|invalid.*key|auth.*fail|鉴权失败|密钥.*无效/.test(info.message?.toLowerCase() || '')) return 0.85
      return 0
    },
    action: 'report_error',
    priority: 100,
    sideEffect: '直接报错，不重试',
    oneShot: true
  },
  {
    id: 'context_length',
    name: '上下文超限',
    description: 'token 超过模型上限，缩短上下文后重试',
    category: 'general',
    match: (info) => {
      const msg = info.message?.toLowerCase() || ''
      if (/context.*length|max.*token|token.*exceed|上下文.*超限|长度.*超出/.test(msg)) return 0.9
      if (info.statusCode === '413') return 0.7
      return 0
    },
    action: 'retry_shorter_context',
    priority: 70,
    sideEffect: '缩短历史上下文后重试',
    oneShot: true
  },
  {
    id: 'server_error_retry',
    name: '服务端错误重试',
    description: '5xx 服务端错误，稍等后重试',
    category: 'general',
    match: (info) => {
      if (info.statusCode && info.statusCode.startsWith('5')) return 0.85
      if (/server.*error|internal.*error|服务.*错误/.test(info.message?.toLowerCase() || '')) return 0.6
      return 0
    },
    action: 'retry_after_delay',
    priority: 75,
    sideEffect: '延迟 3 秒后重试，最多 2 次',
    oneShot: false
  },
  {
    id: 'model_not_found',
    name: '模型不存在',
    description: '模型名错误或服务商不支持该模型',
    category: 'general',
    match: (info) => {
      const msg = info.message?.toLowerCase() || ''
      if (/model.*not.*found|模型.*不存在|invalid.*model/.test(msg)) return 0.9
      return 0
    },
    action: 'report_error',
    priority: 95,
    sideEffect: '直接报错，提示用户检查模型名',
    oneShot: true
  }
]

// ============================================================
//  错误信息标准化
// ============================================================

function normalizeError(error, context = {}) {
  const msg = error?.message || String(error || '')
  const statusMatch = /API error: (\d{3})/.exec(msg)
  const statusCode = statusMatch ? statusMatch[1] : (error?.statusCode || error?.status || null)

  // 尝试从错误信息中提取更丰富的内容
  let errorDetail = ''
  try {
    const jsonMatch = msg.match(/(\{[\s\S]*\})/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1])
      errorDetail = parsed.error?.message || parsed.message || ''
    }
  } catch {}

  return {
    message: msg,
    errorDetail: errorDetail || msg,
    statusCode: String(statusCode || ''),
    isVisionRequest: !!context.isVisionRequest,
    hasImages: !!context.hasImages,
    hasDocs: !!context.hasDocs,
    triedNoTools: !!context.triedNoTools,
    triedBase64: !!context.triedBase64,
    triedOcr: !!context.triedOcr,
    triedStrategies: context.triedStrategies || [],
    failedOnFilesApi: !!context.failedOnFilesApi,
    isImage: !!context.isImage,
    provider: context.provider || '',
    model: context.model || ''
  }
}

// ============================================================
//  策略匹配与排序
// ============================================================

/**
 * 分析错误，返回推荐的修复策略列表（按优先级排序）
 * @param {Error} error — 错误对象
 * @param {object} context — 上下文信息
 * @param {object} memory — 历史记忆（该服务的策略成功率）
 * @returns {Array<{strategy: object, matchScore: number, finalScore: number}>}
 */
export function analyzeErrorStrategies(error, context, memory = {}) {
  const info = normalizeError(error, context)
  const results = []

  for (const strategy of STRATEGY_LIBRARY) {
    // 1. 计算匹配度
    let matchScore = 0
    try {
      matchScore = strategy.match(info) || 0
    } catch { matchScore = 0 }

    if (matchScore <= 0) continue

    // 2. oneShot 策略已经试过了 → 跳过
    if (strategy.oneShot && info.triedStrategies.includes(strategy.id)) continue

    // 3. 加上历史成功率加权
    const strategyMemory = memory[strategy.id]
    let successBonus = 0
    if (strategyMemory && strategyMemory.total > 0) {
      const rate = strategyMemory.success / strategyMemory.total
      successBonus = (rate - 0.5) * 20 // 成功率 50% 是基准，每高 10% 加 2 分
    }

    // 4. 最终得分 = 基础优先级 * 匹配度 + 历史加权
    const finalScore = strategy.priority * matchScore + successBonus

    results.push({
      strategy,
      matchScore,
      finalScore,
      strategyId: strategy.id,
      action: strategy.action,
      description: strategy.description
    })
  }

  // 按最终得分降序排列
  results.sort((a, b) => b.finalScore - a.finalScore)

  return {
    info,
    strategies: results,
    topStrategy: results[0] || null
  }
}

// ============================================================
//  策略执行结果记忆
// ============================================================

const STRATEGY_MEMORY_KEY = 'strategy_learning_memory'

function loadStrategyMemory() {
  try {
    const raw = localStorage.getItem(STRATEGY_MEMORY_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch { return {} }
}

function saveStrategyMemory(mem) {
  try { localStorage.setItem(STRATEGY_MEMORY_KEY, JSON.stringify(mem)) } catch {}
}

function getServiceKey(baseURL, model) {
  return `${String(baseURL || '')}::${String(model || '')}`
}

/**
 * 记录某个策略在某个服务上的执行结果
 */
export function recordStrategyResult(baseURL, model, strategyId, success) {
  const mem = loadStrategyMemory()
  const key = getServiceKey(baseURL, model)
  if (!mem[key]) mem[key] = {}
  if (!mem[key][strategyId]) mem[key][strategyId] = { success: 0, total: 0 }
  mem[key][strategyId].total++
  if (success) mem[key][strategyId].success++
  saveStrategyMemory(mem)
}

/**
 * 获取某个服务的策略学习记忆
 */
export function getStrategyMemory(baseURL, model) {
  const mem = loadStrategyMemory()
  const key = getServiceKey(baseURL, model)
  return mem[key] || {}
}

// ============================================================
//  便捷函数：获取最佳下一步动作
// ============================================================

/**
 * 给定错误和上下文，返回最佳下一步动作
 * @returns {object} { action, reason, strategyId, shouldRetry }
 */
export function getBestNextAction(error, context, baseURL, model) {
  const memory = getStrategyMemory(baseURL, model)
  const analysis = analyzeErrorStrategies(error, context, memory)
  const top = analysis.topStrategy

  if (!top) {
    return {
      action: 'report_error',
      reason: error?.message || '未知错误',
      strategyId: null,
      shouldRetry: false,
      allStrategies: analysis.strategies
    }
  }

  return {
    action: top.action,
    reason: top.strategy.description + `（匹配度：${Math.round(top.matchScore * 100)}%）`,
    strategyId: top.strategyId,
    shouldRetry: top.action !== 'report_error',
    topStrategy: top,
    allStrategies: analysis.strategies,
    errorInfo: analysis.info
  }
}

// ============================================================
//  导出
// ============================================================

export default {
  STRATEGY_LIBRARY,
  normalizeError,
  analyzeErrorStrategies,
  getBestNextAction,
  recordStrategyResult,
  getStrategyMemory
}
