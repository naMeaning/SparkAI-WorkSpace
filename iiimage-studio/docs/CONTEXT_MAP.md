# IIIMAGE STUDIO 上下文地图

> 地图版本：2  
> 最近同步：2026-07-23
> 对应桌面版本：1.0.4  
> 适用范围：Windows Electron 客户端、本地单 Agent runtime、项目文件与发布链路

本文是面向开发者和 Agent 的当前实现导航。它回答“能力归谁所有、从哪里进入、跨越哪些边界、修改后验证什么”。产品方向仍以根目录 `PRODUCT_INTENT.md` 为准，强制编码约束以根目录 `AGENTS.md` 为准；日期开头的计划和审计文档只用于追溯历史。

## 1. 文档权威顺序与维护规则

发生冲突时按以下顺序判断：

1. `PRODUCT_INTENT.md`：当前产品意图、允许能力和明确废弃项。
2. `AGENTS.md`：实现、安全、验证和本文档维护约束。
3. `docs/CONTEXT_MAP.md`：当前进程、模块、契约、状态和测试导航。
4. 当前代码与测试：实现事实。
5. `docs/YYYY-MM-DD_*.md`、release note 和 history：历史背景，不是恢复旧实现的依据。

以下变化必须在同一批改动中更新本文：

- 新增、删除、移动模块，或改变模块所有权。
- 新增、删除、重命名公共导出符号。
- 改变 preload bridge、IPC、远端 API、Agent tool schema 或 runtime action schema。
- 改变项目 session、manifest、资产身份、FastMemory、SQLite 或更新清单格式。
- 新增、删除、重命名测试命令或发布入口。
- 改变本节列出的镜像实现、不变量或跨仓契约。

检索时优先使用文件路径、导出符号、IPC 名和 action type；行号会随代码移动而变化，不作为长期主键。

## 2. 产品与仓库边界

本仓库只维护桌面创作端和本地 Agent runtime：

- Electron 主进程负责窗口、IPC、项目文件、用户会话、远端请求、图片工作线程和更新。
- React Renderer 负责工作台、无限画布、项目 Agent UI、图片容器、需求节点和成果呈现。
- `agent-runtime.cjs` 负责 Prompt/画布上下文组装、压缩编排、模型协议循环与工具执行；SQLite/JSON memory、Prompt/FastMemory 持久化、tool schema 和 Responses/Chat 响应解析由 `runtime/` 专属模块持有，但均不直接修改 React state。
- CRM、New API、账户/角色/quota/计费、下载站和生产部署位于独立 `ai-native` 仓库。

桌面端不是服务端权威来源。身份、角色、余额、模型可用性、计费和使用日志以远端 New API 返回为准；项目画布、项目素材、对话和 FastMemory 以本地项目及应用数据为准。

## 3. 进程拓扑

```text
用户
  │
  ▼
Electron Main: electron-main.cjs
  ├─ BrowserWindow / native dialog / shell / desktopCapturer
  ├─ desktop/ipc/register-desktop-ipc.cjs：69 个 handler 的唯一注册顺序
  │    └─ config / agent / window / debug / project / asset / server registrar
  ├─ 项目、session、模型缓存、更新状态
  ├─ desktop/project-save-coordinator.cjs
  ├─ desktop/model-catalog.cjs
  ├─ desktop/agent-responses-adapter.cjs
  ├─ desktop/new-api-transport.cjs：Node HTTP / Windows curl 传输与取消
  ├─ desktop/new-api-client.cjs：重试、会话 cookie、JSON 与 SSE relay
  ├─ 图片导入、缩略图、抠图、PSD workers
  ├─ 远端 New API 账户、模型缓存与图片服务编排
  └─ createAgentRuntime(agent-runtime.cjs)
          │
          ├─ Prompt / tool protocol loop / compact orchestration
          ├─ runtime/memory-store.cjs：SQLite + JSON memory、Prompt/FastMemory 与 conversation persistence
          ├─ runtime/tool-schemas.cjs：公开与内部 Agent tool schema
          ├─ runtime/responses-parser.cjs：Responses/Chat 响应归一化与流式 chunk 聚合
          ├─ runtime/image-frame.cjs：Image 2 画幅与请求尺寸
          ├─ runtime/image-batch-normalization.cjs：单项兼容、占位过滤与批次画幅归一化
          ├─ runtime/view-image-payload.cjs：view_image 授权与观察副本预算
          ├─ image_gen / view_image / shell_command / ask_user
          └─ 返回 AgentRuntimeAction[]，不直接写 React state

Electron Main
  │ contextBridge + IPC
  ▼
preload.cjs
  ├─ window.iiimageConfig
  ├─ window.iiimageServer
  ├─ window.iiimageUpdater
  └─ window.iiimageAgent
          │
          ▼
React Renderer
  index.html → src/main.tsx → App
  ├─ src/core.ts：共享类型、bridge contract、图片与 session 规则
  ├─ src/settings-persistence.ts：默认设置、迁移与浏览器回退存储
  ├─ src/asset-identity.ts / src/paste-blocks.ts：纯数据域
  ├─ src/agent.ts：Agent 请求和时间线适配
  ├─ src/ui.tsx：基础 UI 兼容 façade；真实实现位于 src/ui/*
  ├─ auth / image viewer / reference picker / window controls 表面模块
  ├─ src/styles.css → src/styles/01…08：保持顺序的样式区域；07 再按 07a→07i 有序展开
  ├─ 画布、容器、需求、TaskScope、选择与分层模块
  └─ applyRuntimeActions：把 runtime action 落到画布
```

安全边界：Renderer 不启用 Node integration；文件系统、窗口原语、凭据和远端会话只经 preload 暴露的受限桥访问。

## 4. 关键入口与调用链

### 4.1 应用启动

```text
package.json.main
  → electron-main.cjs
  → createWindow()
  → BrowserWindow(preload.cjs, contextIsolation=true, sandbox=true)
  → 开发态 loadURL / 生产态 loadFile
  → index.html
  → src/main.tsx createRoot()
  → App()
```

### 4.2 窗口控制

```text
src/main.tsx
  → <WindowControls />
  → src/window-controls.tsx
  → window.iiimageConfig.windowControl({ action })
  → preload IPC "iiimage:window:control"
  → desktop/ipc/window-ipc.cjs
  → 当前 BrowserWindow minimize / maximize / restore / close
```

`WindowControls` 只负责按钮和可访问性，不应读取项目或 Agent 状态。公共 bridge 类型位于 `src/core.ts` 的 `ConfigBridge`。

### 4.3 Agent 请求

```text
src/main.tsx sendPrompt()
  → 项目化附件并冻结 AgentTaskScope v2
  → src/agent.ts requestAgent()
  → window.iiimageAgent.chat
  → preload IPC "iiimage:agent:chat"
  → desktop/ipc/agent-ipc.cjs
  → electron-main.cjs 创建/复用 Agent runtime
  → agent-runtime.cjs chat()
  → 模型与工具循环
  → AgentRuntimeAction[]
  → src/main.tsx applyRuntimeActions()
  → 画布成果、关系、容器或编辑器状态
```

`agent-runtime.cjs` 只能返回 action，不能直接持有或修改 React state。Renderer 不应伪造工具成功结果。

### 4.4 Agent 模型与生图

```text
Agent chat
  → serverChatCompletion()
  → /iiimage/v1/chat/completions 或 /iiimage/v1/responses

image_gen
  → callImageGeneration()
  → electron-main.cjs serverGenerateImage()
  → callNewApiImageWithSession()
  → /iiimage/v1/images/generations 或 /iiimage/v1/images/edits
  → 项目 output 资产
  → workflow action
  → Renderer 归组与溯源
```

`generate/edit/replace/variants/layers/cutout/redraw` 是桌面 Agent 的业务语义；远端边界是 OpenAI-compatible relay、用户会话、模型、计费和图片结果。

### 4.5 项目 session 保存

```text
Renderer 自动保存 / 显式保存
  → window.iiimageConfig.saveSession(session + revision)
  → preload IPC "iiimage:config:save-session"
  → desktop/ipc/config-ipc.cjs
  → electron-main.cjs 注入项目服务
  → desktop/project-store.cjs 解析 active project、session/manifest 路径和 manifest v2
  → desktop/project-session-normalizer.cjs 清洗 session、迁移容器并修复资产身份
  → desktop/project-asset-repository.cjs hydrate/save 项目资产索引
  → projectSessionSaveCoordinator.enqueue(projectId, requestedRevision, apply)
       ├─ 每个项目独立串行队列
       ├─ 首次从磁盘读取 initialRevision
       ├─ requestedRevision <= currentRevision 时跳过旧写入
       └─ apply 成功后推进内存 revision
  → 原子 JSON 写入 + project manifest 更新
```

`desktop/project-save-coordinator.cjs` 只协调顺序和 revision，不决定 session 内容、不直接选择文件路径。`project-store.cjs` 拥有项目列表、路径和 manifest；session 清洗与资产索引分别只有一个 owner。`apply` 返回 `applied:false` 时不得推进 revision。

### 4.6 图片导入与输出

```text
拖入文件/目录
  → Renderer 请求 ConfigBridge
  → electron-main.cjs
  → image-import.cjs / image-import-worker.cjs
  → 校验路径、数量、单文件和总字节限制
  → 复制到当前项目管理目录
  → 生成稳定 assetId / occurrenceId
  → Renderer 容器或成果节点
```

外部原图只读；所有后续处理必须使用复制进项目库的资产。缩略图、观察副本和导出临时文件不得覆盖项目原图。

### 4.7 在线更新

```text
Renderer UpdaterBridge
  → electron-main.cjs checkDesktopUpdate()
  → /api/desktop-update/check
  → 验证 product/version/compatibility/hash/size/signature
  → restart ASAR 或完整 installer 下载授权
  → update helper / launcher
  → 健康标记与失败回滚
```

版本来自 `package.json.version`，restart 兼容标识来自 `iiimageUpdateCompatibility`。签名规范化由 `update-release.cjs` 与打包公钥共同约束。

## 5. 模块登记

### 5.1 进程与桌面模块

| 路径 | Owns | Must not own | 关键检索词 | 主要验证 |
| --- | --- | --- | --- | --- |
| `electron-main.cjs` | Electron 生命周期、桌面服务依赖装配、远端账户/图片编排、模型缓存和 runtime 工厂 | React UI、画布 reducer、内联 IPC handler、重复实现 project store/session normalization/asset repository 或 New API transport/client | `registerIpc`, `createWindow`, `serverChatCompletion`, `callNewApiImageWithSession` | `test:ipc-registration`, `test:project-io`, `test:new-api-transport`, `test:lifecycle`, `test:update`, `aidebug:gui` |
| `preload.cjs` | 四组受限 context bridge | 业务状态、磁盘实现、凭据展示 | `iiimageConfig`, `iiimageServer`, `iiimageUpdater`, `iiimageAgent` | `test:ui-foundation`, `test:lifecycle`, `aidebug:gui` |
| `desktop/ipc/register-desktop-ipc.cjs`, `desktop/ipc/*-ipc.cjs` | Settings → Updater → Session → Agent → Window → Debug → Project → Asset → Server 的固定注册顺序和各域 handler | 桌面服务实现、React 状态、跨域业务复制；依赖必须由 Main 显式注入 | `registerDesktopIpc`, `registerSettingsIpc`, `registerAgentIpc`, `registerAssetIpc`, `registerServerIpc` | `test:ipc-registration`, `test:lifecycle`, `aidebug:gui` |
| `agent-runtime.cjs` | Prompt/画布上下文组装、compact/model/tool 协议循环、工具执行、runtime action 编排 | React state、窗口原语、直接画布 mutation、SQLite/JSON memory CRUD、重复实现已抽出的 schema/响应解析/图片帧/观察副本规则 | `createAgentRuntime`, `chat`, `runTool`, `toolSchemas`, `buildPromptMessages` | `test:agent-text`, `test:agent-protocol`, `test:view-image`, `aidebug:gui` |
| `desktop/project-store.cjs` | 项目列表与 active/default 项目、项目目录/session/manifest v2、legacy manifest migration、thumbnail roots | session 字段清洗、资产扫描/hydration、保存队列或 IPC | `createProjectStore`, `projectSessionFromDisk`, `writeProjectManifest`, `ensureProjectFiles` | `test:project-io`, `test:project-save-coordinator` |
| `desktop/project-session-normalizer.cjs` | session/node/message 清洗、资产身份修复、容器迁移、pending execution 兼容 | 项目路径选择、磁盘 IO、资产扫描或 IPC | `sanitizeSession`, `hydrateSessionAssets`, `repairSessionAssetIdentities`, `sanitizePersistedPendingAgentExecution` | `test:project-io`, `test:asset-identity`, `test:image-container` |
| `desktop/project-asset-repository.cjs` | 项目 asset index、recorded paths、session hydrate 与保存归一化 | 项目列表、manifest 版本、package/export/import 或 IPC | `createProjectAssetRepository`, `buildProjectAssetIndex`, `sessionForProjectSave`, `sessionWithProjectAssets` | `test:project-io`, `test:project-save-coordinator` |
| `desktop/project-package-service.cjs` | `.iiimage` 项目包校验、大小/数量限制、可移植资产收集、导出写入、导入恢复与路径重写 | 项目列表、active project、IPC/dialog 或普通 session 保存队列 | `createProjectPackageService`, `packageProject`, `validateProjectPackageData`, `sessionFromPackage`, `importProjectPackage` | `test:project-io`, `test:project-save-coordinator` |
| `desktop/project-save-coordinator.cjs` | 按项目串行保存、revision 规范化、旧写入拒绝 | session 清洗、路径选择、磁盘格式 | `createProjectSaveCoordinator`, `normalizeSessionRevision`, `enqueue` | `test:project-save-coordinator`, `test:project-io` |
| `desktop/model-catalog.cjs` | 模型响应解析、大小写去重、Agent/Image 默认模型选择、缓存键与缓存归一化 | 网络请求、磁盘缓存时机、IPC | `uniqueModelIds`, `modelIdsFromResponse`, `splitModelSettings`, `cachedModelSettings` | `test:model-catalog`, `test:new-api-transport`, `test:lifecycle` |
| `desktop/agent-responses-adapter.cjs` | Chat Completions 请求到 Responses API input/tool/tool-choice 的纯转换 | HTTP、流读取、凭据或重试 | `responsesRequestFromChatRequest`, `responsesInputFromChatMessages`, `responsesToolsFromChatTools` | `test:agent-responses-adapter`, `test:agent-protocol` |
| `desktop/new-api-transport.cjs` | Node HTTP 与 Windows curl 请求、请求/响应大小限制、流取消、活跃 curl 生命周期 | 设置持久化、登录、重试策略、Updater 状态 | `createNewApiTransport`, `newApiTransportFetch`, `stopActiveNewApiCurlTransports` | `test:new-api-transport`, `test:lifecycle` |
| `desktop/new-api-client.cjs` | New API URL、会话 cookie、重试、JSON request、managed relay JSON/SSE | 账户 UI、模型选择、图片落盘、raw socket/curl 实现 | `createNewApiClient`, `newApiFetch`, `newApiRequest`, `newApiRelayStream` | `test:new-api-transport`, `test:agent-protocol`, `test:lifecycle` |
| `runtime/memory-store.cjs` | SQLite 初始化与 CRUD、Prompt/FastMemory/memorycontext/datememory JSON、context/experience、toolmemory、conversation summary/protocol 持久化和按会话清理 | 模型调用、compact 决策、画布状态、工具执行或 Renderer | `createMemoryStore`, `getFastMemory`, `contextManage`, `appendConversationProtocolTurn` | `test:agent-text`, `test:agent-protocol`, `aidebug:gui` |
| `runtime/tool-schemas.cjs` | 公开/内部 Agent tool schema、图片模型工具契约与 schema 选择 | 模型请求发送、工具执行、Prompt 或 runtime 状态 | `agentToolSchemas`, `toolSchemas`, `imageModelContractForSettings` | `test:agent-text`, `test:agent-protocol` |
| `runtime/responses-parser.cjs` | Chat/Responses 非流式响应归一化、文本/推理 delta 读取、tool-call 与 Responses output 流式聚合 | HTTP/SSE 读取、原生工具进度编排、Agent loop 或工具执行 | `messageFromResponse`, `responseFromStreamChunks`, `mergeResponsesToolCallEvent` | `test:agent-text`, `test:agent-protocol` |
| `runtime/image-frame.cjs` | Image 2 比例、分辨率、质量与 delivery/request size 归一化 | 模型请求发送、项目资产落盘 | `normalizeImage2Size`, `normalizeImageToolFrame`, `validateImageFrameFields` | `test:agent-text`, `test:agent-protocol` |
| `runtime/image-batch-normalization.cjs` | `image_gen` 单项 `items` 兼容提升、占位项过滤、真实批次数与逐项画幅归一化 | 模型调用、图片服务请求、工具进度或画布 action | `createImageBatchNormalization`, `normalizeSingleImageItemCompatibility`, `normalizeImageBatchItems` | `test:agent-text`, `test:agent-protocol` |
| `runtime/view-image-payload.cjs` | `view_image` 允许根、安全读取、格式/尺寸识别、批量 payload 预算与 WebP 观察副本 | 会话持久化、画布预览、原图覆盖 | `prepareViewImageModelPayload`, `viewImagePathAllowed`, `viewImagePayloadBudgetForBatch` | `test:view-image`, `test:agent-protocol` |
| `update-release.cjs` | 更新清单 canonical text | 下载、安装、UI | `canonicalDesktopRelease` | `test:update`, `release:verify`, `package:update-e2e` |
| `src/server.ts` | Vite/AIDebug 浏览器服务回退 | 正式 Electron 文件系统或完整 Agent bridge | `installBrowserServerBridge`, `LOCAL_NEW_API_PROXY` | `build`, `aidebug:gui`, `test:new-api-transport` |

### 5.2 Renderer 核心模块

| 路径 | Owns | Must not own | 关键导出/检索词 | 主要验证 |
| --- | --- | --- | --- | --- |
| `src/main.tsx` | App 状态、画布交互、项目/会话、Agent 调用、runtime action 落地和跨域编排 | 主进程文件 IO、真实 relay token、已抽出表面的内部实现 | `App`, `sendPrompt`, `applyRuntimeActions` | `build`, `aidebug:gui` 及对应专项 suite |
| `src/core.ts` | 共享类型与 bridge contract、会话清洗、图片/mask 与画布纯逻辑；保留资产/paste 兼容重导出 | React 渲染、长运行 Agent 状态、设置持久化与 alpha 归一化的新实现 | `WorkflowNode`, `AgentTaskScope`, `ConfigBridge`, `ServerBridge`, `AgentBridge` | `typecheck`, `test:agent-text`, `test:layer-alpha` |
| `src/layer-alpha-normalization.ts` | 图层 RGBA alpha 像素归属归一化、透明图层互斥重建与归一化报告 | 分层合成编排、mask 生成、`core.ts` façade 重导出 | `normalizeLayerAlphaPixelBuffers`, `normalizeTransparentLayerAlphaExclusivity` | `test:layer-alpha`, `test:layer-mask-replay`, `typecheck`, `build`, `test:bundle` |
| `src/settings-persistence.ts` | 默认设置、旧字段迁移、模型池清洗、Storage Keys、`readJson`/`writeJson` | Electron 磁盘设置、远端账户状态 | `defaultSettings`, `mergeSettings`, `STORAGE_*` | `test:settings-persistence`, `typecheck`, `build` |
| `src/asset-identity.ts` | 稳定 asset/occurrence ID、身份 claim 协调、安全 locator/relative path | 文件复制、项目 manifest IO | `stableImageAssetId`, `stableImageOccurrenceId`, `reconcileImageAssetIdentityClaims` | `test:asset-identity`, `test:project-io`, `test:image-import` |
| `src/paste-blocks.ts` | 大文本粘贴块、可见/模型 prompt 组合、图片粘贴阻断 | Clipboard 文件导入、React 状态 | `composePromptWithPasteBlocks`, `visiblePromptWithPasteBlocks`, `blockImagePaste` | `test:paste-blocks`, `test:agent-text`, `aidebug:gui` |
| `src/agent.ts` | Agent 请求入口、流文本 reducer、工具时间线格式化 | runtime 内部 memory 和模型请求 | `requestAgent`, `reduceAgentStreamEvent` | `test:agent-protocol`, `test:timeline`, `aidebug:gui` |
| `src/aidebug/agent-fixture-bridge.ts` | Renderer Agent action/message fixture 窗口钩子、32ms 流消息合并及安装清理生命周期 | 真实 runtime action 实现、React/项目状态、正式 bundle chunk | `installAgentFixtureBridge`, `__iiimageDebugApplyAgentActions`, `__iiimageDebugSeedAgentMessages` | `test:aidebug-agent-fixtures`, `typecheck`, `test:agent-text-ui`, `aidebug:gui`, `test:bundle` |
| `src/ui.tsx` | 对现有调用方保持稳定的基础 UI 兼容重导出 façade | primitives 内部实现、产品业务状态 | `DialogShell`, `DrawerShell`, `ButtonBase`, `useFloatingDialogInteractions` | `test:ui-foundation`, `typecheck`, `build` |
| `src/ui/*` | Dialog/Drawer focus 与 close policy、共享 controls、菜单 surface、overflow tooltip、浮窗拖动 | 产品业务状态、功能页数据获取 | `dialog-shell.tsx`, `primitives.tsx`, `menu-surface.tsx`, `overflow-tooltip.tsx`, `floating-dialog-interactions.ts` | `test:ui-foundation`, `aidebug:gui` |
| `src/window-controls.tsx` | 原生窗口最小化、最大化/还原、关闭按钮 | BrowserWindow 实现、项目状态 | `WindowControls`, `windowControl` | `build`, `aidebug:gui`, `test:lifecycle` |
| `src/use-stable-event.ts` | 持久 handler identity、调用最新闭包 | 业务状态或事件策略 | `useStableEvent` | `typecheck`, `build` |
| `src/styles.css`, `src/styles/01…08` | 有序样式入口与 base/canvas/legacy/dialog/desktop/responsive/workbench/motion 区域；`07-workbench-flattening.css` 仅按 07a→07i 聚合 workbench slices | 数据修复、运行时状态补丁、跨文件随意改 import 顺序 | `@import`, `07a-foundation-consolidation.css`, `07i-auth-gate.css`, `.ide-shell`, `.canvas`, `.agent-panel` | `test:ui-foundation`, `aidebug:gui`, `test:bundle` |
| `src/markdown.tsx` | Agent Markdown 呈现 | 模型协议或工具执行 | Markdown renderer exports | `build`, `aidebug:gui` |

### 5.3 画布、需求与图片组织

| 路径 | Owns | 关键检索词 | 主要验证 |
| --- | --- | --- | --- |
| `src/selection-state.ts` | `none/single/multiple` 选择 reducer | `reduceSelectionState` | `test:selection` |
| `src/canvas-commands.ts` | 多选可用命令、批量删除/移动等纯命令能力 | canvas command exports | `test:canvas-commands` |
| `src/task-scope.ts` | Renderer 侧 TaskScope clone/merge/continuation policy | `AgentTaskScope`, continuation | `test:task-scope`, `test:execution-gate` |
| `src/task-result-layout.ts` | 根据冻结 TaskScope 规划并构建新成果的容器/布局 mutation | `planTaskResultLayout`, `buildTaskResultLayoutMutation`, snapshot hash | `test:image-container`, `test:task-scope` |
| `src/requirement-graph.ts` | 需求节点输入角色与图关系合法性 | requirement source/result edges | `test:requirement-graph`, `aidebug:requirements` |
| `src/requirement-signature.ts` | 需求重复执行签名 | source signature | `test:requirement-signature`, `test:execution-gate` |
| `src/image-container.ts` | 兼容旧调用方的容器域重导出 façade | `image-container-spec.ts`, `image-container-graph.ts`, `task-result-layout.ts` | `test:image-container`, `typecheck` |
| `src/image-container-spec.ts` | 持久化容器 spec 清洗、成员 binding 与旧字段兼容 | `sanitizeImageContainerSpec`, `imageContainerSpecForNode`, `applyImageContainerCompatibility` | `test:image-container` |
| `src/image-container-graph.ts` | 容器拓扑清洗、spec 同步与 canvas layout projection | `sanitizeImageContainerGraph`, `synchronizeImageContainerSpecs`, `deriveImageLayoutGroupsFromContainerSpecs` | `test:image-container`, `test:image-layout` |
| `src/image-layout.ts` | 2–10 图比例感知布局、排序、拆组与归一化 | layout rows/groups | `test:image-layout`, `aidebug:image-recovery` |
| `src/layer-composition-runtime.ts` | Renderer 分层合成输入准备与校验 | layer composition | `test:layer-alpha`, `test:layer-mask-replay` |

### 5.4 对话框与功能表面

| 路径组 | 职责 | 主要验证 |
| --- | --- | --- |
| `src/account-drawer.tsx` | 账户、余额、日志入口 | `aidebug:gui` |
| `src/model-config-dialog.tsx` | Agent/图片模型选择和服务端模型展示 | `test:agent-text-ui`, `aidebug:gui` |
| `src/agent-text-editor-dialog.tsx` | 主 Prompt 与 FastMemory 编辑 | `test:agent-text`, `test:agent-text-ui` |
| `src/ask-user-dialog.tsx` | `ask_user` 继续执行输入 | `aidebug:ask-user`, `test:execution-gate` |
| `src/requirement-editor-dialog.tsx` | 需求节点编辑与执行入口 | `aidebug:requirements` |
| `src/manual-image-task-dialog.tsx` | 空白画布直接生图表单 | `aidebug:gui`, image generation suites |
| `src/common-dialogs.tsx` | 通用项目、确认和导出弹窗 | `test:ui-foundation`, `aidebug:gui` |
| `src/auth-gate.tsx` | 启动检查、登录/注册表面与认证标题栏 | `test:ui-foundation`, `aidebug:gui`, `test:lifecycle` |
| `src/image-viewer.tsx` | 图片缩放、适配、平移、切图与导出入口 | `test:ui-foundation`, `aidebug:gui` |
| `src/reference-picker-dialog.tsx` | SOURCE/REFERENCE 图片选择、分页和上限展示 | `aidebug:ask-user`, `aidebug:gui`, `test:execution-gate` |

### 5.5 图片与 Worker 模块

| 路径 | 职责 | 边界 | 主要验证 |
| --- | --- | --- | --- |
| `image-import.cjs`, `image-import-worker.cjs` | 扫描、校验、复制、哈希、尺寸读取 | 不修改外部原图；防路径逃逸和资源超限 | `test:image-import`, `aidebug:image-import` |
| `thumbnail-cache.cjs`, `image-thumbnail-worker.cjs` | 项目私有 WebP 缩略图 | 缩略图不替换原资产 | `test:thumbnail-cache` |
| `semantic-matting.cjs`, `semantic-matting-worker.cjs` | OpenCV/PNGJS 蒙版细化和 alpha 验证 | worker 隔离；保持尺寸与资源限制 | `test:semantic-matting`, `test:layer-alpha` |
| `background-removal.cjs` | 边缘连通背景移除兼容逻辑 | 不恢复为产品滤镜入口 | `test:chroma-key` |
| `psd-export.cjs`, `psd-export-worker.cjs`, `psd-raster-source-worker.cjs` | PSD 隔离导出、源图栅格化、回读校验 | 临时源按进程隔离并清理 | `test:psd-export` |

Worker 文件位于仓库根目录是 Electron ASAR 和 worker 路径解析约束，不能只为目录美观移动。

### 5.6 AIDebug harness 与 suite

| 路径 | Owns | Must not own | 主要验证 |
| --- | --- | --- | --- |
| `scripts/aidebug-gui.mjs` | CLI 参数、suite 选择、运行目录、Vite/Electron/CDP 总编排和最终报告 | 已迁出 suite 的场景函数体、重复实现公共截图/进程/PNG helper | `aidebug:gui` 与各 `--*-suite` 专项 |
| `scripts/aidebug/harness/*` | CDP 连接、受控进程退出、PNG 读取/比较、双帧和原生截图证据 | 产品场景、画布业务断言、suite CLI 决策 | `aidebug:gui`, `node --check` |
| `scripts/aidebug/harness/state-snapshot.mjs` | Renderer DOM、几何、可访问性、画布和 Agent 状态的统一快照表达式；显式接收 evaluator 与 workbench 最小宽度 | suite 路由、进程生命周期、报告写入或产品状态修改 | `aidebug:gui`, `node --check` |
| `scripts/aidebug/suites/selection-command.mjs` | selection/command 场景 probe | 通用 CDP/截图实现、其他 suite | `aidebug:selection` |
| `scripts/aidebug/suites/ui-surface.mjs` | UI surface 场景 probe | 通用 CDP/截图实现、其他 suite | `aidebug:gui` |
| `scripts/aidebug/suites/image-generation.mjs` | 单图、图片恢复和图片集合三个图像 probe | CLI/process/CDP 生命周期、其他 suite | `aidebug:image`, `aidebug:image-recovery`, `aidebug:image-collection` |
| `scripts/aidebug/suites/layer-editing.mjs` | layer stack、抠图、区域重绘 probe 与专属 DOM proof | CLI/process/CDP 生命周期、其他 suite 或通用 PNG/CDP helper | `aidebug:gui` 的 `--layer-stack-suite`、`--cutout-suite`、`--region-redraw-suite` |
| `scripts/aidebug/suites/performance.mjs` | 200/1000 节点、长/流式时间线、10 张 4K 图片、交互、内存、Long Task、持久化与视觉检查点基线 probe | CLI/process/CDP 生命周期、最终报告路由、其他 suite | `node --check scripts/aidebug/suites/performance.mjs`、模块 import smoke、`aidebug:performance` |

## 6. 跨边界契约

### 6.1 Preload 与 IPC

| Bridge | Renderer 入口 | 主进程职责 |
| --- | --- | --- |
| `window.iiimageConfig` | 设置、项目、session、导入/导出、窗口控制 | 本地文件、项目目录、BrowserWindow、原子保存 |
| `window.iiimageServer` | 登录、用户、余额、日志、模型、生图 | New API session、用户 header、远端 relay、结果落盘 |
| `window.iiimageUpdater` | 检查、下载、应用更新、进度订阅 | 签名、hash、ticket、helper、回滚 |
| `window.iiimageAgent` | chat、停止、模型、Prompt、FastMemory | Agent runtime 生命周期、memory、模型与工具循环 |

任何 bridge 变更必须同步：

1. `src/core.ts` 类型。
2. `preload.cjs` 暴露方法。
3. 对应 `desktop/ipc/*-ipc.cjs` handler 与 `register-desktop-ipc.cjs` 注册顺序。
4. Renderer 调用方与错误处理。
5. 对应 selftest/AIDebug。

### 6.2 Runtime action

`agent-runtime.cjs` 返回 `AgentRuntimeAction[]`，`src/main.tsx` 的 `applyRuntimeActions` 是唯一主要落地点。新增 action 必须同时更新：

- `src/core.ts` 的 `AgentRuntimeAction` 类型。
- runtime action 创建与错误回执。
- Renderer handler 和幂等/失败行为。
- session 清洗与迁移（若 action 形成持久化节点）。
- Agent protocol、自测和真实 GUI 链路。

### 6.3 TaskScope v2

TaskScope 是每轮 Agent 请求冻结的来源合同，区分 `SOURCE` 和 `REFERENCE`，包含 scope、result、confirmation policy 和 snapshot hash。`ask_user` 继续执行必须沿用同一份作用域，不得根据后续画布变化静默替换来源。

来源上限：SOURCE 200、REFERENCE 40；真实图片工具单轮参考图上限 9。需求节点执行时来源只能来自需求节点左侧合法图片关系。

### 6.4 项目保存 revision

- Renderer 生成单调 revision。
- `project-save-coordinator` 按 projectId 建立独立队列。
- 旧 revision 返回 `skippedStale:true`，不得覆盖磁盘较新 session。
- 无显式 revision 的兼容调用使用当前 revision + 1。
- 写入被业务层拒绝并返回 `applied:false` 时，不推进协调器 revision。
- 重启后的基线从项目 manifest/session 读取，不依赖上次进程内 Map。

### 6.5 远端服务

桌面默认访问 `https://image.aieyra.cn`。正式认证使用 session cookie 与 `New-Api-User`；relay token 保持服务端隐藏。主要契约：

- `/api/user/login`, `/api/user/self`, `/api/user/models`
- `/api/log/self`
- `/api/crm/session/self`
- `/iiimage/v1/models`
- `/iiimage/v1/chat/completions`, `/iiimage/v1/responses`
- `/iiimage/v1/images/generations`, `/iiimage/v1/images/edits`
- `/api/desktop-update/*`, `/api/desktop-download/*`

修改上述路径、方法、认证 header、流事件、DTO、上传限制、幂等键或更新 schema 时，必须同步审计独立 `ai-native` 仓库。

## 7. 镜像实现与同步规则

以下逻辑存在于不同进程或技术栈，修改一处时必须核对另一处：

| 镜像合同 | 位置 | 同步要求 |
| --- | --- | --- |
| TaskScope snapshot hash | `src/core.ts`、`agent-runtime.cjs` | 哈希材料、字段顺序和 v2 前缀必须一致；运行 `test:task-scope`、`test:agent-protocol` |
| Image 2 比例/分辨率/尺寸 | `src/core.ts`、`runtime/image-frame.cjs`、主进程生图参数 | UI 展示、runtime normalization 和真实请求必须一致；运行 `test:agent-text`、`test:agent-protocol`、真实图片专项 |
| Asset identity | Renderer `src/asset-identity.ts`（由 `core.ts` 兼容重导出）、`electron-main.cjs` 项目/session 清洗、导入 worker | assetId/occurrenceId/content hash 不得因重启或迁移漂移；运行 `test:asset-identity`, `test:project-io`, `test:image-import` |
| Session revision | Renderer 自动保存、`desktop/project-save-coordinator.cjs`、项目 manifest/session | revision 单调且旧写不覆盖新写；运行 `test:project-save-coordinator`, `test:project-io` |
| 服务返回清洗 | `electron-main.cjs` 正式路径、`src/server.ts` 浏览器回退 | 登录、用户、模型、日志和图片 DTO 不能静默分叉；正式行为以 Electron 路径为准 |
| Agent 文本清洗 | `agent-runtime.cjs` tool envelope、`src/core.ts` 持久化消息清洗、`src/agent.ts` 时间线 | 不泄露 entry id/FastMemory metadata，不重复最终文本；运行 `test:agent-text`, `test:timeline` |
| 更新清单 | `package.json`, `update-release.cjs`, `electron-main.cjs`, `build/update-public-key.pem`, `ai-native` release manifest | version、compatibility、hash、size、signature 和服务器实物必须成组发布 |

短期内不要为了去重而跨 CommonJS/TypeScript 强行共享运行时代码；优先使用共同 fixture 和契约测试保证一致。

## 8. 修改影响矩阵

| 修改类型 | 首要位置 | 必须联动检查 | 最低专项验证 |
| --- | --- | --- | --- |
| 顶栏、窗口按钮 | `src/main.tsx`, `src/window-controls.tsx`, `src/styles/01-base-controls.css` 与后续覆盖区域 | `ConfigBridge`, preload, window IPC | `build`, `aidebug:gui`, `test:lifecycle` |
| 画布交互/选择 | `src/main.tsx`, `selection-state.ts`, `canvas-commands.ts` | Agent 当前上下文、容器拖放 | `test:selection`, `test:canvas-commands`, `aidebug:selection` |
| 图片容器/布局 | `image-container-spec.ts`, `image-container-graph.ts`, `task-result-layout.ts`, `image-layout.ts`；`image-container.ts` 仅作兼容 façade | session migration、TaskScope provenance、layout projection | `test:image-container`, `test:image-layout`, `aidebug:gui` |
| 需求节点 | `requirement-graph.ts`, `requirement-signature.ts`, dialogs, `main.tsx` | TaskScope、重复执行 gate、关系边 | requirement、task-scope、execution-gate、AIDebug suites |
| Agent Prompt/tool/schema | `agent-runtime.cjs` | `src/core.ts` 类型、`src/agent.ts`、action handler、产品意图 | `test:agent-text`, `test:agent-protocol`, `aidebug:gui` |
| `view_image` | `runtime/view-image-payload.cjs`, `agent-runtime.cjs` | 允许根、payload 预算、Sharp、持久化排除 | `test:view-image`, `test:agent-protocol` |
| 模型目录/缓存 | `desktop/model-catalog.cjs`, `electron-main.cjs` | 服务响应 DTO、60 秒缓存、设置/Agent 共用模型 | `test:model-catalog`, `test:new-api-transport`, `test:lifecycle` |
| 设置/浏览器回退存储 | `settings-persistence.ts` | `AppSettings` 类型、Electron ConfigBridge、旧字段迁移 | `test:settings-persistence`, `typecheck`, `aidebug:gui` |
| 远端 API/模型/登录 | `desktop/new-api-transport.cjs`, `desktop/new-api-client.cjs`, `electron-main.cjs`, `src/server.ts` | preload/core bridge、ai-native | `test:new-api-transport`, `test:lifecycle`, `aidebug:gui` |
| 项目保存/session | `main.tsx`, `electron-main.cjs`, save coordinator | manifest、revision、迁移、原子写入 | `test:project-save-coordinator`, `test:project-io` |
| 图片导入/缩略图 | import/cache modules | 资产身份、路径限制、容器 | `test:image-import`, `test:thumbnail-cache`, AIDebug import |
| 抠图/alpha/分层 | `layer-alpha-normalization.ts`, `core.ts`, matting/background/layer modules | 尺寸、透明度、mask replay、PSD | alpha、mask、matting、chroma-key、PSD tests |
| 更新/安装器 | main/update/release scripts/build/tools | ai-native manifest、签名密钥、回滚 | update tests、installer smoke、update E2E |
| 模块移动/拆分 | 原模块与新模块 | public re-export、打包 files、worker/ASAR 路径、本文 | `typecheck`, `build`, `test:bundle` + 对应专项 |

## 9. 状态与持久化位置

### 9.1 开发态与打包态根目录

| 数据 | 开发态 | 打包态 |
| --- | --- | --- |
| config 根 | 仓库 `config/` | Electron `userData/data/` |
| Agent workspace | 仓库根目录 | Electron `userData/workspace/` |
| Electron diagnostics | `.diagnostics/electron/` | Electron logs 下的 `runtime/` |

可用 `IIIMAGE_CONFIG_DIR`、`IIIMAGE_DEBUG_DIR` 等诊断变量覆盖隔离测试目录，但不得把真实用户数据写入随机源码目录。

### 9.2 应用与项目文件

| 路径/文件 | 内容 | 所有者 |
| --- | --- | --- |
| `app-settings.json` | App 设置及本地远端会话 | Electron Main；不得暴露凭据到 UI |
| `session.json` | 全局/兼容 session | Electron Main |
| `model-cache.json` | 60 秒模型缓存的磁盘回退 | Electron Main；不得含 token/cookie/key |
| `project-list.json` | 项目登记与 activeProjectId | Electron Main |
| `projects/<id>/session.json` 或用户选择项目的 session | 画布、会话、容器、需求与资产引用 | Renderer 产生、Main 清洗并原子写入 |
| `<project>/.iiimage/project.json` | 项目 manifest v2、revision 和统计 | Electron Main |
| `<project>/output/` | 生成或衍生图片 | Main/Agent 图片链路 |
| `references/` | 兼容/受管参考资产 | Electron Main |
| `updates/` | 更新状态、下载和健康标记 | Electron updater |
| `start.iiimage` | 可移植项目导出 | 项目 IO |

### 9.3 Agent memory

位于 `<configRoot>/memory/`：

- `promptcontext.json`：可编辑主 Prompt 与 memory Prompt。
- `fastmemory.json`：按 `projectId + conversationId` 隔离的 FastMemory。
- `memorycontext.json`：内部 memory context。
- `datememorycontext.json`：日期维护上下文。
- `iiimage-memory.db`：runtime meta、context、toolmemory、date memory 等 SQLite 数据。

Prompt、tool schema、compact summary 和 FastMemory 是不同存储面，不能重新合并为旧 Prompt entries。

### 9.4 仅内存状态

- `desktop/project-save-coordinator.cjs` 的 project queue 与 revision Map。
- 当前 BrowserWindow、模型 inflight 请求和模型 memory cache。
- Agent 当前执行、取消控制器、流式文本和工具轮次。
- Renderer 当前 selection、drawer/dialog、拖拽和未保存 UI 状态。

进程重启后必须从磁盘/服务端恢复权威状态，不得依赖这些 Map 或 React state。

## 10. 测试映射

所有代码改动至少执行 `corepack pnpm run build`；TypeScript/TSX 结构调整同时执行 `corepack pnpm run typecheck`。下面是专项入口：

| 领域 | 命令 |
| --- | --- |
| Agent Prompt/FastMemory/tool contract | `corepack pnpm run test:agent-text` |
| Agent/Responses/TaskScope protocol | `corepack pnpm run test:agent-protocol` |
| Responses 请求转换 | `corepack pnpm run test:agent-responses-adapter` |
| New API transport | `corepack pnpm run test:new-api-transport` |
| `view_image` | `corepack pnpm run test:view-image` |
| 项目 IO | `corepack pnpm run test:project-io` |
| 保存 revision/队列 | `corepack pnpm run test:project-save-coordinator` |
| 模型目录/缓存纯逻辑 | `corepack pnpm run test:model-catalog` |
| 设置迁移与 localStorage 回退 | `corepack pnpm run test:settings-persistence` |
| 粘贴块 | `corepack pnpm run test:paste-blocks` |
| Agent 文本 UI | `corepack pnpm run test:agent-text-ui` |
| 布局/容器 | `corepack pnpm run test:image-layout`, `corepack pnpm run test:image-container` |
| 需求/TaskScope/gate | `test:requirement-signature`, `test:requirement-graph`, `test:task-scope`, `test:execution-gate` |
| UI primitives | `corepack pnpm run test:ui-foundation` |
| alpha/mask/matting | `test:chroma-key`, `test:layer-alpha`, `test:layer-mask-replay`, `test:semantic-matting` |
| 选择/画布/资产 | `test:selection`, `test:canvas-commands`, `test:asset-identity` |
| 工具时间线 | `corepack pnpm run test:timeline` |
| PSD/缩略图/导入 | `test:psd-export`, `test:thumbnail-cache`, `test:image-import` |
| IPC 注册顺序/preload 对称性 | `corepack pnpm run test:ipc-registration` |
| Electron 生命周期 | `corepack pnpm run test:lifecycle` |
| 更新 | `test:update`, `test:update-rollback`, `test:update-helper` |
| 正式 bundle | `corepack pnpm run test:bundle` |
| 真实 GUI 总入口 | `corepack pnpm run aidebug:gui` |
| 正式发布 | `corepack pnpm run release:final` |

测试存在不代表所有改动都要执行全量套件。按修改影响矩阵选择专项，但 UI、Electron、项目或 Agent 改动必须包含真实 `aidebug:gui` 验证；正式制品必须通过 `test:bundle` 和发布编排器要求。

## 11. 当前高风险热点

- `src/main.tsx`、`electron-main.cjs`、`agent-runtime.cjs` 和 `src/core.ts` 仍较大，但已分别建立 renderer surface、desktop domain、runtime domain 与纯数据模块边界；Main 的 69 个 IPC handler 已由 `desktop/ipc/*` 独立拥有，`agent-runtime.cjs` 的 memory store、tool schema 与 Responses/Chat parser 也已有独立 owner，后续继续沿现有边界拆，不要重新内联。
- `src/styles.css` 是 28 行有序入口；`src/styles/07-workbench-flattening.css` 也只是保持 07a→07i 顺序的二级入口，workbench 规则分别归属对应 slice。任何样式调整都必须同时保持 01→08、07a→07i import 顺序和最终 reduced-motion gate。
- `settings-persistence.ts` 直接拥有设置/Storage 导出；新代码不要再从 `core.ts` 查找这些符号。
- `src/server.ts` 是浏览器开发回退，不是正式 Electron 产品能力基线。
- Worker 根目录位置受 ASAR 解析约束。
- `public/ui/style-library` 与 `core.ts` 的旧风格库需要先确认真实消费者，再决定删除或隔离；不得恢复为旧复杂风格向导。
- 远端 API 和更新发布跨越 `iiimage-studio` 与 `ai-native` 两仓，单仓修改不能证明交付完成。

## 12. 最近同步记录

| 日期 | 桌面版本 | 同步内容 |
| --- | --- | --- |
| 2026-07-22 | 1.0.4 | 建立首版上下文地图；登记 `src/window-controls.tsx` 与 `desktop/project-save-coordinator.cjs`；补全进程拓扑、调用链、跨边界契约、镜像规则、持久化和测试映射。 |
| 2026-07-22 | 1.0.4 | 模块化 `main.tsx` 表面、Electron 模型/Responses/保存域、runtime 图片帧与 `view_image`、core 设置/资产/粘贴域；把 1 万行样式按原级联顺序拆成 8 区；新增对应 selftest、打包白名单和共享 chunk 门禁。 |
| 2026-07-22 | 1.0.4 | 抽出 `runtime/tool-schemas.cjs` 与 `runtime/responses-parser.cjs`，让 Agent runtime facade 只消费稳定 schema 和响应解析 owner；增加直接协议 characterization 与禁止重复实现断言。 |
| 2026-07-22 | 1.0.4 | 抽出 `runtime/memory-store.cjs`，集中持有 SQLite/JSON memory、Prompt/FastMemory、context/experience、tool/date memory 与 conversation summary/protocol；Runtime 只保留模型 compact 和 Agent loop 编排。 |
| 2026-07-22 | 1.0.4 | 抽出 `desktop/new-api-transport.cjs` 与 `desktop/new-api-client.cjs`；raw transport 通过独立 `getDesktopVersion` 注入解除对 Updater 的反向依赖，Electron facade 与 selftest 导出保持不变。 |
| 2026-07-22 | 1.0.4 | 抽出 `desktop/project-package-service.cjs`，集中持有项目包校验、限制、导入导出与恢复；抽出 `scripts/aidebug/suites/layer-editing.mjs`，集中持有 layer-stack、cutout、region-redraw 场景，入口调用顺序和公开测试命令不变。 |
| 2026-07-22 | 1.0.4 | 抽出 `desktop/ipc/*-ipc.cjs` 与根 registrar；固定并直接验证 69 个 handler 的顺序、唯一性、66 个 preload invoke 和 3 个内部 Agent channel。 |
| 2026-07-23 | 1.0.4 | 抽出 `scripts/aidebug/harness/state-snapshot.mjs`，由统一 reader 持有 Renderer GUI 状态快照；主 AIDebug 脚本仅保留 evaluator 与 workbench 宽度装配，快照字段和表达式保持逐行等价。 |
| 2026-07-23 | 1.0.4 | 抽出 `scripts/aidebug/suites/performance.mjs`，集中持有性能 fixture、视觉检查点与 Renderer heap/GC helper；主 AIDebug 脚本显式注入运行目录、evaluator 和 capture owner，性能报告契约保持不变。 |
| 2026-07-23 | 1.0.4 | 抽出 `src/aidebug/agent-fixture-bridge.ts`，集中持有 Agent action/message fixture 窗口钩子与 32ms 流消息合并；`main.tsx` 仅注入 runtime action、消息 ref/state 与时间标签，正式 bundle 禁止包含两个诊断 hook。 |
| 2026-07-23 | 1.0.4 | 从 `src/core.ts` 抽出 `src/layer-alpha-normalization.ts`，集中持有 RGBA alpha 像素归属与透明图层互斥归一化；分层合成 runtime 与 alpha/mask selftest 直接引用新 owner，`core.ts` 不保留 façade 重导出。 |
| 2026-07-23 | 1.0.4 | 抽出 `runtime/image-batch-normalization.cjs`，集中持有 `image_gen` 单项兼容、占位项过滤、有效批次数和逐项画幅归一化；Agent runtime 仅注入文本清洗并消费稳定 normalizer，禁止新 owner 反向依赖 facade。 |
