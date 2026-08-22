/**
 * 共享文字样式工具：字体颜色 / 高亮背景 / 加粗 / 下划线 / 删除线
 * 选中节点 = 对节点全部文字作用；多节点 = 对全部节点的全部文字作用
 * 通过 node.setText 走命令栈，支持 Ctrl+Z 撤销
 * 被 Contextmenu.vue（右键菜单色板）、toolHandler.js（AI set_node_style）、
 * App.vue（Alt / Ctrl+Alt 快捷键）共用
 */

// 统一字体颜色：AI 工具、固定工具栏、文字工具栏、右键菜单、快捷键共用同一套色板。
// 这里的值以文字工具栏（TextToolbar）为准，避免 AI 的“蓝色”和工具栏的“蓝色”不一致。
export const textColors = [
  { label: '黑色', value: '#1d1d1f' },
  { label: '红色', value: '#ff3b30' },
  { label: '橙色', value: '#ff9500' },
  { label: '黄色', value: '#ffcc00' },
  { label: '绿色', value: '#34c759' },
  { label: '青色', value: '#00c7be' },
  { label: '蓝色', value: '#007aff' },
  { label: '靛蓝', value: '#5856d6' },
  { label: '紫色', value: '#af52de' },
  { label: '粉色', value: '#ff2d55' },
  { label: '灰色', value: '#8e8e93' },
  { label: '白色', value: '#ffffff' }
]

// 供 TextToolbar 直接使用的一维色值数组
export const textColorValues = textColors.map(c => c.value)

// 统一高亮背景色：与文字工具栏的 8 个高亮色保持一致
export const highlightColors = [
  { label: '黄色高亮', value: 'rgba(255, 230, 0, 0.25)' },
  { label: '橙色高亮', value: 'rgba(255, 149, 0, 0.25)' },
  { label: '红色高亮', value: 'rgba(255, 45, 85, 0.25)' },
  { label: '紫色高亮', value: 'rgba(175, 82, 222, 0.25)' },
  { label: '靛蓝高亮', value: 'rgba(88, 86, 214, 0.25)' },
  { label: '蓝色高亮', value: 'rgba(0, 122, 255, 0.25)' },
  { label: '青色高亮', value: 'rgba(0, 199, 190, 0.25)' },
  { label: '绿色高亮', value: 'rgba(52, 199, 89, 0.25)' }
]

export const highlightColorValues = highlightColors.map(c => c.value)

// 色系 → 统一字体颜色
const TEXT_COLOR_FAMILY_MAP = {
  红: '#ff3b30',
  橙: '#ff9500',
  黄: '#ffcc00',
  绿: '#34c759',
  青: '#00c7be',
  蓝: '#007aff',
  紫: '#af52de',
  粉: '#ff2d55',
  黑: '#1d1d1f',
  白: '#ffffff',
  灰: '#8e8e93'
}

// 色系 → 统一高亮背景色
const HIGHLIGHT_COLOR_FAMILY_MAP = {
  红: 'rgba(255, 45, 85, 0.25)',
  橙: 'rgba(255, 149, 0, 0.25)',
  黄: 'rgba(255, 230, 0, 0.25)',
  绿: 'rgba(52, 199, 89, 0.25)',
  青: 'rgba(0, 199, 190, 0.25)',
  蓝: 'rgba(0, 122, 255, 0.25)',
  紫: 'rgba(175, 82, 222, 0.25)',
  粉: 'rgba(255, 45, 85, 0.25)',
  黑: 'rgba(255, 230, 0, 0.25)',
  白: 'rgba(255, 230, 0, 0.25)',
  灰: 'rgba(255, 230, 0, 0.25)'
}

// 统一节点背景色
export const nodeBgColorValues = ['#ffffff', '#f5f5f7', '#ffe58f', '#91d5ff', '#b7eb8f', '#ffa8c5', '#e8f0fa', '#111111']

// Alt+字母 → 字体颜色（颜色英文单词首字母）
export const fontColorShortcuts = {
  r: { color: '#ff3b30', label: '红色' },
  o: { color: '#ff9500', label: '橙色' },
  g: { color: '#34c759', label: '绿色' },
  b: { color: '#007aff', label: '蓝色' },
  p: { color: '#af52de', label: '紫色' },
  k: { color: '#1d1d1f', label: '黑色' }
}

// Ctrl+Alt+字母 → 高亮背景色
export const highlightColorShortcuts = {
  y: { color: 'rgba(255, 230, 0, 0.25)', label: '黄色高亮' },
  g: { color: 'rgba(52, 199, 89, 0.25)', label: '绿色高亮' },
  b: { color: 'rgba(0, 122, 255, 0.25)', label: '蓝色高亮' },
  p: { color: 'rgba(255, 45, 85, 0.25)', label: '粉色高亮' }
}

export const escapeHtmlForStyle = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 收集容器内所有非空文本节点
export const collectTextNodes = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const list = []
  while (walker.nextNode()) {
    const t = walker.currentNode
    if (t.nodeValue && t.nodeValue.trim()) list.push(t)
  }
  return list
}

// 获取文本节点所在的行内 span；文本直接挂在 <p> 上或挖空 span 上时，包一层新 span
export const ensureInlineSpan = (textNode) => {
  let el = textNode.parentElement
  const needWrap = !el ||
    el.tagName === 'P' ||
    el.tagName === 'DIV' ||
    (el.classList && el.classList.contains('smm-cloze'))
  if (needWrap) {
    const span = document.createElement('span')
    textNode.replaceWith(span)
    span.appendChild(textNode)
    el = span
  }
  return el
}

// 沿祖先链读取内联样式属性值
export const getEffectiveProp = (el, prop) => {
  let cur = el
  while (cur && cur.nodeType === 1) {
    const v = cur.style && cur.style.getPropertyValue(prop)
    if (v) return v
    if (prop === 'font-weight' && (cur.tagName === 'STRONG' || cur.tagName === 'B')) return 'bold'
    if (prop === 'font-style' && (cur.tagName === 'EM' || cur.tagName === 'I')) return 'italic'
    if (prop === 'text-decoration-line' || prop === 'text-decoration') {
      if (cur.tagName === 'U') return 'underline'
      if (cur.tagName === 'S' || cur.tagName === 'DEL' || cur.tagName === 'STRIKE') return 'line-through'
    }
    cur = cur.parentElement
  }
  return ''
}

/**
 * 查找元素自身或祖先链上最近的语义标签（strong/em/u/s/del/strike）
 */
const findSemanticTag = (el, tags) => {
  let cur = el
  while (cur && cur.nodeType === 1) {
    if (tags.includes(cur.tagName)) return cur
    cur = cur.parentElement
  }
  return null
}

/**
 * 把元素包进指定语义标签；若已在目标标签内则直接返回
 */
const wrapWithSemanticTag = (el, tagName) => {
  const exists = findSemanticTag(el, [tagName])
  if (exists) return exists
  const wrapper = document.createElement(tagName)
  el.replaceWith(wrapper)
  wrapper.appendChild(el)
  return wrapper
}

/**
 * 移除元素自身或最近祖先上的指定语义标签
 */
const unwrapSemanticTag = (el, tagNames) => {
  const target = findSemanticTag(el, tagNames)
  if (!target) return
  const parent = target.parentNode
  if (!parent) return
  while (target.firstChild) {
    parent.insertBefore(target.firstChild, target)
  }
  parent.removeChild(target)
}

// 旧版/简写 font-family → Quill 富文本白名单字体栈
const FONT_FAMILY_ALIASES = {
  'microsoft yahei': '微软雅黑, Microsoft YaHei',
  '微软雅黑': '微软雅黑, Microsoft YaHei',
  'simsun': '宋体, SimSun, Songti SC',
  '宋体': '宋体, SimSun, Songti SC',
  'simhei': '黑体, SimHei, Heiti SC',
  '黑体': '黑体, SimHei, Heiti SC',
  'kaiti': '楷体, 楷体_GB2312, SimKai, STKaiti',
  '楷体': '楷体, 楷体_GB2312, SimKai, STKaiti',
  'fangsong': '仿宋, FangSong',
  '仿宋': '仿宋, FangSong',
  'arial': 'arial, helvetica, sans-serif',
  'times new roman': 'times new roman',
  'andale mono': 'andale mono',
  'comic sans ms': 'comic sans ms',
  'impact': 'impact, chicago',
  'sans-serif': 'sans-serif',
  'serif': 'serif'
}

const normalizeFontFamily = (value) => {
  const v = String(value || '').trim().toLowerCase().replace(/["']/g, '')
  return FONT_FAMILY_ALIASES[v] || String(value || '').trim()
}

// 修改 text-decoration-line（支持 underline + line-through 组合）
export const setTextDecorationToken = (el, token, add) => {
  const cur = getEffectiveProp(el, 'text-decoration-line') || getEffectiveProp(el, 'text-decoration') || ''
  const tokens = cur.split(/[\s,]+/).filter(Boolean)
  const idx = tokens.indexOf(token)
  if (add && idx === -1) tokens.push(token)
  if (!add && idx !== -1) tokens.splice(idx, 1)
  if (tokens.length > 0) {
    el.style.setProperty('text-decoration-line', tokens.join(' '))
  } else {
    // 用 none 明确覆盖从祖先传播下来的下划线/删除线；仅移除自身属性无法抵消继承的装饰
    el.style.setProperty('text-decoration-line', 'none')
  }
}

// 对 HTML 中所有文本节点执行样式写入；无文本节点时返回 null
export const transformNodeHtml = (html, cssAction) => {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  const textNodes = collectTextNodes(div)
  if (textNodes.length === 0) return null
  for (const t of textNodes) {
    const el = ensureInlineSpan(t)
    cssAction(el)
  }
  return div.innerHTML
}

/**
 * 把旧版内联样式（font-weight/font-style/text-decoration）归一化为 Quill 能识别的语义标签。
 * 用于节点进入富文本编辑前，保证“非编辑态加粗”与“编辑态加粗”是同一状态。
 */
export const normalizeHtmlForQuill = (html) => {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  for (const t of collectTextNodes(div)) {
    const el = ensureInlineSpan(t)
    const weight = getEffectiveProp(el, 'font-weight')
    if (weight === 'bold') {
      wrapWithSemanticTag(el, 'STRONG')
      el.style.removeProperty('font-weight')
    }
    const style = getEffectiveProp(el, 'font-style')
    if (style === 'italic') {
      wrapWithSemanticTag(el, 'EM')
      el.style.removeProperty('font-style')
    }
    const fontFamily = getEffectiveProp(el, 'font-family')
    if (fontFamily) {
      const normalized = normalizeFontFamily(fontFamily)
      if (normalized && normalized !== fontFamily) {
        el.style.setProperty('font-family', normalized)
      }
    }
    const deco = (getEffectiveProp(el, 'text-decoration-line') || getEffectiveProp(el, 'text-decoration') || '').split(/[\s,]+/)
    if (deco.includes('underline')) {
      wrapWithSemanticTag(el, 'U')
      setTextDecorationToken(el, 'underline', false)
    }
    if (deco.includes('line-through')) {
      wrapWithSemanticTag(el, 'S')
      setTextDecorationToken(el, 'line-through', false)
    }
  }
  return div.innerHTML
}

/**
 * 编辑态选区样式：富文本编辑中且有选区时，对选中文字应用格式（而非整个节点）
 * @returns {boolean} true 表示已按选区处理
 */
export const applyTextStyleToSelection = (mindMap, nodes, action) => {
  const rt = mindMap?.richText
  if (!rt || !rt.showTextEdit || !rt.quill || !rt.node) return false
  // 正在编辑的节点不在目标列表时（如 AI 操作其他节点），不劫持为选区操作
  if (Array.isArray(nodes) && nodes.length > 0 && !nodes.includes(rt.node)) return false

  const quill = rt.quill
  let range = quill.getSelection(true)
  if (!range || range.length === 0) range = rt.range || rt.lastRange || null
  if (!range || range.length === 0) return false

  let formats = null
  const cur = quill.getFormat(range.index, range.length) || {}
  if (action === 'bold') {
    formats = { bold: !cur.bold }
  } else if (action === 'underline') {
    formats = { underline: !cur.underline }
  } else if (action === 'strikethrough') {
    formats = { strike: !cur.strike }
  } else if (action.startsWith('color:')) {
    const c = action.slice(6)
    formats = { color: c || false }
  } else if (action.startsWith('highlight:')) {
    const c = action.slice(10)
    formats = { background: c || false }
  }
  if (!formats) return false

  // Quill 2 API：格式对象形式（Quill 1 的 (name, value) 传法会静默失效）
  quill.formatText(range.index, range.length, formats, 'user')
  try {
    quill.setSelection(range.index, range.length, 'user')
  } catch (e) {}
  return true
}

/**
 * 应用文字样式到节点列表
 * @param {Object} mindMap - 思维导图实例
 * @param {Array} nodes - 节点实例数组
 * @param {string} action - 见 applyRichTextAction 支持的动作
 * @returns {number} 实际变更的节点数量（0 表示没有任何节点生效）
 */
export const applyTextStyleToNodes = (mindMap, nodes, action) => {
  // 编辑态且有文字选区时，优先作用于选区（右键菜单 / Alt 快捷键 / AI 工具统一生效）
  if (applyTextStyleToSelection(mindMap, nodes, action)) return 1
  let changed = 0
  for (const node of nodes) {
    try {
      const data = node.getData()
      if (!data) continue
      const rawText = data.text || ''
      const isRich = data.richText !== false
      let html = isRich
        ? rawText
        : `<p><span>${escapeHtmlForStyle(String(rawText).replace(/<[^>]+>/g, ''))}</span></p>`

      const newHtml = transformNodeHtml(html, el => applyRichTextAction(el, action))
      if (!newHtml || newHtml === html) continue
      if (typeof node.setText === 'function') {
        node.setText(newHtml, true)
        changed++
      }
    } catch (e) {
      console.error('[textStyle] 应用文字样式失败:', e)
    }
  }
  if (changed > 0 && mindMap) {
    // 多次渲染确保 UI 更新
    setTimeout(() => { try { mindMap.render() } catch (e) {} }, 100)
  }
  return changed
}

/**
 * 把一个富文本样式动作应用到单个行内元素（幂等：on/off 直接写目标状态）
 * 支持的动作（AI 工具与快捷键共用）：
 *   toggle 类：bold / underline / strikethrough
 *   幂等类：bold-on / bold-off / italic-on / italic-off / underline-on / underline-off /
 *          strikethrough-on / strikethrough-off / color:xxx / highlight:xxx /
 *          font:xxx（字体名）/ fontsize:N（文字字号）
 *   值为空串时表示清除该样式（如 color:）
 */
export const applyRichTextAction = (el, action) => {
  if (action === 'bold') {
    const isBold = getEffectiveProp(el, 'font-weight') === 'bold'
    if (isBold) {
      unwrapSemanticTag(el, ['STRONG', 'B'])
      el.style.setProperty('font-weight', 'normal')
    } else {
      wrapWithSemanticTag(el, 'STRONG')
      el.style.removeProperty('font-weight')
    }
    return
  }
  if (action === 'italic') {
    const isItalic = getEffectiveProp(el, 'font-style') === 'italic'
    if (isItalic) {
      unwrapSemanticTag(el, ['EM', 'I'])
      el.style.setProperty('font-style', 'normal')
    } else {
      wrapWithSemanticTag(el, 'EM')
      el.style.removeProperty('font-style')
    }
    return
  }
  if (action === 'bold-on') { wrapWithSemanticTag(el, 'STRONG'); el.style.removeProperty('font-weight'); return }
  if (action === 'bold-off') { unwrapSemanticTag(el, ['STRONG', 'B']); el.style.setProperty('font-weight', 'normal'); return }
  if (action === 'italic-on') { wrapWithSemanticTag(el, 'EM'); el.style.removeProperty('font-style'); return }
  if (action === 'italic-off') { unwrapSemanticTag(el, ['EM', 'I']); el.style.setProperty('font-style', 'normal'); return }
  if (action === 'underline-on') { wrapWithSemanticTag(el, 'U'); return }
  if (action === 'underline-off') { unwrapSemanticTag(el, ['U']); return }
  if (action === 'strikethrough-on') { wrapWithSemanticTag(el, 'S'); return }
  if (action === 'strikethrough-off') { unwrapSemanticTag(el, ['S', 'DEL', 'STRIKE']); return }
  if (action === 'underline' || action === 'strikethrough') {
    const token = action === 'underline' ? 'underline' : 'line-through'
    const tagNames = token === 'underline' ? ['U'] : ['S', 'DEL', 'STRIKE']
    const tagName = token === 'underline' ? 'U' : 'S'
    const has = findSemanticTag(el, tagNames) ||
      ((getEffectiveProp(el, 'text-decoration-line') || getEffectiveProp(el, 'text-decoration') || '').split(/[\s,]+/).includes(token))
    if (has) {
      unwrapSemanticTag(el, tagNames)
      setTextDecorationToken(el, token, false)
    } else {
      wrapWithSemanticTag(el, tagName)
    }
    return
  }
  if (action.startsWith('color:')) {
    const c = action.slice(6)
    if (c) el.style.setProperty('color', c)
    else el.style.removeProperty('color')
    return
  }
  if (action.startsWith('highlight:')) {
    const c = action.slice(10)
    if (c) el.style.setProperty('background-color', c)
    else el.style.removeProperty('background-color')
    return
  }
  if (action.startsWith('font:')) {
    const f = action.slice(5)
    if (f) el.style.setProperty('font-family', f)
    else el.style.removeProperty('font-family')
    return
  }
  if (action.startsWith('fontsize:')) {
    const s = action.slice(9)
    if (s) el.style.setProperty('font-size', s + 'px')
    else el.style.removeProperty('font-size')
  }
}

/**
 * 把样式动作列表应用到节点内匹配的文字片段（其余文字不动）
 * @param {string} html - 节点富文本 HTML
 * @param {string} matchText - 子串：匹配其全部出现位置
 * @param {string|null} matchRegex - 正则源（优先于 matchText），如 "【[^】]*】"
 * @param {string[]} actions - applyRichTextAction 动作数组
 * @returns {{html: string|null, count: number}} 新 HTML 与匹配片段数
 */
export const styleTextRanges = (html, matchText, matchRegex, actions) => {
  const div = document.createElement('div')
  div.innerHTML = html || ''

  // 预编译匹配器：返回一个文本中全部匹配区间的函数
  let findRanges
  if (matchRegex) {
    let re
    try {
      re = new RegExp(matchRegex, 'g')
    } catch (e) {
      return { html: null, count: 0, error: `正则无效: ${e.message}` }
    }
    findRanges = (text) => {
      const ranges = []
      re.lastIndex = 0
      let m
      while ((m = re.exec(text)) !== null) {
        if (m[0].length > 0) ranges.push([m.index, m.index + m[0].length])
        if (re.lastIndex === m.index) re.lastIndex++
      }
      return ranges
    }
  } else if (matchText) {
    findRanges = (text) => {
      const ranges = []
      let from = 0
      while (true) {
        const i = text.indexOf(matchText, from)
        if (i === -1) break
        ranges.push([i, i + matchText.length])
        from = i + matchText.length
      }
      return ranges
    }
  } else {
    return { html: null, count: 0, error: '未提供匹配文字' }
  }

  let count = 0
  const textNodes = collectTextNodes(div)
  for (const t of textNodes) {
    const ranges = findRanges(t.nodeValue || '')
    if (ranges.length === 0) continue
    // 从后往前拆分文本节点，避免前面的拆分使后面的区间失效
    for (let r = ranges.length - 1; r >= 0; r--) {
      const [start, end] = ranges[r]
      let node = t
      try {
        const after = node.splitText(end)
        const mid = node.splitText(start)
        // mid 即匹配片段；包一层 span 写样式（可能处于挖空 span 内部，包在内层不影响挖空）
        const span = document.createElement('span')
        mid.replaceWith(span)
        span.appendChild(mid)
        for (const action of actions) applyRichTextAction(span, action)
        count++
        node = after
      } catch (e) {
        console.error('[textStyle] 拆分文本节点失败:', e)
      }
    }
  }
  if (count === 0) return { html: null, count: 0 }
  return { html: div.innerHTML, count }
}

/**
 * 对节点列表内匹配的文字片段批量应用样式动作
 * @returns {{changed: number, matched: number}} 变更节点数 / 匹配片段总数
 */
export const applyTextStyleToTextRanges = (mindMap, nodes, matchText, matchRegex, actions) => {
  let changed = 0
  let matched = 0
  for (const node of nodes) {
    try {
      const data = node.getData()
      if (!data) continue
      const rawText = data.text || ''
      const isRich = data.richText !== false
      const html = isRich
        ? rawText
        : `<p><span>${escapeHtmlForStyle(String(rawText).replace(/<[^>]+>/g, ''))}</span></p>`
      const res = styleTextRanges(html, matchText, matchRegex, actions)
      if (res.error) return { changed, matched, error: res.error }
      if (!res.html || res.html === html) continue
      if (typeof node.setText === 'function') {
        node.setText(res.html, true)
        changed++
        matched += res.count
      }
    } catch (e) {
      console.error('[textStyle] 范围样式失败:', e)
    }
  }
  if (changed > 0 && mindMap) {
    setTimeout(() => { try { mindMap.render() } catch (e) {} }, 100)
  }
  return { changed, matched }
}

/**
 * 审计节点富文本 HTML 中的文字样式（只统计显式设置过的样式）
 * @param {string} html - 节点 data.text 富文本 HTML
 * @returns {Object|null} 按样式类型分组的摘要；无任何显式样式时返回 null
 * {
 *   colors: { '#e74c3c': '文本片段…' },      // 文字颜色
 *   highlights: { '#ffe58f': '文本片段…' },  // 高亮背景
 *   bold: ['片段'], italic: ['片段'], underline: ['片段'], strikethrough: ['片段'],
 *   fontSizes: { '20px': '片段' },
 *   cloze: ['被挖空的片段']
 * }
 */
export const analyzeNodeTextStyles = (html) => {
  if (!html || typeof html !== 'string' || !html.includes('<')) return null
  let div
  try {
    div = document.createElement('div')
    div.innerHTML = html
  } catch (e) {
    return null
  }
  const res = {
    colors: {}, highlights: {}, fontSizes: {},
    bold: [], italic: [], underline: [], strikethrough: [], cloze: []
  }
  const push = (map, key, text) => {
    const t = (text || '').trim().slice(0, 20)
    if (!t) return
    if (map[key]) {
      if (!map[key].includes(t) && map[key].length < 80) map[key] += '、' + t
    } else {
      map[key] = t
    }
  }
  const pushList = (list, text) => {
    const t = (text || '').trim().slice(0, 20)
    if (t && !list.includes(t) && list.length < 12) list.push(t)
  }
  for (const tn of collectTextNodes(div)) {
    let el = tn.parentElement
    while (el && el !== div) {
      if (el.classList && el.classList.contains('smm-cloze')) {
        pushList(res.cloze, tn.nodeValue)
        break
      }
      el = el.parentElement
    }
    const host = tn.parentElement
    if (!host) continue
    const color = getEffectiveProp(host, 'color')
    if (color && color !== 'inherit') push(res.colors, color, tn.nodeValue)
    const bg = getEffectiveProp(host, 'background-color')
    if (bg && bg !== 'transparent' && bg !== 'inherit') push(res.highlights, bg, tn.nodeValue)
    const weight = getEffectiveProp(host, 'font-weight')
    if (weight && (weight === 'bold' || parseInt(weight, 10) >= 600)) pushList(res.bold, tn.nodeValue)
    const style = getEffectiveProp(host, 'font-style')
    if (style && style !== 'normal') pushList(res.italic, tn.nodeValue)
    const deco = getEffectiveProp(host, 'text-decoration-line') || getEffectiveProp(host, 'text-decoration') || ''
    if (deco.includes('underline')) pushList(res.underline, tn.nodeValue)
    if (deco.includes('line-through')) pushList(res.strikethrough, tn.nodeValue)
    const fs = getEffectiveProp(host, 'font-size')
    if (fs && fs !== 'inherit') push(res.fontSizes, fs, tn.nodeValue)
  }
  const hasAny = Object.keys(res.colors).length || Object.keys(res.highlights).length ||
    Object.keys(res.fontSizes).length || res.bold.length || res.italic.length ||
    res.underline.length || res.strikethrough.length || res.cloze.length
  return hasAny ? res : null
}

/**
 * 格式刷（文字级）：提取源节点第一个文字片段的内联样式，应用到目标节点全部文字
 * 与画布格式刷（节点级样式）互补；由 AI format_painter 工具的 copy_text_styles 参数触发
 * @returns {number} 实际应用的目标节点数
 */
export const copyRichTextStyles = (mindMap, sourceNode, targetNodes) => {
  let srcHtml = ''
  try { srcHtml = sourceNode.getData().text || '' } catch (e) { return 0 }
  let div
  try {
    div = document.createElement('div')
    div.innerHTML = srcHtml
  } catch (e) { return 0 }
  const textNodes = collectTextNodes(div)
  if (textNodes.length === 0) return 0

  // 汇总「所有」文字片段的样式（而非只取第一个片段），把加粗/斜体/下划线/删除线/
  // 高亮/字号/字体/颜色都完整提取。语义标签（<strong>/<em>/<u>/<s>/<mark>，来自
  // markdown 或 Quill 归一化）没有行内样式，需沿祖先链单独识别，否则格式刷会丢样式。
  const props = {}
  const inlineProps = ['color', 'background-color', 'font-weight', 'font-style', 'font-size', 'font-family']
  const decoSet = new Set()
  for (const tn of textNodes) {
    let el = tn.parentElement
    if (!el) continue
    for (const p of inlineProps) {
      if (props[p] !== undefined) continue
      const v = getEffectiveProp(el, p)
      if (v && v !== 'inherit' && v !== 'transparent' && v !== 'normal') props[p] = v
    }
    const deco = (getEffectiveProp(el, 'text-decoration-line') || getEffectiveProp(el, 'text-decoration') || '')
      .split(/[\s,]+/)
      .filter(t => t && t !== 'none')
    for (const t of deco) decoSet.add(t)

    let cur = el
    while (cur && cur.nodeType === 1 && cur !== div) {
      const tag = cur.tagName
      if (props['font-weight'] === undefined && (tag === 'STRONG' || tag === 'B')) props['font-weight'] = 'bold'
      if (props['font-style'] === undefined && (tag === 'EM' || tag === 'I')) props['font-style'] = 'italic'
      if (tag === 'U') decoSet.add('underline')
      if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') decoSet.add('line-through')
      if (props['background-color'] === undefined && tag === 'MARK') {
        const mv = getEffectiveProp(cur, 'background-color')
        props['background-color'] = (mv && mv !== 'transparent' && mv !== 'inherit') ? mv : '#ffe58f'
      }
      cur = cur.parentElement
    }
  }
  if (decoSet.size > 0) props['text-decoration-line'] = Array.from(decoSet).join(' ')
  if (Object.keys(props).length === 0) return 0

  let changed = 0
  for (const node of targetNodes) {
    try {
      if (!node || node === sourceNode) continue
      const data = node.getData()
      if (!data) continue
      const rawText = data.text || ''
      const isRich = data.richText !== false
      const html = isRich
        ? rawText
        : `<p><span>${escapeHtmlForStyle(String(rawText).replace(/<[^>]+>/g, ''))}</span></p>`
      const newHtml = transformNodeHtml(html, el => {
        for (const [p, v] of Object.entries(props)) {
          el.style.setProperty(p, v)
        }
      })
      if (!newHtml || newHtml === html) continue
      if (typeof node.setText === 'function') {
        node.setText(newHtml, true)
        changed++
      }
    } catch (e) {
      console.error('[textStyle] copyRichTextStyles 单节点失败:', e)
    }
  }
  if (changed > 0 && mindMap) {
    setTimeout(() => { try { mindMap.render() } catch (e) {} }, 100)
  }
  return changed
}

/* ============================================================
 * 颜色归类（色系匹配）：把相近颜色归为同一色系，供"把红色变黑色"类操作使用
 * 用户按色系描述（红/橙/黄/绿/青/蓝/紫/粉/黑/白/灰）即可命中该色系下所有近似色
 * ============================================================ */

// 常用颜色名映射（解析颜色值时兜底）
const NAMED_COLORS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', gray: '#808080',
  grey: '#808080', cyan: '#00ffff', magenta: '#ff00ff', silver: '#c0c0c0'
}

// 解析颜色为 {r,g,b}（支持 #hex、#hex短、rgb()/rgba()、颜色名）
export const parseColorToRgb = (color) => {
  if (!color) return null
  let s = String(color).trim().toLowerCase()
  if (NAMED_COLORS[s]) s = NAMED_COLORS[s]
  let m = s.match(/^#?([0-9a-f]{6})$/)
  if (m) {
    const v = m[1]
    return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) }
  }
  m = s.match(/^#?([0-9a-f]{3})$/)
  if (m) {
    const v = m[1]
    return { r: parseInt(v[0] + v[0], 16), g: parseInt(v[1] + v[1], 16), b: parseInt(v[2] + v[2], 16) }
  }
  m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (m) {
    return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) }
  }
  return null
}

// RGB → HSL（h 0-360，s/l 0-1）
const rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s, l }
}

// 把颜色值归为色系：红/橙/黄/绿/青/蓝/紫/粉/黑/白/灰
export const classifyColor = (color) => {
  const rgb = parseColorToRgb(color)
  if (!rgb) return null
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b)
  // 无彩色：饱和度极低 → 黑/白/灰
  if (s < 0.12) {
    if (l > 0.9) return '白'
    if (l < 0.16) return '黑'
    return '灰'
  }
  if (h < 15 || h >= 345) return '红'
  if (h < 45) return '橙'
  if (h < 70) return '黄'
  if (h < 160) return '绿'
  if (h < 200) return '青'
  if (h < 250) return '蓝'
  if (h < 290) return '紫'
  return '粉'
}

// 色系关键词 → 标准色系名（支持中文色名、英文色名、hex/rgb 值）
export const colorNameToFamily = (name) => {
  if (!name) return null
  const n = String(name).trim()
  const lower = n.toLowerCase()
  const map = [
    ['红', ['red', 'crimson', 'scarlet', 'tomato']],
    ['橙', ['orange']],
    ['黄', ['yellow', 'gold']],
    ['绿', ['green', 'lime']],
    ['青', ['cyan', 'teal']],
    ['蓝', ['blue', 'navy', 'sky']],
    ['紫', ['purple', 'violet']],
    ['粉', ['pink', 'magenta', 'rose']],
    ['黑', ['black']],
    ['白', ['white']],
    ['灰', ['gray', 'grey', 'silver']]
  ]
  for (const [family, keywords] of map) {
    if (n.includes(family)) return family
    if (keywords.some(k => lower.includes(k))) return family
  }
  return classifyColor(n)
}

/**
 * 把任意颜色名/色值归一化为统一字体颜色色板。
 * AI 工具设置文字颜色前必须先经过这里，保证“蓝色”和工具栏里的蓝色完全一致。
 */
export const normalizeTextColor = (color) => {
  const raw = String(color || '').trim()
  if (!raw) return ''
  if (textColorValues.includes(raw.toLowerCase())) return raw.toLowerCase()
  const family = colorNameToFamily(raw)
  return TEXT_COLOR_FAMILY_MAP[family] || raw
}

/**
 * 把任意颜色名/色值归一化为统一高亮背景色。
 */
export const normalizeHighlightColor = (color) => {
  const raw = String(color || '').trim()
  if (!raw) return ''
  if (highlightColorValues.includes(raw.toLowerCase())) return raw.toLowerCase()
  const family = colorNameToFamily(raw)
  return HIGHLIGHT_COLOR_FAMILY_MAP[family] || raw
}

/**
 * 把任意颜色名/色值归一化为统一节点背景色。
 */
export const normalizeNodeFillColor = (color) => {
  const raw = String(color || '').trim()
  if (!raw) return ''
  if (nodeBgColorValues.includes(raw.toLowerCase())) return raw.toLowerCase()
  const family = colorNameToFamily(raw)
  const map = {
    红: '#ffa8c5',
    橙: '#ffe58f',
    黄: '#ffe58f',
    绿: '#b7eb8f',
    青: '#91d5ff',
    蓝: '#91d5ff',
    紫: '#ffa8c5',
    粉: '#ffa8c5',
    黑: '#111111',
    白: '#ffffff',
    灰: '#f5f5f7'
  }
  return map[family] || raw
}

/**
 * 按色系匹配文字片段并应用样式（供"把所有红色变黑色"类批量操作）
 * 遍历 HTML 所有文本节点，把有效颜色归类到指定色系的片段应用 actions
 * @param {string} html - 节点富文本 HTML
 * @param {string} colorFamily - 目标色系（红/橙/黄/绿/青/蓝/紫/粉/黑/白/灰）
 * @param {string[]} actions - applyRichTextAction 动作数组（如 ['color:#1d1d1f']）
 * @returns {{html: string|null, count: number}}
 */
export const styleTextRangesByColor = (html, colorFamily, actions) => {
  const div = document.createElement('div')
  div.innerHTML = html || ''
  let count = 0
  for (const t of collectTextNodes(div)) {
    const host = t.parentElement
    if (!host) continue
    const color = getEffectiveProp(host, 'color')
    if (!color || color === 'inherit') continue
    if (classifyColor(color) !== colorFamily) continue
    // 包一层独立 span 再写样式，避免改到同段落其他颜色的文字
    const span = ensureInlineSpan(t)
    for (const action of actions) applyRichTextAction(span, action)
    count++
  }
  if (count === 0) return { html: null, count: 0 }
  return { html: div.innerHTML, count }
}

/**
 * 对节点列表内指定色系的文字片段批量应用样式（按颜色归类匹配）
 * @returns {{changed: number, matched: number}}
 */
export const applyTextStyleToTextRangesByColor = (mindMap, nodes, colorFamily, actions) => {
  let changed = 0
  let matched = 0
  for (const node of nodes) {
    try {
      const data = node.getData()
      if (!data) continue
      const rawText = data.text || ''
      const isRich = data.richText !== false
      const html = isRich
        ? rawText
        : `<p><span>${escapeHtmlForStyle(String(rawText).replace(/<[^>]+>/g, ''))}</span></p>`
      const res = styleTextRangesByColor(html, colorFamily, actions)
      if (!res.html || res.html === html) continue
      if (typeof node.setText === 'function') {
        node.setText(res.html, true)
        changed++
        matched += res.count
      }
    } catch (e) {
      console.error('[textStyle] 色系范围样式失败:', e)
    }
  }
  if (changed > 0 && mindMap) {
    setTimeout(() => { try { mindMap.render() } catch (e) {} }, 100)
  }
  return { changed, matched }
}
