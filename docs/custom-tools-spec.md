# 自定义工具编写规范（Custom Tools Spec）

版本：v1.0（草案）

## 1. 目标

允许用户在不改主程序代码的情况下，按本规范新增本地工具。AI 可以从工具目录中看到这些工具，并通过 `call_custom_tool` 调用；用户也可以直接在对话里说“调用某个工具”。

每个工具由两个文件组成：

```text
custom-tools/
  <tool-id>/
    tool.json
    tool.js
```

- `tool-id`：全局唯一，建议使用小写英文、数字和下划线，例如 `my_weather`。
- `tool.json`：工具元数据和参数 Schema。
- `tool.js`：工具执行函数。

## 2. tool.json 规范

```json
{
  "id": "my_weather",
  "name": "查询天气",
  "description": "查询指定城市的当前天气。",
  "category": "Custom",
  "enabled": true,
  "autoInvoke": true,
  "readOnly": true,
  "risk": "low",
  "timeoutMs": 30000,
  "parameters": {
    "type": "object",
    "properties": {
      "city": {
        "type": "string",
        "description": "城市名，例如 成都"
      }
    },
    "required": ["city"]
  },
  "resultHint": "返回 JSON，至少包含 success 和 data。"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 唯一工具 ID，与目录名一致 |
| `name` | string | 是 | 展示给 AI 和用户的名称 |
| `description` | string | 是 | AI 判断何时调用该工具的依据，越具体越好 |
| `category` | string | 否 | 工具目录分组，默认 `Custom` |
| `enabled` | boolean | 否 | 是否启用，默认 `true` |
| `autoInvoke` | boolean | 否 | 是否允许 AI 自动调用；`false` 时仅用户点名调用 |
| `readOnly` | boolean | 否 | 是否只读，AI 判断危险操作时优先使用 |
| `risk` | string | 否 | `low` / `medium` / `high`，默认 `low` |
| `timeoutMs` | number | 否 | 超时时间，默认 30000 |
| `parameters` | object | 是 | JSON Schema，遵循 OpenAI function calling 的 parameters 结构 |
| `resultHint` | string | 否 | 返回结果提示，帮助 AI 解读结果 |

## 3. tool.js 规范

`tool.js` 必须导出一个异步函数，默认导出或具名 `execute` 均可：

```js
export async function execute(args, context) {
  const city = String(args.city || '')
  if (!city) {
    return { success: false, message: '缺少 city 参数' }
  }

  // 这里写你自己的业务逻辑。
  // 可以调用任何 Node.js 能力，但请避免阻塞主线程。

  return {
    success: true,
    message: `已查询 ${city} 天气`,
    data: {
      city,
      weather: '晴',
      temperature: 26
    }
  }
}
```

返回值统一为：

```json
{
  "success": true,
  "message": "给用户看的简短结果",
  "data": { }
}
```

也可以只返回字符串，系统会包装为 `{ success: true, message: "..." }`。

### 允许使用的 context

`context` 会提供以下字段：

```js
{
  app: {
    version: '1.0.0',
    userDataDir: '...'
  },
  file: {
    currentFilePath: '...',
    currentFileName: '...'
  },
  mindMap: {
    getData: () => ({...}),
    getCurrentNodeUids: () => []
  },
  http: {
    fetch: globalThis.fetch
  }
}
```

安全限制：

- 默认不允许直接访问 `electron` 主进程对象。
- 文件写操作只能通过 `context.file` 提供的方法，避免误写安装目录。
- 工具必须自行处理异常并返回 `success: false`，不要把异常抛给 AI。

## 4. AI 如何调用

系统会把所有启用工具合并到 AI 工具目录，并按以下方式暴露：

1. `list_custom_tools`：列出可用自定义工具及其参数。
2. `call_custom_tool`：参数为 `toolId` 和 `arguments`。

如果 `autoInvoke=false`，AI 只会在用户明确点名该工具时调用；`autoInvoke=true` 时 AI 可在相关任务中自动选择。

## 5. 示例

见 `custom-tools/example-hello/`。

## 6. 兼容性约定

- `tool.json` 的 `parameters` 必须是合法 JSON Schema。
- `tool.js` 使用 ESM。
- 工具目录优先读取用户数据目录下的 `custom-tools`，而不是程序安装目录，避免权限问题。
