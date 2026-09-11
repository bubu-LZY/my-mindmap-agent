/**
 * run_code - JS 代码执行工具
 *
 * 在独立 Web Worker 中执行用户代码：
 * - 没有 window / document / localStorage / 当前页面工具集合
 * - 仅暴露 tools / mindMap 快照 / context / console
 * - 工具调用通过 postMessage RPC 回到主线程，由 ToolRegistry 执行
 */

import { toolRegistry } from '../ToolRegistry'

const RUN_TIMEOUT = 60000

// run_code 工具白名单：按风险等级分为只读和读写两类
// 只读工具 → 自动执行，无需用户确认
// 读写工具 → 需用户确认后才能执行
// 不允许：删除本地/云端文件、发送消息、外部上传等高风险动作
const READONLY_RUN_CODE_TOOLS = new Set([
  // 导图读取
  'get_mindmap_content',
  'get_mindmap_info',
  'get_node_detail',
  'query_node_styles',
  'read_mindmap_file',
  'read_node_subtree',
  // 节点查询
  'query_nodes',
  'search_nodes',
  'focus_node',
  // 挖空查询
  'list_cloze_nodes',
  // 知识库检索
  'semantic_search',
  'search_knowledge_base',
  // 文件读取
  'read_local_file',
  'retrieve_local_file',
  'find_local_file',
  'list_directory',
  // 发现类（只读）
  'list_mcp_servers',
  'list_mcp_tools',
  'list_skills',
  'list_custom_tools',
  'semantic_tool_search',
  'activate_tools',
])

const READWRITE_RUN_CODE_TOOLS = new Set([
  // 节点编辑
  'update_node_text',
  'update_node_note',
  'expand_node',
  'add_child_nodes',
  'insert_parent_node',
  'delete_node',
  'merge_nodes',
  'batch_move_nodes',
  'reorder_nodes',
  'batch_node_actions',
  // 样式
  'set_node_style',
  'format_painter',
  // 挖空操作
  'toggle_cloze_visibility',
  'clear_cloze',
  'ai_cloze',
  'ai_cloze_review',
  'mechanical_cloze',
  // 保存/导出
  'save_mindmap',
  'export_to_markdown',
  'export_mindmap_html',
  'export_mindmap_pdf',
  'export_outline_pdf',
  'export_subtree',
  // 导图整体操作（拆分/合并/导入/生成）
  'split_mindmap',
  'merge_mindmap_files',
  'import_file_as_mindmap',
  'generate_mindmap',
  'convert_doc_to_mindmap',
])

const ALLOWED_RUN_CODE_TOOLS = new Set([
  ...READONLY_RUN_CODE_TOOLS,
  ...READWRITE_RUN_CODE_TOOLS,
])

const buildWorkerSource = () => `
"use strict";
let toolSeq = 0;
const pendingTools = new Map();

const tools = new Proxy({}, {
  get(_, name) {
    return async (...args) => {
      const reqId = ++toolSeq;
      return new Promise((resolve, reject) => {
        pendingTools.set(reqId, { resolve, reject });
        postMessage({ type: 'tool', reqId, name, args });
      });
    };
  }
});

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type === 'tool-result') {
    const pending = pendingTools.get(msg.reqId);
    if (!pending) return;
    pendingTools.delete(msg.reqId);
    if (msg.error) pending.reject(new Error(msg.error));
    else pending.resolve(msg.result);
    return;
  }

  if (msg.type !== 'run') return;
  const { code, context } = msg;
  const logs = [];
  const sandboxConsole = {
    log: (...values) => logs.push(values.map(formatValue).join(' ')),
    warn: (...values) => logs.push('[WARN] ' + values.map(formatValue).join(' ')),
    error: (...values) => logs.push('[ERROR] ' + values.map(formatValue).join(' ')),
    info: (...values) => logs.push(values.map(formatValue).join(' '))
  };

  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction('tools', 'mindMap', 'context', 'console', code);
    const result = await fn(tools, context?.mindMap || null, context || {}, sandboxConsole);
    postMessage({ type: 'done', result, logs });
  } catch (error) {
    postMessage({
      type: 'error',
      error: error?.message || String(error),
      stack: error?.stack || '',
      logs
    });
  }
};

function formatValue(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
`

const formatResult = (result) => {
  if (typeof result === 'string') return result
  if (result === null || result === undefined) return String(result)
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

export const runCodeTool = {
  name: 'run_code',
  category: 'AI',
  description: 'Execute JavaScript code in an isolated Web Worker with a minimal tool-calling API. The code has NO access to window, document, localStorage, or the full tool registry; it can call allowlisted tools through await tools.toolName(args). Requires user confirmation before execution.',
  parameters: {
    code: {
      type: 'string',
      description: 'JavaScript code to execute. Use await tools.toolName(args) to call allowlisted tools. Available globals: tools, mindMap (serializable snapshot), context, console.',
    },
    description: {
      type: 'string',
      description: 'Brief description of what this code does (shown to user in confirmation dialog)',
    },
  },
  required: ['code'],
  timeout: RUN_TIMEOUT,
  outputLimit: 500 * 1024,
  dangerous: '执行自定义 JavaScript 代码，可能操作文件、修改导图、调用外部工具',
  _isNewStyle: true,

  handler: async (args, context) => {
    const { code, description } = args

    if (!code || typeof code !== 'string') {
      return { success: false, message: '请提供 code 参数' }
    }

    // 只有用户在确认弹窗中明确批准了这段代码，才授予写权限；默认按只读运行。
    const writeApproved = context?.extraHandlers?.runCodeWriteApproved === true

    const blob = new Blob([buildWorkerSource()], { type: 'text/javascript' })
    const workerUrl = URL.createObjectURL(blob)
    const worker = new Worker(workerUrl)

    try {
      const execution = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          worker.terminate()
          reject(new Error(`代码执行超时（${Math.round(RUN_TIMEOUT / 1000)}秒）`))
        }, RUN_TIMEOUT)

        worker.onmessage = async (event) => {
          const msg = event.data || {}
          if (msg.type === 'tool') {
            try {
              if (!ALLOWED_RUN_CODE_TOOLS.has(msg.name)) {
                throw new Error(`run_code 不允许调用工具 ${msg.name}。请改用白名单内的批量/查询/读取工具。`)
              }
              // 运行时写授权：是否"只读"不能只靠对代码文本做正则静态分析——
              // tools['delete'+'_node']() 或 const t = tools 再调用都能绕过匹配，
              // 让写操作代码被当成只读自动放行。真正的授权必须收口在这个唯一的
              // RPC 边界上：调用方未显式授予写权限时，一律拒绝读写类工具。
              if (!writeApproved && READWRITE_RUN_CODE_TOOLS.has(msg.name)) {
                throw new Error(`run_code 未获得写操作授权，已拒绝调用 ${msg.name}。请让用户在确认弹窗中批准写操作，或把代码改为只使用只读工具。`)
              }
              // 内部工具调用视为已确认：run_code 自身已在执行前经过危险操作确认，
              // 不再对每个子工具重复弹窗。
              const result = await toolRegistry.call(msg.name, msg.args || {}, {
                ...context,
                extraHandlers: { ...(context?.extraHandlers || {}), dangerPreConfirmed: true }
              })
              worker.postMessage({ type: 'tool-result', reqId: msg.reqId, result })
            } catch (error) {
              worker.postMessage({
                type: 'tool-result',
                reqId: msg.reqId,
                error: error?.message || String(error)
              })
            }
            return
          }

          if (msg.type === 'done') {
            clearTimeout(timer)
            resolve({ result: msg.result, logs: msg.logs || [] })
            return
          }

          if (msg.type === 'error') {
            clearTimeout(timer)
            reject(Object.assign(new Error(msg.error || '代码执行出错'), {
              stack: msg.stack || ''
            }))
          }
        }

        worker.onerror = (event) => {
          clearTimeout(timer)
          reject(new Error(event.message || 'Worker 执行失败'))
        }

        // Worker 无法克隆 MindMap 实例/函数，只把可序列化快照传进去。
        const workerContext = {
          mindMap: typeof context?.mindMap?.getData === 'function' ? context.mindMap.getData() : null,
          currentFilePath: typeof context?.extraHandlers?.currentFilePath === 'function' ? context.extraHandlers.currentFilePath() : '',
          currentFileName: typeof context?.extraHandlers?.currentFileName === 'function' ? context.extraHandlers.currentFileName() : ''
        }
        worker.postMessage({ type: 'run', code, context: workerContext })
      })

      const { result, logs } = await execution
      const output = (logs || []).join('\n')
      const resultStr = result !== undefined ? formatResult(result) : ''

      let message = ''
      if (description) message += `【${description}】执行完成\n\n`
      if (output) message += `输出：\n${output}\n\n`
      if (resultStr) message += `返回值：\n${resultStr}`
      if (!message) message = '代码执行完成，无输出。'

      return {
        success: true,
        message,
        result: result ?? null,
        logs
      }
    } catch (error) {
      return {
        success: false,
        message: `代码执行出错：${error.message}`,
        error: error.message,
        stack: error.stack || ''
      }
    } finally {
      URL.revokeObjectURL(workerUrl)
      worker.terminate()
    }
  },
}

export default runCodeTool

// 导出只读/读写工具分类，供外部判断代码安全性
export { READONLY_RUN_CODE_TOOLS, READWRITE_RUN_CODE_TOOLS, ALLOWED_RUN_CODE_TOOLS }
