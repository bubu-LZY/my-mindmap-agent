/**
 * AI 接口工具调用行为探测脚本（node tools/api-toolcall-probe.js）
 *
 * 用途：检测当前配置的 AI 接口在流式模式下是否会正确返回
 *      finish_reason: 'tool_calls'。部分中转站只返回 'stop' 或不返回，
 *      导致 chatWithCallbacks 累积的工具调用被整体丢弃（工具永不执行）。
 *
 * 读取 %APPDATA%/mind-map-ai-agent/config.json 中的 aiConfig，
 * 发送一次强制工具调用的小请求（max_tokens 受限，成本极低），
 * 输出每个 chunk 的 finish_reason、工具调用增量与参数完整性判定。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

function loadConfig() {
  const cfgPath = path.join(os.homedir(), 'AppData', 'Roaming', 'mind-map-ai-agent', 'config.json')
  if (!fs.existsSync(cfgPath)) {
    console.error('未找到配置文件:', cfgPath)
    process.exit(1)
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  if (!cfg.aiConfig || !cfg.aiConfig.baseURL) {
    console.error('配置中没有 aiConfig.baseURL')
    process.exit(1)
  }
  return cfg.aiConfig
}

function buildChatURL(baseURL) {
  let url = baseURL.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(url)) return url
  if (/\/v1$/i.test(url)) return url + '/chat/completions'
  return url + '/v1/chat/completions'
}

async function probe() {
  const { baseURL, apiKey, model } = loadConfig()
  const url = buildChatURL(baseURL)

  const body = {
    model,
    stream: true,
    max_tokens: 500,
    messages: [
      { role: 'user', content: '请调用 get_current_weather 工具查询北京的天气，不要直接用文字回答。' }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_current_weather',
          description: '查询指定城市的当前天气',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string', description: '城市名' } },
            required: ['city']
          }
        }
      }
    ],
    tool_choice: 'auto'
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)

  console.log('接口:', url.replace(/\/\/[^/]+/, '//<host>'))
  console.log('模型:', model)
  console.log('---')

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    if (!resp.ok) {
      const t = await resp.text().catch(() => '')
      console.error(`HTTP ${resp.status}: ${t.slice(0, 300)}`)
      process.exit(1)
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    const finishReasons = []
    const toolCalls = {}
    let chunkCount = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const dataStr = line.slice(5).trim()
        if (dataStr === '[DONE]') continue
        let parsed
        try { parsed = JSON.parse(dataStr) } catch { continue }
        chunkCount++
        const choice = parsed.choices && parsed.choices[0]
        if (!choice) continue
        if (choice.finish_reason) {
          finishReasons.push(choice.finish_reason)
        }
        const tc = choice.delta && choice.delta.tool_calls
        if (tc) {
          for (const c of tc) {
            const idx = c.index || 0
            if (!toolCalls[idx]) toolCalls[idx] = { id: '', name: '', args: '' }
            if (c.id) toolCalls[idx].id = c.id
            if (c.function && c.function.name) toolCalls[idx].name += c.function.name
            if (c.function && c.function.arguments) toolCalls[idx].args += c.function.arguments
          }
        }
      }
    }

    console.log('收到 chunk 数:', chunkCount)
    console.log('出现过的 finish_reason:', finishReasons.length ? finishReasons.join(', ') : '（从未返回）')
    const tcList = Object.values(toolCalls).filter(t => t.name)
    console.log('累积的工具调用数:', tcList.length)
    for (const t of tcList) {
      let argsOk = '（空参数，视为完整）'
      if (t.args) {
        try { JSON.parse(t.args); argsOk = '合法 JSON' } catch { argsOk = '非法 JSON（不完整）' }
      }
      console.log(`  - ${t.name}(${t.id || '无id'}) 参数: ${argsOk}  内容: ${t.args.slice(0, 120)}`)
    }

    console.log('---')
    const hasToolCallFinish = finishReasons.includes('tool_calls')
    const hasToolDeltas = tcList.length > 0
    if (hasToolDeltas && hasToolCallFinish) {
      console.log('结论: 标准接口。流式正确返回 finish_reason=tool_calls，当前严格门控不会误杀。')
    } else if (hasToolDeltas && !hasToolCallFinish) {
      console.log('结论: 中转站缺陷接口！有工具调用增量但 finish_reason 不是 tool_calls（实际为 ' +
        (finishReasons.join(', ') || '空') + '）。当前严格门控会把工具调用整体丢弃 —— 必须放宽。')
    } else if (!hasToolDeltas) {
      console.log('结论: 本次模型未发起工具调用（可能是模型能力或提示词原因），无法据此判定 finish_reason 行为。')
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('请求超时（60s）')
    } else {
      console.error('请求失败:', err.message)
    }
    process.exit(1)
  } finally {
    clearTimeout(timer)
  }
}

probe()
