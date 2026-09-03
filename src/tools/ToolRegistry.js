/**
 * ToolRegistry - 工具注册中心
 *
 * 统一管理所有 AI 工具的注册、发现和执行。
 * 支持：超时控制、输出大小限制、按分类/名称查找、危险操作标记
 *
 * 工具定义格式：
 * {
 *   name: 'tool_name',                  // 工具名（唯一）
 *   category: 'Category',               // 分类
 *   description: 'Tool description',    // 描述
 *   parameters: { ... },                // JSON Schema 参数定义
 *   required: [],                       // 必填参数
 *   timeout: 30000,                     // 超时时间(ms)，0=不超时
 *   outputLimit: 1024 * 1024,           // 输出大小限制(字节)，0=不限制
 *   dangerous: false,                   // 危险操作标记：false / 警告文案
 *   handler: async (args, context) => { ... }  // 处理函数
 * }
 */

// 工具名称排序（保证序列化一致性，最大化前缀缓存命中）
const sortTools = (tools) =>
  tools.slice().sort((a, b) => a.function.name.localeCompare(b.function.name))

// 默认超时配置
const DEFAULT_TIMEOUT = 30000 // 30秒
const DEFAULT_OUTPUT_LIMIT = 2 * 1024 * 1024 // 2MB
const MINDMAP_OPS_TIMEOUT = 0 // 导图操作不设硬超时
const AI_OPS_TIMEOUT = 120000 // AI操作 2分钟

// 超时分类预设
export const TIMEOUT_PRESETS = {
  fast: 10000,        // 快速操作：10秒
  normal: 30000,      // 普通操作：30秒
  slow: 60000,        // 慢操作：1分钟
  ai: 120000,         // AI相关：2分钟
  mindmap: 0,         // 导图操作：不设硬超时
  none: 0,            // 不超时
}

export class ToolRegistry {
  constructor() {
    this._tools = new Map() // name -> toolDef
  }

  /**
   * 注册单个工具
   */
  register(toolDef) {
    if (!toolDef?.name) {
      throw new Error('ToolRegistry.register: toolDef.name is required')
    }
    if (!toolDef?.handler || typeof toolDef.handler !== 'function') {
      throw new Error(`ToolRegistry.register: ${toolDef.name} handler must be a function`)
    }

    const fullDef = {
      name: toolDef.name,
      category: toolDef.category || 'Other',
      description: toolDef.description || '',
      parameters: toolDef.parameters || { type: 'object', properties: {} },
      required: toolDef.required || [],
      timeout: toolDef.timeout ?? DEFAULT_TIMEOUT,
      outputLimit: toolDef.outputLimit ?? DEFAULT_OUTPUT_LIMIT,
      dangerous: toolDef.dangerous ?? false,
      handler: toolDef.handler,
    }

    this._tools.set(fullDef.name, fullDef)
    return fullDef
  }

  /**
   * 批量注册工具
   */
  registerBatch(toolDefs) {
    return toolDefs.map(def => this.register(def))
  }

  /**
   * 获取工具定义
   */
  get(name) {
    return this._tools.get(name) || null
  }

  /**
   * 检查工具是否存在
   */
  has(name) {
    return this._tools.has(name)
  }

  /**
   * 获取所有工具列表
   */
  list() {
    return Array.from(this._tools.values())
  }

  /**
   * 按分类获取工具
   */
  getByCategory(category) {
    return this.list().filter(t => t.category === category)
  }

  /**
   * 按名称列表获取工具（返回 OpenAI function calling 格式）
   */
  getByNames(names) {
    const set = new Set(names)
    const tools = this.list()
      .filter(t => set.has(t.name))
      .map(t => this._toFunctionDef(t))
    return sortTools(tools)
  }

  /**
   * 获取核心工具集（默认激活的工具）
   */
  getCoreTools(coreToolNames) {
    return this.getByNames(coreToolNames)
  }

  /**
   * 获取工具目录（用于展示）
   */
  getCatalog() {
    return this.list().map(t => ({
      name: t.name,
      category: t.category,
      desc: t.description,
    }))
  }

  /**
   * 生成工具目录文本
   */
  buildCatalogText(maxDescLen = 90) {
    const byCat = new Map()
    for (const t of this.list()) {
      const cat = t.category || 'Other'
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat).push(t)
    }
    const parts = []
    for (const [cat, tools] of byCat) {
      parts.push(`[${cat}]`)
      for (const t of tools) {
        const desc = t.description.length > maxDescLen
          ? t.description.slice(0, maxDescLen) + '…'
          : t.description
        parts.push(`- ${t.name}: ${desc}`)
      }
    }
    return parts.join('\n')
  }

  /**
   * 检查是否为危险操作
   */
  isDangerous(name) {
    const tool = this.get(name)
    return tool?.dangerous ? tool.dangerous : false
  }

  /**
   * 调用工具（带超时和输出限制）
   *
   * @param {string} name - 工具名
   * @param {object} args - 参数
   * @param {object} context - 执行上下文 (mindMap, activeNode, extraHandlers, etc.)
   * @returns {Promise<object>} - 工具执行结果
   */
  async call(name, args, context = {}) {
    const tool = this.get(name)
    if (!tool) {
      return {
        success: false,
        message: `未知工具: ${name}`,
      }
    }

    try {
      let resultPromise = tool.handler(args, context)

      // 超时控制
      if (tool.timeout > 0) {
        resultPromise = this._withTimeout(resultPromise, tool.timeout, name)
      }

      const result = await resultPromise

      // 输出大小限制
      if (tool.outputLimit > 0 && result?.message) {
        result.message = this._truncateOutput(result.message, tool.outputLimit)
        result._truncated = result.message.length !== (result._originalLen ?? result.message.length)
      }

      return result
    } catch (error) {
      if (error.name === 'TimeoutError') {
        return {
          success: false,
          message: `工具 ${name} 执行超时（${tool.timeout / 1000}秒），可能是操作量过大或卡住了。`,
          timeout: true,
        }
      }
      return {
        success: false,
        message: `工具 ${name} 执行失败: ${error.message}`,
        error: error.message,
      }
    }
  }

  /**
   * 转为 OpenAI function calling 格式
   */
  _toFunctionDef(tool) {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.parameters,
          required: tool.required,
        },
      },
    }
  }

  /**
   * Promise 超时包装
   */
  _withTimeout(promise, ms, toolName) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(`Tool ${toolName} timed out after ${ms}ms`)
        err.name = 'TimeoutError'
        reject(err)
      }, ms)

      Promise.resolve(promise)
        .then(result => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch(err => {
          clearTimeout(timer)
          reject(err)
        })
    })
  }

  /**
   * 截断输出到指定大小
   */
  _truncateOutput(text, limitBytes) {
    if (!text || typeof text !== 'string') return text
    const encoder = new TextEncoder()
    const bytes = encoder.encode(text)
    if (bytes.length <= limitBytes) return text

    // 截断到约 80% 的限制，然后加提示
    const targetBytes = Math.floor(limitBytes * 0.8)
    // 粗略估算字符数（中文约3字节/字）
    const approxChars = Math.floor(targetBytes / 2)
    const truncated = text.slice(0, approxChars)
    const removedLines = text.slice(approxChars).split('\n').length - 1

    return `${truncated}\n\n... [输出已截断，原内容约 ${(bytes.length / 1024).toFixed(1)}KB，超出 ${(limitBytes / 1024).toFixed(0)}KB 限制，省略了约 ${removedLines} 行]`
  }
}

// 全局单例
export const toolRegistry = new ToolRegistry()

export default toolRegistry
