/**
 * 向量嵌入服务（语义检索）
 * 双模式：
 * - 优先：用户配置的 Embedding API（效果好，需联网）
 * - 兜底：本地 @huggingface/transformers + multilingual-e5-small（离线可用，WASM 推理）
 * 
 * API 调用通过主进程代理（ai:embed），apiKey 由主进程注入，不暴露给渲染层
 */
let embedPipeline = null
let loadingPromise = null
let localLoadFailed = false

const MODEL_ID = 'Xenova/multilingual-e5-small'

// ===== 本地模型（兜底） =====
async function getLocalPipeline() {
  if (embedPipeline) return embedPipeline
  if (localLoadFailed) return null
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    try {
      const { pipeline } = await import('@huggingface/transformers')
      embedPipeline = await pipeline('feature-extraction', MODEL_ID, {
        dtype: 'q8'
      })
      return embedPipeline
    } catch (e) {
      console.warn('[Embedding] 本地模型加载失败（将仅使用 API 模式或降级关键词检索）:', e?.message || e)
      localLoadFailed = true
      return null
    } finally {
      loadingPromise = null
    }
  })()
  return loadingPromise
}

const runLocalEmbed = async (texts) => {
  if (!texts.length) return []
  const pipe = await getLocalPipeline()
  if (!pipe) return []
  // 分批推理（每批 32 条），避免大文档一次性送入模型导致内存峰值过高
  const rows = []
  const BATCH = 32
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH)
    const out = await pipe(batch, { pooling: 'mean', normalize: true })
    const data = out.data || out
    const dim = out.dims?.[out.dims.length - 1] || data.length
    if (batch.length === 1) {
      rows.push(Array.from(data))
    } else {
      for (let j = 0; j < batch.length; j++) {
        rows.push(Array.from(data.slice(j * dim, (j + 1) * dim)))
      }
    }
  }
  return rows
}

// ===== API 模式（优先） =====
async function runApiEmbed(texts) {
  try {
    const api = window.electronAPI?.ai?.aiEmbed || window.electronAPI?.aiEmbed
    if (!api) return null
    const res = await api(texts)
    if (res && res.success && Array.isArray(res.vectors) && res.vectors.length === texts.length) {
      return res.vectors
    }
    return null
  } catch (e) {
    console.warn('[Embedding] API 调用失败，降级本地模型:', e?.message || e)
    return null
  }
}

// 统一入口：先试 API，失败走本地
const runEmbed = async (texts) => {
  if (!texts.length) return []
  // 先试 API
  const apiResult = await runApiEmbed(texts)
  if (apiResult && apiResult.length === texts.length) return apiResult
  // 失败走本地
  return await runLocalEmbed(texts)
}

export const embeddingService = {
  isLocalFailed() {
    return localLoadFailed
  },

  // 查询向量
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
