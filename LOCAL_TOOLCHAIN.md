# 本地开发工具链与发布入口

本文以当前代码为准，记录 Windows 开发机上能复现的工具链、作用范围和发布前置条件。工具默认安装到工作区的 `.tools/`（该目录已被 `.gitignore` 忽略），激活只修改当前 PowerShell 进程，不写系统 `PATH`，不启动服务，也不访问线上业务数据。

## 项目实际需要什么

| 工具 | 当前代码用途 | 版本/状态（2026-09-20 只读检查） |
| --- | --- | --- |
| Node.js | Electron、Vite、桌面端和 Extension 的全部脚本 | `v24.19.0`；满足桌面/根脚本 `>=22.12.0` 与活跃 Extension 服务 `>=24.0.0` |
| TypeScript | 桌面 Renderer 类型检查和构建；不是独立运行时 | 随 `sparkai_workspace` 锁文件安装，使用 `corepack pnpm`，不要依赖全局 `tsc` |
| pnpm/Corepack | 两个项目的锁文件安装、测试、构建和发布编排 | 项目固定 `pnpm@10.12.1`；必须在项目目录执行 `corepack pnpm ...` |
| Go | 仅用于历史 New API 源码的 Go 测试/审计；当前活跃 Extension 是 Node 服务，不依赖 Go | 便携 `go1.25.1 windows/amd64` 已安装并验证 |
| Bun | 仅用于历史 New API Web 审计；当前活跃 Extension 不依赖 Bun | 便携 `1.3.14` 已安装并验证 |
| .NET SDK | Windows 品牌安装器、开发启动器和正式桌面发布 | 便携 `9.0.316` 已安装并验证 |
| GitHub CLI (`gh`) | 在已有 Git checkout 中创建/上传 GitHub Release | 便携 `2.96.0` 已安装；`gh auth status` 显示当前未登录，没有在本次任务中登录或推送 |
| Docker Desktop / Compose | 仅用于 `sparkai-extension/deploy/sparkai-extension` 的容器部署和 Caddy/网络联调；本地 Node 测试不依赖它 | 当前会话未发现 `docker` 命令，未安装/未验证；不能把本地静态检查当成部署证据 |
| Python | 科研绘图 Runner 在用户明确选择 Python 时通过 `python` 或 `NAIMAGE_SCIENTIFIC_PYTHON` 启动 | 当前会话只解析到 WindowsApps stub，未把可执行 Python 解释器作为已验证事实；需用真实路径复核 |
| R/Rscript | 科研绘图 Runner 的可选 R 后端 | 未验证；缺失时只能报告运行时不可用，不能静默切换 Python |

应用代码的关键事实：`sparkai_workspace/package.json` 是 Electron + React + TypeScript/Vite 桌面端，当前版本 `1.0.9`；`sparkai-extension/services/sparkai-extension` 是 Node 24 + `node:sqlite` 的独立服务，当前版本 `0.2.1`。`sparkai-extension/services/ai-gateway/new-api` 和其 Web 目录属于历史清理输入，不是活跃 Extension 的启动依赖。

## 安装/激活

首次准备或补齐便携工具：

```powershell
& .\scripts\bootstrap-local-toolchain.ps1
```

脚本只下载并校验固定版本的 Go、Bun、.NET SDK 和 GitHub CLI；下载文件的官方 SHA-256/SHA-512 在脚本中固定，工具落在 `.tools/`。如果只先配置 Go/Bun/gh、暂不下载约 284 MiB 的 .NET SDK，可以显式执行：

```powershell
& .\scripts\bootstrap-local-toolchain.ps1 -SkipDotnet
```

每个新的 PowerShell 会话都要重新激活：

```powershell
& .\scripts\activate-local-toolchain.ps1
```

激活后的 Go 环境变量为工作区内路径：`GOROOT=.tools/go-1.25.1-complete/go`、`GOPATH=.tools/go-work`、`GOMODCACHE=.tools/go-mod-cache`、`GOCACHE=.tools/go-build-cache`，并固定 `GOTOOLCHAIN=local`。脚本不会改系统级 PATH。

正式 Windows 打包前要求所有发布工具存在：

```powershell
& .\scripts\activate-local-toolchain.ps1 -RequireReleaseTools
```

缺少 .NET 时该命令会明确失败；不要用系统中另一个 SDK 混合构建，以免改变安装器指纹。

## 诊断

只检查工具版本（不运行项目测试）：

```powershell
& .\scripts\diagnose-local-toolchain.ps1 -ToolsOnly
```

检查活动项目的最小路径（会运行桌面 `typecheck`、Extension `verify:workspace` 和 `check`）：

```powershell
& .\scripts\diagnose-local-toolchain.ps1
```

正式发布前加严为：

```powershell
& .\scripts\diagnose-local-toolchain.ps1 -RequireReleaseTools
```

诊断把 Bun、Go、.NET、gh 作为可报告的工具项；只有 `-RequireReleaseTools` 才会因发布工具缺失硬失败。历史 New API Web 依赖目录缺失不会再阻塞活跃 Extension，因为应用根脚本和部署包不依赖那棵树。Windows 当前 `LongPathsEnabled=0`，深路径安装历史 Web 依赖时应使用更短 checkout 路径或 WSL/Linux。

Python 需单独确认：

```powershell
Get-Command python -All
python --version
```

若结果仍是 `C:\Users\...\WindowsApps\python.exe` stub，请把真实 Python 安装目录加入当前会话 PATH，或设置 `NAIMAGE_SCIENTIFIC_PYTHON` 为真实 `python.exe`；不要把 Python 路径写进项目配置或提交到仓库。

## 从冻结源码到 Release

发布名决策（2026-09-20）：

- 发布项目/GitHub Release 展示名统一使用 **`SparkAI-WorkSpace`**。
- 应用内用户可见名称继续以代码中的 **`SparkAI WorkSpace`** 为准；不要因此改动 `appId=org.sparkai.naimage`、`executableName=SparkAIWorkSpace`、`naimage-studio` 更新 product、协议或用户数据目录，这些是升级兼容 ABI。
- 当前 Windows 安装包代码生成的 canonical 文件名是 `SparkAI-WorkSpace-Unrestricted-Setup-<version>-x64.exe`；SparkAPI 变体为 `SparkAI-WorkSpace-SparkAPI-Setup-<version>-x64.exe`。Restart ASAR 仍必须保留 `naimage-Restart-Update-<version>-x64.asar`。

桌面正式发布顺序由 `sparkai_workspace/docs/RELEASE_CHECKLIST.md` 和 `scripts/release/windows-release-orchestrator.mjs` 共同定义：

1. 在有 Git 元数据的真实 checkout 中确认版本、最低升级版本、release notes、`docs/RELEASE_<version>.md`、文档索引和上下文地图都已进入冻结提交；工作树必须干净。
2. 激活工具链并确认 `.NET SDK 9.0.316`、项目 pin 的 pnpm 和发布私钥/公钥边界满足要求。私钥不得进仓库、命令行、日志或服务器。
3. 在 `sparkai_workspace/` 运行 `corepack pnpm run release:final`。该编排会依次执行 release verify、Vite/Bundle 门禁、Windows NSIS 与品牌 UI、打包 smoke、安装/卸载 smoke、更新 helper、签名 manifest、Restart ASAR、哈希交叉校验和必要的升级 E2E。任何一步失败都不能把旧制品当作新 Release。
4. 读取同一次运行生成的报告、`release/SHA256SUMS.txt`、Setup/Restart ASAR/manifest/sidecar；未签名或未通过正式门禁的测试包只能留在本地诊断目录。
5. 经用户明确授权后，在真实 checkout 中推送冻结提交和版本 tag，再用已登录的 `gh` 创建 GitHub Release。命令模板（先核对远端和版本，勿在本快照中执行）：

   ```powershell
   git status --short --branch
   git remote -v
   git push origin <冻结分支>
   git tag -a v<version> -m "SparkAI-WorkSpace v<version>"
   git push origin v<version>
   gh release create v<version> --repo <owner>/SparkAI-WorkSpace `
     --title "SparkAI-WorkSpace v<version>" `
     release/SparkAI-WorkSpace-Unrestricted-Setup-<version>-x64.exe `
     release/naimage-Restart-Update-<version>-x64.asar `
     release/desktop-release.json `
     release/SparkAI-WorkSpace-Unrestricted-Setup-<version>-x64.exe.json `
     release/SHA256SUMS.txt
   ```

   实际资产清单以 `release:final` 报告和 manifest 为准；不要上传私钥、`.env`、用户数据、incomplete marker 或旧命名制品。

本工作区当前只是文件快照，根目录和两个项目目录都没有 `.git`，因此本次没有创建 commit、tag、远端 push 或 GitHub Release；上述流程是可执行的发布说明，不是已完成的发布证据。工具链诊断已通过；项目依赖安装、正式 `release:final` 和发布制品仍未在本次任务中执行。

本次已实际验证：`diagnose-local-toolchain.ps1 -RequireReleaseTools` 通过；桌面 `corepack pnpm run typecheck`、`corepack pnpm run build`（1676 modules）、Extension `verify:workspace`/`check`（9 tests）、`test:release-orchestrator` 和 `release:plan` 通过。`release:final`、NSIS/安装卸载 smoke、签名制品、真实模型/License/生产部署和 GitHub push 仍未执行。
