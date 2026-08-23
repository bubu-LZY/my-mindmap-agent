---
name: my-mindmap-agent-api
description: Call the local my-mindmap agent over HTTP to execute mind-map and AI tasks from another agent. Use this skill when the user asks another AI agent to operate my-mindmap agent, generate/edit mind maps, run AI mind-map tools, or reuse the app's conversation abilities without controlling the local UI.
---

# my-mindmap-agent API

Call the local `my-mindmap agent` through its built-in HTTP API.

## When to use

- The user wants another agent to call my-mindmap agent.
- The user says "调用 my-mindmap agent", "让另一个 AI 帮我操作思维导图", or provides a local Token and asks you to call it.
- You need to create, reorganize, continue, quiz, cloze, rewrite, or query a mind map in the local app.

## Before you call

Ask the user for these required values:

1. **Base URL**
   - Default: `http://127.0.0.1:17800`
   - The actual port may change if `17800` is occupied. Ask the user to check:
     - 设置 → 系统 → 本地 HTTP 服务
     - The page shows the real access address and Token.
2. **Token**
   - The same page shows the access Token.
   - Token is valid for 60 days and is saved in the local app.
3. **Message**
   - What the local agent should do, in natural language.
4. **Source name** (optional)
   - A short identifier for logs, for example `"notebook-agent"`, `"n8n"`, `"dify"`.

Confirm that:

- The local app is running.
- 本地 HTTP 服务 is enabled.
- The main window is not closed. If the main window is closed, the API returns `503`.

## API method

### `POST /api/agent/chat`

Send one chat message to the local agent.

#### URL

```text
POST {BASE_URL}/api/agent/chat
```

#### Headers

```http
Content-Type: application/json
Authorization: Bearer {TOKEN}
```

#### Request body

```json
{
  "message": "请帮我生成一张关于时间管理的思维导图",
  "source": "my-agent"
}
```

| Field | Type | Required | Description |
|---|---:|---|---|
| `message` | string | yes | The instruction for my-mindmap agent. It may use AI tools, files, review, cloze, export, etc. |
| `source` | string | no | A short stable name for logs and third-party message center. Default: `agent`. |
| `token` | string | no | Alternative auth if you cannot use the `Authorization` header. |

#### Success response

```json
{
  "ok": true,
  "reply": "已完成..."
}
```

#### Error responses

```json
{
  "ok": false,
  "error": "Token 无效或已过期"
}
```

```json
{
  "ok": false,
  "error": "主页面已关闭"
}
```

## Optional status check

### `GET /api/status?token={TOKEN}`

Use it to verify that the local service is running and get its current address, quality, and token expiry.

```text
GET {BASE_URL}/api/status?token={TOKEN}
```

## Examples

### cURL

```bash
curl -X POST "http://127.0.0.1:17800/api/agent/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"message":"把当前导图做全文挖空","source":"n8n"}'
```

### Python

```python
import requests

url = "http://127.0.0.1:17800/api/agent/chat"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_TOKEN"
}
payload = {
    "message": "请为当前导图生成 5 道自测题，保存为新文件",
    "source": "my-other-agent"
}

response = requests.post(url, headers=headers, json=payload, timeout=120)
print(response.json())
```

### JavaScript

```js
const response = await fetch("http://127.0.0.1:17800/api/agent/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_TOKEN"
  },
  body: JSON.stringify({
    message: "把当前导图导出为大纲 PDF",
    source: "dify"
  })
})

console.log(await response.json())
```

## Calling rules

- Prefer one high-level natural-language instruction per call.
- If the user asks for a multi-step workflow, send all steps in one `message`.
- Wait for the final `reply`; the local agent may call tools internally.
- Timeout should be at least `120 seconds`.
- Do not retry immediately on `401`; ask the user for a new Token.
- On `503`, tell the user to open the local main program and enable 本地 HTTP 服务.
- The response `reply` is the final answer from my-mindmap agent.
- Do not call this API to control the local mouse/keyboard; use it only for agent-level tasks.

## What to tell the user

After a successful call, report:

1. The `reply` returned by the local agent.
2. The `source` used.
3. The files or mind-map changes mentioned in the reply, if any.
