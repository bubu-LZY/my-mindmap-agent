const { ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { resolveProfileForVision, isVisionEnabled } = require('./aiConfig')

// 懒加载 tesseract.js worker
let tesseractWorker = null

/**
 * 创建/获取 tesseract.js worker
 * v5 API: createWorker(lang, oem, options)
 * - lang: 语言代码，如 'chi_sim+eng'
 * - oem: OCR 引擎模式，1 = LSTM only
 * - options: 配置项，含 logger 回调
 * 语言数据会自动从 CDN 下载，首次使用时需要联网
 */
async function getWorker(lang = 'chi_sim+eng', event = null) {
  const { createWorker } = require('tesseract.js')
  const worker = await createWorker(lang, 1, {
    logger: m => {
      // 将进度发送到渲染进程
      if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('ocr-progress', {
          status: m.status,
          progress: m.progress
        })
      }
    }
  })
  return worker
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
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${imageBase64}`
                }
              }
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

/**
 * 使用 tesseract.js 进行 OCR 识别
 */
async function doOCR(base64Data, lang, event) {
  let worker = null
  try {
    worker = await getWorker(lang, event)
    const buffer = Buffer.from(base64Data, 'base64')
    const { data: { text } } = await worker.recognize(buffer)
    return { success: true, text }
  } finally {
    if (worker) {
      await worker.terminate()
    }
  }
}

// 识别图片文件（通过文件路径）
ipcMain.handle('ocr-image', async (event, imagePath) => {
  let worker = null
  try {
    if (!fs.existsSync(imagePath)) {
      return { success: false, error: `文件不存在: ${imagePath}` }
    }

    worker = await getWorker('chi_sim+eng', event)
    const { data: { text } } = await worker.recognize(imagePath)
    return { success: true, text }
  } catch (error) {
    return { success: false, error: error.message }
  } finally {
    if (worker) {
      await worker.terminate()
    }
  }
})

// 识别 base64 图片数据
ipcMain.handle('ocr-base64', async (event, base64Data, lang = 'chi_sim+eng') => {
  let worker = null
  try {
    worker = await getWorker(lang, event)
    const buffer = Buffer.from(base64Data, 'base64')
    const { data: { text } } = await worker.recognize(buffer)
    return { success: true, text }
  } catch (error) {
    return { success: false, error: error.message }
  } finally {
    if (worker) {
      await worker.terminate()
    }
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
