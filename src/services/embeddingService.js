/**
 * 本地向量嵌入服务（三期：语义检索）
 * - @huggingface/transformers 渲染进程本地推理（WASM/WebGPU），无需 API Key
 * - 模型 Xenova/multilingual-e5-small（384 维，多语言含中文），首次调用自动下载并缓存
 * - 模型加载/下载失败时静默降级（上层检索自动回退 BM25），不阻塞主流程
 */
let embedPipeline = null
let loadingPromise = null
let loadFailed = false

const MODEL_ID = 'Xenova/multilingual-e5-small'

async function getPipeline() {
  if (embedPipeline) return embedPipeline
  if (loadFailed) return null
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    try {
      const { pipeline } = await import('@huggingface/transformers')
      embedPipeline = await pipeline('feature-extraction', MODEL_ID, {
        dtype: 'q8'
      })
      return embedPipeline
    } catch (e) {
      console.warn('[Embedding] 模型加载失败（语义检索降级为关键词检索）:', e?.message || e)
      loadFailed = true
      return null
    } finally {
      loadingPromise = null
    }
  })()
  return loadingPromise
}

const runEmbed = async (texts) => {
  if (!texts.length) return []
  const pipe = await getPipeline()
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

export const embeddingService = {
  isFailed() {
    return loadFailed
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
