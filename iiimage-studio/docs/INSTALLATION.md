# iiimage Studio 1.0.2 安装说明

## 系统要求

- Windows 10 或 Windows 11，x64。
- 建议至少 8 GB 内存；处理多张 4K 图片或大型画布时建议 16 GB 以上。
- Agent、生图、联网检索和账户功能需要可访问配置服务与模型渠道。

## 安装包

- 文件名：`iiimage-Studio-Setup-1.0.2-x64.exe`
- SHA-256：`61492f24f4ee05e8d0502a5ed8b3199ea51f03314e4999e6142fe87a7e95db4a`
- Authenticode：`NotSigned`
- 精选案例包：`iiimage-Studio-Showcase-1.0.0.zip`
- 案例包 SHA-256：`ae9174b609e6c6322f98244cdff03d2d01b7fda5bbfa05d28e3b4598b08db784`

在 PowerShell 中核对下载文件：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\iiimage-Studio-Setup-1.0.2-x64.exe'
```

当前版本没有商业代码签名证书，Windows 可能显示发布者未知。只应使用官方 Forge 发布的安装包，并在继续安装前确认完整 SHA-256 一致。

Forge Release 同时提供 `SHA256SUMS.txt`。精选案例包包含 33 张真实 Image 2 成果和对应说明，不是程序运行依赖。

## 安装与启动

1. 双击安装包，进入 iiimage Studio 自有的深色品牌安装界面；不会显示旧式 Windows 安装向导。
2. 阅读能力介绍，选择当前用户可写的安装目录，并决定是否创建桌面和开始菜单快捷方式。v1 不允许安装到 Windows、`Program Files` 或其他需要管理员权限的位置。
3. 安装器会校验内部组件，再由隐藏的 NSIS 内核完成安全部署。已有版本会进入更新/修复流程、锁定原安装路径并保留用户数据。
4. 完成后可立即启动，或从快捷方式、开始菜单及安装目录中的 `iiimage Studio.exe` 启动。

品牌界面使用 Windows 10/11 系统自带的 .NET Framework 4.8。当前仅支持保持系统更新的 Windows 10/11 x64，不支持移除了系统 .NET Framework 组件的裁剪镜像。

安装后的用户项目、会话、FastMemory、缓存和图片库位于 Electron 的当前用户数据目录，通常为：

```text
%APPDATA%\iiimage Studio\data
```

工作空间位于同一用户数据根目录下的 `workspace`。程序不会直接修改拖入的原图，而会复制到项目管理目录后再操作。

## 卸载

可从 Windows“已安装的应用”或内部卸载入口打开同风格品牌卸载器。默认勾选“保留项目、会话、设置与图片库”，不会误删创作数据。只有用户明确关闭该选项时，才会清理当前账户下的应用数据；位于其他目录的外部项目始终不会被卸载器删除。

最终安装烟测已验证：中文/空格自定义路径、已安装路径锁定、受保护目录拒绝、正式程序运行、桌面/开始菜单快捷方式、Windows 卸载注册、同版本覆盖修复、失败/取消零写入、快捷方式 opt-out、品牌卸载和安装目录零文件残留。卸载注册使用 Registry API 保留完整中文路径，并会从系统登记的静默卸载入口真实启动品牌卸载器。安装与卸载内核都有有界 watchdog、一次恢复重试和全新安装失败回滚。另已真实验证旧版 `1.0.1` 安装后由 `1.0.2` 覆盖升级：应用 ASAR 被完整替换、安装路径不迁移、卸载注册切换到品牌卸载器，最终程序文件与快捷方式零残留。多 DPI 截图覆盖安装与卸载的欢迎、选项、进度、完成和错误页，并包含 ToggleButton、Enter/Escape、按钮 Automation Name 同步和进程 watchdog 契约验证。架构和验证说明见 [品牌安装器架构](./BRANDED_INSTALLER_ARCHITECTURE.md)。

## 从源码构建

```powershell
pnpm install
pnpm run package:win
pnpm run package:smoke
pnpm run package:installer-smoke
```

上述命令只用于本地构建和分项验证。正式发布必须使用唯一事务入口：

```powershell
$env:IIIMAGE_RELEASE_BASELINE_EXE = (Resolve-Path '.diagnostics\restart-update-e2e\baseline-build\win-unpacked\iiimage Studio.exe').Path
pnpm run release:plan
pnpm run test:release-orchestrator
pnpm run release:final
```

任一步失败时 `release/.iiimage-release-incomplete.json` 会保留，旧 manifest、sidecar、Restart ASAR 和 `SHA256SUMS.txt` 会被撤销；存在该标记的目录不得上传或同步到下载服务器。

安装包输出到 `release/iiimage-Studio-Setup-1.0.2-x64.exe`。
