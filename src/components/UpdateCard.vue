<template>
  <div v-if="visible" class="update-card">
    <!-- 发现新版本：还没开始下载 -->
    <template v-if="state.status === 'available'">
      <div class="update-card-head">
        <span class="update-card-title">发现新版本 {{ state.latestVersion }}</span>
        <button class="update-card-close" title="稍后" @click="dismiss">✕</button>
      </div>
      <div class="update-card-body">
        当前版本 {{ state.currentVersion }}。{{ modeHint }}
      </div>
      <div class="update-card-actions">
        <button class="update-btn primary" :disabled="busy" @click="start">{{ primaryText }}</button>
        <button v-if="canDownload" class="update-btn" :disabled="busy" @click="openPage">前往下载页</button>
      </div>
    </template>

    <!-- 下载中 -->
    <template v-else-if="state.status === 'downloading'">
      <div class="update-card-head">
        <span class="update-card-title">正在后台下载 {{ state.latestVersion }}</span>
      </div>
      <div class="update-card-body">
        <div class="update-progress-track">
          <div class="update-progress-fill" :style="{ width: state.percent + '%' }"></div>
        </div>
        <div class="update-progress-meta">
          <span>{{ state.percent }}%</span>
          <span>{{ formatBytes(state.receivedBytes) }} / {{ formatBytes(state.totalBytes) }}</span>
          <span v-if="state.bytesPerSecond">{{ formatBytes(state.bytesPerSecond) }}/s</span>
        </div>
      </div>
      <div class="update-card-actions">
        <button class="update-btn" @click="cancel">取消下载</button>
      </div>
    </template>

    <!-- 已下载完成，等待重启安装 -->
    <template v-else-if="state.status === 'ready'">
      <div class="update-card-head">
        <span class="update-card-title">更新包已就绪 {{ state.latestVersion }}</span>
        <button class="update-card-close" title="稍后" @click="dismiss">✕</button>
      </div>
      <div class="update-card-body">
        {{ readyHint }}
      </div>
      <div class="update-card-actions">
        <button class="update-btn primary" :disabled="busy" @click="install">{{ installText }}</button>
      </div>
    </template>

    <!-- 安装中 -->
    <template v-else-if="state.status === 'installing'">
      <div class="update-card-head">
        <span class="update-card-title">正在安装 {{ state.latestVersion }}</span>
      </div>
      <div class="update-card-body">程序即将退出并自动完成安装，请稍候…</div>
    </template>

    <!-- 失败 -->
    <template v-else-if="state.status === 'error'">
      <div class="update-card-head">
        <span class="update-card-title">更新失败</span>
        <button class="update-card-close" title="关闭" @click="dismiss">✕</button>
      </div>
      <div class="update-card-body">{{ state.message || '下载失败，请稍后重试' }}</div>
      <div class="update-card-actions">
        <button class="update-btn primary" :disabled="busy" @click="retry">重试</button>
        <button class="update-btn" @click="openPage">前往下载页</button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import {
  updateState as state,
  downloadUpdate,
  cancelDownload,
  installUpdate,
  openReleasePage,
  formatBytes
} from '../services/updateService'

const busy = ref(false)
// 用户手动点「稍后」时只隐藏卡片，不改变主进程的下载/就绪状态
const hidden = ref(false)

// 状态一变（例如开始下载）就重新显示，避免「稍后」之后再也看不到进度
watch(() => state.status, (next) => {
  if (next === 'downloading' || next === 'installing') hidden.value = false
})

const visible = computed(() => state.status !== 'idle' && !hidden.value)

const canDownload = computed(() => state.installMode !== 'open-page')

const primaryText = computed(() => (canDownload.value ? '后台下载' : '前往下载页'))

const modeHint = computed(() => {
  if (state.installMode === 'silent') return '可在后台下载，下载完成后重启即可自动安装。'
  if (state.installMode === 'open-file') return '下载完成后需要打开安装包，按系统提示完成安装。'
  return '当前系统没有可自动安装的安装包，请前往下载页手动选择。'
})

const readyHint = computed(() => (
  state.installMode === 'silent'
    ? '点击「重启并安装」后程序会退出并自动完成安装。'
    : '点击「打开安装包」后会调用系统安装程序完成安装。'
))

const installText = computed(() => (state.installMode === 'silent' ? '重启并安装' : '打开安装包'))

const dismiss = () => { hidden.value = true }

const start = async () => {
  if (state.installMode === 'open-page') {
    await openPage()
    return
  }
  busy.value = true
  try { await downloadUpdate() } finally { busy.value = false }
}

const cancel = async () => { await cancelDownload() }

const retry = async () => {
  busy.value = true
  try {
    if (state.installMode === 'open-page') await openReleasePage()
    else await downloadUpdate()
  } finally { busy.value = false }
}

const install = async () => {
  busy.value = true
  try { await installUpdate() } finally { busy.value = false }
}

const openPage = async () => { await openReleasePage() }
</script>

<style scoped>
.update-card {
  position: fixed;
  right: 18px;
  bottom: 18px;
  width: 320px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
  z-index: 7100;
  font-size: 13px;
  color: #303133;
}
.update-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.update-card-title {
  font-weight: 600;
}
.update-card-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: #909399;
  font-size: 13px;
  line-height: 1;
  padding: 2px 4px;
}
.update-card-close:hover {
  color: #606266;
}
.update-card-body {
  color: #606266;
  line-height: 1.6;
}
.update-progress-track {
  height: 6px;
  border-radius: 3px;
  background: #ebeef5;
  overflow: hidden;
}
.update-progress-fill {
  height: 100%;
  background: #409eff;
  transition: width 0.25s ease;
}
.update-progress-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  color: #909399;
  font-size: 12px;
}
.update-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.update-btn {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid #dcdfe6;
  background: #fff;
  color: #606266;
  cursor: pointer;
  font-size: 12px;
}
.update-btn:hover:not(:disabled) {
  color: #409eff;
  border-color: #c6e2ff;
}
.update-btn.primary {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}
.update-btn.primary:hover:not(:disabled) {
  background: #66b1ff;
  border-color: #66b1ff;
  color: #fff;
}
.update-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
