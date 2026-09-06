/**
 * Plan-and-Execute 计划标记过滤
 * 模型在 content 中输出两类结构化标记（提示词约定），前端不直接显示，而是渲染为计划清单 UI：
 *   <plan>
 *   1. 步骤一
 *   2. 步骤二
 *   </plan>
 *   <step-done>2</step-done>   ← 第 2 步完成时输出
 * 流式过滤：标签可能被拆成多个 chunk（与 thinkFilter 相同的处理方式）
 */

const PLAN_OPEN = '<plan>'
const PLAN_CLOSE = '</plan>'
const STEP_OPEN = '<step-done>'
const STEP_CLOSE = '</step-done>'

const OPENERS = [PLAN_OPEN, STEP_OPEN]

// 返回 s 末尾最长可能是 tag 前缀的长度
function partialTagLength(s, tag) {
  const max = Math.min(s.length, tag.length - 1)
  for (let len = max; len > 0; len--) {
    if (s.endsWith(tag.slice(0, len))) return len
  }
  return 0
}

// 多个标签取最长前缀保持长度
function partialAnyTag(s) {
  let hold = 0
  for (const tag of OPENERS) {
    hold = Math.max(hold, partialTagLength(s, tag))
  }
  return hold
}

/**
 * 计划文本 → 步骤数组：按行拆分，剥离行首编号（1. / 1、/ ① / - / *）
 */
export function parsePlanText(text) {
  if (typeof text !== 'string') return []
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:\d+\s*[\.、\)]\s*|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]\s*|[-*]\s+)/, '').trim())
    .filter(Boolean)
}

/**
 * 一次性剥离文本中的计划标记（非流式路径 / 兜底清理）
 */
export function stripPlanTags(text) {
  if (typeof text !== 'string' || !text.includes('<')) return text
  return text
    .replace(/<plan>[\s\S]*?<\/plan>/g, '')
    .replace(/<step-done>\s*\d*\s*<\/step-done>/g, '')
    .replace(/<plan>[\s\S]*$/g, '')            // 未闭合的计划块：全部丢弃
    .replace(/<step-done>[^<]*$/g, '')         // 未闭合的步骤标记
}

/**
 * 流式增量过滤器
 * push(delta) 返回本次新增的可见文本；解析到计划/步骤完成时通过回调通知
 * flush() 在流结束时调用，返回残留可见文本
 */
export function createPlanStreamFilter({ onPlan, onStepDone } = {}) {
  // state: 'normal' | 'plan' | 'step'
  let state = 'normal'
  let pending = ''
  let collect = ''

  const emitStepDone = () => {
    const n = parseInt(collect.trim(), 10)
    collect = ''
    if (Number.isFinite(n) && n > 0 && onStepDone) onStepDone(n)
  }

  const emitPlan = () => {
    const steps = parsePlanText(collect)
    collect = ''
    if (steps.length > 0 && onPlan) onPlan(steps)
  }

  const push = (delta) => {
    if (typeof delta !== 'string' || delta === '') return ''
    let buf = pending + delta
    pending = ''
    let out = ''

    while (buf) {
      if (state === 'normal') {
        // 找最早的开放标签
        let idx = -1
        let tag = null
        for (const opener of OPENERS) {
          const i = buf.indexOf(opener)
          if (i !== -1 && (idx === -1 || i < idx)) {
            idx = i
            tag = opener
          }
        }
        if (tag) {
          out += buf.slice(0, idx)
          buf = buf.slice(idx + tag.length)
          state = tag === PLAN_OPEN ? 'plan' : 'step'
          continue
        }
        const hold = partialAnyTag(buf)
        if (hold > 0) {
          out += buf.slice(0, buf.length - hold)
          pending = buf.slice(buf.length - hold)
        } else {
          out += buf
        }
        buf = ''
      } else if (state === 'plan') {
        const i = buf.indexOf(PLAN_CLOSE)
        if (i !== -1) {
          collect += buf.slice(0, i)
          buf = buf.slice(i + PLAN_CLOSE.length)
          state = 'normal'
          emitPlan()
          continue
        }
        const hold = partialTagLength(buf, PLAN_CLOSE)
        collect += hold > 0 ? buf.slice(0, buf.length - hold) : buf
        pending = hold > 0 ? buf.slice(buf.length - hold) : ''
        buf = ''
      } else {
        const i = buf.indexOf(STEP_CLOSE)
        if (i !== -1) {
          collect += buf.slice(0, i)
          buf = buf.slice(i + STEP_CLOSE.length)
          state = 'normal'
          emitStepDone()
          continue
        }
        const hold = partialTagLength(buf, STEP_CLOSE)
        collect += hold > 0 ? buf.slice(0, buf.length - hold) : buf
        pending = hold > 0 ? buf.slice(buf.length - hold) : ''
        buf = ''
      }
    }
    return out
  }

  const flush = () => {
    const rest = pending
    pending = ''
    // 流结束时标记未闭合：内容属于标记内部，丢弃（计划不完整不展示）
    return state === 'normal' ? rest : ''
  }

  return { push, flush }
}
