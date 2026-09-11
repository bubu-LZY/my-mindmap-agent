/**
 * 出网请求的目标地址校验（SSRF 防护）。
 *
 * 为什么必须做 DNS 解析而不是只匹配 hostname 字符串：
 * 只比对域名的黑名单可以被一条 A 记录绕过——攻击者注册 evil.example 指向 169.254.169.254，
 * 请求就直连云元数据服务了。所以这里先解析出全部 IP，再逐个分类。
 *
 * 为什么必须自己跟重定向：
 * fetch 默认自动跟随 3xx，一个公网地址可以 302 跳到内网，第一跳的校验就白做了。
 * 这里改成 redirect:'manual'，每一跳都重新校验。
 *
 * 残留限制（已知，非疏漏）：校验时的 DNS 解析与 fetch 自身的解析是两次独立查询，
 * 理论上存在 DNS rebinding 窗口。彻底消除需要用 undici Agent 的 connect 钩子固定 IP，
 * 但那会破坏 https 的 SNI 与证书校验，代价大于收益。短 TTL 重绑定才能利用这个窗口。
 */
const dns = require('dns').promises
const net = require('net')

// 各云厂商的实例元数据服务端点。拿到这些地址的响应通常等于拿到实例角色凭据，
// 因此单独归为一类硬拦，任何场景都不放行、不提供开关。
// 注意 fd00:ec2::254 落在 ULA(fc00::/7)、100.100.100.200 落在 CGNAT(100.64/10) 内，
// 只按网段分类会被判成 private，而 AI 端点策略是放行 private 的（本地推理服务需要），
// 所以必须先于网段规则精确命中这几个地址。
const CLOUD_METADATA_IPS = new Set([
  '169.254.169.254',   // AWS / GCP / Azure / 阿里云 / Oracle Cloud（IPv4）
  'fd00:ec2::254',     // AWS（IPv6）
  '100.100.100.200',   // 阿里云
  '169.254.170.2'      // AWS ECS 容器凭据端点
])

// 把 IPv6 展开成全 8 组的规范写法，避免 ::254 与 0:0:0:0:0:0:0:254 之类等价形式绕过集合比对。
// IPv4-mapped（::ffff:1.2.3.4）不在此处理，classifyIp 会先把它转成内嵌 IPv4 再分类。
function expandIpv6(raw) {
  if (!net.isIPv6(raw) || raw.includes('.')) return raw
  const parts = raw.split('::')
  const left = parts[0] ? parts[0].split(':') : []
  const hasDouble = parts.length > 1
  const right = hasDouble ? (parts[1] ? parts[1].split(':') : []) : []
  const fill = hasDouble ? Math.max(0, 8 - left.length - right.length) : 0
  const groups = [...left, ...Array(fill).fill('0'), ...right]
  if (groups.length !== 8) return raw
  return groups.map((g) => g.padStart(4, '0')).join(':')
}

function isCloudMetadata(raw) {
  if (CLOUD_METADATA_IPS.has(raw)) return true
  const expanded = expandIpv6(raw)
  return expanded !== raw && [...CLOUD_METADATA_IPS].some((ip) => expandIpv6(ip) === expanded)
}

// 分类结果：
//   metadata    云厂商实例元数据端点（任何场景都拒绝）
//   loopback    回环（127/8、::1、localhost）
//   private     私网/CGNAT/ULA（10/8、172.16/12、192.168/16、100.64/10、fc00::/7、内网域名后缀）
//   linklocal   链路本地（169.254/16、fe80::/10）
//   multicast   组播/广播
//   unspecified 未指定地址（0.0.0.0、::）
//   reserved    保留/测试段（192.0.2/24、198.18/15、2001:db8::/32）
//   public      公网
//   invalid     无法解析
function classifyIp(ip) {
  const raw = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!raw) return 'invalid'

  // IPv4-mapped IPv6（::ffff:127.0.0.1）直接按内嵌的 IPv4 分类
  const v4Mapped = raw.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (v4Mapped) return classifyIp(v4Mapped[1])

  if (isCloudMetadata(raw)) return 'metadata'

  if (net.isIPv4(raw)) {
    const o = raw.split('.').map(Number)
    if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return 'invalid'
    const [a, b, c] = o
    if (a === 0) return 'unspecified'
    if (a === 127) return 'loopback'
    if (a === 10) return 'private'
    if (a === 100 && b >= 64 && b <= 127) return 'private'
    if (a === 169 && b === 254) return 'linklocal'
    if (a === 172 && b >= 16 && b <= 31) return 'private'
    if (a === 192 && b === 168) return 'private'
    if (a === 192 && (c === 0 || c === 2)) return 'reserved'
    if (a === 198 && (b === 18 || b === 19)) return 'reserved'
    if (a >= 224) return 'multicast'
    return 'public'
  }

  if (net.isIPv6(raw)) {
    if (raw === '::' || raw === '::0') return 'unspecified'
    if (raw === '::1') return 'loopback'
    if (raw.startsWith('ff')) return 'multicast'
    if (/^fe[89ab]/.test(raw)) return 'linklocal'
    if (/^f[cd]/.test(raw)) return 'private'
    if (raw.startsWith('2001:db8')) return 'reserved'

    const groups = expandIpv6(raw).split(':')
    // Teredo（2001:0000::/32）把服务端 IPv4 按位取反存放在地址尾部，无法可靠还原校验，
    // 且该机制已被废弃，直接归入保留段拦掉。必须比对归一化后的前两组，
    // 否则会误伤 2001:4860:: 这类真实公网 IPv6。
    if (groups.length === 8 && groups[0] === '2001' && groups[1] === '0000') return 'reserved'

    // 6to4（2002:WWXX:YYZZ::/48）把 IPv4 编进前缀：两个 16 位组，每组含两个八位组。
    // 例：2002:a9fe:a9fe:: → 169.254.169.254，正是云元数据地址。
    const sixToFour = raw.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/)
    if (sixToFour) {
      const octets = [sixToFour[1], sixToFour[2]].flatMap((g) => {
        const p = g.padStart(4, '0')
        return [parseInt(p.slice(0, 2), 16), parseInt(p.slice(2), 16)]
      })
      return classifyIp(octets.join('.'))
    }
    return 'public'
  }

  return 'invalid'
}

// 这些主机名不需要 DNS 就能判定，且部分内网服务（如云元数据）根本不在公共 DNS 里
const LOOPBACK_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback'])
const METADATA_HOSTNAMES = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'metadata.tencentyun.com'
])
const PRIVATE_HOSTNAMES = new Set(['host.docker.internal'])
const PRIVATE_SUFFIXES = ['.local', '.internal', '.lan', '.localhost', '.home.arpa', '.corp', '.intranet']

function endsWithAny(host, suffixes) {
  return suffixes.some((s) => host === s.slice(1) || host.endsWith(s))
}

/**
 * 解析 URL 并把目标主机分类。域名会做 DNS 解析，取全部记录里「最危险」的一类。
 * @param {string} rawUrl
 * @param {{allowSchemes?: string[]}} [opts]
 * @returns {Promise<{url: URL, hostname: string, klass: string, addresses: string[]}>}
 */
async function inspectUrl(rawUrl, opts = {}) {
  const allowSchemes = opts.allowSchemes || ['http:', 'https:']
  let parsed
  try {
    parsed = new URL(String(rawUrl || '').trim())
  } catch {
    throw new Error(`地址无效：${rawUrl}`)
  }
  if (!allowSchemes.includes(parsed.protocol)) {
    throw new Error(`不允许的协议 ${parsed.protocol}（仅支持 ${allowSchemes.join(' / ')}）：${rawUrl}`)
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (!hostname) throw new Error(`地址缺少主机名：${rawUrl}`)

  if (net.isIP(hostname)) {
    return { url: parsed, hostname, klass: classifyIp(hostname), addresses: [hostname] }
  }
  if (LOOPBACK_HOSTNAMES.has(hostname)) {
    return { url: parsed, hostname, klass: 'loopback', addresses: [] }
  }
  if (METADATA_HOSTNAMES.has(hostname)) {
    return { url: parsed, hostname, klass: 'metadata', addresses: [] }
  }
  if (PRIVATE_HOSTNAMES.has(hostname) || endsWithAny(hostname, PRIVATE_SUFFIXES)) {
    return { url: parsed, hostname, klass: 'private', addresses: [] }
  }

  let records
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch (e) {
    throw new Error(`域名解析失败（${hostname}）：${e.code || e.message}`)
  }
  if (!records || records.length === 0) throw new Error(`域名未解析到任何地址：${hostname}`)

  const addresses = records.map((r) => r.address)
  // 多记录里只要有一个落在更危险的段就按那个算，避免「一个公网 IP 掩护一个内网 IP」
  const rank = {
    invalid: 7, metadata: 6, unspecified: 5, multicast: 5, linklocal: 4,
    reserved: 3, private: 2, loopback: 1, public: 0
  }
  const classes = addresses.map(classifyIp)
  const klass = classes.reduce((worst, cur) => (rank[cur] > rank[worst] ? cur : worst), 'public')
  return { url: parsed, hostname, klass, addresses }
}

// 任何场景都不允许的目标：云元数据、链路本地、组播、未指定地址、保留段、非法地址。
// 这些永远不是合法的 AI 端点或网页地址，因此不提供开关。
const HARD_BLOCKED = new Set(['metadata', 'linklocal', 'multicast', 'unspecified', 'reserved', 'invalid'])

const KLASS_LABEL = {
  metadata: '云实例元数据地址',
  loopback: '回环地址',
  private: '内网地址',
  linklocal: '链路本地/云元数据地址',
  multicast: '组播地址',
  unspecified: '未指定地址',
  reserved: '保留地址段',
  invalid: '非法地址',
  public: '公网地址'
}

/**
 * 校验 AI 端点。允许回环与内网：本地推理服务（Ollama 的 /api/tags、LM Studio、vLLM）
 * 和团队内网网关都是本应用明确支持的用法，一律拦掉会直接打断正常使用。
 * 只硬拦云元数据那一类永远不可能是 AI 端点的地址。
 * @param {string} rawUrl
 * @returns {Promise<URL>}
 */
async function assertSafeAiEndpoint(rawUrl) {
  const info = await inspectUrl(rawUrl)
  if (HARD_BLOCKED.has(info.klass)) {
    throw new Error(
      `已拒绝访问${KLASS_LABEL[info.klass] || info.klass}（${info.hostname}` +
      `${info.addresses.length ? ' → ' + info.addresses.join(', ') : ''}），该地址不是合法的 AI 服务地址`
    )
  }
  if (info.klass === 'loopback' || info.klass === 'private') {
    console.warn(`[security] AI 端点指向${KLASS_LABEL[info.klass]}: ${info.hostname}`)
  }
  return info.url
}

/**
 * 校验任意网页抓取目标。策略比 AI 端点更严：回环与内网默认一并拦掉，
 * 因为「读取网页正文」没有任何理由需要访问本机或内网服务。
 * @param {string} rawUrl
 * @param {{allowPrivateNetwork?: boolean}} [opts]
 * @returns {Promise<URL>}
 */
async function assertSafeWebTarget(rawUrl, opts = {}) {
  const info = await inspectUrl(rawUrl)
  if (HARD_BLOCKED.has(info.klass)) {
    throw new Error(`已拒绝访问${KLASS_LABEL[info.klass] || info.klass}：${info.hostname}`)
  }
  if ((info.klass === 'loopback' || info.klass === 'private') && !opts.allowPrivateNetwork) {
    throw new Error(`已拒绝访问${KLASS_LABEL[info.klass]}（${info.hostname}），网页抓取不允许指向本机或内网`)
  }
  return info.url
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5

/**
 * 带 SSRF 校验的 fetch：每一跳重定向都重新校验目标地址。
 * 签名与 fetch 一致，可直接替换。
 */
async function fetchWithGuard(rawUrl, opts = {}, assertTarget = assertSafeAiEndpoint) {
  let current = String(rawUrl)
  let method = (opts.method || 'GET').toUpperCase()
  let body = opts.body
  let headers = opts.headers

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertTarget(current)
    const resp = await fetch(current, { ...opts, method, body, headers, redirect: 'manual' })
    if (!REDIRECT_STATUSES.has(resp.status)) return resp

    const location = resp.headers.get('location')
    if (!location) return resp
    const next = new URL(location, current).toString()

    // 303 一律转 GET；301/302 对 POST 按浏览器惯例也转 GET（丢掉 body）
    if (resp.status === 303 || ((resp.status === 301 || resp.status === 302) && method === 'POST')) {
      method = 'GET'
      body = undefined
      if (headers) {
        const h = { ...headers }
        delete h['Content-Length']
        delete h['content-length']
        delete h['Content-Type']
        delete h['content-type']
        headers = h
      }
    }
    current = next
  }
  throw new Error(`重定向次数超过上限（${MAX_REDIRECTS} 次），已中止请求`)
}

module.exports = {
  classifyIp,
  inspectUrl,
  assertSafeAiEndpoint,
  assertSafeWebTarget,
  fetchWithGuard,
  HARD_BLOCKED,
  KLASS_LABEL
}
