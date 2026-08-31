## my-mindmap agent v3.2.0

在 v3.1.0 基础上的**安全 + 体验 + 性能**系统性加固，同时新增多个 AI Agent 能力。

### 🔐 安全

- **fsGuard 路径白名单持久化**（重启程序不再丢失白名单）；FileTree 的 addFolder / syncSaveDirRoot / onMounted 三处自动同步注册到 fsGuard
- **shell:exec 独立 cwd 校验**（修复高危漏洞 S-1）：原版依赖 fileManager.assertPathAllowed 在「无白名单 + 无 activeFileDir」时全部放行；新版对 cwd 做独立硬约束，必须命中 userData / temp / 激活文件目录 / 已注册白名单 / 桌面·文档·下载 之一
- **run_node / run_python 脚本路径校验**：新增 `shell:assertScriptPathAllowed` IPC；run_node / run_python 在调用 shell:exec 之前先校验 script_path
- **用户 MCP 服务对外暴露**：修复 `listTools` 未未导出 bug。`/mcp` 端点的 `tools/list` 现在会把用户添加的 MCP 服务工具合并后下发（命名 `mcp__<serverId>__<toolName>`），外部 Agent（Trae / Claude Desktop / Cursor）可调用
- **shell_exec / spawn env 白名单合并**：env 字段只放行 21 个白名单 key，杜绝 `NODE_OPTIONS=--require /tmp/evil.js` 劫持子进程
- **shell:spawn `stdio: ['ignore', 'pipe', 'pipe']`** 显式关掉 stdin，避免死锁
- **shell_get_env 脱敏**：`NODE_OPTIONS` / `NPM_CONFIG_REGISTRY` 等 4 个 key 只返回"已设置"标记，不返回真实值
- **before-quit / will-quit 清理后台任务**：避免孤儿进程
- **shell:exec maxBuffer 从 2MB → 8MB**：给 npm install / pip install 长输出更大空间

### ⚡ 性能 / 体验

- **`setNodeGeneralization` 整树 render 防抖**（scheduleMindMapRender）：批量场景从 N 次 render 降到 1 次
- **AI 流式响应节流到 RAF**：避免每 token 触发 Vue patch
- **主进程 22 处同步 fs → 异步**：fs.existsSync / mkdirSync / writeFileSync / readdirSync / statSync 全部 await 化；list-files 把 N 个 stat 改 `Promise.all` 并行（5~10x）
- **AI 上下文**：`KEEP_RECENT_ROUNDS` 8 → 12；新增 `hasStructuredContent` 检测，含 markdown 表格 / 围栏代码块 / 多级标题 / 长列表的 AI 消息从压缩区抠出来保留原文
- **`shouldKeepContextMessage` 过短过滤修复**：移除 `content.length > 300` 误判，避免 AI 短表格回复被丢
- **Export 工具描述强化**：4 个 Export 工具加 ⚠️ 强约束，防 AI 把"用 markdown 表格输出"误识别为"导出文件"
- **`read_local_file` 大文件提示**：>500KB 文件提示用 `offset/max_chars` 分次读取
- **fs:listDir 不再静默吞错**：返回 `{ error, items }`

### 🆕 新增能力（AI Agent 工具）

- **`run_shell`**：白名单 binary（node / npm / pnpm / python / git / docker / kubectl 等 31 个），最长 10 分钟
- **`run_node` / `run_python`**：执行本地脚本，绝对路径 + 主进程 fsGuard 双重校验
- **`spawn_shell`**：后台长任务流式输出（开发服务器、训练等场景）
- **`shell_get_env` / shell:listJobs / shell:kill**：后台任务管理

### 🐛 Bug 修复

- **深度思考按钮关闭后被强制开启**：toggleDeepThinkingMenu 不再自动 setEnabled(true)；菜单补"开启深度思考"入口
- **"沉淀 Skill"按钮只有悬浮弹窗** → 改为消息列表可编辑卡片（5 个状态 + name/description/instructions 可编辑 + 4 个按钮：保存 / 一键试用 / 取消 / 重试）
- **文件名过长超出消息框**：max-width 限制 + ellipsis 不溢出
- **fs:listDir 错误静默吞错**

### 🛠️ 工程

- 新增 Skill：`ai-card-feature-fix-loop`（.trae/skills/ai-card-feature-fix-loop/SKILL.md）
- `COMMON_CODE_EXTS` 抽公共常量
- shellExec.js 暴露 `setMaxBackgroundJobs` / `getMaxBackgroundJobs`

---

### 📥 安装

下载 `my-mindmap-agent-Setup-3.2.0.exe` 双击运行，按引导安装即可。

### 📦 包含的源码

`my-mindmap-agent-source-3.2.0.zip` 是脱敏源码包（不含 node_modules / .workbuddy / 用户数据 / 隐私目录），按 `npm install` 后 `npm run electron:build` 即可自行打包。

完整更新日志见 [CHANGELOG.md](https://github.com/bubu-LZY/my-mindmap-agent/blob/main/CHANGELOG.md)。