# Skills / MCP / Custom Tools 官方编写指南

本文面向外部 AI、插件作者和用户，说明 my-mindmap agent 的扩展能力边界、参数约定和编写规范。

## 1. 扩展能力总览

本程序支持三类扩展：

| 类型 | 用途 | 编写文件 |
|---|---|---|
| Custom Tool | 本地 JS 工具，可被 AI 直接调用 | `custom-tools/<id>/tool.json` + `tool.js` |
| Skill | 给 AI 的流程/方法提示，可自动或按需触发 | `skills/<name>/SKILL.md` |
| MCP Server | 外部工具协议，AI 通过 `mcp_call_tool` 调用 | 在设置中导入 JSON 或手动新增 |

## 2. 当前 AI 能力清单

### 2.1 思维导图操作

- 生成、续写、整理、合并导图
- 节点查询、批量修改、移动、删除、合并、插入父节点
- 关联线、外框、备注、概要
- 导出 `.smm` / Markdown / HTML / PDF / XMind / PNG / SVG

### 2.2 学习与复习

- 智能挖空 `ai_cloze` / 全文挖空 `ai_cloze_full_map`
- 背诵改写 `ai_recite_rewrite`
- 出题 `ai_quiz` / `ai_quiz_append`
- 复习计划 `add_to_review` 等

### 2.3 本地知识与文件

- `read_local_file`：读取 txt/md/json/docx/pptx/xlsx/xls/csv/tsv/pdf/smm 和常见图片 OCR
- `retrieve_local_file`：文档内语义检索
- `find_local_file` / `list_directory`：定位和浏览本地文件
- `convert_doc_to_mindmap`：把 PDF/DOCX/PPTX/XLSX 等转成新 `.smm`

### 2.4 联网与外部集成

- `search_web` / `read_webpage`
- 飞书文档、云盘、消息
- 微信消息、文件

### 2.5 扩展协议

- `list_custom_tools` / `call_custom_tool`
- `list_skills` / `invoke_skill` / `create_skill`
- `list_mcp_servers` / `list_mcp_tools` / `mcp_call_tool`

## 3. 参数约定

工具参数采用 OpenAI Function Calling 的 JSON Schema 结构：

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "绝对路径"
    }
  },
  "required": ["file_path"]
}
```

统一约定：

- 文件路径优先使用 `file_path` 或 `filePath`。
- 多个目标尽量使用数组批量参数，例如 `uids`、`items`。
- 工具返回值统一为 `{ success: boolean, message: string, ...extra }`。

## 4. 如何编写 Custom Tool

目录结构：

```text
custom-tools/
  <tool-id>/
    tool.json
    tool.js
```

### tool.json

```json
{
  "id": "my_tool",
  "name": "示例工具",
  "description": "这个工具做什么，AI 何时应该使用它。",
  "parameters": {
    "type": "object",
    "properties": {
      "input": { "type": "string", "description": "输入内容" }
    },
    "required": ["input"]
  },
  "readOnly": false,
  "risk": "low",
  "timeoutMs": 30000
}
```

### tool.js

```js
export async function execute(args, context) {
  try {
    const input = String(args.input || '')
    if (!input) {
      return { success: false, message: '缺少 input 参数' }
    }
    return {
      success: true,
      message: `处理完成：${input}`,
      data: { input }
    }
  } catch (e) {
    return { success: false, message: e.message }
  }
}
```

详细字段说明见 `docs/custom-tools-spec.md`。

## 5. 如何编写 Skill

Skill 使用 Markdown，至少包含以下结构：

```markdown
---
name: skill-name
description: 用一句话说明这个 Skill 解决什么问题，什么情况下使用。
---

# Skill 名称

## When to use

## Steps

1. 第一步
2. 第二步
3. 第三步
```

推荐：

- `name` 使用小写英文、数字和连字符。
- `description` 必须写清触发场景，不要只写“通用工具”。
- 步骤要具体到“调用哪个工具、参数是什么、如何判断成功”。

## 6. MCP 配置格式

### 6.1 本程序内置 MCP 配置（复制给外部客户端）

设置 → 系统 → 本地 HTTP 服务 → MCP 接口，提供可直接粘贴给 Claude Desktop / Cursor / Trae 的配置。

### 6.2 从外部导入 MCP JSON

支持常见三种结构：

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\path"],
      "env": {},
      "disabled": false
    }
  }
}
```

流式 HTTP：

```json
{
  "mcpServers": {
    "server-name": {
      "transport": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

也兼容 Claude Desktop 常用的：

- `command` / `cmd`
- `args`
- `env` / `environment`
- `url` / `baseUrl`
- `transport` / `transportType` / `type`
- `disabled` / `enabled`

## 7. 编写规范

1. 工具 ID、Skill name 全局唯一。
2. `description` 要写“何时用、解决什么”，而不是泛泛描述。
3. 工具必须自行捕获异常，并返回 `{ success: false, message }`。
4. 不允许在 Custom Tool 中直接访问 Electron 主进程。
5. 涉及文件删除、外发、覆盖等危险操作，必须设置 `risk` 并返回清晰提示。
6. MCP 尽量优先使用 HTTP/SSE；stdio 服务应避免依赖无法在用户机器上安装的全局命令。
