'use strict'
// 探测旧版本 mindmap-mubu 的 localStorage 键名与值格式
const fs = require('fs')
const path = require('path')
const { uncompress } = require('snappyjs')
const { readLocalStorageFromDir } = require('../electron/utils/legacyLevelDb')

const dir = path.join(process.env.APPDATA, 'mindmap-mubu', 'Local Storage', 'leveldb')
if (!fs.existsSync(dir)) {
  console.log('旧 leveldb 目录不存在:', dir)
  process.exit(0)
}
try {
  const { currentMapId, items } = readLocalStorageFromDir(dir, fs, path, (data) => uncompress(data))
  console.log(`共 ${items.length} 条 localStorage 数据，当前 mapId = ${currentMapId}`)
  for (const it of items) {
    const preview = it.value.length > 100 ? it.value.slice(0, 100) + '…' : it.value
    console.log(`${it.name} (mapId=${it.mapId}) = ${JSON.stringify(preview)}`)
  }
} catch (e) {
  console.error('解析失败:', e.message)
  process.exit(1)
}
