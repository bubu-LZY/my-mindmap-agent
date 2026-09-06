/**
 * 本地文档文本提取（无外部解析库依赖）
 * - DOCX：ZIP 容器（JSZip 解压，simple-mind-map 已依赖）→ word/document.xml → 剥标签取文本
 * - PDF：解析 FlateDecode 压缩流（浏览器 DecompressionStream）→ 提取 Tj/TJ 文本算子
 *   无字体 CMap 支持的尽力而为提取：部分中文扫描版/CID 字体 PDF 可能提取失败，失败时如实返回
 */

import JSZip from 'jszip'

// ============ DOCX ============

/**
 * 提取 .docx 全文（段落按换行拼接）
 * @param {ArrayBuffer} buf
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
export async function extractDocxText(buf) {
  try {
    const zip = await JSZip.loadAsync(buf)
    const docXml = zip.file('word/document.xml')
    if (!docXml) return { success: false, error: 'docx 内缺少 word/document.xml（可能不是标准 Word 文档）' }
    const xml = await docXml.async('string')
    const text = docxXmlToText(xml)
    if (!text.trim()) return { success: false, error: '文档中没有可提取的文本（可能是纯图片文档）' }
    return { success: true, text }
  } catch (e) {
    return { success: false, error: 'docx 解析失败: ' + (e.message || e) }
  }
}

// 逐段处理 document.xml：<w:p> 段落，<w:t> 文本，<w:tab> 制表，<w:br>/<w:cr> 换行
function docxXmlToText(xml) {
  const paragraphs = xml.split(/<\/w:p>/)
  const lines = []
  for (const p of paragraphs) {
    let line = ''
    // 段内逐个取文本节点与换行符标记
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g
    let m
    while ((m = re.exec(p)) !== null) {
      if (m[1] !== undefined) {
        line += decodeXmlEntities(m[1])
      } else if (m[0].startsWith('<w:tab')) {
        line += '\t'
      } else {
        line += '\n'
      }
    }
    lines.push(line)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
}

// ============ PDF ============

/**
 * 提取 .pdf 文本（尽力而为）
 * @param {ArrayBuffer} buf
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
export async function extractPdfText(buf) {
  try {
    const bytes = new Uint8Array(buf)
    const chunks = []
    // 1. 收集全部 stream...endstream 块
    const streams = collectStreams(bytes)
    if (streams.length === 0) return { success: false, error: 'PDF 中未找到内容流' }

    for (const raw of streams) {
      // 2. 依次尝试：zlib(deflate) → deflate-raw → 未压缩
      let content = null
      for (const method of ['deflate', 'deflate-raw']) {
        try {
          content = await inflate(raw, method)
          if (content !== null) break
        } catch {
          content = null
        }
      }
      if (content === null && isMostlyPrintable(raw)) {
        content = decodeStreamText(raw)
      }
      if (content === null) continue
      // 3. 提取文本算子
      const text = extractTextOperators(content)
      if (text) chunks.push(text)
    }

    let all = chunks.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    // 质量检查：可打印字符占比过低说明是 CID 字体乱码（多为未内嵌 CMap 的中文 PDF）
    if (!all) {
      return { success: false, error: '该 PDF 没有可提取的文本层（可能是扫描版/图片型 PDF），请转成 docx/md 或用图片 OCR' }
    }
    const printable = (all.match(/[\x20-\x7E\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u0400-\u04FF\u0600-\u06FF\u3040-\u30ff\uac00-\ud7af]/g) || []).length
    if (printable / all.length < 0.6) {
      return { success: false, error: '该 PDF 文本层编码无法识别（CID 字体未内嵌映射，常见于部分中文 PDF），请提供 docx/md 版本' }
    }
    return { success: true, text: all }
  } catch (e) {
    return { success: false, error: 'PDF 解析失败: ' + (e.message || e) }
  }
}

// 找到所有 stream...endstream 之间的字节（跳过 PDF 对象头，容忍 \r\n 与二进制）
// 注意：不能对 "stream" 做全局正则扫描——"endstream" 里也含 "stream"，会把
// 下一个对象的真实数据流吞进垃圾切片导致内容丢失，必须跳过 end 前缀逐个定位
function collectStreams(bytes) {
  const results = []
  const text = new TextDecoder('latin1').decode(bytes)
  let pos = 0
  while (pos < text.length) {
    const s = text.indexOf('stream', pos)
    if (s === -1) break
    const isEndKeyword = s >= 3 && text.slice(s - 3, s) === 'end'
    let start = s + 6
    if (text[start] === '\r') start++
    if (text[start] === '\n') start++
    if (isEndKeyword) {
      pos = start
      continue
    }
    const end = text.indexOf('endstream', start)
    if (end === -1) break
    // zlib 流以 0x78 开头；截掉流尾的换行符
    let e = end
    while (e > start && (bytes[e - 1] === 10 || bytes[e - 1] === 13)) e--
    const slice = bytes.slice(start, e)
    if (slice.length > 0) results.push(slice)
    pos = end + 9
  }
  return results
}

// 用 DecompressionStream 解压；返回字符串，解压后不可打印则返回 null
async function inflate(raw, method) {
  const ds = new DecompressionStream(method)
  const stream = new Blob([raw]).stream().pipeThrough(ds)
  const out = new Uint8Array(await new Response(stream).arrayBuffer())
  if (out.length === 0) return null
  if (!isMostlyPrintable(out, 0.85)) return null
  return decodeStreamText(out)
}

// 内容流字节 → 文本：合法 UTF-8 用 UTF-8（中文直出），否则按 latin1 保字节（CID 字体走乱码检测）
function decodeStreamText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}

function isMostlyPrintable(bytes, threshold = 0.7) {
  if (bytes.length === 0) return false
  let ok = 0
  const n = Math.min(bytes.length, 4096)
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) ok++
  }
  return ok / n >= threshold
}

// 从内容流提取文本：(...) Tj、[...] TJ；Td/TD/T*/BT 视作换行
function extractTextOperators(content) {
  const lines = []
  let current = ''
  const re = /\((?:\\.|[^\\()])*\)\s*Tj|\[(?:[^\]]*)\]\s*TJ|\((?:\\.|[^\\()])*\)\s*'|T[dD]\b|T\*|BT\b|ET\b/g
  let m
  while ((m = re.exec(content)) !== null) {
    const op = m[0]
    if (op.endsWith('Tj') || op.endsWith("'")) {
      const lit = op.match(/^\((?:\\.|[^\\()])*\)/)
      if (lit) current += decodePdfString(lit[0])
    } else if (op.endsWith('TJ')) {
      const arr = op.slice(0, op.lastIndexOf(']') + 1)
      // TJ 数组内所有字符串拼接；负大位移（字间距拉大）视为空格
      const strRe = /\((?:\\.|[^\\()])*\)|-?\d+(?:\.\d+)?/g
      let sm
      while ((sm = strRe.exec(arr)) !== null) {
        if (sm[0].startsWith('(')) current += decodePdfString(sm[0])
        else if (parseFloat(sm[0]) < -180 && current && !current.endsWith(' ')) current += ' '
      }
    } else if (op === 'Td' || op === 'TD' || op === 'T*' || op === 'ET') {
      if (current.trim()) lines.push(current.trim())
      current = ''
    } else if (op === 'BT') {
      if (current.trim()) lines.push(current.trim())
      current = ''
    }
  }
  if (current.trim()) lines.push(current.trim())
  // 过滤纯数字/符号噪声行
  const meaningful = lines.filter(l => /[\u4e00-\u9fff a-zA-Z]{2,}/.test(l) && l.replace(/[^0-9.]/g, '').length < l.length)
  return meaningful.join('\n')
}

// PDF 字符串字面量解码（含八进制转义与 \n \r \t \( \) \\）
function decodePdfString(s) {
  const inner = s.slice(1, -1)
  return inner.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, g) => {
    if (g === 'n') return '\n'
    if (g === 'r') return '\r'
    if (g === 't') return '\t'
    if (g === 'b' || g === 'f') return ''
    if (g === '(') return '('
    if (g === ')') return ')'
    if (g === '\\') return '\\'
    return String.fromCharCode(parseInt(g, 8))
  })
}
