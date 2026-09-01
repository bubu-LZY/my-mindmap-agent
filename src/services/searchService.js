const getApi = () => window.electronAPI?.database

// 大图向量提示状态：整个会话只提示一次
let _largeMapTipShown = false

// 事件回调订阅者
const _listeners = new Set()

// 触发事件
function emit(event, payload) {
  for (const fn of _listeners) {
    try { fn(event, payload) } catch (e) { console.warn('[searchService] 事件回调异常:', e) }
  }
}

// 递归提取思维导图所有节点文本（与主进程 extractAllText 逻辑一致）
function extractMindMapNodes(node, results = []) {
  if (!node) return results
  const text = node.data?.text || node.text || ''
  const plainText = text.replace(/<[^>]+>/g, '').trim()
  if (plainText) {
    results.push({
      uid: node.data?.uid || '',
      text: plainText
    })
  }
  const children = node.children || node.data?.children || []
  if (Array.isArray(children)) {
    for (const child of children) extractMindMapNodes(child, results)
  }
  return results
}

export const searchService = {
  // 事件订阅：目前支持 'large-map'（大图未自动建向量提示）
  on(fn) {
    if (typeof fn === 'function') _listeners.add(fn)
    return () => _listeners.delete(fn)
  },

  isAvailable() {
    return !!getApi()
  },

  async search(query) {
    const api = getApi()
    if (!api) return { results: [], error: '数据库不可用，请在桌面应用中运行' }
    return await api.search(query)
  },

  async indexFile(filePath, fileName, treeData) {
    const api = getApi()
    if (!api) return { success: false, error: '数据库不可用' }
    const result = await api.indexFile(filePath, fileName, treeData)
    // 异步构建节点向量索引（不阻塞 FTS 索引返回）
    if (result && result.success && result.indexed > 0) {
      try {
        const nodes = extractMindMapNodes(treeData)
        if (nodes.length > 0 && nodes.length <= 500) {
          // 节点数不超过 500 时立即索引；超大思维导图延后到重建时再做，避免阻塞
          this.indexMindMapVectors(filePath, fileName, '', nodes).catch(() => {})
        } else if (nodes.length > 500 && !_largeMapTipShown) {
          // 大图：整个会话只提示一次
          _largeMapTipShown = true
          emit('large-map', { filePath, fileName, nodeCount: nodes.length })
        }
      } catch { /* ignore */ }
    }
    return result
  },

  // 文档索引：PDF/DOCX/XLSX/CSV/MD/TXT 解析后的文本分块入库（file_type='doc'）
  async indexDocument(filePath, fileName, fileType, chunks, mtime) {
    const api = getApi()
    if (!api || typeof api.indexDocument !== 'function') return { success: false, error: '数据库不可用' }
    return await api.indexDocument({ filePath, fileName, fileType, chunks, mtime })
  },

  async removeFile(filePath) {
    const api = getApi()
    if (!api) return { success: false, error: '数据库不可用' }
    // 同步删除向量索引
    try {
      const vapi = window.electronAPI?.vector
      if (vapi && typeof vapi.remove === 'function') vapi.remove(filePath)
    } catch { /* ignore */ }
    return await api.removeFile(filePath)
  },

  // 删除目录下所有文件的搜索索引和向量索引
  async removeDir(dirPath) {
    const api = getApi()
    if (!api || typeof api.removeDir !== 'function') return { success: false, error: '数据库不可用' }
    const result = await api.removeDir(dirPath)
    // 同步删除向量索引
    if (result?.files?.length > 0) {
      try {
        const vapi = window.electronAPI?.vector
        if (vapi && typeof vapi.remove === 'function') {
          for (const fp of result.files) vapi.remove(fp)
        }
      } catch { /* ignore */ }
    }
    return result
  },

  async getStats() {
    const api = getApi()
    if (!api) return { files: 0, entries: 0 }
    return await api.getStats()
  },

  async listFiles() {
    const api = getApi()
    if (!api) return []
    return await api.listFiles()
  },

  // ========== 向量库操作 ==========

  getVectorApi() {
    return window.electronAPI?.vector || null
  },

  async getVectorStats() {
    const vapi = this.getVectorApi()
    if (!vapi || typeof vapi.getStats !== 'function') return { files: 0, vectors: 0 }
    const vStats = await vapi.getStats()
    // 计算未向量化的文件数（搜索索引里有，但向量库里没有）
    let unindexed = 0
    try {
      const api = getApi()
      if (api && typeof api.getStats === 'function') {
        const dbStats = await api.getStats()
        const dbFileCount = dbStats?.files || 0
        unindexed = Math.max(0, dbFileCount - (vStats.files || 0))
      }
    } catch { /* ignore */ }
    return { ...vStats, unindexed }
  },

  async clearAllVectors() {
    const vapi = this.getVectorApi()
    if (!vapi || typeof vapi.clearAll !== 'function') return { success: false, error: '向量库不可用' }
    return await vapi.clearAll()
  },

  /**
   * 混合语义检索：BM25 关键词 + 本地向量余弦（embedding），
   * RRF 融合排序；向量模型不可用时自动降级纯 BM25。
   * 支持思维导图（按 nodeUid 精确匹配）和文档（按 filePath 匹配）两类结果。
   * @param {string} query 原始查询
   * @returns {Promise<{results: Array, terms: string[]}>}
   */
  async semanticSearch(query) {
    const q = String(query || '').trim()
    if (!q) return { results: [], terms: [] }
    const terms = [q]

    // BM25 关键词检索
    const bm25Map = new Map()
    try {
      const res = await this.search(q)
      for (const r of res?.results || []) {
        const key = `${r.filePath}::${r.nodeUid || ''}`
        if (!bm25Map.has(key)) {
          const content = String(r.snippet || '').replace(/<[^>]+>/g, '')
          bm25Map.set(key, { ...r, snippet: content, hitTerms: [q] })
        }
      }
    } catch (e) {
      console.warn('[语义搜索] BM25 检索失败:', e)
    }

    // 向量检索（失败静默降级）
    const vectorHits = await this.vectorSearch(q, 30)

    // RRF 融合：BM25 名次分 + 向量名次分
    // 先给 BM25 结果排名次
    const bm25Ranked = [...bm25Map.values()].map((item, idx) => ({ ...item, bm25Rank: idx + 1 }))

    // 用 filePath + nodeUid 作为合并 key
    const merged = new Map()
    for (const item of bm25Ranked) {
      const key = `${item.filePath}::${item.nodeUid || ''}`
      merged.set(key, item)
    }

    // 合并向量命中
    for (const v of vectorHits) {
      // 思维导图节点：用 filePath + nodeUid 精确匹配
      // 文档：用 filePath 匹配（nodeUid 为空）
      const key = v.nodeUid ? `${v.filePath}::${v.nodeUid}` : `${v.filePath}::`
      const existing = merged.get(key)

      if (existing) {
        existing.vectorRank = v.rank
        existing.vectorScore = v.score
        existing.fileType = existing.fileType || v.fileType || 'doc'
        // 向量命中的文本比 BM25 snippet 更完整时补充
        if (v.text && v.text.length > (existing.snippet || '').length) {
          existing.snippet = v.text.slice(0, 200)
        }
      } else {
        // 向量独有的命中（BM25 没搜到）
        merged.set(key, {
          filePath: v.filePath,
          fileName: v.fileName,
          nodeUid: v.nodeUid || '',
          fileType: v.fileType || 'doc',
          snippet: String(v.text || '').slice(0, 200),
          hitTerms: [],
          vectorRank: v.rank,
          vectorScore: v.score
        })
      }
    }

    // RRF 计分排序
    const rrfScore = (item) => {
      let s = 0
      if (item.bm25Rank) s += 1 / (60 + item.bm25Rank)
      if (item.vectorRank) s += 1.2 / (60 + item.vectorRank)
      return s
    }

    const results = [...merged.values()]
      .map(item => ({ ...item, score: Math.round(rrfScore(item) * 10000) / 10000 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map((item, i) => ({ ...item, ref: i + 1 }))

    return { results, terms }
  },

  // 向量检索；模型未就绪/失败返回空数组
  async vectorSearch(query, topK = 20) {
    try {
      const vapi = this.getVectorApi()
      if (!vapi || typeof vapi.search !== 'function') return []
      const { embeddingService } = await import('./embeddingService')
      const qv = await embeddingService.embedQuery(query)
      if (!qv) return []
      const res = await vapi.search(qv, topK)
      if (!res?.success) return []
      return (res.results || []).map((r, i) => ({ ...r, rank: i + 1 }))
    } catch (e) {
      console.warn('[向量搜索] 失败:', e)
      return []
    }
  },

  // 文档向量索引（模型就绪后异步计算；失败静默，BM25 检索不受影响）
  async indexDocumentVectors(filePath, fileName, mtime, chunks) {
    const run = async () => {
      const vapi = this.getVectorApi()
      if (!vapi || typeof vapi.indexDocument !== 'function') return false
      const { embeddingService } = await import('./embeddingService')
      const vectors = await embeddingService.embedPassages(chunks)
      if (!vectors.length) return false
      await vapi.indexDocument({ filePath, fileName, mtime, chunks, vectors })
      return true
    }
    try {
      try {
        return await run()
      } catch (firstErr) {
        // 失败后重试 1 次
        console.warn('[向量索引] 文档首次索引失败，重试中:', firstErr?.message)
        return await run()
      }
    } catch (e) {
      console.warn('[向量索引] 文档索引失败:', e)
      return false
    }
  },

  // 思维导图节点向量索引（失败静默，不影响关键词搜索，自动重试 1 次）
  async indexMindMapVectors(filePath, fileName, mtime, nodes) {
    const run = async () => {
      const vapi = this.getVectorApi()
      if (!vapi || typeof vapi.indexMindMap !== 'function') return false
      if (!Array.isArray(nodes) || !nodes.length) return false
      const texts = nodes.map(n => n.text || '')
      const { embeddingService } = await import('./embeddingService')
      const vectors = await embeddingService.embedPassages(texts)
      if (!vectors.length) return false
      await vapi.indexMindMap({ filePath, fileName, mtime, nodes, vectors })
      return true
    }
    try {
      try {
        return await run()
      } catch (firstErr) {
        // 失败后重试 1 次
        console.warn('[向量索引] 思维导图首次索引失败，重试中:', firstErr?.message)
        return await run()
      }
    } catch (e) {
      console.warn('[向量索引] 思维导图索引失败:', e)
      return false
    }
  },

  /**
   * 重建全部向量索引
   * 从 search_index 读取已索引的文件内容，重新计算向量并写入向量库
   * @param {function} onProgress 进度回调 (current, total, fileName) => void
   * @param {object} controller 可选的取消控制器（{ cancelled: false }）
   * @returns {Promise<{success: boolean, total: number, successCount: number, failedCount: number, cancelled: boolean, error?: string}>}
   */
  async rebuildAllVectors(onProgress, controller) {
    try {
      const api = getApi()
      const vapi = this.getVectorApi()
      if (!api || !vapi) return { success: false, total: 0, successCount: 0, failedCount: 0, cancelled: false, error: '数据库不可用' }

      const isCancelled = () => controller && controller.cancelled

      // 1. 清空现有向量库
      await vapi.clearAll()

      // 2. 获取所有已索引文件
      const files = await api.listFiles()
      if (!Array.isArray(files) || files.length === 0) {
        return { success: true, total: 0, successCount: 0, failedCount: 0, cancelled: false }
      }

      // 3. 逐个文件重建向量（带失败重试）
      let successCount = 0
      let failedCount = 0
      const { embeddingService } = await import('./embeddingService')

      // 重试工具函数
      const withRetry = async (fn, retries = 2) => {
        let lastError = null
        for (let i = 0; i <= retries; i++) {
          if (isCancelled()) return { ok: false, cancelled: true }
          try {
            const result = await fn()
            return { ok: !!result, cancelled: false }
          } catch (e) {
            lastError = e
            if (i < retries) {
              // 重试前短暂等待
              await new Promise(r => setTimeout(r, 500 * (i + 1)))
            }
          }
        }
        console.warn('[向量重建] 重试耗尽失败:', lastError)
        return { ok: false, cancelled: false }
      }

      for (let i = 0; i < files.length; i++) {
        if (isCancelled()) break

        const f = files[i]
        const filePath = f.file_path || f.filePath
        const fileName = f.file_name || f.fileName || ''
        const fileType = f.file_type || 'smm'

        try {
          if (onProgress) onProgress(i + 1, files.length, fileName)

          // 获取文件的所有索引条目
          const res = await api.getFileEntries(filePath)
          const entries = res?.entries || []
          if (!entries.length) { continue }

          if (fileType === 'smm') {
            // 思维导图：提取节点列表
            const nodes = entries
              .filter(e => e.node_uid && e.content)
              .map(e => ({ uid: e.node_uid, text: String(e.content || '').trim() }))
              .filter(n => n.text)
            if (nodes.length > 0) {
              const r = await withRetry(() => this.indexMindMapVectors(filePath, fileName, f.mtime || '', nodes))
              if (r.cancelled) break
              if (r.ok) successCount++
              else failedCount++
            }
          } else {
            // 文档：分块列表
            const chunks = entries
              .map(e => String(e.content || '').trim())
              .filter(Boolean)
            if (chunks.length > 0) {
              const r = await withRetry(() => this.indexDocumentVectors(filePath, fileName, f.mtime || '', chunks))
              if (r.cancelled) break
              if (r.ok) successCount++
              else failedCount++
            }
          }
        } catch (e) {
          console.warn('[向量重建] 文件失败:', fileName, e)
          failedCount++
        }
      }

      const cancelled = isCancelled()
      return {
        success: !cancelled,
        total: files.length,
        successCount,
        failedCount,
        cancelled
      }
    } catch (e) {
      console.error('[向量重建] 整体失败:', e)
      return { success: false, total: 0, successCount: 0, failedCount: 0, cancelled: false, error: e.message }
    }
  }
}
