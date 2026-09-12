import { blockDeepSeekOverlay } from './deepSeekOverlayGate'

/**
 * DeepSeek 网页模式的画面由主进程 BrowserView（原生层）渲染，永远盖在 DOM 之上。
 * 显式登记每个浮层（见 deepSeekOverlayGate 的调用点）容易漏：新加的面板、第三方组件
 * 自己的下拉/弹层、右键菜单……漏掉任何一个，用户就会看到"DeepSeek 窗口浮在其他窗口上面"。
 *
 * 这里再加一层兜底：监听整个文档，只要出现"高层浮层元素"并且它的实际显示区域与
 * DeepSeek 面板区域相交，就自动登记阻断（隐藏原生层）；浮层消失后自动恢复。
 */
const REASON = 'auto-overlay'

// 覆盖 Element Plus 与项目自绘的各类浮层 class
const CANDIDATE_SELECTOR = [
  '.el-overlay',
  '.el-dialog',
  '.el-drawer',
  '.el-message-box',
  '.el-dropdown-menu',
  '.el-popper',
  '[class*="overlay"]',
  '[class*="dialog"]',
  '[class*="popover"]',
  '[class*="modal"]',
  '[class*="contextmenu"]',
  '[class*="context-menu"]',
  '[class*="dropdown"]'
].join(',')

// 只认真正"压在高层的"元素：普通布局元素 z-index 很小或为 auto
const MIN_Z_INDEX = 100
// 扫描节流：DOM 变动很频繁，攒一下再扫
const SCAN_DELAY = 120

const toZIndex = (value) => {
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : 0
}

const intersects = (a, b) =>
  a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom

const isVisibleLayer = (el) => {
  let style
  try {
    style = getComputedStyle(el)
  } catch (e) {
    return null
  }
  if (!style || style.display === 'none' || style.visibility === 'hidden') return null
  if (Number(style.opacity) === 0) return null
  if (toZIndex(style.zIndex) < MIN_Z_INDEX) return null
  if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return null
  const rect = el.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return null
  return rect
}

const collectVisibleLayerRects = () => {
  const rects = []
  let nodes
  try {
    nodes = document.querySelectorAll(CANDIDATE_SELECTOR)
  } catch (e) {
    return rects
  }
  for (const el of nodes) {
    const rect = isVisibleLayer(el)
    if (rect) rects.push(rect)
  }
  return rects
}

/**
 * 启动兜底监听。
 * @param {() => DOMRect|null} getPanelRect 取 DeepSeek 面板容器当前的实际显示区域
 * @returns {() => void} 停止监听
 */
export const startDeepSeekAutoOverlayGuard = (getPanelRect) => {
  let timer = null

  const scan = () => {
    timer = null
    // 面板本身收起了（宽/高为 0）：不需要阻断，交给正常显隐逻辑
    const panel = typeof getPanelRect === 'function' ? getPanelRect() : null
    if (!panel || panel.width < 2 || panel.height < 2) {
      blockDeepSeekOverlay(REASON, false)
      return
    }
    blockDeepSeekOverlay(REASON, collectVisibleLayerRects().some((r) => intersects(r, panel)))
  }

  const schedule = () => {
    if (timer) return
    timer = setTimeout(scan, SCAN_DELAY)
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  })
  schedule()

  return () => {
    observer.disconnect()
    if (timer) clearTimeout(timer)
    timer = null
    blockDeepSeekOverlay(REASON, false)
  }
}