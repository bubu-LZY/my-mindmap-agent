#!/usr/bin/env node
/**
 * 复习计划「双向删除」的回归测试（纯 node 运行：npm run test:review-plan）
 *
 * 锁定的是桌面日历把「用户在日历里删掉了这条复习任务」回传给思维导图后的行为：
 *   - 按「日期 + 去前缀标题」精确删掉对应的复习周期；
 *   - 删掉的周期不能在下一次读取时被「按 5 个标准周期补齐」的迁移逻辑复活（记进 skippedCycles）；
 *   - 周期全删完时整条复习项一并移除，不留空壳；
 *   - 日期对不上时什么都不做（不能误删别的周期）；
 *   - 同一个节点重新加入复习计划时，拿到的是全新的 5 个周期（不受历史删除影响）。
 *
 * reviewPlan.js 是给渲染进程用的 ESM + 浏览器 API，这里先打成一个临时 CJS 再 require，
 * 并给 localStorage / window / DOMParser 打上最小桩（只需要支撑纯文本提取与事件广播）。
 */
const path = require('path')
const fs = require('fs')
const os = require('os')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..')

// ------------------------------------------------- 浏览器环境桩

const memory = new Map()
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => { memory.set(key, String(value)) },
  removeItem: (key) => { memory.delete(key) },
  clear: () => memory.clear()
}

const dispatched = []
globalThis.window = {
  dispatchEvent: (event) => { dispatched.push(event); return true },
  addEventListener: () => {},
  removeEventListener: () => {}
}
globalThis.CustomEvent = class CustomEvent {
  constructor (type, init) {
    this.type = type
    this.detail = init && init.detail
  }
}
globalThis.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  visibilityState: 'visible'
}
// 只用于 stripHtmlTags 的纯文本提取：去掉标签即可
globalThis.DOMParser = class DOMParser {
  parseFromString (html) {
    return { body: { textContent: String(html).replace(/<[^>]*>/g, '') } }
  }
}

// ------------------------------------------------- 加载被测模块

async function loadReviewPlan () {
  const esbuild = require('esbuild')
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/utils/reviewPlan.js')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent'
  })
  const bundlePath = path.join(os.tmpdir(), `review-plan-test-${process.pid}-${Date.now()}.cjs`)
  fs.writeFileSync(bundlePath, result.outputFiles[0].text, 'utf8')
  try {
    return require(bundlePath)
  } finally {
    try { fs.unlinkSync(bundlePath) } catch { /* 临时文件回收失败不影响结论 */ }
  }
}

// ------------------------------------------------- 断言脚手架

let pass = 0
let fail = 0
const failures = []

function check (label, fn) {
  try {
    fn()
    pass++
  } catch (e) {
    fail++
    failures.push(label + '\n      ' + e.message)
  }
}

function eq (actual, expected, label) {
  check(label, () => assert.deepStrictEqual(actual, expected))
}

function ok (value, label) {
  check(label, () => assert.ok(value))
}

// ------------------------------------------------- 用例

async function main () {
  const rp = await loadReviewPlan()
  const { addToReviewPlan, getReviewPlan, removeCyclesByDateAndTitle } = rp

  const seed = () => {
    memory.clear()
    dispatched.length = 0
    return addToReviewPlan({ nodeText: '三角函数', fileName: '数学.smm' })
  }

  // ===== 新建：5 个标准周期 =====
  {
    const item = seed()
    eq(getReviewPlan().length, 1, '新增后计划里有 1 条')
    eq(item.cycles.length, 5, '新增带 5 个标准周期')
    eq(item.cycles.map(c => c.label), ['1天', '3天', '7天', '15天', '31天'], '周期标签顺序固定')
  }

  // ===== 删除单个周期：立刻生效，且下一轮读取不会复活 =====
  {
    const item = seed()
    const target = item.cycles[1]
    eq(removeCyclesByDateAndTitle(target.reviewDate, '[MM复习]三角函数'), 1, '按带前缀标题能删掉 1 个周期')

    const stored = getReviewPlan()[0]
    eq(stored.cycles.length, 4, '删掉后剩 4 个周期')
    eq(stored.cycles.some(c => c.cycle === target.cycle), false, '被删的周期不再出现')
    eq(stored.skippedCycles, [target.cycle], '被删的周期号记进 skippedCycles')
    eq(getReviewPlan()[0].cycles.length, 4, '再读一次仍然是 4 个（迁移逻辑没有补齐回来）')
    ok(dispatched.some(e => e.type === 'review-plan-changed'), '广播了复习计划变更事件')
    eq(dispatched[dispatched.length - 1].detail, { type: 'remote' }, '事件标为 remote，避免反向再推一次')
  }

  // ===== 标题前缀：新版 [MM复习] / 旧版 [复习] / 无前缀都能命中 =====
  {
    for (const title of ['[MM复习]三角函数', '[复习]三角函数', '三角函数']) {
      const item = seed()
      const target = item.cycles[0]
      eq(removeCyclesByDateAndTitle(target.reviewDate, title), 1, `标题 ${title} 能命中`)
      eq(getReviewPlan()[0].cycles.length, 4, `标题 ${title} 删除后剩 4 个周期`)
    }
  }

  // ===== 连删多个：skippedCycles 累积 =====
  {
    const item = seed()
    const [first, second] = item.cycles
    removeCyclesByDateAndTitle(first.reviewDate, '[MM复习]三角函数')
    removeCyclesByDateAndTitle(second.reviewDate, '[MM复习]三角函数')

    const stored = getReviewPlan()[0]
    eq(stored.cycles.length, 3, '连删两个后剩 3 个周期')
    eq(stored.skippedCycles, [first.cycle, second.cycle], 'skippedCycles 按周期号累积排序')
  }

  // ===== 日期对不上 / 标题对不上：什么都不做 =====
  {
    const item = seed()
    eq(removeCyclesByDateAndTitle('1970-01-01', '[MM复习]三角函数'), 0, '日期对不上返回 0')
    eq(removeCyclesByDateAndTitle(item.cycles[0].reviewDate, '[MM复习]立体几何'), 0, '标题对不上返回 0')
    eq(removeCyclesByDateAndTitle('', '[MM复习]三角函数'), 0, '日期为空返回 0')
    eq(removeCyclesByDateAndTitle(item.cycles[0].reviewDate, ''), 0, '标题为空返回 0')

    const stored = getReviewPlan()[0]
    eq(stored.cycles.length, 5, '没命中时周期一个都不少')
    eq(stored.skippedCycles, undefined, '没命中时不会留下 skippedCycles')
  }

  // ===== 同一天多条不同复习项：只删匹配的那一条 =====
  {
    memory.clear()
    const a = addToReviewPlan({ nodeText: '三角函数', fileName: '数学.smm' })
    const b = addToReviewPlan({ nodeText: '立体几何', fileName: '数学.smm' })

    eq(removeCyclesByDateAndTitle(a.cycles[0].reviewDate, '[MM复习]三角函数'), 1, '只删匹配标题的那一条')

    const list = getReviewPlan()
    eq(list.length, 2, '两条复习项都还在（各自都还剩周期）')
    const kept = list.find(i => i.nodeText === '立体几何')
    eq(kept.cycles.length, 5, '另一条复习项的周期没被动过')
    eq(b.cycles.length, 5, '另一条复习项仍完整')
  }

  // ===== 全部周期删完：整条复习项移除（不留空壳）=====
  {
    const item = seed()
    let removed = 0
    for (const cycle of item.cycles) {
      removed += removeCyclesByDateAndTitle(cycle.reviewDate, '[MM复习]三角函数')
    }

    eq(removed, 5, '5 个周期逐个删完')
    eq(getReviewPlan().length, 0, '周期删完后整条复习项被移除')
  }

  // ===== 重新加入同一节点：全新的 5 个周期，不受历史删除影响 =====
  {
    const item = seed()
    removeCyclesByDateAndTitle(item.cycles[0].reviewDate, '[MM复习]三角函数')
    eq(getReviewPlan()[0].cycles.length, 4, '先删掉 1 个周期')

    const again = addToReviewPlan({ nodeText: '三角函数', fileName: '数学.smm' })
    eq(again.cycles.length, 5, '重新加入拿到全新的 5 个周期')
    eq(getReviewPlan().length, 2, '与旧记录并存（是否合并由上层决定）')
    eq(getReviewPlan().find(i => i.id === again.id).skippedCycles, undefined, '新记录不带历史 skippedCycles')
  }

  // ------------------------------------------------- 结果
  if (fail === 0) {
    console.log(`复习计划双向删除测试通过（${pass} 项）`)
    return
  }

  console.error(`复习计划双向删除测试失败：${fail} 项失败 / 共 ${pass + fail} 项`)
  for (const message of failures) {
    console.error('  ✗ ' + message)
  }
  process.exitCode = 1
}

main().catch((e) => {
  console.error('测试运行失败：', e && e.stack ? e.stack : e)
  process.exitCode = 1
})
