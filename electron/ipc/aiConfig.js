const { ipcMain, safeStorage } = require('electron')
const store = require('../utils/store')
const { buildChatURL } = require('./aiChat')

// API Key 加密标记前缀：命中该前缀的 apiKey 为 safeStorage 密文（base64）
const ENC_PREFIX = 'enc:v1:'

// 加密单个 apiKey。仅当系统级加密可用时才加密；加密后做一次回环校验，
// 校验失败回退明文，确保绝不把无法读回的内容写盘。
function encryptKey(plain) {
  if (!plain) return plain
  if (typeof plain !== 'string' || plain.startsWith(ENC_PREFIX)) return plain
  try {
    if (!safeStorage.isEncryptionAvailable()) return plain
    const enc = ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
    return safeStorage.decryptString(Buffer.from(enc.slice(ENC_PREFIX.length), 'base64')) === plain ? enc : plain
  } catch {
    return plain
  }
}

// 解密单个 apiKey。非密文（明文旧值）原样返回；解密失败（如系统密钥变更）原样返回，
// 避免掩盖问题或崩溃——最坏情况是当作明文旧值继续使用。
function decryptKey(stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith(ENC_PREFIX)) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return stored
  }
}

function decryptProfiles(config) {
  for (const p of (config && config.profiles) || []) {
    if (p && typeof p.apiKey === 'string') p.apiKey = decryptKey(p.apiKey)
  }
  return config
}

function encryptProfiles(config) {
  for (const p of (config && config.profiles) || []) {
    if (p && typeof p.apiKey === 'string') p.apiKey = encryptKey(p.apiKey)
  }
  return config
}

// 读取配置（存储中 apiKey 为密文 → 解密后返回）
function readConfig() {
  return decryptProfiles(migrateConfig(store.get('aiConfig', {})))
}

// 写入配置（apiKey 加密后落盘）
function writeConfig(config) {
  store.set('aiConfig', encryptProfiles(migrateConfig(config)))
}

// 默认 AI 配置
// profiles 为统一列表，含两类配置档：type 'base'（基础大模型）与 'vision'（多模态，独立 URL/Key/模型）
const DEFAULT_AI_CONFIG = {
  profiles: [],
  activeProfileId: '',
  temperature: 0.7,
  vision: {
    enabled: false,
    activeProfileId: ''  // 当前启用的多模态配置档（type: 'vision'）
  }
}

// 生成唯一 ID
function genProfileId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
}

// 任意旧格式 → 新格式迁移（规范化）
function migrateConfig(raw) {
  const config = {
    profiles: [],
    activeProfileId: '',
    temperature: 0.7,
    vision: { enabled: false, activeProfileId: '' }
  }
  if (!raw || typeof raw !== 'object') return config

  config.temperature = Number.isFinite(Number(raw.temperature)) ? Number(raw.temperature) : 0.7

  if (Array.isArray(raw.profiles)) {
    for (const p of raw.profiles) {
      if (!p) continue
      config.profiles.push({
        id: p.id || genProfileId(),
        name: p.name || '',
        baseURL: p.baseURL || '',
        apiKey: p.apiKey || '',
        model: p.model || '',
        type: p.type === 'vision' ? 'vision' : 'base',
        // URL 自动补全开关（旧配置无此字段 → 默认开启，行为不变）
        autoComplete: p.autoComplete !== false
      })
    }
  } else if (raw.baseURL || raw.apiKey || raw.model) {
    // 旧扁平格式 → 单个基础配置档
    config.profiles.push({
      id: 'default',
      name: '默认配置',
      baseURL: raw.baseURL || '',
      apiKey: raw.apiKey || '',
      model: raw.model || '',
      type: 'base',
      autoComplete: true
    })
  }

  // activeProfileId 只允许指向基础配置档
  const bases = config.profiles.filter(p => p.type === 'base')
  if (raw.activeProfileId && bases.some(p => p.id === raw.activeProfileId)) {
    config.activeProfileId = raw.activeProfileId
  } else if (bases.length > 0) {
    config.activeProfileId = bases[0].id
  }

  const oldVision = raw.vision || {}
  config.vision.enabled = !!oldVision.enabled

  // 新格式：vision.activeProfileId 直接校验引用
  if (oldVision.activeProfileId) {
    const vp = config.profiles.find(p => p.id === oldVision.activeProfileId && p.type === 'vision')
    if (vp) config.vision.activeProfileId = vp.id
  }

  // 中间格式迁移：vision.profileId 引用基础档 + vision.model → 复制该档 URL/Key 生成独立多模态档
  if (!config.vision.activeProfileId && oldVision.profileId) {
    const ref = config.profiles.find(p => p.id === oldVision.profileId)
    if (ref && (ref.baseURL || ref.apiKey || oldVision.model)) {
      const vp = {
        id: genProfileId(),
        name: (ref.name ? ref.name + '（多模态）' : '多模态配置'),
        baseURL: ref.baseURL || '',
        apiKey: ref.apiKey || '',
        model: oldVision.model || '',
        type: 'vision',
        autoComplete: true
      }
      config.profiles.push(vp)
      config.vision.activeProfileId = vp.id
    }
  }

  // 旧扁平 vision：自带 URL/Key/模型 → 独立多模态档
  if (!config.vision.activeProfileId && (oldVision.baseURL || oldVision.model)) {
    const vp = {
      id: genProfileId(),
      name: '多模态配置',
      baseURL: oldVision.baseURL || '',
      apiKey: oldVision.apiKey || '',
      model: oldVision.model || '',
      type: 'vision',
      autoComplete: true
    }
    config.profiles.push(vp)
    config.vision.activeProfileId = vp.id
  }

  // 兜底：指向第一个多模态档（若有）
  if (!config.vision.activeProfileId) {
    const first = config.profiles.find(p => p.type === 'vision')
    if (first) config.vision.activeProfileId = first.id
  }

  return config
}

// 从基础配置档中解析当前活跃配置（AI 对话使用，不含多模态档）
function resolveActiveProfile(config) {
  const profile = (config.profiles || []).filter(p => p.type !== 'vision')
    .find(p => p.id === config.activeProfileId)
  return profile || { baseURL: '', apiKey: '', model: '' }
}

// 解析多模态使用的配置档（独立的 type:'vision' 配置档，未配置返回 null）
// 空值回退：多模态档 URL/Key 留空 → 沿用当前活跃基础档的 URL/Key（模型名仍需单独填写）
// 地址继承时补全开关也一并沿用基础档，避免基础档关闭补全后多模态仍追加后缀
function resolveVisionProfile(config) {
  const pid = config.vision && config.vision.activeProfileId
  const profile = (config.profiles || []).find(p => p.id === pid && p.type === 'vision')
  if (!profile) return null
  const base = resolveActiveProfile(config)
  const inheritURL = !profile.baseURL && !!base.baseURL
  return {
    ...profile,
    baseURL: profile.baseURL || base.baseURL || '',
    apiKey: profile.apiKey || base.apiKey || '',
    autoComplete: inheritURL ? (base.autoComplete !== false) : (profile.autoComplete !== false)
  }
}

// 获取 AI 配置（返回完整结构 + 解析后的活跃字段，兼容旧版调用方）
ipcMain.handle('get-ai-config', () => {
  try {
    const config = readConfig()
    const active = resolveActiveProfile(config)
    return {
      ...config,
      baseURL: active.baseURL || '',
      apiKey: active.apiKey || '',
      model: active.model || '',
      autoComplete: active.autoComplete !== false
    }
  } catch (error) {
    return { ...DEFAULT_AI_CONFIG, baseURL: '', apiKey: '', model: '' }
  }
})

// 保存 AI 配置（先规范化再加密落盘，保证结构一致）
ipcMain.handle('set-ai-config', (event, config) => {
  try {
    writeConfig(config)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 导出解析函数供其他模块使用（ocr-smart 等需要解析 profile 的场景）
// 返回多模态配置档的完整连接信息；未启用/未配置返回 null
function resolveProfileForVision() {
  const config = readConfig()
  if (!config.vision.enabled) return null
  const profile = resolveVisionProfile(config)
  if (!profile) return null
  return {
    baseURL: profile.baseURL || '',
    apiKey: profile.apiKey || '',
    model: profile.model || '',
    autoComplete: profile.autoComplete !== false
  }
}

// 多模态识别是否已启用且配置完整（URL/Key/模型齐全）
function isVisionEnabled() {
  const p = resolveProfileForVision()
  return !!(p && p.baseURL && p.apiKey && p.model)
}

// 渲染进程查询多模态是否可用及连接信息（带图对话直接发多模态配置档）
ipcMain.handle('ai:getVisionConfig', () => {
  try {
    const config = readConfig()
    if (!config.vision.enabled) return { available: false, reason: 'disabled' }
    const profile = resolveVisionProfile(config)
    if (!profile) return { available: false, reason: 'no_profile' }
    if (!profile.baseURL || !profile.apiKey) return { available: false, reason: 'incomplete' }
    if (!profile.model) return { available: false, reason: 'no_model' }
    return {
      available: true,
      baseURL: profile.baseURL,
      apiKey: profile.apiKey,
      model: profile.model,
      autoComplete: profile.autoComplete !== false
    }
  } catch (error) {
    return { available: false, reason: error.message }
  }
})

// 构建基础 URL（去除 completions 路径）
function buildBaseURL(url) {
  if (!url) return ''
  let base = url.trim()
  base = base.replace(/\/+$/, '')
  base = base.replace(/\/v1\/chat\/completions$/i, '')
  base = base.replace(/\/chat\/completions$/i, '')
  base = base.replace(/\/completions$/i, '')
  return base
}

// 解析 /models 目录项的多模态元数据（各平台字段不一，做通用兼容）
function parseModelMeta(m) {
  const inputs =
    (m && m.modalities && m.modalities.input_modalities) ||
    (m && m.architecture && m.architecture.input_modalities) ||
    (m && (m.input_modalities || m.supported_inputs)) ||
    []
  const visionFromAPI = Array.isArray(inputs) && inputs.some((x) => /image|vision/i.test(String(x)))
  const status = (m && m.status) || ''
  return { visionFromAPI, status }
}

// 通过主进程检测可用模型列表（避免 CORS 限制）
// 返回 models（id 数组）+ details（含接口元数据识别的多模态标记与上下架状态）
ipcMain.handle('ai:fetchModels', async (event, { baseURL, apiKey }) => {
  try {
    if (!baseURL) {
      return { success: false, error: '缺少 API 地址' }
    }
    const base = buildBaseURL(baseURL)
    const headers = {}
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
    // base 已带版本号（/v1、/v4、/compatible-mode/v1 等）直接拼 /models，否则拼 /v1/models，避免双重路径
    const modelsUrl = /\/v\d+[a-z]*$/i.test(base) ? `${base}/models` : `${base}/v1/models`
    let models = []
    let details = []
    // 超时保护：端点挂起时避免「检测模型」永久转圈
    const fetchWithTimeout = (url, opts = {}) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer))
    }
    try {
      const resp = await fetchWithTimeout(modelsUrl, { headers })
      if (resp.ok) {
        const data = await resp.json()
        if (data.data && Array.isArray(data.data)) {
          for (const m of data.data) {
            if (!m || !m.id) continue
            models.push(m.id)
            details.push({ id: m.id, ...parseModelMeta(m) })
          }
        }
      }
    } catch { /* ignore */ }
    if (models.length === 0) {
      try {
        const resp = await fetchWithTimeout(`${base}/api/tags`)
        if (resp.ok) {
          const data = await resp.json()
          if (data.models && Array.isArray(data.models)) {
            models = data.models.map((m) => m.name).filter(Boolean)
            details = models.map((id) => ({ id, visionFromAPI: false, status: '' }))
          }
        }
      } catch { /* ignore */ }
    }
    if (models.length > 0) {
      return { success: true, models, details }
    }
    return { success: false, error: '未能检测到可用模型，请手动输入模型名称' }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 16x16 红色 PNG（base64）：实测探测用的最小有效图片（多数服务要求边长 ≥ 14px）
const VISION_TEST_IMAGE_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII='

// 把常见平台报错映射为用户可操作的提示
function classifyVisionTestError(status, text) {
  const t = String(text || '')
  if (/UnsupportedModel|coding plan/i.test(t)) {
    return '该模型不被当前端点支持（如 Coding 计划套餐不含此模型），请更换该端点支持的视觉模型'
  }
  if (/ModelNotOpen/i.test(t)) {
    return '账号未开通该模型，请到服务商控制台（模型广场/模型服务）开通后重试'
  }
  if (/Insufficient Balance|余额不足|insufficient_quota|billing/i.test(t)) {
    return '账户余额不足或未开通按量计费，请充值或更换 API Key'
  }
  if (/Image dimensions|image is too small|image size/i.test(t)) {
    // 服务端已进入图片处理流程（仅嫌测试图太小），说明模型支持图片输入
    return ''
  }
  if (status === 404 || /does not exist|InvalidEndpointOrModel|not found/i.test(t)) {
    return '模型不存在或已下线（Retiring），请更换模型名称'
  }
  if (status === 401 || /Unauthorized|invalid api key|AccessDenied/i.test(t)) {
    return 'API Key 无效或无权限，请检查 Key 是否正确'
  }
  return t.slice(0, 200) || `请求失败（HTTP ${status}）`
}

// 实测探测：向指定配置发送一张真实小图，验证模型是否真的可用于图片识别
ipcMain.handle('ai:testVisionModel', async (event, { baseURL, apiKey, model, autoComplete }) => {
  try {
    if (!baseURL || !model) {
      return { success: false, error: '缺少 API 地址或模型名称' }
    }
    const url = buildChatURL(baseURL, autoComplete !== false)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)
    let resp
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          model,
          max_tokens: 30,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: '这张图片是什么颜色？只回答颜色' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${VISION_TEST_IMAGE_B64}` } }
            ]
          }]
        }),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
    const text = await resp.text()
    if (resp.ok) {
      return { success: true, message: '图片识别链路正常，该模型可用于多模态识图' }
    }
    // 部分平台对过小图片报尺寸错误——恰好证明图片通道可用
    if (/Image dimensions|image is too small|image size/i.test(text)) {
      return { success: true, message: '该模型支持图片输入（服务端已受理图片，仅测试图过小）' }
    }
    return { success: false, error: classifyVisionTestError(resp.status, text) }
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { success: false, error: '请求超时（30 秒），请检查 API 地址是否可访问' }
    }
    return { success: false, error: error.message }
  }
})

// 导出供 ocr.js 使用
module.exports = { resolveProfileForVision, isVisionEnabled }
