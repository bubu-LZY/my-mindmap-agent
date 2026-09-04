<template>
  <div class="feishu-panel" :class="{ embedded: embedded }" v-if="visible || embedded">
    <div class="feishu-header">
      <span class="feishu-title">三方链接</span>
      <div class="feishu-header-actions">
        <button
          class="feishu-log-btn"
          :class="{ active: runLogVisible }"
          :title="activeChannel === 'feishu' ? '飞书运行日志' : '微信运行日志'"
          @click="toggleRunLog"
        >
          <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
            <path d="M4 5h12M4 10h12M4 15h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          运行日志
        </button>
        <button v-if="!embedded" class="feishu-close" @click="$emit('close')">✕</button>
      </div>
    </div>

    <!-- 面板级运行日志（跟随当前页签渠道，格式与 AI 对话日志一致） -->
    <PanelRunLog
      v-if="runLogVisible"
      :source="activeChannel"
      :refreshSignal="runLogRefreshSignal"
      @close="runLogVisible = false"
    />

    <div class="channel-layout">
      <!-- 左侧渠道目录 -->
      <div class="channel-nav">
        <div class="channel-nav-title">推送渠道</div>
        <div class="channel-nav-item" :class="{ active: activeChannel === 'feishu' }" @click="activeChannel = 'feishu'">
          <span class="channel-name">飞书</span>
          <label class="channel-switch" title="启用飞书推送" @click.stop>
            <input type="checkbox" v-model="config.enabled" />
            <span class="switch-slider"></span>
          </label>
        </div>
        <div class="channel-nav-item" :class="{ active: activeChannel === 'wechat' }" @click="activeChannel = 'wechat'">
          <span class="channel-name">微信</span>
          <label class="channel-switch" title="启用微信推送" @click.stop>
            <input type="checkbox" v-model="wechatConfig.enabled" />
            <span class="switch-slider"></span>
          </label>
        </div>
        <div class="channel-nav-hint">开关开启的渠道，定时任务结果会自动推送到该渠道；两个都开则同时推送</div>
      </div>

      <!-- 右侧渠道内容 -->
      <div class="feishu-body" v-show="activeChannel === 'feishu'">
        <!-- 配置区域 -->
        <div class="feishu-section">
          <div class="section-title">飞书应用配置</div>
          <div v-if="!apiAvailable" class="browser-mode-warning">
            飞书集成仅在桌面应用模式下可用。请使用 <code>npm run electron:dev</code> 启动应用。
          </div>
          <div class="form-row">
            <label>App ID</label>
            <input v-model="config.appId" placeholder="cli_xxx" class="form-input" />
          </div>
          <div class="form-row">
            <label>App Secret</label>
            <input v-model="config.appSecret" type="password" :placeholder="hasSecret ? '已设置（输入新值覆盖）' : '应用密钥'" class="form-input" />
          </div>
          <div class="form-row">
            <label>访问域名</label>
            <input v-model="config.domain" placeholder="默认 www.feishu.cn（Lark 用户填 www.larksuite.com）" class="form-input" />
          </div>
          <div class="form-actions">
            <button class="btn-primary" @click="saveConfig">保存配置</button>
            <button class="btn-secondary" @click="testConnection" :disabled="testing">
              {{ testing ? '测试中...' : '测试连接' }}
            </button>
            <label class="enable-toggle">
              <input type="checkbox" v-model="config.enabled" />
              <span>启用飞书</span>
            </label>
          </div>
          <div v-if="testResult" class="test-result" :class="testResult.success ? 'success' : 'error'">
            {{ testResult.message }}
          </div>
        </div>

        <!-- 配置指南 -->
        <div class="feishu-section">
          <div class="section-title clickable" @click="guideOpen = !guideOpen">
            <svg class="guide-chevron" :class="{ open: guideOpen }" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
            </svg>
            配置指南
          </div>
          <Transition name="guide-slide">
            <div v-if="guideOpen" class="guide-content">
              <ol class="guide-steps">
                <li>
                  <strong>创建飞书应用</strong>
                  <p>访问 <a href="#" @click.prevent="openUrl('https://open.feishu.cn/app')">飞书开发者后台</a>，点击「创建企业自建应用」，填写应用名称和描述。</p>
                </li>
                <li>
                  <strong>获取 App ID 和 App Secret</strong>
                  <p>在应用的「凭证与基础信息」页面，复制 <code>App ID</code>（cli_ 开头）和 <code>App Secret</code>，填入上方配置。</p>
                </li>
                <li>
                  <strong>启用机器人能力</strong>
                  <p>在「应用能力 → 添加应用能力」中，启用「机器人」。</p>
                </li>
                <li>
                  <strong>配置事件订阅（长连接模式）</strong>
                  <p>进入「事件与回调 → 事件配置」：</p>
                  <ul>
                    <li>订阅方式选择「<strong>使用长连接接收事件</strong>」</li>
                    <li>添加事件：<code>im.message.receive_v1</code>（接收消息）</li>
                  </ul>
                </li>
                <li>
                  <strong>配置权限</strong>
                  <p>在「权限管理」中，搜索并开通以下权限：</p>
                  <ul>
                    <li><code>im:message</code> — 获取用户发给机器人的单聊消息</li>
                    <li><code>im:message.group_at_msg</code> — <strong>获取群组中@机器人的消息（群聊@必需）</strong></li>
                    <li><code>im:message:send_as_bot</code> — 获取与发送单聊、群组消息</li>
                    <li><code>im:chat:readonly</code> — 获取群组信息（可选，用于群聊列表）</li>
                    <li><code>im:resource</code> — 获取与发送图片、文件消息（可选）</li>
                  </ul>
                </li>
                <li>
                  <strong>发布应用版本</strong>
                  <p>在「版本管理与发布」中创建版本并提交审核（企业自建应用通常即时生效）。</p>
                </li>
                <li>
                  <strong>将机器人添加到群聊</strong>
                  <p>在飞书群聊中，点击群设置 → 群机器人 → 添加机器人 → 搜索你创建的应用名称并添加。</p>
                </li>
                <li>
                  <strong>启动机器人长连接</strong>
                  <p>保存配置后，在下方「机器人长连接」区域点击「启动」按钮。然后在飞书中 @机器人 发消息即可触发 AI 回复。</p>
                </li>
              </ol>
              <div class="guide-note">
                <strong>提示：</strong>长连接模式无需公网 URL、无需备案域名，应用启动后自动与飞书建立 WebSocket 通道。
              </div>
              <div class="guide-note" style="margin-top: 8px; background: rgba(255, 149, 0, 0.08);">
                <strong style="color: #ff9500;">群聊 @ 收不到消息？</strong> 请检查：
                ① 已开通 <code>im:message.group_at_msg</code> 权限；
                ② 已将机器人添加到群聊（群设置 → 群机器人 → 添加）；
                ③ 添加权限后已重新发布应用版本；
                ④ 发布后等待约 1 分钟生效。
              </div>
            </div>
          </Transition>
        </div>

        <!-- 消息发送 -->
        <div class="feishu-section" v-if="config.enabled">
          <div class="section-title">发送消息</div>
          <div class="form-row">
            <label>选择群聊</label>
            <select v-model="selectedChat" class="form-input">
              <option value="">请选择群聊</option>
              <option v-for="chat in chatList" :key="chat.chat_id" :value="chat.chat_id">
                {{ chat.name }}{{ chat.chat_id === defaultChatId ? '（默认推送）' : '' }}
              </option>
            </select>
            <button class="btn-small" @click="loadChats">刷新</button>
            <button class="btn-small" @click="setDefaultChat" :disabled="!selectedChat">设为默认推送</button>
          </div>
          <div class="form-row">
            <label>消息内容</label>
            <textarea v-model="messageText" rows="3" class="form-input" placeholder="输入消息内容..."></textarea>
          </div>
          <button class="btn-primary" @click="sendMessage" :disabled="sending">
            {{ sending ? '发送中...' : '发送消息' }}
          </button>
        </div>

        <!-- 文档操作 -->
        <div class="feishu-section" v-if="config.enabled">
          <div class="section-title">云文档操作</div>
          <div class="form-row">
            <button class="btn-secondary" @click="loadFiles">刷新文件列表</button>
          </div>
          <div class="form-row">
            <input v-model="searchQuery" placeholder="搜索云文档..." class="form-input" @keydown.enter="searchFiles" />
            <button class="btn-secondary" @click="searchFiles">搜索</button>
          </div>
          <div class="file-list" v-if="fileList.length > 0">
            <div v-for="file in fileList" :key="file.token" class="file-item">
              <span class="file-icon">{{ getFileIcon(file.type) }}</span>
              <span class="file-name">{{ file.name }}</span>
              <button class="btn-small" @click="downloadFile(file)">下载</button>
            </div>
          </div>
        </div>

        <!-- 机器人长连接 -->
        <div class="feishu-section" v-if="config.enabled">
          <div class="section-title">机器人长连接</div>
          <div class="bot-status-row">
            <span class="status-dot" :class="botConnected ? 'online' : 'offline'"></span>
            <span class="status-text">{{ botConnected ? '已连接' : '未连接' }}</span>
            <button class="btn-primary" @click="toggleBot" :disabled="botToggling">
              {{ botToggling ? '处理中...' : (botConnected ? '停止' : '启动') }}
            </button>
          </div>
          <div class="bot-hint" v-if="!botConnected">
            启动后，在飞书中 @机器人 发消息即可触发 AI 回复
          </div>
          <div class="bot-log" v-if="botMessages.length > 0">
            <div v-for="(msg, idx) in botMessages" :key="idx" class="bot-log-item">
              <span class="log-time">{{ formatTime(msg.timestamp) }}</span>
              <span class="log-dir" :class="msg.type">{{ msg.type === 'in' ? '收' : '回' }}</span>
              <span class="log-text">{{ msg.text }}</span>
            </div>
          </div>
        </div>

        <!-- AI 远程调用日志 -->
        <div class="feishu-section" v-if="config.enabled">
          <div class="section-title clickable" @click="callLogOpen = !callLogOpen">
            <svg class="guide-chevron" :class="{ open: callLogOpen }" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
            </svg>
            AI 远程调用日志
            <span class="call-log-count" v-if="callLogs.length > 0">{{ callLogs.length }}</span>
          </div>
          <Transition name="guide-slide">
            <div v-if="callLogOpen" class="call-log-container">
              <div class="call-log-stats" v-if="callLogs.length > 0">
                <span class="stat-badge receive">接收 {{ callLogReceiveCount }}</span>
                <span class="stat-badge send">回复 {{ callLogSendCount }}</span>
                <span class="stat-badge tool" v-if="callLogToolCount > 0">工具 {{ callLogToolCount }}</span>
                <span class="stat-badge error" v-if="callLogErrorCount > 0">错误 {{ callLogErrorCount }}</span>
                <span class="stat-badge auto-clear">30天自动清除</span>
              </div>
              <div class="call-log-list" v-if="callLogs.length > 0">
                <div v-for="log in callLogs" :key="log.id" class="call-log-entry" :class="log.type">
                  <div class="call-log-header">
                    <span class="call-log-type" :class="log.type">{{ callLogTypeLabel(log.type) }}</span>
                    <span class="call-log-time">{{ formatFeishuLogTime(log.timestamp) }}</span>
                  </div>
                  <div class="call-log-content">{{ truncateLog(log.content, 300) }}</div>
                </div>
              </div>
              <div v-else class="call-log-empty">暂无调用日志</div>
              <button class="btn-small danger" @click="clearCallLogs" v-if="callLogs.length > 0">清空日志</button>
            </div>
          </Transition>
        </div>
      </div>

      <!-- 微信内容区 -->
      <div class="feishu-body" v-show="activeChannel === 'wechat'">
        <!-- 微信配置 -->
        <div class="feishu-section">
          <div class="section-title">微信配置（官方 ClawBot）</div>
          <div v-if="!wechatApiAvailable" class="browser-mode-warning">
            微信集成仅在桌面应用模式下可用。请使用 <code>npm run electron:dev</code> 启动应用。
          </div>

          <div class="bot-status-row" v-if="wechatConfig.hasToken">
            <span class="status-dot online"></span>
            <span class="status-text">已登录{{ wechatConfig.loginTime ? ' · ' + formatDate(wechatConfig.loginTime) : '' }}</span>
            <button class="btn-small danger" @click="logoutWechat">退出登录</button>
          </div>

          <template v-if="!wechatConfig.hasToken">
            <div class="form-row">
              <button class="btn-primary" @click="startWechatLogin" :disabled="wechatLogging">
                {{ wechatLogging ? '获取中...' : (loginStatus === 'expired' || loginStatus === 'verify_code_blocked' ? '重新获取二维码' : '扫码登录') }}
              </button>
              <button class="btn-secondary" v-if="qrImageUrl || loginStatus" @click="cancelWechatLogin">取消</button>
            </div>
            <div class="qr-box" v-if="qrImageUrl">
              <img :src="qrImageUrl" class="qr-img" alt="微信登录二维码" />
              <div class="qr-status" :class="loginStatus">{{ loginMessage }}</div>
              <div class="verify-row" v-if="loginStatus === 'need_verifycode'">
                <input v-model="verifyCodeInput" class="form-input verify-input" placeholder="输入手机微信显示的数字" @keydown.enter="submitVerifyCode" />
                <button class="btn-primary" @click="submitVerifyCode">提交</button>
              </div>
            </div>
          </template>

          <div class="form-actions">
            <button class="btn-secondary" @click="testWechatConnection" :disabled="wechatTesting || !wechatConfig.hasToken">
              {{ wechatTesting ? '测试中...' : '测试连接' }}
            </button>
            <label class="enable-toggle">
              <input type="checkbox" v-model="wechatConfig.enabled" />
              <span>启用微信</span>
            </label>
          </div>
          <div v-if="wechatTestResult" class="test-result" :class="wechatTestResult.success ? 'success' : 'error'">
            {{ wechatTestResult.message }}
          </div>
        </div>

        <!-- 微信配置指南 -->
        <div class="feishu-section">
          <div class="section-title clickable" @click="wechatGuideOpen = !wechatGuideOpen">
            <svg class="guide-chevron" :class="{ open: wechatGuideOpen }" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
            </svg>
            配置指南
          </div>
          <Transition name="guide-slide">
            <div v-if="wechatGuideOpen" class="guide-content">
              <ol class="guide-steps">
                <li>
                  <strong>获取二维码</strong>
                  <p>点击「扫码登录」，应用会向微信官方 iLink Bot 服务申请登录二维码。</p>
                </li>
                <li>
                  <strong>手机扫码确认</strong>
                  <p>用手机微信扫描二维码并确认授权。若手机上显示一串数字（配对码），在输入框中提交该数字完成验证。</p>
                </li>
                <li>
                  <strong>建立推送会话</strong>
                  <p>登录成功后，用你的微信给机器人发一条消息（任意内容），应用会记录该联系人作为推送目标。</p>
                </li>
                <li>
                  <strong>启用推送</strong>
                  <p>打开左侧「微信」开关后：定时任务结果会自动推送到微信；AI 对话中也可直接说「把结果发到微信」触发推送工具。</p>
                </li>
                <li>
                  <strong>机器人监听</strong>
                  <p>扫码登录成功后消息监听会自动启动（下方状态显示「监听中」）。在微信里给机器人发消息即可远程调用本应用 AI，同时该联系人会被记录为推送目标。</p>
                </li>
              </ol>
              <div class="guide-note">
                <strong>提示：</strong>微信 ClawBot 为官方开放接口，凭证保存在本机，不会上传到任何第三方服务器。登录过期后重新扫码即可。
              </div>
            </div>
          </Transition>
        </div>

        <!-- 微信机器人监听 -->
        <div class="feishu-section" v-if="wechatConfig.hasToken">
          <div class="section-title">机器人消息监听</div>
          <div class="bot-status-row">
            <span class="status-dot" :class="wechatBotConnected ? 'online' : 'offline'"></span>
            <span class="status-text">{{ wechatBotConnected ? '监听中' : '未启动' }}</span>
            <button class="btn-primary" @click="toggleWechatBot" :disabled="wechatBotToggling">
              {{ wechatBotToggling ? '处理中...' : (wechatBotConnected ? '停止' : '启动') }}
            </button>
          </div>
          <div class="bot-hint" v-if="!wechatBotConnected">
            监听未运行：点击「启动」后在微信里给机器人发条消息，即可触发 AI 回复并记录推送联系人（正常情况下扫码登录后会自动启动）
          </div>
          <div class="bot-hint" v-else>
            监听运行中：用微信给机器人发条消息，即可触发 AI 回复并记录为推送联系人
          </div>
          <div class="bot-diag" v-if="wechatBotConnected" :class="{ err: monitorStatus && !monitorStatus.ok }">
            {{ monitorStatusText }}
          </div>
          <div class="bot-log" v-if="wechatBotMessages.length > 0">
            <div v-for="(msg, idx) in wechatBotMessages" :key="idx" class="bot-log-item">
              <span class="log-time">{{ formatTime(msg.timestamp) }}</span>
              <span class="log-dir" :class="msg.type">{{ msg.type === 'in' ? '收' : '回' }}</span>
              <span class="log-text">{{ msg.text }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, computed, watch } from 'vue'
import QRCode from 'qrcode'
import { feishuService } from '../services/feishuService'
import { feishuBotService } from '../services/feishuBotService'
import { wechatService } from '../services/wechatService'
import { loadFeishuLogs, clearFeishuLogs, formatFeishuLogTime, addFeishuLog } from '../utils/feishuLogStore'
import { addPanelLog } from '../utils/panelLogStore'
import PanelRunLog from './PanelRunLog.vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  embedded: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close'])

// 当前展示的渠道目录
const activeChannel = ref('feishu')

// 面板运行日志（与 AI 对话运行日志同构，按渠道隔离）
const runLogVisible = ref(false)
const runLogRefreshSignal = ref(0)
const toggleRunLog = () => {
  runLogVisible.value = !runLogVisible.value
  if (runLogVisible.value) runLogRefreshSignal.value++
}
// 写日志便捷方法：写入当前渠道的运行日志并在日志页打开时刷新
const panelLog = (source, type, content, meta) => {
  addPanelLog(source, type, content, meta)
  if (runLogVisible.value) runLogRefreshSignal.value++
}

// 响应式状态（飞书）
const config = reactive({
  appId: '',
  appSecret: '',
  enabled: false,
  domain: '',
  defaultChatId: ''
})
const defaultChatId = ref('')
const hasSecret = ref(false)
const apiAvailable = ref(feishuService.isAvailable())

const testResult = ref(null)
const testing = ref(false)
const chatList = ref([])
const selectedChat = ref('')
const messageText = ref('')
const sending = ref(false)
const fileList = ref([])
const searchQuery = ref('')

// 机器人长连接状态（飞书）
const botConnected = ref(false)
const botToggling = ref(false)
const botMessages = ref([])
const guideOpen = ref(false)

// 响应式状态（微信）
const wechatApiAvailable = ref(wechatService.isAvailable())
const wechatConfig = reactive({
  enabled: false,
  hasToken: false,
  botId: '',
  userId: '',
  loginTime: ''
})
const wechatTestResult = ref(null)
const wechatTesting = ref(false)
const wechatGuideOpen = ref(false)

// 微信扫码登录状态
const qrImageUrl = ref('')
const loginStatus = ref('')
const loginMessage = ref('')
const verifyCodeInput = ref('')
const wechatLogging = ref(false)
// 登录会话代数：每次开始/取消登录时自增，旧轮询循环检测到代数变化即退出，
// 避免旧循环在长轮询挂起期间与新循环并发，覆盖状态或死锁配对码等待
let loginSession = 0
let verifyResolver = null

// 微信机器人监听状态
const wechatBotConnected = ref(false)
const wechatBotToggling = ref(false)
const wechatBotMessages = ref([])
// 监听轮询诊断状态（每次 getupdates 的结果）
const monitorStatus = ref(null)
const monitorStatusText = computed(() => {
  const s = monitorStatus.value
  if (!s) return '等待首次轮询…'
  const time = new Date(s.timestamp).toLocaleTimeString('zh-CN', { hour12: false })
  if (s.ok) return `${time} 轮询正常${s.msgCount ? `，收到 ${s.msgCount} 条消息` : '（暂无新消息）'}`
  return `${time} 轮询异常：${s.error}${s.debug ? `\n服务端响应：${s.debug}` : ''}`
})

// AI 远程调用日志
const callLogOpen = ref(false)
const callLogs = ref([])
const callLogReceiveCount = computed(() => callLogs.value.filter(l => l.type === 'receive').length)
const callLogSendCount = computed(() => callLogs.value.filter(l => l.type === 'send').length)
const callLogToolCount = computed(() => callLogs.value.filter(l => l.type === 'tool_call' || l.type === 'tool_result' || l.type === 'tool_error').length)
const callLogErrorCount = computed(() => callLogs.value.filter(l => l.type === 'error').length)

function callLogTypeLabel(type) {
  switch (type) {
    case 'receive': return '接收'
    case 'send': return '回复'
    case 'tool_call': return '工具调用'
    case 'tool_result': return '工具返回'
    case 'tool_error': return '工具错误'
    case 'error': return '错误'
    default: return type
  }
}

function truncateLog(text, maxLen) {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

function refreshCallLogs() {
  callLogs.value = loadFeishuLogs()
}

function clearCallLogs() {
  clearFeishuLogs()
  callLogs.value = []
}

function openUrl(url) {
  // Electron 渲染进程中 window.open 不会在系统默认浏览器打开，
  // 需走主进程 shell.openExternal。
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url)
  } else {
    window.open(url, '_blank')
  }
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function formatDate(iso) {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

/* ==================== 飞书 ==================== */

async function checkBotStatus() {
  if (!feishuBotService.isAvailable()) return
  try {
    const res = await feishuBotService.status()
    botConnected.value = res.connected
  } catch {}
}

async function toggleBot() {
  if (!feishuBotService.isAvailable()) {
    testResult.value = { success: false, message: '飞书 Bot API 不可用，请在桌面应用中运行' }
    return
  }
  botToggling.value = true
  try {
    if (botConnected.value) {
      const res = await feishuBotService.stop()
      botConnected.value = false
      testResult.value = { success: true, message: res.message || '已断开' }
      panelLog('feishu', 'info', `机器人长连接已停止：${res.message || '已断开'}`)
    } else {
      const res = await feishuBotService.start()
      if (res.success) {
        botConnected.value = true
        testResult.value = { success: true, message: res.message || '连接成功' }
        panelLog('feishu', 'info', `机器人长连接已启动：${res.message || '连接成功'}`)
      } else {
        testResult.value = { success: false, message: res.error || '连接失败' }
        panelLog('feishu', 'error', `机器人长连接启动失败：${res.error || '连接失败'}`)
      }
    }
    setTimeout(() => { testResult.value = null }, 4000)
  } catch (err) {
    testResult.value = { success: false, message: err.message }
    panelLog('feishu', 'error', `机器人长连接操作失败：${err.message}`)
  } finally {
    botToggling.value = false
  }
}

// 注册消息回调（保存注销函数，卸载时注销，防止面板反复开关导致监听器累积、消息重复处理）
const botMessageDisposers = []
const disposeBotListeners = () => {
  while (botMessageDisposers.length) {
    const dispose = botMessageDisposers.pop()
    try { dispose && dispose() } catch (e) {}
  }
}
botMessageDisposers.push(feishuBotService.onMessageReceived?.((data) => {
  botMessages.value.push({ type: 'in', text: data.text, timestamp: data.timestamp })
  if (botMessages.value.length > 50) botMessages.value.shift()
  addFeishuLog('receive', data.text, { sender: data.senderName })
  panelLog('feishu', 'receive', `收到机器人消息${data.senderName ? `（来自 ${data.senderName}）` : ''}：${data.text}`)
  refreshCallLogs()
}))
botMessageDisposers.push(feishuBotService.onReplySent?.((data) => {
  botMessages.value.push({ type: 'out', text: data.text, timestamp: data.timestamp })
  if (botMessages.value.length > 50) botMessages.value.shift()
  addFeishuLog('send', data.text)
  panelLog('feishu', 'send', `AI 回复已发送：${data.text}`)
  refreshCallLogs()
}))

// 加载配置（飞书）
async function loadConfig() {
  try {
    const result = await feishuService.getConfig()
    config.appId = result.appId || ''
    config.appSecret = ''
    hasSecret.value = result.hasSecret || false
    config.enabled = result.enabled || false
    config.domain = result.domain || ''
    config.defaultChatId = result.defaultChatId || ''
    defaultChatId.value = config.defaultChatId
  } catch (err) {
    console.error('[飞书] 加载配置失败:', err)
    testResult.value = { success: false, message: `加载配置失败: ${err.message}` }
  }
}

// 保存配置（飞书）
async function saveConfig() {
  try {
    await feishuService.setConfig({
      appId: config.appId,
      appSecret: config.appSecret,
      enabled: config.enabled,
      domain: config.domain,
      defaultChatId: config.defaultChatId
    })
    // 空密钥时后端保留旧密钥（appSecret || oldConfig.appSecret），
    // 因此仅在输入了新值时置真，否则占位符会从"已设置"退回"应用密钥"，误导用户以为密钥丢失
    if (config.appSecret) {
      hasSecret.value = true
    }
    config.appSecret = ''
    testResult.value = { success: true, message: '配置保存成功' }
    panelLog('feishu', 'info', '飞书应用配置已保存')
    setTimeout(() => { testResult.value = null }, 3000)
  } catch (err) {
    console.error('[飞书] 保存配置失败:', err)
    testResult.value = { success: false, message: `保存配置失败: ${err.message}` }
    panelLog('feishu', 'error', `保存配置失败: ${err.message}`)
  }
}

// 左侧目录开关切换（飞书）：立即持久化
async function saveFeishuEnabled() {
  try {
    await feishuService.setConfig({
      appId: config.appId,
      appSecret: '',
      enabled: config.enabled,
      domain: config.domain,
      defaultChatId: config.defaultChatId
    })
  } catch (err) {
    console.error('[飞书] 保存开关失败:', err)
    testResult.value = { success: false, message: `保存开关失败: ${err.message}` }
  }
}

// 设置默认推送群聊（定时任务结果推送到该群）
async function setDefaultChat() {
  if (!selectedChat.value) return
  try {
    config.defaultChatId = selectedChat.value
    defaultChatId.value = selectedChat.value
    await feishuService.setConfig({
      appId: config.appId,
      appSecret: '',
      enabled: config.enabled,
      domain: config.domain,
      defaultChatId: config.defaultChatId
    })
    testResult.value = { success: true, message: '已设为默认推送群聊' }
    setTimeout(() => { testResult.value = null }, 3000)
  } catch (err) {
    testResult.value = { success: false, message: `设置失败: ${err.message}` }
  }
}

// 测试连接（飞书）
async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    const result = await feishuService.testConnection()
    testResult.value = {
      success: result.success,
      message: result.success ? '连接成功' : `连接失败: ${result.message || '未知错误'}`
    }
    panelLog('feishu', result.success ? 'info' : 'error', `测试连接：${result.success ? '连接成功' : `连接失败：${result.message || '未知错误'}`}`)
  } catch (err) {
    console.error('[飞书] 测试连接失败:', err)
    testResult.value = { success: false, message: `测试连接失败: ${err.message}` }
    panelLog('feishu', 'error', `测试连接失败: ${err.message}`)
  } finally {
    testing.value = false
  }
}

// 加载群聊列表
async function loadChats() {
  try {
    const result = await feishuService.listChats()
    chatList.value = result.items || result.chats || []
  } catch (err) {
    console.error('[飞书] 加载群聊失败:', err)
    testResult.value = { success: false, message: `加载群聊失败: ${err.message}` }
  }
}

// 发送消息（飞书）
async function sendMessage() {
  if (!selectedChat.value) {
    testResult.value = { success: false, message: '请先选择群聊' }
    return
  }
  if (!messageText.value.trim()) {
    testResult.value = { success: false, message: '请输入消息内容' }
    return
  }
  sending.value = true
  try {
    panelLog('feishu', 'send', `发送消息到群聊：${messageText.value}`)
    await feishuService.sendTextMessage(selectedChat.value, messageText.value)
    testResult.value = { success: true, message: '消息发送成功' }
    panelLog('feishu', 'info', '消息发送成功')
    messageText.value = ''
    setTimeout(() => { testResult.value = null }, 3000)
  } catch (err) {
    console.error('[飞书] 发送消息失败:', err)
    testResult.value = { success: false, message: `发送消息失败: ${err.message}` }
    panelLog('feishu', 'error', `发送消息失败: ${err.message}`)
  } finally {
    sending.value = false
  }
}

// 加载文件列表
async function loadFiles() {
  try {
    const result = await feishuService.listFiles()
    fileList.value = result.files || result.items || []
  } catch (err) {
    console.error('[飞书] 加载文件列表失败:', err)
    testResult.value = { success: false, message: `加载文件列表失败: ${err.message}` }
  }
}

// 搜索文件
async function searchFiles() {
  if (!searchQuery.value.trim()) {
    testResult.value = { success: false, message: '请输入搜索关键词' }
    return
  }
  try {
    const result = await feishuService.searchFiles(searchQuery.value.trim())
    fileList.value = result.files || result.items || result.entities || []
  } catch (err) {
    console.error('[飞书] 搜索文件失败:', err)
    testResult.value = { success: false, message: `搜索文件失败: ${err.message}` }
  }
}

// 下载文件
async function downloadFile(file) {
  try {
    const savePath = await window.electronAPI?.dialog?.showSaveDialog({
      title: '保存文件',
      defaultPath: file.name || '下载文件',
      buttonLabel: '保存'
    })
    if (!savePath) return
    await feishuService.downloadFile(file.token, savePath)
    testResult.value = { success: true, message: '文件下载成功' }
    setTimeout(() => { testResult.value = null }, 3000)
  } catch (err) {
    console.error('[飞书] 下载文件失败:', err)
    testResult.value = { success: false, message: `下载文件失败: ${err.message}` }
  }
}

// 获取文件图标
function getFileIcon(type) {
  const iconMap = {
    doc: '📄',
    sheet: '📊',
    bitable: '📋',
    mindnote: '🧠',
    folder: '📁',
    file: '📎'
  }
  return iconMap[type] || '📎'
}

/* ==================== 微信 ==================== */

async function loadWechatConfig() {
  try {
    const c = await wechatService.getConfig()
    wechatConfig.enabled = !!c.enabled
    wechatConfig.hasToken = !!c.hasToken
    wechatConfig.botId = c.botId || ''
    wechatConfig.userId = c.userId || ''
    wechatConfig.loginTime = c.loginTime || ''
  } catch (err) {
    console.error('[微信] 加载配置失败:', err)
    wechatTestResult.value = { success: false, message: `加载配置失败: ${err.message}` }
  }
}

async function saveWechatEnabled() {
  try {
    await wechatService.setConfig({ enabled: wechatConfig.enabled })
  } catch (err) {
    console.error('[微信] 保存开关失败:', err)
    wechatTestResult.value = { success: false, message: `保存开关失败: ${err.message}` }
  }
}

// 监听 wechatConfig.enabled 变化，持久化到主进程
watch(() => wechatConfig.enabled, (newVal) => {
  saveWechatEnabled()

  // 关闭启用开关时，同时停止机器人监听
  if (!newVal && wechatBotConnected.value) {
    toggleWechatBot()
  }
})

async function testWechatConnection() {
  wechatTesting.value = true
  wechatTestResult.value = null
  try {
    const result = await wechatService.testConnection()
    wechatTestResult.value = {
      success: result.success,
      message: result.success ? '连接成功' : `连接失败: ${result.message || '未知错误'}`
    }
    panelLog('wechat', result.success ? 'info' : 'error', `测试连接：${result.success ? '连接成功' : `连接失败：${result.message || '未知错误'}`}`)
  } catch (err) {
    console.error('[微信] 测试连接失败:', err)
    wechatTestResult.value = { success: false, message: `测试连接失败: ${err.message}` }
    panelLog('wechat', 'error', `测试连接失败: ${err.message}`)
  } finally {
    wechatTesting.value = false
  }
}

async function logoutWechat() {
  try {
    await wechatService.logout()
    wechatBotConnected.value = false
    await loadWechatConfig()
    wechatTestResult.value = { success: true, message: '已退出微信登录' }
    setTimeout(() => { wechatTestResult.value = null }, 3000)
  } catch (err) {
    wechatTestResult.value = { success: false, message: `退出失败: ${err.message}` }
  }
}

// 获取二维码并开始轮询扫码状态
async function startWechatLogin() {
  wechatLogging.value = true
  const session = ++loginSession
  try {
    panelLog('wechat', 'info', '开始获取登录二维码')
    const res = await wechatService.loginStart()
    if (session !== loginSession) return // 用户已取消或已重新开始
    if (!res.success) {
      wechatTestResult.value = { success: false, message: res.error || '获取二维码失败' }
      panelLog('wechat', 'error', `获取二维码失败：${res.error || '未知错误'}`)
      return
    }
    qrImageUrl.value = await QRCode.toDataURL(res.qrcodeUrl, { width: 240, margin: 1 })
    loginStatus.value = 'wait'
    loginMessage.value = '请用手机微信扫码'
    runLoginPoll(session)
  } catch (err) {
    console.error('[微信] 登录启动失败:', err)
    wechatTestResult.value = { success: false, message: `登录启动失败: ${err.message}` }
    panelLog('wechat', 'error', `登录启动失败: ${err.message}`)
  } finally {
    wechatLogging.value = false
  }
}

// 扫码状态轮询循环：wait/scaned 继续轮询，need_verifycode 挂起等待用户输入配对码
async function runLoginPoll(session) {
  while (session === loginSession) {
    let code = ''
    if (loginStatus.value === 'need_verifycode') {
      code = await new Promise((resolve) => { verifyResolver = resolve })
      if (session !== loginSession) break
    }
    let r
    try {
      r = await wechatService.loginPoll(code)
    } catch (err) {
      r = { status: 'error', message: err.message }
    }
    if (session !== loginSession) break
    loginStatus.value = r.status
    loginMessage.value = r.message
    if (r.status === 'need_verifycode') continue
    if (r.status === 'confirmed' || r.status === 'binded') {
      await loadWechatConfig()
      if (!wechatConfig.hasToken) {
        // 服务端确认但未下发凭证：不能当作登录成功，否则下方功能区不会出现
        loginStatus.value = 'error'
        loginMessage.value = '登录未完成（未获取到凭证），请点击重新获取二维码'
        wechatTestResult.value = { success: false, message: '登录未完成：未获取到登录凭证，请重新扫码' }
        panelLog('wechat', 'error', '登录未完成：服务端已确认但未下发登录凭证，请重新扫码')
        break
      }
      qrImageUrl.value = ''
      loginStatus.value = ''
      loginMessage.value = ''
      checkWechatBotStatus()
      wechatTestResult.value = { success: true, message: r.status === 'binded' ? '已绑定过，无需重复连接' : '微信登录成功' }
      panelLog('wechat', 'info', r.status === 'binded' ? '此微信号已绑定过，无需重复连接' : '扫码登录成功，消息监听已自动启动')
      setTimeout(() => { wechatTestResult.value = null }, 4000)
      break
    }
    if (['expired', 'error', 'verify_code_blocked'].includes(r.status)) {
      qrImageUrl.value = ''
      panelLog('wechat', 'error', `登录中止：${r.message || r.status}`)
      break
    }
    // wait / scaned：服务端长轮询自带阻塞，直接继续
  }
}

function submitVerifyCode() {
  const code = verifyCodeInput.value.trim()
  if (!code) return
  verifyCodeInput.value = ''
  if (verifyResolver) {
    const resolve = verifyResolver
    verifyResolver = null
    resolve(code)
  }
}

function cancelWechatLogin() {
  loginSession++
  if (verifyResolver) {
    const resolve = verifyResolver
    verifyResolver = null
    resolve('')
  }
  qrImageUrl.value = ''
  loginStatus.value = ''
  loginMessage.value = ''
  wechatService.loginCancel().catch(() => {})
}

async function checkWechatBotStatus() {
  if (!wechatService.isBotAvailable()) return
  try {
    const res = await wechatService.botStatus()
    wechatBotConnected.value = res.connected
  } catch {}
}

async function toggleWechatBot() {
  if (!wechatService.isBotAvailable()) {
    wechatTestResult.value = { success: false, message: '微信 Bot API 不可用，请在桌面应用中运行' }
    return
  }
  wechatBotToggling.value = true
  try {
    if (wechatBotConnected.value) {
      const res = await wechatService.botStop()
      wechatBotConnected.value = false
      wechatTestResult.value = { success: true, message: res.message || '已停止' }
      panelLog('wechat', 'info', `消息监听已停止：${res.message || '已停止'}`)
    } else {
      const res = await wechatService.botStart()
      if (res.success) {
        wechatBotConnected.value = true
        wechatTestResult.value = { success: true, message: res.message || '监听已启动' }
        panelLog('wechat', 'info', `消息监听已启动：${res.message || '监听已启动'}`)
      } else {
        wechatTestResult.value = { success: false, message: res.error || '启动失败' }
        panelLog('wechat', 'error', `消息监听启动失败：${res.error || '启动失败'}`)
      }
    }
    setTimeout(() => { wechatTestResult.value = null }, 4000)
  } catch (err) {
    wechatTestResult.value = { success: false, message: err.message }
    panelLog('wechat', 'error', `消息监听操作失败：${err.message}`)
  } finally {
    wechatBotToggling.value = false
  }
}

// 微信机器人消息监听回调
botMessageDisposers.push(wechatService.onMessageReceived?.((data) => {
  wechatBotMessages.value.push({ type: 'in', text: data.text, timestamp: data.timestamp })
  if (wechatBotMessages.value.length > 50) wechatBotMessages.value.shift()
  panelLog('wechat', 'receive', `收到机器人消息：${data.text}`)
}))
botMessageDisposers.push(wechatService.onReplySent?.((data) => {
  wechatBotMessages.value.push({ type: 'out', text: data.text, timestamp: data.timestamp })
  if (wechatBotMessages.value.length > 50) wechatBotMessages.value.shift()
  panelLog('wechat', 'send', `AI 回复已发送：${data.text}`)
}))
botMessageDisposers.push(wechatService.onError?.((data) => {
  wechatBotConnected.value = false
  wechatTestResult.value = { success: false, message: data.message || '微信监听异常' }
  panelLog('wechat', 'error', `监听异常：${data.message || '未知错误'}`)
}))
// 监听轮询诊断：每次 getupdates 的结果实时显示，方便排查收不到消息的问题
botMessageDisposers.push(wechatService.onMonitorStatus?.((data) => {
  monitorStatus.value = data
}))

onMounted(async () => {
  loadConfig()
  checkBotStatus()
  refreshCallLogs()
  await loadWechatConfig()
  checkWechatBotStatus()

  // 自动恢复微信机器人监听（如果上次是开启状态）
  if (wechatConfig.hasToken && wechatConfig.enabled) {
    setTimeout(async () => {
      try {
        const status = await wechatService.botStatus()
        if (!status.connected) {
          await toggleWechatBot()
        } else {
          wechatBotConnected.value = true
        }
      } catch {}
    }, 500)
  }
})

onUnmounted(() => {
  cancelWechatLogin()
  disposeBotListeners()
})
</script>

<style scoped>
.feishu-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  /* 日志覆盖层（PanelRunLog）以此为定位基准 */
  position: relative;
  background-color: var(--ai-panel-bg);
  -webkit-backdrop-filter: var(--blur-amount) var(--blur-saturate);
  backdrop-filter: var(--blur-amount) var(--blur-saturate);
  border-left: 1px solid var(--border-color);
}

/* ========== Header ========== */
.feishu-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.feishu-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.feishu-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.feishu-log-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.feishu-log-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

.feishu-log-btn.active {
  background: rgba(0, 122, 255, 0.1);
  color: #007aff;
  border-color: rgba(0, 122, 255, 0.3);
}

.feishu-close {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.feishu-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

/* ========== 渠道目录 + 内容布局 ========== */
.channel-layout {
  flex: 1;
  min-height: 0;
  display: flex;
}

.channel-nav {
  flex-shrink: 0;
  width: 132px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 10px;
  border-right: 1px solid var(--border-color);
}

.channel-nav-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 0 6px 4px;
  letter-spacing: 0.02em;
}

.channel-nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.channel-nav-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.channel-nav-item.active {
  background: rgba(0, 122, 255, 0.1);
}

.channel-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.channel-nav-item.active .channel-name {
  color: var(--apple-blue);
}

.channel-nav-hint {
  margin-top: 8px;
  padding: 0 4px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-secondary);
}

/* iOS 风格小开关 */
.channel-switch {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 19px;
  flex-shrink: 0;
  cursor: pointer;
}

.channel-switch input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.switch-slider {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 10px;
  transition: background-color 0.2s;
}

.switch-slider::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 15px;
  height: 15px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.channel-switch input:checked + .switch-slider {
  background: #34c759;
}

.channel-switch input:checked + .switch-slider::before {
  transform: translateX(13px);
}

/* ========== Body ========== */
.feishu-body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ========== Section ========== */
.feishu-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.browser-mode-warning {
  padding: 10px 12px;
  font-size: 12px;
  color: #856404;
  background-color: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.2);
  border-radius: var(--radius-sm);
  line-height: 1.5;
}

.browser-mode-warning code {
  padding: 1px 4px;
  background-color: rgba(0, 0, 0, 0.06);
  border-radius: 3px;
  font-family: monospace;
  font-size: 11px;
}

/* ========== Form ========== */
.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-row label {
  flex-shrink: 0;
  width: 70px;
  font-size: 13px;
  color: var(--text-secondary);
  font-family: var(--font-family);
}

.form-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  font-size: 13px;
  font-family: var(--font-family);
  color: var(--text-primary);
  background-color: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.form-input:focus {
  border-color: var(--apple-blue);
  box-shadow: var(--focus-ring);
}

textarea.form-input {
  height: auto;
  padding: 8px 10px;
  line-height: 1.5;
  resize: vertical;
}

select.form-input {
  cursor: pointer;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%2386868B' d='M0 0l5 6 5-6z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
}

/* ========== Form Actions ========== */
.form-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.enable-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--font-family);
  margin-left: auto;
}

.enable-toggle input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--apple-blue);
  cursor: pointer;
}

/* ========== Buttons ========== */
.btn-primary {
  height: 32px;
  padding: 0 16px;
  font-size: 13px;
  font-family: var(--font-family);
  background-color: var(--apple-blue);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast), transform var(--transition-fast);
}

.btn-primary:hover {
  background-color: #0066d6;
}

.btn-primary:active {
  transform: scale(0.97);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  height: 32px;
  padding: 0 16px;
  font-size: 13px;
  font-family: var(--font-family);
  background-color: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast), transform var(--transition-fast);
}

.btn-secondary:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

.btn-secondary:active {
  transform: scale(0.97);
}

.btn-small {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  font-family: var(--font-family);
  background-color: rgba(0, 0, 0, 0.05);
  color: var(--text-secondary);
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast), transform var(--transition-fast);
}

.btn-small:hover {
  background-color: rgba(0, 0, 0, 0.08);
  color: var(--text-primary);
}

.btn-small:active {
  transform: scale(0.96);
}

/* ========== Test Result ========== */
.test-result {
  padding: 8px 12px;
  font-size: 12px;
  font-family: var(--font-family);
  border-radius: var(--radius-sm);
  line-height: 1.5;
  animation: msg-fade-in var(--transition-standard);
}

.test-result.success {
  background-color: rgba(52, 199, 89, 0.08);
  color: var(--apple-green);
}

.test-result.error {
  background-color: rgba(255, 59, 48, 0.08);
  color: var(--apple-red);
}

@keyframes msg-fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ========== 微信扫码登录 ========== */
.qr-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px;
  background: rgba(0, 122, 255, 0.03);
  border: 1px dashed rgba(0, 122, 255, 0.25);
  border-radius: var(--radius-md);
}

.qr-img {
  width: 200px;
  height: 200px;
  image-rendering: pixelated;
}

.qr-status {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.5;
}

.qr-status.scaned {
  color: var(--apple-blue);
}

.qr-status.need_verifycode {
  color: #ff9500;
  font-weight: 600;
}

.qr-status.expired,
.qr-status.verify_code_blocked,
.qr-status.error {
  color: var(--apple-red);
}

.verify-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  justify-content: center;
}

.verify-input {
  max-width: 200px;
  text-align: center;
  letter-spacing: 2px;
}

/* ========== File List ========== */
.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: var(--radius-sm);
  transition: background-color var(--transition-fast);
}

.file-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.file-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.file-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 配置指南 */
.section-title.clickable {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  user-select: none;
}

.section-title.clickable:hover {
  opacity: 0.7;
}

.guide-chevron {
  transition: transform 0.2s;
}

.guide-chevron.open {
  transform: rotate(90deg);
}

.guide-content {
  margin-top: 10px;
}

.guide-steps {
  list-style: none;
  counter-reset: step;
  padding: 0;
  margin: 0;
}

.guide-steps li {
  counter-increment: step;
  position: relative;
  padding-left: 28px;
  margin-bottom: 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary, #1d1d1f);
}

.guide-steps li::before {
  content: counter(step);
  position: absolute;
  left: 0;
  top: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(0, 122, 255, 0.1);
  color: #007aff;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.guide-steps strong {
  display: block;
  margin-bottom: 2px;
  color: var(--text-primary, #1d1d1f);
}

.guide-steps p {
  margin: 0 0 4px 0;
  color: var(--text-secondary, #86868b);
}

.guide-steps ul {
  margin: 2px 0 4px 0;
  padding-left: 16px;
  color: var(--text-secondary, #86868b);
}

.guide-steps ul li {
  font-size: 11px;
  margin-bottom: 2px;
  padding-left: 0;
}

.guide-steps ul li::before {
  display: none;
}

.guide-steps code {
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
  font-family: 'SF Mono', 'Consolas', monospace;
}

.guide-steps a {
  color: #007aff;
  text-decoration: none;
}

.guide-steps a:hover {
  text-decoration: underline;
}

.guide-note {
  margin-top: 10px;
  padding: 8px 12px;
  background: rgba(52, 199, 89, 0.08);
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary, #86868b);
}

.guide-note strong {
  color: #34c759;
}

.guide-slide-enter-active,
.guide-slide-leave-active {
  transition: opacity 0.2s, max-height 0.3s ease;
  overflow: hidden;
  max-height: 600px;
}

.guide-slide-enter-from,
.guide-slide-leave-to {
  opacity: 0;
  max-height: 0;
}

.bot-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.online {
  background: #34c759;
  box-shadow: 0 0 4px rgba(52, 199, 89, 0.5);
}

.status-dot.offline {
  background: #ccc;
}

.status-text {
  font-size: 13px;
  color: var(--text-secondary);
  flex: 1;
}

.bot-hint {
  font-size: 12px;
  color: var(--text-secondary);
  background: rgba(0, 122, 255, 0.05);
  border-radius: 6px;
  padding: 6px 10px;
  line-height: 1.5;
}

.bot-diag {
  font-size: 11px;
  color: var(--text-secondary);
  background: rgba(52, 199, 89, 0.07);
  border-radius: 6px;
  padding: 5px 10px;
  font-family: Consolas, monospace;
  white-space: pre-line;
  word-break: break-all;
}
.bot-diag.err {
  color: #d70015;
  background: rgba(215, 0, 21, 0.06);
}

.bot-log {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 8px;
  margin-top: 8px;
}

.bot-log-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
  font-size: 12px;
  line-height: 1.5;
}

.bot-log-item:last-child {
  border-bottom: none;
}

.log-time {
  color: var(--text-secondary, #86868b);
  flex-shrink: 0;
  font-size: 11px;
}

.log-dir {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: white;
}

.log-dir.in {
  background: #007aff;
}

.log-dir.out {
  background: #34c759;
}

.log-text {
  flex: 1;
  min-width: 0;
  color: var(--text-primary, #1d1d1f);
  word-break: break-word;
}

/* ========== AI 远程调用日志 ========== */
.call-log-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 6px;
  border-radius: 8px;
}

.call-log-container {
  margin-top: 8px;
}

.call-log-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}

.stat-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 8px;
  font-weight: 500;
}

.stat-badge.receive { background: rgba(0, 122, 255, 0.1); color: #007aff; }
.stat-badge.send { background: rgba(52, 199, 89, 0.1); color: #34c759; }
.stat-badge.tool { background: rgba(175, 82, 222, 0.1); color: #af52de; }
.stat-badge.error { background: rgba(255, 59, 48, 0.1); color: #ff3b30; }
.stat-badge.auto-clear { background: rgba(142, 142, 147, 0.1); color: #8e8e93; }

.call-log-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 8px;
}

.call-log-entry {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
  font-size: 12px;
  line-height: 1.5;
}

.call-log-entry:last-child {
  border-bottom: none;
}

.call-log-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.call-log-type {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  color: white;
}

.call-log-type.receive { background: #007aff; }
.call-log-type.send { background: #34c759; }
.call-log-type.tool_call { background: #af52de; }
.call-log-type.tool_result { background: #5856d6; }
.call-log-type.tool_error { background: #ff9500; }
.call-log-type.error { background: #ff3b30; }

.call-log-time {
  font-size: 11px;
  color: var(--text-secondary, #86868b);
}

.call-log-content {
  font-size: 12px;
  color: var(--text-primary, #1d1d1f);
  white-space: pre-wrap;
  word-break: break-word;
}

.call-log-empty {
  font-size: 12px;
  color: var(--text-secondary, #86868b);
  text-align: center;
  padding: 20px;
}

.btn-small.danger {
  color: var(--apple-red, #ff3b30);
  margin-top: 8px;
}

.btn-small.danger:hover {
  background: rgba(255, 59, 48, 0.1);
}

/* ========== embedded 模式（内嵌到设置面板） ========== */
.feishu-panel.embedded {
  position: static;
  height: 480px;
  border: 1px solid var(--border-color, #e5e5e7);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-primary, #fff);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  border-left: none;
}
</style>
