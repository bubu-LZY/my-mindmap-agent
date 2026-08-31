# Agent 优化设计报告

> 范围：基于近期日志与对话梳理出的 13 项需求；本文档**只做方案设计，不动代码**。
> 每一项均包含：当前问题、改法方案、涉及文件、影响范围、风险与回滚、是否依赖其他项。
> 决策原则：用户确认后再按轮次实施；每一轮做完会单独打包供测试。

---

## 目录

1. [持久记忆（跨会话）](#1-持久记忆跨会话)
2. [AI 主动定时/提醒](#2-ai-主动定时提醒)
3. [AI 对照参考（改写前快照）](#3-ai-对照参考改写前快照)
4. [AI 读取任意本地文件（PDF/DOCX/XLSX）](#4-ai-读取任意本地文件pdfdocxxlsx)
5. [错误恢复链路闭环（429/timeout 自动退避）](#5-错误恢复链路闭环429timeout-自动退避)
6. [MCP/自定义工具故障主动通知](#6-mcp自定义工具故障主动通知)
7. [批量工具调用 SLA（120 秒单批超时）](#7-批量工具调用-sla120-秒单批超时)
8. [动态 system prompt（按需加载相关 Skill/MCP/Custom）](#8-动态-system-prompt按需加载相关-skillmcpcustom)
9. [token 精确计算（tiktoken）](#9-token-精确计算tiktoken)
10. [流式响应渲染优化（rAF 合并）](#10-流式响应渲染优化raf-合并)
11. [日志分级 + 关键事件打点](#11-日志分级--关键事件打点)
12. [AI 行为回放（下载 .jsonl trace）](#12-ai-行为回放下载-jsonl-trace)
13. [UX 体验改进（进度感/错误中文化/重生成/折叠）](#13-ux-体验改进进度感错误中文化重生成折叠)
14. [网络断开降级提示](#14-网络断开降级提示)
15. [并发会话冲突 → 排队机制](#15-并发会话冲突--排队机制)

---

## 1. 持久记忆（跨会话）

### 1.1 当前问题

- "永久记忆"是用户手动配置的硬规则字符串，AI 不能从对话中自动学习用户偏好。
- 用户每次都得重复说明"我用的是 XX 公司""回答用 XX 风格"。
- 不同会话之间无上下文连接，AI 无法做到"记住上次聊到哪"。

### 1.2 改法方案

**A. 新建持久记忆存储**
- 在主进程新增 `electron/ipc/memoryStore.js`，存储结构：
  ```js
  {
    items: [
      { id, content, category, source: 'auto'|'manual', createdAt, lastUsedAt, useCount }
    ]
  }
  ```
- 类别（category）：`preference`(偏好) / `fact`(事实) / `context`(上下文) / `instruction`(指令)

**B. 三种入口**
1. **手动管理**：设置页新增「持久记忆」标签页，支持增删改查、分类、批量导入导出
2. **AI 自动沉淀**：每次会话结束（关闭/新建会话时）AI 摘要 3-5 条用户偏好 → 写入
3. **AI 主动写入**：在 system prompt 中给 AI 一个 `add_memory(content, category)` 工具，让 AI 觉得"应该记下"时主动调用

**C. 加载机制**
- system prompt 启动时自动注入记忆摘要（按 useCount + recency 排序，取前 20 条）
- 长记忆走"按需召回"——AI 用 `search_memory(query)` 检索（本地 BM25 简单实现）

**D. 容量控制**
- 总条数上限 200，超过则按 LRU 淘汰
- 单条 content 上限 500 字
- 重复检测：编辑距离 > 0.8 时更新而非新增

### 1.3 涉及文件

- 新建：`electron/ipc/memoryStore.js`
- 改：`electron/preload.js`（暴露 IPC）
- 改：`electron/main.js`（require memoryStore）
- 改：`src/services/toolHandler.js`（新增 `add_memory` / `search_memory` / `list_memory` 工具）
- 改：`src/components/ChatPanel.vue`（system prompt 注入 + 关闭会话触发自动沉淀）
- 改：`src/components/SettingsView.vue`（新增「持久记忆」管理页面）

### 1.4 影响范围

- system prompt 体积增加约 200~500 字（影响每次 AI 请求的输入 token）
- 关闭会话时增加 1 次 AI 摘要调用（额外成本）
- localStorage 数据约 5~50KB

### 1.5 风险与回滚

- **风险**：AI 误记忆（用户没表达的内容被自动沉淀）
- **缓解**：自动沉淀的内容默认 `enabled: false`，用户在管理页勾选启用；手动写入默认启用
- **回滚**：所有记忆项加 enabled 开关，全局关闭即等于未启用

### 1.6 依赖

- 无前置依赖；独立可做

---

## 2. AI 主动定时/提醒

### 2.1 当前问题

- 你已做了"定时任务"基础设施（`electron/ipc/taskScheduler.js`），但 AI 无法理解"明天 9 点提醒我复习"这种自然语言意图
- 用户必须手动打开设置页填写 cron

### 2.2 改法方案

**A. 意图识别层**
- 在 `system prompt` 增加规则：当用户说「提醒我 X」「X 时间后做 Y」「每天/每周 X」时，AI 必须先调用 `task_create` 工具创建定时任务
- 不依赖规则正则；让 AI 自己判断（LLM 在系统 prompt 提示下能高准确度识别）

**B. 自然语言时间解析**
- 主进程增加 `parseNaturalTime(text, now)` 函数，支持：
  - 相对时间："明天 9 点""3 小时后""下周一"
  - 周期："每天早上 8 点""每周三下午 3 点"
  - 绝对时间："2026-09-01 10:00"
- 解析失败时给 AI 返回错误，AI 反问用户

**C. AI 输出格式**
- system prompt 教 AI 输出形如：
  ```
  {{TASK: title="复习英语单词", cron="0 9 * * *", oneTime=true, at="2026-08-31 09:00"}}
  ```
- 前端解析这个标记，自动调 `task_create`（无需 AI 主动调工具）

**D. 任务触发时**
- 任务触发后 AI 自动启动一个独立会话（已有 infrastructure）执行任务
- 任务结果推送：站内消息 +（可选）飞书/微信

### 2.3 涉及文件

- 改：`electron/ipc/taskScheduler.js`（新增 `parseNaturalTime`）
- 改：`electron/preload.js`
- 改：`src/services/toolHandler.js`（新增 `task_create_with_natural_time` 工具）
- 改：`src/components/ChatPanel.vue`（system prompt + 标记解析 + 任务执行回写消息）

### 2.4 影响范围

- system prompt 增加 ~150 字
- 任务触发链路新增独立会话（无冲突）

### 2.5 风险

- 时间解析误差（如"明天"在不同时区有歧义）—— 默认使用系统时区，错误时给 AI 反馈重新确认
- 周期任务误创建 —— 任何定时任务创建后用户必须有 5 秒内取消窗口（弹通知）

### 2.6 依赖

- 复用现有 taskScheduler（无需新建）

---

## 3. AI 对照参考（改写前快照）

### 3.1 当前问题

- 背诵改写时已把原文存到节点 note，但其他场景（AI 主动改写导图节点）会丢原内容
- 用户想看"AI 改了什么"，只能依赖版本快照（粒度粗，AI 修改5 次才有 1 个快照）

### 3.2 改法方案

**A. 节点级快照**
- 所有改写类工具（`set_node_text`、`batch_text_style`、`update_node_text`、背诵改写、合并概要等）执行前：
  1. 调用 `snapshot_node(uid, fullText)` 把当前文本/样式存到 `node.note`
  2. 如果 note 已存在，把旧 note 移到 `node._history_notes[]`（最多保留 5 版）
- AI 报告里自动附"原内容：[note 中的旧文本]"

**B. 文件级快照（已有）**
- 复用 `listFileVersions` / `restoreFileVersion`
- AI 改写导图超过 3 个节点时自动触发文件级快照

**C. UI 体现**
- 节点右键菜单加「查看修改历史」
- 悬浮一个 popover 显示历史版本

### 3.3 涉及文件

- 改：`src/services/toolHandler.js`（在所有改写类 case 前加 snapshot）
- 改：`src/utils/nodeSnapshot.js`（新建 helper）
- 改：`src/components/MindMapEditor.vue`（右键菜单 + 历史 popover）

### 3.4 影响范围

- `.smm` 文件略增大（每个被改写节点多 1~5 个历史版本）
- 改写工具调用时长 +5~20ms（snapshot 本身）

### 3.5 风险

- 大量改写时历史版本堆爆文件 —— 限制每节点最多 5 版、自动清理最早版

### 3.6 依赖

- 无；独立可做

---

## 4. AI 读取任意本地文件（PDF/DOCX/XLSX）

### 4.1 当前问题

- `read_local_file` 只能读 .txt/.md/.json 等纯文本
- PDF/Word/Excel 等二进制格式直接报错或返回乱码

### 4.2 改法方案

**A. 复用现有 docParseService**
- 已存在 `src/services/docParseService.js`（PDF/DOCX/XLSX 解析）
- 只需在 `read_local_file` handler 加：检测文件扩展名 → 如果是支持类型则走 docParseService → 返回纯文本

**B. 自动索引**
- 读取后自动写入知识库（BM25 索引），后续可 `search_knowledge_base` 命中
- 已存在 `database.js`，加 1 行 hook 即可

**C. AI 输出反馈**
- AI 拿到长文档后，自动让 AI 摘要前 1000 字 + 关键章节作为"已读"上下文

### 4.3 涉及文件

- 改：`src/services/toolHandler.js`（`case 'read_local_file'`）

### 4.4 影响范围

- 大文件（> 10MB）读取会慢（~3-5 秒），需提示用户

### 4.5 风险

- 二进制文件占用内存（PDF 解析后内存可能膨胀 10 倍）
- 缓解：限制单文件读取大小为 50MB

### 4.6 依赖

- 无；独立可做

---

## 5. 错误恢复链路闭环（429/timeout 自动退避）

### 5.1 当前问题

- 日志里常见 "429" 连续重试 3 次后崩溃
- 工具失败时 AI 会"自主重试"，但卡在 429/timeout 时不会降级（不会换模型/减上下文）

### 5.2 改法方案

**A. 主进程退避策略（429）**
- 在 `electron/ipc/aiChat.js` 的 `ai:chat` handler：
  - 收到 429 时，按指数退避（1s → 2s → 4s）最多 3 次
  - 已有部分实现，需扩展覆盖流式 + 非流式

**B. 主进程退避策略（timeout）**
- 在 `ai:chat` 中 catch `AbortError` 时：
  - 第一次超时：自动重试（同一请求）
  - 第二次超时：把 max_tokens 减半后重试
  - 第三次超时：返回明确错误「请求超时，建议检查网络/减小上下文」

**C. AI 层面错误恢复指引**
- 在 `toolHandler` 中，工具返回失败时注入详细恢复指引：
  ```
  {{RECOVERY_HINT: 工具 X 失败原因 Y；建议：① 减小参数；② 换用工具 Z；③ 拆任务}}
  ```
- AI 看到这个标记必须尝试恢复，不能直接道歉

**D. 网络断开检测**
- 复用 navigator.onLine + 周期心跳（主进程每 30 秒 fetch 一个外部地址）
- 断开时所有 AI 请求直接返回 `NETWORK_DOWN` 错误，UI 显示降级提示

### 5.3 涉及文件

- 改：`electron/ipc/aiChat.js`（退避策略）
- 改：`src/services/toolHandler.js`（错误注入恢复指引）
- 新建：`electron/ipc/networkMonitor.js`（网络心跳）
- 改：`src/components/ChatPanel.vue`（网络断开 UI）

### 5.4 影响范围

- 慢响应时退避会拉长总时长，但成功率显著提升
- 心跳请求每 30 秒一次（可忽略）

### 5.5 风险

- 过度退避导致响应慢 —— 限制总退避时长 ≤ 60 秒

### 5.6 依赖

- 依赖 #14（网络断开降级提示）部分代码

---

## 6. MCP/自定义工具故障主动通知

### 6.1 当前问题

- MCP stdio 进程死掉 / 自定义工具超时，用户无感知
- 直到下次 AI 调用才报错，体感差

### 6.2 改法方案

**A. 主进程进程监听**
- MCP stdio 进程：监听 `proc.on('exit')` / `proc.on('error')` → 触发 IPC 通知渲染进程
- 自定义工具：捕获异常后通过 `customTools:call` 返回值标记 `processDead: true`

**B. 渲染进程 Electron Notification**
- 主进程通过 `new Notification()` 发送系统通知（Windows toast）
- 通知内容：「MCP 服务 X 已停止」「工具 Y 调用超时」
- 点击通知跳转到对应设置页

**C. 设置页状态实时刷新**
- MCP/自定义工具列表增加"运行状态"列（运行/停止/超时）
- 状态变化时通过 IPC 推送实时刷新

### 6.3 涉及文件

- 改：`electron/ipc/mcpManager.js`（进程监听）
- 改：`electron/ipc/customTools.js`（异常标记）
- 改：`electron/main.js`（Notification 触发）
- 改：`src/components/SettingsView.vue`（状态列）

### 6.4 影响范围

- 新增 Notification 权限请求（首次启动会询问）

### 6.5 风险

- 系统通知可能让用户烦躁 —— 加"勿扰模式"开关（设置里）

### 6.6 依赖

- 无；独立可做

---

## 7. 批量工具调用 SLA（120 秒单批超时）

### 7.1 当前问题

- AI 经常一次性调用 5+ 工具并发，没有单批超时
- 任何慢的工具会拖垮整批

### 7.2 改法方案

**A. 单批超时（120 秒）**
- 在 `aiService.chatWithCallbacks` 中，对每批 tool_calls 整体包一个 `Promise.race([batch, sleep(120s)])`
- 超时时把未完成的工具标记为 `soft_fail`（不报错，AI 收到「工具 X 在 120 秒内未完成，已跳过」）

**B. 串行工具调用限速**
- 当 batch 中包含写操作时，串行执行每个工具（已有部分逻辑）
- 单个工具超 60 秒立即放弃该工具（不影响其他工具）

**C. UI 提示**
- 工具调用面板显示「批 1/3 已完成，预计还需 X 秒」

### 7.3 涉及文件

- 改：`src/services/aiService.js`（chatWithCallbacks 加超时）
- 改：`src/components/ToolCallIndicator.vue`（UI）

### 7.4 影响范围

- AI 行为略变：超时工具不再阻塞整批
- 系统稳定性提升

### 7.5 风险

- 误杀慢但合法的工具 —— 60 秒单工具超时 + 120 秒批超时都是软超时（仅跳过），不会让 AI 报错

### 7.6 依赖

- 无；独立可做

---

## 8. 动态 system prompt（按需加载相关 Skill/MCP/Custom）

### 8.1 当前问题

- 每次请求都把 system prompt 全部塞进去（已几千字）
- 所有 Skill / MCP / Custom Tools 描述也常驻（上百个工具，几千 token）
- 浪费 30-50% 输入 token

### 8.2 改法方案

**A. 加载策略分层**
- **核心层**（每次都带）：操作规则、工具发现指令、当前文件/会话状态
- **相关层**（按需带）：
  - Skill：从 user message 提取关键词 → 与 Skill description 做 BM25 匹配 → 取 top 3
  - MCP：同 Skill 策略
  - Custom Tools：用户拖入文件类型关键词 + 同策略
- **细节层**（懒加载）：完整工具 schema 走 `activate_tools` 按需返回（已实现）

**B. 缓存**
- 用户最近一次消息的「相关 Skill/MCP/Custom」缓存 5 分钟，避免每条消息都重算

**C. 提示词结构**
```
[CORE]
Mind-map AI assistant (.smm). ...

[RELEVANT SKILLS]
- skill-creation-guide (only when user asks about creating skills)

[RELEVANT MCP]
- minimax (only when user asks about web search)

[CURRENT CONTEXT]
file: xxx.smm
node focus: yyy
```

### 8.3 涉及文件

- 改：`src/services/aiService.js`（buildSystemPrompt）
- 改：`src/components/ChatPanel.vue`（缓存 + 关键词提取）

### 8.4 影响范围

- 每次请求 token 减少 30-50%
- AI 可能找不到"未激活"的工具（需要在 system prompt 明确说：可用 `activate_tools` 加载）

### 8.5 风险

- 误判"不相关"导致工具不在 prompt —— 兜底：所有工具都可 `activate_tools` 按需加载

### 8.6 依赖

- 与 #1 持久记忆的 system prompt 注入有耦合（一起做）

---

## 9. token 精确计算（tiktoken）

### 9.1 当前问题

- `SAFE_CHARS = 280000` 是字符数粗估
- 某些含中文/代码块的消息实际 token 远超字符数（1 中文字 ≈ 1.5-2 token）
- 触发压缩的时机不准（要么过早，要么过晚）

### 9.2 改法方案

**A. 引入 tiktoken**
- 已有依赖 `tiktoken`（在 node_modules 中）
- 主进程使用：`encoding.encode(text).length`

**B. 替换 estimateTokens**
- `src/utils/contextWindow.js` 中的 `estimateTokens` 改用 tiktoken
- 缓存：`encoding.encode()` 调用昂贵，每条消息只算一次

**C. 精确压缩阈值**
- 用 token 替换字符数：`SAFE_TOKENS = 70000`
- 当总 token > 70K 时触发压缩

### 9.3 涉及文件

- 改：`src/utils/contextWindow.js`
- 改：`electron/ipc/aiChat.js`（如果服务端做 token 限制）

### 9.4 影响范围

- tiktoken 加载慢（首次 ~500ms），需在启动时预热
- 内存：~10MB

### 9.5 风险

- 不同模型的 tokenizer 不同（GPT/Claude/国产各异）—— 默认用 cl100k_base（GPT-4 兼容），差异在 5% 以内可接受

### 9.6 依赖

- 无；独立可做

---

## 10. 流式响应渲染优化（rAF 合并）

### 10.1 当前问题

- 每次 `onChunk` 都触发 Vue 重渲染
- 长回答时浏览器掉帧

### 10.2 改法方案

**A. 缓冲 + rAF**
- 在 ChatPanel 加 chunk buffer，rAF（每 16ms）批量 flush
- 累积超过 50ms 时强制 flush（避免延迟感）

**B. 选择性渲染**
- 只对"可见"的消息流式更新（不可见消息用一次性写入）

### 10.3 涉及文件

- 改：`src/services/aiService.js`（暴露 chunk 缓冲）
- 改：`src/components/ChatPanel.vue`（rAF flush）

### 10.4 影响范围

- 长回答流畅度明显提升
- 改动小

### 10.5 风险

- rAF 在窗口隐藏时被暂停（浏览器优化）—— 兜底：maxBufferTime = 100ms 强制 flush

### 10.6 依赖

- 无；独立可做

---

## 11. 日志分级 + 关键事件打点

### 11.1 当前问题

- 当前 `addLog` 无级别、无结构化字段
- 日志只能看"发生了什么"，不能统计"耗时多少/失败率多高"

### 11.2 改法方案

**A. 日志结构升级**
- `src/utils/logStore.js`：
  - 字段：`level` (debug/info/warn/error)、`event`、`durationMs`、`meta`、`timestamp`
  - 内存保留最近 1000 条
- 自动 flush 到磁盘：每 100 条或每 5 分钟

**B. 关键事件打点**
- 工具调用：进入/退出/异常 + durationMs
- AI 请求：进入/退出/异常 + token 估算 + durationMs
- 上下文压缩：触发原因 + 压缩前后 token 数

**C. 日志面板增强**
- 日志面板加级别筛选
- 加时间统计（"AI 思考耗时 5.2 秒"）

### 11.3 涉及文件

- 改：`src/utils/logStore.js`
- 改：`src/components/ChatPanel.vue`（关键事件打点）
- 改：`src/components/LogPanel.vue`（UI）

### 11.4 影响范围

- 内存占用 +1~3MB
- 磁盘 IO 轻微增加

### 11.5 风险

- 频繁打点影响性能 —— debug 级别默认关，按需开启

### 11.6 依赖

- 与 #12 行为回放紧密相关（trace 是日志的子集）

---

## 12. AI 行为回放（下载 .jsonl trace）

### 12.1 当前问题

- 出问题无法复现"AI 当时具体怎么走的"
- 用户反馈"AI 行为异常"时只能猜原因

### 12.2 改法方案

**A. Trace 记录**
- 每次 run 启动时分配 runId
- trace 数据：每轮消息（含 tool_calls）、工具调用耗时、token 估算、错误堆栈
- 格式：JSONL（每行一条事件，便于解析）

**B. 下载入口**
- 日志面板新增「下载本次行为回放」按钮
- 文件名：`trace-{runId}-{timestamp}.jsonl`
- 通过 showSaveDialog + fs.writeFile 保存

**C. 分析工具**
- 提供简单 Python/Node 脚本（可选）解析 trace

### 12.3 涉及文件

- 改：`src/services/aiService.js`（trace 收集）
- 改：`src/components/LogPanel.vue`（下载按钮）
- 改：`electron/preload.js`（保存对话框 + 写文件）

### 12.4 影响范围

- 单次 run 的 trace 文件约 10~500KB

### 12.5 风险

- 用户 trace 文件可能含敏感信息 —— 在文件名加警告，文档里说明

### 12.6 依赖

- 依赖 #11 日志分级（trace 数据源）

---

## 13. UX 体验改进（进度感/错误中文化/重生成/折叠）

### 13.1 进度感（响应慢时反馈）

**问题**：模型"卡住"5 分钟没有反馈，用户焦虑。
**改法**：
- ChatPanel 顶部状态栏加 "AI 正在思考... X 秒"（每 1 秒更新）
- 超过 30 秒显示 "这个问题较复杂，AI 仍在推理"
- 超过 60 秒提示 "可点右上角停止"
**涉及文件**：`src/components/ChatPanel.vue`
**风险**：计时器未清理导致内存泄漏 —— onBeforeUnmount 清理

### 13.2 错误信息中文化

**问题**："API error: 429"、"IPC 调用超时"——用户完全看不懂。
**改法**：
- `src/utils/errorMessages.js`（新建）：错误码 → 用户友好消息映射表
- ChatPanel 显示错误时统一过一层 `humanizeError()`
**涉及文件**：新建 `src/utils/errorMessages.js`；改 `src/components/ChatPanel.vue`、`src/services/aiService.js`
**风险**：翻译错误（漏翻/误翻）—— 保留原始错误细节到日志

### 13.3 一键重新生成

**问题**：觉得回答不好？现在得删了重发。
**改法**：
- 每条 AI 回复下加"重新生成"按钮
- 内部：删除当前 AI 回复，复制上一条 user 消息到输入框，自动发送
- 保留被替换的 AI 回复到日志
**涉及文件**：`src/components/ChatPanel.vue`
**风险**：重新生成消耗 token —— 加每日限额（默认 50 次/天，可在设置改）

### 13.4 AI 输出折叠

**问题**：长回答占满屏幕影响阅读。
**改法**：
- 超过 12 行的 AI 回复自动折叠
- 显示前 6 行 + "点击展开"
- 用户手动展开后保持展开
**涉及文件**：`src/components/ChatPanel.vue`
**风险**：用户找内容不方便 —— 提供「折叠全部/展开全部」快捷键

### 13.5 共同涉及

`src/components/ChatPanel.vue`（主战场）

### 13.6 依赖

- 无；独立可做

---

## 14. 网络断开降级提示

### 14.1 当前问题

- 拔网线后 AI 一直转圈
- 不知道是网络问题还是 AI 慢

### 14.2 改法方案

**A. 主进程心跳**
- `electron/ipc/networkMonitor.js`（新建）
- 每 30 秒请求一次 `https://www.google.com/generate_204`（204 是空内容，只检测连通性）
- 失败 3 次标记 offline，发送 IPC 通知渲染进程

**B. 渲染进程**
- ChatPanel 顶部状态栏：「⚠️ 网络不可用，部分功能受限」
- AI 请求自动降级：网络断开时所有 `search_web`/`read_webpage` 直接返回 `NETWORK_DOWN`，不调用 API

**C. 断网恢复**
- 心跳恢复后自动重连，UI 提示消失

### 14.3 涉及文件

- 新建：`electron/ipc/networkMonitor.js`
- 改：`src/components/ChatPanel.vue`（状态显示）
- 改：`src/services/toolHandler.js`（联网工具降级）

### 14.4 影响范围

- 心跳请求每 30 秒一次（可忽略）

### 14.5 风险

- 防火墙拦截 204 心跳地址 —— 用 HEAD 请求 `https://api.openai.com`（更通用）作为兜底

### 14.6 依赖

- 无；独立可做

---

## 15. 并发会话冲突 → 排队机制

### 15.1 当前问题

- 同一文件在两个会话打开，AI 同时改 → 覆盖丢失
- "排队"语义：你说"当前任务做完了之后，再去做后面的"

### 15.2 改法方案

**A. 会话队列（同一文件）**
- `src/stores/conversationQueue.js`（新建）：
  - 维护 Map<filePath, ConversationQueueItem[]>
  - 每个文件最多 1 个 active 会话，其余 waiting

**B. 状态机**
- 会话状态：`idle` / `active` / `waiting`
- 当前会话 `aiStatus='thinking'` 时，新发起的同文件会话进入 `waiting`
- active 会话完成后（status=done/error/idle），自动激活队列下一个 waiting 会话

**C. UI**
- 顶部状态栏：「此文件还有 2 个任务在排队」
- waiting 会话的消息发送按钮变为"加入队列"按钮
- 用户可拖拽调整队列顺序

**D. 跨文件不排队**
- 不同文件的会话仍可并发（各自有独立队列）

### 15.3 涉及文件

- 新建：`src/stores/conversationQueue.js`
- 改：`src/stores/mindMapStore.js`（activeFile 维度）
- 改：`src/components/ChatPanel.vue`（状态机 + UI）
- 改：`src/App.vue`（队列调度器）

### 15.4 影响范围

- 用户操作略变（"加入队列" vs "立即发送"）
- 队列调度器单例（全局）

### 15.5 风险

- 队列过长导致用户忘记有 waiting 任务 —— UI 显眼提示
- 队列调度死锁 —— 加超时（waiting > 10 分钟自动跳过）

### 15.6 依赖

- 无；独立可做

---

## 实施优先级建议

| 优先级 | 编号 | 项目 | 风险 | 依赖 |
|---|---|---|---|---|
| 🔴 | 7 | 错误恢复闭环 | 低 | 部分 #14 |
| 🔴 | 9 | MCP 故障通知 | 低 | 无 |
| 🔴 | 10 | 批量 SLA 120 秒 | 低 | 无 |
| 🔴 | 19 | 错误信息中文化 | 低 | 无 |
| 🟡 | 2 | 持久记忆 | 中 | 无 |
| 🟡 | 11 | 动态 system prompt | 中 | 部分 #1 |
| 🟡 | 13 | token 精确计算 | 低 | 无 |
| 🟡 | 14 | rAF 渲染优化 | 低 | 无 |
| 🟡 | 15 | 日志分级 | 低 | 无 |
| 🟡 | 18 | 响应进度感 | 低 | 无 |
| 🟡 | 20 | 一键重新生成 | 低 | 无 |
| 🟡 | 21 | 输出折叠 | 低 | 无 |
| 🟡 | 23 | 并发排队 | 中 | 无 |
| 🟢 | 3 | AI 定时/提醒 | 中 | 复用 task |
| 🟢 | 4 | 对照参考快照 | 中 | 无 |
| 🟢 | 5 | 读任意本地文件 | 低 | 复用 docParse |
| 🟢 | 16 | 行为回放下载 | 低 | 依赖 #15 |
| 🟢 | 22 | 网络断开降级 | 低 | 无 |

## 实施轮次建议（每轮 3-5 项）

**第一轮（核心可靠性）**：7、9、10、19、15 — 全部低风险，立刻见效
**第二轮（核心能力）**：2、13、14、18、20 — UX 与能力双提升
**第三轮（高级特性）**：11、21、23、3 — 高级交互
**第四轮（边缘场景）**：4、5、22、16 — 完善边界

每轮完成后我会单独打包、单独 review、不交叉污染。