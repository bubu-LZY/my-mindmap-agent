'use strict'

/**
 * 旧版本数据迁移 IPC。
 * 旧版应用（mindmap-mubu）更新为新版（mind-map-ai-agent）后 userData 目录变更，
 * localStorage（leveldb）随之不可见，导致 AI 长期记忆/对话历史/文件根目录等丢失。
 * 这里只读解析旧目录 leveldb，把键值返回给渲染进程，由渲染进程做键名映射与合并。
 */
const { ipcMain, app } = require('electron')
const path = require('path')
const fs = require('fs')
const { readLocalStorageFromDir } = require('../utils/legacyLevelDb')

const LEGACY_APP_DIR = 'mindmap-mubu'

function readLegacyStorage() {
  try {
    const legacyDir = path.join(app.getPath('appData'), LEGACY_APP_DIR)
    const ldbDir = path.join(legacyDir, 'Local Storage', 'leveldb')
    if (!fs.existsSync(ldbDir)) return { found: false, items: [] }
    let snappy = null
    try { snappy = require('snappyjs').uncompress } catch { snappy = null }
    const { items } = readLocalStorageFromDir(ldbDir, fs, path, snappy)
    return { found: true, items }
  } catch (e) {
    console.warn('读取旧版数据失败:', e.message)
    return { found: false, error: e.message, items: [] }
  }
}

function registerLegacyMigrateIPC() {
  ipcMain.handle('legacy-storage-read', () => readLegacyStorage())
}

module.exports = { registerLegacyMigrateIPC, readLegacyStorage }
