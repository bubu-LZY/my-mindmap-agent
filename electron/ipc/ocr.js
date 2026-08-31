const { ipcMain, app } = require('electron')
const path = require('path')
const fs = require('fs')
const { resolveProfileForVision, isVisionEnabled } = require('./aiConfig')

// worker 复用缓存：按语言缓存，避免每次 OCR 都重新初始化（语言模型加载是慢的主要来源）
const workerCache = new Map()
// worker 最后使用时间戳，用于 LRU 淘汰
const workerLastUsed = new Map()
// 最大缓存 worker 数量（每种语言一个 worker，内存占用不小，限制上限）
const MAX_CACHED_WORKERS = 3
// worker 空闲超时（30 分钟未使用自动清理）
const WORKER_IDLE_TIMEOUT_MS = 30 * 60 * 1000

// 清理过期 worker（LRU + 空闲超时）
function cleanupIdleWorkers() {
  const now = Date.now()
  // 先按空闲超时清理
  for (const [key, lastTime] of workerLastUsed) {
    if (now - lastTime > WORKER_IDLE_TIMEOUT_MS) {
      const worker = workerCache.get(key)
      if (worker) {
        try { worker.terminate && worker.terminate() } catch (e) {}
      }
      workerCache.delete(key)
      workerLastUsed.delete(key)
    }
  }
  // 再按数量上限清理（淘汰最久未用的）
  if (workerCache.size > MAX_CACHED_WORKERS) {
    const sorted = [...workerLastUsed.entries()].sort((a, b) => a[1] - b[1])
    const toRemove = sorted.slice(0, sorted.length - MAX_CACHED_WORKERS)
    for (const [key] of toRemove) {
      const worker = workerCache.get(key)
      if (worker) {
        try { worker.terminate && worker.terminate() } catch (e) {}
      }
      workerCache.delete(key)
      workerLastUsed.delete(key)
    }
  }
}

/**
 * 创建/获取 tesseract.js worker（复用缓存，LRU 淘汰 + 空闲超时清理）
 * v5 API: createWorker(lang, oem, options)
 * - lang: 语言代码，如 'chi_sim+eng'
 * - oem: OCR 引擎模式，1 = LSTM only
 */
async function getWorker(lang = 'chi_sim+eng', event = null) {
  const { createWorker } = require('tesseract.js')
  const key = lang || 'chi_sim+eng'
  if (workerCache.has(key)) {
    workerLastUsed.set(key, Date.now())
    return workerCache.get(key)
  }
  // 创建新 worker 前先清理过期的
  cleanupIdleWorkers()
  const worker = await createWorker(key, 1, {
    logger: m => {
      if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('ocr-progress', { status: m.status, progress: m.progress })
      }
    }
  })
  workerCache.set(key, worker)
  workerLastUsed.set(key, Date.now())
  return worker
}

// OCR 串行锁：worker 同一时间只能识别一张图，并发调用排队
let ocrQueue = Promise.resolve()
function enqueueOCR(task) {
  const run = ocrQueue.then(task, task)
  ocrQueue = run.catch(() => {})
  return run
}

/**
 * 使用 tesseract.js 进行 OCR 识别（复用 worker，不 terminate）
 */
async function doOCR(base64Data, lang, event) {
  const worker = await getWorker(lang, event)
  const buffer = Buffer.from(base64Data, 'base64')
  const { data: { text } } = await enqueueOCR(() => worker.recognize(buffer))
  return { success: true, text }
}

/**
 * 构建 chat completions API URL
 */
function buildChatURL(baseURL, autoComplete = true) {
  if (!baseURL) return ''
  let url = baseURL.trim().replace(/\/+$/, '')
  // 自动补全关闭：地址原样使用，适配自带独立后缀的厂商
  if (autoComplete === false) return url
  // 自愈历史配置中的双重版本路径（如 /v4/v1/chat/completions → /v4/chat/completions）
  url = url.replace(/(\/v\d+[a-z]*)(?:\/v\d+[a-z]*)+\/chat\/completions$/i, '$1/chat/completions')
  if (/\/chat\/completions$/i.test(url)) return url
  // 已带版本号（/v1、/v4、/compatible-mode/v1 等）→ 只补 /chat/completions，避免 /v4/v1/... 双重路径
  if (/\/v\d+[a-z]*$/i.test(url)) return url + '/chat/completions'
  return url + '/v1/chat/completions'
}

/**
 * 根据 baseURL 域名识别厂商（与渲染进程 fileUploadService 保持一致）
 */
function detectVisionProvider(baseURL) {
  const url = String(baseURL || '').toLowerCase()
  if (url.includes('moonshot')) return 'kimi'
  if (url.includes('bigmodel') || url.includes('zhipu')) return 'zhipu'
  if (url.includes('volcengine') || url.includes('ark.cn') || url.includes('byteplus')) return 'volcengine'
  if (url.includes('dashscope') || url.includes('aliyun')) return 'qwen'
  if (url.includes('generativelanguage') || url.includes('googleapis')) return 'gemini'
  if (url.includes('deepseek')) return 'deepseek'
  return 'openai'
}

/**
 * 上传图片到厂商 files API，返回消息 content part（失败返回 null → 调用方降级 base64 直发）
 */
async function uploadImageViaFilesAPI({ baseURL, apiKey, filesURL, base64 }) {
  try {
    const provider = detectVisionProvider(baseURL)
    let uploadURL = filesURL ? String(filesURL).trim().replace(/\/+$/, '') : ''
    if (!uploadURL) {
      let base = String(baseURL || '').trim().replace(/\/+$/, '')
      if (!base) return null
      base = base.replace(/\/(chat\/completions|completions)$/i, '')
      if (provider === 'gemini') {
        uploadURL = /\/files$/.test(base) ? base : (/\/v1beta$/.test(base) ? base + '/files' : base + '/v1beta/files')
      } else if (provider === 'deepseek') {
        // DeepSeek files 端点是 {origin}/files，与路径（/v1、/v1/chat/completions）无关
        const m = base.match(/^(https?:\/\/[^/]+)/i)
        uploadURL = (m ? m[1] : base) + '/files'
      } else {
        uploadURL = /\/files$/.test(base) ? base : base + '/files'
      }
    }
    const purpose = provider === 'openai' ? 'vision' : (provider === 'kimi' ? 'image' : (provider === 'deepseek' ? 'user_data' : 'file-extract'))
    const buf = Buffer.from(base64, 'base64')
    const form = new FormData()
    form.append('file', new Blob([buf], { type: 'image/png' }), 'image.png')
    if (purpose) form.append('purpose', purpose)
    const headers = {}
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    const response = await fetch(uploadURL, { method: 'POST', headers, body: form })
    if (!response.ok) return null
    const data = await response.json().catch(() => null)
    if (!data) return null
    const fileId = data.id || data.file_id || data.fileId || ''
    const fileUri = data.uri || data.fileUri || data.file_uri || ''
    const url = data.url || data.file_url || data.download_url || ''
    if (provider === 'gemini') {
      return fileUri ? { type: 'file_data', file_data: { file_uri: fileUri, mime_type: 'image/png' } } : null
    }
    if (provider === 'qwen') {
      return url ? { type: 'image_url', image_url: { url } } : null
    }
    // DeepSeek：chat completions 用 { type: 'file', file_id }（file_id 在顶层）
    if (provider === 'deepseek') {
      return fileId ? { type: 'file', file_id: fileId } : null
    }
    if (fileId) return { type: 'input_image', file_id: fileId }
    if (url) return { type: 'image_url', image_url: { url } }
    return null
  } catch (e) {
    return null
  }
}

/**
 * 尝试使用 AI 视觉模型识别图片
 * 发送 base64 图片到 OpenAI 兼容的 chat completions API
 * 返回 { success, text } 或 { success: false, error }
 */
async function tryAIVision(base64Data, event) {
  try {
    const vision = resolveProfileForVision()
    if (!vision) {
      return { success: false, error: '多模态识别未启用' }
    }
    const baseURL = vision.baseURL
    const apiKey = vision.apiKey
    const model = vision.model
    if (!baseURL || !apiKey) {
      return { success: false, error: '多模态配置档缺失（未填写 API 地址或 Key）' }
    }
    if (!model) {
      return { success: false, error: '多模态配置档未填写模型名称' }
    }

    const chatURL = buildChatURL(baseURL, vision.autoComplete !== false)

    // 确保 base64 数据格式正确（去除 data:image/... 前缀）
    let imageBase64 = base64Data
    if (imageBase64.startsWith('data:')) {
      imageBase64 = imageBase64.split(',')[1]
    }

    // 优先走 files API 上传（按厂商自动选择），失败降级 base64 直发
    let imagePart = { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
    try {
      const up = await uploadImageViaFilesAPI({
        baseURL,
        apiKey,
        filesURL: vision.filesURL || '',
        base64: imageBase64
      })
      if (up) imagePart = up
    } catch (e) { /* files API 失败，降级 base64 直发 */ }

    // 发送进度通知
    if (event && event.sender && !event.sender.isDestroyed()) {
      event.sender.send('ocr-progress', {
        status: 'AI 视觉模型识别中...',
        progress: 0.3
      })
    }

    const response = await fetch(chatURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: '请识别并提取这张图片中的所有文字内容。只返回识别到的文字，保持原有格式和结构。不要添加任何解释或说明。'
              },
              imagePart
            ]
          }
        ],
        max_tokens: 4096,
        temperature: 0
      })
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText)
      return { success: false, error: `AI 视觉模型请求失败: ${response.status} ${errText}` }
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content

    if (!text || !text.trim()) {
      return { success: false, error: 'AI 视觉模型未返回有效内容' }
    }

    // 发送进度通知
    if (event && event.sender && !event.sender.isDestroyed()) {
      event.sender.send('ocr-progress', {
        status: 'AI 视觉模型识别完成',
        progress: 1.0
      })
    }

    return { success: true, text: text.trim() }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// 识别图片文件（通过文件路径）
ipcMain.handle('ocr-image', async (event, imagePath) => {
  try {
    // 路径安全校验
    if (typeof imagePath !== 'string' || !imagePath.trim()) {
      return { success: false, error: '图片路径无效' }
    }
    if (imagePath.includes('\0') || /[\x00-\x1f\x7f]/.test(imagePath)) {
      return { success: false, error: '路径包含非法字符' }
    }
    const normalized = path.normalize(imagePath)
    // 限制读取范围：userData + temp + 桌面 + 文档 + 下载
    const allowedRoots = [
      path.normalize(app.getPath('userData')),
      path.normalize(app.getPath('temp')),
      path.normalize(require('os').tmpdir()),
      path.normalize(app.getPath('desktop')),
      path.normalize(app.getPath('documents')),
      path.normalize(app.getPath('downloads'))
    ]
    const resolved = path.resolve(normalized)
    let allowed = false
    for (const root of allowedRoots) {
      if (resolved === root || resolved.startsWith(root + path.sep)) {
        allowed = true
        break
      }
    }
    if (!allowed) {
      return { success: false, error: '图片路径不在允许范围内（请将图片放到桌面/文档/下载目录后再试）' }
    }
    if (!fs.existsSync(resolved)) {
      return { success: false, error: `文件不存在: ${resolved}` }
    }
    const stat = fs.statSync(resolved)
    if (!stat.isFile()) {
      return { success: false, error: '路径不是文件' }
    }
    // 限制文件大小（最大 20MB）
    if (stat.size > 20 * 1024 * 1024) {
      return { success: false, error: '图片过大（超过 20MB）' }
    }
    const worker = await getWorker('chi_sim+eng', event)
    const { data: { text } } = await enqueueOCR(() => worker.recognize(resolved))
    return { success: true, text }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 识别 base64 图片数据（复用 worker，串行排队）
ipcMain.handle('ocr-base64', async (event, base64Data, lang = 'chi_sim+eng') => {
  try {
    const worker = await getWorker(lang, event)
    const buffer = Buffer.from(base64Data, 'base64')
    const { data: { text } } = await enqueueOCR(() => worker.recognize(buffer))
    return { success: true, text }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 智能图片识别（降级方案）：
// 1. 若已开启多模态识别（aiConfig.vision.enabled），先尝试 AI 视觉模型（多模态 URL/Key 缺省回退基础大模型）
// 2. 多模态未开启/失败，自动降级为本地 OCR (tesseract.js)；失败时返回 fallback_from/fallback_reason 供上层提示用户
// 返回 { success, text, source: 'ai_vision' | 'ocr', fallback_from?, fallback_reason? }
ipcMain.handle('ocr-smart', async (event, base64Data, lang = 'chi_sim+eng') => {
  try {
    const vision = resolveProfileForVision()
    const visionEnabled = !!vision

    // 1. 开启多模态识别时，先尝试 AI 视觉模型
    if (visionEnabled) {
      const aiResult = await tryAIVision(base64Data, event)
      if (aiResult.success) {
        return {
          success: true,
          text: aiResult.text,
          source: 'ai_vision'
        }
      }

      // 视觉模型失败：记录原因，降级为本地 OCR
      const visionError = aiResult.error || '多模态模型调用失败'
      if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('ocr-progress', {
          status: `多模态识别失败（${visionError}），降级为本地 OCR...`,
          progress: 0.5
        })
      }
      // 降级到 OCR，带出失败原因
      const ocrResult = await doOCR(base64Data, lang, event)
      if (ocrResult.success) {
        return {
          success: true,
          text: ocrResult.text,
          source: 'ocr',
          fallback_from: 'ai_vision',
          fallback_reason: visionError
        }
      }
      return { success: false, error: `多模态失败（${visionError}）且本地 OCR 也失败: ${ocrResult.error}` }
    }

    // 2. 未开启多模态，直接走本地 OCR
    const ocrResult = await doOCR(base64Data, lang, event)
    if (ocrResult.success) {
      return {
        success: true,
        text: ocrResult.text,
        source: 'ocr'
      }
    }

    return { success: false, error: ocrResult.error }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 识别并直接生成思维导图（OCR + AI）
// OCR 识别在主进程完成，AI 处理由渲染进程完成
ipcMain.handle('ocr-to-mindmap', async (event, base64Data, lang = 'chi_sim+eng') => {
  try {
    // 多模态已启用且配置完整时，先尝试 AI 视觉模型
    if (isVisionEnabled()) {
      const aiResult = await tryAIVision(base64Data, event)
      if (aiResult.success) {
        return { success: true, text: aiResult.text, source: 'ai_vision' }
      }
    }

    // 降级为本地 OCR
    const ocrResult = await doOCR(base64Data, lang, event)
    if (ocrResult.success) {
      return { success: true, text: ocrResult.text, source: 'ocr' }
    }

    return { success: false, error: ocrResult.error }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 捕获主窗口当前画面（OCR 截图识别用，仅本程序窗口内）
// 返回 { success, dataUrl, width, height }，dataUrl 为 PNG
ipcMain.handle('ocr-capture-window', async (event) => {
  try {
    const { BrowserWindow } = require('electron')
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isVisible())
    if (!win) return { success: false, error: '未找到可见窗口' }
    if (win.isMinimized()) return { success: false, error: '窗口已最小化' }
    const image = await win.webContents.capturePage()
    if (!image || image.isEmpty()) return { success: false, error: '截图失败' }
    const size = image.getSize()
    const dataUrl = image.toDataURL()
    return { success: true, dataUrl, width: size.width, height: size.height }
  } catch (e) {
    return { success: false, error: e.message }
  }
})
