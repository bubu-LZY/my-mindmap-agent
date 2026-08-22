const { contextBridge, ipcRenderer, webUtils } = require('electron')

// 通过 contextBridge 安全地暴露 IPC 方法给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 获取拖入文件的本地路径（Electron 安全替代 File.path）
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch (e) {
      return (file && file.path) || ''
    }
  },

  // 读取旧版本（mindmap-mubu）userData 的 localStorage 数据，用于迁移
  legacyStorageRead: () => ipcRenderer.invoke('legacy-storage-read'),

  // 在默认浏览器中打开 URL
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // 文件管理（旧接口，保留兼容）
  saveFile: (filename, data, opts) => ipcRenderer.invoke('save-file', { filename, data, overwrite: !!(opts && opts.overwrite) }),
  saveBinaryFile: (filename, base64) => ipcRenderer.invoke('save-binary-file', { filename, base64 }),
  printToPdf: (html) => ipcRenderer.invoke('print-to-pdf', { html }),
  openFile: (filePath) => ipcRenderer.invoke('open-file', { filePath }),
  selectFile: () => ipcRenderer.invoke('select-file'),
  listFiles: () => ipcRenderer.invoke('list-files'),

  // 知识库检索
  searchKnowledgeBase: (query) => ipcRenderer.invoke('search-knowledge-base', query),

  // 免费联网搜索（Bing/DuckDuckGo，主进程请求避免 CORS）
  webSearch: (payload) => ipcRenderer.invoke('web-search', payload),

  // 读取网页正文（配合联网搜索使用）
  webFetch: (url) => ipcRenderer.invoke('web-fetch', url),

  // 获取当前位置（IP 定位，配合联网搜索使用）
  getLocation: () => ipcRenderer.invoke('get-location'),

  // AI 配置管理
  getAIConfig: () => ipcRenderer.invoke('get-ai-config'),
  // 统一深克隆：调用方可能传入 Vue 响应式 Proxy，IPC 结构化克隆会抛
  // "An object could not be cloned"；配置均为字符串/布尔，JSON 往返无损失
  setAIConfig: (config) => ipcRenderer.invoke('set-ai-config', JSON.parse(JSON.stringify(config || {}))),
  fetchModels: (baseURL, apiKey) => ipcRenderer.invoke('ai:fetchModels', { baseURL, apiKey }),
  // 实测探测多模态模型可用性（发真实小图验证）
  testVisionModel: (baseURL, apiKey, model, autoComplete) => ipcRenderer.invoke('ai:testVisionModel', { baseURL, apiKey, model, autoComplete }),
  getVisionConfig: () => ipcRenderer.invoke('ai:getVisionConfig'),

  // AI 对话请求（通过主进程代理，避免 CORS）
  aiChat: (url, headers, body) => ipcRenderer.invoke('ai:chat', { url, headers, body }),
  aiChatStream: (url, headers, body, onData, onDone, onError) => {
    const id = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`

    const chunkHandler = (_event, data) => {
      try { onData(data) } catch (e) { console.error('onData error:', e) }
    }
    const doneHandler = () => {
      cleanup()
      try { onDone() } catch (e) { console.error('onDone error:', e) }
    }
    const errorHandler = (_event, err) => {
      cleanup()
      try { onError(new Error(err)) } catch (e) { console.error('onError error:', e) }
    }

    function cleanup() {
      ipcRenderer.removeListener(`ai:chat:chunk:${id}`, chunkHandler)
      ipcRenderer.removeListener(`ai:chat:done:${id}`, doneHandler)
      ipcRenderer.removeListener(`ai:chat:error:${id}`, errorHandler)
    }

    ipcRenderer.on(`ai:chat:chunk:${id}`, chunkHandler)
    ipcRenderer.on(`ai:chat:done:${id}`, doneHandler)
    ipcRenderer.on(`ai:chat:error:${id}`, errorHandler)

    ipcRenderer.send('ai:chatStream', { id, url, headers, body })

    return {
      cancel: () => {
        cleanup()
        ipcRenderer.send('ai:chatCancel', id)
      }
    }
  },

  // 默认保存目录
  getDefaultSaveDir: () => ipcRenderer.invoke('get-default-save-dir'),
  setSaveDir: (dirPath) => ipcRenderer.invoke('set-save-dir', dirPath),

  // 开机自启动（注册表 Run 键）
  autoLaunch: {
    get: () => ipcRenderer.invoke('auto-launch:get'),
    set: (enable) => ipcRenderer.invoke('auto-launch:set', enable)
  },

  // OCR 识别
  ocrImage: (imagePath) => ipcRenderer.invoke('ocr-image', imagePath),
  ocrBase64: (base64Data, lang) => ipcRenderer.invoke('ocr-base64', base64Data, lang),
  ocrToMindmap: (base64Data, lang) => ipcRenderer.invoke('ocr-to-mindmap', base64Data, lang),
  ocrSmart: (base64Data, lang) => ipcRenderer.invoke('ocr-smart', base64Data, lang),

  // OCR 进度监听
  onOcrProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('ocr-progress', handler)
    return () => ipcRenderer.removeListener('ocr-progress', handler)
  },

  // 引用功能 - 文件/节点引用
  refScanFiles: (rootPath) => ipcRenderer.invoke('ref:scanFiles', rootPath),
  refScanNodes: (rootPath) => ipcRenderer.invoke('ref:scanNodes', rootPath),
  refReadFile: (filePath) => ipcRenderer.invoke('ref:readFile', filePath),
  refFileExists: (filePath) => ipcRenderer.invoke('ref:fileExists', filePath),

  // 文件树管理（新接口）
  fs: {
    selectFolder: () => ipcRenderer.invoke('fs:selectFolder'),
    listDir: (dirPath) => ipcRenderer.invoke('fs:listDir', dirPath),
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    readBinary: (filePath) => ipcRenderer.invoke('fs:readBinary', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    writeBinary: (filePath, base64) => ipcRenderer.invoke('fs:writeBinary', filePath, base64),
    getTempDir: () => ipcRenderer.invoke('fs:getTempDir'),
    rename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
    // 在资源管理器中打开（文件定位选中 / 文件夹直接打开）
    showInFolder: (filePath) => ipcRenderer.invoke('fs:showInFolder', filePath),
    // 用系统默认程序打开文件（双击等效行为）
    openFile: (filePath) => ipcRenderer.invoke('fs:openFile', filePath),
    remove: (filePath) => ipcRenderer.invoke('fs:remove', filePath),
    mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath),
    createFile: (filePath, content) => ipcRenderer.invoke('fs:createFile', filePath, content),
    move: (src, destDir) => ipcRenderer.invoke('fs:move', src, destDir),
    exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
    absPath: (rawPath) => ipcRenderer.invoke('fs:absPath', rawPath),
    findFile: (opts) => ipcRenderer.invoke('fs:findFile', opts)
  },

  // 本机用户目录信息（供 AI 构造文件路径）
  getUserDirs: () => ipcRenderer.invoke('get-user-dirs'),

  // 飞书集成
  feishu: {
    getConfig: () => ipcRenderer.invoke('feishu:getConfig'),
    setConfig: (config) => ipcRenderer.invoke('feishu:setConfig', config),
    testConnection: () => ipcRenderer.invoke('feishu:testConnection'),
    sendMessage: (receiveId, receiveIdType, msgType, content) =>
      ipcRenderer.invoke('feishu:sendMessage', { receiveId, receiveIdType, msgType, content }),
    sendImage: (chatId, filePath) =>
      ipcRenderer.invoke('feishu:sendImage', { chatId, filePath }),
    sendFile: (chatId, filePath) =>
      ipcRenderer.invoke('feishu:sendFile', { chatId, filePath }),
    listChats: () => ipcRenderer.invoke('feishu:listChats'),
    uploadFile: (filePath, parentType, parentNode) =>
      ipcRenderer.invoke('feishu:uploadFile', { filePath, parentType, parentNode }),
    uploadDriveFile: (filePath, folderToken) =>
      ipcRenderer.invoke('feishu:uploadDriveFile', { filePath, folderToken }),
    importMarkdownDoc: (markdown, title, folderToken) =>
      ipcRenderer.invoke('feishu:importMarkdownDoc', { markdown, title, folderToken }),
    deleteFile: (fileToken, fileType) =>
      ipcRenderer.invoke('feishu:deleteFile', { fileToken, fileType }),
    renameFile: (fileToken, newName, fileType) =>
      ipcRenderer.invoke('feishu:renameFile', { fileToken, newName, fileType }),
    downloadFile: (fileToken, savePath) =>
      ipcRenderer.invoke('feishu:downloadFile', { fileToken, savePath }),
    createDoc: (title, content, folderToken) =>
      ipcRenderer.invoke('feishu:createDoc', { title, content, folderToken }),
    getDocContent: (docToken, format) =>
      ipcRenderer.invoke('feishu:getDocContent', { docToken, format }),
    searchFiles: (query, count) =>
      ipcRenderer.invoke('feishu:searchFiles', { query, count }),
    listFiles: (folderToken) =>
      ipcRenderer.invoke('feishu:listFiles', { folderToken }),
    getRootFolder: () =>
      ipcRenderer.invoke('feishu:getRootFolder')
  },

  // 微信 ClawBot 集成（iLink Bot API）
  wechat: {
    getConfig: () => ipcRenderer.invoke('wechat:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('wechat:setConfig', patch),
    loginStart: () => ipcRenderer.invoke('wechat:loginStart'),
    loginPoll: (verifyCode) => ipcRenderer.invoke('wechat:loginPoll', verifyCode),
    loginCancel: () => ipcRenderer.invoke('wechat:loginCancel'),
    logout: () => ipcRenderer.invoke('wechat:logout'),
    testConnection: () => ipcRenderer.invoke('wechat:testConnection'),
    getContacts: () => ipcRenderer.invoke('wechat:getContacts'),
    sendMessage: (toUserId, text) => ipcRenderer.invoke('wechat:sendMessage', { toUserId, text }),
    sendImage: (toUserId, filePath) => ipcRenderer.invoke('wechat:sendImage', { toUserId, filePath }),
    sendFile: (toUserId, filePath) => ipcRenderer.invoke('wechat:sendFile', { toUserId, filePath })
  },

  // 微信机器人消息监听（长轮询）
  wechatBot: {
    start: () => ipcRenderer.invoke('wechatBot:start'),
    stop: () => ipcRenderer.invoke('wechatBot:stop'),
    status: () => ipcRenderer.invoke('wechatBot:status'),
    // 以下监听均返回注销函数，组件卸载时必须调用，防止监听器累积导致消息重复处理
    onMessageReceived: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('wechatBot:messageReceived', handler)
      return () => ipcRenderer.removeListener('wechatBot:messageReceived', handler)
    },
    onReplySent: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('wechatBot:replySent', handler)
      return () => ipcRenderer.removeListener('wechatBot:replySent', handler)
    },
    onError: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('wechatBot:error', handler)
      return () => ipcRenderer.removeListener('wechatBot:error', handler)
    },
    onMonitorStatus: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('wechatBot:monitorStatus', handler)
      return () => ipcRenderer.removeListener('wechatBot:monitorStatus', handler)
    },
    onProcessMessage: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('wechatBot:processMessage', handler)
      return () => ipcRenderer.removeListener('wechatBot:processMessage', handler)
    },
    sendProcessMessageResult: (id, reply, error) => {
      ipcRenderer.send('wechatBot:processMessageResult', { id, reply, error })
    }
  },

  // AI 定时任务调度器
  taskScheduler: {
    // 创建定时任务
    create: (task) => ipcRenderer.invoke('task:create', task),
    // 删除定时任务
    delete: (taskId) => ipcRenderer.invoke('task:delete', taskId),
    // 更新定时任务
    update: (task) => ipcRenderer.invoke('task:update', task),
    // 列出所有计划任务（从 Windows Task Scheduler 查询）
    list: () => ipcRenderer.invoke('task:list'),
    // 获取所有存储的任务元数据（从 electron-store）
    getAll: () => ipcRenderer.invoke('task:getAll'),
    // 同步本地存储与 Task Scheduler
    syncAll: (tasks) => ipcRenderer.invoke('task:syncAll', tasks),
    // 监听定时任务触发事件（由 main.js 在应用启动时发送）
    // 返回注销函数，组件卸载时必须调用，防止监听器累积
    onScheduledTrigger: (callback) => {
      const handler = (_event, taskId) => callback(taskId)
      ipcRenderer.on('task:scheduledTrigger', handler)
      return () => ipcRenderer.removeListener('task:scheduledTrigger', handler)
    }
  },

  // 系统对话框
  dialog: {
    showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpenDialog', options)
  },

  // 知识库检索（SQLite + FTS5）
  database: {
    search: (query) => ipcRenderer.invoke('db:search', query),
    indexFile: (filePath, fileName, treeData) =>
      ipcRenderer.invoke('db:indexFile', { filePath, fileName, treeData }),
    removeFile: (filePath) => ipcRenderer.invoke('db:removeFile', { filePath }),
    getStats: () => ipcRenderer.invoke('db:getStats'),
    listFiles: () => ipcRenderer.invoke('db:listFiles')
  },

  // 飞书机器人长连接（WebSocket）
  feishuBot: {
    start: () => ipcRenderer.invoke('feishuBot:start'),
    stop: () => ipcRenderer.invoke('feishuBot:stop'),
    status: () => ipcRenderer.invoke('feishuBot:status'),
    // 以下监听均返回注销函数，组件卸载时必须调用，防止监听器累积导致消息重复处理
    onMessageReceived: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('feishuBot:messageReceived', handler)
      return () => ipcRenderer.removeListener('feishuBot:messageReceived', handler)
    },
    onReplySent: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('feishuBot:replySent', handler)
      return () => ipcRenderer.removeListener('feishuBot:replySent', handler)
    },
    onProcessMessage: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('feishuBot:processMessage', handler)
      return () => ipcRenderer.removeListener('feishuBot:processMessage', handler)
    },
    sendProcessMessageResult: (id, reply, error) => {
      ipcRenderer.send('feishuBot:processMessageResult', { id, reply, error })
    }
  }
})

