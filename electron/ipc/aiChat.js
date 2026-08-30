/**
 * AI 对话请求 IPC 处理
 * 通过主进程代理 API 请求，避免渲染进程的 CORS 限制
 */
const { ipcMain } = require('electron')
const { getAiTimeoutMs } = require('../utils/store')

/**
 * 构建 chat completions API URL
 * autoComplete=false 时地址原样使用（仅去除末尾斜杠），适配自带独立后缀的厂商
 */
function buildChatURL(baseURL, autoComplete = true) {
  if (!baseURL) return ''
  let url = baseURL.trim().replace(/\/+$/, '')
  if (autoComplete === false) return url
  // 自愈历史版本错误拼接出的双重版本路径（如 /v4/v1/chat/completions → /v4/chat/completions）
  url = url.replace(/(\/v\d+[a-z]*)(?:\/v\d+[a-z]*)+\/chat\/completions$/i, '$1/chat/completions')
  if (/\/chat\/completions$/i.test(url)) return url
  // 已带版本号（/v1、/v4、/v1beta、/compatible-mode/v1 等）→ 只补 /chat/completions，避免拼出 /v4/v1/... 双重路径
  if (/\/v\d+[a-z]*$/i.test(url)) return url + '/chat/completions'
  return url + '/v1/chat/completions'
}

// 延迟 require，避免与 aiConfig.js 的循环依赖（aiConfig 也 require 本模块的 buildChatURL）
let resolveApiKeyForProfile = null
const getApiKeyResolver = () => {
  if (!resolveApiKeyForProfile) {
    try {
      resolveApiKeyForProfile = require('./aiConfig').resolveApiKeyForProfile
    } catch {
      resolveApiKeyForProfile = () => ''
    }
  }
  return resolveApiKeyForProfile
}

// 主进程注入 Authorization：渲染进程不再传 apiKey 明文，改为传 profileId，
// 由主进程按 id 查 key 注入请求头，杜绝渲染进程持有明文 apiKey（防 XSS 窃取）。
function injectAuth(headers, profileId) {
  const h = { ...(headers || {}) }
  if (!h['Authorization'] && profileId) {
    const key = getApiKeyResolver()(profileId)
    if (key) h['Authorization'] = `Bearer ${key}`
  }
  return h
}

/**
 * 非流式对话请求
 * 参数: { url, headers, body, profileId }
 * 返回: { success, data } 或 { success: false, status, error }
 */
ipcMain.handle('ai:chat', async (event, { url, headers, body, profileId }) => {
  // 429 限频自动重试（指数退避），最多 3 次；超时保护避免请求永久挂起
  const MAX_ATTEMPTS = 3
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timeoutMs = getAiTimeoutMs()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: injectAuth(headers, profileId),
        body,
        signal: controller.signal
      })

      if (response.status === 429 && attempt < MAX_ATTEMPTS - 1) {
        // 限频：指数退避后重试
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
        continue
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        return { success: false, status: response.status, error: errText }
      }

      const data = await response.json()
      return { success: true, data }
    } catch (error) {
      if (error && error.name === 'AbortError') {
        return { success: false, error: `请求超时（${Math.round(timeoutMs / 1000)} 秒），请检查 API 地址与网络` }
      }
      return { success: false, error: error.message }
    } finally {
      clearTimeout(timer)
    }
  }
  return { success: false, error: '请求失败（重试次数已用尽）' }
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
ipcMain.on('ai:chatStream', async (event, { id, url, headers, body, profileId }) => {
  const controller = new AbortController()
  activeStreams.set(id, controller)
  // 流式空闲超时：模型在长推理/网络抖动后可能既不结束也不发数据（连接僵死），
  // 此时渲染进程 read() 会永久挂起（表现为"AI 卡住无输出"）。超过阈值无任何字节到达即中断并回传错误，
  // 让渲染进程以可恢复的报错收尾，而不是无限转圈。每次收到数据块都会重置计时。
  const IDLE_TIMEOUT_MS = getAiTimeoutMs()
  let idleTimer = null
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      try { controller.abort() } catch (e) {}
      try {
        event.reply(`ai:chat:error:${id}`, `流式响应超时（${Math.round(IDLE_TIMEOUT_MS / 1000)} 秒无数据），已中断连接`)
      } catch (e) {
        // 渲染层可能已销毁
      }
    }, IDLE_TIMEOUT_MS)
  }
  try {
    resetIdleTimer()
    const response = await fetch(url, {
      method: 'POST',
      headers: injectAuth(headers, profileId),
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

/**
 * 文件上传代理（files API）：multipart/form-data 上传到厂商的 files 端点
 * 参数: { url, apiKey, fileName, base64, mimeType, purpose, extraFields }
 *   - url: 上传端点（渲染层按厂商构造）
 *   - base64: 文件二进制 base64（不含 data: 前缀）
 *   - purpose: OpenAI 兼容系的 purpose 字段（user_data / file-extract / vision 等）
 *   - extraFields: 厂商特定附加表单字段（如 Gemini 的 metadata、通义的其它字段）
 * 返回: { success, data } 或 { success: false, status, error }
 */
ipcMain.handle('ai:uploadFile', async (event, { url, apiKey, profileId, fileName, base64, mimeType, purpose, extraFields }) => {
  if (!url || !base64) {
    return { success: false, error: '缺少上传地址或文件数据' }
  }
  const controller = new AbortController()
  const timeoutMs = getAiTimeoutMs()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const buf = Buffer.from(base64, 'base64')
    const form = new FormData()
    const blob = new Blob([buf], { type: mimeType || 'application/octet-stream' })
    form.append('file', blob, fileName || 'file')
    if (purpose) form.append('purpose', purpose)
    if (extraFields && typeof extraFields === 'object') {
      for (const [k, v] of Object.entries(extraFields)) {
        if (v !== undefined && v !== null && v !== '') form.append(k, String(v))
      }
    }
    // Authorization 优先由主进程按 profileId 注入；兼容旧调用方显式传 apiKey
    const headers = injectAuth({}, profileId)
    if (!headers['Authorization'] && apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    // 不要手动设置 Content-Type：fetch + FormData 会自动附带正确的 multipart boundary
    const response = await fetch(url, { method: 'POST', headers, body: form, signal: controller.signal })
    const text = await response.text().catch(() => '')
    let data
    try { data = JSON.parse(text) } catch { data = text }
    if (!response.ok) {
      return { success: false, status: response.status, error: text }
    }
    return { success: true, data }
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { success: false, error: `上传超时（${Math.round(timeoutMs / 1000)} 秒），请检查 files API 地址与网络` }
    }
    return { success: false, error: error.message }
  } finally {
    clearTimeout(timer)
  }
})

module.exports = { buildChatURL }
