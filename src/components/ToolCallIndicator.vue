<template>
  <Transition name="indicator">
    <div
      v-if="status && status !== 'idle'"
      class="tool-indicator"
      :class="status"
    >
      <span class="indicator-icon">
        <span
          v-if="status === 'thinking' || status === 'calling'"
          class="spinner"
        ></span>
        <svg
          v-else-if="status === 'done'"
          class="check-icon"
          viewBox="0 0 16 16"
          fill="none"
        >
          <path
            d="M3.5 8.5L6.5 11.5L12.5 5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg
          v-else-if="status === 'error'"
          class="cross-icon"
          viewBox="0 0 16 16"
          fill="none"
        >
          <path
            d="M4 4L12 12M12 4L4 12"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </span>
      <span class="indicator-text">{{ statusText }}</span>
    </div>
  </Transition>
</template>

<script setup>
import { computed, watch, onBeforeUnmount } from 'vue'

const props = defineProps({
  status: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['dismiss'])

const statusTextMap = {
  thinking: 'AI 思考中...',
  calling: '正在调用工具...',
  done: '操作完成',
  error: '操作失败'
}

const statusText = computed(() => {
  return statusTextMap[props.status] || ''
})

// done 状态 3 秒、error 状态 5 秒后自动消失（错误详情在消息列表与运行日志中保留，
// 悬浮条只做瞬时状态提示，避免红色"操作失败"一直悬在底部）；
// 新状态到来时必须清除旧定时器，否则连续调用多个工具时，
// 前一个状态的定时器会把执行中的指示器顶掉
let dismissTimer = null

watch(
  () => props.status,
  (newStatus) => {
    if (dismissTimer) {
      clearTimeout(dismissTimer)
      dismissTimer = null
    }
    if (newStatus === 'done' || newStatus === 'error') {
      const delay = newStatus === 'error' ? 5000 : 3000
      dismissTimer = setTimeout(() => {
        dismissTimer = null
        if (props.status === 'done' || props.status === 'error') {
          emit('dismiss')
        }
      }, delay)
    }
  }
)

onBeforeUnmount(() => {
  if (dismissTimer) {
    clearTimeout(dismissTimer)
    dismissTimer = null
  }
})
</script>

<style scoped>
.tool-indicator {
  position: fixed;
  bottom: 20px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: var(--radius-xl);
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  box-shadow: var(--shadow-floating);
  -webkit-backdrop-filter: var(--blur-amount) var(--blur-saturate);
  backdrop-filter: var(--blur-amount) var(--blur-saturate);
  pointer-events: none;
  z-index: 9999;
  white-space: nowrap;
  transform: translateX(-50%);
}

/* thinking / calling - Apple Blue */
.tool-indicator.thinking,
.tool-indicator.calling {
  background-color: var(--apple-blue);
}

/* done - Apple Green */
.tool-indicator.done {
  background-color: var(--apple-green);
}

/* error - Apple Red */
.tool-indicator.error {
  background-color: var(--apple-red);
}

.indicator-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

/* Spinner */
.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Check / Cross icons */
.check-icon,
.cross-icon {
  width: 16px;
  height: 16px;
}

.indicator-text {
  line-height: 1;
}

/* Transition */
.indicator-enter-active,
.indicator-leave-active {
  transition: opacity var(--transition-standard),
    transform var(--transition-bounce);
}

.indicator-enter-from,
.indicator-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(16px) scale(0.9);
}

.indicator-enter-to,
.indicator-leave-from {
  opacity: 1;
  transform: translateX(-50%) translateY(0) scale(1);
}
</style>
