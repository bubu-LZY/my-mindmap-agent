/**
 * 密码门禁模块
 * - 使用 PBKDF2 哈希存储密码
 * - 3 次错误锁定 5 分钟
 * - 会话令牌 30 分钟有效期
 */
const { ipcMain, safeStorage } = require('electron')
const crypto = require('crypto')
const store = require('../utils/store')

const PASSWORD_CONFIG_KEY = 'password_gate_config'

// 配置：可根据需要调整
const MAX_ATTEMPTS = 3           // 最大尝试次数
const LOCK_DURATION_MS = 5 * 60 * 1000  // 锁定时长 5 分钟
const SESSION_DURATION_MS = 30 * 60 * 1000  // 会话有效期 30 分钟

// 内存状态
let failedAttempts = 0
let lockedUntil = 0
let sessionToken = null
let sessionExpiresAt = 0

/**
 * 获取密码配置
 */
function getPasswordConfig() {
  return store.get(PASSWORD_CONFIG_KEY) || {
    enabled: false,
    passwordHash: null,
    createdAt: null
  }
}

/**
 * 保存密码配置
 */
function savePasswordConfig(config) {
  store.set(PASSWORD_CONFIG_KEY, config)
}

/**
 * 简单的 bcrypt 替代实现（使用 PBKDF2 + salt）
 * 避免引入额外的原生依赖
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
  return { salt, hash, iterations: 100000 }
}

function verifyPassword(password, stored) {
  if (!stored || !stored.salt || !stored.hash) return false
  const hash = crypto.pbkdf2Sync(password, stored.salt, stored.iterations || 100000, 64, 'sha512').toString('hex')
  // 使用 timingSafeEqual 防止时序攻击
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(stored.hash, 'hex'))
  } catch {
    return false
  }
}

/**
 * 生成会话令牌
 */
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * 检查是否被锁定
 */
function isLocked() {
  if (lockedUntil && Date.now() < lockedUntil) {
    return true
  }
  // 锁定已过期，重置
  if (lockedUntil && Date.now() >= lockedUntil) {
    lockedUntil = 0
    failedAttempts = 0
  }
  return false
}

/**
 * 记录失败尝试
 */
function recordFailedAttempt() {
  failedAttempts++
  if (failedAttempts >= MAX_ATTEMPTS) {
    lockedUntil = Date.now() + LOCK_DURATION_MS
    failedAttempts = 0
  }
}

/**
 * 重置失败计数
 */
function resetAttempts() {
  failedAttempts = 0
  lockedUntil = 0
}

/**
 * 验证会话令牌
 */
function validateSession(token) {
  if (!token || !sessionToken || Date.now() >= sessionExpiresAt) {
    sessionToken = null
    sessionExpiresAt = 0
    return false
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(sessionToken, 'hex'))
  } catch {
    return false
  }
}

/**
 * 刷新会话（如果还有效的话）
 */
function refreshSession(token) {
  if (validateSession(token)) {
    sessionExpiresAt = Date.now() + SESSION_DURATION_MS
    return true
  }
  return false
}

// ========== IPC 处理 ==========

// 检查密码是否已设置
ipcMain.handle('password:isEnabled', () => {
  const config = getPasswordConfig()
  return { enabled: config.enabled && !!config.passwordHash }
})

// 设置密码（首次设置或修改密码，需要验证旧密码）
ipcMain.handle('password:set', async (event, { oldPassword, newPassword }) => {
  try {
    const config = getPasswordConfig()

    // 如果已经设置了密码，需要验证旧密码
    if (config.enabled && config.passwordHash) {
      if (isLocked()) {
        return { success: false, error: '尝试次数过多，请 5 分钟后再试', locked: true }
      }
      if (!oldPassword || !verifyPassword(oldPassword, config.passwordHash)) {
        recordFailedAttempt()
        return { success: false, error: '旧密码错误', attemptsLeft: MAX_ATTEMPTS - failedAttempts }
      }
    }

    // 验证新密码强度
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return { success: false, error: '密码长度至少 6 位' }
    }
    if (newPassword.length > 128) {
      return { success: false, error: '密码长度不能超过 128 位' }
    }

    // 哈希新密码
    const passwordHash = hashPassword(newPassword)

    // 保存配置
    savePasswordConfig({
      enabled: true,
      passwordHash,
      createdAt: Date.now()
    })

    // 重置失败计数
    resetAttempts()

    // 创建新会话
    sessionToken = generateSessionToken()
    sessionExpiresAt = Date.now() + SESSION_DURATION_MS

    return { success: true, sessionToken, expiresAt: sessionExpiresAt }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// 验证密码（解锁）
ipcMain.handle('password:verify', async (event, { password }) => {
  try {
    const config = getPasswordConfig()

    if (!config.enabled || !config.passwordHash) {
      return { success: false, error: '密码未设置' }
    }

    if (isLocked()) {
      return { success: false, error: '尝试次数过多，请 5 分钟后再试', locked: true }
    }

    if (!password || !verifyPassword(password, config.passwordHash)) {
      recordFailedAttempt()
      const locked = failedAttempts === 0 && lockedUntil > 0
      return {
        success: false,
        error: locked ? '尝试次数过多，请 5 分钟后再试' : '密码错误',
        attemptsLeft: locked ? 0 : MAX_ATTEMPTS - failedAttempts,
        locked
      }
    }

    // 验证成功，重置计数并创建会话
    resetAttempts()
    sessionToken = generateSessionToken()
    sessionExpiresAt = Date.now() + SESSION_DURATION_MS

    return { success: true, sessionToken, expiresAt: sessionExpiresAt }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// 验证会话
ipcMain.handle('password:validateSession', async (event, { token }) => {
  const valid = validateSession(token)
  if (valid) {
    // 刷新会话
    sessionExpiresAt = Date.now() + SESSION_DURATION_MS
  }
  return { valid, expiresAt: sessionExpiresAt }
})

// 登出（清除会话）
ipcMain.handle('password:logout', async () => {
  sessionToken = null
  sessionExpiresAt = 0
  return { success: true }
})

// 检查锁定状态
ipcMain.handle('password:getLockStatus', async () => {
  const locked = isLocked()
  return {
    locked,
    lockedUntil: locked ? lockedUntil : null,
    attemptsLeft: locked ? 0 : MAX_ATTEMPTS - failedAttempts
  }
})

// 供内部使用：验证会话有效性
function isSessionValid(token) {
  return validateSession(token)
}

module.exports = {
  isSessionValid,
  getPasswordConfig
}
