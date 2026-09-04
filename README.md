# my-mindmap agent

基于思维导图和大纲的 AI 智能体。把「思维导图 / 大纲 / 关联图 / Markdown」四种视图和本地 AI Agent 结合，
支持本地文件、知识库检索、飞书/微信、MCP、自定义工具，以及对 `.smm` 思维导图文件的深度操作。

## 功能特性

- **四种视图**：思维导图 / 大纲 / 关联图 / Markdown，可来回同步（表格、代码块、图片、引用原子块等结构会尽量保留）。
- **AI Agent**：生成导图、续写、整理、批量改节点、AI 挖空、背诵改写、出题、复习计划等。
- **本地知识库**：读取 txt/md/json/docx/pptx/xlsx/pdf/图片 OCR，BM25 + 向量语义检索。
- **后台任务**：AI 按“指定文件路径”在后台修改文件，不抢占前台，完成后返回可在应用内打开的文件路径。
- **多分屏**：Obsidian 式分屏树，拖拽标签到边缘组合多个导图，多屏合并为“多屏”组合标签。
- **扩展协议**：Skills / MCP / Custom Tools，支持外部 Agent 调用。
- **三方集成**：飞书文档/云盘/机器人、微信推送、定时任务。

## 运行环境

- Windows（主要目标平台）
- Node.js 18+（Electron 28）

## 开发

```bash
npm install
npm run dev          # 前端 Vite
npm run electron:dev # Electron + Vite 开发模式
```

## 打包

```bash
npm run electron:build
```

打包产物输出到 `release/`，Windows NSIS 安装程序为
`release/my-mindmap agent Setup <version>.exe`。

## 目录结构

```text
src/            渲染进程（Vue 3 + Element Plus + simple-mind-map）
electron/       主进程（IPC、文件管理、MCP、自定义工具、安全防护）
custom-tools/   内置自定义工具示例
skills/         Skills 示例
docs/           文档（编写规范、实现方案、开发经验）
```

## 相关文档

- [更新日志](./CHANGELOG.md)
- [Skills / MCP / Custom Tools 编写指南](./docs/skills-mcp-tools.md)
- [自定义工具编写规范](./docs/custom-tools-spec.md)
- [分屏拖出独立标签页实现方案](./docs/分屏拖出独立标签页-实现方案.md)
- [开发经验与注意事项](./docs/开发经验与注意事项.md)

## License

本项目为个人项目，源码仅供学习与交流使用。
