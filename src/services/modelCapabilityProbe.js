/**
 * 模型能力自动发现引擎
 *
 * 核心思想：用户只需要填 baseURL + API Key + model name，
 * 系统自动探测这个服务支持哪些能力，不用用户一个个配置。
 *
 * 探测项目：
 *   - 多模态/视觉能力
 *   - 工具调用 (function calling)
 *   - 流式输出
 *   - files API 可用性
 *   - 最大上下文长度（近似估算）
 *
 * 探测策略：
 *   - 懒探测：第一次需要用到某个能力时才探测，不是启动就全测
 *   - 最小代价：用最小的请求（如 1x1 透明图、空工具列表）来验证
 *   - 缓存结果：24小时内不重复探测
 *   - 渐进式：失败也不报错，只是标记为"不支持"，走降级方案
 */

import { detectProvider } from './fileUploadService.js'
import { isKnownTextOnlyModel } from './multimodalRouter.js'

// ============================================================
//  能力缓存
// ============================================================

const CAPABILITY_KEY = 'model_capability_discovery'
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24小时

function loadCache() {
  try {
    const raw = localStorage.getItem(CAPABILITY_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw)
    // 清理过期
    const now = Date.now()
    for (const key of Object.keys(data)) {
      if (data[key].timestamp && now - data[key].timestamp > CACHE_TTL) {
        delete data[key]
      }
    }
    return data
  } catch { return {} }
}

function saveCache(cache) {
  try { localStorage.setItem(CAPABILITY_KEY, JSON.stringify(cache)) } catch {}
}

function getCacheKey(baseURL, model) {
  return `${String(baseURL || '').trim()}::${String(model || '').trim()}`
}

// ============================================================
//  能力查询
// ============================================================

/**
 * 获取模型能力（从缓存读取，不触发探测）
 * @returns {object|null} 能力对象，null 表示尚未探测
 */
export function getModelCapability(baseURL, model) {
  const cache = loadCache()
  const key = getCacheKey(baseURL, model)
  const entry = cache[key]
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL) return null
  return entry.capabilities
}

/**
 * 保存模型能力到缓存
 */
export function setModelCapability(baseURL, model, capabilities) {
  const cache = loadCache()
  const key = getCacheKey(baseURL, model)
  cache[key] = {
    capabilities,
    timestamp: Date.now()
  }
  saveCache(cache)
}

/**
 * 更新模型能力的某个字段
 */
export function updateModelCapability(baseURL, model, patch) {
  const cache = loadCache()
  const key = getCacheKey(baseURL, model)
  const existing = cache[key]?.capabilities || {}
  cache[key] = {
    capabilities: { ...existing, ...patch },
    timestamp: Date.now()
  }
  saveCache(cache)
}

// ============================================================
//  能力探测（实际发请求验证）
// ============================================================

/**
 * 探测模型是否支持多模态视觉能力
 *
 * 原理：发一个带极小透明图片（1x1）的聊天请求，看模型接不接受。
 * - 如果成功 → 支持多模态
 * - 如果报"不支持 image 类型"之类的错 → 不支持多模态
 *
 * 注意：这个探测很轻量，几乎不消耗 token
 *
 * @param {object} opts
 *   - baseURL, model, profileId
 *   - sendChatFn: 发送聊天请求的函数 (messages, opts) => Promise
 * @returns {Promise<boolean>}
 */
export async function probeVisionCapability({ baseURL, model, profileId, sendChatFn }) {
  // 先检查已知纯文本模型（直接返回 false，不浪费请求）
  if (isKnownTextOnlyModel(model)) {
    setModelCapability(baseURL, model, { vision: false, visionProbed: true })
    return false
  }

  // 1x1 透明 PNG 的 base64（极小，几乎不占 token）
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const dataUrl = `data:image/png;base64,${tinyPngBase64}`

  try {
    await sendChatFn(
      [
        { role: 'system', content: 'You are a helpful assistant.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hi' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ],
      {
        maxTokens: 1,       // 只要能返回就行，不需要内容
        stream: false,      // 不用流式，更快判断
        temperature: 0
      }
    )

    // 成功 → 支持多模态
    updateModelCapability(baseURL, model, {
      vision: true,
      visionProbed: true,
      visionSupportsImageUrl: true
    })
    return true
  } catch (e) {
    const msg = (e.message || '').toLowerCase()
    // 明确说不支持 image → 标记为不支持
    if (/not support.*image|image.*not.*support|content.*type.*invalid|不支持.*图片|image_url.*invalid/.test(msg)) {
      updateModelCapability(baseURL, model, {
        vision: false,
        visionProbed: true,
        visionError: msg
      })
      return false
    }
    // 其他错误（网络、鉴权等）→ 不标记，下次再试
    return null // null = 未知
  }
}

/**
 * 探测模型是否支持工具调用 (function calling)
 *
 * 原理：发一个带空 tools 列表的请求，看模型接不接受。
 *
 * @param {object} opts
 * @returns {Promise<boolean|null>}
 */
export async function probeToolCapability({ baseURL, model, profileId, sendChatFn }) {
  try {
    await sendChatFn(
      [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'hi' }
      ],
      {
        tools: [],
        tool_choice: 'none',
        maxTokens: 1,
        stream: false,
        temperature: 0
      }
    )

    updateModelCapability(baseURL, model, {
      toolCalling: true,
      toolProbed: true
    })
    return true
  } catch (e) {
    const msg = (e.message || '').toLowerCase()
    if (/tool.*not.*support|不支持.*tool|function.*call.*not.*support|不支持.*函数/.test(msg)) {
      updateModelCapability(baseURL, model, {
        toolCalling: false,
        toolProbed: true,
        toolError: msg
      })
      return false
    }
    return null // 未知错误，不标记
  }
}

/**
 * 探测 files API 是否可用（以及支持的文件类型）
 *
 * 原理：尝试上传一个极小的文本文件到 files API
 *
 * @param {object} opts
 *   - baseURL, profileId, filesURL
 *   - uploadFn: 上传函数
 * @returns {Promise<object>}
 */
export async function probeFilesApi({ baseURL, profileId, filesURL, uploadFn }) {
  const tinyText = 'hello'
  const tinyBase64 = Buffer.from(tinyText).toString('base64')

  try {
    const result = await uploadFn({
      baseURL,
      profileId,
      fileName: '__probe__.txt',
      mimeType: 'text/plain',
      base64: tinyBase64,
      customFilesURL: filesURL
    })

    const supported = result?.success === true
    updateModelCapability(baseURL, '', {
      filesApi: supported,
      filesApiProbed: true,
      filesApiRefType: result?.ref ? Object.keys(result.ref)[0] : null
    })
    return { supported, ref: result.ref }
  } catch (e) {
    updateModelCapability(baseURL, '', {
      filesApi: false,
      filesApiProbed: true,
      filesApiError: e.message || String(e)
    })
    return { supported: false, error: e.message }
  }
}

// ============================================================
//  便捷：根据当前能力缓存给出建议
// ============================================================

/**
 * 根据能力缓存，给出多模态处理的建议路径
 * @returns {string} 'vision' | 'ocr' | 'unknown'
 */
export function suggestVisionPath(baseURL, model) {
  const cap = getModelCapability(baseURL, model)
  if (!cap) return 'unknown'
  if (cap.vision === true) return 'vision'
  if (cap.vision === false) return 'ocr'
  return 'unknown'
}

// ============================================================
//  导出
// ============================================================

export default {
  getModelCapability,
  setModelCapability,
  updateModelCapability,
  probeVisionCapability,
  probeToolCapability,
  probeFilesApi,
  suggestVisionPath,
}
