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
   * 语义检索：把 query 与扩展词分别做本地索引检索，合并去重后按命中词数和
   * 命中位置打分排序。扩展词可以由 AI 生成，也可以由调用方直接传入。
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

    const queryTokens = [...new Set(terms.flatMap(term => term.toLowerCase().split(/[\s,，、/|]+/)).filter(Boolean))]
    const results = [...merged.values()].map((result, index) => {
      const content = String(result.snippet || '').replace(/<[^>]+>/g, '')
      const haystack = `${result.fileName || ''} ${content}`.toLowerCase()
      let score = result.hitTerms.length * 6
      for (const token of queryTokens) if (haystack.includes(token)) score += 3
      return { ...result, snippet: content, score, ref: index + 1 }
    }).sort((a, b) => b.score - a.score).slice(0, 30)

    return { results, terms }
  }
}
