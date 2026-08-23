import { reactive } from 'vue'

// 第三方调用消息共享状态（ChatPanel 和 SettingsView 都引用同一个 reactive 对象）
export const MAX_CHANNEL_HISTORY = 60

export const thirdPartyChannels = reactive({
  wechat: { label: '微信端', messages: [], unread: 0 },
  feishu: { label: '飞书端', messages: [], unread: 0 },
  task: { label: '定时端', messages: [], unread: 0 },
  agent: { label: '外部 Agent', messages: [], unread: 0 }
})

export const getThirdPartyChannel = (source) => thirdPartyChannels[source] || thirdPartyChannels.task

export const pushThirdPartyMessage = (source, msg) => {
  const channel = getThirdPartyChannel(source)
  channel.messages.push(msg)
  if (channel.messages.length > MAX_CHANNEL_HISTORY) {
    channel.messages.splice(0, channel.messages.length - MAX_CHANNEL_HISTORY)
  }
  channel.unread++
}

export const pushThirdPartyNotice = (source, text) => {
  pushThirdPartyMessage(source, { role: 'notice', content: text, time: Date.now() })
}

export const clearThirdPartyChannel = (key) => {
  if (thirdPartyChannels[key]) {
    thirdPartyChannels[key].messages = []
    thirdPartyChannels[key].unread = 0
  }
}

export const selectThirdPartyChannel = (key, activeRef) => {
  if (activeRef) activeRef.value = key
  if (thirdPartyChannels[key]) thirdPartyChannels[key].unread = 0
}

export const formatTpTime = (ts) => {
  try {
    const d = new Date(ts)
    const pad = n => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch { return '' }
}
