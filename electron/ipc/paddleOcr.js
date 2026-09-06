/**
 * PaddleOCR 本地 OCR 引擎（基于 eSearch-OCR + onnxruntime-node）
 *
 * 特性：
 *   - 中文识别效果远优于 tesseract.js
 *   - 支持排版分析（分栏、段落、阅读方向）
 *   - 支持文档旋转自动校正
 *   - 模型按需自动下载，缓存到用户数据目录
 *   - 失败自动降级到 tesseract.js
 *
 * 模型来源：eSearch-OCR 项目发布的 PaddleOCR ONNX 模型
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const { app } = require('electron')
const zlib = require('zlib')

// ============================================================
//  模型配置
// ============================================================

// 默认使用 v6 tiny 版：体积小、速度快，效果比 tesseract 好很多
// 后续可根据用户配置切换到更大的模型
const MODEL_CONFIG = {
  // v6 tiny 中英文混合（约 5MB，最快）
  default: {
    name: 'ppocr_v6_tiny',
    version: 'v6_tiny',
    zipUrl: 'https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0/ppocr_v6_tiny.zip',
    // 备用下载地址（国内镜像，如果GitHub慢的话）
    zipUrlMirror: 'https://ghproxy.cc/https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0/ppocr_v6_tiny.zip',
    files: ['det.onnx', 'rec.onnx', 'ppocr_keys_v1.txt']
  },
  // v5 mobile 中英文混合（约 10MB，效果更好一点）
  v5_mobile: {
    name: 'ppocr_v5_mobile',
    version: 'v5_mobile',
    zipUrl: 'https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0/ppocr_v5_mobile.zip',
    zipUrlMirror: 'https://ghproxy.cc/https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0/ppocr_v5_mobile.zip',
    files: ['det.onnx', 'rec.onnx', 'ppocr_keys_v1.txt']
  },
  // 文档方向识别模型（约 1MB，所有模型共用）
  doc_cls: {
    name: 'doc_cls',
    version: '8.1.0',
    fileUrl: 'https://github.com/xushengfeng/eSearch-OCR/releases/download/8.1.0/doc_cls.onnx',
    fileUrlMirror: 'https://ghproxy.cc/https://github.com/xushengfeng/eSearch-OCR/releases/download/8.1.0/doc_cls.onnx',
    fileName: 'doc_cls.onnx'
  }
}

// ============================================================
//  路径管理
// ============================================================

function getModelDir() {
  const userData = app ? app.getPath('userData') : path.join(__dirname, '..', '..', 'ocr_models')
  const dir = path.join(userData, 'ocr_models')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function getModelPath(modelKey) {
  const dir = path.join(getModelDir(), modelKey)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ============================================================
//  文件下载（带进度、重试、镜像 fallback）
// ============================================================

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, {
      headers: { 'User-Agent': 'my-mindmap-agent/1.0' }
    }, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, destPath, onProgress).then(resolve).catch(reject)
        req.destroy()
        return
      }

      if (res.statusCode !== 200) {
        reject(new Error(`下载失败：HTTP ${res.statusCode}`))
        req.destroy()
        return
      }

      const totalSize = parseInt(res.headers['content-length'] || '0', 10)
      let downloaded = 0
      const stream = fs.createWriteStream(destPath)

      res.on('data', (chunk) => {
        downloaded += chunk.length
        stream.write(chunk)
        if (onProgress && totalSize > 0) {
          onProgress(downloaded / totalSize, downloaded, totalSize)
        }
      })

      res.on('end', () => {
        stream.end()
        resolve(destPath)
      })

      res.on('error', (e) => {
        stream.destroy()
        fs.unlink(destPath, () => {})
        reject(e)
      })
    })

    req.on('error', reject)
    req.setTimeout(30000, () => {
      req.destroy(new Error('下载超时'))
    })
  })
}

async function downloadWithFallback(urls, destPath, onProgress) {
  let lastError = null
  for (const url of urls) {
    try {
      return await downloadFile(url, destPath, onProgress)
    } catch (e) {
      lastError = e
    }
  }
  throw lastError || new Error('所有下载地址均失败')
}

// ============================================================
//  ZIP 解压（轻量实现，仅支持无压缩/DEFLATE 的 zip）
// 因为是简单的模型文件 zip，用 node 内置能力即可，不需要引入额外库
// ============================================================

async function unzipSimple(zipPath, destDir) {
  // 用 unzipper 或者直接调用系统命令？
  // 为了不引入新依赖，我们用 PowerShell 的 Expand-Archive
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process')
    const cmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // PowerShell 不行的话，试试 unzipper 库（但我们没装）
        reject(err)
      } else {
        resolve(destDir)
      }
    })
  })
}

// ============================================================
//  模型下载与验证
// ============================================================

async function ensureModel(modelKey, onProgress) {
  const config = MODEL_CONFIG[modelKey]
  if (!config) throw new Error(`未知模型：${modelKey}`)

  const modelDir = getModelPath(config.name)

  // doc_cls 是单个文件，其他是 zip 包
  if (modelKey === 'doc_cls') {
    const filePath = path.join(modelDir, config.fileName)
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      return filePath
    }
    if (onProgress) onProgress(0, 0, 0, `正在下载文档方向识别模型...`)
    await downloadWithFallback(
      [config.fileUrl, config.fileUrlMirror],
      filePath,
      (p, d, t) => onProgress(p, d, t, `正在下载文档方向识别模型...`)
    )
    return filePath
  }

  // 检查是否已经下载并解压
  const allExist = config.files.every(f => fs.existsSync(path.join(modelDir, f)))
  if (allExist) {
    return modelDir
  }

  // 下载 zip
  const zipPath = path.join(getModelDir(), `${config.name}.zip`)

  if (onProgress) onProgress(0, 0, 0, `正在下载 OCR 模型 (${config.version})...`)

  await downloadWithFallback(
    [config.zipUrl, config.zipUrlMirror],
    zipPath,
    (p, d, t) => onProgress(p, d, t, `正在下载 OCR 模型 (${config.version})...`)
  )

  // 解压
  if (onProgress) onProgress(0.95, 0, 0, '正在解压模型文件...')
  await unzipSimple(zipPath, modelDir)

  // 删除 zip
  try { fs.unlinkSync(zipPath) } catch {}

  // 验证
  const stillMissing = config.files.filter(f => !fs.existsSync(path.join(modelDir, f)))
  if (stillMissing.length > 0) {
    throw new Error(`模型文件不完整，缺少：${stillMissing.join(', ')}`)
  }

  return modelDir
}

// ============================================================
//  PaddleOCR 引擎
// ============================================================

let paddleOcrInstance = null
let paddleOcrInitializing = null

async function initPaddleOCR(onProgress) {
  if (paddleOcrInstance) return paddleOcrInstance
  if (paddleOcrInitializing) return paddleOcrInitializing

  paddleOcrInitializing = (async () => {
    try {
      // 1. 确保模型已下载
      const modelDir = await ensureModel('default', onProgress)
      const docClsPath = await ensureModel('doc_cls', onProgress)

      if (onProgress) onProgress(0.98, 0, 0, '正在初始化 OCR 引擎...')

      // 2. 加载依赖
      const ocr = require('esearch-ocr')
      const ort = require('onnxruntime-node')
      const { createCanvas, loadImage } = require('canvas')

      // 3. 设置 canvas（Node.js 环境需要）
      ocr.setCanvas(createCanvas)

      // 4. 读取字典文件
      const dictPath = path.join(modelDir, 'ppocr_keys_v1.txt')
      const decodeDic = fs.readFileSync(dictPath, 'utf-8').trim()

      // 5. 读取模型文件为 Buffer
      const detBuffer = fs.readFileSync(path.join(modelDir, 'det.onnx'))
      const recBuffer = fs.readFileSync(path.join(modelDir, 'rec.onnx'))
      const docClsBuffer = fs.readFileSync(docClsPath)

      // 6. 初始化 OCR 引擎
      const instance = await ocr.init({
        ort,
        det: {
          input: detBuffer.buffer.slice(detBuffer.byteOffset, detBuffer.byteOffset + detBuffer.byteLength)
        },
        rec: {
          input: recBuffer.buffer.slice(recBuffer.byteOffset, recBuffer.byteOffset + recBuffer.byteLength),
          decodeDic,
          optimize: {
            space: true // v6 默认开空格优化
          }
        },
        docCls: {
          input: docClsBuffer.buffer.slice(docClsBuffer.byteOffset, docClsBuffer.byteOffset + docClsBuffer.byteLength)
        },
        analyzeLayout: {
          // 启用排版分析
        }
      })

      paddleOcrInstance = instance
      return instance
    } catch (e) {
      paddleOcrInitializing = null
      throw e
    }
  })()

  return paddleOcrInitializing
}

// ============================================================
//  主识别函数
// ============================================================

/**
 * PaddleOCR 识别
 * @param {Buffer|string} input — Buffer 或图片路径或 base64
 * @param {object} opts — 选项 { withLayout, lang, onProgress, event }
 * @returns {Promise<{success: boolean, text: string, layout?: object}>}
 */
async function paddleRecognize(input, opts = {}) {
  const { withLayout = false, onProgress, event } = opts

  // 发送进度事件
  const sendProgress = (status, progress = 0) => {
    if (event && event.sender && !event.sender.isDestroyed()) {
      event.sender.send('ocr-progress', { status, progress })
    }
    onProgress?.(status, progress)
  }

  try {
    sendProgress('初始化 OCR 引擎...', 0.1)
    const ocr = await initPaddleOCR((p, d, t, msg) => {
      sendProgress(msg || '下载模型中...', p)
    })

    sendProgress('正在识别文字...', 0.5)

    // 处理输入：Buffer → base64 data URL
    let imgInput = input
    if (Buffer.isBuffer(input)) {
      // 用 canvas 加载 Buffer，转成 ImageData
      const { loadImage, createCanvas } = require('canvas')
      const img = await loadImage(input)
      const canvas = createCanvas(img.width, img.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      imgInput = ctx.getImageData(0, 0, img.width, img.height)
    } else if (typeof input === 'string' && input.startsWith('data:')) {
      // 已经是 data URL
    } else if (typeof input === 'string' && fs.existsSync(input)) {
      // 文件路径
      const buf = fs.readFileSync(input)
      const { loadImage, createCanvas } = require('canvas')
      const img = await loadImage(buf)
      const canvas = createCanvas(img.width, img.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      imgInput = ctx.getImageData(0, 0, img.width, img.height)
    }

    // 执行 OCR
    const result = await ocr.ocr(imgInput)

    sendProgress('识别完成', 1)

    // 提取文本
    let text = ''
    if (result && result.parragraphs && result.parragraphs.length > 0) {
      // 用排版分析后的段落结果（阅读顺序正确）
      text = result.parragraphs.map(item => item.text).join('\n')
    } else if (result && result.src && result.src.length > 0) {
      // 退化为逐行结果
      text = result.src.map(item => item.text).join('\n')
    }

    return {
      success: true,
      text: text.trim(),
      layout: withLayout ? {
        columns: result.columns || [],
        parragraphs: result.parragraphs || [],
        readingDir: result.readingDir || null,
        angle: result.angle || null,
        lines: result.src || []
      } : undefined
    }
  } catch (e) {
    return {
      success: false,
      error: e.message || String(e),
      text: ''
    }
  }
}

// ============================================================
//  引擎状态查询
// ============================================================

function isPaddleOcrAvailable() {
  return paddleOcrInstance !== null
}

function getOcrEngineName() {
  return paddleOcrInstance ? 'PaddleOCR (v6)' : 'tesseract.js'
}

// ============================================================
//  导出
// ============================================================

module.exports = {
  initPaddleOCR,
  paddleRecognize,
  isPaddleOcrAvailable,
  getOcrEngineName,
  ensureModel,
  getModelDir,
  MODEL_CONFIG
}
