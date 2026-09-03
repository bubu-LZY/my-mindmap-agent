/**
 * 文档向量库（主进程，文件分片存储）
 * - 每个文档一个 JSON 分片：chunks + vectors
 * - 搜索时逐个分片读取，避免一次性把全库向量读进内存
 * - 大文档按批 append，索引过程内存峰值可控
 */
const { ipcMain, app } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MAX_CHUNKS_PER_FILE = 800

function getStoreDir() {
  return path.join(app.getPath('userData'), 'doc_vectors')
}

function getLegacyPath() {
  return path.join(app.getPath('userData'), 'doc_vectors.json')
}

function ensureDir() {
  const dir = getStoreDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function shardName(filePath) {
  return crypto.createHash('sha256').update(String(filePath || '')).digest('hex') + '.json'
}

function shardPath(filePath) {
  return path.join(ensureDir(), shardName(filePath))
}

function readShard(filePath) {
  const p = shardPath(filePath)
  if (!fs.existsSync(p)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (!raw || !Array.isArray(raw.chunks) || !Array.isArray(raw.vectors)) return null
    return raw
  } catch {
    return null
  }
}

function writeShard(entry) {
  const p = shardPath(entry.filePath)
  fs.writeFileSync(p, JSON.stringify(entry), 'utf8')
}

function removeShard(filePath) {
  const p = shardPath(filePath)
  if (fs.existsSync(p)) {
    try { fs.unlinkSync(p) } catch {}
  }
}

function migrateLegacyStore() {
  const legacy = getLegacyPath()
  if (!fs.existsSync(legacy)) return
  try {
    const old = JSON.parse(fs.readFileSync(legacy, 'utf8'))
    if (!old || typeof old !== 'object') return
    for (const [filePath, entry] of Object.entries(old)) {
      if (!entry || !Array.isArray(entry.chunks) || !Array.isArray(entry.vectors)) continue
      writeShard({
        filePath,
        fileName: entry.fileName || '',
        mtime: entry.mtime || '',
        chunks: entry.chunks.slice(0, MAX_CHUNKS_PER_FILE),
        vectors: entry.vectors.slice(0, MAX_CHUNKS_PER_FILE)
      })
    }
    try { fs.unlinkSync(legacy) } catch {}
  } catch {}
}

function listShards() {
  ensureDir()
  migrateLegacyStore()
  return fs.readdirSync(getStoreDir()).filter(f => f.endsWith('.json'))
}

function capEntry(entry) {
  return {
    filePath: entry.filePath || '',
    fileName: entry.fileName || '',
    mtime: entry.mtime || '',
    chunks: (entry.chunks || []).slice(0, MAX_CHUNKS_PER_FILE),
    vectors: (entry.vectors || []).slice(0, MAX_CHUNKS_PER_FILE)
  }
}

function registerVectorHandlers() {
  ensureDir()
  migrateLegacyStore()

  ipcMain.handle('vector:indexDocument', async (event, { filePath, fileName, mtime, chunks, vectors }) => {
    try {
      if (!Array.isArray(chunks) || !Array.isArray(vectors) || !chunks.length || chunks.length !== vectors.length) {
        return { success: false, error: '向量与分块数量不匹配' }
      }
      writeShard(capEntry({ filePath, fileName, mtime, chunks, vectors }))
      return { success: true, indexed: Math.min(chunks.length, MAX_CHUNKS_PER_FILE) }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('vector:appendDocument', async (event, { filePath, fileName, mtime, chunks, vectors }) => {
    try {
      if (!Array.isArray(chunks) || !Array.isArray(vectors) || !chunks.length || chunks.length !== vectors.length) {
        return { success: false, error: '向量与分块数量不匹配' }
      }
      const existing = readShard(filePath) || { filePath, fileName: fileName || '', mtime: mtime || '', chunks: [], vectors: [] }
      const merged = capEntry({
        filePath,
        fileName: fileName || existing.fileName,
        mtime: mtime || existing.mtime,
        chunks: [...existing.chunks, ...chunks],
        vectors: [...existing.vectors, ...vectors]
      })
      writeShard(merged)
      return { success: true, indexed: merged.chunks.length }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('vector:remove', async (event, { filePath }) => {
    try {
      removeShard(filePath)
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('vector:search', async (event, { queryVector, topK = 8 }) => {
    try {
      const q = Array.isArray(queryVector) ? queryVector : null
      if (!q || !q.length) return { success: false, error: '无效查询向量' }
      const k = Math.max(1, Math.min(Number(topK) || 8, 30))
      const hits = []

      let scanned = 0
      for (const name of listShards()) {
        scanned++
        if (scanned % 10 === 0) await new Promise((resolve) => setImmediate(resolve))
        const p = path.join(getStoreDir(), name)
        let entry
        try {
          entry = JSON.parse(fs.readFileSync(p, 'utf8'))
        } catch {
          continue
        }
        const vecs = entry.vectors || []
        for (let i = 0; i < vecs.length; i++) {
          const v = vecs[i]
          if (!Array.isArray(v) || v.length !== q.length) continue
          let dot = 0
          for (let j = 0; j < q.length; j++) dot += q[j] * v[j]
          if (dot > 0.12) {
            hits.push({
              filePath: entry.filePath || '',
              fileName: entry.fileName || '',
              chunkIdx: i,
              text: entry.chunks?.[i] || '',
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
      let files = 0
      let vectorCount = 0
      for (const name of listShards()) {
        try {
          const entry = JSON.parse(fs.readFileSync(path.join(getStoreDir(), name), 'utf8'))
          files++
          vectorCount += (entry.vectors || []).length
        } catch {}
      }
      return { files, vectors: vectorCount }
    } catch (e) {
      return { files: 0, vectors: 0, error: e.message }
    }
  })
}

registerVectorHandlers()

module.exports = {}
