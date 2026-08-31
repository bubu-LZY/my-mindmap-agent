# 更新日志 / Changelog

记录项目的所有重要变更。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [3.0.0] - 2026-08-31

本次大版本在「安全 / 体验 / 性能」三方面做了系统性加固，同时新增了多个 AI Agent 能力。

### 安全（Security）

- **fsGuard 路径白名单持久化**：之前 `__allowedPathRoots` / `__activeFileDir` 是进程内 Map / 字符串，重启程序后丢失，导致 FileTree 已添加的目录无法再次访问。已迁移到 `electron-store` 持久化（`fsGuardAllowedRoots` / `fsGuardActiveFileDir`）。FileTree 的 `addFolder` / `syncSaveDirRoot` / `onMounted` 三处都会自动把 folderRoots 同步注册到 fsGuard。
- **`shell:exec` 独立 cwd 校验**（修复高危漏洞 S-1）：原版依赖 `fileManager.assertPathAllowed` 在「无白名单 + 无 activeFileDir」时全部放行，新版 shellExec.js 内部对 cwd 做独立硬约束：必须命中 userData / temp / 激活文件目录 / 已注册白名单 / 桌面·文档·下载 之一才放行。
- **`run_node` / `run_python` 脚本路径校验**：新增 `shell:assertScriptPathAllowed` IPC；`run_node` / `run_python` 在调用 shell:exec 之前先校验 `script_path` 是否在白名单内，防止 AI 把任意目录下的恶意脚本通过 node/python 执行。
- **用户 MCP 服务对外暴露（外部 Agent 可调用）**：`/mcp` 端点的 `tools/list` 现在会把用户在设置里添加的 stdio / HTTP MCP 服务工具合并后下发（命名规范 `mcp__<serverId>__<toolName>`），`tools/call` 用前缀正则识别并路由到 `mcpManager.callTool`。修复了 `listTools` 未未导出导致的"外部 Agent 看不到用户 MCP 工具" bug。外部 Agent（Trae / Claude Desktop / Cursor）可通过 `/mcp` 端点直接调用本程序 + 用户添加的 MCP 服务。
- **shell_exec / spawn env 白名单合并**：env 字段只放行 `PATH` / `NODE_ENV` / `PYTHONPATH` / `JAVA_HOME` / `HTTPS_PROXY` 等 21 个白名单 key，杜绝 AI 用 `NODE_OPTIONS=--require /tmp/evil.js` 劫持子进程。
- **`shell:spawn` `stdio: ['ignore', 'pipe', 'pipe']`** 显式关掉 stdin，避免 node REPL 等场景下 stdin 死锁。
- **`shell_get_env` 脱敏**：`NODE_OPTIONS` / `NPM_CONFIG_REGISTRY` / `PYTHONPATH` / `NODE_ENV` 这 4 个 key 只返回"已设置 / 长度"标记，不返回真实值。
- **后 before-quit 清理后台任务**：`app.on('before-quit')` / `will-quit` / `window-all-closed` 三处清理 backgroundJobs，避免孤儿进程。
- **`shell:exec` maxBuffer 从 2MB 提升到 8MB**：给 npm install / pip install 等长输出更大空间，超出时由 `clipOutput` 截断而非 kill 子进程。

### 性能 / 体验（Performance & UX）

- **AI 工作时频繁整树重渲染 优化**：`setNodeGeneralization` 内的 `mindMap.render()` 改为 `scheduleMindMapRender()`（requestAnimationFrame 防抖），批量场景下从 N 次 render 降到 1 次。批量改节点（背诵改写 / 出题 / 挖空）提速明显。
- **AI 流式响应 优化**：每 token 不再触发 `aiMsg.content = fullResponse`（Vue 重 patch），改为本地变量累加 + 每帧 raf 同步一次到响应式对象，UI 渲染开销显著下降。
- **主进程 22 处同步 fs 调用改异步**：`fs.existsSync` / `mkdirSync` / `writeFileSync` / `readdirSync` / `statSync` 全部改成 `await asyncExists` / `asyncMkdir` / `asyncWriteFile` / `asyncReaddir` / `asyncStat`，保留 `getDefaultSaveDir` 的同步 fallback（高频入口，牵连全链路）。`list-files` 把 N 个 stat 改成 `Promise.all` 并行（速度提升 5~10 倍）。
- **AI 上下文管理**：`KEEP_RECENT_ROUNDS` 从 8 提升到 12；新增 `hasStructuredContent` 检测，含 markdown 表格 / 围栏代码块 / 多级标题 / 长列表的 AI 消息会从压缩区"抠出来"保留原文。
- **`shouldKeepContextMessage` 过短过滤修复**：原规则 `content.length > 300` 会把 AI 短回复（结构化表格往往 < 300 字）误判为"无效短回复"丢弃，导致用户说"用 markdown 表格再输出"时 AI 拿不到上轮表格。新规则只在"无内容 + 无成功工具 + 错误信息命中"时才过滤。
- **Export 工具描述强化**（防误匹配）：`export_to_markdown` / `export_mindmap_html` / `export_mindmap_pdf` / `export_outline_pdf` 四个工具的描述都加了 ⚠️ 强约束："仅当用户明确要求导出/保存为文件时才调用本工具；用户说 markdown 表格 / 列表 / 代码块时直接用文字回答"。
- **大代码文件提示**：`read_local_file` 对 >500KB 的代码文件自动追加"建议用 offset/max_chars 分次读取"的提示。
- **fileManager `maxBuffer` 优化**等。

### 新增能力（New Capabilities）

- **`run_shell` 工具**：允许在白名单 binary（node / npm / pnpm / python / git / docker / kubectl 等 31 个）里执行命令，最长 10 分钟；cwd 必须命中白名单（独立校验）。
- **`run_node` / `run_python` 工具**：执行本地脚本，绝对路径 + 主进程 fsGuard 双重校验。
- **`spawn_shell` 长任务流式工具**：后台启动进程，通过 `shell:stdout` / `shell:stderr` / `shell:exit` 事件推送输出，配合 `shell_kill_background_job` 终止；支持开发服务器 / 长任务训练等场景。
- **`shell_get_env` / `shell:listJobs` / `shell:kill` 工具**：查看 / 管理后台任务。

### Bug 修复

- **深度思考按钮关闭后被强制开启**：`toggleDeepThinkingMenu` / `toggleDeepThinkingPullup` 不再在关闭状态下 `setEnabled(true)`；同时为关闭状态补"开启深度思考"菜单入口（之前打开菜单根本没有任何可点的项）。
- **"沉淀 Skill"按钮只有悬浮弹窗**：原版 `ElMessage.success('已沉淀')` 3 秒消失，用户看不到 AI 给出的内容也没法改/试用。新版在消息列表插入可编辑卡片，5 个状态（analyzing / ready / saving / saved / not_feasible / failed / discarded），name / description / instructions 可编辑，提供 4 个按钮：「💾 保存」「▶ 一键试用」「✕ 取消」「🔄 重试」。
- **文件名过长超出消息框**：`.message-content` 加 `max-width: 100%; overflow-wrap: anywhere`，`、`.msg-file-chip` 改 `max-width: min(280px, calc(100% - 8px))`，文件名 ellipsis 不溢出。
- **fs:listDir 错误静默吞错**：返回 `{ error, items }` 让前端能反馈"该目录已被 fsGuard 拒绝"。

### 工程改进（Tooling）

- **新增 Skill: `ai-card-feature-fix-loop`**：把"AI 操作只有悬浮弹窗"这类问题的标准修复模式沉淀为可复用 skill，路径 `.trae/skills/ai-card-feature-fix-loop/SKILL.md`。
- **`COMMON_CODE_EXTS` 抽公共常量**：`read_local_file` / `retrieve_local_file` 共用一份代码扩展名列表，避免两份独立维护造成不一致。
- **`shellExec.js` 暴露 `setMaxBackgroundJobs` / `getMaxBackgroundJobs`**：供设置页 / 测试调整后台任务上限。

## [2.x]

历史 2.x 版本的更新日志未保留在仓库中，请参考 git commit history。