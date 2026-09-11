// 惰性（inert）HTML 解析工具。
//
// 为什么不能再用「游离 div + innerHTML」解析不可信 HTML：
// innerHTML 确实不会执行 <script>（规范规定 script 经由 innerHTML 插入时永不运行），
// 但 createElement('div') 出来的节点属于当前活动文档，浏览器仍会为它加载子资源并派发事件，
// 因此 `<img src=x onerror=alert(1)>`、`<video onerror>`、`<svg><animate onbegin>` 这类
// 带事件属性的标签在游离 div 上照样能触发脚本——这是一个稳定的 XSS 落点，
// 而本项目里被解析的 HTML 大量来自 .smm 文件、AI 回复、网页抓取内容，全都不可信。
//
// DOMParser 产出的 document 没有浏览上下文（no browsing context）：
// 不加载任何子资源、不派发任何事件处理器、不执行脚本，是真正的惰性解析。
// 注意：解析后不能把节点 adopt 回主文档的游离容器，那样等于重新给了它加载能力。

/**
 * 用惰性文档解析 HTML。
 * @param {string} html
 * @returns {Document} 解析结果文档（无浏览上下文）
 */
export function parseHtmlInert(html) {
  return new DOMParser().parseFromString(String(html ?? ''), 'text/html')
}

/**
 * 惰性解析并返回其 body 元素，语义上等价于旧的「游离 div」，
 * 可直接用于 .innerHTML / .textContent / .querySelectorAll / TreeWalker。
 *
 * 与游离 div 的一处有意差异：输入里的 <title>/<style>/<meta> 会被文档解析器归入 <head>，
 * 因此 body.textContent 不再包含 CSS 源码与标题文本——对纯文本提取而言这正是期望行为。
 *
 * @param {string} html
 * @returns {HTMLBodyElement}
 */
export function parseHtmlBodyInert(html) {
  return parseHtmlInert(html).body
}

/**
 * 惰性解析 HTML 并取出纯文本。
 * @param {string} html
 * @returns {string}
 */
export function textFromHtmlInert(html) {
  if (!html || typeof html !== 'string') return ''
  return parseHtmlBodyInert(html).textContent || ''
}
