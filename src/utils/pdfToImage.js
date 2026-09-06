/**
 * PDF 渲染为图片（供 OCR 兜底使用）
 * 场景：PDF 文本层不可提取（扫描版 / CID 字体未内嵌映射的中文 PDF）时，
 *       用 pdfjs-dist 把页面渲染成 PNG，再交给主进程 tesseract OCR 识别。
 *
 * 仅在渲染进程可用（依赖 DOM canvas）。
 * 使用 legacy build（对 Electron/旧 Chromium 兼容性最好），worker 走 Vite ?url 静态资源。
 */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * 把 PDF 渲染为 PNG base64 数组（不含 data: 前缀）
 * @param {ArrayBuffer|Uint8Array} buf PDF 二进制
 * @param {{ pageStart?: number, pageEnd?: number, maxPages?: number, scale?: number }} opts
 *   - pageStart: 起始页（1-based，默认 1）
 *   - pageEnd: 结束页（含，默认 = pageStart + maxPages - 1）；传了则精确渲染到该页
 *   - maxPages: 未指定 pageEnd 时最多渲染的页数（默认 8）
 *   - scale: 渲染缩放倍数（默认 2）
 * @returns {Promise<{ success: boolean, pages?: string[], totalPages?: number, renderedPages?: number, pageStart?: number, pageEnd?: number, error?: string }>}
 */
export async function pdfToImages(buf, { pageStart = 1, pageEnd = null, maxPages = 8, scale = 2 } = {}) {
  let doc = null
  try {
    const data = buf instanceof ArrayBuffer ? buf : new Uint8Array(buf)
    doc = await pdfjsLib.getDocument({ data }).promise
    const totalPages = doc.numPages || 0
    if (!totalPages) return { success: false, error: 'PDF 没有可渲染的页面' }

    const start = Math.max(1, Math.min(totalPages, Math.floor(Number(pageStart) || 1)))
    let end
    if (pageEnd != null && pageEnd !== '') {
      end = Math.max(start, Math.min(totalPages, Math.floor(Number(pageEnd) || start)))
    } else {
      end = Math.min(totalPages, start + Math.max(1, maxPages) - 1)
    }

    const pages = []
    for (let i = start; i <= end; i++) {
      const page = await doc.getPage(i)
      try {
        const viewport = page.getViewport({ scale: Math.max(1, scale) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) { page.cleanup(); continue }
        await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise
        const dataUrl = canvas.toDataURL('image/png')
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
        if (base64) pages.push(base64)
      } finally {
        page.cleanup()
      }
    }
    if (!pages.length) return { success: false, error: 'PDF 页面渲染失败（可能为加密或损坏文件）' }
    return { success: true, pages, totalPages, renderedPages: pages.length, pageStart: start, pageEnd: end }
  } catch (e) {
    return { success: false, error: 'PDF 渲染失败: ' + (e?.message || e) }
  } finally {
    if (doc) { try { await doc.destroy() } catch {} }
  }
}
