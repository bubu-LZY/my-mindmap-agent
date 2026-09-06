# 生成桌面交付包：源码(排除构建产物) + 5份MD文档 + 图标
$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$zipPath = Join-Path $desktop 'my-mindmap-agent-deliverable.zip'

$excludeDirs = @('node_modules', '.git', 'release', 'dist', '.trae', '.vscode')
$rootPrefix = 'my-mindmap-agent/'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
$utf8 = [System.Text.Encoding]::UTF8
try {
  $files = Get-ChildItem -Path $projectDir -Recurse -File |
    Where-Object {
      $rel = $_.FullName.Substring($projectDir.Length + 1)
      $parts = $rel -split '[\\/]'
      -not ($excludeDirs -contains $parts[0])
    }
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($projectDir.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, "$rootPrefix$rel", 'Optimal') | Out-Null
  }

  # 5份MD文档放到包根目录（副本，方便快速阅读）
  foreach ($md in (Get-ChildItem -Path (Join-Path $projectDir 'deliverables') -Filter '*.md')) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $md.FullName, $md.Name, 'Optimal') | Out-Null
  }

  # 图标预览
  foreach ($ico in (Get-ChildItem -Path (Join-Path $projectDir 'electron\icons') -File)) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $ico.FullName, "icons-preview/$($ico.Name)", 'Optimal') | Out-Null
  }

  $entryCount = $zip.Entries.Count
} finally {
  $zip.Dispose()
}

Write-Host "DONE: $zipPath"
Write-Host "Entries: $entryCount"
Write-Host ("Size: {0:N1} MB" -f ((Get-Item $zipPath).Length / 1MB))
