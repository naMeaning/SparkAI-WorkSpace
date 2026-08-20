# AI Gateway

`@ai-native/ai-gateway` 是 AI 网关服务。它通过 Node 服务入口检查、构建和启动内嵌的 `new-api`。

## 边界

- `server.cjs` 是服务入口。
- `new-api/` 是内嵌上游源码，不拆成单独 workspace 包。
- `new-api/web` 使用 Bun 管理唯一的 `default` 前端工作区。
- `diagnostics/` 是提交到仓库的诊断脚本源码。
- `.diagnostics/` 是诊断运行输出，不提交。

## 脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm --filter @ai-native/ai-gateway dev` | 启动 AI gateway 服务入口。 |
| `pnpm --filter @ai-native/ai-gateway start` | 同 `dev`，用于常规运行。 |
| `pnpm --filter @ai-native/ai-gateway smoke` | 输出 New API 布局和构建产物状态。 |
| `pnpm --filter @ai-native/ai-gateway build:new-api` | 构建内嵌 New API 前端和后端产物。 |
| `pnpm --filter @ai-native/ai-gateway diagnostics` | 运行诊断脚本并生成报告。 |

根目录等价入口：

```bash
pnpm run dev:gateway
pnpm run build:gateway
pnpm run smoke:gateway
pnpm run diagnostics:gateway
```

## 运行时目录

| 路径 | 说明 |
| --- | --- |
| `config/` | AI gateway / New API 本地运行数据。 |
| `.diagnostics/new-api/` | AI gateway 启动 New API 时写入的日志。 |
| `.diagnostics/server-check/` | 诊断脚本生成的报告、JSON 和临时数据。 |
| `new-api/bin/` | New API 后端二进制构建产物。 |
| `new-api/logs/` | New API 运行日志。 |
| `new-api/data/` | New API 本地数据。 |
| `new-api/web/*/dist/` | New API 前端构建产物。 |

这些运行时数据和构建产物不会提交。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 服务端口。 |
| `NAIMAGE_SERVER_PORT` | naimage 使用的服务端口变量，优先级高于 `PORT`。 |
| `AI_GATEWAY_DATA_DIR` | New API 数据目录。 |
| `NAIMAGE_SERVER_DATA_DIR` | naimage 启动器的数据目录变量；优先使用 `AI_GATEWAY_DATA_DIR`。 |
| `NAIMAGE_PARENT_PID` | 父进程 PID，可用于外部进程管理器关联服务生命周期。 |

## 诊断

```bash
pnpm run diagnostics:gateway
```

诊断脚本会检查 New API 布局、服务入口语法、smoke 结果、运行时接口和登录/token 基础契约。报告输出到 `.diagnostics/server-check/`。

如果没有执行过 `build:new-api`，`smoke` 可能显示前端 dist、后端二进制或 vendor 产物未就绪；这是构建产物缺失提示，不代表服务入口失败。

需要补齐构建产物时显式执行：

```bash
pnpm run build:gateway
```
