// 自定义工具独立子进程执行器（Node 环境，无 Electron API）
// 通过 IPC 与主进程通信：文件读写 / PowerShell 等能力走 RPC，由主进程做路径白名单校验。
// 这样工具代码即使 import('fs') / import('child_process')，也只能拿到子进程自己的 Node，
// 无法直接触碰主进程、渲染进程、localStorage 或应用其它资源。

let rpcSeq = 0
const pendingRpc = new Map()

const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++rpcSeq
  pendingRpc.set(id, { resolve, reject })
  try {
    process.send({ type: 'rpc', id, method, params })
  } catch (e) {
    pendingRpc.delete(id)
    reject(e)
  }
})

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'rpc-result') {
    const p = pendingRpc.get(msg.id)
    if (!p) return
    pendingRpc.delete(msg.id)
    if (msg.ok) p.resolve(msg.result)
    else p.reject(new Error(msg.error || 'RPC 失败'))
    return
  }

  if (msg.type === 'run') {
    const { args, contextMeta, tmpFile } = msg
    try {
      const { pathToFileURL } = require('url')
      const mod = await import(pathToFileURL(tmpFile).href + '?v=' + Date.now())
      const execute = mod && (mod.execute || (mod.default && mod.default.execute) || mod.default)
      if (typeof execute !== 'function') {
        throw new Error('tool.js 必须导出 execute 函数')
      }
      const context = {
        app: {
          version: contextMeta.appVersion,
          userDataDir: contextMeta.userDataDir
        },
        file: {
          currentFilePath: contextMeta.currentFilePath || '',
          currentFileName: contextMeta.currentFileName || '',
          writeText: (filePath, content) => rpc('file.writeText', { filePath, content }),
          readText: (filePath) => rpc('file.readText', { filePath }),
          exists: (filePath) => rpc('file.exists', { filePath })
        },
        shell: contextMeta.allowShell
          ? { powerShell: (script, options) => rpc('shell.powerShell', { script, options }) }
          : null,
        http: { fetch: globalThis.fetch }
      }
      const result = await execute(args || {}, context)
      let payload = null
      try {
        payload = JSON.stringify(result === undefined ? null : result)
      } catch (e) {
        payload = JSON.stringify({ message: typeof result === 'string' ? result : '工具执行完成（结果不可序列化）' })
      }
      process.send({ type: 'result', ok: true, payload })
    } catch (e) {
      process.send({ type: 'result', ok: false, error: (e && e.message) || String(e) })
    }
  }
})
