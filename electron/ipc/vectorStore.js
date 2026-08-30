/**
 * 文档向量库（主进程，三期：本地语义检索）
 * - 存储每个文档的分块向量 + 分块文本（userData/doc_vectors.json）
 * - 向量已归一化（embeddingService 输出），余弦相似度 = 点积
 * - 个人知识库规模（万级 chunk）全量内存扫描即可毫秒级返回
 */
const { ipcMain, app } = require('electron')
const fs = require('fs')
const path = require('path')

let store = null // { [filePath]: { fileName, mtime, chunks: string[], vectors: number[][] } }
let loaded = false
let saveTimer = null

function getStorePath() {
  return path.join(app.getPath('userData'), 'doc_vectors.json')
}

function loadStore() {
  if (loaded) return
  loaded = true
  try {
    if (fs.existsSync(getStorePath())) {
      const parsed = JSON.parse(fs.readFileSync(getStorePath(), 'utf8'))
      // 使用 Object.create(null) 创建无原型对象，防止原型污染
      store = Object.create(null)
      if (parsed && typeof parsed === 'object') {
        for (const key of Object.keys(parsed)) {
          store[key] = parsed[key]
        }
      }
    } else {
      store = Object.create(null)
    }
  } catch (e) {
    console.error('[Vector] 向量库加载失败:', e)
    store = Object.create(null)
  }
  if (!store || typeof store !== 'object') store = Object.create(null)
}

// 安全键名校验：防止原型污染
function safeKey(key) {
  const k = String(key || '')
  // 拒绝 __proto__ / constructor / prototype 等危险键名
  if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
    return '__unsafe_' + k
  }
  return k
}

function saveStore() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      fs.writeFileSync(getStorePath(), JSON.stringify(store))
    } catch (e) {
      console.error('[Vector] 向量库保存失败:', e)
    }
  }, 1000)
}

function registerVectorHandlers() {
  ipcMain.handle('vector:indexDocument', async (event, { filePath, fileName, mtime, chunks, vectors }) => {
    try {
      loadStore()
      if (!Array.isArray(chunks) || !Array.isArray(vectors) || !chunks.length || chunks.length !== vectors.length) {
        return { success: false, error: '向量与分块数量不匹配' }
      }
      const key = safeKey(filePath)
      store[key] = { fileName: fileName || '', mtime: mtime || '', chunks, vectors }
      saveStore()
      return { success: true, indexed: chunks.length }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('vector:remove', async (event, { filePath }) => {
    try {
      loadStore()
      const key = safeKey(filePath)
      if (store[key]) {
        delete store[key]
        saveStore()
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // 余弦（= 点积，向量已归一化）全量扫描，返回 topK 命中
  ipcMain.handle('vector:search', async (event, { queryVector, topK = 8 }) => {
    try {
      loadStore()
      const q = Array.isArray(queryVector) ? queryVector : null
      if (!q || !q.length) return { success: false, error: '无效查询向量' }
      const k = Math.max(1, Math.min(Number(topK) || 8, 20))
      const hits = []
      for (const [filePath, entry] of Object.entries(store)) {
        const vecs = entry.vectors || []
        for (let i = 0; i < vecs.length; i++) {
          const v = vecs[i]
          if (!Array.isArray(v) || v.length !== q.length) continue
          let dot = 0
          for (let j = 0; j < q.length; j++) dot += q[j] * v[j]
          if (dot > 0.25) hits.push({ filePath, fileName: entry.fileName || '', chunkIdx: i, text: entry.chunks?.[i] || '', score: Math.round(dot * 1000) / 1000 })
        }
      }
      hits.sort((a, b) => b.score - a.score)
      return { success: true, results: hits.slice(0, k) }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('vector:getStats', async () => {
    try {
      loadStore()
      let vectorCount = 0
      for (const entry of Object.values(store)) vectorCount += (entry.vectors || []).length
      return { files: Object.keys(store).length, vectors: vectorCount }
    } catch (e) {
      return { files: 0, vectors: 0, error: e.message }
    }
  })
}

registerVectorHandlers()

module.exports = {}
