<template>
  <div ref="containerRef" class="graph-view">
    <div ref="graphDomRef" class="graph-canvas-wrap"></div>

    <!-- 空状态 -->
    <div v-if="empty && !initError" class="graph-empty">
      <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
        <circle cx="5" cy="5" r="2.2" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <circle cx="19" cy="5" r="2.2" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <circle cx="12" cy="19" r="2.2" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M6.8 6.2l3.4 10.4M17.2 6.2L13.8 16.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
      <p>暂无导图数据，请先打开一个思维导图文件</p>
    </div>

    <!-- 初始化错误提示 -->
    <div v-if="initError" class="graph-error">
      <p class="err-title">关联图初始化失败</p>
      <p class="err-msg">{{ initError }}</p>
    </div>

    <!-- 节点计数 -->
    <div v-if="nodeCount > 0" class="graph-count">
      {{ nodeCount }} 个节点 · {{ linkCount }} 条连线
    </div>

    <!-- 导出按钮 -->
    <button v-if="nodeCount > 0" class="graph-export-btn" @click="onExport">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
        <path d="M12 15V4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        <path d="M7.5 8.5L12 4l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M5 16v3c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
      <span>导出关联图</span>
    </button>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { downloadGraphHtml } from '../utils/graphExport'
import { buildTriModeHtml } from '../utils/triModeExport'
import { safeExportSvg } from '../utils/safeExportSvg'

const props = defineProps({
  // 导图实例（优先使用，可获取实时数据）
  mindMap: {
    type: Object,
    default: null
  },
  // 原始导图数据（兜底，编辑器隐藏时也能用）
  mindMapData: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['locate-node'])

const containerRef = ref(null)
const graphDomRef = ref(null)
const empty = ref(true)
const initError = ref('')
const nodeCount = ref(0)
const linkCount = ref(0)

let graph = null
let resizeObserver = null
let hoveredNode = null
let ForceGraphModule = null

// 富文本 HTML 转纯文本
const htmlToText = (html) => {
  if (!html) return ''
  const div = document.createElement('div')
  div.innerHTML = String(html)
  return (div.textContent || '').replace(/\s+/g, ' ').trim()
}

// 按层级着色
const DEPTH_COLORS = ['#0a84ff', '#30b0c7', '#34c759', '#ff9500', '#af52de', '#8e8e93', '#ff3b30']

// 从导图实例提取节点 + 关联线
const buildFromInstance = (mindMap) => {
  const nodes = []
  const links = []
  const root = mindMap?.renderer?.root
  if (!root) return { nodes, links }

  const truncate = (s, n = 16) => (s.length > n ? s.slice(0, n) + '…' : s)
  const seenAssoc = new Set()

  const walk = (node, parentUid, depth) => {
    if (!node || node.isGeneralization) return
    let uid = node.getData?.('uid') || node.uid
    if (!uid) return
    uid = String(uid)
    const text = htmlToText(node.getData?.('text') || '') || '未命名'
    const note = node.getData?.('note') || ''
    const image = node.getData?.('image')?.url || node.getData?.('image')?.src || ''
    nodes.push({
      id: uid,
      name: truncate(text),
      fullName: text,
      depth,
      hasNote: !!note,
      note,
      hasImage: !!image,
      image
    })
    if (parentUid) {
      links.push({ source: parentUid, target: uid, type: 'tree' })
    }
    const targets = node.getData?.('associativeLineTargets') || []
    const textMap = node.getData?.('associativeLineText') || {}
    for (const toUid of targets) {
      const t = String(toUid)
      const key = [uid, t].sort().join('|')
      if (!seenAssoc.has(key)) {
        seenAssoc.add(key)
        links.push({ source: uid, target: t, type: 'assoc', label: textMap[toUid] || '' })
      }
    }
    ;(node.children || []).forEach(c => walk(c, uid, depth + 1))
  }
  walk(root, null, 0)
  return { nodes, links }
}

// 从原始数据提取节点 + 关联线（兜底方案）
const buildFromRawData = (data) => {
  const nodes = []
  const links = []
  if (!data) return { nodes, links }

  const truncate = (s, n = 16) => (s.length > n ? s.slice(0, n) + '…' : s)
  const seenAssoc = new Set()

  const walk = (nodeData, parentUid, depth) => {
    if (!nodeData || !nodeData.data) return
    const d = nodeData.data
    const uid = String(d.uid || '')
    if (!uid) return
    // 跳过概括节点
    if (d.generalization && !d.text) return

    const text = htmlToText(d.text || '') || '未命名'
    const note = d.note || ''
    const image = d.image?.url || d.image?.src || ''
    nodes.push({
      id: uid,
      name: truncate(text),
      fullName: text,
      depth,
      hasNote: !!note,
      note,
      hasImage: !!image,
      image
    })
    if (parentUid) {
      links.push({ source: parentUid, target: uid, type: 'tree' })
    }
    const targets = Array.isArray(d.associativeLineTargets) ? d.associativeLineTargets : []
    const textMap = d.associativeLineText || {}
    for (const toUid of targets) {
      const t = String(toUid)
      const key = [uid, t].sort().join('|')
      if (!seenAssoc.has(key)) {
        seenAssoc.add(key)
        links.push({ source: uid, target: t, type: 'assoc', label: textMap[toUid] || '' })
      }
    }
    if (Array.isArray(nodeData.children)) {
      nodeData.children.forEach(c => walk(c, uid, depth + 1))
    }
  }
  walk(data, null, 0)
  return { nodes, links }
}

const buildGraphData = () => {
  // 优先用实例，实例不可用时用原始数据兜底
  if (props.mindMap?.renderer?.root) {
    return buildFromInstance(props.mindMap)
  }
  if (props.mindMapData) {
    return buildFromRawData(props.mindMapData)
  }
  return { nodes: [], links: [] }
}

// 计算放射状布局骨架坐标（根在中心，子节点按角度向四周发散，每层一个圆环）
// 目的：让图打开即呈有序的放射状分布，父子连线呈放射、避免乱交叉
const computeTreeLayout = (nodes, links) => {
  if (!nodes.length) return
  const children = new Map()
  const hasParent = new Set()
  for (const l of links) {
    if (l.type !== 'tree') continue
    const s = String(l.source?.id ?? l.source)
    const t = String(l.target?.id ?? l.target)
    if (!s || !t) continue
    if (!children.has(s)) children.set(s, [])
    children.get(s).push(t)
    hasParent.add(t)
  }
  // 根节点：没有父节点的节点
  const roots = nodes.filter(n => !hasParent.has(n.id)).map(n => n.id)
  if (!roots.length) return

  // 每个节点的子树叶子数（决定其占据的角度比例）
  const weight = new Map()
  const calcWeight = (id) => {
    const kids = children.get(id) || []
    if (!kids.length) { weight.set(id, 1); return 1 }
    let sum = 0
    for (const k of kids) sum += calcWeight(k)
    weight.set(id, sum)
    return sum
  }
  roots.forEach(calcWeight)

  // 从根开始分配角度区间（按子树权重瓜分），半径按深度递增
  const angle = new Map()
  const radius = new Map()
  const RADIUS_GAP = 120 // 每层半径间距

  const assignAngle = (id, start, end, depth) => {
    const mid = (start + end) / 2
    angle.set(id, mid)
    radius.set(id, depth * RADIUS_GAP)
    const kids = children.get(id) || []
    const totalWeight = weight.get(id) || 1
    let cur = start
    for (const k of kids) {
      const w = weight.get(k) || 1
      const span = (end - start) * (w / totalWeight)
      assignAngle(k, cur, cur + span, depth + 1)
      cur += span
    }
  }
  // 多根时均分圆周
  roots.forEach((r, i) => {
    const span = (Math.PI * 2) / roots.length
    assignAngle(r, span * i, span * (i + 1), 0)
  })

  for (const n of nodes) {
    const a = angle.get(n.id) ?? 0
    const r = radius.get(n.id) ?? 0
    n.layoutX = r * Math.cos(a)
    n.layoutY = r * Math.sin(a)
    // 初始位置直接用布局坐标，让图打开即有序、避免仿真初期乱飞
    n.x = n.layoutX
    n.y = n.layoutY
  }
}

const render = () => {
  if (!graph) return
  try {
    const { nodes, links } = buildGraphData()
    computeTreeLayout(nodes, links)
    empty.value = nodes.length === 0
    nodeCount.value = nodes.length
    linkCount.value = links.length
    graph.graphData({ nodes, links })
    if (nodes.length) {
      setTimeout(() => {
        try { graph.zoomToFit(400, 40) } catch (e) { /* 忽略 */ }
      }, 700)
    }
  } catch (e) {
    console.error('[GraphView] render error:', e)
  }
}

// 导出三模式 HTML（思维导图 + 大纲 + 关联图）
const onExport = async () => {
  try {
    const rawData = props.mindMapData
    if (!rawData) {
      ElMessage.warning('没有可导出的数据')
      return
    }
    // 从根节点取文件名
    const getRootName = () => {
      const root = rawData.data
      const text = root?.text || ''
      if (!text) return '思维导图'
      return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || '思维导图'
    }
    const name = getRootName()

    // 安全导出 SVG（处理容器隐藏时尺寸异常的问题）
    let svgDataUrl = null
    if (props.mindMap) {
      try {
        svgDataUrl = await safeExportSvg(props.mindMap, name)
      } catch (e) {
        console.warn('[GraphView] SVG 导出失败:', e.message)
      }
    }

    if (!svgDataUrl) {
      ElMessage.warning('当前无法获取导图 SVG，请先切换到思维导图模式再导出')
      return
    }

    const html = await buildTriModeHtml(svgDataUrl, rawData, name)
    const fileName = `${name}-全视图模式`
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    ElMessage.success(`三模式 HTML 已导出：${fileName}.html`)
  } catch (e) {
    console.error('[GraphView] 导出失败:', e)
    ElMessage.error(`导出失败: ${e.message}`)
  }
}

const initGraph = async () => {
  const container = graphDomRef.value
  if (!container) {
    initError.value = '找不到画布容器元素'
    return
  }

  const parent = containerRef.value
  const cw = parent?.clientWidth || container.clientWidth || window.innerWidth * 0.6
  const ch = parent?.clientHeight || container.clientHeight || window.innerHeight * 0.6

  if (cw <= 0 || ch <= 0) {
    initError.value = `容器尺寸异常：${cw} x ${ch}`
    return
  }

  try {
    if (!ForceGraphModule) {
      const mod = await import('force-graph')
      ForceGraphModule = mod.default || mod
    }
    const ForceGraph = ForceGraphModule

    if (typeof ForceGraph !== 'function') {
      initError.value = 'force-graph 模块导出格式异常：' + typeof ForceGraph
      return
    }

    graph = ForceGraph()(container)
      .width(cw)
      .height(ch)
      .backgroundColor('#fafafa')
      .nodeId('id')
      .linkSource('source')
      .linkTarget('target')
      .linkColor(link => (link.type === 'assoc' ? 'rgba(10, 132, 255, 0.55)' : 'rgba(0, 0, 0, 0.12)'))
      .linkWidth(link => (link.type === 'assoc' ? 1.5 : 0.8))
      .linkDirectionalArrowLength(link => (link.type === 'assoc' ? 4 : 0))
      .linkDirectionalArrowRelPos(1)
      .linkLabel(link => link.label || '')
      .nodeLabel(node => node.fullName || node.name || '')
      .nodeVal(6)
      .enablePanInteraction(true)
      .enableZoomInteraction(true)
      .nodeCanvasObjectMode(() => 'replace')
      .nodeCanvasObject((node, ctx, globalScale) => {
        if (node.x == null || node.y == null) return
        const r = 5
        const color = DEPTH_COLORS[(node.depth || 0) % DEPTH_COLORS.length]
        ctx.beginPath()
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false)
        ctx.fillStyle = color
        ctx.fill()
        if (node === hoveredNode) {
          ctx.beginPath()
          ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI, false)
          ctx.strokeStyle = 'rgba(10, 132, 255, 0.65)'
          ctx.lineWidth = 2
          ctx.stroke()
        }
        // 备注标识（右上角小黄点）
        if (node.hasNote) {
          ctx.beginPath()
          ctx.arc(node.x + r - 1, node.y - r + 1, 2.2, 0, 2 * Math.PI, false)
          ctx.fillStyle = '#ffcc00'
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 1
          ctx.stroke()
        }
        // 图片标识（右下角小绿点）
        if (node.hasImage) {
          ctx.beginPath()
          ctx.arc(node.x + r - 1, node.y + r - 1, 2.2, 0, 2 * Math.PI, false)
          ctx.fillStyle = '#34c759'
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 1
          ctx.stroke()
        }
        // 文字显示：所有节点在任何缩放级别都显示文字（缩小后文字相对放大、偏乱，可接受）
        if (node.name) {
          const fontSize = 12 / globalScale
          ctx.font = `${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = 'rgba(40, 44, 52, 0.88)'
          ctx.fillText(node.name, node.x + r + 4, node.y)
        }
      })
      .nodePointerAreaPaint((node, color, ctx) => {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(node.x, node.y, 10, 0, 2 * Math.PI, false)
        ctx.fill()
      })
      .onNodeHover(node => {
        hoveredNode = node
        container.style.cursor = node ? 'pointer' : 'grab'
      })
      .onNodeClick(node => {
        if (node && node.id) emit('locate-node', node.id)
      })
      .onBackgroundClick(() => { /* 空实现，屏蔽默认行为 */ })

    // 力导向参数（默认值）
    try {
      graph.d3Force('charge').strength(-120)
      graph.d3Force('link').distance(link => (link.type === 'assoc' ? 80 : 55))
      graph.d3Force('center').strength(0.05)
    } catch (e) {
      console.warn('[GraphView] d3Force 配置跳过:', e.message)
    }

    render()
    initError.value = ''

    // 关闭浏览器右键菜单，并接管右键拖动（默认 force-graph 只响应左键 pan）
    const onContextMenu = (e) => e.preventDefault()
    container.addEventListener('contextmenu', onContextMenu)
    container.__onContextMenu = onContextMenu
    // 自定义右键 pan：mousedown 记录起点，mousemove 调用 centerAt 调整视口，
    // mouseup 结束。这样不需要 hack force-graph 内部事件，直接覆盖用户交互层。
    let rightDragging = false
    let startClientX = 0
    let startClientY = 0
    let startCenterX = 0
    let startCenterY = 0
    const onRightMouseDown = (e) => {
      if (e.button !== 2) return
      rightDragging = true
      startClientX = e.clientX
      startClientY = e.clientY
      try {
        const c = graph.centerAt()
        startCenterX = c.x
        startCenterY = c.y
      } catch (_) { /* ignore */ }
      container.style.cursor = 'grabbing'
      e.preventDefault()
    }
    const onRightMouseMove = (e) => {
      if (!rightDragging) return
      // 直接调用 pan 内部：dx/dy 为屏幕像素位移
      const dx = e.clientX - startClientX
      const dy = e.clientY - startClientY
      try {
        const k = graph.zoom() || 1
        graph.centerAt(startCenterX - dx / k, startCenterY - dy / k, 0)
      } catch (_) { /* ignore */ }
      e.preventDefault()
    }
    const onRightMouseUp = () => {
      if (!rightDragging) return
      rightDragging = false
      container.style.cursor = 'grab'
    }
    container.addEventListener('mousedown', onRightMouseDown)
    window.addEventListener('mousemove', onRightMouseMove)
    window.addEventListener('mouseup', onRightMouseUp)
    container.__rightDragCleanup = () => {
      window.removeEventListener('mousemove', onRightMouseMove)
      window.removeEventListener('mouseup', onRightMouseUp)
    }
  } catch (e) {
    console.error('[GraphView] initGraph error:', e)
    initError.value = e.message || String(e)
  }

  // 响应式尺寸
  if (parent && !resizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      if (graph && parent) {
        const w = parent.clientWidth
        const h = parent.clientHeight
        if (w > 0 && h > 0) {
          try { graph.width(w).height(h) } catch (e) { /* 忽略 */ }
        }
      }
    })
    resizeObserver.observe(parent)
  }
}

onMounted(() => {
  nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        initGraph()
      })
    })
  })
})

// 监听实例变化和原始数据变化，任意一个更新都重新渲染
watch(() => props.mindMap, () => {
  if (graph) nextTick(render)
}, { deep: false })

watch(() => props.mindMapData, () => {
  if (graph) nextTick(render)
}, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  // 清理自定义右键拖动监听器
  try {
    const c = graphDomRef.value
    if (c && c.__onContextMenu) c.removeEventListener('contextmenu', c.__onContextMenu)
    if (c && c.__rightDragCleanup) c.__rightDragCleanup()
  } catch (e) { /* 忽略 */ }
  try { graph?._destructor?.() } catch (e) { /* 忽略 */ }
  graph = null
  ForceGraphModule = null
})
</script>

<style scoped>
.graph-view {
  position: absolute;
  inset: 0;
  background: #fafafa;
  overflow: hidden;
}
.graph-canvas-wrap {
  position: absolute;
  inset: 0;
}
.graph-canvas-wrap :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
  cursor: grab;
}
.graph-canvas-wrap :deep(canvas:active) {
  cursor: grabbing;
}
.graph-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #a8abb2;
  font-size: 13px;
  pointer-events: none;
  z-index: 2;
}
.graph-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #ff3b30;
  font-size: 13px;
  z-index: 3;
  background: rgba(255, 255, 255, 0.9);
}
.err-title {
  font-weight: 600;
  font-size: 14px;
}
.err-msg {
  font-family: "Consolas", monospace;
  font-size: 12px;
  max-width: 80%;
  word-break: break-all;
  text-align: center;
  color: #8e8e93;
}
.graph-count {
  position: absolute;
  bottom: 12px;
  right: 16px;
  font-size: 12px;
  color: #a8abb2;
  pointer-events: none;
  z-index: 2;
}
.graph-export-btn {
  position: absolute;
  bottom: 12px;
  left: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  font-size: 12px;
  color: #1d1d1f;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  z-index: 3;
  transition: all 0.15s ease;
}
.graph-export-btn:hover {
  background: #fff;
  border-color: rgba(10, 132, 255, 0.3);
  color: #0a84ff;
  box-shadow: 0 2px 12px rgba(10, 132, 255, 0.12);
}
.graph-export-btn:active {
  transform: scale(0.97);
}
</style>
