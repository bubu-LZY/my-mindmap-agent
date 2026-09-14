/**
 * 文档解析后台线程
 *
 * 主线程把文件字节转移（transfer）进来，在这里完成 PDF / DOCX / PPTX / XLSX / XLS / CSV 解析，
 * 只把结果文本回传。目的是把 mammoth / JSZip / exceljs / pdfjs 这些 CPU 密集型解析从 UI 线程
 * 挪开，避免解析大文档时界面卡死；同时线程可被直接 terminate，所以「停止」是真正的硬中断。
 *
 * 解析实现与主线程共用同一份代码（docParseService.js 的 parseInWorker），不做重复实现。
 */
import { parseInWorker } from './docParseService.js'

self.onmessage = async (event) => {
  const { id, ext, filePath, buffer } = event.data || {}
  try {
    const res = await parseInWorker(ext, buffer, filePath)
    self.postMessage({ id, ok: true, res })
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) })
  }
}