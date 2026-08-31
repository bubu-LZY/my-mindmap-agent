<template>
  <Teleport to="body">
    <Transition name="note-dialog">
      <!-- 节点旁跟随悬浮窗模式（传入 pos 时）：无遮罩，定位在节点旁 -->
      <div
        v-if="visible && pos"
        class="note-popover"
        :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      >
        <div class="note-popover-arrow"></div>
        <div class="note-dialog-header">
          <span class="note-dialog-title">{{ title }}</span>
          <button class="note-dialog-close" title="关闭 (Esc)" @click="onClose">✕</button>
        </div>
        <div v-if="nodeName" class="note-dialog-node" :title="nodeName">{{ nodeName }}</div>
        <textarea
          ref="textareaRef"
          v-model="text"
          class="note-dialog-textarea"
          :placeholder="placeholderText"
          @keydown="onKeydown"
        ></textarea>
        <div class="note-dialog-footer">
          <span class="note-dialog-tip">Ctrl+Enter 保存</span>
          <div class="note-dialog-actions">
            <button v-if="hasExisting" class="note-btn note-btn-clear" @click="onClear">{{ clearLabel }}</button>
            <button class="note-btn" @click="onClose">取消</button>
            <button class="note-btn note-btn-primary" @click="onSave">保存</button>
          </div>
        </div>
      </div>

      <!-- 居中模态模式（默认，兼容大纲视图等未传 pos 的场景） -->
      <div v-else-if="visible" class="note-dialog-mask" @mousedown.self="onClose">
        <div class="note-dialog">
          <div class="note-dialog-header">
            <span class="note-dialog-title">{{ title }}</span>
            <button class="note-dialog-close" title="关闭 (Esc)" @click="onClose">✕</button>
          </div>
          <div v-if="nodeName" class="note-dialog-node" :title="nodeName">{{ nodeName }}</div>
          <textarea
            ref="textareaRef"
            v-model="text"
            class="note-dialog-textarea"
            :placeholder="placeholderText"
            @keydown="onKeydown"
          ></textarea>
          <div class="note-dialog-footer">
            <span class="note-dialog-tip">Ctrl+Enter 保存</span>
            <div class="note-dialog-actions">
              <button v-if="hasExisting" class="note-btn note-btn-clear" @click="onClear">{{ clearLabel }}</button>
              <button class="note-btn" @click="onClose">取消</button>
              <button class="note-btn note-btn-primary" @click="onSave">保存</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  initialText: { type: String, default: '' },
  nodeName: { type: String, default: '' },
  multiCount: { type: Number, default: 1 },
  // 节点屏幕坐标 {x, y}：传入时以「节点旁跟随悬浮窗」显示，否则居中模态
  pos: { type: Object, default: null },
  // 自定义文案（复用于概括编辑等场景，不传保持备注默认）
  titleText: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  clearLabel: { type: String, default: '清除备注' }
})

const emit = defineEmits(['save', 'clear', 'close'])

const text = ref('')
const textareaRef = ref(null)
const hasExisting = ref(false)

watch(() => props.visible, (v) => {
  if (v) {
    text.value = props.initialText || ''
    hasExisting.value = !!(props.initialText && props.initialText.trim())
    nextTick(() => {
      textareaRef.value?.focus()
      const len = text.value.length
      try {
        textareaRef.value?.setSelectionRange(len, len)
      } catch (e) {}
    })
  }
})

const title = computed(() => {
  if (props.titleText) return props.titleText
  return props.multiCount > 1 ? `为 ${props.multiCount} 个节点设置备注` : '节点备注'
})

const placeholderText = computed(() => props.placeholder || '输入节点备注（支持多行），悬停节点图标时显示')

const onSave = () => emit('save', text.value)
const onClear = () => emit('clear')
const onClose = () => emit('close')

const onKeydown = (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    onClose()
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    onSave()
  }
}
</script>

<style scoped>
/* ============ 节点旁跟随悬浮窗 ============ */
.note-popover {
  position: fixed;
  z-index: 3100;
  width: 340px;
  max-width: calc(100vw - 48px);
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  padding: 12px 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.note-popover-arrow {
  position: absolute;
  left: -6px;
  top: 22px;
  width: 0;
  height: 0;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  border-right: 6px solid #fff;
}

/* ============ 居中模态 ============ */
.note-dialog-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3100;
}
.note-dialog {
  width: 460px;
  max-width: calc(100vw - 48px);
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ============ 通用内部结构 ============ */
.note-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.note-dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: #1d1d1f;
}
.note-dialog-close {
  border: none;
  background: none;
  color: #999;
  font-size: 13px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.note-dialog-close:hover {
  background: #f2f2f2;
  color: #333;
}
.note-dialog-node {
  font-size: 12px;
  color: #888;
  background: #f7f7f9;
  border-radius: 6px;
  padding: 4px 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note-dialog-textarea {
  width: 100%;
  height: 140px;
  resize: vertical;
  border: 1px solid #e0e0e6;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.6;
  color: #333;
  outline: none;
  font-family: inherit;
  box-sizing: border-box;
}
.note-popover .note-dialog-textarea {
  height: 120px;
}
.note-dialog-textarea:focus {
  border-color: #a8bfff;
  box-shadow: 0 0 0 2px rgba(41, 128, 185, 0.12);
}
.note-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.note-dialog-tip {
  font-size: 11px;
  color: #aaa;
}
.note-dialog-actions {
  display: flex;
  gap: 8px;
}
.note-btn {
  border: 1px solid #e0e0e6;
  background: #fff;
  color: #555;
  font-size: 12px;
  padding: 5px 14px;
  border-radius: 6px;
  cursor: pointer;
}
.note-btn:hover {
  border-color: #c9c9d4;
  background: #fafafa;
}
.note-btn-primary {
  background: #2980b9;
  border-color: #2980b9;
  color: #fff;
}
.note-btn-primary:hover {
  background: #2472a6;
}
.note-btn-clear {
  color: #e74c3c;
  border-color: #f2c4c0;
}
.note-btn-clear:hover {
  background: #fdf3f2;
  border-color: #e74c3c;
}
.note-dialog-enter-active,
.note-dialog-leave-active {
  transition: opacity 0.15s ease;
}
.note-dialog-enter-from,
.note-dialog-leave-to {
  opacity: 0;
}
</style>
