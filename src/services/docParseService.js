/**
 * 统一文档解析服务：PDF / DOCX / XLSX / CSV / MD / TXT → { text, html, meta }
 * - text  供 AI 阅读与知识库索引
 * - html  供 DocViewer 原样查看（可选，部分格式无）
 * - 解析库按需动态加载（unpdf / exceljs 体积大，不进主 chunk）
 */
import mammoth from 'mammoth'
import Papa from 'papaparse'
import JSZip from 'jszip'

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const decodeXmlEntities = (s) => String(s ?? '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;|&#39;/g, "'")
  .replace(/&nbsp;/g, ' ')

// IPC 二进制读取 → ArrayBuffer（优先直接用主进程传来的 Uint8Array，兼容旧版 base64）
async function readBinaryBuffer(filePath) {
  const r = await window.electronAPI.fs.readBinary(filePath)
  if (!r || !r.success) throw new Error(r?.error || '读取文件失败')
  if (r.data) {
    const u8 = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data)
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  }
  // 旧版 base64 回退
  const bin = atob(r.base64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

// 表格数据（二维数组）→ Markdown 表格文本（Sheet 名 + 管道表格）
// 首行视为表头；与 tableRowsToHtml 一致，便于大模型理解列对齐关系
function tableRowsToText(sheets) {
  const parts = []
  for (const s of sheets) {
    parts.push(`【${s.name}】`)
    if (!s.rows.length) continue
    const rows = s.rows
    // 列数取最大行宽，短行补空，避免表格列错位
    const colCount = Math.max(1, ...rows.map(r => r.length))
    const pad = (r) => {
      const cells = r.slice()
      while (cells.length < colCount) cells.push('')
      return cells
    }
    const esc = (c) => String(c ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
    const header = pad(rows[0]).map(esc)
    const sep = Array(colCount).fill('---')
    parts.push('| ' + header.join(' | ') + ' |')
    parts.push('| ' + sep.join(' | ') + ' |')
    for (let i = 1; i < rows.length; i++) {
      parts.push('| ' + pad(rows[i]).map(esc).join(' | ') + ' |')
    }
  }
  return parts.join('\n')
}

// 表格数据 → HTML（sheet 分块 table，首行视为表头加粗显示）
function tableRowsToHtml(sheets) {
  const blocks = sheets.map(s => {
    const head = s.rows.length
      ? `<thead><tr>${s.rows[0].map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`
      : ''
    const body = s.rows.slice(1).map(r =>
      `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`
    ).join('')
    return `<div class="sheet-name">${escapeHtml(s.name)}</div><table class="doc-table">${head}<tbody>${body}</tbody></table>`
  })
  return blocks.join('<div class="sheet-gap"></div>')
}

// exceljs 单元格值 → 纯文本
const cellToText = (v) => {
  if (v == null) return ''
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('')
    if (v.formula != null) return v.result != null ? String(v.result) : String(v.formula)
    if (v.hyperlink) return String(v.text ?? v.hyperlink)
    if (v.error) return ''
    return JSON.stringify(v)
  }
  return String(v)
}

// 旧版 .xls（BIFF8）走 SheetJS：exceljs 只支持 .xlsx
async function parseXls(filePath) {
  const XLSX = await import('xlsx')
  const lib = XLSX.default || XLSX
  const buf = await readBinaryBuffer(filePath)
  const wb = lib.read(new Uint8Array(buf), { type: 'array' })
  const sheets = []
  for (const name of wb.SheetNames || []) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const rows = lib.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
      .map(r => (r || []).map(c => String(c ?? '')))
      .filter(r => r.length)
    if (rows.length) sheets.push({ name, rows })
  }
  if (!sheets.length) return { success: false, error: '工作簿中没有数据行' }
  const cells = sheets.reduce((n, s) => n + s.rows.length, 0)
  return {
    success: true,
    type: 'xls',
    text: tableRowsToText(sheets),
    html: tableRowsToHtml(sheets),
    meta: { sheets: sheets.length, rows: cells, sheetNames: sheets.map(s => s.name) }
  }
}

async function parseXlsx(filePath) {
  const mod = await import('exceljs')
  const ExcelJS = mod.default || mod
  const buf = await readBinaryBuffer(filePath)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const sheets = []
  wb.eachSheet(ws => {
    const rows = []
    ws.eachRow({ includeEmpty: false }, row => {
      rows.push((row.values || []).slice(1).map(cellToText))
    })
    if (rows.length) sheets.push({ name: ws.name, rows })
  })
  if (!sheets.length) return { success: false, error: '工作簿中没有数据行' }
  const cells = sheets.reduce((n, s) => n + s.rows.length, 0)
  return {
    success: true,
    type: 'xlsx',
    text: tableRowsToText(sheets),
    html: tableRowsToHtml(sheets),
    meta: { sheets: sheets.length, rows: cells, sheetNames: sheets.map(s => s.name) }
  }
}

async function parseCsv(filePath, ext) {
  const raw = await window.electronAPI.fs.readFile(filePath)
  const delimiter = ext === 'tsv' ? '\t' : undefined
  const result = Papa.parse(raw, { skipEmptyLines: 'greedy', delimiter })
  if (!result.data?.length) return { success: false, error: '表格中没有数据行' }
  const sheets = [{ name: 'CSV', rows: result.data.map(r => r.map(c => String(c ?? ''))) }]
  return {
    success: true,
    type: 'csv',
    text: tableRowsToText(sheets),
    html: tableRowsToHtml(sheets),
    meta: { rows: sheets[0].rows.length, delimiter: result.meta?.delimiter || ',' }
  }
}

async function parseDocx(filePath) {
  const buf = await readBinaryBuffer(filePath)
  const [raw, html] = await Promise.all([
    mammoth.extractRawText({ arrayBuffer: buf.slice(0) }),
    mammoth.convertToHtml({ arrayBuffer: buf.slice(0) })
  ])
  const text = String(raw?.value || '').trim()
  if (!text) return { success: false, error: '文档中没有可提取的文本' }
  return {
    success: true,
    type: 'docx',
    text,
    html: String(html?.value || ''),
    meta: { chars: text.length }
  }
}

async function parsePdf(filePath) {
  const buf = await readBinaryBuffer(filePath)
  // 统一用 pdfjs-dist（与 DocViewer/pdfToImage 同版本），避免 unpdf 内置的 pdfjs 6.x
  // 与项目 pdfjs-dist 4.x 产生 worker 版本冲突（"API 4.10.38 vs Worker 6.1.200"）
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    cMapUrl: 'https://unpkg.com/pdfjs-dist@4.10.38/cmaps/',
    cMapPacked: true
  }).promise
  const totalPages = pdf.numPages || 0
  const parts = []
  for (let i = 1; i <= totalPages; i++) {
    let page
    try {
      page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const t = (content.items || []).map(it => it.str || '').join(' ')
      if (t.trim()) parts.push(t)
    } finally {
      if (page) { try { page.cleanup() } catch {} }
    }
  }
  const merged = parts.join('\n\n')
  const clean = merged.replace(/\u0000/g, '').trim()
  // 无文本层 / 中文 CID 编码的扫描版：success=false 交给上层 OCR 兜底
  if (!clean || clean.length < 8) {
    return { success: false, error: '该 PDF 没有可提取的文本层（可能是扫描版），需要 OCR 识别' }
  }
  return {
    success: true,
    type: 'pdf',
    text: clean,
    meta: { pages: totalPages }
  }
}

async function parsePptx(filePath) {
  const buf = await readBinaryBuffer(filePath)
  const zip = await JSZip.loadAsync(buf)
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const an = Number(a.match(/slide(\d+)\.xml$/i)?.[1] || 0)
      const bn = Number(b.match(/slide(\d+)\.xml$/i)?.[1] || 0)
      return an - bn
    })
  if (!slideFiles.length) {
    return { success: false, error: 'PPT 文件中没有可提取的幻灯片文本' }
  }

  const slides = []
  for (const file of slideFiles) {
    const xml = await zip.file(file).async('string')
    const texts = []
    const textRe = /<a:t>([\s\S]*?)<\/a:t>/gi
    let match
    while ((match = textRe.exec(xml)) !== null) {
      const text = decodeXmlEntities(match[1]).trim()
      if (text) texts.push(text)
    }
    const slideText = texts.join(' ').replace(/\s+/g, ' ').trim()
    if (slideText) slides.push(slideText)
  }

  if (!slides.length) {
    return { success: false, error: 'PPT 文件中没有可提取的幻灯片文本' }
  }

  return {
    success: true,
    type: 'pptx',
    text: slides.map((text, i) => `【幻灯片 ${i + 1}】\n${text}`).join('\n\n'),
    meta: { slides: slides.length }
  }
}

/**
 * 解析入口。返回 { success, type, text, html?, meta }
 * @param {string} filePath 绝对路径
 * @param {object} opts { forView: 是否需要 HTML 查看 }
 */
export async function parseDocument(filePath, opts = {}) {
  const ext = String(filePath || '').split('.').pop().toLowerCase()
  try {
    if (ext === 'pdf') return await parsePdf(filePath)
    if (ext === 'docx') return await parseDocx(filePath)
    if (ext === 'pptx') return await parsePptx(filePath)
    if (ext === 'xlsx') return await parseXlsx(filePath)
    if (ext === 'xls') return await parseXls(filePath)
    if (ext === 'csv' || ext === 'tsv') return await parseCsv(filePath, ext)
    if (['txt', 'md', 'markdown', 'json', 'log', 'html', 'xml'].includes(ext)) {
      const text = await window.electronAPI.fs.readFile(filePath)
      return { success: true, type: ext === 'md' || ext === 'markdown' ? 'md' : 'text', text, meta: { chars: text.length } }
    }
    return { success: false, error: `不支持的文件类型 .${ext}` }
  } catch (err) {
    return { success: false, error: err?.message || String(err) }
  }
}

/**
 * 文本切块（知识库索引用）：按段落切，超长段落按句子再切
 * @returns {string[]} chunk 数组
 */
export function chunkText(text, { size = 500 } = {}) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  const chunks = []
  let cur = ''
  const push = () => { const t = cur.trim(); if (t) chunks.push(t); cur = '' }
  for (const para of clean.split(/\n{2,}/)) {
    if (para.length > size) {
      push()
      let sent = ''
      for (const s of para.split(/(?<=[。！？!?；;])/)) {
        if ((sent + s).length > size && sent) { chunks.push(sent.trim()); sent = '' }
        sent += s
        while (sent.length > size) { chunks.push(sent.slice(0, size).trim()); sent = sent.slice(size) }
      }
      cur = sent
      continue
    }
    if ((cur + '\n' + para).length > size && cur) push()
    cur = cur ? cur + '\n' + para : para
  }
  push()
  return chunks
}
