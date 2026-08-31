/**
 * 统一 localStorage 封装
 * 所有持久化读写统一走这里，方便后续切换存储方案（IndexedDB 等）
 */

const PREFIX = 'mm_'

function safe(fn, fallback) {
  try { return fn() } catch (e) { console.warn('[storage]', e.message); return fallback }
}

export const storage = {
  get(key, fallback = null) {
    return safe(() => {
      const raw = localStorage.getItem(PREFIX + key)
      if (raw === null || raw === undefined) return fallback
      try { return JSON.parse(raw) } catch { return raw }
    }, fallback)
  },

  set(key, value) {
    return safe(() => {
      const v = typeof value === 'string' ? value : JSON.stringify(value)
      localStorage.setItem(PREFIX + key, v)
      return true
    }, false)
  },

  remove(key) {
    return safe(() => localStorage.removeItem(PREFIX + key), false)
  },

  has(key) {
    return safe(() => localStorage.getItem(PREFIX + key) !== null, false)
  },

  keys() {
    return safe(() => {
      const ks = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(PREFIX)) ks.push(k.slice(PREFIX.length))
      }
      return ks
    }, [])
  },

  clear() {
    return safe(() => {
      const ks = []
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i)
        if (k && k.startsWith(PREFIX)) { localStorage.removeItem(k); ks.push(k) }
      }
      return ks.length
    }, 0)
  }
}

export default storage
