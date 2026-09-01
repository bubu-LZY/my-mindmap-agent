const { contextBridge, ipcRenderer, webUtils } = require('electron')

// 深克隆：Vue 响应式 Proxy 无法被 IPC 结构化克隆，会抛 "An object could not be cloned"
const clonePlain = (obj) => JSON.parse(JSON.stringify(obj == null ? {} : obj))

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

  // 软重启界面（保存并刷新）
  reloadUI: () => ipcRenderer.invoke('app:reload-ui'),

  // 文件管理（旧接口，保留兼容）
  saveFile: (filename, data, opts) => ipcRenderer.invoke('save-file', { filename, data, overwrite: !!(opts && opts.overwrite) }),
  saveBinaryFile: (filename, base64) => ipcRenderer.invoke('save-binary-file', { filename, base64 }),
  printToPdf: (html) => ipcRenderer.invoke('print-to-pdf', { html }),
  openFile: (filePath) => ipcRenderer.invoke('open-file', { filePath }),
  selectFile: () => ipcRenderer.invoke('select-file'),
  listFiles: () => ipcRenderer.invoke('list-files'),

  // 双击 .smm 文件拉起应用时，主进程转发文件路径到渲染进程（返回注销函数）
  onOpenFile: (callback) => {
    const handler = (_event, filePath) => callback(filePath)
    ipcRenderer.on('app:openFile', handler)
    return () => ipcRenderer.removeListener('app:openFile', handler)
  },

  // 知识库检索
  searchKnowledgeBase: (query) => ipcRenderer.invoke('search-knowledge-base', query),

  // 免费联网搜索（Bing/DuckDuckGo，主进程请求避免 CORS）
  webSearch: (payload) => ipcRenderer.invoke('web-search', payload),

  // 读取网页正文（配合联网搜索使用）
  webFetch: (url) => ipcRenderer.invoke('web-fetch', url),

  // 获取当前位置（IP 定位，配合联网搜索使用）
  getLocation: () => ipcRenderer.invoke('get-location'),

  // Shell 命令执行（路径 A：AI 写代码 / 跑脚本 / 安装依赖 / 部署环境）
  // 全部走主进程白名单 + 路径校验，避免任意命令执行
  shell: {
    exec: (opts) => ipcRenderer.invoke('shell:exec', opts || {}),
    spawn: (opts) => ipcRenderer.invoke('shell:spawn', opts || {}),
    kill: (handle) => ipcRenderer.invoke('shell:kill', handle),
    listJobs: () => ipcRenderer.invoke('shell:listJobs'),
    getEnv: (key) => ipcRenderer.invoke('shell:getEnv', key),
    // review S-2：run_node / run_python 用，先校验 script_path 是否在白名单内
    assertScriptPathAllowed: (scriptPath) => ipcRenderer.invoke('shell:assertScriptPathAllowed', scriptPath),
    // 长任务事件流（spawn 后台进程时订阅）
    onStdout: (cb) => {
      const h = (_e, p) => { try { if (typeof cb === 'function') cb(p) } catch (_) {} }
      ipcRenderer.on('shell:stdout', h)
      return () => { try { ipcRenderer.removeListener('shell:stdout', h) } catch (_) {} }
    },
    onStderr: (cb) => {
      const h = (_e, p) => { try { if (typeof cb === 'function') cb(p) } catch (_) {} }
      ipcRenderer.on('shell:stderr', h)
      return () => { try { ipcRenderer.removeListener('shell:stderr', h) } catch (_) {} }
    },
    onExit: (cb) => {
      const h = (_e, p) => { try { if (typeof cb === 'function') cb(p) } catch (_) {} }
      ipcRenderer.on('shell:exit', h)
      return () => { try { ipcRenderer.removeListener('shell:exit', h) } catch (_) {} }
    }
  },

  // AI 配置管理
  getAIConfig: () => ipcRenderer.invoke('get-ai-config'),
  // 统一深克隆：调用方可能传入 Vue 响应式 Proxy，IPC 结构化克隆会抛
  // "An object could not be cloned"；配置均为字符串/布尔，JSON 往返无损失
  setAIConfig: (config) => ipcRenderer.invoke('set-ai-config', JSON.parse(JSON.stringify(config || {}))),
  // AI 请求超时时长（秒，默认 300 = 5 分钟）
  getAiTimeout: () => ipcRenderer.invoke('get-ai-timeout'),
  setAiTimeout: (seconds) => ipcRenderer.invoke('set-ai-timeout', seconds),
  fetchModels: (baseURL, apiKey, profileId) => ipcRenderer.invoke('ai:fetchModels', { baseURL, apiKey, profileId }),
  // 实测探测多模态模型可用性（发真实小图验证）
  testVisionModel: (baseURL, apiKey, model, autoComplete, profileId) => ipcRenderer.invoke('ai:testVisionModel', { baseURL, apiKey, model, autoComplete, profileId }),
  getVisionConfig: () => ipcRenderer.invoke('ai:getVisionConfig'),
  // Embedding 向量化模型
  listEmbeddingModels: (baseURL, apiKey, profileId, autoComplete) => ipcRenderer.invoke('ai:listEmbeddingModels', { baseURL, apiKey, profileId, autoComplete }),
  testEmbedding: (baseURL, apiKey, model, autoComplete, profileId) => ipcRenderer.invoke('ai:testEmbedding', { baseURL, apiKey, model, autoComplete, profileId }),
  aiEmbed: (texts, type) => ipcRenderer.invoke('ai:embed', { texts, type }),

  // AI 对话请求（通过主进程代理，避免 CORS；apiKey 由主进程按 profileId 注入，渲染进程不持有明文）
  aiChat: (url, headers, body, profileId) => ipcRenderer.invoke('ai:chat', { url, headers, body, profileId }),
  // 文件上传（files API，multipart 走主进程代理）
  aiUploadFile: (payload) => ipcRenderer.invoke('ai:uploadFile', payload || {}),
  aiChatStream: (url, headers, body, onData, onDone, onError, profileId) => {
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

    ipcRenderer.send('ai:chatStream', { id, url, headers, body, profileId })

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

  // 版本快照（覆盖保存自动备份，可列出/恢复）
  listFileVersions: (filePath) => ipcRenderer.invoke('list-file-versions', filePath),
  restoreFileVersion: (filePath, versionPath) => ipcRenderer.invoke('restore-file-version', filePath, versionPath),

  // 开机自启动（注册表 Run 键）
  autoLaunch: {
    get: () => ipcRenderer.invoke('auto-launch:get'),
    set: (enable) => ipcRenderer.invoke('auto-launch:set', enable)
  },

  // 本地 HTTP 远程服务
  httpServer: {
    getStatus: () => ipcRenderer.invoke('http-server:getStatus'),
    setEnabled: (enabled) => ipcRenderer.invoke('http-server:setEnabled', !!enabled),
    setQuality: (quality) => ipcRenderer.invoke('http-server:setQuality', quality),
    setLanAccess: (lanAccess) => ipcRenderer.invoke('http-server:setLanAccess', !!lanAccess),
    resetToken: () => ipcRenderer.invoke('http-server:resetToken')
  },

  // 仅查看端口（多人共享只读查看屏幕，独立端口 + 独立 token，不支持操作）
  httpViewOnly: {
    getStatus: () => ipcRenderer.invoke('http-viewonly:getStatus'),
    setEnabled: (enabled) => ipcRenderer.invoke('http-viewonly:setEnabled', !!enabled),
    setLanAccess: (lanAccess) => ipcRenderer.invoke('http-viewonly:setLanAccess', !!lanAccess),
    resetToken: () => ipcRenderer.invoke('http-viewonly:resetToken')
  },

  agentApi: {
    onRequest: (callback) => {
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('agent-api:request', handler)
      return () => ipcRenderer.removeListener('agent-api:request', handler)
    },
    sendResponse: (id, reply, error) => {
      ipcRenderer.send('agent-api:response', { id, reply, error })
    }
  },

  // MCP 服务端桥接（外部 AI 客户端通过 /mcp 端点调用本程序工具）
  mcpServer: {
    onRequest: (callback) => {
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('mcp-server:request', handler)
      return () => ipcRenderer.removeListener('mcp-server:request', handler)
    },
    sendResponse: (id, payload) => {
      ipcRenderer.send('mcp-server:response', { id, ...(payload || {}) })
    },
    getInstallConfig: () => ipcRenderer.invoke('mcp-server:getInstallConfig')
  },

  // MCP 访问令牌管理（多令牌，每令牌独立工具权限范围）
  mcpTokens: {
    list: () => ipcRenderer.invoke('mcp-tokens:list'),
    create: (opts) => ipcRenderer.invoke('mcp-tokens:create', opts || {}),
    update: (id, patch) => ipcRenderer.invoke('mcp-tokens:update', { id, patch: patch || {} }),
    remove: (id) => ipcRenderer.invoke('mcp-tokens:remove', { id }),
    installConfig: (id) => ipcRenderer.invoke('mcp-tokens:installConfig', { id })
  },

  // 密码门禁
  passwordGate: {
    isEnabled: () => ipcRenderer.invoke('password:isEnabled'),
    setPassword: (oldPassword, newPassword) => ipcRenderer.invoke('password:set', { oldPassword, newPassword }),
    verifyPassword: (password) => ipcRenderer.invoke('password:verify', { password }),
    validateSession: (token) => ipcRenderer.invoke('password:validateSession', { token }),
    logout: () => ipcRenderer.invoke('password:logout'),
    getLockStatus: () => ipcRenderer.invoke('password:getLockStatus')
  },

  // MCP 多服务管理
  fsGuard: {
    // 渲染层在"打开 .smm 文件/用户选文件"时调用，把所属目录加入主进程白名单（review C.1）
    setActiveFileDir: (dir) => ipcRenderer.invoke('fsGuard:setActiveFileDir', dir),
    addAllowed: (dirs) => ipcRenderer.invoke('fsGuard:addAllowed', dirs),
    reset: () => ipcRenderer.invoke('fsGuard:reset')
  },

  network: {
    // 当前状态（主进程缓存）
    getState: () => ipcRenderer.invoke('network:getState'),
    // 主动探测一次（用于 UI 上的"重试"按钮）
    checkNow: () => ipcRenderer.invoke('network:checkNow'),
    // 订阅主进程推送（online/offline 变化 + 心跳）；返回 unsubscribe 函数
    onStatusChange: (cb) => {
      const handler = (_event, payload) => { try { if (typeof cb === 'function') cb(payload) } catch (e) {} }
      ipcRenderer.on('network:status', handler)
      return () => { try { ipcRenderer.removeListener('network:status', handler) } catch (e) {} }
    }
  },
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    create: (server) => ipcRenderer.invoke('mcp:create', server),
    update: (id, patch) => ipcRenderer.invoke('mcp:update', id, patch),
    remove: (id) => ipcRenderer.invoke('mcp:delete', id),
    listTools: (id, overrideTimeoutMs) => ipcRenderer.invoke('mcp:listTools', id, overrideTimeoutMs),
    callTool: (id, toolName, args) => ipcRenderer.invoke('mcp:callTool', id, toolName, args),
    // 主进程主动推送 MCP 服务状态变化（进程退出/启动失败）。订阅返回取消订阅函数。
    onStatusChange: (cb) => {
      const handler = (_event, payload) => { try { if (typeof cb === 'function') cb(payload) } catch (e) {} }
      ipcRenderer.on('mcp:status', handler)
      return () => { try { ipcRenderer.removeListener('mcp:status', handler) } catch (e) {} }
    }
  },

  // Skills 多技能管理
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    create: (skill) => ipcRenderer.invoke('skills:create', clonePlain(skill)),
    update: (id, patch) => ipcRenderer.invoke('skills:update', id, clonePlain(patch)),
    remove: (id) => ipcRenderer.invoke('skills:delete', id),
    // 拖拽导入：files 为 [{ name, relativePath, base64 }]，支持 .md / .zip / 含 SKILL.md 的文件夹
    import: (files) => ipcRenderer.invoke('skills:import', {
      files: (files || []).map((f) => ({ name: f.name, relativePath: f.relativePath, base64: f.base64 }))
    }),
    openDir: () => ipcRenderer.invoke('skills:openDir'),
    // 获取内置「AI 能力扩展引导」Skill 的 SKILL.md 原文（用于「下载 Skill 创建指南」按钮）
    getBuiltinGuideContent: () => ipcRenderer.invoke('skills:getBuiltinGuideContent')
  },

  // 自定义工具（userData/custom-tools + 项目 custom-tools）
  customTools: {
    list: () => ipcRenderer.invoke('customTools:list'),
    update: (id, patch) => ipcRenderer.invoke('customTools:update', id, patch),
    call: (id, args, meta) => ipcRenderer.invoke('customTools:call', id, args, meta),
    openDir: () => ipcRenderer.invoke('customTools:openDir'),
    getSpec: () => ipcRenderer.invoke('customTools:getSpec'),
    saveSpec: () => ipcRenderer.invoke('customTools:saveSpec'),
    importFolder: (folderName, files) => ipcRenderer.invoke('customTools:importFolder', { folderName, files }),
    // 主进程在工具内部调用 context.mindmap.* 时，会把请求通过此通道推给渲染层，
    // 渲染层处理完后通过 replyMindmapRequest 把结果回传
    onMindmapRequest: (handler) => {
      const listener = (_e, msg) => {
        try { handler(msg) } catch (err) { /* ignore */ }
      }
      ipcRenderer.on('customTools:mindmapRequest', listener)
      return () => { try { ipcRenderer.removeListener('customTools:mindmapRequest', listener) } catch (e) {} }
    },
    replyMindmapRequest: (reqId, result, error) => {
      try {
        ipcRenderer.send('customTools:mindmapResponse', {
          reqId,
          result: error ? null : result,
          error: error ? String(error) : null
        })
      } catch (e) { /* ignore */ }
    },
    onStatusChange: (cb) => {
      const handler = (_event, payload) => { try { if (typeof cb === 'function') cb(payload) } catch (e) {} }
      ipcRenderer.on('customTools:status', handler)
      return () => { try { ipcRenderer.removeListener('customTools:status', handler) } catch (e) {} }
    }
  },

  // OCR 识别
  ocrImage: (imagePath) => ipcRenderer.invoke('ocr-image', imagePath),
  ocrBase64: (base64Data, lang) => ipcRenderer.invoke('ocr-base64', base64Data, lang),
  ocrToMindmap: (base64Data, lang) => ipcRenderer.invoke('ocr-to-mindmap', base64Data, lang),
  ocrSmart: (base64Data, lang) => ipcRenderer.invoke('ocr-smart', base64Data, lang),
  // 捕获主窗口画面（OCR 截图识别用）
  captureWindow: () => ipcRenderer.invoke('ocr-capture-window'),

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
    stat: (filePath) => ipcRenderer.invoke('fs:stat', filePath),
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

  // 知识库检索（SQLite + MiniSearch BM25）
  database: {
    search: (query) => ipcRenderer.invoke('db:search', query),
    indexFile: (filePath, fileName, treeData, mtime) =>
      ipcRenderer.invoke('db:indexFile', { filePath, fileName, treeData, mtime }),
    indexDocument: (opts) => ipcRenderer.invoke('db:indexDocument', opts),
    removeFile: (filePath) => ipcRenderer.invoke('db:removeFile', { filePath }),
    removeDir: (dirPath) => ipcRenderer.invoke('db:removeDir', { dirPath }),
    getStats: () => ipcRenderer.invoke('db:getStats'),
    listFiles: () => ipcRenderer.invoke('db:listFiles'),
    getFileEntries: (filePath) => ipcRenderer.invoke('db:getFileEntries', { filePath })
  },

  // 文档向量库（本地语义检索，模型在渲染进程推理）
  vector: {
    indexDocument: (opts) => ipcRenderer.invoke('vector:indexDocument', opts),
    indexMindMap: (opts) => ipcRenderer.invoke('vector:indexMindMap', opts),
    remove: (filePath) => ipcRenderer.invoke('vector:remove', { filePath }),
    clearAll: () => ipcRenderer.invoke('vector:clearAll'),
    listFiles: () => ipcRenderer.invoke('vector:listFiles'),
    search: (queryVector, topK) => ipcRenderer.invoke('vector:search', { queryVector, topK }),
    getStats: () => ipcRenderer.invoke('vector:getStats')
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

