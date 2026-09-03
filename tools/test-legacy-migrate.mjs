// 临时验证：用真实旧数据跑渲染进程迁移逻辑（mock localStorage/electronAPI）
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { uncompress } = require('snappyjs')
const { readLocalStorageFromDir } = require('../electron/utils/legacyLevelDb')

const dir = path.join(process.env.APPDATA, 'mindmap-mubu', 'Local Storage', 'leveldb')
const { items } = readLocalStorageFromDir(dir, fs, path, (d) => uncompress(d))

// 模拟新版已有部分数据（测试合并路径）
const store = new Map([
  ['mindmap_ai_longterm_memory', JSON.stringify([{ id: 'f1', content: '已有记忆', type: 'preference', source: 'ai', createdAt: '2026-08-01' }])],
  ['mindmap_ai_conversations', JSON.stringify([{ id: 'conv_new', title: '新版对话', messages: [{ id: 'm1', role: 'user', content: 'hi' }], createdAt: 1, updatedAt: 2 }])],
  ['mindmap_ai_current_conversation', 'conv_new']
])
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
}
globalThis.window = { electronAPI: { legacyStorageRead: async () => ({ found: true, items }) } }

const { runLegacyMigration } = await import('../src/utils/legacyMigrate.js')
await runLegacyMigration()

console.log('=== mindmap_ai_longterm_memory ===')
const mem = JSON.parse(store.get('mindmap_ai_longterm_memory'))
console.log(`共 ${mem.length} 条`)
for (const m of mem) console.log(` - [${m.source}/${m.type}] ${m.content.slice(0, 50)}`)
console.log('\n=== mindmap_ai_conversations ===')
const convs = JSON.parse(store.get('mindmap_ai_conversations'))
console.log(`共 ${convs.length} 个对话`)
for (const c of convs) console.log(` - ${c.id} "${c.title.slice(0, 30)}" 消息数=${c.messages.length} createdAt=${c.createdAt}`)
console.log('\n=== 直迁键 ===')
for (const k of ['MINDMAP_FOLDER_ROOTS', 'smm_cloze_versions', 'SIMPLE_MIND_MAP_CLOZE_STATE', 'mindmap_legacy_migrated']) {
  console.log(` - ${k}: ${store.has(k) ? (store.get(k).slice(0, 60)) : '(未写入)'}`)
}
