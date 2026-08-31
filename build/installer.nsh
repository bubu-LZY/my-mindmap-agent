; 安装/卸载前自动退出正在运行的程序，避免文件占用导致安装失败
; taskkill 不带 /F 先请求正常关闭；若仍存活再用 /F 强制结束（未运行时命令静默失败，不影响安装）
;
; 关键修复：customInit / customUnInit 会被 electron-builder 内联进 .onInit / un.onInit。
; nsExec 的 Exec / ExecToLog 每次调用都会向栈压入退出码，必须 Pop 回收，否则栈被污染，
; 后续模板逻辑 Pop 到错误值，可能导致 .onInit 静默 Abort -- 表现为安装器双击无反应。
; 同时改用 nsExec::Exec（初始化阶段尚无日志窗口，比 ExecToLog 更稳妥）。

!macro customInit
  DetailPrint "正在检测并退出运行中的 my-mindmap agent..."
  nsExec::Exec 'taskkill /IM "my-mindmap agent.exe" /T'
  Pop $0
  Sleep 1000
  nsExec::Exec 'taskkill /F /IM "my-mindmap agent.exe" /T'
  Pop $0
  Sleep 500
!macroend

!macro customUnInit
  DetailPrint "正在检测并退出运行中的 my-mindmap agent..."
  nsExec::Exec 'taskkill /IM "my-mindmap agent.exe" /T'
  Pop $0
  Sleep 1000
  nsExec::Exec 'taskkill /F /IM "my-mindmap agent.exe" /T'
  Pop $0
  Sleep 500
!macroend

; 卸载时清理开机自启动（注册表 Run 键），与主进程 setLoginItemSettings 写入的位置一致
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "my-mindmap agent"
!macroend