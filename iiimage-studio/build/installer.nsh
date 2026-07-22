LangString IIIMAGE_WELCOME_TITLE 2052 "欢迎使用 iiimage Studio"
LangString IIIMAGE_WELCOME_TITLE 1033 "Welcome to iiimage Studio"
LangString IIIMAGE_WELCOME_TEXT 2052 "单 Agent 驱动的 AI 图像工作台。$\r$\n$\r$\n用自然语言完成生图、参考图编辑、多版式探索、分层 PNG 与 PSD 交付；成果会自动进入无限画布，并保留清晰的来源关系。$\r$\n$\r$\n安装程序将为当前用户安全部署 iiimage Studio，保留已有项目与设置。"
LangString IIIMAGE_WELCOME_TEXT 1033 "A single-Agent AI image workspace.$\r$\n$\r$\nCreate, edit, explore variants, deliver layered PNG and PSD assets, and keep every result organized on an infinite visual canvas.$\r$\n$\r$\nSetup installs iiimage Studio safely for the current user and preserves existing projects and settings."
LangString IIIMAGE_DIRECTORY_TEXT 2052 "选择 iiimage Studio 的安装位置。用户项目、会话与图片库独立保存，升级不会覆盖创作成果。"
LangString IIIMAGE_DIRECTORY_TEXT 1033 "Choose where to install iiimage Studio. Projects, conversations, and image libraries are stored separately and remain intact across upgrades."
LangString IIIMAGE_FINISH_TITLE 2052 "iiimage Studio 已准备就绪"
LangString IIIMAGE_FINISH_TITLE 1033 "iiimage Studio is ready"
LangString IIIMAGE_FINISH_TEXT 2052 "安装已完成。启动后登录账户，即可让 Agent 接手图像任务并在画布中整理成果。"
LangString IIIMAGE_FINISH_TEXT 1033 "Installation is complete. Sign in to let the Agent handle image tasks and organize results on the canvas."

!macro customHeader
  BrandingText "iiimage Studio · Aieyra"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_FINISHPAGE_TITLE_3LINES
  !define MUI_ABORTWARNING
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(IIIMAGE_WELCOME_TITLE)"
  !define MUI_WELCOMEPAGE_TEXT "$(IIIMAGE_WELCOME_TEXT)"
  !define MUI_DIRECTORYPAGE_TEXT_TOP "$(IIIMAGE_DIRECTORY_TEXT)"
  !define MUI_FINISHPAGE_TITLE "$(IIIMAGE_FINISH_TITLE)"
  !define MUI_FINISHPAGE_TEXT "$(IIIMAGE_FINISH_TEXT)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

; The distributable setup is a branded WPF bootstrapper. This NSIS package is
; intentionally invoked in silent mode and remains the proven install/upgrade
; engine. The branded uninstaller is copied beside the application and becomes
; the only public uninstall entry. The generated NSIS uninstaller remains an
; internal removal engine so upgrades and rollback retain electron-builder's
; established behavior.
!macro customInstall
  File /oname=iiimage-studio-uninstaller.exe "${PROJECT_DIR}\.release-tools\brand-uninstaller\iiimage Studio Uninstaller.exe"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$INSTDIR\iiimage-studio-uninstaller.exe" --install-dir="$INSTDIR"'
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString '"$INSTDIR\iiimage-studio-uninstaller.exe" /S --install-dir="$INSTDIR"'
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayIcon "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
!macroend

; If someone opens the internal NSIS uninstaller directly, redirect before any
; MUI page is created. This prevents the legacy Windows wizard from flashing.
!macro customUnInit
  ${IfNot} ${Silent}
    Exec '"$INSTDIR\iiimage-studio-uninstaller.exe" --install-dir="$INSTDIR"'
    Quit
  ${EndIf}
!macroend
