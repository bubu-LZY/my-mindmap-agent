/**
 * 信任模式：全局开关，开启后所有危险操作跳过二次确认，直接执行。
 * 两个开关（对话窗口 / 设置面板）共享同一个 localStorage 状态，任一开启即全局生效。
 */

const TRUST_KEY = 'mindmap_ai_trust_mode'
const TRUST_EXPIRES_KEY = 'mindmap_ai_trust_mode_expires'
const TRUST_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 读取信任模式状态
 */
export function isTrustMode() {
  try {
    if (localStorage.getItem(TRUST_KEY) !== 'true') return false
    const expires = Number(localStorage.getItem(TRUST_EXPIRES_KEY) || 0)
    if (expires && Date.now() > expires) {
      localStorage.removeItem(TRUST_KEY)
      localStorage.removeItem(TRUST_EXPIRES_KEY)
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * 设置信任模式状态
 */
export function setTrustMode(value) {
  try {
    if (value) {
      localStorage.setItem(TRUST_KEY, 'true')
      localStorage.setItem(TRUST_EXPIRES_KEY, String(Date.now() + TRUST_TTL_MS))
    } else {
      localStorage.removeItem(TRUST_KEY)
      localStorage.removeItem(TRUST_EXPIRES_KEY)
    }
  } catch {}
}

/**
 * 切换信任模式
 */
export function toggleTrustMode() {
  const next = !isTrustMode()
  setTrustMode(next)
  return next
}
