const { ipcMain, net, app, BrowserWindow, Notification } = require('electron')
const store = require('../utils/store')
const crypto = require('crypto')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const STORE_KEY = 'mcpServers'
const stdioClients = new Map()

const listServers = () => {
  const list = store.get(STORE_KEY, []) || []
  return list.filter(s => s && s.id)
}

const saveServers = (list) => {
  store.set(STORE_KEY, list)
  return list
}

const normalizeServer = (input = {}) => {
  return {
    id: String(input.id || crypto.randomUUID()),
    name: String(input.name || '未命名 MCP').trim(),
    transport: input.transport === 'stdio' ? 'stdio' : 'http',
    url: String(input.url || '').trim(),
    command: String(input.command || '').trim(),
    args: Array.isArray(input.args) ? input.args.map(String) : [],
    env: input.env && typeof input.env === 'object' ? input.env : {},
    headers: input.headers && typeof input.headers === 'object' ? input.headers : {},
    enabled: input.enabled !== false,
    timeoutMs: Math.min(Math.max(Number(input.timeoutMs) || 10000, 1000), 120000)
  }
}

const createServer = (input) => {
  const servers = listServers()
  const server = normalizeServer(input)
  servers.push(server)
  saveServers(servers)
  return server
}

const updateServer = (id, patch) => {
  const servers = listServers()
  const idx = servers.findIndex(s => s.id === id)
  if (idx < 0) throw new Error('MCP 服务不存在')
  servers[idx] = { ...servers[idx], ...normalizeServer({ ...servers[idx], ...patch, id }) }
  saveServers(servers)
  const client = stdioClients.get(id)
  if (client) {
    try { client.proc.kill() } catch (e) {}
    stdioClients.delete(id)
  }
  // 用户改了 MCP 服务（command/args/enabled 都可能影响工具列表），让外部 /mcp 端点下次拉取时刷新
  invalidateUserMcpToolsCache(id)
  return servers[idx]
}

const deleteServer = (id) => {
  const servers = listServers().filter(s => s.id !== id)
  saveServers(servers)
  const client = stdioClients.get(id)
  if (client) {
    try { client.proc.kill() } catch (e) {}
    stdioClients.delete(id)
  }
  invalidateUserMcpToolsCache(id)
  return true
}



// ============ MCP 状态变更通知（进程异常时主动推送 UI + 系统通知）============
// 在 mcpManager.js 内直接调 BrowserWindow.getAllWindows() 推送，不依赖 main.js 注入，
// 避免主进程 IPC require 顺序耦合（mcpManager 在 mainWindow 创建之前已被 require）。
const notifyMcpStatusChange = (payload) => {
  try {
    const wins = BrowserWindow.getAllWindows() || []
    for (const win of wins) {
      if (!win || win.isDestroyed()) continue
      try { win.webContents.send('mcp:status', payload) } catch (e) { /* 渲染层可能已销毁 */ }
    }
  } catch (e) { /* ignore */ }
}

// 仅在系统不支持 Notification（Linux 某些环境）时静默降级
const showMcpSystemNotification = ({ title, body }) => {
  try {
    if (!Notification || !Notification.isSupported || !Notification.isSupported()) return
    const n = new Notification({ title, body, silent: false })
    n.on('click', () => {
      try {
        const wins = BrowserWindow.getAllWindows() || []
        const main = wins.find(w => w && !w.isDestroyed()) || wins[0]
        if (main) { main.show(); main.focus() }
      } catch (e) {}
    })
    n.show()
  } catch (e) { /* ignore */ }
}
const getStdioCwd = (server) => {
  // stdio MCP 进程默认继承应用启动目录；安装到 Program Files 时该目录不可写，
  // Playwright MCP 会尝试在其中创建 .playwright-mcp，导致 EPERM。
  // 这里改为每个 MCP 服务一个用户可写的运行目录。
  try {
    const base = app.getPath('userData')
    const safeId = String(server.id || 'default').replace(/[^a-zA-Z0-9_-]/g, '_')
    const dir = path.join(base, 'mcp-runtime', safeId)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  } catch (e) {
    const fallback = os.homedir() || process.env.TEMP || process.cwd()
    const dir = path.join(fallback, 'my-mindmap-agent-mcp')
    try { fs.mkdirSync(dir, { recursive: true }) } catch (e2) {}
    return dir
  }
}

const getStdioClient = (server) => {
  if (!server.command) throw new Error('stdio MCP 需要 command')
  if (stdioClients.has(server.id)) return stdioClients.get(server.id)
  // shell: true 让系统 shell 解析命令路径（解决 Electron 打包后找不到 npx/node 的问题）
  const isWindows = process.platform === 'win32'
  // 安全审计：stdio 模式会在本机启动外部程序，记录 command/args 便于事后审计
  console.log(`[MCP stdio 审计] 启动外部进程: ${server.command} ${(server.args || []).join(' ')}`)
  const proc = spawn(server.command, server.args || [], {
    env: { ...process.env, ...(server.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: isWindows,
    cwd: getStdioCwd(server)
  })
  const client = {
    proc,
    pending: new Map(),
    buffer: '',
    nextId: 1
  }
  proc.stdout.on('data', (chunk) => {
    client.buffer += chunk.toString('utf8')
    let idx
    while ((idx = client.buffer.indexOf('\n')) >= 0) {
      const line = client.buffer.slice(0, idx).trim()
      client.buffer = client.buffer.slice(idx + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch (e) { continue }
      if (msg.id && client.pending.has(msg.id)) {
        const { resolve, reject } = client.pending.get(msg.id)
        client.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    }
  })
  proc.stderr.on('data', () => {})
  proc.on('error', (err) => {
    for (const [, p] of client.pending) p.reject(err)
    client.pending.clear()
    stdioClients.delete(server.id)
    try {
      const reason = (err && (err.message || err.code)) ? String(err.message || err.code) : '未知错误'
      notifyMcpStatusChange({ id: server.id, name: server.name, status: 'error', reason, at: Date.now() })
      showMcpSystemNotification({ title: 'MCP 服务异常：' + server.name, body: '进程启动/通讯失败：' + reason + '。下次调用该工具时会自动重试。' })
    } catch (e) { /* ignore */ }
  })
  proc.on('exit', (code, signal) => {
    for (const [, p] of client.pending) p.reject(new Error('stdio MCP 进程已退出'))
    client.pending.clear()
    stdioClients.delete(server.id)
    // 仅在明确非零退出时推送（主动 kill 的 code 通常为 null，不算异常）
    try {
      const abnormal = code !== null && code !== 0
      if (abnormal) {
        notifyMcpStatusChange({ id: server.id, name: server.name, status: 'exit', code: code, signal: signal || null, at: Date.now() })
        showMcpSystemNotification({ title: 'MCP 服务停止：' + server.name, body: '进程退出（code=' + code + '）。下次调用该工具时会自动重启。' })
      }
    } catch (e) { /* ignore */ }
  })
  stdioClients.set(server.id, client)
  return client
}

const rpcStdio = (server, method, params) => {
  const client = getStdioClient(server)
  const id = client.nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.pending.delete(id)
      const err = new Error(`stdio MCP 调用超时（${Math.round((server.timeoutMs || 10000) / 1000)} 秒）—— 可能原因：1. 命令未安装或路径错误（请在命令行单独运行 \`${server.command} ${(server.args || []).join(' ')}\` 验证）；2. 进程首次启动在拉取依赖（pip/npm 下载慢）；3. 网络受限无法访问包仓库。`);
      err.code = 'MCP_TIMEOUT'
      err.serverId = server.id
      err.serverName = server.name
      reject(err)
    }, server.timeoutMs || 10000)
    client.pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value) },
      reject: (err) => { clearTimeout(timer); reject(err) }
    })
    if (!client.proc.stdin.writable) {
      client.pending.delete(id)
      clearTimeout(timer)
      reject(new Error('stdio MCP 进程输入流不可写'))
      return
    }
    try {
      client.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n')
    } catch (err) {
      client.pending.delete(id)
      clearTimeout(timer)
      reject(err)
    }
  })
}

const rpcFor = (server, method, params) => {
  if (server.transport === 'stdio') return rpcStdio(server, method, params)
  return rpc(server, method, params)
}

const rpc = async (server, method, params, requestId) => {
  if (!server || server.transport !== 'http' || !server.url) throw new Error('HTTP MCP 需要 url')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), server.timeoutMs || 10000)
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(server.headers || {})
    }
    const res = await net.fetch(server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestId || crypto.randomUUID(),
        method,
        params: params || {}
      }),
      signal: controller.signal
    })
    const json = await res.json()
    if (json && json.error) throw new Error(json.error.message || JSON.stringify(json.error))
    return json?.result
  } finally {
    clearTimeout(timer)
  }
}

const getTools = async (server) => {
  // 首次拉取（uvx/npx 首次启动通常需要下载依赖）容易触发默认超时。
  // 若用户的 timeoutMs ≤ 30 秒且首次超时，自动临时延长到 60 秒重试一次；用户明确设置更长则不重试。
  const FIRST_RETRY_TIMEOUT_MS = 60000
  const userTimeout = server.timeoutMs || 10000
  const doList = async () => {
    await rpcFor(server, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'my-mindmap-agent', version: '2.0.0' }
    })
    const result = await rpcFor(server, 'tools/list', {})
    return Array.isArray(result?.tools) ? result.tools : []
  }
  try {
    return await doList()
  } catch (e) {
    const isFirstTimeout = e && e.code === 'MCP_TIMEOUT' && userTimeout <= 30000 && server.transport === 'stdio'
    if (!isFirstTimeout) throw e
    // 临时把 timeoutMs 提到 60 秒再试一次，仅影响这一次调用（不写回 store）
    const originalTimeout = server.timeoutMs
    server.timeoutMs = FIRST_RETRY_TIMEOUT_MS
    // 首次超时通常是进程没起来；先把 stdio 客户端踢掉，下次 getStdioClient 会重建
    const client = stdioClients.get(server.id)
    if (client) {
      try { client.proc.kill() } catch (err) {}
      stdioClients.delete(server.id)
    }
    try {
      const tools = await doList()
      // 在错误对象上附加标记，便于上层告诉用户"自动重试成功"
      e.firstPullRetried = true
      e.firstPullSuccess = true
      return tools
    } catch (e2) {
      server.timeoutMs = originalTimeout
      e2.firstPullRetried = true
      e2.firstPullSuccess = false
      e2.originalTimeoutMs = originalTimeout
      throw e2
    }
  }
}

const callTool = async (server, toolName, args) => {
  return rpcFor(server, 'tools/call', { name: toolName, arguments: args || {} })
}

ipcMain.handle('mcp:list', async () => listServers())
ipcMain.handle('mcp:create', async (e, input) => createServer(input))
ipcMain.handle('mcp:update', async (e, id, patch) => updateServer(id, patch))
ipcMain.handle('mcp:delete', async (e, id) => deleteServer(id))
ipcMain.handle('mcp:listTools', async (e, id, overrideTimeoutMs) => {
  const server = listServers().find(s => s.id === id)
  if (!server) throw new Error('MCP 服务不存在')
  if (server.enabled === false) throw new Error('MCP 服务已停用')
  // 仅本次调用临时覆盖超时（用户点「再试一次(60秒)」时使用），不写回 store
  if (Number.isFinite(overrideTimeoutMs) && overrideTimeoutMs > 0) {
    server.timeoutMs = overrideTimeoutMs
  }
  return getTools(server)
})
ipcMain.handle('mcp:callTool', async (e, id, toolName, args) => {
  const server = listServers().find(s => s.id === id)
  if (!server) throw new Error('MCP 服务不存在')
  if (server.enabled === false) throw new Error('MCP 服务已停用')
  return callTool(server, toolName, args)
})

// 供外部 /mcp 端点调用：根据 serverId 取出该 MCP 服务并列出工具；带超时，避免卡死外部请求。
// 注意：先尝试从 stdioClients 缓存里取已经初始化好的客户端；否则新建一次 getTools 调用。
const listTools = async (serverId, overrideTimeoutMs) => {
  const server = listServers().find(s => s.id === serverId)
  if (!server) throw new Error('MCP 服务不存在')
  if (server.enabled === false) throw new Error('MCP 服务已停用')
  if (Number.isFinite(overrideTimeoutMs) && overrideTimeoutMs > 0) {
    server.timeoutMs = overrideTimeoutMs
  }
  return getTools(server)
}

// 让 mcpManager.js 能在 update/delete 时主动失效 mcpServer 内部的 userMcpToolsCache
// （mcpServer 模块级 Map，进程内单例）。直接 require 并调用 invalidate 函数即可。
const invalidateUserMcpToolsCache = (serverId) => {
  try {
    const mcpServer = require('./mcpServer')
    if (typeof mcpServer.invalidateUserMcpToolsCache === 'function') {
      mcpServer.invalidateUserMcpToolsCache(serverId)
    }
  } catch (_) { /* 首次 require 时序耦合，容错 */ }
}

// 导出 listServers / listTools / callTool 供 mcpServer（外部 /mcp 端点）调用，
// 把用户配置的 MCP 服务工具桥接给外部 Agent。
module.exports = { listServers, listTools, callTool, invalidateUserMcpToolsCache }


