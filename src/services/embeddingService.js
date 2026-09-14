/**
 * 本地向量嵌入服务（三期：语义检索）
 * - 优先使用用户配置的 Embedding API
 * - API 不可用时降级到 Web Worker 中的本地 multilingual-e5-small
 * - 本地模型加载/推理都不再占用主线程；失败时静默降级 BM25
 */

let worker = null
// 线程失败的「冷却截止时间」。旧实现是永久置位的布尔标记：线程一次加载/执行失败后，
// 本地嵌入就永久失效（用户配好环境、模型就位了也不会再尝试）；而且失败的 worker
// 实例还被留在变量里。改成时间戳 + 冷却期后可以自愈，超时即重建线程重试。
let workerFailedAt = 0
let requestSeq = 0
const pendingRequests = new Map()
const EMBED_WORKER_COOLDOWN_MS = 30 * 1000

const embedViaApi = async (texts) => {
  try {
    if (!window.electronAPI?.getEmbeddingConfig || !window.electronAPI?.embedding) return null
    const cfg = await window.electronAPI.getEmbeddingConfig()
    if (!cfg?.available) return null
    const res = await window.electronAPI.embedding({
      baseURL: cfg.baseURL,
      model: cfg.model,
      input: texts.map(t => String(t || '')),
      profileId: cfg.profileId || '',
      autoComplete: cfg.autoComplete !== false
    })
    if (!res?.success || !Array.isArray(res.vectors)) return null
    return res.vectors
  } catch {
    return null
  }
}

const getWorker = () => {
  if (workerFailedAt && Date.now() - workerFailedAt < EMBED_WORKER_COOLDOWN_MS) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./embedding.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      // 线程能回消息说明它是健康的，清掉冷却标记
      workerFailedAt = 0
      const { id, vectors, error } = event.data || {}
      const pending = pendingRequests.get(id)
      if (!pending) return
      pendingRequests.delete(id)
      if (error) pending.reject(new Error(error))
      else pending.resolve(vectors || [])
    }
    worker.onerror = () => {
      // 线程级失败：进入冷却期、终止线程、让等待中的请求立即失败（调用方降级 BM25）。
      // 冷却期结束后会重建线程重试本地嵌入，而不是永久降级。
      workerFailedAt = Date.now()
      const dead = worker
      worker = null
      if (dead) { try { dead.terminate() } catch (e) { /* 忽略 */ } }
      for (const pending of pendingRequests.values()) {
        pending.reject(new Error('Embedding Worker 执行失败'))
      }
      pendingRequests.clear()
    }
  } catch {
    workerFailedAt = Date.now()
    worker = null
    return null
  }
  return worker
}

const embedLocal = (texts) => {
  const currentWorker = getWorker()
  if (!currentWorker) return Promise.resolve([])
  const id = ++requestSeq
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject })
    currentWorker.postMessage({ id, texts })
  })
}

const runEmbed = async (texts) => {
  if (!texts.length) return []
  // 优先使用用户配置的 Embedding API；不可用/失败时自动降级本地 Worker。
  const apiVectors = await embedViaApi(texts)
  if (apiVectors && apiVectors.length === texts.length) return apiVectors
  return await embedLocal(texts)
}

export const embeddingService = {
  isFailed() {
    // 「正在冷却」才算失败降级；冷却结束后会自动重试本地嵌入
    return !!workerFailedAt && Date.now() - workerFailedAt < EMBED_WORKER_COOLDOWN_MS
  },

  // 查询向量（E5 规范：query 前缀）
  async embedQuery(text) {
    const rows = await runEmbed([`query: ${String(text || '')}`])
    return rows[0] || null
  },

  // 文档块向量（E5 规范：passage 前缀），批量计算
  async embedPassages(texts) {
    const list = (texts || []).map(t => `passage: ${String(t || '')}`)
    return await runEmbed(list)
  }
}
