/**
 * 飞书机器人长连接（WebSocket）模块
 * 通过 @larksuiteoapi/node-sdk 建立与飞书平台的 WebSocket 连接
 * 接收 @机器人消息后，调用 AI 生成回复并发送到飞书
 */
const { ipcMain, BrowserWindow } = require('electron')
const store = require('../utils/store')
const { decryptFields } = require('../utils/secureStore')

let wsClient = null
let larkClient = null
let isConnected = false
let mainSender = null

// 等待渲染进程处理结果的 pending map
const pendingMessages = new Map()

// 已处理消息去重（防止飞书重发事件导致重复回复）
const processedMessageIds = new Set()
const PROCESSED_ID_TTL = 5 * 60 * 1000 // 5分钟后清理

const FEISHU_CONFIG_KEY = 'feishu_config'
const AI_CONFIG_KEY = 'aiConfig'
// 与 electron/ipc/feishu.js 保持一致：appSecret 以 safeStorage 密文落盘
const FEISHU_SENSITIVE_FIELDS = ['appSecret']
// 长连接期望状态持久化：true = 上次用户启动了长连接，应用重启后自动恢复
const BOT_AUTO_START_KEY = 'feishu_bot_auto_start'

function getFeishuConfig() {
  return decryptFields(store.get(FEISHU_CONFIG_KEY) || {}, FEISHU_SENSITIVE_FIELDS)
}

function getAIConfig() {
  return store.get(AI_CONFIG_KEY) || { baseURL: 'https://api.openai.com', apiKey: '', model: 'gpt-4o-mini' }
}

/**
 * 从消息内容中提取纯文本（去除 @机器人 前缀）
 */
function extractMessageText(data) {
  try {
    const content = JSON.parse(data.message.content)
    let text = content.text || ''

    // 去除 @机器人 的 key（如 @_user_1）
    if (data.message.mentions) {
      for (const mention of data.message.mentions) {
        text = text.replace(mention.key, '').trim()
      }
    }
    // 兜底：正则去除 @._user_N 格式
    text = text.replace(/@_user_\d+/g, '').trim()

    return text
  } catch {
    return ''
  }
}

/**
 * 获取可用的渲染进程 sender：
 * 优先最近一次 IPC 调用方；自动启动场景下没有任何 IPC 调用时，取主窗口兜底
 */
function getRendererSender() {
  if (mainSender && !mainSender.isDestroyed()) return mainSender
  const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
  return win ? win.webContents : null
}

/**
 * 将消息转发到渲染进程，使用 AI 助手（含工具调用）处理后返回结果
 */
async function processViaRenderer(text, chatId, senderName) {
  const msgId = `feishu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const replyPromise = new Promise((resolve, reject) => {
    pendingMessages.set(msgId, { resolve, reject })
    // 超时时长可配置（默认 5 分钟）
    const timeoutMs = store.getAiTimeoutMs()
    setTimeout(() => {
      if (pendingMessages.has(msgId)) {
        pendingMessages.delete(msgId)
        reject(new Error(`AI 处理超时（${Math.round(timeoutMs / 1000)}秒）`))
      }
    }, timeoutMs)
  })

  // 发送到渲染进程
  const sender = getRendererSender()
  if (sender) {
    sender.send('feishuBot:processMessage', {
      id: msgId,
      text,
      chatId,
      senderName,
      timestamp: Date.now()
    })
  } else {
    pendingMessages.delete(msgId)
    throw new Error('渲染进程不可用')
  }

  return replyPromise
}

/**
 * 启动飞书长连接
 */
async function startBot() {
  const config = getFeishuConfig()
  if (!config.appId || !config.appSecret) {
    return { success: false, error: '飞书配置缺失：请先设置 App ID 和 App Secret' }
  }

  if (isConnected) {
    return { success: true, message: '已连接，无需重复启动' }
  }

  try {
    const lark = require('@larksuiteoapi/node-sdk')

    // 创建 API Client（用于回复消息）
    larkClient = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: lark.AppType.SelfBuild,
    })

    // 事件分发器
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        try {
          console.log('[飞书Bot] 收到消息事件:', JSON.stringify(data, null, 2))

          const messageId = data.message.message_id

          // 去重：飞书在事件未及时 ACK 时会重发，跳过已处理的消息
          if (processedMessageIds.has(messageId)) {
            console.log('[飞书Bot] 消息已处理过，跳过:', messageId)
            return
          }
          processedMessageIds.add(messageId)
          // 5分钟后清理，避免 Set 无限增长
          setTimeout(() => processedMessageIds.delete(messageId), PROCESSED_ID_TTL)

          const text = extractMessageText(data)
          console.log('[飞书Bot] 提取文本:', text)
          if (!text) {
            console.log('[飞书Bot] 消息文本为空，跳过')
            return
          }

          const chatId = data.message.chat_id
          const senderName = data.sender?.sender_id?.open_id || '用户'

          // 通知渲染进程（用于日志显示）
          const logSender = getRendererSender()
          if (logSender) {
            logSender.send('feishuBot:messageReceived', {
              text,
              chatId,
              senderName,
              timestamp: Date.now()
            })
          }

          // 异步处理：不 await，立即返回 ACK，防止 SDK 超时重发
          ;(async () => {
            let reply
            try {
              reply = await processViaRenderer(text, chatId, senderName)
            } catch (aiErr) {
              reply = `[AI 处理失败] ${aiErr.message}`
            }

            // 回复到飞书
            try {
              await larkClient.im.message.reply({
                path: { message_id: messageId },
                data: {
                  content: JSON.stringify({ text: reply }),
                  msg_type: 'text'
                }
              })
            } catch (replyErr) {
              console.error('[飞书Bot] 回复失败:', replyErr)
            }

            // 通知渲染进程回复已发送
            const replySender = getRendererSender()
            if (replySender) {
              replySender.send('feishuBot:replySent', {
                text: reply,
                chatId,
                timestamp: Date.now()
              })
            }
          })()
        } catch (err) {
          console.error('[飞书Bot] 处理消息失败:', err)
        }
      }
    })

    // 启动 WebSocket 客户端
    wsClient = new lark.WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      loggerLevel: lark.LoggerLevel.info
    })

    await wsClient.start({ eventDispatcher })
    isConnected = true

    return { success: true, message: '飞书长连接已启动' }
  } catch (err) {
    console.error('[飞书Bot] 启动失败:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 停止长连接
 */
function stopBot() {
  try {
    if (wsClient) {
      wsClient.close && wsClient.close()
      wsClient = null
    }
    larkClient = null
    isConnected = false
    return { success: true, message: '已断开连接' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// IPC 处理器
function registerFeishuBotHandlers() {
  ipcMain.handle('feishuBot:start', async (event) => {
    mainSender = event.sender
    const result = await startBot()
    // 启动成功后记住期望状态，应用重启时自动恢复长连接
    if (result.success) store.set(BOT_AUTO_START_KEY, true)
    return result
  })

  ipcMain.handle('feishuBot:stop', () => {
    store.set(BOT_AUTO_START_KEY, false)
    return stopBot()
  })

  ipcMain.handle('feishuBot:status', () => {
    return { connected: isConnected }
  })

  // 接收渲染进程处理完的消息结果
  ipcMain.on('feishuBot:processMessageResult', (event, { id, reply, error }) => {
    const pending = pendingMessages.get(id)
    if (pending) {
      pendingMessages.delete(id)
      if (error) {
        pending.reject(new Error(error))
      } else {
        pending.resolve(reply)
      }
    }
  })
}

/**
 * 应用启动时调用：上次用户保持长连接开启的话，自动恢复启动
 */
async function initAutoStart() {
  try {
    if (!store.get(BOT_AUTO_START_KEY)) return
    const config = getFeishuConfig()
    if (!config.appId || !config.appSecret) return
    const result = await startBot()
    if (result.success) {
      console.log('[飞书Bot] 已自动恢复长连接')
    } else {
      console.warn('[飞书Bot] 自动恢复长连接失败:', result.error)
    }
  } catch (err) {
    console.error('[飞书Bot] 自动恢复长连接异常:', err)
  }
}

registerFeishuBotHandlers()

module.exports = { startBot, stopBot, initAutoStart }
