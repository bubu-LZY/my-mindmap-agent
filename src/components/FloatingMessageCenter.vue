<template>
  <div
    class="floating-message-center"
    :style="{ left: pos.x + 'px', top: pos.y + 'px', width: size.w + 'px', height: size.h + 'px' }"
    @mousedown.stop
  >
    <!-- 标题栏（拖拽区） -->
    <div
      class="mc-header"
      @pointerdown="onDragStart"
      @pointermove="onDragMove"
      @pointerup="onDragEnd"
      @pointercancel="onDragEnd"
    >
      <div class="mc-title">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
          <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
          <path d="M4.5 6h7M4.5 8.5h7M4.5 11h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        <span>消息中心</span>
      </div>
      <button class="mc-close" title="关闭" @click.stop="close">×</button>
    </div>

    <!-- 消息内容（内嵌第三方消息面板） -->
    <div class="mc-body">
      <ThirdPartyPanel />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import ThirdPartyPanel from './ThirdPartyPanel.vue'

const emit = defineEmits(['close'])

// 默认出现在主界面右侧，避开左侧目录树
const pos = ref({ x: Math.max(20, window.innerWidth - 580), y: 90 })
const size = ref({ w: 540, h: 560 })

let dragOffset = null

const onDragStart = (e) => {
  if (e.target && e.target.closest && e.target.closest('button')) return
  const rect = e.currentTarget.closest('.floating-message-center')?.getBoundingClientRect()
  if (!rect) return
  dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch (err) {}
}

const onDragMove = (e) => {
  if (!dragOffset) return
  pos.value = {
    x: Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - 80)),
    y: Math.max(0, Math.min(e.clientY - dragOffset.y, window.innerHeight - 40))
  }
}

const onDragEnd = (e) => {
  dragOffset = null
  try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch (err) {}
}

const close = () => emit('close')
</script>

<style scoped>
.floating-message-center {
  position: fixed;
  z-index: 7500;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e5e5e7);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}
.mc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 12px;
  flex-shrink: 0;
  cursor: move;
  user-select: none;
  border-bottom: 1px solid var(--border-color, #e5e5e7);
  background: var(--bg-tertiary, #f2f2f7);
}
.mc-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary, #3a3a3c);
}
.mc-close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  color: var(--text-tertiary, #8e8e93);
  padding: 4px 8px;
  border-radius: 6px;
}
.mc-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #1c1c1e;
}
.mc-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
/* 让内嵌的消息面板填满悬浮框、去掉自带边框与固定高度 */
.mc-body :deep(.tp-embedded) {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 0;
}
.mc-body :deep(.tp-embedded-layout) {
  height: 100%;
}
</style>
