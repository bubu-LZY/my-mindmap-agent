const { ipcMain } = require('electron')
const http = require('http')
const crypto = require('crypto')
const os = require('os')
const wsModule = require('ws')
const WebSocketServer = wsModule.WebSocketServer || wsModule.Server
const store = require('../utils/store')

const STORE_KEY = 'httpRemoteServer'
const DEFAULT_PORT = 17800
const TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000
const FRAME_INTERVAL_MS = 80
const QUALITY_JPEG = { low: 52, medium: 70, high: 86 }

let getMainWindow = () => null
let server = null
let wss = null
let port = 0
let starting = false
let clients = new Set()
let streamTimer = null
let capturing = false
let frameRequested = false
let preRemoteWindowState = null
const pendingAgentRequests = new Map()

const readConfig = () => store.get(STORE_KEY, {}) || {}
const writeConfig = (config) => store.set(STORE_KEY, config)

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

const getLanAddresses = () => {
  const addresses = [`http://127.0.0.1:${port}`]
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
    quality: config.quality || 'medium'
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
  return !!(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized())
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
  const payload = JSON.stringify({ type: 'state', state })
  for (const ws of clients) {
    if (ws.readyState === 1) {
      try { ws.send(payload) } catch (e) {}
    }
  }
}

const captureFrame = async () => {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return null
  if (!isMainWindowAvailable(win)) return null
  try {
    const image = await win.webContents.capturePage()
    if (!image || image.isEmpty()) return null
    const bounds = win.getContentBounds()
    const quality = readConfig().quality || 'medium'
    const jpegQuality = QUALITY_JPEG[quality] || QUALITY_JPEG.medium
    const scaled = image.resize({
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
      quality: 'good'
    })
    return {
      data: scaled.toJPEG(jpegQuality).toString('base64'),
      width: bounds.width,
      height: bounds.height
    }
  } catch (e) {
    return null
  }
}

const broadcastFrame = async () => {
  if (!clients.size) {
    stopStream()
    return
  }
  if (capturing) return
  const win = getMainWindow()
  if (!isMainWindowAvailable(win)) {
    sendStateToAll('closed')
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
    sendStateToAll('closed')
    return
  }
  const payload = JSON.stringify({ type: 'frame', ...frame })
  for (const ws of clients) {
    if (ws.readyState === 1) {
      try { ws.send(payload) } catch (e) {}
    }
  }
}

const requestImmediateFrame = () => {
  if (!clients.size) return
  if (capturing) {
    frameRequested = true
    return
  }
  setImmediate(broadcastFrame)
}

const startStream = () => {
  if (streamTimer) return
  streamTimer = setInterval(broadcastFrame, FRAME_INTERVAL_MS)
}

const stopStream = () => {
  if (streamTimer) {
    clearInterval(streamTimer)
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

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(REMOTE_PAGE)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    try {
      const body = await readBody(req)
      const config = readConfig()
      if (!config.enabled || Date.now() >= config.tokenExpiresAt || !tokenMatches(body.token)) {
        sendJson(res, 401, { ok: false, error: 'Token 无效或已过期' })
        return
      }
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
      if (!isMainWindowAvailable(win)) {
        sendJson(res, 503, { ok: false, error: '主页面已关闭' })
        return
      }
      const id = crypto.randomUUID()
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingAgentRequests.delete(id)
          reject(new Error('Agent 请求超时'))
        }, 120000)
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
    if (err.code === 'EADDRINUSE' && portToTry !== 0) {
      listen(0).then(resolve).catch(reject)
      return
    }
    reject(err)
  }
  server.once('error', onError)
  server.listen(portToTry, '0.0.0.0', () => {
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
  stopStream()
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
}

const setEnabled = async (enabled) => {
  if (enabled) return start()
  stop()
  return getStatus()
}

const init = (getWindow) => {
  getMainWindow = getWindow || (() => null)
  ipcMain.handle('http-server:getStatus', () => getStatus())
  ipcMain.handle('http-server:setEnabled', async (event, enabled) => {
    return setEnabled(!!enabled)
  })
  ipcMain.handle('http-server:setQuality', async (event, quality) => {
    const config = readConfig()
    config.quality = QUALITY_JPEG[quality] ? quality : 'medium'
    writeConfig(config)
    return getStatus()
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
  var qualitySelect = document.getElementById('qualitySelect');
  var pendingReconnect = false;

  var setStatus = function (text) { statusEl.textContent = text; };

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
    ws.onopen = function () {
      setStatus('已连接');
      if (pendingReconnect) {
        pendingReconnect = false;
        ws.send(JSON.stringify({ type: 'reconnect' }));
      }
    };
    ws.onmessage = function (e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'frame' && msg.data) {
          frameWidth = msg.width;
          frameHeight = msg.height;
          img.src = 'data:image/jpeg;base64,' + msg.data;
          closedOverlay.style.display = 'none';
        } else if (msg.type === 'inputError') {
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
          if (msg.state === 'closed') {
            closedOverlay.style.display = 'flex';
          } else {
            closedOverlay.style.display = 'none';
          }
        } else if (msg.type === 'ready' || msg.type === 'quality') {
          if (msg.quality) qualitySelect.value = msg.quality;
        }
      } catch (err) {}
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

module.exports = {
  init,
  initAutoStart,
  getStatus,
  setEnabled
}
