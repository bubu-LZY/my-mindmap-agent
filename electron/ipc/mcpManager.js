const { ipcMain, net } = require('electron')
const store = require('../utils/store')
const crypto = require('crypto')
const { spawn } = require('child_process')

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
  return true
}

const getStdioClient = (server) => {
  if (!server.command) throw new Error('stdio MCP 需要 command')
  if (stdioClients.has(server.id)) return stdioClients.get(server.id)
  const proc = spawn(server.command, server.args || [], {
    env: { ...process.env, ...(server.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe']
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
  })
  proc.on('exit', () => {
    for (const [, p] of client.pending) p.reject(new Error('stdio MCP 进程已退出'))
    client.pending.clear()
    stdioClients.delete(server.id)
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
      reject(new Error('stdio MCP 调用超时'))
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
  await rpcFor(server, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'my-mindmap-agent', version: '1.0.0' }
  })
  const result = await rpcFor(server, 'tools/list', {})
  return Array.isArray(result?.tools) ? result.tools : []
}

const callTool = async (server, toolName, args) => {
  return rpcFor(server, 'tools/call', { name: toolName, arguments: args || {} })
}

ipcMain.handle('mcp:list', async () => listServers())
ipcMain.handle('mcp:create', async (e, input) => createServer(input))
ipcMain.handle('mcp:update', async (e, id, patch) => updateServer(id, patch))
ipcMain.handle('mcp:delete', async (e, id) => deleteServer(id))
ipcMain.handle('mcp:listTools', async (e, id) => {
  const server = listServers().find(s => s.id === id)
  if (!server) throw new Error('MCP 服务不存在')
  return getTools(server)
})
ipcMain.handle('mcp:callTool', async (e, id, toolName, args) => {
  const server = listServers().find(s => s.id === id)
  if (!server) throw new Error('MCP 服务不存在')
  return callTool(server, toolName, args)
})

module.exports = {}
