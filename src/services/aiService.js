/**
 * AI 模型接入服务
 * 支持 OpenAI 兼容 API（流式和非流式）
 */

import { stripThinkBlocks, createThinkStreamFilter } from '../utils/thinkFilter'
import { createPlanStreamFilter } from '../utils/planFilter'

/**
 * 清洗工具返回值，移除/截断 AI 不需要且会爆上下文的大字段：
 * - base64 图片/文件数据（data:image/...;base64,...）替换为占位符
 * - 字符串值超过 MAX_STR_LEN 自动截断
 * - 递归处理嵌套对象/数组
 */
const MAX_STR_LEN = 3000
const BASE64_RE = /^data:[a-zA-Z0-9]+\/[a-zA-Z0-9.+-]+;base64,/
const sanitizeForAI = (obj, depth = 0) => {
  if (depth > 8) return '[嵌套过深已省略]'
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    if (BASE64_RE.test(obj)) {
      return `[二进制数据已省略，长度 ${obj.length} 字符，请使用 filePath 访问文件]`
    }
    if (obj.length > MAX_STR_LEN) {
      return obj.slice(0, MAX_STR_LEN) + `\n...[内容过长已截断，原长度 ${obj.length} 字符]`
    }
    return obj
  }
  if (Array.isArray(obj)) {
    // 数组也截断（防止read_file返回巨大的行数组）
    const arr = obj.map(v => sanitizeForAI(v, depth + 1))
    if (arr.length > 50) {
      return [...arr.slice(0, 50), `...[数组过长已截断，原 ${arr.length} 项]`]
    }
    return arr
  }
  if (typeof obj === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      // 明确移除会携带巨量二进制数据的字段（AI不需要看base64图片/文件内容）
      if (k === 'imageData' || k === 'fileData' || k === 'binaryData' || k === 'dataUrl' || k === 'base64') {
        if (typeof v === 'string' && v.length > 500) {
          out[k] = `[二进制数据已省略，长度 ${v.length} 字符]`
          continue
        }
      }
      out[k] = sanitizeForAI(v, depth + 1)
    }
    return out
  }
  return obj
}

/**
 * 安全序列化工具结果给 AI：先清洗再 JSON.stringify
 */
const safeStringifyResult = (r) => JSON.stringify(sanitizeForAI(r))

/**
 * 构建 chat completions API URL
 * autoComplete=true（默认）：如果 baseURL 已包含 /chat/completions，则直接使用；
 *   如果以 /v1 结尾，追加 /chat/completions；否则追加 /v1/chat/completions
 * autoComplete=false：地址原样使用（仅去除末尾斜杠），适配自带独立后缀的厂商
 */
export function buildChatURL(baseURL, autoComplete = true) {
  if (!baseURL) return ''
  let url = baseURL.trim().replace(/\/+$/, '')
  if (autoComplete === false) return url
  // 自愈历史版本错误拼接出的双重版本路径（旧版 autoCompleteURL 会把 /v4/v1/chat/completions 整段写进配置）
  // 例：.../paas/v4/v1/chat/completions → .../paas/v4/chat/completions
  url = url.replace(/(\/v\d+[a-z]*)(?:\/v\d+[a-z]*)+\/chat\/completions$/i, '$1/chat/completions')
  if (/\/chat\/completions$/i.test(url)) return url
  // 已带版本号（/v1、/v4、/compatible-mode/v1、/v1beta 等）→ 只补 /chat/completions，避免拼出 /v4/v1/... 双重路径
  if (/\/v\d+[a-z]*$/i.test(url)) return url + '/chat/completions'
  return url + '/v1/chat/completions'
}

/**
 * 从完整 API URL 中提取基础 URL（用于 /v1/models 等其他端点）
 */
export function buildBaseURL(baseURL) {
  if (!baseURL) return ''
  let url = baseURL.trim().replace(/\/+$/, '')
  url = url.replace(/\/chat\/completions$/i, '')
  url = url.replace(/\/v1$/i, '')
  return url
}

/**
 * 并行安全工具（纯查询、无副作用、互不依赖）：
 * 同一批 tool_calls 全部属于此集合时用 Promise.all 并行执行
 */
const PARALLEL_SAFE_TOOLS = new Set([
  'get_mindmap_content',
  'get_mindmap_info',
  'search_nodes',
  'search_web',
  'read_webpage',
  'get_location',
  'search_knowledge_base',
  'read_node_image',
  'semantic_search',
  'read_mindmap_file',
  'read_local_file',
  'find_local_file',
  'list_references',
  'feishu_list_files',
  'feishu_get_doc_content',
  'get_review_schedule',
  'list_cloze_nodes',
  'query_node_styles',
  'find_related'
])

/**
 * 自动补全 URL：如果用户未写全 completions 路径，则自动追加
 * autoComplete=false 时原样返回（仅去除末尾斜杠）
 */
export function autoCompleteURL(url, autoComplete = true) {
  return buildChatURL(url, autoComplete)
}

// 多引擎联网搜索（免费无密钥）。taskId 用于限制同一次用户任务的搜索次数。
let currentWebSearchTaskId = ''
export function resetWebSearchTask(taskId = `search_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`) {
  currentWebSearchTaskId = taskId
  return taskId
}
export async function searchWeb(query, options = {}) {
  const deepResearch = options.deepResearch === true || /深度调研|系统调研|全面调研/.test(String(query || ''))
  const taskId = options.taskId || currentWebSearchTaskId || resetWebSearchTask()
  // 优先走主进程 IPC：渲染进程直接 fetch 会被 CORS 拦截而永远返回空
  try {
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.webSearch) {
      const response = await window.electronAPI.webSearch({ query, taskId, deepResearch })
      if (response && response.success && Array.isArray(response.results)) {
        const results = response.results.slice(0, options.limit || 8)
        results.searchMeta = {
          cacheHit: !!response.cacheHit,
          earlyReturn: !!response.earlyReturn,
          engineStatuses: response.engineStatuses || [],
          breakerStatuses: response.breakerStatuses || [],
          searchBudget: response.searchBudget || null,
          errors: response.errors || []
        }
        return results
      }
      if (response && response.success) return []
      if (response && response.error) {
        throw new Error(`${response.error}${response.searchBudget ? `（预算 ${response.searchBudget.count}/${response.searchBudget.limit}）` : ''}`)
      }
    }
  } catch (error) {
    if (error && error.message && (error.message.includes('搜索失败') || error.message.includes('搜索预算已用完'))) throw error
  }
}

// 读取网页正文（主进程抓取并提取纯文本，配合联网搜索使用）
export async function readWebpage(url) {
  if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.webFetch) {
    const r = await window.electronAPI.webFetch(url)
    if (r && r.success) {
      return { title: r.title || '', content: r.content || '', truncated: !!r.truncated }
    }
    throw new Error((r && r.error) || '网页读取失败')
  }
  throw new Error('网页读取功能不可用（仅支持桌面版）')
}

/**
 * 模型提供商预设列表
 */
export const providerPresets = [
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '🤖',
    baseURL: 'https://api.openai.com',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: '🐋',
    baseURL: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    id: 'moonshot',
    name: 'Kimi (月之暗面)',
    icon: '🌙',
    baseURL: 'https://api.moonshot.cn',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    icon: '✨',
    baseURL: 'https://open.bigmodel.cn/api/paas',
    models: ['glm-4', 'glm-4-flash', 'glm-4-air']
  },
  {
    id: 'qwen',
    name: '通义千问',
    icon: '🌐',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo']
  },
  {
    id: 'ollama',
    name: 'Ollama (本地)',
    icon: '💻',
    baseURL: 'http://localhost:11434',
    models: ['llama3', 'qwen2', 'phi3', 'mistral']
  },
  {
    id: 'openai_proxy',
    name: 'OpenAI 兼容（第三方/中转站）',
    icon: '🔄',
    baseURL: '',
    models: [],
    description: '支持填写中转站、代理商、模型供应商的 OpenAI 兼容 API 地址，如 https://api.your-proxy.com'
  },
  {
    id: 'custom',
    name: '自定义',
    icon: '⚙️',
    baseURL: '',
    models: []
  }
]

/**
 * 多模态（视觉理解）模型知识库：跨平台内置规则，用于从模型列表识别支持图片输入的模型。
 * 三层识别策略（由强到弱）：
 *   1. 接口元数据：/models 返回 modalities.input_modalities 含 image（火山方舟等提供）
 *   2. 本知识库：按模型名模式匹配，覆盖主流平台（下方两个列表）
 *   3. 实测探测：设置页「测试识图」按钮发真实小图验证可用性（端点限制/未开通/余额等）
 */
export const VISION_POSITIVE_PATTERNS = [
  // OpenAI：gpt-4o / 4.1 / 4.5 / 5 及 o3、o4-mini 支持图片（o1 系列仅文本，勿匹配）
  'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision', 'gpt-4.1', 'gpt-4.5', 'gpt-5', 'o3', 'o4-mini',
  // Anthropic：Claude 3 起全系支持图片
  'claude-3', 'claude-4', 'claude-opus', 'claude-sonnet', 'claude-haiku',
  // Google Gemini 全系多模态
  'gemini',
  // 智谱 GLM 视觉系列
  'glm-4v', 'glm-4.1v', 'glm-4.5v', 'glm-4.6v', 'glm-4v-flash', 'cogagent',
  // 通义千问视觉系列
  'qwen-vl', 'qwen2-vl', 'qwen2.5-vl', 'qwen3-vl', 'qvq', 'qwen2.5-omni', 'qwen3-omni',
  // 火山方舟豆包：seed-2.x 全系支持视觉理解、seed-code/seed-1.6-vision 等
  'doubao-seed-2', 'doubao-seed-code', 'doubao-seed-1-6-vision', 'doubao-seed-1.6-vision', 'doubao-vision',
  // Kimi / Moonshot 视觉
  'moonshot-v1-vision', 'moonshot-v1-8k-vision', 'moonshot-v1-32k-vision', 'kimi-k2.6', 'kimi-k2.7', 'kimi-latest',
  // 阶跃 / 混元 / 文心 / MiniMax 视觉
  'step-1v', 'step-2v', 'hunyuan-vision', 'ernie-vl', 'ernie-4.5-vl', 'abab5.5-vision',
  // 开源 / 本地（Ollama、硅基流动、vLLM 等）
  'llava', 'internvl', 'xcomposer', 'pixtral', 'minicpm-v', 'cogvlm', 'moondream',
  'deepseek-vl', 'llama-3.2-11b-vision', 'llama-3.2-90b-vision', 'gemma3', 'yi-vision',
  'phi-3-vision', 'phi-3.5-vision', 'smolvlm', 'granite-vision'
]

// 排除模式（优先于正向）：图片/视频生成、向量、语音类模型不是视觉理解模型
export const VISION_EXCLUDE_PATTERNS = [
  'embedding', 'rerank', 'bge-',
  'seedream', 'seedance', 'dall-e', 'flux', 'stable-diffusion', 'sdxl', 'sd3',
  'wan2', 'cogvideo', 'hunyuan-video', 'kolors', 'videomaker',
  'tts', 'whisper', 'sensevoice', 'cosyvoice', 'asr'
]

/**
 * 判断模型名是否支持多模态（图片输入）——内置知识库规则
 * @param {string} name 模型名
 */
export function isVisionModel(name) {
  if (!name) return false
  const n = String(name).toLowerCase()
  if (VISION_EXCLUDE_PATTERNS.some((k) => n.includes(k))) return false
  return VISION_POSITIVE_PATTERNS.some((k) => n.includes(k.toLowerCase()))
}

/**
 * 自动工具发现（第一级）：用用户原话在工具池里做本地匹配（中文二元组 + 拉丁词），
 * 返回得分最高且未被激活的工具。纯本地计算，不发请求、零 token。
 * 命中规则：description 命中一个 token 记 1 分，工具名命中记 3 分，≥2 分才算命中
 */
function matchToolsByText(text, pool, activeNames, limit = 3) {
  const q = String(text || '').trim()
  if (!q || !Array.isArray(pool) || pool.length === 0) return []
  const tokens = new Set()
  for (const w of (q.toLowerCase().match(/[a-z][a-z0-9_]{1,}/g) || [])) tokens.add(w)
  const cjk = q.replace(/[^\u4e00-\u9fff]/g, '')
  for (let i = 0; i < cjk.length - 1; i++) tokens.add(cjk.slice(i, i + 2))
  if (tokens.size === 0) return []
  const hits = []
  for (const t of pool) {
    const name = t?.function?.name || ''
    if (!name) continue
    if (activeNames.has(name)) continue
    const desc = t?.function?.description || ''
    const nameL = name.toLowerCase()
    const descL = desc.toLowerCase()
    let score = 0
    for (const tok of tokens) {
      if (descL.includes(tok)) score += 1
      if (nameL.includes(tok)) score += 3
    }
    if (score >= 2) hits.push({ name, desc: desc.slice(0, 80), score })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * 自动工具发现（第二级·语义）：第一级未命中且模型疑似"拒答"时，
 * 把紧凑工具目录（名称+一行描述）发给模型做一次语义挑选。
 * 目录只在这个兜底路径才发送（一次非流式小请求），不进常规提示词
 */
async function semanticToolMatch(userQuery, pool, activeNames) {
  const catalog = pool
    .filter(t => {
      const n = t?.function?.name || ''
      return n && !activeNames.has(n)
    })
    .map(t => `${t.function.name}：${String(t.function.description || '').slice(0, 60)}`)
    .join('\n')
  if (!catalog) return []
  const sys = '你是工具路由器。根据用户需求，从工具目录中挑选真正匹配的工具。只输出 JSON：{"tools":["工具名1","工具名2"]}；没有匹配输出 {"tools":[]}。规则：用户要做"操作"（修改/查询/导出/发送/上传/删除/切换/显示/隐藏/生成等）且目录里有对应工具时才选；纯知识问答、闲聊、寒暄不要选任何工具；最多选 3 个。'
  const usr = `用户需求：${userQuery}\n\n工具目录：\n${catalog}`
  try {
    const choice = await aiService.chat(usr, sys, null, { responseFormat: 'json' })
    const raw = choice?.message?.content || ''
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return []
    const parsed = JSON.parse(m[0])
    const names = Array.isArray(parsed.tools) ? parsed.tools.filter(x => typeof x === 'string') : []
    const valid = new Set(pool.map(t => t.function.name))
    return names
      .filter(n => valid.has(n) && !activeNames.has(n))
      .slice(0, 3)
      .map(n => {
        const def = pool.find(t => t.function.name === n)
        return { name: n, desc: String(def.function.description || '').slice(0, 80) }
      })
  } catch {
    return []
  }
}

/** 从消息列表提取最近一条用户消息的原始输入（剥离"## 当前时间"等动态上下文块） */
function extractLatestUserQuery(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    let text = ''
    if (typeof m.content === 'string') text = m.content
    else if (Array.isArray(m.content)) {
      text = m.content.filter(p => p && p.type === 'text').map(p => p.text).join('\n')
    }
    return text.split(/\n## /)[0].trim()
  }
  return ''
}

/** 拒答特征检测：模型没用任何工具却输出"无法完成"类回复时触发语义兜底 */
const REFUSAL_RE = /(无法|不能|做不到|不支持|没有.{0,6}(功能|工具|能力)|暂不|无法执行|无法完成|我帮不了)/

class AIService {
  constructor() {
    this.baseURL = ''
    this.apiKey = ''
    this.model = ''
    // URL 自动补全开关（false 时按填写的地址原样请求）
    this.autoComplete = true
    // 生成温度（可在设置中自定义，默认 0.7）
    this.temperature = 0.7
    this.initialized = false
    // 暴露提供商预设供 UI 使用
    this.providerPresets = providerPresets
    // 中断控制：用户点击"停止"后置位，中断流式读取与工具调用循环
    this._abortedTokens = new Set()
    this._activeStreamCancel = null
    this._abortController = null
    // chatWithCallbacks 主循环运行标记：嵌套的 chat() 调用不重置中断状态
    this._inLoop = false
    // 运行代际令牌：新一轮 chatWithCallbacks 启动时更新；旧循环检测到自己过期后静默退出，
    // 防止"停止/切换会话后立即发新消息，旧循环因 _aborted 被新轮回置而复活"
    this._activeRunToken = null
  }

  /**
   * 中断当前正在进行的 AI 请求/工具调用循环
   */
  abort() {
    if (this._activeRunToken) this._abortedTokens.add(this._activeRunToken)
    if (this._activeStreamCancel) {
      try { this._activeStreamCancel() } catch (e) {}
      this._activeStreamCancel = null
    }
    if (this._abortController) {
      try { this._abortController.abort() } catch (e) {}
      this._abortController = null
    }
  }

  isAborted() {
    return this._activeRunToken ? this._abortedTokens.has(this._activeRunToken) : false
  }

  _resetAbort() {
    this._abortedTokens = new Set()
    this._activeStreamCancel = null
    this._abortController = null
  }

  /**
   * 公开方法：新的用户操作开始前清除上一次遗留的停止标记
   * 由各 AI 功能入口（发送消息 / 续写 / 背诵改写 / 挖空）在开始时显式调用
   * 嵌套的工具内 AI 调用绝不调用此方法，避免清掉主流程的停止标记
   */
  resetAbort() {
    this._resetAbort()
  }

  /**
   * 从 Electron 主进程获取配置并初始化
   */
  async init() {
    const config = await window.electronAPI.getAIConfig()
    this.baseURL = config.baseURL
    this.apiKey = config.apiKey
    this.model = config.model
    this.autoComplete = config.autoComplete !== false
    this.temperature = Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.7
    this.initialized = true
  }

  /**
   * 直接设置配置（不经过 Electron，用于临时测试或运行时更新）
   * @param {object} config { baseURL, apiKey, model, autoComplete }
   */
  setConfig(config) {
    this.baseURL = config.baseURL || ''
    this.apiKey = config.apiKey || ''
    this.model = config.model || ''
    this.autoComplete = config.autoComplete !== false
    this.temperature = Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.7
    this.initialized = true
  }

  /**
   * 重置初始化状态（配置变更后调用）
   * 下次使用时会重新从 Electron 加载配置
   */
  resetConfig() {
    this.initialized = false
  }

  /**
   * 确保服务已初始化
   */
  async ensureInitialized() {
    if (!this.initialized) await this.init()
  }

  /* ============================================================
   * IPC 代理辅助方法
   * 通过 Electron 主进程代理 API 请求，避免 CORS 限制
   * ============================================================ */

  /**
   * 检查是否可通过 Electron IPC 代理请求
   */
  _isElectron() {
    return typeof window !== 'undefined' && window.electronAPI && window.electronAPI.aiChat
  }

  /**
   * 构建请求头（可传入 apiKey 覆盖当前配置，用于多模态等独立配置档）
   */
  _buildHeaders(apiKey) {
    const headers = { 'Content-Type': 'application/json' }
    const key = apiKey !== undefined ? apiKey : this.apiKey
    if (key) {
      headers['Authorization'] = `Bearer ${key}`
    }
    return headers
  }

  /**
   * 非流式 API 请求（自动选择 IPC 或直接 fetch）
   * @returns {Promise<{ ok: boolean, status: number, json: Function, text: Function }>}
   */
  async _fetchAPI(url, body, apiKey) {
    const headers = this._buildHeaders(apiKey)

    if (this._isElectron()) {
      // 通过 IPC 代理
      const result = await window.electronAPI.aiChat(url, headers, body)
      if (!result.success) {
        return {
          ok: false,
          status: result.status || 0,
          json: async () => {
            try { return JSON.parse(result.error || '{}') } catch { return {} }
          },
          text: async () => result.error || ''
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => result.data,
        text: async () => JSON.stringify(result.data)
      }
    }

    // 浏览器降级：直接 fetch
    return fetch(url, {
      method: 'POST',
      headers,
      body
    })
  }

  /**
   * 流式 API 请求（自动选择 IPC 或直接 fetch）
   * 返回一个统一的 reader，read() 返回 { done, value: string }
   * @returns {Promise<{ ok: boolean, status: number, getReader: Function }>}
   */
  async _fetchStream(url, body, apiKey) {
    const headers = this._buildHeaders(apiKey)

    if (this._isElectron() && window.electronAPI.aiChatStream) {
      // 通过 IPC 代理流式请求
      let chunkResolver = null
      const chunkQueue = []
      let streamDone = false
      let streamError = null
      let responseOk = true
      let responseStatus = 200

      // 中断当前流：通知主进程取消请求，并置为完成态唤醒等待中的 read()
      let streamCancelHandle = null
      this._activeStreamCancel = () => {
        try { streamCancelHandle?.cancel?.() } catch (e) {}
        streamDone = true
        if (chunkResolver) {
          const resolver = chunkResolver
          chunkResolver = null
          resolver({ done: true, value: undefined })
        }
      }

      streamCancelHandle = window.electronAPI.aiChatStream(
        url, headers, body,
        // onData
        (data) => {
          if (chunkResolver) {
            const resolver = chunkResolver
            chunkResolver = null
            resolver({ done: false, value: data })
          } else {
            chunkQueue.push(data)
          }
        },
        // onDone
        () => {
          streamDone = true
          if (chunkResolver) {
            const resolver = chunkResolver
            chunkResolver = null
            resolver({ done: true, value: undefined })
          }
        },
        // onError
        (error) => {
          streamError = error
          // 解析错误中的状态码
          const statusMatch = error.message?.match(/API error: (\d+)/)
          if (statusMatch) {
            responseStatus = parseInt(statusMatch[1])
            responseOk = false
          }
          if (chunkResolver) {
            const resolver = chunkResolver
            chunkResolver = null
            resolver({ done: true, value: undefined })
          }
        }
      )

      // 等待第一个数据或错误来确认连接状态
      // 如果有错误，会在第一次 read() 时抛出
      return {
        ok: responseOk,
        status: responseStatus,
        getReader: () => ({
          // IPC 流中途出错时 onError 会把读循环以 done 收尾，读循环需据此区分正常结束与中断
          getError: () => streamError,
          read: () => {
            if (streamError) {
              return Promise.reject(streamError)
            }
            if (chunkQueue.length > 0) {
              return Promise.resolve({ done: false, value: chunkQueue.shift() })
            }
            if (streamDone) {
              return Promise.resolve({ done: true, value: undefined })
            }
            return new Promise((resolve) => { chunkResolver = resolve })
          },
          releaseLock: () => {}
        })
      }
    }

    // 浏览器降级：直接 fetch（支持 AbortController 中断）
    this._abortController = new AbortController()
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: this._abortController.signal
    })

    if (!response.body) {
      return {
        ok: response.ok,
        status: response.status,
        getReader: () => ({
          read: () => Promise.resolve({ done: true, value: undefined }),
          releaseLock: () => {}
        })
      }
    }

    // 包装 fetch reader，统一返回文本
    const rawReader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    return {
      ok: response.ok,
      status: response.status,
      getReader: () => ({
        read: async () => {
          const { done, value } = await rawReader.read()
          if (done) return { done: true, value: undefined }
          return { done: false, value: decoder.decode(value, { stream: true }) }
        },
        releaseLock: () => rawReader.releaseLock()
      })
    }
  }

  /**
   * 测试 AI API 连接是否可用
   * 发送一个极简请求，根据响应判断连接状态
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async testConnection() {
    await this.ensureInitialized()
    try {
      const url = buildChatURL(this.baseURL, this.autoComplete)
      const body = JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5
      })
      const response = await this._fetchAPI(url, body)
      if (response.ok) return { success: true, message: '连接成功！' }
      const err = await response.json().catch(() => ({}))
      return {
        success: false,
        message: `连接失败: ${err.error?.message || response.status}`
      }
    } catch (e) {
      return { success: false, message: `连接失败: ${e.message}` }
    }
  }

  /**
   * 普通对话（非流式）
   * @param {string} userMessage 用户消息
   * @param {string} systemPrompt 系统提示词
   * @param {Array|null} tools 工具定义
   * @param {object} options 额外选项 { webSearch: boolean, responseFormat: 'json' }
   * @returns {Promise<object>} choices[0] 结果
   */
  async chat(userMessage, systemPrompt = '', tools = null, options = {}) {
    await this.ensureInitialized()
    // 已被用户停止：直接中断，不再发出新请求（批量挖空等流程靠此快速终止）
    if (this._abortedTokens.has(this._activeRunToken)) {
      const err = new Error('已停止')
      err.aborted = true
      throw err
    }
    const messages = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push({ role: 'user', content: userMessage })

    // 如果开启联网搜索，先搜索
    if (options.webSearch && messages.length > 0) {
      const lastUserMsg = messages.filter(m => m.role === 'user').pop()
      if (lastUserMsg) {
        const query = typeof lastUserMsg.content === 'string'
          ? lastUserMsg.content
          : lastUserMsg.content?.map(c => c.text || '').join(' ') || ''
        if (query.length > 0) {
          const searchResults = await searchWeb(query.substring(0, 100))
          if (searchResults.length > 0) {
            const searchContext = searchResults.map((r, i) =>
              `[${i+1}] ${r.title}\n${r.snippet}\nURL: ${r.link}`
            ).join('\n\n')
            // 添加系统消息作为搜索上下文
            messages.push({
              role: 'system',
              content: `以下是联网搜索到的相关信息，请参考这些信息回答用户问题：\n\n${searchContext}`
            })
          }
        }
      }
    }

    // 请求发出前已被停止（如搜索期间用户点了停止）
    if (this._abortedTokens.has(this._activeRunToken)) {
      const err = new Error('已停止')
      err.aborted = true
      throw err
    }

    const body = { model: this.model, messages, temperature: options.temperature ?? this.temperature ?? 0.7 }
    if (tools) body.tools = tools
    if (Number.isFinite(options.max_tokens) && options.max_tokens > 0) body.max_tokens = options.max_tokens

    // JSON 严格模式：支持的供应商会强制输出合法 JSON，从源头减少解析失败
    if (options.responseFormat === 'json') {
      body.response_format = { type: 'json_object' }
    }

    let response = await this._fetchAPI(buildChatURL(this.baseURL, this.autoComplete), JSON.stringify(body))
    // 部分供应商不支持 response_format：收到 4xx 时去掉该参数重试一次
    if (!response.ok && options.responseFormat === 'json') {
      delete body.response_format
      response = await this._fetchAPI(buildChatURL(this.baseURL, this.autoComplete), JSON.stringify(body))
    }
    if (!response.ok) throw new Error(`API error: ${response.status}`)
    // 请求期间用户点了停止：丢弃结果，直接抛出中断
    if (this._abortedTokens.has(this._activeRunToken)) {
      const err = new Error('已停止')
      err.aborted = true
      throw err
    }
    const data = await response.json()
    const choice = data.choices[0]
    // MiniMax 等推理模型会在 content 中输出 <think> 思考过程：剥离后再交给调用方（挖空 JSON 解析等依赖干净文本）
    if (typeof choice?.message?.content === 'string') {
      choice.message.content = stripThinkBlocks(choice.message.content)
    }
    return choice
  }

  /**
   * 流式对话（SSE）
   * 逐字 yield content 片段，同时也会 yield tool_calls 片段
   * @param {string} userMessage 用户消息
   * @param {string} systemPrompt 系统提示词
   * @param {Array|null} tools 工具定义
   * @yields {{ type: 'content'|'tool_calls', content?: string, tool_calls?: object }}
   */
  async *chatStream(userMessage, systemPrompt = '', tools = null) {
    await this.ensureInitialized()

    const messages = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push({ role: 'user', content: userMessage })

    const body = {
      model: this.model,
      messages,
      temperature: this.temperature ?? 0.7,
      stream: true
    }
    if (tools) {
      body.tools = tools
    }

    const streamResponse = await this._fetchStream(buildChatURL(this.baseURL, this.autoComplete), JSON.stringify(body))

    if (!streamResponse.ok) {
      throw new Error(`API error: ${streamResponse.status}`)
    }

    const reader = streamResponse.getReader()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          // IPC 流中途出错时 onError 以 done 收尾：检查 streamError，非空则按错误抛出而非静默结束
          const streamErr = typeof reader.getError === 'function' ? reader.getError() : null
          if (streamErr) {
            throw streamErr instanceof Error ? streamErr : new Error(String(streamErr?.message || streamErr))
          }
          break
        }

        // value 已经是文本字符串
        buffer += value

        // 按换行符分割缓冲区，保留最后一段不完整的（可能还有后续数据）
        const lines = buffer.split('\n')
        // 最后一段可能是不完整的行，留到下次处理
        buffer = lines.pop() || ''

        for (const rawLine of lines) {
          const line = rawLine.trim()
          // 跳过空行和注释行
          if (!line) continue
          if (line.startsWith(':')) continue

          // 只处理 data: 开头的行
          if (!line.startsWith('data:')) continue

          // 去除 "data:" 前缀，去除可能的空格
          const dataStr = line.slice(5).trim()

          // 结束标记
          if (dataStr === '[DONE]') {
            return
          }

          let parsed
          try {
            parsed = JSON.parse(dataStr)
          } catch (e) {
            // JSON 解析失败，跳过这一行（可能是分片不完整）
            continue
          }

          const choices = parsed.choices
          if (!choices || choices.length === 0) continue

          const delta = choices[0].delta
          if (!delta) continue

          // 处理文本内容
          if (delta.content) {
            yield { type: 'content', content: delta.content }
          }

          // 处理工具调用
          if (delta.tool_calls) {
            yield { type: 'tool_calls', tool_calls: delta.tool_calls }
          }

          // 处理 finish_reason（部分服务在此处给出结束信号）
          if (choices[0].finish_reason) {
            // finish_reason 为 stop / tool_calls 等时，流可能仍在继续，
            // 由 [DONE] 统一结束，这里不做提前 return
          }
        }
      }

      // 处理缓冲区中剩余的数据
      const remaining = buffer.trim()
      if (remaining && remaining.startsWith('data:')) {
        const dataStr = remaining.slice(5).trim()
        if (dataStr && dataStr !== '[DONE]') {
          try {
            const parsed = JSON.parse(dataStr)
            const choices = parsed.choices
            if (choices && choices.length > 0) {
              const delta = choices[0].delta
              if (delta) {
                if (delta.content) {
                  yield { type: 'content', content: delta.content }
                }
                if (delta.tool_calls) {
                  yield { type: 'tool_calls', tool_calls: delta.tool_calls }
                }
              }
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * 带工具调用的对话
   * 1. 发送请求带 tools 参数
   * 2. 如果返回 tool_calls，调用 onToolCall 处理
   * 3. 将工具结果作为 tool 角色消息追加
   * 4. 再次发送请求获取最终回复
   * @param {string} userMessage 用户消息
   * @param {string} systemPrompt 系统提示词
   * @param {Array} tools 工具定义
   * @param {Function} onToolCall 工具调用回调 (toolCall) => result
   * @returns {Promise<object>} 最终回复
   */
  async chatWithTools(userMessage, systemPrompt, tools, onToolCall) {
    await this.ensureInitialized()

    const messages = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push({ role: 'user', content: userMessage })

    // 第一轮：发送请求，带 tools 参数
    const body = {
      model: this.model,
      messages,
      temperature: this.temperature ?? 0.7,
      tools
    }

    const response = await this._fetchAPI(buildChatURL(this.baseURL, this.autoComplete), JSON.stringify(body))

    if (!response.ok) throw new Error(`API error: ${response.status}`)
    const data = await response.json()
    const choice = data.choices[0]

    // 如果模型没有调用工具，直接返回文本回复
    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      return choice
    }

    // 将 assistant 的工具调用消息追加到对话中
    messages.push({
      role: 'assistant',
      content: choice.message.content || '',
      tool_calls: choice.message.tool_calls
    })

    // 逐个处理工具调用，将结果作为 tool 角色消息追加
    for (const toolCall of choice.message.tool_calls) {
      const toolResult = await onToolCall(toolCall)
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: safeStringifyResult(toolResult)
      })
    }

    // 第二轮：带上工具结果再次发送请求，获取最终回复
    const secondBody = {
      model: this.model,
      messages,
      temperature: this.temperature ?? 0.7
    }

    const secondResponse = await this._fetchAPI(buildChatURL(this.baseURL, this.autoComplete), JSON.stringify(secondBody))

    if (!secondResponse.ok) throw new Error(`API error: ${secondResponse.status}`)
    const secondData = await secondResponse.json()
    return secondData.choices[0]
  }

  /**
   * 带回调的流式对话（支持工具调用 + 多轮）
   * 这是 ChatPanel 使用的主要接口
   * @param {object} param0 { messages, tools, allTools, configOverride }
   *   - tools: 首轮激活的工具（核心集）
   *   - allTools: 全量工具池（get_tool_definitions 激活后从中补充进后续轮次）
   *   - configOverride: 可选 { baseURL, apiKey, model }，本次运行使用的独立配置档（如多模态）
   * @param {object} callbacks { onChunk, onToolCall, onDone, onError, onPlan, onStepDone, onBeforeRetry }
   *   - onBeforeRetry(hits)：自动工具发现兜底触发时回调（界面应清空已流式输出的首答），hits=[{name,desc}]
   */
  async chatWithCallbacks({ messages, tools, allTools, runToken, configOverride, toolMetadata }, callbacks = {}) {
    const { onChunk, onToolCall, onDone, onError, onPlan, onStepDone, onBeforeRetry } = callbacks
    await this.ensureInitialized()
    this._resetAbort()
    // 本次运行实际使用的连接配置：默认当前配置，多模态带图消息等场景传入独立配置档
    const cfg = configOverride && configOverride.baseURL
      ? {
          baseURL: configOverride.baseURL,
          apiKey: configOverride.apiKey || '',
          model: configOverride.model || this.model,
          autoComplete: configOverride.autoComplete !== false
        }
      : { baseURL: this.baseURL, apiKey: this.apiKey, model: this.model, autoComplete: this.autoComplete }
    // 登记新一代运行；传入 runToken 的旧循环在代际更新后自动判定过期
    const token = runToken ?? Symbol('run')
    this._activeRunToken = token
    const isStale = () => this._activeRunToken !== token
    this._inLoop = true

    let currentMessages = [...messages]
    // 动态轮次上限：基础 8 轮；模型输出计划后按"步骤数+4"放宽；
    // 轮次用尽但模型仍在调用工具时自动延长（最多 2 次、每次 +3），支持长链复杂任务
    let maxRounds = 8
    let extensions = 0
    // Plan-and-Execute：<plan>/<step-done> 标记从显示文本剥离（整个循环共用一个过滤器）
    const planFilter = createPlanStreamFilter({
      onPlan: (steps) => {
        maxRounds = Math.max(maxRounds, steps.length + 4)
        if (onPlan) onPlan(steps)
      },
      onStepDone
    })
    // 动态工具激活：工具池默认 = 首轮 tools；get_tool_definitions 返回 activatedTools 后扩充
    const toolPool = Array.isArray(allTools) && allTools.length > 0 ? allTools : (tools || [])
    let activeTools = Array.isArray(tools) ? [...tools] : []
    const toolMetadataMap = new Map(Object.entries(toolMetadata || {}))
    const toolCallCounts = new Map()
    // 缓存前缀稳定：核心工具集保持首轮固定顺序（稳定前缀），激活工具按名字排序追加到末尾，
    // 不随激活顺序变化 → 最大化前缀缓存命中
    const coreToolNames = new Set(activeTools.map(t => t.function.name))
    const syncActiveToolsOrder = () => {
      const core = activeTools.filter(t => coreToolNames.has(t.function.name))
      const extra = activeTools
        .filter(t => !coreToolNames.has(t.function.name))
        .sort((a, b) => a.function.name.localeCompare(b.function.name))
      activeTools = [...core, ...extra]
    }
    // 自动工具发现兜底：整轮未调用工具时，用用户原话检索目录命中未激活工具 → 激活并重答一次
    const latestUserQuery = extractLatestUserQuery(messages)
    let anyToolCalled = false
    let autoDiscoveryTried = false
    let emptyResponseRetryTried = false

    try {
      let round = 0
      let lastRoundHadTools = false
      while (true) {
        // 用户已点击停止 / 本轮运行已过期（新一轮已启动或会话已切换）：静默退出
        if (this._abortedTokens.has(token) || isStale()) {
          if (!isStale() && onDone) onDone()
          return
        }
        // 轮次控制：用尽时若模型仍在调工具则放宽，否则收尾
        if (round >= maxRounds) {
          if (lastRoundHadTools && extensions < 2) {
            extensions++
            maxRounds += 3
          } else {
            break
          }
        }
        round++

        // 循环内溢出保护：工具调用多轮后 currentMessages 会持续增长（assistant+tool result对），
        // 若总字符数超过安全阈值，从最前面（跳过system）删除最早的 assistant+tool 对，保留最后几轮
        const SAFE_CHARS = 280000 // ~70K tokens，留足响应空间
        const trimMessagesIfNeeded = (msgs) => {
          const trySerialize = () => { try { return JSON.stringify(msgs); } catch { return '' } }
          let serialized = trySerialize()
          while (serialized.length > SAFE_CHARS && msgs.length > 6) {
            // 找第一条非system消息开始的assistant，删除它及其后面的连续tool结果
            let startIdx = 0
            for (let i = 0; i < msgs.length; i++) {
              if (msgs[i].role !== 'system') { startIdx = i; break }
            }
            // 从startIdx开始找第一个assistant
            let delEnd = -1
            for (let i = startIdx; i < msgs.length; i++) {
              if (msgs[i].role === 'assistant') {
                // 找到这个assistant后面的连续tool结果
                delEnd = i + 1
                while (delEnd < msgs.length && msgs[delEnd].role === 'tool') delEnd++
                // 不删除最后3条消息（保留当前轮）
                if (delEnd >= msgs.length - 3) break
                msgs.splice(startIdx, delEnd - startIdx)
                break
              }
            }
            // 如果无法再删除（没有assistant或已到尾部），强制截断第一条非system消息的content
            if (delEnd < 0 || msgs.length <= 6) break
            serialized = trySerialize()
          }
          return msgs
        }
        trimMessagesIfNeeded(currentMessages)

        const body = {
          model: cfg.model,
          messages: currentMessages,
          temperature: this.temperature ?? 0.7,
          stream: true
        }
        if (activeTools.length > 0) {
          body.tools = activeTools
        }

        const streamResponse = await this._fetchStream(buildChatURL(cfg.baseURL, cfg.autoComplete), JSON.stringify(body), cfg.apiKey)

        if (!streamResponse.ok) {
          throw new Error(`API error: ${streamResponse.status}`)
        }

        const reader = streamResponse.getReader()
        let buffer = ''
        // rawContent 保留 <plan> 等标记（喂回模型保持计划上下文）；fullContent 为界面显示的净文本
        let rawContent = ''
        let fullContent = ''
        // 每轮独立过滤 <think> 思考过程（只影响 content 文本，tool_calls 是独立字段不受影响）
        const thinkFilter = createThinkStreamFilter()
        let toolCalls = [] // 收集工具调用
        let finishReason = null

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              // IPC 流中途出错时 onError 以 done 收尾：检查 streamError，非空则按错误抛出而非静默结束
              const streamErr = typeof reader.getError === 'function' ? reader.getError() : null
              if (streamErr) {
                throw streamErr instanceof Error ? streamErr : new Error(String(streamErr?.message || streamErr))
              }
              break
            }

            // value 已经是文本字符串
            buffer += value
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const rawLine of lines) {
              const line = rawLine.trim()
              if (!line || line.startsWith(':')) continue
              if (!line.startsWith('data:')) continue

              const dataStr = line.slice(5).trim()
              if (dataStr === '[DONE]') continue

              let parsed
              try {
                parsed = JSON.parse(dataStr)
              } catch {
                continue
              }

              const choices = parsed.choices
              if (!choices || choices.length === 0) continue

              const delta = choices[0].delta
              if (!delta) continue

              // 文本内容：先剥 <think>，再过滤 <plan>/<step-done> 标记（仅影响显示，rawContent 保留）
              if (delta.content) {
                const noThink = thinkFilter.push(delta.content)
                if (noThink) {
                  rawContent += noThink
                  const visible = planFilter.push(noThink)
                  if (visible) {
                    fullContent += visible
                    if (onChunk) onChunk(visible)
                  }
                }
              }

              // 工具调用（流式增量）
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index || 0
                  if (!toolCalls[idx]) {
                    toolCalls[idx] = {
                      id: tc.id || '',
                      type: 'function',
                      function: { name: '', arguments: '' }
                    }
                  }
                  if (tc.id) toolCalls[idx].id = tc.id
                  if (tc.function?.name) toolCalls[idx].function.name += tc.function.name
                  if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments
                }
              }

              if (choices[0].finish_reason) {
                finishReason = choices[0].finish_reason
              }
            }
          }
        } finally {
          reader.releaseLock()
        }

        // 流结束：释放可能滞留的半截标签缓冲（仍在未闭合 think 内的部分直接丢弃）
        const thinkTail = thinkFilter.flush()
        if (thinkTail) {
          rawContent += thinkTail
          const visible = planFilter.push(thinkTail)
          if (visible) {
            fullContent += visible
            if (onChunk) onChunk(visible)
          }
        }
        const planTail = planFilter.flush()
        if (planTail) {
          rawContent += planTail
          fullContent += planTail
          if (onChunk) onChunk(planTail)
        }

        // 过滤掉空的工具调用
        toolCalls = toolCalls.filter(tc => tc && tc.function && tc.function.name)

        // 用户已点击停止 / 本轮已过期：不再执行后续工具调用与请求轮次
        if (this._abortedTokens.has(token) || isStale()) {
          if (!isStale() && onDone) onDone()
          return
        }

        // 工具调用执行判定：
        // - 标准接口：finish_reason === 'tool_calls'
        // - 缺陷中转站：只返回 'stop' 或不返回 finish_reason，但工具调用增量完整。
        //   放宽标准：参数全部为完整合法 JSON（流已正常收尾）时同样执行；
        //   被 max_tokens 截断（finish_reason='length'）时参数为非法 JSON，自然不会通过。
        const argsComplete = toolCalls.every(tc => {
          const args = tc.function.arguments
          if (!args) return true
          try { JSON.parse(args); return true } catch { return false }
        })
        const shouldRunTools = toolCalls.length > 0 &&
          (finishReason === 'tool_calls' || argsComplete)

        // 没有可执行的工具调用：尝试自动工具发现兜底（一次），否则完成（过期运行不再回调，静默退出）
        if (!shouldRunTools) {
          // 推理型模型可能把输出预算耗在 <think> 中，工具已执行但最终可见内容为空。
          // 这里注入极简恢复指令并只重试一次，避免界面表现为“运行完但停止/无回复”。
          if (anyToolCalled && !rawContent && !emptyResponseRetryTried && !this._aborted && !isStale()) {
            emptyResponseRetryTried = true
            currentMessages.push({
              role: 'system',
              content: '【系统恢复指令】上一轮工具已执行成功，但没有产生任何可见回复。不要输出思考过程，不要重复解释。若用户要求修改导图且下一步工具明确，请立即调用该工具；否则用不超过200字中文汇报工具结果。'
            })
            lastRoundHadTools = false
            continue
          }
          if (!anyToolCalled && !autoDiscoveryTried && latestUserQuery && !this._aborted && !isStale()) {
            const activeNames = new Set(activeTools.map(t => t.function.name))
            // 第一级：本地 n-gram 匹配（零成本）
            let hits = matchToolsByText(latestUserQuery, toolPool, activeNames)
            // 第二级：首答疑似"拒答"且本地未命中 → 一次语义检索（把紧凑目录发给模型挑选）
            if (hits.length === 0 && REFUSAL_RE.test(rawContent)) {
              hits = await semanticToolMatch(latestUserQuery, toolPool, activeNames)
            }
            if (hits.length > 0) {
              autoDiscoveryTried = true
              const defs = hits
                .map(h => toolPool.find(t => t.function.name === h.name))
                .filter(Boolean)
              for (const d of defs) {
                if (!activeTools.includes(d)) activeTools.push(d)
              }
              syncActiveToolsOrder()
              // 保留首答进上下文（模型需要知道自己说过什么），再注入系统提示引导其用工具重答
              currentMessages.push({ role: 'assistant', content: rawContent || null })
              currentMessages.push({
                role: 'system',
                content: `【系统提示】检测到本次需求可能匹配以下未激活工具：${hits.map(h => `${h.name}（${h.desc}…）`).join('；')}。请直接调用其中合适的工具完成用户请求；确需多个工具时先输出任务计划再逐个调用。`
              })
              if (onBeforeRetry) onBeforeRetry(hits)
              lastRoundHadTools = false
              continue
            }
          }
          if (!isStale() && onDone) onDone()
          return
        }
        anyToolCalled = true

        // 有工具调用：执行工具并继续对话
        // 先将 assistant 消息（含 tool_calls）加入消息列表（rawContent 保留计划标记供后续轮次参考）
        currentMessages.push({
          role: 'assistant',
          content: rawContent || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments }
          }))
        })

        // 执行工具调用：
        // - 全部为只读工具（查询/检索类，无副作用）→ 并行执行，缩短等待
        // - 含写操作 → 串行执行，避免竞态
        const readOnly = toolCalls.every(tc => PARALLEL_SAFE_TOOLS.has(tc.function.name))
        const results = new Array(toolCalls.length)
        const runOne = async (tc, index) => {
          const metadata = toolMetadataMap.get(tc.function.name) || {}
          const usedCount = toolCallCounts.get(tc.function.name) || 0
          if (Number.isFinite(metadata.maxCallsPerTask) && usedCount >= metadata.maxCallsPerTask) {
            return {
              success: false,
              message: `工具 ${tc.function.name} 已达到本次任务调用上限（${metadata.maxCallsPerTask} 次）。请基于已有结果继续，或请用户确认后重新发起任务。`
            }
          }
          toolCallCounts.set(tc.function.name, usedCount + 1)
          // 用户已点击停止 / 本轮已过期：中断工具执行链
          if (this._abortedTokens.has(token) || isStale()) return { success: false, message: '用户已停止 AI 运行' }
          if (!onToolCall) return null
          const toolCallObj = {
            id: tc.id,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments
            }
          }
          const result = await onToolCall(toolCallObj)

          // 动态工具激活：get_tool_definitions 返回 activatedTools，下一轮即可直接调用
          if (result && Array.isArray(result.activatedTools) && result.activatedTools.length > 0) {
            for (const n of result.activatedTools) {
              const def = toolPool.find(t => t.function.name === n)
              if (def && !activeTools.includes(def)) activeTools.push(def)
            }
            syncActiveToolsOrder()
          }
          return result
        }

        if (toolCalls.length > 1) {
          // 混合批处理：只读部分并行执行，写操作保持串行，避免整批退化为串行。
          const readOnlyCalls = toolCalls.map((tc, index) => ({ tc, index })).filter(({ tc }) => PARALLEL_SAFE_TOOLS.has(tc.function.name))
          const writeCalls = toolCalls.map((tc, index) => ({ tc, index })).filter(({ tc }) => !PARALLEL_SAFE_TOOLS.has(tc.function.name))
          await Promise.all(readOnlyCalls.map(({ tc, index }) => runOne(tc, index).then(result => { results[index] = result })))
          for (const { tc, index } of writeCalls) {
            if (this._abortedTokens.has(token) || isStale()) break
            results[index] = await runOne(tc, index)
          }
        } else if (toolCalls.length === 1) {
          results[0] = await runOne(toolCalls[0], 0)
        }

        // 按原始顺序回传工具结果（与 tool_call_id 一一对应）
        for (let i = 0; i < toolCalls.length; i++) {
          const r = results[i]
          let contentStr
          const msg = r && typeof r.message === 'string' ? r.message : ''
          const userStopped = msg.includes('用户取消') || msg.includes('用户已停止')
          if (r && r.success === false && !userStopped) {
            // 失败自恢复：在工具结果中注入恢复引导，让模型自主换路径重试而不是中断汇报
            contentStr = safeStringifyResult({
              ...r,
              _recovery_hint: '该工具执行失败。请自主恢复，禁止直接中断向用户道歉：①分析错误原因，修正参数后重试（最多2次）；②换用等效工具（如 set_node_style / batch_node_actions / batch_text_style 可互换）；③把任务拆成更小的步骤。全部尝试仍失败才向用户简要说明原因与已尝试的方案。'
            })
          } else {
            contentStr = safeStringifyResult(r ?? { success: false, message: '未执行' })
          }
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCalls[i].id,
            content: contentStr
          })
        }

        // 继续下一轮，让模型根据工具结果生成回复
        lastRoundHadTools = true
      }

      // 超过最大轮次（过期运行不回调，静默退出）
      if (!isStale() && onDone) onDone()
    } catch (error) {
      // 过期运行的错误不渲染（会话已切换/新运行已启动，错误不属于当前界面）
      if (isStale()) return
      if (onError) onError(error)
      else throw error
    } finally {
      this._inLoop = false
    }
  }
}

export const aiService = new AIService()

export default aiService

