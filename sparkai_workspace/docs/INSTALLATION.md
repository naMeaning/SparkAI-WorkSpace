# SparkAI WorkSpace 安装说明

## 系统要求

- Windows 10 或 Windows 11，x64。
- 建议至少 8 GB 内存；处理多张 4K 图片或大型画布时建议 16 GB 以上。
- Agent、生图、联网检索和账户功能需要可访问配置服务与模型渠道。

## 安装包

- Unrestricted 文件名：`SparkAI-WorkSpace-Unrestricted-Setup-<version>-x64.exe`
- SparkAPI 账号专用文件名：`SparkAI-WorkSpace-SparkAPI-Setup-<version>-x64.exe`
- 主程序：`SparkAIWorkSpace.exe`
- Authenticode：当前构建为 `NotSigned`
- 完整性校验：以同一发布页的 `SHA256SUMS.txt` 和安装包旁置元数据为准

在 PowerShell 中核对下载文件：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\SparkAI-WorkSpace-Unrestricted-Setup-<version>-x64.exe'
```

当前版本没有商业代码签名证书，Windows 可能显示发布者未知。实际发布项目/GitHub Release 展示名为 `SparkAI-WorkSpace`。只应使用受信发布源提供的安装包，并在继续安装前确认完整 SHA-256 与同一发布页的 `SHA256SUMS.txt` 一致。旧版本的真实文件名、哈希与验收结论保留在 `RELEASE_*.md`，不得把旧哈希套用到新品牌制品。

当前仓库测试安装包（2026-09-27，源码版本 `1.0.9`；`bundleEnforced: false`，不是正式 Release）：

| 安装包 | 大小 | SHA-256 |
| --- | --- | --- |
| `release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe` | 109,803,520 | `407CFF0FD9DA7BCE3EBDBA8DD434168B74EC601FE3F85F93F2653D43437A8077` |
| `release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe` | 109,803,520 | `79D8C832D3B88E6918DAC210F79626A5EAC91CC307B81C6CE9D73CDD14A48509` |

一般自己使用 Unrestricted。这是测试开发包，没有商业代码签名，也未做真实安装/卸载 smoke；构建保留既有大 chunk、.NET nullable、NuGet 漏洞源不可访问和 Node 子进程 deprecation 警告。`release/` 不再保留 1.0.7/1.0.8 或旧 `naimage-Setup-*` 公开命名。

## 安装与启动

1. 双击安装包，进入 SparkAI WorkSpace 自有的透明玻璃品牌安装界面；不会显示旧式 Windows 安装向导。
2. 阅读能力介绍，选择当前用户可写的安装目录，并决定是否创建桌面和开始菜单快捷方式。v1 不允许安装到 Windows、`Program Files` 或其他需要管理员权限的位置。
3. 安装器会校验内部组件，再由隐藏的 NSIS 内核完成安全部署。已有版本会进入更新/修复流程、锁定原安装路径并保留用户数据。
4. 完成后可立即启动，或从快捷方式、开始菜单及安装目录中的 `SparkAIWorkSpace.exe` 启动。

品牌界面使用 Windows 10/11 系统自带的 .NET Framework 4.8。当前仅支持保持系统更新的 Windows 10/11 x64，不支持移除了系统 .NET Framework 组件的裁剪镜像。

安装后的用户项目、会话、FastMemory、缓存和图片库位于 Electron 的当前用户数据目录，通常为：

```text
%APPDATA%\naimage\data
```

工作空间位于同一用户数据根目录下的 `workspace`。程序不会直接修改拖入的原图，而会复制到项目管理目录后再操作。

首次启动 `naimage` 时，程序会检查更名前的 `%APPDATA%\iiimage Studio` 用户目录。它只把旧 `data/`、`workspace/` 和应用 `Local Storage/` 中目标位置尚不存在的普通文件复制到 `%APPDATA%\naimage`，不覆盖新数据、不移动或删除旧数据，也不跟随符号链接。`Local Storage/` 用于保留浏览器回退设置与生图统计；迁移完成后会在新目录写入一次性标记。

## 卸载

可从 Windows“已安装的应用”或内部卸载入口打开同风格品牌卸载器。默认勾选“保留项目、会话、设置与图片库”，不会误删创作数据。只有用户明确关闭该选项时，才会清理当前账户下的应用数据；位于其他目录的外部项目始终不会被卸载器删除。

安装烟测覆盖中文/空格自定义路径、已安装路径锁定、受保护目录拒绝、正式程序运行、桌面/开始菜单快捷方式、Windows 卸载注册、同版本覆盖修复、失败/取消零写入、快捷方式 opt-out、品牌卸载和安装目录零文件残留。卸载注册使用 Registry API 保留完整中文路径，并会从系统登记的静默卸载入口真实启动品牌卸载器。安装与卸载内核都有有界 watchdog、一次恢复重试和全新安装失败回滚。多 DPI 截图覆盖安装与卸载的欢迎、选项、进度、完成和错误页，并包含 ToggleButton、Enter/Escape、按钮 Automation Name 同步和进程 watchdog 契约验证。架构和验证说明见 [品牌安装器架构](./BRANDED_INSTALLER_ARCHITECTURE.md)。

## 从源码构建

```powershell
corepack pnpm install
corepack pnpm run package:win
corepack pnpm run package:smoke
corepack pnpm run package:installer-smoke
```

上述命令只用于本地构建和分项验证。正式发布必须使用唯一事务入口：

升级 E2E 应使用上一正式版安装目录中的主程序作为基线。当前公开制品是 SparkAI WorkSpace 1.0.9，主程序为 `SparkAIWorkSpace.exe`。

```powershell
$env:NAIMAGE_RELEASE_BASELINE_EXE = (Resolve-Path '.diagnostics\restart-update-e2e\baseline-1.0.6\win-unpacked\naimage.exe').Path
corepack pnpm run release:plan
corepack pnpm run test:release-orchestrator
corepack pnpm run release:final
```

任一步失败时 `release/.naimage-release-incomplete.json` 会保留，当前版本 manifest、sidecar、Restart ASAR 和 `SHA256SUMS.txt` 会被撤销；存在该标记的目录不得上传或同步到下载服务器。

默认安装包输出到 `release/SparkAI-WorkSpace-Unrestricted-Setup-<version>-x64.exe`；双版本入口还会生成 `release/SparkAI-WorkSpace-SparkAPI-Setup-<version>-x64.exe`。重启更新继续使用内部兼容名 `release/naimage-Restart-Update-<version>-x64.asar`。
