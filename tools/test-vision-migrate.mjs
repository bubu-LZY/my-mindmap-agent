// 临时回归测试：验证 aiConfig.js migrateConfig 对各历史格式的迁移（运行后可删除）
import { readFileSync } from 'fs'

const src = readFileSync(new URL('../electron/ipc/aiConfig.js', import.meta.url), 'utf8')
const head = src.split('// 获取 AI 配置')[0]
  .replace("const { ipcMain } = require('electron')", '')
  .replace("const store = require('../utils/store')", '')
const mod = { exports: {} }
new Function('module', head + '\nmodule.exports = { migrateConfig }')(mod)
const { migrateConfig } = mod.exports

const cases = {
  empty: {},
  flat_old: { baseURL: 'https://api.a.com/v1', apiKey: 'sk-1', model: 'gpt-4o' },
  mid_old: {
    profiles: [{ id: 'p1', name: 'OpenAI', baseURL: 'https://api.a.com', apiKey: 'sk-1', model: 'gpt-4o' }],
    activeProfileId: 'p1',
    vision: { enabled: true, profileId: 'p1', model: 'gpt-4o-mini' }
  },
  flat_vision_old: {
    profiles: [{ id: 'p1', name: 'A', baseURL: 'https://a.com', apiKey: 'k', model: 'm1' }],
    activeProfileId: 'p1',
    vision: { enabled: true, baseURL: 'https://v.com', apiKey: 'vk', model: 'qwen-vl-max' }
  },
  new_format: {
    profiles: [
      { id: 'b1', name: '基础', baseURL: 'https://a.com', apiKey: 'k', model: 'm1', type: 'base' },
      { id: 'v1', name: '视觉', baseURL: 'https://v.com', apiKey: 'vk', model: 'qv', type: 'vision' }
    ],
    activeProfileId: 'b1',
    vision: { enabled: true, activeProfileId: 'v1' }
  },
  bad_ref: {
    profiles: [{ id: 'b1', name: 'B', baseURL: 'u', apiKey: 'k', model: 'm', type: 'base' }],
    activeProfileId: 'b1',
    vision: { enabled: true, activeProfileId: 'ghost' }
  }
}

let failed = 0
const assert = (cond, msg) => { if (!cond) { failed++; console.log('  FAIL: ' + msg) } }

for (const [name, input] of Object.entries(cases)) {
  const out = migrateConfig(JSON.parse(JSON.stringify(input)))
  const base = out.profiles.filter(p => p.type === 'base')
  const vis = out.profiles.filter(p => p.type === 'vision')
  console.log(`--- ${name}`)
  if (base.length > 0) assert(base.some(p => p.id === out.activeProfileId), 'activeProfileId 指向基础档')
  if (out.vision.activeProfileId) assert(vis.some(p => p.id === out.vision.activeProfileId), 'vision.activeProfileId 指向多模态档')
  for (const p of out.profiles) console.log(`  [${p.type}] ${p.name} | ${p.baseURL} | model=${p.model}`)
}

// flat_old：应得到 1 个基础档、无多模态档
let out = migrateConfig(cases.flat_old)
assert(out.profiles.length === 1 && out.profiles[0].type === 'base', 'flat_old -> 单基础档')
assert(!out.vision.activeProfileId, 'flat_old -> 无多模态档')

// mid_old：应复制基础档 URL/Key 生成多模态档，model 用 vision.model
out = migrateConfig(cases.mid_old)
const vp = out.profiles.find(p => p.id === out.vision.activeProfileId)
assert(vp && vp.type === 'vision', 'mid_old -> 生成多模态档')
assert(vp.baseURL === 'https://api.a.com' && vp.apiKey === 'sk-1', 'mid_old -> 复制引用档 URL/Key')
assert(vp.model === 'gpt-4o-mini', 'mid_old -> 模型用 vision.model')
assert(out.profiles.filter(p => p.type === 'base').length === 1, 'mid_old -> 基础档不变')

// flat_vision_old：独立三字段生成多模态档
out = migrateConfig(cases.flat_vision_old)
const vp2 = out.profiles.find(p => p.id === out.vision.activeProfileId)
assert(vp2 && vp2.baseURL === 'https://v.com' && vp2.model === 'qwen-vl-max', 'flat_vision_old -> 独立多模态档')

// new_format：原样保留
out = migrateConfig(cases.new_format)
assert(out.activeProfileId === 'b1' && out.vision.activeProfileId === 'v1', 'new_format -> 引用保留')

// bad_ref：vision.activeProfileId 失效但存在多模态档时兜底指向第一个
out = migrateConfig(cases.bad_ref)
assert(!out.vision.activeProfileId, 'bad_ref -> 无效引用清空（无多模态档可兜底）')

console.log(failed === 0 ? 'ALL_PASS' : `FAILED: ${failed}`)
