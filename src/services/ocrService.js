// OCR 服务 - 通过 IPC 调用主进程的 tesseract.js
export class OCRService {
  // 识别图片文件
  async recognizeImage(imagePath) {
    const result = await window.electronAPI.ocrImage(imagePath)
    return result
  }

  // 识别 base64 图片数据
  async recognizeBase64(base64Data, lang = 'chi_sim+eng') {
    const result = await window.electronAPI.ocrBase64(base64Data, lang)
    return result
  }

  // 从文件输入元素获取图片并识别
  async recognizeFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const base64 = e.target.result.split(',')[1]
          const result = await this.recognizeBase64(base64)
          resolve(result)
        } catch (err) {
          reject(err)
        }
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // OCR 识别并生成思维导图（返回识别文本，AI 处理由调用方完成）
  async recognizeToMindmap(base64Data, lang = 'chi_sim+eng') {
    const result = await window.electronAPI.ocrToMindmap(base64Data, lang)
    return result
  }

  // 智能识别 base64 图片数据（优先 AI 视觉模型，降级 OCR）
  // 返回 { success, text, source: 'ai_vision' | 'ocr' }
  async recognizeSmart(base64Data, lang = 'chi_sim+eng') {
    const result = await window.electronAPI.ocrSmart(base64Data, lang)
    return result
  }

  // 从文件进行智能识别（优先 AI 视觉模型，降级 OCR）
  // 将 File 转为 base64 后调用 recognizeSmart
  async recognizeSmartFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const base64 = e.target.result.split(',')[1]
          const result = await this.recognizeSmart(base64)
          resolve(result)
        } catch (err) {
          reject(err)
        }
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }
}

export const ocrService = new OCRService()
