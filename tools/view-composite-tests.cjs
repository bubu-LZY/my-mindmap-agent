#!/usr/bin/env node
/**
 * 原生子视图合成的回归测试（零依赖，纯 node 运行：npm run test:composite）
 *
 * 锁定的是「局域网镜像里 DeepSeek 网页版一片空白」这个问题的修复：
 * 主窗口截图必须把挂在窗口上的 BrowserView 叠进去。这里覆盖坐标换算、
 * 窗口外裁剪、行跨距与越界防护 —— 全是纯函数，不需要真的起 Electron。
 */
const path = require('path')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..')
const {
  resolvePhysicalSize,
  computePlacement,
  compositeBitmaps,
  pickTopmostIndexAtPoint
} = require(path.join(ROOT, 'electron/utils/viewComposite.js'))

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

// BGRA 每像素 4 字节
function solid (width, height, b, g, r, a) {
  const buf = Buffer.alloc(width * height * 4)
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = b
    buf[i + 1] = g
    buf[i + 2] = r
    buf[i + 3] = a === undefined ? 255 : a
  }
  return buf
}

function pixelAt (buf, width, x, y) {
  const o = (y * width + x) * 4
  return [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]
}

// ------------------------------------------------- 物理尺寸反推

function testResolvePhysicalSize () {
  eq(resolvePhysicalSize(800 * 600 * 4, 800, 600), { width: 800, height: 600 }, '1x：逻辑尺寸即物理尺寸')
  eq(resolvePhysicalSize(1600 * 1200 * 4, 800, 600), { width: 1600, height: 1200 }, '2x：能反推出翻倍后的物理尺寸')
  eq(resolvePhysicalSize(1000 * 750 * 4, 800, 600), { width: 1000, height: 750 }, '1.25x：非整数缩放比也能反推')
  eq(resolvePhysicalSize(1920 * 1080 * 4, 1920, 1080), { width: 1920, height: 1080 }, '宽屏比例')

  eq(resolvePhysicalSize(0, 800, 600), null, '空缓冲区返回 null')
  eq(resolvePhysicalSize(800 * 600 * 4, 0, 600), null, '逻辑宽为 0 返回 null')
  eq(resolvePhysicalSize(999 * 4, 800, 600), null, '宽高比对不上时返回 null（宁可放弃合成也不画错位）')
}

// ------------------------------------------------- 坐标换算与裁剪

function testComputePlacement () {
  // 2x 屏：内容区 800x600 DIP，截图为 1600x1200 物理像素
  const base = { baseSize: { width: 1600, height: 1200 }, contentSize: { width: 800, height: 600 } }

  eq(
    computePlacement({ ...base, viewBounds: { x: 400, y: 300, width: 200, height: 150 }, sourceSize: { width: 400, height: 300 } }),
    { target: { x: 800, y: 600, width: 400, height: 300 }, clip: { x: 800, y: 600, width: 400, height: 300 } },
    '2x 屏：DIP 位置翻倍成物理像素，完整可见时不裁剪'
  )

  eq(
    computePlacement({ ...base, viewBounds: { x: 700, y: 550, width: 200, height: 150 }, sourceSize: { width: 400, height: 300 } }),
    { target: { x: 1400, y: 1100, width: 400, height: 300 }, clip: { x: 1400, y: 1100, width: 200, height: 100 } },
    '超出右下角：裁剪到窗口内'
  )

  eq(
    computePlacement({ ...base, viewBounds: { x: -40, y: -20, width: 200, height: 150 }, sourceSize: { width: 400, height: 300 } }),
    { target: { x: -80, y: -40, width: 400, height: 300 }, clip: { x: 0, y: 0, width: 320, height: 260 } },
    '超出左上角：负坐标时裁剪出可见部分'
  )

  eq(
    computePlacement({ ...base, viewBounds: { x: 900, y: 100, width: 200, height: 150 }, sourceSize: { width: 400, height: 300 } }),
    null,
    '完全在窗口右侧之外：返回 null'
  )

  eq(
    computePlacement({ ...base, viewBounds: { x: 100, y: 100, width: 0, height: 150 }, sourceSize: { width: 400, height: 300 } }),
    null,
    '子视图尺寸为 0：返回 null'
  )

  eq(
    computePlacement({ baseSize: { width: 1600, height: 1200 }, contentSize: { width: 0, height: 600 }, viewBounds: { x: 0, y: 0, width: 10, height: 10 }, sourceSize: { width: 10, height: 10 } }),
    null,
    '内容区尺寸为 0：返回 null（避免除零）'
  )

  eq(
    computePlacement({ baseSize: { width: 800, height: 600 }, contentSize: { width: 800, height: 600 }, viewBounds: { x: 100, y: 50, width: 200, height: 150 }, sourceSize: { width: 200, height: 150 } }),
    { target: { x: 100, y: 50, width: 200, height: 150 }, clip: { x: 100, y: 50, width: 200, height: 150 } },
    '1x 屏：不放大也不缩小'
  )
}

// ------------------------------------------------- 像素叠加

function testCompositeBitmaps () {
  check('整块覆盖：目标区域被完全替换', () => {
    const dst = solid(2, 2, 0, 0, 0)
    const red = solid(2, 2, 0, 0, 255)
    compositeBitmaps(dst, { width: 2, height: 2 }, [{ target: { x: 0, y: 0, width: 2, height: 2 }, clip: { x: 0, y: 0, width: 2, height: 2 }, bitmap: red }])
    assert.deepStrictEqual(pixelAt(dst, 2, 1, 1), [0, 0, 255, 255])
  })

  check('局部覆盖：只写自己的区域，其余像素不受影响', () => {
    const dst = solid(4, 4, 0, 0, 0)
    const green = solid(2, 2, 0, 255, 0)
    compositeBitmaps(dst, { width: 4, height: 4 }, [{ target: { x: 2, y: 1, width: 2, height: 2 }, clip: { x: 2, y: 1, width: 2, height: 2 }, bitmap: green }])
    assert.deepStrictEqual(pixelAt(dst, 4, 2, 1), [0, 255, 0, 255], '覆盖区左上角应为绿色')
    assert.deepStrictEqual(pixelAt(dst, 4, 3, 2), [0, 255, 0, 255], '覆盖区右下角应为绿色')
    assert.deepStrictEqual(pixelAt(dst, 4, 1, 1), [0, 0, 0, 255], '覆盖区左侧的像素应保持原样')
    assert.deepStrictEqual(pixelAt(dst, 4, 2, 3), [0, 0, 0, 255], '覆盖区下方的像素应保持原样')
  })

  check('左/上越界时按源位图正确列偏移取值（不能整行错位）', () => {
    // 源 2x2：左列蓝、右列红；target.x = -1 → 只画右列
    const dst = solid(2, 2, 0, 0, 0)
    const src = Buffer.alloc(2 * 2 * 4)
    for (let y = 0; y < 2; y++) {
      src[(y * 2 + 0) * 4 + 0] = 255 // 蓝
      src[(y * 2 + 0) * 4 + 1] = 0
      src[(y * 2 + 0) * 4 + 2] = 0
      src[(y * 2 + 0) * 4 + 3] = 255
      src[(y * 2 + 1) * 4 + 0] = 0
      src[(y * 2 + 1) * 4 + 1] = 0
      src[(y * 2 + 1) * 4 + 2] = 255 // 红
      src[(y * 2 + 1) * 4 + 3] = 255
    }
    compositeBitmaps(dst, { width: 2, height: 2 }, [{ target: { x: -1, y: 0, width: 2, height: 2 }, clip: { x: 0, y: 0, width: 1, height: 2 }, bitmap: src }])
    assert.deepStrictEqual(pixelAt(dst, 2, 0, 0), [0, 0, 255, 255], '第 0 行应取源的红色列')
    assert.deepStrictEqual(pixelAt(dst, 2, 0, 1), [0, 0, 255, 255], '第 1 行应取源的红色列')
    assert.deepStrictEqual(pixelAt(dst, 2, 1, 0), [0, 0, 0, 255], '未覆盖的右侧保持原样')
  })

  check('宽高不等（行跨距 != 宽度）时按行正确推进', () => {
    const dst = solid(4, 2, 0, 0, 0)
    const src = solid(2, 1, 0, 0, 255) // 2x1 红
    compositeBitmaps(dst, { width: 4, height: 2 }, [{ target: { x: 1, y: 1, width: 2, height: 1 }, clip: { x: 1, y: 1, width: 2, height: 1 }, bitmap: src }])
    assert.deepStrictEqual(pixelAt(dst, 4, 1, 1), [0, 0, 255, 255])
    assert.deepStrictEqual(pixelAt(dst, 4, 2, 1), [0, 0, 255, 255])
    assert.deepStrictEqual(pixelAt(dst, 4, 0, 1), [0, 0, 0, 255])
    assert.deepStrictEqual(pixelAt(dst, 4, 1, 0), [0, 0, 0, 255])
  })

  check('源位图长度不足时跳过该层，不改动画面', () => {
    const dst = solid(2, 2, 0, 0, 0)
    const short = Buffer.alloc(4)
    compositeBitmaps(dst, { width: 2, height: 2 }, [{ target: { x: 0, y: 0, width: 2, height: 2 }, clip: { x: 0, y: 0, width: 2, height: 2 }, bitmap: short }])
    assert.deepStrictEqual(pixelAt(dst, 2, 0, 0), [0, 0, 0, 255])
  })

  check('空层列表 / 空参数是安全的', () => {
    const dst = solid(2, 2, 0, 0, 0)
    assert.strictEqual(compositeBitmaps(dst, { width: 2, height: 2 }, []), dst)
    assert.strictEqual(compositeBitmaps(dst, { width: 2, height: 2 }, null), dst)
    assert.strictEqual(compositeBitmaps(null, { width: 2, height: 2 }, []), null)
  })

  check('多层按顺序叠加，后面的覆盖前面的', () => {
    const dst = solid(2, 2, 0, 0, 0)
    const blue = solid(2, 2, 255, 0, 0)
    const red = solid(2, 2, 0, 0, 255)
    compositeBitmaps(dst, { width: 2, height: 2 }, [
      { target: { x: 0, y: 0, width: 2, height: 2 }, clip: { x: 0, y: 0, width: 2, height: 2 }, bitmap: blue },
      { target: { x: 0, y: 0, width: 2, height: 2 }, clip: { x: 0, y: 0, width: 2, height: 2 }, bitmap: red }
    ])
    assert.deepStrictEqual(pixelAt(dst, 2, 0, 0), [0, 0, 255, 255], '后叠的层应覆盖先叠的层')
  })
}

// ------------------------------------------------- 命中判定（远程输入路由）

function testPickTopmostIndexAtPoint () {
  const main = { x: 0, y: 0, width: 100, height: 100 }

  eq(pickTopmostIndexAtPoint([main], 50, 50), 0, '命中唯一矩形')
  eq(pickTopmostIndexAtPoint([main], 150, 50), -1, '点在矩形外返回 -1')
  eq(pickTopmostIndexAtPoint([], 50, 50), -1, '空列表返回 -1')
  eq(pickTopmostIndexAtPoint(null, 50, 50), -1, '非数组返回 -1')
  eq(pickTopmostIndexAtPoint([main], NaN, 50), -1, '坐标为 NaN 返回 -1')

  // 左上角含、右下边界不含：相邻两个面在边界线上不能同时命中
  eq(pickTopmostIndexAtPoint([main], 0, 0), 0, '左上角属于该矩形')
  eq(pickTopmostIndexAtPoint([main], 99, 99), 0, '右下角内侧仍属于该矩形')
  eq(pickTopmostIndexAtPoint([main], 100, 50), -1, '右边线（开区间）不算命中')
  eq(pickTopmostIndexAtPoint([main], 50, 100), -1, '下边线（开区间）不算命中')

  // 后添加的视图画在上面，重叠时优先命中它
  const view = { x: 20, y: 20, width: 40, height: 40 }
  eq(pickTopmostIndexAtPoint([main, view], 30, 30), 1, '重叠区域命中上面那层视图')
  eq(pickTopmostIndexAtPoint([main, view], 10, 10), 0, '只落在主窗口时命中主窗口')
  eq(pickTopmostIndexAtPoint([main, view], 20, 20), 1, '视图左上角属于视图')

  // 已销毁的视图传 null：跳过它，落到下层的面
  eq(pickTopmostIndexAtPoint([main, null], 30, 30), 0, 'null 层被跳过')

  // 尺寸为 0 的视图不参与命中（避免 0 宽高把边线也算进去）
  eq(pickTopmostIndexAtPoint([main, { x: 30, y: 30, width: 0, height: 0 }], 30, 30), 0, '零尺寸视图被忽略')

  eq(pickTopmostIndexAtPoint([main], 50.5, 60.25), 0, '小数坐标正常命中')
  eq(pickTopmostIndexAtPoint([main], -1, 50), -1, '负坐标不命中')
}

// ---------------------------------------------------------------- 汇总

function main () {
  testResolvePhysicalSize()
  testComputePlacement()
  testCompositeBitmaps()
  testPickTopmostIndexAtPoint()

  console.log('')
  if (failures.length) {
    console.log('失败 ' + failures.length + ' 项：')
    for (const f of failures) console.log('  - ' + f)
  }
  console.log('\n原生视图合成回归：' + pass + ' 通过，' + fail + ' 失败')
  process.exit(fail ? 1 : 0)
}

main()