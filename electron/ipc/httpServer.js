const { ipcMain } = require('electron')
const http = require('http')
const crypto = require('crypto')
const os = require('os')
const wsModule = require('ws')
const WebSocketServer = wsModule.WebSocketServer || wsModule.Server
const store = require('../utils/store')
const mcpServer = require('./mcpServer')
const { encryptString, decryptString } = require('../utils/secureStore')

const STORE_KEY = 'httpRemoteServer'
const DEFAULT_PORT = 17800
// 仅查看端口：独立端口 + 独立 token，只推送屏幕画面，不接受任何输入/操作
const VIEW_ONLY_STORE_KEY = 'httpViewOnlyServer'
const VIEW_ONLY_DEFAULT_PORT = 17801
const TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000
const FRAME_INTERVAL_MS = 50  // 降低帧间隔以减少延迟（约20fps）
const QUALITY_JPEG = { low: 55, medium: 76, high: 90, ultra: 98 }
const FRAME_HEADER_MAGIC = 0x4d46524d // 'MFRM'

let getMainWindow = () => null
let server = null
let wss = null
let port = 0
let starting = false
let clients = new Set()
let streamTimer = null
// 仅查看服务器状态（与主服务器相互独立，共享同一截图帧）
let viewOnlyServer = null
let viewOnlyWss = null
let viewOnlyPort = 0
let viewOnlyStarting = false
let viewOnlyClients = new Set()
// 缓存 quality 设置，避免每帧读 store
let cachedQuality = null
const getCachedQuality = () => {
  if (cachedQuality === null) {
    const q = readConfig().quality || 'medium'
    cachedQuality = QUALITY_JPEG[q] ? q : 'medium'
  }
  return cachedQuality
}
const setCachedQuality = (q) => { cachedQuality = QUALITY_JPEG[q] ? q : 'medium' }
let capturing = false
let frameRequested = false
let preRemoteWindowState = null
let lastWindowState = null
const pendingAgentRequests = new Map()

// 登录限流：每个 IP 在时间窗口内最多失败 N 次，超过则锁定（主服务与仅查看服务独立计数）
const LOGIN_RATE_LIMIT = {
  maxFailures: 10,      // 最大失败次数（放宽，避免误伤正常登录）
  windowMs: 60 * 1000,  // 时间窗口（1分钟）
  lockoutMs: 5 * 60 * 1000  // 锁定时长（5分钟）
}
const loginFailures = new Map() // 主服务限流：ip -> { count, firstFail, lockedUntil }
const viewOnlyLoginFailures = new Map() // 仅查看服务独立限流（与主服务隔离，避免互相累计）

// 获取客户端 IP
// 安全加固：X-Forwarded-For 头可被客户端伪造。仅在用户明确开启 trustProxy 后才信任，
// 避免公网暴露时被攻击者通过 XFF 头绕过登录限流（5 次锁定）
const trustHttpProxy = () => {
  try { return !!store.get('httpServerTrustProxy', false) } catch (e) { return false }
}
const getClientIp = (req) => {
  if (trustHttpProxy()) {
    const forwarded = req.headers['x-forwarded-for']
    if (forwarded) {
      const first = String(forwarded).split(',')[0].trim()
      if (first) return first
    }
  }
  return req.socket?.remoteAddress || 'unknown'
}

// 检查是否被限流（map 参数化，主/仅查看独立）
const isLoginRateLimited = (ip, map = loginFailures) => {
  const record = map.get(ip)
  if (!record) return false
  const now = Date.now()
  // 已锁定且未到期
  if (record.lockedUntil && now < record.lockedUntil) {
    return true
  }
  // 锁定已到期，清除记录
  if (record.lockedUntil && now >= record.lockedUntil) {
    map.delete(ip)
    return false
  }
  // 时间窗口已过，重置计数
  if (now - record.firstFail > LOGIN_RATE_LIMIT.windowMs) {
    map.delete(ip)
    return false
  }
  return false
}

// 记录登录失败
const recordLoginFailure = (ip, map = loginFailures) => {
  const now = Date.now()
  let record = map.get(ip)
  if (!record || now - record.firstFail > LOGIN_RATE_LIMIT.windowMs) {
    record = { count: 0, firstFail: now, lockedUntil: 0 }
    map.set(ip, record)
  }
  record.count += 1
  if (record.count >= LOGIN_RATE_LIMIT.maxFailures) {
    record.lockedUntil = now + LOGIN_RATE_LIMIT.lockoutMs
  }
}

// 记录登录成功（清除失败记录）
const recordLoginSuccess = (ip, map = loginFailures) => {
  map.delete(ip)
}

const readConfig = () => {
  const config = store.get(STORE_KEY, {}) || {}
  if (typeof config.token === 'string') config.token = decryptString(config.token)
  if (Array.isArray(config.mcpTokens)) {
    config.mcpTokens = config.mcpTokens.map(t => (t && typeof t.token === 'string' ? { ...t, token: decryptString(t.token) } : t))
  }
  return config
}
const writeConfig = (config) => {
  const c = { ...config }
  if (typeof c.token === 'string') c.token = encryptString(c.token)
  if (Array.isArray(c.mcpTokens)) {
    c.mcpTokens = c.mcpTokens.map(t => (t && typeof t.token === 'string' ? { ...t, token: encryptString(t.token) } : t))
  }
  store.set(STORE_KEY, c)
}

const generateToken = () => crypto.randomBytes(24).toString('base64url')

const ensureFreshToken = (config) => {
  if (!config.token || !config.tokenExpiresAt || Date.now() >= config.tokenExpiresAt) {
    config.token = generateToken()
    config.tokenExpiresAt = Date.now() + TOKEN_TTL_MS
    writeConfig(config)
  }
  return config
}

const tokenMatches = (value) => {
  if (typeof value !== 'string' || !value) return false
  const expected = readConfig().token || ''
  const a = Buffer.from(value)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// 仅查看端口独立配置与 token
const readViewOnlyConfig = () => {
  const config = store.get(VIEW_ONLY_STORE_KEY, {}) || {}
  if (typeof config.token === 'string') config.token = decryptString(config.token)
  return config
}
const writeViewOnlyConfig = (config) => {
  const c = { ...config }
  if (typeof c.token === 'string') c.token = encryptString(c.token)
  store.set(VIEW_ONLY_STORE_KEY, c)
}
const ensureFreshViewOnlyToken = (config) => {
  if (!config.token || !config.tokenExpiresAt || Date.now() >= config.tokenExpiresAt) {
    config.token = generateToken()
    config.tokenExpiresAt = Date.now() + TOKEN_TTL_MS
    writeViewOnlyConfig(config)
  }
  return config
}
const viewOnlyTokenMatches = (value) => {
  if (typeof value !== 'string' || !value) return false
  const expected = readViewOnlyConfig().token || ''
  const a = Buffer.from(value)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

const getLanAddresses = () => {
  const config = readConfig()
  const addresses = [`http://127.0.0.1:${port}`]
  // 未开启局域网访问时，只返回本机回环地址
  if (!config.lanAccess) return addresses
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(`http://${net.address}:${port}`)
      }
    }
  }
  return [...new Set(addresses)]
}

const getStatus = () => {
  const config = readConfig()
  const running = !!(server && server.listening)
  return {
    enabled: running,
    running,
    port,
    token: running ? config.token || '' : '',
    tokenExpiresAt: running ? config.tokenExpiresAt || 0 : 0,
    addresses: running ? getLanAddresses() : [],
    frameIntervalMs: FRAME_INTERVAL_MS,
    quality: config.quality || 'medium',
    lanAccess: !!config.lanAccess
  }
}

const readBody = (req) => new Promise((resolve, reject) => {
  let raw = ''
  let size = 0
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > 1024 * 1024) {
      reject(new Error('请求体过大'))
      req.destroy()
      return
    }
    raw += chunk.toString('utf8')
  })
  req.on('end', () => {
    try {
      resolve(raw ? JSON.parse(raw) : {})
    } catch (e) {
      reject(new Error('JSON 格式错误'))
    }
  })
  req.on('error', reject)
})

const sendJson = (res, statusCode, data) => {
  const body = JSON.stringify(data)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

const ensureMainWindowForRemote = (win) => {
  if (!win || win.isDestroyed()) return false
  let changed = false
  if (win.isMinimized()) {
    try { win.restore() } catch (e) {}
    changed = true
  }
  if (!win.isVisible()) {
    try { win.show() } catch (e) {}
    changed = true
  }
  if (!win.isMaximized() && !win.isFullScreen()) {
    try { win.maximize() } catch (e) {}
    changed = true
  }
  return changed
}

const saveWindowStateForRemote = (win) => {
  if (!win || win.isDestroyed()) return
  preRemoteWindowState = {
    visible: win.isVisible(),
    minimized: win.isMinimized(),
    maximized: win.isMaximized() || win.isFullScreen(),
    bounds: win.getBounds()
  }
}

const restoreWindowStateAfterRemote = (win) => {
  if (!win || win.isDestroyed() || !preRemoteWindowState) return
  const state = preRemoteWindowState
  preRemoteWindowState = null
  try {
    if (!state.maximized) {
      if (win.isMaximized()) win.unmaximize()
      if (state.bounds) win.setBounds(state.bounds)
    }
    if (state.minimized) {
      win.minimize()
    } else if (!state.visible) {
      win.hide()
    }
  } catch (e) {}
}

const isMainWindowAvailable = (win) => {
  // 最小化窗口仍属于“可控制”：渲染进程和输入注入都正常，只是画面可能暂时无法截取。
  // 只有窗口被关闭（主程序驻留托盘，窗口 hide）或已销毁时才算真正不可用。
  return !isMainWindowClosed(win)
}

// 对于纯后台任务（Agent API / 消息机器人等），只要渲染进程存在就能处理，
// 无需窗口可见。窗口隐藏到托盘时也可以正常收发 IPC 消息。
const isRendererAvailable = (win) => {
  return win && !win.isDestroyed()
}

const isMainWindowClosed = (win) => {
  if (!win || win.isDestroyed()) return true
  // Electron 28 在 Windows 上最小化时 isVisible() 为 false；
  // 因此必须用 isMinimized() 区分“最小化”和“关闭隐藏”。
  return !win.isVisible() && !win.isMinimized()
}

const getWindowState = (win) => {
  if (isMainWindowClosed(win)) return 'closed'
  if (win && win.isMinimized()) return 'minimized'
  return 'online'
}

const openMainWindowForRemote = (win) => {
  if (!win || win.isDestroyed()) return false
  try {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return true
  } catch (e) {
    return false
  }
}

const sendStateToAll = (state) => {
  if (state === lastWindowState) return
  lastWindowState = state
  const payload = JSON.stringify({ type: 'state', state })
  for (const ws of clients) {
    if (ws.readyState === 1) {
      try { ws.send(payload) } catch (e) {}
    }
  }
  for (const ws of viewOnlyClients) {
    if (ws.readyState === 1) {
      try { ws.send(payload) } catch (e) {}
    }
  }
}

const captureFrame = async () => {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return null
  if (isMainWindowClosed(win)) return null
  if (win.isMinimized()) return null
  try {
    const image = await win.webContents.capturePage()
    if (!image || image.isEmpty()) return null
    const bounds = win.getContentBounds()
    const qualityKey = getCachedQuality()
    const jpegQuality = QUALITY_JPEG[qualityKey] || QUALITY_JPEG.medium
    // 以 capturePage 返回的真实物理像素为基准缩放；高分屏下不做这个修正会
    // 把 2x 物理截图缩小回 1x 逻辑尺寸，导致“超清也只是放大缩小”的模糊感。
    const scale = qualityKey === 'low' ? 0.75 : qualityKey === 'medium' ? 0.85 : 1
    const imgSize = image.getSize()
    const targetW = Math.max(1, Math.round(imgSize.width * scale))
    const targetH = Math.max(1, Math.round(imgSize.height * scale))
    const needResize = imgSize.width !== targetW || imgSize.height !== targetH
    const resizeQuality = qualityKey === 'low' || qualityKey === 'medium' ? 'good' : 'best'
    const target = needResize ? image.resize({ width: targetW, height: targetH, quality: resizeQuality }) : image
    return {
      data: target.toJPEG(jpegQuality),
      width: bounds.width,
      height: bounds.height,
      scale
    }
  } catch (e) {
    return null
  }
}

const broadcastFrame = async () => {
  if (!clients.size && !viewOnlyClients.size) {
    stopStream()
    return
  }
  if (capturing) return
  const win = getMainWindow()
  const state = getWindowState(win)
  if (state !== 'online') {
    sendStateToAll(state)
    return
  }
  capturing = true
  const frame = await captureFrame()
  capturing = false
  if (frameRequested) {
    frameRequested = false
    setImmediate(broadcastFrame)
  }
  if (!frame) {
    // 刚恢复/最小化时 capturePage 可能拿不到画面；此时窗口并没有关闭，
    // 保持当前状态，不把远程端误判成黑屏或已关闭。
    sendStateToAll(getWindowState(getMainWindow()))
    return
  }
  lastWindowState = 'online'
  // 二进制帧：16 字节头部 + JPEG 原始数据。比 base64+JSON 少约 1/3 传输量，
  // 同时省掉浏览器端 JSON.parse 和 base64 解码，高画质下延迟更低。
  const header = Buffer.alloc(16)
  header.writeUInt32LE(FRAME_HEADER_MAGIC, 0)
  header.writeUInt32LE(frame.width, 4)
  header.writeUInt32LE(frame.height, 8)
  header.writeUInt16LE(Math.max(1, Math.round((frame.scale || 1) * 100)), 12)
  const payload = Buffer.concat([header, frame.data])
  for (const ws of clients) {
    if (ws.readyState === 1) {
      try { ws.send(payload, { binary: true }) } catch (e) {}
    }
  }
  for (const ws of viewOnlyClients) {
    if (ws.readyState === 1) {
      try { ws.send(payload, { binary: true }) } catch (e) {}
    }
  }
}

const requestImmediateFrame = () => {
  if (!clients.size && !viewOnlyClients.size) return
  if (capturing) {
    frameRequested = true
    return
  }
  setImmediate(broadcastFrame)
}

const getFrameInterval = (quality) => {
  // 统一优先保证流畅度；超高画质因编码量更大，允许稍长但仍有约 20fps。
  switch (quality) {
    case 'low': return 33      // ~30fps
    case 'medium': return 33   // ~30fps
    case 'high': return 40     // ~25fps
    case 'ultra': return 50    // ~20fps
    default: return 33
  }
}

const startStream = () => {
  if (streamTimer) return
  // 用自调度代替 setInterval：每帧截图完成后才安排下一帧，
  // 避免截图耗时超过间隔时发生漏帧和后续调度堆积，降低远程输入延迟。
  const runLoop = async () => {
    if (!clients.size && !viewOnlyClients.size) {
      stopStream()
      return
    }
    await broadcastFrame()
    if (!clients.size && !viewOnlyClients.size) {
      stopStream()
      return
    }
    streamTimer = setTimeout(runLoop, getFrameInterval(getCachedQuality()))
  }
  streamTimer = setTimeout(runLoop, 0)
}

const restartStreamWithQuality = (quality) => {
  if (!streamTimer) return
  clearTimeout(streamTimer)
  streamTimer = null
  startStream()
}

const stopStream = () => {
  if (streamTimer) {
    clearTimeout(streamTimer)
    streamTimer = null
  }
}

const forwardInput = (event) => {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || !event) return { ok: false, error: '主窗口不可用' }
  try {
    if (win.isMinimized()) win.restore()
    win.webContents.sendInputEvent(event)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
}

const insertRemoteText = async (text) => {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return false
  const safeText = String(text || '').slice(0, 2000)
  if (!safeText) return false
  const script = `(() => {
    const text = ${JSON.stringify(safeText)};
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    const isEditable = el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA';
    if (!isEditable) return false;
    try {
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        const start = el.selectionStart == null ? el.value.length : el.selectionStart;
        const end = el.selectionEnd == null ? start : el.selectionEnd;
        el.setRangeText(text, start, end, 'end');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        document.execCommand('insertText', false, text);
      }
      return true;
    } catch (err) {
      return false;
    }
  })()`
  try {
    return await win.webContents.executeJavaScript(script, true)
  } catch (e) {
    return false
  }
}

const isMainEditable = async () => {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return false
  const script = `(() => {
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    return el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA';
  })()`
  try {
    return !!(await win.webContents.executeJavaScript(script, true))
  } catch (e) {
    return false
  }
}

const handleRequest = async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  // MCP 服务端端点：/mcp（Streamable HTTP 传输，供外部 AI 客户端安装调用本程序工具）
  if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
    await mcpServer.handleMcpRequest(req, res, url, readBody)
    return
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:"
    })
    res.end(REMOTE_PAGE)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    try {
      const ip = getClientIp(req)
      // 登录限流检查
      if (isLoginRateLimited(ip)) {
        sendJson(res, 429, { ok: false, error: '登录失败次数过多，请 5 分钟后再试' })
        return
      }
      const body = await readBody(req)
      const config = readConfig()
      if (!config.enabled || Date.now() >= config.tokenExpiresAt || !tokenMatches(body.token)) {
        recordLoginFailure(ip)
        sendJson(res, 401, { ok: false, error: 'Token 无效或已过期' })
        return
      }
      recordLoginSuccess(ip)
      sendJson(res, 200, { ok: true, tokenExpiresAt: config.tokenExpiresAt })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const config = readConfig()
    const token = url.searchParams.get('token') || ''
    if (!config.enabled || Date.now() >= config.tokenExpiresAt || !tokenMatches(token)) {
      sendJson(res, 401, { ok: false, error: 'Token 无效或已过期' })
      return
    }
    sendJson(res, 200, { ok: true, ...getStatus() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/agent/chat') {
    try {
      const body = await readBody(req)
      const config = readConfig()
      const authToken = String(body.token || req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim()
      if (!config.enabled || Date.now() >= config.tokenExpiresAt || !tokenMatches(authToken)) {
        sendJson(res, 401, { ok: false, error: 'Token 无效或已过期' })
        return
      }
      const message = String(body.message || '').trim()
      if (!message) {
        sendJson(res, 400, { ok: false, error: 'message 不能为空' })
        return
      }
      const win = getMainWindow()
      // Agent API 是纯后台任务，只需渲染进程存在即可，无需窗口可见
      // 窗口隐藏到托盘时也能正常处理，不会打扰用户
      if (!isRendererAvailable(win)) {
        sendJson(res, 503, { ok: false, error: '主页面已关闭' })
        return
      }
      const id = crypto.randomUUID()
      const promise = new Promise((resolve, reject) => {
        const timeoutMs = store.getAiTimeoutMs()
        const timer = setTimeout(() => {
          pendingAgentRequests.delete(id)
          reject(new Error(`Agent 请求超时（${Math.round(timeoutMs / 1000)}秒）`))
        }, timeoutMs)
        pendingAgentRequests.set(id, { resolve, reject, timer })
      })
      win.webContents.send('agent-api:request', {
        id,
        message,
        source: String(body.source || 'agent')
      })
      try {
        const result = await promise
        sendJson(res, 200, { ok: true, reply: result })
      } catch (e) {
        sendJson(res, 504, { ok: false, error: e.message || 'Agent 请求失败' })
      }
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  sendJson(res, 404, { ok: false, error: 'Not Found' })
}

// ===== 仅查看端口：只提供画面查看，不提供任何操作端点（无 /mcp、无 Agent API） =====
const handleViewOnlyRequest = async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const config = readViewOnlyConfig()

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:"
    })
    res.end(REMOTE_VIEW_PAGE)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    try {
      const ip = getClientIp(req)
      // 登录限流检查（仅查看服务独立计数，与主服务隔离）
      if (isLoginRateLimited(ip, viewOnlyLoginFailures)) {
        sendJson(res, 429, { ok: false, error: '登录失败次数过多，请 5 分钟后再试' })
        return
      }
      const body = await readBody(req)
      if (!config.enabled || Date.now() >= config.tokenExpiresAt || !viewOnlyTokenMatches(body.token)) {
        recordLoginFailure(ip, viewOnlyLoginFailures)
        sendJson(res, 401, { ok: false, error: 'Token 无效或已过期' })
        return
      }
      recordLoginSuccess(ip, viewOnlyLoginFailures)
      sendJson(res, 200, { ok: true, tokenExpiresAt: config.tokenExpiresAt })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const token = url.searchParams.get('token') || ''
    if (!config.enabled || Date.now() >= config.tokenExpiresAt || !viewOnlyTokenMatches(token)) {
      sendJson(res, 401, { ok: false, error: 'Token 无效或已过期' })
      return
    }
    sendJson(res, 200, { ok: true, viewOnly: true })
    return
  }

  sendJson(res, 404, { ok: false, error: 'Not Found' })
}

const handleViewOnlyUpgrade = (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname !== '/ws') {
    socket.destroy()
    return
  }
  const config = readViewOnlyConfig()
  const token = url.searchParams.get('token') || ''
  if (!config.enabled || Date.now() >= config.tokenExpiresAt || !viewOnlyTokenMatches(token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  viewOnlyWss.handleUpgrade(req, socket, head, (ws) => {
    const win = getMainWindow()
    viewOnlyClients.add(ws)
    ws.send(JSON.stringify({
      type: 'ready',
      port: viewOnlyPort,
      tokenExpiresAt: config.tokenExpiresAt,
      quality: getCachedQuality(),
      state: isMainWindowAvailable(win) ? 'online' : 'closed'
    }))
    startStream()

    // 仅查看：忽略所有客户端消息（input/text/quality/reconnect 一律不处理），只推送画面
    ws.on('message', () => {})

    ws.on('close', () => {
      viewOnlyClients.delete(ws)
      if (!clients.size && !viewOnlyClients.size) {
        stopStream()
        restoreWindowStateAfterRemote(getMainWindow())
      }
    })

    ws.on('error', () => {
      viewOnlyClients.delete(ws)
      if (!clients.size && !viewOnlyClients.size) {
        stopStream()
        restoreWindowStateAfterRemote(getMainWindow())
      }
    })
  })
}

const handleUpgrade = (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname !== '/ws') {
    socket.destroy()
    return
  }
  const config = readConfig()
  const token = url.searchParams.get('token') || ''
  if (!config.enabled || Date.now() >= config.tokenExpiresAt || !tokenMatches(token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const win = getMainWindow()
    clients.add(ws)
    ws.send(JSON.stringify({
      type: 'ready',
      port,
      tokenExpiresAt: config.tokenExpiresAt,
      quality: config.quality || 'medium',
      state: isMainWindowAvailable(win) ? 'online' : 'closed'
    }))
    startStream()

    ws.on('message', async (raw) => {
      let message
      try { message = JSON.parse(raw.toString()) } catch (e) { return }
      if (message && message.type === 'input' && message.event) {
        const result = forwardInput(message.event)
        if (!result.ok) {
          try {
            ws.send(JSON.stringify({ type: 'inputError', error: result.error || '输入注入失败' }))
          } catch (e) {}
        } else {
          requestImmediateFrame()
          if (message.event.type === 'mouseUp' && message.event.button === 'left') {
            try {
              const editable = await isMainEditable()
              ws.send(JSON.stringify({ type: 'editableFocus', editable: !!editable }))
            } catch (e) {}
          }
        }
      } else if (message && message.type === 'text' && typeof message.text === 'string') {
        const inserted = await insertRemoteText(message.text)
        if (inserted) {
          requestImmediateFrame()
        }
      } else if (message && message.type === 'quality' && QUALITY_JPEG[message.quality]) {
        const cfg = readConfig()
        cfg.quality = message.quality
        writeConfig(cfg)
        setCachedQuality(message.quality)
        // 动态调整帧率：低画质更快帧率，高画质稍慢
        restartStreamWithQuality(message.quality)
        try {
          ws.send(JSON.stringify({ type: 'quality', quality: message.quality }))
        } catch (e) {}
      } else if (message && message.type === 'reconnect') {
        openMainWindowForRemote(getMainWindow())
        requestImmediateFrame()
      }
    })

    ws.on('close', () => {
      clients.delete(ws)
      if (!clients.size) {
        stopStream()
        restoreWindowStateAfterRemote(getMainWindow())
      }
    })

    ws.on('error', () => {
      clients.delete(ws)
      if (!clients.size) {
        stopStream()
        restoreWindowStateAfterRemote(getMainWindow())
      }
    })
  })
}

const listen = (portToTry) => new Promise((resolve, reject) => {
  const onError = (err) => {
    server.removeListener('error', onError)
    // EADDRINUSE：端口被占用；EACCES：端口被系统保留/防火墙拒绝
    if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && portToTry !== 0) {
      listen(0).then(resolve).catch(reject)
      return
    }
    reject(err)
  }
  server.once('error', onError)
  // 默认只监听本机回环地址；用户显式开启"允许局域网访问"后才监听 0.0.0.0
  const host = readConfig().lanAccess ? '0.0.0.0' : '127.0.0.1'
  server.listen(portToTry, host, () => {
    server.removeListener('error', onError)
    port = server.address().port
    const config = ensureFreshToken(readConfig())
    config.port = port
    writeConfig(config)
    resolve(port)
  })
})

const start = async () => {
  if (server && server.listening) return getStatus()
  if (starting) return getStatus()
  starting = true
  const config = ensureFreshToken(readConfig())
  config.enabled = true
  writeConfig(config)

  server = http.createServer(handleRequest)
  wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', handleUpgrade)

  try {
    await listen(DEFAULT_PORT)
  } catch (e) {
    starting = false
    server = null
    wss = null
    const config = readConfig()
    config.enabled = false
    writeConfig(config)
    throw e
  }
  starting = false
  return getStatus()
}

const stop = () => {
  for (const ws of clients) {
    try { ws.close() } catch (e) {}
  }
  clients.clear()
  if (wss) {
    try { wss.close() } catch (e) {}
    wss = null
  }
  if (server) {
    try { server.close() } catch (e) {}
    server = null
  }
  port = 0
  const config = readConfig()
  config.enabled = false
  writeConfig(config)
  // 若仅查看端口仍有客户端，保持截图流运行，避免共享画面被误停
  if (!viewOnlyClients.size) stopStream()
}

const setEnabled = async (enabled) => {
  if (enabled) return start()
  stop()
  return getStatus()
}

// ===== 仅查看端口启动/停止 =====
const listenViewOnly = (portToTry) => new Promise((resolve, reject) => {
  const onError = (err) => {
    viewOnlyServer.removeListener('error', onError)
    // EADDRINUSE：端口被占用；EACCES：端口被系统保留/防火墙拒绝（Windows 常见）
    if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && portToTry !== 0) {
      listenViewOnly(0).then(resolve).catch(reject)
      return
    }
    reject(err)
  }
  viewOnlyServer.once('error', onError)
  // 默认只监听本机回环地址；用户显式开启"允许局域网访问"后才监听 0.0.0.0
  const viewHost = readViewOnlyConfig().lanAccess ? '0.0.0.0' : '127.0.0.1'
  viewOnlyServer.listen(portToTry, viewHost, () => {
    viewOnlyServer.removeListener('error', onError)
    viewOnlyPort = viewOnlyServer.address().port
    const cfg = ensureFreshViewOnlyToken(readViewOnlyConfig())
    cfg.port = viewOnlyPort
    writeViewOnlyConfig(cfg)
    resolve(viewOnlyPort)
  })
})

const getViewOnlyStatus = () => {
  const config = readViewOnlyConfig()
  const running = !!(viewOnlyServer && viewOnlyServer.listening)
  const addresses = running ? (() => {
    const list = [`http://127.0.0.1:${viewOnlyPort}`]
    if (!config.lanAccess) return list
    const nets = os.networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          list.push(`http://${net.address}:${viewOnlyPort}`)
        }
      }
    }
    return [...new Set(list)]
  })() : []
  return {
    enabled: running,
    running,
    port: viewOnlyPort,
    token: running ? config.token || '' : '',
    tokenExpiresAt: running ? config.tokenExpiresAt || 0 : 0,
    addresses,
    lanAccess: !!config.lanAccess
  }
}

const startViewOnly = async () => {
  if (viewOnlyServer && viewOnlyServer.listening) return getViewOnlyStatus()
  if (viewOnlyStarting) return getViewOnlyStatus()
  viewOnlyStarting = true
  const config = ensureFreshViewOnlyToken(readViewOnlyConfig())
  config.enabled = true
  writeViewOnlyConfig(config)

  viewOnlyServer = http.createServer(handleViewOnlyRequest)
  viewOnlyWss = new WebSocketServer({ noServer: true })
  viewOnlyServer.on('upgrade', handleViewOnlyUpgrade)

  try {
    await listenViewOnly(VIEW_ONLY_DEFAULT_PORT)
  } catch (e) {
    viewOnlyStarting = false
    viewOnlyServer = null
    viewOnlyWss = null
    const cfg = readViewOnlyConfig()
    cfg.enabled = false
    writeViewOnlyConfig(cfg)
    throw e
  }
  viewOnlyStarting = false
  return getViewOnlyStatus()
}

const stopViewOnly = () => {
  for (const ws of viewOnlyClients) {
    try { ws.close() } catch (e) {}
  }
  viewOnlyClients.clear()
  if (viewOnlyWss) {
    try { viewOnlyWss.close() } catch (e) {}
    viewOnlyWss = null
  }
  if (viewOnlyServer) {
    try { viewOnlyServer.close() } catch (e) {}
    viewOnlyServer = null
  }
  viewOnlyPort = 0
  const cfg = readViewOnlyConfig()
  cfg.enabled = false
  writeViewOnlyConfig(cfg)
}

const setViewOnlyEnabled = async (enabled) => {
  if (enabled) return startViewOnly()
  stopViewOnly()
  return getViewOnlyStatus()
}

const init = (getWindow) => {
  getMainWindow = getWindow || (() => null)
  // MCP 服务端初始化：桥接到渲染进程的工具清单与执行
  mcpServer.init({
    getMainWindow: () => getMainWindow(),
    readConfig,
    writeConfig,
    tokenMatches,
    getPort: () => port,
    isRunning: () => !!(server && server.listening),
    // 把用户配置的 MCP 服务也桥接给外部 Agent：tools/list 时把它们的工具以 mcp__<id>__<name> 暴露，
    // tools/call 时由 mcpManager 实际转发到对应的 stdio / http MCP server。
    getUserMcpServers: () => {
      try {
        const cfg = store.get('mcpServers', [])
        return Array.isArray(cfg) ? cfg.filter(s => s && s.enabled !== false) : []
      } catch (_) { return [] }
    },
    callUserMcpTool: async (serverId, toolName, args) => {
      const mcpManager = require('./mcpManager')
      try {
        const result = await mcpManager.callTool(serverId, toolName, args || {})
        return { success: true, message: typeof result === 'string' ? result : JSON.stringify(result), data: result }
      } catch (e) {
        return { success: false, message: e.message || String(e) }
      }
    }
  })
  ipcMain.handle('http-server:getStatus', () => getStatus())
  // MCP 安装配置 JSON：外部 AI 客户端（Trae / Claude Desktop / Cursor 等）可直接粘贴安装
  ipcMain.handle('mcp-server:getInstallConfig', () => {
    const running = !!(server && server.listening)
    const config = readConfig()
    return {
      running,
      port,
      installConfig: running ? mcpServer.buildInstallConfig(port, config.token || '') : null,
      mcpUrl: running ? `http://127.0.0.1:${port}/mcp` : '',
      lanUrls: running ? getLanAddresses().map(a => `${a}/mcp`) : []
    }
  })
  ipcMain.handle('http-server:setEnabled', async (event, enabled) => {
    return setEnabled(!!enabled)
  })
  ipcMain.handle('http-server:setQuality', async (event, quality) => {
    const config = readConfig()
    const q = QUALITY_JPEG[quality] ? quality : 'medium'
    config.quality = q
    writeConfig(config)
    setCachedQuality(q)
    restartStreamWithQuality(q)
    return getStatus()
  })
  // 允许局域网访问开关：修改后若服务运行中则重启以应用新监听地址
  ipcMain.handle('http-server:setLanAccess', async (event, lanAccess) => {
    const config = readConfig()
    config.lanAccess = !!lanAccess
    writeConfig(config)
    if (server && server.listening) {
      stop()
      await start()
    }
    return getStatus()
  })
  // 重置 HTTP 主 token：立即生成新 token，旧 token 失效
  ipcMain.handle('http-server:resetToken', async () => {
    const config = readConfig()
    config.token = generateToken()
    config.tokenExpiresAt = Date.now() + TOKEN_TTL_MS
    writeConfig(config)
    return getStatus()
  })
  // 仅查看端口 IPC
  ipcMain.handle('http-viewonly:getStatus', () => getViewOnlyStatus())
  ipcMain.handle('http-viewonly:setEnabled', async (event, enabled) => setViewOnlyEnabled(!!enabled))
  ipcMain.handle('http-viewonly:setLanAccess', async (event, lanAccess) => {
    const cfg = readViewOnlyConfig()
    cfg.lanAccess = !!lanAccess
    writeViewOnlyConfig(cfg)
    if (viewOnlyServer && viewOnlyServer.listening) {
      stopViewOnly()
      await startViewOnly()
    }
    return getViewOnlyStatus()
  })
  // 重置仅查看 token：立即生成新 token，旧 token 失效
  ipcMain.handle('http-viewonly:resetToken', async () => {
    const cfg = readViewOnlyConfig()
    cfg.token = generateToken()
    cfg.tokenExpiresAt = Date.now() + TOKEN_TTL_MS
    writeViewOnlyConfig(cfg)
    return getViewOnlyStatus()
  })
ipcMain.handle('httpServer:getConfig', () => {
  try { return { trustProxy: !!store.get('httpServerTrustProxy', false) } } catch (e) { return { trustProxy: false } }
})
ipcMain.handle('httpServer:setTrustProxy', (_event, enabled) => {
  try { store.set('httpServerTrustProxy', !!enabled) } catch (e) {}
  return { trustProxy: !!enabled }
})

  ipcMain.on('agent-api:response', (event, payload) => {
    const item = payload && payload.id ? pendingAgentRequests.get(payload.id) : null
    if (!item) return
    pendingAgentRequests.delete(payload.id)
    clearTimeout(item.timer)
    if (payload.error) item.reject(new Error(payload.error))
    else item.resolve(String(payload.reply || ''))
  })
}

const initAutoStart = async () => {
  const config = readConfig()
  if (config.enabled) {
    try {
      await start()
    } catch (e) {
      console.error('[http-server] 自动启动失败:', e)
    }
  }
  const viewConfig = readViewOnlyConfig()
  if (viewConfig.enabled) {
    try {
      await startViewOnly()
    } catch (e) {
      console.error('[http-viewonly] 自动启动失败:', e)
    }
  }
}

const REMOTE_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<title>my-mindmap agent 远程操作</title>
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111; color: #eee; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  #login { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #1b1b1f; z-index: 20; }
  .card { width: min(420px, calc(100vw - 40px)); background: #242429; border: 1px solid #38383f; border-radius: 16px; padding: 26px; box-shadow: 0 12px 40px rgba(0,0,0,.45); }
  .card h1 { font-size: 20px; margin: 0 0 10px; }
  .card p { color: #a7a7b3; font-size: 13px; line-height: 1.6; margin: 0 0 18px; }
  .card input { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #4a4a54; border-radius: 10px; background: #141417; color: #fff; font-size: 14px; outline: none; }
  .card button { width: 100%; margin-top: 14px; padding: 12px; border: none; border-radius: 10px; background: #0a84ff; color: #fff; font-size: 15px; cursor: pointer; }
  #stage { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #111; }
  #screen { max-width: 100vw; max-height: 100vh; user-select: none; -webkit-user-select: none; touch-action: none; }
  #imeInput { position: fixed; left: 10px; bottom: 10px; width: 1px; height: 1px; padding: 0; border: 0; opacity: 0; background: transparent; color: transparent; caret-color: transparent; outline: none; resize: none; z-index: 30; }
  #status { position: fixed; top: 12px; left: 12px; z-index: 10; padding: 7px 10px; background: rgba(0,0,0,.55); border-radius: 8px; font-size: 12px; color: #d6d6de; pointer-events: none; }
  #qualityBar { position: fixed; top: 12px; right: 12px; z-index: 11; padding: 6px 8px; background: rgba(0,0,0,.55); border-radius: 8px; display: flex; align-items: center; gap: 6px; font-size: 12px; color: #d6d6de; }
  #qualityBar select { background: #242429; color: #fff; border: 1px solid #3a3a42; border-radius: 6px; font-size: 12px; padding: 3px 6px; }
  #minimizedOverlay { position: fixed; inset: 0; z-index: 14; display: none; align-items: center; justify-content: center; background: rgba(17,17,17,.78); }
  #minimizedOverlay .card { text-align: center; }
  #minimizedOverlay button { margin-top: 14px; padding: 10px 18px; border: none; border-radius: 10px; background: #0a84ff; color: #fff; font-size: 14px; cursor: pointer; }
  #closedOverlay { position: fixed; inset: 0; z-index: 15; display: none; align-items: center; justify-content: center; background: rgba(17,17,17,.86); }
  #closedOverlay .card { text-align: center; }
  #closedOverlay button { margin-top: 14px; padding: 10px 18px; border: none; border-radius: 10px; background: #0a84ff; color: #fff; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>
  <div id="login">
    <div class="card">
      <h1>远程操作登录</h1>
      <p>请输入主程序设置中显示的访问 Token。Token 会保存在本浏览器，60 天内免重复输入。</p>
      <input id="token" autocomplete="off" placeholder="粘贴访问 Token" />
      <button id="loginBtn">连接</button>
    </div>
  </div>
  <div id="stage" style="display:none;">
    <img id="screen" draggable="false" alt="主程序画面" />
    <textarea id="imeInput" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>
    <div id="qualityBar">
      <span>画质</span>
      <select id="qualitySelect">
        <option value="low">流畅</option>
        <option value="medium" selected>均衡</option>
        <option value="high">清晰</option>
        <option value="ultra">超清</option>
      </select>
    </div>
  </div>
  <div id="closedOverlay">
    <div class="card">
      <h1>主页面已关闭</h1>
      <p>请在电脑端打开主程序后重连，或点击下方按钮重试。</p>
      <button id="reconnectBtn">一键重连</button>
    </div>
  </div>
  <div id="minimizedOverlay">
    <div class="card">
      <h1>主页面已最小化</h1>
      <p>当前窗口被缩小，无法获取画面。点击下方按钮恢复窗口后即可继续操作。</p>
      <button id="restoreBtn">点击恢复窗口</button>
    </div>
  </div>
  <div id="status">未连接</div>
<script>
(function () {
  var token = localStorage.getItem('mm_http_token') || '';
  var ws = null;
  var frameWidth = 0;
  var frameHeight = 0;
  var img = document.getElementById('screen');
  var imeInput = document.getElementById('imeInput');
  var login = document.getElementById('login');
  var stage = document.getElementById('stage');
  var statusEl = document.getElementById('status');
  var closedOverlay = document.getElementById('closedOverlay');
  var minimizedOverlay = document.getElementById('minimizedOverlay');
  var qualitySelect = document.getElementById('qualitySelect');
  var pendingReconnect = false;
  var frameObjectUrl = null;

  var setStatus = function (text) { statusEl.textContent = text; };

  var applyState = function (state) {
    closedOverlay.style.display = state === 'closed' ? 'flex' : 'none';
    minimizedOverlay.style.display = state === 'minimized' ? 'flex' : 'none';
    if (state === 'minimized') {
      setStatus('主页面已最小化，点击恢复窗口后继续操作');
    } else if (state === 'online') {
      setStatus('已连接');
    }
  };

  var loginAction = function () {
    var value = (document.getElementById('token').value || '').trim();
    if (!value) return;
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: value })
    }).then(function (r) {
      if (r.ok) {
        token = value;
        localStorage.setItem('mm_http_token', token);
        login.style.display = 'none';
        stage.style.display = 'flex';
        connect();
      } else {
        setStatus('Token 无效或已过期');
      }
    }).catch(function () { setStatus('连接失败'); });
  };

  document.getElementById('loginBtn').addEventListener('click', loginAction);
  document.getElementById('token').addEventListener('keydown', function (e) { if (e.key === 'Enter') loginAction(); });

  var connect = function () {
    if (ws) { try { ws.close(); } catch (e) {} }
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws?token=' + encodeURIComponent(token));
    ws.binaryType = 'arraybuffer';
    ws.onopen = function () {
      setStatus('已连接');
      if (pendingReconnect) {
        pendingReconnect = false;
        ws.send(JSON.stringify({ type: 'reconnect' }));
      }
    };
    ws.onmessage = function (e) {
      if (typeof e.data === 'string') {
        try {
          var msg = JSON.parse(e.data);
          if (msg.type === 'inputError') {
          setStatus('操作注入失败：' + (msg.error || '未知错误'));
          } else if (msg.type === 'editableFocus') {
          if (msg.editable) {
            imeInput.value = '';
            imeInput.dataset.composing = '0';
            var left = lastPointer.x;
            var top = lastPointer.y;
            imeInput.style.left = Math.max(10, Math.min(window.innerWidth - 10, left)) + 'px';
            imeInput.style.top = Math.max(10, Math.min(window.innerHeight - 10, top)) + 'px';
            imeInput.focus();
          } else {
            imeInput.value = '';
            imeInput.blur();
          }
          } else if (msg.type === 'state') {
          applyState(msg.state);
          } else if (msg.type === 'ready' || msg.type === 'quality') {
          if (msg.quality) qualitySelect.value = msg.quality;
          if (msg.state) applyState(msg.state);
          }
        } catch (err) {}
      } else if (e.data instanceof ArrayBuffer) {
        try {
          var buf = e.data;
          var dv = new DataView(buf);
          if (buf.byteLength < 16 || dv.getUint32(0, true) !== 0x4d46524d) return;
          frameWidth = dv.getUint32(4, true);
          frameHeight = dv.getUint32(8, true);
          var jpeg = new Uint8Array(buf, 16);
          var blob = new Blob([jpeg], { type: 'image/jpeg' });
          var url = URL.createObjectURL(blob);
          var oldUrl = frameObjectUrl;
          frameObjectUrl = url;
          img.onload = function () {
            if (oldUrl) { try { URL.revokeObjectURL(oldUrl) } catch (e) {} }
          };
          img.src = url;
          closedOverlay.style.display = 'none';
          minimizedOverlay.style.display = 'none';
          setStatus('已连接');
        } catch (err) {}
      }
    };
    ws.onclose = function () { setStatus('连接断开'); };
    ws.onerror = function () { setStatus('连接错误'); };
  };

  var send = function (event) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', event: event }));
    }
  };

  var sendText = function (text) {
    text = String(text || '');
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'text', text: text }));
  };

  qualitySelect.addEventListener('change', function () {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'quality', quality: qualitySelect.value }));
    }
  });

  document.getElementById('reconnectBtn').addEventListener('click', function () {
    closedOverlay.style.display = 'none';
    setStatus('正在重连...');
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'reconnect' }));
    } else {
      pendingReconnect = true;
      connect();
    }
  });

  document.getElementById('restoreBtn').addEventListener('click', function () {
    minimizedOverlay.style.display = 'none';
    setStatus('正在恢复窗口...');
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'reconnect' }));
    } else {
      pendingReconnect = true;
      connect();
    }
  });

  var pointForEvent = function (e) {
    var rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height || !frameWidth || !frameHeight) {
      return { x: Math.round(e.clientX), y: Math.round(e.clientY) };
    }
    return {
      x: Math.max(0, Math.min(frameWidth - 1, Math.round((e.clientX - rect.left) * (frameWidth / rect.width)))),
      y: Math.max(0, Math.min(frameHeight - 1, Math.round((e.clientY - rect.top) * (frameHeight / rect.height))))
    };
  };

  var mouseDown = false;
  var mouseButton = 'left';
  var mouseButtons = 0;
  var activeClickCount = 1;
  var lastClick = null;
  var lastPointer = { x: 20, y: 20 };
  var buttonsFor = function (button) {
    return button === 'left' ? 1 : button === 'right' ? 2 : button === 'middle' ? 4 : 0;
  };
  var nextClickCount = function (point, button) {
    if (button !== 0) {
      lastClick = null;
      return 1;
    }
    var now = Date.now();
    if (
      lastClick &&
      now - lastClick.time < 420 &&
      Math.abs(point.x - lastClick.x) < 5 &&
      Math.abs(point.y - lastClick.y) < 5
    ) {
      lastClick = null;
      return 2;
    }
    lastClick = { time: now, x: point.x, y: point.y };
    return 1;
  };
  img.addEventListener('mousedown', function (e) {
    e.preventDefault();
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    imeInput.blur();
    mouseDown = true;
    mouseButton = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    mouseButtons = buttonsFor(mouseButton);
    var point = pointForEvent(e);
    activeClickCount = nextClickCount(point, e.button);
    send({ type: 'mouseDown', x: point.x, y: point.y, button: mouseButton, buttons: mouseButtons, clickCount: activeClickCount });
  });
  img.addEventListener('dblclick', function (e) {
    e.preventDefault();
  });
  window.addEventListener('mouseup', function (e) {
    if (!mouseDown) return;
    mouseDown = false;
    var point = pointForEvent(e);
    send({ type: 'mouseUp', x: point.x, y: point.y, button: mouseButton, buttons: 0, clickCount: activeClickCount });
    mouseButtons = 0;
    activeClickCount = 1;
  });
  window.addEventListener('mousemove', function (e) {
    if (!mouseDown) return;
    var point = pointForEvent(e);
    send({ type: 'mouseMove', x: point.x, y: point.y, button: mouseButton, buttons: mouseButtons });
  });
  img.addEventListener('wheel', function (e) {
    e.preventDefault();
    var point = pointForEvent(e);
    send({ type: 'mouseWheel', x: point.x, y: point.y, deltaX: -e.deltaX, deltaY: -e.deltaY, canScroll: true });
  }, { passive: false });
  img.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('auxclick', function (e) { e.preventDefault(); });

  var modifiers = function (e) {
    var mods = [];
    if (e.ctrlKey) mods.push('control');
    if (e.altKey) mods.push('alt');
    if (e.shiftKey) mods.push('shift');
    if (e.metaKey) mods.push('meta');
    return mods;
  };

  var acceleratorKey = function (e) {
    var codeMap = {
      Space: 'Space',
      Enter: 'Enter',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Tab: 'Tab',
      Escape: 'Escape',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5',
      F6: 'F6', F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10',
      F11: 'F11', F12: 'F12'
    };
    if (codeMap[e.code]) return codeMap[e.code];
    if (e.key && e.key.length === 1) return /[a-z]/.test(e.key) ? e.key.toUpperCase() : e.key;
    return e.key || e.code || '';
  };

  window.addEventListener('keydown', function (e) {
    if (login.style.display !== 'none') return;
    if (e.isComposing || e.keyCode === 229) return;
    if (document.activeElement === imeInput && e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      return;
    }
    var keyCode = acceleratorKey(e);
    if (!keyCode) return;
    e.preventDefault();
    send({ type: 'keyDown', keyCode: keyCode, modifiers: modifiers(e) });
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      send({ type: 'char', keyCode: e.key, modifiers: modifiers(e) });
    }
  });
  window.addEventListener('keyup', function (e) {
    if (login.style.display !== 'none') return;
    if (e.isComposing || e.keyCode === 229) return;
    if (document.activeElement === imeInput && e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      return;
    }
    var keyCode = acceleratorKey(e);
    if (!keyCode) return;
    e.preventDefault();
    send({ type: 'keyUp', keyCode: keyCode, modifiers: modifiers(e) });
  });

  imeInput.addEventListener('compositionstart', function () {
    imeInput.dataset.composing = '1';
  });
  imeInput.addEventListener('keydown', function (e) {
    if (['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
    }
  });
  imeInput.addEventListener('compositionend', function (e) {
    imeInput.dataset.composing = '0';
    var text = e.data || imeInput.value || '';
    if (text) sendText(text);
    imeInput.value = '';
  });
  imeInput.addEventListener('input', function (e) {
    if (imeInput.dataset.composing === '1' || e.isComposing) return;
    var text = imeInput.value || '';
    if (text) sendText(text);
    imeInput.value = '';
  });

  var touchStart = null;
  var touchStartDistance = 0;
  var lastTouchX = 0;
  var lastTouchY = 0;
  img.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      var point = pointForEvent(e.touches[0]);
      send({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
    } else if (e.touches.length === 2) {
      touchStartDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      lastTouchX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      lastTouchY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  }, { passive: false });
  img.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (e.touches.length === 1 && touchStart) {
      var point = pointForEvent(e.touches[0]);
      send({ type: 'mouseMove', x: point.x, y: point.y, button: 'left', buttons: 1 });
    } else if (e.touches.length === 2) {
      var distance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      var midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      var midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      var midPoint = pointForEvent({ clientX: midX, clientY: midY });
      send({ type: 'mouseWheel', x: midPoint.x, y: midPoint.y, deltaX: lastTouchX - midX, deltaY: lastTouchY - midY, canScroll: true });
      if (touchStartDistance) send({ type: 'mouseWheel', x: midPoint.x, y: midPoint.y, deltaX: 0, deltaY: (touchStartDistance - distance) * 6, canScroll: true });
      touchStartDistance = distance;
      lastTouchX = midX;
      lastTouchY = midY;
    }
  }, { passive: false });
  img.addEventListener('touchend', function (e) {
    e.preventDefault();
    var point = pointForEvent(e.changedTouches[0]);
    send({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
    touchStart = null;
    touchStartDistance = 0;
  });

  if (token) {
    login.style.display = 'none';
    stage.style.display = 'flex';
    connect();
  }
})();
</script>
</body>
</html>`

// 仅查看页面：只显示共享画面与连接状态，无任何输入/操作控件；token 通过 URL 参数 ?token= 传入
const REMOTE_VIEW_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<title>my-mindmap agent 屏幕共享（仅查看）</title>
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111; color: #eee; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  #stage { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #111; }
  #screen { max-width: 100vw; max-height: 100vh; user-select: none; -webkit-user-select: none; }
  #status { position: fixed; top: 12px; left: 12px; z-index: 10; padding: 7px 10px; background: rgba(0,0,0,.55); border-radius: 8px; font-size: 12px; color: #d6d6de; pointer-events: none; }
  #overlay { position: fixed; inset: 0; z-index: 14; display: none; align-items: center; justify-content: center; background: rgba(17,17,17,.82); }
  .card { width: min(420px, calc(100vw - 40px)); background: #242429; border: 1px solid #38383f; border-radius: 16px; padding: 26px; text-align: center; }
  .card h1 { font-size: 20px; margin: 0 0 10px; }
  .card p { color: #a7a7b3; font-size: 13px; line-height: 1.6; margin: 0 0 16px; }
  #login { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #1b1b1f; z-index: 20; }
  #login .card { text-align: left; }
  .card input { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #4a4a54; border-radius: 10px; background: #141417; color: #fff; font-size: 14px; outline: none; margin-bottom: 12px; }
  .card button { width: 100%; padding: 12px; border: none; border-radius: 10px; background: #0a84ff; color: #fff; font-size: 15px; cursor: pointer; }
</style>
</head>
<body>
  <div id="login">
    <div class="card">
      <h1>屏幕共享登录</h1>
      <p>请输入主程序设置中显示的访问 Token。Token 会保存在本浏览器，60 天内免重复输入。</p>
      <input id="token" autocomplete="off" placeholder="粘贴访问 Token" />
      <button id="loginBtn">连接</button>
    </div>
  </div>
  <div id="stage" style="display:none;">
    <img id="screen" draggable="false" alt="共享画面" />
  </div>
  <div id="overlay">
    <div class="card">
      <h1>画面暂不可用</h1>
      <p id="overlayText">主页面已关闭或最小化，请稍候。</p>
    </div>
  </div>
  <div id="status">未连接</div>
<script>
(function () {
  var token = localStorage.getItem('mm_view_token') || '';
  var ws = null;
  var img = document.getElementById('screen');
  var statusEl = document.getElementById('status');
  var overlay = document.getElementById('overlay');
  var overlayText = document.getElementById('overlayText');
  var login = document.getElementById('login');
  var stage = document.getElementById('stage');
  var frameObjectUrl = null;
  var setStatus = function (t) { statusEl.textContent = t; };

  var loginAction = function () {
    var value = (document.getElementById('token').value || '').trim();
    if (!value) return;
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: value })
    }).then(function (r) {
      return r.json().then(function (data) {
        if (r.ok) {
          token = value;
          localStorage.setItem('mm_view_token', token);
          login.style.display = 'none';
          stage.style.display = 'flex';
          connect();
        } else {
          setStatus((data && data.error) ? data.error : 'Token 无效或已过期');
        }
      }).catch(function () { setStatus('Token 无效或已过期'); });
    }).catch(function () { setStatus('连接失败'); });
  };
  document.getElementById('loginBtn').addEventListener('click', loginAction);
  document.getElementById('token').addEventListener('keydown', function (e) { if (e.key === 'Enter') loginAction(); });

  var connect = function () {
    if (!token) { setStatus('缺少 token'); return; }
    if (ws) { try { ws.close(); } catch (e) {} }
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws?token=' + encodeURIComponent(token));
    ws.binaryType = 'arraybuffer';
    ws.onopen = function () { setStatus('已连接'); };
    ws.onmessage = function (e) {
      if (typeof e.data === 'string') {
        try {
          var msg = JSON.parse(e.data);
          if (msg.type === 'state') {
            overlay.style.display = msg.state === 'online' ? 'none' : 'flex';
            overlayText.textContent = msg.state === 'closed' ? '主页面已关闭' : '主页面已最小化';
            setStatus(msg.state === 'online' ? '已连接' : msg.state);
          }
        } catch (err) {}
      } else if (e.data instanceof ArrayBuffer) {
        try {
          var buf = e.data;
          var dv = new DataView(buf);
          if (buf.byteLength < 16 || dv.getUint32(0, true) !== 0x4d46524d) return;
          var jpeg = new Uint8Array(buf, 16);
          var blob = new Blob([jpeg], { type: 'image/jpeg' });
          var url = URL.createObjectURL(blob);
          var oldUrl = frameObjectUrl;
          frameObjectUrl = url;
          img.onload = function () { if (oldUrl) { try { URL.revokeObjectURL(oldUrl) } catch (e) {} } };
          img.src = url;
          overlay.style.display = 'none';
          setStatus('已连接');
        } catch (err) {}
      }
    };
    ws.onclose = function () {
      setStatus('连接断开，正在重连...');
      setTimeout(function () { if (!ws || ws.readyState === WebSocket.CLOSED) connect(); }, 2000);
    };
    ws.onerror = function () { setStatus('连接错误'); };
  };
  // 已有有效 token 则直接连接，否则显示登录框
  if (token) {
    login.style.display = 'none';
    stage.style.display = 'flex';
    connect();
  } else {
    setStatus('请输入访问 Token');
  }
})();
</script>
</body>
</html>`

module.exports = {
  init,
  initAutoStart,
  getStatus,
  setEnabled,
  getViewOnlyStatus,
  setViewOnlyEnabled
}
