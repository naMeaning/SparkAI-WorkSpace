# 本地开发工具链

工作区自带 Bun、Go 和 .NET SDK。下面的脚本只修改当前 PowerShell 进程的 `PATH` 和本地开发环境变量：不修改系统 `PATH`，不启动服务，也不访问线上服务、生产数据或用户项目数据。

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
| Go | `1.25.1` | `.tools/go` |
| .NET SDK | `9.0.316` | `.tools/dotnet` |

pnpm 命令统一写成 `corepack pnpm ...`，不要依赖机器上另一个全局 pnpm。激活后，Bun、Go、.NET 的缓存/工作目录也指向工作区 `.tools`，不会写入系统级工具目录。

## 诊断

执行完整的本地只读/测试诊断：

```powershell
& .\scripts\diagnose-local-toolchain.ps1
```

它会验证工具版本、`iiimage-studio` 的 pnpm/typecheck、`ai-native` 的 `verify:workspace` 和 `crm:check`。只检查工具时使用：

```powershell
& .\scripts\diagnose-local-toolchain.ps1 -ToolsOnly
```

退出码含义：

- `0`：所检查项目通过，且检测到 New API Web 依赖目录；这仍不等于 Web 构建已通过。
- `1`：工具版本或本地项目检查失败。
- `2`：工具链和已执行检查通过，但 New API Web 依赖仍未完成安装。

## New API Web 的已知限制

当前 Windows 注册表为 `LongPathsEnabled=0`，仓库物理路径较深。New API Web 强制使用 Bun isolated linker，并包含指向 monorepo 契约包的本地 `file:` 依赖。在这个路径下：

- Bun `1.3.14` 未能完成安装；
- Bun `1.2.23` 本体可运行，但兼容安装尝试仍以 postinstall `ENOTCONN` 或无输出挂起结束；
- `web/node_modules` 与 `web/default/node_modules` 当前不存在，`bun.lock` 未修改；
- 因此不能宣称 New API Web 已可构建。

后续应把整个工作区放到更短的物理路径，或在 WSL/Linux 下安装。不要依赖 junction/subst 作为稳定方案；已观察到 Bun 在这类映射路径上的异常。重试前先确认 `LongPathsEnabled`、真实物理路径和 Bun 版本，再执行项目原有的 frozen-lockfile/isolated-linker 安装命令。
