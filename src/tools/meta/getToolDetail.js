/**
 * get_tool_detail - 获取单个工具的详细说明
 *
 * 让 AI 可以查询某个具体工具的详细参数、用法说明和使用示例。
 * 当 AI 知道工具名但不确定具体参数时使用。
 */

import { toolRegistry } from '../ToolRegistry'

export const getToolDetailTool = {
  name: 'get_tool_detail',
  category: 'Meta',
  description: '获取指定工具的详细说明，包括参数定义、必填项、返回格式等。当你知道工具名但不确定具体参数时调用。',
  parameters: {
    type: 'object',
    properties: {
      tool_name: {
        type: 'string',
        description: '要查询的工具名称，例如 "search_nodes"、"add_child_nodes"'
      }
    },
    required: ['tool_name']
  },
  timeout: 5000,
  _isNewStyle: true,

  handler: async (args) => {
    const { tool_name } = args || {}

    if (!tool_name) {
      return {
        success: false,
        message: '请提供 tool_name 参数，指定要查询的工具名称。'
      }
    }

    const tool = toolRegistry.get(tool_name)

    if (!tool) {
      // 尝试模糊匹配，给建议
      const allTools = toolRegistry.list()
      const suggestions = allTools
        .filter(t => t.name.includes(tool_name) || tool_name.includes(t.name))
        .slice(0, 5)
        .map(t => t.name)

      let msg = `未找到工具: "${tool_name}"。`
      if (suggestions.length > 0) {
        msg += ` 你是不是想找: ${suggestions.join('、')}？`
      }
      msg += ' 调用 list_tools() 可查看所有可用工具。'

      return {
        success: false,
        message: msg,
        suggestions
      }
    }

    // 兼容两种参数格式：
    // 新格式: parameters = { type: 'object', properties: { ... }, required: [...] }
    // 老格式: parameters = { param1: { type, description, ... }, param2: ... }
    let props = {}
    let required = []
    if (tool.parameters?.properties) {
      // 新格式
      props = tool.parameters.properties
      required = tool.parameters.required || tool.required || []
    } else if (tool.parameters && typeof tool.parameters === 'object') {
      // 老格式：parameters 本身就是参数映射
      props = tool.parameters
      required = tool.required || []
    }
    const paramNames = Object.keys(props)

    const lines = []
    lines.push(`# ${tool.name}`)
    lines.push('')
    lines.push(`**分类**: ${tool.category || 'Other'}`)
    lines.push('')
    lines.push(`**说明**: ${tool.description}`)
    lines.push('')

    if (tool.timeout && tool.timeout > 0) {
      lines.push(`**超时**: ${tool.timeout / 1000} 秒`)
    }

    if (tool.dangerous) {
      lines.push(`**⚠️ 危险操作**: ${tool.dangerous}`)
    }

    lines.push('')
    lines.push('## 参数')
    lines.push('')

    if (paramNames.length === 0) {
      lines.push('（无参数，直接调用即可）')
    } else {
      // 递归渲染参数（支持嵌套对象）
      function renderParam(name, param, depth = 0, reqList = []) {
        const indent = '  '.repeat(depth)
        const isRequired = reqList.includes(name)
        const reqMark = isRequired ? '**(必填)**' : '(可选)'
        lines.push(`${indent}- **${name}** ${reqMark}`)
        lines.push(`${indent}  - 类型: ${param.type || 'any'}`)
        if (param.description) {
          lines.push(`${indent}  - 说明: ${param.description}`)
        }
        if (param.enum) {
          lines.push(`${indent}  - 可选值: ${param.enum.join(' | ')}`)
        }
        if (param.default !== undefined) {
          lines.push(`${indent}  - 默认值: ${JSON.stringify(param.default)}`)
        }
        // 嵌套对象属性
        if (param.properties && typeof param.properties === 'object') {
          const subReq = param.required || []
          const subNames = Object.keys(param.properties)
          if (subNames.length > 0) {
            lines.push(`${indent}  - 子字段:`)
            for (const subName of subNames) {
              renderParam(subName, param.properties[subName], depth + 2, subReq)
            }
          }
        }
        // 数组元素类型
        if (param.type === 'array' && param.items?.properties) {
          lines.push(`${indent}  - 元素类型: object`)
          const subReq = param.items.required || []
          const subNames = Object.keys(param.items.properties)
          if (subNames.length > 0) {
            lines.push(`${indent}  - 元素字段:`)
            for (const subName of subNames) {
              renderParam(subName, param.items.properties[subName], depth + 2, subReq)
            }
          }
        }
      }

      for (const pName of paramNames) {
        renderParam(pName, props[pName], 0, required)
      }
    }

    lines.push('')
    lines.push('## 返回格式')
    lines.push('')
    lines.push('```json')
    lines.push('{')
    lines.push('  "success": true | false,')
    lines.push('  "message": "结果描述或错误信息",')
    lines.push('  "...": "其他返回字段依工具而定"')
    lines.push('}')
    lines.push('```')

    return {
      success: true,
      message: lines.join('\n'),
      tool: {
        name: tool.name,
        category: tool.category,
        description: tool.description,
        parameters: tool.parameters,
        required: tool.required,
        timeout: tool.timeout,
        dangerous: tool.dangerous
      }
    }
  }
}

export default getToolDetailTool
