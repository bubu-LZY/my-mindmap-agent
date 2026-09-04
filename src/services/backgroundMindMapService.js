/**
 * 后台离屏导图实例服务
 *
 * 用于方案 A：后台任务按「本地文件路径」操作，不打开前台 pane。
 * - 若文件已经在某个 pane 打开，直接复用注册表中的实例。
 * - 若未打开，则读取 .smm 数据，在离屏容器中创建 MindMap 实例并注册到 store。
 * - 实例做 LRU 缓存，避免同一次会话反复重建。
 */

import MindMap from 'simple-mind-map'
import { useMindMapStore } from '../stores/mindMapStore'

const MAX_BACKGROUND_INSTANCES = 5
const backgroundContainers = new Map()
const backgroundInstances = new Map()

const normalizeFileId = (fileId) => String(fileId || '')
  .replace(/[\\/]+/g, '/')
  .replace(/\/+$/, '')

const getStore = () => {
  try {
    return useMindMapStore()
  } catch {
    return null
  }
}

const disposeInstance = (fileId) => {
  const norm = normalizeFileId(fileId)
  const mm = backgroundInstances.get(norm)
  const container = backgroundContainers.get(norm)
  if (container?.parentNode) {
    try { container.parentNode.removeChild(container) } catch { /* 忽略 */ }
  }
  backgroundContainers.delete(norm)
  backgroundInstances.delete(norm)
  if (mm) {
    const store = getStore()
    try {
      if (store && store.getInstance && store.getInstance(norm) === mm) {
        store.unregisterInstance(norm)
      }
    } catch { /* store 未就绪时忽略 */ }
  }
}

const touch = (fileId) => {
  const norm = normalizeFileId(fileId)
  const mm = backgroundInstances.get(norm)
  if (mm) {
    backgroundInstances.delete(norm)
    backgroundInstances.set(norm, mm)
  }
}

const enforceCap = () => {
  while (backgroundInstances.size > MAX_BACKGROUND_INSTANCES) {
    const oldest = backgroundInstances.keys().next().value
    disposeInstance(oldest)
  }
}

const readMindmapFile = async (filePath) => {
  if (!window.electronAPI?.openFile) return null
  const result = await window.electronAPI.openFile(filePath)
  if (!result?.success || !result.data || typeof result.data !== 'object') return null
  return result.data
}

/**
 * 获取指定 .smm 文件对应的 mindMap 实例。
 * @param {string} filePath 绝对路径
 * @returns {Promise<object|null>}
 */
export async function ensureBackgroundMindMap(filePath) {
  if (!filePath) return null
  const norm = normalizeFileId(filePath)
  touch(norm)

  const store = getStore()
  if (store && typeof store.getInstance === 'function') {
    const existing = store.getInstance(norm)
    if (existing) return existing
  }

  const data = await readMindmapFile(filePath)
  if (!data) return null

  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;height:600px;pointer-events:none;'
  document.body.appendChild(container)

  const mindMap = new MindMap({
    el: container,
    data,
    layout: 'logicalStructure',
    theme: 'default',
    readonly: false,
    mousewheelAction: 'zoom',
    openPerformance: true,
    performanceConfig: {
      time: 120,
      padding: 120,
      removeNodeWhenOutCanvas: false
    }
  })

  backgroundInstances.set(norm, mindMap)
  backgroundContainers.set(norm, container)
  if (store && typeof store.registerInstance === 'function') {
    store.registerInstance(norm, mindMap)
  }
  enforceCap()
  return mindMap
}

/**
 * 从文本中提取第一个明确的本地文件路径。
 * 覆盖 Windows 绝对路径、filePath/file_path 参数两种常见写法。
 */
export function extractFilePathFromText(text) {
  const value = String(text || '')
  const patterns = [
    /(?:filePath|file_path|path)\s*[:=]\s*["']?([A-Za-z]:[\\/][^\r\n"'<>|?*]+\.(?:smm|json))/i,
    /([A-Za-z]:[\\/][^\r\n"'<>|?*]*\.(?:smm|json))/i
  ]
  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (match && match[1]) return match[1].trim()
  }
  return ''
}

export { normalizeFileId }
