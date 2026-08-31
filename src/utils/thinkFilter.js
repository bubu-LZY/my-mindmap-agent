/**
 * <think> 思考过程过滤
 * MiniMax 等推理模型会在 content 中输出 <think>...</think> 思考过程，
 * 前端不展示思考内容；过滤只作用于文本 content，tool_calls 是独立字段，不受影响。
 */

const OPEN_TAG = '<think>'
const CLOSE_TAG = '</think>'

// 返回 s 末尾最长可能是 tag 前缀的长度（如 s="a<th"，tag="<think>" → 3）
function partialTagLength(s, tag) {
  const max = Math.min(s.length, tag.length - 1)
  for (let len = max; len > 0; len--) {
    if (s.endsWith(tag.slice(0, len))) return len
  }
  return 0
}

/**
 * 一次性剥离文本中的全部 <think>...</think> 块
 * 兼容：未闭合的 <think>（流被截断，其后内容全部丢弃）、孤立的 </think>（部分中转站已剥离开标签）
 */
export function stripThinkBlocks(text) {
  if (typeof text !== 'string' || !text.includes('<')) return text
  let out = text
  const openIdx = out.lastIndexOf(OPEN_TAG)
  if (openIdx !== -1 && out.indexOf(CLOSE_TAG, openIdx) === -1) {
    out = out.slice(0, openIdx)
  }
  out = out.replace(/<think>[\s\S]*?<\/think>/g, '')
  out = out.replace(/<\/think>/g, '')
  return out
}

/**
 * 流式增量过滤器：标签可能被拆成多个 chunk（如 "<thi" + "nk>"）
 * push(delta) 返回本次新增的可见文本（可能为空）；flush() 在流结束时返回残留的可见文本
 */
export function createThinkStreamFilter() {
  let insideThink = false
  let pending = ''

  const push = (delta) => {
    if (typeof delta !== 'string' || delta === '') return ''
    let buf = pending + delta
    pending = ''
    let out = ''

    while (buf) {
      if (!insideThink) {
        const i = buf.indexOf(OPEN_TAG)
        if (i !== -1) {
          out += buf.slice(0, i)
          buf = buf.slice(i + OPEN_TAG.length)
          insideThink = true
          continue
        }
        const hold = partialTagLength(buf, OPEN_TAG)
        if (hold > 0) {
          out += buf.slice(0, buf.length - hold)
          pending = buf.slice(buf.length - hold)
        } else {
          out += buf
          buf = ''
        }
        buf = ''
      } else {
        const i = buf.indexOf(CLOSE_TAG)
        if (i !== -1) {
          buf = buf.slice(i + CLOSE_TAG.length)
          insideThink = false
          continue
        }
        // 思考内容中等待闭合标签，其余直接丢弃；末尾可能是半截 </think>，暂存
        const hold = partialTagLength(buf, CLOSE_TAG)
        pending = hold > 0 ? buf.slice(buf.length - hold) : ''
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
