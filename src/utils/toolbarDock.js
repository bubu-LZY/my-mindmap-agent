import { onMounted, onBeforeUnmount, watch } from 'vue'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

/**
 * 让工具条支持拖拽并吸附到容器四边。
 * - 顶部/底部：横向工具条
 * - 左侧/右侧：竖向工具条
 * - 位置与吸附状态持久化到 localStorage，下次打开自动恢复
 */
export function useDockToolbar(rootRef, storageKey) {
  let state = { edge: 'top', offset: 0.5 }
  let dragState = null
  let resizeObserver = null
  let observedParent = null

  const normalizeEdge = (edge) => {
    return ['top', 'bottom', 'left', 'right'].includes(edge) ? edge : 'top'
  }

  const load = () => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return
      state = {
        edge: normalizeEdge(parsed.edge),
        offset: clamp(Number(parsed.offset), 0, 1)
      }
      if (!Number.isFinite(state.offset)) state.offset = 0.5
    } catch {
      state = { edge: 'top', offset: 0.5 }
    }
  }

  const persist = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state))
    } catch {}
  }

  /**
   * 挂载容器尺寸观察器。
   * 工具条根元素带 v-if，onMounted 执行时它可能还没渲染，此时拿不到 parentElement，
   * 观察器就会永远挂空（窗口 resize 仍生效，但 AI 面板展开这类容器自身缩放不掉样式）。
   * 因此每次定位时都重新解析父容器，变化了才重挂。
   */
  const syncParentObserver = () => {
    const parent = rootRef.value?.parentElement
    if (!parent || typeof ResizeObserver === 'undefined') return
    if (parent === observedParent) return
    if (resizeObserver) {
      try { resizeObserver.disconnect() } catch {}
    }
    resizeObserver = new ResizeObserver(() => applyPosition())
    resizeObserver.observe(parent)
    observedParent = parent
  }

  const applyPosition = () => {
    const el = rootRef.value
    const parent = el?.parentElement
    if (!el || !parent) return

    syncParentObserver()

    el.style.position = 'absolute'
    el.style.transform = 'none'
    el.style.right = 'auto'
    el.style.bottom = 'auto'

    const pr = parent.getBoundingClientRect()
    if (!pr.width || !pr.height) return

    const margin = 8
    const availWidth = pr.width - margin * 2
    const availHeight = pr.height - margin * 2

    // 量一次指定方向下的尺寸：改 flexDirection 会触发一次同步布局，
    // 但本函数只在挂载/拖拽结束/容器尺寸变化时调用，不在滚动或 rAF 路径上
    const measure = (edge) => {
      el.style.flexDirection = (edge === 'top' || edge === 'bottom') ? 'row' : 'column'
      return { width: el.offsetWidth, height: el.offsetHeight }
    }

    let edge = state.edge
    let { width, height } = measure(edge)
    let horizontal = edge === 'top' || edge === 'bottom'

    // 首选方向放不下时自动换另一方向：横条需要约 500px 宽，右侧 AI 助手面板展开 /
    // 分屏把画布压窄后，超出画布的部分会被父容器的 overflow:hidden 从右边界裁掉
    // （看起来像被 AI 面板遮住）。竖条只需约 44px 宽，贴边即可留在画布内。
    // 这是运行时避让，不写回 state：空间恢复后仍按用户原本的吸附方向显示
    if (horizontal && width > availWidth) {
      const alt = measure('right')
      if (alt.height <= availHeight) {
        edge = 'right'
        width = alt.width
        height = alt.height
        horizontal = false
      }
    } else if (!horizontal && height > availHeight) {
      const alt = measure('top')
      if (alt.width <= availWidth) {
        edge = 'top'
        width = alt.width
        height = alt.height
        horizontal = true
      }
    }

    if (!width || !height) return

    let left
    let top

    if (horizontal) {
      left = margin + (pr.width - width - margin * 2) * state.offset
      top = edge === 'top' ? margin : pr.height - height - margin
    } else {
      top = margin + (pr.height - height - margin * 2) * state.offset
      left = edge === 'left' ? margin : pr.width - width - margin
    }

    // 容器小于工具条时居中，且绝不把工具条移出可视范围
    if (pr.width < width) left = (pr.width - width) / 2
    if (pr.height < height) top = (pr.height - height) / 2

    left = clamp(left, 0, Math.max(0, pr.width - width))
    top = clamp(top, 0, Math.max(0, pr.height - height))

    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }

  const startDrag = (event) => {
    const el = rootRef.value
    const parent = el?.parentElement
    if (!el || !parent) return

    event.preventDefault()
    event.stopPropagation()

    const pr = parent.getBoundingClientRect()
    const rr = el.getBoundingClientRect()
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      baseLeft: rr.left - pr.left,
      baseTop: rr.top - pr.top,
      parentWidth: pr.width,
      parentHeight: pr.height,
      width: rr.width,
      height: rr.height
    }

    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', onDragEnd, { once: true })
  }

  const onDragMove = (event) => {
    if (!dragState) return
    const el = rootRef.value
    if (!el) return

    const dx = event.clientX - dragState.startX
    const dy = event.clientY - dragState.startY
    const maxLeft = Math.max(0, dragState.parentWidth - dragState.width)
    const maxTop = Math.max(0, dragState.parentHeight - dragState.height)

    const left = clamp(dragState.baseLeft + dx, 0, maxLeft)
    const top = clamp(dragState.baseTop + dy, 0, maxTop)

    el.style.position = 'absolute'
    el.style.transform = 'none'
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.right = 'auto'
    el.style.bottom = 'auto'
  }

  const onDragEnd = () => {
    window.removeEventListener('mousemove', onDragMove)
    if (!dragState) return
    dragState = null

    const el = rootRef.value
    const parent = el?.parentElement
    if (!el || !parent) return

    const pr = parent.getBoundingClientRect()
    const rr = el.getBoundingClientRect()
    const distances = [
      { edge: 'left', distance: rr.left - pr.left },
      { edge: 'right', distance: pr.right - rr.right },
      { edge: 'top', distance: rr.top - pr.top },
      { edge: 'bottom', distance: pr.bottom - rr.bottom }
    ].sort((a, b) => a.distance - b.distance)

    const edge = distances[0]?.edge || 'top'
    let offset
    if (edge === 'left' || edge === 'right') {
      offset = pr.height > 0 ? (rr.top + rr.height / 2 - pr.top) / pr.height : 0.5
    } else {
      offset = pr.width > 0 ? (rr.left + rr.width / 2 - pr.left) / pr.width : 0.5
    }

    state = {
      edge: normalizeEdge(edge),
      offset: clamp(offset, 0, 1)
    }
    persist()
    applyPosition()
  }

  const scheduleApply = () => {
    requestAnimationFrame(applyPosition)
    setTimeout(applyPosition, 60)
  }

  onMounted(() => {
    load()
    applyPosition()
    window.addEventListener('resize', applyPosition)

    // v-if 让根元素可能晚于 mounted 出现：出现后补一次定位并挂上观察器
    watch(rootRef, () => {
      observedParent = null
      scheduleApply()
    })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', applyPosition)
    window.removeEventListener('mousemove', onDragMove)
    if (resizeObserver) {
      try { resizeObserver.disconnect() } catch {}
      resizeObserver = null
    }
    observedParent = null
  })

  return { startDrag, applyPosition }
}
