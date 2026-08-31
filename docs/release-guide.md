# 发布到 GitHub 指南

本项目自带 `tools/release.ps1` 一键发布脚本。

## 1. 前置条件（一次性）

1. **创建空 GitHub 仓库**
   - 访问 https://github.com/new
   - Repository name 填 `my-mindmap-agent`（或自定义）
   - 类型选 Public 或 Private
   - **不要勾选** "Add a README file" / "Add .gitignore" / "Choose a license"（保持空仓库）

2. **生成 GitHub Personal Access Token (PAT)**
   - 访问 https://github.com/settings/tokens
   - 点 "Generate new token" → → "Generate new token (classic)"
   - Note 填 `my-mindmap-agent-release`
   - Expiration 选 90 天 或 No expiration
   - **Scopes 勾选 `repo`（Full control of private repositories）**
   - 点 "Generate token"
   - **立即复制 token**（关闭页面后无法再次查看）

## 2. 准备产物（每次发布）

```powershell
# 在项目根目录
npm install                 # 第一次或依赖更新后
npm run build               # 编译渲染进程
npm run electron:build       # 打包 exe（产物在 release\my-mindmap-agent Setup 3.0.0.exe）
node tools/make-source-zip.cjs   # 脱敏源码包（产物在桌面 my-mindmap-agent-source.zip）
```

## 3. 运行发布脚本

打开 PowerShell，切换到项目根目录：

```powershell
cd "c:\Users\lizhu\Desktop\mymindmapagent\my-mindmap agent 源码"

# 首次运行：把脚本顶部的 3 个变量填上
notepad tools/release.ps1
#   - $GITHUB_OWNER = 你的 GitHub 用户名
#   - $GITHUB_REPO  = 仓库名
#   - $GITHUB_PAT   = 第 1 步拿到的 PAT
#   - $GIT_USER_NAME / $GIT_USER_EMAIL 也填一下

# 执行
powershell -ExecutionPolicy Bypass -File tools/release.ps1
```

脚本会自动：
1. **隐私扫描**：在源码里搜密钥 / token / 邮箱 / 用户名 / `C:\Users\<name>\` 等敏感字符串
3. **Git 操作**：git init → add → commit → push
4. **创建 Tag**：`v3.0.0`
5. **GitHub Release**：调用 REST API 创建 release + 上传 exe + zip

## 4. 隐私保护清单

✅ 自动排除的文件 / 目录（已在 `.gitignore` 和 `make-source-zip.cjs` 里）：

| 排除项 | 原因 |
|--------|------|
| `node_modules/` | 巨大且能 npm install |
| `dist/` | 构建产物 |
| `release/` | 私有构建产物 |
| `.workbuddy/` | IDE 本地工作目录痕迹（含 `C:\Users\lizhu\...`） |
| `package/` | simple-mind-map 离线源码（已走 dependencies） |
| `*.zip` | 历史发布包 |
| `simple-mind-map-*.tgz` | 包缓存 |
| `AI工具测试对话.md` / `对话总结.md` / `多窗口多标签改造计划.md` | 内部对话/计划文档 |
| `_probe.cjs` / `electron/_syntax_check_stub_electron.cjs` | 调试 / 临时脚本 |
| `tools/fix-prompt.ps1` 等 6 个早期调试脚本 | 历史工具 |
| `*.ldb` / `*.ldb-shm` / `*.ldb-wal` | LevelDB 用户数据 |

✅ 保留的脚本：

- `tools/gen-integrity-manifest.js` — electron-builder 用，生成完整性清单
- `tools/make-source-zip.cjs` — 脱敏源码打包（也会被 release.ps1 间接使用）
- `tools/release.ps1` — 一键 GitHub Release 发布脚本

✅ 自动扫描的敏感模式（发现会**先警告**再让你确认是否继续）：

- OpenAI / Anthropic API key (`sk-...`、`sk-ant-...`)
- GitHub Token (`ghp_` / `gho_` / `ghu_` / `ghs_` / `ghr_`)
- Slack token (`xoxb-` / `xoxp-` / `xoxa-` / `xoxr-` / `xoxs-`)
- Google API key (`AIza...`)
- AWS key (`AKIA...`)
- 邮箱（gmail / outlook / qq / 163 / hotmail / yahoo / foxmail / sina / aliyun）
- Windows 用户目录（`C:\Users\<name>\`）
- 飞书 appSecret 真实值（空字符串占位会被忽略）

## 5. 手动 fallback（不信任脚本）

如果 release.ps1 跑不起来，可以手动操作：

1. 在 GitHub 网页上点 "Releases" → "Draft a new release"
2. Tag 输入 `v3.0.0`（或先 `git tag v3.0.0 && git push origin v3.0.0`）
3. Release title 输入 `my-mindmap-agent 3.0.0`
4. Describe this release 框粘贴 [CHANGELOG.md](../CHANGELOG.md) 的 [3.0.0] 章节
5. 底部 Attach binaries 拖入：
   - `release\my-mindmap agent Setup 3.0.0.exe` （installer）
   - `my-mindmap-agent-source.zip` （脱敏源码包）
6. 点 "Publish release"

## 6. 验证

发布完成后去 GitHub release 页面（`https://github.com/<owner>/my-mindmap-agent/releases`）检查：

- [ ] Release 标题、Tag、描述正确
- [ ] 两个附件能下载
- [ ] ZIP 解压后只有 ~140 个文件，全是源代码 / 配置 / 文档
- [ ] ZIP 里没有 `.workbuddy/` / `node_modules/` / `package/` / `AI工具测试对话.md` 等隐私 / 构建产物

如果发现 zip 里有不该有的文件，告诉我，我再调整 `make-source-zip.cjs` 的 `IGNORE_PATTERNS`。