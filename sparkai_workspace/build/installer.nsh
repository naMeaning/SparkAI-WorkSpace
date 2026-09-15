LangString NAIMAGE_WELCOME_TITLE 2052 "欢迎使用 SparkAI WorkSpace"
LangString NAIMAGE_WELCOME_TITLE 1033 "Welcome to SparkAI WorkSpace"
LangString NAIMAGE_WELCOME_TEXT 2052 "面向跨境电商的 AI 套图工作台。$\r$\n$\r$\n一键翻译多国语言套图，专属个性配置，生成专属于你的跨境电商套图；支持参考图编辑、分层 PNG 与 PSD 交付。$\r$\n$\r$\n安装程序将为当前用户安全部署 SparkAI WorkSpace，保留已有项目与设置。"
LangString NAIMAGE_WELCOME_TEXT 1033 "An AI image workspace built for cross-border commerce.$\r$\n$\r$\nTranslate product sets into multiple languages, apply your own brand configuration, and deliver layered PNG or PSD assets.$\r$\n$\r$\nSetup installs SparkAI WorkSpace safely for the current user and preserves existing projects and settings."
LangString NAIMAGE_DIRECTORY_TEXT 2052 "选择 SparkAI WorkSpace 的安装位置。用户项目、会话与图片库独立保存，升级不会覆盖创作成果。"
LangString NAIMAGE_DIRECTORY_TEXT 1033 "Choose where to install SparkAI WorkSpace. Projects, conversations, and image libraries are stored separately and remain intact across upgrades."
LangString NAIMAGE_FINISH_TITLE 2052 "SparkAI WorkSpace 已准备就绪"
LangString NAIMAGE_FINISH_TITLE 1033 "SparkAI WorkSpace is ready"
LangString NAIMAGE_FINISH_TEXT 2052 "安装已完成。启动后登录账户，即可让 Agent 接手图像任务并在画布中整理成果。"
LangString NAIMAGE_FINISH_TEXT 1033 "Installation is complete. Sign in to let the Agent handle image tasks and organize results on the canvas."

!macro customHeader
  BrandingText "SparkAI WorkSpace · namean"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_FINISHPAGE_TITLE_3LINES
  !define MUI_ABORTWARNING
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(NAIMAGE_WELCOME_TITLE)"
  !define MUI_WELCOMEPAGE_TEXT "$(NAIMAGE_WELCOME_TEXT)"
  !define MUI_DIRECTORYPAGE_TEXT_TOP "$(NAIMAGE_DIRECTORY_TEXT)"
  !define MUI_FINISHPAGE_TITLE "$(NAIMAGE_FINISH_TITLE)"
  !define MUI_FINISHPAGE_TEXT "$(NAIMAGE_FINISH_TEXT)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

; The distributable setup is a branded WPF bootstrapper. This NSIS package is
; intentionally invoked in silent mode and remains the proven install/upgrade
; engine. The branded uninstaller is copied beside the application and becomes
; the only public uninstall entry. The generated NSIS uninstaller remains an
; internal removal engine so upgrades and rollback retain electron-builder's
; established behavior.
!macro customInstall
  File /oname=naimage-uninstaller.exe "${PROJECT_DIR}\.release-tools\brand-uninstaller\SparkAI WorkSpace Uninstaller.exe"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$INSTDIR\naimage-uninstaller.exe" --install-dir="$INSTDIR"'
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString '"$INSTDIR\naimage-uninstaller.exe" /S --install-dir="$INSTDIR"'
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayIcon "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
!macroend

; If someone opens the internal NSIS uninstaller directly, redirect before any
; MUI page is created. This prevents the legacy Windows wizard from flashing.
!macro customUnInit
  ${IfNot} ${Silent}
    Exec '"$INSTDIR\naimage-uninstaller.exe" --install-dir="$INSTDIR"'
    Quit
  ${EndIf}
!macroend
