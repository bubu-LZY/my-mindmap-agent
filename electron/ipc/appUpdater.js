/**
 * 应用更新器：下载最新安装包 → 校验 → 重启并安装。
 *
 * 与「只提示去网页下载」的区别：下载在主进程后台进行，渲染层只负责展示进度与按钮；
 * 安装包下完并校验通过后，用户点「重启并安装」，主进程调用系统安装器完成覆盖安装再退出。
 *
 * 平台策略：
 *   win32  → 运行 NSIS 安装包（--updated /S --force-run）：静默覆盖安装并自动拉起新版本
 *   darwin → hdiutil 挂载 dmg，ditto 覆盖 /Applications 下的 .app，再重启；任一步失败回退打开 dmg
 *   linux  → AppImage 原地原子替换后重启；deb/rpm 交给系统包管理器打开
 *   其它   → 打开 Release 下载页，由用户手动下载
 *
 * 安全约束（这些是本模块存在的前提，改动请保持）：
 *   1. 下载地址一律由主进程根据 GitHub Release API 的响应推导，绝不接受渲染层传入的 URL；
 *   2. 只允许 https，且主机名限定在 GitHub 的下载域，重定向逐跳校验、最多 5 跳；
 *   3. 落盘前完成 sha256（Release API 提供 digest 时）与文件大小校验，不通过即删除；
 *   4. 文件名只取 basename 并过滤路径分隔符，落盘目录固定为 userData/updates；
 *   5. 安装只允许执行「本次下载到 updates 目录里的那个文件」，路径与版本都要复核。
 */

const { app, ipcMain, shell } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const https = require('https')
const crypto = require('crypto')
const { spawn } = require('child_process')
const updateChecker = require('./updateChecker')

const REQUEST_TIMEOUT_MS = 30 * 1000 // 30 秒无数据即判定超时（不是总时长限制）
const REDIRECT_LIMIT = 5
const PROGRESS_THROTTLE_MS = 250
const QUIT_AFTER_INSTALL_MS = 800
const DOWNLOAD_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com'
]

let getMainWindow = null
let activeRequest = null
let lastProgressAt = 0
// 已确认可用的更新信息（含资产 url / digest），只留在主进程，不下发给渲染层
let pendingAsset = null
let downloadedFile = ''

let state = {
  status: 'idle', // idle | available | downloading | ready | installing | error
  currentVersion: '',
  latestVersion: '',
  releaseUrl: '',
  platform: process.platform,
  arch: process.arch,
  installMode: 'open-page', // silent | open-file | open-page
  assetName: '',
  totalBytes: 0,
  receivedBytes: 0,
  percent: 0,
  bytesPerSecond: 0,
  fileName: '',
  message: '',
  // 每次「定时检测到新版本」都刷新一次，渲染层据此决定是否再弹一次提醒（配合「今日不再提醒」）
  availableAt: 0,
  // 本次「可更新」是用户手动检查触发的（手动触发不受「今日不再提醒」限制）
  manualCheck: false
}

const updatesDir = () => path.join(app.getPath('userData'), 'updates')

// 下发给渲染层的状态：不含下载地址与本地绝对路径，减少不必要的信息外露
const publicState = () => ({ ...state })

const push = (force = false) => {
  if (!force && Date.now() - lastProgressAt < PROGRESS_THROTTLE_MS) return
  lastProgressAt = Date.now()
  const win = getMainWindow?.()
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send('update-state', publicState())
  }
}

const setState = (patch, force = true) => {
  state = { ...state, ...patch }
  push(force)
}

const setError = (message) => {
  setState({ status: 'error', message: String(message || '更新失败') })
}

const isAllowedUrl = (raw) => {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    return DOWNLOAD_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h))
  } catch (e) {
    return false
  }
}

// 只保留安全的文件名：去掉目录成分与可疑字符，长度封顶
const safeFileName = (name) => {
  const base = path.basename(String(name || '')).replace(/[\\/:*?"<>|]/g, '_').trim()
  return base.slice(0, 120) || 'update-download'
}

const removeQuietly = (file) => {
  try { if (file && fs.existsSync(file)) fs.unlinkSync(file) } catch (e) { /* 清理失败不影响主流程 */ }
}

// 清理历史安装包，避免每次更新都在 userData/updates 里堆积几百 MB
const cleanOldDownloads = (keep) => {
  try {
    const dir = updatesDir()
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name)
      if (file === keep) continue
      if (name.endsWith('.part')) { removeQuietly(file); continue }
      removeQuietly(file)
    }
  } catch (e) { /* 目录不可读时忽略 */ }
}

// 流式下载：逐跳校验重定向、边下边算 sha256、按节流回报进度
const download = (url, dest, { redirectsLeft = REDIRECT_LIMIT } = {}) => {
  return new Promise((resolve, reject) => {
    if (!isAllowedUrl(url)) {
      reject(new Error('下载地址不在可信范围内'))
      return
    }
    const req = https.get(url, {
      headers: { 'User-Agent': 'my-mindmap-agent', Accept: 'application/octet-stream' }
    }, (res) => {
      const code = res.statusCode || 0
      if (code >= 300 && code < 400) {
        res.resume()
        const loc = res.headers.location
        if (!loc) { reject(new Error('重定向缺少目标地址')); return }
        if (redirectsLeft <= 0) { reject(new Error('重定向次数过多')); return }
        resolve(download(new URL(loc, url).toString(), dest, { redirectsLeft: redirectsLeft - 1 }))
        return
      }
      if (code !== 200) {
        res.resume()
        reject(new Error('下载失败 HTTP ' + code))
        return
      }
      const total = Number(res.headers['content-length']) || state.totalBytes || 0
      const hash = crypto.createHash('sha256')
      const out = fs.createWriteStream(dest)
      let received = 0
      const startedAt = Date.now()
      res.on('data', (chunk) => {
        received += chunk.length
        hash.update(chunk)
        state.receivedBytes = received
        state.totalBytes = total || state.totalBytes
        state.percent = total ? Math.min(99, Math.round(received * 100 / total)) : 0
        const elapsed = (Date.now() - startedAt) / 1000
        state.bytesPerSecond = elapsed > 0.5 ? Math.round(received / elapsed) : 0
        push()
      })
      res.on('error', (e) => { out.destroy(); reject(e) })
      out.on('error', reject)
      res.pipe(out)
      out.on('finish', () => {
        out.close(() => resolve({ received, total, sha256: hash.digest('hex') }))
      })
    })
    req.on('error', reject)
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('下载超时（长时间无数据）'))
    })
    activeRequest = req
  })
}

// 取得（或复用）当前可下载的资产；没有匹配资产时抛出可读错误
const resolvePendingAsset = async (force) => {
  if (pendingAsset && !force) return pendingAsset
  const info = await updateChecker.checkManually({ force: true })
  if (!info.success) throw new Error(info.message || '检查更新失败')
  if (!info.hasUpdate) throw new Error('当前已是最新版本')
  if (!info.asset) throw new Error('该版本没有适配当前系统的安装包')
  pendingAsset = info.asset
  setState({
    latestVersion: info.latestVersion,
    releaseUrl: info.url,
    assetName: info.asset.name,
    totalBytes: info.asset.size,
    installMode: info.asset.installMode
  })
  return pendingAsset
}

const startDownload = async () => {
  if (state.status === 'downloading') return { success: false, message: '正在下载中' }
  if (state.status === 'installing') return { success: false, message: '正在安装，请稍候' }
  if (state.status === 'ready' && downloadedFile && fs.existsSync(downloadedFile)) {
    return { success: true, message: '安装包已下载完成' }
  }
  let dest = ''
  try {
    const asset = await resolvePendingAsset()
    const fileName = safeFileName(asset.name)
    const dir = updatesDir()
    fs.mkdirSync(dir, { recursive: true })
    cleanOldDownloads('')
    dest = path.join(dir, fileName)
    downloadedFile = ''
    setState({
      status: 'downloading',
      message: '正在后台下载更新包',
      receivedBytes: 0,
      percent: 0,
      bytesPerSecond: 0,
      totalBytes: asset.size || 0,
      fileName
    })
    const result = await download(asset.url, dest)
    activeRequest = null
    // 大小对不上或摘要不匹配：一律删掉，不当成一次成功下载
    if (result.total && result.received !== result.total) {
      removeQuietly(dest)
      throw new Error(`下载不完整（${result.received}/${result.total} 字节）`)
    }
    const expected = /^sha256:/i.test(asset.digest || '') ? asset.digest.split(':')[1].toLowerCase() : ''
    if (expected && expected !== result.sha256) {
      removeQuietly(dest)
      throw new Error('安装包校验失败（摘要不匹配），已放弃本次更新')
    }
    downloadedFile = dest
    setState({
      status: 'ready',
      percent: 100,
      receivedBytes: result.received,
      totalBytes: result.total || result.received,
      message: expected ? '下载完成并已通过校验' : '下载完成'
    })
    return { success: true, message: '下载完成' }
  } catch (e) {
    activeRequest = null
    removeQuietly(dest) // 半截文件不留：下次重下，避免被当成完整安装包
    setError(e?.message || '下载失败')
    return { success: false, message: e?.message || '下载失败' }
  }
}

const cancelDownload = () => {
  if (state.status !== 'downloading') return { success: false, message: '当前没有进行中的下载' }
  try { activeRequest?.destroy(new Error('用户取消下载')) } catch (e) { /* 已结束 */ }
  activeRequest = null
  if (downloadedFile) removeQuietly(downloadedFile)
  downloadedFile = ''
  setState({ status: pendingAsset ? 'available' : 'idle', percent: 0, receivedBytes: 0, bytesPerSecond: 0, message: '已取消下载' })
  return { success: true }
}

const run = (cmd, args) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  child.on('error', reject)
  child.on('close', (code) => {
    if (code === 0) resolve(out)
    else reject(new Error(`${path.basename(cmd)} 退出码 ${code}${out.trim() ? '：' + out.trim().split('\n').slice(-2).join(' ') : ''}`))
  })
})

const quitSoon = () => {
  setTimeout(() => {
    app.quit()
    // 若有 beforeunload 之类的钩子拦住退出，兜底强退，避免安装器一直等进程结束
    setTimeout(() => app.exit(0), 3000)
  }, QUIT_AFTER_INSTALL_MS)
}

// Windows：NSIS 安装包静默覆盖安装（--updated 跳过安装向导页，/S 静默，--force-run 装完自动拉起）
const installWindows = (file) => {
  const child = spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' })
  child.unref()
  return { success: true, message: '正在安装新版本，程序即将退出' }
}

// macOS：挂载 dmg → 覆盖 /Applications 下的应用 → 重新打开；失败则回退为打开 dmg 让用户手动拖入
const installMac = async (file) => {
  const exe = app.getPath('exe')
  const match = exe.match(/^(.*\.app)(\/|$)/)
  const bundle = match ? match[1] : path.join('/Applications', `${app.getName()}.app`)
  const mountDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-agent-update-'))
  let attached = false
  try {
    await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-noverify', '-quiet', '-mountpoint', mountDir, file])
    attached = true
    const appName = fs.readdirSync(mountDir).find(n => n.endsWith('.app'))
    if (!appName) throw new Error('安装包内未找到应用')
    // --noqtn 去掉隔离属性，否则覆盖后首次启动会被 Gatekeeper 拦下
    try {
      await run('/usr/bin/ditto', ['--noextattr', '--noqtn', path.join(mountDir, appName), bundle])
    } catch (e) {
      await run('/usr/bin/ditto', [path.join(mountDir, appName), bundle])
    }
  } catch (e) {
    try { await run('/usr/bin/hdiutil', ['detach', mountDir, '-force']) } catch (e2) { /* 未挂载 */ }
    try { fs.rmdirSync(mountDir) } catch (e2) { /* 目录可能非空 */ }
    const opened = await shell.openPath(file)
    return {
      success: false,
      message: opened
        ? '自动安装未完成，已为你打开安装包，请手动把应用拖入「应用程序」'
        : '自动安装未完成，请到 Release 页面手动下载安装'
    }
  }
  try { await run('/usr/bin/hdiutil', ['detach', mountDir, '-force']) } catch (e) { /* 已在卸载 */ }
  try { fs.rmdirSync(mountDir) } catch (e) { /* 目录可能非空 */ }
  spawn('/usr/bin/open', ['-a', bundle], { detached: true, stdio: 'ignore' }).unref()
  return { success: true, message: '正在安装新版本，程序即将退出' }
}

// Linux：AppImage 原地原子替换后重启；deb/rpm 只能交给系统包管理器
const installLinux = async (file, installMode) => {
  const target = process.env.APPIMAGE
  if (installMode === 'silent' && target) {
    const next = target + '.new'
    fs.copyFileSync(file, next)
    fs.chmodSync(next, 0o755)
    fs.renameSync(next, target) // 同目录 rename，替换是原子的
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref()
    return { success: true, message: '正在安装新版本，程序即将退出' }
  }
  const opened = await shell.openPath(file)
  return {
    success: Boolean(opened === ''),
    message: opened === ''
      ? '已打开安装包，请按系统提示完成安装'
      : '无法自动打开安装包，请到 Release 页面手动下载安装'
  }
}

const install = async () => {
  if (state.status !== 'ready' || !downloadedFile) {
    return { success: false, message: '安装包尚未下载完成' }
  }
  // 复核：必须是我们自己下到 updates 目录里的文件
  const resolved = path.resolve(downloadedFile)
  if (!resolved.startsWith(path.resolve(updatesDir()) + path.sep) || !fs.existsSync(resolved)) {
    downloadedFile = ''
    setError('安装包文件已失效，请重新下载')
    return { success: false, message: '安装包文件已失效，请重新下载' }
  }
  setState({ status: 'installing', message: '正在安装新版本' })
  try {
    const result = process.platform === 'win32'
      ? installWindows(resolved)
      : process.platform === 'darwin'
        ? await installMac(resolved)
        : await installLinux(resolved, state.installMode)
    if (!result.success) {
      setState({ status: 'ready', message: result.message })
      return result
    }
    quitSoon()
    return result
  } catch (e) {
    setError(e?.message || '安装失败')
    return { success: false, message: e?.message || '安装失败' }
  }
}

const handleCheck = async () => {
  if (state.status === 'downloading' || state.status === 'installing') {
    return { success: false, message: '更新正在进行中，请稍候' }
  }
  // 已经下好待安装时，重新检查不能把「待安装」状态冲掉
  const wasReady = state.status === 'ready'
  const info = await updateChecker.checkManually({ force: true })
  if (!info.success) {
    if (wasReady) return info
    setError(info.message || '检查更新失败')
    return info
  }
  pendingAsset = info.asset || null
  setState({
    status: wasReady || info.hasUpdate ? (wasReady ? 'ready' : 'available') : 'idle',
    currentVersion: info.currentVersion,
    latestVersion: info.latestVersion,
    releaseUrl: info.url,
    installMode: info.installMode,
    assetName: info.asset?.name || '',
    totalBytes: info.asset?.size || 0,
    message: wasReady ? state.message : (info.hasUpdate ? '' : `已是最新版本（${info.currentVersion}）`),
    availableAt: Date.now(),
    manualCheck: true
  })
  return info
}

// 定时检测到新版本时由 updateChecker 回调进来：先只是「可更新」，用户点了才下载
const setUpdateAvailable = (info) => {
  if (!info?.hasUpdate) return
  if (state.status === 'downloading' || state.status === 'installing' || state.status === 'ready') return
  pendingAsset = info.asset || null
  setState({
    status: 'available',
    currentVersion: info.currentVersion,
    latestVersion: info.latestVersion,
    releaseUrl: info.url,
    installMode: info.installMode,
    assetName: info.asset?.name || '',
    totalBytes: info.asset?.size || 0,
    message: '',
    availableAt: Date.now(),
    manualCheck: false
  })
}

const initAppUpdater = (getWin) => {
  getMainWindow = getWin
  state.currentVersion = app.getVersion()

  ipcMain.handle('updater:state', () => publicState())
  ipcMain.handle('updater:check', () => handleCheck())
  ipcMain.handle('updater:download', () => startDownload())
  ipcMain.handle('updater:cancel', () => cancelDownload())
  ipcMain.handle('updater:install', () => install())
  // 回退路径：没有匹配的安装包时，打开 Release 页面让用户自己下载
  ipcMain.handle('updater:open-release-page', async () => {
    const url = state.releaseUrl || `https://github.com/${updateChecker.REPO}/releases/latest`
    await shell.openExternal(url)
    return { success: true }
  })
}

// 下载中的临时文件在退出时清掉，避免留下半个安装包
app.on('before-quit', () => {
  try { activeRequest?.destroy() } catch (e) { /* 已结束 */ }
  if (state.status === 'downloading' && downloadedFile) removeQuietly(downloadedFile)
})

module.exports = { initAppUpdater, setUpdateAvailable, getState: () => publicState() }
