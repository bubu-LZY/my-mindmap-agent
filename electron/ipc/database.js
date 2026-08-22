const { ipcMain, app } = require('electron')
const fs = require('fs')
const path = require('path')

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
  // 清理历史遗留的 FTS5 虚拟表（建表失败时可能存在残留）
  try {
    db.run('DROP TABLE IF EXISTS search_index')
  } catch (e) {
    // 旧虚拟表无法 DROP 时忽略
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT UNIQUE NOT NULL,
      file_name TEXT NOT NULL,
      indexed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS search_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT,
      file_path TEXT,
      file_name TEXT,
      node_uid TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_search_content ON search_index(content);
    CREATE INDEX IF NOT EXISTS idx_search_file ON search_index(file_path);
  `)

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
      return { results: keywordSearch(query) }
    } catch (e) {
      console.error('[DB] 搜索失败:', e)
      return { results: [], error: e.message }
    }
  })

  ipcMain.handle('db:indexFile', async (event, { filePath, fileName, treeData }) => {
    try {
      await initDatabase()

      db.run('DELETE FROM search_index WHERE file_path = ?', [filePath])
      db.run('DELETE FROM files WHERE file_path = ?', [filePath])

      db.run('INSERT INTO files (file_path, file_name) VALUES (?, ?)', [filePath, fileName])

      const nodes = extractAllText(treeData)
      const insertStmt = db.prepare(
        'INSERT INTO search_index (content, file_path, file_name, node_uid) VALUES (?, ?, ?, ?)'
      )

      for (const node of nodes) {
        insertStmt.run([node.text, filePath, fileName, node.uid])
      }
      insertStmt.free()

      saveDatabase()
      return { success: true, indexed: nodes.length }
    } catch (e) {
      console.error('[DB] 索引文件失败:', e)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('db:removeFile', async (event, { filePath }) => {
    try {
      await initDatabase()
      db.run('DELETE FROM search_index WHERE file_path = ?', [filePath])
      db.run('DELETE FROM files WHERE file_path = ?', [filePath])
      saveDatabase()
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('db:getStats', async () => {
    try {
      await initDatabase()
      const files = queryRows('SELECT COUNT(*) as count FROM files')
      const entries = queryRows('SELECT COUNT(*) as count FROM search_index')
      return { files: files[0]?.count || 0, entries: entries[0]?.count || 0 }
    } catch (e) {
      return { files: 0, entries: 0, error: e.message }
    }
  })

  ipcMain.handle('db:listFiles', async () => {
    try {
      await initDatabase()
      return queryRows('SELECT file_path, file_name, indexed_at FROM files ORDER BY indexed_at DESC')
    } catch (e) {
      return []
    }
  })
}

registerDatabaseHandlers()

module.exports = { flushDatabaseSync }
