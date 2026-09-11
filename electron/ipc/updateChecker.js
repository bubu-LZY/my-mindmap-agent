/**
 * 更新检测：程序启动后 + 运行中每 6 小时，查询 GitHub 最新 release 并对比版本号。
 * - 无更新 / 检测失败（网络异常等）→ 静默，不做任何提示。
 * - 检测到新版本 → 回调 onUpdateAvailable(info)，由 appUpdater 记录状态并推给渲染进程。
 *
 * 本模块只负责「查 + 比 + 选资产」，不负责下载与安装（见 appUpdater.js），也不注册任何 IPC。
 * 选资产就是按当前系统平台与架构，从 release 资产列表里挑出唯一匹配的安装包；
 * 挑不到就返回 null，让上层回退到「打开下载页」。
 */

const { app } = require('electron')
const https = require('https')

const REPO = 'bubu-LZY/my-mindmap-agent'
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 小时
const INITIAL_DELAY_MS = 10 * 1000 // 启动后延迟 10 秒，等窗口加载完成
const REQUEST_TIMEOUT_MS = 10 * 1000
const RELEASE_CACHE_MS = 60 * 1000 // 一分钟内多次取用只发一次请求（「检查 → 下载」会先后取用）

let onUpdateAvailable = null
let timer = null
let cachedRelease = null
let cachedAt = 0

// 语义化版本对比：忽略 v 前缀，逐段比较数字；a > b 返回 1，a < b 返回 -1，相等返回 0
const compareVersions = (a, b) => {
  const pa = String(a || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const pb = String(b || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

// 查询 GitHub 最新 release，保留资产列表（下载用的 url / 大小 / 摘要都由这里来）
const fetchLatestRelease = () => {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers: {
          'User-Agent': 'my-mindmap-agent',
          Accept: 'application/vnd.github+json'
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error('HTTP ' + res.statusCode))
          return
        }
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            const assets = Array.isArray(json?.assets)
              ? json.assets.map(a => ({
                  name: String(a?.name || ''),
                  size: Number(a?.size) || 0,
                  url: String(a?.browser_download_url || ''),
                  digest: String(a?.digest || '')
                })).filter(a => a.name && a.url)
              : []
            resolve({
              tagName: String(json?.tag_name || ''),
              url: String(json?.html_url || ''),
              body: String(json?.body || ''),
              assets
            })
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy()
      reject(new Error('timeout'))
    })
  })
}

// 取最新 release（带缓存，避免「检查 → 下载」连打两次 API 触发限流）
const getLatestRelease = async (force = false) => {
  if (!force && cachedRelease && Date.now() - cachedAt < RELEASE_CACHE_MS) return cachedRelease
  const release = await fetchLatestRelease()
  cachedRelease = release
  cachedAt = Date.now()
  return release
}

// 架构别名：产物命名不统一（x64 / x86_64 / amd64 都有人用），统一成同类词
const ARCH_ALIASES = {
  x64: ['x64', 'x86_64', 'x86-64', 'amd64'],
  arm64: ['arm64', 'aarch64'],
  ia32: ['ia32', 'x86', 'i386'],
  armv7l: ['armv7l', 'armhf']
}

// 平台候选：按扩展名判定这份资产属于哪个平台，以及它是不是「能静默安装」的形态
const PLATFORM_RULES = {
  win32: [
    { ext: /\.exe$/i, installMode: 'silent' },
    { ext: /\.msi$/i, installMode: 'open-file' }
  ],
  darwin: [
    { ext: /\.dmg$/i, installMode: 'silent' },
    { ext: /\.zip$/i, installMode: 'open-file' },
    { ext: /\.pkg$/i, installMode: 'open-file' }
  ],
  linux: [
    { ext: /\.appimage$/i, installMode: 'silent' },
    { ext: /\.deb$/i, installMode: 'open-file' },
    { ext: /\.rpm$/i, installMode: 'open-file' }
  ]
}

// 本产品实际出包的平台架构矩阵（与 package.json 的 build 配置一致）。
// 不在矩阵里的架构（如 32 位 Windows ia32）没有对应产物，直接判「匹配失败」交给上层回退下载页；
// 否则会因为 Windows 安装包名里不含架构词而被当成通用包选中，装到 32 位系统上必然失败。
const SUPPORTED_ARCHES = {
  win32: ['x64'],
  darwin: ['x64', 'arm64'],
  linux: ['x64']
}

// 从资产列表里挑出当前平台 + 架构唯一匹配的安装包。
// 打分规则：平台形态必须命中（否则直接排除）；架构词命中 +5，产物名里没有架构词 +2（视为通用包），
// 架构词存在但不匹配则排除。得分最高的胜出；同分时取体积更大的。
const resolveAsset = (assets, platform = process.platform, arch = process.arch) => {
  const rules = PLATFORM_RULES[platform]
  if (!Array.isArray(assets) || !rules) return null
  const supported = SUPPORTED_ARCHES[platform]
  if (supported && !supported.includes(arch)) return null
  const aliases = ARCH_ALIASES[arch] || [String(arch).toLowerCase()]
  // 源码包不是安装包：macOS 的 .zip 也是合法安装形态，若不排除，缺 dmg 时会把
  // 「xxx-source-v1.0.0.zip」当成 macOS 安装包下载下来。
  const SOURCE_HINTS = ['source', 'sources', 'src']
  let best = null
  for (const asset of assets) {
    const name = asset.name
    const lower = name.toLowerCase()
    const rule = rules.find(r => r.ext.test(lower))
    if (!rule) continue
    // electron-builder 的 Linux x64 产物用 x86_64 命名，而按 [^a-z0-9]+ 切词会把下划线当分隔符，
    // 碎成 x86 + 64；x86 又是 ia32 的别名，于是 AppImage 被当成「异构架构」排除，
    // Linux 用户只能拿到 .deb（需手动安装）而拿不到可静默更新的 AppImage。
    // 先归一化复合写法再切词比对。
    const normalized = lower.replace(/x86[_-]64/g, 'x64').replace(/aarch64/g, 'arm64')
    const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean)
    if (SOURCE_HINTS.some(hint => tokens.includes(hint))) continue
    const hasForeignArch = Object.entries(ARCH_ALIASES).some(([key, list]) => (
      key !== arch && list.some(alias => tokens.includes(alias))
    ))
    if (hasForeignArch) continue
    const archHit = aliases.some(alias => tokens.includes(alias))
    const score = (archHit ? 5 : 2) + (rule.installMode === 'silent' ? 1 : 0)
    if (!best || score > best.score || (score === best.score && asset.size > best.asset.size)) {
      best = { score, asset, installMode: rule.installMode }
    }
  }
  if (!best) return null
  // AppImage 只有在「当前就是 AppImage 运行」时才能自我替换；否则只能下载后交给用户打开
  const installMode = best.installMode === 'silent' &&
    platform === 'linux' && !process.env.APPIMAGE
    ? 'open-file'
    : best.installMode
  return {
    name: best.asset.name,
    size: best.asset.size,
    url: best.asset.url,
    digest: best.asset.digest,
    installMode
  }
}

// 检查更新并给出明确结果；hasUpdate 为 false 或抛错时由调用方决定是否提示
const checkManually = async ({ force = true } = {}) => {
  try {
    const release = await getLatestRelease(force)
    if (!release.tagName) return { success: false, message: '未获取到版本信息' }
    const current = app.getVersion()
    const asset = resolveAsset(release.assets)
    return {
      success: true,
      hasUpdate: compareVersions(release.tagName, current) > 0,
      currentVersion: current,
      latestVersion: release.tagName,
      url: release.url || `https://github.com/${REPO}/releases/latest`,
      platform: process.platform,
      arch: process.arch,
      asset,
      // 没有任何匹配资产时（如 32 位 Windows、无产物的架构）回退到下载页
      installMode: asset ? asset.installMode : 'open-page'
    }
  } catch (e) {
    return { success: false, message: e?.message || '检查更新失败（网络异常）' }
  }
}

// 定时静默检测：只在「有更新」时回调，其余情况（无更新 / 网络失败）一律安静
const check = async () => {
  const info = await checkManually({ force: false })
  if (!info.success || !info.hasUpdate) return
  try { onUpdateAvailable?.(info) } catch (e) { /* 回调异常不影响定时器 */ }
}

const initUpdateChecker = (onAvailable) => {
  onUpdateAvailable = onAvailable
  stopUpdateChecker()
  setTimeout(check, INITIAL_DELAY_MS)
  timer = setInterval(check, CHECK_INTERVAL_MS)
}

const stopUpdateChecker = () => {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = {
  initUpdateChecker,
  stopUpdateChecker,
  check,
  compareVersions,
  checkManually,
  getLatestRelease,
  resolveAsset,
  REPO
}
