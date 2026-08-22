/**
 * 信任模式：全局开关，开启后所有危险操作跳过二次确认，直接执行。
 * 两个开关（对话窗口 / 设置面板）共享同一个 localStorage 状态，任一开启即全局生效。
 */

const TRUST_KEY = 'mindmap_ai_trust_mode'

/**
 * 读取信任模式状态
 */
export function isTrustMode() {
  try {
    return localStorage.getItem(TRUST_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * 设置信任模式状态
 */
export function setTrustMode(value) {
  try {
    localStorage.setItem(TRUST_KEY, value ? 'true' : 'false')
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