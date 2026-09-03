#!/usr/bin/env node
/**
 * 修复 clonePlainTree 历史 bug 导致的 .smm 数据损坏。
 *
 * 背景：src/utils/treeUtils.js 的 clonePlainTree 曾把节点 data 里的数组字段
 * （generalization 概要 / associativeLineTargets 关联线目标 / icon 图标 / tag 标签）
 * 错误地按树节点 { data, children } 结构克隆，产出 { data: {} } 空壳：
 *   - 概要丢失文本 → 画布上显示 "undefined"、双击编辑为空
 *   - 关联线目标丢失 → 关联线消失
 *
 * 本脚本扫描 .smm 文件，找出这类空壳，并尝试从同目录（或父目录）的
 * .smm_versions/<文件名>/ 版本快照里按「节点 uid + 字段 + 下标」找回原始值。
 * 备份里同样是空壳的会继续往更早的备份找；全部找不到的标记为「已永久丢失」，
 * 在 --apply 模式下会把空壳移除（概要直接消失、关联线目标置空），避免继续渲染 undefined。
 *
 * 用法：
 *   node tools/repair-array-fields.mjs                 # 默认扫描 C:\我的mindmap，只报告不改写
 *   node tools/repair-array-fields.mjs "D:\其他目录"   # 指定扫描根目录
 *   node tools/repair-array-fields.mjs --apply         # 实际写回（写前自动留 .bak）
 */

import fs from 'fs'
import path from 'path'

// 这些字段在 simple-mind-map 里必须是数组；若变成「带 data 键的普通对象」即为被污染的空壳
const ARRAY_FIELDS = ['generalization', 'associativeLineTargets', 'icon', 'tag']

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const ROOT = args.find(a => !a.startsWith('--')) || 'C:\\我的mindmap'

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** 判断某个值是不是被 clonePlainTree 污染出的空壳 */
function isCorrupted(value) {
  if (!isPlainObject(value)) return false
  if (!('data' in value)) return false
  // 合法的 generalization 单条概要也可能以对象形式保存，但它一定带 text / range / image / icon
  if ('text' in value || 'range' in value || 'image' in value || 'icon' in value) return false
  return true
}

/** 该字段的一个候选值是否“健康可用”（备份里同样可能是空壳，必须逐个校验） */
function isHealthy(field, value) {
  if (value === undefined || value === null) return false
  if (isCorrupted(value)) return false
  if (field === 'generalization') {
    if (!Array.isArray(value)) return false
    return value.some(
      it =>
        isPlainObject(it) &&
        ((typeof it.text === 'string' && it.text.trim() !== '' && it.text !== 'undefined') ||
          (it.range !== undefined && it.range !== null))
    )
  }
  return Array.isArray(value) && value.length > 0
}

/** 收集所有 { 节点uid: { 字段: 值 } }，用于从备份里找回原始值 */
function collectByUid(node, map = new Map()) {
  if (!isPlainObject(node)) return map
  const data = isPlainObject(node.data) ? node.data : {}
  const uid = data.uid
  if (uid) {
    const bag = {}
    for (const f of ARRAY_FIELDS) {
      const v = data[f]
      if (Array.isArray(v) || isPlainObject(v)) bag[f] = v
    }
    if (Object.keys(bag).length) map.set(uid, bag)
  }
  for (const c of Array.isArray(node.children) ? node.children : []) collectByUid(c, map)
  return map
}

/** 找出文件中所有损坏项 */
function findCorrupted(node, out = []) {
  if (!isPlainObject(node)) return out
  const data = isPlainObject(node.data) ? node.data : {}
  for (const f of ARRAY_FIELDS) {
    const v = data[f]
    if (isCorrupted(v)) {
      out.push({ node, field: f, index: -1 })
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (isCorrupted(item)) out.push({ node, field: f, index: i })
      })
    }
  }
  for (const c of Array.isArray(node.children) ? node.children : []) findCorrupted(c, out)
  return out
}

/** 从备份池（新→旧）里按 uid + 字段 + 下标 找回第一个健康的值 */
function recover(uid, field, index, pool) {
  for (const map of pool) {
    const bag = map.get(uid)
    if (!bag) continue
    const v = bag[field]
    if (!Array.isArray(v)) continue
    if (index < 0) {
      if (isHealthy(field, v)) return { value: v, whole: true }
      continue
    }
    const hit = v[index]
    if (hit !== undefined && hit !== null && !isCorrupted(hit)) {
      // 对 generalization 还要确认该项真的带文本/区间，而不是另一个残缺项
      if (field !== 'generalization' || (isPlainObject(hit) &&
          ((typeof hit.text === 'string' && hit.text.trim() !== '' && hit.text !== 'undefined') ||
            (hit.range !== undefined && hit.range !== null)))) {
        return { value: hit, whole: false }
      }
    }
  }
  return null
}

function listSmmFiles(dir) {
  const out = []
  const walk = d => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue // 跳过 .smm_versions / .obsidian 等
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.smm$/i.test(e.name)) out.push(p)
    }
  }
  walk(dir)
  return out
}

function versionDirsFor(smmPath) {
  const dirs = []
  const self = path.join(path.dirname(smmPath), '.smm_versions', path.basename(smmPath))
  const parent = path.join(path.dirname(path.dirname(smmPath)), '.smm_versions', path.basename(smmPath))
  for (const d of [self, parent]) {
    if (fs.existsSync(d) && fs.statSync(d).isDirectory()) dirs.push(d)
  }
  return dirs
}

/** 备份池：按时间从新到旧 */
function loadBackupPool(smmPath) {
  const pool = []
  for (const vd of versionDirsFor(smmPath)) {
    let files = []
    try { files = fs.readdirSync(vd).filter(f => /\.bak$/i.test(f)).sort().reverse() } catch { continue }
    for (const f of files) {
      try {
        const json = JSON.parse(fs.readFileSync(path.join(vd, f), 'utf8'))
        pool.push(collectByUid(json))
      } catch { /* 坏备份跳过 */ }
    }
  }
  return pool
}

const strip = s => String(s || '').replace(/<[^>]+>/g, '').trim()
const brief = v => {
  if (Array.isArray(v)) {
    return v.map(x => (isPlainObject(x) ? strip(x.text) || '[概要]' : String(x))).join(' | ').slice(0, 70)
  }
  return JSON.stringify(v).slice(0, 70)
}

// ---------- 主流程 ----------
console.log(`扫描目录：${ROOT}${APPLY ? '  【写回模式】' : '  【只读体检，加 --apply 才会改写文件】'}\n`)

const files = listSmmFiles(ROOT)
let totalCorrupt = 0
let totalFixed = 0
let totalLost = 0
const fileReports = []

for (const file of files) {
  let root
  try {
    root = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    console.log(`[跳过] ${file} 解析失败：${e.message}`)
    continue
  }
  const bad = findCorrupted(root)
  if (!bad.length) continue

  const pool = loadBackupPool(file)
  const lines = []
  const actions = [] // { node, field, index, value | null }
  let fixed = 0
  let lost = 0

  for (const item of bad) {
    const { node, field, index } = item
    const uid = (node.data && node.data.uid) || ''
    const nodeText = strip(node.data && node.data.text).slice(0, 24) || '(空节点)'
    const got = recover(uid, field, index, pool)
    if (got) {
      actions.push({ node, field, index, value: got.value, whole: got.whole })
      fixed++
      lines.push(`  ✔ 可恢复 ${field}  节点「${nodeText}」→ ${brief(got.value)}`)
    } else {
      actions.push({ node, field, index, value: null })
      lost++
      lines.push(`  ✘ 已永久丢失 ${field}（所有版本快照里都是空壳）  节点「${nodeText}」`)
    }
  }

  totalCorrupt += bad.length
  totalFixed += fixed
  totalLost += lost

  // 应用修复：同一数组内多项时从后往前改，避免下标错位
  if (APPLY) {
    const byKey = new Map()
    for (const a of actions) {
      const k = a.node
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(a)
    }
    for (const [, list] of byKey) {
      list.sort((a, b) => b.index - a.index)
      for (const a of list) {
        const data = a.node.data
        if (a.value !== null) {
          if (a.index < 0) data[a.field] = a.value
          else if (Array.isArray(data[a.field])) data[a.field][a.index] = a.value
          else data[a.field] = [a.value]
        } else {
          // 找不回：移除空壳，避免继续渲染成 undefined
          if (a.index < 0) {
            delete data[a.field]
          } else if (Array.isArray(data[a.field])) {
            data[a.field].splice(a.index, 1)
            if (data[a.field].length === 0) delete data[a.field]
          }
        }
      }
    }
    const backup = `${file}.repair-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.bak`
    try {
      fs.copyFileSync(file, backup)
      fs.writeFileSync(file, JSON.stringify(root, null, 2), 'utf8')
      lines.push(`  → 已写回，原文件备份为 ${path.basename(backup)}`)
    } catch (e) {
      lines.push(`  → 写回失败：${e.message}`)
    }
  }

  fileReports.push({ file, lines, fixed, lost, bad: bad.length })
}

for (const r of fileReports) {
  console.log(`【${r.file}】损坏 ${r.bad} 项 → 可恢复 ${r.fixed} / 已丢失 ${r.lost}`)
  r.lines.forEach(l => console.log(l))
  console.log('')
}

console.log('———— 汇总 ————')
console.log(`共扫描 ${files.length} 个 .smm 文件`)
console.log(`发现损坏字段 ${totalCorrupt} 项：可恢复 ${totalFixed} 项，已永久丢失 ${totalLost} 项`)
if (!APPLY) {
  console.log(`\n这是只读体检，未修改任何文件。确认无误后加 --apply 执行修复：`)
  console.log(`  node tools/repair-array-fields.mjs "${ROOT}" --apply`)
  if (totalLost > 0) {
    console.log(`\n注意：--apply 会把无法恢复的空壳直接移除（概要节点消失 / 关联线目标清空），`)
    console.log(`      以便画布不再显示 undefined。这些内容的原文在现有快照里已找不回来。`)
  }
}
