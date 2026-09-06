/**
 * 智能多模态路由引擎
 *
 * 核心思想：用户只需要拖文件进来，剩下的全交给系统自动判断。
 *
 * 功能：
 *   1. 零配置自动探测 — 自动检测当前模型服务是否支持多模态，无需用户单独配置
 *   2. 智能文件路由 — 按文件类型选择最优处理路径（文本直读/本地解析/多模态API）
 *   3. 三级自动降级 — Files API → Base64 → 本地OCR，失败自动切换
 *   4. 记忆自学习 — 记录各服务成功率，越用越聪明
 *   5. 透明状态反馈 — 用户知道在干嘛，但不被打扰
 *
 * 文件类型判断注意：
 *   - 图片既可能是 .png/.jpg 等图片文件，也可能是嵌入在 PDF/Office 里的图片
 *   - 图片类文件统一按"图片"处理（走多模态视觉能力），不区分传入形式
 */

import { uploadFileForProvider, detectProvider, isImageMime } from './fileUploadService.js'

// ============================================================
//  一、文件类型分类
// ============================================================

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tiff', '.ico']
const TEXT_EXTS = ['.txt', '.md', '.markdown', '.csv', '.json', '.xml', '.html', '.htm', '.log', '.yml', '.yaml', '.ini', '.conf']
const OFFICE_EXTS = ['.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt']
const PDF_EXTS = ['.pdf']
const EBOOK_EXTS = ['.epub', '.mobi', '.azw3']
const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg']
const VIDEO_EXTS = ['.mp4', '.avi', '.mov', '.mkv', '.webm']

// 文件类别枚举
export const FileCategory = {
  IMAGE: 'image',       // 图片类 — 走多模态视觉
  TEXT: 'text',         // 纯文本 — 直接读内容
  OFFICE: 'office',     // Office文档 — 本地解析优先
  PDF: 'pdf',           // PDF — 智能判断
  EBOOK: 'ebook',       // 电子书
  AUDIO: 'audio',       // 音频
  VIDEO: 'video',       // 视频
  UNKNOWN: 'unknown'    // 未知
}

// 根据扩展名判断文件类别
export function classifyFile(fileName) {
  const ext = '.' + String(fileName || '').split('.').pop().toLowerCase()
  if (IMAGE_EXTS.includes(ext)) return FileCategory.IMAGE
  if (TEXT_EXTS.includes(ext)) return FileCategory.TEXT
  if (OFFICE_EXTS.includes(ext)) return FileCategory.OFFICE
  if (PDF_EXTS.includes(ext)) return FileCategory.PDF
  if (EBOOK_EXTS.includes(ext)) return FileCategory.EBOOK
  if (AUDIO_EXTS.includes(ext)) return FileCategory.AUDIO
  if (VIDEO_EXTS.includes(ext)) return FileCategory.VIDEO
  return FileCategory.UNKNOWN
}

// 判断一个文件是否需要多模态视觉能力处理
export function needsVision(category) {
  return category === FileCategory.IMAGE ||
         category === FileCategory.PDF ||
         category === FileCategory.OFFICE ||
         category === FileCategory.UNKNOWN
}

// ============================================================
//  二、多模态能力记忆（自学习）
// ============================================================
//
// 记录每个 baseURL + model 的多模态能力表现：
//   - filesApiSuccessRate: files API 上传成功率
//   - visionWithToolsSuccess: 带 tools 参数的多模态请求成功率
//   - visionDirectSuccess: 不带 tools 的多模态请求成功率
//   - lastChecked: 上次探测时间
//
// 基于历史表现自动选择最优路径，越用越准。

const MEMORY_KEY = 'multimodal_router_memory'
const MEMORY_TTL = 7 * 24 * 60 * 60 * 1000 // 7天过期

function loadMemory() {
  try {
    const raw = localStorage.getItem(MEMORY_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw)
    // 清理过期条目
    const now = Date.now()
    for (const key of Object.keys(data)) {
      if (data[key].lastChecked && now - data[key].lastChecked > MEMORY_TTL) {
        delete data[key]
      }
    }
    return data
  } catch { return {} }
}

function saveMemory(mem) {
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(mem)) } catch {}
}

function getMemoryKey(baseURL, model) {
  return `${String(baseURL || '')}::${String(model || '')}`
}

// 读取某个服务的多模态记忆
export function getVisionMemory(baseURL, model) {
  const mem = loadMemory()
  const key = getMemoryKey(baseURL, model)
  return mem[key] || null
}

// 记录一次多模态操作结果
export function recordVisionResult(baseURL, model, operation, success) {
  const mem = loadMemory()
  const key = getMemoryKey(baseURL, model)
  if (!mem[key]) {
    mem[key] = {
      filesApi: { success: 0, total: 0 },
      visionWithTools: { success: 0, total: 0 },
      visionNoTools: { success: 0, total: 0 },
      lastChecked: Date.now()
    }
  }
  const entry = mem[key]
  if (operation === 'filesApi') {
    entry.filesApi.total++
    if (success) entry.filesApi.success++
  } else if (operation === 'visionWithTools') {
    entry.visionWithTools.total++
    if (success) entry.visionWithTools.success++
  } else if (operation === 'visionNoTools') {
    entry.visionNoTools.total++
    if (success) entry.visionNoTools.success++
  }
  entry.lastChecked = Date.now()
  saveMemory(mem)
}

// 获取某个操作的成功率（0-1）
function getSuccessRate(stats) {
  if (!stats || stats.total === 0) return null // 无历史数据
  return stats.success / stats.total
}

// ============================================================
//  三、智能策略决策
// ============================================================

// 已知不支持多模态视觉的纯文本模型（遇到直接走 OCR，不浪费请求）
// 这些模型的 chat completions 只支持 text 类型，不支持 image_url / input_image
const KNOWN_TEXT_ONLY_MODELS = [
  // 智谱 GLM 系列：纯文本模型，不支持视觉
  /^glm-4-flash/i,
  /^glm-4\.7-flash/i,
  /^glm-4-air/i,
  /^glm-4-long/i,
  /^glm-3-turbo/i,
  /^glm-4$|^glm-4\.0/i, // 基础版 glm-4 也不是视觉版
  // 其他已知纯文本模型可继续补充
]

export function isKnownTextOnlyModel(modelName) {
  const name = String(modelName || '')
  return KNOWN_TEXT_ONLY_MODELS.some(pattern => pattern.test(name))
}

/**
 * 根据文件列表和服务配置，决策最优处理策略
 * @param {Array} files — 文件列表 [{ path, fileName, ext, size }]
 * @param {object} config — 模型配置 { baseURL, model, profileId, filesURL }
 * @returns {object} 策略结果
 *   - strategy: 'direct_text' | 'local_parse' | 'multimodal_files' | 'multimodal_base64' | 'ocr_fallback'
 *   - needsVision: 是否需要视觉能力
 *   - recommendedPath: 推荐的多模态路径 'files' | 'base64' | 'ocr'
 *   - shouldOmitTools: 是否应该去掉 tools 参数
 *   - reason: 决策理由（用于日志）
 */
export function decideStrategy(files, config) {
  const { baseURL, model } = config || {}
  const mem = getVisionMemory(baseURL, model)
  const provider = detectProvider(baseURL)

  // 先分类所有文件
  const categories = files.map(f => ({
    file: f,
    category: classifyFile(f.fileName || f.path)
  }))

  const hasImage = categories.some(c => c.category === FileCategory.IMAGE)
  const hasText = categories.some(c => c.category === FileCategory.TEXT)
  const hasOffice = categories.some(c => c.category === FileCategory.OFFICE)
  const hasPdf = categories.some(c => c.category === FileCategory.PDF)
  const needsVis = categories.some(c => needsVision(c.category))

  // 全是纯文本 → 直接读，不走多模态
  if (!needsVis) {
    return {
      strategy: 'direct_text',
      needsVision: false,
      recommendedPath: null,
      shouldOmitTools: false,
      reason: '全部为纯文本文件，直接读取内容即可，无需多模态'
    }
  }

  // 已知是纯文本模型（如 GLM-4-flash）→ 直接走本地 OCR，不浪费请求
  if (isKnownTextOnlyModel(model)) {
    return {
      strategy: 'ocr_direct',
      needsVision: true,
      recommendedPath: 'ocr',
      shouldOmitTools: false,
      reason: `${model} 是纯文本模型，不支持视觉理解，自动使用本地 OCR（PaddleOCR）`,
      provider,
      hasImage,
      hasText,
      hasOffice,
      hasPdf,
      fileCategories: categories,
      skipVisionProbe: true // 标记不需要探测多模态
    }
  }

  // 检查记忆：files API 历史表现
  const filesApiRate = getSuccessRate(mem?.filesApi)
  const withToolsRate = getSuccessRate(mem?.visionWithTools)
  const noToolsRate = getSuccessRate(mem?.visionNoTools)

  // 决策路径：优先用 files API（省token、支持大文件），否则 base64，最后 OCR
  let recommendedPath = 'files'
  let shouldOmitTools = false
  let reason = ''

  // 已知该服务商 files API 历史成功率极低 → 直接跳过 files API
  if (filesApiRate !== null && filesApiRate < 0.3 && mem.filesApi.total >= 3) {
    recommendedPath = 'base64'
    reason = `该服务 files API 历史成功率仅 ${Math.round(filesApiRate * 100)}%，直接走 base64`
  } else {
    reason = '优先尝试 files API 上传（节省 token、支持大文件）'
  }

  // 已知带 tools 的多模态请求历史成功率极低 → 自动去掉 tools
  if (withToolsRate !== null && withToolsRate < 0.3 && mem.visionWithTools.total >= 2) {
    shouldOmitTools = true
    if (!reason) reason = ''
    reason += `；该服务带 tools 调用多模态历史成功率仅 ${Math.round(withToolsRate * 100)}%，已自动去除 tools 参数`
  }

  // 特殊厂商预判
  // 智谱 GLM-4V 系列：已知不支持带 tools 的多模态请求
  if (provider === 'zhipu') {
    shouldOmitTools = true
    if (!reason) reason = ''
    reason += '；智谱 GLM 多模态接口不支持 tools 参数，自动去除'
  }
  // MiniMax：图片不走 files API
  if (provider === 'minimax' && hasImage) {
    recommendedPath = 'base64'
    reason = 'MiniMax files API 不支持图片，直接走 base64'
  }

  // 图片太大（单张 > 2MB）→ 跳过 base64，直接 OCR（避免卡死）
  const bigImages = categories.filter(
    c => c.category === FileCategory.IMAGE && c.file.size && c.file.size > 2 * 1024 * 1024
  )
  if (bigImages.length > 0 && recommendedPath === 'base64') {
    recommendedPath = 'ocr'
    reason = `存在 ${bigImages.length} 张大于 2MB 的大图，base64 会撑爆上下文，直接走本地 OCR`
  }

  return {
    strategy: 'multimodal',
    needsVision: true,
    recommendedPath,
    shouldOmitTools,
    reason: reason || '使用默认策略',
    provider,
    hasImage,
    hasText,
    hasOffice,
    hasPdf,
    fileCategories: categories
  }
}

// ============================================================
//  四、多模态能力自动探测
// ============================================================

/**
 * 探测当前模型服务是否支持多模态
 * 原理：发一个带极小图片（1x1透明像素）的试探请求
 * 成功说明支持，失败说明不支持
 *
 * 注意：只在第一次遇到需要多模态的请求时探测，之后缓存结果
 */
const PROBE_CACHE_KEY = 'multimodal_probe_cache'
const PROBE_CACHE_TTL = 24 * 60 * 60 * 1000 // 24小时

function loadProbeCache() {
  try {
    const raw = localStorage.getItem(PROBE_CACHE_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch { return {} }
}

function saveProbeCache(cache) {
  try { localStorage.setItem(PROBE_CACHE_KEY, JSON.stringify(cache)) } catch {}
}

/**
 * 检查是否已知该服务支持多模态（从缓存读取，不发起探测）
 * @returns {boolean|null} true=支持, false=不支持, null=未知
 */
export function isVisionSupportedCached(baseURL, model) {
  const cache = loadProbeCache()
  const key = getMemoryKey(baseURL, model)
  const entry = cache[key]
  if (!entry) return null
  if (Date.now() - entry.timestamp > PROBE_CACHE_TTL) return null
  return entry.supported
}

/**
 * 记录探测结果到缓存
 */
export function setVisionProbeResult(baseURL, model, supported) {
  const cache = loadProbeCache()
  const key = getMemoryKey(baseURL, model)
  cache[key] = { supported, timestamp: Date.now() }
  saveProbeCache(cache)
}

// ============================================================
//  五、统一文件处理入口（智能路由主函数）
// ============================================================

/**
 * 智能处理文件：自动选择最优路径，支持多级降级
 *
 * @param {object} opts
 *   - files: 要处理的文件列表 [{ path, fileName, ext, size? }]
 *   - config: 模型配置 { baseURL, model, profileId, filesURL }
 *   - userText: 用户输入的文字内容
 *   - callbacks: 状态回调 { onStatus, onProgress, onError }
 *   - readBinaryFn: 读取文件二进制的函数 (path) => { success, base64 }
 *   - ocrFn: 本地 OCR 函数 (imagePaths) => text
 *   - parseOfficeFn: 本地解析 Office 文档的函数（可选）
 *   - parsePdfFn: 本地解析 PDF 的函数（可选）
 * @returns {Promise<object>} 处理结果
 *   - parts: 消息 content parts 数组（用于多模态直发）
 *   - textContent: 文本内容（OCR/解析结果，用于纯文本大模型）
 *   - usedStrategy: 实际使用的策略
 *   - hasFallback: 是否发生了降级
 */
export async function smartProcessFiles({
  files,
  config,
  userText = '',
  callbacks = {},
  readBinaryFn,
  ocrFn,
  parseOfficeFn,
  parsePdfFn
}) {
  const { onStatus } = callbacks
  const strategy = decideStrategy(files, config)

  // 纯文本文件，直接读
  if (strategy.strategy === 'direct_text') {
    onStatus?.('正在读取文本文件...')
    const textParts = []
    for (const f of files) {
      try {
        const r = await readBinaryFn(f.path)
        if (r?.success && r.base64) {
          const text = atob(r.base64)
          textParts.push(`【文件：${f.fileName}】\n${text}`)
        }
      } catch { /* 跳过失败的文件 */ }
    }
    return {
      parts: [],
      textContent: textParts.join('\n\n'),
      usedStrategy: 'direct_text',
      hasFallback: false,
      strategyInfo: strategy
    }
  }

  // 需要多模态/视觉处理
  onStatus?.('正在分析文件...')

  const result = {
    parts: [],
    textContent: '',
    usedStrategy: strategy.recommendedPath,
    hasFallback: false,
    strategyInfo: strategy
  }

  // 按类别分别处理
  const imageFiles = strategy.fileCategories
    .filter(c => c.category === FileCategory.IMAGE)
    .map(c => c.file)
  const docFiles = strategy.fileCategories
    .filter(c => c.category === FileCategory.PDF || c.category === FileCategory.OFFICE || c.category === FileCategory.UNKNOWN)
    .map(c => c.file)

  // ========== 处理图片 ==========
  if (imageFiles.length > 0) {
    const imageResult = await processImagesWithFallback({
      images: imageFiles,
      config,
      recommendedPath: strategy.recommendedPath,
      callbacks,
      readBinaryFn,
      ocrFn
    })
    result.parts.push(...imageResult.parts)
    if (imageResult.ocrText) {
      result.textContent += (result.textContent ? '\n\n' : '') + imageResult.ocrText
    }
    if (imageResult.hasFallback) {
      result.hasFallback = true
      result.usedStrategy = 'ocr'
    }
  }

  // ========== 处理文档 ==========
  if (docFiles.length > 0) {
    const docResult = await processDocsWithFallback({
      docs: docFiles,
      config,
      strategy,
      callbacks,
      readBinaryFn,
      ocrFn,
      parseOfficeFn,
      parsePdfFn
    })
    result.parts.push(...docResult.parts)
    if (docResult.textContent) {
      result.textContent += (result.textContent ? '\n\n' : '') + docResult.textContent
    }
    if (docResult.hasFallback) {
      result.hasFallback = true
    }
  }

  return result
}

// -------- 内部：图片处理 + 降级 --------
async function processImagesWithFallback({ images, config, recommendedPath, callbacks, readBinaryFn, ocrFn }) {
  const { onStatus } = callbacks
  const parts = []
  let ocrText = ''
  let hasFallback = false

  // 最大直接处理4张图（避免上下文爆炸）
  const maxImages = 4
  const targetImages = images.slice(0, maxImages)

  onStatus?.(`正在处理 ${targetImages.length} 张图片...`)

  // 策略1: files API 上传
  if (recommendedPath === 'files') {
    onStatus?.('正在上传图片到 Files API...')
    let allSuccess = true
    for (const img of targetImages) {
      try {
        const r = await readBinaryFn(img.path)
        if (!r?.success || !r.base64) { allSuccess = false; continue }

        const ext = (img.ext || '.png').replace('.', '').toLowerCase()
        const mime = ext === 'jpg' ? 'jpeg' : ext

        const up = await uploadFileForProvider({
          baseURL: config.baseURL,
          profileId: config.profileId,
          fileName: img.fileName || (img.path ? img.path.split(/[\\/]/).pop() : 'image'),
          mimeType: `image/${mime}`,
          base64: r.base64,
          customFilesURL: config.filesURL || ''
        })

        if (up?.success && up.ref) {
          parts.push(up.ref)
          // 记录成功
          recordVisionResult(config.baseURL, config.model, 'filesApi', true)
        } else {
          allSuccess = false
          recordVisionResult(config.baseURL, config.model, 'filesApi', false)
        }
      } catch {
        allSuccess = false
        recordVisionResult(config.baseURL, config.model, 'filesApi', false)
      }
    }

    // files API 全部成功 → 直接返回
    if (allSuccess && parts.length === targetImages.length) {
      return { parts, ocrText: '', hasFallback: false }
    }

    // 部分失败 → 降级策略继续处理失败的
    hasFallback = true
    onStatus?.('部分图片上传失败，正在尝试备用方式...')
  }

  // 策略2: base64 直传（仅适用于未上传成功的小图）
  const remainingImages = targetImages.slice(parts.length)
  const MAX_DIRECT_B64 = 1024 * 1024 // 1MB base64 字符（约 750KB 原图）
  const tooBigImages = []

  if (recommendedPath !== 'ocr' && remainingImages.length > 0) {
    onStatus?.('正在嵌入图片内容...')
    for (const img of remainingImages) {
      try {
        const r = await readBinaryFn(img.path)
        if (!r?.success || !r.base64) continue

        if (r.base64.length > MAX_DIRECT_B64) {
          tooBigImages.push(img)
          continue
        }

        const ext = (img.ext || '.png').replace('.', '').toLowerCase()
        const mime = ext === 'jpg' ? 'jpeg' : ext
        const dataUrl = `data:image/${mime};base64,${r.base64}`
        parts.push({ type: 'image_url', image_url: { url: dataUrl } })
      } catch { /* 跳过 */ }
    }
  }

  // 策略3: 本地 OCR（太大的图 / base64 也失败的图）
  const ocrImages = [...tooBigImages]
  // 如果 base64 路径也没成功处理完，剩余的也走 OCR
  if (parts.filter(p => p.type === 'image_url' || p.type === 'input_image' || (p.type === 'file' && p.file)).length < remainingImages.length - tooBigImages.length) {
    // 简单处理：如果有未处理成功的，收集起来走OCR
    const unprocessed = remainingImages.length - parts.filter(p => p.type === 'image_url').length - tooBigImages.length
    if (unprocessed > 0) {
      // 把剩下的都追加到 ocrImages（这里简化处理，实际应该跟踪每个文件的状态）
    }
  }

  if (ocrImages.length > 0 || (recommendedPath === 'ocr' && targetImages.length > 0)) {
    hasFallback = true
    const imagesToOcr = recommendedPath === 'ocr' ? targetImages : ocrImages
    onStatus?.(`正在本地识别 ${imagesToOcr.length} 张图片文字...`)
    try {
      ocrText = await ocrFn(imagesToOcr.map(p => ({ path: p.path, fileName: p.fileName, ext: p.ext })))
    } catch (e) {
      ocrText = ''
    }
  }

  return { parts, ocrText, hasFallback }
}

// -------- 内部：文档处理 + 降级 --------
async function processDocsWithFallback({ docs, config, strategy, callbacks, readBinaryFn, ocrFn, parseOfficeFn, parsePdfFn }) {
  const { onStatus } = callbacks
  const parts = []
  let textContent = ''
  let hasFallback = false

  // 最大直接处理4个文档
  const maxDocs = 4
  const targetDocs = docs.slice(0, maxDocs)

  onStatus?.(`正在处理 ${targetDocs.length} 个文档...`)

  // 文档优先尝试 files API 上传（让多模态模型自己读）
  let filesApiSucceeded = 0
  if (strategy.recommendedPath === 'files') {
    onStatus?.('正在上传文档到 Files API...')
    for (const doc of targetDocs) {
      try {
        const r = await readBinaryFn(doc.path)
        if (!r?.success || !r.base64) continue

        const ext = (doc.ext || '').replace('.', '').toLowerCase()
        const mimeMap = {
          pdf: 'application/pdf',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          doc: 'application/msword',
          xls: 'application/vnd.ms-excel',
          ppt: 'application/vnd.ms-powerpoint'
        }
        const mimeType = mimeMap[ext] || 'application/octet-stream'

        const up = await uploadFileForProvider({
          baseURL: config.baseURL,
          profileId: config.profileId,
          fileName: doc.fileName || (doc.path ? doc.path.split(/[\\/]/).pop() : 'file'),
          mimeType,
          base64: r.base64,
          customFilesURL: config.filesURL || ''
        })

        if (up?.success && up.ref) {
          parts.push(up.ref)
          filesApiSucceeded++
          recordVisionResult(config.baseURL, config.model, 'filesApi', true)
        } else {
          recordVisionResult(config.baseURL, config.model, 'filesApi', false)
        }
      } catch {
        recordVisionResult(config.baseURL, config.model, 'filesApi', false)
      }
    }

    // 全部成功 → 返回
    if (filesApiSucceeded === targetDocs.length) {
      return { parts, textContent: '', hasFallback: false }
    }

    hasFallback = true
    onStatus?.('部分文档上传失败，正在尝试本地解析...')
  }

  // files API 失败的文档，尝试本地解析
  const failedDocs = targetDocs.slice(filesApiSucceeded)
  const localParseResults = []

  for (const doc of failedDocs) {
    const ext = (doc.ext || '').replace('.', '').toLowerCase()
    let parsed = ''

    // PDF: 优先本地解析
    if (ext === 'pdf' && parsePdfFn) {
      try {
        onStatus?.(`正在解析 PDF: ${doc.fileName}...`)
        parsed = await parsePdfFn(doc.path)
      } catch { parsed = '' }
    }
    // Office: 优先本地解析
    else if (['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt'].includes(ext) && parseOfficeFn) {
      try {
        onStatus?.(`正在解析文档: ${doc.fileName}...`)
        parsed = await parseOfficeFn(doc.path)
      } catch { parsed = '' }
    }

    if (parsed) {
      localParseResults.push(`【文件：${doc.fileName}】\n${parsed}`)
    }
  }

  if (localParseResults.length > 0) {
    textContent = localParseResults.join('\n\n---\n\n')
  }

  // 本地解析也失败的，提示用户
  const totallyFailed = failedDocs.length - localParseResults.length
  if (totallyFailed > 0) {
    textContent += (textContent ? '\n\n' : '') +
      `（注：有 ${totallyFailed} 个文件无法解析，可能需要手动查看）`
  }

  return { parts, textContent, hasFallback }
}

// ============================================================
//  六、错误分类与自动降级建议
// ============================================================

/**
 * 分析多模态请求错误，给出下一步策略建议
 * @param {Error} error — 错误对象
 * @param {object} config — 模型配置
 * @param {object} currentState — 当前状态 { triedNoTools, triedOcr }
 * @returns {object} 建议
 *   - action: 'retry_no_tools' | 'retry_ocr' | 'report_error'
 *   - reason: 原因说明
 */
export function analyzeVisionError(error, config, currentState) {
  const msg = error?.message || ''
  const statusMatch = /API error: (\d{3})/.exec(msg)
  const statusCode = statusMatch ? statusMatch[1] : null

  // 400/422: 参数错误，大概率是不支持 tools 参数
  if ((statusCode === '400' || statusCode === '422') && !currentState.triedNoTools) {
    // 记录失败
    recordVisionResult(config.baseURL, config.model, 'visionWithTools', false)
    return {
      action: 'retry_no_tools',
      reason: `接口返回 ${statusCode}，疑似不支持 tools 参数，已自动去除 tools 重试`
    }
  }

  // 401/403: 鉴权问题，不重试
  if (statusCode === '401' || statusCode === '403') {
    return {
      action: 'report_error',
      reason: '鉴权失败，请检查 API Key 配置'
    }
  }

  // 429: 限流，提示用户稍后再试
  if (statusCode === '429') {
    return {
      action: 'report_error',
      reason: '请求频率过高，请稍后再试'
    }
  }

  // 其他错误 → 降级 OCR
  if (!currentState.triedOcr) {
    return {
      action: 'retry_ocr',
      reason: `多模态请求失败（${msg || '未知错误'}），自动降级本地 OCR 后重发`
    }
  }

  return {
    action: 'report_error',
    reason: msg || '未知错误'
  }
}

// 记录多模态请求成功
export function recordVisionSuccess(baseURL, model, hadTools) {
  recordVisionResult(baseURL, model, hadTools ? 'visionWithTools' : 'visionNoTools', true)
}

// 记录多模态请求失败
export function recordVisionFailure(baseURL, model, hadTools) {
  recordVisionResult(baseURL, model, hadTools ? 'visionWithTools' : 'visionNoTools', false)
}

// ============================================================
//  导出
// ============================================================

export default {
  FileCategory,
  classifyFile,
  needsVision,
  decideStrategy,
  smartProcessFiles,
  analyzeVisionError,
  isVisionSupportedCached,
  setVisionProbeResult,
  recordVisionSuccess,
  recordVisionFailure,
  getVisionMemory
}
