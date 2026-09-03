/**
 * run_code - JS 代码执行工具
 *
 * 在沙箱环境中执行 JavaScript 代码，可以调用所有已注册的工具。
 * 用于批量操作、复杂逻辑、数据处理等场景。
 *
 * 安全机制：
 * - 执行前需要用户确认
 * - 超时控制
 * - 输出大小限制
 * - 沙箱环境只暴露必要的 API
 */

import { toolRegistry } from '../ToolRegistry'

export const runCodeTool = {
  name: 'run_code',
  category: 'AI',
  description: 'Execute JavaScript code in a sandbox with full tool access. Use for batch operations, complex logic, data processing, or when multiple tool calls can be combined into one script. Tools are available via await tools.toolName(args). The code has access to the mindMap instance, file system helpers, and all registered tools.',
  parameters: {
    code: {
      type: 'string',
      description: 'JavaScript code to execute. Use await tools.toolName(args) to call tools. Available globals: tools (all registered tools), mindMap (current mindmap instance), console (log to output), context (execution context). Return a value to include it in the result.',
    },
    description: {
      type: 'string',
      description: 'Brief description of what this code does (shown to user in confirmation dialog)',
    },
  },
  required: ['code'],
  timeout: 60000, // 60秒
  outputLimit: 500 * 1024, // 500KB
  dangerous: '执行自定义 JavaScript 代码，可能操作文件、修改导图、调用外部工具',

  // 标记为新版格式工具（handleToolCall 会通过 Registry 调用）
  _isNewStyle: true,

  handler: async (args, context) => {
    const { code, description } = args

    if (!code || typeof code !== 'string') {
      return { success: false, message: '请提供 code 参数' }
    }

    // 构建工具代理对象：让代码里可以用 await tools.toolName(args) 调用工具
    const toolsProxy = new Proxy({}, {
      get: (_, toolName) => {
        return async (toolArgs = {}) => {
          const result = await toolRegistry.call(toolName, toolArgs, context)
          return result
        }
      },
    })

    // 收集 console 输出
    const logs = []
    const sandboxConsole = {
      log: (...msgs) => logs.push(msgs.map(m => formatConsoleArg(m)).join(' ')),
      warn: (...msgs) => logs.push('[WARN] ' + msgs.map(m => formatConsoleArg(m)).join(' ')),
      error: (...msgs) => logs.push('[ERROR] ' + msgs.map(m => formatConsoleArg(m)).join(' ')),
      info: (...msgs) => logs.push(msgs.map(m => formatConsoleArg(m)).join(' ')),
    }

    // 构建沙箱函数
    // 注意：使用 new Function 而不是 eval，以限制作用域
    const sandboxFn = new Function(
      'tools',
      'mindMap',
      'context',
      'console',
      `
        "use strict";
        return (async () => {
          ${code}
        })();
      `
    )

    try {
      const result = await sandboxFn(
        toolsProxy,
        context.mindMap || null,
        context,
        sandboxConsole
      )

      const output = logs.join('\n')
      const resultStr = result !== undefined ? formatResult(result) : ''

      let message = ''
      if (description) {
        message += `【${description}】执行完成\n\n`
      }
      if (output) {
        message += `输出：\n${output}\n\n`
      }
      if (resultStr) {
        message += `返回值：\n${resultStr}`
      }
      if (!message) {
        message = '代码执行完成，无输出。'
      }

      return {
        success: true,
        message,
        result: result ?? null,
        logs,
      }
    } catch (error) {
      const output = logs.join('\n')
      return {
        success: false,
        message: `代码执行出错：${error.message}\n\n${output ? `执行到出错前的输出：\n${output}` : ''}`,
        error: error.message,
        stack: error.stack,
        logs,
      }
    }
  },
}

// 格式化 console 参数
function formatConsoleArg(arg) {
  if (typeof arg === 'string') return arg
  if (arg === null) return 'null'
  if (arg === undefined) return 'undefined'
  try {
    return JSON.stringify(arg, null, 2)
  } catch {
    return String(arg)
  }
}

// 格式化返回结果
function formatResult(result) {
  if (typeof result === 'string') return result
  if (result === null || result === undefined) return String(result)
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

export default runCodeTool
