/**
 * MCP 服务端（Streamable HTTP 传输）
 * 挂载在远程服务器（httpServer.js）的 /mcp 端点上，
 * 让外部 AI 客户端（Trae / Claude Desktop / Cursor 等）通过标准 MCP 协议
 * 安装并调用本程序的全部工具（工具清单与执行均桥接到渲染进程）。
 *
 * 协议：JSON-RPC 2.0 over HTTP POST
 *   - initialize               握手，返回 serverInfo + 会话 ID
 *   - notifications/initialized 客户端就绪通知（202，无响应体）
 *   - tools/list                工具清单（按令牌权限过滤）
 *   - tools/call                执行单个工具（校验令牌权限后桥接渲染进程）
 *   - ping                      心跳
 *
 * 认证（多令牌）：
 *   - 主令牌：与远程服务器（HTTP Agent API）共用，全部工具可用
 *   - 访问令牌（mcpTokens）：每个令牌独立勾选可用工具范围，
 *     在设置页"访问令牌管理"中创建/编辑/停用/删除
 */
const crypto = require('crypto')

let getMainWindow = () => null
let readConfig = () => ({})
let writeConfig = () => {}
let tokenMatches = () => false
let getPort = () => 0
let isRunning = () => false

// 渲染进程请求等待队列：id -> { resolve, reject, timer }
const pendingMcpRequests = new Map()
// 已建立的 MCP 会话（initialize 时分配）
const mcpSessions = new Set()
const MCP_REQUEST_TIMEOUT_MS = 180000

const PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05']

const init = (opts = {}) => {
  getMainWindow = opts.getMainWindow || (() => null)
  readConfig = opts.readConfig || (() => ({}))
  writeConfig = opts.writeConfig || (() => {})
  tokenMatches = opts.tokenMatches || (() => false)
  getPort = opts.getPort || (() => 0)
  isRunning = opts.isRunning || (() => false)

  const { ipcMain } = require('electron')
  ipcMain.on('mcp-server:response', (event, payload) => {
    if (!payload || !payload.id) return
    const item = pendingMcpRequests.get(payload.id)
    if (!item) return
    pendingMcpRequests.delete(payload.id)
    clearTimeout(item.timer)
    item.resolve(payload)
  })
  registerTokenHandlers(ipcMain)
}

// ========== 访问令牌（多令牌 + 每令牌工具权限范围） ==========
const TOKEN_ID_PREFIX = 'mcp_token_'

const listTokens = () => {
  const config = readConfig()
  return Array.isArray(config.mcpTokens) ? config.mcpTokens.filter(t => t && t.id) : []
}

const saveTokens = (tokens) => {
  const config = readConfig()
  config.mcpTokens = tokens
  writeConfig(config)
}

const timingSafeEqualStr = (a, b) => {
  const ba = Buffer.from(String(a || ''))
  const bb = Buffer.from(String(b || ''))
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}

/**
 * 解析请求令牌 → { full: true } 主令牌全权限；
 * { full: false, entry } 访问令牌（按 allowedTools 限权）；null = 无效
 */
const resolveToken = (token) => {
  if (typeof token !== 'string' || !token) return null
  if (tokenMatches(token)) {
    // 主令牌同样校验有效期，与 HTTP Agent API 各端点一致（tokenMatches 只比对令牌值）
    const cfg = readConfig()
    if (!cfg.tokenExpiresAt || Date.now() >= cfg.tokenExpiresAt) return null
    return { full: true }
  }
  const entry = listTokens().find(t => t.enabled !== false && timingSafeEqualStr(t.token, token))
  return entry ? { full: false, entry } : null
}

const isToolAllowed = (tokenCtx, toolName) => {
  if (!tokenCtx || tokenCtx.full) return true
  const allowed = tokenCtx.entry.allowedTools
  if (!Array.isArray(allowed) || allowed.length === 0) return false
  return allowed.includes('*') || allowed.includes(toolName)
}

// 记录最近使用（节流：同令牌 60 秒内不重复写盘）
const touchToken = (entry) => {
  const now = Date.now()
  if (entry.lastUsedAt && now - entry.lastUsedAt < 60000) return
  const tokens = listTokens()
  const item = tokens.find(t => t.id === entry.id)
  if (!item) return
  item.lastUsedAt = now
  saveTokens(tokens)
}

const normalizeAllowedTools = (allowedTools) => {
  if (Array.isArray(allowedTools) && allowedTools.includes('*')) return ['*']
  const list = Array.isArray(allowedTools)
    ? allowedTools.filter(x => typeof x === 'string' && x && x !== '*')
    : []
  return list
}

function registerTokenHandlers(ipcMain) {
  ipcMain.handle('mcp-tokens:list', () => ({ tokens: listTokens() }))

  ipcMain.handle('mcp-tokens:create', (event, { name, allowedTools }) => {
    try {
      const tokens = listTokens()
      const tokenName = String(name || '').trim() || '未命名令牌'
      const entry = {
        id: TOKEN_ID_PREFIX + crypto.randomBytes(6).toString('hex'),
        name: tokenName.slice(0, 30),
        token: crypto.randomBytes(24).toString('base64url'),
        enabled: true,
        allowedTools: normalizeAllowedTools(allowedTools),
        createdAt: Date.now(),
        lastUsedAt: 0
      }
      tokens.push(entry)
      saveTokens(tokens)
      return { success: true, token: entry }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('mcp-tokens:update', (event, { id, patch }) => {
    try {
      const tokens = listTokens()
      const item = tokens.find(t => t.id === id)
      if (!item) return { success: false, error: '令牌不存在' }
      if (patch && patch.name !== undefined) item.name = String(patch.name || '').trim().slice(0, 30) || item.name
      if (patch && patch.enabled !== undefined) item.enabled = !!patch.enabled
      if (patch && patch.allowedTools !== undefined) item.allowedTools = normalizeAllowedTools(patch.allowedTools)
      // 重置令牌值（可选）：泄露后一键轮换
      if (patch && patch.rotate === true) item.token = crypto.randomBytes(24).toString('base64url')
      saveTokens(tokens)
      return { success: true, token: item }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('mcp-tokens:remove', (event, { id }) => {
    try {
      const tokens = listTokens()
      const next = tokens.filter(t => t.id !== id)
      if (next.length === tokens.length) return { success: false, error: '令牌不存在' }
      saveTokens(next)
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // 按访问令牌生成安装 JSON（含该令牌自身）
  ipcMain.handle('mcp-tokens:installConfig', (event, { id }) => {
    const item = listTokens().find(t => t.id === id)
    if (!item) return { success: false, error: '令牌不存在' }
    // HTTP 服务未开启时无法生成可用的端点地址（port 为 0），明确提示而不是返回错误配置
    if (!isRunning()) {
      return { success: false, running: false, error: '本地 HTTP 服务未开启，请先开启后再生成安装配置' }
    }
    return {
      success: true,
      running: true,
      port: getPort(),
      installConfig: buildInstallConfig(getPort(), item.token),
      mcpUrl: `http://127.0.0.1:${getPort()}/mcp`
    }
  })
}

// 向渲染进程发起请求并等待回复（复用 agent-api 的双向 IPC 模式）
const requestRenderer = (kind, toolName, args, ctx) => new Promise((resolve, reject) => {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || !win.webContents) {
    reject(new Error('应用主页面不可用（请先启动本程序并保持后台运行）'))
    return
  }
  const id = crypto.randomUUID()
  const timer = setTimeout(() => {
    pendingMcpRequests.delete(id)
    reject(new Error('MCP 请求超时，渲染进程未响应'))
  }, MCP_REQUEST_TIMEOUT_MS)
  pendingMcpRequests.set(id, { resolve, reject, timer })
  win.webContents.send('mcp-server:request', { id, kind, toolName, args: args || {}, ctx: ctx || {} })
})

const sendRpcError = (res, statusCode, code, message, id = null) => {
  const body = JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id })
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

const sendRpcResult = (res, result, id, extraHeaders = {}) => {
  const body = JSON.stringify({ jsonrpc: '2.0', result, id })
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  })
  res.end(body)
}

// 工具执行结果 → MCP content 文本
const resultToContent = (payload) => {
  if (payload && payload.ok === false) {
    return { text: `工具执行失败：${payload.error || '未知错误'}`, isError: true }
  }
  const r = payload && payload.result !== undefined ? payload.result : payload
  let text
  if (typeof r === 'string') {
    text = r
  } else if (r && typeof r === 'object') {
    if (r.success === false) {
      text = `工具执行失败：${r.message || '未知错误'}`
      return { text, isError: true }
    }
    text = r.message || r.content || r.text || JSON.stringify(r)
  } else {
    text = String(r ?? '')
  }
  return { text, isError: false }
}

/**
 * 处理 /mcp 端点请求。返回 true 表示已处理（httpServer 不再继续路由）。
 */
const handleMcpRequest = async (req, res, url, readBody) => {
  // 认证：主令牌（全权限）或访问令牌（按令牌勾选的工具范围）
  const authHeader = String(req.headers['authorization'] || '')
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const config = readConfig()
  const tokenCtx = resolveToken(token)
  if (!config.enabled || !tokenCtx) {
    sendRpcError(res, 401, -32001, 'Token 无效或已停用。主令牌在远程服务器设置中查看；访问令牌在设置-访问令牌管理中创建')
    return true
  }
  const ctx = { tokenName: tokenCtx.full ? '主令牌' : tokenCtx.entry.name }

  if (req.method === 'GET') {
    // Streamable HTTP：GET 用于服务端推送流；本服务无主动推送，按规范返回 405
    res.writeHead(405, { 'Allow': 'POST, DELETE' })
    res.end()
    return true
  }

  if (req.method === 'DELETE') {
    const sessionId = req.headers['mcp-session-id']
    if (sessionId && mcpSessions.has(sessionId)) mcpSessions.delete(sessionId)
    res.writeHead(200)
    res.end()
    return true
  }

  if (req.method !== 'POST') {
    sendRpcError(res, 405, -32000, 'Method not allowed')
    return true
  }

  let body
  try {
    body = await readBody(req)
  } catch (e) {
    sendRpcError(res, 400, -32700, '请求体不是合法 JSON：' + (e.message || ''))
    return true
  }
  const { id, method, params } = body || {}
  const isNotification = id === undefined || id === null

  try {
    // initialize：握手 + 分配会话
    if (method === 'initialize') {
      const requested = String((params && params.protocolVersion) || '')
      const protocolVersion = PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : PROTOCOL_VERSIONS[0]
      const sessionId = crypto.randomUUID()
      mcpSessions.add(sessionId)
      sendRpcResult(res, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'my-mindmap-agent', version: '2.1.0', title: 'My-Mindmap Agent（思维导图智能体）' }
      }, id, { 'Mcp-Session-Id': sessionId })
      return true
    }

    // 通知类消息：无 id，返回 202 Accepted
    if (typeof method === 'string' && method.startsWith('notifications/')) {
      res.writeHead(202)
      res.end()
      return true
    }

    if (method === 'ping') {
      sendRpcResult(res, {}, id)
      return true
    }

    if (method === 'tools/list') {
      const payload = await requestRenderer('list-tools', null, {}, ctx)
      let tools = Array.isArray(payload && payload.tools) ? payload.tools : []
      // 访问令牌只下发其权限范围内的工具（客户端看不到未授权工具）
      if (!tokenCtx.full) {
        tools = tools.filter(t => t && isToolAllowed(tokenCtx, t.name))
      }
      sendRpcResult(res, { tools }, id)
      return true
    }

    if (method === 'tools/call') {
      const toolName = params && params.name
      const toolArgs = (params && params.arguments) || {}
      if (!toolName) {
        sendRpcError(res, 200, -32602, 'params.name 不能为空', id)
        return true
      }
      // 权限校验：访问令牌只能调用勾选的工具
      if (!isToolAllowed(tokenCtx, toolName)) {
        sendRpcError(res, 200, -32003, `令牌「${tokenCtx.entry.name}」没有工具 ${toolName} 的调用权限，请在 设置 → 访问令牌管理 中调整该令牌的权限范围`, id)
        return true
      }
      if (!tokenCtx.full) touchToken(tokenCtx.entry)
      const payload = await requestRenderer('call-tool', toolName, toolArgs, ctx)
      const { text, isError } = resultToContent(payload)
      sendRpcResult(res, {
        content: [{ type: 'text', text }],
        isError
      }, id)
      return true
    }

    sendRpcError(res, 200, -32601, `Method not found: ${method}`, id)
    return true
  } catch (error) {
    sendRpcError(res, 200, -32000, error.message || 'MCP 服务器内部错误', id)
    return true
  }
}

// 生成给外部 AI 客户端（Trae / Claude Desktop / Cursor 等）的安装配置 JSON
const buildInstallConfig = (port, token) => {
  const url = `http://127.0.0.1:${port}/mcp`
  return {
    mcpServers: {
      'my-mindmap-agent': {
        url,
        headers: { Authorization: `Bearer ${token}` }
      }
    }
  }
}

module.exports = { init, handleMcpRequest, buildInstallConfig, requestRenderer }
