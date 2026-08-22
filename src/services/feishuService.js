/**
 * 飞书集成服务
 * 通过 Electron IPC 与飞书 OpenAPI 交互
 * 使用懒加载获取 API，避免在浏览器环境下导入时即报错
 */

const getApi = () => window.electronAPI?.feishu

/**
 * 检查飞书 API 是否可用
 * 在浏览器模式（npm run dev）下不可用，需使用 npm run electron:dev
 */
const ensureApi = () => {
  const api = getApi()
  if (!api) {
    if (!window.electronAPI) {
      throw new Error('飞书 API 不可用：window.electronAPI 不存在。请使用 npm run electron:dev 启动桌面应用（而非 npm run dev），并重启 Electron 进程以加载最新的 preload.js。')
    }
    const availableKeys = Object.keys(window.electronAPI).join(', ')
    throw new Error(`飞书 API 不可用：window.electronAPI 存在但缺少 feishu 属性。可用属性: ${availableKeys}。请重启 Electron 进程。`)
  }
  return api
}

export const feishuService = {
  // 检查是否可用
  isAvailable() {
    return !!getApi()
  },

  // 配置管理
  async getConfig() {
    const api = getApi()
    if (!api) return { appId: '', appSecret: '', enabled: false, domain: '', defaultChatId: '' }
    return await api.getConfig()
  },

  async setConfig(config) {
    return await ensureApi().setConfig(config)
  },

  async testConnection() {
    return await ensureApi().testConnection()
  },

  // 消息发送
  async sendTextMessage(chatId, text) {
    return await ensureApi().sendMessage(chatId, 'chat_id', 'text', JSON.stringify({ text }))
  },

  async sendCardMessage(chatId, card) {
    return await ensureApi().sendMessage(chatId, 'chat_id', 'interactive', JSON.stringify(card))
  },

  // 发送文件（PDF 等）
  async sendFile(chatId, filePath) {
    const result = await ensureApi().sendFile(chatId || '', filePath)
    if (result && result.success === false) throw new Error(result.error || '飞书文件发送失败')
    return result
  },

  // 群聊管理
  async listChats() {
    return await ensureApi().listChats()
  },

  // 文档操作
  async uploadFile(filePath, parentNode = '') {
    return await ensureApi().uploadFile(filePath, 'explorer', parentNode)
  },

  // 上传任意文件到云空间指定文件夹（不限格式），返回 token + 可访问链接
  async uploadDriveFile(filePath, folderToken = '') {
    return await ensureApi().uploadDriveFile(filePath, folderToken)
  },

  // 将 Markdown 导入为飞书文档（docx），返回文档 token + 链接
  async importMarkdownDoc(markdown, title, folderToken = '') {
    return await ensureApi().importMarkdownDoc(markdown, title, folderToken)
  },

  // 删除云空间文件（移入回收站）
  async deleteFile(fileToken, fileType = 'file') {
    return await ensureApi().deleteFile(fileToken, fileType)
  },

  // 重命名云空间文件
  async renameFile(fileToken, newName, fileType = 'file') {
    return await ensureApi().renameFile(fileToken, newName, fileType)
  },

  async downloadFile(fileToken, savePath) {
    return await ensureApi().downloadFile(fileToken, savePath)
  },

  async createDoc(title, content = '', folderToken = '') {
    return await ensureApi().createDoc(title, content, folderToken)
  },

  async getDocContent(docToken, format = 'markdown') {
    return await ensureApi().getDocContent(docToken, format)
  },

  // 文件搜索
  async searchFiles(query) {
    return await ensureApi().searchFiles(query, 20)
  },

  async listFiles(folderToken = '') {
    return await ensureApi().listFiles(folderToken)
  },

  async getRootFolder() {
    return await ensureApi().getRootFolder()
  }
}
