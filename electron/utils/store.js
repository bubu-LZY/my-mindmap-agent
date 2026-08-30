const Store = require('electron-store')
const fs = require('fs')
const path = require('path')

const store = new Store()

// Windows 下 electron-store（底层 conf）用 atomically 做原子写入：
// 先写 config.json.tmp-xxx 再 rename 到 config.json。目标文件被防病毒实时扫描 /
// 文件索引服务等短暂锁定时，rename 会抛 EPERM（conf 只对 EXDEV 降级，EPERM 直接抛）。
// 这里包装 set：先重试，重试耗尽后降级为「直接写文件」绕过 rename，保证设置能正常保存。
function syncSleep(ms) {
  try {
    const sab = new SharedArrayBuffer(4)
    Atomics.wait(new Int32Array(sab), 0, 0, ms)
  } catch (e) {
    // Atomics.wait 不可用（极少数环境）时退化为忙等
    const end = Date.now() + ms
    while (Date.now() < end) { /* busy wait */ }
  }
}

// 降级：直接把内存中的完整配置序列化写入 config.json（绕过原子 rename）
function directWrite() {
  // conf 的序列化格式：JSON.stringify(value, undefined, '\t')，缩进与缩进字符保持一致
  const data = JSON.stringify(store.store, undefined, '\t')
  fs.mkdirSync(path.dirname(store.path), { recursive: true })
  fs.writeFileSync(store.path, data, { mode: 0o600 })
}

const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'EXDEV'])

const originalSet = store.set.bind(store)
store.set = function (key, value, options) {
  try {
    return originalSet(key, value, options)
  } catch (e) {
    if (!(e && RETRYABLE_CODES.has(e.code))) throw e
    // 先重试：覆盖短暂锁定（30ms ~ 150ms）
    let lastErr = e
    for (let i = 0; i < 5; i++) {
      syncSleep(30 * (i + 1))
      try {
        return originalSet(key, value, options)
      } catch (e2) {
        lastErr = e2
        if (!(e2 && RETRYABLE_CODES.has(e2.code))) throw e2
      }
    }
    // 重试耗尽：降级为直接写文件
    try {
      directWrite()
      return
    } catch (e3) {
      // 直接写也失败，抛最后一次错误
      throw lastErr
    }
  }
}

// AI 请求超时时长（毫秒）：默认 5 分钟，可在设置中配置（单位秒，限制 30 秒 ~ 1 小时）
function getAiTimeoutMs() {
  const seconds = Number(store.get('aiTimeoutSeconds', 300)) || 300
  return Math.min(Math.max(seconds, 30), 3600) * 1000
}

module.exports = store
module.exports.getAiTimeoutMs = getAiTimeoutMs
