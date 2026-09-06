/**
 * 微信 ClawBot 集成（官方 iLink Bot API，腾讯 openclaw-weixin 协议）
 *
 * 登录流程：POST get_bot_qrcode 获取二维码链接 → 手机微信扫码 →
 *   长轮询 get_qrcode_status（wait/scaned/need_verifycode/confirmed/...）→
 *   confirmed 后保存 bot_token / ilink_bot_id / baseUrl
 *
 * 消息收发：POST getupdates 长轮询收消息（携带游标 get_updates_buf），
 *   POST sendmessage 发文本（需联系人 to_user_id + context_token）
 *
 * 联系人模型：机器人收到的每条用户消息都会记录 from_user_id + context_token，
 *   定时推送/AI 主动发送默认发给最近联系（或配置的默认联系人）
 */
const { ipcMain, BrowserWindow } = require('electron')
const crypto = require('crypto')
const store = require('../utils/store')
const { encryptString, decryptString } = require('../utils/secureStore')

const WECHAT_CONFIG_KEY = 'wechat_config'
const WECHAT_CONTACTS_KEY = 'wechat_contacts'
// getupdates 游标持久化：对齐官方插件 sync-buf，重启后从断点续收，避免监听间隙的消息丢失
const WECHAT_SYNC_BUF_KEY = 'wechat_sync_buf'

// 官方 openclaw-weixin 插件协议常量
const FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com'
const DEFAULT_ILINK_BOT_TYPE = '3'
// iLink-App-Id 取自官方插件 package.json 的 ilink_appid 字段
const ILINK_APP_ID = 'bot'
// iLink-App-ClientVersion：0x00MMNNPP（2.4.6 → 131072+1024+6）
const ILINK_APP_CLIENT_VERSION = 132102
const CHANNEL_VERSION = '2.4.6'
const BOT_AGENT = 'MindMapAgent/4.8.0'

// 扫码状态接口为长轮询（服务端 hold 最长约 35 秒），客户端超时需大于它
const QR_POLL_TIMEOUT_MS = 40_000
const LONG_POLL_TIMEOUT_MS = 40_000
const API_TIMEOUT_MS = 15_000

/* ========== 配置与联系人存取 ========== */

function getConfig() {
  const config = store.get(WECHAT_CONFIG_KEY) || {
    enabled: false,
    token: '',
    botId: '',
    userId: '',
    baseUrl: '',
    loginTime: '',
    defaultContactId: ''
  }
  if (typeof config.token === 'string') config.token = decryptString(config.token)
  return config
}

function saveConfig(patch) {
  const config = { ...getConfig(), ...patch }
  // bot token 使用 safeStorage 加密落盘
  if (typeof config.token === 'string') config.token = encryptString(config.token)
  store.set(WECHAT_CONFIG_KEY, config)
  return config
}

function getContacts() {
  const contacts = store.get(WECHAT_CONTACTS_KEY) || {}
  // contextToken 密文 → 解密返回
  for (const uid of Object.keys(contacts)) {
    const c = contacts[uid]
    if (c && typeof c.contextToken === 'string') c.contextToken = decryptString(c.contextToken)
  }
  return contacts
}

function saveContact(userId, contextToken, name) {
  if (!userId) return
  const contacts = getContacts()
  contacts[userId] = {
    userId,
    name: name || contacts[userId]?.name || '',
    contextToken: contextToken || contacts[userId]?.contextToken || '',
    lastTime: Date.now()
  }
  // contextToken 明文 → 加密落盘
  for (const uid of Object.keys(contacts)) {
    const c = contacts[uid]
    if (c && typeof c.contextToken === 'string') c.contextToken = encryptString(c.contextToken)
  }
  store.set(WECHAT_CONTACTS_KEY, contacts)
}

// 最近联系的联系人（默认推送目标）
function getDefaultContact() {
  const contacts = getContacts()
  const config = getConfig()
  if (config.defaultContactId && contacts[config.defaultContactId]) {
    return contacts[config.defaultContactId]
  }
  const list = Object.values(contacts).sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0))
  return list[0] || null
}

/* ========== 请求基础 ========== */

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), 'utf-8').toString('base64')
}

function buildCommonHeaders() {
  return {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION)
  }
}

function buildHeaders(token) {
  const headers = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
    ...buildCommonHeaders()
  }
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`
  }
  return headers
}

function buildBaseInfo() {
  return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT }
}

async function doFetch(url, options, timeoutMs, label) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    const rawText = await res.text()
    if (!res.ok) {
      throw new Error(`${label} HTTP ${res.status}: ${rawText.slice(0, 200)}`)
    }
    return rawText
  } finally {
    clearTimeout(timer)
  }
}

// 返回原始 Response（CDN 上传需要读响应头 x-encrypted-param，不能提前消费 body）
async function doFetchRaw(url, options, timeoutMs, label) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (e) {
    throw new Error(`${label} 网络错误: ${e.message}`)
  } finally {
    clearTimeout(timer)
  }
}

// 登录阶段的请求（二维码/扫码状态），baseUrl 可能因 IDC 重定向切换
async function loginPost(endpoint, body) {
  const url = new URL(endpoint, `${FIXED_BASE_URL}/`).toString()
  return doFetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body)
  }, API_TIMEOUT_MS, 'loginPost')
}

async function loginGet(baseUrl, endpoint) {
  const url = new URL(endpoint, `${baseUrl.replace(/\/$/, '')}/`).toString()
  return doFetch(url, {
    method: 'GET',
    headers: buildCommonHeaders()
  }, QR_POLL_TIMEOUT_MS, 'loginGet')
}

// 登录后的业务请求（getupdates/sendmessage/getconfig），走登录返回的 baseUrl
async function callWechatAPI(endpoint, body, timeoutMs = API_TIMEOUT_MS) {
  const config = getConfig()
  if (!config.token) throw new Error('微信未登录：请先在三方链接面板扫码登录')
  const base = (config.baseUrl || FIXED_BASE_URL).replace(/\/$/, '')
  const url = new URL(endpoint, `${base}/`).toString()
  const raw = await doFetch(url, {
    method: 'POST',
    headers: buildHeaders(config.token),
    body: JSON.stringify({ ...body, base_info: buildBaseInfo() })
  }, timeoutMs, 'callWechatAPI')
  return JSON.parse(raw)
}

/* ========== 扫码登录（会话状态保存在主进程内存） ========== */

let activeLogin = null // { qrcode, qrcodeUrl, startedAt, currentApiBaseUrl, pendingVerifyCode }

const LOGIN_TTL_MS = 5 * 60_000

function isLoginFresh() {
  return activeLogin && Date.now() - activeLogin.startedAt < LOGIN_TTL_MS
}

async function fetchQRCode() {
  const localTokenList = getConfig().token ? [getConfig().token] : []
  const raw = await loginPost(
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_ILINK_BOT_TYPE)}`,
    { local_token_list: localTokenList }
  )
  const data = JSON.parse(raw)
  if (!data.qrcode || !data.qrcode_img_content) {
    throw new Error('获取二维码失败：服务端未返回二维码')
  }
  activeLogin = {
    qrcode: data.qrcode,
    qrcodeUrl: data.qrcode_img_content,
    startedAt: Date.now(),
    currentApiBaseUrl: FIXED_BASE_URL,
    pendingVerifyCode: undefined
  }
  return { qrcodeUrl: activeLogin.qrcodeUrl, expiresIn: LOGIN_TTL_MS }
}

/**
 * 轮询一次扫码状态（渲染进程循环调用）
 * 返回 { status, message, needVerifyCode?, account? }
 */
async function pollLoginStatus(verifyCode) {
  if (!isLoginFresh()) {
    activeLogin = null
    return { status: 'expired', message: '二维码已过期，请重新生成' }
  }
  const code = verifyCode || activeLogin.pendingVerifyCode
  if (verifyCode) activeLogin.pendingVerifyCode = verifyCode

  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(activeLogin.qrcode)}`
  if (code) endpoint += `&verify_code=${encodeURIComponent(code)}`

  let data
  try {
    const raw = await loginGet(activeLogin.currentApiBaseUrl, endpoint)
    data = JSON.parse(raw)
  } catch (err) {
    // 长轮询超时/网关抖动按等待处理，渲染进程继续轮询
    return { status: 'wait', message: '等待扫码' }
  }

  switch (data.status) {
    case 'wait':
      return { status: 'wait', message: '等待扫码' }
    case 'scaned':
      if (activeLogin.pendingVerifyCode) activeLogin.pendingVerifyCode = undefined
      return { status: 'scaned', message: '已扫码，请在手机上确认授权' }
    case 'need_verifycode':
      return {
        status: 'need_verifycode',
        message: code ? '配对码不匹配，请重新输入手机微信显示的数字' : '请输入手机微信上显示的数字配对码',
        needVerifyCode: true
      }
    case 'verify_code_blocked':
      activeLogin.pendingVerifyCode = undefined
      return { status: 'verify_code_blocked', message: '配对码多次输入错误，请重新生成二维码再试' }
    case 'scaned_but_redirect': {
      if (data.redirect_host) {
        activeLogin.currentApiBaseUrl = `https://${data.redirect_host}`
      }
      return { status: 'wait', message: '已扫码，正在切换接入点' }
    }
    case 'binded_redirect':
      activeLogin = null
      return { status: 'binded', message: '此微信号已绑定过，无需重复连接' }
    case 'confirmed': {
      if (!data.ilink_bot_id) {
        activeLogin = null
        return { status: 'error', message: '登录失败：服务器未返回机器人 ID' }
      }
      if (!data.bot_token) {
        // 无凭证不算登录成功：静默保存空 token 会导致界面误报成功、功能区不出现
        activeLogin = null
        return { status: 'error', message: '登录未完成：服务器未返回登录凭证，请重新扫码' }
      }
      // baseUrl 优先级：服务器返回的 baseurl > IDC 重定向后的主机 > 固定域名
      // （若经历过 scaned_but_redirect，正确的主机是 currentApiBaseUrl，不能盲目回退固定域名）
      const resolvedBaseUrl = data.baseurl || (activeLogin && activeLogin.currentApiBaseUrl) || FIXED_BASE_URL
      const config = saveConfig({
        token: data.bot_token || '',
        botId: data.ilink_bot_id,
        userId: data.ilink_user_id || '',
        baseUrl: resolvedBaseUrl,
        loginTime: new Date().toISOString()
      })
      activeLogin = null
      // 登录成功即自动启动消息监听：用户给机器人发消息才能被收到并记录为推送联系人
      if (config.token) {
        store.set(BOT_AUTO_START_KEY, true)
        await startMonitor()
      }
      return {
        status: 'confirmed',
        message: '微信登录成功，消息监听已自动启动',
        account: {
          botId: config.botId,
          userId: config.userId,
          loginTime: config.loginTime,
          hasToken: !!config.token
        }
      }
    }
    case 'expired':
      return { status: 'expired', message: '二维码已过期，请重新生成' }
    default:
      return { status: 'wait', message: `未知状态：${data.status || '(空)'}` }
  }
}

/* ========== 消息发送 ========== */

/**
 * 发送文本消息
 * @param {string} toUserId 目标联系人（缺省用默认联系人）
 */
async function sendTextMessage(toUserId, text) {
  if (!text || !String(text).trim()) throw new Error('消息内容不能为空')

  const contacts = getContacts()
  const target = toUserId && contacts[toUserId]
    ? contacts[toUserId]
    : getDefaultContact()
  if (!target) {
    throw new Error(
      monitorRunning
        ? '没有可用的微信联系人：监听运行中但尚未收到消息，请现在用微信给机器人发一条消息，发完即可推送'
        : '没有可用的微信联系人：消息监听未启动。请打开三方链接面板 → 微信，点击「机器人消息监听」的启动按钮（或重新扫码登录），然后用微信给机器人发一条消息'
    )
  }

  // Agent 回复可能较长，超过单条上限会被微信拒收 → 按行分片逐条发送
  const chunks = splitTextForWechat(text)
  const messageIds = []
  for (const chunk of chunks) {
    messageIds.push(await sendOneText(target, chunk))
  }
  return { success: true, to: target.userId, messageId: messageIds[0] || '', chunks: chunks.length }
}

// 单条文本上限（保守值，避免触及微信消息长度限制）
const WECHAT_TEXT_CHUNK = 1500

function splitTextForWechat(text) {
  const str = String(text)
  if (str.length <= WECHAT_TEXT_CHUNK) return [str]
  const chunks = []
  let rest = str
  while (rest.length > WECHAT_TEXT_CHUNK) {
    // 优先在换行处切分，尽量保持段落完整可读
    let cut = rest.lastIndexOf('\n', WECHAT_TEXT_CHUNK)
    if (cut < WECHAT_TEXT_CHUNK * 0.4) cut = WECHAT_TEXT_CHUNK
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest) chunks.push(rest)
  return chunks
}

// 发送单条文本（结构对齐官方插件 buildTextMessageReq：message_type=2(BOT)、message_state=2(FINISH)、client_id 幂等标识）
async function sendOneText(target, text) {
  const clientId = `openclaw-weixin:${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const resp = await callWechatAPI('ilink/bot/sendmessage', {
    msg: {
      from_user_id: '',
      to_user_id: target.userId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: target.contextToken || undefined,
      item_list: [{ type: 1, text_item: { text: String(text) } }]
    }
  })
  const errCode = respErrCode(resp)
  if (errCode !== 0) {
    throw new Error(`微信发送失败: ${resp.errmsg || ''}（errcode ${errCode}）`)
  }
  return resp.message_id || ''
}

/* ========== 图片发送（对齐官方插件 CDN 上传协议） ========== */

// CDN 上传/下载基地址（官方插件常量）
const WECHAT_CDN_BASE = 'https://novac2c.cdn.weixin.qq.com/c2c'

/**
 * 通用 CDN 媒体上传：AES-128-ECB 加密 → getuploadurl 取预签名 URL → POST 密文
 * 图片(media_type=1)与文件(media_type=3)共用
 * @returns {{ downloadParam: string, filesize: number, aeskeyHex: string }}
 */
async function uploadMediaToCDN(buf, mediaType, toUserId, sizeLimitBytes, sizeLabel) {
  if (buf.length === 0) throw new Error(`${sizeLabel}为空`)
  if (buf.length > sizeLimitBytes) throw new Error(`${sizeLabel}超过 ${Math.floor(sizeLimitBytes / 1024 / 1024)}MB，微信 CDN 上传限制`)

  // 1. 本地生成密钥并加密（对齐官方：filekey/aeskey 均客户端随机，AES-128-ECB + PKCS7）
  const rawsize = buf.length
  const rawfilemd5 = crypto.createHash('md5').update(buf).digest('hex')
  const aeskey = crypto.randomBytes(16)
  const filekey = crypto.randomBytes(16).toString('hex')
  const cipher = crypto.createCipheriv('aes-128-ecb', aeskey, null)
  const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()])
  const filesize = ciphertext.length

  // 2. getuploadurl（带 Bearer 鉴权头）
  const upResp = await callWechatAPI('ilink/bot/getuploadurl', {
    filekey,
    media_type: mediaType, // 1=IMAGE, 3=FILE
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString('hex')
  })
  const upErr = respErrCode(upResp)
  if (upErr !== 0) {
    throw new Error(`获取上传地址失败: ${upResp.errmsg || ''}（errcode ${upErr}）`)
  }
  const uploadFullUrl = (upResp.upload_full_url || '').trim()
  const uploadParam = upResp.upload_param || ''
  if (!uploadFullUrl && !uploadParam) {
    throw new Error('获取上传地址失败：服务端未返回上传 URL')
  }
  const cdnUrl = uploadFullUrl || `${WECHAT_CDN_BASE}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`

  // 3. POST 密文到 CDN（无鉴权头，凭预签名 URL；下载参数在响应头）
  const cdnResp = await doFetchRaw(cdnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: ciphertext
  }, 30_000, 'CDN上传')
  if (cdnResp.status >= 400 && cdnResp.status < 500) {
    const msg = cdnResp.headers.get('x-error-message') || await cdnResp.text().catch(() => '')
    throw new Error(`CDN 上传失败 ${cdnResp.status}: ${String(msg).slice(0, 200)}`)
  }
  if (cdnResp.status !== 200) {
    const msg = cdnResp.headers.get('x-error-message') || `status ${cdnResp.status}`
    throw new Error(`CDN 上传服务端错误: ${msg}`)
  }
  const downloadParam = cdnResp.headers.get('x-encrypted-param')
  if (!downloadParam) {
    throw new Error('CDN 上传响应缺少下载参数（x-encrypted-param）')
  }
  return { downloadParam, filesize, aeskeyHex: aeskey.toString('hex') }
}

/**
 * 发送图片消息：CDN 上传 → sendmessage(type=2 image_item)
 * @param {string} toUserId 目标联系人（缺省用默认联系人）
 * @param {string} filePath 本地图片路径
 */
async function sendImageMessage(toUserId, filePath) {
  const fs = require('fs')
  const path = require('path')
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('图片文件不存在')
  }
  const buf = fs.readFileSync(filePath)

  const contacts = getContacts()
  const target = toUserId && contacts[toUserId]
    ? contacts[toUserId]
    : getDefaultContact()
  if (!target) {
    throw new Error(
      monitorRunning
        ? '没有可用的微信联系人：监听运行中但尚未收到消息，请现在用微信给机器人发一条消息，发完即可推送'
        : '没有可用的微信联系人：消息监听未启动。请打开三方链接面板 → 微信，启动「机器人消息监听」后用微信给机器人发一条消息'
    )
  }

  const { downloadParam, filesize, aeskeyHex } = await uploadMediaToCDN(
    buf, 1, target.userId, 10 * 1024 * 1024, '图片'
  )

  // 发送图片消息（aes_key 官方行为：hex 字符串的 base64，保持与官方插件互通）
  const clientId = `openclaw-weixin:${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const resp = await callWechatAPI('ilink/bot/sendmessage', {
    msg: {
      from_user_id: '',
      to_user_id: target.userId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: target.contextToken || undefined,
      item_list: [{
        type: 2, // IMAGE
        image_item: {
          media: {
            encrypt_query_param: downloadParam,
            aes_key: Buffer.from(aeskeyHex).toString('base64'),
            encrypt_type: 1
          },
          mid_size: filesize
        }
      }]
    }
  })
  const errCode = respErrCode(resp)
  if (errCode !== 0) {
    throw new Error(`微信图片发送失败: ${resp.errmsg || ''}（errcode ${errCode}）`)
  }
  return {
    success: true,
    to: target.userId,
    messageId: resp.message_id || '',
    fileName: path.basename(filePath)
  }
}

/**
 * 发送文件消息（PDF/Excel 等任意文件）：CDN 上传(media_type=3) → sendmessage(type=4 file_item)
 * @param {string} toUserId 目标联系人（缺省用默认联系人）
 * @param {string} filePath 本地文件路径
 */
async function sendFileMessage(toUserId, filePath) {
  const fs = require('fs')
  const path = require('path')
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('文件不存在')
  }
  const buf = fs.readFileSync(filePath)

  const contacts = getContacts()
  const target = toUserId && contacts[toUserId]
    ? contacts[toUserId]
    : getDefaultContact()
  if (!target) {
    throw new Error(
      monitorRunning
        ? '没有可用的微信联系人：监听运行中但尚未收到消息，请现在用微信给机器人发一条消息，发完即可推送'
        : '没有可用的微信联系人：消息监听未启动。请打开三方链接面板 → 微信，启动「机器人消息监听」后用微信给机器人发一条消息'
    )
  }

  const { downloadParam, filesize, aeskeyHex } = await uploadMediaToCDN(
    buf, 3, target.userId, 30 * 1024 * 1024, '文件'
  )

  const clientId = `openclaw-weixin:${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const resp = await callWechatAPI('ilink/bot/sendmessage', {
    msg: {
      from_user_id: '',
      to_user_id: target.userId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: target.contextToken || undefined,
      item_list: [{
        type: 4, // FILE
        file_item: {
          media: {
            encrypt_query_param: downloadParam,
            aes_key: Buffer.from(aeskeyHex).toString('base64'),
            encrypt_type: 1
          },
          file_name: path.basename(filePath),
          md5: crypto.createHash('md5').update(buf).digest('hex'),
          len: String(filesize)
        }
      }]
    }
  })
  const errCode = respErrCode(resp)
  if (errCode !== 0) {
    throw new Error(`微信文件发送失败: ${resp.errmsg || ''}（errcode ${errCode}）`)
  }
  return {
    success: true,
    to: target.userId,
    messageId: resp.message_id || '',
    fileName: path.basename(filePath)
  }
}

/* ========== 机器人长轮询监听（收消息 → AI → 回复） ========== */

let monitorRunning = false
let monitorCursor = ''
let mainSender = null

// 等待渲染进程 AI 处理结果的 pending map
const pendingMessages = new Map()
// 消息去重（getupdates 游标回退时可能重收）
const processedMessageIds = new Set()

const BOT_AUTO_START_KEY = 'wechat_bot_auto_start'

function getRendererSender() {
  if (mainSender && !mainSender.isDestroyed()) return mainSender
  const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
  return win ? win.webContents : null
}

function processViaRenderer(text, fromUserId, senderName) {
  const msgId = `wechat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const replyPromise = new Promise((resolve, reject) => {
    pendingMessages.set(msgId, { resolve, reject })
    const timeoutMs = store.getAiTimeoutMs()
    setTimeout(() => {
      if (pendingMessages.has(msgId)) {
        pendingMessages.delete(msgId)
        reject(new Error(`AI 处理超时（${Math.round(timeoutMs / 1000)}秒）`))
      }
    }, timeoutMs)
  })

  const sender = getRendererSender()
  if (sender) {
    sender.send('wechatBot:processMessage', {
      id: msgId,
      text,
      fromUserId,
      senderName,
      timestamp: Date.now()
    })
  } else {
    pendingMessages.delete(msgId)
    return Promise.reject(new Error('渲染进程不可用'))
  }
  return replyPromise
}

// 提取消息内容（iLink MessageItemType：1=文本 2=图片 3=语音 4=文件 5=视频）
// 语音优先使用微信服务端 ASR 转写（voice_item.text）；无法处理的内容记入 unsupported 供提示
function extractMessageContent(msg) {
  const result = { text: '', unsupported: [] }
  try {
    if (!Array.isArray(msg.item_list)) return result
    const parts = []
    for (const item of msg.item_list) {
      if (item.type === 1 && item.text_item?.text) {
        parts.push(item.text_item.text)
      } else if (item.type === 3) {
        const voice = item.voice_item || {}
        const asr = voice.text
        console.log('[微信Bot] 收到语音消息, 时长:', voice.playtime, 'ms, 有无转写:', !!(asr && String(asr).trim()))
        if (asr && String(asr).trim()) {
          parts.push(String(asr).trim())
        } else {
          result.unsupported.push('语音')
        }
      } else if (item.type === 2) {
        result.unsupported.push('图片')
      } else if (item.type === 4) {
        result.unsupported.push('文件')
      } else if (item.type === 5) {
        result.unsupported.push('视频')
      }
    }
    result.text = parts.join('\n').trim()
  } catch {
    /* 保持空结果 */
  }
  return result
}

// 把每次轮询结果推给渲染进程，便于在面板里直接看到监听是否正常
function emitMonitorStatus(payload) {
  const sender = getRendererSender()
  if (sender) sender.send('wechatBot:monitorStatus', { timestamp: Date.now(), ...payload })
}

// 判断业务响应的错误码：成功时服务器直接返回 msgs/get_updates_buf，可能完全不带 ret 字段。
// 只有 errcode / ret 为非零数字时才是错误；返回 0 表示成功。
function respErrCode(resp) {
  if (!resp || typeof resp !== 'object') return -1
  if (typeof resp.errcode === 'number' && resp.errcode !== 0) return resp.errcode
  if (typeof resp.ret === 'number' && resp.ret !== 0) return resp.ret
  return 0
}

async function monitorLoop() {
  while (monitorRunning) {
    try {
      const resp = await callWechatAPI(
        'ilink/bot/getupdates',
        { get_updates_buf: monitorCursor },
        LONG_POLL_TIMEOUT_MS
      )
      if (!monitorRunning) break

      const errCode = respErrCode(resp)
      if (errCode !== 0) {
        // -14 = 会话超时（token 失效），停止监听并通知
        if (errCode === -14) {
          stopMonitor()
          const sender = getRendererSender()
          if (sender) sender.send('wechatBot:error', { message: '微信登录已过期，请重新扫码登录' })
          break
        }
        console.error('[微信Bot] getupdates 失败:', resp.errmsg, errCode)
        emitMonitorStatus({
          ok: false,
          error: `${resp.errmsg || '请求失败'}（errcode ${errCode}）`,
          // 完整服务端响应，便于定位是 token 失效、baseUrl 错误还是其他原因
          debug: JSON.stringify(resp).slice(0, 300)
        })
        await new Promise(r => setTimeout(r, 3000))
        continue
      }

      if (resp.get_updates_buf) {
        monitorCursor = resp.get_updates_buf
        store.set(WECHAT_SYNC_BUF_KEY, monitorCursor)
      }

      const msgs = Array.isArray(resp.msgs) ? resp.msgs : []
      emitMonitorStatus({ ok: true, msgCount: msgs.length })
      for (const msg of msgs) {
        // 只处理用户发来的消息（message_type 1 = USER）
        if (!msg || msg.message_type !== 1) continue
        // message_id 超出 Number.MAX_SAFE_INTEGER（如 7.49e18），JSON.parse 精度丢失后
        // 相邻消息可能解析成同一个数 → 仅按 id 去重会把正常消息误判为重复而丢弃。
        // 复合键（发送者+毫秒时间戳+id）保证唯一性：同一用户同一毫秒收到两条碰撞 id 的概率可忽略
        const dedupKey = `${msg.from_user_id || ''}_${msg.create_time_ms || ''}_${msg.message_id || ''}`
        if (processedMessageIds.has(dedupKey)) continue
        processedMessageIds.add(dedupKey)
        if (processedMessageIds.size > 500) {
          const first = processedMessageIds.values().next().value
          processedMessageIds.delete(first)
        }

        // 记录联系人（含 context_token，回复与推送都依赖它）
        saveContact(msg.from_user_id, msg.context_token, '')

        const { text, unsupported } = extractMessageContent(msg)
        if (!text) {
          // 无文本可处理（语音无转写/图片/文件/视频）：给用户明确反馈，不再静默丢弃
          if (unsupported.length > 0) {
            const tip = unsupported.includes('语音')
              ? '这条语音没有获取到转写结果，请再说一次或直接发送文字'
              : `抱歉，暂不支持处理${unsupported.join('、')}消息，请发送文字指令`
            ;(async () => {
              try {
                await sendTextMessage(msg.from_user_id, tip)
              } catch (e) {
                console.error('[微信Bot] 不支持类型提示发送失败:', e.message)
              }
            })()
          }
          continue
        }

        const sender = getRendererSender()
        if (sender) {
          sender.send('wechatBot:messageReceived', {
            text,
            fromUserId: msg.from_user_id,
            senderName: '微信用户',
            timestamp: msg.create_time_ms || Date.now()
          })
        }

        // 异步处理，不阻塞轮询循环
        ;(async () => {
          let reply
          try {
            reply = await processViaRenderer(text, msg.from_user_id, '微信用户')
          } catch (aiErr) {
            reply = `[AI 处理失败] ${aiErr.message}`
          }
          try {
            await sendTextMessage(msg.from_user_id, reply)
          } catch (replyErr) {
            console.error('[微信Bot] 回复失败:', replyErr)
          }
          const replySender = getRendererSender()
          if (replySender) {
            replySender.send('wechatBot:replySent', {
              text: reply,
              fromUserId: msg.from_user_id,
              timestamp: Date.now()
            })
          }
        })()
      }
    } catch (err) {
      if (!monitorRunning) break
      console.error('[微信Bot] 监听异常:', err.message)
      emitMonitorStatus({ ok: false, error: err.message })
      await new Promise(r => setTimeout(r, 3000))
    }
  }
}

async function startMonitor() {
  const config = getConfig()
  if (!config.token) {
    return { success: false, error: '微信未登录：请先在三方链接面板扫码登录' }
  }
  if (monitorRunning) return { success: true, message: '监听已启动' }

  // 对齐官方插件：启动时通知服务器通道上线（失败可忽略，不影响轮询）
  try {
    const resp = await callWechatAPI('ilink/bot/msg/notifystart', {})
    if (resp.ret !== undefined && resp.ret !== 0) {
      console.warn('[微信Bot] notifystart:', resp.errmsg, resp.ret)
    }
  } catch (e) {
    console.warn('[微信Bot] notifystart 失败（忽略）:', e.message)
  }

  monitorRunning = true
  // 从持久化游标恢复（断点续收）；无记录则从当前位置开始
  monitorCursor = store.get(WECHAT_SYNC_BUF_KEY) || ''
  monitorLoop()
  return { success: true, message: '微信消息监听已启动' }
}

function stopMonitor() {
  if (monitorRunning) {
    // 对齐官方插件：停止时通知服务器通道下线（best effort）
    callWechatAPI('ilink/bot/msg/notifystop', {}).catch(() => {})
  }
  monitorRunning = false
  return { success: true, message: '已停止微信消息监听' }
}

/* ========== IPC 注册 ========== */

function registerWechatHandlers() {
  ipcMain.handle('wechat:getConfig', () => {
    const config = getConfig()
    return {
      enabled: !!config.enabled,
      hasToken: !!config.token,
      botId: config.botId || '',
      userId: config.userId || '',
      loginTime: config.loginTime || '',
      defaultContactId: config.defaultContactId || ''
    }
  })

  ipcMain.handle('wechat:setConfig', (event, patch) => {
    mainSender = event.sender
    // token 等凭证只由登录流程写入，这里只允许改开关与默认联系人
    const allowed = {}
    if (typeof patch?.enabled === 'boolean') allowed.enabled = patch.enabled
    if (typeof patch?.defaultContactId === 'string') allowed.defaultContactId = patch.defaultContactId
    saveConfig(allowed)
    return { success: true }
  })

  ipcMain.handle('wechat:loginStart', async (event) => {
    mainSender = event.sender
    try {
      const result = await fetchQRCode()
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('wechat:loginPoll', async (event, verifyCode) => {
    mainSender = event.sender
    try {
      return await pollLoginStatus(verifyCode)
    } catch (err) {
      return { status: 'error', message: err.message }
    }
  })

  ipcMain.handle('wechat:loginCancel', () => {
    activeLogin = null
    return { success: true }
  })

  ipcMain.handle('wechat:logout', () => {
    stopMonitor()
    store.set(BOT_AUTO_START_KEY, false)
    saveConfig({ token: '', botId: '', userId: '', baseUrl: '', loginTime: '', enabled: false })
    store.set(WECHAT_CONTACTS_KEY, {})
    store.set(WECHAT_SYNC_BUF_KEY, '')
    return { success: true }
  })

  ipcMain.handle('wechat:testConnection', async () => {
    const config = getConfig()
    if (!config.token) return { success: false, message: '未登录：请先扫码登录' }
    try {
      // 用与监听相同的 getupdates 端点做短超时探测：
      // 服务器若在超时内保持长连接（客户端中止）= 请求已到达服务端 = 连通；
      // 服务器若立刻返回 ret≠0 才是真的拒绝。
      const resp = await callWechatAPI('ilink/bot/getupdates', { get_updates_buf: '' }, 6000)
      const errCode = respErrCode(resp)
      if (errCode === 0) return { success: true, message: '微信连接正常' }
      return { success: false, message: `服务器拒绝：${resp.errmsg || ''}（errcode ${errCode}）` }
    } catch (err) {
      if (/中止|abort/i.test(err.message)) {
        return { success: true, message: '微信连接正常（服务器保持长连接等待消息）' }
      }
      return { success: false, message: `连接失败：${err.message}` }
    }
  })

  ipcMain.handle('wechat:getContacts', () => {
    const list = Object.values(getContacts()).sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0))
    return list.map(c => ({
      userId: c.userId,
      name: c.name || c.userId.slice(0, 12),
      lastTime: c.lastTime || 0,
      isDefault: c.userId === getConfig().defaultContactId || (!getConfig().defaultContactId && list[0]?.userId === c.userId)
    }))
  })

  ipcMain.handle('wechat:sendMessage', async (event, { toUserId, text }) => {
    mainSender = event.sender
    try {
      return await sendTextMessage(toUserId, text)
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 发送图片（走官方 CDN 上传协议：getuploadurl → AES-ECB 加密 POST → image_item 消息）
  ipcMain.handle('wechat:sendImage', async (event, { toUserId, filePath }) => {
    mainSender = event.sender
    try {
      return await sendImageMessage(toUserId, filePath)
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 发送文件（PDF/Excel 等：CDN 上传 media_type=3 → file_item 消息）
  ipcMain.handle('wechat:sendFile', async (event, { toUserId, filePath }) => {
    mainSender = event.sender
    try {
      return await sendFileMessage(toUserId, filePath)
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 机器人监听
  ipcMain.handle('wechatBot:start', async (event) => {
    mainSender = event.sender
    const result = await startMonitor()
    if (result.success) store.set(BOT_AUTO_START_KEY, true)
    return result
  })

  ipcMain.handle('wechatBot:stop', () => {
    store.set(BOT_AUTO_START_KEY, false)
    return stopMonitor()
  })

  ipcMain.handle('wechatBot:status', () => ({ connected: monitorRunning }))

  ipcMain.on('wechatBot:processMessageResult', (event, { id, reply, error }) => {
    const pending = pendingMessages.get(id)
    if (pending) {
      pendingMessages.delete(id)
      if (error) pending.reject(new Error(error))
      else pending.resolve(reply)
    }
  })
}

registerWechatHandlers()

/**
 * 应用启动时调用：上次保持监听开启且已登录的话自动恢复
 */
async function initAutoStart() {
  try {
    if (!store.get(BOT_AUTO_START_KEY)) return
    const config = getConfig()
    if (!config.token) return
    const result = await startMonitor()
    if (result.success) console.log('[微信Bot] 已自动恢复消息监听')
    else console.warn('[微信Bot] 自动恢复失败:', result.error)
  } catch (err) {
    console.error('[微信Bot] 自动恢复异常:', err)
  }
}

module.exports = { initAutoStart }
