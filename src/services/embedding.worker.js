/**
 * 本地 Embedding Worker
 *
 * 在主线程之外加载 multilingual-e5-small 并执行文本向量化。
 * 主线程只负责 API embedding 优先、降级到该 Worker 和查询/索引调度。
 */

import { pipeline } from '@huggingface/transformers'

const MODEL_ID = 'Xenova/multilingual-e5-small'
let pipePromise = null
let failed = false

const getPipe = async () => {
  if (failed) throw new Error('embedding 模型此前加载失败')
  if (pipePromise) return pipePromise
  pipePromise = pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' })
  return pipePromise
}

self.onmessage = async (event) => {
  const { id, texts } = event.data || {}
  try {
    if (!Array.isArray(texts) || texts.length === 0) {
      self.postMessage({ id, vectors: [] })
      return
    }

    const pipe = await getPipe()
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
    self.postMessage({ id, vectors: rows })
  } catch (error) {
    failed = true
    self.postMessage({ id, error: error?.message || String(error) })
  }
}
