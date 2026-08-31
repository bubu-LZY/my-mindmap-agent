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
  if (url.includes('volcengine') || url.includes('ark.cn') || url.includes('byteplus')) return 'volcengine'
  if (url.includes('dashscope') || url.includes('aliyun')) return 'qwen'
  if (url.includes('generativelanguage') || url.includes('googleapis')) return 'gemini'
  if (url.includes('deepseek')) return 'deepseek'
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
  if (/\/files$/.test(base)) return base
  return base + '/files'
}

// 各厂商上传时的 purpose 字段
function buildPurpose(provider, isImage) {
  if (provider === 'openai') return isImage ? 'vision' : 'user_data'
  if (provider === 'kimi') return isImage ? 'image' : 'file-extract'
  if (provider === 'deepseek') return 'user_data' // DeepSeek files API 仅支持 user_data
  if (provider === 'gemini') return '' // Gemini 不需要 purpose 表单字段
  return 'file-extract' // zhipu / volcengine / qwen 等
}

/**
 * 上传文件到对应厂商的 files API
 * @param {object} opts
 *   - baseURL   模型服务地址（多模态配置档的 baseURL）
 *   - profileId 配置档 id（主进程据此注入 Authorization，渲染进程不持有明文 apiKey）
 *   - fileName  文件名
 *   - mimeType  MIME 类型
 *   - base64    文件二进制 base64（不含 data: 前缀）
 *   - customFilesURL  用户手动指定的 Files API 端点（留空则用内置按厂商推导）
 * @returns {Promise<{ success: boolean, provider?: string, ref?: object, error?: string }>}
 *   ref 为消息 content part 结构（各厂商不同），失败时 success=false
 */
export async function uploadFileForProvider({ baseURL, profileId, fileName, mimeType, base64, customFilesURL }) {
  if (!base64) return { success: false, error: '缺少文件数据' }
  const provider = detectProvider(baseURL)
  const isImage = isImageMime(mimeType)

  // 用户指定了自定义 Files API 端点：直接用，厂商按 OpenAI 兼容（file_id）解析
  const uploadURL = customFilesURL
    ? String(customFilesURL).trim().replace(/\/+$/, '')
    : buildFilesUploadURL(provider, baseURL)

  if (!uploadURL) return { success: false, error: '无法确定 files API 上传地址' }

  const purpose = customFilesURL ? (isImage ? 'image' : 'file-extract') : buildPurpose(provider, isImage)

  // 走主进程代理上传（避免 CORS；主进程 fetch + FormData）
  if (!window.electronAPI || !window.electronAPI.aiUploadFile) {
    return { success: false, error: '当前环境不支持文件上传（请使用桌面应用）' }
  }
  const resp = await window.electronAPI.aiUploadFile({
    url: uploadURL,
    profileId,
    fileName,
    base64,
    mimeType,
    purpose
  })

  if (!resp || !resp.success) {
    const statusInfo = resp?.status ? `HTTP ${resp.status}` : ''
    const errMsg = resp?.error || resp?.message || '上传失败'
    return { success: false, error: statusInfo ? `${errMsg}（${statusInfo}）` : errMsg, uploadURL }
  }

  const data = resp.data
  // 从各厂商的返回里提取引用标识
  const fileId = data && (data.id || data.file_id || data.fileId || '')
  const fileUri = data && (data.uri || data.fileUri || data.file_uri || '')
  const url = data && (data.url || data.file_url || data.download_url || '')

  // 构造 content part（消息里引用）
  const ref = buildContentPart(provider, { fileId, fileUri, url, mimeType, fileName })
  if (!ref) return { success: false, error: '上传成功但无法解析文件引用标识' }

  return { success: true, provider, ref, fileId, fileUri, url }
}

/**
 * 构造消息 content part（各厂商引用格式）
 * @returns {object|null} content part，无法构造时返回 null
 */
function buildContentPart(provider, { fileId, fileUri, url, mimeType, fileName }) {
  if (provider === 'gemini') {
    // Gemini：fileData { fileUri, mimeType }
    if (fileUri) {
      return { type: 'file_data', file_data: { file_uri: fileUri, mime_type: mimeType } }
    }
    return null
  }
  if (provider === 'qwen') {
    // 通义：上传返回临时 URL，消息里用 image_url / file url 引用
    if (url) {
      return isImageMime(mimeType)
        ? { type: 'image_url', image_url: { url } }
        : { type: 'file', file: { url } }
    }
    return null
  }
  // DeepSeek：图片和文件都用 { type: 'file', file_id }（file_id 在顶层，非嵌套）
  if (provider === 'deepseek') {
    if (fileId) return { type: 'file', file_id: fileId }
    if (url) return { type: 'file', url }
    return null
  }
  // OpenAI 兼容系：图片用 input_image，文档用 file（file_id 嵌套）
  if (isImageMime(mimeType)) {
    if (fileId) return { type: 'input_image', file_id: fileId }
    if (url) return { type: 'image_url', image_url: { url } }
    return null
  }
  // 文档：file_id 引用
  if (fileId) return { type: 'file', file: { file_id: fileId } }
  if (url) return { type: 'file', file: { url } }
  return null
}

export default {
  isImageMime,
  detectProvider,
  buildFilesUploadURL,
  uploadFileForProvider
}
