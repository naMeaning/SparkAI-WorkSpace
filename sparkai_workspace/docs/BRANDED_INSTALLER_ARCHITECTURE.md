# SparkAI WorkSpace 品牌安装与卸载架构

## 交付目标

Windows 用户从双击安装包到安装完成，全程只看到 SparkAI WorkSpace 自有界面；从“已安装的应用”、开始菜单或内部卸载入口发起卸载时，也只看到同一视觉体系。electron-builder 生成的旧式 MUI 向导不再作为公开界面。

## 两层设计

### 品牌交互层

`tools/windows-installer/` 包含两个体积很小的 WPF 程序：

- `Installer/`：欢迎、能力介绍、可滚动发布说明、安装路径、桌面/开始菜单选项、升级识别、进度、完成和错误页。
- `Uninstaller/`：卸载确认、数据保留选择、危险清理二次确认、进度、完成和错误页。
- `BrandShell.cs`：两者复用的色板、无边框窗口、按钮、勾选项、状态标签、截图、命令行转义和进程 watchdog。
- `ModernFolderPicker.cs`：使用现代 Explorer `IFileDialog` 的文件夹选择器，不依赖旧式 WinForms `FolderBrowserDialog`。

界面采用与黄色 Logo 配套的浅暖黄背景、陶土橙强调色和正式 Windows 图标，并以“一键翻译多国语言套图、专属个性配置、跨境电商套图”为核心宣传。所有按钮、间距、文字层级和错误反馈来自同一个组件层，不依赖 Windows 默认向导控件。

公开安装器与卸载器都以单一 EXE 运行，不依赖旁置 `.config` 文件。Windows 文件属性统一显示 `SparkAI WorkSpace`、`namean` 和纯净的发布版本号，不把内部 Git 提交哈希暴露成用户可见产品版本；提交身份仍由 GitHub 版本记录和发布清单追踪。

真实交互安装在内核成功、文件校验完成且可选的应用启动已经交接后，短暂展示完成反馈并自动关闭品牌安装引导窗口，不要求用户再次点击“完成”。失败页继续保留错误与重试入口，取消路径按既有回滚语义退出；`--capture-page=complete` 只用于发布截图，不调度自动关闭。

品牌壳以 920 × 620 设计坐标构建，并根据当前显示器可用工作区等比缩放；文字、图形与控件仍由 WPF 矢量渲染。这样在 1366 × 768 且 125%、150%、200% 缩放的环境下不会越出屏幕，也不会为了适配高 DPI 改回系统向导。

品牌壳目标为 `.NET Framework 4.8`、Windows x64。受支持且保持系统更新的 Windows 10/11 已具备该运行时，因此不需要把独立 Desktop Runtime 重复塞入安装包。当前 1.0.5 正式安装包约 167 MiB；若未来需要支持缺少 .NET Framework 4.8 的裁剪系统，应另行提供运行时预检 bootstrapper，不能静默回退到旧式安装界面。

v1 只允许安装到当前用户可写目录。安装器会在写入前显式拒绝磁盘根目录、Windows、`Program Files` 和其他需要提权的位置，并在品牌错误页要求改用默认位置或个人文件夹；它不会启动 `runas`，因此不会因用户输入另一管理员账户而把 HKCU、快捷方式和卸载注册写到错误账户。检测到已有版本后，安装路径会被锁定，浏览按钮隐藏，命令行传入的其他路径也会被忽略，以保证覆盖更新和失败回滚语义唯一。

### 静默安装内核

electron-builder/NSIS 继续负责成熟且高风险的系统操作：

- 应用压缩和解压；
- 当前用户安装与自定义目录；
- 已有版本检测、覆盖更新和内部旧版本卸载；
- 注册表、桌面和开始菜单快捷方式；
- 应用占用检测及失败返回；
- 生成内部核心卸载器。

公开安装包将 NSIS 安装器作为经过 SHA-256 校验的嵌入资源。品牌安装器仅用 `/S` 调用它，所以不会创建或闪现 MUI 页面。`build/installer.nsh` 将 Windows 卸载注册改为 `SparkAIWorkSpace-uninstaller.exe`；内部 NSIS 卸载器只作为静默删除内核保留。即使用户直接双击内部卸载器，也会在页面创建前转交给品牌卸载器。

安装与卸载内核均由共享 watchdog 观察。首轮超过安全时限后会终止对应进程树并自动重试一次；安装仍失败时，全新安装进入有界回滚，卸载仍失败时保留品牌窗口和日志供用户处理后再次继续，不会无限卡住且禁止关闭。诊断环境可以缩短超时验证恢复与零残留语义，正式运行使用分钟级保守时限。

## 数据安全语义

- 默认卸载只移除程序、快捷方式和注册信息。
- 项目、会话、FastMemory、缓存和图片库默认保留。
- 用户必须主动关闭“保留项目、会话、设置与图片库”才能清理当前账户的应用数据。
- “彻底清理”同时覆盖 Roaming 用户数据与 Local 安装日志；两处路径都经过固定根目录校验，不接受任意删除目标。
- 清理数据还需要进入同一品牌窗口内的第二确认页；不会叠加系统 `MessageBox`。
- 位于用户自行选择的外部目录中的项目不由卸载器删除。
- 覆盖升级始终传递保留数据语义。
- 静默覆盖升级在没有显式快捷方式参数时保留用户现有的桌面/开始菜单选择，不会把此前关闭的快捷方式重新创建。
- 全新安装在提交前取消或失败时不会留下程序文件；安装开始后的安全取消会等待提交结束后调用卸载链路撤销。

卸载器从安装目录启动时会先复制到临时目录，再开始删除，避免运行中的卸载器自身成为最后一个无法清理的文件。升级场景中 electron-builder 已完成同类外移，品牌卸载器会同步等待内部卸载完成。

## 构建链路

`scripts/release/build-windows.mjs` 按以下顺序执行：

1. 发布品牌卸载器到 `.release-tools/brand-uninstaller/`。
2. 让 electron-builder 构建包含品牌卸载器的 NSIS 核心包。
3. 将核心包移入 `.release-tools/brand-installer/` 并计算 SHA-256。
4. 发布品牌安装器，把核心包和哈希嵌入单一 EXE。
5. 根据已构建的接入策略，直接输出 `release/SparkAI-WorkSpace-Unrestricted-Setup-<version>-x64.exe` 或 `release/SparkAI-WorkSpace-SparkAPI-Setup-<version>-x64.exe`。
6. 删除只属于内部 NSIS 核心、与最终 EXE 不匹配的 blockmap。
7. 清除当前版本的旧签名清单、安装包旁置元数据和旧重启 ASAR，强制 `release:manifest` 基于同一轮新产物重新生成；中断构建不会留下一个表面完整、实际哈希错位的发布目录。

electron-builder 的内部核心包使用 `naimage-Core-*`，构建完成后立即移入 `.release-tools/`，不会作为公开制品。公开文件名、双版本构建、下载清单和应用内完整更新共用同一接入策略命名 authority；安装后的主程序为 `SparkAIWorkSpace.exe`。App ID、数据目录和小版本 ASAR 重启更新继续保持升级兼容。

`pnpm run release:manifest` 会分别记录完整安装包和重启更新 ASAR 的大小与 SHA-256，使用项目内发布私钥签署规范化清单，并立即用随客户端打包的 `build/update-public-key.pem` 反向验签。私钥与客户端公钥不匹配时发布会直接失败，不能生成一个客户端必然拒绝的更新清单。完成后同时生成 `SHA256SUMS.txt`，覆盖安装包、重启 ASAR、签名清单和安装包旁置元数据，供 GitHub Release 下载页与人工核验统一使用。

## 自动化验证

```powershell
pnpm run package:win
pnpm run package:installer-ui-smoke
pnpm run package:installer-smoke
```

正式 RC 只有一个权威入口：`pnpm run release:final`。`package:release` 仅是兼容别名，也会进入同一个事务式编排器；不得再手工拼接一条较短的“发布命令”。可先用 `pnpm run release:plan` 查看固定顺序，用 `pnpm run test:release-orchestrator` 验证失败失效和防篡改契约。

编排器严格执行以下顺序：

1. `release:verify`：运行完整源代码、GUI、性能、构建和 bundle 门禁。
2. `package:win`：基于冻结后的唯一工作树重建应用、品牌安装器和品牌卸载器，并主动使旧更新清单失效。
3. `package:smoke`：从 `release/win-unpacked` 验证正式 preload、项目 I/O、图片导入、分层/PSD 与更新桥。
4. `package:installer-smoke`：验证全新安装、同版修复、路径锁定、快捷方式、注册表、watchdog、数据保留/清理和卸载零残留。
5. `test:update`、`test:update-helper`：再次验证签名防篡改、过期完整安装包清理、重启更新健康启动和失败回滚。
6. `release:manifest`：生成 Restart ASAR、signed manifest、安装包 sidecar 与 `SHA256SUMS.txt`。
7. `package:update-e2e`：复制项目内的上一公开版运行夹具，在副本上执行重启更新，确认设置、会话与 FastMemory 保留、目标哈希一致、备份与下载源清理。
8. `release:sha-verify`：重新验签 manifest，逐文件复算 sidecar、Restart ASAR、win-unpacked ASAR 和四行 `SHA256SUMS.txt`，并核对安装包 Windows 元数据。

编排开始前会写入 `release/.naimage-release-incomplete.json` 并清除当前版本旧 manifest、sidecar、Restart ASAR 与校验单。任一步失败、源工作树在执行期间变化或进程收到中断信号，都会再次撤销这些“完整发布”标志并保留失败标记；只有最后一项验签与 SHA 门禁通过才移除标记。更新 E2E 基线通过 `NAIMAGE_RELEASE_BASELINE_EXE` 指定，必须位于项目目录内、版本低于当前 RC，且包含 update helper；编排器会复制后再测试，不修改基线本体。

UI 烟测会生成安装和卸载的欢迎/选项/进度/完成/错误页、危险数据清理确认页，并覆盖 100%、125%、150%、200% 渲染倍率；还会模拟 1366 × 768 工作区的 125%、150%、200% 高 DPI 布局。安装烟测会验证：

- 真实成功分支短暂进入完成态后自动关闭安装引导窗口，同时完成页截图模式仍可稳定取证；

- 中文与空格路径隔离安装；
- 已安装版本的 UI 路径锁定，并拒绝命令行迁移到另一目录；
- `Program Files` 与 Windows 目录拒绝且保持零写入；
- 正式程序启动与运行时桥接；
- 桌面和开始菜单快捷方式；
- Windows 卸载注册通过 PowerShell Registry API 读取，中文路径保持完整，并从 `QuietUninstallString` 真实启动品牌卸载器；
- 同版本覆盖/修复；
- 安装前失败与取消保持零文件；
- 用户取消快捷方式后不创建快捷方式；
- ToggleButton 可通过 Tab/Space 操作，并向 UI Automation 暴露 Toggle Pattern 与可读名称；主按钮支持 Enter，取消/退出按钮支持 Escape，视觉文字与 Automation Name 始终同步；
- 安装器与卸载器的产品名、公司和产品版本元数据一致，卸载窗口的辅助说明不会误写成安装窗口，裸 EXE 在没有旁置配置文件时仍可启动；
- watchdog 可终止无响应进程树、执行恢复重试；双次诊断超时会返回非零并保持全新安装零残留，首轮超时后的真实安装与卸载可恢复完成；
- 品牌卸载器完成后快捷方式和程序目录零残留。
- 默认卸载保留内部项目库，显式清理会删除隔离的管理数据目录，同时不会删除外部项目目录。
- 品牌静默卸载直接执行并返回真实卸载结果：成功为 `0`，用户/诊断取消为 `1223`，失败为非零；不会因临时 UI 外移而提前伪报成功。
- 同版本静默修复会保留此前的快捷方式关闭状态，且仍锁定原安装路径。
- 安装与卸载注册清理后，Windows 卸载项不残留。
- 文件夹选择器可成功创建现代 Explorer `IFileDialog`，且构建中不再引用旧式 `FolderBrowserDialog`。
- 从旧 NSIS `1.0.1` 安装覆盖到品牌安装器 `1.0.2` 时，原路径保持不变、应用资源更新到目标哈希、卸载注册迁移到品牌卸载器，卸载后旧快捷方式和程序文件零残留。

发布前仍需人工查看 `.diagnostics/release/branded-installer-ui-*/` 中的原始截图。自动像素检查只能发现空图、尺寸和明显渲染失败，不能代替视觉审查。

## 当前剩余发布风险

- 当前没有商业 Authenticode 证书，最终 EXE、应用 EXE 和品牌卸载器会显示 `NotSigned`。正式公开分发前应购买并接入代码签名证书。
- WPF 品牌层依赖 Windows 10/11 上的 .NET Framework 4.8；极端裁剪镜像不在当前支持范围。
