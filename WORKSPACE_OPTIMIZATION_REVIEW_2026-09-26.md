# SparkAI WorkSpace 项目上下文与优化审查

- 审查日期：2026-09-26
- 范围：工作区根目录、`sparkai_workspace` 桌面客户端、`sparkai-extension` 扩展服务
- 方式：只读代码与文档审查；未调用真实图片/视频模型，未访问生产部署
- 目标：记录当前架构、已观察事实、优化优先级与验证入口

## 项目上下文

SparkAI WorkSpace 是 Windows Electron 桌面 AI 视觉工作台，维护单项目、单无限画布、项目级 Agent、历史会话、图片/视频成果、图片容器、需求节点、来源关系、受管资产、本地 Agent runtime、FastMemory、模型连接、导入导出、插件和 CLI/MCP 自动化。

`sparkai-extension` 是独立的小型 Node 服务，不是 New API fork。它只负责 Pro 设备 License、兑换码/设备授权，以及可选的异步图片任务包装、状态查询和结果短期保存。用户独立部署的原生 New API 继续负责账号、session、Token、模型、渠道、quota、计费、用量和管理后台。

Electron Main 持有网络、凭据、IPC、项目保存、模型目录、授权和窗口生命周期；Renderer 通过受限 preload bridge 工作；Agent runtime 负责 Prompt、tool loop、compact、steer 和 action 编排；项目目录是 session、受管资产和输出的权威存储；Extension 通过同域扩展路径和现有 Docker network 的内部 DNS 调用原生 New API。

当前明确未验证的边界包括真实图片模型和 Seedance 视频模型、Extension 目标服务器部署、科研 Runner 的真实 R/Python 环境、正式签名与安装 smoke，以及线上 New API、License 和模型服务。

## 当前工作树快照

主 checkout 为 `main`，当前未提交改动主要集中在统一图片生成协议和相关 UI/设置链路：

- `runtime/image-generation/{types,adapters,normalize-response,errors}.cjs`
- `desktop/image-generation-service.cjs`
- `desktop/new-api-client.cjs` 的 Images、multipart 和 async transport
- `ImageModelConfig`、`ImageProtocol`、`ImageGateway`、`ImageTransportMode`
- 模型能力展示、async create/poll/unknown error 元数据和 IPC 脱敏错误字段

## 优化优先级

### P0：统一图片生成跨仓合同

桌面 async transport 当前按 `/v1/images/<endpoint>/async` 创建并轮询 `/v1/images/tasks/:id`；Extension 对外异步路径是 `/v1/image-tasks/*`。应把两者定义为不同 transport adapter，明确 create、poll、download、auth header、body、幂等键、错误状态和 `Retry-After` 语义，不能靠 endpoint 字符串拼接隐含兼容。

`ImageModelConfig` 的归一化在 `src/core.ts`、`electron-main.cjs` 和 `runtime/image-generation/types.cjs` 各有一份，Electron 侧 capabilities 还比 Renderer 侧宽松。建议以一份 JSON Schema 或可共同加载的 CJS/TS schema 为唯一来源，并记录 declared、runtime-verified、inferred 证据、版本和最后验证时间。

完成证据：矩阵化 contract selftest 覆盖 OpenAI JSON/multipart、xAI、Gemini native、New API/Sub2API/Direct、sync/async、401/429/5xx/超时/空 task id/未知状态/结果缺失、两套异步路由和凭据脱敏。

### P0：补齐 async 幂等、恢复和 unknown 状态

为每个 `operationId + requestIndex` 派生稳定幂等键，并在 create 前写入受管 task journal。create 返回不明确时进入 `create-unknown`，只允许显式查询/恢复，不自动重建。poll 使用有上限的指数退避和 `Retry-After`；应用重启时恢复可查询任务，无法恢复的任务保留可解释的 unknown/failed 状态。

完成证据：重复提交、create unknown、重启、poll 429/5xx、Abort、结果缺失和相同 `operationId + requestIndex` 的回归测试；Extension loopback 与桌面测试使用同一幂等样例。

### P0：把模型能力从可配置提升为可证明

`desktop/model-catalog.cjs` 已有 capability profile 和 evidence，但 `imageModelConfigs` 仍允许设置层直接提供 capabilities。建议分开保存上游声明、本地推断、运行验证和用户覆盖；发送前由 Main 根据 adapter capability 做硬校验；能力证据改变后清理旧模型目录缓存。

### P1：收紧图片输入、响应和错误边界

`desktop/image-generation-service.cjs` 支持本地路径和 data URL，并限制单个输入 32 MiB。Main 入口还应校验路径来自当前项目受管资产、明确授权的临时文件或已验证导入副本。错误 DTO 只允许 code/category/status/provider/protocol/gateway/taskId 等脱敏字段，不得透传 provider body、请求头、Base URL、完整 URL、Prompt 或 token。

### P1：继续用一个注册表生成 IPC、CLI、MCP 和文档

当前桌面已有 147 个 invoke handler（144 个 preload、3 个内部 Agent），另有 9 个 receive 和 2 个 send。应统一登记参数、返回 DTO、敏感字段、项目 guard、revision/CAS、幂等性和副作用级别，并在 CI 检查 handler、preload、schema、CLI、MCP 和文档集合相等。

### P1：降低大文件编排成本

当前主要热点约为：`src/main.tsx` 1.47 MB、`agent-runtime.cjs` 399 KB、`electron-main.cjs` 209 KB、`src/core.ts` 221 KB。建议按边界小步抽取 ImageGenerationController、CanvasMutationController、AgentRunController 和 ProjectPersistenceController；先看真实 profile，不要为了 bundle 数字做高风险大重构。

### P1：为 Session 做追加日志与周期压缩路线

Session v5 已有 mutation journal、writer checkpoint、tombstone 和 causal barrier，但仍是整份 JSON。建议保留 v5 读取兼容，新写入先追加有界 mutation log，按 checkpoint 周期压缩为 canonical snapshot，并记录资产索引、任务 journal 和画布布局的大小/耗时。

### P1：把 Extension 从可打包推进到可运行

在目标服务器验证 `docker compose config`、现有 New API network 的 DNS/内部端口、Caddy 路径优先级、SQLite/结果目录/HMAC secret 备份、重启任务语义、旧包回滚、health/License/image-task loopback 和脱敏日志告警。本机没有 Docker 命令，不能用桌面测试代替这项证据。

### P2：授权门控的真实 provider canary 与黄金路径

准备默认关闭的 canary runner，每个 provider/gateway 只允许一条最小授权请求，结果进入隔离项目，create 不明确时保存 unknown，不自动重试。在真实服务验证前，先完成 mock/loopback 和脱敏报告。体验上用“创建项目→导入图片→Agent 编辑→查看来源→导出→重启恢复”作为黄金路径，再分别为电商、社媒、科研定义一个首屏任务。

## 建议执行顺序

1. 统一图片层 contract 和 `ImageModelConfig` schema。
2. 加入 async 幂等、task journal、恢复与错误脱敏。
3. 运行图片生成专项、IPC registration、typecheck 和 production build。
4. 再处理 command registry、能力 evidence、Session profile 和 Extension 部署验收。
5. 最后做授权 provider canary、Seedance 单任务验证和黄金路径 GUI 证据。

## 本次审查限制

- 没有运行测试、production build 或 GUI；本记录不是实现完成证明。
- 没有调用真实 New API、图片模型、视频模型或 License 服务。
- 没有执行 Docker 部署、真实 AppData 迁移、安装/卸载或签名验证。
- 当前主 checkout 的未提交改动保持原样；本记录只描述观察和建议。
