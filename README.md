# my-mindmap agent

> 基于思维导图（simple-mind-map）与大纲的 **AI 智能体桌面应用**。  
> 用 AI 生成、整理、扩展、复习你的知识图谱，并支持联网搜索、飞书/微信推送、定时任务与复习计划。

> 💙 **特别致谢**：本项目的思维导图内核由开源项目 **[Simple Mind Map（思绪思维导图）](https://github.com/wanglin2/mind-map)** 强力驱动，感谢作者 **wanglin2** 及所有贡献者的卓越工作，让一个轻量而强大的思维导图引擎得以自由生长。本项目在 MIT 协议下复用其内核并扩展出 AI 智能体能力。


![platform](https://img.shields.io/badge/platform-Windows-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![version](https://img.shields.io/badge/version-1.0.0-orange)

---

## 一、这是什么

`my-mindmap agent` 是一个 **Electron + Vue 3** 打造的桌面软件，把"思维导图"和"AI 助手"融为一体：

- 左侧是**文件树 / 大纲 / 复习计划**三合一侧边栏；
- 中间是**思维导图画布**（基于 `simple-mind-map`，支持主题、布局、缩略图、全屏）；
- 右侧是**对话式 AI 面板**，AI 能直接读图、改图、生成新图，而不是只陪你聊天。

它不只是"把 AI 接到导图里"——AI 拥有 **80+ 个工具（tool calls）**，可以真正地去**增删节点、批量标色加粗、一键整理框架、生成填空自测、出题、上传飞书、定时推送微信**……你说一句话，它去把导图改好。

---

## 程序截图

<p align="center">
  <img src="https://raw.githubusercontent.com/bubu-LZY/my-mindmap-agent/main/docs/assets/icon.png" alt="欢迎页：My-mindmap 智能体 + 思维导图" width="96" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/bubu-LZY/my-mindmap-agent/main/docs/assets/screenshot-1-mindmap.png" alt="主界面：思维导图 + AI 助手" width="540" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/bubu-LZY/my-mindmap-agent/main/docs/assets/screenshot-4-integrations.png" alt="设置面板：飞书/微信三方链接" width="720" />
</p>

<p align="center">
  <em>左：应用图标&nbsp;&nbsp;·&nbsp;&nbsp;右上：主界面（画布 + AI 助手同屏）&nbsp;&nbsp;·&nbsp;&nbsp;下：设置面板（飞书 / 微信三方链接）</em>
</p>

更多功能与详情请查看项目介绍页：
👉 https://bubu-lzy.github.io/my-mindmap-agent/

## 二、核心功能（重点）

### 1. AI 直接操作思维导图（核心能力）

AI 不只是回答，而是**带着"工牌"去精准修改指定的那份导图**，避免多任务串台。支持：

| 能力 | 说明 |
| --- | --- |
| 生成导图 | 从一个主题直接生成完整 `.smm` 思维导图并自动保存 |
| 扩展节点 | 给选中节点 AI 生成多级子节点（先问参考资料/层级/要求） |
| 节点编辑 | 批量加子节点、改文本、删节点、插父节点、加概要 |
| 批量样式 | 一键把全图【】内容标蓝加粗；按关键词批量设颜色/高亮/字体 |
| 一键整理框架 | `reorganize_mindmap`：AI 重排层级归类，**原文严格保留**，存为新文件 |
| 结构审计/重构 | 审计导图质量、安全重构（dry-run + 安全修复） |
| 主题/布局/视图 | 切换主题、布局、大纲/脑图/复习三模式、缩放、撤销重做 |

### 2. 三种视图模式

- **大纲模式**：所见即所得的大纲编辑，`Shift+Enter` 节点内换行，可导入 Markdown / XMind。
- **思维导图模式**：完整画布，支持全屏、缩略图、多种主题与结构布局。
- **复习模式**：把节点加入**艾宾浩斯遗忘曲线复习计划**（1/3/7/15/31 天记忆周期），到点系统通知提醒。

### 3. 智能学习与自测（面向背诵/考试）

- **AI 智能挖空**：自动挑关键词挖空，点击显隐答案，适合自测背诵。
- **全文挖空**：整图并行挖空 + 进度百分比，超大图也不卡。
- **AI 出题**：从选中节点一键生成选择/填空题，另存为新文件，答案自动挖空隐藏。
- **AI 背诵改写**：把节点改写成记忆口诀，便于背诵。
- **复习计划**：按日期/周期查询，今日复习清单，完成打卡，定时弹窗提醒。

### 4. 联网搜索与网页读取

- 内置**免费多引擎联网搜索**（无需密钥），自动并发、缓存、熔断、相关性重排。
- `search_web` / `read_webpage` 工具让 AI 在回答时获取实时信息并附来源。
- `research_to_mindmap`：调研一个主题，生成**带引用来源**的导图。

### 5. 本地文件与知识库

- 拖入 **PDF / Word / TXT** 等大文件，AI 用 `retrieve_local_file` **语义检索**最相关片段，而非读全文（中文 bigram 打分，扫描版 PDF 走 OCR 兜底）。
- 知识库可纳入对话上下文，AI 优先依据你的资料作答。
- 支持导入/导出 **XMind、Markdown、PDF、图片** 等格式。

### 6. 飞书 / 微信 集成与推送

- **飞书**：上传导图到飞书云盘、转为飞书在线文档、发文件/图片/文本到群聊、飞书机器人自动回复。
- **微信**：扫码登录后，向微信联系人发文本/图片/文件，微信机器人可自动处理消息并用 AI 回复。
- 复习提醒可推送到飞书/微信，或走系统通知。

### 7. AI 定时任务

- 在软件内配置定时任务（一次性 / 每天 / 每周 / 每月），到点在后台唤起应用并执行指定 AI 提示词。
- 可与飞书/微信推送联动，实现"每天早 8 点给我推送今日复习清单"等自动化。

### 8. 多窗口 / 多标签（已落地 Tab 标签栏）

- 顶部 **Tab 标签栏**：一个标签 = 一个文件，可切换、可拖拽剥离为独立窗口。
- **同文件禁止多开**：重复打开会提示并跳转到已有标签。
- AI 任务**绑定目标文件**（fileId），你切换文件也不会改错图。

### 9. 工程与体验细节

- **意图规范化改写**：发送消息前先让 AI 做意图识别与改写，提升弱模型下的指令遵循率。
- **自动保存 / 软重启**：关闭前自动落盘；界面卡死用"刷新"按钮软重启恢复。
- **安全**：主进程对渲染层 IPC 调用做发送方校验，防御 XSS 注入后的越权文件读写。
- **快捷键中心**：内置操作手册，集中管理所有快捷键。
- **旧版本数据迁移**：启动自动把老数据迁移到新结构，避免空数据覆盖。

---

## 三、技术架构

```
my-mindmap-agent/
├── src/                      # Vue 3 前端（渲染进程）
│   ├── App.vue               # 主框架：导航栏 / Tab 栏 / 三视图 / AI 面板
│   ├── components/           # 各 UI 组件（导图编辑器、大纲、复习、聊天、设置…）
│   ├── services/             # AI 服务、工具调度、飞书/微信/知识库/OCR/搜索/定时任务
│   ├── stores/               # Pinia 状态（AI、思维导图实例）
│   ├── utils/                # 挖空、复习计划、Markdown/XMind 解析、PDF、上下文窗口…
│   └── prompts/              # AI Prompt 模板
├── electron/                 # Electron 主进程 + preload + IPC 模块
│   ├── main.js               # 窗口、托盘、IPC 安全校验、联网搜索编排
│   ├── preload.js            # 暴露安全 API 给渲染层
│   ├── ipc/                  # aiChat / fileManager / feishu / wechat / ocr / taskScheduler…
│   └── utils/                # 配置存储、旧版 LevelDB 迁移
├── build/                    # NSIS 安装脚本
├── public/                   # 静态资源（图标）
├── tools/                    # 辅助脚本（打包、图标生成、迁移测试等）
├── index.html
├── vite.config.js
└── package.json
```

> 思维导图渲染内核来自开源项目 [Simple Mind Map](https://github.com/wanglin2/mind-map)（MIT），本项目的 `simple-mind-map` 依赖即源自此仓库。

**技术栈**：Vue 3 · Pinia · Element Plus · Vite 5 · Electron 28 · electron-builder · simple-mind-map · sql.js · tesseract.js（OCR）· jszip · pdfjs-dist · @larksuiteoapi/node-sdk（飞书）。

---

## 四、支持的 AI 模型

兼容 **OpenAI 格式 API**，内置预设：

- OpenAI（gpt-4o 等）
- DeepSeek（deepseek-chat / reasoner）
- Kimi / 月之暗面
- 智谱 GLM
- 以及任意自定义 `baseURL` + 模型名（自动补全 `/v1/chat/completions` 路径）

---

## 五、下载与安装

### 方式一：下载安装包（推荐普通用户）

前往 **[Releases](../../releases)** 页面，下载 `my-mindmap agent Setup 1.0.0.exe`：

- Windows 安装包（NSIS），约 122 MB；
- 支持自定义安装目录、创建桌面/开始菜单快捷方式；
- 安装后首次启动，在右侧 AI 面板配置你的模型 API（BaseURL、Key、模型名）即可使用。

> 安装包不会在后台收集任何数据；AI 调用走你自己的模型密钥。

### 方式二：从源码运行（开发者）

```bash
# 1. 安装依赖
npm install

# 2. 开发模式（Vite + Electron 热更新）
npm run electron:dev

# 3. 打包为安装程序（输出到 release/）
npm run electron:build
```

> 注意：联网搜索、OCR、飞书/微信、定时任务等能力依赖 Electron 主进程，**仅在 `npm run electron:dev` / 打包后的桌面端可用**，纯 `npm run dev` 浏览器模式不可用。

---

## 六、快速上手

1. 打开软件 → 左侧文件树新建或导入（`.smm` / Markdown / XMind）一个导图；
2. 右侧 AI 面板先到**设置**填好模型 API；
3. 试试这些指令：
   - "帮我用思维导图梳理《习近平新时代中国特色社会主义思想概论》第 3 章"
   - "把全图里【】里的内容标蓝加粗"
   - "给这个节点生成 3 层子节点，参考我拖进来的 PDF"
   - "把这份导图一键整理成更合理的框架，存为新文件"
   - "给整图做智能挖空，我要自测背诵"
   - "每天早 8 点把今日复习清单推送到我的微信"

---

## 七、常见问题

- **AI 改错了图？** 切文件不会让它改错——每个 AI 任务都绑定了发起时的文件，只动它该动的图。
- **导入的 Markdown 层级/加粗不对？** 删除旧的错误 `.smm` 重新导入即可（已修复缩进自动检测与行内样式）。
- **扫描版 PDF 识别不了？** 会自动走 OCR 兜底（tesseract.js），首次较慢属正常。
- **弱模型指令误解？** 关键任务建议用更强模型（如 deepseek-chat），并开启意图改写。

---

## 八、许可证

本项目以 **MIT License** 开源，仅供学习与交流使用。
