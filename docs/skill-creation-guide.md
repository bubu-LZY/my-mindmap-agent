---
name: AI 能力扩展引导
description: 当用户希望在本程序（my-mindmap-agent）中新增 Skill、自定义工具或 MCP 服务时，引导用户编写并落盘。本 Skill 由 AI 自动加载。
---

# AI 能力扩展引导

> 本 Skill 用于在 **my-mindmap-agent**（思维导图 + AI 桌面应用）中帮助用户扩展 AI 能力，覆盖三类：**Skill**（指令集）、**自定义工具**（本地 Node.js 脚本）、**MCP 服务**（外部进程）。当用户说"帮我添加/编写/创建 Skill、工具、MCP"或类似需求时，AI 应先调用本 Skill（`invoke_skill(skillId="__builtin_skill_creation_guide__")`），然后按下面的流程引导用户。

## 1. 总体思路：先确定能力类型，再深入

用户原始请求不一定是精确的术语，所以 AI 在最开始就要先判定：

| 用户可能说的 | 对应能力类型 | 主要操作 |
|---|---|---|
| "写个 Skill 让 AI 改写风格" | Skill | 写 instructions |
| "帮我做个工具，调用某 API" | 自定义工具 | 写 tool.json + tool.js |
| "接入 MiniMax / Playwright / 数据库" | MCP | 配置 command/url/headers |
| 不确定 / 都行 | 通用 | 让用户选 |

直接用一句话问用户即可："你想让 AI 新增哪种能力？" 给三个选项让用户选。

## 2. 三类能力的编写流程（按选择分支走）

### 2.1 Skill（指令集）

**适用**：让 AI 按固定流程/风格回答，文本类操作，不需要写代码。

第 1 步：明确用途（一个短问题）
第 2 步：确定输入输出（不超过 3 个问题）
第 3 步：决定是否需要工具（不需要 = 纯文本 Skill）
第 4 步：撰写 instructions（祈使句、步骤编号、明确输出格式、避免"尽量/考虑"等模糊词）
第 5 步：起名 + 写 description
第 6 步：交付 SKILL.md，让用户复制后拖入「设置 → Skills → 导入」

格式：
```markdown
---
name: <名称>
description: <描述>
---

<正文：instructions>
```

### 2.2 自定义工具（本地脚本）

**适用**：调用任意 HTTP API、做本地数据处理、文件批量操作等。

第 1 步：明确工具做什么（一句话）
第 2 步：确定参数（不超过 5 个）
第 3 步：确定返回值结构（`{ success, message, data }`）
第 4 步：写两个文件：

`tool.json`：
```json
{
  "id": "my_tool_id",
  "name": "工具展示名",
  "description": "工具做什么，AI 判断何时调用",
  "category": "Custom",
  "enabled": true,
  "autoInvoke": true,
  "readOnly": true,
  "risk": "low",
  "timeoutMs": 30000,
  "parameters": {
    "type": "object",
    "properties": {
      "param_name": { "type": "string", "description": "参数说明" }
    },
    "required": ["param_name"]
  },
  "resultHint": "返回 JSON，至少包含 success 和 data"
}
```

`tool.js`：
```js
export async function execute(args, context) {
  const param = String(args.param_name || '')
  if (!param) return { success: false, message: '缺少 param_name 参数' }

  // 这里用 context 里的能力：
  // context.app.version / context.file.currentFileName
  // context.http.fetch(url, options)
  // context.knowledge.search(query)   知识库
  // context.feishu.listFiles(...)      飞书
  // context.wechat.sendMessage(...)    微信
  // context.ai.chat(prompt, systemPrompt)  调用其他 AI 模型
  // context.task.create({...})         定时任务

  try {
    const r = await context.http.fetch('https://api.example.com/xxx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: param })
    })
    const data = await r.json()
    return { success: true, message: '调用成功', data }
  } catch (e) {
    return { success: false, message: e.message }
  }
}
```

第 5 步：把两个文件放到「`custom-tools/my_tool_id/`」目录下
第 6 步：工具会自动出现在工具目录里；如果没出现，用户可在「设置 → 自定义工具」点击"刷新"

### 2.3 MCP 服务（外部进程接入）

**适用**：接入 MiniMax MCP、Playwright、文件系统 MCP 等外部 MCP server。

第 1 步：判定传输方式（用户从哪里拿到的接入文档？）
- stdio（本地进程）：需要 command + args
- HTTP/SSE（云端服务）：需要 url + headers

第 2 步：收集信息
- stdio：command（如 `uvx`/`npx`/`node`）、args、环境变量
- HTTP/SSE：URL、API Key 放 headers 里

第 3 步：交付 JSON 配置：

stdio 示例：
```json
{
  "name": "MiniMax MCP",
  "transport": "stdio",
  "command": "uvx",
  "args": ["minimax-coding-plan-mcp", "-y"],
  "env": {
    "MINIMAX_API_KEY": "你的真实 key",
    "MINIMAX_API_HOST": "https://api.minimaxi.com"
  },
  "enabled": true
}
```

HTTP/SSE 示例：
```json
{
  "name": "Some Cloud MCP",
  "transport": "http",
  "url": "https://mcp.example.com/sse",
  "headers": { "Authorization": "Bearer 你的key" },
  "enabled": true
}
```

第 4 步：让用户在「设置 → MCP 服务管理 → 添加」粘贴并保存，然后点"测试"

第 5 步：首次连接超时属于正常（uvx/npx 首次要下载依赖），可点"再试一次(60秒超时)"按钮

## 3. 交付检查清单

无论哪种能力，交付前都要确认：
- ✅ 用户能用一句话说清楚"这个能力做什么"
- ✅ 包含具体的输出格式或参数定义
- ✅ 不包含模糊词（"尽量"、"考虑"、"可能"）
- ✅ 文件/JSON 格式正确（用户能直接复制粘贴使用）

## 4. 引导开场白

如果你是被 invoke_skill 加载来引导用户的，从下面这句话开始：

> 我来帮你扩展 AI 能力。请告诉我你想新增哪一种：
> 1. **Skill**（AI 指令集，纯文本，最简单）
> 2. **自定义工具**（本地脚本，能调用任何 API）
> 3. **MCP 服务**（接入外部 MCP server，如 MiniMax、Playwright）