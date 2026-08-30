/**
 * 可拖动工具条 composable（顶部 fixed toolbar 改造）
 *
 * 用法：
 *   const { dragOffset, onDragHandleDown, resetPosition, isDragging } = useDraggableToolbar('fixed-toolbar-offset')
 *
 * 模板：
 *   <div class="fixed-toolbar" :style="{ transform: toolbarStyle }" @mousedown.prevent>
 *     <span class="ft-drag-handle" :class="{ active: isDragging }" @pointerdown="onDragHandleDown" title="按住可拖动工具条（双击重置位置）">⋮⋮</span>
 *     ...原有内容...
 *   </div>
 *
 * 行为：
 *   - 默认偏移 (0, 0) → 工具条位置不变（与原本绝对定位一致）
 *   - 拖动后偏移存 localStorage，下次进入该模式时恢复
 *   - 抓手双击重置为默认位置
 *   - 跨窗口/跨文件不串扰（每个 storageKey 独立）
 */
import { ref, computed, onBeforeUnmount } from 'vue'

export function useDraggableToolbar(storageKey) {
  const STORAGE_KEY = String(storageKey || 'toolbar-offset')

  // 偏移：默认 (0, 0) 表示工具条仍在原 CSS 位置
  const dragOffset = ref(loadOffset())
  const isDragging = ref(false)
  // 拖动起点（pointer x/y 与当时已有偏移）
  let dragStart = null

  function loadOffset() {
    try {
      if (typeof localStorage === 'undefined') return { x: 0, y: 0 }
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return { x: 0, y: 0 }
      const obj = JSON.parse(raw)
      const x = Number(obj && obj.x)
      const y = Number(obj && obj.y)
      return {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0
      }
    } catch (e) {
      return { x: 0, y: 0 }
    }
  }

  function saveOffset() {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dragOffset.value))
    } catch (e) {}
  }

  function resetPosition() {
    dragOffset.value = { x: 0, y: 0 }
    saveOffset()
  }

  // 把偏移写到工具条上：原 CSS 通常是 `translateX(-50%)` 居中，保留居中效果，把偏移叠加上去
  function toolbarStyleExtra() {
    const x = dragOffset.value.x || 0
    const y = dragOffset.value.y || 0
    if (!x && !y) return ''
    // 注意：toolbarStyle 传入时应直接拼接 "translate(...)"，原本 `translateX(-50%)` 已写在 CSS 上
    return `translate(${x}px, ${y}px)`
  }

  const toolbarTransform = computed(() => {
    const x = dragOffset.value.x || 0
    const y = dragOffset.value.y || 0
    return `translate(${x}px, ${y}px)`
  })

  function onPointerMove(e) {
    if (!dragStart) return
    const dx = e.clientX - dragStart.pointerX
    const dy = e.clientY - dragStart.pointerY
    dragOffset.value = { x: dragStart.offsetX + dx, y: dragStart.offsetY + dy }
  }

  function onPointerUp() {
    isDragging.value = false
    dragStart = null
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
    saveOffset()
  }

  function onDragHandleDown(e) {
    // 仅响应主指针（左键/单指触摸）
    if (e && typeof e.button === 'number' && e.button !== 0) return
    if (e) {
      try { e.preventDefault() } catch (err) {}
    }
    isDragging.value = true
    dragStart = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      offsetX: dragOffset.value.x,
      offsetY: dragOffset.value.y
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    }
  }

  function onDragHandleDblClick(e) {
    if (e) {
      try { e.preventDefault() } catch (err) {}
      try { e.stopPropagation() } catch (err) {}
    }
    resetPosition()
  }

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  })

  return {
    dragOffset,
    isDragging,
    toolbarTransform,
    onDragHandleDown,
    onDragHandleDblClick,
    resetPosition
  }
}
