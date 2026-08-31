/**
 * 网络连通性监视（review #14/#22）
 *
 * 周期性 HEAD 请求到可靠外部地址，失败累积到阈值后标记离线：
 * - 默认 30 秒一次心跳
 * - 连续失败 3 次标记 offline，online 后立即发 online 信号
 * - 推送 channel: 'network:status' payload: { online, lastCheckAt, latencyMs, failStreak }
 *
 * 网络断开期间：search_web / read_webpage / aiChat 都会在渲染侧短路，
 *   返回明确错误 NETWORK_DOWN，UI 同时显示顶部横幅。
 *
 * 安全：HEAD 比 GET 小得多；不使用 google generate_204 是因为部分网络环境会拦截。
 */
const { ipcMain, BrowserWindow } = require('electron')

const HEARTBEAT_MS = 30 * 1000
const FAIL_THRESHOLD = 3
// 多 probe 路由（任何一个通就视为 online），覆盖不同地区
const PROBES = [
  'https://www.apple.com/library/test/success.html',
  'https://www.msftconnecttest.com/connecttest.txt',
  'https://api.openai.com'
]

function notifyAll(payload) {
  try {
    const wins = BrowserWindow.getAllWindows() || []
    for (const w of wins) {
      if (!w || w.isDestroyed()) continue
      try { w.webContents.send('network:status', payload) } catch (e) {}
    }
  } catch (e) {}
}

let monitorState = {
  online: true,           // 乐观默认开启；首次失败开始计数
  lastCheckAt: Date.now(),
  latencyMs: 0,
  failStreak: 0
}

let timer = null

async function probeOnce() {
  const start = Date.now()
  const controller = new AbortController()
  // 单次探测超时（不要等太久，否则恢复后通知慢）
  const localTimer = setTimeout(() => controller.abort(), 5000)
  try {
    const { net } = require('electron')
    // 依次尝试所有 probe，任何一个成功即视为在线（覆盖不同地区/网络环境）
    let lastError = null
    for (const url of PROBES) {
      try {
        const res = await net.fetch(url, { method: 'HEAD', signal: controller.signal })
        if (res && (res.status >= 200 && res.status < 500)) {
          clearTimeout(localTimer)
          // 4xx 视为网络可达（某些网关不响应 HEAD 是正常）
          onProbeSuccess(Date.now() - start)
          return true
        }
        lastError = 'unexpected status ' + res.status
      } catch (e) {
        lastError = e && e.message ? e.message : String(e)
        // 继续尝试下一个 probe
      }
    }
    clearTimeout(localTimer)
    onProbeFailure(lastError || 'all probes failed')
    return false
  } catch (e) {
    clearTimeout(localTimer)
    onProbeFailure(e && e.message ? e.message : String(e))
    return false
  }
}

function onProbeSuccess(latencyMs) {
  const wasOffline = !monitorState.online
  monitorState.online = true
  monitorState.failStreak = 0
  monitorState.latencyMs = latencyMs
  monitorState.lastCheckAt = Date.now()
  if (wasOffline) notifyAll(monitorState)
  else notifyAll(monitorState)  // 每次成功也推一份，UI 可以更新延迟
}

function onProbeFailure(reason) {
  monitorState.failStreak++
  monitorState.lastCheckAt = Date.now()
  if (monitorState.online && monitorState.failStreak >= FAIL_THRESHOLD) {
    monitorState.online = false
    notifyAll({ ...monitorState, reason })
  } else {
    notifyAll({ ...monitorState, reason })
  }
}

async function tick() {
  try { await probeOnce() } catch (e) {}
}

function start() {
  if (timer) return
  // 立即跑一次；后续每 HEARTBEAT_MS 一次
  tick()
  timer = setInterval(tick, HEARTBEAT_MS)
  // 进程退出兜底
  try {
    const { app } = require('electron')
    app.on('will-quit', () => { try { if (timer) clearInterval(timer) } catch (e) {} })
  } catch (e) {}
}

function stop() {
  if (timer) { try { clearInterval(timer) } catch (e) {} timer = null }
}

// 单次主动探测（供渲染层点"重试"时调用）
async function checkNow() {
  await tick()
  return monitorState
}

ipcMain.handle('network:checkNow', async () => checkNow())
ipcMain.handle('network:getState', () => monitorState)

module.exports = { start, stop, checkNow }
