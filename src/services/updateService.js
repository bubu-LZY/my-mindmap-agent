import { reactive } from 'vue'

/**
 * 应用更新状态：唯一数据源在主进程（electron/ipc/appUpdater.js），
 * 这里只做「订阅状态 + 转发命令」，不自己判断版本、也不自己拼下载地址。
 * 好处是关掉设置页、切到别的视图都不会丢进度，下载全程在后台进行。
 */

const state = reactive({
  status: 'idle', // idle | available | downloading | ready | installing | error
  currentVersion: '',
  latestVersion: '',
  releaseUrl: '',
  platform: '',
  arch: '',
  installMode: 'open-page', // silent | open-file | open-page
  assetName: '',
  totalBytes: 0,
  receivedBytes: 0,
  percent: 0,
  bytesPerSecond: 0,
  fileName: '',
  message: '',
  availableAt: 0
})

let inited = false
let dispose = null

const api = () => window.electronAPI?.updater

export const updateState = state

export const isSupported = () => Boolean(api())

// 订阅主进程状态推送，并同步一次当前状态（页面刷新/重开后也能接上已有进度）
export const initUpdateService = async () => {
  if (inited || !api()) return
  inited = true
  dispose = api().onState?.((next) => {
    if (next && typeof next === 'object') Object.assign(state, next)
  })
  try {
    const current = await api().getState()
    if (current && typeof current === 'object') Object.assign(state, current)
  } catch (e) { /* 主进程未就绪时静默，后续推送会补上 */ }
}

export const disposeUpdateService = () => {
  try { dispose?.() } catch (e) { /* 已注销 */ }
  dispose = null
  inited = false
}

// 手动检查更新：结果直接回填状态，UI 只看 state
export const checkUpdate = async () => {
  if (!api()) return { success: false, message: '当前环境不支持检查更新' }
  return api().check()
}

// 后台下载最新安装包
export const downloadUpdate = async () => {
  if (!api()) return { success: false, message: '当前环境不支持自动下载' }
  return api().download()
}

export const cancelDownload = async () => {
  if (!api()) return { success: false }
  return api().cancel()
}

// 重启并安装（静默安装形态）或打开安装包（deb/rpm 等交给系统包管理器）
export const installUpdate = async () => {
  if (!api()) return { success: false, message: '当前环境不支持自动安装' }
  return api().install()
}

// 没有适配当前系统的安装包时，退回 Release 下载页
export const openReleasePage = async () => {
  if (api()) return api().openReleasePage()
  if (state.releaseUrl) window.open(state.releaseUrl, '_blank')
  return { success: true }
}

export const formatBytes = (bytes) => {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
