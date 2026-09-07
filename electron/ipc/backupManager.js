/**
 * 一键备份 / 恢复
 *
 * 导出：收集 AI 记忆、MCP 配置、Skills 配置、自定义工具（手动添加）、大模型配置，
 *      用用户密码 AES-256-GCM 加密后打包成单个 zip 文件。
 * 导入：拖入 zip，输入密码，自动解密并恢复全部配置。
 *
 * 备份文件结构（zip 内只有一个 backup.json）：
 *   { v, salt, iv, authTag, data }  → data 为 AES-256-GCM 加密后的 JSON（明文见 collectPayload）
 */

const { ipcMain, app, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const JSZip = require('jszip')
const store = require('../utils/store')
const { readConfig, writeConfig } = require('./aiConfig')

const BACKUP_VERSION = 1
const PBKDF2_ITERATIONS = 120000
const KEY_LENGTH = 32

// ===== 工具函数 =====

// 递归读取目录，返回 { '相对路径': base64内容 }；目录不存在返回空对象
function readDirRecursive(dir) {
  const out = {}
  try {
    if (!fs.existsSync(dir)) return out
    const walk = (cur, base) => {
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        const abs = path.join(cur, entry.name)
        const rel = base ? `${base}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          walk(abs, rel)
        } else if (entry.isFile()) {
          try {
            out[rel] = fs.readFileSync(abs).toString('base64')
          } catch { /* 忽略单个文件读取失败 */ }
        }
      }
    }
    walk(dir, '')
  } catch { /* 目录读取失败返回空 */ }
  return out
}

// 把 { '相对路径': base64内容 } 写回目录（先清空目标目录，避免残留旧文件）
function writeDirRecursive(dir, files) {
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    for (const [rel, b64] of Object.entries(files || {})) {
      const abs = path.join(dir, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, Buffer.from(b64, 'base64'))
    }
  } catch (e) {
    throw new Error(`写回目录失败：${e.message}`)
  }
}

// 收集全部待备份数据
function collectPayload(memoryText) {
  return {
    app: 'my-mindmap-agent',
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    memory: typeof memoryText === 'string' ? memoryText : '',
    aiConfig: readConfig(),
    mcpServers: store.get('mcpServers', []) || [],
    skills: store.get('agentSkills', []) || [],
    customToolsOverrides: store.get('customToolsOverrides', {}) || {},
    customToolsDir: readDirRecursive(path.join(app.getPath('userData'), 'custom-tools')),
    skillsDir: readDirRecursive(path.join(app.getPath('userData'), 'skills')),
  }
}

// 用密码 AES-256-GCM 加密 JSON
function encryptPayload(payload, password) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    v: BACKUP_VERSION,
    app: payload.app,
    exportedAt: payload.exportedAt,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: encrypted.toString('base64'),
  }
}

// 用密码 AES-256-GCM 解密
function decryptPayload(envelope, password) {
  if (!envelope || envelope.v !== BACKUP_VERSION) throw new Error('备份文件版本不支持')
  const salt = Buffer.from(envelope.salt, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const authTag = Buffer.from(envelope.authTag, 'base64')
  const encrypted = Buffer.from(envelope.data, 'base64')
  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}

// 恢复数据到本地（memory 不在此处理，返回给前端写 localStorage）
function restorePayload(payload) {
  if (payload.aiConfig && typeof payload.aiConfig === 'object') writeConfig(payload.aiConfig)
  if (Array.isArray(payload.mcpServers)) store.set('mcpServers', payload.mcpServers)
  if (Array.isArray(payload.skills)) store.set('agentSkills', payload.skills)
  if (payload.customToolsOverrides && typeof payload.customToolsOverrides === 'object') store.set('customToolsOverrides', payload.customToolsOverrides)
  if (payload.customToolsDir && typeof payload.customToolsDir === 'object') {
    writeDirRecursive(path.join(app.getPath('userData'), 'custom-tools'), payload.customToolsDir)
  }
  if (payload.skillsDir && typeof payload.skillsDir === 'object') {
    writeDirRecursive(path.join(app.getPath('userData'), 'skills'), payload.skillsDir)
  }
  return { memory: payload.memory || '' }
}

// ===== IPC =====

// 导出：{ password, memory } → 保存 zip，返回 { success, filePath }
ipcMain.handle('backup:export', async (event, args = {}) => {
  try {
    const password = String(args.password || '')
    if (!password) return { success: false, message: '请先输入密码' }
    const payload = collectPayload(args.memory)
    const envelope = encryptPayload(payload, password)

    const zip = new JSZip()
    zip.file('backup.json', JSON.stringify(envelope))
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出备份',
      defaultPath: `my-mindmap-agent-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP 备份文件', extensions: ['zip'] }],
    })
    if (canceled || !filePath) return { success: false, message: '已取消导出' }

    fs.writeFileSync(filePath, zipBuffer)
    return { success: true, filePath, message: `已导出备份：${filePath}` }
  } catch (e) {
    return { success: false, message: `导出失败：${e.message}` }
  }
})

// 导入：{ password, zipPath } → 解密并恢复，返回 { success, message, memory }
ipcMain.handle('backup:import', async (event, args = {}) => {
  try {
    const password = String(args.password || '')
    const zipPath = String(args.zipPath || '')
    if (!password) return { success: false, message: '请先输入密码' }
    if (!zipPath || !fs.existsSync(zipPath)) return { success: false, message: '备份文件不存在' }

    const buf = fs.readFileSync(zipPath)
    const zip = await JSZip.loadAsync(buf)
    const entry = zip.file('backup.json')
    if (!entry) return { success: false, message: '不是有效的备份文件（缺少 backup.json）' }
    const envelope = JSON.parse(await entry.async('string'))

    let payload
    try {
      payload = decryptPayload(envelope, password)
    } catch (e) {
      return { success: false, message: '密码错误，无法解密备份文件' }
    }

    const { memory } = restorePayload(payload)
    return {
      success: true,
      message: '导入成功：已恢复 AI 记忆、MCP、Skills、自定义工具与大模型配置',
      memory,
      summary: {
        mcpCount: (payload.mcpServers || []).length,
        skillCount: (payload.skills || []).length,
        toolFileCount: Object.keys(payload.customToolsDir || {}).length,
        aiProfileCount: ((payload.aiConfig && payload.aiConfig.profiles) || []).length,
      },
    }
  } catch (e) {
    return { success: false, message: `导入失败：${e.message}` }
  }
})

// 读取备份文件概要（拖入后预览，不要求密码）
ipcMain.handle('backup:preview', async (event, zipPath) => {
  try {
    if (!zipPath || !fs.existsSync(zipPath)) return { success: false, message: '文件不存在' }
    const buf = fs.readFileSync(zipPath)
    const zip = await JSZip.loadAsync(buf)
    const entry = zip.file('backup.json')
    if (!entry) return { success: false, message: '不是有效的备份文件' }
    const envelope = JSON.parse(await entry.async('string'))
    return {
      success: true,
      backupVersion: envelope.v,
      app: envelope.app || 'my-mindmap-agent',
      exportedAt: envelope.exportedAt || null,
    }
  } catch (e) {
    return { success: false, message: `读取备份信息失败：${e.message}` }
  }
})
