/**
 * 离屏渲染：不依赖当前打开的导图实例，从原始导图数据直接渲染 SVG。
 * 用于 MCP / 外部调用场景 —— 即使桌面端没有打开任何导图，
 * 也能通过 filePath 读取 .smm 数据并导出 HTML / 全视图（三模式 HTML）等。
 *
 * 原理：创建一个移出屏幕外（position:fixed; left:-99999px）的隐藏容器，
 * 用 simple-mind-map 渲染后调用 Export 插件导出 SVG，最后销毁实例并移除容器。
 * 不能用 display:none 隐藏（会导致 SVG 尺寸 20x20 空白），所以移到屏幕外。
 */

import MindMap from 'simple-mind-map'
import Export from 'simple-mind-map/src/plugins/Export.js'
import RichText from 'simple-mind-map/src/plugins/RichText.js'
import AssociativeLine from 'simple-mind-map/src/plugins/AssociativeLine.js'
import OuterFrame from 'simple-mind-map/src/plugins/OuterFrame.js'
import { createUid } from 'simple-mind-map/src/utils'

let pluginsRegistered = false
let themeRegistered = false

// 插件注册（幂等，重复注册安全）
function ensurePlugins() {
  if (pluginsRegistered) return
  try {
    MindMap.usePlugin(RichText)
    MindMap.usePlugin(Export)
    MindMap.usePlugin(AssociativeLine)
    MindMap.usePlugin(OuterFrame)
    pluginsRegistered = true
  } catch (e) {
    console.warn('[offscreenRender] 插件注册失败:', e.message)
  }
}

// 离屏渲染专用主题（与主程序 blueRoot 视觉一致的精简版）
function ensureTheme() {
  if (themeRegistered) return
  try {
    MindMap.defineTheme('offscreenBlue', {
      backgroundColor: '#fafbfc',
      paddingX: 15,
      paddingY: 5,
      root: {
        shape: 'rectangle',
        fillColor: '#4A90D9',
        color: '#ffffff',
        fontSize: 22,
        fontWeight: 'bold',
        borderRadius: 10,
        borderColor: 'transparent',
        borderWidth: 0
      },
      second: {
        shape: 'rectangle',
        fillColor: '#e8f0fa',
        color: '#1a1a1a',
        fontSize: 16,
        borderColor: '#b3d0ee',
        borderWidth: 1,
        borderRadius: 8
      },
      node: {
        shape: 'rectangle',
        fillColor: '#ffffff',
        color: '#333333',
        fontSize: 14,
        borderColor: '#e0e0e0',
        borderWidth: 1,
        borderRadius: 6
      },
      generalization: {
        shape: 'rectangle',
        fillColor: '#f0f0f0',
        color: '#333',
        fontSize: 13,
        fontWeight: 'bold',
        borderColor: '#ccc',
        borderWidth: 1,
        borderRadius: 6
      },
      lineWidth: 2,
      lineColor: '#b0b8c1',
      lineStyle: 'straight'
    })
    themeRegistered = true
  } catch (e) {
    console.warn('[offscreenRender] 主题注册失败:', e.message)
  }
}

// 规范化节点数据（补 uid / richText / HTML 文本），确保离屏实例能正确渲染
function normalizeNodeData(node) {
  if (!node) return null
  if (!node.data) node.data = {}
  if (!node.data.uid) node.data.uid = createUid()
  if (!node.data.richText) node.data.richText = true
  if (node.data.text && !String(node.data.text).startsWith('<')) {
    node.data.text = `<p><span>${node.data.text}</span></p>`
  }
  if (!node.data.text) {
    node.data.text = '<p><span></span></p>'
  }
  if (node.children) node.children.forEach(normalizeNodeData)
  return node
}

// 导出 SVG 时的保真钩子（挖空样式 + foreignObject 溢出可见，与主程序一致）
const buildExportSvgHook = () => (svg) => {
  try {
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    styleEl.textContent = `
      foreignObject { overflow: visible !important; }
      .smm-richtext-node-wrap {
        word-break: break-all;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      }
      .smm-richtext-node-wrap p { font-family: inherit; }
      .smm-cloze {
        background-color: rgba(124, 58, 237, 0.13);
        border-bottom: 2px solid rgba(124, 58, 237, 0.7);
        border-radius: 3px;
        padding: 0 1px;
      }
      .smm-cloze-hidden, .smm-cloze-hidden * { color: transparent !important; }
      .smm-cloze-hidden {
        background-color: rgba(124, 58, 237, 0.18) !important;
        border-bottom: 2px solid #7c3aed !important;
      }
    `
    svg.node.appendChild(styleEl)
    const cloneFos = svg.find('foreignObject')
    cloneFos.forEach(fo => {
      try {
        fo.node.style.setProperty('overflow', 'visible', 'important')
        const w = parseFloat(fo.attr('width'))
        if (!isNaN(w)) fo.attr('width', w + 8)
        const h = parseFloat(fo.attr('height'))
        if (!isNaN(h)) fo.attr('height', h + 6)
      } catch (err) { /* 单节点失败不影响其余 */ }
    })
    // 导出副本显示全部挖空内容
    try {
      const rootEl = svg.node || svg
      rootEl.querySelectorAll('.smm-cloze').forEach(el => {
        el.classList.remove('smm-cloze-hidden')
        el.style.removeProperty('color')
      })
    } catch (err) { /* 忽略 */ }
  } catch (e) {
    console.warn('[offscreenRender] 导出保真钩子失败:', e)
  }
  return svg
}

const waitFrames = (n = 2) => new Promise(resolve => {
  let count = 0
  const step = () => {
    if (++count >= n) { resolve(); return }
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
})

/**
 * 从原始导图数据离屏渲染 SVG，返回 data URL。
 * @param {Object} treeData 原始导图数据（root 为根节点，children 为子树）
 * @param {Object} [opts]
 * @param {string} [opts.layout] 布局，默认 logicalStructure
 * @param {string} [opts.name] 导出文件名（仅用于 SVG 内部标识）
 * @returns {Promise<string>} SVG data URL
 */
export async function renderSvgFromData(treeData, opts = {}) {
  if (!treeData) throw new Error('导图数据为空，无法离屏渲染')
  ensurePlugins()
  ensureTheme()

  const root = Array.isArray(treeData) ? treeData[0] : treeData
  const data = normalizeNodeData(JSON.parse(JSON.stringify(root)))
  const layout = opts.layout || 'logicalStructure'
  const name = opts.name || '思维导图'

  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:1600px;height:1200px;background:#fafbfc;'
  document.body.appendChild(container)

  let mm = null
  try {
    mm = new MindMap({
      el: container,
      data,
      layout,
      theme: 'offscreenBlue',
      readonly: true,
      fit: true,
      isDisableDrag: true,
      openPerformance: false,
      handleBeingExportSvg: buildExportSvgHook()
    })

    // 等渲染稳定（简单导图一帧即可，复杂导图多等几帧）
    await waitFrames(3)

    // 触发一次 resize 确保布局按离屏容器尺寸计算
    try { mm.resize && mm.resize() } catch (e) { /* 忽略 */ }
    await waitFrames(2)

    const svgDataUrl = await mm.export('svg', false, name)
    if (!svgDataUrl) throw new Error('SVG 生成失败（渲染未产出数据）')
    return svgDataUrl
  } finally {
    try {
      if (mm) mm.destroy()
    } catch (e) { /* 忽略 */ }
    try {
      if (container.parentNode) container.parentNode.removeChild(container)
    } catch (e) { /* 忽略 */ }
  }
}
