const getApi = () => window.electronAPI?.database

export const searchService = {
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
    return await api.indexFile(filePath, fileName, treeData)
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
    return await api.removeFile(filePath)
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

  /**
   * 混合语义检索：BM25 关键词（含意图扩展词）+ 本地向量余弦（E5 embedding），
   * RRF 融合排序；向量模型不可用（未下载/加载失败）时自动降级纯 BM25。
   * @param {string} query 原始问题/核心词
   * @param {string[]} keywords 意图扩展词（可为空，则退化为 query 多词检索）
   * @returns {Promise<{results: Array, terms: string[]}>}
   */
  async semanticSearch(query, keywords = []) {
    const terms = [...new Set([
      ...(Array.isArray(keywords) ? keywords.map(k => String(k || '').trim()).filter(Boolean) : []),
      String(query || '').trim()
    ].filter(Boolean))]
    if (terms.length === 0) return { results: [], terms }

    const merged = new Map()
    for (const term of terms) {
      let res
      try {
        res = await this.search(term)
      } catch (e) {
        continue
      }
      for (const r of res?.results || []) {
        const key = `${r.filePath}::${r.nodeUid}`
        if (!merged.has(key)) {
          merged.set(key, { ...r, hitTerms: [term] })
        } else {
          const item = merged.get(key)
          if (!item.hitTerms.includes(term)) item.hitTerms.push(term)
        }
      }
    }

    // 本地向量检索（失败静默降级 BM25）
    const vectorHits = await this.vectorSearch(query, 8)

    // RRF 融合：BM25 名次分 + 向量名次分
    const bm25Ranked = [...merged.values()]
      .map((result, index) => {
        const content = String(result.snippet || '').replace(/<[^>]+>/g, '')
        return { ...result, snippet: content, bm25Rank: index + 1 }
      })
    const rrfScore = (item) => {
      let s = 0
      if (item.bm25Rank) s += 1 / (60 + item.bm25Rank)
      if (item.vectorRank) s += 1.2 / (60 + item.vectorRank)
      return s
    }

    const vecMerged = new Map(bm25Ranked.map(r => [`${r.filePath}::${r.nodeUid}`, r]))
    for (const v of vectorHits) {
      const key = `${v.filePath}::`
      const existing = vecMerged.get(key)
      if (existing) {
        existing.vectorRank = v.rank
        existing.vectorScore = v.score
        // 向量命中的 chunk 文本比 BM25 snippet 更完整时补充
        if (v.text && v.text.length > (existing.snippet || '').length) existing.snippet = v.text.slice(0, 160)
      } else {
        vecMerged.set(key, {
          filePath: v.filePath,
          fileName: v.fileName,
          nodeUid: '',
          fileType: 'doc',
          snippet: String(v.text || '').slice(0, 160),
          hitTerms: [],
          vectorRank: v.rank,
          vectorScore: v.score
        })
      }
    }

    const results = [...vecMerged.values()]
      .map(item => ({ ...item, score: Math.round(rrfScore(item) * 10000) / 10000 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map((item, i) => ({ ...item, ref: i + 1 }))

    return { results, terms }
  },

  // 本地向量余弦检索（E5）；模型未就绪/失败返回空数组
  async vectorSearch(query, topK = 8) {
    try {
      const api = window.electronAPI?.vector
      if (!api || typeof api.search !== 'function') return []
      const { embeddingService } = await import('./embeddingService')
      const qv = await embeddingService.embedQuery(query)
      if (!qv) return []
      const res = await api.search(qv, topK)
      if (!res?.success) return []
      return (res.results || []).map((r, i) => ({ ...r, rank: i + 1 }))
    } catch {
      return []
    }
  },

  // 文档向量索引（模型就绪后异步计算；失败静默，BM25 检索不受影响）
  async indexDocumentVectors(filePath, fileName, mtime, chunks) {
    try {
      const api = window.electronAPI?.vector
      if (!api || typeof api.indexDocument !== 'function') return false
      const { embeddingService } = await import('./embeddingService')
      const vectors = await embeddingService.embedPassages(chunks)
      if (!vectors.length) return false
      await api.indexDocument({ filePath, fileName, mtime, chunks, vectors })
      return true
    } catch {
      return false
    }
  }
}
