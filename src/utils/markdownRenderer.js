/**
 * 轻量级 Markdown 渲染器
 * 支持标题、粗体、斜体、行内代码、代码块、列表、链接、引用、分隔线
 * 不依赖第三方库，避免增加打包体积
 */

/**
 * 转义 HTML 特殊字符
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }
  return text.replace(/[&<>"']/g, m => map[m])
}

/**
 * 渲染 Markdown 为 HTML
 * @param {string} markdown Markdown 文本
 * @returns {string} HTML
 */
export function renderMarkdown(markdown) {
  if (!markdown || typeof markdown !== 'string') return ''

  // 先转义 HTML
  let html = escapeHtml(markdown)

  // 代码块（```...```）
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre class="md-code-block"><code>${code.trim()}</code></pre>`
  })

  // 标题（# ~ ######）
  html = html.replace(/^#{6}\s+(.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^#{5}\s+(.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^#{4}\s+(.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>')

  // 分隔线
  html = html.replace(/^---+$/gm, '<hr class="md-hr">')

  // 引用块
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote class="md-quote">$1</blockquote>')

  // ===== 表格解析辅助（状态机 + 容错） =====
  // 表格行判定：trim 后以 | 开头；或以 | 结尾且至少含 2 个 |（兼容行尾缺 | 的 AI 输出）
  const isTableLine = (line) => {
    const t = line.trim()
    if (!t.includes('|')) return false
    if (t.startsWith('|')) return true
    if (t.endsWith('|') && (t.match(/\|/g) || []).length >= 2) return true
    return false
  }
  // 分隔行判定：仅由 | - : 空格组成且至少一个 -
  const isSeparatorLine = (line) => {
    const t = line.trim()
    if (!t.includes('-')) return false
    return /^-+$/.test(t.replace(/[|\s:]/g, ''))
  }
  // 单元格切分：处理 \| 转义，兼容行首/行尾缺 |
  const splitCells = (line) => {
    const ESC = '\u0000'
    const t = String(line).trim().replace(/\\\|/g, ESC)
    const starts = t.startsWith('|')
    const ends = t.endsWith('|')
    let parts = t.split('|').map(c => c.trim())
    if (starts) parts = parts.slice(1)
    if (ends && parts.length > 0) parts = parts.slice(0, -1)
    return parts.map(c => c.replace(new RegExp(ESC, 'g'), '|'))
  }
  // 解析一个表格行块为 HTML（block[0]=表头，block[1]=分隔行，其余为数据行）
  const buildTable = (block) => {
    const headers = splitCells(block[0])
    const colCount = headers.length
    if (colCount === 0) return null
    // 对齐方式：--- 左 / :--: 中 / ---: 右
    const aligns = splitCells(block[1]).map(c => {
      const left = c.startsWith(':')
      const right = c.endsWith(':')
      if (left && right) return 'center'
      if (right) return 'right'
      return 'left'
    })
    const rows = []
    for (let r = 2; r < block.length; r++) {
      if (isSeparatorLine(block[r])) continue
      const cells = splitCells(block[r])
      while (cells.length < colCount) cells.push('')
      if (cells.length > colCount) cells.length = colCount
      rows.push(cells)
    }
    let html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>'
    headers.forEach((h, i) => {
      const a = aligns[i] || 'left'
      html += `<th style="text-align:${a}">${h}</th>`
    })
    html += '</tr></thead><tbody>'
    rows.forEach(row => {
      html += '<tr>'
      row.forEach((cell, i) => {
        const a = aligns[i] || 'left'
        html += `<td style="text-align:${a}">${cell}</td>`
      })
      html += '</tr>'
    })
    html += '</tbody></table></div>'
    return html
  }

  // 无序列表
  const lines = html.split('\n')
  const result = []
  let inUl = false
  let inOl = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 表格块：收集连续表格行，第二行为分隔行则渲染为表格
    if (isTableLine(line)) {
      const block = []
      let j = i
      while (j < lines.length && isTableLine(lines[j])) {
        block.push(lines[j])
        j++
      }
      i = j - 1
      if (block.length >= 2 && isSeparatorLine(block[1])) {
        const tableHtml = buildTable(block)
        if (tableHtml) {
          // 表格前关闭未闭合的列表
          if (inUl) { result.push('</ul>'); inUl = false }
          if (inOl) { result.push('</ol>'); inOl = false }
          result.push(tableHtml)
          continue
        }
      }
      // 非标准表格（流式半截/无分隔行）：原样输出
      if (inUl) { result.push('</ul>'); inUl = false }
      if (inOl) { result.push('</ol>'); inOl = false }
      block.forEach(l => result.push(l))
      continue
    }

    // 无序列表项
    const ulMatch = line.match(/^\s*[-*+]\s+(.+)/)
    if (ulMatch) {
      if (!inUl) {
        result.push('<ul class="md-list">')
        inUl = true
      }
      if (inOl) {
        result.push('</ol>')
        inOl = false
      }
      result.push(`<li>${ulMatch[1]}</li>`)
      continue
    }

    // 有序列表项
    const olMatch = line.match(/^\s*\d+\.\s+(.+)/)
    if (olMatch) {
      if (!inOl) {
        result.push('<ol class="md-list">')
        inOl = true
      }
      if (inUl) {
        result.push('</ul>')
        inUl = false
      }
      result.push(`<li>${olMatch[1]}</li>`)
      continue
    }

    // 关闭列表
    if (inUl) {
      result.push('</ul>')
      inUl = false
    }
    if (inOl) {
      result.push('</ol>')
      inOl = false
    }

    result.push(line)
  }

  // 关闭未闭合的列表
  if (inUl) result.push('</ul>')
  if (inOl) result.push('</ol>')

  html = result.join('\n')

  // 行内代码（`code`）
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')

  // 粗体 + 斜体（***text***）
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')

  // 粗体（**text**）
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  // 斜体（*text*）
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')

  // 图片（![alt](url)）：先于链接规则处理，避免被链接规则吞掉
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, alt, url) => {
    const safeAlt = alt.replace(/"/g, '&quot;')
    const safeUrl = url.replace(/"/g, '&quot;')
    return `<img src="${safeUrl}" alt="${safeAlt}" class="md-img" title="点击查看大图" />`
  })

  // 链接（[text](url)）
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>')

  // 裸 URL 自动识别（不在 href 中、不在代码标签中的 URL）
  html = html.replace(/(?<!href="[^"]*|<code[^>]*>)(?<!<\/code>)(https?:\/\/[^\s<"]+)/g, '<a href="$1" target="_blank" rel="noopener" class="md-link">$1</a>')

  // 本地绝对路径识别（C:\dir\file.smm 或 C:/dir/file.smm）：转为可点击路径
  // ChatPanel 委托处理：单击用默认程序打开，右键打开所在文件夹
  // (?<!=") 排除已生成的 src/href 属性值中的路径
  // (?<![A-Za-z]) 排除 URL 协议名（https: 中的 s: 会被误判为盘符）
  // 字符类排除 Windows 非法字符与中英文句读标点
  html = html.replace(/(?<!=")(?<![A-Za-z])([A-Za-z]:[\\/][^\s<>:|?*"\[\]：，。；、！？）》」』】]+)/g, (match) => {
    const trimmed = match.replace(/[.,;:!?。，；：、]+$/, '')
    if (trimmed.length < 4) return match
    return `<span class="md-file-path" data-path="${trimmed}" title="单击打开文件 / 右键打开所在文件夹">${trimmed}</span>`
  })

  // 段落处理：将连续非空行包裹在 <p> 中
  // 但不处理已经有 HTML 标签的行
  const finalLines = html.split('\n')
  const paragraphs = []
  let currentPara = []

  for (const line of finalLines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (currentPara.length > 0) {
        paragraphs.push(currentPara.join(' '))
        currentPara = []
      }
      continue
    }
    // 已经是块级元素（含闭合标签）的行不包裹
    if (/^<\/?(h[1-6]|pre|blockquote|hr|ul|ol|li|div|table|tbody|thead|tr|th|td|p)\b/.test(trimmed)) {
      if (currentPara.length > 0) {
        paragraphs.push(currentPara.join(' '))
        currentPara = []
      }
      paragraphs.push(trimmed)
    } else {
      currentPara.push(trimmed)
    }
  }
  if (currentPara.length > 0) {
    paragraphs.push(currentPara.join(' '))
  }

  return paragraphs
    .map(p => /^<\/?(h[1-6]|pre|blockquote|hr|ul|ol|li|div|table|tbody|thead|tr|th|td|p)\b/.test(p) ? p : `<p>${p}</p>`)
    .join('\n')
}

/**
 * 生成 Markdown 渲染所需的 CSS 样式字符串
 * @returns {string} CSS
 */
export function getMarkdownCSS() {
  return `
    .md-content h1, .md-content h2, .md-content h3,
    .md-content h4, .md-content h5, .md-content h6 {
      margin: 10px 0 6px;
      font-weight: 600;
      line-height: 1.3;
    }
    .md-content h1 { font-size: 18px; }
    .md-content h2 { font-size: 16px; }
    .md-content h3 { font-size: 15px; }
    .md-content h4, .md-content h5, .md-content h6 { font-size: 14px; }
    .md-content p { margin: 6px 0; line-height: 1.6; }
    .md-content strong { font-weight: 600; }
    .md-content em { font-style: italic; }
    .md-content .md-inline-code {
      padding: 1px 5px;
      background: rgba(0,0,0,0.06);
      border-radius: 4px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px;
    }
    .md-content .md-code-block {
      margin: 8px 0;
      padding: 10px 12px;
      background: rgba(0,0,0,0.06);
      border-radius: 8px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.5;
    }
    .md-content .md-code-block code {
      font-family: 'SF Mono', 'Fira Code', monospace;
      white-space: pre;
    }
    .md-content .md-list {
      margin: 6px 0;
      padding-left: 20px;
    }
    .md-content .md-list li {
      margin: 3px 0;
      line-height: 1.5;
    }
    .md-content .md-quote {
      margin: 8px 0;
      padding: 6px 12px;
      border-left: 3px solid rgba(0,122,255,0.3);
      background: rgba(0,0,0,0.03);
      border-radius: 0 6px 6px 0;
      color: #555;
    }
    .md-content .md-hr {
      border: none;
      border-top: 1px solid rgba(0,0,0,0.1);
      margin: 10px 0;
    }
    .md-content a {
      color: var(--apple-blue, #007aff);
      text-decoration: none;
    }
    .md-content a:hover {
      text-decoration: underline;
    }
    .md-content .md-table-wrap {
      margin: 8px 0;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      max-width: 100%;
    }
    .md-content .md-table {
      border-collapse: collapse;
      width: auto;
      min-width: 100%;
      font-size: 13px;
    }
    .md-content .md-table th,
    .md-content .md-table td {
      border: 1px solid rgba(0,0,0,0.1);
      padding: 6px 10px;
      text-align: left;
      white-space: nowrap;
    }
    .md-content .md-table th {
      background: rgba(0,0,0,0.04);
      font-weight: 600;
    }
    .md-content .md-table tr:nth-child(even) {
      background: rgba(0,0,0,0.02);
    }
    .md-content img.md-img {
      display: block;
      max-width: 100%;
      max-height: 280px;
      margin: 6px 0;
      border-radius: 8px;
      cursor: zoom-in;
      border: 1px solid rgba(0,0,0,0.08);
    }
    .md-content .md-file-path {
      display: inline;
      padding: 0 3px;
      border-radius: 4px;
      font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
      font-size: 0.92em;
      color: #0369a1;
      background: rgba(14, 165, 233, 0.1);
      cursor: pointer;
      border-bottom: 1px dashed rgba(14, 165, 233, 0.5);
      word-break: break-all;
    }
    .md-content .md-file-path:hover {
      background: rgba(14, 165, 233, 0.2);
    }
  `
}
