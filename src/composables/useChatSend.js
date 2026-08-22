/**
 * useChatSend — 从 ChatPanel.vue 提取的 AI 消息发送逻辑
 * 将 sendMessage 的核心流程拆分为独立函数，方便测试和复用
 */

import { aiService } from '../services/aiService'
import { handleToolCall, getCoreTools, TOOL_METADATA, buildToolCatalogText } from '../services/toolHandler'
import { loadMemory } from '../utils/aiMemory'
import { countNodes, treeToSkeletonText } from '../utils/treeUtils'
import { useMindMapStore } from '../stores/mindMapStore'

/**
 * 构建 AI 请求所需的动态上下文
 */
export function buildDynamicContext({ currentFilePath, currentFileName, mindMap, memoryContent }) {
  const fileInfo = currentFilePath
    ? `当前打开的文件：${currentFileName}（路径：${currentFilePath}）`
    : '当前没有打开任何文件。'

  let context = `\n\n## Current time\nToday is ${(() => {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  })()}. Use this date for time references.\n\n## Current file\n${fileInfo}`

  // 注入导图骨架信息
  if (mindMap && currentFilePath) {
    try {
      const data = mindMap.getData()
      const nodeCount = countNodes(data)
      const skeleton = treeToSkeletonText(data, 2)
      context += `\n\n## Current mind map (file: ${currentFileName})\n- Total nodes: ${nodeCount}\n- Skeleton (top 2 levels):\n${skeleton || '(empty)'}\n- To read full map content, call get_mindmap_content(mode="full"); to query specific nodes call search_nodes(keyword="...") or focus_node.`
    } catch { /* 导图实例未就绪 */ }
  }

  // 注入永久记忆
  const mem = memoryContent || loadMemory()
  if (mem && mem.trim()) {
    context += `\n\n## Permanent memory (user instructions, ALWAYS follow)\n${mem.trim()}`
  }

  return context
}

/**
 * 构建发送给 AI 的完整消息列表（含系统提示词 + 压缩上下文）
 */
export function buildMessagesToSend({ systemPrompt, historyMessages, dynamicContext, finalUserText }) {
  const messages = [...historyMessages]
  // 替换最后一条 user 消息为带动态上下文的完整文本
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      messages[i].content = finalUserText + dynamicContext
      break
    }
  }
  return [{ role: 'system', content: systemPrompt }, ...messages]
}

/**
 * 构建 AI 工具调用回调
 */
export function buildToolCallbacks({ mindMap, activeNode, currentFilePath, currentFileName, emit, onToolCallStatus, onLogUpdated }) {
  const mindMapStore = useMindMapStore()

  return {
    onChunk: (chunk) => { /* 由调用方传入 */ },
    onToolCall: async (toolCall) => {
      onToolCallStatus?.('calling')
      try {
        const result = await handleToolCall(toolCall, mindMap, activeNode, {
          currentFilePath: () => currentFilePath,
          currentFileName: () => currentFileName,
          switchView: (mode) => emit?.('switch-view', mode),
          onFileCreated: (path) => emit?.('file-created', path),
          onExternalFileCreated: () => emit?.('external-file-created'),
          onFileDeleted: () => emit?.('file-deleted'),
          onFileRenamed: (newPath) => emit?.('file-renamed', { oldPath: currentFilePath, newPath }),
          onLogUpdated: () => onLogUpdated?.(),
          aiContinue: async () => {},
          aiAddChild: async () => {},
          aiRewrite: async () => {},
          aiCloze: async () => {},
          aiQuiz: async () => {},
          aiReciteRewrite: async () => {},
          addToInput: () => {},
          addReview: () => {}
        })
        onToolCallStatus?.('done')
        return result
      } catch (e) {
        onToolCallStatus?.('error')
        return { success: false, message: e.message }
      }
    },
    onDone: () => {
      mindMapStore.setActiveTaskFileId('')
      onToolCallStatus?.('done')
    },
    onError: (err) => {
      mindMapStore.setActiveTaskFileId('')
      onToolCallStatus?.('error')
    }
  }
}

/**
 * 剥离历史消息中的动态上下文块（这些每轮重新注入，留在历史里会炸 token）
 */
export function stripDynamicContext(text) {
  if (typeof text !== 'string') return text
  const idx = text.indexOf('\n## Current time')
  if (idx >= 0) return text.slice(0, idx)
  const idx2 = text.indexOf('\n## 当前时间')
  if (idx2 >= 0) return text.slice(0, idx2)
  const idx3 = text.indexOf('\n【永久记忆')
  if (idx3 >= 0) return text.slice(0, idx3)
  return text
}
