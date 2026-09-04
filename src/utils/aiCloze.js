/**
 * AI 智能挖空模块
 * 通过 AI 分析思维导图内容，自动选择关键词进行挖空
 *
 * 智能挖空模式：保守策略，保留上下文线索
 * 激进挖空模式：高强度策略，尽可能多挖空关键词
 * 自动降级：AI 挖空失败时自动回退到激进模式
 * 批量处理：支持对指定节点及其所有子节点批量挖空
 */

import { aiService } from '../services/aiService'
import { applyClozeStyles, getMindMapRef, removeClozeSpansBalanced, clearNodeCloze } from './cloze'
import { classifyMindMap, mindMapTypePrompt } from './mindMapType'

/* ==================== 提取节点信息 ==================== */

const extractPlainText = (html) => {
  if (typeof html !== 'string') return ''
  if (!html.includes('<')) return html
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || div.innerText || ''
}

// 读取节点纯文本
const getNodeText = (node) => {
  if (!node) return ''
  const raw = (typeof node.getData === 'function' ? node.getData('text') : node.text) || ''
  return extractPlainText(raw).trim()
}

// 统一取节点的业务 uid：AI 返回和后续应用匹配都必须用 data.uid，
// 不能使用 simple-mind-map 内部实例的 uid，否则 AI 结果会永远匹配不上节点。
const getNodeUid = (node) => {
  if (!node) return ''
  if (typeof node.getData === 'function') {
    return node.getData('uid') || node.uid || ''
  }
  return node.uid || ''
}

// 构建带上下文的节点信息：父节点 / 子节点 / 同级节点，供 AI 理解上下文做更准确的挖空
const buildNodeInfo = (node, level) => {
  const text = getNodeText(node)
  if (!text) return null
  const parentText = getNodeText(node.parent)
  const childrenTexts = (node.children || []).map(getNodeText).filter(Boolean).slice(0, 8)
  let siblingsTexts = []
  if (node.parent && Array.isArray(node.parent.children)) {
    siblingsTexts = node.parent.children
      .filter(s => s && getNodeUid(s) !== getNodeUid(node))
      .map(getNodeText)
      .filter(Boolean)
      .slice(0, 8)
  }
  return {
    uid: getNodeUid(node),
    level,
    text,
    parentText,
    childrenTexts,
    siblingsTexts
  }
}

const extractNodesFromList = (nodeList) => {
  if (!nodeList || nodeList.length === 0) return []
  const mindMapRef = getMindMapRef()
  const levelMap = {}
  if (mindMapRef && mindMapRef.renderer && mindMapRef.renderer.root) {
    const walkLevel = (node, level) => {
      levelMap[getNodeUid(node)] = level
      if (node.children) {
        node.children.forEach(child => walkLevel(child, level + 1))
      }
    }
    walkLevel(mindMapRef.renderer.root, 0)
  }
  return nodeList
    .map(node => {
      const info = buildNodeInfo(node, levelMap[getNodeUid(node)] !== undefined ? levelMap[getNodeUid(node)] : 1)
      if (!info || !info.text || isHeadingLike(info.text)) return null
      return info
    })
    .filter(Boolean)
}

/* ==================== System Prompts ==================== */

const buildSmartSystemPrompt = () => {
  const mapType = classifyMindMap(getMindMapRef()?.renderer?.root || getMindMapRef()?.getData?.() || '')
  return `你是一个思维导图智能挖空助手。请根据思维导图节点内容，智能选择适合挖空（隐藏）的关键词，用于辅助记忆和复习。

${mindMapTypePrompt(mapType, 'cloze')}

## 核心原则（质量优先，宁缺毋滥）
只挖"当前导图类型下的关键区分词"——忘了它就会答错、答不全、顺序错乱或混淆的关键词。不挖普通名词、铺垫性描述、举例、修饰词。没有明确重点就返回空 clozes。

## 内部推理步骤（不要输出，仅供内部判断）
1. 结合 parentText 与 siblingsTexts，找出该节点与同级节点的区分点。
2. 判断是否为"标签：值"格式；若是，优先挖"值"部分。
3. 判断是否属于短并列项（≤6 字）；若是，可以整词挖空。
4. 校验挖空后剩余文字是否仍能推出原意；若不能，则移除该挖空。

## 上下文字段说明（务必结合上下文准确挖空）
输入中每个节点附带以下字段：
- text：节点自身文本
- parentText：父节点文本（主题上下文）
- childrenTexts：子节点文本列表
- siblingsTexts：同级节点文本列表

请结合 parentText 与 siblingsTexts 判断该节点承载的"区分性考点"：优先挖空能把它与同级节点区分开、且属于得分点的关键词；父节点已给出的词、或无法由上下文推断的通用词不挖。

## 挖空规则
1. 优先挖核心术语、专业概念、关键数字、重要结论、人名、地名、日期。
2. 优先挖完整术语/短语（2~8 字），不要只挖普通单字。
3. 根节点（level 为 0）不挖空。
4. 挖空文本必须与节点原文完全匹配，包括标点符号。
5. 同一关键词在同一节点只出现一次。
6. 章节名、目录名、概括性大标题不挖空。

## 保留可推测性规则（最重要）
1. "标签：值"格式，只挖空"值"部分，保留"标签"作为提示
2. 一句话中的核心语义成分不能全部挖空，至少保留一个
3. 如果两个词在语义上互补或并列，只挖空其中一个
4. 挖空后，用户读到剩余文字应该能大致猜出被隐藏的内容
5. 如果挖空某个词后会导致整句话失去理解线索，则不要挖空该词

## 区分性挖空规则（并列短类别，重点）
- 父节点是"分类/总结词"（如"特点""表现""原因""类型""原则""方法"），子节点是并列的多个短类别（如"客观性""普遍性""多样性""条件性"）时，这些类别彼此只有关键词不同 → 必须挖空这些不同的关键词（区分点）。
- 子节点很短（≤6 字）且整体就是一个完整关键词时，整词挖空，不保留残余文字（例外于"保留多于挖空"）。

## 数量下限与冒号重点（务必执行）
1. 若节点含 3 个及以上并列项（顿号/逗号/分号分隔），至少挖空 2 个；含 4 个及以上时，至少挖空 3 个，不要只挖 1 个。
2. 若节点是"A：B"或"A: B"格式，优先挖冒号后面的 B；B 若由多个并列项组成，可把 B 的关键项全部挖空，保留 A 作为提示。

## 改写规则（仅在必要时使用）
如果某节点原文不适合直接挖空（例如：整段长句、无明确关键词、口语化/冗长表述），可以改写后挖空：
1. rewrite 字段输出改写后的简洁文本：保留全部关键知识点，只做精炼、书面化，让内容更利于挖空和背诵
2. 此时 clozes 必须针对"改写后的文本"输出要挖空的关键词，并与改写后文本完全匹配
3. 能直接挖空的节点绝不要改写；不要为了改写而改写
4. 改写不得改变原意、不得遗漏或新增关键知识点

## 挖空数量规则
- 短文本（10字以内）：最多挖空 1 个关键词
- 中文本（10-25字）：最多挖空 2 个关键词
- 长文本（25字以上）：最多挖空 3 个关键词
- 挖空后保留的文字必须多于被挖空的文字（短节点≤6字整词挖空时例外，可整词挖空）

## 返回格式（必须严格遵守）
输出合法 JSON，可以包裹在 \`\`\`json 代码块中；禁止尾随逗号、注释或 NaN。

{"results": [{"uid": "节点uid", "clozes": ["挖空片段1"]}, {"uid": "另一个uid", "clozes": ["片段1", "片段2"]}, {"uid": "需改写的uid", "rewrite": "改写后的文本", "clozes": ["改写后要挖空的片段"]}]}

要求：
1. 必须是合法 JSON，外层用 {"results": [...]} 包裹
2. 不要包含解释文字、markdown 标记或代码块标记
3. uid 必须与输入完全一致
4. clozes 中每个文本片段必须与节点原文（或改写后文本）完全匹配
5. 如果没有需要挖空的节点，返回 {"results": []}`
}

const buildAggressiveSystemPrompt = () => {
  const mapType = classifyMindMap(getMindMapRef()?.renderer?.root || getMindMapRef()?.getData?.() || '')
  return `你是一个思维导图激进挖空助手。请根据思维导图节点内容，尽可能多地选择关键词进行挖空，用于高强度记忆测试。优先挖重点（考点/术语/数字/因果结论），其次才挖一般内容词，不要为了数量挖无关紧要的词。

${mindMapTypePrompt(mapType, 'cloze')}

## 上下文字段说明
输入中每个节点附带 parentText（父节点）、childrenTexts（子节点）、siblingsTexts（同级节点）。请结合上下文判断哪些是关键考点，优先挖空与同级节点区分开的区分性关键词。

## 挖空规则
1. 优先挖空考点/重点：核心术语、关键数字、重要概念、因果结论；其次挖一般内容词，不挖铺垫词、修饰词
2. 不挖空功能词：的、了、是、在、和、与、或等
3. 根节点（level 为 0）不挖空
4. 挖空的文本必须与节点原文完全匹配
5. 跳过文本过短（少于 2 个字）的节点
6. 同一个关键词在同一个节点中只出现一次
7. 章节名、目录名、概括性大标题（如“第一章”“第一节”“导论”“目录”“知识框架”）不挖空

## 激进策略
1. 只要是一个独立的意义单元就可以挖空
2. 并列短类别（如"特点"下的"客观性/普遍性/多样性"）：整词挖空这些短类别（≤6字），突出彼此区分的不同关键词
3. "标签：值"格式可以同时挖空"标签"和"值"
4. 一句话中可以挖空多个语义成分
5. 并列的多个概念可以全部挖空

## 挖空数量规则
- 短文本（10字以内）：挖空 1-2 个关键词
- 中文本（10-25字）：挖空 2-4 个关键词
- 长文本（25字以上）：挖空 3-6 个关键词

## 返回格式（必须严格遵守）
输出合法 JSON，可以包裹在 \`\`\`json 代码块中；禁止尾随逗号、注释或 NaN。

{"results": [{"uid": "节点uid", "clozes": ["挖空片段1"]}, {"uid": "另一个uid", "clozes": ["片段1", "片段2"]}, {"uid": "需改写的uid", "rewrite": "改写后的文本", "clozes": ["改写后要挖空的片段"]}]}

要求：
1. 必须是合法 JSON
2. 不要包含解释文字、markdown 标记或代码块标记
3. uid 必须与输入完全一致
4. clozes 中每个文本片段必须与节点原文（或改写后文本）完全匹配
5. 如果没有需要挖空的节点，返回 {"results": []}`
}

const buildUserMessage = (nodes, mode) => {
  const modeLabel = mode === 'aggressive' ? 'AI激进挖空' : 'AI智能挖空'
  return `请对以下思维导图节点进行${modeLabel}，返回 JSON 格式结果：

${JSON.stringify(nodes)}

请严格按照系统提示中的格式返回 JSON 对象。`
}

/* ==================== 解析 AI 响应 ==================== */

const THINK_OPEN = String.fromCharCode(60) + 'think' + String.fromCharCode(62)
const THINK_CLOSE = String.fromCharCode(60) + '/think' + String.fromCharCode(62)

const parseAiResponse = (content) => {
  if (!content || typeof content !== 'string') return []
  let text = content.trim()

  // 移除推理模型的 think 标签
  const thinkRegex = new RegExp(THINK_OPEN + '[\\s\\S]*?' + THINK_CLOSE, 'gi')
  text = text.replace(thinkRegex, '')

  // 处理未闭合的 think 标签
  if (text.includes(THINK_OPEN)) {
    const afterThink = text.split(THINK_OPEN)
    const afterContent = afterThink[afterThink.length - 1] || ''
    const jsonStart = afterContent.search(/[{\[]/)
    if (jsonStart >= 0) {
      text = afterContent.substring(jsonStart)
    } else {
      text = ''
    }
  }

  // 移除 markdown 代码块标记
  text = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '')
  // 移除变量赋值前缀
  text = text.replace(/^[a-zA-Z_]\w*\s*=\s*/, '')
  text = text.trim()

  const extractResults = (parsed) => {
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.results)) return parsed.results
    if (parsed && parsed.cloze_result) return extractResults(parsed.cloze_result)
    if (parsed && parsed.data) return extractResults(parsed.data)
    return []
  }

  try {
    const parsed = JSON.parse(text)
    return extractResults(parsed)
  } catch (e) {
    // 尝试提取 JSON 对象
    const objMatches = text.match(/\{[\s\S]*\}/g)
    if (objMatches && objMatches.length > 0) {
      for (let i = objMatches.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(objMatches[i])
          const results = extractResults(parsed)
          if (results.length > 0) return results
        } catch (e2) {}
      }
    }
    // 尝试提取 JSON 数组
    const arrMatch = text.match(/\[[\s\S]*\]/)
    if (arrMatch) {
      try {
        const parsed = JSON.parse(arrMatch[0])
        if (Array.isArray(parsed)) return parsed
      } catch (e3) {}
    }
    console.error('[AI挖空] 解析AI响应失败:', e, '清理后文本:', text.substring(0, 500))
    return []
  }
}

/* ==================== 应用挖空到节点 ==================== */

const wrapTextInElement = (el, searchText) => {
  if (!searchText || !el) return
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      let parent = node.parentNode
      while (parent && parent !== el) {
        if (parent.classList && parent.classList.contains('smm-cloze')) {
          return NodeFilter.FILTER_REJECT
        }
        parent = parent.parentNode
      }
      return node.nodeValue && node.nodeValue.includes(searchText)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    }
  })
  const textNodes = []
  let current
  while ((current = walker.nextNode())) {
    textNodes.push(current)
  }
  textNodes.forEach(textNode => {
    const text = textNode.nodeValue
    const parts = text.split(searchText)
    if (parts.length <= 1) return
    const parent = textNode.parentNode
    const fragment = document.createDocumentFragment()
    parts.forEach((part, i) => {
      if (i > 0) {
        const span = document.createElement('span')
        span.className = 'smm-cloze'
        span.textContent = searchText
        fragment.appendChild(span)
      }
      if (part) {
        fragment.appendChild(document.createTextNode(part))
      }
    })
    parent.replaceChild(fragment, textNode)
  })
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c])

// 硬约束：节点包含“标签：值”结构时，只允许挖冒号后面的内容。
// 这是规则兜底，不依赖模型遵守提示词；若某个挖空片段只出现在冒号前则整段移除。
const filterClozesBeforeColon = (plainText, clozes) => {
  if (!Array.isArray(clozes) || clozes.length === 0) return clozes
  const text = String(plainText || '')
  const delimiters = ['：', ':']
  let colonIndex = -1
  let delimiterLength = 0
  for (const delimiter of delimiters) {
    const index = text.indexOf(delimiter)
    if (index >= 0 && (colonIndex < 0 || index < colonIndex)) {
      colonIndex = index
      delimiterLength = delimiter.length
    }
  }
  if (colonIndex < 0) return clozes

  return clozes.filter((cloze) => {
    const value = String(cloze || '')
    if (!value) return false
    let fromIndex = 0
    while (true) {
      const found = text.indexOf(value, fromIndex)
      if (found < 0) return true
      // 只要存在一处位于冒号前的匹配，就放弃该挖空，确保不会把提示词挖掉。
      if (found < colonIndex) return false
      fromIndex = found + value.length
    }
  })
}

const applyClozeToNode = (node, item) => {
  let clozes = item && Array.isArray(item.clozes) ? item.clozes : []
  const rewrite = item && item.rewrite ? String(item.rewrite).trim() : ''
  if (clozes.length === 0 && !rewrite) return 0

  let text = (typeof node.getData === 'function' ? node.getData('text') : node.text) || ''
  if (typeof text !== 'string' || !text.trim()) return 0

  let isRichText = typeof node.getData === 'function' ? !!node.getData('richText') : !!node.richText

  // 改写：先把原文（纯文本）记为备注，再用改写后的文本替换节点
  if (rewrite) {
    const originalText = extractPlainText(text).trim()
    if (originalText) {
      let hasNote = false
      try { hasNote = !!(typeof node.getData === 'function' && node.getData('note')) } catch (e) {}
      if (!hasNote && typeof node.setNote === 'function') {
        node.setNote(originalText)
      }
    }
    text = rewrite
    isRichText = false
    // 标记该节点被改写，并记录改写后挖空的关键词，供「一键还原」回填原文+挖空
    if (typeof node.setData === 'function') {
      try { node.setData({ clozeRewrite: true, clozeRewriteClozes: clozes }) } catch (e) {}
    }
  }

  // 冒号前不挖空的硬约束放在最终写入前，覆盖 AI、本地兜底、审查补充等所有路径。
  const plainForFilter = extractPlainText(text).trim()
  clozes = filterClozesBeforeColon(plainForFilter, clozes)
  if (clozes.length === 0 && !rewrite) return 0

  // 先清除已有的挖空标记（平衡移除，避免嵌套 span 结构损坏）
  text = removeClozeSpansBalanced(text)

  if (clozes.length > 0) {
    if (isRichText && text.includes('<')) {
      const div = document.createElement('div')
      div.innerHTML = text
      clozes.forEach(cloze => wrapTextInElement(div, cloze))
      text = div.innerHTML
    } else {
      let plainText = text
      clozes.forEach(cloze => {
        plainText = plainText.split(cloze).join('<span class="smm-cloze">' + escapeHtml(cloze) + '</span>')
      })
      text = '<p>' + plainText + '</p>'
    }
  } else {
    // 只有改写没有挖空：整体按纯文本写入
    text = '<p>' + escapeHtml(text) + '</p>'
  }

  if (typeof node.setText === 'function') {
    node.setText(text, true)
  } else if (typeof node.setData === 'function') {
    node.setData({ text, richText: true })
  }
  return (text.match(/class="smm-cloze"/g) || []).length
}

const applyClozeList = (clozeList, skipRender = false) => {
  const mindMapRef = getMindMapRef()
  if (!mindMapRef || !mindMapRef.renderer || !mindMapRef.renderer.root) return 0

  const clozeMap = {}
  clozeList.forEach(item => {
    if (item && item.uid && (Array.isArray(item.clozes) || item.rewrite)) {
      clozeMap[item.uid] = item
    }
  })

  const root = mindMapRef.renderer.root
  let appliedCount = 0
  const walk = (node) => {
    const uid = getNodeUid(node)
    if (uid && clozeMap[uid]) {
      appliedCount += applyClozeToNode(node, clozeMap[uid])
    }
    if (node.children) {
      node.children.forEach(walk)
    }
  }
  walk(root)
  if (!skipRender) {
    mindMapRef.render()
    // 多次确保渲染完成后应用样式
    setTimeout(() => applyClozeStyles(), 50)
    setTimeout(() => applyClozeStyles(), 100)
    setTimeout(() => applyClozeStyles(), 300)
    setTimeout(() => applyClozeStyles(), 500)
  }
  return appliedCount
}

/* ==================== 考点短语提取工具（结构模式+正则） ==================== */

// 前触发词：后面跟着考点
const PRE_TRIGGER_WORDS = [
  '包括', '包含', '含有', '涵盖', '涉及',
  '分为', '分成', '划分', '归类为',
  '具有', '具备', '拥有', '有',
  '表现为', '体现为', '反映为',
  '称为', '叫做', '被称为', '被誉为', '称作',
  '即', '也就是', '指的是', '意即',
  '例如', '比如', '譬如', '如',
  '标志着', '意味着', '表明', '说明',
  '导致', '使得', '造成', '引起', '促使',
  '目的是', '为了', '旨在', '目标是',
  '本质是', '实质是', '核心是', '关键是', '重点是', '根本是',
  '基础是', '前提是', '条件是', '保证是', '保障是',
  '特点是', '特征是', '特性是', '属性是',
  '原因是', '因为', '由于',
  '结果是', '所以', '因此', '因而',
]

// 程度修饰词：后面跟的名词短语是重点
const DEGREE_MODIFIERS = [
  '根本', '基本', '主要', '核心', '关键', '重要', '首要',
  '唯一', '本质', '实质', '最终', '直接', '间接',
  '重要', '主要', '核心', '关键', '根本', '基本',
]

// 通用学术后缀：带这些后缀的词通常是专有概念
const ACADEMIC_SUFFIXES = [
  '理论', '方法', '原则', '规律', '体系', '制度', '机制',
  '模式', '方式', '形式', '结构', '层次', '阶段', '时期', '时代',
  '性质', '特征', '特点', '特性', '属性', '功能', '作用',
  '意义', '价值', '目标', '目的', '任务', '要求',
  '关系', '联系', '矛盾', '统一', '对立',
  '革命', '改革', '运动', '斗争', '建设', '发展',
  '思想', '精神', '意识', '观念', '理念', '概念',
]

// 挖空停用词（太短或太通用，不适合挖空）
const CLOZE_STOP_WORDS = new Set([
  '的', '了', '是', '在', '和', '与', '或', '及', '等', '有', '为', '被',
  '可以', '能够', '进行', '通过', '使用', '方法', '方式', '问题', '情况',
  '内容', '方面', '部分', '过程', '作用', '关系', '意义', '形式', '发展',
  '这个', '那个', '这些', '那些', '一个', '一种', '一些',
  '什么', '怎么', '为什么', '如何',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'by', 'as', 'at', 'from'
])

// 判断短语是否适合挖空
const isUsablePhrase = (phrase) => {
  const p = String(phrase || '').trim()
  if (p.length < 2 || p.length > 15) return false
  if (CLOZE_STOP_WORDS.has(p.toLowerCase())) return false
  // 不能全是标点或数字
  if (/^[\d\s\p{P}]+$/u.test(p)) return false
  // 不能以"的"结尾（不完整）
  if (p.endsWith('的')) return false
  return true
}

// 从候选短语中去重（处理包含关系，保留更长的）
const deduplicatePhrases = (phrases, text) => {
  const sorted = [...phrases].sort((a, b) => b.length - a.length)
  const result = []
  const usedRanges = []

  for (const phrase of sorted) {
    if (!isUsablePhrase(phrase)) continue
    // 找出这个短语在文本中的位置
    let idx = text.indexOf(phrase)
    let isOverlap = false
    while (idx !== -1) {
      const range = [idx, idx + phrase.length]
      // 检查是否和已使用的范围重叠
      for (const used of usedRanges) {
        if (range[0] < used[1] && range[1] > used[0]) {
          isOverlap = true
          break
        }
      }
      if (!isOverlap) {
        usedRanges.push(range)
        result.push(phrase)
        break
      }
      idx = text.indexOf(phrase, idx + 1)
    }
  }
  return result
}

/* ==================== 考点短语提取器 ==================== */

// 提取所有候选考点短语，返回 [{phrase, priority}]，priority 越大越优先
const extractClozeCandidates = (text) => {
  const candidates = []
  const add = (phrase, priority) => {
    if (isUsablePhrase(phrase) && text.includes(phrase)) {
      candidates.push({ phrase, priority })
    }
  }

  // ===== 优先级 5：序数词 + 名词（最像考点） =====
  const ordinalPattern = /第[一二三四五六七八九十百千\d]+[\u4e00-\u9fa5]{2,8}/g
  let m
  while ((m = ordinalPattern.exec(text)) !== null) {
    add(m[0], 50)
  }

  // ===== 优先级 5：前触发词 + 短语 =====
  for (const trigger of PRE_TRIGGER_WORDS) {
    const pattern = new RegExp(
      trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '([\\u4e00-\\u9fa5A-Za-z0-9]{2,12}(?:[、和与及][\\u4e00-\\u9fa5A-Za-z0-9]{2,8})*)',
      'g'
    )
    while ((m = pattern.exec(text)) !== null) {
      const content = m[1]
      // 如果是并列项，分别加入
      const items = content.split(/[、和与及]/).map(s => s.trim()).filter(Boolean)
      if (items.length >= 2) {
        items.forEach(item => add(item, 48))
      } else {
        add(content, 45)
      }
    }
  }

  // ===== 优先级 4：程度修饰词 + 名词 =====
  for (const mod of DEGREE_MODIFIERS) {
    const pattern = new RegExp(mod + '[\\u4e00-\\u9fa5]{2,8}', 'g')
    while ((m = pattern.exec(text)) !== null) {
      add(m[0], 40)
    }
  }

  // ===== 优先级 4：数字 + 量词 + 名词短语 =====
  // 阿拉伯数字
  const numNounPattern = /\d+(?:\.\d+)?[个种项条类点方面层次种类型章节]?[\u4e00-\u9fa5]{2,8}/g
  while ((m = numNounPattern.exec(text)) !== null) {
    add(m[0], 38)
  }
  // 中文数字
  const cnNumPattern = /[一二三四五六七八九十两][个种项条类点方面层次种类型章节]?[\u4e00-\u9fa5]{2,8}/g
  while ((m = cnNumPattern.exec(text)) !== null) {
    add(m[0], 36)
  }

  // ===== 优先级 4：百分比/比例 =====
  const percentPattern = /\d+(?:\.\d+)?%[以上以下左右以内之外]?/g
  while ((m = percentPattern.exec(text)) !== null) {
    add(m[0], 38)
  }

  // ===== 优先级 3：年份/时间 =====
  const yearPattern = /\d{4}年(?:代|初|末|中期)?/g
  while ((m = yearPattern.exec(text)) !== null) {
    add(m[0], 35)
  }
  const centuryPattern = /\d{1,2}世纪(?:年代|初|末|中期|后期)?/g
  while ((m = centuryPattern.exec(text)) !== null) {
    add(m[0], 35)
  }

  // ===== 优先级 3：引号/书名号内容 =====
  const quotePattern = /"([^"]{2,12})"|“([^”]{2,12})”|'([^']{2,12})'|‘([^’]{2,12})’/g
  while ((m = quotePattern.exec(text)) !== null) {
    const content = m[1] || m[2] || m[3] || m[4]
    add(content, 32)
  }
  const bookPattern = /《([^》]{2,15})》/g
  while ((m = bookPattern.exec(text)) !== null) {
    add(m[1], 32)
  }

  // ===== 优先级 3：并列结构（顿号分隔） =====
  const parallelPattern = /[\u4e00-\u9fa5A-Za-z0-9]{2,8}(?:[、][\u4e00-\u9fa5A-Za-z0-9]{2,8}){1,5}/g
  while ((m = parallelPattern.exec(text)) !== null) {
    const items = m[0].split('、').map(s => s.trim()).filter(Boolean)
    if (items.length >= 2) {
      // 并列项按比例：3个挖2个，4个以上挖3个
      const pickCount = items.length >= 4 ? 3 : (items.length >= 3 ? 2 : 2)
      items.slice(0, pickCount).forEach(item => add(item, 30))
    }
  }

  // ===== 优先级 3：学术后缀短语 =====
  for (const suffix of ACADEMIC_SUFFIXES) {
    const pattern = new RegExp('[\\u4e00-\\u9fa5]{2,6}' + suffix, 'g')
    while ((m = pattern.exec(text)) !== null) {
      add(m[0], 28)
    }
  }

  // ===== 优先级 2："XX的XX"偏正短语 =====
  const modifierPattern = /[\u4e00-\u9fa5]{2,6}的[\u4e00-\u9fa5]{2,6}/g
  while ((m = modifierPattern.exec(text)) !== null) {
    add(m[0], 20)
  }

  // ===== 优先级 2："A是B"表语结构 =====
  const definitionPattern = /(?:是|即|指|就是|称为)[^，。！？；、,.!?;:：]{2,12}/g
  while ((m = definitionPattern.exec(text)) !== null) {
    const content = m[0].replace(/^(是|即|指|就是|称为)/, '').trim()
    add(content, 22)
  }

  // ===== 优先级 2：后总结（...等XX） =====
  const postSummaryPattern = /[\u4e00-\u9fa5、]{2,20}等[\u4e00-\u9fa5]{2,6}/g
  while ((m = postSummaryPattern.exec(text)) !== null) {
    const content = m[0]
    // 提取"等"前面的并列项
    const beforeDeng = content.replace(/等[\u4e00-\u9fa5]{2,6}$/, '')
    const items = beforeDeng.split(/[、和与及]/).map(s => s.trim()).filter(Boolean)
    if (items.length >= 2) {
      items.forEach(item => add(item, 25))
    }
  }

  // ===== 优先级 1：冒号后面的值（最后兜底的结构） =====
  const colonMatch = text.match(/[:：]\s*(.+)$/)
  if (colonMatch) {
    const value = colonMatch[1].trim()
    if (value.length >= 2 && value.length <= 12) {
      add(value, 15)
    }
  }

  return candidates
}

// 从候选中选出最优的 N 个挖空词
const pickTopClozes = (text, maxCount) => {
  const candidates = extractClozeCandidates(text)
  if (candidates.length === 0) return []

  // 按优先级降序排序
  candidates.sort((a, b) => b.priority - a.priority)

  // 去重（短语和包含关系处理）
  const uniquePhrases = []
  const seen = new Set()
  for (const c of candidates) {
    if (seen.has(c.phrase)) continue
    seen.add(c.phrase)
    uniquePhrases.push(c.phrase)
  }

  // 处理包含关系：如果一个短语包含另一个，保留长的
  const deduped = deduplicatePhrases(uniquePhrases, text)

  // 取前 N 个
  return deduped.slice(0, maxCount)
}

/* ==================== 同级节点对比（区分性挖空） ==================== */

// 按父节点分组，找出每组中兄弟节点的区分性短语
const buildSiblingDistinctionMap = (nodes) => {
  const siblingGroups = new Map() // parentText -> [{uid, text, candidatePhrases}]

  nodes.forEach(node => {
    const text = extractPlainText(node.text || '').trim()
    if (!text) return
    const parentText = node.parentText || ''
    if (!parentText) return

    if (!siblingGroups.has(parentText)) {
      siblingGroups.set(parentText, [])
    }
    // 提取该节点的候选短语（用于对比）
    const phrases = new Set(
      extractClozeCandidates(text).map(c => c.phrase).filter(isUsablePhrase)
    )
    siblingGroups.get(parentText).push({ uid: node.uid, text, phrases })
  })

  const distinctionMap = new Map() // uid -> Set<区分短语>

  siblingGroups.forEach((siblings) => {
    if (siblings.length < 2) return

    // 统计每个短语出现在多少个兄弟节点中
    const phraseSiblingCount = new Map()
    siblings.forEach(s => {
      s.phrases.forEach(phrase => {
        phraseSiblingCount.set(phrase, (phraseSiblingCount.get(phrase) || 0) + 1)
      })
    })

    // 区分短语：只在 1 个或少数兄弟节点中出现的
    const threshold = Math.max(1, Math.ceil(siblings.length / 2))
    siblings.forEach(s => {
      const distinctions = new Set()
      s.phrases.forEach(phrase => {
        const count = phraseSiblingCount.get(phrase) || 0
        if (count <= threshold && count < siblings.length) {
          distinctions.add(phrase)
        }
      })
      if (distinctions.size > 0) {
        distinctionMap.set(s.uid, distinctions)
      }
    })
  })

  return distinctionMap
}

/* ==================== 本地降级挖空 ==================== */

const isHeadingLike = (text) => {
  const value = (text || '').trim()
  if (!value) return true
  // 仅按文本模式判断是否为章节/目录类标题；不再按节点层级一刀切跳过。
  // 层级过滤（根节点等）由全文挖空的 walk 显式控制，避免误伤用户显式选中的第一层节点
  return /^(第[一二三四五六七八九十百\d]+[章节部分篇]|第[一二三四五六七八九十\d]+节|导论|绪论|前言|后记|附录|目录|知识框架|本章重难点|一、|二、|三、|四、|五、|六、|七、|八、|九、|十、|[（(][一二三四五六七八九十\d]+[）)])/.test(value)
}

const pickFallbackCloze = (text) => {
  const value = (text || '').trim()
  if (value.length < 2) return null

  const cleanTail = (raw) => {
    const tail = (raw || '')
      .replace(/[，。！？；、,.!?;:："'""''（）()\[\]【】]/g, ' ')
      .trim()
    return tail && tail.length >= 2 ? tail : null
  }

  const pickShortTail = (raw) => {
    const tail = cleanTail(raw)
    if (!tail) return null
    const tokens = tail
      .split(/[\s,，。！？；、：:！？;()（）\[\]【】"“”‘’]+/)
      .map(s => s.trim())
      .filter(Boolean)
    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i]
      if (token.length >= 2 && token.length <= 6 && !CLOZE_STOP_WORDS.has(token.toLowerCase())) {
        return token
      }
    }
    const zh = tail.match(/[\u4e00-\u9fa5]{2,4}$/)
    if (zh) return zh[0]
    const en = tail.match(/[A-Za-z][A-Za-z0-9-]{1,5}$/)
    if (en) return en[0]
    return tail.length <= 4 ? tail : tail.slice(-4)
  }

  // “标签：值”优先挖值，保留标签作为可推测线索
  const colonPart = value.match(/[:：]\s*([^:：]+)$/)
  if (colonPart) {
    const tail = pickShortTail(colonPart[1])
    if (tail) return tail
  }

  // “A 是 B / A 指 B / A 称为 B”这类定义句式：挖“是/即/指”后面的解释部分
  const definitionPart = value.match(/(?:是指|就是|称为|叫做|指的是|意为|是|即|指)\s*([^，。！？；、,.!?;:：]+)$/)
  if (definitionPart) {
    const tail = pickShortTail(definitionPart[1])
    if (tail) return tail
  }

  // 有标点/空格时，从末尾往前挑一个有意义的词
  const tokens = value
    .split(/[\s,，。！？；、：:！？;()（）\[\]【】"“”‘’]+/)
    .map(s => s.trim())
    .filter(Boolean)
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]
    if (token.length >= 2 && !CLOZE_STOP_WORDS.has(token.toLowerCase())) {
      return token
    }
  }

  // 连续中文：挖末尾 2~4 个字，保留前面上下文
  const chineseTail = value.match(/[\u4e00-\u9fa5]{2,4}$/)
  if (chineseTail) return chineseTail[0]

  // 英文/数字词：挖末尾单词
  const englishTail = value.match(/[A-Za-z][A-Za-z0-9-]{1,}$/)
  if (englishTail) return englishTail[0]

  return null
}

// 增强版兜底挖空：结构模式 + 正则提取 + 同级对比
const buildEnhancedFallbackClozeList = (nodes) => {
  if (!Array.isArray(nodes) || nodes.length === 0) return []

  // 第一步：构建同级区分度映射
  const distinctionMap = buildSiblingDistinctionMap(nodes)

  const list = []

  // 根据文本长度确定挖空数量上限（宁少勿滥）
  const getMaxClozeCount = (text) => {
    const len = text.length
    if (len <= 10) return 1
    if (len <= 20) return 2
    if (len <= 40) return 3
    return 4
  }

  nodes.forEach(node => {
    if (!node || !node.uid) return
    const text = extractPlainText(node.text || '').trim()
    if (text.length < 2) return
    if (isHeadingLike(text)) return

    const uid = node.uid
    const maxCount = getMaxClozeCount(text)

    // 策略1：短叶子节点（≤8字）且有兄弟节点 → 整词挖空（区分性考点）
    if (text.length <= 8 && distinctionMap.has(uid)) {
      const distinctions = distinctionMap.get(uid)
      if (distinctions && distinctions.has(text) && isUsablePhrase(text)) {
        list.push({ uid, clozes: [text] })
        return
      }
    }

    // 策略2：用结构模式 + 正则提取考点短语（核心方法）
    let clozes = pickTopClozes(text, maxCount)

    // 策略3：结合同级区分度优化
    // 如果有区分性短语，把它们的优先级提到最前面
    const distinctions = distinctionMap.get(uid)
    if (distinctions && distinctions.size > 0 && clozes.length > 0) {
      const distPhrases = []
      const otherPhrases = []
      for (const phrase of clozes) {
        if (distinctions.has(phrase)) {
          distPhrases.push(phrase)
        } else {
          otherPhrases.push(phrase)
        }
      }
      // 区分性短语排在前面
      clozes = [...distPhrases, ...otherPhrases].slice(0, maxCount)
    }

    // 策略4：如果结构模式没提取到，用简单兜底补一个
    if (clozes.length === 0) {
      const simple = pickFallbackCloze(text)
      if (simple) clozes = [simple]
    }

    if (clozes.length > 0) {
      list.push({ uid, clozes })
    }
  })

  return list
}

// 兼容旧接口：简单兜底（保留给小批量场景使用）
const buildFallbackClozeList = (nodes) => {
  // 直接使用增强版，效果更好
  return buildEnhancedFallbackClozeList(nodes)
}


/* ==================== 调用 AI ==================== */

const BATCH_REQUEST_TIMEOUT = 60000

const callAiForCloze = async (nodes, mode, timeoutMs = BATCH_REQUEST_TIMEOUT) => {
  const systemPrompt = mode === 'aggressive' ? buildAggressiveSystemPrompt() : buildSmartSystemPrompt()
  const userMessage = buildUserMessage(nodes, mode)
  // 单批次超时保护：某个请求挂起时不能让整批 Promise.all 一直等
  const choice = await Promise.race([
    aiService.chat(userMessage, systemPrompt, null, { thinking: false }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`AI 挖空请求超时（${timeoutMs / 1000} 秒）`)), timeoutMs))
  ])
  const content = choice?.message?.content || ''
  return parseAiResponse(content)
}

/* ==================== 批量并行处理 ==================== */

const BATCH_SIZE = 20
const MAX_CONCURRENCY = 5
const MIN_CONCURRENCY = 1

const callAiForClozeBatched = async (nodes, mode, onProgress, onBatchResult) => {
  const resultList = []
  let usedFallback = false

  if (nodes.length <= BATCH_SIZE) {
    try {
      const result = await callAiForCloze(nodes, mode)
      if (onBatchResult) onBatchResult(result, false)
      resultList.push(...(result || []))
    } catch (e) {
      usedFallback = true
      const fallback = buildFallbackClozeList(nodes)
      if (onBatchResult) onBatchResult(fallback, true)
      resultList.push(...fallback)
    }
    resultList.usedFallback = usedFallback
    return resultList
  }

  const batches = []
  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    batches.push(nodes.slice(i, i + BATCH_SIZE))
  }

  const initialConcurrency = Math.min(Math.max(Math.ceil(batches.length / 2), 3), MAX_CONCURRENCY)
  let currentConcurrency = initialConcurrency
  const originalTotal = batches.length
  let completedOriginals = 0
  const resolvedOriginals = new Set()

  // 每个原始批次当前还有多少待处理的子任务（动态拆分会增加数量）
  const remainingByOriginal = new Map()
  batches.forEach((_, index) => remainingByOriginal.set(index, 1))

  // 待处理任务队列：任务包含原始批次索引，便于拆分后仍能准确统计进度
  const pending = batches.map((nodes, originalIndex) => ({
    nodes,
    originalIndex,
    retries: 0
  }))
  const fallbackNodes = []

  const report = () => {
    if (onProgress) {
      onProgress({
        done: completedOriginals,
        total: originalTotal,
        percent: Math.min(100, Math.round((completedOriginals / originalTotal) * 100))
      })
    }
  }

  // 每个批次结果即时应用（写入节点文本），失败/停止时已完成的挖空不会丢
  const accept = (batchResult, isFallback = false) => {
    if (Array.isArray(batchResult) && batchResult.length) {
      resultList.push(...batchResult)
      if (onBatchResult) onBatchResult(batchResult, isFallback)
    }
  }

  const markOriginalResolved = (originalIndex) => {
    const remaining = (remainingByOriginal.get(originalIndex) || 1) - 1
    if (remaining <= 0) {
      remainingByOriginal.delete(originalIndex)
      if (!resolvedOriginals.has(originalIndex)) {
        resolvedOriginals.add(originalIndex)
        completedOriginals++
        report()
      }
    } else {
      remainingByOriginal.set(originalIndex, remaining)
    }
  }

  // 失败批次拆成两半，动态降低单批规模；太小就不再拆，改为重试或兜底
  const splitTask = (task) => {
    const mid = Math.max(5, Math.ceil(task.nodes.length / 2))
    return [
      { nodes: task.nodes.slice(0, mid), originalIndex: task.originalIndex, retries: 0 },
      { nodes: task.nodes.slice(mid), originalIndex: task.originalIndex, retries: 0 }
    ]
  }

  while (pending.length > 0) {
    if (aiService.isAborted()) {
      const err = new Error('已停止')
      err.aborted = true
      throw err
    }

    const take = Math.min(currentConcurrency, pending.length)
    const chunk = pending.splice(0, take)
    const chunkResults = await Promise.all(chunk.map(task =>
      callAiForCloze(task.nodes, mode)
        .then(data => ({ task, success: true, data }))
        .catch(error => ({ task, success: false, error }))
    ))

    const retryQueue = []
    let hasFailure = false
    let hasRateLimit = false
    let hasTimeout = false

    chunkResults.forEach(({ task, success, data, error }) => {
      if (success) {
        accept(data, false)
        markOriginalResolved(task.originalIndex)
        return
      }

      hasFailure = true
      const errMsg = (error && error.message) || ''
      if (errMsg.includes('429') || errMsg.toLowerCase().includes('rate') || errMsg.toLowerCase().includes('too many')) {
        hasRateLimit = true
      }
      if (errMsg.includes('超时') || errMsg.toLowerCase().includes('timeout')) {
        hasTimeout = true
      }

      // 第一次失败：原批次先原样重试一次。
      if (task.retries === 0) {
        task.retries = 1
        retryQueue.push(task)
        return
      }

      // 原样重试仍失败：尝试把批次拆小，再给这些小批次最后一次机会。
      if (!task.isSplitChild && task.nodes.length > 5) {
        const children = splitTask(task).map(child => ({
          ...child,
          retries: 1,
          isSplitChild: true
        }))
        remainingByOriginal.set(task.originalIndex, (remainingByOriginal.get(task.originalIndex) || 1) - 1)
        children.forEach(child => {
          remainingByOriginal.set(child.originalIndex, (remainingByOriginal.get(child.originalIndex) || 0) + 1)
          retryQueue.push(child)
        })
        return
      }

      // 无法继续拆分或拆分后仍失败：才进入本地兜底。
      fallbackNodes.push(...task.nodes)
      markOriginalResolved(task.originalIndex)
      usedFallback = true
    })

    if (hasFailure) {
      currentConcurrency = Math.max(Math.floor(currentConcurrency / 2), MIN_CONCURRENCY)
    } else if (currentConcurrency < initialConcurrency) {
      currentConcurrency = Math.min(currentConcurrency + 1, initialConcurrency)
    }

    if (hasRateLimit || hasTimeout) {
      await new Promise(resolve => setTimeout(resolve, hasTimeout ? 500 : 1000))
    }

    pending.unshift(...retryQueue)
  }

  if (fallbackNodes.length > 0) {
    const fallback = buildFallbackClozeList(fallbackNodes)
    accept(fallback, true)
    if (onProgress) {
      onProgress({
        done: originalTotal,
        total: originalTotal,
        percent: 100,
        fallback: true
      })
    }
  }

  resultList.usedFallback = usedFallback
  return resultList
}

/* ==================== AI 审查+补充模式 ==================== */
// 第二阶段：在兜底挖空的基础上，AI审查质量并补充遗漏的关键词
// 比从头开始挖空快很多，因为已有基础结果

const buildReviewSystemPrompt = () => {
  const mapType = classifyMindMap(getMindMapRef()?.renderer?.root || getMindMapRef()?.getData?.() || '')
  return `你是一个思维导图挖空质量审查助手。以下节点已经做了初步挖空（由本地规则生成），请你：
1. 审查已有挖空的质量：判断每个挖空是否合理、是否是关键考点
2. 补充遗漏：如果发现有重要关键词漏掉了，请补充进去
3. 移除不合理的：如果某个挖空太简单、不是考点、或挖了之后完全无法推断，请移除

${mindMapTypePrompt(mapType, 'cloze')}

## 审查标准
- **保留（keep）**：是关键考点/核心术语/重要结论，且剩余文字+上下文能推断出来 → 保留
- **移除（remove）**：不是考点、太简单、挖了之后无法推断、或只是普通修饰词 → 移除
- **补充（add）**：原文中有重要关键词被漏掉了 → 补充进去

## 补充挖空的原则（宁缺毋滥）
- 只补充真正的核心考点：关键术语、重要概念、因果结论、核心数字
- 同一节点补充不超过 2 个
- 补充的词必须是原文中完全匹配的片段
- 不能把整句核心词都挖光，至少保留一个可推断的线索

## 上下文字段说明
每个节点附带：
- text：节点原文
- parentText：父节点文本
- siblingsTexts：同级节点文本列表
- currentClozes：当前已有的挖空词列表

请结合上下文判断：优先保留/补充"和同级节点有区分度的关键词"。

## 返回格式（必须严格遵守）
输出合法 JSON，可以包裹在 \`\`\`json 代码块中；禁止尾随逗号、注释或 NaN。

{"reviews": [
  {
    "uid": "节点uid",
    "keeps": ["保留的挖空词1", "保留的挖空词2"],
    "removes": ["要移除的挖空词"],
    "adds": ["要补充的新挖空词"]
  }
]}

要求：
1. uid 必须与输入完全一致
2. 所有挖空词必须与原文完全匹配
3. 没有变动的节点也要返回（keeps填现有值，removes和adds为空数组）
4. 如果觉得当前挖空已经很好了，keeps就是全部现有值，removes和adds为空
`
}

const buildReviewUserMessage = (items) => {
  return `请审查以下节点的挖空质量，并补充遗漏的重要关键词：

${JSON.stringify(items)}

请严格按照系统提示中的格式返回 JSON。`
}

const parseReviewResponse = (content) => {
  if (!content || typeof content !== 'string') return []
  let text = content.trim()

  // 移除 think 标签
  const thinkRegex = new RegExp(THINK_OPEN + '[\\s\\S]*?' + THINK_CLOSE, 'gi')
  text = text.replace(thinkRegex, '')
  if (text.includes(THINK_OPEN)) {
    const afterThink = text.split(THINK_OPEN)
    const afterContent = afterThink[afterThink.length - 1] || ''
    const jsonStart = afterContent.search(/[{\[]/)
    if (jsonStart >= 0) text = afterContent.substring(jsonStart)
  }

  // 移除代码块标记
  text = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim()

  const extractReviews = (parsed) => {
    if (parsed && Array.isArray(parsed.reviews)) return parsed.reviews
    if (Array.isArray(parsed)) return parsed
    return []
  }

  try {
    const parsed = JSON.parse(text)
    return extractReviews(parsed)
  } catch (e) {
    const m = text.match(/\{[\s\S]*\}/g)
    if (m) {
      for (let i = m.length - 1; i >= 0; i--) {
        try {
          const reviews = extractReviews(JSON.parse(m[i]))
          if (reviews.length > 0) return reviews
        } catch (e2) {}
      }
    }
    console.error('[AI挖空-审查] 解析响应失败:', e, '清理后文本:', text.substring(0, 500))
    return []
  }
}

const callAiForReview = async (items, timeoutMs = 60000) => {
  const choice = await Promise.race([
    aiService.chat(buildReviewUserMessage(items), buildReviewSystemPrompt(), null, { thinking: false }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('AI审查超时')), timeoutMs))
  ])
  const content = choice?.message?.content || ''
  return parseReviewResponse(content)
}

// 判断一个节点的兜底挖空是否"有把握"（有把握的可以跳过AI审查）
const isConfidentFallback = (node, clozes) => {
  const text = extractPlainText(node.text || '').trim()
  const clozeCount = Array.isArray(clozes) ? clozes.length : 0

  // 情况1：短节点（≤8字）整词挖空 → 非常有把握
  if (text.length <= 8 && clozeCount === 1 && clozes[0] === text) {
    return true
  }

  // 情况2：挖出 3 个及以上挖空 → 说明结构模式匹配得不错
  if (clozeCount >= 3) {
    return true
  }

  // 情况3：文本很短（≤10字）且有 2 个挖空 → 也还可以
  if (text.length <= 10 && clozeCount >= 2) {
    return true
  }

  return false
}

// 批量 AI 审查+补充（选择性审查 + 并行执行）
const callAiForReviewBatched = async (nodes, clozeList, onProgress, onBatchReviewed) => {
  if (!nodes || nodes.length === 0) return { reviewed: 0, added: 0, removed: 0 }

  // 建立 uid -> 挖空信息 的映射
  const clozeMap = {}
  clozeList.forEach(item => {
    if (item && item.uid) clozeMap[item.uid] = item
  })

  // ===== 选择性审查：只挑"兜底没把握"的节点给 AI 审 =====
  const itemsToReview = []
  let skipped = 0
  nodes.forEach(node => {
    const clozeItem = clozeMap[node.uid]
    const clozes = clozeItem && Array.isArray(clozeItem.clozes) ? clozeItem.clozes : []

    // 如果兜底很有把握，就跳过AI审查
    if (isConfidentFallback(node, clozes)) {
      skipped++
      return
    }

    itemsToReview.push({
      uid: node.uid,
      text: node.text,
      parentText: node.parentText,
      siblingsTexts: node.siblingsTexts,
      currentClozes: clozes
    })
  })

  console.log(`[AI挖空-审查] 共 ${nodes.length} 个节点，跳过 ${skipped} 个（兜底有把握），待审查 ${itemsToReview.length} 个`)

  if (itemsToReview.length === 0) return { reviewed: 0, added: 0, removed: 0 }

  const BATCH_SIZE = 20
  const MAX_CONCURRENCY = 3 // 3路并行

  // 分批
  const batches = []
  for (let i = 0; i < itemsToReview.length; i += BATCH_SIZE) {
    batches.push(itemsToReview.slice(i, i + BATCH_SIZE))
  }

  const totalBatches = batches.length
  let completedBatches = 0
  let reviewed = 0
  let added = 0
  let removed = 0

  const report = () => {
    if (onProgress) {
      onProgress({
        done: completedBatches,
        total: totalBatches,
        percent: Math.min(100, Math.round((completedBatches / totalBatches) * 100)),
        phase: 'review'
      })
    }
  }

  // 处理单个批次
  const processBatch = async (batch) => {
    if (aiService.isAborted()) {
      const err = new Error('已停止')
      err.aborted = true
      throw err
    }

    try {
      const reviews = await callAiForReview(batch)
      // 建立 uid -> 原文 的映射
      const textMap = {}
      batch.forEach(item => {
        if (item && item.uid) textMap[item.uid] = item.text || ''
      })

      let batchReviewed = 0
      let batchAdded = 0
      let batchRemoved = 0

      if (Array.isArray(reviews) && reviews.length > 0) {
        reviews.forEach(review => {
          const uid = review.uid
          if (!uid || !clozeMap[uid]) return
          const nodeText = textMap[uid] || ''

          const oldClozes = clozeMap[uid].clozes || []
          const keeps = Array.isArray(review.keeps) ? review.keeps : []
          const adds = Array.isArray(review.adds) ? review.adds : []
          // 过滤：只保留在原文中确实存在的挖空词
          const newClozes = [...new Set([...keeps, ...adds])].filter(c => c && nodeText && nodeText.includes(c))

          if (newClozes.length > 0) {
            const addedCount = adds.filter(a => !oldClozes.includes(a) && nodeText.includes(a)).length
            const removedCount = oldClozes.filter(c => !newClozes.includes(c)).length
            batchAdded += addedCount
            batchRemoved += removedCount
            batchReviewed++

            clozeMap[uid].clozes = newClozes

            if (onBatchReviewed) {
              onBatchReviewed(clozeMap[uid])
            }
          }
        })
      }

      return { reviewed: batchReviewed, added: batchAdded, removed: batchRemoved }
    } catch (e) {
      if (e.aborted) throw e
      console.warn('[AI挖空-审查] 批次审查失败，跳过该批次:', e.message)
      return { reviewed: 0, added: 0, removed: 0 }
    }
  }

  // ===== 并发控制：最多 MAX_CONCURRENCY 路并行 =====
  let currentIndex = 0
  const workers = []

  const worker = async () => {
    while (currentIndex < batches.length) {
      const idx = currentIndex++
      const result = await processBatch(batches[idx])
      reviewed += result.reviewed
      added += result.added
      removed += result.removed
      completedBatches++
      report()
    }
  }

  // 启动并发 worker
  const concurrency = Math.min(MAX_CONCURRENCY, batches.length)
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker())
  }

  await Promise.all(workers)

  return { reviewed, added, removed, skipped }
}

/* ==================== 两阶段挖空配置 ==================== */

const TWO_PHASE_THRESHOLD = 100 // 节点数 ≥ 此值时启用两阶段挖空

/* ==================== 上下文一致性复查 ==================== */

const buildVerifySystemPrompt = () => {
  return `你是一个挖空质量校验助手。以下思维导图节点已经做了挖空。请判断每个挖空是否都能从"剩余文字 + 上下文（父节点/同级节点）"推断出来，用于辅助背诵。

## 判断标准
- keep：剩余文字和上下文足以推断出该挖空内容，保留
- hint：推断有一定难度，但给一个简短提示（首字/拼音/字数/类别）后可以推出，保留挖空并附提示
- remove：剩余文字和上下文完全无法推断（挖掉了整句唯一线索），应移除该挖空（撤销挖空、保留原文）

## 返回格式（合法 JSON，可以包裹在 \`\`\`json 代码块中；禁止尾随逗号、注释或 NaN）
{"checks": [{"uid": "节点uid", "cloze": "被挖空的关键词", "action": "keep"|"hint"|"remove", "hint": "提示文字（action为hint时必填，action非hint时省略）"}]}

要求：
1. cloze 必须与输入的 clozes 中的某个关键词完全一致
2. 只针对"无法推断"的挖空给 hint 或 remove，其余都 keep
3. uid 与输入完全一致`
}

const buildVerifyUserMessage = (items) => {
  return `请校验以下节点的挖空质量（每个节点附带 text 原文、parentText 父节点、siblingsTexts 同级节点、clozes 被挖空关键词）：

${JSON.stringify(items)}`
}

const parseVerifyResponse = (content) => {
  if (!content || typeof content !== 'string') return []
  let text = content.trim()
  const thinkRegex = new RegExp(String.fromCharCode(60) + 'think' + String.fromCharCode(62) + '[\\s\\S]*?' + String.fromCharCode(60) + '/think' + String.fromCharCode(62), 'gi')
  text = text.replace(thinkRegex, '')
  text = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim()
  const extractChecks = (parsed) => {
    if (parsed && Array.isArray(parsed.checks)) return parsed.checks
    if (Array.isArray(parsed)) return parsed
    return []
  }
  try {
    return extractChecks(JSON.parse(text))
  } catch (e) {
    const m = text.match(/\{[\s\S]*\}/g)
    if (m) {
      for (let i = m.length - 1; i >= 0; i--) {
        try {
          const checks = extractChecks(JSON.parse(m[i]))
          if (checks.length > 0) return checks
        } catch (e2) {}
      }
    }
    return []
  }
}

// 移除单个关键词的挖空标记（展开对应 span，保留内容）
const removeClozeForKeyword = (node, keyword) => {
  if (!keyword || !node) return false
  let text = (typeof node.getData === 'function' ? node.getData('text') : node.text) || ''
  if (typeof text !== 'string' || !text.includes('smm-cloze')) return false
  const div = document.createElement('div')
  div.innerHTML = text
  let changed = false
  div.querySelectorAll('.smm-cloze').forEach(span => {
    if (span.textContent === keyword) {
      const parent = span.parentNode
      while (span.firstChild) parent.insertBefore(span.firstChild, span)
      parent.removeChild(span)
      changed = true
    }
  })
  if (changed) {
    if (typeof node.setText === 'function') node.setText(div.innerHTML, true)
    else if (typeof node.setData === 'function') node.setData({ text: div.innerHTML, richText: true })
  }
  return changed
}

// 给单个关键词的挖空附加提示（title 悬浮提示 + data-hint）
const applyClozeHint = (node, keyword, hint) => {
  if (!keyword || !hint || !node) return false
  let text = (typeof node.getData === 'function' ? node.getData('text') : node.text) || ''
  if (typeof text !== 'string' || !text.includes('smm-cloze')) return false
  const div = document.createElement('div')
  div.innerHTML = text
  let changed = false
  div.querySelectorAll('.smm-cloze').forEach(span => {
    if (span.textContent === keyword) {
      span.setAttribute('data-hint', String(hint))
      span.setAttribute('title', String(hint))
      changed = true
    }
  })
  if (changed) {
    if (typeof node.setText === 'function') node.setText(div.innerHTML, true)
    else if (typeof node.setData === 'function') node.setData({ text: div.innerHTML, richText: true })
  }
  return changed
}

const callAiForVerify = async (items) => {
  const choice = await Promise.race([
    aiService.chat(buildVerifyUserMessage(items), buildVerifySystemPrompt(), null, { thinking: false }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('一致性复查超时')), 60000))
  ])
  const content = choice?.message?.content || ''
  return parseVerifyResponse(content)
}

// 上下文一致性复查：校验每个挖空是否可由上下文推出，推不出的补提示或移除
const verifyClozeConsistency = async (clozeList, onProgress) => {
  if (aiService.isAborted()) return 0
  const mindMapRef = getMindMapRef()
  if (!mindMapRef || !mindMapRef.renderer || !mindMapRef.renderer.root) return 0
  const root = mindMapRef.renderer.root
  const nodeMap = {}
  const walk = (node) => {
    const uid = getNodeUid(node)
    if (uid) nodeMap[uid] = node
    if (node.children) node.children.forEach(walk)
  }
  walk(root)

  const items = []
  for (const item of clozeList) {
    if (!item || !item.uid || !Array.isArray(item.clozes) || item.clozes.length === 0) continue
    const node = nodeMap[item.uid]
    if (!node) continue
    const info = buildNodeInfo(node, 0)
    if (!info) continue
    items.push({
      uid: item.uid,
      text: info.text,
      parentText: info.parentText,
      siblingsTexts: info.siblingsTexts,
      clozes: item.clozes
    })
  }
  if (items.length === 0) return 0

  if (onProgress) onProgress('正在校验挖空是否可由上下文推出…')

  let checks = []
  try {
    checks = await callAiForVerify(items)
  } catch (e) {
    console.error('[AI挖空] 一致性复查失败（不影响已应用的挖空）:', e)
    return 0
  }
  if (aiService.isAborted() || !Array.isArray(checks) || checks.length === 0) return 0

  let adjusted = 0
  for (const check of checks) {
    const node = nodeMap[check.uid]
    if (!node || !check.cloze) continue
    if (check.action === 'remove') {
      if (removeClozeForKeyword(node, check.cloze)) adjusted++
    } else if (check.action === 'hint') {
      if (applyClozeHint(node, check.cloze, check.hint)) adjusted++
    }
  }
  if (adjusted > 0) {
    mindMapRef.render()
    setTimeout(() => applyClozeStyles(), 100)
    setTimeout(() => applyClozeStyles(), 300)
  }
  return adjusted
}

/* ==================== 核心执行 ==================== */

const doSmartCloze = async (nodes, mode, onProgress) => {
  if (!nodes || nodes.length === 0) {
    throw new Error('没有可挖空的节点')
  }

  // 增量应用：每批结果一到就写入节点文本；失败/停止时已完成部分保留
  let totalApplied = 0
  let aiApplied = 0
  let fallbackApplied = 0
  let reviewAdded = 0
  let reviewRemoved = 0
  let isTwoPhase = false

  const applyBatch = (batchList, isFallback = false) => {
    if (Array.isArray(batchList) && batchList.length) {
      const n = applyClozeList(batchList, true)
      totalApplied += n
      if (isFallback) fallbackApplied += n
      else aiApplied += n
    }
  }

  // 审查阶段的单节点更新
  const applyReviewedItem = (item) => {
    if (!item || !item.uid) return
    // 先清除该节点已有的挖空，再重新应用
    const mindMapRef = getMindMapRef()
    if (!mindMapRef || !mindMapRef.renderer) return
    const root = mindMapRef.renderer.root
    const findNode = (node) => {
      if (getNodeUid(node) === item.uid) return node
      if (node.children) {
        for (const child of node.children) {
          const found = findNode(child)
          if (found) return found
        }
      }
      return null
    }
    const node = findNode(root)
    if (node) {
      clearNodeCloze(node)
      const count = applyClozeToNode(node, item)
      totalApplied = totalApplied + count // 粗略更新，实际以最终渲染为准
    }
  }

  // 失败/停止前把已增量应用的部分渲染出来，避免"数据已写入但画布看不到"
  const flushRender = () => {
    if (totalApplied > 0) {
      const mm = getMindMapRef()
      if (mm && typeof mm.render === 'function') mm.render()
      setTimeout(() => applyClozeStyles(), 50)
      setTimeout(() => applyClozeStyles(), 100)
      setTimeout(() => applyClozeStyles(), 300)
    }
  }

  let clozeList = []

  // 判断是否启用两阶段模式：节点数 ≥ 阈值
  const useTwoPhase = nodes.length >= TWO_PHASE_THRESHOLD

  if (useTwoPhase) {
    isTwoPhase = true
    console.log(`[AI挖空] 节点数 ${nodes.length} ≥ ${TWO_PHASE_THRESHOLD}，启用两阶段挖空`)

    // ========== 第一阶段：增强版兜底快速挖空 ==========
    if (onProgress) {
      onProgress('正在快速分析节点并生成初步挖空…')
    }

    try {
      clozeList = buildEnhancedFallbackClozeList(nodes)
      // 标记这是兜底生成的
      clozeList.usedFallback = true
      // 立即应用到导图
      applyBatch(clozeList, true)
      flushRender()

      if (onProgress) {
        onProgress({
          percent: 100,
          phase: 'fallback_done',
          message: '快速挖空完成，正在进行AI精修…'
        })
      }
    } catch (e) {
      console.error('[AI挖空] 快速兜底失败，回退到纯AI模式:', e)
      // 兜底失败就走正常的 AI 模式
    }
  }

  // ========== 第二阶段：AI 处理 ==========
  // 情况1：两阶段模式 → AI 做审查+补充
  // 情况2：普通模式 → AI 从头挖空

  if (!useTwoPhase || (clozeList.length > 0 && !aiService.isAborted())) {
    try {
      if (useTwoPhase && clozeList.length > 0) {
        // 两阶段模式：AI 审查+补充
        if (onProgress) {
          onProgress('AI正在审查并优化挖空质量…')
        }
        const reviewResult = await callAiForReviewBatched(
          nodes,
          clozeList,
          onProgress,
          applyReviewedItem
        )
        reviewAdded = reviewResult.added
        reviewRemoved = reviewResult.removed
        aiApplied = reviewResult.reviewed // 粗略统计被AI审查过的节点数
      } else {
        // 普通模式：AI 从头挖空
        clozeList = await callAiForClozeBatched(nodes, mode, onProgress, applyBatch)
      }
    } catch (e) {
      flushRender()
      const msg = e.message || ''
      if (msg.includes('已停止') && e.aborted) {
        // 用户停止：保留已完成的部分
        flushRender()
        if (totalApplied === 0) {
          const err = new Error('已停止')
          err.aborted = true
          throw err
        }
        // 有已完成内容就继续往下走，返回已有结果
      } else if (msg.includes('Failed to fetch')) {
        // 两阶段模式下网络错误就保留兜底结果
        if (useTwoPhase && totalApplied > 0) {
          console.warn('[AI挖空] AI阶段网络错误，保留快速兜底结果')
        } else {
          throw new Error('AI接口请求失败：网络错误，请检查网络连接和AI配置')
        }
      } else if (!useTwoPhase) {
        throw e
      }
      // 两阶段模式下AI出错就保留兜底结果，不抛错
    }
  }

  const usedFallback = !!clozeList.usedFallback
  if (usedFallback && onProgress && !useTwoPhase) {
    onProgress({ percent: 100, fallback: true })
  }

  if (clozeList.length === 0) {
    // 用户已停止：不再降级重试
    if (aiService.isAborted()) {
      flushRender()
      const err = new Error('已停止')
      err.aborted = true
      throw err
    }
    // 智能挖空失败，自动降级到激进模式（已增量应用的部分保留）
    if (mode !== 'aggressive' && !clozeList.usedFallback && !useTwoPhase) {
      console.log('[AI挖空] 智能挖空未找到关键词，自动降级到激进模式')
      try {
        clozeList = await callAiForClozeBatched(nodes, 'aggressive', onProgress, applyBatch)
      } catch (e2) {
        throw new Error('AI未能从当前内容中找到适合挖空的关键词')
      }
    }
    if (clozeList.length === 0 && totalApplied === 0) {
      throw new Error('AI未能从当前内容中找到适合挖空的关键词，请检查或更换节点内容后重试')
    }
  }

  // 增量阶段已写入节点文本，这里统一刷新画布与样式一次
  flushRender()

  if (totalApplied === 0) {
    throw new Error('AI 返回了挖空结果，但没有一个片段能在节点原文中匹配并成功应用；请缩短节点文本或换内容重试')
  }

  // 上下文一致性复查：两阶段模式下跳过（审查阶段已经做过质量检查了）
  if (!useTwoPhase) {
    try {
      await verifyClozeConsistency(clozeList, onProgress)
    } catch (e) {
      console.error('[AI挖空] 一致性复查失败:', e)
    }
  }

  return {
    count: totalApplied,
    aiCount: aiApplied,
    fallbackCount: fallbackApplied,
    reviewAdded,
    reviewRemoved,
    isTwoPhase
  }
}


/**
 * 对指定节点列表进行 AI 智能挖空
 * @param {Array} nodeList - 思维导图节点对象数组
 * @param {string} mode - 'smart' | 'aggressive'
 * @param {Function} onProgress - 进度回调
 * @returns {Promise<number>} 挖空数量
 */
export const smartClozeNodes = async (nodeList, mode = 'smart', onProgress) => {
  const mindMapRef = getMindMapRef()
  if (!mindMapRef || !mindMapRef.renderer) {
    throw new Error('思维导图未初始化')
  }
  if (!nodeList || nodeList.length === 0) {
    throw new Error('未选择任何节点')
  }
  const nodes = extractNodesFromList(nodeList)
  if (nodes.length === 0) {
    throw new Error('选中的节点没有可挖空的文本内容')
  }
  return doSmartCloze(nodes, mode, onProgress)
}

/**
 * 对整个思维导图进行 AI 智能挖空
 * 有选中节点时优先挖选中节点，否则挖整图
 */
export const smartCloze = async (mode = 'smart', onProgress) => {
  const mindMapRef = getMindMapRef()
  if (!mindMapRef || !mindMapRef.renderer) {
    throw new Error('思维导图未初始化')
  }

  const activeNodes = mindMapRef.renderer.activeNodeList || []
  if (activeNodes.length > 0) {
    const nodes = extractNodesFromList(activeNodes)
    if (nodes.length > 0) {
      return doSmartCloze(nodes, mode, onProgress)
    }
  }

  return smartClozeFullMap(mode, onProgress)
}

/**
 * 强制对整张思维导图（所有节点）进行 AI 智能挖空，忽略当前选中状态
 */
export const smartClozeFullMap = async (mode = 'smart', onProgress) => {
  const mindMapRef = getMindMapRef()
  if (!mindMapRef || !mindMapRef.renderer) {
    throw new Error('思维导图未初始化')
  }

  const root = mindMapRef.renderer.root
  if (!root) throw new Error('思维导图为空')

  const nodes = []
  const walk = (node, level) => {
    // 仅跳过根节点（level 0）；第一层及以下都参与全文挖空，
    // 章节/目录类标题由 isHeadingLike 的文本模式判定跳过
    if (level >= 1) {
      const info = buildNodeInfo(node, level)
      if (info && info.text && !isHeadingLike(info.text)) {
        nodes.push(info)
      }
    }
    if (node.children) {
      node.children.forEach(child => walk(child, level + 1))
    }
  }
  walk(root, 0)

  if (nodes.length === 0) throw new Error('思维导图为空，无法挖空')
  return doSmartCloze(nodes, mode, onProgress)
}
