<template>
  <div
    v-if="visible"
    class="preview-overlay"
    :class="{ pinned }"
    :style="overlayStyle"
    @mousedown.stop="onOverlayMouseDown"
    @contextmenu.prevent
    @mouseenter="onMouseEnter"
    @wheel.capture="onWheelCapture"
  >
    <!-- 三角箭头（仅非固定模式显示） -->
    <div v-if="!pinned" class="preview-arrow" :style="arrowStyle"></div>

    <!-- 头部（可拖拽移动） -->
    <div
      class="preview-header"
      :class="{ dragging: isDragging }"
      @mousedown.stop.prevent="startDrag"
    >
      <span class="preview-title">{{ fileName }}</span>
      <div class="preview-actions">
        <button class="preview-btn primary" @click="openFile" title="在主界面打开并编辑">
          去编辑
        </button>
        <button class="preview-btn close" @click="hide" title="关闭">
          ✕
        </button>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="preview-body">
      <!-- 加载中 -->
      <div v-if="loading" class="preview-loading">
        <span class="preview-spinner"></span>
        <span>加载中...</span>
      </div>

      <!-- 迷你思维导图容器 -->
      <div
        v-show="!loading && !error"
        ref="miniMapContainerRef"
        class="mini-map-container"
      ></div>

      <!-- 树形展示（Markdown 或后备） -->
      <div v-if="!loading && error" class="preview-error">
        <span>{{ error }}</span>
      </div>
    </div>

    <!-- 缩放手柄（悬浮与固定模式均可用） -->
    <div
      class="preview-resize-handle"
      @mousedown.stop.prevent="startResize"
      title="拖拽调整大小"
    ></div>

    <!-- 缩放/滚动提示 -->
    <div class="preview-zoom-hint">{{ previewType === 'markdown' ? '滚轮滚动查看内容' : '滚轮缩放 · 左/右/中键拖动查看' }}</div>
  </div>
</template>

<script setup>
import { ref, computed, watch, reactive, onBeforeUnmount, nextTick } from 'vue'
import MindMap from 'simple-mind-map'
import { readFile } from '../services/referenceService'
import { escapeHtml } from '../utils/sanitizeHtml'

const props = defineProps({
  visible: { type: Boolean, default: false },
  filePath: { type: String, default: '' },
  nodeUid: { type: String, default: '' },
  pos: { type: Object, default: () => ({ x: 0, y: 0 }) },
  // 点击触发：不显示箭头（隐藏时机由父组件的鼠标位置统一判定）
  pinned: { type: Boolean, default: false }
})

const emit = defineEmits(['hide', 'open-file', 'stay', 'interacting'])

const loading = ref(false)
const error = ref('')
const fileName = ref('')
const miniMapContainerRef = ref(null)
let miniMindMap = null
// 当前预览类型：'minimap'（smm/json）| 'markdown'（md 文本）
const previewType = ref('')

// 拖拽移动 + 缩放状态
const winPos = reactive({ x: null, y: null })
const winSize = reactive({ width: 360, height: 280 })
const isDragging = ref(false)

// 悬浮窗定位样式（拖拽后使用内部位置，否则根据 props.pos 计算）
const overlayStyle = computed(() => {
  let x, y
  if (winPos.x !== null) {
    x = winPos.x
    y = winPos.y
  } else {
    x = props.pos.x || 0
    y = (props.pos.y || 0) + 8
    // 右侧空间不足时翻转到左侧显示
    if (x + winSize.width > window.innerWidth - 12) {
      x = (props.pos.x || 0) - winSize.width - 12
    }
    // 防止超出左侧屏幕
    x = Math.max(12, x)
    // 防止超出底部
    if (y + winSize.height > window.innerHeight) {
      y = (props.pos.y || 0) - winSize.height - 8
    }
  }
  return {
    left: Math.max(10, x) + 'px',
    top: Math.max(10, y) + 'px',
    width: winSize.width + 'px',
    height: winSize.height + 'px'
  }
})

// 箭头位置（非固定模式）
const arrowStyle = computed(() => {
  const arrowX = (props.pos.x || 0) - parseInt(overlayStyle.value.left) + 20
  return { left: Math.max(8, arrowX) + 'px', top: '-6px' }
})

// 开始拖拽移动（悬浮预览与固定预览均可拖动）
const startDrag = (e) => {
  const rect = e.currentTarget.closest('.preview-overlay').getBoundingClientRect()
  const offsetX = e.clientX - rect.left
  const offsetY = e.clientY - rect.top
  isDragging.value = true
  emit('interacting', true)

  const onMove = (ev) => {
    winPos.x = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - offsetX))
    winPos.y = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - offsetY))
  }
  const onUp = () => {
    isDragging.value = false
    emit('interacting', false)
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// 开始缩放
const startResize = (e) => {
  const startW = winSize.width
  const startH = winSize.height
  const startX = e.clientX
  const startY = e.clientY

  const onMove = (ev) => {
    winSize.width = Math.max(240, Math.min(window.innerWidth - 40, startW + ev.clientX - startX))
    winSize.height = Math.max(180, Math.min(window.innerHeight - 40, startH + ev.clientY - startY))
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/**
 * 悬浮窗内右/中键按下：拖动平移迷你导图（左键保持库默认行为），不弹浏览器菜单。
 * 拖动期间上报 interacting=true（父组件不自动隐藏）；松手后按鼠标位置统一判定。
 */
let suppressContextUntil = 0

const onOverlayMouseDown = (e) => {
  if (e.button !== 1 && e.button !== 2) return
  e.preventDefault()
  emit('interacting', true)
  const panButton = e.button
  let lastX = e.clientX
  let lastY = e.clientY
  const onMove = (ev) => {
    const dx = ev.clientX - lastX
    const dy = ev.clientY - lastY
    lastX = ev.clientX
    lastY = ev.clientY
    if (dx || dy) {
      try { miniMindMap?.view?.translateXY(dx, dy) } catch (err) {}
    }
  }
  const onUp = () => {
    emit('interacting', false)
    // 右键平移松手后，短暂抑制紧随的 contextmenu（鼠标可能已在悬浮窗外，
    // 否则会弹出画布右键菜单遮挡阅读）
    if (panButton === 2) suppressContextUntil = Date.now() + 400
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// 右键平移松手后的短时间内吞掉 contextmenu，避免在窗外触发画布右键菜单
const onDocContextmenuCapture = (e) => {
  if (Date.now() < suppressContextUntil) {
    e.preventDefault()
    e.stopPropagation()
  }
}
document.addEventListener('contextmenu', onDocContextmenuCapture, true)

const onMouseEnter = () => {
  // 通知父组件保持显示（用户可能要拖动/缩放悬浮窗）
  emit('stay')
}

/**
 * Markdown 文本预览时在捕获阶段阻断 wheel 事件继续传播（不阻止默认行为）：
 * 双保险——即使容器上残留迷你导图实例的 wheel 监听（会 preventDefault 触发缩放），
 * 也无法拦截滚轮，原生滚动 .md-preview 不受影响；minimap 模式放行（滚轮缩放导图）
 */
const onWheelCapture = (e) => {
  if (previewType.value === 'markdown') {
    e.stopPropagation()
  }
}

/**
 * 隐藏预览
 */
const hide = () => {
  emit('hide')
}

/**
 * 去编辑：在主界面打开被引用的文件/节点
 */
const openFile = () => {
  emit('open-file', { filePath: props.filePath, nodeUid: props.nodeUid })
  hide()
}

/**
 * 加载并渲染预览
 */
const loadPreview = async () => {
  if (!props.filePath) return

  loading.value = true
  error.value = ''

  // 提取文件名
  const parts = props.filePath.replace(/\\/g, '/').split('/')
  fileName.value = parts[parts.length - 1] || props.filePath

  try {
    // 读取文件
    const result = await readFile(props.filePath)

    if (!result.success) {
      error.value = result.error || '文件读取失败'
      loading.value = false
      return
    }

    // 等待 DOM 渲染
    await nextTick()
    loading.value = false

    if (result.type === 'json' && result.data) {
      // JSON/SMM 格式：创建迷你思维导图
      previewType.value = 'minimap'
      await renderMiniMap(result.data)
    } else if (result.type === 'markdown') {
      // Markdown：简单显示文本
      previewType.value = 'markdown'
      renderMarkdownPreview(result.data)
    } else {
      previewType.value = ''
      error.value = '不支持的文件格式'
    }
  } catch (e) {
    error.value = e.message || '加载失败'
    loading.value = false
  }
}

/**
 * 规范化预览数据：缺字段的节点数据会让 simple-mind-map 渲染时抛错
 */
const normalizePreviewData = (node) => {
  if (!node || typeof node !== 'object') return
  if (!node.data || typeof node.data !== 'object') {
    node.data = { text: typeof node.data === 'string' ? node.data : '' }
  }
  if (typeof node.data.text !== 'string') {
    node.data.text = String(node.data.text ?? '')
  }
  if (!Array.isArray(node.children)) {
    node.children = []
  }
  node.children.forEach(normalizePreviewData)
}

/**
 * 渲染迷你思维导图
 */
const renderMiniMap = async (data) => {
  if (!miniMapContainerRef.value) return

  // 清除旧实例
  destroyMiniMap()

  // 等待容器真正可见：loading=false 后 v-show 生效需要额外一个渲染周期，
  // 在 0 尺寸容器上初始化是此前"渲染失败"的主要根因
  await nextTick()
  let waited = 0
  while (waited < 20 &&
    (miniMapContainerRef.value.clientWidth < 10 || miniMapContainerRef.value.clientHeight < 10)) {
    await new Promise(resolve => setTimeout(resolve, 50))
    waited++
  }

  // 适配数据结构：MindMap 构造函数接收的是根节点树本身（{data,children}），
  // 而不是 {root: 树} 包装对象。本应用保存的 .smm 即根节点树；仅当文件里
  // 带配置包装（{root,...}，如外部导出格式）时才取 data.root
  const mindData = data.root && data.root.data ? data.root : data
  normalizePreviewData(mindData)

  try {
    miniMindMap = new MindMap({
      el: miniMapContainerRef.value,
      data: mindData,
      layout: 'logicalStructure',
      theme: 'default',
      readonly: true,
      fit: true,
      // 明确允许只读预览内的画布拖动与滚轮缩放（库的 view 拖动/缩放不检查 readonly，
      // 这里显式关闭 isDisableDrag 兜底，避免默认值变动导致交互失效）
      isDisableDrag: false,
      disableMouseWheelZoom: false,
      mousewheelAction: 'zoom'
    })

    // 缩小显示（fit 方法挂在 view 上，MindMap 实例本身无 fit 方法）
    miniMindMap.on('node_tree_render_end', () => {
      nextTick(() => {
        try {
          miniMindMap?.view?.fit?.()

          // 如果有 nodeUid，高亮目标节点
          if (props.nodeUid) {
            highlightNode(props.nodeUid)
          }
        } catch {}
      })
    })
  } catch (e) {
    error.value = '思维导图渲染失败：' + (e?.message || e)
  }
}

/**
 * 目标节点高亮边框闪烁（约 2 秒，提醒位置）
 */
const blinkNodeBorder = (node) => {
  try {
    const gEl = node.group?.node || node.group
    if (!gEl || !gEl.classList) return
    gEl.classList.remove('preview-highlight-node')
    gEl.classList.add('preview-highlight-node')
    setTimeout(() => {
      gEl.classList.remove('preview-highlight-node')
    }, 2200)
  } catch {}
}

/**
 * 高亮目标节点：居中定位 + 边框闪烁
 */
const highlightNode = (uid) => {
  if (!miniMindMap || !miniMindMap.renderer) return

  const findNode = (node) => {
    if (!node) return null
    const nodeUid = node.getData?.('uid') || node.uid
    if (nodeUid === uid) return node
    if (node.children) {
      for (const child of node.children) {
        const found = findNode(child)
        if (found) return found
      }
    }
    return null
  }

  // 优先使用递归查找
  const root = miniMindMap.renderer.root
  const target = findNode(root)
  if (target) {
    try {
      // resetScale=true：缩放重置为 100% 并居中目标节点，窗口内可直接看到节点及其周边内容
      miniMindMap.renderer?.moveNodeToCenter?.(target, true)
    } catch {}
    blinkNodeBorder(target)
    return
  }

  // 兜底：遍历 allNodes
  miniMindMap.renderer?.allNodes?.forEach(node => {
    const nodeUid = node.getData?.('uid') || node.uid
    if (nodeUid === uid) {
      try {
        miniMindMap.renderer?.moveNodeToCenter?.(node, true)
      } catch {}
      blinkNodeBorder(node)
    }
  })
}

/**
 * 销毁迷你思维导图实例（移除其 el 上的 wheel 等事件监听）
 */
const destroyMiniMap = () => {
  if (miniMindMap) {
    try {
      miniMindMap.destroy()
    } catch {}
    miniMindMap = null
  }
}

/**
 * 渲染 Markdown 预览
 */
const renderMarkdownPreview = (content) => {
  if (!miniMapContainerRef.value) return
  // 必须先销毁残留的迷你导图实例：其实例的 wheel 监听会 preventDefault（滚轮缩放），
  // 若残留会导致 Markdown 文本无法用滚轮滚动（只能拖动滚动条）
  destroyMiniMap()
  const lines = content.split('\n').slice(0, 20)
  const html = lines
    .map(line => {
      const match = line.match(/^(#{1,6})\s+(.+)/)
      if (match) {
        const level = match[1].length
        return `<div class="md-line md-h${level}">${escapeHtml(match[2])}</div>`
      }
      return `<div class="md-line">${line ? escapeHtml(line) : '&nbsp;'}</div>`
    })
    .join('')
  miniMapContainerRef.value.innerHTML = `<div class="md-preview">${html}</div>`
}

// 监听可见性和文件路径变化
watch(
  [() => props.visible, () => props.filePath],
  ([visible]) => {
    if (visible && props.filePath) {
      // 重置拖拽位置，尺寸保持用户上次调整值
      winPos.x = null
      winPos.y = null
      nextTick(() => loadPreview())
    } else {
      // 清理迷你思维导图
      destroyMiniMap()
    }
  },
  { immediate: true }
)

// 清理
onBeforeUnmount(() => {
  destroyMiniMap()
  document.removeEventListener('contextmenu', onDocContextmenuCapture, true)
})
</script>

<style scoped>
.preview-overlay {
  position: fixed;
  z-index: 10001;
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  animation: preview-fade-in 0.2s ease;
}

@keyframes preview-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 三角箭头 */
.preview-arrow {
  position: absolute;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 6px solid rgba(255, 255, 255, 0.98);
  top: -6px;
}

/* 头部（所有模式均可拖拽移动） */
.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  cursor: move;
  user-select: none;
}

.preview-header.dragging {
  cursor: grabbing;
}

.preview-title {
  font-size: 13px;
  font-weight: 600;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.preview-actions {
  display: flex;
  gap: 4px;
}

.preview-btn {
  height: 24px;
  padding: 0 10px;
  font-size: 12px;
  font-family: inherit;
  color: #4A90D9;
  background: rgba(74, 144, 217, 0.08);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.preview-btn:hover {
  background: rgba(74, 144, 217, 0.15);
}

.preview-btn.primary {
  color: #fff;
  background: #4A90D9;
}

.preview-btn.primary:hover {
  background: #3a7bc8;
}

.preview-btn.close {
  color: #86868b;
  background: rgba(0, 0, 0, 0.05);
  width: 24px;
  padding: 0;
  text-align: center;
}

.preview-btn.close:hover {
  background: rgba(0, 0, 0, 0.1);
}

/* 内容区 */
.preview-body {
  flex: 1;
  overflow: hidden;
  position: relative;
}

/* 缩放手柄（右下角） */
.preview-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  z-index: 5;
  background: linear-gradient(135deg, transparent 50%, rgba(74, 144, 217, 0.5) 50%);
  border-bottom-right-radius: 12px;
}

/* 操作提示 */
.preview-zoom-hint {
  position: absolute;
  left: 12px;
  bottom: 8px;
  font-size: 10px;
  color: rgba(134, 134, 139, 0.85);
  background: rgba(255, 255, 255, 0.85);
  padding: 2px 8px;
  border-radius: 8px;
  pointer-events: none;
  z-index: 4;
}

.mini-map-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* 节点引用定位：目标节点边框高亮闪烁 */
.mini-map-container :deep(.preview-highlight-node > rect) {
  stroke: #ff9500 !important;
  stroke-width: 3 !important;
  animation: preview-node-blink 0.45s ease-in-out 4;
}

@keyframes preview-node-blink {
  0%, 100% { stroke: #ff9500; }
  50% { stroke: transparent; }
}

/* 加载中 */
.preview-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  font-size: 13px;
  color: #86868b;
}

.preview-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(74, 144, 217, 0.2);
  border-top-color: #4A90D9;
  border-radius: 50%;
  animation: preview-spin 0.6s linear infinite;
}

@keyframes preview-spin {
  to { transform: rotate(360deg); }
}

/* 错误 */
.preview-error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 13px;
  color: #ff3b30;
}

/* Markdown 预览 */
:deep(.md-preview) {
  padding: 12px 16px;
  font-size: 12px;
  line-height: 1.6;
  color: #333;
  overflow-y: auto;
  height: 100%;
}

:deep(.md-line) {
  padding: 2px 0;
  color: #555;
}

:deep(.md-h1) { font-size: 14px; font-weight: 700; color: #1a1a1a; }
:deep(.md-h2) { font-size: 13px; font-weight: 600; color: #1a1a1a; }
:deep(.md-h3) { font-size: 12px; font-weight: 600; color: #333; }
</style>
