/**
 * <think> 思考过程过滤 & <ask> 提问块过滤 & <plan> 计划块过滤
 * - MiniMax 等推理模型会在 content 中输出 <think>...</think> 思考过程，前端不展示思考内容
 * - AI 提问时输出 <ask>{"type":"single","options":[...],"question":"..."}</ask> 块，前端仅渲染为按钮，不展示原始 JSON
 * - AI 输出 <plan>...</plan> 计划块，折叠展示，不混在正文中
 * 过滤只作用于文本 content，tool_calls 是独立字段，不受影响。
 */

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'
const ASK_OPEN = '<ask>'
const ASK_CLOSE = '</ask>'
const PLAN_OPEN = '<plan>'
const PLAN_CLOSE = '</plan>'

// 返回 s 末尾最长可能是 tag 前缀的长度（如 s="a<th"，tag="<think>" → 3）
function partialTagLength(s, tag) {
  const max = Math.min(s.length, tag.length - 1)
  for (let len = max; len > 0; len--) {
    if (s.endsWith(tag.slice(0, len))) return len
  }
  return 0
}

// 通用：一次性剥离指定标签的全部块
function stripBlocksByTag(text, openTag, closeTag) {
  if (typeof text !== 'string' || !text.includes('<')) return text
  let out = text
  const openIdx = out.lastIndexOf(openTag)
  // 未闭合的开标签：其后内容全部丢弃（流被截断的情况）
  if (openIdx !== -1 && out.indexOf(closeTag, openIdx) === -1) {
    out = out.slice(0, openIdx)
  }
  const re = new RegExp(openTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + closeTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  out = out.replace(re, '')
  // 孤立的闭合标签也去掉
  const closeRe = new RegExp(closeTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  out = out.replace(closeRe, '')
  return out
}

/**
 * 一次性剥离文本中的全部 <think>...</think> 块
 * 兼容：未闭合的 <think>（流被截断，其后内容全部丢弃）、孤立的 </think>（部分中转站已剥离开标签）
 */
export function stripThinkBlocks(text) {
  return stripBlocksByTag(text, THINK_OPEN, THINK_CLOSE)
}

/**
 * 一次性剥离文本中的全部 <ask>...</ask> 块
 * ask 块由前端独立渲染为快捷回复按钮，不应出现在消息正文中
 */
export function stripAskBlocks(text) {
  return stripBlocksByTag(text, ASK_OPEN, ASK_CLOSE)
}

/**
 * 一次性剥离文本中的全部 <plan>...</plan> 块
 * plan 块由前端独立折叠展示，不应混在正文中
 */
export function stripPlanBlocks(text) {
  return stripBlocksByTag(text, PLAN_OPEN, PLAN_CLOSE)
}

/**
 * 统一清理消息正文内容：剥离 think、ask、plan 等不应直接展示的标签块
 */
export function cleanMessageContent(text) {
  if (typeof text !== 'string' || !text) return text
  let out = stripThinkBlocks(text)
  out = stripAskBlocks(out)
  out = stripPlanBlocks(out)
  // 清理多余的空行（连续空行压缩为最多 2 个）
  out = out.replace(/\n{4,}/g, '\n\n\n')
  return out.trim()
}

/**
 * 提取文本中全部 <think>...</think> 块的内容，拼接后返回
 * 用于将思考过程单独展示，而不是混在正文中
 */
export function extractThinkBlocks(text) {
  if (typeof text !== 'string' || !text.includes(THINK_OPEN)) return ''
  const parts = []
  const regex = /<think>([\s\S]*?)<\/think>/g
  let match
  while ((match = regex.exec(text)) !== null) {
    parts.push(match[1].trim())
  }
  return parts.join('\n\n')
}

/**
 * 提取文本中全部 <ask>...</ask> 块的 JSON 对象
 * 用于渲染快捷回复按钮
 */
export function extractAskBlocks(text) {
  if (typeof text !== 'string' || !text.includes(ASK_OPEN)) return []
  const results = []
  const regex = /<ask>\s*(\{[\s\S]*?\})\s*<\/ask>/g
  let match
  while ((match = regex.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[1])
      results.push(obj)
    } catch {}
  }
  return results
}

/**
 * 流式增量过滤器：标签可能被拆成多个 chunk（如 "<thi" + "nk>"）
 * push(delta) 返回本次新增的可见文本（可能为空）；flush() 在流结束时返回残留的可见文本
 * 可选 onThink 回调：每当有新的思考内容片段时触发（用于实时显示思考过程）
 */
export function createThinkStreamFilter(options = {}) {
  const onThink = typeof options.onThink === 'function' ? options.onThink : null
  let insideThink = false
  let pending = ''
  let thinkBuffer = '' // 累积当前思考块的内容

  const push = (delta) => {
    if (typeof delta !== 'string' || delta === '') return ''
    let buf = pending + delta
    pending = ''
    let out = ''

    while (buf) {
      if (!insideThink) {
        const i = buf.indexOf(THINK_OPEN)
        if (i !== -1) {
          out += buf.slice(0, i)
          buf = buf.slice(i + THINK_OPEN.length)
          insideThink = true
          thinkBuffer = ''
          continue
        }
        const hold = partialTagLength(buf, THINK_OPEN)
        if (hold > 0) {
          out += buf.slice(0, buf.length - hold)
          pending = buf.slice(buf.length - hold)
        } else {
          out += buf
          buf = ''
        }
        buf = ''
      } else {
        const i = buf.indexOf(THINK_CLOSE)
        if (i !== -1) {
          const thinkContent = buf.slice(0, i)
          thinkBuffer += thinkContent
          if (onThink && thinkContent) onThink(thinkContent, false) // false = 未结束
          buf = buf.slice(i + THINK_CLOSE.length)
          insideThink = false
          if (onThink) onThink('', true) // true = 思考块结束
          continue
        }
        // 思考内容中等待闭合标签；末尾可能是半截 </think>，暂存
        const hold = partialTagLength(buf, THINK_CLOSE)
        if (hold > 0) {
          const thinkContent = buf.slice(0, buf.length - hold)
          thinkBuffer += thinkContent
          if (onThink && thinkContent) onThink(thinkContent, false)
          pending = buf.slice(buf.length - hold)
        } else {
          thinkBuffer += buf
          if (onThink && buf) onThink(buf, false)
          pending = ''
        }
        buf = ''
      }
    }
    return out
  }

  const flush = () => {
    const rest = pending
    pending = ''
    // 流结束时仍在思考（未闭合）：残留全部属于思考内容，丢弃
    return insideThink ? '' : rest
  }

  return { push, flush }
}
