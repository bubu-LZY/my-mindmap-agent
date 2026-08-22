/**
 * 微信 ClawBot 集成服务（渲染层）
 * 通过 Electron IPC 与主进程的 iLink Bot API 实现交互
 */

const getApi = () => window.electronAPI?.wechat
const getBotApi = () => window.electronAPI?.wechatBot

const ensureApi = () => {
  const api = getApi()
  if (!api) {
    if (!window.electronAPI) {
      throw new Error('微信 API 不可用：window.electronAPI 不存在。请使用 npm run electron:dev 启动桌面应用（而非 npm run dev），并重启 Electron 进程以加载最新的 preload.js。')
    }
    const availableKeys = Object.keys(window.electronAPI).join(', ')
    throw new Error(`微信 API 不可用：window.electronAPI 存在但缺少 wechat 属性。可用属性: ${availableKeys}。请重启 Electron 进程。`)
  }
  return api
}

export const wechatService = {
  isAvailable() {
    return !!getApi()
  },

  isBotAvailable() {
    return !!getBotApi()
  },

  async getConfig() {
    const api = getApi()
    if (!api) return { enabled: false, hasToken: false, botId: '', userId: '', loginTime: '', defaultContactId: '' }
    return await api.getConfig()
  },

  async setConfig(patch) {
    return await ensureApi().setConfig(patch)
  },

  // 扫码登录：获取二维码链接（内容为 URL，渲染层用 qrcode 库生成图片）
  async loginStart() {
    return await ensureApi().loginStart()
  },

  // 轮询扫码状态：wait/scaned/need_verifycode/confirmed/expired/binded...
  async loginPoll(verifyCode) {
    return await ensureApi().loginPoll(verifyCode)
  },

  async loginCancel() {
    return await ensureApi().loginCancel()
  },

  async logout() {
    return await ensureApi().logout()
  },

  async testConnection() {
    return await ensureApi().testConnection()
  },

  async getContacts() {
    const api = getApi()
    if (!api) return []
    return await api.getContacts()
  },

  // 发送文本（toUserId 省略时发给默认联系人）
  async sendTextMessage(toUserId, text) {
    return await ensureApi().sendMessage(toUserId || '', text)
  },

  // 发送图片（toUserId 省略时发给默认联系人）
  async sendImage(toUserId, filePath) {
    const api = getApi()
    if (!api || typeof api.sendImage !== 'function') {
      throw new Error('当前环境不支持发送微信图片（请使用桌面应用并重启 Electron）')
    }
    const result = await api.sendImage(toUserId || '', filePath)
    if (result && result.success === false) throw new Error(result.error || '微信图片发送失败')
    return result
  },

  // 发送文件（toUserId 省略时发给默认联系人）
  async sendFile(toUserId, filePath) {
    const api = getApi()
    if (!api || typeof api.sendFile !== 'function') {
      throw new Error('当前环境不支持发送微信文件（请使用桌面应用并重启 Electron）')
    }
    const result = await api.sendFile(toUserId || '', filePath)
    if (result && result.success === false) throw new Error(result.error || '微信文件发送失败')
    return result
  },

  // 机器人监听
  async botStart() {
    return await getBotApi().start()
  },
  async botStop() {
    return await getBotApi().stop()
  },
  async botStatus() {
    const api = getBotApi()
    if (!api) return { connected: false }
    return await api.status()
  },

  // 监听器透传（返回注销函数，组件卸载时必须调用）
  onMessageReceived(callback) {
    return getBotApi()?.onMessageReceived(callback)
  },
  onReplySent(callback) {
    return getBotApi()?.onReplySent(callback)
  },
  onError(callback) {
    return getBotApi()?.onError(callback)
  },
  onMonitorStatus(callback) {
    return getBotApi()?.onMonitorStatus(callback)
  }
}
