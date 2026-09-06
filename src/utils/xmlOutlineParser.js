/**
 * XML 类大纲格式 → simple-mind-map 树形数据
 * - OPML（.opml）：大纲编辑器通用交换格式，<outline text="..."/> 嵌套
 * - FreeMind（.mm）：<map><node TEXT="..."><node .../></node></map>
 * 使用浏览器内置 DOMParser，无外部依赖
 */

import { createUid } from 'simple-mind-map/src/utils'

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 转义后再包装：ensureRichText 见 &lt; 开头不会误判为已含 HTML 的富文本，防止原文注入节点
const makeNode = (text) => ({
  data: { text: `<p><span>${escapeHtml(String(text || '').trim() || '（空节点）')}</span></p>`, uid: createUid(), richText: true },
  children: []
})

const decodeEntities = (s) => {
  const d = document.createElement('textarea')
  d.innerHTML = String(s || '')
  return d.value
}

/**
 * 解析 OPML 文本为导图树
 * @param {string} xmlText OPML 文件内容
 * @param {string} fallbackName 根节点缺省名（用文件名）
 * @returns {{success: boolean, tree?: object, error?: string}}
 */
export function parseOpmlToTree(xmlText, fallbackName = 'OPML 大纲') {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml')
    if (doc.querySelector('parsererror')) {
      return { success: false, error: 'OPML 文件格式错误（XML 解析失败）' }
    }
    const body = doc.querySelector('body')
    if (!body) return { success: false, error: 'OPML 文件缺少 body 节点' }
    const outlines = [...body.children].filter(el => el.tagName.toLowerCase() === 'outline')

    // 根节点：head > title 优先，其次第一个 outline 的文本（此时它降级为根），否则文件名
    const title = decodeEntities(doc.querySelector('head > title')?.textContent || '').trim()
    let rootText = title
    let topLevel = outlines
    if (!rootText && outlines.length > 0) {
      rootText = (outlines[0].getAttribute('text') || outlines[0].getAttribute('title') || '').trim()
      topLevel = [...outlines[0].children].filter(el => el.tagName.toLowerCase() === 'outline')
      // 无标题但首个 outline 有子级且自身文本为空时，保留其余顶层项
      if (!rootText) { rootText = fallbackName; topLevel = outlines }
    }
    if (!rootText) rootText = fallbackName

    const root = makeNode(rootText)
    const walk = (el, parent) => {
      const text = (el.getAttribute('text') || el.getAttribute('title') || '').trim()
      if (text) {
        const node = makeNode(text)
        parent.children.push(node)
        parent = node
      }
      for (const child of [...el.children].filter(c => c.tagName.toLowerCase() === 'outline')) {
        walk(child, parent)
      }
    }
    for (const el of topLevel) walk(el, root)
    return { success: true, tree: root }
  } catch (e) {
    return { success: false, error: 'OPML 解析失败: ' + (e.message || e) }
  }
}

/**
 * 解析 FreeMind(.mm) 文本为导图树
 * @param {string} xmlText .mm 文件内容
 * @param {string} fallbackName 根节点缺省名
 * @returns {{success: boolean, tree?: object, error?: string}}
 */
export function parseFreemindToTree(xmlText, fallbackName = 'FreeMind 导图') {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml')
    if (doc.querySelector('parsererror')) {
      return { success: false, error: 'FreeMind 文件格式错误（XML 解析失败）' }
    }
    const mapNode = doc.querySelector('map')
    if (!mapNode) return { success: false, error: 'FreeMind 文件缺少 map 节点' }
    const rootEl = [...mapNode.children].find(el => el.tagName.toLowerCase() === 'node')
    if (!rootEl) return { success: false, error: 'FreeMind 文件缺少根 node 节点' }

    const nodeText = (el) => {
      // TEXT 属性优先；旧版本可能用 <text> 子元素
      return decodeEntities(el.getAttribute('TEXT') || el.getAttribute('text') || el.querySelector(':scope > text')?.textContent || '')
    }

    const walk = (el) => {
      const node = makeNode(nodeText(el) || '（空节点）')
      for (const child of [...el.children].filter(c => c.tagName.toLowerCase() === 'node')) {
        node.children.push(walk(child))
      }
      return node
    }
    const root = walk(rootEl)
    if (!nodeText(rootEl)) root.data.text = `<p><span>${escapeHtml(fallbackName)}</span></p>`
    return { success: true, tree: root }
  } catch (e) {
    return { success: false, error: 'FreeMind 解析失败: ' + (e.message || e) }
  }
}
