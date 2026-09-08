/**
 * list_tools - 列出所有可用工具
 *
 * 让 AI 可以查询当前有哪些可用工具，以及每个工具的简要说明。
 * 可按分类筛选，帮助 AI 快速找到需要的工具。
 */

import { toolRegistry } from '../ToolRegistry'

export const listToolsTool = {
  name: 'list_tools',
  category: 'Meta',
  description: '列出所有可用的工具及其简要说明。可按分类筛选，帮助你了解有哪些能力可用。当你不确定该用什么工具时，先调用这个工具。',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: '按分类筛选工具，例如 "Node"、"File"、"Export" 等。不填则列出所有工具。'
      },
      verbose: {
        type: 'boolean',
        description: '是否显示详细参数说明。默认 false，只显示工具名和简要描述。'
      }
    },
    required: []
  },
  timeout: 5000,
  _isNewStyle: true,

  handler: async (args) => {
    const { category, verbose = false } = args || {}

    let tools = toolRegistry.list()

    // 按分类筛选
    if (category) {
      const catLower = String(category).toLowerCase()
      tools = tools.filter(t =>
        t.category.toLowerCase() === catLower ||
        t.category.toLowerCase().includes(catLower)
      )
    }

    if (tools.length === 0) {
      return {
        success: false,
        message: `没有找到分类为 "${category}" 的工具。请使用 list_tools() 查看所有可用分类。`
      }
    }

    // 按分类分组
    const byCategory = new Map()
    for (const t of tools) {
      const cat = t.category || 'Other'
      if (!byCategory.has(cat)) byCategory.set(cat, [])
      byCategory.get(cat).push(t)
    }

    // 生成文本
    const lines = []
    lines.push(`可用工具共 ${tools.length} 个，按分类如下：`)
    lines.push('')

    for (const [cat, catTools] of byCategory) {
      lines.push(`## ${cat}（${catTools.length} 个）`)
      lines.push('')
      for (const t of catTools) {
        lines.push(`- **${t.name}**: ${t.description}`)
        if (verbose && t.parameters) {
          const props = t.parameters.properties || {}
          const paramNames = Object.keys(props)
          if (paramNames.length > 0) {
            const required = t.required || []
            const paramList = paramNames.map(p =>
              required.includes(p) ? `${p}(必填)` : `${p}(可选)`
            ).join(', ')
            lines.push(`  - 参数: ${paramList}`)
          }
        }
      }
      lines.push('')
    }

    lines.push('> 💡 想了解某个工具的详细参数和用法，请调用 get_tool_detail(tool_name="工具名")')

    return {
      success: true,
      message: lines.join('\n'),
      total: tools.length,
      categories: Array.from(byCategory.keys()),
      tools: tools.map(t => ({
        name: t.name,
        category: t.category,
        description: t.description,
        ...(verbose ? { parameters: t.parameters, required: t.required } : {})
      }))
    }
  }
}

export default listToolsTool
