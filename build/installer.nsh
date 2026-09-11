; 安装/卸载前自动退出正在运行的程序，避免文件占用导致安装失败
; 安装时先检测进程，若正在运行则弹确认框（确认后才退出，避免误退未保存的程序）
; taskkill 不带 /F 先请求正常关闭；若仍存活再用 /F 强制结束（未运行时命令静默失败，不影响安装）
;
; 关键修复：customInit / customUnInit 会被 electron-builder 内联进 .onInit / un.onInit。
; nsExec 的 Exec / ExecToLog 每次调用都会向栈压入退出码，必须 Pop 回收，否则栈被污染，
; 后续模板逻辑 Pop 到错误值，可能导致 .onInit 静默 Abort -- 表现为安装器双击无反应。
; 同时改用 nsExec::Exec（初始化阶段尚无日志窗口，比 ExecToLog 更稳妥）。

!include "LogicLib.nsh"

!macro customInit
  DetailPrint "正在检测运行中的 my-mindmap agent..."
  ; 检测进程是否在运行（nsProcess::_FindProcess 返回 0=找到/进程存在）
  nsProcess::_FindProcess "my-mindmap agent.exe"
  Pop $0
  ${If} $0 == 0
    ; /SD IDYES：静默安装（应用内自动更新走的是 --updated /S）时不弹确认框直接继续，
    ; 否则 MessageBox 会挂在无人值守的静默安装流程里，导致更新卡住
    MessageBox MB_YESNO|MB_ICONQUESTION "检测到 my-mindmap agent 正在运行。$\r$\n$\r$\n继续安装将自动退出该程序，如有未保存的内容请先保存，否则可能丢失。$\r$\n$\r$\n是否继续安装？" /SD IDYES IDYES proceed
      Abort
    proceed:
  ${EndIf}
  DetailPrint "正在退出运行中的 my-mindmap agent..."
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
