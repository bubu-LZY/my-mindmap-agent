/**
 * 敏感字段加密存储工具（复用 aiConfig.js 的 safeStorage 策略）
 * 封装 Electron safeStorage（Windows 用 DPAPI / macOS 用 Keychain），
 * 加密后做回环校验，确保写入的可读回；系统加密不可用或解密失败时回退原值，绝不丢数据。
 */
const { safeStorage } = require('electron')

const ENC_PREFIX = 'enc:v1:'

// 加密单个字符串；已是密文/空值/系统加密不可用时原样返回
function encryptString(plain) {
  if (!plain) return plain
  if (typeof plain !== 'string' || plain.startsWith(ENC_PREFIX)) return plain
  try {
    if (!safeStorage.isEncryptionAvailable()) return plain
    const enc = ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
    // 回环校验：解不回来的绝不落盘
    return safeStorage.decryptString(Buffer.from(enc.slice(ENC_PREFIX.length), 'base64')) === plain ? enc : plain
  } catch {
    return plain
  }
}

// 解密单个字符串；非密文/解密失败原样返回（兼容明文旧值与系统密钥变更）
function decryptString(stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith(ENC_PREFIX)) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return stored
  }
}

// 加密对象中指定字段（返回新对象，不改原对象）
function encryptFields(obj, keys) {
  const out = { ...(obj || {}) }
  for (const k of keys) {
    if (typeof out[k] === 'string') out[k] = encryptString(out[k])
  }
  return out
}

// 解密对象中指定字段（返回新对象）
function decryptFields(obj, keys) {
  const out = { ...(obj || {}) }
  for (const k of keys) {
    if (typeof out[k] === 'string') out[k] = decryptString(out[k])
  }
  return out
}

module.exports = { encryptString, decryptString, encryptFields, decryptFields }
