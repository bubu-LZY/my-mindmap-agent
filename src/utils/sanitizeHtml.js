/**
 * HTML 消毒 / 转义工具
 * - escapeHtml：把任意字符串转为纯文本安全的 HTML（用于拼接进节点/预览时的转义）
 * - sanitizeSafeHtml：对富文本 HTML 做白名单式消毒，剥离脚本与事件注入，保留常用排版标签与内联样式
 */

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const DANGEROUS_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'style', 'link', 'meta',
  'base', 'form', 'svg', 'math', 'noscript', 'template', 'portal'
])

const DANGEROUS_URL = /^\s*(javascript|vbscript|data):/i

export function sanitizeSafeHtml(html) {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const body = doc.body

  const clean = (el) => {
    for (let i = el.children.length - 1; i >= 0; i--) {
      const child = el.children[i]
      if (DANGEROUS_TAGS.has(child.tagName.toLowerCase())) {
        child.remove()
        continue
      }
      const attrs = [...child.attributes]
      for (const a of attrs) {
        const name = a.name.toLowerCase()
        if (name.startsWith('on')) {
          child.removeAttribute(a.name)
          continue
        }
        if ((name === 'href' || name === 'src' || name === 'xlink:href') && DANGEROUS_URL.test(a.value)) {
          child.removeAttribute(a.name)
        }
      }
      clean(child)
    }
  }
  clean(body)
  return body.innerHTML
}