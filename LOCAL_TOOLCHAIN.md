# 本地开发工具链

工作区自带 Bun、Go、.NET SDK 和 GitHub CLI。下面的脚本只修改当前 PowerShell 进程的 `PATH` 和本地开发环境变量：不修改系统 `PATH`，不启动服务，也不访问线上服务、生产数据或用户项目数据。

两个项目的职责、技术栈和跨仓修改导航见 [WORKSPACE_CONTEXT_MAP.md](./WORKSPACE_CONTEXT_MAP.md)。

## 激活

在工作区根目录执行：

```powershell
& .\scripts\activate-local-toolchain.ps1
```

默认选择 Bun `1.3.14`。若要复现兼容性排查，可显式选择 Bun `1.2.23`：

```powershell
& .\scripts\activate-local-toolchain.ps1 -BunVersion 1.2.23
```

当前固定/验证版本：

| 工具 | 版本 | 来源 |
| --- | --- | --- |
| Node.js | `24.15.0` | 当前机器 Node；项目要求 `>=22.12.0` |
| pnpm | `10.12.1` | Corepack 和两个项目的 `packageManager` 字段 |
| Bun | `1.3.14`（默认）/ `1.2.23`（兼容尝试） | `.tools` 便携二进制 |
| Go | `1.25.1` | `.tools/go-1.25.1-complete/go`（激活脚本会校验标准库与编译器完整性后选择） |
| .NET SDK | `9.0.316` | `.tools/dotnet` |
| GitHub CLI | `2.96.0` | `.tools/gh-2.96.0` 便携版；登录凭据由 Windows 凭据存储保管 |

pnpm 命令统一写成 `corepack pnpm ...`，不要依赖机器上另一个全局 pnpm。激活后，Bun、Go、.NET 的缓存/工作目录也指向工作区 `.tools`，不会写入系统级工具目录。GitHub CLI 可直接使用 `gh`；当前已登录 `naMeaning`，网络访问继续通过命令级 `HTTP_PROXY`/`HTTPS_PROXY` 使用 Clash `127.0.0.1:7897`，不修改 Git 全局代理配置。

## 诊断

执行完整的本地只读/测试诊断：

```powershell
& .\scripts\diagnose-local-toolchain.ps1
```

它会验证工具版本、`naimage-studio` 的 pnpm/typecheck、`ai-native` 的 `verify:workspace` 和 `crm:check`。只检查工具时使用：

```powershell
& .\scripts\diagnose-local-toolchain.ps1 -ToolsOnly
```

退出码含义：

- `0`：所检查项目通过，且检测到 New API Web 依赖目录；诊断脚本本身不执行 Web 构建。
- `1`：工具版本或本地项目检查失败。
- `2`：工具链和已执行检查通过，但 New API Web 依赖仍未完成安装。

## New API Web

当前工作区已使用 Bun `1.3.14` 完成依赖安装，并通过 `bun run typecheck` 与 `bun run build`。诊断脚本只检查依赖目录，不会替代这两项验证；修改 New API Web 后应在 `ai-native/services/ai-gateway/new-api/web/default` 中显式执行它们。

本机 `LongPathsEnabled=0`，且仓库物理路径较深。重新安装依赖时仍应使用工作区工具链并从 `ai-native/services/ai-gateway/new-api/web` 执行 `bun install --frozen-lockfile`；若再次出现路径相关错误，优先改用较短的物理检出路径或 WSL/Linux，不把 junction/subst 当作稳定发布方案。
