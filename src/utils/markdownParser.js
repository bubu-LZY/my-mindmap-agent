/**
 * Markdown 解析为思维导图树形数据的工具
 * 支持：
 * - #/##/### 标题
 * - 嵌套列表（按缩进区分层级）
 * - 行内样式：**粗体**、*斜体*、~~删除线~~、`代码`
 */

import { createUid } from 'simple-mind-map/src/utils'
import { escapeHtml } from './sanitizeHtml'

/**
 * 兼容旧版本遗留的“整张表格塞进单个节点”的数据。
 * 把 <table class="mm-md-table"> 转成多行富文本（每行一个表格行，列名做前缀），
 * 避免 simple-mind-map 的 Quill 编辑器无法编辑 <table>、退出后表格被剥成纯文本的问题。
 */
export const legacyTableHtmlToText = (html) => {
  if (!html || typeof html !== 'string' || !/<table\b/i.test(html)) return html
  try {
    const div = document.createElement('div')
    div.innerHTML = html
    const table = div.querySelector('table')
    if (!table) return html
    const header = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map(td => (td.textContent || '').trim())
    const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(td => (td.textContent || '').trim()))
    if (!rows.length) {
      const cells = header.filter(Boolean)
      return cells.length ? `<p><span>${cells.map(c => escapeHtml(c)).join('、')}</span></p>` : html
    }
    const lineHtml = rows.map(row => {
      const parts = row.map((cell, idx) => {
        const label = header[idx] ? `【${escapeHtml(header[idx])}】` : ''
        return cell ? `${label}${escapeHtml(cell)}` : ''
      }).filter(Boolean)
      return parts.join('<br>')
    }).filter(Boolean).join('<br><br>')
    return `<p><span>${lineHtml}</span></p>`
  } catch (e) {
    return html
  }
}

/**
 * 将 Markdown 文本解析为 simple-mind-map 树形数据结构
 * @param {string} markdown Markdown 文本
 * @returns {object} 树形数据 { data: { text, uid, richText }, children: [] }
 */
export function parseMarkdownToTree(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return { data: { text: '<p><span>空导图</span></p>', uid: createUid(), richText: true }, children: [] }
  }

  const lines = markdown.split('\n')
  const indentUnit = detectIndentUnit(lines)
  const nodes = parseLines(lines, indentUnit)

  if (nodes.length === 0) {
    return { data: { text: '<p><span>空导图</span></p>', uid: createUid(), richText: true }, children: [] }
  }

  const tree = buildTree(nodes)
  normalizeTree(tree)
  return tree
}

/**
 * 检测列表缩进单位（2 或 4 空格/级），保证嵌套列表层级正确
 */
function detectIndentUnit(lines) {
  const indents = []
  for (const line of lines) {
    const m = line.match(/^([ \t]+)(?:[-*+]|\d+[.)])\s/)
    if (m) {
      const spaces = m[1].replace(/\t/g, '    ').length
      if (spaces > 0) indents.push(spaces)
    }
  }
  if (indents.length === 0) return 4
  const min = Math.min(...indents)
  // 常见缩进单位为 2 或 4；若最小缩进是 4 的倍数取 4，否则取最小正缩进（2）
  return min % 4 === 0 ? 4 : min
}

/**
 * 将 Markdown 行解析为扁平节点列表
 * 每个节点有 depth（层级）和 text
 */
function parseLines(lines, indentUnit) {
  const nodes = []
  let currentHeadingDepth = 0

  const indentLevelOf = (indentStr) => {
    const spaces = String(indentStr || '').replace(/\t/g, '    ').length
    return Math.round(spaces / indentUnit)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue

    // 代码块（跳过内容，不解析为节点）
    if (line.trim().startsWith('```')) {
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) i++
      continue
    }

    // # 标题（允许前面有缩进）
    const hMatch = line.match(/^[ \t]*(#{1,6})[ \t]+(.+)/)
    if (hMatch) {
      currentHeadingDepth = hMatch[1].length
      nodes.push({ depth: currentHeadingDepth, text: hMatch[2].trim() })
      continue
    }

    // === 下划线标题（h1）
    if (/^[ \t]*=+[ \t]*$/.test(line) && nodes.length > 0) {
      const last = nodes[nodes.length - 1]
      last.depth = 1
      currentHeadingDepth = 1
      continue
    }

    // --- 下划线标题（h2）
    if (/^[ \t]*-{2,}[ \t]*$/.test(line) && nodes.length > 0) {
      const last = nodes[nodes.length - 1]
      last.depth = 2
      currentHeadingDepth = 2
      continue
    }

    // 列表项（- * + 或 1. / 1)），按缩进区分层级
    const listMatch = line.match(/^([ \t]*)([-*+]|\d+[.)])[ \t]+(.+)/)
    if (listMatch) {
      const depth = currentHeadingDepth + 1 + indentLevelOf(listMatch[1])
      nodes.push({ depth, text: listMatch[3].trim() })
      continue
    }

    // 引用块
    const quoteMatch = line.match(/^([ \t]*)>[ \t]*(.+)/)
    if (quoteMatch) {
      const depth = currentHeadingDepth + 1 + indentLevelOf(quoteMatch[1])
      nodes.push({ depth, text: quoteMatch[2].trim(), quote: true })
      continue
    }

    // Markdown 表格：连续的 | ... | 行拆成“每行一个节点”，列名作为前缀写入同一节点。
    // 不再把 <table> 塞进节点文本：simple-mind-map 的富文本编辑基于 Quill，无法编辑/还原
    // <table>，双击编辑后会卡住，退出后表格还会被剥成纯文本。多行节点仍可正常双击编辑。
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const tableLines = []
      let j = i
      while (j < lines.length) {
        const cur = lines[j].trim()
        if (cur && /^\s*\|.*\|\s*$/.test(cur)) {
          tableLines.push(cur)
          j++
        } else {
          break
        }
      }
      // 去掉分隔行（|---|:--| 等）
      const dataRows = tableLines.filter(l => !/^\|[\s:|-]+\|$/.test(l))
      if (dataRows.length) {
        const rows = dataRows.map(r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim()))
        const header = rows[0] || []
        const body = rows.slice(1)
        const baseDepth = currentHeadingDepth + 1
        if (body.length) {
          body.forEach(row => {
            const parts = row.map((cell, idx) => {
              const label = header[idx] ? `【${header[idx]}】` : ''
              return cell ? `${label}${cell}` : ''
            }).filter(Boolean)
            if (parts.length) {
              nodes.push({ depth: baseDepth, text: parts.join('\n') })
            }
          })
        } else if (header.length) {
          nodes.push({ depth: baseDepth, text: header.filter(Boolean).join('、') })
        }
      }
      i = j - 1
      continue
    }

    // 普通段落文本
    const plainMatch = line.match(/^([ \t]*)(.+)/)
    const depth = currentHeadingDepth + 1 + indentLevelOf(plainMatch ? plainMatch[1] : '')
    nodes.push({ depth, text: line.trim() })
  }

  return nodes
}

/**
 * 将扁平节点列表构建为树形结构（使用栈维护层级关系）
 */
function buildTree(nodes) {
  const root = { data: { text: '', uid: createUid(), richText: true }, children: [] }
  const stack = [{ node: root, depth: 0 }]

  for (const item of nodes) {
    const newNode = { data: { text: item.text, uid: createUid(), richText: true }, children: [] }
    if (item.tableHtml) newNode.data.tableHtml = item.tableHtml
    if (item.quote) newNode.data.quote = true

    // 弹出栈中深度 >= 当前的节点，找到父节点
    while (stack.length > 1 && stack[stack.length - 1].depth >= item.depth) {
      stack.pop()
    }
    stack[stack.length - 1].node.children.push(newNode)
    stack.push({ node: newNode, depth: item.depth })
  }

  // 如果只有一个一级子节点，返回它作为根
  if (root.children.length === 1) return root.children[0]
  // 多个一级子节点，创建虚拟根
  if (root.children.length > 1) {
    root.data.text = '思维导图'
    return root
  }
  return { data: { text: '思维导图', uid: createUid(), richText: true }, children: [] }
}

/**
 * 行内 Markdown → 富文本 HTML（入参已 HTML 转义，避免注入）
 * 支持：**粗体**、__粗体__、*斜体*、~~删除线~~、`代码`
 */
function inlineMarkdownToHtml(escapedText) {
  let out = String(escapedText || '')
  // 换行 → <br>（表格等多行内容合并到单节点时保留行结构）
  out = out.replace(/\n/g, '<br>')
  // 粗体 **...** 或 __...__
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  // 删除线 ~~...~~
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  // 行内代码 `...`
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  // 斜体 *...*（单个星号，避免与 ** 冲突）
  out = out.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
  return out
}

function normalizeTree(node) {
  if (!node) return
  if (!node.data) node.data = {}
  if (!node.data.uid) node.data.uid = createUid()
  node.data.richText = true
  if (node.data.tableHtml) {
    node.data.text = node.data.tableHtml
  } else if (node.data.quote) {
    const escaped = escapeHtml(node.data.text || '')
    node.data.text = `<p><span class="mm-md-quote">${inlineMarkdownToHtml(escaped)}</span></p>`
  } else {
    node.data.text = (typeof node.data.text === 'string' && node.data.text)
      ? `<p><span>${inlineMarkdownToHtml(escapeHtml(node.data.text))}</span></p>`
      : '<p><span></span></p>'
  }
  if (node.children) {
    node.children.forEach(normalizeTree)
  }
}

/**
 * 将树形数据转换为 Markdown 文本（保留粗体等行内样式）
 * @param {object} node 树节点
 * @param {number} depth 当前深度
 * @returns {string} Markdown 文本
 */
export function treeToMarkdown(node, depth = 1) {
  if (!node || !node.data) return ''
  let md = '#'.repeat(depth) + ' ' + richTextToMarkdownInline(node.data.text) + '\n'
  if (node.children) {
    node.children.forEach(child => {
      md += treeToMarkdown(child, depth + 1)
    })
  }
  return md
}

/**
 * 富文本 HTML → Markdown 行内（<strong>→**bold**、<em>→*italic*、<del>→~~strike~~）
 */
function richTextToMarkdownInline(html) {
  return String(html || '')
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .replace(/<b>(.*?)<\/b>/g, '**$1**')
    .replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<i>(.*?)<\/i>/g, '*$1*')
    .replace(/<del>(.*?)<\/del>/g, '~~$1~~')
    .replace(/<strike>(.*?)<\/strike>/g, '~~$1~~')
    .replace(/<code>(.*?)<\/code>/g, '`$1`')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}
