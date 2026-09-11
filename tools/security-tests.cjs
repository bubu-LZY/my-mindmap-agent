#!/usr/bin/env node
/**
 * 安全回归测试（零依赖，纯 node 运行：npm run test:security）
 *
 * 这里锁定的都是「修过一次、以后很容易被人无意改回去」的安全边界：
 * 路径穿越（safePath）与 SSRF 地址分类（netGuard）。
 * 只覆盖主进程纯函数层——渲染层工具（sanitizeHtml、inertDom）需要浏览器环境，
 * 由 vite build 的类型/语法检查与手工 PoC 覆盖。
 */
const path = require('path')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..')
const { resolveInside } = require(path.join(ROOT, 'electron/utils/safePath.js'))
const netGuard = require(path.join(ROOT, 'electron/utils/netGuard.js'))

let pass = 0
let fail = 0
let skipped = 0
const failures = []

function check(label, fn) {
  try {
    fn()
    pass++
  } catch (e) {
    fail++
    failures.push(`${label}\n      ${e.message}`)
  }
}

function eq(actual, expected, label) {
  check(label, () => assert.strictEqual(actual, expected))
}

function throwsSync(label, fn) {
  check(label, () => {
    let threw = false
    try {
      fn()
    } catch {
      threw = true
    }
    assert.ok(threw, '期望抛出异常，但正常返回了')
  })
}

// ---------------------------------------------------------------- safePath

function testSafePath() {
  const BASE = path.resolve(ROOT, 'custom-tools')

  // 合法相对路径：输出必须精确等于 BASE 下的对应位置
  const ok = (rel, expectedTail) =>
    eq(resolveInside(BASE, rel), path.resolve(BASE, expectedTail), `safePath 放行 ${JSON.stringify(rel)}`)

  // 向上穿越：必须抛异常（这是 Zip Slip 的正面攻击）
  const blocked = (rel) => throwsSync(`safePath 拦截 ${JSON.stringify(rel)}`, () => resolveInside(BASE, rel))

  // 退化输入：必须返回 null（返回 BASE 本身会让调用方写目录报 EISDIR）
  const nulled = (rel) => eq(resolveInside(BASE, rel), null, `safePath 返回 null ${JSON.stringify(rel)}`)

  // 敌意输入的总不变式：抛异常 / null / 严格落在 BASE 内部，三者之一。
  // 绝对路径与盘符会被「重定位」进 BASE（归档解压的标准做法）而不是抛错，
  // 所以这里断言的是不会逃逸，而不是断言具体返回值。
  const contained = (rel) =>
    check(`safePath 不越界 ${JSON.stringify(rel)}`, () => {
      let out
      try {
        out = resolveInside(BASE, rel)
      } catch {
        return // 抛异常即满足不变式
      }
      if (out === null) return
      assert.strictEqual(typeof out, 'string', `返回类型异常: ${typeof out}`)
      const relFromBase = path.relative(BASE, out)
      assert.ok(
        relFromBase && !relFromBase.startsWith('..') && !path.isAbsolute(relFromBase),
        `逃逸出 BASE: ${out}`
      )
    })

  // 正常路径
  ok('tool.js', 'tool.js')
  ok('sub/tool.js', 'sub/tool.js')
  ok('sub/nested/tool.js', 'sub/nested/tool.js')
  ok('./tool.js', 'tool.js')
  ok('sub/./tool.js', 'sub/tool.js')
  ok('sub//tool.js', 'sub/tool.js')
  ok('sub/', 'sub')
  // Windows 反斜杠先归一成 /，再按段解析
  ok('sub\\tool.js', 'sub/tool.js')
  ok('sub\\\\nested\\tool.js', 'sub/nested/tool.js')

  // 向上穿越——必须抛
  blocked('../evil.js')
  blocked('../../evil.js')
  blocked('sub/../../evil.js')
  blocked('..\\evil.js')
  blocked('..\\..\\Windows\\system32\\evil.dll')
  blocked('sub/../../../Windows/win.ini')
  blocked('a/../../../etc/passwd')

  // 绝对路径 / UNC / 盘符——被重定位进 BASE，断言不逃逸
  for (const rel of [
    'C:/Windows/evil.dll',
    'C:\\Windows\\evil.dll',
    '/etc/passwd',
    '\\\\server\\share\\evil.js',
    '\\server\\share\\evil.js',
    'c:',
    'C:',
    'D:/',
  ]) {
    contained(rel)
  }
  nulled('c:')
  nulled('C:')

  // 空值与退化输入
  nulled('')
  nulled(null)
  nulled(undefined)
  nulled('   ')
  nulled('.')
  nulled('./')

  // NUL 截断（老式 C 层绕过手法）：前导 NUL 被剥掉后剩下的 .. 必须照样拦住
  blocked('tool.js\x00/../../evil.js')
  blocked('\x00../../evil.js')

  // 混合手法：穿越段藏在合法目录后面
  blocked('sub/../../../../evil.js')
  blocked('./sub/../../evil.js')
}

// ---------------------------------------------------------------- netGuard

function testClassifyIp() {
  const cases = [
    // 云元数据：任何场景都硬拦。
    // fd00:ec2::254 落在 ULA(fc00::/7)、100.100.100.200 落在 CGNAT(100.64/10) 内，
    // 只按网段分类会被判成 private，而 AI 策略是放行 private 的——必须先精确命中这几个地址。
    ['169.254.169.254', 'metadata'],
    ['fd00:ec2::254', 'metadata'],
    ['fd00:ec2:0:0:0:0:0:254', 'metadata'],
    ['FD00:EC2::254', 'metadata'],
    ['100.100.100.200', 'metadata'],
    ['169.254.170.2', 'metadata'],
    ['::ffff:169.254.169.254', 'metadata'],

    // 回环
    ['127.0.0.1', 'loopback'],
    ['127.5.5.5', 'loopback'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'loopback'],

    // 私网（含 CGNAT 与 ULA）
    ['10.0.0.1', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'private'],
    ['100.127.9.9', 'private'],
    ['fc00::1', 'private'],
    ['fd12::1', 'private'],

    // 私网边界外必须是 public，不能扩大化误伤
    ['172.15.0.1', 'public'],
    ['172.32.0.1', 'public'],
    ['100.128.0.1', 'public'],
    ['169.253.1.1', 'public'],
    ['11.0.0.1', 'public'],

    // 链路本地 / 组播 / 未指定
    ['169.254.1.1', 'linklocal'],
    ['fe80::1', 'linklocal'],
    ['febf::1', 'linklocal'],
    ['ff02::1', 'multicast'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'multicast'],
    ['0.0.0.0', 'unspecified'],
    ['::', 'unspecified'],

    // 保留段
    ['192.0.2.1', 'reserved'],
    ['198.18.0.1', 'reserved'],
    ['2001:db8::1', 'reserved'],

    // Teredo（2001:0000::/32）：内嵌 IPv4 按位取反无法可靠还原，协议已废弃，整段拦掉。
    // 关键是不能误伤 2001:4860:: 这类真实公网 IPv6。
    ['2001:0000:0000:0000:0000:0000:0000:0001', 'reserved'],
    ['2001:0:1::1', 'reserved'],
    ['2001:4860:4860::8888', 'public'],
    ['2606:4700:4700::1111', 'public'],

    // 6to4（2002:WWXX:YYZZ::/48）：内嵌 IPv4 展开后重新分类
    ['2002:a9fe:a9fe::', 'metadata'], // → 169.254.169.254
    ['2002:c0a8:0101::', 'private'], // → 192.168.1.1
    ['2002:7f00:1::', 'loopback'], // → 127.0.0.1
    ['2002:0808:0808::', 'public'], // → 8.8.8.8

    // 公网
    ['8.8.8.8', 'public'],
    ['1.1.1.1', 'public'],

    // 非法
    ['999.1.1.1', 'invalid'],
    ['1.2.3', 'invalid'],
    ['not-an-ip', 'invalid'],
    ['', 'invalid'],
  ]
  for (const [ip, expect] of cases) {
    eq(netGuard.classifyIp(ip), expect, `classifyIp(${JSON.stringify(ip)})`)
  }
}

async function testPolicies() {
  // [url, AI 期望, 网页抓取期望]；true = 放行，false = 拒绝
  const cases = [
    ['https://api.deepseek.com/v1/models', true, true],

    // 本地推理服务（Ollama / LM Studio / vLLM）与内网网关必须继续可用，否则「检测模型」全挂
    ['http://127.0.0.1:11434/api/tags', true, false],
    ['http://localhost:1234/v1/models', true, false],
    ['http://192.168.1.50:8000/v1/models', true, false],
    ['https://[::1]/v1/models', true, false],
    // .local/.internal 归为 private：AI 放行，read_webpage 拦掉（后者可被提示注入指向内网）
    ['http://foo.local/v1/models', true, false],
    ['http://host.docker.internal/v1/models', true, false],

    // 云元数据：两条策略都拦
    ['http://169.254.169.254/latest/meta-data/', false, false],
    ['http://[fd00:ec2::254]/v1/models', false, false],
    ['http://100.100.100.200/latest/meta-data/', false, false],
    ['http://metadata.google.internal/computeMetadata/v1/', false, false],
    ['http://[2002:a9fe:a9fe::]/latest/meta-data/', false, false],

    // WHATWG URL 会把整数形式主机归一化成点分十进制，这种绕过写法同样要拦住
    ['http://2852039166/latest/meta-data/', false, false],

    // 非法协议与非法输入
    ['file:///C:/Windows/win.ini', false, false],
    ['gopher://127.0.0.1:6379/_INFO', false, false],
    ['http://0.0.0.0:8080/v1/models', false, false],
    ['http://224.0.0.1/v1/models', false, false],
    ['not a url', false, false],
    ['', false, false],
  ]

  // 公网域名用例要真做 DNS 解析；离线时解析失败不等于策略失败，单独计为跳过。
  const isDnsFailure = (e) => !!e && /域名解析失败|域名未解析到任何地址/.test(e.message)

  for (const [url, aiExpect, webExpect] of cases) {
    for (const [label, assertFn, expect] of [
      ['AI ', netGuard.assertSafeAiEndpoint, aiExpect],
      ['WEB', netGuard.assertSafeWebTarget, webExpect],
    ]) {
      let allowed = false
      let err = null
      try {
        await assertFn(url)
        allowed = true
      } catch (e) {
        err = e
      }
      if (!allowed && expect && isDnsFailure(err)) {
        skipped++
        continue
      }
      check(`${label} ${url}`, () => assert.strictEqual(allowed, expect))
    }
  }

  // 拒绝理由要对用户可读：不能是 [object Object]，也要带上主机名便于排查
  let err = null
  try {
    await netGuard.assertSafeWebTarget('http://169.254.169.254/latest/meta-data/')
  } catch (e) {
    err = e
  }
  check('SSRF 拒绝信息可读且含主机名', () => {
    assert.ok(err, '期望抛出异常')
    assert.ok(/云实例元数据/.test(err.message), `拒绝理由不可读: ${err.message}`)
    assert.ok(err.message.includes('169.254.169.254'), `拒绝理由缺少主机名: ${err.message}`)
  })
}

// ---------------------------------------------------------------- 汇总

async function main() {
  testSafePath()
  testClassifyIp()
  await testPolicies()

  console.log('')
  if (failures.length) {
    console.log(`失败 ${failures.length} 项：`)
    for (const f of failures) console.log(`  - ${f}`)
  }
  const skipNote = skipped ? `，${skipped} 跳过（公网域名解析不可用）` : ''
  console.log(`\n安全回归：${pass} 通过，${fail} 失败${skipNote}`)
  process.exit(fail ? 1 : 0)
}

main()
