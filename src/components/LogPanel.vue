<template>
  <div class="log-panel">
    <!-- 头部 -->
    <div class="log-header">
      <span class="log-title">运行日志</span>
      <div class="log-actions">
        <button class="log-action-btn" @click="refreshLogs" title="刷新">
          <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
            <path d="M16 10a6 6 0 1 1-1.76-4.24M16 4v3h-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        </button>
        <button class="log-action-btn" @click="copyAllLogs" title="复制当前对话所有日志">
          <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
            <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.3" fill="none"/>
          </svg>
        </button>
        <button class="log-action-btn" @click="copyLastTurnLogs" title="复制最近一次对话日志">
          <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
            <rect x="5" y="3.5" width="10" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M7 7.5h6M7 10.5h6M7 13.5h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="log-action-btn danger" @click="confirmClear" title="清空当前对话日志">
          <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
            <path d="M5 7h10M8 7V5h4v2M7 7l1 9h4l1-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        </button>
        <button class="log-action-btn" @click="$emit('close')" title="关闭">
          <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 日志统计（点击徽章筛选对应类型，再次点击取消筛选） -->
    <div class="log-stats" v-if="logs.length > 0">
      <button
        class="stat-badge send"
        :class="{ active: activeFilter === 'send' }"
        @click="toggleFilter('send')"
        title="点击只看发送的消息，再次点击取消筛选"
      >发送 {{ sendCount }}</button>
      <button
        class="stat-badge receive"
        :class="{ active: activeFilter === 'receive' }"
        @click="toggleFilter('receive')"
        title="点击只看返回的消息，再次点击取消筛选"
      >返回 {{ receiveCount }}</button>
      <button
        class="stat-badge tool"
        v-if="toolCallCount > 0 || activeFilter === 'tool'"
        :class="{ active: activeFilter === 'tool' }"
        @click="toggleFilter('tool')"
        title="点击只看工具调用/返回/报错日志，再次点击取消筛选"
      >工具 {{ toolCallCount }}</button>
      <button
        class="stat-badge error"
        v-if="errorCount > 0 || activeFilter === 'error'"
        :class="{ active: activeFilter === 'error' }"
        @click="toggleFilter('error')"
        title="点击只看错误日志（含工具报错），再次点击取消筛选"
      >错误 {{ errorCount }}</button>
      <span class="stat-badge auto-clear">30天自动清除</span>
      <button
        class="stat-badge download-trace"
        v-if="logs.length > 0"
        @click="downloadTraceJsonl"
        title="下载本次会话的全部日志为 .jsonl 文件（review #16 行为回放）"
      >下载回放 .jsonl</button>
    </div>

    <!-- 日志列表 -->
    <div class="log-list" ref="logListRef">
      <div v-if="logs.length === 0" class="log-empty">
        暂无日志记录
      </div>
      <div v-else-if="filteredLogs.length === 0" class="log-empty">
        「{{ filterLabel(activeFilter) }}」类型下暂无日志
      </div>
      <div
        v-for="log in filteredLogs"
        :key="log.id"
        class="log-entry"
        :class="log.type"
      >
        <div class="log-entry-header">
          <span class="log-type-tag" :class="log.type">{{ typeLabel(log.type) }}</span>
          <span v-if="log.level && log.level !== 'info'" class="log-level-tag" :class="'level-' + log.level">{{ log.level }}</span>
          <span v-if="log.event" class="log-event-tag" :title="log.event">{{ log.event }}</span>
          <span class="log-time">{{ formatLogTime(log.timestamp) }}</span>
          <span class="log-duration" v-if="log.durationMs !== undefined">{{ log.durationMs }}ms</span>
          <span class="log-model" v-if="log.model">{{ log.model }}</span>
        </div>
        <div
          class="log-content"
          :class="{ expanded: expandedIds.has(log.id) }"
          :title="'点击展开/收起完整内容'"
          @click="toggleExpand(log.id)"
        >{{ log.content }}</div>
        <div class="log-meta" v-if="log.toolCalls && log.toolCalls.length > 0">
          <span class="log-tool" v-for="(tc, i) in log.toolCalls" :key="i">
            {{ tc.displayName || tc.name }}: {{ tc.status }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { loadLogsByConversation, clearLogsByConversation, formatLogTime } from '../utils/logStore'

const props = defineProps({
  refreshSignal: {
    type: Number,
    default: 0
  },
  conversationId: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close'])

const logs = ref([])
const logListRef = ref(null)

// 当前筛选类型：null（全部）| 'send' | 'receive' | 'tool' | 'error'
const activeFilter = ref(null)

const sendCount = computed(() => logs.value.filter(l => l.type === 'send').length)
const receiveCount = computed(() => logs.value.filter(l => l.type === 'receive').length)
const errorCount = computed(() => logs.value.filter(l => l.type === 'error' || l.type === 'tool_error').length)
const toolCallCount = computed(() => logs.value.filter(l => l.type === 'tool_call' || l.type === 'tool_result' || l.type === 'tool_error' || l.type === 'tool_rejected').length)

// 点击徽章切换筛选；再点一次同类型则取消
const toggleFilter = (filter) => {
  activeFilter.value = activeFilter.value === filter ? null : filter
}

const filterLabel = (f) => {
  const map = { send: '发送', receive: '返回', tool: '工具', error: '错误' }
  return map[f] || f
}

const filteredLogs = computed(() => {
  const f = activeFilter.value
  if (!f) return logs.value
  if (f === 'tool') {
    return logs.value.filter(l => l.type === 'tool_call' || l.type === 'tool_result' || l.type === 'tool_error' || l.type === 'tool_rejected')
  }
  if (f === 'error') {
    return logs.value.filter(l => l.type === 'error' || l.type === 'tool_error')
  }
  return logs.value.filter(l => l.type === f)
})

const typeLabel = (type) => {
  switch (type) {
    case 'send': return '发送'
    case 'receive': return '返回'
    case 'error': return '错误'
    case 'info': return '信息'
    case 'tool_call': return '工具调用'
    case 'tool_result': return '工具返回'
    case 'tool_error': return '工具错误'
    case 'tool_rejected': return '工具取消'
    case 'abort': return '停止'
    case 'compress': return '压缩'
    case 'ocr': return 'OCR'
    case 'plan': return '计划'
    case 'plan_step': return '计划步骤'
    case 'worker': return '子Agent'
    case 'metrics': return '指标'
    default: return type
  }
}

// 展开/收起完整日志内容
const expandedIds = ref(new Set())
const toggleExpand = (id) => {
  const next = new Set(expandedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  expandedIds.value = next
}

const refreshLogs = () => {
  logs.value = props.conversationId ? loadLogsByConversation(props.conversationId) : []
  scrollToBottom()
}

// 原生 confirm() 在 Electron 渲染进程中运行嵌套原生消息循环，可能永久阻塞界面，改用 ElMessageBox
const confirmClear = async () => {
  try {
    await ElMessageBox.confirm('确定要清空当前对话的日志吗？', '清空确认', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  clearLogsByConversation(props.conversationId)
  logs.value = []
}

const copyAllLogs = async () => {
  if (logs.value.length === 0) {
    ElMessage.info('当前对话暂无日志')
    return
  }
  const header = `# 运行日志（共 ${logs.value.length} 条）\n导出时间：${new Date().toLocaleString()}\n`
  const text = header + logs.value.map(log => {
    const time = formatLogTime(log.timestamp)
    const type = typeLabel(log.type)
    let line = `[${time}] [${type}]`
    if (log.model) line += ` [${log.model}]`
    if (log.toolName) line += ` [工具: ${log.toolName}]`
    line += `\n${log.content}`
    return line
  }).join('\n\n---\n\n')

  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`已复制 ${logs.value.length} 条日志`)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    ElMessage.success(`已复制 ${logs.value.length} 条日志`)
  }
}

// 复制最近一次对话（从最后一条"发送"起，到最新）的日志
const copyLastTurnLogs = async () => {
  if (logs.value.length === 0) {
    ElMessage.info('当前对话暂无日志')
    return
  }
  let startIndex = -1
  for (let i = logs.value.length - 1; i >= 0; i--) {
    if (logs.value[i].type === 'send') {
      startIndex = i
      break
    }
  }
  const turnLogs = startIndex >= 0 ? logs.value.slice(startIndex) : logs.value.slice(-1)
  const text = turnLogs.map(log => {
    const time = formatLogTime(log.timestamp)
    const type = typeLabel(log.type)
    let line = `[${time}] [${type}]`
    if (log.model) line += ` [${log.model}]`
    if (log.toolName) line += ` [工具: ${log.toolName}]`
    line += `\n${log.content}`
    return line
  }).join('\n\n---\n\n')

  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`已复制最近一次对话的 ${turnLogs.length} 条日志`)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    ElMessage.success(`已复制最近一次对话的 ${turnLogs.length} 条日志`)
  }
}

const scrollToBottom = () => {
  if (logListRef.value) {
    logListRef.value.scrollTop = logListRef.value.scrollHeight
  }
}

watch(() => props.refreshSignal, () => {
  refreshLogs()
})

watch(() => props.conversationId, () => {
  refreshLogs()
})

onMounted(() => {
  refreshLogs()
})
</script>

<style scoped>
.log-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--ai-panel-bg, rgba(255, 255, 255, 0.72));
  -webkit-backdrop-filter: var(--blur-amount, blur(20px)) var(--blur-saturate, saturate(180%));
  backdrop-filter: var(--blur-amount, blur(20px)) var(--blur-saturate, saturate(180%));
  border-left: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
}

.log-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
}

.log-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1d1d1f);
}

.log-actions {
  display: flex;
  gap: 4px;
}

.log-action-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-secondary, #86868b);
  transition: background-color 0.2s, color 0.2s;
}

.log-action-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary, #1d1d1f);
}

.log-action-btn.danger:hover {
  background: rgba(255, 59, 48, 0.1);
  color: #ff3b30;
}

.log-stats {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
}

.stat-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
  font-family: inherit;
  border: none;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s, box-shadow 0.15s;
}

.stat-badge:not(.auto-clear):hover {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}

.stat-badge.send {
  background: rgba(0, 122, 255, 0.1);
  color: #007aff;
}

.stat-badge.send.active {
  background: #007aff;
  color: #fff;
}

.stat-badge.receive {
  background: rgba(52, 199, 89, 0.1);
  color: #34c759;
}

.stat-badge.receive.active {
  background: #34c759;
  color: #fff;
}

.stat-badge.error {
  background: rgba(255, 59, 48, 0.1);
  color: #ff3b30;
}

.stat-badge.error.active {
  background: #ff3b30;
  color: #fff;
}

.stat-badge.tool {
  background: rgba(255, 149, 0, 0.1);
  color: #ff9500;
}

.stat-badge.tool.active {
  background: #ff9500;
  color: #fff;
}

.stat-badge.auto-clear {
  background: rgba(120, 120, 128, 0.08);
  color: #86868b;
  margin-left: auto;
  cursor: default;
}

.log-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}

.log-level-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  margin-left: 4px;
  text-transform: uppercase;
}
.log-level-tag.level-error { background: #fef0f0; color: #f56c6c; border: 1px solid #fbc4c4; }
.log-level-tag.level-warn { background: #fdf6ec; color: #e6a23c; border: 1px solid #f5dab1; }
.log-level-tag.level-debug { background: #f0f9ff; color: #909399; border: 1px solid #dcdfe6; }
.log-event-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  margin-left: 4px;
  background: rgba(64, 158, 255, 0.1);
  color: #409eff;
  border: 1px solid rgba(64, 158, 255, 0.3);
  font-family: monospace;
}

.log-empty {
  padding: 40px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary, #c7c7cc);
}

.log-entry {
  margin-bottom: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.02);
  border-left: 3px solid transparent;
  font-size: 12px;
  line-height: 1.5;
}

.log-entry.send {
  border-left-color: #007aff;
  background: rgba(0, 122, 255, 0.03);
}

.log-entry.receive {
  border-left-color: #34c759;
  background: rgba(52, 199, 89, 0.03);
}

.log-entry.error {
  border-left-color: #ff3b30;
  background: rgba(255, 59, 48, 0.03);
}

.log-entry.info {
  border-left-color: #8e8e93;
}

.log-entry.abort {
  border-left-color: #86868b;
  background: rgba(120, 120, 128, 0.03);
}

.log-entry.tool_call {
  border-left-color: #ff9500;
  background: rgba(255, 149, 0, 0.03);
}

.log-entry.tool_result {
  border-left-color: #34c759;
  background: rgba(52, 199, 89, 0.03);
}

.log-entry.tool_error {
  border-left-color: #ff3b30;
  background: rgba(255, 59, 48, 0.03);
}

.log-entry.tool_rejected {
  border-left-color: #8e8e93;
  background: rgba(142, 142, 147, 0.03);
}

.log-entry.compress,
.log-entry.ocr,
.log-entry.plan,
.log-entry.plan_step,
.log-entry.worker,
.log-entry.metrics {
  border-left-color: #5856d6;
  background: rgba(88, 86, 214, 0.03);
}

.log-entry-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.log-type-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.log-type-tag.send {
  background: rgba(0, 122, 255, 0.15);
  color: #007aff;
}

.log-type-tag.receive {
  background: rgba(52, 199, 89, 0.15);
  color: #248a3d;
}

.log-type-tag.error {
  background: rgba(255, 59, 48, 0.15);
  color: #d70015;
}

.log-type-tag.info {
  background: rgba(142, 142, 147, 0.15);
  color: #8e8e93;
}

.log-type-tag.tool_call {
  background: rgba(255, 149, 0, 0.15);
  color: #ff9500;
}

.log-type-tag.tool_result {
  background: rgba(52, 199, 89, 0.15);
  color: #248a3d;
}

.log-type-tag.tool_error {
  background: rgba(255, 59, 48, 0.15);
  color: #d70015;
}

.log-type-tag.tool_rejected {
  background: rgba(142, 142, 147, 0.15);
  color: #8e8e93;
}

.log-type-tag.compress,
.log-type-tag.ocr,
.log-type-tag.plan,
.log-type-tag.plan_step,
.log-type-tag.worker,
.log-type-tag.metrics {
  background: rgba(88, 86, 214, 0.15);
  color: #5856d6;
}

.log-time {
  font-size: 10px;
  color: var(--text-tertiary, #c7c7cc);
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.log-duration {
  font-size: 10px;
  color: #86868b;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.log-model {
  font-size: 10px;
  color: #86868b;
  margin-left: auto;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.log-content {
  color: var(--text-primary, #1d1d1f);
  word-break: break-word;
  white-space: pre-wrap;
  max-height: 160px;
  overflow-y: auto;
  cursor: pointer;
}

.log-content.expanded {
  max-height: none;
  overflow-y: visible;
}

.log-meta {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.log-tool {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(120, 120, 128, 0.1);
  color: #636366;
}

.log-list::-webkit-scrollbar {
  width: 5px;
}

.log-list::-webkit-scrollbar-track {
  background: transparent;
}

.log-list::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.12);
  border-radius: 3px;
}

.log-list::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.2);
}
</style>
