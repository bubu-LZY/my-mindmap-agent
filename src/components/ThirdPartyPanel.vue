<template>
  <div class="tp-embedded">
    <div class="tp-embedded-layout">
      <div class="tp-sidebar">
        <div class="tp-sidebar-title">消息来源</div>
        <div
          v-for="(channel, key) in thirdPartyChannels"
          :key="key"
          class="tp-channel"
          :class="{ active: activeChannel === key }"
          @click="selectChannel(key)"
        >
          <span class="tp-channel-name">{{ channel.label }}</span>
          <span v-if="channel.unread" class="tp-channel-unread">{{ channel.unread > 99 ? '99+' : channel.unread }}</span>
        </div>
      </div>
      <div class="tp-main" style="position: relative;">
        <div class="tp-main-header">
          <div class="tp-main-titles">
            <span class="tp-main-title">{{ thirdPartyChannels[activeChannel].label }}</span>
            <span class="tp-main-info">{{ thirdPartyChannels[activeChannel].messages.length }} 条记录</span>
          </div>
          <div class="tp-main-actions">
            <button class="tp-log-btn" @click="showLog = true" title="查看运行日志">
              <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
                <path d="M4 4h12v12H4V4z" stroke="currentColor" stroke-width="1.3" fill="none" rx="1.5"/>
                <path d="M6 7h8M6 10h8M6 13h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
              日志
            </button>
            <button class="tp-clear-btn" @click="clearChannel(activeChannel)">清空</button>
          </div>
        </div>
        <div class="tp-messages" ref="messagesRef">
          <div v-if="thirdPartyChannels[activeChannel].messages.length === 0" class="tp-empty">
            暂无来自{{ thirdPartyChannels[activeChannel].label }}的消息
          </div>
          <div
            v-for="(msg, i) in thirdPartyChannels[activeChannel].messages"
            :key="i"
            class="tp-msg"
            :class="msg.role"
          >
            <div v-if="msg.role === 'notice'" class="tp-notice">
              {{ msg.content }}
              <span class="tp-notice-time">{{ formatTpTime(msg.time) }}</span>
            </div>
            <template v-else>
              <div class="tp-bubble">
                <div
                  v-if="msg.role === 'assistant' && msg.content"
                  class="md-content"
                  v-html="renderMarkdown(stripThinkBlocks(msg.content))"
                  @click="onContentClick"
                ></div>
                <div v-else-if="msg.content" class="tp-text">{{ msg.content }}</div>
                <div v-if="msg.toolCalls && msg.toolCalls.length" class="tp-tool-calls">
                  <div v-for="(tc, j) in msg.toolCalls" :key="j" class="tp-tool-call" :class="tc.status">
                    <span v-if="tc.status === 'calling'" class="tool-spinner"></span>
                    <span v-else-if="tc.status === 'done'" class="tool-check">&#10003;</span>
                    <span v-else-if="tc.status === 'error'" class="tool-error">&#10007;</span>
                    <span v-else class="tool-stopped">&#9632;</span>
                    <span class="tp-tool-name">{{ tc.displayName || tc.name }}</span>
                  </div>
                </div>
              </div>
              <div class="tp-time">{{ formatTpTime(msg.time) }}</div>
            </template>
          </div>
        </div>
        <!-- 运行日志面板（覆盖在消息区域上方） -->
        <PanelRunLog
          v-if="showLog"
          :source="activeChannel"
          :refresh-signal="logRefreshSignal"
          @close="showLog = false"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, watch } from 'vue'
import { renderMarkdown } from '../utils/markdownRenderer'
import { stripThinkBlocks } from '../utils/thinkFilter'
import PanelRunLog from './PanelRunLog.vue'
import {
  thirdPartyChannels,
  clearThirdPartyChannel,
  selectThirdPartyChannel,
  formatTpTime
} from '../utils/thirdPartyStore'

const activeChannel = ref('wechat')
const messagesRef = ref(null)
const showLog = ref(false)
const logRefreshSignal = ref(0)

const selectChannel = (key) => {
  selectThirdPartyChannel(key, activeChannel)
}

const clearChannel = (key) => {
  clearThirdPartyChannel(key)
}

// 消息中心里的本地路径点击：交给 App 在应用内打开，而不是跳到系统资源管理器。
const onContentClick = (event) => {
  const fileEl = event.target?.closest?.('.md-file-path')
  if (!fileEl) return
  event.preventDefault()
  const path = fileEl.getAttribute('data-path') || fileEl.dataset?.path || ''
  if (path) {
    window.dispatchEvent(new CustomEvent('open-local-file', { detail: { path } }))
  }
}

// 打开日志时刷新信号
watch(showLog, (val) => {
  if (val) logRefreshSignal.value++
})

// 切换渠道时滚动到底部
watch(activeChannel, () => {
  nextTick(() => {
    if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  })
})

// 新消息到来时滚动到底部
watch(
  () => thirdPartyChannels[activeChannel.value]?.messages.length,
  () => {
    nextTick(() => {
      if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight
    })
  }
)
</script>

<style scoped>
.tp-embedded {
  width: 100%;
  border: 1px solid var(--border-color, #e5e5e7);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-secondary, #fafafa);
}
.tp-embedded-layout {
  display: flex;
  height: 420px;
}
.tp-sidebar {
  width: 110px;
  background: var(--bg-tertiary, #f2f2f7);
  border-right: 1px solid var(--border-color, #e5e5e7);
  padding: 10px 0;
  flex-shrink: 0;
  overflow-y: auto;
}
.tp-sidebar-title {
  font-size: 11px;
  color: var(--text-tertiary, #8e8e93);
  padding: 0 10px 8px;
  font-weight: 500;
}
.tp-channel {
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text-secondary, #3a3a3c);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: background 0.15s;
}
.tp-channel:hover {
  background: rgba(124, 58, 237, 0.06);
}
.tp-channel.active {
  background: rgba(124, 58, 237, 0.12);
  color: #7c3aed;
  font-weight: 500;
}
.tp-channel-unread {
  background: #ff3b30;
  color: #fff;
  font-size: 10px;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}
.tp-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.tp-main-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color, #e5e5e7);
  background: var(--bg-primary, #fff);
}
.tp-main-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tp-main-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1d1d1f);
}
.tp-main-info {
  font-size: 11px;
  color: var(--text-tertiary, #8e8e93);
}
.tp-main-actions {
  display: flex;
  gap: 8px;
}
.tp-log-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  background: rgba(124, 58, 237, 0.08);
  border: 1px solid rgba(124, 58, 237, 0.3);
  border-radius: 6px;
  color: #7c3aed;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.tp-log-btn:hover {
  background: rgba(124, 58, 237, 0.15);
  border-color: rgba(124, 58, 237, 0.5);
}
.tp-clear-btn {
  padding: 4px 10px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--border-color, #e5e5e7);
  border-radius: 6px;
  color: var(--text-secondary, #3a3a3c);
  cursor: pointer;
}
.tp-clear-btn:hover {
  border-color: #ff3b30;
  color: #ff3b30;
}
.tp-messages {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px;
  background: var(--bg-primary, #fff);
}
.tp-empty {
  text-align: center;
  color: var(--text-tertiary, #8e8e93);
  font-size: 13px;
  padding: 40px 0;
}
.tp-msg {
  margin-bottom: 10px;
}
.tp-msg.notice {
  text-align: center;
}
.tp-notice {
  display: inline-block;
  background: rgba(124, 58, 237, 0.08);
  color: #7c3aed;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 10px;
}
.tp-notice-time {
  margin-left: 8px;
  opacity: 0.6;
  font-size: 11px;
}
.tp-bubble {
  background: var(--bg-secondary, #f2f2f7);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary, #1d1d1f);
  word-break: break-word;
  line-height: 1.5;
  max-width: 100%;
}
.tp-msg.assistant .tp-bubble {
  background: rgba(124, 58, 237, 0.08);
}
.tp-msg.user .tp-bubble {
  background: rgba(120, 120, 128, 0.12);
}
.tp-text {
  white-space: pre-wrap;
}
.tp-time {
  font-size: 10px;
  color: var(--text-tertiary, #8e8e93);
  margin-top: 2px;
  padding-left: 4px;
}
.tp-tool-calls {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.tp-tool-call {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(124, 58, 237, 0.1);
  color: #7c3aed;
}
.tp-tool-call.error {
  background: rgba(255, 59, 48, 0.1);
  color: #ff3b30;
}
.tp-tool-call.done {
  background: rgba(52, 199, 89, 0.1);
  color: #34c759;
}
.tool-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: tp-spin 0.8s linear infinite;
}
@keyframes tp-spin {
  to { transform: rotate(360deg); }
}
.tool-check { color: #34c759; }
.tool-error { color: #ff3b30; }

/* markdown 内容样式 */
.tp-bubble :deep(p) { margin: 0 0 6px; }
.tp-bubble :deep(p:last-child) { margin-bottom: 0; }
.tp-bubble :deep(code) {
  background: rgba(0,0,0,0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
  font-family: 'SF Mono', Consolas, monospace;
}
.tp-bubble :deep(pre) {
  background: rgba(0,0,0,0.06);
  padding: 8px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 6px 0;
}
.tp-bubble :deep(pre code) {
  background: transparent;
  padding: 0;
}
.tp-bubble :deep(ul), .tp-bubble :deep(ol) {
  margin: 4px 0;
  padding-left: 18px;
}
.tp-bubble :deep(a) {
  color: #7c3aed;
  text-decoration: none;
}
.tp-bubble :deep(a:hover) { text-decoration: underline; }
</style>
