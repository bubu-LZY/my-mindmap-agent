/**
 * 更新检测：程序启动后 + 运行中每 6 小时，查询 GitHub 最新 release 并对比版本号。
 * - 无更新 / 检测失败（网络异常等）→ 静默，不做任何提示。
 * - 检测到新版本（GitHub tag 大于当前版本）→ 通过 webContents 通知渲染进程弹提示。
 * 提示的「今日不再提醒」等交互逻辑由渲染进程处理，这里只负责检测与通知。
 */

const { app, ipcMain } = require('electron')
const https = require('https')

const REPO = 'bubu-LZY/my-mindmap-agent'
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 小时
const INITIAL_DELAY_MS = 10 * 1000 // 启动后延迟 10 秒，等窗口加载完成
const REQUEST_TIMEOUT_MS = 10 * 1000

let getMainWindow = null
let timer = null

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

// 查询 GitHub 最新 release（仅取 tag_name 与 html_url）
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
            resolve({ tagName: json?.tag_name || '', url: json?.html_url || '' })
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

const check = async () => {
  try {
    const { tagName, url } = await fetchLatestRelease()
    if (!tagName) return
    const current = app.getVersion()
    if (compareVersions(tagName, current) <= 0) return // 无新版本，静默
    const win = getMainWindow?.()
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('update-available', {
        currentVersion: current,
        latestVersion: tagName,
        url: url || `https://github.com/${REPO}/releases/latest`
      })
    }
  } catch (e) {
    // 网络异常 / 检测失败：静默，不提示
  }
}

// 手动检查更新：返回明确结果（供设置页「手动检查更新」按钮使用）
const checkManually = async () => {
  try {
    const { tagName, url } = await fetchLatestRelease()
    if (!tagName) return { success: false, message: '未获取到版本信息' }
    const current = app.getVersion()
    const hasUpdate = compareVersions(tagName, current) > 0
    return {
      success: true,
      hasUpdate,
      currentVersion: current,
      latestVersion: tagName,
      url: url || `https://github.com/${REPO}/releases/latest`
    }
  } catch (e) {
    return { success: false, message: e?.message || '检查更新失败（网络异常）' }
  }
}

const initUpdateChecker = (getWin) => {
  getMainWindow = getWin
  stopUpdateChecker()
  setTimeout(check, INITIAL_DELAY_MS)
  timer = setInterval(check, CHECK_INTERVAL_MS)
}

const stopUpdateChecker = () => {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { initUpdateChecker, stopUpdateChecker, check, compareVersions, checkManually }

// 渲染进程手动触发更新检查
ipcMain.handle('update-check', async () => checkManually())
