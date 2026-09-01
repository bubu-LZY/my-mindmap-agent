/**
 * 文档向量库（主进程，三期：本地语义检索）
 * - 存储每个文件的分块/节点向量 + 文本（userData/doc_vectors.json）
 * - 支持文档（doc）和思维导图（smm）两类文件
 * - 向量已归一化（embeddingService 输出），余弦相似度 = 点积
 * - 个人知识库规模（万级 chunk）全量内存扫描即可毫秒级返回
 */
const { ipcMain, app } = require('electron')
const fs = require('fs')
const path = require('path')

// store 结构：
// {
//   [filePath]: {
//     fileName, mtime, fileType,  // fileType: 'doc' | 'smm'
//     chunks: string[],            // 分块文本 / 节点文本
//     vectors: number[][],         // 对应向量
//     nodeUids?: string[]          // 仅 smm：节点 uid，与 chunks/vectors 一一对应
//   }
// }
let store = null
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
  if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
    return '__unsafe_' + k
  }
  return k
}

// 安全校验向量数据：必须是数字数组，防止注入异常数据
function validateVectors(vectors, expectedDim = null) {
  if (!Array.isArray(vectors)) return false
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i]
    if (!Array.isArray(v)) return false
    if (expectedDim !== null && v.length !== expectedDim) return false
    for (let j = 0; j < v.length; j++) {
      if (typeof v[j] !== 'number' || !Number.isFinite(v[j])) return false
    }
  }
  return true
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
  // 文档向量索引（doc 类型）
  ipcMain.handle('vector:indexDocument', async (event, { filePath, fileName, mtime, chunks, vectors }) => {
    try {
      loadStore()
      if (!Array.isArray(chunks) || !Array.isArray(vectors) || !chunks.length || chunks.length !== vectors.length) {
        return { success: false, error: '向量与分块数量不匹配' }
      }
      if (!validateVectors(vectors)) {
        return { success: false, error: '向量数据格式无效' }
      }
      const key = safeKey(filePath)
      store[key] = {
        fileName: fileName || '',
        mtime: mtime || '',
        fileType: 'doc',
        chunks,
        vectors
      }
      saveStore()
      return { success: true, indexed: chunks.length }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // 思维导图节点向量索引（smm 类型）
  ipcMain.handle('vector:indexMindMap', async (event, { filePath, fileName, mtime, nodes, vectors }) => {
    try {
      loadStore()
      if (!Array.isArray(nodes) || !Array.isArray(vectors) || !nodes.length || nodes.length !== vectors.length) {
        return { success: false, error: '向量与节点数量不匹配' }
      }
      if (!validateVectors(vectors)) {
        return { success: false, error: '向量数据格式无效' }
      }
      const key = safeKey(filePath)
      const texts = nodes.map(n => n.text || '')
      const uids = nodes.map(n => n.uid || '')
      store[key] = {
        fileName: fileName || '',
        mtime: mtime || '',
        fileType: 'smm',
        chunks: texts,
        vectors,
        nodeUids: uids
      }
      saveStore()
      return { success: true, indexed: nodes.length }
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

  // 清空全部向量（用于重建）
  ipcMain.handle('vector:clearAll', async () => {
    try {
      loadStore()
      store = Object.create(null)
      saveStore()
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // 列出所有已向量化的文件
  ipcMain.handle('vector:listFiles', async () => {
    try {
      loadStore()
      const files = []
      for (const [filePath, entry] of Object.entries(store)) {
        files.push({
          filePath,
          fileName: entry.fileName || '',
          fileType: entry.fileType || 'doc',
          mtime: entry.mtime || '',
          vectorCount: (entry.vectors || []).length
        })
      }
      return { success: true, files }
    } catch (e) {
      return { success: false, error: e.message, files: [] }
    }
  })

  // 余弦（= 点积，向量已归一化）全量扫描，返回 topK 命中
  ipcMain.handle('vector:search', async (event, { queryVector, topK = 8 }) => {
    try {
      loadStore()
      const q = Array.isArray(queryVector) ? queryVector : null
      if (!q || !q.length) return { success: false, error: '无效查询向量' }
      const k = Math.max(1, Math.min(Number(topK) || 8, 50))
      const hits = []
      for (const [filePath, entry] of Object.entries(store)) {
        const vecs = entry.vectors || []
        for (let i = 0; i < vecs.length; i++) {
          const v = vecs[i]
          if (!Array.isArray(v) || v.length !== q.length) continue
          let dot = 0
          for (let j = 0; j < q.length; j++) dot += q[j] * v[j]
          if (dot > 0.25) {
            hits.push({
              filePath,
              fileName: entry.fileName || '',
              fileType: entry.fileType || 'doc',
              chunkIdx: i,
              text: entry.chunks?.[i] || '',
              nodeUid: entry.nodeUids?.[i] || '',
              score: Math.round(dot * 1000) / 1000
            })
          }
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
      let docCount = 0
      let smmCount = 0
      for (const entry of Object.values(store)) {
        const vc = (entry.vectors || []).length
        vectorCount += vc
        if (entry.fileType === 'smm') smmCount++
        else docCount++
      }
      return {
        files: Object.keys(store).length,
        vectors: vectorCount,
        docFiles: docCount,
        smmFiles: smmCount
      }
    } catch (e) {
      return { files: 0, vectors: 0, docFiles: 0, smmFiles: 0, error: e.message }
    }
  })
}

registerVectorHandlers()

module.exports = {}
