/**
 * 模型上下文窗口表 + 上下文体积估算
 * 用于对话上下文压缩：估算当前上下文 token 数，超过模型窗口 60% 时触发增量摘要压缩。
 *
 * 窗口表分两层：内置主流模型表（参考值）+ 用户自定义覆盖（localStorage，可被 AI 工具增删改）。
 * 查询优先级：用户覆盖 > 内置表 > 兜底默认值。
 */

// 内置主流模型上下文窗口（token 数，参考值；用户可通过 set_context_window 工具覆盖）
export const DEFAULT_CONTEXT_WINDOWS = {
  // OpenAI
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4-vision': 128000,
  'gpt-4.1': 1048576,
  'gpt-4.1-mini': 1048576,
  'gpt-4.1-nano': 1048576,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16384,
  'o1': 200000,
  'o3': 200000,
  'o4-mini': 200000,
  // Anthropic
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-3.5-sonnet': 200000,
  'claude-3.7-sonnet': 200000,
  'claude-4': 200000,
  // Google
  'gemini-1.5-pro': 1048576,
  'gemini-1.5-flash': 1048576,
  'gemini-2.0-flash': 1048576,
  'gemini-2.0-pro': 1048576,
  // DeepSeek
  'deepseek-chat': 128000,
  'deepseek-reasoner': 128000,
  'deepseek-v3': 128000,
  'deepseek-r1': 128000,
  // 智谱 GLM
  'glm-4': 128000,
  'glm-4-flash': 128000,
  'glm-4-plus': 128000,
  'glm-4v': 128000,
  'glm-4.5': 128000,
  'glm-4.6': 200000,
  // 通义千问
  'qwen-max': 131072,
  'qwen-plus': 131072,
  'qwen-turbo': 131072,
  'qwen-long': 10485760,
  'qwen-vl-max': 32000,
  'qwen2.5-vl': 128000,
  'qwen3-vl': 131072,
  'qvq-max': 131072,
  // Kimi / Moonshot
  'moonshot-v1-8k': 8192,
  'moonshot-v1-32k': 32768,
  'moonshot-v1-128k': 128000,
  'kimi-latest': 128000,
  // 百度文心
  'ernie-4.0': 128000,
  'ernie-4.5': 128000,
  'ernie-4.0-turbo': 128000,
  // 腾讯混元
  'hunyuan-turbo': 131072,
  'hunyuan-lite': 262144,
  // 字节豆包
  'doubao-1.5-pro': 256000,
  'doubao-1.5-lite': 256000,
  // MiniMax
  'minimax-text': 245760,
  'abab6.5': 245760,
  // 本地 Ollama / 开源
  'llama3': 8192,
  'llama3.1': 128000,
  'qwen2': 32768,
  'qwen2.5': 32768,
  'mistral': 32768,
  'phi3': 4096
}

// 兜底窗口（查不到模型名时用，绝大多数模型 ≥ 32K）
export const DEFAULT_WINDOW = 32000

// 触发压缩的阈值比例（估算 token 超过 窗口 × 该比例 时压缩）
export const COMPRESS_THRESHOLD_RATIO = 0.5

// review B2：从 8 提到 12，保留更多对话轮原文，避免结构化表格/代码块/列表被压成 1~2 行摘要后失真。
// 估算阈值 COMPRESS_THRESHOLD_RATIO=0.5（32K 模型窗口 × 0.5 = 16K 触发压缩），保留 12 轮约 6K tokens，
// 留出余量给 system prompt + 工具定义 + 当前问题。
export const KEEP_RECENT_ROUNDS = 12

const STORAGE_KEY = 'mindmap_context_window_overrides'

// 读取用户自定义覆盖表
export function loadUserContextWindows() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

// 保存用户自定义覆盖表
export function saveUserContextWindows(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map || {}))
    return true
  } catch {
    return false
  }
}

// 查询某模型的上下文窗口（用户覆盖 > 内置表 > 兜底）
export function getContextWindow(modelName) {
  if (!modelName) return DEFAULT_WINDOW
  const key = String(modelName).trim().toLowerCase()
  const user = loadUserContextWindows()
  if (user[key]) return Number(user[key])
  if (DEFAULT_CONTEXT_WINDOWS[key]) return DEFAULT_CONTEXT_WINDOWS[key]
  return DEFAULT_WINDOW
}

// 查询单个模型窗口详情（带来源，供 AI 工具使用；查不到返回兜底 + source=default）
export function queryContextWindow(modelName) {
  const name = String(modelName || '').trim().toLowerCase()
  if (!name) return { success: false, error: '缺少模型名称' }
  const user = loadUserContextWindows()
  if (user[name]) return { success: true, model: name, context_window: Number(user[name]), source: 'user' }
  if (DEFAULT_CONTEXT_WINDOWS[name]) return { success: true, model: name, context_window: DEFAULT_CONTEXT_WINDOWS[name], source: 'builtin' }
  return { success: true, model: name, context_window: DEFAULT_WINDOW, source: 'default' }
}

// 列出全部窗口表（内置 + 用户覆盖，用户覆盖标注 source）
export function listAllContextWindows() {
  const user = loadUserContextWindows()
  const merged = { ...DEFAULT_CONTEXT_WINDOWS, ...user }
  return Object.keys(merged)
    .map((name) => ({
      model: name,
      context_window: Number(merged[name]),
      source: user[name] ? 'user' : 'builtin'
    }))
    .sort((a, b) => a.model.localeCompare(b.model))
}

// 设置/更新某模型的窗口（写入用户覆盖层）
export function setContextWindow(modelName, contextWindow) {
  const name = String(modelName || '').trim().toLowerCase()
  const win = Math.floor(Number(contextWindow))
  if (!name) return { success: false, error: '缺少模型名称' }
  if (!Number.isFinite(win) || win <= 0) return { success: false, error: '窗口大小必须是正整数（token 数）' }
  const map = loadUserContextWindows()
  map[name] = win
  saveUserContextWindows(map)
  return { success: true, model: name, context_window: win }
}

// 删除某模型的用户自定义窗口（回退到内置表或兜底）
export function deleteContextWindow(modelName) {
  const name = String(modelName || '').trim().toLowerCase()
  if (!name) return { success: false, error: '缺少模型名称' }
  const map = loadUserContextWindows()
  if (!(name in map)) return { success: false, error: `该模型「${name}」没有自定义窗口记录` }
  delete map[name]
  saveUserContextWindows(map)
  return { success: true, model: name }
}

// 字符数估算 token：中文约 1 字 1 token，其余字符约 3 字符 1 token（保守偏高，保证不低估）
export function estimateTokens(text) {
  if (!text) return 0
  const s = String(text)
  let cn = 0
  let other = 0
  for (const ch of s) {
    // 中文字符（含中文标点、全角符号）：实际BPE分词约 1字≈1.5-2 tokens，取保守值1.6
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) cn++
    else other++
  }
  // 中文1.6token/字，英文4字符/token，再加 15% 结构开销（JSON括号/键名/role字段等）
  const raw = cn * 1.6 + other / 3.5
  return Math.ceil(raw * 1.15)
}

// 估算工具定义的 tokens（每个工具的JSON schema）
export function estimateToolsTokens(tools) {
  if (!tools || !tools.length) return 0
  // 工具schema平均每个约 200-400 tokens（取决于参数数量），保守按 300 tokens/个 + 20% 结构开销
  return Math.ceil(tools.length * 300 * 1.2)
}
