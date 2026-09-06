/**
 * 工具模块入口
 *
 * 统一导出 ToolRegistry、工具定义、以及相关工具函数。
 *
 * 使用方式：
 *   import { toolRegistry, getCoreTools, handleToolCall } from './tools'
 *
 * 工具分类：
 * - mindmap/   思维导图整体操作
 * - node/      节点操作
 * - ai/        AI 相关能力
 * - study/     学习/挖空/复习
 * - file/      文件操作
 * - export/    导出功能
 * - web/       网络/搜索
 * - kb/        知识库
 * - mcp/       MCP 相关
 * - skills/    Skill 相关
 * - custom/    自定义工具
 * - meta/      元工具（工具发现等）
 * - view/      视图/布局/主题
 * - edit/      编辑操作
 */

import { ToolRegistry, toolRegistry, TIMEOUT_PRESETS } from './ToolRegistry'

export { ToolRegistry, toolRegistry, TIMEOUT_PRESETS }
export { registerLegacyTools } from './legacyBridge'

// ========== 新版格式工具（逐步迁移） ==========

// AI 类
import { runCodeTool } from './ai/runCode'

export { runCodeTool }

// 所有新版格式工具列表（用于批量注册）
const newTools = [
  // AI 类
  runCodeTool,
]

/**
 * 注册所有新版格式工具
 * 调用一次即可注册全部独立文件的工具
 */
export function registerAllNewTools() {
  for (const tool of newTools) {
    toolRegistry.register(tool)
  }
  return newTools.length
}

export default toolRegistry
