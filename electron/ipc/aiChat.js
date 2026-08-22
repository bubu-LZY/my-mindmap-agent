/**
 * AI 对话请求 IPC 处理
 * 通过主进程代理 API 请求，避免渲染进程的 CORS 限制
 */
const { ipcMain } = require('electron')

/**
 * 构建 chat completions API URL
 * autoComplete=false 时地址原样使用（仅去除末尾斜杠），适配自带独立后缀的厂商
 */
function buildChatURL(baseURL, autoComplete = true) {
  if (!baseURL) return ''
  let url = baseURL.trim().replace(/\/+$/, '')
  if (autoComplete === false) return url
  if (/\/chat\/completions$/i.test(url)) return url
  if (/\/v1$/i.test(url)) return url + '/chat/completions'
  return url + '/v1/chat/completions'
}

/**
 * 非流式对话请求
 * 参数: { url, headers, body }
 * 返回: { success, data } 或 { success: false, status, error }
 */
ipcMain.handle('ai:chat', async (event, { url, headers, body }) => {
  // 超时保护：API 无响应时避免工具调用/请求永久挂起
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return { success: false, status: response.status, error: errText }
    }

    const data = await response.json()
    return { success: true, data }
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { success: false, error: '请求超时（120 秒），请检查 API 地址与网络' }
    }
    return { success: false, error: error.message }
  } finally {
    clearTimeout(timer)
  }
})

/**
 * 进行中的流式请求：id -> AbortController
 * 取消时真正中断 fetch，停止继续拉取模型响应（避免点停止后后台继续扣 token）
 */
const activeStreams = new Map()

/**
 * 流式对话请求
 * 参数: { id, url, headers, body }
 * 通过 IPC 事件转发数据块:
 *   - ai:chat:chunk:{id}  - 数据块 (string)
 *   - ai:chat:done:{id}   - 流结束
 *   - ai:chat:error:{id}  - 错误 (string)
 */
ipcMain.on('ai:chatStream', async (event, { id, url, headers, body }) => {
  const controller = new AbortController()
  activeStreams.set(id, controller)
  // 流式空闲超时：模型在长推理/网络抖动后可能既不结束也不发数据（连接僵死），
  // 此时渲染进程 read() 会永久挂起（表现为"AI 卡住无输出"）。超过阈值无任何字节到达即中断并回传错误，
  // 让渲染进程以可恢复的报错收尾，而不是无限转圈。每次收到数据块都会重置计时。
  const IDLE_TIMEOUT_MS = 120000
  let idleTimer = null
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      try { controller.abort() } catch (e) {}
      try {
        event.reply(`ai:chat:error:${id}`, '流式响应超时（120 秒无数据），已中断连接')
      } catch (e) {
        // 渲染层可能已销毁
      }
    }, IDLE_TIMEOUT_MS)
  }
  try {
    resetIdleTimer()
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      event.reply(`ai:chat:error:${id}`, `API error: ${response.status} ${errText}`)
      return
    }

    if (!response.body) {
      event.reply(`ai:chat:error:${id}`, 'No response body')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        // 只要仍有字节到达就重置空闲计时（即使本块解码为空，也说明连接未僵死）
        resetIdleTimer()
        // 解码并转发文本块
        const text = decoder.decode(value, { stream: true })
        if (text) {
          event.reply(`ai:chat:chunk:${id}`, text)
        }
      }
      // 刷新解码器中剩余的数据
      const remaining = decoder.decode()
      if (remaining) {
        event.reply(`ai:chat:chunk:${id}`, remaining)
      }
      event.reply(`ai:chat:done:${id}`)
    } finally {
      reader.releaseLock()
    }
  } catch (error) {
    // 用户主动取消：渲染层已移除监听，无需再通知，静默退出即可
    if (controller.signal.aborted) return
    try {
      event.reply(`ai:chat:error:${id}`, error.message)
    } catch (e) {
      // 渲染层可能已销毁
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    activeStreams.delete(id)
  }
})

/**
 * 取消流式请求
 * 参数: id
 * 中断对应的 fetch，主进程立即停止拉取模型响应
 */
ipcMain.on('ai:chatCancel', (event, id) => {
  const controller = activeStreams.get(id)
  if (controller) {
    try {
      controller.abort()
    } catch (e) {
      // 忽略重复取消
    }
    activeStreams.delete(id)
  }
})

module.exports = { buildChatURL }
