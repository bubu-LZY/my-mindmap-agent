/**
 * 旧版工具桥接器
 *
 * 将 toolHandler.js 中已有的工具定义和 switch-case 处理器
 * 桥接到 ToolRegistry 中，使所有工具立即获得：
 * - 超时控制
 * - 输出大小限制
 * - 统一的注册/发现接口
 *
 * 后续可以逐步将工具迁移到独立文件中，替换掉桥接层。
 */

import { toolRegistry, TIMEOUT_PRESETS } from './ToolRegistry'

/**
 * 从旧版 aiTools 数组和 handleToolCall 函数构建注册表
 *
 * @param {Array} aiTools - 旧版工具定义数组（OpenAI function calling 格式）
 * @param {Function} handleToolCall - 旧版工具调用处理器 (toolCall, mindMap, activeNode, extraHandlers)
 * @param {Object} options - 配置选项
 * @param {Object} options.dangerousMap - 危险工具映射 { toolName: warningMessage }
 * @param {Object} options.timeoutMap - 工具超时配置 { toolName: timeoutMs }
 * @param {Object} options.categoryMap - 工具分类映射 { toolName: category }（可选，优先用 aiTools 自带的）
 */
export function registerLegacyTools(aiTools, handleToolCall, options = {}) {
  const { dangerousMap = {}, timeoutMap = {}, categoryMap = {} } = options

  for (const toolDef of aiTools) {
    const name = toolDef.function.name
    const description = toolDef.function.description
    const parameters = toolDef.function.parameters?.properties || {}
    const required = toolDef.function.parameters?.required || []

    // 分类优先从 toolCatalog 来，但 aiTools 里没有 category 字段
    // 所以用 categoryMap 传入，或者默认 'Other'
    const category = categoryMap[name] || 'Other'

    // 超时配置
    let timeout = timeoutMap[name]
    if (timeout === undefined) {
      // 根据分类和名称智能推断超时
      timeout = inferTimeout(name, category)
    }

    // 危险操作标记
    const dangerous = dangerousMap[name] || false

    // 构建桥接 handler
    const handler = createLegacyHandler(name, handleToolCall)

    toolRegistry.register({
      name,
      category,
      description,
      parameters,
      required,
      timeout,
      outputLimit: inferOutputLimit(name, category),
      dangerous,
      handler,
    })
  }

  return toolRegistry.list().length
}

/**
 * 创建桥接处理函数
 * 将旧版 handleToolCall 的调用方式适配为新版 (args, context) 格式
 */
function createLegacyHandler(toolName, handleToolCall) {
  return async (args, context) => {
    const toolCall = {
      name: toolName,
      arguments: args || {},
    }

    const result = await handleToolCall(
      toolCall,
      context.mindMap || null,
      context.activeNode || null,
      context.extraHandlers || {}
    )

    return result
  }
}

/**
 * 根据工具名称和分类智能推断超时时间
 */
function inferTimeout(name, category) {
  // AI 相关工具：2分钟
  if (
    category === 'AI' ||
    name.startsWith('ai_') ||
    name.includes('ai_') ||
    name === 'parallel_ai_workers' ||
    name === 'research_to_mindmap' ||
    name === 'semantic_search' ||
    name === 'semantic_tool_search' ||
    name === 'search_knowledge_base'
  ) {
    return TIMEOUT_PRESETS.ai // 120秒
  }

  // 导图操作：不设硬超时（大导图可能很慢，用进度反馈代替）
  if (
    category === 'Mindmap' ||
    name === 'generate_mindmap' ||
    name === 'add_child_nodes' ||
    name === 'ai_continue_children' ||
    name === 'ai_cloze_full_map' ||
    name === 'ai_quiz' ||
    name === 'reorganize_mindmap' ||
    name === 'refactor_mindmap' ||
    name === 'merge_mindmap_files' ||
    name === 'convert_doc_to_mindmap' ||
    name === 'import_file_as_mindmap'
  ) {
    return TIMEOUT_PRESETS.mindmap // 不超时
  }

  // 导出相关：1分钟
  if (
    category === 'Export' ||
    name.startsWith('export_') ||
    name === 'save_mindmap'
  ) {
    return TIMEOUT_PRESETS.slow // 60秒
  }

  // 文件读取（大文件可能慢）
  if (
    name === 'read_local_file' ||
    name === 'retrieve_local_file' ||
    name === 'parseDocument' ||
    name === 'pdfToImages'
  ) {
    return TIMEOUT_PRESETS.slow // 60秒
  }

  // 飞书/微信/网络相关：30秒
  if (
    category === 'Feishu' ||
    category === 'Push' ||
    category === 'Web' ||
    name.startsWith('feishu_') ||
    name.startsWith('send_') ||
    name.startsWith('upload_') ||
    name === 'search_web' ||
    name === 'read_webpage'
  ) {
    return TIMEOUT_PRESETS.normal // 30秒
  }

  // 节点操作（批量可能慢）
  if (
    name === 'batch_node_actions' ||
    name === 'batch_text_style' ||
    name === 'batch_move_nodes' ||
    name === 'duplicate_nodes' ||
    name === 'find_replace_text' ||
    name === 'set_node_style'
  ) {
    return TIMEOUT_PRESETS.mindmap // 不设硬超时
  }

  // 默认：30秒
  return TIMEOUT_PRESETS.normal
}

/**
 * 根据工具名称智能推断输出大小限制
 */
function inferOutputLimit(name, category) {
  // 可能返回大量数据的工具：放宽到 5MB
  if (
    name === 'get_mindmap_content' ||
    name === 'read_local_file' ||
    name === 'retrieve_local_file' ||
    name === 'search_nodes' ||
    name === 'query_nodes' ||
    name === 'semantic_search' ||
    name === 'search_knowledge_base' ||
    name === 'get_review_schedule' ||
    name === 'export_mindmap' ||
    name === 'export_to_markdown'
  ) {
    return 5 * 1024 * 1024 // 5MB
  }

  // MCP 工具调用：输出可能较大
  if (name === 'mcp_call_tool') {
    return 5 * 1024 * 1024 // 5MB
  }

  // 默认：2MB
  return 2 * 1024 * 1024
}

export default registerLegacyTools
