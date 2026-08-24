/**
 * 浏览器环境 polyfill：模拟 window.electronAPI
 * 让 Electron 应用可以在纯浏览器中运行（部分功能降级）
 */

const isBrowser = typeof window !== 'undefined' && !window.electronAPI

if (isBrowser) {
  console.log('[Browser Polyfill] 检测到浏览器环境，注入模拟 Electron API')

  // 模拟的 electronAPI
  const electronAPI = {
    // 文件管理（降级：使用 localStorage 或 IndexedDB）
    getPathForFile: (file) => file?.name || '',
    saveFile: async (filename, data, opts) => {
      console.warn('[Browser] saveFile 降级：使用下载代替', filename)
      const blob = new Blob([data], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      return { success: true, path: filename }
    },
    saveBinaryFile: async (filename, base64) => {
      console.warn('[Browser] saveBinaryFile 降级：使用下载代替', filename)
      const binary = atob(base64)
      const array = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i)
      const blob = new Blob([array], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      return { success: true, path: filename }
    },
    openFile: async (filePath) => {
      console.warn('[Browser] openFile 不可用', filePath)
      return { success: false, error: '浏览器环境不支持打开本地文件' }
    },
    selectFile: async () => {
      console.warn('[Browser] selectFile 降级：使用文件选择器')
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.smm,.md,.xmind,.json,.txt,.pdf,.doc,.docx'
        input.onchange = async (e) => {
          const file = e.target.files[0]
          if (!file) return resolve({ success: false, error: '未选择文件' })
          const text = await file.text()
          resolve({ success: true, data: text, name: file.name, path: file.name })
        }
        input.click()
      })
    },
    listFiles: async () => {
      console.warn('[Browser] listFiles 不可用')
      return { success: true, files: [] }
    },

    // 知识库检索（降级：返回空）
    searchKnowledgeBase: async (query) => {
      console.warn('[Browser] searchKnowledgeBase 不可用')
      return { success: true, results: [] }
    },

    // 联网搜索（降级：使用浏览器 fetch 代理）
    webSearch: async (payload) => {
      console.warn('[Browser] webSearch 降级：使用 DuckDuckGo HTML 版')
      try {
        const q = encodeURIComponent(payload.query || '')
        const resp = await fetch(`https://html.duckduckgo.com/html/?q=${q}`)
        const html = await resp.text()
        const results = []
        const matches = html.matchAll(/<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([^<]*)<\/a>/g)
        for (const m of matches) {
          results.push({ title: m[2], url: m[1], snippet: '' })
          if (results.length >= 5) break
        }
        return { success: true, results }
      } catch (e) {
        return { success: false, error: e.message, results: [] }
      }
    },
    webFetch: async (url) => {
      console.warn('[Browser] webFetch 降级：直接 fetch（可能 CORS 失败）')
      try {
        const resp = await fetch(url)
        const text = await resp.text()
        return { success: true, content: text.slice(0, 5000) }
      } catch (e) {
        return { success: false, error: e.message }
      }
    },
    getLocation: async () => ({ success: false, error: '浏览器环境不支持定位' }),

    // AI 配置管理（使用 localStorage）
    getAIConfig: async () => {
      try {
        const config = JSON.parse(localStorage.getItem('ai-config') || '{}')
        return { success: true, config }
      } catch {
        return { success: true, config: {} }
      }
    },
    setAIConfig: async (config) => {
      localStorage.setItem('ai-config', JSON.stringify(config))
      return { success: true }
    },
    fetchModels: async (baseURL, apiKey) => {
      console.warn('[Browser] fetchModels 降级：直接调用 API（可能 CORS 失败）')
      try {
        const resp = await fetch(`${baseURL}/v1/models`, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        })
        const data = await resp.json()
        return { success: true, models: data.data?.map(m => m.id) || [] }
      } catch (e) {
        return { success: false, error: e.message }
      }
    },
    testVisionModel: async () => ({ success: false, error: '浏览器环境不支持测试视觉模型' }),
    getVisionConfig: async () => ({ success: true, config: {} }),

    // AI 对话（降级：直接调用 API，可能 CORS 失败）
    aiChat: async (url, headers, body) => {
      console.warn('[Browser] aiChat 降级：直接调用 API（可能 CORS 失败）')
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body)
        })
        const data = await resp.json()
        return { success: true, data }
      } catch (e) {
        return { success: false, error: e.message }
      }
    },
    aiChatStream: (url, headers, body, onData, onDone, onError) => {
      console.warn('[Browser] aiChatStream 降级：使用 fetch streaming')
      const controller = new AbortController()
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal
      }).then(async (resp) => {
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value)
          const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
          for (const line of lines) {
            const data = line.slice(6)
            if (data === '[DONE]') { onDone(); return }
            try { onData(JSON.parse(data)) } catch {}
          }
        }
        onDone()
      }).catch(e => onError(e))
      return { cancel: () => controller.abort() }
    },

    // 保存目录（降级：使用 IndexedDB 或内存）
    getDefaultSaveDir: async () => '/browser-saves',
    setSaveDir: async () => ({ success: true }),

    // 开机自启动（浏览器不支持）
    autoLaunch: {
      get: async () => ({ success: true, enabled: false }),
      set: async () => ({ success: false, error: '浏览器环境不支持开机自启' })
    },

    // 本地 HTTP 服务（浏览器不支持）
    httpServer: {
      getStatus: async () => ({ success: true, running: false }),
      setEnabled: async () => ({ success: false, error: '浏览器环境不支持本地 HTTP 服务' }),
      getUrl: async () => ({ success: false }),
      getToken: async () => ({ success: false }),
      refreshToken: async () => ({ success: false })
    },

    // MCP 管理（浏览器不支持）
    mcp: {
      list: async () => ({ success: true, servers: [] }),
      add: async () => ({ success: false, error: '浏览器环境不支持 MCP' }),
      remove: async () => ({ success: false }),
      start: async () => ({ success: false }),
      stop: async () => ({ success: false })
    },

    // Skills 管理（浏览器不支持）
    skills: {
      list: async () => ({ success: true, skills: [] }),
      add: async () => ({ success: false, error: '浏览器环境不支持 Skills' }),
      remove: async () => ({ success: false }),
      enable: async () => ({ success: false }),
      disable: async () => ({ success: false })
    },

    // 自定义工具（浏览器不支持）
    customTools: {
      list: async () => ({ success: true, tools: [] }),
      call: async () => ({ success: false, error: '浏览器环境不支持自定义工具' })
    },

    // 飞书（浏览器不支持）
    feishu: {
      isConfigured: async () => ({ success: true, configured: false }),
      getConfig: async () => ({ success: true, config: {} }),
      setConfig: async () => ({ success: false, error: '浏览器环境不支持飞书' }),
      uploadFile: async () => ({ success: false }),
      sendMessage: async () => ({ success: false })
    },

    // 微信（浏览器不支持）
    wechat: {
      isConfigured: async () => ({ success: true, configured: false }),
      getQrcode: async () => ({ success: false, error: '浏览器环境不支持微信' }),
      sendMessage: async () => ({ success: false })
    },

    // OCR（降级：使用 tesseract.js）
    ocr: {
      recognize: async (imageData) => {
        console.warn('[Browser] OCR 降级：使用 tesseract.js（较慢）')
        try {
          const Tesseract = await import('tesseract.js')
          const worker = await Tesseract.createWorker('chi_sim+eng')
          const { data: { text } } = await worker.recognize(imageData)
          await worker.terminate()
          return { success: true, text }
        } catch (e) {
          return { success: false, error: e.message }
        }
      }
    },

    // 定时任务（降级：使用 setInterval）
    taskScheduler: {
      list: async () => ({ success: true, tasks: [] }),
      add: async (task) => {
        console.warn('[Browser] taskScheduler 降级：使用 setInterval')
        if (task.schedule?.type === 'once') {
          const delay = new Date(task.schedule.at).getTime() - Date.now()
          if (delay > 0) setTimeout(() => console.log('[Browser] 定时任务触发:', task.name), delay)
        }
        return { success: true }
      },
      remove: async () => ({ success: true }),
      pause: async () => ({ success: true }),
      resume: async () => ({ success: true })
    },

    // 窗口控制（浏览器不支持）
    window: {
      minimize: async () => {},
      maximize: async () => {},
      close: async () => {},
      isMaximized: async () => false
    },

    // 系统信息
    system: {
      getPlatform: () => 'browser',
      getVersion: () => '1.0.0-web',
      isElectron: () => false
    },

    // 其他
    openExternal: (url) => window.open(url, '_blank'),
    legacyStorageRead: async () => ({ success: false }),
    printToPdf: async () => ({ success: false, error: '浏览器环境不支持 PDF 导出' }),
    refReadFile: async () => ({ success: false, error: '浏览器环境不支持读取本地文件' }),
    refScanFiles: async () => ({ success: true, files: [] }),

    // Agent API（浏览器不支持）
    agentApi: {
      onRequest: null,
      onResponse: null
    }
  }

  // 注入到 window
  window.electronAPI = electronAPI

  // 标记为浏览器环境
  window.__IS_BROWSER__ = true

  console.log('[Browser Polyfill] 注入完成，部分功能将降级运行')
}
