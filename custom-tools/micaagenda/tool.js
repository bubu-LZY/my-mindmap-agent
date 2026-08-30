import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'

const DEFAULT_PORT = 17801

// 从 MicaAgenda 配置目录读取 Token 和端口
// 兼容字段名大小写：ApiToken / apiToken、ApiPort / apiPort
function loadConfig() {
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  const baseDir = join(appData, 'MicaAgenda')

  let token = ''
  let port = DEFAULT_PORT

  // 尝试读取 app-config.json（优先）
  const configPath = join(baseDir, 'app-config.json')
  try {
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
      // 兼容大小写
      token = String(cfg.ApiToken || cfg.apiToken || token || '').trim()
      const p = cfg.ApiPort || cfg.apiPort
      if (typeof p === 'number' && p > 0) port = p
    }
  } catch { /* ignore */ }

  // 如果 token 还是空，尝试从 api-token.txt 读
  if (!token) {
    const tokenPath = join(baseDir, 'api-token.txt')
    try {
      if (existsSync(tokenPath)) {
        token = readFileSync(tokenPath, 'utf-8').trim()
      }
    } catch { /* ignore */ }
  }

  return { token, port }
}

// 使用 Node.js 原生 http 模块发送请求，避免 fetch 的 ByteString 编码问题
function httpRequest(port, token, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : ''
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(bodyStr, 'utf8')
    }
    // 确保 token 只含 ASCII 字符
    if (token && /^[\x00-\x7F]*$/.test(token)) {
      headers['X-Auth-Token'] = token
    } else if (token) {
      // 如果 token 含非 ASCII（不应该发生），用 base64 编码或者直接忽略
      // 这里选择忽略并给出警告
      console.warn('[micaagenda] Token contains non-ASCII characters, skipping auth header')
    }

    const options = {
      hostname: 'localhost',
      port,
      path: pathname,
      method,
      headers,
      timeout: 8000
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        let result
        try {
          result = data ? JSON.parse(data) : {}
        } catch (e) {
          result = { raw: data }
        }
        resolve({ status: res.statusCode, data: result })
      })
    })

    req.on('error', (e) => reject(e))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })

    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

export async function execute(args, context) {
  const action = String(args.action || 'query').toLowerCase()

  // 支持从参数传入 token 和 port，优先级高于自动读取
  let { token, port } = loadConfig()
  if (args.token && String(args.token).trim()) {
    token = String(args.token).trim()
  }
  if (args.port && Number(args.port) > 0) {
    port = Number(args.port)
  }

  // 先检查服务是否可用
  try {
    const health = await httpRequest(port, token, 'GET', '/api/health')
    if (health.status !== 200) {
      return {
        success: false,
        message: `无法连接到 MicaAgenda 桌面日历（端口 ${port}）。请确保桌面日历程序正在运行。`
      }
    }
  } catch (e) {
    return {
      success: false,
      message: `无法连接到 MicaAgenda 桌面日历（端口 ${port}）：${e.message}。请确保桌面日历程序正在运行。`
    }
  }

  try {
    switch (action) {
      case 'query': {
        let queryPath = '/api/tasks'
        const params = new URLSearchParams()
        if (args.date) {
          params.set('date', String(args.date))
        } else if (args.range) {
          params.set('range', String(args.range))
        }
        const qs = params.toString()
        if (qs) queryPath += '?' + qs
        const { status, data } = await httpRequest(port, token, 'GET', queryPath)
        if (status === 401) return { success: false, message: '鉴权失败：API Token 无效，请检查桌面日历的 Token 配置' }
        if (status >= 400) return { success: false, message: `查询失败（HTTP ${status}）`, data }
        return {
          success: true,
          message: `查询成功，共 ${data.count || 0} 条任务`,
          data
        }
      }

      case 'add': {
        if (!args.title) return { success: false, message: 'add 操作必须提供 title 参数' }
        const body = { title: String(args.title) }
        if (args.date) body.date = String(args.date)
        if (typeof args.isImportant === 'boolean') body.isImportant = args.isImportant
        const { status, data } = await httpRequest(port, token, 'POST', '/api/tasks', body)
        if (status === 401) return { success: false, message: '鉴权失败：API Token 无效，请检查桌面日历的 Token 配置' }
        if (status >= 400) return { success: false, message: `添加失败（HTTP ${status}）`, data }
        return {
          success: true,
          message: `任务已添加：${data.title}`,
          data
        }
      }

      case 'update': {
        if (!args.taskId && !args.id) return { success: false, message: 'update 操作必须提供 taskId 参数' }
        const id = args.taskId || args.id
        const body = {}
        if (args.title !== undefined) body.title = String(args.title)
        if (args.date !== undefined) body.date = String(args.date)
        if (typeof args.isImportant === 'boolean') body.isImportant = args.isImportant
        const { status, data } = await httpRequest(port, token, 'PUT', `/api/tasks/${id}`, body)
        if (status === 401) return { success: false, message: '鉴权失败：API Token 无效，请检查桌面日历的 Token 配置' }
        if (status >= 400) return { success: false, message: `更新失败（HTTP ${status}）`, data }
        return { success: true, message: '任务已更新', data }
      }

      case 'delete': {
        if (!args.taskId && !args.id) return { success: false, message: 'delete 操作必须提供 taskId 参数' }
        const id = args.taskId || args.id
        const { status, data } = await httpRequest(port, token, 'DELETE', `/api/tasks/${id}`)
        if (status === 401) return { success: false, message: '鉴权失败：API Token 无效，请检查桌面日历的 Token 配置' }
        if (status >= 400) return { success: false, message: `删除失败（HTTP ${status}）`, data }
        return { success: true, message: '任务已删除', data }
      }

      case 'complete': {
        if (!args.taskId && !args.id) return { success: false, message: 'complete 操作必须提供 taskId 参数' }
        const id = args.taskId || args.id
        const { status, data } = await httpRequest(port, token, 'POST', `/api/tasks/${id}/complete`)
        if (status === 401) return { success: false, message: '鉴权失败：API Token 无效，请检查桌面日历的 Token 配置' }
        if (status >= 400) return { success: false, message: `操作失败（HTTP ${status}）`, data }
        return { success: true, message: '任务已标记完成', data }
      }

      case 'uncomplete': {
        if (!args.taskId && !args.id) return { success: false, message: 'uncomplete 操作必须提供 taskId 参数' }
        const id = args.taskId || args.id
        const { status, data } = await httpRequest(port, token, 'POST', `/api/tasks/${id}/uncomplete`)
        if (status === 401) return { success: false, message: '鉴权失败：API Token 无效，请检查桌面日历的 Token 配置' }
        if (status >= 400) return { success: false, message: `操作失败（HTTP ${status}）`, data }
        return { success: true, message: '任务已取消完成', data }
      }

      case 'batch': {
        if (!Array.isArray(args.operations) || args.operations.length === 0) {
          return { success: false, message: 'batch 操作必须提供 operations 数组' }
        }
        const { status, data } = await httpRequest(port, token, 'PUT', '/api/tasks', { operations: args.operations })
        if (status === 401) return { success: false, message: '鉴权失败：API Token 无效，请检查桌面日历的 Token 配置' }
        if (status >= 400) return { success: false, message: `批量操作失败（HTTP ${status}）`, data }
        const successCount = Array.isArray(data.results)
          ? data.results.filter(r => r && !r.error).length
          : 0
        return {
          success: true,
          message: `批量操作完成：成功 ${successCount} 条，共 ${data.results?.length || 0} 条`,
          data
        }
      }

      case 'sync_review': {
        // 便捷操作：将复习计划同步到日历
        // 支持两种输入方式：
        // 1. reviewItems 数组，每项包含 title、date、isOverdue、cycle 等字段
        // 2. 从 get_review_schedule 的结果中解析
        const items = []

        if (Array.isArray(args.reviewItems) && args.reviewItems.length > 0) {
          for (const item of args.reviewItems) {
            const title = item.title || item.nodeTitle || '复习任务'
            const date = item.date || item.dueDate
            const cycle = item.cycle ? ` [${item.cycle}周期]` : ''
            const overdue = item.isOverdue ? '（逾期）' : ''
            items.push({
              action: 'add',
              title: `复习：${title}${cycle}${overdue}`,
              date: date || undefined,
              isImportant: !!item.isImportant
            })
          }
        }

        if (items.length === 0) {
          return { success: false, message: '没有需要同步的复习任务。请提供 reviewItems 数组，每项包含 title 和 date。' }
        }

        const { status, data } = await httpRequest(port, token, 'PUT', '/api/tasks', { operations: items })
        if (status === 401) return { success: false, message: '鉴权失败：API Token 无效，请检查桌面日历的 Token 配置' }
        if (status >= 400) return { success: false, message: `同步失败（HTTP ${status}）`, data }
        const successCount = Array.isArray(data.results)
          ? data.results.filter(r => r && !r.error).length
          : 0
        return {
          success: true,
          message: `复习计划同步完成：成功 ${successCount} 条，共 ${items.length} 条`,
          data
        }
      }

      default:
        return { success: false, message: `不支持的操作类型：${action}。支持：query、add、update、delete、complete、uncomplete、batch、sync_review` }
    }
  } catch (e) {
    return {
      success: false,
      message: `操作失败：${e.message}`
    }
  }
}
