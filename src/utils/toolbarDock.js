import { onMounted, onBeforeUnmount } from 'vue'

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

  const applyPosition = () => {
    const el = rootRef.value
    const parent = el?.parentElement
    if (!el || !parent) return

    el.style.position = 'absolute'
    el.style.transform = 'none'
    el.style.right = 'auto'
    el.style.bottom = 'auto'

    const horizontal = state.edge === 'top' || state.edge === 'bottom'
    el.style.flexDirection = horizontal ? 'row' : 'column'

    const pr = parent.getBoundingClientRect()
    if (!pr.width || !pr.height) return

    const width = el.offsetWidth
    const height = el.offsetHeight
    if (!width || !height) return

    const margin = 8
    let left
    let top

    if (horizontal) {
      left = margin + (pr.width - width - margin * 2) * state.offset
      top = state.edge === 'top' ? margin : pr.height - height - margin
    } else {
      top = margin + (pr.height - height - margin * 2) * state.offset
      left = state.edge === 'left' ? margin : pr.width - width - margin
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
    scheduleApply()
    window.addEventListener('resize', applyPosition)

    const parent = rootRef.value?.parentElement
    if (parent && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => applyPosition())
      resizeObserver.observe(parent)
    }
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', applyPosition)
    window.removeEventListener('mousemove', onDragMove)
    if (resizeObserver) {
      try { resizeObserver.disconnect() } catch {}
      resizeObserver = null
    }
  })

  return { startDrag, applyPosition }
}
