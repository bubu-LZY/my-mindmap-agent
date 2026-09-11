/**
 * 云盘同步（rclone WebDAV）：把本地默认保存目录镜像同步到云盘指定文件夹。
 * 渲染进程保存 .smm 后触发，主进程 spawn rclone.exe 执行 sync。
 *
 * 同步语义：单向镜像（本地为源），本地目录下所有文件/子目录结构与云端文件夹保持一致，
 * 本地新增/修改/删除都会同步到云端对应位置。
 *
 * 凭据边界：密码与 rclone 可执行文件路径都存在主进程（electron-store + safeStorage），
 * 渲染进程只能拿到掩码。原因是这两项一旦交给渲染层就等于给了 XSS 两个现成的落点——
 * 密码可被直接读走，rclonePath 可被替换成任意 exe 从而拿到本地代码执行。
 * rclone:sync 不接受这两个字段，一律用主进程存的值。
 */

const { ipcMain, app } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const store = require('../utils/store')
const { encryptString, decryptString } = require('../utils/secureStore')

const STORE_KEY = 'cloudSyncConfig'

// 与 fileManager 保持一致的默认保存目录
const DEFAULT_SAVE_DIR = 'C:\\我的mindmap'
const getDefaultSaveDir = () => app.defaultSaveDir || DEFAULT_SAVE_DIR

// 掩码显示：绝不把明文密码回传渲染进程
const MASK_MARK = '****'
const maskPass = (pass) => (pass ? MASK_MARK : '')
const isMasked = (value) => typeof value === 'string' && value.includes(MASK_MARK)

const defaultConfig = () => ({
  enabled: false,
  vendor: 'custom',
  url: '',
  user: '',
  pass: '', // 落盘时为 safeStorage 密文
  remoteDir: '',
  rclonePath: 'rclone'
})

// 读主进程配置（pass 已解密，仅在主进程内使用，不可外传）
function readConfig() {
  const raw = store.get(STORE_KEY) || {}
  const cfg = { ...defaultConfig(), ...raw }
  cfg.pass = decryptString(cfg.pass) || ''
  return cfg
}

// 只回传非敏感字段 + 掩码，供设置页渲染
function toPublicConfig(cfg) {
  const { pass, ...rest } = cfg
  return { ...rest, pass: maskPass(pass), hasPass: !!pass }
}

// 校验 rclone 路径：只允许裸命令名或 .exe，避免被替换成脚本/任意可执行体
function assertRclonePath(p) {
  const s = String(p || '').trim()
  if (!s) return 'rclone'
  // 控制字符（含 NUL 截断）不应出现在可执行文件路径里
  if (/[\x00-\x1f\x7f]/.test(s)) throw new Error('rclone 路径包含非法控制字符')
  const base = path.basename(s)
  // 裸命令名（走 PATH）或 .exe 绝对路径
  if (!/[\\/]/.test(s)) return s
  const ext = path.extname(base).toLowerCase()
  if (ext !== '.exe') {
    throw new Error(`rclone 路径必须是 .exe 可执行文件，当前为 ${ext || '无扩展名'}`)
  }
  return s
}

// 校验 WebDAV 地址：只允许 http/https，避免把 file:// 之类的后端塞进 URL 字段
function assertWebdavUrl(url) {
  const s = String(url || '').trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) {
    throw new Error('WebDAV 地址必须以 http:// 或 https:// 开头')
  }
  return s
}

// 规范化云端目录路径：统一以 / 开头（相对 WebDAV 根）
const normalizeRemotePath = (remoteDir) => {
  const s = String(remoteDir || '').trim().replace(/\\/g, '/')
  if (!s || s === '/') return ''
  return s.startsWith('/') ? s : '/' + s
}

// 用 rclone obscure 把明文密码加密成 obscured 字符串（rclone 配置的 pass 字段要求 obscured 格式）
const obscurePassword = (rclonePath, pass) => {
  return new Promise((resolve) => {
    if (!pass) { resolve(''); return }
    let child
    try {
      child = spawn(rclonePath, ['obscure', pass], { windowsHide: true })
    } catch (e) {
      resolve(pass)
      return
    }
    let out = ''
    child.stdout?.on('data', (d) => { out += d })
    child.stderr?.on('data', (d) => { out += d })
    child.on('error', () => resolve(pass))
    child.on('close', (code) => {
      const obscured = out.trim()
      resolve(code === 0 && obscured ? obscured : pass)
    })
  })
}

// 执行一次 rclone sync。config 只接受非敏感字段，pass / rclonePath 一律取主进程存储值。
const runSync = async (override = {}) => {
  const stored = readConfig()
  const rclonePath = assertRclonePath(stored.rclonePath)
  const url = String(stored.url || '').trim()
  const user = String(stored.user || '').trim()
  const pass = String(stored.pass || '')
  // 远端目录允许本次调用覆盖（不含凭据，无安全边界问题）
  const remoteDir = normalizeRemotePath(
    override && typeof override.remoteDir === 'string' ? override.remoteDir : stored.remoteDir
  )
  const localDir = String(stored.localDir || getDefaultSaveDir()).trim()

  if (!url) return { success: false, message: '未配置 WebDAV 服务器地址' }
  if (!user) return { success: false, message: '未配置 WebDAV 账号' }
  if (!localDir) return { success: false, message: '未配置本地目录' }

  // rclone 的 pass 字段要求 obscured 格式，先用 rclone obscure 把明文密码加密
  const obscuredPass = await obscurePassword(rclonePath, pass)

  // 用环境变量方式配置一个临时 remote，避免密码出现在进程命令行
  const env = {
    ...process.env,
    RCLONE_CONFIG_MYCLOUD_TYPE: 'webdav',
    RCLONE_CONFIG_MYCLOUD_URL: url,
    RCLONE_CONFIG_MYCLOUD_VENDOR: 'other',
    RCLONE_CONFIG_MYCLOUD_USER: user,
    RCLONE_CONFIG_MYCLOUD_PASS: obscuredPass
  }

  const dest = remoteDir ? `mycloud:${remoteDir}` : 'mycloud:'
  const args = [
    'sync',
    localDir,
    dest,
    '--transfers', '4',
    '--checkers', '8',
    '--log-level', 'ERROR'
  ]

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(rclonePath, args, { env, windowsHide: true })
    } catch (e) {
      resolve({ success: false, message: `无法启动 rclone：${e?.message || e}` })
      return
    }

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => { stdout += d })
    child.stderr?.on('data', (d) => { stderr += d })

    child.on('error', (e) => {
      resolve({ success: false, message: `rclone 启动失败：${e?.message || e}（请确认已安装 rclone 且路径正确）` })
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, message: '同步完成' })
      } else {
        const raw = (stderr || stdout || '').trim()
        const msg = raw.split('\n').filter(Boolean).slice(-3).join('；') || `退出码 ${code}`
        resolve({ success: false, message: `同步失败：${msg}` })
      }
    })
  })
}

ipcMain.handle('rclone:getConfig', async () => {
  try {
    return { success: true, config: toPublicConfig(readConfig()) }
  } catch (e) {
    return { success: false, message: e?.message || '读取配置失败', config: toPublicConfig(defaultConfig()) }
  }
})

ipcMain.handle('rclone:saveConfig', async (_event, incoming) => {
  try {
    const next = { ...readConfig(), ...(incoming || {}) }
    next.url = assertWebdavUrl(next.url)
    next.rclonePath = assertRclonePath(next.rclonePath)
    next.remoteDir = normalizeRemotePath(next.remoteDir)
    next.enabled = next.enabled === true
    next.vendor = typeof next.vendor === 'string' ? next.vendor : 'custom'
    next.user = String(next.user || '').trim()

    // 三种意图要分清：
    // - 没传 pass 字段（局部更新）或传的是掩码（用户没动这个框）→ 沿用原密码
    // - 传了空串 → 用户主动清空
    // - 其它 → 新密码
    const oldPass = readConfig().pass
    const incomingPass = incoming && typeof incoming.pass === 'string' ? incoming.pass : null
    if (incomingPass === null || isMasked(incomingPass)) next.pass = oldPass
    else next.pass = incomingPass

    store.set(STORE_KEY, { ...next, pass: encryptString(next.pass) })
    return { success: true, config: toPublicConfig(readConfig()) }
  } catch (e) {
    return { success: false, message: e?.message || '保存配置失败' }
  }
})

ipcMain.handle('rclone:sync', async (_event, override) => {
  try {
    return await runSync(override || {})
  } catch (e) {
    return { success: false, message: e?.message || '同步异常' }
  }
})
