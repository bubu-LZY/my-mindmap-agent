/**
 * 对照参考快照（review #5）：改写类工具执行前把当前文本存入 node.note
 *
 * 存储结构：
 *   node.note = [
 *     { text, capturedAt, source: 'ai_rewrite' | 'ai_cloze' | 'manual' }
 *   ]
 *
 * 历史保留最近 5 条（用户可通过右键"修改历史"查看）。重复快照（同一文本）会被去重。
 *
 * 适用：set_node_text / update_node_text / batch_node_actions 改写类子操作 / ai_recite_rewrite 等
 */
const MAX_HISTORY = 5

export function snapshotBeforeTextChange(node, source) {
  if (!node) return
  try {
    const data = typeof node.getData === 'function' ? node.getData() : node.data
    if (!data) return
    const currentText = data.text
    if (!currentText || typeof currentText !== 'string') return
    const setData = (patch) => {
      try {
        if (typeof node.setData === 'function') {
          node.setData(patch)
        } else if (node.nodeData && node.nodeData.data) {
          Object.assign(node.nodeData.data, patch)
        }
      } catch (e) {}
    }
    // 读取现有 note：可以是字符串（旧版 UI）或数组（已迁移）
    const existing = data.note
    let list = []
    if (Array.isArray(existing)) {
      list = existing.slice()
    } else if (typeof existing === 'string' && existing.trim()) {
      list = [{ text: existing, capturedAt: 0, source: 'legacy' }]
    }
    // 去重：与最近一条文本相同则跳过
    const lastText = list.length ? (list[list.length - 1].text || '') : ''
    if (lastText === currentText) return
    list.push({
      text: currentText,
      capturedAt: Date.now(),
      source: source || 'manual'
    })
    if (list.length > MAX_HISTORY) list = list.slice(-MAX_HISTORY)
    setData({ note: list })
  } catch (e) { /* 静默失败，不影响主流程 */ }
}

export function getNodeHistory(node) {
  if (!node) return []
  try {
    const data = typeof node.getData === 'function' ? node.getData() : node.data
    if (!data) return []
    const existing = data.note
    if (Array.isArray(existing)) return existing
    if (typeof existing === 'string' && existing.trim()) return [{ text: existing, capturedAt: 0, source: 'legacy' }]
    return []
  } catch (e) { return [] }
}
