/**
 * 云盘同步（rclone WebDAV）：把本地默认保存目录镜像同步到云盘指定文件夹。
 * 渲染进程保存 .smm 后触发，主进程 spawn rclone.exe 执行 sync。
 *
 * 同步语义：单向镜像（本地为源），本地目录下所有文件/子目录结构与云端文件夹保持一致，
 * 本地新增/修改/删除都会同步到云端对应位置。
 */

const { ipcMain, app } = require('electron')
const { spawn } = require('child_process')

// 与 fileManager 保持一致的默认保存目录
const DEFAULT_SAVE_DIR = 'C:\\我的mindmap'
const getDefaultSaveDir = () => app.defaultSaveDir || DEFAULT_SAVE_DIR

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

// 执行一次 rclone sync
const runSync = async (config = {}) => {
  const rclonePath = String(config.rclonePath || 'rclone').trim()
  const url = String(config.url || '').trim()
  const user = String(config.user || '').trim()
  const pass = String(config.pass || '')
  const remoteDir = normalizeRemotePath(config.remoteDir)
  const localDir = String(config.localDir || getDefaultSaveDir()).trim()

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

ipcMain.handle('rclone:sync', async (_event, config) => {
  try {
    return await runSync(config || {})
  } catch (e) {
    return { success: false, message: e?.message || '同步异常' }
  }
})
