// === 主进程全局异常兜底 ===
// 打包后无控制台，stdout/stderr 管道可能已关闭，console.log/warn/error 写入会抛 EPIPE，
// 触发 Electron "A JavaScript error occurred in the main process" 崩溃弹窗。
// 这里静默吞掉 EPIPE / 管道已销毁类错误，其余异常照常打印。
function _isPipeError(err) {
  if (!err) return false
  return err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED' || err.code === 'ERR_STREAM_WRITE_AFTER_END'
}
if (process.stdout && typeof process.stdout.on === 'function') {
  process.stdout.on('error', (err) => { if (_isPipeError(err)) return; throw err })
}
if (process.stderr && typeof process.stderr.on === 'function') {
  process.stderr.on('error', (err) => { if (_isPipeError(err)) return; throw err })
}
process.on('uncaughtException', (err) => {
  if (_isPipeError(err)) return
  try { console.error('[uncaughtException]', err) } catch (_) {}
})
process.on('unhandledRejection', (reason) => {
  if (_isPipeError(reason)) return
  try { console.error('[unhandledRejection]', reason) } catch (_) {}
})

const { app, BrowserWindow, shell, ipcMain, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

// === IPC 发送方校验（防御渲染层被注入后滥用特权 IPC）===
// 仅放行业务主窗口：生产为 file:// 打包产物，开发为本地 dev server。
// 一旦渲染层被 XSS 注入，可在主进程统一拦截，避免任意文件读写/对外发送被滥用。
const _origIpcHandle = ipcMain.handle.bind(ipcMain)
const _origIpcOn = ipcMain.on.bind(ipcMain)
function _isTrustedSender(event) {
  try {
    const url = (event.senderFrame && event.senderFrame.url) || ''
    if (url.startsWith('file://')) return true
    if (/^https?:\/\/(localhost|127\.0\.0\.1):\d+/.test(url)) return true
    return false
  } catch {
    return false
  }
}
ipcMain.handle = function (channel, listener) {
  return _origIpcHandle(channel, async (event, ...args) => {
    if (!_isTrustedSender(event)) {
      console.warn(`[security] 拦截未授权 IPC 调用: ${channel} (${event.senderFrame && event.senderFrame.url})`)
      throw new Error('未授权调用')
    }
    return listener(event, ...args)
  })
}
ipcMain.on = function (channel, listener) {
  return _origIpcOn(channel, (event, ...args) => {
    if (!_isTrustedSender(event)) {
      console.warn(`[security] 拦截未授权 IPC 调用: ${channel} (${event.senderFrame && event.senderFrame.url})`)
      return
    }
    return listener(event, ...args)
  })
}

// 引入 IPC 模块
require('./ipc/fileManager')
require('./ipc/aiConfig')
require('./ipc/aiChat')
require('./ipc/knowledgeBase')
require('./ipc/ocr')
require('./ipc/referenceManager')
require('./ipc/feishu')
require('./ipc/taskScheduler')
require('./ipc/dialog')
const { registerLegacyMigrateIPC } = require('./ipc/legacyMigrate')
registerLegacyMigrateIPC()
const databaseModule = require('./ipc/database')
const feishuBotModule = require('./ipc/feishuBot')
const wechatBotModule = require('./ipc/wechat')
const httpServerModule = require('./ipc/httpServer')
require('./ipc/mcpManager')
require('./ipc/skillsManager')
require('./ipc/customTools')
require('./ipc/vectorStore')
require('./ipc/passwordGate')
const networkMonitor = require('./ipc/networkMonitor')

// 在默认浏览器中打开 URL
ipcMain.handle('open-external', async (event, url) => {
  try {
    if (!url || typeof url !== 'string') return false
    if (!/^https?:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  } catch (error) {
    console.error('打开外部链接失败:', error)
    return false
  }
})

// 免费联网搜索（无需密钥）。
// SearchOrchestrator：多引擎并发、独立超时、缓存、熔断、相关性重排、任务搜索预算。
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000
const ENGINE_BREAKER_MS = 5 * 60 * 1000
const ENGINE_FAILURE_THRESHOLD = 3
const MAX_SEARCHES_PER_TASK = 2
const MAX_DEEP_RESEARCH_SEARCHES = 6
const searchCache = new Map()
const engineFailures = new Map()
const searchBudgets = new Map()

const normalizeSearchQuery = (query) => String(query || '').toLowerCase().replace(/\s+/g, ' ').trim()

const tokenizeSearchQuery = (query) => normalizeSearchQuery(query)
  .split(/[\s/\\|]+/)
  .flatMap((token) => {
    if (token.length <= 2 || /^(今日|今天|明天|天气|新闻|价格)$/.test(token)) return [token]
    const cjk = token.match(/[\u4e00-\u9fa5]{2,}/g)
    if (cjk && cjk.length) {
      return cjk.flatMap((word) => {
        const parts = []
        for (let i = 0; i < word.length - 1; i++) parts.push(word.slice(i, i + 2))
        return parts
      })
    }
    return [token]
  })
  .filter(Boolean)

const extractSearchDate = (text) => {
  const match = String(text || '').replace(/\./g, '-').match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})/)
  if (!match) return null
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return new Date(Date.UTC(Number(match[1]), month - 1, day)).toISOString().slice(0, 10)
}

const scoreSearchResult = (query, result) => {
  const normalizedQuery = normalizeSearchQuery(query)
  const title = String(result.title || '').toLowerCase()
  const snippet = String(result.snippet || '').toLowerCase()
  const link = String(result.link || '').toLowerCase()
  let score = 0
  if (title.includes(normalizedQuery) || snippet.includes(normalizedQuery)) score += 12
  for (const token of tokenizeSearchQuery(query)) {
    if (title.includes(token)) score += 6
    if (snippet.includes(token)) score += 3
    if (link.includes(token)) score += 2
  }
  if (/天气|weather|气温|降雨|降温/.test(normalizedQuery)) {
    if (/天气|weather|气温|降雨|降温/.test(title + snippet)) score += 12
    if (/tianqi|weather|forecast|气象/.test(link)) score += 10
    if (/baike|map\.baidu|旅游|攻略|百科|政府/.test(title + link)) score -= 14
  }
  if (/新闻|news|最新|今天|today/.test(normalizedQuery)) {
    if (/新闻|news|快讯|最新/.test(title + snippet)) score += 8
    if (/baike|百科|攻略/.test(title + link)) score -= 10
  }
  if (/价格|多少钱|报价|price/.test(normalizedQuery) && /价格|报价|多少钱|price/.test(title + snippet)) score += 10
  if (!snippet) score -= 5
  if (/baidu\.com\/link\?url=/.test(link)) score -= snippet ? 4 : 12
  const date = extractSearchDate(title + ' ' + snippet)
  if (date) score += Math.max(0, 6 - Math.floor((Date.now() - new Date(date).getTime()) / (30 * 24 * 3600 * 1000)))
  return score
}

const getSearchEngineState = (name) => {
  const failure = engineFailures.get(name)
  if (!failure) return { open: false, failures: 0, retryInMs: 0 }
  if (Date.now() >= failure.retryAt) {
    engineFailures.delete(name)
    return { open: false, failures: 0, retryInMs: 0 }
  }
  return { open: true, failures: failure.count, retryInMs: failure.retryAt - Date.now() }
}

const recordSearchEngineResult = (name, success) => {
  if (success) {
    engineFailures.delete(name)
    return
  }
  const failure = engineFailures.get(name) || { count: 0, retryAt: 0 }
  failure.count += 1
  if (failure.count >= ENGINE_FAILURE_THRESHOLD) failure.retryAt = Date.now() + ENGINE_BREAKER_MS
  engineFailures.set(name, failure)
}

const cleanupSearchCache = () => {
  const now = Date.now()
  for (const [key, item] of searchCache) {
    if (item.expiresAt <= now) searchCache.delete(key)
  }
}

const consumeSearchBudget = (taskId, deepResearch) => {
  const limit = deepResearch ? MAX_DEEP_RESEARCH_SEARCHES : MAX_SEARCHES_PER_TASK
  if (!taskId) return { allowed: true, count: 0, limit }
  const now = Date.now()
  const budget = searchBudgets.get(taskId)
  if (!budget || now - budget.createdAt > 30 * 60 * 1000) {
    searchBudgets.set(taskId, { count: 0, createdAt: now })
    return { allowed: true, count: 0, limit }
  }
  return budget.count >= limit
    ? { allowed: false, count: budget.count, limit }
    : { allowed: true, count: budget.count, limit }
}

const commitSearchBudget = (taskId, deepResearch) => {
  if (!taskId) return
  const limit = deepResearch ? MAX_DEEP_RESEARCH_SEARCHES : MAX_SEARCHES_PER_TASK
  const budget = searchBudgets.get(taskId) || { count: 0, createdAt: Date.now() }
  budget.count += 1
  searchBudgets.set(taskId, budget)
}

ipcMain.handle('web-search', async (event, query) => {
  const { net } = require('electron')
  const payload = typeof query === 'object' && query !== null ? query : { query }
  const qs = String(payload.query || '').trim()
  const taskId = String(payload.taskId || '').trim()
  const deepResearch = payload.deepResearch === true
  if (!qs) return { success: false, error: '搜索关键词为空' }

  const cacheKey = normalizeSearchQuery(qs)
  cleanupSearchCache()
  const cached = searchCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return { ...cached.payload, cacheHit: true }

  const budget = consumeSearchBudget(taskId, deepResearch)
  if (!budget.allowed) {
    return {
      success: false,
      error: `搜索预算已用完（本次任务 ${budget.count}/${budget.limit} 次）。请基于已有搜索结果回答；除非用户明确要求深度调研，不要再调用 search_web。`,
      searchBudget: budget
    }
  }

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
  const doRequest = (url, method) => new Promise((resolve, reject) => {
    const request = net.request({ method, url })
    const MAX_BYTES = 2 * 1024 * 1024
    const timer = setTimeout(() => {
      try { request.abort() } catch (error) {}
      reject(new Error('请求超时'))
    }, 6000)
    request.on('response', (response) => {
      let buffer = Buffer.alloc(0)
      const settle = (html) => { clearTimeout(timer); resolve(html) }
      response.on('data', (chunk) => {
        if (buffer.length >= MAX_BYTES) return
        buffer = Buffer.concat([buffer, chunk])
        if (buffer.length >= MAX_BYTES) {
          try { request.abort() } catch (error) {}
          settle(buffer.toString('utf8'))
        }
      })
      response.on('end', () => settle(buffer.toString('utf8')))
      response.on('error', (error) => { clearTimeout(timer); reject(error) })
    })
    request.on('error', (error) => { clearTimeout(timer); reject(error) })
    request.setHeader('User-Agent', UA)
    request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8')
    if (method === 'POST') {
      request.setHeader('Content-Type', 'application/x-www-form-urlencoded')
      request.write('q=' + encodeURIComponent(qs))
    }
    request.end()
  })

  const decode = (value) => String(value)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&ensp;|&emsp;/g, ' ').replace(/&#0183;|&middot;/g, '·').replace(/&hellip;/g, '…')
    .replace(/\s+/g, ' ').trim()

  const normalizeLink = (raw) => {
    let link = String(raw)
    const uddg = link.match(/uddg=([^&]+)/)
    if (uddg) link = decodeURIComponent(uddg[1])
    if (link.startsWith('//')) link = 'https:' + link
    return /^https?:\/\//i.test(link) ? link : null
  }

  const parseBing = (html) => {
    const results = []
    const blockRe = /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>([\s\S]*?)<\/li>/g
    let match
    while ((match = blockRe.exec(html)) !== null && results.length < 8) {
      const link = normalizeLink(match[1])
      const title = decode(match[2])
      if (!link || !title) continue
      let snippetMatch = match[3].match(/<p[^>]*class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/)
      if (!snippetMatch) snippetMatch = match[3].match(/<div class="b_caption[^"]*">[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)
      if (!snippetMatch) snippetMatch = match[3].match(/<p[^>]*>([\s\S]*?)<\/p>/)
      results.push({ title, link, snippet: snippetMatch ? decode(snippetMatch[1]) : '' })
    }
    return results
  }

  const parseLiteVersion = (html) => {
    const results = []
    const snippets = []
    const snippetRe = /class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g
    let snippetMatch
    while ((snippetMatch = snippetRe.exec(html)) !== null) snippets.push(decode(snippetMatch[1]))
    const linkRe = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    let match
    while ((match = linkRe.exec(html)) !== null && results.length < 8) {
      const link = normalizeLink(match[1])
      const title = decode(match[2])
      if (!link || !title) continue
      results.push({ title, link, snippet: snippets[results.length] || '' })
    }
    return results
  }

  const parseHtmlVersion = (html) => {
    const results = []
    const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/
    let match
    while ((match = linkRe.exec(html)) !== null && results.length < 8) {
      const link = normalizeLink(match[1])
      if (!link) continue
      const snippetMatch = html.slice(linkRe.lastIndex).match(snippetRe)
      results.push({ title: decode(match[2]), link, snippet: snippetMatch ? decode(snippetMatch[1]) : '' })
    }
    return results
  }

  const parseBaidu = (html) => {
    const results = []
    const snippets = []
    const snippetRe = /<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/g
    let snippetMatch
    while ((snippetMatch = snippetRe.exec(html)) !== null) snippets.push(decode(snippetMatch[1]))
    const titleRe = /<h3[^>]*class="[^"]*(?:c-title|\bt\b)[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let match
    let picked = 0
    while ((match = titleRe.exec(html)) !== null && results.length < 8) {
      const title = decode(match[2])
      if (!title) continue
      results.push({ title, link: normalizeLink(match[1]), snippet: snippets[picked] || '' })
      picked++
    }
    return results
  }

  const allEndpoints = [
    { name: 'Baidu', url: `https://www.baidu.com/s?wd=${encodeURIComponent(qs)}&ie=utf-8`, method: 'GET', parse: parseBaidu },
    { name: 'Bing', url: `https://cn.bing.com/search?q=${encodeURIComponent(qs)}`, method: 'GET', parse: parseBing },
    { name: 'DuckDuckGo lite', url: 'https://lite.duckduckgo.com/lite/', method: 'POST', parse: parseLiteVersion },
    { name: 'DuckDuckGo html', url: 'https://html.duckduckgo.com/html/', method: 'POST', parse: parseHtmlVersion }
  ]
  const breakerStatuses = allEndpoints.map((endpoint) => {
    const state = getSearchEngineState(endpoint.name)
    return { engine: endpoint.name, breakerOpen: state.open, failures: state.failures, retryInMs: state.retryInMs }
  })
  const endpoints = allEndpoints.filter((endpoint) => !getSearchEngineState(endpoint.name).open)
  if (!endpoints.length) return { success: false, error: '所有搜索引擎均处于熔断状态，请稍后重试。', engineStatuses: [], breakerStatuses }

  const searches = endpoints.map((endpoint) => (async () => {
    const html = await doRequest(endpoint.url, endpoint.method)
    const results = endpoint.parse(html)
    if (!results.length) throw new Error('无可解析结果')
    return { engine: endpoint.name, results }
  })().then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason })
  ))

  const settled = []
  let earlyReturn = false
  const enoughEngines = new Promise((resolve) => {
    let successCount = 0
    searches.forEach((promise) => promise.then((result) => {
      settled.push(result)
      if (result.status === 'fulfilled') successCount++
      if (successCount >= 2 && endpoints.length >= 2) {
        earlyReturn = true
        resolve()
      }
    }))
  })
  await Promise.race([enoughEngines, Promise.all(searches)])
  commitSearchBudget(taskId, deepResearch)

  const errors = []
  const engineStatuses = []
  const merged = []
  const seen = new Set()
  settled.forEach((result, index) => {
    const endpoint = endpoints[index]
    if (result.status !== 'fulfilled') {
      const message = result.reason?.message || '请求失败'
      errors.push(`${endpoint.name} ${message}`)
      engineStatuses.push({ engine: endpoint.name, success: false, count: 0, error: message })
      recordSearchEngineResult(endpoint.name, false)
      return
    }
    engineStatuses.push({ engine: endpoint.name, success: true, count: result.value.results.length })
    recordSearchEngineResult(endpoint.name, true)
    for (const item of result.value.results) {
      let hostname = ''
      try { hostname = new URL(item.link).hostname.replace(/^www\./, '') } catch (error) {}
      const key = `${hostname}|${item.title.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({ ...item, engine: result.value.engine })
    }
  })

  if (!merged.length) {
    return { success: false, error: '搜索失败：' + errors.join('；'), engineStatuses, breakerStatuses, searchBudget: { count: budget.count + 1, limit: budget.limit } }
  }
  const ranked = merged
    .map((result) => ({ ...result, score: scoreSearchResult(qs, result), publishedDate: extractSearchDate(result.title + ' ' + result.snippet) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((result, index) => ({ ...result, ref: index + 1 }))
  const response = {
    success: true,
    results: ranked,
    engineStatuses,
    breakerStatuses,
    errors,
    earlyReturn,
    searchBudget: { count: budget.count + 1, limit: budget.limit },
    cachedAt: new Date().toISOString()
  }
  searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, payload: response })
  return response
})

// SSRF 防护：命中内网/回环/链路本地/保留地址返回 true（web-fetch 抓取网页前用它拦截）
function isBlockedTarget(hostname) {
  const h = String(hostname || '').toLowerCase().trim().replace(/^\[|\]$/g, '')
  if (!h) return true
  if (h === 'localhost' || h === 'localhost.localdomain') return true
  if (/\.(local|internal|lan|localhost|home\.arpa|corp)$/.test(h)) return true
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const o = ipv4.slice(1, 5).map(Number)
    if (o.some(n => n > 255)) return true
    const [a, b] = o
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 192 && (o[2] === 0 || o[2] === 2)) return true
    if (a >= 224) return true
    return false
  }
  if (h.includes(':')) {
    if (h === '::1') return true
    if (/^f[cd]/.test(h)) return true
    if (/^fe[89ab]/.test(h)) return true
  }
  return false
}

// 读取网页正文（配合联网搜索使用）：抓取网页 HTML 并提取纯文本
ipcMain.handle('web-fetch', async (event, url) => {
  const { net } = require('electron')
  const target = String(url || '').trim()
  if (!/^https?:\/\//i.test(target)) return { success: false, error: '仅支持 http/https 链接' }
  // SSRF 防护：禁止抓取内网/回环/链路本地/保留地址
  try {
    if (isBlockedTarget(new URL(target).hostname)) return { success: false, error: '禁止访问内网或本地地址' }
  } catch {
    return { success: false, error: '链接格式不合法' }
  }

  const MAX_BYTES = 3 * 1024 * 1024 // 超大页面截断，避免内存问题
  const MAX_CHARS = 8000 // 返回给 AI 的正文长度上限

  try {
    const html = await new Promise((resolve, reject) => {
      const req = net.request({ method: 'GET', url: target })
      const timer = setTimeout(() => {
        try { req.abort() } catch (e) {}
        reject(new Error('请求超时'))
      }, 15000)
      let buf = Buffer.alloc(0)
      req.on('response', (res) => {
        res.on('data', (c) => {
          if (buf.length < MAX_BYTES) buf = Buffer.concat([buf, c])
          else { try { req.abort() } catch (e) {} }
        })
        res.on('end', () => { clearTimeout(timer); resolve(buf.toString('utf8')) })
        res.on('error', (err) => { clearTimeout(timer); reject(err) })
      })
      req.on('error', (err) => { clearTimeout(timer); reject(err) })
      req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')
      req.setHeader('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8')
      req.end()
    })

    // 提取标题
    const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const title = tm ? tm[1].replace(/\s+/g, ' ').trim() : ''

    // 提取正文：去掉脚本/样式/头部等，块级标签转换行，再剥掉全部标签
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(br|hr)[^>]*>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|pre|table|ul|ol|dl|dd|dt)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/&ensp;|&emsp;/g, ' ').replace(/&hellip;/g, '…').replace(/&mdash;/g, '—')
    // 逐行压缩空白并去掉空行堆积
    text = text.split('\n').map(l => l.trim()).filter(l => l).join('\n')
    text = text.replace(/\n{3,}/g, '\n\n').trim()

    if (!text) return { success: false, error: '未能从网页提取到正文（可能是纯脚本渲染页面）' }

    let truncated = false
    if (text.length > MAX_CHARS) { text = text.slice(0, MAX_CHARS); truncated = true }
    return { success: true, url: target, title, content: text, truncated }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// 获取当前位置（IP 定位，免费无密钥）：pconline 优先，ip-api 兜底
// 注意：走系统代理时定位结果可能是代理出口城市
ipcMain.handle('get-location', async () => {
  const { net } = require('electron')
  const fetchText = (url) => new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url })
    const timer = setTimeout(() => {
      try { req.abort() } catch (e) {}
      reject(new Error('请求超时'))
    }, 8000)
    req.on('response', (res) => {
      let body = ''
      res.on('data', (c) => { body += c.toString('utf8') })
      res.on('end', () => { clearTimeout(timer); resolve(body) })
      res.on('error', (err) => { clearTimeout(timer); reject(err) })
    })
    req.on('error', (err) => { clearTimeout(timer); reject(err) })
    req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')
    req.end()
  })

  const errors = []
  try {
    const t = await fetchText('https://whois.pconline.com.cn/ipJson.jsp?json=true')
    const j = JSON.parse(t.trim())
    if (j && j.city && !j.err) {
      const isp = String(j.addr || '').replace(String(j.pro || ''), '').replace(String(j.city || ''), '').trim()
      return { success: true, ip: j.ip || '', country: '中国', province: j.pro || '', city: j.city, isp, source: 'pconline' }
    }
    errors.push('pconline 无有效数据')
  } catch (e) { errors.push('pconline ' + e.message) }

  try {
    const t = await fetchText('http://ip-api.com/json/?lang=zh-CN')
    const j = JSON.parse(t)
    if (j && j.status === 'success' && j.city) {
      return { success: true, ip: j.query || '', country: j.country || '', province: j.regionName || '', city: j.city, isp: j.isp || '', source: 'ip-api' }
    }
    errors.push('ip-api 无有效数据')
  } catch (e) { errors.push('ip-api ' + e.message) }

  return { success: false, error: '定位失败：' + errors.join('；') }
})

// 开机自启动：Windows 下 app.setLoginItemSettings 会写入注册表
// HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
ipcMain.handle('auto-launch:get', () => {
  try {
    return app.getLoginItemSettings().openAtLogin
  } catch (error) {
    console.error('读取开机自启动状态失败:', error)
    return false
  }
})

ipcMain.handle('auto-launch:set', (event, enable) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enable,
      // 打包后指向应用 exe；开发态指向 electron.exe（便于本地调试）
      path: process.execPath,
      args: []
    })
    return { success: true, enabled: app.getLoginItemSettings().openAtLogin }
  } catch (error) {
    console.error('设置开机自启动失败:', error)
    return { success: false, error: error.message }
  }
})

// 默认保存目录（桌面）
let defaultSaveDir = ''

function getDefaultSaveDir() {
  if (!defaultSaveDir) {
    defaultSaveDir = app.getPath('desktop')
  }
  return defaultSaveDir
}

// 将默认保存目录挂载到 app 上，供 IPC 模块使用
app.whenReady().then(() => {
  try { networkMonitor.start() } catch (e) { console.error('[networkMonitor] start failed:', e) }
  app.defaultSaveDir = getDefaultSaveDir()
})

let mainWindow = null
let tray = null
let isQuiting = false

// 系统托盘：关闭窗口后应用驻留后台，点击托盘图标恢复窗口
function createTray() {
  let trayIcon
  try {
    trayIcon = nativeImage.createFromPath(path.join(__dirname, 'icons', 'tray-32.png'))
  } catch (e) {}
  if (!trayIcon || trayIcon.isEmpty()) {
    trayIcon = nativeImage.createFromPath(path.join(__dirname, 'icons', 'icon.png'))
  }

  tray = new Tray(trayIcon)
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuiting = true
        app.quit()
      }
    }
  ])
  tray.setToolTip('my-mindmap agent')
  tray.setContextMenu(contextMenu)
  // 左键单击托盘图标：显示/隐藏窗口
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      showMainWindow()
    }
  })
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// 校验外部前端资源目录（resources/app-dist）的完整性：
// 外部目录自带 .integrity-manifest.json（由 tools/gen-integrity-manifest.js 生成，
// 轻量更新器 update.nsi 会连同前端资源一起同步复制），逐文件比对 SHA256。
// 任一文件缺失或哈希不匹配即判定为被篡改，返回 false（回退包内资源）。
// 说明：校验的是「外部 manifest 与外部文件的内部一致性」，可拦截"替换单个 JS 注入"类常见篡改；
// 若同时篡改文件与 manifest 则需进一步签名（当前无代码签名，暂不做）。
function verifyExternalDist(externalDir) {
  try {
    const manifestPath = path.join(externalDir, 'integrity-manifest.json')
    if (!fs.existsSync(manifestPath)) return false
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const expected = manifest && manifest.files
    if (!expected || typeof expected !== 'object' || Object.keys(expected).length === 0) return false
    for (const rel of Object.keys(expected)) {
      const file = path.join(externalDir, rel)
      if (!fs.existsSync(file)) return false
      const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
      if (hash !== expected[rel]) return false
    }
    return true
  } catch (e) {
    return false
  }
}

function createWindow() {
  // 开机自启动带 --hidden 参数：静默驻留托盘，不弹窗口；用户手动双击则正常显示
  const startHidden = process.argv.includes('--hidden')
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'my-mindmap agent',
    icon: path.join(__dirname, 'icons', 'icon.ico'),
    autoHideMenuBar: true,
    show: !startHidden,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // 隐藏顶部 File/Edit/View/Window/Help 菜单栏
  mainWindow.setMenu(null)

  // 兜底拦截窗口导航（如拖入文件时 Chromium 默认打开 file:// 导致应用被替换；正常业务不使用页面跳转）
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // 开发环境加载本地服务器，生产环境加载打包后的文件
  if (process.env.NODE_ENV === 'development') {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
    mainWindow.loadURL(devServerUrl)
    // 开发环境自动打开开发者工具
    mainWindow.webContents.openDevTools()
    // 临时诊断：把渲染进程控制台输出 / 加载失败 / 渲染进程崩溃 转发到主进程 stdout，
    // 便于在终端定位"白屏但终端无报错"的真因（排查完删除）
    mainWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
      console.log(`[renderer][${level}] ${message}  (${sourceId}:${line})`)
    })
    mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
      console.log(`[did-fail-load] code=${code} desc=${desc} url=${url}`)
    })
    mainWindow.webContents.on('render-process-gone', (e, details) => {
      console.log(`[render-process-gone] ${JSON.stringify(details)}`)
    })
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[did-finish-load] page finished loading')
    })
  } else {
    // 生产环境：优先加载外部前端资源目录 resources/app-dist（轻量更新器 update.nsi 只替换此目录，
    // 几秒完成一次前端更新，无需重跑完整安装）；加载前做 SHA256 完整性校验，
    // 防止外部目录被篡改注入恶意 JS；目录不存在或校验失败时回退到包内 asar 的 dist
    const externalDir = path.join(process.resourcesPath, 'app-dist')
    const externalIndex = path.join(externalDir, 'index.html')
    const bundledIndex = path.join(__dirname, '..', 'dist', 'index.html')
    if (fs.existsSync(externalIndex)) {
      if (verifyExternalDist(externalDir)) {
        console.log('[loader] 使用外部前端资源（完整性校验通过）:', externalIndex)
        mainWindow.loadFile(externalIndex)
      } else {
        console.warn('[loader] 外部前端资源完整性校验失败，回退包内资源')
        mainWindow.loadFile(bundledIndex)
      }
    } else {
      mainWindow.loadFile(bundledIndex)
    }
  }

  // 检查是否由定时任务触发（--scheduled-task=<taskId>）
  const taskId = parseScheduledTaskArg(process.argv)
  if (taskId) {
    // 等待渲染进程加载完成后发送定时任务触发事件
    forwardScheduledTask(mainWindow, taskId)
  }

  // 点击右上角叉号：不退出，仅隐藏窗口驻留后台（托盘仍在运行）
  mainWindow.on('close', (e) => {
    if (!isQuiting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ============ 单实例锁 ============
// 防止定时任务（schtasks）触发时开出第二个窗口：
// 拿不到锁的实例直接退出；由已运行的第一实例在 second-instance 事件中
// 接收第二实例的命令行参数，转发定时任务并聚焦已有窗口。
const gotTheLock = app.requestSingleInstanceLock()

// 解析命令行数组中的 --scheduled-task=<taskId> / --scheduled-task <taskId>
function parseScheduledTaskArg(argv) {
  const eqArg = argv.find(arg => arg.startsWith('--scheduled-task='))
  if (eqArg) return eqArg.split('=')[1]
  const idx = argv.indexOf('--scheduled-task')
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1]
  return null
}

// 解析命令行中的 .smm 文件路径（Windows 双击 .smm 文件 → 系统把文件路径作为参数传给应用）
function parseOpenFilePath(argv) {
  const p = (argv || []).find(arg => {
    if (typeof arg !== 'string' || !arg) return false
    if (arg.startsWith('-')) return false
    return /\.smm$/i.test(arg)
  })
  return p ? path.resolve(p) : null
}

// 转发定时任务触发事件到渲染进程（等待页面加载完成，避免事件丢失）
function forwardScheduledTask(win, taskId) {
  const send = () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('task:scheduledTrigger', taskId)
    }
  }
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

// 转发"打开 .smm 文件"事件到渲染进程（等待页面加载完成，避免事件丢失）
function forwardOpenFile(win, filePath) {
  if (!filePath) return
  const send = () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:openFile', filePath)
    }
  }
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

if (!gotTheLock) {
  // 已有实例在运行：本实例退出，任务由 first-instance 的 second-instance 处理器转交
  app.quit()
} else {
  // 第二实例启动：定时任务静默执行不弹窗；普通启动才聚焦已有窗口
  app.on('second-instance', (event, commandLine) => {
    if (!mainWindow || mainWindow.isDestroyed()) return

    const taskId = parseScheduledTaskArg(commandLine)
    if (taskId) {
      // 定时任务触发：后台静默执行，不弹出窗口、不抢焦点
      // 只转发任务事件到渲染进程，让 AI 在后台处理
      forwardScheduledTask(mainWindow, taskId)
      return
    }

    // 双击 .smm 文件：聚焦窗口并转发文件打开事件
    const openFilePath = parseOpenFilePath(commandLine)
    if (openFilePath) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      forwardOpenFile(mainWindow, openFilePath)
      return
    }

    // 普通启动（用户手动双击）：正常显示并聚焦窗口
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    // 确保默认保存目录已初始化
    app.defaultSaveDir = getDefaultSaveDir()

    // 开机自启动：不再默认强制开启（原逻辑打包后每次启动幂等写入注册表 + --hidden 静默驻留）。
    // 改为由用户在设置界面通过 auto-launch:set 手动控制，避免应用默认持续后台驻留增大攻击面。
    // （若用户曾手动开启，注册表项已存在，app 启动仍会自动拉起，符合用户预期）

    createWindow()
    createTray()

    // 首次启动即通过双击 .smm 文件拉起：把命令行中的文件路径转发给渲染进程打开
    const startupOpenFile = parseOpenFilePath(process.argv)
    if (startupOpenFile) {
      forwardOpenFile(mainWindow, startupOpenFile)
    }

    httpServerModule.init(() => mainWindow)
    httpServerModule.initAutoStart()

    // 上次用户保持飞书机器人长连接开启的话，等渲染页面加载完成后自动恢复启动
    // （避免消息早于渲染进程就绪到达而丢失）
    const botWin = BrowserWindow.getAllWindows()[0]
    const restoreBot = () => {
      feishuBotModule.initAutoStart()
      wechatBotModule.initAutoStart()
    }
    if (botWin && botWin.webContents.isLoading()) {
      botWin.webContents.once('did-finish-load', restoreBot)
    } else {
      restoreBot()
    }

    app.on('activate', () => {
      // macOS 中点击 dock 图标且没有其他窗口打开时，重新创建一个窗口
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  // 真正退出前标记，允许 close 事件通过
  app.on('before-quit', () => {
    isQuiting = true
    // 退出前同步落盘搜索索引数据库（写盘已节流，这里强制 flush 避免丢数据）
    try {
      databaseModule.flushDatabaseSync()
    } catch (e) {
      console.error('退出时写盘失败:', e)
    }
  })

  // 应用常驻后台：窗口全部隐藏后不退出，仅通过托盘菜单“退出”结束进程
  app.on('window-all-closed', () => {
    // 不做任何事，保持后台运行
  })
}
