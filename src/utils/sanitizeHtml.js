/**
 * HTML 消毒 / 转义工具
 * - escapeHtml：把任意字符串转为纯文本安全的 HTML（用于拼接进节点/预览时的转义）
 * - isSafeUrl：URL 协议白名单判定（供 sanitizeSafeHtml 与外部链接点击拦截复用）
 * - sanitizeSafeHtml：对富文本 HTML 做白名单式消毒，剥离脚本与事件注入，保留常用排版标签与内联样式
 */

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const DANGEROUS_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'style', 'link', 'meta',
  'base', 'form', 'svg', 'math', 'noscript', 'template', 'portal'
])

const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp'])

// 允许内联的 data: 图片类型。刻意排除 image/svg+xml（可内嵌 <script>）和 text/html。
const ALLOWED_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i

// 单值 URL 属性
const URL_ATTRS = new Set([
  'href', 'src', 'xlink:href', 'action', 'formaction', 'data', 'poster', 'background'
])

// 多候选 URL 属性：值为逗号分隔列表，必须逐个校验，否则靠后的候选能夹带 javascript:
const URL_LIST_ATTRS = new Set(['srcset', 'imagesrcset'])

// WHATWG URL 在解析 scheme 之前会剥离所有 ASCII Tab / LF / CR，浏览器地址栏与
// <a href> 也遵循同一规则。因此 "java\tscript:alert(1)" 在 Chromium 中等价于
// "javascript:alert(1)"，任何基于原始字符串的黑名单正则都会被这种写法绕过。
// 这里在判定前先移除全部 C0 控制字符与空格、DEL，使待判字符串与浏览器实际解析的一致。
const normalizeUrlForCheck = (value) => String(value ?? '').replace(/[\u0000-\u0020\u007f]/g, '')

export function isSafeUrl(value) {
  const url = normalizeUrlForCheck(value)
  if (!url) return true
  const schemeMatch = url.match(/^([a-z][a-z0-9+.\-]*):/i)
  // 无 scheme：相对路径、锚点、协议相对 URL，交给浏览器按当前文档基址解析
  if (!schemeMatch) return true
  const scheme = schemeMatch[1].toLowerCase()
  if (scheme === 'data') return ALLOWED_DATA_IMAGE.test(url)
  return ALLOWED_URL_SCHEMES.has(scheme)
}

function isSafeUrlList(value) {
  return String(value ?? '')
    .split(',')
    .every((candidate) => isSafeUrl(candidate.trim()))
}

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
        // 事件处理器（onclick / onerror / onfocus...）一律剥离
        if (name.startsWith('on')) {
          child.removeAttribute(a.name)
          continue
        }
        // URL 类属性走协议白名单，不再用可被控制字符绕过的黑名单
        if (URL_ATTRS.has(name) && !isSafeUrl(a.value)) {
          child.removeAttribute(a.name)
        } else if (URL_LIST_ATTRS.has(name) && !isSafeUrlList(a.value)) {
          child.removeAttribute(a.name)
        }
      }
      clean(child)
    }
  }
  clean(body)
  return body.innerHTML
}
