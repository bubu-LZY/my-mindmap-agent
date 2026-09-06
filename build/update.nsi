; ============================================================
;  轻量级前端更新器（高频更新方案）
;  只替换已安装应用的 resources\app-dist 前端资源目录，
;  几秒钟完成一次前端更新，无需每次跑完整安装。
;
;  工作原理：
;   1. 完整安装器（electron-builder NSIS）安装后，主进程
;      main.js 优先加载 resources\app-dist\index.html，
;      目录不存在时回落到包内 asar 的 dist。
;   2. 本更新器从注册表读取完整安装器写入的 InstallLocation，
;      把新的前端资源覆盖写入 resources\app-dist。
;   3. 更新前自动退出运行中的程序，避免文件占用。
;
;  编译方式（需安装 NSIS，makensis 在 PATH 中）：
;     cd build
;     makensis /DPROJECT_DIR=".." update.nsi
;   产物：my-mindmap-agent-update.exe
; ============================================================

!include "MUI2.nsh"

!define APP_NAME "my-mindmap agent"
!define APP_EXE "my-mindmap agent.exe"
!define APP_ID "com.mindmap.aiagent"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

; 项目根目录（编译时通过 -DPROJECT_DIR 传入，默认相对脚本所在目录的上级）
!ifndef PROJECT_DIR
  !define PROJECT_DIR ".."
!endif

Name "${APP_NAME} 前端更新"
OutFile "my-mindmap-agent-update.exe"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
ShowInstDetails show

; ---------- 目录页：优先从注册表预填安装目录 ----------
Var REAL_INSTDIR
!define MUI_PAGE_CUSTOMFUNCTION_PRE preDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function preDirectory
  ; 完整安装器（electron-builder）在卸载注册表写入了 InstallLocation
  ReadRegStr $0 HKLM "${UNINST_KEY}" "InstallLocation"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${UNINST_KEY}" "InstallLocation"
  ${EndIf}
  ${If} $0 != ""
    StrCpy $INSTDIR $0
    StrCpy $REAL_INSTDIR $0
  ${EndIf}
FunctionEnd

Function .onInit
  ; 退出运行中的程序（先请求正常关闭，再强制结束）
  DetailPrint "正在退出运行中的 ${APP_NAME}..."
  nsExec::ExecToLog 'taskkill /IM "${APP_EXE}" /T'
  Sleep 1000
  nsExec::ExecToLog 'taskkill /F /IM "${APP_EXE}" /T'
  Sleep 500

  ; 若目录页未能从注册表取到，则跳过目录选择（直接以传入值安装）
  ReadRegStr $0 HKLM "${UNINST_KEY}" "InstallLocation"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${UNINST_KEY}" "InstallLocation"
  ${EndIf}
  ${If} $0 != ""
    StrCpy $INSTDIR $0
    StrCpy $REAL_INSTDIR $0
  ${EndIf}
FunctionEnd

Section "更新前端资源"
  ${If} $INSTDIR == ""
    DetailPrint "未找到安装目录，请在上一步选择应用安装位置。"
    MessageBox MB_OK "未能在注册表找到 ${APP_NAME} 的安装目录，请选择安装位置。"
  ${EndIf}

  DetailPrint "安装目录：$INSTDIR"
  DetailPrint "正在更新前端资源到 $INSTDIR\resources\app-dist ..."

  ; 清空旧资源，避免残留（删除整个目录后重建）
  RMDir /r "$INSTDIR\resources\app-dist"
  CreateDirectory "$INSTDIR\resources\app-dist"

  ; 将 dist 目录内容递归复制到 app-dist 根（不含 dist 本身）
  SetOutPath "$INSTDIR\resources\app-dist"
  File /r "${PROJECT_DIR}\dist\*.*"

  DetailPrint "前端资源更新完成。"
SectionEnd
