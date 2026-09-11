/**
 * 云盘同步服务（渲染进程）
 * - WebDAV 同步配置存在主进程（密码经 safeStorage 加密），本层只持有掩码副本用于界面渲染
 * - 保存 .smm 后触发防抖同步
 * - 提供手动同步（设置页「立即同步」按钮）
 *
 * 同步语义：本地默认保存目录（C:\我的mindmap）整目录镜像到云盘指定文件夹。
 *
 * 为什么配置不再放 localStorage：早期版本把 WebDAV 明文密码直接写进 localStorage，
 * 渲染层任意一处 XSS 就能读走网盘凭据。现在密码只在主进程内解密使用，
 * 渲染层拿到的是 ****，同步时也不需要把密码传回主进程。
 */

const LEGACY_CONFIG_KEY = 'MINDMAP_CLOUD_SYNC'

const defaultConfig = () => ({
  enabled: false,
  vendor: 'custom', // 'jianguoyun' | 'terabox' | 'yandex' | 'custom'
  url: '',
  user: '',
  pass: '', // 主进程回传的掩码（**** 或空），不是明文
  hasPass: false,
  remoteDir: '', // 云盘目标文件夹（相对 WebDAV 根）
  rclonePath: 'rclone' // rclone.exe 路径或命令名
})

// 厂商预设（只预填 WebDAV 地址，账号密码仍需用户填）
// 注意：123云盘已不再提供免费WebDAV服务，故移除
const VENDOR_PRESETS = {
  jianguoyun: { label: '坚果云（推荐）', url: 'https://dav.jianguoyun.com/dav/' },
  terabox: { label: 'TeraBox 海外版', url: 'https://dav.terabox.com/dav/' },
  yandex: { label: 'Yandex Disk（俄）', url: 'https://webdav.yandex.ru/' },
  custom: { label: '自定义', url: '' }
}

const hasBridge = () => !!window.electronAPI?.cloudSync?.getConfig

// 主进程配置的内存副本。loadConfig() 必须保持同步——设置页用 ref(loadConfig()) 直接初始化，
// 改成异步会牵动一大片调用方；改由 init() 在模块加载时就开始灌缓存。
let cache = defaultConfig()
let initPromise = null

const loadConfig = () => ({ ...cache })

// 把旧版 localStorage 里的明文配置迁到主进程，迁完立刻删掉本地明文
const migrateLegacyConfig = async () => {
  let legacy = null
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_CONFIG_KEY) || 'null')
  } catch {
    legacy = null
  }
  // 无论迁移成不成都要清掉：这个键里可能躺着明文密码
  try { localStorage.removeItem(LEGACY_CONFIG_KEY) } catch { /* 忽略 */ }
  if (!legacy || typeof legacy !== 'object') return

  const current = await window.electronAPI.cloudSync.getConfig()
  if (current?.config?.hasPass) return // 主进程已有密码就别覆盖，用户可能已在新版本里改过

  await window.electronAPI.cloudSync.saveConfig({
    enabled: legacy.enabled === true,
    vendor: typeof legacy.vendor === 'string' ? legacy.vendor : 'custom',
    url: String(legacy.url || ''),
    user: String(legacy.user || ''),
    pass: String(legacy.pass || ''),
    remoteDir: String(legacy.remoteDir || ''),
    rclonePath: String(legacy.rclonePath || 'rclone')
  })
}

// 迁移旧配置 + 灌满缓存。幂等：重复调用返回同一个 promise。
const init = () => {
  if (initPromise) return initPromise
  initPromise = (async () => {
    if (!hasBridge()) return cache // 纯浏览器环境（开发调试）：保持默认值
    try {
      await migrateLegacyConfig()
      const res = await window.electronAPI.cloudSync.getConfig()
      if (res?.success && res.config) cache = { ...defaultConfig(), ...res.config }
    } catch {
      /* 读取失败就用默认值，不阻塞启动 */
    }
    return cache
  })()
  return initPromise
}

const saveConfig = async (cfg) => {
  const next = { ...cache, ...(cfg || {}) }
  if (!hasBridge()) {
    cache = next // 纯浏览器环境：只更新内存，不落盘
    return { success: false, message: '云盘同步不可用（需在应用内运行）' }
  }
  try {
    const res = await window.electronAPI.cloudSync.saveConfig({
      enabled: next.enabled === true,
      vendor: next.vendor,
      url: next.url,
      user: next.user,
      pass: next.pass,
      remoteDir: next.remoteDir,
      rclonePath: next.rclonePath
    })
    // 保存失败也要同步缓存，避免界面显示与主进程实际配置长期不一致
    cache = res?.success && res.config ? { ...defaultConfig(), ...res.config } : next
    return res || { success: false, message: '保存无返回结果' }
  } catch (e) {
    cache = next
    return { success: false, message: e?.message || '保存配置失败' }
  }
}

const isEnabled = () => cache.enabled === true

let syncTimer = null
let syncing = false

// 保存后触发：防抖合并连续保存，静默执行
const triggerSync = (delay = 3000) => {
  if (!isEnabled()) return
  if (!cache.url || !cache.user) return
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => { runSync().catch(() => {}) }, delay)
}

// 手动/自动执行一次同步。凭据由主进程自己取，这里不传。
const runSync = async () => {
  if (syncing) return { success: false, message: '同步进行中' }
  if (!cache.url || !cache.user) return { success: false, message: '请先配置 WebDAV 地址和账号' }
  if (!window.electronAPI?.cloudSync?.sync) return { success: false, message: '云盘同步不可用（需在应用内运行）' }
  syncing = true
  try {
    const res = await window.electronAPI.cloudSync.sync({ remoteDir: cache.remoteDir || '' })
    return res || { success: false, message: '同步无返回结果' }
  } finally {
    syncing = false
  }
}

// 模块加载即开始拉配置：App.vue 的 triggerSync 与设置页的 loadConfig 都依赖缓存已就绪，
// 放在这里比要求每个调用方自己 await 更不容易漏。
init()

export { init, loadConfig, saveConfig, triggerSync, runSync, isEnabled, VENDOR_PRESETS }
