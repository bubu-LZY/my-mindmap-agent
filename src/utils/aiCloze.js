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
import { applyClozeStyles, getMindMapRef, removeClozeSpansBalanced } from './cloze'

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

// 构建带上下文的节点信息：父节点 / 子节点 / 同级节点，供 AI 理解上下文做更准确的挖空
const buildNodeInfo = (node, level) => {
  const text = getNodeText(node)
  if (!text) return null
  const parentText = getNodeText(node.parent)
  const childrenTexts = (node.children || []).map(getNodeText).filter(Boolean).slice(0, 8)
  let siblingsTexts = []
  if (node.parent && Array.isArray(node.parent.children)) {
    siblingsTexts = node.parent.children
      .filter(s => s && s.uid !== node.uid)
      .map(getNodeText)
      .filter(Boolean)
      .slice(0, 8)
  }
  return {
    uid: node.uid,
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
      levelMap[node.uid] = level
      if (node.children) {
        node.children.forEach(child => walkLevel(child, level + 1))
      }
    }
    walkLevel(mindMapRef.renderer.root, 0)
  }
  return nodeList
    .map(node => {
      const info = buildNodeInfo(node, levelMap[node.uid] !== undefined ? levelMap[node.uid] : 1)
      if (!info || !info.text || isHeadingLike(info.text)) return null
      return info
    })
    .filter(Boolean)
}

/* ==================== System Prompts ==================== */

const buildSmartSystemPrompt = () => {
  return `你是一个思维导图智能挖空助手。请根据思维导图节点内容，智能选择适合挖空（隐藏）的关键词，用于辅助记忆和复习。

## 核心原则（质量优先，宁缺毋滥）
只挖"考点/得分点/易错点"——忘了它就会答错、答不全或混淆的关键词（核心术语、关键数字、时间、地点、人名、因果结论、限定词如"唯一/最/基本/首要/核心/前提"）。不挖普通名词、铺垫性描述、举例、修饰词。没有明确重点就返回空 clozes。

## 上下文字段说明（务必结合上下文准确挖空）
输入中每个节点附带以下字段：
- text：节点自身文本
- parentText：父节点文本（主题上下文）
- childrenTexts：子节点文本列表
- siblingsTexts：同级节点文本列表

请结合 parentText 与 siblingsTexts 判断该节点承载的"区分性考点"：优先挖空能把它与同级节点区分开、且属于得分点的关键词；父节点已给出的词、或无法由上下文推断的通用词不挖。

## 挖空规则
1. 只挖空考点/重点内容词：核心术语、专业概念、关键数字、重要结论、人名、地名、日期；不挖一般性名词、铺垫词、修饰词
2. 不挖空功能词：的、了、是、在、和、与、或、等语法词
3. 根节点（level 为 0）不挖空
4. 挖空的文本必须与节点原文完全匹配，包括标点符号
5. 跳过文本过短（少于 2 个字）的节点
6. 同一个关键词在同一个节点中只出现一次
7. 章节名、目录名、概括性大标题（如“第一章”“第一节”“导论”“目录”“知识框架”）不挖空

## 保留可推测性规则（最重要）
1. "标签：值"格式，只挖空"值"部分，保留"标签"作为提示
2. 一句话中的核心语义成分不能全部挖空，至少保留一个
3. 如果两个词在语义上互补或并列，只挖空其中一个
4. 挖空后，用户读到剩余文字应该能大致猜出被隐藏的内容
5. 如果挖空某个词后会导致整句话失去理解线索，则不要挖空该词

## 区分性挖空规则（并列短类别，重点）
- 父节点是"分类/总结词"（如"特点""表现""原因""类型""原则""方法"），子节点是并列的多个短类别（如"客观性""普遍性""多样性""条件性"）时，这些类别彼此只有关键词不同 → 必须挖空这些不同的关键词（区分点）。
- 子节点很短（≤6 字）且整体就是一个完整关键词时，整词挖空，不保留残余文字（例外于"保留多于挖空"）。

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
返回 JSON 对象：

{"results": [{"uid": "节点uid", "clozes": ["挖空片段1"]}, {"uid": "另一个uid", "clozes": ["片段1", "片段2"]}, {"uid": "需改写的uid", "rewrite": "改写后的文本", "clozes": ["改写后要挖空的片段"]}]}

要求：
1. 必须是合法 JSON，外层用 {"results": [...]} 包裹
2. 不要包含解释文字、markdown 标记或代码块标记
3. uid 必须与输入完全一致
4. clozes 中每个文本片段必须与节点原文（或改写后文本）完全匹配
5. 如果没有需要挖空的节点，返回 {"results": []}`
}

const buildAggressiveSystemPrompt = () => {
  return `你是一个思维导图激进挖空助手。请根据思维导图节点内容，尽可能多地选择关键词进行挖空，用于高强度记忆测试。优先挖重点（考点/术语/数字/因果结论），其次才挖一般内容词，不要为了数量挖无关紧要的词。

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
返回 JSON 对象：

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

const applyClozeToNode = (node, item) => {
  const clozes = item && Array.isArray(item.clozes) ? item.clozes : []
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
    if (clozeMap[node.uid]) {
      appliedCount += applyClozeToNode(node, clozeMap[node.uid])
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

/* ==================== 本地降级挖空 ==================== */

const CLOZE_STOP_WORDS = new Set([
  '的', '了', '是', '在', '和', '与', '或', '及', '等', '有', '为', '被',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'by', 'as', 'at', 'from'
])

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

const buildFallbackClozeList = (nodes) => {
  if (!Array.isArray(nodes) || nodes.length === 0) return []
  const list = []
  nodes.forEach(node => {
    if (!node || !node.uid) return
    const text = extractPlainText(node.text || '').trim()
    if (text.length < 2) return
    if (isHeadingLike(text)) return
    const cloze = pickFallbackCloze(text)
    if (cloze && cloze !== text) {
      list.push({ uid: node.uid, clozes: [cloze] })
    }
  })
  return list
}


/* ==================== 调用 AI ==================== */

const BATCH_REQUEST_TIMEOUT = 60000

const callAiForCloze = async (nodes, mode, timeoutMs = BATCH_REQUEST_TIMEOUT) => {
  const systemPrompt = mode === 'aggressive' ? buildAggressiveSystemPrompt() : buildSmartSystemPrompt()
  const userMessage = buildUserMessage(nodes, mode)
  // 单批次超时保护：某个请求挂起时不能让整批 Promise.all 一直等
  const choice = await Promise.race([
    aiService.chat(userMessage, systemPrompt),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`AI 挖空请求超时（${timeoutMs / 1000} 秒）`)), timeoutMs))
  ])
  const content = choice?.message?.content || ''
  return parseAiResponse(content)
}

/* ==================== 批量并行处理 ==================== */

const BATCH_SIZE = 10
const MAX_CONCURRENCY = 5
const MIN_CONCURRENCY = 1

const callAiForClozeBatched = async (nodes, mode, onProgress, onBatchResult) => {
  const resultList = []
  let usedFallback = false

  if (nodes.length <= BATCH_SIZE) {
    try {
      const result = await callAiForCloze(nodes, mode)
      if (onBatchResult) onBatchResult(result)
      resultList.push(...(result || []))
    } catch (e) {
      usedFallback = true
      const fallback = buildFallbackClozeList(nodes)
      if (onBatchResult) onBatchResult(fallback)
      resultList.push(...fallback)
    }
    resultList.usedFallback = usedFallback
    return resultList
  }

  const batches = []
  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    batches.push(nodes.slice(i, i + BATCH_SIZE))
  }

  // 全文挖空场景：每批 10 个节点，并发上限 5 路，避免打爆 API 并发上限
  const initialConcurrency = Math.min(Math.max(Math.ceil(batches.length / 2), 3), MAX_CONCURRENCY)
  let currentConcurrency = initialConcurrency
  let consecutiveErrors = 0
  const fallbackNodes = []
  let useFallbackForRemaining = false
  let completedCount = 0
  let batchIdx = 0

  const report = () => {
    if (onProgress) {
      onProgress({
        done: completedCount,
        total: batches.length,
        percent: Math.round((completedCount / batches.length) * 100)
      })
    }
  }
  // 每个批次结果即时应用（写入节点文本），失败/停止时已完成的挖空不会丢
  const accept = (batchResult) => {
    if (Array.isArray(batchResult) && batchResult.length) {
      resultList.push(...batchResult)
      if (onBatchResult) onBatchResult(batchResult)
    }
  }

  while (batchIdx < batches.length) {
    // 用户已点击停止：立即终止批量流程
    if (aiService.isAborted()) {
      const err = new Error('已停止')
      err.aborted = true
      throw err
    }
    const chunk = batches.slice(batchIdx, batchIdx + currentConcurrency)
    const chunkPromises = chunk.map(batch =>
      callAiForCloze(batch, mode)
        .then(r => ({ success: true, data: r }))
        .catch(e => ({ success: false, error: e, data: [] }))
    )
    const chunkResults = await Promise.all(chunkPromises)

    let hasError = false
    let hasRateLimit = false
    let hasTimeout = false
    const failedBatches = []

    chunkResults.forEach((r, i) => {
      if (r.success) {
        accept(r.data)
        } else {
        hasError = true
        const errMsg = (r.error && r.error.message) || ''
        if (errMsg.includes('429') || errMsg.toLowerCase().includes('rate') || errMsg.toLowerCase().includes('too many')) {
          hasRateLimit = true
        }
        if (errMsg.includes('超时') || errMsg.toLowerCase().includes('timeout')) {
          hasTimeout = true
        }
        failedBatches.push(chunk[i])
      }
      completedCount++
      report()
    })

    // 失败批次重试（重试结果同样即时应用；单个重试失败则进入本地降级）
    const retryFailed = async (failed) => {
      for (const fb of failed) {
        if (aiService.isAborted()) break
        try {
          const retryResult = await callAiForCloze(fb, mode, 20000)
          accept(retryResult)
        } catch (e2) {
          console.error('[AI挖空] 重试失败:', e2)
          // 连续失败时持续降级，避免继续用高并发反复冲击服务端
          currentConcurrency = Math.max(Math.floor(currentConcurrency / 2), MIN_CONCURRENCY)
          fallbackNodes.push(...fb)
          usedFallback = true
        }
      }
    }

    if (hasTimeout) {
      useFallbackForRemaining = true
      failedBatches.forEach(fb => fallbackNodes.push(...fb))
      usedFallback = true
      break
    } else if (hasRateLimit) {
      currentConcurrency = Math.max(Math.floor(currentConcurrency / 2), MIN_CONCURRENCY)
      consecutiveErrors = 0
      await new Promise(resolve => setTimeout(resolve, 1000))
      await retryFailed(failedBatches)
    } else if (hasError) {
      consecutiveErrors++
      if (consecutiveErrors >= 2) {
        currentConcurrency = Math.max(Math.floor(currentConcurrency / 2), MIN_CONCURRENCY)
        consecutiveErrors = 0
      }
      await retryFailed(failedBatches)
    } else {
      consecutiveErrors = 0
      if (currentConcurrency < initialConcurrency) {
        currentConcurrency = Math.min(currentConcurrency + 1, initialConcurrency)
      }
    }

    batchIdx += chunk.length
  }

  if (useFallbackForRemaining) {
    for (let i = batchIdx; i < batches.length; i++) {
      fallbackNodes.push(...batches[i])
    }
  }

  if (fallbackNodes.length > 0) {
    usedFallback = true
    const fallback = buildFallbackClozeList(fallbackNodes)
    accept(fallback)
    if (onProgress) {
      onProgress({
        done: batches.length,
        total: batches.length,
        percent: 100,
        fallback: true
      })
    }
  }

  resultList.usedFallback = usedFallback
  return resultList
}

/* ==================== 上下文一致性复查 ==================== */

const buildVerifySystemPrompt = () => {
  return `你是一个挖空质量校验助手。以下思维导图节点已经做了挖空。请判断每个挖空是否都能从"剩余文字 + 上下文（父节点/同级节点）"推断出来，用于辅助背诵。

## 判断标准
- keep：剩余文字和上下文足以推断出该挖空内容，保留
- hint：推断有一定难度，但给一个简短提示（首字/拼音/字数/类别）后可以推出，保留挖空并附提示
- remove：剩余文字和上下文完全无法推断（挖掉了整句唯一线索），应移除该挖空（撤销挖空、保留原文）

## 返回格式（严格 JSON，不要解释、不要代码块）
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
    aiService.chat(buildVerifyUserMessage(items), buildVerifySystemPrompt()),
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
    nodeMap[node.uid] = node
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
  const applyBatch = (batchList) => {
    if (Array.isArray(batchList) && batchList.length) {
      totalApplied += applyClozeList(batchList, true)
    }
  }
  // 失败/停止前把已增量应用的部分渲染出来，避免"数据已写入但画布看不到"
  const flushRender = () => {
    if (totalApplied > 0) {
      const mm = getMindMapRef()
      if (mm && typeof mm.render === 'function') mm.render()
      setTimeout(() => applyClozeStyles(), 100)
      setTimeout(() => applyClozeStyles(), 300)
    }
  }

  let clozeList = []
  try {
    clozeList = await callAiForClozeBatched(nodes, mode, onProgress, applyBatch)
  } catch (e) {
    flushRender()
    const msg = e.message || ''
    if (msg.includes('Failed to fetch')) {
      throw new Error('AI接口请求失败：网络错误，请检查网络连接和AI配置')
    }
    throw e
  }

  const usedFallback = !!clozeList.usedFallback
  if (usedFallback && onProgress) {
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
    if (mode !== 'aggressive' && !clozeList.usedFallback) {
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

  // 上下文一致性复查：校验每个挖空是否可由上下文推出，推不出的补提示或移除
  try {
    await verifyClozeConsistency(clozeList, onProgress)
  } catch (e) {
    console.error('[AI挖空] 一致性复查失败:', e)
  }

  return totalApplied
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
