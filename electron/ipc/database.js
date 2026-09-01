const { ipcMain, app } = require('electron')
const fs = require('fs')
const path = require('path')
const MiniSearch = require('minisearch')

let db = null
let SQL = null

const DB_FILE = 'mindmap_search.db'

function getDBPath() {
  return path.join(app.getPath('userData'), DB_FILE)
}

async function initDatabase() {
  if (db) return db

  const initSqlJs = require('sql.js')
  SQL = await initSqlJs()

  const dbPath = getDBPath()
  if (fs.existsSync(dbPath)) {
    const buffer = await fs.promises.readFile(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // sql.js 的 WASM 构建不含 FTS5 模块，使用普通表 + LIKE 实现关键词检索
  // 仅当 search_index 是 FTS5 虚拟表时才删除（旧版本遗留），普通表必须保留
  try {
    const vtabCheck = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='search_index'")
    if (vtabCheck.length && vtabCheck[0].values.length) {
      const sql = String(vtabCheck[0].values[0][0] || '')
      if (sql.toUpperCase().includes('VIRTUAL TABLE') && sql.toUpperCase().includes('FTS5')) {
        db.run('DROP TABLE IF EXISTS search_index')
      }
    }
  } catch (e) {
    // 旧虚拟表无法 DROP 时忽略；普通表查询失败不影响主流程
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT UNIQUE NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT DEFAULT 'smm',
      mtime TEXT,
      indexed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS search_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT,
      file_path TEXT,
      file_name TEXT,
      node_uid TEXT,
      file_type TEXT DEFAULT 'smm'
    );

    CREATE INDEX IF NOT EXISTS idx_search_content ON search_index(content);
    CREATE INDEX IF NOT EXISTS idx_search_file ON search_index(file_path);
  `)

  // 旧库升级：补 file_type / mtime 列（ADD COLUMN 无 IF NOT EXISTS，先查表结构）
  try {
    const cols = queryRows("PRAGMA table_info(files)")
    const fileCols = new Set(cols.map(c => c.name))
    if (!fileCols.has('file_type')) db.run("ALTER TABLE files ADD COLUMN file_type TEXT DEFAULT 'smm'")
    if (!fileCols.has('mtime')) db.run("ALTER TABLE files ADD COLUMN mtime TEXT")
    const idxCols = new Set(queryRows("PRAGMA table_info(search_index)").map(c => c.name))
    if (!idxCols.has('file_type')) db.run("ALTER TABLE search_index ADD COLUMN file_type TEXT DEFAULT 'smm'")
  } catch (e) {
    console.error('[DB] 表结构升级失败:', e)
  }

  return db
}

// 数据库写盘节流：db.export() + writeFileSync 是同步阻塞操作，
// 批量索引（如启动时 rebuildSearchIndex 连续索引上百个文件）若每次都写盘，
// 会反复阻塞主进程导致界面卡死。改为延迟合并写盘：400ms 内多次调用只写一次。
let saveTimer = null

function saveDatabase() {
  if (!db) return
  if (saveTimer) return // 已有待执行的写盘任务，本次跳过
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      const data = db.export()
      const buffer = Buffer.from(data)
      fs.writeFileSync(getDBPath(), buffer)
    } catch (e) {
      console.error('[DB] 保存失败:', e)
    }
  }, 400)
}

// 立即同步写盘（应用退出前调用，避免节流窗口内的数据丢失）
function flushDatabaseSync() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!db) return
  try {
    const data = db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(getDBPath(), buffer)
  } catch (e) {
    console.error('[DB] 退出写盘失败:', e)
  }
}

function extractAllText(node, results = []) {
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
    children.forEach(child => extractAllText(child, results))
  }
  return results
}

// 生成匹配片段（高亮命中词附近的文本）
function makeSnippet(content, query) {
  // 先转义文本，再高亮，避免节点内容中的 HTML 注入（渲染层用 v-html 展示片段）
  const lowerContent = content.toLowerCase()
  const idx = lowerContent.indexOf(query.toLowerCase())
  let raw
  if (idx === -1) {
    raw = content.length > 60 ? content.slice(0, 60) + '...' : content
  } else {
    const start = Math.max(0, idx - 20)
    const end = Math.min(content.length, idx + query.length + 40)
    raw = (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '')
  }
  const escapedText = escapeHtml(raw)
  // 在转义后的文本上高亮所有命中
  const escaped = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escapedText.replace(new RegExp(escaped, 'gi'), m => `<mark>${m}</mark>`)
}

function queryRows(sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

/* ============================================================
 * MiniSearch BM25 内存索引（sql.js 无 FTS5，用其补齐全文检索排序）
 * 中文分词：英文数字整词 + 汉字单字与相邻二字组（bigram）
 * ============================================================ */
const zhTokenize = (s) => {
  const text = String(s || '').toLowerCase()
  const tokens = []
  for (const w of text.match(/[a-z0-9]+/g) || []) tokens.push(w)
  const han = text.replace(/[^\u4e00-\u9fff]/g, '')
  for (let i = 0; i < han.length; i++) {
    tokens.push(han[i])
    if (i + 1 < han.length) tokens.push(han.slice(i, i + 2))
  }
  return tokens
}

// 查询专用中文分词：按空白/标点分段，每段只保留二字组（bigram）去掉单字，避免"文/化/飞/跃"这类单字命中放大无关结果
const zhQueryTokenize = (s) => {
  const text = String(s || '').toLowerCase()
  const tokens = []
  for (const w of text.match(/[a-z0-9]+/g) || []) tokens.push(w)
  // 按空白/标点切分中文片段，逐段生成 bigram（避免跨词 bigram）
  const segs = text.split(/[^\u4e00-\u9fff]+/).filter(Boolean)
  for (const seg of segs) {
    if (seg.length === 1) {
      tokens.push(seg) // 单字兜底
    } else {
      for (let i = 0; i + 1 < seg.length; i++) tokens.push(seg.slice(i, i + 2))
    }
  }
  return tokens
}

let miniIndex = null
let miniLoaded = false

function getMiniIndex() {
  if (miniIndex) return miniIndex
  miniIndex = new MiniSearch({
    fields: ['content', 'file_name'],
    storeFields: ['content', 'file_path', 'file_name', 'node_uid', 'file_type'],
    tokenize: zhTokenize,
    searchOptions: {
      tokenize: zhTokenize,
      fuzzy: 0.2,
      prefix: true,
      boost: { file_name: 2 }
    }
  })
  return miniIndex
}

// 懒加载全量：首次 BM25 检索时把 SQLite 内容构建进内存索引
function ensureMiniLoaded() {
  if (miniLoaded) return
  const rows = queryRows('SELECT id, content, file_path, file_name, node_uid, file_type FROM search_index')
  const docs = rows.map(r => ({
    id: r.id,
    content: String(r.content || ''),
    file_path: r.file_path,
    file_name: r.file_name,
    node_uid: r.node_uid || '',
    file_type: r.file_type || 'smm'
  }))
  try {
    getMiniIndex().addAll(docs)
  } catch (e) {
    console.error('[DB] MiniSearch 全量加载失败:', e)
  }
  miniLoaded = true
}

// 写入 SQLite 后同步内存索引（失败不影响主流程，下次全量重建自动修复）
function miniAddRows(rows) {
  try {
    ensureMiniLoaded()
    const mini = getMiniIndex()
    for (const r of rows) {
      if (!mini.has(r.id)) {
        mini.add({
          id: r.id,
          content: String(r.content || ''),
          file_path: r.file_path,
          file_name: r.file_name,
          node_uid: r.node_uid || '',
          file_type: r.file_type || 'smm'
        })
      }
    }
  } catch (e) {
    console.error('[DB] MiniSearch 增量插入失败:', e)
  }
}

function miniRemoveFile(filePath) {
  try {
    if (!miniIndex || !miniLoaded) return
    miniIndex.removeAll(i => i.file_path === filePath)
  } catch (e) {
    console.error('[DB] MiniSearch 删除失败:', e)
  }
}

// BM25 检索：MiniSearch 打分排序；出错时降级 LIKE
function bm25Search(query, limit = 50) {
  ensureMiniLoaded()
  // 中文查询：用 bigram 查询分词 + AND 组合 + 关闭 fuzzy，避免单字/模糊匹配产生大量无关结果
  const hasHan = /[\u4e00-\u9fff]/.test(query)
  const mini = getMiniIndex()
  let opts = hasHan
    ? { tokenize: zhQueryTokenize, fuzzy: false, prefix: false, combineWith: 'AND', boost: { file_name: 2 } }
    : { fuzzy: 0.2, prefix: true, boost: { file_name: 2 } }
  let hits = mini.search(query, opts)
  // 中文 AND 无结果时降级 OR（长句/多词场景兜底，避免过度收紧导致空结果）
  if (hasHan && hits.length === 0) {
    opts = { tokenize: zhQueryTokenize, fuzzy: false, prefix: false, combineWith: 'OR', boost: { file_name: 2 } }
    hits = mini.search(query, opts)
  }
  const results = []
  for (const h of hits) {
    if (results.length >= limit) break
    const term = (h.terms && h.terms[0]) || query
    results.push({
      filePath: h.file_path,
      fileName: h.file_name,
      nodeUid: h.node_uid || '',
      fileType: h.file_type || 'smm',
      score: Math.round(h.score * 100) / 100,
      snippet: makeSnippet(String(h.content || '').slice(0, 200), term)
    })
  }
  return results
}

function keywordSearch(query, limit = 50) {
  const q = query.trim()
  if (!q) return []
  const pattern = `%${q}%`
  // 文件名命中优先，其次节点内容命中
  const fileNameRows = queryRows(
    `SELECT DISTINCT file_path, file_name FROM search_index WHERE file_name LIKE ? LIMIT 20`,
    [pattern]
  )
  const nameResults = fileNameRows.map(r => ({
    filePath: r.file_path,
    fileName: r.file_name,
    nodeUid: '',
    snippet: `<mark>${escapeHtml(q)}</mark>（文件名命中）`
  }))
  const contentRows = queryRows(
    `SELECT file_path, file_name, node_uid, content FROM search_index
     WHERE (content LIKE ? OR file_name LIKE ?)
     ORDER BY file_name, id
     LIMIT ?`,
    [pattern, pattern, limit]
  )
  const seen = new Set(nameResults.map(r => r.filePath))
  const contentResults = []
  for (const row of contentRows) {
    // 文件名命中的文件，内容命中不再重复显示文件级条目，但节点级仍显示
    const key = `${row.file_path}::${row.node_uid}`
    if (seen.has(key)) continue
    seen.add(key)
    contentResults.push({
      filePath: row.file_path,
      fileName: row.file_name,
      nodeUid: row.node_uid || '',
      snippet: makeSnippet(row.content || '', q)
    })
  }
  return [...nameResults, ...contentResults].slice(0, limit)
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function registerDatabaseHandlers() {
  ipcMain.handle('db:search', async (event, query) => {
    try {
      await initDatabase()
      if (!query || !query.trim()) return { results: [] }
      // BM25 优先（支持中文分词、模糊与相关度排序）；失败降级 LIKE 关键词
      try {
        return { results: bm25Search(String(query)) }
      } catch (e) {
        console.error('[DB] BM25 检索失败，降级 LIKE:', e)
        return { results: keywordSearch(query) }
      }
    } catch (e) {
      console.error('[DB] 搜索失败:', e)
      return { results: [], error: e.message }
    }
  })

  ipcMain.handle('db:indexFile', async (event, { filePath, fileName, treeData, mtime }) => {
    try {
      await initDatabase()

      db.run('DELETE FROM search_index WHERE file_path = ?', [filePath])
      db.run('DELETE FROM files WHERE file_path = ?', [filePath])
      miniRemoveFile(filePath)

      db.run('INSERT INTO files (file_path, file_name, file_type, mtime) VALUES (?, ?, ?, ?)', [filePath, fileName, 'smm', mtime || ''])

      const nodes = extractAllText(treeData)
      const insertStmt = db.prepare(
        'INSERT INTO search_index (content, file_path, file_name, node_uid, file_type) VALUES (?, ?, ?, ?, ?)'
      )
      const added = []
      for (const node of nodes) {
        insertStmt.run([node.text, filePath, fileName, node.uid, 'smm'])
        added.push({ id: getLastInsertId(), content: node.text, file_path: filePath, file_name: fileName, node_uid: node.uid, file_type: 'smm' })
      }
      insertStmt.free()
      miniAddRows(added)

      saveDatabase()
      return { success: true, indexed: nodes.length }
    } catch (e) {
      console.error('[DB] 索引文件失败:', e)
      return { success: false, error: e.message }
    }
  })

  // 文档索引：PDF/DOCX/XLSX/CSV/MD/TXT 等解析后的文本分块入库（file_type='doc'）
  ipcMain.handle('db:indexDocument', async (event, { filePath, fileName, fileType, mtime, chunks }) => {
    try {
      await initDatabase()
      if (!Array.isArray(chunks) || !chunks.length) return { success: false, error: '没有可索引的内容' }

      // 同文件且未修改则跳过重索引
      // 但如果 search_index 里没有该文件的索引条目（历史 bug：files 表被写过但 chunks 没写入），
      // 必须强制重新索引，否则永远无法入库
      if (mtime) {
        const prev = queryRows('SELECT mtime FROM files WHERE file_path = ?', [filePath])
        if (prev.length && prev[0].mtime === String(mtime)) {
          const chunkCount = (queryRows('SELECT COUNT(*) as c FROM search_index WHERE file_path = ?', [filePath])[0] || {}).c || 0
          if (chunkCount > 0) return { success: true, skipped: true, indexed: 0 }
          // files 存在但 search_index 为空 → 强制重新索引
        }
      }

      db.run('DELETE FROM search_index WHERE file_path = ?', [filePath])
      db.run('DELETE FROM files WHERE file_path = ?', [filePath])
      miniRemoveFile(filePath)

      db.run('INSERT INTO files (file_path, file_name, file_type, mtime) VALUES (?, ?, ?, ?)', [filePath, fileName, fileType || 'doc', mtime || ''])

      const insertStmt = db.prepare(
        'INSERT INTO search_index (content, file_path, file_name, node_uid, file_type) VALUES (?, ?, ?, ?, ?)'
      )
      const added = []
      for (const chunk of chunks) {
        const text = String(chunk || '').trim()
        if (!text) continue
        insertStmt.run([text, filePath, fileName, '', 'doc'])
        added.push({ id: getLastInsertId(), content: text, file_path: filePath, file_name: fileName, node_uid: '', file_type: 'doc' })
      }
      insertStmt.free()
      miniAddRows(added)

      saveDatabase()
      return { success: true, indexed: added.length }
    } catch (e) {
      console.error('[DB] 索引文档失败:', e)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('db:removeFile', async (event, { filePath }) => {
    try {
      await initDatabase()
      db.run('DELETE FROM search_index WHERE file_path = ?', [filePath])
      db.run('DELETE FROM files WHERE file_path = ?', [filePath])
      miniRemoveFile(filePath)
      saveDatabase()
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // 删除目录下所有文件的索引（递归子目录）
  ipcMain.handle('db:removeDir', async (event, { dirPath }) => {
    try {
      await initDatabase()
      if (!dirPath) return { success: false, error: '缺少目录路径' }
      const prefix = dirPath.replace(/\\/g, '/').replace(/\/+$/, '') + '/'
      // 用 LIKE 匹配前缀（Windows 下路径分隔符可能是 \\，所以两种都要考虑）
      const rows = queryRows("SELECT file_path FROM files WHERE file_path LIKE ? OR file_path LIKE ?", [
        prefix + '%',
        prefix.replace(/\//g, '\\') + '%'
      ])
      const removed = []
      for (const r of rows) {
        const fp = r.file_path
        db.run('DELETE FROM search_index WHERE file_path = ?', [fp])
        db.run('DELETE FROM files WHERE file_path = ?', [fp])
        miniRemoveFile(fp)
        removed.push(fp)
      }
      if (removed.length > 0) saveDatabase()
      return { success: true, removed: removed.length, files: removed }
    } catch (e) {
      return { success: false, error: e.message, removed: 0, files: [] }
    }
  })

  ipcMain.handle('db:getStats', async () => {
    try {
      await initDatabase()
      const files = queryRows('SELECT COUNT(*) as count FROM files')
      const entries = queryRows('SELECT COUNT(*) as count FROM search_index')
      const docs = queryRows("SELECT COUNT(*) as count FROM files WHERE file_type = 'doc'")
      return { files: files[0]?.count || 0, entries: entries[0]?.count || 0, documents: docs[0]?.count || 0 }
    } catch (e) {
      return { files: 0, entries: 0, error: e.message }
    }
  })

  ipcMain.handle('db:listFiles', async () => {
    try {
      await initDatabase()
      return queryRows('SELECT file_path, file_name, file_type, mtime, indexed_at FROM files ORDER BY indexed_at DESC')
    } catch (e) {
      return []
    }
  })

  // 获取某个文件的所有索引条目（用于向量重建）
  ipcMain.handle('db:getFileEntries', async (event, { filePath }) => {
    try {
      await initDatabase()
      const rows = queryRows(
        'SELECT content, node_uid, file_type FROM search_index WHERE file_path = ? ORDER BY rowid ASC',
        [filePath]
      )
      return { success: true, entries: rows }
    } catch (e) {
      return { success: false, error: e.message, entries: [] }
    }
  })
}

function getLastInsertId() {
  return (queryRows('SELECT last_insert_rowid() AS id')[0] || {}).id || 0
}

registerDatabaseHandlers()

module.exports = { flushDatabaseSync }
