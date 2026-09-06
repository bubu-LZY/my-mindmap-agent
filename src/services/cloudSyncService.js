/**
 * 云盘同步服务（渲染进程）
 * - 管理 WebDAV 同步配置（localStorage 持久化）
 * - 保存 .smm 后触发防抖同步
 * - 提供手动同步（设置页「立即同步」按钮）
 *
 * 同步语义：本地默认保存目录（C:\我的mindmap）整目录镜像到云盘指定文件夹。
 */

const CONFIG_KEY = 'MINDMAP_CLOUD_SYNC'

const defaultConfig = () => ({
  enabled: false,
  vendor: 'custom', // 'jianguoyun' | '123pan' | 'custom'
  url: '',
  user: '',
  pass: '',
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

const loadConfig = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}')
    return { ...defaultConfig(), ...raw }
  } catch {
    return defaultConfig()
  }
}

const saveConfig = (cfg) => {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg || defaultConfig()))
  } catch { /* 忽略 */ }
}

const isEnabled = () => loadConfig().enabled === true

let syncTimer = null
let syncing = false

// 保存后触发：防抖合并连续保存，静默执行
const triggerSync = (delay = 3000) => {
  const cfg = loadConfig()
  if (!cfg.enabled) return
  if (!cfg.url || !cfg.user) return
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => { runSync().catch(() => {}) }, delay)
}

// 手动/自动执行一次同步
const runSync = async () => {
  if (syncing) return { success: false, message: '同步进行中' }
  const cfg = loadConfig()
  if (!cfg.url || !cfg.user) return { success: false, message: '请先配置 WebDAV 地址和账号' }
  if (!window.electronAPI?.cloudSync?.sync) return { success: false, message: '云盘同步不可用（需在应用内运行）' }
  syncing = true
  try {
    const res = await window.electronAPI.cloudSync.sync({
      rclonePath: cfg.rclonePath || 'rclone',
      url: cfg.url,
      user: cfg.user,
      pass: cfg.pass || '',
      remoteDir: cfg.remoteDir || ''
    })
    return res || { success: false, message: '同步无返回结果' }
  } finally {
    syncing = false
  }
}

export { loadConfig, saveConfig, triggerSync, runSync, isEnabled, VENDOR_PRESETS }
