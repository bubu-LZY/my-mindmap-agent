const getApi = () => window.electronAPI?.feishuBot

export const feishuBotService = {
  isAvailable() {
    return !!getApi()
  },

  async start() {
    const api = getApi()
    if (!api) throw new Error('飞书 Bot API 不可用，请在桌面应用中运行')
    return await api.start()
  },

  async stop() {
    const api = getApi()
    if (!api) throw new Error('飞书 Bot API 不可用')
    return await api.stop()
  },

  async status() {
    const api = getApi()
    if (!api) return { connected: false }
    return await api.status()
  },

  // 以下三个监听均返回注销函数（preload 提供），组件卸载时必须调用
  onMessageReceived(callback) {
    const api = getApi()
    if (!api) return
    return api.onMessageReceived(callback)
  },

  onReplySent(callback) {
    const api = getApi()
    if (!api) return
    return api.onReplySent(callback)
  },

  onProcessMessage(callback) {
    const api = getApi()
    if (!api) return
    return api.onProcessMessage(callback)
  },

  sendProcessMessageResult(id, reply, error) {
    const api = getApi()
    if (!api) return
    api.sendProcessMessageResult(id, reply, error)
  }
}
