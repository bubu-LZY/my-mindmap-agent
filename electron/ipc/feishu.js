const { ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
// 直接引用 store 实例（electron-store），与 aiConfig.js 保持一致的写法
const store = require('../utils/store')
const { encryptFields, decryptFields } = require('../utils/secureStore')

// 配置存储 key
const FEISHU_CONFIG_KEY = 'feishu_config'
// 敏感字段：appSecret 使用 safeStorage 加密落盘
const FEISHU_SENSITIVE_FIELDS = ['appSecret']

// 飞书 API 基础 URL（固定，无需用户配置）
const FEISHU_BASE_URL = 'https://open.feishu.cn'

// 获取配置（appSecret 密文 → 解密返回）
function getConfig() {
  return decryptFields(store.get(FEISHU_CONFIG_KEY) || { appId: '', appSecret: '', enabled: false, domain: '', defaultChatId: '' }, FEISHU_SENSITIVE_FIELDS)
}

// 保存配置（appSecret 明文 → 加密落盘）
function saveConfig(config) {
  store.set(FEISHU_CONFIG_KEY, encryptFields(config, FEISHU_SENSITIVE_FIELDS))
}

// 获取飞书域名（用于拼接可访问链接），默认 www.feishu.cn
function getFeishuDomain() {
  const config = getConfig()
  const d = (config.domain || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
  return d || 'www.feishu.cn'
}

// 根据 file_token 和文件类型构造可访问链接
function buildFileUrl(token, type) {
  const domain = getFeishuDomain()
  const t = type || 'file'
  if (t === 'doc' || t === 'docx') return `https://${domain}/docx/${token}`
  return `https://${domain}/file/${token}`
}

// 开启文件链接分享权限（尽量生成可访问链接；失败不影响上传结果）
async function enableLinkShare(fileToken, type = 'file') {
  const trySet = async (linkShareEntity) => {
    const token = await getTenantAccessToken()
    const response = await fetch(
      `${FEISHU_BASE_URL}/open-apis/drive/v1/permissions/${fileToken}/public?type=${encodeURIComponent(type)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          external_access_entity: 'open',
          security_entity: 'anyone_can_view',
          comment_entity: 'anyone_can_view',
          share_entity: 'anyone',
          link_share_entity: linkShareEntity,
          invite_external: true,
          manage_collaborator_entity: 'collaborator_can_view'
        })
      }
    )
    const data = await response.json()
    return data.code === 0
  }
  try {
    if (await trySet('anyone_readable_view')) return 'anyone_readable_view'
  } catch (e) { /* 忽略，尝试降级 */ }
  try {
    if (await trySet('tenant_readable_link')) return 'tenant_readable_link'
  } catch (e) { /* 忽略 */ }
  return null
}

// 缓存 tenant_access_token
let cachedToken = null
let tokenExpireTime = 0

// 获取 tenant_access_token
async function getTenantAccessToken() {
  const config = getConfig()
  if (!config.appId || !config.appSecret) {
    throw new Error('飞书配置缺失：请先设置 App ID 和 App Secret')
  }

  // 检查缓存（提前 60 秒过期，避免临界点失效）
  if (cachedToken && Date.now() < tokenExpireTime - 60000) {
    return cachedToken
  }

  const url = `${FEISHU_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`

  // 使用全局 fetch（Electron 28 内置 Node 18+，原生支持 fetch）
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret
    })
  })

  const data = await response.json()
  if (data.code !== 0) {
    throw new Error(`获取 token 失败: ${data.msg}`)
  }

  cachedToken = data.tenant_access_token
  tokenExpireTime = Date.now() + (data.expire || 7200) * 1000

  return cachedToken
}

// 调用飞书 API 的通用方法
async function callFeishuAPI(method, reqPath, body = null, params = null) {
  const token = await getTenantAccessToken()

  let url = `${FEISHU_BASE_URL}${reqPath}`
  if (params) {
    const searchParams = new URLSearchParams(params)
    url += `?${searchParams.toString()}`
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  }

  const options = { method, headers }
  if (body) {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(url, options)
  const data = await response.json()

  if (data.code !== 0) {
    throw new Error(`飞书 API 错误: ${data.msg || '未知错误'} (code: ${data.code})`)
  }

  return data.data
}

// IPC 处理器注册
function registerFeishuHandlers() {
  // 获取配置
  ipcMain.handle('feishu:getConfig', () => {
    const config = getConfig()
    // 不返回 appSecret 明文，只返回是否已设置
    return {
      appId: config.appId,
      hasSecret: !!config.appSecret,
      enabled: config.enabled,
      domain: config.domain || '',
      defaultChatId: config.defaultChatId || ''
    }
  })

  // 保存配置
  ipcMain.handle('feishu:setConfig', (event, config) => {
    const oldConfig = getConfig()
    saveConfig({
      appId: config.appId || '',
      // 如果前端没有传新的 secret，则保留旧值
      appSecret: config.appSecret || oldConfig.appSecret,
      enabled: config.enabled ?? false,
      domain: config.domain ?? oldConfig.domain ?? '',
      defaultChatId: config.defaultChatId ?? oldConfig.defaultChatId ?? ''
    })
    // 配置变更后清除 token 缓存
    cachedToken = null
    return { success: true }
  })

  // 测试连接
  ipcMain.handle('feishu:testConnection', async () => {
    try {
      const token = await getTenantAccessToken()
      return { success: true, message: '连接成功', token: token.substring(0, 10) + '...' }
    } catch (e) {
      return { success: false, message: e.message }
    }
  })

  // 发送消息
  ipcMain.handle(
    'feishu:sendMessage',
    async (event, { receiveId, receiveIdType, msgType, content }) => {
      return await callFeishuAPI(
        'POST',
        '/open-apis/im/v1/messages',
        {
          receive_id: receiveId,
          msg_type: msgType,
          content: content
        },
        { receive_id_type: receiveIdType || 'chat_id' }
      )
    }
  )

  // 获取群列表
  ipcMain.handle('feishu:listChats', async () => {
    return await callFeishuAPI('GET', '/open-apis/im/v1/chats', null, { page_size: 50 })
  })

  // 上传文件到飞书云空间（上传成功后尝试开启链接分享并返回可访问链接）
  ipcMain.handle(
    'feishu:uploadFile',
    async (event, { filePath, parentType, parentNode }) => {
      const token = await getTenantAccessToken()

      const fileName = path.basename(filePath)
      const fileStats = fs.statSync(filePath)
      const fileBuffer = fs.readFileSync(filePath)

      // 使用原生 FormData 与 Blob（Node 18+ 全局可用，无需 form-data 包）
      const form = new FormData()
      form.append('file_name', fileName)
      form.append('parent_type', parentType || 'explorer')
      form.append('parent_node', parentNode || '')
      form.append('size', fileStats.size.toString())
      const fileBlob = new Blob([fileBuffer])
      form.append('file', fileBlob, fileName)

      const response = await fetch(`${FEISHU_BASE_URL}/open-apis/drive/v1/files/upload_all`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: form
      })

      const data = await response.json()
      if (data.code !== 0) {
        throw new Error(`上传失败: ${data.msg}`)
      }

      // 开启链接分享，使上传的文件可通过链接访问（应用身份上传的文件默认仅应用可见）
      let permission = null
      try {
        permission = await enableLinkShare(data.data.file_token, 'file')
      } catch (e) {
        // 权限设置失败不影响上传结果
      }

      return {
        ...data.data,
        url: buildFileUrl(data.data.file_token, 'file'),
        permission
      }
    }
  )

  // 发送图片消息到群聊（上传消息素材 → msg_type=image）
  ipcMain.handle(
    'feishu:sendImage',
    async (event, { chatId, filePath }) => {
      const targetChat = chatId || getConfig().defaultChatId
      if (!targetChat) throw new Error('未指定群聊且未配置默认群聊')

      // 1. 上传图片拿 image_key
      const token = await getTenantAccessToken()
      const fileName = path.basename(filePath)
      const fileBuffer = fs.readFileSync(filePath)
      const form = new FormData()
      form.append('image_type', 'message')
      form.append('image', new Blob([fileBuffer]), fileName)
      const upResp = await fetch(`${FEISHU_BASE_URL}/open-apis/im/v1/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      })
      const upData = await upResp.json()
      if (upData.code !== 0) {
        throw new Error(`图片上传失败: ${upData.msg}`)
      }

      // 2. 发送图片消息
      const msgResp = await fetch(
        `${FEISHU_BASE_URL}/open-apis/im/v1/messages?receive_id_type=chat_id`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            receive_id: targetChat,
            msg_type: 'image',
            content: JSON.stringify({ image_key: upData.data.image_key })
          })
        }
      )
      const msgData = await msgResp.json()
      if (msgData.code !== 0) {
        throw new Error(`图片消息发送失败: ${msgData.msg}`)
      }
      return { success: true, message_id: msgData.data?.message_id || '' }
    }
  )

  // 发送文件消息到群聊（上传消息素材 im/v1/files → msg_type=file，PDF/Excel 等任意格式，≤30MB）
  ipcMain.handle(
    'feishu:sendFile',
    async (event, { chatId, filePath }) => {
      const targetChat = chatId || getConfig().defaultChatId
      if (!targetChat) throw new Error('未指定群聊且未配置默认群聊')

      const stats = fs.statSync(filePath)
      if (stats.size > 30 * 1024 * 1024) {
        throw new Error('文件超过 30MB，飞书消息文件上传限制')
      }

      // 1. 上传文件拿 file_key
      const token = await getTenantAccessToken()
      const fileName = path.basename(filePath)
      const fileBuffer = fs.readFileSync(filePath)
      const form = new FormData()
      form.append('file_type', 'stream')
      form.append('file_name', fileName)
      form.append('file', new Blob([fileBuffer]), fileName)
      const upResp = await fetch(`${FEISHU_BASE_URL}/open-apis/im/v1/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      })
      const upData = await upResp.json()
      if (upData.code !== 0) {
        throw new Error(`文件上传失败: ${upData.msg}`)
      }

      // 2. 发送文件消息
      const msgResp = await fetch(
        `${FEISHU_BASE_URL}/open-apis/im/v1/messages?receive_id_type=chat_id`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            receive_id: targetChat,
            msg_type: 'file',
            content: JSON.stringify({ file_key: upData.data.file_key })
          })
        }
      )
      const msgData = await msgResp.json()
      if (msgData.code !== 0) {
        throw new Error(`文件消息发送失败: ${msgData.msg}`)
      }
      return { success: true, message_id: msgData.data?.message_id || '' }
    }
  )

  // 上传文件到指定云空间文件夹（不限格式，返回 token 与可访问链接）
  ipcMain.handle(
    'feishu:uploadDriveFile',
    async (event, { filePath, folderToken }) => {
      const token = await getTenantAccessToken()

      const fileName = path.basename(filePath)
      const fileStats = fs.statSync(filePath)
      const fileBuffer = fs.readFileSync(filePath)

      const form = new FormData()
      form.append('file_name', fileName)
      form.append('parent_type', 'explorer')
      form.append('parent_node', folderToken || '')
      form.append('size', fileStats.size.toString())
      const fileBlob = new Blob([fileBuffer])
      form.append('file', fileBlob, fileName)

      const response = await fetch(`${FEISHU_BASE_URL}/open-apis/drive/v1/files/upload_all`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: form
      })

      const data = await response.json()
      if (data.code !== 0) {
        throw new Error(`上传失败: ${data.msg}`)
      }

      let permission = null
      try {
        permission = await enableLinkShare(data.data.file_token, 'file')
      } catch (e) {
        // 忽略
      }

      return {
        ...data.data,
        url: buildFileUrl(data.data.file_token, 'file'),
        permission
      }
    }
  )

  // 导入 Markdown 为飞书文档（思维导图 → 层级文档）
  // 流程：写入临时 .md → 上传云空间 → 创建导入任务(docx) → 轮询结果 → 返回文档 token + 链接
  ipcMain.handle(
    'feishu:importMarkdownDoc',
    async (event, { markdown, title, folderToken }) => {
      const token = await getTenantAccessToken()
      const os = require('os')

      const safeTitle = (title || '思维导图').replace(/[<>:"/\\|?*]/g, '_').slice(0, 80)
      const mdName = `${safeTitle}.md`
      const tmpPath = path.join(os.tmpdir(), `feishu_import_${Date.now()}_${mdName}`)
      fs.writeFileSync(tmpPath, markdown || '', 'utf-8')
      const fileStats = fs.statSync(tmpPath)
      const fileBuffer = fs.readFileSync(tmpPath)

      // 1. 上传临时 md 文件
      const form = new FormData()
      form.append('file_name', mdName)
      form.append('parent_type', 'explorer')
      form.append('parent_node', folderToken || '')
      form.append('size', fileStats.size.toString())
      form.append('file', new Blob([fileBuffer]), mdName)

      const uploadResp = await fetch(`${FEISHU_BASE_URL}/open-apis/drive/v1/files/upload_all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      })
      const uploadData = await uploadResp.json()
      if (uploadData.code !== 0) {
        try { fs.unlinkSync(tmpPath) } catch (e) {}
        throw new Error(`上传临时 Markdown 失败: ${uploadData.msg}`)
      }
      try { fs.unlinkSync(tmpPath) } catch (e) {}

      // 2. 创建导入任务：md → docx
      const importResp = await fetch(`${FEISHU_BASE_URL}/open-apis/drive/v1/import_tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          file_extension: 'md',
          file_token: uploadData.data.file_token,
          file_name: safeTitle,
          type: 'docx',
          point: {
            // 未指定目标文件夹时挂载到"我的空间"根目录（mount_type=0），
            // 指定文件夹时才挂载到该文件夹（mount_type=1）；此前写死 1 且 mount_key 为空会直接导入失败
            mount_type: folderToken ? 1 : 0,
            mount_key: folderToken || ''
          }
        })
      })
      const importData = await importResp.json()
      if (importData.code !== 0) {
        throw new Error(`创建导入任务失败: ${importData.msg}`)
      }
      const ticket = importData.data.ticket

      // 3. 轮询导入任务结果（最长 30 秒）
      const queryTask = async () => {
        const resp = await fetch(
          `${FEISHU_BASE_URL}/open-apis/drive/v1/import_tasks/${ticket}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const d = await resp.json()
        if (d.code !== 0) throw new Error(`查询导入任务失败: ${d.msg}`)
        return d.data
      }

      let result = null
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        const data = await queryTask()
        // job_status: 0=成功 1=运行中 2=失败
        if (data.job_status === 0) {
          result = data
          break
        }
        if (data.job_status === 2) {
          throw new Error(`导入失败: ${data.extra?.error_code || '未知错误'}`)
        }
      }
      if (!result) {
        throw new Error('导入任务超时（30 秒），可稍后在飞书云空间查看结果')
      }

      const docToken = result.token

      // 4. 尝试开启文档链接分享
      let permission = null
      try {
        permission = await enableLinkShare(docToken, 'docx')
      } catch (e) {
        // 忽略
      }

      return {
        success: true,
        token: docToken,
        type: 'docx',
        url: buildFileUrl(docToken, 'docx'),
        permission
      }
    }
  )

  // 删除云空间文件（移入回收站）
  ipcMain.handle('feishu:deleteFile', async (event, { fileToken, fileType }) => {
    const token = await getTenantAccessToken()
    const type = fileType || 'file'
    const response = await fetch(
      `${FEISHU_BASE_URL}/open-apis/drive/v1/files/${fileToken}?type=${encodeURIComponent(type)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      }
    )
    const data = await response.json()
    if (data.code !== 0) {
      throw new Error(`删除失败: ${data.msg}`)
    }
    return { success: true }
  })

  // 重命名云空间文件
  ipcMain.handle('feishu:renameFile', async (event, { fileToken, newName, fileType }) => {
    const token = await getTenantAccessToken()
    const type = fileType || 'file'
    const response = await fetch(
      `${FEISHU_BASE_URL}/open-apis/drive/v1/files/${fileToken}/rename?type=${encodeURIComponent(type)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: newName })
      }
    )
    const data = await response.json()
    if (data.code !== 0) {
      throw new Error(`重命名失败: ${data.msg}`)
    }
    return { success: true, file: data.data?.file || null }
  })

  // 下载文件
  ipcMain.handle('feishu:downloadFile', async (event, { fileToken, savePath }) => {
    const token = await getTenantAccessToken()

    const response = await fetch(`${FEISHU_BASE_URL}/open-apis/drive/v1/files/${fileToken}/download`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    })

    if (!response.ok) {
      let errMsg = response.statusText
      try {
        const error = await response.json()
        errMsg = error.msg || errMsg
      } catch {
        // 响应体非 JSON，使用 statusText
      }
      throw new Error(`下载失败: ${errMsg}`)
    }

    const buffer = await response.arrayBuffer()
    fs.writeFileSync(savePath, Buffer.from(buffer))

    return { success: true, path: savePath }
  })

  // 创建文档（包含标题）
  ipcMain.handle('feishu:createDoc', async (event, { title, content, folderToken }) => {
    return await callFeishuAPI('POST', '/open-apis/docx/v1/documents', {
      folder_token: folderToken || '',
      title: title || '新建文档'
    })
  })

  // 获取文档内容
  ipcMain.handle('feishu:getDocContent', async (event, { docToken, format }) => {
    return await callFeishuAPI(
      'GET',
      `/open-apis/docx/v1/documents/${docToken}/raw_content`,
      null,
      null
    )
  })

  // 搜索云空间文件（飞书 v2 搜索接口，使用 POST）
  ipcMain.handle('feishu:searchFiles', async (event, { query, count }) => {
    return await callFeishuAPI('POST', '/open-apis/search/v2/doc_wiki/search', {
      query: query || '',
      doc_filter: { search_type: 0 },
      page_size: count || 20
    })
  })

  // 获取云空间文件列表
  ipcMain.handle('feishu:listFiles', async (event, { folderToken }) => {
    return await callFeishuAPI('GET', '/open-apis/drive/v1/files', null, {
      folder_token: folderToken || '',
      page_size: 50
    })
  })

  // 获取根目录 token
  ipcMain.handle('feishu:getRootFolder', async () => {
    return await callFeishuAPI('GET', '/open-apis/drive/explorer/v2/root_folder/meta', null, null)
  })
}

// 模块被 require 时自动注册处理器（与 main.js 的 require('./ipc/feishu') 用法匹配）
registerFeishuHandlers()

module.exports = { registerFeishuHandlers, getConfig, saveConfig }
