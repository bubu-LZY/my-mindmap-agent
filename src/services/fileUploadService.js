/**
 * files API 文件上传服务
 * 根据模型服务的 baseURL 识别厂商，选择对应的 files API 上传文件（图片/文档），
 * 并生成该厂商消息中引用文件所需的 content part 结构。
 *
 * 支持厂商：
 *   - openai      OpenAI（及默认 OpenAI 兼容）       POST {base}/files
 *   - kimi        Moonshot Kimi（OpenAI 兼容）        POST {base}/files
 *   - zhipu       智谱 GLM                            POST {base}/files
 *   - volcengine  火山方舟                            POST {base}/files
 *   - qwen        通义千问（DashScope/百炼）          POST {base}/files
 *   - gemini      Google Gemini                       POST {base}/files（独立 /v1beta/files）
 *
 * 所有 OpenAI 兼容系都走 multipart 上传（file + purpose），返回 file_id；
 * Gemini 返回 fileUri；通义返回临时 URL。具体以各厂商返回字段为准。
 */

// 图片 MIME 类型判断
export const isImageMime = (mimeType) =>
  /^image\//i.test(String(mimeType || ''))

// 厂商识别：根据 baseURL 域名
export function detectProvider(baseURL) {
  const url = String(baseURL || '').toLowerCase()
  if (url.includes('moonshot')) return 'kimi'
  if (url.includes('bigmodel') || url.includes('zhipu')) return 'zhipu'
  if (url.includes('volcengine') || url.includes('ark.cn') || url.includes('byteplus') || url.includes('doubao')) return 'volcengine'
  if (url.includes('dashscope') || url.includes('aliyun')) return 'qwen'
  if (url.includes('generativelanguage') || url.includes('googleapis')) return 'gemini'
  if (url.includes('anthropic') || url.includes('claude')) return 'anthropic'
  if (url.includes('deepseek')) return 'deepseek'
  if (url.includes('minimax') || url.includes('minimaxi')) return 'minimax'
  if (url.includes('baidubce') || url.includes('wenxin') || url.includes('yiyan')) return 'ernie'
  if (url.includes('xf-yun') || url.includes('xunfei') || url.includes('spark-api')) return 'spark'
  if (url.includes('siliconflow')) return 'siliconflow'
  if (url.includes('openai')) return 'openai'
  // 默认按 OpenAI 兼容处理
  return 'openai'
}

// 构造 files 上传端点
export function buildFilesUploadURL(provider, baseURL) {
  let base = String(baseURL || '').trim().replace(/\/+$/, '')
  if (!base) return ''
  // 去掉 baseURL 里可能带的 /chat/completions 后缀（用户可能填了完整对话端点）
  base = base.replace(/\/(chat\/completions|completions)$/i, '')
  if (provider === 'gemini') {
    if (/\/files$/.test(base)) return base
    if (/\/v1beta$/.test(base)) return base + '/files'
    return base + '/v1beta/files'
  }
  if (provider === 'deepseek') {
    // DeepSeek files 端点是 {origin}/files，与 baseURL 的路径（/v1、/v1/chat/completions）无关
    const m = base.match(/^(https?:\/\/[^/]+)/i)
    const origin = m ? m[1] : base
    return origin + '/files'
  }
  if (provider === 'minimax') {
    // MiniMax files 上传端点是 {base}/files/upload
    if (/\/files\/upload$/i.test(base)) return base
    if (/\/files$/i.test(base)) return base.replace(/\/files$/i, '') + '/files/upload'
    return base + '/files/upload'
  }
  if (/\/files$/.test(base)) return base
  return base + '/files'
}

// 各厂商上传时的 purpose 字段
function buildPurpose(provider, isImage) {
  if (provider === 'openai') return isImage ? 'vision' : 'user_data'
  if (provider === 'kimi') return isImage ? 'image' : 'file-extract'
  if (provider === 'deepseek') return 'user_data' // DeepSeek files API 仅支持 user_data
  if (provider === 'gemini') return '' // Gemini 不需要 purpose 表单字段
  if (provider === 'minimax') return isImage ? 'image' : 'file-extract'
  return 'file-extract' // zhipu / volcengine / qwen / ernie / spark / siliconflow 等
}

// 从（自定义）Files 端点域名识别厂商；认不出返回空串，交由调用方回退到 baseURL 的厂商
function pickVendor(url) {
  const s = String(url || "").toLowerCase()
  if (!s) return ""
  const table = [
    ["moonshot", "kimi"],
    ["bigmodel", "zhipu"], ["zhipu", "zhipu"],
    ["volcengine", "volcengine"], ["ark.cn", "volcengine"], ["byteplus", "volcengine"], ["doubao", "volcengine"],
    ["dashscope", "qwen"], ["aliyun", "qwen"],
    ["generativelanguage", "gemini"], ["googleapis", "gemini"],
    ["anthropic", "anthropic"], ["claude", "anthropic"],
    ["deepseek", "deepseek"],
    ["minimax", "minimax"], ["minimaxi", "minimax"],
    ["baidubce", "ernie"], ["wenxin", "ernie"], ["yiyan", "ernie"],
    ["xf-yun", "spark"], ["xunfei", "spark"], ["spark-api", "spark"],
    ["siliconflow", "siliconflow"],
    ["openai", "openai"]
  ]
  for (const [kw, p] of table) if (s.includes(kw)) return p
  return ""
}

// 从 400 返回体里解析服务端声明的可用 purpose（形如 Supported purposes: ["user_data"]）
function pickSupportedPurpose(text) {
  const m = String(text || "").match(/supported purposes?\s*:\s*\[([^\]]*)\]/i)
  if (!m) return ""
  const vm = m[1].match(/[A-Za-z_][A-Za-z0-9_-]*/)
  return vm ? vm[0] : ""
}

/**
 * 上传文件到对应厂商的 files API
 * @param {object} opts
 *   - baseURL   模型服务地址（多模态配置档的 baseURL）
 *   - profileId 配置档 id（主进程据此注入 Authorization，渲染进程不持有明文 apiKey）
 *   - fileName  文件名
 *   - mimeType  MIME 类型
 *   - base64    文件二进制 base64（不含 data: 前缀）；与 filePath 二选一
 *   - filePath  本地文件绝对路径（优先；主进程直接读盘上传，渲染进程不必持有整份 base64）
 *   - customFilesURL  用户手动指定的 Files API 端点（留空则用内置按厂商推导）
 * @returns {Promise<{ success: boolean, provider?: string, ref?: object, error?: string }>}
 *   ref 为消息 content part 结构（各厂商不同），失败时 success=false
 */
export async function uploadFileForProvider({ baseURL, profileId, fileName, mimeType, base64, filePath, customFilesURL }) {
  // 有路径时交给主进程读盘上传：渲染进程不再持有整份文件的 base64（大文档内存/卡顿主因）
  if (!base64 && !filePath) return { success: false, error: '缺少文件数据' }
  const provider = detectProvider(baseURL)
  const isImage = isImageMime(mimeType)

  // MiniMax 的 files API 只支持音频/视频（voice_clone/prompt_audio/t2a_async_input/
  // video_understanding/video_generation_input），不支持图片；图片应走 base64/URL image_url。
  // 这里直接返回失败，让调用方降级 base64，避免浪费一次无意义的 files 上传往返。
  if (provider === 'minimax' && isImage) {
    return { success: false, error: 'MiniMax files API 不支持图片（仅音频/视频），改用 base64 直传' }
  }

  // 用户指定了自定义 Files API 端点：直接用，厂商按 OpenAI 兼容（file_id）解析
  const uploadURL = customFilesURL
    ? String(customFilesURL).trim().replace(/\/+$/, '')
    : buildFilesUploadURL(provider, baseURL)

  if (!uploadURL) return { success: false, error: '无法确定 files API 上传地址' }

  // 自定义 Files 端点也按端点域名推导厂商的 purpose：曾无条件发 file-extract，
  // 而 DeepSeek 的 files API 只接受 user_data，上传直接 400 → 整批降级本地解析。
  const customVendor = pickVendor(customFilesURL)
  const effectiveProvider = customVendor || provider
  const purpose = customVendor
    ? buildPurpose(customVendor, isImage)
    : (customFilesURL && isImage ? 'image' : buildPurpose(provider, isImage))

  // 走主进程代理上传（避免 CORS；主进程 fetch + FormData）
  if (!window.electronAPI || !window.electronAPI.aiUploadFile) {
    return { success: false, error: '当前环境不支持文件上传（请使用桌面应用）' }
  }
  // 有 filePath 就走路径模式：主进程直接读盘组 multipart，渲染进程不必把整份文件读成 base64
  const callUpload = (p) => window.electronAPI.aiUploadFile({
    url: uploadURL,
    profileId,
    fileName,
    mimeType,
    purpose: p,
    ...(filePath ? { filePath } : { base64 })
  })

  let usedPurpose = purpose
  let resp = await callUpload(usedPurpose)
  // 有的厂商只接受特定 purpose，并在 400 里明确列出支持值（如 DeepSeek 仅 user_data）。
  // 命中这类错误时按服务端给的值再试一次，避免一次 purpose 不匹配就让整批降级到本地解析。
  if ((!resp || !resp.success) && resp?.status === 400) {
    const supported = pickSupportedPurpose(resp.error)
    if (supported && supported !== usedPurpose) {
      usedPurpose = supported
      resp = await callUpload(usedPurpose)
    }
  }

  if (!resp || !resp.success) {
    const statusInfo = resp?.status ? `HTTP ${resp.status}` : ''
    const errMsg = resp?.error || resp?.message || '上传失败'
    return { success: false, error: statusInfo ? `${errMsg}（${statusInfo}）` : errMsg, uploadURL }
  }

  const data = resp.data
  // 递归提取引用标识：不同厂商返回结构差异大（顶层字段 / 嵌套 file 对象 / 更深层级），
  // 统一在 JSON 树里深度搜索 file_id / file_uri / url，避免"靠猜字段名"。
  const extractIdentifiers = (node) => {
    let out = { fileId: '', fileUri: '', url: '' }
    if (!node || typeof node !== 'object') return out
    const ID_KEYS = ['file_id', 'fileId', 'id']
    const URI_KEYS = ['uri', 'fileUri', 'file_uri']
    const URL_KEYS = ['url', 'file_url', 'download_url']
    const walk = (obj, depth) => {
      if (!obj || typeof obj !== 'object' || depth > 5 || (out.fileId && out.fileUri && out.url)) return
      if (Array.isArray(obj)) {
        for (const v of obj) walk(v, depth + 1)
        return
      }
      for (const [k, v] of Object.entries(obj)) {
        const key = String(k).toLowerCase()
        if (!out.fileId && ID_KEYS.includes(key) && typeof v === 'string' && v) out.fileId = v
        else if (!out.fileUri && URI_KEYS.includes(key) && typeof v === 'string' && v) out.fileUri = v
        else if (!out.url && URL_KEYS.includes(key) && typeof v === 'string' && v) out.url = v
        else if (v && typeof v === 'object') walk(v, depth + 1)
      }
    }
    walk(node, 0)
    return out
  }
  const ids = extractIdentifiers(data)
  const fileId = ids.fileId
  const fileUri = ids.fileUri
  const url = ids.url

  // 构造 content part（消息里引用）
  const ref = buildContentPart(effectiveProvider, { fileId, fileUri, url, mimeType, fileName })
  if (!ref) {
    // 打印完整返回体（截断 + 剥离敏感信息），让任何厂商的异常都能一眼定位，不再靠猜
    let body = ''
    try { body = JSON.stringify(data) } catch { body = String(data ?? '') }
    if (body.length > 600) body = body.slice(0, 600) + '…'
    return { success: false, error: `上传成功但无法解析文件引用标识。返回体：${body || '空'}`, uploadURL }
  }

  return { success: true, provider: effectiveProvider, ref, fileId, fileUri, url }
}

/**
 * 构造消息 content part（各厂商引用格式）
 * @returns {object|null} content part，无法构造时返回 null
 */
function buildContentPart(provider, { fileId, fileUri, url, mimeType, fileName }) {
  const isImg = isImageMime(mimeType)
  if (provider === 'gemini') {
    // Gemini：fileData { fileUri, mimeType }；仅有 url 时退回 image_url
    if (fileUri) return { type: 'file_data', file_data: { file_uri: fileUri, mime_type: mimeType } }
    if (url) return { type: 'image_url', image_url: { url } }
    return null
  }
  if (provider === 'qwen') {
    // 通义：上传返回临时 URL，消息里用 image_url / file url 引用；也兼容 file_id
    if (url) return isImg ? { type: 'image_url', image_url: { url } } : { type: 'file', file: { url } }
    if (fileId) return { type: 'file', file: { file_id: fileId } }
    return null
  }
  if (provider === 'deepseek') {
    // DeepSeek：图片和文件都用 { type: 'file', file_id }（file_id 在顶层，非嵌套）
    if (fileId) return { type: 'file', file_id: fileId }
    if (url) return { type: 'file', url }
    return null
  }
  if (provider === 'zhipu') {
    // 智谱 GLM：图片用 input_image（file_id），文档用 file
    if (isImg && fileId) return { type: 'input_image', file_id: fileId }
    if (isImg && url) return { type: 'image_url', image_url: { url } }
    if (fileId) return { type: 'file', file: { file_id: fileId } }
    if (url) return { type: 'file', file: { url } }
    return null
  }
  // OpenAI 兼容系（openai / kimi / minimax / volcengine / ernie / spark / siliconflow / anthropic 代理等）：
  // 统一用 OpenAI file 引用 { type: 'file', file: { file_id } }；图片同样走 file（files API 返回 file_id）
  if (fileId) return { type: 'file', file: { file_id: fileId } }
  if (url) return isImg ? { type: 'image_url', image_url: { url } } : { type: 'file', file: { url } }
  return null
}

export default {
  isImageMime,
  detectProvider,
  buildFilesUploadURL,
  uploadFileForProvider
}
