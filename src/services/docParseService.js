/**
 * 统一文档解析服务：PDF / DOCX / XLSX / CSV / MD / TXT → { text, html, meta }
 * - text  供 AI 阅读与知识库索引
 * - html  供 DocViewer 原样查看（可选，部分格式无）
 * - 解析库按需动态加载（unpdf / exceljs 体积大，不进主 chunk）
 */
import mammoth from 'mammoth'
import Papa from 'papaparse'
import JSZip from 'jszip'
// 「用户已停止」专用错误：解析中途取消时抛出，由 parseDocument 转成 { cancelled: true }
const cancelledDocError = () => { const e = new Error('已取消'); e.cancelled = true; return e }

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

// 读取文件 → ArrayBuffer
// 优先向主进程要 raw 字节：结构化克隆只拷一次，既没有 base64 的 1/3 体积膨胀，
// 也不必在渲染进程里用逐字符循环把上千万字符还原成字节（大文件卡顿的主因之一）。
//
// buffer 参数供后台解析线程使用：字节随消息转移进线程后逐层传参，不再用模块级变量。
// 模块级变量在两次并发解析之间会互相踩踏，线程终止后还可能一直钉住整份文件字节。
async function readBinaryBuffer(filePath, buffer = null) {
  if (buffer) return buffer
  const r = await window.electronAPI.fs.readBinary(filePath, { raw: true })
  if (!r || !r.success) throw new Error(r?.error || '读取文件失败')
  if (r.data) {
    const u8 = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data)
    // 视图正好覆盖整个 buffer 时直接复用，避免再复制一份同尺寸数据。
    return (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength)
      ? u8.buffer
      : u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  }
  if (!r.base64) throw new Error('读取文件失败：返回数据为空')
  // 旧版主进程（不认 raw 参数）才走这里
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
async function parseXls(filePath, buffer = null) {
  const XLSX = await import('xlsx')
  const lib = XLSX.default || XLSX
  const buf = await readBinaryBuffer(filePath, buffer)
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

async function parseXlsx(filePath, buffer = null) {
  const mod = await import('exceljs')
  const ExcelJS = mod.default || mod
  const buf = await readBinaryBuffer(filePath, buffer)
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

async function parseCsv(filePath, ext, buffer = null) {
  // 统一走字节读取：既能在后台线程里解析（字节随消息转移进来），也不再依赖 IPC 读文本
  const raw = new TextDecoder('utf-8').decode(new Uint8Array(await readBinaryBuffer(filePath, buffer)))
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

async function parseDocx(filePath, buffer = null) {
  const buf = await readBinaryBuffer(filePath, buffer)
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

async function parsePdf(filePath, opts = {}, buffer = null) {
  const shouldAbort = typeof opts.shouldAbort === 'function' ? opts.shouldAbort : null
  const buf = await readBinaryBuffer(filePath, buffer)
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
  try {
    for (let i = 1; i <= totalPages; i++) {
      // 用户已停止：立刻中断，不继续把整份 PDF 解析完（否则停止后仍会长时间占 CPU）
      if (shouldAbort && shouldAbort()) throw cancelledDocError()
      // 每 5 页让出主线程，避免大 PDF 同步解析把界面卡死。
      if (i % 5 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
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
  } finally {
    // 释放 pdfjs 文档与 worker 持有的整份 PDF 数据（字体缓存、页面对象等）。
    // 不释放时大 PDF 会一直占住数百 MB 内存，直到刷新窗口；停止/完成后也降不下来。
    try { await pdf.cleanup() } catch (e) { /* 忽略 */ }
    try { await pdf.destroy() } catch (e) { /* 忽略 */ }
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

async function parsePptx(filePath, buffer = null) {
  const buf = await readBinaryBuffer(filePath, buffer)
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

const BINARY_EXTS = ['pdf', 'docx', 'pptx', 'xlsx', 'xls', 'csv', 'tsv']
const TEXT_EXTS = ['txt', 'md', 'markdown', 'json', 'log', 'html', 'xml']

// 按扩展名分发到具体解析实现（主线程与后台解析线程共用同一份实现）
async function parseByExt(ext, filePath, opts = {}, buffer = null) {
  if (ext === 'pdf') return await parsePdf(filePath, opts, buffer)
  if (ext === 'docx') return await parseDocx(filePath, buffer)
  if (ext === 'pptx') return await parsePptx(filePath, buffer)
  if (ext === 'xlsx') return await parseXlsx(filePath, buffer)
  if (ext === 'xls') return await parseXls(filePath, buffer)
  if (ext === 'csv' || ext === 'tsv') return await parseCsv(filePath, ext, buffer)
  return { success: false, error: `不支持的文件类型 .${ext}` }
}

/* ============================================================
 * 后台解析线程
 * ============================================================
 * 文档解析（mammoth / JSZip / exceljs / pdfjs）是纯 CPU 密集型工作，放在渲染主线程上
 * 会把界面卡住。这里统一交给 Worker 线程执行，主线程只负责读字节和接收结果文本。
 * 线程不可用或线程内出错时自动退回主线程解析，保证功能始终可用。
 */
let parseWorker = null
// 线程失败的「冷却截止时间」。旧实现用布尔量 + 永久置位：一次线程加载失败后，
// 之后所有解析都永远退回主线程（大文件照样卡界面），环境恢复也无法自愈。
// 改成时间戳后，超过冷却期就会重新尝试后台线程。
let parseWorkerFailedAt = 0
let parseSeq = 0
const pendingParse = new Map()
const PARSE_WORKER_COOLDOWN_MS = 30 * 1000

// 线程被硬中断（终止线程以响应用户停止）时抛出的错误：可重试。
// 与 cancelledDocError 区分开——那个表示「用户要求停止」，这个表示「线程没了，换一个再来」。
const errParseRetryable = () => { const e = new Error('文档解析线程被中断'); e.retryable = true; return e }

function getParseWorker() {
  if (parseWorkerFailedAt && Date.now() - parseWorkerFailedAt < PARSE_WORKER_COOLDOWN_MS) return null
  if (parseWorker) return parseWorker
  try {
    const worker = new Worker(new URL('./docParse.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      // 线程能回消息说明它是健康的，清掉冷却标记
      parseWorkerFailedAt = 0
      const { id, ok, res, error } = event.data || {}
      const pending = pendingParse.get(id)
      if (!pending) return
      pendingParse.delete(id)
      if (ok) pending.resolve(res)
      else pending.reject(new Error(error || '文档解析失败'))
    }
    worker.onerror = () => {
      // 线程级失败（脚本加载/运行异常）：终止并进入冷却期，让等待中的请求立即失败，
      // 由调用方退回主线程解析，避免界面一直停在「解析中」。
      // 是「线程本身不可用」而不是用户停止：绝不能报成 cancelled，否则会被上层误判成
      // 「用户已停止」。冷却期过后下次解析会重新尝试后台线程（可自愈）。
      killParseWorker({ failed: true })
    }
    parseWorker = worker
    return worker
  } catch (e) {
    parseWorkerFailedAt = Date.now()
    parseWorker = null
    return null
  }
}

// 终止后台线程，等待中的请求随之结束，下次解析会自动重建线程。
// docx / xlsx 这类解析是一次性调用、库本身不支持中断，终止线程是唯一可靠的停止方式。
// @param cancelledId 触发本次终止的请求 id（用户停止：只有它算「被取消」，其它请求可换线程重试）
// @param failed      true 表示线程本身不可用（脚本加载/运行异常），此时所有等待中的请求都退回主线程解析
function killParseWorker({ cancelledId = null, failed = false } = {}) {
  const worker = parseWorker
  parseWorker = null
  if (worker) {
    try { worker.terminate() } catch (e) { /* 忽略 */ }
  }
  if (failed) parseWorkerFailedAt = Date.now()
  if (pendingParse.size) {
    for (const [id, pending] of pendingParse.entries()) {
      if (failed) pending.reject(new Error('文档解析线程不可用'))
      else if (cancelledId != null && id === cancelledId) pending.reject(cancelledDocError())
      else pending.reject(errParseRetryable())
    }
    pendingParse.clear()
  }
}

/** Worker 内部入口：字节已随消息转移进来，直接解析（仅 docParse.worker.js 调用） */
export async function parseInWorker(ext, buffer, filePath) {
  return await parseByExt(ext, filePath, {}, buffer)
}

/**
 * 解析入口。返回 { success, type, text, html?, meta }
 * @param {string} filePath 绝对路径
 * @param {object} opts { shouldAbort: () => boolean 用户是否已停止 }
 */
export async function parseDocument(filePath, opts = {}) {
  const ext = String(filePath || '').split('.').pop().toLowerCase()
  const shouldAbort = typeof opts.shouldAbort === 'function' ? opts.shouldAbort : null
  try {
    // 纯文本类只有一次读盘，没有 CPU 密集工作，留在主线程即可
    if (TEXT_EXTS.includes(ext)) {
      const text = await window.electronAPI.fs.readFile(filePath)
      return { success: true, type: ext === 'md' || ext === 'markdown' ? 'md' : 'text', text, meta: { chars: text.length } }
    }
    if (!BINARY_EXTS.includes(ext)) return { success: false, error: `不支持的文件类型 .${ext}` }
    if (shouldAbort && shouldAbort()) throw cancelledDocError()

    const worker = getParseWorker()
    if (!worker) {
      // 后台线程不可用（极老环境，或正处在失败冷却期）：退回主线程解析，保底可用
      return await parseByExt(ext, filePath, opts)
    }

    // 字节读进来后所有权转交后台线程（零拷贝），主线程不再持有整份数据；
    // 因此需要重试时必须重新读盘，不能复用已被转移的 buffer。
    let buffer = await readBinaryBuffer(filePath)
    let attempt = 0
    while (true) {
      attempt++
      const id = ++parseSeq
      try {
        return await new Promise((resolve, reject) => {
          let timer = null
          const settle = (fn) => (v) => { if (timer) { clearInterval(timer); timer = null } fn(v) }
          pendingParse.set(id, { resolve: settle(resolve), reject: settle(reject) })
          // 用户停止 → 终止后台线程（线程内解析库不可中断，终止线程是唯一硬中断手段）
          if (shouldAbort) timer = setInterval(() => { if (shouldAbort()) killParseWorker({ cancelledId: id }) }, 120)
          try {
            // 转移 buffer 所有权：零拷贝把字节交给后台线程，主线程不再持有整份数据
            worker.postMessage({ id, ext, filePath, buffer }, [buffer])
          } catch (postErr) {
            pendingParse.delete(id)
            settle(reject)(postErr)
          }
        })
      } catch (err) {
        if (err && err.cancelled) throw err
        if (shouldAbort && shouldAbort()) throw cancelledDocError()
        // 线程被中途终止（例如并发的另一次解析触发了「停止」）：换个线程重试一次，
        // 否则一次无关的停止就会让这份文档退化成主线程解析、把界面卡住。
        if (err && err.retryable && attempt < 2) {
          const retryWorker = getParseWorker()
          if (retryWorker) {
            buffer = await readBinaryBuffer(filePath)
            continue
          }
        }
        // 后台线程内出错（例如线程里某个解析库加载失败）：退回主线程再解析一次
        return await parseByExt(ext, filePath, opts)
      }
    }
  } catch (err) {
    // 用户停止导致的取消：单独标记，让调用方中断整条转换（不要当成解析失败继续降级）
    if (err && err.cancelled) return { success: false, cancelled: true, error: '已取消' }
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
