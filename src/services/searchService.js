import { parseDocument, chunkText } from './docParseService'

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
   * 目录树实时兜底搜索：直接遍历左侧目录树根目录，搜索文件名与文件内容。
   * 重点覆盖尚未进入 SQLite 索引的二进制文档（PDF/DOCX/PPTX/XLSX/XLS）。
   * 有文件数量与时间上限，避免阻塞 UI。
   */
  async searchDirectoryTree(query, roots = [], options = {}) {
    const q = String(query || '').trim()
    if (!q) return { results: [], timedOut: false }

    const maxFiles = Math.min(Math.max(Number(options.maxFiles) || 180, 1), 300)
    const maxDepth = Math.min(Math.max(Number(options.maxDepth) || 5, 1), 8)
    const deadline = Date.now() + Math.min(Math.max(Number(options.timeoutMs) || 5000, 1000), 12000)
    const textExts = new Set(['txt', 'md', 'markdown', 'json', 'log', 'html', 'xml', 'csv', 'tsv'])
    const binaryExts = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'xls'])
    const allExts = new Set([...textExts, ...binaryExts])

    let resolvedRoots = Array.isArray(roots) ? roots.filter(p => typeof p === 'string' && p) : []
    if (!resolvedRoots.length) {
      try {
        const saved = JSON.parse(localStorage.getItem('MINDMAP_FOLDER_ROOTS') || '[]')
        if (Array.isArray(saved)) resolvedRoots.push(...saved.filter(p => typeof p === 'string' && p))
      } catch {}
    }
    try {
      const saveDir = await window.electronAPI?.getDefaultSaveDir?.()
      if (saveDir) resolvedRoots.push(saveDir)
    } catch {}
    resolvedRoots = [...new Set(resolvedRoots.filter(p => p && typeof p === 'string'))]
    if (!resolvedRoots.length) return { results: [], timedOut: false }

    const results = []
    const seen = new Set()
    const binaryDocCache = new Map()
    let timedOut = false
    let processed = 0
    const pushResult = (item) => {
      const key = `${item.filePath}::${item.nodeUid || ''}`
      if (seen.has(key)) return
      seen.add(key)
      results.push(item)
    }

    const makeSnippet = (content) => {
      const text = String(content || '')
      const lower = text.toLowerCase()
      const idx = lower.indexOf(q.toLowerCase())
      if (idx === -1) return text.slice(0, 160)
      const start = Math.max(0, idx - 30)
      return (start > 0 ? '...' : '') + text.slice(start, idx + q.length + 90) + (idx + q.length + 90 < text.length ? '...' : '')
    }

    const searchTextFile = async (filePath, fileName, ext) => {
      const content = await window.electronAPI?.fs?.readFile?.(filePath)
      if (content && String(content).toLowerCase().includes(q.toLowerCase())) {
        pushResult({
          filePath,
          fileName,
          nodeUid: '',
          fileType: 'doc',
          snippet: makeSnippet(String(content))
        })
      }
    }

    const searchBinaryFile = async (filePath, fileName) => {
      const st = await window.electronAPI?.fs?.stat?.(filePath)
      if (st?.success && Number(st.size || 0) > 20 * 1024 * 1024) return
      const cacheKey = `${filePath}::${st?.mtime || ''}`
      let doc = binaryDocCache.get(cacheKey)
      if (doc === undefined) {
        doc = await parseDocument(filePath)
        binaryDocCache.set(cacheKey, doc)
      }
      if (!doc?.success) return
      const chunks = chunkText(String(doc.text || ''))
      for (const chunk of chunks) {
        if (!chunk.toLowerCase().includes(q.toLowerCase())) continue
        pushResult({
          filePath,
          fileName,
          nodeUid: '',
          fileType: 'doc',
          snippet: makeSnippet(chunk)
        })
        break
      }
    }

    const walk = async (dir, depth) => {
      if (timedOut || processed >= maxFiles || Date.now() > deadline) return
      if (depth > maxDepth) return
      const entries = await window.electronAPI?.fs?.listDir?.(dir) || []
      for (const entry of entries) {
        if (timedOut || processed >= maxFiles || Date.now() > deadline) {
          timedOut = true
          return
        }
        if (entry.isDir) {
          await walk(entry.path, depth + 1)
          continue
        }
        const ext = (entry.name || '').split('.').pop().toLowerCase()
        if (!allExts.has(ext)) continue
        processed++
        if (entry.name.toLowerCase().includes(q.toLowerCase())) {
          pushResult({
            filePath: entry.path,
            fileName: entry.name,
            nodeUid: '',
            fileType: 'doc',
            snippet: '文件名命中'
          })
        }
        try {
          if (textExts.has(ext)) await searchTextFile(entry.path, entry.name, ext)
          else if (binaryExts.has(ext)) await searchBinaryFile(entry.path, entry.name)
        } catch {}
        if (processed % 6 === 0) await new Promise((r) => setTimeout(r, 0))
      }
    }

    for (const root of resolvedRoots) {
      if (timedOut || processed >= maxFiles) break
      await walk(root, 0)
    }

    return { results: results.slice(0, 30), timedOut }
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
      const batchSize = 24
      const list = (chunks || []).slice(0, 800)
      let indexed = 0
      for (let i = 0; i < list.length; i += batchSize) {
        const batchChunks = list.slice(i, i + batchSize)
        const batchVectors = await embeddingService.embedPassages(batchChunks)
        if (!batchVectors.length) continue
        const payload = {
          filePath,
          fileName,
          mtime,
          chunks: batchChunks,
          vectors: batchVectors
        }
        if (i === 0) {
          const r = await api.indexDocument(payload)
          if (!r?.success) return indexed > 0
        } else if (typeof api.appendDocument === 'function') {
          const r = await api.appendDocument(payload)
          if (!r?.success) break
        } else {
          break
        }
        indexed += batchChunks.length
        // 每个 batch 让出主线程，避免大批量推理持续占用 UI。
        await new Promise((r) => setTimeout(r, 0))
      }
      return indexed > 0
    } catch {
      return false
    }
  }
}
