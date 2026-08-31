# ============================================================
# my-mindmap-agent 一键发布脚本（PowerShell）
# ============================================================
#
# 这个脚本会：
#   1) 检查隐私：扫描关键目录里有没有密钥 / token / 邮箱 / 用户名
#   2) git init + add + commit（首次发布）
#   3) git push 到 GitHub（需要远端仓库已经创建）
#   4) 用 GitHub REST API 创建 Release v3.0.0，上传 exe 和 zip 附件
#
# 运行前请：
#   - 在 GitHub 网页上创建一个空仓库（如 https://github.com/<OWN>/>my-mindmap-agent）
#   - 在 https://github.com/settings/tokens 生成一个 PAT（需要 repo 权限）
#   - 把下面 3 个变量填好再运行
# ============================================================

$ErrorActionPreference = 'Stop'

# ============= 用户必填 =============
$GITHUB_OWNER = ''           # 你的 GitHub 用户名 / 组织名（如 'octocat' 或 'my-org'）
$GITHUB_REPO  = ''           # 仓库名（如 'my-mindmap-agent'）
$GITHUB_PAT   = ''           # Personal Access Token，需要 'repo' 权限
$GIT_USER_NAME  = ''         # Git commit 用（不传也行，会用全局 git config）
$GIT_USER_EMAIL = ''        # Git commit 用

# ============= 自动检测 =============
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$REPO_DIR   = Split-Path -Parent $SCRIPT_DIR
$VERSION    = '3.0.0'
$TAG        = "v$VERSION"

Set-Location $REPO_DIR
Write-Host "📦 当前仓库根目录：$REPO_DIR" -ForegroundColor Cyan

# ============= 步骤 1：隐私扫描 =============
Write-Host ""
Write-Host "🔍 [1/5] 隐私扫描（5 秒）" -ForegroundColor Cyan

$privatePatterns = @(
  @{ Name = 'OpenAI/Anthropic key'; Regex = 'sk-[a-zA-Z0-9]{20,}|sk-ant-' },
  @{ Name = 'GitHub Token';         Regex = 'gh[pousr]_[A-Za-z0-9]{30,}' },
  @{ Name = 'Slack token';          Regex = 'xox[baprs]-[0-9a-zA-Z-]+' },
  @{ Name = 'Google API key';       Regex = 'AIza[0-9A-Za-z\-_]{35}' },
  @{ Name = 'AWS key';              Regex = 'AKIA[0-9A-Z]{16}' },
  @{ Name = '邮箱';                 Regex = '[A-Za-z0-9._%+-]+@(gmail|outlook|qq|163|hotmail|yahoo|foxmail|sina|aliyun)\.com' },
  @{ Name = '用户目录';             Regex = 'C:\\Users\\[^\\\/\s"]+' },
  @{ Name = '飞书 appSecret';       Regex = '"appSecret"\s*:\s*"[A-Za-z0-9]{10,}"' }
)

$findings = @()
foreach ($p in $privatePatterns) {
  $matches = Select-String -Path "$REPO_DIR" -Include '*.js','*.vue','*.json','*.md','*.ts' `
    -Recurse -ExcludePath '.git','node_modules','dist','release','.workbuddy','package' `
    -Pattern $p.Regex -ListSupported:$false -ErrorAction SilentlyContinue
  foreach ($m in $matches) {
    # 排除 src/services/feishuService.js 里的字段定义（"appSecret": '' 是空串占位，不算密钥）
    if ($m.Path -like '*feishuService.js*' -and $m.Line -match '"appSecret":\s*""') { continue }
    if ($m.Path -like '*FeishuPanel.vue*' -and $m.Line -match '"appSecret":\s*""') { continue }
    if ($m.Path -like '*toolHandler.js*' -and $m.Line -match 'appSecret') { continue }
    $findings += [PSCustomObject]@{ Pattern = $p.Name; File = $m.Path; Line = $m.LineNumber; Content = $m.Line.Trim() }
  }
}

if ($findings.Count -eq 0) {
  Write-Host "   ✅ 未发现硬编码密钥 / 邮箱 / 用户目录" -ForegroundColor Green
} else {
  Write-Host "   ⚠️ 发现 $($findings.Count) 处可能敏感内容：" -ForegroundColor Yellow
  $findings | ForEach-Object {
    Write-Host "      [$($_.Pattern)] $($_.File):$($_.Line)" -ForegroundColor DarkYellow
    Write-Host "         $($_.Content)" -ForegroundColor DarkGray
  }
  Write-Host ""
  Write-Host "   请确认是否需要删除后再继续发布（按 Ctrl+C 中断脚本）" -ForegroundColor Yellow
  Read-Host "   按 Enter 继续"
}

# ============= 步骤 2：检查产物存在 =============
Write-Host ""
Write-Host "📁 [2/5] 检查发布产物" -ForegroundColor Cyan

$EXE_PATH = Join-Path $REPO_DIR "release\my-mindmap agent Setup 3.0.0.exe"
$ZIP_PATH = 'C:\Users\lizhu\Desktop\my-mindmap-agent-source.zip'

if (-not (Test-Path $EXE_PATH)) {
  Write-Host "   ❌ 找不到 exe：$EXE_PATH" -ForegroundColor Red
  Write-Host "   请先运行 npm run electron:build" -ForegroundColor Yellow
  exit 1
}
if (-not (Test-Path $ZIP_PATH)) {
  Write-Host "   ❌ 找不到 zip：$ZIP_PATH" -ForegroundColor Red
  Write-Host "   请先运行 node tools/make-source-zip.cjs" -ForegroundColor Yellow
  exit 1
}

$exeSize  = [math]::Round((Get-Item $EXE_PATH).Length / 1MB, 2)
$zipSize  = [math]::Round((Get-Item $ZIP_PATH).Length / 1MB, 2)
$zipNames = $zipPath.Split('\')[-1]
Write-Host "   ✅ exe  ($exeSize MB): $EXE_PATH" -ForegroundColor Green
Write-Host "   ✅ zip  ($zipSize MB): $ZIP_PATH" -ForegroundColor Green

# ============= 步骤 3：Git 初始化 + 推送 =============
Write-Host ""
Write-Host "📤 [3/5] Git 推送（如果还没初始化仓库）" -ForegroundColor Cyan

if (-not (Test-Path ".git")) {
  Write-Host "   当前目录不是 git 仓库，开始初始化..." -ForegroundColor Yellow
  git init
  git checkout -b main 2>$null
  if ($GIT_USER_NAME)  { git config user.name  $GIT_USER_NAME  }
  if ($GIT_USER_EMAIL) { git config user.email $GIT_USER_EMAIL }
} else {
  Write-Host "   已经是 git 仓库，跳过初始化" -ForegroundColor Gray
}

# 远端检查
$remoteUrl = git remote get-url origin 2>$null
if (-not $remoteUrl) {
  Write-Host "   ❌ 没有设置 origin 远端" -ForegroundColor Red
  Write-Host "   请先在 GitHub 创建仓库，然后执行：" -ForegroundColor Yellow
  Write-Host "     git remote add origin https://github.com/$GITHUB_OWNER/$GITHUB_REPO.git" -ForegroundColor Cyan
  exit 1
}
Write-Host "   ✅ origin = $remoteUrl" -ForegroundColor Green

git add -A
git status --short | Select-Object -First 10
git commit -m "release: v$VERSION" 2>$null
Write-Host "   推送 master/main 到 origin..." -ForegroundColor Yellow
git push -u origin HEAD 2>&1 | Select-Object -Last 5

# ============= 步骤 4：创建 Tag =============
Write-Host ""
Write-Host "🏷️  [4/5] 创建并推送 tag $TAG" -ForegroundColor Cyan

git tag -d $TAG 2>$null
git tag $TAG
git push origin $TAG --force 2>&1 | Select-Object -Last 3

# ============= 步骤 5：创建 GitHub Release + 上传附件 =============
Write-Host ""
Write-Host "🚀 [5/5] 创建 GitHub Release + 上传附件" -ForegroundColor Cyan

$RELEASE_NOTES = @"
## my-mindmap-agent $VERSION

本版本在「安全 / 体验 / 性能」三方面做了系统性加固，新增多个 AI Agent 能力。

### 🔐 安全
- fsGuard 路径白名单持久化（重启程序不再丢失白名单）
- shell:exec 独立 cwd 校验（高危漏洞 S-1 修复）
- run_node / run_python script_path 校验
- shell_exec/spawn env 白名单合并
- 用户 MCP 服务对外暴露（外部 Agent 可通过 /mcp 调用）

### ⚡ 性能 / 体验
- AI 工作时整树重渲染 防抖（scheduleMindMapRender）
- AI 流式输出 节流到 RAF
- 主进程 22 处同步 fs 调用改异步
- AI 上下文管理：KEEP_RECENT_ROUNDS=12 + 结构化内容不压缩
- Export 工具描述强化（防 AI 把 markdown 表格误识别为导出文件）

### 🆕 新增能力
- run_shell / run_node / run_python 工具
- spawn_shell 长任务流式工具
- shell_get_env / shell:listJobs / shell:kill 工具

### 🐛 Bug 修复
- 深度思考按钮关闭后被强制开启
- "沉淀 Skill"按钮只有悬浮弹窗 → 改为消息列表可编辑卡片
- 文件名过长超出消息框
- fs:listDir 错误静默吞错

完整更新日志见 [CHANGELOG.md](https://github.com/$GITHUB_OWNER/$GITHUB_REPO/blob/$TAG/CHANGELOG.md)
"@

# GitHub API：创建 release
$apiBase = 'https://api.github.com'
$createReleaseUrl = "$apiBase/repos/$GITHUB_OWNER/$GITHUB_REPO/releases"

$releaseBody = @{
  tag_name = $TAG
  name     = "my-mindmap-agent $VERSION"
  body     = $RELEASE_NOTES
  draft    = $false
  prerelease = $false
} | ConvertTo-Json -Depth 10

$headers = @{
  Authorization  = "token $GITHUB_PAT"
  Accept        = 'application/vnd.github+json'
  'User-Agent'  = 'my-mindmap-agent-release-script'
  'X-GitHub-Api-Version' = '2022-11-28'
}

Write-Host "   创建 release..." -ForegroundColor Yellow
$releaseResp = Invoke-RestMethod -Uri $createReleaseUrl -Method Post `
  -Headers $headers -Body $releaseBody -ContentType 'application/json'

if ($releaseResp.upload_url) {
  Write-Host "   ✅ Release 已创建：$($releaseResp.html_url)" -ForegroundColor Green

  # 上传附件
  $uploadUrlTemplate = $releaseResp.upload_url -replace '\{\?name,label\}', '?name={0}'
  foreach ($asset in @(
    @{ Path = $EXE_PATH; Name = 'my-mindmap-agent-Setup-3.0.0.exe' }
    @{ Path = $ZIP_PATH; Name = 'my-mindmap-agent-source-3.0.0.zip' }
  )) {
    if (-not (Test-Path $asset.Path)) {
      Write-Host "   ❌ 跳过：$($asset.Path) 不存在" -ForegroundColor Yellow
      continue
    }

    $url = $uploadUrlTemplate -f $asset.Name
    Write-Host "   上传 $($asset.Name)..." -ForegroundColor Yellow
    try {
      # PowerShell 5.1（PowerShell 5 / Windows PowerShell）不支持 -InFile，需手动构造 multipart/form-data
      $boundary = [System.Guid]::NewGuid().ToString()
      $fileBytes = [System.IO.File]::ReadAllBytes($asset.Path)
      $fileEnc   = [System.Text.Encoding]::GetEncoding('iso-8859-1').GetString($fileBytes)
      $header    = "--$boundary`r`nContent-Disposition: form-data; name=`"attachment`"; filename=`"$($asset.Name)`"`r`nContent-Type: application/octet-stream`r`n`r`n"
      $footer    = "`r`n--$boundary--`r`n"
      $body      = $header + $fileEnc + $footer
      $bodyBytes = [System.Text.Encoding]::GetEncoding('iso-8859-1').GetBytes($body)

      $multipartHeaders = $headers.Clone()
      $multipartHeaders['Content-Type'] = "multipart/form-data; boundary=$boundary"

      Invoke-RestMethod -Uri $url -Method Post `
        -Headers $multipartHeaders `
        -Body $bodyBytes
      Write-Host "      ✅ 上传成功" -ForegroundColor Green
    } catch {
      Write-Host "      ❌ 上传失败：$($_.Exception.Message)" -ForegroundColor Red
    }
  }
} else {
  Write-Host "   ❌ 创建 release失败：$($releaseResp | ConvertTo-Json -Depth 5)" -ForegroundColor Red
}

Write-Host ""
Write-Host "🎉 发布流程完成！" -ForegroundColor Green
if ($releaseResp -and $releaseResp.html_url) {
  Write-Host "   Release URL: $($releaseResp.html_url)" -ForegroundColor Cyan
}