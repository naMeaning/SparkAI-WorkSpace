# naimage 项目现状与后续改造报告

更新时间：2026-07-24

当前分支：`refactor/modular-boundaries`

最近结构提交：`fe542b8 refactor(runtime): extract controlled shell command domain`

## 结论摘要

当前工作区已经从“功能集中在少数入口文件”推进到“主要跨边界已有明确 owner”的阶段，但目标尚未全部完成。

- `naimage` 品牌、Session Relay 路由、桌面更新路由和项目格式已经切换到当前名称；旧名称只保留在本地迁移、旧项目导入、历史制品和生产物理 ABI 中。
- AIDebug harness、若干 suite、UI façade、图片容器域、Runtime schema/Responses parser/memory、New API transport、项目持久化和 IPC registrar 已经完成第一轮拆分。
- 当前仍最重的是 `src/main.tsx`、`scripts/aidebug-gui.mjs`、`agent-runtime.cjs`、`electron-main.cjs`；下一批应优先做不进入新 chunk 的纯计算域和 AIDebug suite 拆分。
- 账号登录和内置模型调用主链路已具备；自定义中转站/自定义大模型与图片模型在底层有配置字段，但 Electron 的真实请求出口仍被 Session Relay 固定回调绕过，尚不能算完整产品能力。
- CRM Web workspace 已移除，但 CRM API、共享 contracts、New API `/api/crm/*` proxy、MySQL、Compose 和部署逻辑仍存在；按用户要求，后续应单独删除，不能与登录改造混批。

## 一、两个项目分别是什么

### 1. `naimage-studio/`

Windows 桌面 AI 图片工作台，核心是一个 Electron + React 的无限画布应用。它负责：

- 账户登录、Session cookie 和 `New-Api-User` 会话桥接；
- Agent 对话、Responses/Chat 流式事件、工具时间线和 TaskScope；
- `image_gen` 的生成、编辑、替换、变体、分层、抠图和区域重绘；
- 图片成果节点、图片容器、分组、溯源关系、需求节点和结果布局；
- 项目目录、session、manifest、资产索引、缩略图、项目包导入导出；
- PNG/PSD 等输出、图片查看器、图层编辑和本地图片导入；
- 签名更新、重启更新、安装器和回滚；
- AIDebug GUI、视觉快照、性能、图片恢复、导入和登录场景验证。

主要技术栈：Electron 42、React 18、TypeScript、Vite 8、Node.js/CommonJS、Sharp、PNGJS、OpenCV.js，以及少量 .NET Windows 工具。

### 2. `ai-native/`

统一后端与运营 monorepo，公开入口是 `services/ai-gateway`，内嵌 QuantumNous New API 源码。它负责：

- 注册、登录、Cookie/JWT/session、用户、角色、额度和用量；
- OpenAI-compatible Chat/Responses/Image relay、渠道选择和计费；
- `naimage` 的 Session Relay 托管 Token 入口；
- Web GUI、模型目录、管理员设置、订阅/余额等 New API 功能；
- 桌面安装包下载授权、更新检查、验证码和发布清单验签；
- Docker Compose、Caddy、systemd、备份和部署校验；
- 仍待删除的内部 CRM API、CRM contracts、MySQL 和 `/api/crm/*` 代理。

主要技术栈：Node.js/pnpm workspace、Go 1.25 + Gin + GORM、SQLite/MySQL/PostgreSQL/Redis、React 19 + TypeScript + Rsbuild/TanStack/Tailwind、Bun Web workspace、Docker/Caddy/systemd。

## 二、跨项目请求链路

```text
桌面登录
  → New API /api/user/login
  → session cookie + New-Api-User
  → 本地受限 bridge

Agent 文本
  → Electron Agent runtime
  → /naimage/v1/chat/completions 或 /naimage/v1/responses
  → New API UserAuth + ManagedRelayTokenAuth
  → 上游模型渠道

图片任务
  → /naimage/v1/images/generations 或 /naimage/v1/images/edits
  → 计费/幂等/渠道 relay
  → 项目 output 资产
  → Renderer workflow action

桌面更新
  → /api/desktop-update/*
  → signed manifest / ticket / hash / helper
  → 安全重启或安装器
```

当前 canonical 对外入口：

- `/naimage/v1/models`
- `/naimage/v1/chat/completions`
- `/naimage/v1/responses`
- `/naimage/v1/images/generations`
- `/naimage/v1/images/edits`
- `/downloads/naimage-studio/windows`

普通 New API 的 `/v1/*` Token Relay 仍保留；`/iiimage/v1/*` 不再注册为当前网络路由。

## 三、长期目标完成矩阵

| 目标 | 当前状态 | 证据/说明 |
| --- | --- | --- |
| 建立版本控制基线 | 已完成 | 分支 `refactor/modular-boundaries`，每批独立 commit |
| `iiimage` → `naimage` 品牌与 canonical 路由 | 基本完成 | `package.json`、App ID、EXE、IPC、项目格式、资源协议、`/naimage/v1/*` 已切换；旧本地数据和历史签名保留只读兼容 |
| AIDebug 公共 harness | 第一轮完成 | `scripts/aidebug/harness/{cdp,png,process,reporting,screenshot,state-snapshot}.mjs` 已有明确 owner |
| AIDebug suite 拆分 | 部分完成 | image-generation、layer-editing、performance、selection-command、ui-surface 已独立；auth/image-import/canvas-clarity/context-menu 等仍在入口内联 |
| `ui.tsx` 拆分 | 已完成 | `src/ui.tsx` 是 57 行兼容 façade，真实实现位于 `src/ui/*` |
| image-container / task-result-layout ownership | 第一轮完成 | `image-container.ts` 仅 façade；spec、graph、layout 各自拥有持久化/拓扑/TaskScope 结果规划 |
| Renderer 图片几何域拆分 | 未完成 | 约 320 行纯几何/展示计算仍在 `src/main.tsx`，适合下一批抽到 `src/image-node-geometry.ts` |
| styles/07 拆分 | 结构完成，审计未完成 | 入口已拆为 `07a`–`07i`；仍需审计重复覆盖，不能盲目继续切文件 |
| Electron AIDebug backend | owner 已建立 | `desktop/aidebug-backend.cjs`，仍有约 940 行，后续可按报告/fixture/进程边界继续拆 |
| Electron Updater | owner 已建立 | `desktop/updater-service.cjs`，仍有约 1,220 行，更新协议应保持单 owner |
| Runtime schema / Responses parser / memory | 已完成第一轮 | `runtime/tool-schemas.cjs`、`responses-parser.cjs`、`memory-store.cjs`；本批新增 `controlled-shell-command.cjs` |
| New API transport | 已完成第一轮 | `desktop/new-api-transport.cjs` + `new-api-client.cjs`，支持 account/relay/update 分离 |
| 项目持久化 | 已完成第一轮 | project-store、session-normalizer、asset-repository、package-service、save-coordinator 已有独立 owner |
| IPC 注册层 | 已完成第一轮 | 9 个 registrar，当前约 69 handlers / 66 preload invokes |
| CRM UI 删除 | 已完成部分 | 独立 CRM Web workspace/profile enrichment 已移除；New API Web 中无 CRM UI 文件 |
| CRM 后端/数据库/代理删除 | 未完成 | `services/crm-api`、`packages/crm-contracts`、`/api/crm/*`、Compose/MySQL/备份仍在 |
| 账号登录 | 主链路可用，需真实站点验证 | 默认账户地址为 `https://sparkapi.org`；本地 contract/AIDebug 通过，尚未使用真实账号访问线上站点 |
| 自定义中转站/自定义模型来源 | 未完成产品化 | 配置字段存在，但 Electron 实际请求仍固定注入 Session Relay 回调 |

## 四、当前重文件与推荐拆分

| 文件 | 当前规模 | 判断 | 推荐动作 |
| --- | ---: | --- | --- |
| `src/main.tsx` | 22,610 行 / 1.13 MB | 仍是最大热点 | 先抽纯图片几何/展示计算到 `src/image-node-geometry.ts`；静态导入，不进 manualChunks |
| `scripts/aidebug-gui.mjs` | 9,815 行 / 497 KB | suite 编排和部分场景仍内联 | 抽 auth-gate、image-import、canvas-clarity 等完整 suite，保持 factory injection |
| `scripts/aidebug/harness/state-snapshot.mjs` | 3,404 行 / 200 KB | snapshot 域已独立但仍偏大 | 下一步按 DOM/geometry/accessibility/canvas 证据域审计，暂不重复拆通用表达式 |
| `agent-runtime.cjs` | 5,563 行 / 285 KB | 已降约 220 行 | 继续沿 TaskScope、图片请求预处理、协议循环边界拆；不要把 schema/parser/memory 重新内联 |
| `electron-main.cjs` | 3,446 行 / 135 KB | service 装配和图片/账户编排仍集中 | 后续抽图片导出/账户路由选择域，保留 Main 作为装配 façade |
| `runtime/memory-store.cjs` | 1,487 行 / 63 KB | owner 清晰，暂不盲拆 | 只有出现明确持久化子域时再拆 |
| `desktop/updater-service.cjs` | 1,220 行 / 53 KB | 协议完整但偏重 | 按 manifest、download ticket、restart/rollback 三个稳定边界审计 |
| `desktop/aidebug-backend.cjs` | 940 行 / 42 KB | 可按诊断 backend/fixture/IPC 继续拆 | 先保证 AIDebug report schema 不变 |
| `desktop/ipc/asset-ipc.cjs` | 604 行 / 27 KB | handler 数较多 | 按 asset read/import/export 与 output 写入边界审计 |

Styles 方面，`07a`–`07i` 已按职责分片；更值得审计的是 `01-base-controls.css`、`02-canvas-workspace.css`、`04-dialogs-viewers.css` 的重复覆盖。任何样式改动都必须保持 01→08 以及 07a→07i 的 import 顺序。

## 五、登录与自定义渠道审计结论

### 已经可用

- 账户服务默认配置为 `https://sparkapi.org`。
- 注册、登录、读取用户信息、模型列表和 Electron session 保存链路已存在。
- Electron 保存 session cookie 与 `New-Api-User`，托管 relay token 不暴露到客户端。
- `relayBaseUrl` 为空时继承 `accountBaseUrl`，`updateBaseUrl` 可独立配置。
- Session Relay 经过 `UserAuth` 与 `ManagedRelayTokenAuth`，服务端负责选择托管 Token。

### 必须先修的缺口

1. **退出登录方法不一致**：后端注册 `GET /api/user/logout`，但 `desktop/ipc/server-ipc.cjs` 和 `src/server.ts` 发送 POST，导致远端 session 可能仍然有效。
2. **设置 UI 没有暴露三地址**：设置抽屉尚未提供 `accountBaseUrl`、`relayBaseUrl`、`updateBaseUrl` 的输入和校验。
3. **CUSTOM 出口被绕过**：Electron 创建 runtime 时固定注入 `serverChatCompletion`/`serverGenerateImage`，`agentBaseUrl`、`agentApiKey`、`imageBaseUrl`、`imageApiKey` 当前不会真正决定出口。
4. **浏览器 fallback 不支持异源 relay cookie**：异源请求使用 `same-origin`，浏览器不能主动设置 Cookie；应改为同源代理或明确禁用该路径。
5. **异源 Relay 需要明确授权**：账户 cookie 不能静默发送到任意自定义域；应有 HTTPS、域名信任确认、清晰提示和凭据隔离。
6. **更新发布清单需要重新签名**：仓内冻结的 1.0.4 `iiimage-studio` manifest 不能直接替换字符串；必须生成并签名新的 `naimage-studio` manifest 与制品。

## 六、推荐后续修改顺序

### P0：先完成登录可验证闭环

1. 修正 logout 方法并补客户端—后端 method/path contract test。
2. 在本地隔离环境用测试账号验证：登录、刷新、读取用户、模型列表、登出、再次登录。
3. 再验证一次真实 Session Relay 的 Chat/Responses 和图片接口；不要使用生产用户数据。
4. 在设置 UI 暴露三个服务地址，并明确显示当前出口：内置 Session Relay 或自定义渠道。

### P1：完成自定义模型来源

1. 抽出统一 `ProviderRoute`/`ModelSource` 解析，区分账户认证、Agent 文本、图片模型和更新服务。
2. Session Relay 模式只发送 session/user header；CUSTOM 模式只发送用户明确配置的 API key，不混发账户 cookie。
3. 模型目录按 `accountBaseUrl + relayBaseUrl + provider + user` 隔离缓存。
4. 对 Chat、Responses、Images 分别做 capability 校验和错误分类；不把图片模型失败静默降级到旧模型。
5. 为自定义 relay 增加域名信任确认、HTTPS 校验和“凭据将发往该域名”的 UI 文案。

### P2：继续拆重代码

1. `src/image-node-geometry.ts`：抽出约 320 行纯计算，静态导入，跑 `typecheck`、`test:image-layout`、`test:image-container`、`build`、`test:bundle`、`aidebug:canvas-clarity`、`aidebug:gui`。
2. AIDebug：分别抽 `auth-gate.mjs`、`image-import.mjs`、`canvas-clarity.mjs`，每个用 dependency injection，不让 suite 反向读取主入口变量。
3. `agent-runtime.cjs`：受控 Shell 已完成；下一批可考虑 TaskScope 纯域或图片请求预处理域。
4. `electron-main.cjs`：按账户/图片请求出口或资产导出边界继续拆，保持 Main 只做装配。
5. Styles：先做 selector 覆盖审计，再决定是否拆 01/02/04；不抬高 Bundle 门禁。

### P3：最后删除 CRM

按用户的明确边界，删除顺序应为：

1. `services/crm-api` 与 `packages/crm-contracts`；
2. New API `/api/crm/*` proxy、HMAC trust 和 CRM DTO；
3. Compose、MySQL、备份/恢复、部署和 workspace scripts；
4. CRM 文档、诊断和环境变量；
5. 保留 New API 的账号、session、quota、模型目录、计费和用量日志。

CRM 删除必须单独提交，不能和登录、自定义模型出口或 Renderer 拆分混在一起。

## 七、当前验证证据

本轮已通过：

- `corepack pnpm run typecheck`
- `corepack pnpm run build`
- `corepack pnpm run test:bundle`
  - initial JS：596,198 / 600,000 B
  - total JS：651,967 / 652,000 B（余 33 B）
- `corepack pnpm run test:controlled-shell-command`
- `corepack pnpm run test:agent-text`
- `corepack pnpm run test:agent-protocol`
- `corepack pnpm run test:settings-persistence`
- `corepack pnpm run test:project-io`
- `corepack pnpm run test:update`
- `corepack pnpm run test:new-api-transport`
- `corepack pnpm run aidebug:gui`（`failures: []`，品牌截图显示 `naimage`）
- New API：`go test ./router ./controller ./model`
- `ai-native`：`verify:workspace` 与 backend build
- New API Web：Bun typecheck/build

尚未完成的验证：真实 `https://sparkapi.org` 账号登录、远端 logout、真实自定义 relay 凭据隔离和重新签名后的线上更新制品。这些需要在用户提供测试账号/测试窗口后执行，当前没有访问线上服务或生产数据。
