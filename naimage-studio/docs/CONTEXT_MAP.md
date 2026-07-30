# naimage 上下文地图

> 地图版本：8
> 最近同步：2026-07-30
> 对应桌面版本：1.0.7
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
- 准备新的正式版本；发布冻结提交必须同时包含对应版本发布说明、文档索引、本文最近同步记录和 `scripts/release/release-notes.json`。跨仓契约发生变化时还必须同步工作区根目录 `WORKSPACE_CONTEXT_MAP.md`。

检索时优先使用文件路径、导出符号、IPC 名和 action type；行号会随代码移动而变化，不作为长期主键。

## 2. 产品与仓库边界

本仓库只维护桌面创作端和本地 Agent runtime：

- Electron 主进程负责窗口、IPC、项目文件、用户会话、远端请求、图片工作线程和更新。
- React Renderer 负责工作台、无限画布、项目 Agent UI、图片容器、需求节点和成果呈现。
- `agent-runtime.cjs` 负责 Prompt/画布上下文组装、压缩编排、模型协议循环与工具执行；SQLite/JSON memory、Prompt/FastMemory 持久化、tool schema 和 Responses/Chat 响应解析由 `runtime/` 专属模块持有，但均不直接修改 React state。
- New API、账户/角色/quota/计费、渠道、模型、下载站和生产部署位于独立 `ai-native` 仓库。

桌面端不是服务端权威来源。身份、角色、余额、模型可用性、计费和使用日志以远端 New API 返回为准；项目画布、项目素材、对话和 FastMemory 以本地项目及应用数据为准。

产品层把 Agent 定义为“Codex/Claude Code 式通用 Agent Runtime + naimage 图片创作 Agent”。前者拥有目标分解、工具循环、模型协议、上下文 checkpoint、Skills/CLI 和任务恢复；后者拥有画布语义、TaskScope、图片容器、Image Gen、素材归属和绘画经验。它是能力与协议的组合，不是把 Codex 产品或源码直接嵌入应用。

## 3. 进程拓扑

```text
用户
  │
  ▼
Electron Main: electron-main.cjs
  ├─ BrowserWindow / native dialog / shell / desktopCapturer
  ├─ desktop/ipc/register-desktop-ipc.cjs：95 个 invoke handler（92 preload + 3 internal）/5 receive/2 send channel 的唯一注册顺序
  │    └─ settings / plugin / automation / updater / session / agent / window / debug / project / asset / server registrar
  ├─ 项目、session、账户密钥脱敏快照、模型缓存、更新状态
  ├─ desktop/project-save-coordinator.cjs
  ├─ desktop/model-catalog.cjs
  ├─ desktop/agent-responses-adapter.cjs
  ├─ desktop/new-api-transport.cjs：默认 Node HTTP、显式 HTTP(S) 代理时的 Windows curl 传输与取消
  ├─ desktop/new-api-client.cjs：account/relay/update 基址解析、重试、会话 cookie、JSON/通用 SSE 与 Images SSE relay
  ├─ desktop/account-token-service.cjs：New API 用户密钥 CRUD、按账户隔离的脱敏磁盘快照与 Main-only 完整 Key 内存缓存
  ├─ desktop/automation-service.cjs：127.0.0.1 随机端口、随机 Bearer Token 与 Renderer 命令转发
  ├─ desktop/agent-integration-service.cjs：Codex/Claude Code/OpenCode/OpenClaw Skill 检测、安装与移除
  ├─ desktop/plugin-task-prompts.cjs：电商与 Project Graph 受信任任务 Prompt
  ├─ desktop/theme-preset-service.cjs：自定义主题 schema 与原生导入/导出
  ├─ runtime/glass-theme-settings.cjs：共享 Glass registry 的 Electron 设置归一化与原生窗口底色
  ├─ desktop/agent-window-service.cjs：独立 Agent BrowserWindow 生命周期、主 Renderer 权威状态与命令中继
  ├─ desktop/license-service.cjs：设备激活、24 小时校验缓存与 72 小时离线宽限
  ├─ desktop/aidebug-image-fixture.cjs：本地 mock 生图的确定性 PNG 与图层提示
  ├─ 图片导入、缩略图、抠图、PSD workers
  ├─ 远端 New API 账户、模型缓存与图片服务编排
  └─ createAgentRuntime(agent-runtime.cjs)
          │
          ├─ Prompt / tool protocol loop / compact orchestration
          ├─ runtime/memory-store.cjs：SQLite + JSON memory、Prompt/FastMemory 与 conversation persistence
          ├─ runtime/tool-schemas.cjs：公开与内部 Agent tool schema
          ├─ runtime/responses-parser.cjs：Responses/Chat 响应归一化与流式 chunk 聚合
          ├─ runtime/controlled-shell-command.cjs：受控只读命令规划、路径边界与子进程执行
          ├─ runtime/image-frame.cjs：Image 2 画幅与请求尺寸
          ├─ runtime/image-batch-normalization.cjs：单项兼容、占位过滤与批次画幅归一化
          ├─ runtime/view-image-payload.cjs：view_image 授权与观察副本预算
          ├─ image_gen / view_image / shell_command / ask_user
          └─ 返回 AgentRuntimeAction[]，不直接写 React state

Electron Main
  │ contextBridge + IPC
  ▼
preload.cjs
  ├─ window.naimageConfig
  ├─ window.naimageServer
  ├─ window.naimageUpdater
  ├─ window.naimageAgent
  ├─ window.naimageAutomation
  ├─ window.naimageAgentIntegrations
  └─ window.naimageAgentWindow
          │
          ▼
React Renderer
  index.html → public/glass-theme-bootstrap.js（React 前安全首帧投影）→ src/main.tsx → App
  ├─ src/core.ts：共享类型、bridge contract、图片与 session 规则
  ├─ runtime/glass-theme-presets.json → src/glass-theme.ts → src/glass-theme-provider.tsx：Glass registry、归一化、根节点投影与无 wrapper Provider
  ├─ src/settings-persistence.ts：默认设置、迁移、浏览器回退存储与无敏感信息的 Glass bootstrap snapshot
  ├─ src/workspace-chrome.tsx：自然异步左侧素材轨、工作台/专注/评审切换、任务上下文与只读成果投影
  ├─ src/glass-lab.tsx：设置外观页内再次按需加载的 Glass Lab
  ├─ src/plugin-state.ts / src/plugin-system.ts：声明式插件状态、manifest、权限、命令与工具栏贡献
  ├─ src/plugins/*：内置插件领域任务契约；不直接修改项目 session
  ├─ src/agent-panel-layout.ts：Agent 停靠/浮动布局、边界限制与 CSS 拖动预览
  ├─ src/agent-window-sync.ts：按需加载的独立窗快照与命令校验
  ├─ src/asset-identity.ts / src/paste-blocks.ts：纯数据域
  ├─ src/agent.ts：Agent 请求和时间线适配
  ├─ src/ui.tsx：基础 UI 兼容 façade；真实实现位于 src/ui/*
  ├─ auth / image viewer / reference picker / theme palette / window controls 表面模块
  ├─ src/styles.css → src/styles/01…08：01 Glass token/主题桥，04 设置外观，07a→07i workbench，07j Glass surface/视图模式；04b 随 Glass Lab 异步 chunk 加载
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

### 4.1.1 Glass 主题首帧与实时投影

```text
runtime/glass-theme-presets.json（六套主题、三套材质、强调色与参数范围）
  ├─ runtime/glass-theme-settings.cjs
  │    → Electron 设置归一化
  │    → 主窗口和独立 Agent BrowserWindow 创建时的原生 backgroundColor 使用已保存主题 canvas 色
  │    → 设置保存后 desktop/ipc/config-ipc.cjs onSettingsSaved 更新全部存活 BrowserWindow 的原生底色
  └─ src/glass-theme.ts
       → normalizeGlassThemeSettings()
       → glassAppearanceProjection()
       → applyGlassAppearanceToRoot()

index.html 的静态 light-sky + frosted fallback
  → public/glass-theme-bootstrap.js 在 React/Vite 入口前读取 naimage.glassTheme.bootstrap.v1
  → 只信任 glassTheme / glassMaterial / glassParameters 并重新计算变量
  → documentElement datasets / classes / CSS variables
  → src/main.tsx settingsWithGlassBootstrap(defaultSettings) 让首个 React frame 复用同一安全外观子集
  → src/main.tsx <GlassThemeProvider settings={settings}>
  → useLayoutEffect 重新投影权威设置并刷新安全 bootstrap snapshot
```

`runtime/glass-theme-presets.json` 是运行时 registry 的 canonical 数据源；`public/glass-theme-bootstrap.js` 为了在 Vite bundle 执行前工作而保留一份启动期投影镜像，必须由 `test:glass-theme` 对六主题、三材质、强调色和变量逐项防漂移。bootstrap snapshot 固定为 `naimage-glass-theme-bootstrap` v1，只包含 `glassTheme`、`glassMaterial`、`glassParameters.{opacity,blur,saturation,highlight,shadow,radius,accent,noise,reduceMotion}` 及可重建投影，不包含账号、Key、Cookie、Prompt 或项目数据；启动脚本忽略持久化的 `variables`，防止任意 CSS 值被直接信任。

根节点合同包括 `data-glass-theme`、`data-glass-mode`、`data-glass-material`、`data-glass-accent`、`data-glass-accent-resolved`、`data-glass-noise`、`data-glass-reduce-motion`，以及 `glass-theme-active`、`theme-light|theme-dark`、`glass-no-noise`、`glass-reduce-motion`。默认是 `light-sky + frosted`。Electron 的完整设置仍以 Main 磁盘配置为 authority；`settingsWithGlassBootstrap()` 只把无凭据的 Glass 子集借给首个 React frame，避免 bootstrap 已恢复的非默认主题被异步磁盘加载前的默认 state 短暂覆盖。`GlassThemeProvider` 不渲染 DOM wrapper，只更新根 datasets、classes 和 CSS variables；切换主题、材质或自定义参数不得卸载、重建或重新初始化画布。

Glass Lab 的自然异步链路是：顶栏 `.workspace-glass-lab-button` 或素材轨设置按钮 → `LazySettingsDrawer` → 外观 section → `LazyGlassLab` → `src/glass-lab.tsx` 同 chunk 导入 `src/styles/04b-glass-lab.css`。Glass 全局 token/兼容桥由 `src/styles/01-liquid-glass-tokens.css` 持有，chrome、Agent、素材轨、工具栏、菜单/对话框/设置、输入框和浮动控件的 surface 由 `src/styles/07j-liquid-glass-surfaces.css` 持有；画布 artwork、图片节点和各成果预览保持不透明，并显式禁用 `filter`、`backdrop-filter` 与混合模式。

### 4.2 窗口控制

```text
src/main.tsx
  → <WindowControls />
  → src/window-controls.tsx
  → window.naimageConfig.windowControl({ action })
  → preload IPC "naimage:window:control"
  → desktop/ipc/window-ipc.cjs
  → 当前 BrowserWindow minimize / maximize / restore / close
```

`WindowControls` 只负责按钮和可访问性，不应读取项目或 Agent 状态。公共 bridge 类型位于 `src/core.ts` 的 `ConfigBridge`。

### 4.2.1 左侧素材轨与 Workbench / Focus / Review

```text
src/main.tsx workspaceViewMode（naimage.workspaceViewMode.v1，仅 UI 便利状态）
  → loadWorkspaceChrome() 单一自然异步模块
  ├─ WorkspaceDirectionSwitcher：workbench / focus / review
  ├─ WorkspaceSearch：顶栏项目搜索与 Ctrl/Cmd K 入口
  ├─ WorkspaceAssetRail：成果 / 图层 / 需求 / 历史 + 导入 / 设置
  ├─ WorkspaceTaskContext：当前模式与选中节点摘要
  ├─ WorkspaceFocusStage：当前成果 + 最近成果胶片条 + 继续生成
  └─ WorkspaceReviewGrid：最近四个成果并排评审 + 当前方向
       → 选择、打开大图、切换会话、导入和设置均回调 src/main.tsx 的生产动作
```

主 Shell 合同是 `.ide-main.canvas-only.has-asset-rail.workspace-mode-{workbench|focus|review}` 与既有 `agent-placement-*`/`agent-collapsed` 的组合。左侧素材栏是正式产品结构，必须保留成果、图层、需求、历史、导入和设置入口，不得再以“原 Shell 无永久侧栏”为由移除。异步加载期间分别使用 `.workspace-direction-switcher.workspace-direction-switcher-loading` 与 `.workspace-asset-rail.is-loading`，不能用空白或第二套临时布局替代。素材轨从 live `canvasNodes` 和 `conversations` 派生成果、图层、需求与历史，最多呈现有界的最近 40 项；它不持有第二份画布、会话或项目状态。原型入口必须连接既有生产动作或权威状态；禁止保留无行为按钮、平行 mock 数据或第二套业务实现，Agent 仍是唯一控制中心。

Workbench 始终保留 canonical 无限画布；Focus 与 Review 是挂在同一 `.canvas-panel` 内、位于 canonical canvas 之后的 sibling projection，只改变可见投影，不得条件卸载画布。切换到 Focus/Review 时若当前未选中有效图片，Main 只选择现有图片成果，不创建或改写节点。`WorkspaceSearch` 搜索真实图片、需求和会话，支持按钮与 Ctrl/Cmd K 调用，并按精确标题、标题前缀、内容匹配依次排序；选择结果必须回到 Main 的真实节点/会话选择动作，不能只关闭浮层或修改局部投影。Navigator、Workbench、Focus 与 Review 发起跨节点选择时必须使用 explicit replace 语义，不得复用 selection `focus` 手势；后者会保守忽略已存在选择下的跨节点切换。Focus/Review 只能投影已有图片成果；在这两个模式中搜索到需求或尚无资产的进行中图片时，Main 必须先切回 Workbench，再定位 canonical 节点，避免任务摘要与可见图片不一致。Focus 的“继续生成”只打开所选现有成果的编辑器，不立即派发图片请求或产生费用。Review 的“当前方向”以 canonical `selectedNodeId` 为权威，选择后进入现有项目持久化链，不得另设 Review-only 选择状态。生产 BrowserWindow 最小尺寸为 884 x 640 px；`07j-liquid-glass-surfaces.css` 对 1280/1100/1000 px 逐级收紧顶栏、素材轨和视图投影，AIDebug 的 540 px BrowserWindow 仅用于隔离响应式 fixture，不改变正式窗口门槛。

### 4.3 Agent 请求

```text
src/main.tsx sendPrompt()
  → 项目化附件并冻结 AgentTaskScope v2
  → src/agent.ts requestAgent()
  → window.naimageAgent.chat
  → preload IPC "naimage:agent:chat"
  → desktop/ipc/agent-ipc.cjs
  → electron-main.cjs 创建/复用 Agent runtime
  → agent-runtime.cjs chat()
  → 模型与工具循环
  → AgentRuntimeAction[]
  → src/main.tsx applyRuntimeActions()
  → 画布成果、关系、容器或编辑器状态
```

`agent-runtime.cjs` 只能返回 action，不能直接持有或修改 React state。Renderer 不应伪造工具成功结果。

运行中的任务由 `desktop/agent-run-control.cjs` 按 `projectId + conversationId + runId` 管理。暂停只在模型/工具派发边界等待，结束以 `NAIMAGE_RUN_CANCELLED` 中断父运行；修改需求（steer）则把文本和显式 TaskScope update 写入有界队列，以 `NAIMAGE_RUN_STEERED` 只中断当前模型或工具 phase，再向同一协议历史补齐被跳过的工具输出、追加新的 user intent 并重新规划。queued steer 会让边界后创建的新 phase 立即以 steer 结束，避免旧工具从检查与启动之间的竞态缝隙漏出。TaskScope update 以独立的 `sourceMode=keep|replace|merge|clear` 与 `referenceMode=keep|replace|merge|clear` 表达保留、替换、追加和清空；Main 必须先归一化候选 scope、重新计算 `snapshotHash`、重算 SOURCE 节点锁并复核跨会话冲突，保存到 run record 后才能中断 child phase。主窗口、独立窗口和 CLI 均暴露显式模式；单条 steer 最多 36,000 字符，超限明确拒绝而不静默截断。模型或图片上游已接收的请求即使客户端中断等待，仍可能产生费用。逻辑专项入口为 `test:agent-run-control` 与 `test:agent-steer`，主/独立窗口可见模式和发送后重置由 `aidebug:skills` 做真实 GUI 验证。

Goal 是普通对话之外的显式全画布批量合同。`src/goal-task-scope.ts` 从当前画布投影全部顶层合格图片容器，排除纯 REFERENCE、空容器和生成中容器，并把每个图片槽位保留为独立有序 binding；`src/goal-mode.ts` 将容器/图片计数、费用估算、probe 策略和冻结 `snapshotHash` 组成预览。主窗口、独立 Agent 窗口与 `agent.goal` 自动化命令都必须先预览、再由用户明确确认；Main 在派发前按当前画布重算 hash，发生 drift 时零请求拒绝，不能沿用旧确认或现场重建范围。

确认后的模型只允许一次 `image_gen(scopeExecution="all-goal-sources")`，`runtime/goal-image-execution.cjs` 校验 Goal metadata、TaskScope、SOURCE binding、容器顺序、本地路径和 hash 完全一致，再由 runtime 逐 binding 展开。`runtime/goal-probe-admission.cjs` 是 Main 进程唯一 Goal admission owner：probe 串行且优先于新 ramp，已通过 Goal 在 wave 边界公平共享冻结容量，retry hold、同项目唯一 lease、跨 Goal circuit 和 provider draining 都在这里决定。`runtime/image-batch-scheduler.cjs` 负责每个 Goal 内的 `1–2` probe 与 `2 → 4 → configuredConcurrency` 波次，并且只有请求、资产落盘、Sharp 完整解码、非零尺寸和交付画幅都通过后才完成 token。取消和熔断只能阻止未派发请求，已被上游接受的请求仍可能完成并计费。

### 4.4 Agent 模型与生图

```text
Agent chat
  → serverChatCompletion()
  → account：所选 New API Key + accountBaseUrl/v1
  → custom：用户 Base URL + 用户 API Key
  → /v1/chat/completions 或 /v1/responses

image_gen
  → callImageGeneration()
  → electron-main.cjs serverGenerateImage()
  → callNewApiImageWithSession()
  ├─ account：所选 New API Key 直连；纯文生图优先 /v1/responses + image_generation
  └─ custom：用户图片 Key 直连；纯文生图同样优先 /v1/responses + image_generation
       （两者编辑/参考图均使用 /v1/images/edits）
  → 项目 output 资产
  → workflow action
  → Renderer 归组与溯源
```

`generate/edit/replace/variants/layers/cutout/redraw` 是桌面 Agent 的普通业务语义；远端边界是 OpenAI-compatible relay、用户会话、模型、计费和图片结果。Goal v1 刻意缩小为 `edit | replace | variants`，每个冻结 binding 按已确认的 `operationsPerAsset` 输出，总请求不超过 200；跨境电商多项矩阵接受并强制校验等长 `items`，单项矩阵改用顶层槽位/语言元数据。Goal 不接受额外 REFERENCE、layers、cutout、redraw 或运行中 SOURCE/REFERENCE 变化；Goal steer 只允许文字，范围变化必须重新预览和确认。

桌面有两种互斥但可运行时切换的接入模式：

- `account`：用户名/密码登录 SparkAPI/New API；Cookie + `New-Api-User` 只用于 `/api/user/*`、`/api/token/*`、设备授权和更新。登录后桌面列出、创建、编辑、分组、启停和删除用户密钥，并用用户选择的完整 Key 直连 `accountBaseUrl/v1`。完整 Key 优先兼容原生 New API 在 token 列表/详情中的返回值，脱敏部署则通过 `POST /api/token/:id/key` 按需取回；两者都只缓存在 Electron Main 内存，不进入 Renderer、设置文件、模型缓存或日志。`account-token-cache.json` 只按账户地址 + user ID 保存最多 8 份公开元数据快照，不保存任何 Key、Cookie、IP 白名单或模型限制。
- `custom`：用户提供 Base URL、API Key、Agent 模型和生图模型；桌面直接请求标准 `/v1/models`、`/v1/chat/completions`、`/v1/responses`、`/v1/images/generations` 与 `/v1/images/edits`，不发送 SparkAPI `group`。

两个模式共用安装级 `licenseDeviceId` 与激活令牌。切换到自定义模式不会删除账号 session，切回账号模式可以快速恢复；自定义 Base URL 已含 `/v1` 时，client 必须去重路径而不能产生 `/v1/v1/*`。Responses 请求允许标准 SSE，也允许 HTTP 200 JSON 回退；空 JSON、空 SSE 和只有 `[DONE]` 的 SSE 都必须作为空输出失败，不能伪装为 Agent 成功。

设置页数据加载是显式的离线优先边界：挂载时 `tokens({ preferCached: true })` 与 `models({ cacheOnly: true })` 只读 Main 本地快照；没有模型快照时回退到设置内模型池。切换设置分区不会联网；只有“刷新密钥与分组”“刷新模型”、密钥 CRUD 或切换密钥等明确用户动作可以请求 New API。模型磁盘快照即使超过 60 秒，在 `cacheOnly` 模式下也可用于离线显示，并标记来源/更新时间；正常运行时的 60 秒缓存规则仍保持。

账号和自定义模式的纯文生图现在使用同一传输优先级：请求图片凭据对应的 `POST /v1/responses`，顶层模型使用 `agentModel`，完整 Prompt 放入 `input`，`tools[0]` 为 `image_generation`，其中携带 `action=generate`、画幅、格式、审核、质量和 `partial_images=3`；图片模型由该工具对应的上游渠道选择。账号模式的凭据来自当前所选账户 Key 与规范化的 `accountBaseUrl/v1`，Cookie 与 `New-Api-User` 不作为模型鉴权；自定义模式使用用户图片 Key。密钥分组由 New API token 自身决定，桌面不得向模型/生图 JSON 或 multipart 注入 `group`。客户端只把索引 0–2 映射成 `1/3`、`2/3`、`3/3` 中间预览，忽略上游额外的最终态 partial，并从 `response.output_item.done.item.result` 或 `response.completed.response.output[]` 收口、去重最终图片。只有 400/404/422 明确表示 Responses、模型或 `image_generation` 工具不受支持时才回退 Images API：账号模式先尝试 `/v1/images/generations` SSE，再按明确的不支持错误回退 JSON；自定义模式直接回退非流式 JSON。HTTP 200 空流、已有 partial 后断流或不完整响应不得补发，避免重复计费。账号编辑/参考图使用 `/v1/images/edits` SSE，自定义编辑/参考图使用同端点的 multipart 非流式链路。

生图 SOURCE/REFERENCE 输入和上游图片结果的受管格式为 PNG、JPEG、WebP；`image_gen.outputFormat` 未指定时默认 PNG，未知格式由 Electron Main 在 provider 派发前拒绝。这里的“上游结果格式”属于模型请求与项目资产落盘合同，本地“另存为”属于另一条完全离线的文件链路，不能混用计费语义或资产身份。

单张画布资产的另存链路为：Renderer/`canvas.export-image` 只提交节点、槽位和目标格式 → Main 校验并物化项目受管源图 → 原生 Save 对话框取得用户目标授权 → `desktop/image-export-service.cjs` 按真实解码元数据识别源格式并在必要时使用 Sharp 转码 → 写入用户选择的位置。可选格式为 PNG、JPEG、WebP、AVIF、TIFF；JPEG 固定以白色背景展平 alpha，其余格式保留 alpha。相同格式可直接复制，跨格式转换在本机完成，不调用 Agent 或图片模型、不消耗生图额度，也不改变受管源图。新目标优先以同卷 hard-link 原子发布；文件系统不支持 hard-link 时回退到 `COPYFILE_EXCL` 排他复制，两条路径都不得覆盖并发创建的文件。确认覆盖才执行原子替换，Main 以真实父目录规范化目标锁并对所有既有目标执行锁内最终确认。分层成果原有 Photoshop PSD 导出继续独立保留，不经过单图格式转换降级。

中间图只进入 `image-preview` 进度和 Renderer 的临时 `streamingImagePreviews`。`src/streaming-image-preview.ts` 按父 operation、生成节点与一基 request slot 建立归属；分层任务为每个图层传递独立 slot；`src/main.tsx` 再通过 layout projection 把 partial 放进目标单图、批量容器、连续系列或分层占位组的 pending tile。最终图、失败或停止后按槽位清理。中间图不进入 Agent 时间线卡、主/独立 Agent 对话窗口、项目成果、会话历史或图片库。单次图片任务最多 10 张，生成与编辑统一最多 10 路并发；任何失败仍按原请求槽位返回，不把中间图伪装成最终成果。Main 只记录模型、尺寸、质量、Prompt 字符/UTF-8 字节数和 body keys 等脱敏 metadata，不记录 Prompt 内容、API Key、Cookie。

AIDebug mock 图片路径由 `electron-main.cjs` 编排，但尺寸归一化、图层提示兼容推断和确定性 PNG base64 只由 `desktop/aidebug-image-fixture.cjs` 实现；真实图片服务请求、项目资产落盘与返回 DTO 不经过该 fixture owner。

### 4.5 本机 Agent 自动化

```text
Codex / Claude Code / OpenCode / OpenClaw
  → integrations/naimage-control/scripts/naimage.ps1
  → <configRoot>/automation/endpoint.json（端口 + 每次启动随机 Token）
  → http://127.0.0.1:<random>/v1/execute
  → desktop/automation-service.cjs
  → preload naimageAutomation request/response
  → src/main.tsx 生产状态与生产动作
```

`integrations/naimage-control` 是随安装包分发的正式 Skill；设置页可检测并复制到各 Agent 的 `skills/naimage-control`。安装目录的 `.naimage-connection.json` 只保存 endpoint 文件位置与 EXE 路径，不保存 Bearer Token；CLI 每次从应用私有 endpoint 文件读取当前 Token。服务只监听 loopback，Renderer 不使用任何 AIDebug hook。`references/commands.schema.json` 是命令名、参数示例、枚举和图片格式元数据的共享注册表，由 `scripts/automation-command-reference.mjs` 生成 Renderer registry 与命令参考，Main 的格式扩展名/MIME/Save 过滤器也读取同一注册表。公开命令覆盖项目、画布状态/选择/容器/导入和 Agent 会话，并与 GUI 同步提供 `canvas.export-image`、`agent.goal`、`agent.steer`、`agent.pause`、`agent.resume`、`agent.stop`。`canvas.export-image` 只接受 `nodeId`、`assetIndex` 和 PNG/JPEG/WebP/AVIF/TIFF 格式，通过 GUI 同一原生 Save 对话框获得目标授权；命令不能传任意目标路径，本地转换不调用模型或消耗额度，真实导出失败必须作为 CLI 失败传播，只有用户取消是正常 no-op。`agent.goal` 第一次调用只返回 `requiresConfirmation`、冻结 snapshot 和 counts；第二次必须携带 `confirmed=true` 及同一预览的 `expectedSnapshotHash`，命令说明同时公开 probe、渐进放量、熔断和已接收请求仍可能计费的边界。`agent.steer.taskScopeMode` 提供常用简写，`sourceMode`/`referenceMode` 可独立选择 `keep | replace | merge | clear`，清空全部或删除所选还必须传 `confirmed=true`。`canvas.import-skill` 与画布菜单“导入 SKILL.md”通过 `naimage:project-skill:parse` 共用 `desktop/skill-import.cjs` 的解析、长度限制和 `CanvasSkill` 身份；PowerShell CLI 优先用 `-SkillPath` 在本地读取用户授权文件，只把 Markdown 和 basename 交给 Renderer，再由 Main 解析。当前只导入一个不超过 256 KiB、指令不超过 24,000 字符的 Markdown 文件，不复制同级 scripts/references/assets；绝对源路径不进入请求或 session。导入结果仍是带 Skill 元数据的 requirement，执行继续走 requirement TaskScope、输入关系和重复执行 gate。新增可自动化产品动作时必须同步 schema、Renderer handler、Skill 和 `test:automation-service`。

Graph CLI 与 GUI 共用生产画布关系实现，不维护第二套图模型。`canvas.state` 返回权威 `canvasRevision`、锁、关系和活动状态；严格 `canvas.select` 在改变选择前校验全部 ID 与 primary，不允许 stale 集合部分生效。所有图 mutation 强制 `expectedProjectId`，并可携带 `expectedCanvasRevision` 做 canvas CAS；Requirement update/execute 额外强制 `expectedRevision`。连接/断开、归组/解散、位移及 Requirement create/update 在完整节点/边集合、锁、兼容类型、循环与 binding 预校验后一次提交，任一输入 stale/非法时整批失败；execute 在异步 Agent 派发前完成 revision/TaskScope fence，provider 和结果持久化不属于图提交事务。成功 mutation 返回新 revision/receipt，后续要求严格 CAS 时必须携带最新回执。最终真实 Electron loopback CLI 证据为 `.diagnostics/electron/aidebug-graph-cli-2026-07-29T16-05-00-768Z/report.json`，配套 review/montage 位于 `.diagnostics/aidebug-review/review-graph-cli-2026-07-29T16-05-00-768Z/`；证据覆盖 Electron 内 `900x640` Renderer CSS 视口，未记录原生 BrowserWindow bounds。

### 4.6 Agent 上下文与 checkpoint

`naimage Agent = Codex 式通用 Agent Runtime + naimage 图片领域 Agent`。通用部分拥有长上下文、模型协议历史、工具循环和 checkpoint；图片领域部分拥有画布快照、TaskScope SOURCE/REFERENCE、图片容器、Image Gen 与 FastMemory 绘画经验。

```text
settings + agentModel
  → runtime/context-strategy.cjs
  ├─ GPT 5.5/5.6：272K 总窗口 / 95% 有效 / 244.8K checkpoint / Responses 历史
  ├─ Claude：200K 或明确长上下文模型 1M / 普通 messages 历史
  └─ 未知兼容模型：128K naimage-balanced
  → agent-runtime.cjs 估算 Prompt + tools + history + world state
  → 达到策略阈值时生成 handoff summary
  → runtime/memory-store.cjs 替换旧 protocol foundation
  → 清除旧 encrypted reasoning，保留有界用户意图
  → 新窗口重新注入当前 Workbench、TaskScope 和 FastMemory
```

GPT/Codex 不再按固定 32K 或消息条数过早压缩。单条 Responses 用户消息预算由策略提供，不能重新退回固定 12K 字符；否则长需求文档会在达到模型窗口前被静默截断。Claude 请求不得包含 `responses_items`，也不得因暴露 Responses 原生 `web_search` 被强制路由到 `/v1/responses`。策略专项入口是 `test:context-strategy` 与 `test:context-checkpoint`。

### 4.6.1 Agent 面板布局与拖动

```text
设置中的 agentPanelPlacement/Width/Height/X/Y
  → src/agent-panel-layout.ts 读取并约束布局
  → right / left / top / bottom / floating（应用内）
  → pointermove 只更新 drag ref
  → requestAnimationFrame 写入 --agent-panel-preview-* CSS variables
  → pointer release 才提交 React state 与设置持久化
```

`src/agent-panel-layout.ts` 是布局计算、停靠转换、边界限制和 CSS preview 的唯一 owner；`main.tsx` 只编排 pointer capture 与提交。上/下停靠调整高度，左/右停靠调整宽度。`floating` 明确指主 Renderer 内浮动；可拖出主窗口的独立 Electron `BrowserWindow` 由下述窗口服务和 IPC 链路单独拥有。面板专项入口为 `test:agent-panel-layout` 和 `test:agent-panel-ui`。

独立窗口链路已经建立：

```text
主 Renderer（唯一 Agent/画布/项目状态 owner）
  → 按需加载 src/agent-window-sync.ts
  → 有界、脱敏 AgentWindowSnapshot（含 glassAppearance）
  → preload.cjs / window.naimageAgentWindow.publishState
  → desktop/ipc/window-ipc.cjs "naimage:agent-window:publish-state"
  → desktop/agent-window-service.cjs owner 校验、序列化边界与 latestState 中继
  → agent-window-preload.cjs
  → agent-window.html + agent-window-renderer.js
  → 用户命令经相反方向回到主 Renderer 执行
```

独立窗没有 Node integration，不持有 API Key、Cookie、项目写权限或第二个 Agent Runtime。它支持发送，以及运行中的修改、暂停/恢复和真实结束；也支持会话切换、新建/清理、原图/参考图入口、FastMemory 入口和收回五种主窗口位置。涉及图片选择或记忆编辑时服务先聚焦主窗口。独立窗关闭后主面板自动展开，主 Renderer 销毁时独立窗同步关闭。快照 JSON 最大 16 MiB、命令最大 512 KiB，消息/提示词/中间预览还有 Renderer 侧逐字段上限。

主 Renderer 是外观与设置的唯一权威：它把 `settings.glassTheme`、`settings.glassMaterial` 和 `settings.glassParameters` 交给 `buildAgentWindowSnapshot()`，由同一 `glassAppearanceProjection()` 生成 `glassAppearance.{glassTheme,glassMaterial,glassParameters,mode,resolvedAccent,variables}`。Main 只做 owner 校验、大小限制和序列化中继；独立 `agent-window-renderer.js` 再校验主题/材质/强调色枚举，并只接受 `glassVariableNamePattern` allowlist 内的 CSS 变量后投影根节点。独立窗不得读取或写入主窗口的 bootstrap snapshot，也不得成为设置持久化 authority；打开后或主窗口外观变化时，只镜像最新发布快照。主窗口的 React 前 bootstrap 负责主画布首帧无闪烁；独立窗在创建时先由 Main 从已保存设置解析主题 canvas 原生底色，再在收到首份 state 后补齐完整 Glass 变量镜像。设置保存后的 `onSettingsSaved` 会同步更新所有存活 BrowserWindow 的原生底色，两条路径都不能被误写成第二套主题设置系统。专项入口为 `test:glass-theme`、`test:agent-window`、`test:ipc-registration` 与 `test:agent-window-ui`。

### 4.6.2 声明式插件、电商套图计划、Project Graph 与科研绘图

```text
plugins/builtin-manifests.json
  → desktop/plugin-state.cjs + src/plugin-state.ts 双侧清洗安装状态
  → 设置页安装 / 授权 / 启用 / 停用 / 卸载
  → 启用插件时动态 import src/plugin-system.ts
  → PluginCommandRegistry 在执行前复核安装状态、启用状态和权限
  → 画布顶部 toolbar contribution
  ├─ plugins/commerce-set-schema.json
  │    → src/plugins/commerce-set.ts 归一化 generate/translate 计划、请求矩阵、费用计数和稳定 snapshot material
  │    → desktop/plugin-task-prompts.cjs 读取同一语言与上限注册表
  ├─ src/commerce-set-dialog.tsx（自然异步完整配置表面）
  │    → src/commerce-translation-dialog.tsx 保留现有翻译命令兼容适配
  │    → preload "naimage:plugin:compose-task"
  │    → desktop/ipc/plugin-ipc.cjs
  │    → desktop/plugin-task-prompts.cjs
  │    → Renderer sendPrompt() → 按语言形成独立结果组
  ├─ preload "naimage:project-graph:import"
       → desktop/project-graph-adapter.cjs 只读 .prg/JSON
       → desktop/plugin-task-prompts.cjs 生成有界 GRAPH Prompt
       → 返回 graph + task DTO
       → Renderer sendPrompt() → 按概念分支形成独立学习图片
  └─ sparkai.scientific-figure.start-workflow
       → desktop/plugin-task-prompts.cjs 生成 Python/R 单后端科研绘图契约
       → Renderer sendPrompt() → Agent 收集结论、证据、Panel、导出与 QA 要求
```

插件只接受随应用发布的受信任声明式 manifest，不允许任意 JavaScript 注入 Renderer，也没有项目文件写权限。插件命令只能经主 Renderer 已登记的 handler 调用现有产品动作；`sparkai.commerce-toolkit` 申请 `canvas.read-selection`、`agent.submit-task`、`canvas.write-results`。`plugins/commerce-set-schema.json` 是电商语言、单次请求上限、probe/ramp 策略和默认七张套图槽位的共享注册表；`src/plugins/commerce-set.ts` 提供 generate/translate 两种计划、单/多母图矩阵、请求/费用计数及按有序 SOURCE 生成的稳定 snapshot material。`src/commerce-set-dialog.tsx` 位于现有自然异步插件 chunk，支持整套张数、逐图标题/Prompt、目标语言与逐语言提示、Requirement/Skill 保存意图和执行前 probe/费用风险预览；跨境电商工具栏的一键套图与一键多国语言均已接入主 Renderer 和共享 command runtime，确认派发后可落盘 Requirement/Skill，并可从对应节点按同一 Goal 两阶段协议复用执行。`src/commerce-translation-dialog.tsx` 继续作为旧翻译入口的兼容适配层。`sparkai.project-graph` 申请 `project.read-graph`、`agent.submit-task`、`canvas.write-results`；它显式清空画布/附件继承，只把导入 GRAPH 作为知识 SOURCE。`.prg` 是 ZIP，适配器只读取最大 16 MiB 的 `stage.msgpack`，最多输出 1000 节点和 3000 关系，不读取附件、不执行扩展、不暴露绝对路径、不修改 `.prg` 或 session。`sparkai.scientific-figure` 以 `plugins/builtin/sparkai.scientific-figure/` 作为可拆包目录，只内置 Agent 工作流契约和 Apache-2.0 notice，不打包上游图库、示例或 Python/R 依赖；定量绘图必须先选择 Python 或 R，之后同一任务不得混用后端，也不得虚构实验值或统计。插件命令的长 Prompt 统一由 `desktop/plugin-task-prompts.cjs` 在受信任 Electron 侧生成；Renderer 只保留计划配置、对话框和有界 task DTO 消费，`src/plugin-system.ts` 仍按启用状态动态加载。专项入口为 `test:commerce-set`、`test:plugin-system`、`test:project-graph` 与 `test:ipc-registration`。

### 4.6.3 自定义主题导入、导出与实时应用

```text
src/theme-palette-picker.tsx
  ├─ 编辑 light/dark 各 10 个 --theme-* 语义颜色
  ├─ draftSettings.customTheme → applyTheme() → 主画布实时预览
  └─ window.naimageConfig importThemePreset/exportThemePreset
       → preload IPC "naimage:theme:import|export"
       → desktop/ipc/config-ipc.cjs
       → desktop/theme-preset-service.cjs
       → Electron native open/save dialog

保存设置
  → AppSettings.customTheme + themePalette="custom"
  → Renderer/Electron 双侧 normalizeCustomThemePreset
  → 独立 Agent 快照同步 light/dark 自定义颜色
```

文件契约固定为 `naimage-theme v1`，最大 64 KiB，名称最多 48 字符，浅色和深色必须各包含 10 个完整语义键；颜色只接受 `#RGB` 或 `#RRGGBB`，解析后统一为小写 `#RRGGBB`。不接受 CSS、URL、额外执行内容或不完整模式；导入失败只返回清洗后的错误，不覆盖当前 draft。Renderer 不读取任意路径，导入/导出都由用户通过原生对话框明确选择。专项入口为 `test:theme-preset`、`test:settings-persistence`、`test:agent-window` 与快速 `aidebug:gui` 外观/上下文冒烟。

### 4.7 项目 session 保存

```text
Renderer 自动保存 / 显式保存
  → window.naimageConfig.saveSession(session v5, revision + writerId + observedRevision + 已确认 baseline)
  → preload IPC "naimage:config:save-session"
  → desktop/ipc/config-ipc.cjs
  → electron-main.cjs 注入项目服务
  → desktop/project-store.cjs 解析 active project、session/manifest 路径和 manifest v2
  → desktop/project-session-normalizer.cjs 清洗 session v5、journal/checkpoint/barrier、容器与资产身份
  → desktop/project-asset-repository.cjs hydrate/save 项目资产索引
  → projectSessionSaveCoordinator.enqueue(projectId, requestedRevision, apply)
       ├─ Renderer 与 Main 均按项目串行，避免重叠保存跨过 mutation baseline
       ├─ 首次从磁盘读取 initialRevision
       ├─ Main 比较 baseline 与当前节点并生成 upsert/delete/restore
       ├─ 正常写入也与最新磁盘 journal 合并并分配 commitRevision
       ├─ requestedRevision <= currentRevision 时转入 stale-save 合并
       └─ apply 成功后推进内存 revision 并回传已提交 journal
  → desktop/project-session-merge.cjs 按 persistenceOriginId 应用决定性事件
       ├─ delete tombstone 阻止旧窗口复活节点
       ├─ 显式 undo 以 restore 恢复已观察的 tombstone
       ├─ 不同顶层字段按 mutation clock 合并，同字段按 Main 提交顺序决胜
       ├─ 只有本次真实 writer 刷新 checkpoint；30 天未活跃 writer 退出 GC quorum
       └─ 全部活跃 writer 确认后把 delete/restore 收敛为 compact causal barrier
  → 原子 JSON 写入 + project manifest 更新
```

`desktop/project-save-coordinator.cjs` 只协调顺序和 revision，不决定 session 内容、不直接选择文件路径。`desktop/project-session-merge.cjs` 是 Main 的 baseline 比较、事件采集/compact、字段时钟、提交顺序、tombstone/restore、writer checkpoint、causal barrier 与 stale-save 合并 owner；Renderer 只保存最近一次已确认 baseline 和 Main 回传的权威 mutation 状态。`project-store.cjs` 拥有项目列表、路径和 manifest；session 清洗与资产索引分别只有一个 owner。`apply` 返回 `applied:false` 时不得推进 revision。该机制已由 `test:project-session-dual-renderer` 通过生产 save IPC 覆盖 edit/edit、edit/delete、delete/undo、连续快速保存和回执前后窗口销毁。它仍只保护同一 Electron Main 进程，不是递归字段或远程多人协作 CRDT；assets、生成终态/进度和 provenance 保留专用兼容策略。

### 4.8 图片导入与输出

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

### 4.9 在线更新

```text
Renderer UpdaterBridge
  → electron-main.cjs checkDesktopUpdate()
  → /api/desktop-update/check
  → 验证 product/version/compatibility/hash/size/signature
  → restart ASAR 或完整 installer 下载授权
  → update helper / launcher
  → 健康标记与失败回滚
```

版本来自 `package.json.version`，restart 兼容标识来自 `naimageUpdateCompatibility`。签名规范化由 `update-release.cjs` 与打包公钥共同约束。客户端在检查、验证码与下载授权中都显式声明 `product: naimage-studio` 和 `X-Naimage-Desktop-Product`；发布链只签发和校验 `naimage-studio` 产品身份的 manifest 与制品。更新服务默认由 `https://sparkapi.org` 提供，GitHub 私有仓库的 PAT/Actions 私钥只能留在服务端或发布工作流，不能进入安装包。

品牌迁移首版为 `1.0.5`，`naimageUpdateMinimumVersion` 也固定为 `1.0.5`。当前 `naimage` 1.0.4 客户端即使 compatibility 相同也必须走完整 installer，不能只替换 ASAR；更名前客户端不再拥有网络别名，需手工安装当前版本。

## 5. 模块登记

### 5.1 进程与桌面模块

| 路径 | Owns | Must not own | 关键检索词 | 主要验证 |
| --- | --- | --- | --- | --- |
| `electron-main.cjs` | Electron 生命周期、桌面服务依赖装配、远端账户/图片编排、模型缓存和 runtime 工厂 | React UI、画布 reducer、内联 IPC handler、重复实现 project store/session normalization/asset repository、New API transport/client 或 AIDebug PNG fixture | `registerIpc`, `createWindow`, `serverChatCompletion`, `callNewApiImageWithSession` | `test:ipc-registration`, `test:project-io`, `test:new-api-transport`, `test:lifecycle`, `test:update`, `aidebug:gui` |
| `preload.cjs`, `agent-window-preload.cjs` | 主 Renderer 七组受限 context bridge，以及独立 Agent 表面的 state/command 单用途桥 | 业务状态、磁盘实现、凭据展示、第二个 Agent Runtime | `naimageConfig`, `naimageServer`, `naimageUpdater`, `naimageAgent`, `naimageAutomation`, `naimageAgentIntegrations`, `naimageAgentWindow`, `naimageAgentWindowSurface` | `test:ipc-registration`, `test:agent-window`, `test:lifecycle`, `aidebug:gui` |
| `desktop/ipc/register-desktop-ipc.cjs`, `desktop/ipc/*-ipc.cjs` | Settings → Plugin → Automation → Updater → Session → Agent → Window → Debug → Project → Asset → Server 的固定注册顺序和各域 handler | 桌面服务实现、React 状态、跨域业务复制；依赖必须由 Main 显式注入 | `registerDesktopIpc`, `registerPluginIpc`, `registerAutomationIpc`, `registerSettingsIpc`, `registerAgentIpc`, `registerAssetIpc`, `registerServerIpc` | `test:ipc-registration`, `test:lifecycle`, `aidebug:gui` |
| `agent-runtime.cjs` | Prompt/画布上下文组装、模型感知 checkpoint/model/tool 协议循环、工具执行、runtime action 编排 | React state、窗口原语、直接画布 mutation、SQLite/JSON memory CRUD、重复实现已抽出的策略/schema/响应解析/图片帧/观察副本规则 | `createAgentRuntime`, `chat`, `runTool`, `buildPromptMessages`, `compactConversationIfNeeded` | `test:context-checkpoint`, `test:agent-text`, `test:agent-protocol`, `test:view-image` |
| `desktop/agent-run-control.cjs` | 按项目/会话/Renderer owner 持有父运行取消、暂停、节点锁、有界 steer 队列与可中断 child phase；owner/global 停止和空闲 scope 回收 | 模型/工具执行、协议历史、React UI 或项目持久化 | `createAgentRunControl`, `beginPhase`, `consumeSteers`, `steer`, `stopOwner`, `stopAll`, `isRunnable` | `test:agent-run-control`, `test:agent-steer`, `test:lifecycle`, `test:ipc-registration` |
| `desktop/project-store.cjs` | 项目列表与 active/default 项目、项目目录/session/manifest v2、当前元数据路径，以及更名前元数据的只读迁移 | session 字段清洗、资产扫描/hydration、保存队列或 IPC | `createProjectStore`, `projectSessionFromDisk`, `writeProjectManifest`, `ensureProjectFiles` | `test:project-io`, `test:project-save-coordinator` |
| `desktop/project-session-normalizer.cjs` | session v5、node mutation journal/writer checkpoint/causal barrier、node/message 清洗、资产身份修复、容器迁移、pending execution 兼容 | 项目路径选择、磁盘 IO、资产扫描或 IPC | `sanitizeSession`, `hydrateSessionAssets`, `repairSessionAssetIdentities`, `sanitizePersistedPendingAgentExecution` | `test:project-io`, `test:asset-identity`, `test:image-container`, `test:node-mutation-journal` |
| `desktop/project-session-merge.cjs` | 已确认 baseline 间的 mutation 事件采集/compact、stale-save 合并、节点 ID 重映射、字段 mutation clock、Main commitRevision、delete/restore barrier、writer checkpoint 30 天保留与安全 GC | React 状态、磁盘 IO、保存队列或远程协作 | `collectNodeMutationEvents`, `mergeProjectSessions`, `normalizeNodeMutationJournal`, `mergeNodeMutationWriterCheckpoints`, `compactNodeMutationJournal` | `test:project-session-merge`, `test:project-session-dual-renderer`, `test:node-mutation-journal`, `test:project-io` |
| `desktop/project-asset-repository.cjs` | 项目 asset index、recorded paths、session hydrate 与保存归一化；新写入使用 `naimage-asset:` 与 `.naimage/assets`，读取兼容更名前资产 | 项目列表、manifest 版本、package/export/import 或 IPC | `createProjectAssetRepository`, `buildProjectAssetIndex`, `projectAssetRoots`, `projectWritableAssetRoots`, `sessionForProjectSave`, `sessionWithProjectAssets` | `test:project-io`, `test:project-save-coordinator` |
| `desktop/project-package-service.cjs` | `.naimage` 项目包校验、大小/数量限制、可移植资产收集、导出写入、旧包导入恢复与路径重写 | 项目列表、active project、IPC/dialog 或普通 session 保存队列 | `createProjectPackageService`, `packageProject`, `validateProjectPackageData`, `sessionFromPackage`, `importProjectPackage` | `test:project-io`, `test:project-save-coordinator` |
| `desktop/project-graph-adapter.cjs` | 只读 `.prg` ZIP/`stage.msgpack` 与有界图结构 JSON 解析、Project Graph 对象引用还原、安全 DTO | 扩展执行、附件读取、Renderer、Agent 调用、项目/session 写入或绝对路径暴露 | `parseProjectGraphFile`, `parseProjectGraphBuffer`, `adaptSerializedStage` | `test:project-graph`, `test:ipc-registration` |
| `desktop/plugin-task-prompts.cjs`, `desktop/ipc/plugin-ipc.cjs` | 受信任内置插件的长 Prompt、语言/GRAPH 输入清洗和 task DTO 生成；插件 compose IPC 只公开有界结果 | Renderer UI、插件安装状态、图片请求、项目/session 写入或任意外部插件代码 | `composePluginTask`, `projectGraphTask`, `projectGraphPromptPayload`, `registerPluginIpc` | `test:plugin-system`, `test:project-graph`, `test:ipc-registration`, `test:bundle` |
| `desktop/theme-preset-service.cjs` | `naimage-theme v1` schema、十六进制颜色归一化、64 KiB 限制、原生导入/导出对话框与安全文件名 | Renderer 状态、CSS 应用、任意 CSS/URL/脚本解释或未授权路径访问 | `normalizeCustomThemePreset`, `parseThemePresetJson`, `createThemePresetService` | `test:theme-preset`, `test:settings-persistence`, `test:ipc-registration`, `aidebug:gui` |
| `runtime/glass-theme-presets.json`, `runtime/glass-theme-settings.cjs`, `public/glass-theme-bootstrap.js` | 六主题/三材质/强调色/范围 registry、Electron 归一化与原生窗口底色、React 前安全首帧投影 | React/画布状态、凭据或项目数据；bootstrap 不得信任 snapshot 内任意变量，启动期 registry 镜像不得静默漂移 | `naimage-glass-theme-registry`, `normalizeGlassThemeSettings`, `nativeWindowBackgroundColor`, `bootstrapNaimageGlassAppearance` | `test:glass-theme`, `test:settings-persistence`, `test:agent-window`, `test:ipc-registration`, `test:lifecycle`, `test:bundle` |
| `desktop/project-save-coordinator.cjs` | 按项目串行保存、revision 规范化、旧写入拒绝 | session 清洗、路径选择、磁盘格式 | `createProjectSaveCoordinator`, `normalizeSessionRevision`, `enqueue` | `test:project-save-coordinator`, `test:project-io` |
| `desktop/model-catalog.cjs` | 模型响应解析、大小写去重、Agent/Image 默认模型选择、缓存键与缓存归一化 | 网络请求、磁盘缓存时机、IPC | `uniqueModelIds`, `modelIdsFromResponse`, `splitModelSettings`, `cachedModelSettings` | `test:model-catalog`, `test:new-api-transport`, `test:lifecycle` |
| `desktop/agent-responses-adapter.cjs` | Chat Completions 请求到 Responses API input/tool/tool-choice 的纯转换 | HTTP、流读取、凭据或重试 | `responsesRequestFromChatRequest`, `responsesInputFromChatMessages`, `responsesToolsFromChatTools` | `test:agent-responses-adapter`, `test:agent-protocol` |
| `desktop/aidebug-image-fixture.cjs` | AIDebug mock 图片尺寸归一化、显式/旧 prompt 图层提示与确定性 PNG base64 | 真实图片服务、项目资产、用户图片、GUI suite 编排或 Main 生命周期 | `aidebugImageBase64`, `aidebugLayerFixtureHint` | `test:new-api-transport`, `aidebug:image-recovery`, `aidebug:gui` |
| `desktop/image-export-service.cjs` | PNG/JPEG/WebP/AVIF/TIFF 真实解码格式识别、schema 驱动的 Save 过滤器/扩展名/MIME、Sharp 本地转码、no-clobber 发布与确认后的原子替换；JPEG 白底展平 | 原生对话框、项目资产授权、Renderer 状态、模型请求、计费或 PSD 分层导出 | `IMAGE_EXPORT_FORMATS`, `convertImageForExport`, `decodedImageExportFormat`, `imageExportFilters`, `normalizeImageExportFormat` | `test:image-export`, `test:automation-service`, `test:ipc-registration` |
| `desktop/skill-import.cjs` | 单文件 SKILL.md frontmatter/正文解析、显式大小与字段限制、稳定内容 fingerprint，以及原生文件选择/读取 | React mutation、任意 YAML 执行、同级 Skill 资源复制或 TaskScope 执行 | `parseCanvasSkillMarkdown`, `canvasSkillContentFingerprint`, `MAX_SKILL_*`, `importSkillFromDialog` | `test:skill-import`, `test:automation-service`, `test:ipc-registration` |
| `desktop/ipc/update-ipc.cjs` | 桌面更新 IPC channel 注册、操作错误到公开失败 DTO/进度事件的映射 | 更新清单校验、下载、回滚或安装进程实现 | `registerUpdateIpc` | `test:ipc-registration`, `test:update`, `test:update-rollback` |
| `desktop/new-api-transport.cjs` | 默认 Node HTTP、显式应用代理时的 Windows curl、请求/响应大小限制、流取消、活跃 curl 生命周期 | 设置持久化、登录、重试策略、Updater 状态；不得读取或修改 Git/系统全局代理 | `createNewApiTransport`, `newApiTransportFetch`, `stopActiveNewApiCurlTransports` | `test:new-api-transport`, `test:lifecycle` |
| `desktop/new-api-client.cjs` | New API URL、会话 cookie、重试、JSON request、managed relay JSON/SSE、Images SSE、Responses image_generation partial/final 解析与受限回退分类 | 账户 UI、模型选择、图片落盘、raw socket/curl 实现 | `createNewApiClient`, `newApiFetch`, `newApiRequest`, `newApiRelayStream`, `newApiRelayImage`, `newApiRelayResponsesImage` | `test:custom-api-transport`, `test:new-api-transport`, `test:agent-protocol`, `test:lifecycle` |
| `desktop/account-token-service.cjs` | New API `/api/token/*` 列表/选择/CRUD、原生 token 响应与脱敏 `/key` 扩展兼容、按账户隔离的公开元数据磁盘快照、所选 token 元数据持久化、完整 Key Main-only 内存缓存与账号 `/v1` credentials | Renderer 表单、模型请求体、项目数据、磁盘 Key/Cookie/IP 白名单/模型限制或日志 | `createAccountTokenService`, `credentials`, `ensureSelection`, `list`, `select` | `test:account-token`, `test:settings-lazy-load`, `test:ipc-registration`, `typecheck` |
| `desktop/automation-service.cjs` | loopback HTTP 服务、每次启动随机 Bearer Token、endpoint 文件、Renderer 请求关联与超时 | 业务命令实现、AIDebug hook、远端监听或长期 Token | `createAutomationService`, `rendererReady`, `resolveRendererResponse` | `test:automation-service`, `test:ipc-registration`, `test:bundle` |
| `desktop/agent-integration-service.cjs`, `integrations/naimage-control/` | Agent 配置目录检测、内置 Skill/PowerShell CLI 安装更新和受控移除 | 修改 Agent 全局设置、读取/输出 endpoint Token、直接编辑项目文件 | `createAgentIntegrationService`, `naimage.ps1`, `SKILL.md` | `test:agent-integration`, `test:automation-service`, Skill `quick_validate.py`, `test:bundle` |
| `desktop/agent-window-service.cjs`, `agent-window-*` | 独立 Agent BrowserWindow 生命周期、已保存主题原生底色、主 Renderer owner 绑定、有界状态/命令中继、allowlist 外观镜像与隔离表面 | Agent Runtime、模型请求、项目写入、凭据、画布 reducer 或第二个设置 authority | `createAgentWindowService`, `getBackgroundColor`, `publishState`, `forwardCommand`, `applyGlassAppearance`, `naimageAgentWindowSurface` | `test:glass-theme`, `test:agent-window`, `test:agent-window-ui`, `test:ipc-registration`, `test:lifecycle` |
| `desktop/license-service.cjs` | 安装设备 ID 授权状态、激活/校验端点选择、24 小时缓存与 72 小时离线宽限 | 激活码生成、数据库、账户计费、Renderer 表单 | `createLicenseService`, `verify`, `activate`, `requireActive` | `test:license`, `test:ipc-registration`, `aidebug:gui` |
| `runtime/context-strategy.cjs` | 模型族识别、上下文窗口、有效窗口、自动 checkpoint、保留用户意图及 Prompt/协议/画布/记忆预算 | 模型调用、消息持久化、设置 UI 或画布读取 | `contextStrategyForSettings`, `contextModelFamily`, `autoCompactTokenLimit`, `protocolMessageMaxChars` | `test:context-strategy`, `test:context-checkpoint` |
| `runtime/memory-store.cjs` | SQLite 初始化与 CRUD、Prompt/FastMemory/memorycontext/datememory JSON、context/experience、toolmemory、conversation summary/protocol 持久化、协议基础替换和按会话清理 | 模型调用、compact 决策、画布状态、工具执行或 Renderer | `createMemoryStore`, `getFastMemory`, `appendConversationProtocolTurn`, `replaceConversationProtocolItems` | `test:context-checkpoint`, `test:agent-text`, `test:agent-protocol` |
| `runtime/tool-schemas.cjs` | 公开/内部 Agent tool schema、图片模型工具契约与 schema 选择 | 模型请求发送、工具执行、Prompt 或 runtime 状态 | `agentToolSchemas`, `toolSchemas`, `imageModelContractForSettings` | `test:agent-text`, `test:agent-protocol` |
| `runtime/responses-parser.cjs` | Chat/Responses 非流式响应归一化、文本/推理 delta 读取、tool-call 与 Responses output 流式聚合 | HTTP/SSE 读取、原生工具进度编排、Agent loop 或工具执行 | `messageFromResponse`, `responseFromStreamChunks`, `mergeResponsesToolCallEvent` | `test:agent-text`, `test:agent-protocol` |
| `runtime/controlled-shell-command.cjs` | `shell_command` 的只读 allowlist、cwd/路径越界防护、输出裁剪和无 shell 子进程执行 | Agent loop、模型 Prompt、Renderer、IPC 或任意写入命令 | `controlledCommandPlan`, `executeControlledCommand`, `isExploreCommand` | `test:controlled-shell-command`, `test:agent-text`, `test:agent-protocol`, `aidebug:gui` |
| `runtime/image-frame.cjs` | Image 2 比例、分辨率、质量与 delivery/request size 归一化 | 模型请求发送、项目资产落盘 | `normalizeImage2Size`, `normalizeImageToolFrame`, `validateImageFrameFields` | `test:agent-text`, `test:agent-protocol` |
| `runtime/image-batch-normalization.cjs` | `image_gen` 单项 `items` 兼容提升、占位项过滤、真实批次数与逐项画幅归一化 | 模型调用、图片服务请求、工具进度或画布 action | `createImageBatchNormalization`, `normalizeSingleImageItemCompatibility`, `normalizeImageBatchItems` | `test:agent-text`, `test:agent-protocol` |
| `runtime/goal-image-execution.cjs` | 冻结 Goal TaskScope 的严格校验、1–2 个不同容器代表图排序与 runtime SOURCE job 展开 | UI 确认、图片请求、落盘/解码实现、模型自行枚举 binding 或第二次 Goal 工具调用 | `validateFrozenGoalTaskScope`, `goalSourceJobs`, `goalScopeExecutionValue` | `test:goal-runtime`, `test:goal-task-scope`, `test:agent-text` |
| `runtime/goal-probe-admission.cjs` | Main 进程 Goal probe/ramp 准入、冻结容量、公平 wave、retry hold、同项目 lease、跨 Goal circuit 与 provider draining | Agent 生命周期/steer 语义、图片 transport 实现、Renderer UI | `createGoalAdmissionControl`, `createGoalProbeAdmission` | `test:goal-probe-admission`, `test:image-batch-scheduler`, `test:goal-probe-dual-renderer` |
| `runtime/view-image-payload.cjs` | `view_image` 允许根、安全读取、格式/尺寸识别、批量 payload 预算与 WebP 观察副本 | 会话持久化、画布预览、原图覆盖 | `prepareViewImageModelPayload`, `viewImagePathAllowed`, `viewImagePayloadBudgetForBatch` | `test:view-image`, `test:agent-protocol` |
| `update-release.cjs` | 更新清单 canonical text | 下载、安装、UI | `canonicalDesktopRelease` | `test:update`, `release:verify`, `package:update-e2e` |
| `src/server.ts` | Vite/AIDebug 浏览器服务回退 | 正式 Electron 文件系统或完整 Agent bridge | `installBrowserServerBridge`, `LOCAL_NEW_API_PROXY` | `build`, `aidebug:gui`, `test:new-api-transport` |

### 5.2 Renderer 核心模块

| 路径 | Owns | Must not own | 关键导出/检索词 | 主要验证 |
| --- | --- | --- | --- | --- |
| `src/main.tsx` | App 状态、画布交互、项目/会话、Agent 调用、runtime action 落地和跨域编排 | 主进程文件 IO、真实 relay token、已抽出表面的内部实现 | `App`, `sendPrompt`, `applyRuntimeActions` | `build`, `aidebug:gui` 及对应专项 suite |
| `src/glass-theme.ts`, `src/glass-theme-provider.tsx` | Glass 设置归一化、主题/材质转换、根 datasets/classes/CSS variables 投影，以及不增加 DOM wrapper 的状态保持 Provider | 画布/项目 mutation、组件 remount、Electron IO、独立窗设置持久化或任意 CSS 执行 | `normalizeGlassThemeSettings`, `glassAppearanceProjection`, `applyGlassAppearanceToRoot`, `GlassThemeProvider` | `test:glass-theme`, `test:settings-persistence`, `test:agent-window`, `typecheck`, `build` |
| `src/workspace-chrome.tsx` | 自然异步 Workbench/Focus/Review 切换器、项目搜索、正式左素材栏、任务摘要与只读成果投影；Focus 只请求打开已有成果编辑器，Review 把当前方向交回 canonical 选择 | 第二份画布/会话/选择状态、节点 mutation、项目持久化、图片请求/计费或 canonical canvas 生命周期 | `WorkspaceDirectionSwitcher`, `WorkspaceSearch`, `WorkspaceAssetRail`, `WorkspaceTaskContext`, `WorkspaceFocusStage`, `WorkspaceReviewGrid` | `test:workspace-glass-ui`（50 cases）, `typecheck`, `build`, `aidebug:glass-workspace` |
| `src/core.ts` | 共享类型与 bridge contract、session v5 mutation event/checkpoint/barrier 类型、会话清洗、图片/mask 与画布纯逻辑；保留资产/paste 兼容重导出 | React 渲染、长运行 Agent 状态、设置持久化与 alpha 归一化的新实现 | `ThemeChoice`, `ThemePaletteChoice`, `WorkflowNode`, `NodeMutationEvent`, `NodeMutationWriterCheckpoint`, `NodeMutationBarrier`, `AgentTaskScope`, `ConfigBridge`, `AgentBridge` | `typecheck`, `test:agent-text`, `test:layer-alpha`, `test:node-mutation-journal` |
| `src/automation-command-runtime.ts`, `src/automation-command-registry.ts` | 懒加载 Renderer 自动化命令分派与 schema 生成的命令名注册表；Agent steer 与 GUI 共享 SOURCE/REFERENCE 模式 | loopback 鉴权、PowerShell 进程、React 状态所有权或手工维护第二份命令清单 | `executeAutomationCommand`, `AutomationCommandContext`, `AUTOMATION_RENDERER_COMMAND_NAMES` | `test:automation-service`, `typecheck`, `build`, `test:bundle` |
| `src/project-agent-composer.tsx` | 自然异步的主 Agent 输入表面、运行控制和可见 TaskScope keep/replace/merge/clear 选择；每次 steer/运行结束重置自动模式 | Agent 执行、画布 mutation、IPC 或 run record | `ProjectAgentComposer` | `test:agent-panel-ui`, `test:automation-service`, `typecheck`, `build`, `test:bundle` |
| `src/goal-mode.ts` | Goal 预览、计数/费用摘要和公开 CLI 确认 DTO | live runtime 展开、图片请求或 React 状态 | `createGoalModePreview`, `publicGoalModePreview` | `test:goal-task-scope`, `test:automation-service`, `typecheck` |
| `src/layer-alpha-normalization.ts` | 图层 RGBA alpha 像素归属归一化、透明图层互斥重建与归一化报告 | 分层合成编排、mask 生成、`core.ts` façade 重导出 | `normalizeLayerAlphaPixelBuffers`, `normalizeTransparentLayerAlphaExclusivity` | `test:layer-alpha`, `test:layer-mask-replay`, `typecheck`, `build`, `test:bundle` |
| `src/settings-persistence.ts` | 默认设置、明暗/11 套调色盘/自定义主题与旧字段迁移、Glass bootstrap v1 安全快照、首个 React frame 安全外观 seed、上下文策略预算、模型池清洗、Storage Keys、`readJson`/`writeJson` | Electron 磁盘设置、远端账户状态、主题文件 IO；bootstrap snapshot 不得包含凭据、Prompt 或项目数据，也不得覆盖非外观设置 | `defaultSettings`, `mergeSettings`, `glassThemeBootstrapSnapshot`, `readGlassThemeBootstrapSnapshot`, `settingsWithGlassBootstrap`, `writeGlassThemeBootstrapSnapshot`, `STORAGE_*` | `test:glass-theme`, `test:settings-persistence`, `test:context-strategy`, `test:theme-preset`, `typecheck`, `build` |
| `src/plugin-state.ts`, `desktop/plugin-state.cjs` | Renderer/Electron 插件安装状态、授权集合和启用状态清洗镜像 | manifest 解析、命令执行、UI 或项目修改 | `normalizePluginStates`, `normalizePluginPermissions` | `test:plugin-system`, `test:settings-persistence` |
| `src/plugin-system.ts`, `plugins/builtin-manifests.json` | 受信任 manifest、生命周期操作、权限复核、命令注册表与工具栏 contribution；按启用状态动态加载 | 任意脚本执行、直接 session 写入、Agent Runtime 或文件 IO | `PluginCommandRegistry`, `activePluginToolbarItems`, `installBuiltinPlugin` | `test:plugin-system`, `typecheck`, `build`, `test:bundle` |
| `plugins/commerce-set-schema.json`, `src/plugins/commerce-set.ts`, `src/commerce-set-dialog.tsx`, `src/commerce-translation-dialog.tsx` | 跨境电商共享语言/限制/默认槽位、generate/translate 计划归一化、请求矩阵/费用计数、稳定 snapshot material、完整自然异步配置 UI 与旧翻译入口适配 | Agent/automation 执行、SOURCE 冻结、图片网络请求、Requirement/Skill 落盘、插件权限或画布 reducer | `normalizeCommerceSetPlan`, `buildCommerceSetMatrix`, `commerceSetRequestCounts`, `commerceSetSnapshotMaterial`, `CommerceSetDialog` | `test:commerce-set`, `test:plugin-system`, `typecheck`, `build` |
| `src/theme-palette-picker.tsx` | 11 套配色选择、自定义主题名称、浅/深色 10 项编辑、导入/导出/恢复交互 | 文件 IO、schema 权威校验、任意 CSS 解释或设置磁盘写入 | `ThemePalettePicker`, `defaultCustomTheme`, `transferTheme` | `test:theme-preset`, `test:settings-persistence`, `test:ui-foundation`, `aidebug:gui`, `build`, `test:bundle` |
| `src/agent-panel-layout.ts` | Agent 面板设置读取、四向停靠/应用内浮动转换、边界限制、pointer delta 与 CSS preview variables | React 状态、Electron 独立窗口、设置磁盘 IO | `agentPanelLayoutFromSettings`, `agentPanelLayoutForPlacement`, `agentPanelLayoutFromPointer`, `applyAgentPanelLayoutPreview` | `test:agent-panel-layout`, `test:agent-panel-ui`, `typecheck`, `build`, `test:bundle` |
| `src/agent-window-sync.ts` | 独立窗脱敏有界快照、Glass appearance projection、状态文案与命令 allowlist；只在打开独立窗时动态加载 | IPC、BrowserWindow、Agent 执行、项目持久化或独立设置 authority | `AgentWindowGlassAppearance`, `buildAgentWindowSnapshot`, `normalizeAgentWindowCommand`, `agentWindowStatusText` | `test:glass-theme`, `test:agent-window`, `test:agent-window-ui`, `typecheck`, `build`, `test:bundle` |
| `src/streaming-image-preview.ts` | 生图 partial 的运行时状态归一化、operation/request slot 键与目标图片节点归属 | 网络流解析、图片落盘、Agent 时间线消息、项目 session | `upsertStreamingImagePreviewState`, `groupStreamingImagePreviewsByNode` | `test:image-stream-preview`, `test:image-container`, `typecheck`, `build`, `test:bundle` |
| `src/asset-identity.ts` | 稳定 asset/occurrence ID、身份 claim 协调、安全 locator/relative path | 文件复制、项目 manifest IO | `stableImageAssetId`, `stableImageOccurrenceId`, `reconcileImageAssetIdentityClaims` | `test:asset-identity`, `test:project-io`, `test:image-import` |
| `src/paste-blocks.ts` | 大文本粘贴块、可见/模型 prompt 组合、图片粘贴阻断 | Clipboard 文件导入、React 状态 | `composePromptWithPasteBlocks`, `visiblePromptWithPasteBlocks`, `blockImagePaste` | `test:paste-blocks`, `test:agent-text`, `aidebug:gui` |
| `src/agent.ts` | Agent 请求入口、流文本 reducer、工具时间线格式化 | runtime 内部 memory 和模型请求 | `requestAgent`, `reduceAgentStreamEvent` | `test:agent-protocol`, `test:timeline`, `aidebug:gui` |
| `src/aidebug/agent-fixture-bridge.ts` | Renderer Agent action/message fixture 窗口钩子、32ms 流消息合并及安装清理生命周期 | 真实 runtime action 实现、React/项目状态、正式 bundle chunk | `installAgentFixtureBridge`, `__naimageDebugApplyAgentActions`, `__naimageDebugSeedAgentMessages` | `test:aidebug-agent-fixtures`, `typecheck`, `test:agent-text-ui`, `aidebug:gui`, `test:bundle` |
| `src/ui.tsx` | 对现有调用方保持稳定的基础 UI 兼容重导出 façade | primitives 内部实现、产品业务状态 | `DialogShell`, `DrawerShell`, `ButtonBase`, `useFloatingDialogInteractions` | `test:ui-foundation`, `typecheck`, `build` |
| `src/ui/*` | Dialog/Drawer focus 与 close policy、共享 controls、菜单 surface、overflow tooltip、浮窗拖动 | 产品业务状态、功能页数据获取 | `dialog-shell.tsx`, `primitives.tsx`, `menu-surface.tsx`, `overflow-tooltip.tsx`, `floating-dialog-interactions.ts` | `test:ui-foundation`, `aidebug:gui` |
| `src/window-controls.tsx` | 原生窗口最小化、最大化/还原、关闭按钮 | BrowserWindow 实现、项目状态 | `WindowControls`, `windowControl` | `build`, `aidebug:gui`, `test:lifecycle` |
| `src/theme-palette-picker.tsx` | 设置页明暗模式与 10 套命名调色盘选择表面 | 设置持久化、全局 App 状态、CSS canonical token | `ThemePalettePicker`, `aria-pressed`, `data-palette` | `test:settings-persistence`, `test:ui-foundation`, `typecheck`, `aidebug:gui` |
| `src/studio-dialogs.ts` | 设置、账户、编辑对话框、主题与 Markdown 的统一动态 import barrel | 业务状态、手工吸入共享依赖、初始 Renderer chunk | `loadStudioDialogs`, named surface exports | `typecheck`, `build`, `test:bundle`, `aidebug:gui` |
| `src/use-stable-event.ts` | 持久 handler identity、调用最新闭包 | 业务状态或事件策略 | `useStableEvent` | `typecheck`, `build` |
| `src/styles.css`, `src/styles/01…08` | 有序样式入口与 base/canvas/legacy/dialog/desktop/responsive/workbench/motion 区域；`01-liquid-glass-tokens.css` 持有 Glass token/旧 `--theme-*` 桥，07a→07i 仍由 workbench 聚合，`07j-liquid-glass-surfaces.css` 在其后持有 Glass surface、素材轨和视图模式 | 数据修复、运行时状态补丁、画布 artwork 滤镜、跨文件随意改 import 顺序，或把 `04b-glass-lab.css` 提前放入全局首屏入口 | `@import`, `01-liquid-glass-tokens.css`, `07-workbench-flattening.css`, `07j-liquid-glass-surfaces.css`, `08-motion-accessibility.css` | `test:workspace-glass-ui`, `test:ui-foundation`, `test:settings-lazy-load`, `test:aidebug-glass-workspace`, `aidebug:glass-workspace`, `test:bundle` |
| `src/markdown.tsx` | Agent Markdown 呈现 | 模型协议或工具执行 | Markdown renderer exports | `build`, `aidebug:gui` |

### 5.3 画布、需求与图片组织

| 路径 | Owns | 关键检索词 | 主要验证 |
| --- | --- | --- | --- |
| `src/selection-state.ts` | `none/single/multiple` 选择 reducer | `reduceSelectionState` | `test:selection` |
| `src/canvas-commands.ts` | 多选可用命令、批量删除/移动等纯命令能力 | canvas command exports | `test:canvas-commands` |
| `src/task-scope.ts` | Renderer 侧 TaskScope clone/merge/continuation policy | `AgentTaskScope`, continuation | `test:task-scope`, `test:execution-gate` |
| `src/goal-task-scope.ts` | 当前画布全部合格图片容器预检、槽位 binding 保留、冻结 Goal TaskScope 与 hash 材料 | 用户确认、runtime 网络派发、动态追加 SOURCE/REFERENCE | `preflightGoalTaskScope`, `buildGoalTaskScopeFromNodes` | `test:goal-task-scope`, `test:goal-runtime` |
| `src/task-result-layout.ts` | 根据冻结 TaskScope 规划并构建新成果的容器/布局 mutation | `planTaskResultLayout`, `buildTaskResultLayoutMutation`, snapshot hash | `test:image-container`, `test:task-scope` |
| `src/requirement-graph.ts` | 需求节点输入角色与图关系合法性 | requirement source/result edges | `test:requirement-graph`, `aidebug:requirements` |
| `src/requirement-signature.ts` | 需求重复执行签名 | source signature | `test:requirement-signature`, `test:execution-gate` |
| `desktop/skill-import.cjs`, `CanvasRequirement.skill` | 将单文件 SKILL.md 赋予可复用需求明确 Skill 身份；复用需求连线和执行语义 | 独立工作流节点、隐式执行、绝对源路径或伴随目录复制 | `CanvasSkill`, `parseCanvasSkillMarkdown`, `canvas.import-skill` | `test:skill-import`, `test:automation-service`, `test:ipc-registration` |
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
| `src/auth-gate.tsx` | 启动检查、账号/自定义接入切换、激活输入、登录/注册表面与认证标题栏 | `test:custom-api-transport`, `test:license`, `aidebug:gui`, `test:lifecycle` |
| `src/glass-lab.tsx`, `src/styles/04b-glass-lab.css` | 外观 section 内自然异步的六主题、三材质、自定义参数、强调色、噪点/减弱动态和实时预览表面；样式跟随该异步 chunk | 全局主题 authority、设置磁盘写入、画布 remount 或初始 Renderer CSS | `test:glass-theme`, `test:settings-lazy-load`, `test:aidebug-glass-workspace`, `aidebug:glass-workspace` |
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
| `scripts/aidebug-gui.mjs` | 已解析参数的消费、suite 选择顺序、运行目录、Vite/Electron/CDP 总编排和最终报告 | CLI/env 解析、已迁出 suite 的场景函数体、重复实现公共截图/进程/PNG helper | `test:aidebug-options`, `aidebug:gui` 与各 `--*-suite` 专项 |
| `scripts/aidebug/options.mjs` | AIDebug CLI alias、env/CLI 优先级、数值边界、路径/references 归一化和 supervisor `rawArgs` 快照 | suite 选择/dispatch、进程状态读取、运行目录创建或 GUI 启动副作用 | `test:aidebug-options`, `node --check` |
| `scripts/aidebug/harness/*` | CDP 连接、受控进程退出、PNG 读取/比较、双帧和原生截图证据 | 产品场景、画布业务断言、suite CLI 决策 | `aidebug:gui`, `node --check` |
| `scripts/aidebug/harness/state-snapshot.mjs` | Renderer DOM、几何、可访问性、画布和 Agent 状态的统一快照表达式；显式接收 evaluator 与 workbench 最小宽度 | suite 路由、进程生命周期、报告写入或产品状态修改 | `aidebug:gui`, `node --check` |
| `scripts/aidebug/suites/selection-command.mjs` | selection/command 场景 probe | 通用 CDP/截图实现、其他 suite | `aidebug:selection` |
| `scripts/aidebug/suites/ui-surface.mjs` | UI surface 场景 probe | 通用 CDP/截图实现、其他 suite | `aidebug:gui` |
| `scripts/aidebug/suites/image-generation.mjs` | 单图、图片恢复和图片集合三个图像 probe | CLI/process/CDP 生命周期、其他 suite | `aidebug:image`, `aidebug:image-recovery`, `aidebug:image-collection` |
| `scripts/aidebug/suites/layer-editing.mjs` | layer stack、抠图、区域重绘 probe 与专属 DOM proof | CLI/process/CDP 生命周期、其他 suite 或通用 PNG/CDP helper | `aidebug:gui` 的 `--layer-stack-suite`、`--cutout-suite`、`--region-redraw-suite` |
| `scripts/aidebug/suites/performance.mjs` | 200/1000 节点、长/流式时间线、10 张 4K 图片、交互、内存、Long Task、持久化与视觉检查点基线 probe | CLI/process/CDP 生命周期、最终报告路由、其他 suite | `node --check scripts/aidebug/suites/performance.mjs`、模块 import smoke、`aidebug:performance` |
| `scripts/aidebug-requirement-node-suite.mjs` | 需求节点创建、连接、重复执行与六层成果的专项 probe；默认使用轻量六层 fixture，完整 Layer Stack 仅由显式 `--full-suite` 运行 | 重复执行完整 Layer Stack、通用 CDP/进程生命周期、其他 suite | `aidebug:requirements`；需要完整图层回归时使用 `aidebug:requirements:full` |
| `scripts/aidebug-skill-node-suite.mjs` | 经 loopback 自动化正式入口导入 Skill-backed requirement，验证重复聚焦、异常 frontmatter、正常/最小窗口视觉，以及主/独立 Agent TaskScope 模式与发送后复位 | 产品解析/执行实现、任意真实凭证或图片服务、通用 CDP/进程生命周期 | `aidebug:skills`、`aidebug:evidence`、`AIDEBUG/visual-review.mjs` |
| `scripts/aidebug-goal-mode-suite.mjs` | 构造真实图片容器 fixture，验证可见普通/Goal 模式、合格容器/图片计数、probe/放量/费用确认文案、画布变化后的 stale hash 零派发及截图健康度 | 真实付费图片请求、Goal runtime 逻辑替身、通用 CDP/进程生命周期 | `aidebug:goal`、`aidebug:evidence`、`AIDEBUG/visual-review.mjs` |
| `scripts/aidebug-glass-workspace-suite.mjs`, `AIDEBUG/catalog.json` | 独立 Electron Glass/Workspace 可见闭环及 catalog/profile 注册：默认外观、六主题、三材质、九类自定义控制、推荐值恢复、canonical canvas/node DOM 身份与 geometry、素材轨四 tab、三视图、surface/图片不透明、884 x 640 Shell/设置/菜单，以及同配置目录真实关闭冷重启 | 真实网络/付费生图、产品主题实现、通用截图/报告替身或日常隐式全量 GUI | `test:aidebug-glass-workspace`, `test:aidebug-catalog`, `aidebug:glass-workspace`, `node AIDEBUG/run.mjs --check` |
| `AIDEBUG/run.mjs` | 显式 task/profile/可重复 Agent 选择、单进程并发 runner、毫秒时间戳加 UUID 的独占证据目录、覆盖全部 SUPER GOAL owner lane 的 workpack v2 manifest 生成和确定性 `--result-file` 回链 | 跨进程 claim/recovery、GUI 审阅结论、日常隐式全量测试 | `node AIDEBUG/run.mjs --check`、`test:aidebug-workpack` |
| `AIDEBUG/super-goal-contract.mjs` | fail-closed 校验最终 profile 覆盖每个 workstream owner lane 及其全部 verificationTasks | 执行测试、生成 workpack 或修改目标状态 | `node AIDEBUG/run.mjs --check`、`test:aidebug-workpack` |
| `AIDEBUG/workpack.mjs` | manifest/integrity/目标哈希复核、wave 屏障、原子 claim、追加 checkpoint、跨 workpack 资源锁、stale reclaim、runner/GUI evidence 绑定与不可变 closure | 产品 Renderer、模型分派、未声明的手工 `run.mjs` 进程、自动审美评分 | `test:aidebug-workpack` |
| `AIDEBUG/visual-review.mjs` | 截图收集、严格裁切、montage 和源/裁切/拼接文件哈希清单 | 自动审美 verdict、产品 GUI 断言替身 | `aidebug-visual-review`、`test:aidebug-workpack` |

## 6. 跨边界契约

### 6.1 Preload 与 IPC

| Bridge | Renderer 入口 | 主进程职责 |
| --- | --- | --- |
| `window.naimageConfig` | 设置、项目、session、导入/导出、图片另存、Project Graph 只读导入、窗口控制 | 本地文件、原生 Save 授权、项目目录、BrowserWindow、原子保存、受限 `.prg` 解析 |
| `window.naimageServer` | 登录、自定义 API 配置、激活、用户、余额、日志、模型、账户密钥 CRUD/选择、生图 | New API session、公开脱敏 token DTO、Main-only 完整 Key、授权状态与结果落盘 |
| `window.naimageUpdater` | 检查、下载、应用更新、进度订阅 | 签名、hash、ticket、helper、回滚 |
| `window.naimageAgent` | chat、停止、模型、Prompt、FastMemory | Agent runtime 生命周期、memory、模型与工具循环 |
| `window.naimageAutomation` | Renderer ready、生产命令接收与结果回传 | loopback HTTP 请求关联、随机 Token 与超时 |
| `window.naimageAgentIntegrations` | Agent 目录检测、安装/更新/移除 Skill | 目标路径验证、复制和 `.naimage-connection.json` 生成 |

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

TaskScope 是每轮 Agent 请求冻结的来源合同，区分 `SOURCE` 和 `REFERENCE`，包含 scope、result、confirmation policy 和 snapshot hash。`ask_user` 继续执行必须沿用同一份作用域，不得根据后续画布变化静默替换来源。运行中 steer 只有携带显式 update 才能改变附件；SOURCE/REFERENCE 均支持 `keep | replace | merge | clear`。Renderer 生成候选 v2 scope，Main 重新归一化和哈希、重算 SOURCE locks、先写入 run record，再将带权威快照的 steer 交给 runtime continuation。

来源上限：SOURCE 200、REFERENCE 40；真实图片工具单轮参考图上限 9。需求节点执行时来源只能来自需求节点左侧合法图片关系。

Goal TaskScope 是更严格的 v1 子合同：`origin=goal`、`target=all-image-containers`、`frozen=true`，`sourceContainerIds`、`sourceBindingIds`、`sourceAssets` 和 Goal metadata 必须按序完全一致，且不允许截断或额外 REFERENCE。每个容器内的每个槽位都是独立 binding，即使不同槽位复用同一 blob 也不能去重成一次操作；顶层合格容器最多冻结 200 个 binding。Goal metadata 中的容器/图片计数、`configuredConcurrency` 和 1–2 容器 probe 数也参与 snapshot hash。运行期间只能 `keep` 全部附件并接受文字 steer，任何范围变化都需要新建并重新确认 Goal。

### 6.4 项目保存 revision

- Renderer 生成单调 revision。
- `project-save-coordinator` 按 projectId 建立独立队列。
- 旧 revision 返回 `skippedStale:true`，不得覆盖磁盘较新 session。
- 无显式 revision 的兼容调用使用当前 revision + 1。
- 写入被业务层拒绝并返回 `applied:false` 时，不推进协调器 revision。
- 重启后的基线从项目 manifest/session 读取，不依赖上次进程内 Map。

### 6.5 远端服务

账号模式使用 `accountBaseUrl=https://sparkapi.org` 和 `updateBaseUrl=https://sparkapi.org`；模型 Base URL 由账户地址规范化为 `https://sparkapi.org/v1`。`relayBaseUrl` 仅作为旧设置/后续独立服务保留，当前账号模型请求不再依赖 Session Relay。自定义模式使用独立的 `agentBaseUrl/agentApiKey` 与 `imageBaseUrl/imageApiKey`；当前 UI 用同一组输入初始化 Agent/生图地址和 Key，底层字段仍保持分离，以支持后续拆成不同渠道。`networkProxyUrl` 是可选的应用级 HTTP(S) 代理；留空使用 Node 原生 HTTP，填写如 `http://127.0.0.1:7897` 时只有 naimage 服务请求通过 Windows curl 代理，不修改环境、Git 或系统全局配置。读取设置时，旧 `https://image.aieyra.cn`（含尾部斜杠和大小写变体）会强制迁移为 SparkAPI 更新地址；其他合法自定义更新地址仍可保留。若服务端尚未部署桌面更新扩展，客户端会把更新错误显示为不可用，不会把 GitHub 私有仓库密钥打包进客户端。旧 `serverUrl` 仅在读取时迁移到账户地址，不再写回；账户地址变化必须清空 session cookie、user id 和所选 token 元数据，并清除完整 Key 内存缓存。

账户管理认证使用 session cookie 与 `New-Api-User`；标准模型接口认证使用所选 token 的 `Authorization: Bearer <key>`。正式登出尽力调用账户站 `/api/user/logout`，无论远端结果如何都必须清理本地认证、所选 token 元数据和完整 Key 内存缓存。账户密钥额度保留原始 quota，`desktop/account-token-quota.cjs` 使用公开状态中的 `quota_per_unit` 得到 R（`1 R = 1 USD`），再使用 `usd_exchange_rate` 得到人民币分值；`price` 是充值价格倍率，禁止参与余额换算。显式刷新时并行读取状态与密钥，缓存读取不联网。主要契约：

- `/api/status`（公开额度单位与美元汇率）、`/api/user/login`, `/api/user/self`, `/api/user/self/groups`, `/api/user/models?group=...`
- `/api/token/?p=1&size=100`, `POST /api/token/:id/key`, `POST/PUT /api/token/`, `DELETE /api/token/:id/`
- `/api/log/self`
- `/v1/models`, `/v1/chat/completions`, `/v1/responses`
- `/v1/images/generations`, `/v1/images/edits`（密钥自身决定分组，客户端不传 `group`）
- `/api/naimage/license`, `/api/naimage/license/{activate,verify}`
- `/api/naimage/license/account/{activate,verify}`（需要 New API 用户 session）
- `/api/desktop-update/*`, `/api/desktop-download/*`

设备激活仍由 `/api/naimage/license*` 单独校验；激活码明文只在管理员创建时返回一次，数据库只保存激活码和授权令牌的 SHA-256；客户端只保存随机安装 ID 与授权令牌，不保存兑换码，也不读取硬件指纹。完整部署与管理员操作见 `docs/NEW_API_DUAL_ACCESS_AND_ACTIVATION.md`。

账号账户管理的 canonical 入口是 `/api/user/*` 与 `/api/token/*`，账号模型调用的 canonical 入口是账户站 `/v1/*`，更新下载入口是 `/downloads/naimage-studio/windows`；`/naimage/v1/*` 只保留为后端扩展/旧 Session Relay 合同，不再是当前 Studio 账号模型请求路径。修改这些路径、方法、认证 header、DTO、上传限制或更新 schema 时，必须同步审计独立 `ai-native` 仓库。

## 7. 镜像实现与同步规则

以下逻辑存在于不同进程或技术栈，修改一处时必须核对另一处：

| 镜像合同 | 位置 | 同步要求 |
| --- | --- | --- |
| TaskScope snapshot hash | `src/core.ts`、`agent-runtime.cjs` | 哈希材料、字段顺序和 v2 前缀必须一致；运行 `test:task-scope`、`test:agent-protocol` |
| Image 2 比例/分辨率/尺寸 | `src/core.ts`、`runtime/image-frame.cjs`、主进程生图参数 | UI 展示、runtime normalization 和真实请求必须一致；运行 `test:agent-text`、`test:agent-protocol`、真实图片专项 |
| Asset identity | Renderer `src/asset-identity.ts`（由 `core.ts` 兼容重导出）、`electron-main.cjs` 项目/session 清洗、导入 worker | assetId/occurrenceId/content hash 不得因重启或迁移漂移；运行 `test:asset-identity`, `test:project-io`, `test:image-import` |
| Session revision、节点事件与多窗口合并 | Renderer `src/main.tsx` 的确认 baseline/journal 快照、`desktop/project-save-coordinator.cjs`、`desktop/project-session-merge.cjs`、项目 manifest/session | revision 单调；Main 从确认 baseline 采集事件并分配 commitRevision；字段 clock 不得被 legacy richer fallback 覆盖；delete/restore barrier 必须阻止旧事件；只有真实 incoming writer 刷新 checkpoint；运行 `test:node-mutation-journal`, `test:project-save-coordinator`, `test:project-session-merge`, `test:project-session-dual-renderer`, `test:project-io` |
| Agent 运行控制与 steer | 主/独立 Renderer、`preload.cjs`、Agent IPC、`desktop/agent-run-control.cjs`、`agent-runtime.cjs` | pause 等待派发边界；stop 中断父运行；steer 只中断 child phase，queued steer 不得漏启新 phase；TaskScope update 必须先在 Main 归一化、重哈希、重算锁并保存，再补齐工具输出并在同一协议历史注入权威新 scope 与用户意图；运行 `test:agent-run-control`, `test:agent-steer`, `test:agent-window`, `test:ipc-registration` |
| Goal GUI/runtime/CLI/schema | `src/{goal-task-scope,goal-mode,project-agent-composer,automation-command-runtime}.ts*`、`src/main.tsx`、`agent-window-*`、`runtime/{goal-image-execution,goal-probe-admission,image-batch-scheduler,tool-schemas}.cjs`、`agent-runtime.cjs`、`integrations/naimage-control/` | 普通/Goal 模式、两阶段确认、hash drift 零派发、`all-goal-sources` 单次调用、逐 binding 输出、串行 probe、等待 probe 优先、公平进程容量、retry hold、provider draining、跨 Goal circuit 与费用边界必须一致；共享 command registry 同时驱动 Renderer、CLI 参考和测试；运行 `test:goal-task-scope`, `test:goal-runtime`, `test:goal-probe-admission`, `test:image-batch-scheduler`, `test:goal-probe-dual-renderer`, `test:automation-service`, `test:agent-window` 和 `aidebug:goal` |
| Glass registry、首帧与独立 Agent 镜像 | `runtime/glass-theme-presets.json`、`runtime/glass-theme-settings.cjs`、`public/glass-theme-bootstrap.js`、`src/{glass-theme,glass-theme-provider,settings-persistence,agent-window-sync}.ts*`、`desktop/ipc/config-ipc.cjs`、`electron-main.cjs`、`preload.cjs`、`desktop/ipc/window-ipc.cjs`、`desktop/agent-window-service.cjs`、`agent-window-renderer.js`、`agent-window.css` | registry/default/range、TS/CJS 归一化和启动期镜像必须一致；bootstrap 只信任安全 appearance 字段并重建变量；首个 React frame 必须用 `settingsWithGlassBootstrap` 保持同一外观，完整磁盘设置随后恢复 authority；主题切换只能投影根节点，不得 remount canvas；浅色 muted 在实色 surface 上至少 4.5:1；主/独立 BrowserWindow 创建和设置保存后的原生底色必须跟随主题 canvas；主 Renderer 是设置 authority，Main 只中继有界快照，独立窗只应用变量 allowlist；运行 `test:glass-theme`, `test:settings-persistence`, `test:settings-lazy-load`, `test:agent-window`, `test:ipc-registration`, `test:workspace-glass-ui`, `test:aidebug-glass-workspace`，需要真实可见证据时才运行 `aidebug:glass-workspace` |
| 图片格式、本地导出与远程资产 | `runtime/{tool-schemas,encoded-image-format}.cjs`、`electron-main.cjs`、`desktop/{image-export-service,public-http-resource,remote-asset-proxy}.cjs`、Asset IPC/preload、`src/remote-asset-source.ts`、Renderer/automation/CLI | 上游输入/结果限 PNG/JPEG/WebP，默认 PNG，未知格式在 provider 派发前拒绝，真实字节必须与请求格式一致；Provider URL 逐跳限公网 HTTP(S)，DNS 固定到禁用共享连接池的一次性连接并复核真实 socket，全局下载并发 2 且相同 URL 在途去重；新结果必须落盘后再进入画布，历史 URL 只经 recorded-only `naimage-asset:`，CSP 禁止 Renderer 直连；本地导出限 PNG/JPEG/WebP/AVIF/TIFF，格式元数据由共享 schema 驱动，同目标串行且无覆盖授权时 no-clobber；运行 `test:image-format`, `test:image-export`, `test:remote-asset-security`, `test:automation-service`, `typecheck` |
| 服务返回清洗 | `electron-main.cjs` 正式路径、`src/server.ts` 浏览器回退 | 登录、用户、模型、日志和图片 DTO 不能静默分叉；正式行为以 Electron 路径为准 |
| Agent 文本清洗 | `agent-runtime.cjs` tool envelope、`src/core.ts` 持久化消息清洗、`src/agent.ts` 时间线 | 不泄露 entry id/FastMemory metadata，不重复最终文本；运行 `test:agent-text`, `test:timeline` |
| 更新清单 | `package.json`, `update-release.cjs`, `electron-main.cjs`, `build/update-public-key.pem`, `ai-native` release manifest | canonical 清单的 product、version、minimum version、compatibility、hash、size 与制品必须一致，并独立验签 |

短期内不要为了去重而跨 CommonJS/TypeScript 强行共享运行时代码；优先使用共同 fixture 和契约测试保证一致。

## 8. 修改影响矩阵

| 修改类型 | 首要位置 | 必须联动检查 | 最低专项验证 |
| --- | --- | --- | --- |
| 顶栏、窗口按钮 | `src/main.tsx`, `src/window-controls.tsx`, `src/styles/01-base-controls.css` 与后续覆盖区域 | `ConfigBridge`, preload, window IPC | `build`, `aidebug:gui`, `test:lifecycle` |
| Glass 主题、材质、Glass Lab 或首帧 | `runtime/glass-theme-presets.json`, `src/glass-theme.ts`, `src/glass-theme-provider.tsx`, `src/settings-persistence.ts`, `public/glass-theme-bootstrap.js`, `src/glass-lab.tsx`, `styles/{01-liquid-glass-tokens,04b-glass-lab,07j-liquid-glass-surfaces}.css` | Electron `runtime/glass-theme-settings.cjs`、主/独立 BrowserWindow 创建底色与 `onSettingsSaved` 实时底色、root dataset/class/variable 合同、bootstrap 安全字段与首个 React seed、浅色 muted 对比、设置懒加载、独立 Agent appearance snapshot/变量 allowlist、画布不得 remount、artwork 必须不透明 | `test:glass-theme`, `test:settings-persistence`, `test:settings-lazy-load`, `test:workspace-glass-ui`, `test:agent-window`, `test:ipc-registration`, `test:aidebug-glass-workspace`；仅需真实视觉证据时运行 `aidebug:glass-workspace` |
| 左素材栏、项目搜索、Workspace 模式或 884 x 640 Shell | `src/workspace-chrome.tsx`, `src/main.tsx`, `src/styles/07j-liquid-glass-surfaces.css`, `electron-main.cjs` | 正式保留成果/图层/需求/历史/导入/设置；live nodes/conversations；Ctrl/Cmd K 与精确标题→前缀→内容排序；搜索真实选择；Navigator/Workbench/Focus/Review 跨节点选择使用 explicit replace，不能使用会保守忽略的 selection `focus`；Focus/Review 选择需求或未完成图片时回到 Workbench 定位；Focus 继续生成只开编辑器且不派发/计费；Review 当前方向使用并持久化 canonical `selectedNodeId`；canonical canvas 持续挂载、Focus/Review sibling projection、全部 agent placement、异步 fallback 与窄屏断点；原型入口不得是无行为 mock | `test:workspace-glass-ui`（50 cases）, `test:lifecycle`, `test:aidebug-glass-workspace`, `typecheck`；视觉或布局变更再运行 `aidebug:glass-workspace` |
| 画布交互/选择 | `src/main.tsx`, `selection-state.ts`, `canvas-commands.ts` | Agent 当前上下文、容器拖放 | `test:selection`, `test:canvas-commands`, `aidebug:selection` |
| 图片容器/布局 | `image-container-spec.ts`, `image-container-graph.ts`, `task-result-layout.ts`, `image-layout.ts`；`image-container.ts` 仅作兼容 façade | session migration、TaskScope provenance、layout projection | `test:image-container`, `test:image-layout`, `aidebug:gui` |
| 需求节点 | `requirement-graph.ts`, `requirement-signature.ts`, dialogs, `main.tsx` | TaskScope、重复执行 gate、关系边 | requirement、task-scope、execution-gate、AIDebug suites |
| SKILL.md 导入/Skill 身份 | `skill-import.ts`, `CanvasRequirement.skill`, `main.tsx`, project IPC | 24,000 字符持久化上限、GUI/CLI 同 parser、绝对路径排除、requirement TaskScope/关系边、schema/Skill 文档 | `test:skill-import`, `test:automation-service`, `test:ipc-registration`, `typecheck`, `aidebug:skills` |
| Graph CLI/多节点原子操作 | `src/automation-command-{registry,runtime}.ts`, `src/canvas-relation-graph.ts`, `src/canvas-commands.ts`, `src/main.tsx`, `integrations/naimage-control` | 共享 schema；`canvas.state` 权威 revision/锁/关系，严格选择；项目 guard 必需、canvas revision CAS 可选、Requirement update/execute revision 必需；完整集合预校验，图 mutation 与 create/update 单次 commit/receipt；execute 仅在异步派发前 fence | `test:canvas-commands`, `test:selection`, `test:requirement-graph`, `test:automation-service`, `test:aidebug-graph-cli-harness`, `aidebug:graph-cli` |
| Agent Prompt/tool/schema | `agent-runtime.cjs` | `src/core.ts` 类型、`src/agent.ts`、action handler、产品意图 | `test:agent-text`, `test:agent-protocol`, `aidebug:gui` |
| Agent 暂停/结束/运行中修改 | `desktop/agent-run-control.cjs`, `desktop/ipc/agent-ipc.cjs`, `agent-runtime.cjs`, `src/agent-stop-request.ts`, 主/独立 Renderer composer | preload bridge、run snapshot、child AbortSignal、stop-pending/failure fence、工具协议补齐、节点锁与同会话历史；只有结构有效的 Main `{ok:true}` 才允许 Renderer 清除 active run，失败必须保持 busy 并可重试 | `test:agent-run-control`, `test:agent-steer`, `test:agent-window`（44+68）, `test:agent-window-ui`, `test:ipc-registration`, `aidebug:stop-pending` |
| 当前画布 Goal 模式 | `src/goal-task-scope.ts`, `src/goal-mode.ts`, `src/main.tsx`, `src/project-agent-composer.tsx`, `runtime/goal-image-execution.cjs`, `runtime/goal-probe-admission.cjs`, `runtime/image-batch-scheduler.cjs`, `agent-runtime.cjs` | 独立窗、session continuation 清洗/节点锁、共享 automation schema/Renderer registry/CLI Skill、一次工具调用、输出 provenance、进程 probe/ramp 准入、retry/draining/circuit 与费用文案 | `test:goal-task-scope`, `test:goal-runtime`, `test:goal-probe-admission`, `test:image-batch-scheduler`, `test:goal-probe-dual-renderer`, `test:automation-service`, `test:agent-window`, `test:agent-steer`, `typecheck`, `aidebug:goal` |
| 图片格式/另存为/远程 URL | `runtime/encoded-image-format.cjs`, `desktop/{image-export-service,public-http-resource,remote-asset-proxy}.cjs`, `desktop/ipc/asset-ipc.cjs`, `electron-main.cjs`, `preload.cjs`, `src/remote-asset-source.ts`, `src/main.tsx`, automation registry/runtime 与 CLI schema/Skill | 上游 PNG/JPEG/WebP 真实字节与请求一致、本地五格式、真实解码识别、alpha 规则、共享格式注册表、原生 Save 授权、受管源图只读、同目标串行、no-clobber/确认后原子替换、真实失败传播、PSD 独立；远程结果逐跳公网校验、DNS pin、真实 socket 复核、禁共享 agent、全局并发 2/同 URL 去重、新结果落盘、历史 recorded-only proxy、Renderer CSP 禁止直连；不得引入模型调用或计费 | `test:image-format`, `test:image-export`, `test:remote-asset-security`, `test:automation-service`, `typecheck`, `build`, `test:bundle` |
| `view_image` | `runtime/view-image-payload.cjs`, `agent-runtime.cjs` | 允许根、payload 预算、Sharp、持久化排除 | `test:view-image`, `test:agent-protocol` |
| 模型目录/缓存 | `desktop/model-catalog.cjs`, `electron-main.cjs` | 服务响应 DTO、60 秒运行缓存、`cacheOnly` 离线磁盘快照、设置/Agent 共用模型 | `test:model-catalog`, `test:settings-lazy-load`, `test:ipc-registration`, `test:new-api-transport` |
| 账户密钥快照/显式刷新 | `desktop/account-token-service.cjs`, server IPC, `src/main.tsx` | 按账户隔离、脱敏字段、preload bridge、设置页不得自动联网 | `test:account-token`, `test:settings-lazy-load`, `test:ipc-registration`, `typecheck`, `build`, `test:bundle` |
| 设置/浏览器回退存储 | `settings-persistence.ts` | `AppSettings` 类型、Electron ConfigBridge、当前 `naimage.*` LocalStorage 键、更名前键的只读迁移、账户切换认证边界 | `test:settings-persistence`, `test:ipc-registration`, `typecheck`, `aidebug:gui` |
| 明暗模式/主题调色盘 | `theme-palette-picker.tsx`, `settings-persistence.ts`, `desktop/theme-preset-service.cjs`, `styles/01-theme-palettes.css`, `styles/04-settings-appearance.css` | `AppSettings.theme/themePalette/customTheme`、Electron `defaultSettings/migrateSettings` 镜像、ConfigBridge/IPC、独立 Agent 快照、Vite `studio-dialogs` 懒加载 chunk | `test:theme-preset`, `test:settings-persistence`, `test:agent-window`, `test:ui-foundation`, `test:ipc-registration`, `typecheck`, `build`, `test:bundle`, `aidebug:gui` |
| 插件/电商/Project Graph | `plugin-state.ts`, `plugin-system.ts`, `plugins/builtin-manifests.json`, `src/plugins/*`, `desktop/plugin-task-prompts.cjs`, `desktop/project-graph-adapter.cjs` | Electron/Renderer 状态清洗镜像、设置持久化、权限、动态 chunk、preload/IPC、主 Renderer handler；长 Prompt 归 Main；禁止脚本注入、扩展执行和直接 session 写入 | `test:plugin-system`, `test:project-graph`, `test:settings-persistence`, `test:ipc-registration`, `typecheck`, `build`, `test:bundle` |
| 远端 API/模型/登录 | `desktop/new-api-transport.cjs`, `desktop/new-api-client.cjs`, `electron-main.cjs`, `src/server.ts` | preload/core bridge、ai-native | `test:new-api-transport`, `test:lifecycle`, `aidebug:gui` |
| 项目保存/session | `main.tsx`, `desktop/ipc/config-ipc.cjs`, `desktop/project-save-coordinator.cjs`, `desktop/project-session-merge.cjs` | session v5、manifest、revision、writer baseline/sequence/checkpoint、字段事件、delete/restore barrier、节点 ID 重映射、迁移、原子写入 | `test:node-mutation-journal`, `test:project-save-coordinator`, `test:project-session-merge`, `test:project-session-dual-renderer`, `test:project-io` |
| 图片导入/缩略图 | import/cache modules | 资产身份、路径限制、容器 | `test:image-import`, `test:thumbnail-cache`, AIDebug import |
| 抠图/alpha/分层 | `layer-alpha-normalization.ts`, `core.ts`, matting/background/layer modules | 尺寸、透明度、mask replay、PSD | alpha、mask、matting、chroma-key、PSD tests |
| 更新/安装器 | main/update/release scripts/build/tools | ai-native manifest、签名密钥、回滚 | update tests、installer smoke、update E2E |
| Bundle 分层策略或异步边界 | `scripts/production-bundle-policy.cjs`, `scripts/production-bundle-selftest.cjs`, Vite imports/chunks | initial/plugin/CSS hard gate、core async/core/dist advisory、AIDebug marker 与插件初始图结构门禁；优先复用和自然异步，不为数字引入高风险重构或复杂拆分 | `test:bundle-policy`；只有直接影响 Bundle/chunk 边界或正式发布时再运行 `build` + `test:bundle` |
| 模块移动/拆分 | 原模块与新模块 | public re-export、打包 files、worker/ASAR 路径、本文 | `typecheck`, `build`, `test:bundle` + 对应专项 |

## 9. 状态与持久化位置

### 9.1 开发态与打包态根目录

| 数据 | 开发态 | 打包态 |
| --- | --- | --- |
| config 根 | 仓库 `config/` | Electron `userData/data/` |
| Agent workspace | 仓库根目录 | Electron `userData/workspace/` |
| Electron diagnostics | `.diagnostics/electron/` | Electron logs 下的 `runtime/` |

可用 `NAIMAGE_CONFIG_DIR`、`NAIMAGE_DEBUG_DIR` 等诊断变量覆盖隔离测试目录；不得把真实用户数据写入随机源码目录。

### 9.2 应用与项目文件

| 路径/文件 | 内容 | 所有者 |
| --- | --- | --- |
| `app-settings.json` | App 设置、Glass theme/material/parameters、账号 session、所选账户密钥的 ID/名称/分组元数据、自定义 API Key、可选应用级代理 URL、随机安装 ID 与授权令牌 | Electron Main；账户完整 Key 不得写入该文件、日志、模型缓存或项目文件 |
| Renderer LocalStorage `naimage.glassTheme.bootstrap.v1` | React/bridge 可用前使用的 `naimage-glass-theme-bootstrap` v1 安全外观快照；变量必须由 appearance 字段重建 | `GlassThemeProvider` 写、`public/glass-theme-bootstrap.js` 读；不是设置 authority，不得含凭据、Prompt 或项目数据 |
| Renderer LocalStorage `naimage.workspaceViewMode.v1` | `workbench` / `focus` / `review` 便利视图偏好 | Renderer UI；不进入项目 session，不改变画布或 Agent TaskScope |
| `session.json` | 全局/兼容 session | Electron Main |
| `model-cache.json` | 60 秒模型运行缓存的磁盘回退；设置页 `cacheOnly` 可读取过期快照 | Electron Main；不得含 token/cookie/key |
| `account-token-cache.json` | 最多 8 个账户的密钥公开元数据、选择状态与更新时间快照 | Electron Main；按账户地址 + user ID 隔离，不得含完整/掩码 Key、Cookie、IP 白名单或模型限制 |
| `project-list.json` | 项目登记与 activeProjectId | Electron Main |
| `projects/<id>/session.json` 或用户选择项目的 session | 画布、会话、容器、需求与资产引用 | Renderer 产生、Main 清洗并原子写入 |
| `<project>/.naimage/project.json` | `naimage-project` manifest v2、revision 和统计 | Electron Main |
| `<project>/output/` | 生成或衍生图片 | Main/Agent 图片链路 |
| `references/` | 兼容/受管参考资产 | Electron Main |
| `updates/` | 更新状态、下载和健康标记 | Electron updater |
| `start.naimage` / `*.naimage` | `naimage-project-package` 可移植项目数据 | 项目 IO |

### 9.2.1 更名兼容边界

- 新写入与导出只使用 `.naimage/project.json`、`start.naimage`、`naimage-project`、`naimage-project-package` 和 `naimage-asset:`；导入器仍只读接受更名前格式，绝不向旧路径写入。
- 浏览器业务回退键统一为 `naimage.settings.v1`、`naimage.ideSession.v1`、`naimage.imageGenerationStats.v1`、`naimage.serverAuth.v1`；只有当前键不存在时才只读迁移更名前值，正常保存只写当前品牌键。React 前安全外观快照单独使用 `naimage.glassTheme.bootstrap.v1`，便利视图偏好单独使用 `naimage.workspaceViewMode.v1`，两者都不是项目或业务设置 authority。
- 打包应用名与 userData 根均为 `naimage`。首次迁移更名前 userData 时，仅复制应用自有目录中的缺失文件；不覆盖现有文件、不移动来源、不跟随符号链接，并以 `.naimage-user-data-migration-v1.json` 标记完成。
- updater 只接受 `naimage-studio` manifest 与 `/downloads/naimage-studio/windows`；服务端不再注册更名前网络路由。验证码挑战绑定产品身份和安装包指纹，授权阶段不得切换产品或跨发布复用。
- Studio 新请求使用 `naimage-` 幂等键；服务端只在内部把它映射到冻结的更名前计费安全命名空间，并保持上游派生键稳定，避免升级重试绕过既有记录造成重复生图或扣费。该兼容不注册旧路由，也不暴露旧产品身份。
- 本地 Gateway 的开发 fallback Session Secret 已切换到当前品牌，已有本地登录 Cookie 需要重新登录一次；生产必须继续提供稳定的 `SESSION_SECRET`，不会使用该 fallback。
- 仓内冻结的 1.0.4 manifest 只用于历史验签，不能与当前后端一起部署；首次 1.0.5 发布必须把后端与新签名的 `naimage-studio` manifest 作为一个原子变更交付。

### 9.3 Agent memory

位于 `<configRoot>/memory/`：

- `promptcontext.json`：可编辑主 Prompt 与 memory Prompt。
- `fastmemory.json`：按 `projectId + conversationId` 隔离的 FastMemory。
- `memorycontext.json`：内部 memory context。
- `datememorycontext.json`：日期维护上下文。
- `naimage-memory.db`：runtime meta、context、toolmemory、date memory 等 SQLite 数据；当前库不存在时可从更名前数据库只读迁移，失败时不覆盖或删除来源。

Prompt、tool schema、compact summary 和 FastMemory 是不同存储面，不能重新合并为旧 Prompt entries。

### 9.4 仅内存状态

- `desktop/project-save-coordinator.cjs` 的 project queue 与 revision Map；`desktop/project-session-merge.cjs` 是无状态 stale-save/journal 合并器，不持有运行时 Map。
- `desktop/account-token-service.cjs` 的账户完整 Key cache；Renderer 只接收脱敏密钥元数据，进程重启后通过登录 session 再次按需获取。
- 当前 BrowserWindow、模型 inflight 请求和模型 memory cache。
- Agent 当前父执行、暂停状态、取消控制器、node locks、child phase 和有界 steer 队列，以及 Renderer 的流式文本和工具轮次。
- Images/Responses 生图流的最新中间预览；只显示当前 partial，不进入 `validMessages` 或项目 session。
- Renderer 当前 selection、drawer/dialog、拖拽和未保存 UI 状态。

进程重启后必须从磁盘/服务端恢复权威状态，不得依赖这些 Map 或 React state。

## 10. 测试映射

测试按本次改动的直接影响面选择最小专项，不机械运行无关测试：纯文档改动只做文档/差异校验；TypeScript/TSX 类型或结构改动运行对应专项并按需 `typecheck`；只有改动真实触及构建、CSS、import/chunk 或 Bundle 边界时才追加 `build`/`test:bundle`。正式发布时再按发布编排器执行全量门禁。下面是专项入口：

| 领域 | 命令 |
| --- | --- |
| Agent Prompt/FastMemory/tool contract | `corepack pnpm run test:agent-text` |
| Agent/Responses/TaskScope protocol | `corepack pnpm run test:agent-protocol` |
| Responses 请求转换 | `corepack pnpm run test:agent-responses-adapter` |
| New API transport / AIDebug image fixture / Images SSE / 显式代理 | `corepack pnpm run test:new-api-transport` |
| New API 账户密钥列表/选择/CRUD、原生 Key 响应兼容与账号 `/v1` 直连 | `corepack pnpm run test:account-token` |
| 设置页账户/模型离线快照与显式刷新 | `corepack pnpm run test:settings-lazy-load` |
| 本机 loopback 自动化鉴权与正式 CLI | `corepack pnpm run test:automation-service` |
| Goal 冻结范围、runtime 展开与跨 Renderer 高并发保护 | `corepack pnpm run test:goal-task-scope`, `corepack pnpm run test:goal-runtime`, `corepack pnpm run test:goal-probe-admission`, `corepack pnpm run test:image-batch-scheduler`, `corepack pnpm run test:goal-probe-dual-renderer`；GUI 为 `corepack pnpm run aidebug:goal`，验证可见模式、真实计数、确认警告、hash drift 零派发及无重叠/裁切 |
| SKILL.md 解析、限制、CanvasSkill 持久化往返 | `corepack pnpm run test:skill-import` |
| Skill-backed requirement 节点、重复导入、异常 frontmatter、主/独立 TaskScope 控件 | `corepack pnpm run aidebug:skills` |
| Codex/Claude Code/OpenCode/OpenClaw Skill 检测、安装与移除 | `corepack pnpm run test:agent-integration` + Skill `quick_validate.py` |
| 自定义 API `/v1`、JSON/SSE 回退 | `corepack pnpm run test:custom-api-transport` |
| 设备激活、缓存与离线宽限 | `corepack pnpm run test:license` |
| `view_image` | `corepack pnpm run test:view-image` |
| 项目 IO | `corepack pnpm run test:project-io` |
| 保存 revision/队列/节点 journal/多窗口合并 | `corepack pnpm run test:node-mutation-journal`, `corepack pnpm run test:project-save-coordinator`, `corepack pnpm run test:project-session-merge`, `corepack pnpm run test:project-session-dual-renderer` |
| Agent 暂停/结束/运行中修改 | `corepack pnpm run test:agent-run-control`, `corepack pnpm run test:agent-steer`；主/独立窗为 `test:agent-window`（44+68 cases），真实失败保留/重试为 `aidebug:stop-pending` |
| 模型目录/缓存纯逻辑 | `corepack pnpm run test:model-catalog` |
| 设置迁移与 localStorage 回退 | `corepack pnpm run test:settings-persistence` |
| Glass registry、首帧 bootstrap/首个 React seed、根投影、浅色 muted 对比、Electron 归一化与原生窗口底色 | `corepack pnpm run test:glass-theme`；设置保存回调与独立窗口底色同时运行 `corepack pnpm run test:ipc-registration`、`corepack pnpm run test:agent-window` |
| Workspace 正式左素材栏、项目搜索、Workbench/Focus/Review、Glass CSS/artwork 保护 | `corepack pnpm run test:workspace-glass-ui`（50 cases，覆盖 Ctrl/Cmd K、排序/真实选择、四入口跨节点 explicit replace、非图片目标回 Workbench、Focus 只开编辑器不扣费、Review canonical 当前方向及真实入口接线）；设置/Glass Lab 自然异步为 `corepack pnpm run test:settings-lazy-load`；AIDebug 注册静态合同为 `corepack pnpm run test:aidebug-glass-workspace` 与 `corepack pnpm run test:aidebug-catalog`；真实 Electron 专项为 `corepack pnpm run aidebug:glass-workspace`，当前证据覆盖 25 checks / 30 screenshots、九类控制、canvas/node DOM identity + geometry、884 x 640 Shell/设置/菜单、真实关闭冷重启、0 应用级 console error 和 0 生图网络请求 |
| 粘贴块 | `corepack pnpm run test:paste-blocks` |
| Agent 文本 UI | `corepack pnpm run test:agent-text-ui` |
| AIDebug CLI/options 纯解析 | `corepack pnpm run test:aidebug-options` |
| 布局/容器 | `corepack pnpm run test:image-layout`, `corepack pnpm run test:image-container` |
| 需求/TaskScope/gate | `test:requirement-signature`, `test:requirement-graph`, `test:task-scope`, `test:execution-gate`；GUI 专项为 `aidebug:requirements`，完整 Layer Stack 仅按需运行 `aidebug:requirements:full` |
| UI primitives | `corepack pnpm run test:ui-foundation` |
| Agent 面板布局/拖动/提示词复制区/独立窗口 | `corepack pnpm run test:agent-panel-layout`, `corepack pnpm run test:agent-panel-ui`, `corepack pnpm run test:agent-window`, `corepack pnpm run test:agent-window-ui` |
| alpha/mask/matting | `test:chroma-key`, `test:layer-alpha`, `test:layer-mask-replay`, `test:semantic-matting` |
| 选择/画布/资产与 Graph CLI | `test:selection`, `test:canvas-commands`, `test:asset-identity`, `test:requirement-graph`, `test:aidebug-graph-cli-harness`；真实 CLI 闭环为 `aidebug:graph-cli` |
| 工具时间线 | `corepack pnpm run test:timeline` |
| PSD/缩略图/导入/单图本地导出 | `test:psd-export`, `test:thumbnail-cache`, `test:image-import`, `test:image-format`, `test:image-export` |
| IPC 注册顺序/preload 对称性 | `corepack pnpm run test:ipc-registration`；当前合同为 95 invoke handlers / 92 preload invokes / 3 internal Agent invokes / 5 receives / 2 sends |
| Project Graph `.prg`/JSON 适配与安全边界 | `corepack pnpm run test:project-graph` |
| 自定义主题 schema/导入导出 | `corepack pnpm run test:theme-preset` |
| Electron 生命周期 | `corepack pnpm run test:lifecycle` |
| 更新 | `test:update`, `test:update-rollback`, `test:update-helper` |
| 正式 bundle | `corepack pnpm run test:bundle` |
| Bundle hard/advisory policy | `corepack pnpm run test:bundle-policy` |
| 正式产品性能硬门禁 | `corepack pnpm run aidebug:performance:product` |
| 日常 GUI 快速冒烟（主画布宽/窄、Agent、设置） | `corepack pnpm run aidebug:gui` |
| 完整 UI surface 基线 | `corepack pnpm run aidebug:gui:surface` |
| 正式发布 | `corepack pnpm run release:final` |

测试存在不代表所有改动都要执行全量套件。日常开发优先跑纯逻辑 selftest 和一个受影响领域专项；一般 Renderer/UI 改动在一批功能完成后只跑一次快速 `aidebug:gui`，跨页面或全局 surface 改动才跑 `aidebug:gui:surface`。Electron、项目或 Agent 非可视改动无需机械追加 GUI；正式制品仍必须通过 `test:bundle`、独立的 `aidebug:performance:product` 产品性能硬门禁和发布编排器的完整要求。

当前 Renderer Bundle 采用 hard/advisory 分层策略。硬门禁为：initial JS 目标 685,000 B，并额外允许 1,024 B 测量容差；685,001–686,024 B 记录 advisory，超过 686,024 B 才失败；plugin JS 120,000 B 与 CSS 270,000 B 无额外容差并直接失败。core async JS 190,000 B、core JS 870,000 B 与完整 dist 1,200,000 B 是 advisory 趋势目标，不单独导致 `test:bundle` 失败。AIDebug marker 泄漏、首屏入口无法识别、插件 chunk 缺失或插件进入初始依赖图仍是结构性硬失败；插件 JS 不计入 core JS/core async，但继续受 plugin hard gate。真实启动、堆内存、缩放、平移、拖动和 long task 由 `aidebug:performance:product` 独立硬门禁验证，任何 Bundle advisory 结果都不能替代产品性能证据。

这组当前基线承认 Glass token/surface CSS 和自然异步 Workspace/Glass Lab 的真实产品成本：保留首屏、插件与 CSS 的硬边界，同时把 core async/core/dist 作为趋势预警。后续优先复用和迁入自然业务异步边界，但不得为了跨过 hard 或 advisory 数字牺牲可维护性、引入高风险重构或复杂拆分。

Glass Workspace 完成批次的 2026-07-30 正式构建证据为：initial JS 684,208 B、all JS 893,377 B、core JS 874,335 B、plugin JS 19,042 B、core async JS 190,127 B、CSS 267,530 B、dist 1,209,732 B。initial、plugin 和 CSS hard gate 全部通过，AIDebug marker/入口/插件异步结构检查也通过；core async 超 advisory 127 B、core 超 4,335 B、dist 超 9,732 B，仅记录趋势预警，不为这些数字引入高风险重构或复杂拆分。

独立 Agent 窗口批次后的正式证据为：initial JS 639,365 B、async JS 60,073 B、total JS 699,438 B、CSS 187,824 B、dist 943,051 B。首屏只剩约 10.6 KB；`src/agent-window-sync.ts` 已保持为打开独立窗时才加载的动态 chunk，后续 Renderer 功能仍必须同步审计 chunk 归属并运行 `build + test:bundle`。

Project Graph 插件批次后的历史证据为：initial JS 646,764 B、async JS 73,200 B、total JS 719,964 B、CSS 192,511 B、dist 968,264 B。Project Graph Prompt 保持为执行命令时才加载的独立 chunk；“总 JS 只剩 36 B”只描述当时旧总量门禁，不再要求为该历史数字进行高风险重构，当前以本节顶部的 hard/advisory 分层策略为准。

自定义主题与 Prompt 所有权调整批次后的历史证据为：initial JS 648,017 B、async JS 71,911 B、total JS 719,928 B、CSS 193,912 B、dist 969,629 B。电商和 Project Graph 长 Prompt 已移入 Electron `desktop/plugin-task-prompts.cjs`；当时“只剩 72 B”的旧总量余量仅供趋势追溯。后续仍优先复用和自然异步模块，但不得仅为跨越任何 Bundle 硬门禁或 advisory 数字牺牲可维护性；只有正式发布或直接影响 Bundle 边界的改动才运行对应构建门禁。

插件独立计量批次后的正式证据为：initial JS 648,314 B，all JS 720,218 B，core JS 710,952 B，plugin JS 9,266 B，core async JS 62,638 B，CSS 193,912 B，dist 969,919 B。插件运行时、设置表面与跨境翻译对话框均为自然异步 chunk，账号与自定义纯文生图共用 Responses-first 传输策略。

画布批处理与运行控制批次后的正式证据为：initial JS 664,163 B，all JS 736,174 B，core JS 726,908 B，plugin JS 9,266 B，core async JS 62,745 B，CSS 194,443 B，dist 986,406 B。插件仍保持异步；相对当时 1,000,000 B dist advisory 目标余 13,594 B，只作为历史趋势记录。

节点 journal 与 steer 主批次（CLI 对齐和 Renderer 保存串行化之前）的正式证据为：initial JS 669,208 B，all JS 741,250 B，core JS 731,984 B，plugin JS 9,266 B，core async JS 62,776 B，CSS 194,443 B，dist 991,482 B。按当时策略，首屏相对 670,000 B 目标余 792 B，另有 1,024 B 测量容差；dist 相对 1,000,000 B advisory 目标余 8,518 B。该组数字保留为历史基线。

远程资产安全批次的历史生产构建证据为：initial JS 670,944 B，all JS 768,811 B，core JS 759,553 B，plugin JS 9,258 B，core async JS 88,609 B，CSS 199,454 B，dist 1,016,274 B。按当时策略，initial 超出 670,000 B 目标 944 B，但仍低于 671,024 B 硬门禁线；core async、plugin 与 CSS hard gate 全部通过，core JS 与 dist 只产生 advisory，`failures=[]`、`leakedMarkers=[]`。这些数字只用于追溯旧基线，不代表当前 Glass Workspace 批次的最终余量。

## 11. 当前高风险热点

- `src/main.tsx`、`electron-main.cjs`、`agent-runtime.cjs` 和 `src/core.ts` 仍较大，但已分别建立 renderer surface、desktop domain、runtime domain 与纯数据模块边界；Main 的 95 个 invoke handler（92 个 preload invoke + 3 个内部 Agent invoke）、5 个进度接收和 2 个 send channel 已由 `desktop/ipc/*` 独立拥有，`agent-runtime.cjs` 的 memory store、tool schema、Responses/Chat parser 与图片批次调度也已有独立 owner，后续继续沿现有边界拆，不要重新内联。
- 同项目并行采用多个 Renderer 窗口隔离运行状态；Main 以 `projectId + conversationId + Renderer owner` 管理暂停、恢复、结束、steer 和节点锁。Renderer 消失会停止其全部 run 并立即拒绝对应 automation pending；最后一个 run 回收 scope，应用退出在拆 transport 前执行 `stopAll`。不同 owner 即使共享项目/会话也不共享暂停状态，重叠节点仍互斥。项目 session 仍是整份 JSON，但 v5 journal 已提供顶层字段 clock、writer checkpoint、30 天保留策略及 delete/restore compact barrier，并由真实双 Renderer 专项覆盖关键竞态。它仍不是递归字段或远程多人 CRDT；同字段按 Main 提交顺序决胜，保护范围只覆盖同一 Electron Main 进程。
- steer 已支持显式 TaskScope update：SOURCE 与 REFERENCE 都可保留/替换/追加/清空；主窗口和独立窗口提供可见模式且每次使用后回到自动，CLI 既支持 `taskScopeMode` 简写也支持独立 `sourceMode`/`referenceMode`。替换 SOURCE 会同步重算节点锁；上游 transport 若未及时响应 `AbortSignal`，已经接受的模型或图片请求仍可能计费。
- Goal 已使用 Main 进程唯一 admission controller：Renderer 间 probe 串行，等待 probe 优先于新 ramp，已通过 Goal 在 wave 边界公平共享冻结容量；限流/5xx/网络 retry 打开全局 ramp hold，保护性失败打开跨 Goal circuit，同项目重复确认被拒绝。reservation 同时等待 scheduler 最终验证与真实 provider Promise；Renderer 退出或 Abort 不会提前释放仍在途的计费槽位。该机制仍只能阻止未来派发，无法取消上游已接受请求或追回费用，真实视觉质量也不能成为确定性自动 gate。Goal v1 仍限制为 edit/replace/variants、每 binding 1 输出和文字 steer；layers、cutout、redraw、额外 REFERENCE 与运行中换范围仍是后续协议工作。逻辑、真实双 Renderer 与可见 AIDEBUG Goal 专项提供分层证据；完整 SUPER GOAL closure 已覆盖对应 owner lane。
- Provider 返回的远程图片 URL 已从 Renderer 直连边界移出：Main 逐跳验证公网 HTTP(S)、固定全部 DNS 结果到禁用连接池的一次性 socket，并核对真实 `remoteAddress`；全局下载准入固定为 2 并发，相同 URL 在途去重。新结果经格式/尺寸/解码验证后落为受管文件，历史项目的已记录 URL 只能经 `naimage-asset:` 兼容读取，CSP 已移除 `img-src https:`。该策略仍依赖操作系统 DNS 给出完整地址集合，正式发布应保留公网 CDN URL 冒烟，但任何私网 fallback 都必须 fail closed。
- `src/styles.css` 是有序入口；`src/styles/07-workbench-flattening.css` 只保持 07a→07i 顺序，`07j-liquid-glass-surfaces.css` 必须紧随其后，`08-motion-accessibility.css` 继续作为最终 reduced-motion gate。`04b-glass-lab.css` 只由懒加载的 `glass-lab.tsx` 导入，不能为了方便移进全局首屏 CSS。任何样式调整都必须同时保持这些级联与 artwork 不透明保护。
- `public/glass-theme-bootstrap.js` 必须在 Vite/React 前独立运行，因此启动期 registry/projection 与 canonical `runtime/glass-theme-presets.json` 存在技术栈镜像；修改主题、材质、范围、强调色或变量时必须同步并运行 `test:glass-theme`。不要把 snapshot 的任意 `variables` 恢复为可信输入。
- `settings-persistence.ts` 直接拥有设置/Storage 导出；新代码不要再从 `core.ts` 查找这些符号。
- `src/server.ts` 是浏览器开发回退，不是正式 Electron 产品能力基线。
- New API 登录 session 只负责账户、余额、密钥 CRUD、授权和更新管理；账号模式的 Agent、生图与 `/v1/models` 使用所选账户密钥，分组由 token 自身决定，模型 JSON/FormData 不得注入 `group`。`/api/user/self/groups` 只用于密钥编辑候选与模型目录查询。设置抽屉按接入、外观、模型、Agent、更新五个分页显示，默认打开接入页。
- Electron 关闭重启时优先使用 `serverSessionCookie + serverUserId` 返回缓存身份，随后后台校验 `/api/user/self` 并异步读取日志；这条快速恢复路径不伪造余额或模型列表。
- Worker 根目录位置受 ASAR 解析约束。
- `public/ui/style-library` 与 `core.ts` 的旧风格库需要先确认真实消费者，再决定删除或隔离；不得恢复为旧复杂风格向导。
- 远端 API 和更新发布跨越 `naimage-studio` 与 `ai-native` 两仓，单仓修改不能证明交付完成。

## 12. 最近同步记录

| 日期 | 桌面版本 | 同步内容 |
| --- | --- | --- |
| 2026-07-30 | 1.0.7 | 冻结 1.0.7 正式发布范围：Liquid Glass 与左素材栏/三视图、Goal 小批量探测和渐进并发、Agent pause/resume/stop/steer、session v5 journal/checkpoint/tombstone GC、图片多格式导出与远程资产安全、跨境套图/多语工作流、Graph CLI 和共享 automation schema。正式编排扩充为覆盖全部新增逻辑专项和真实 Electron GUI 的发布门禁，并以官方 1.0.6 运行时验证 1.0.6 → 1.0.7 Restart 更新。 |
| 2026-07-30 | 1.0.6-dev | 上下文地图 v8 登记 Liquid Glass 与 Workspace Chrome：六主题/三材质 registry、React 前安全 bootstrap、无 wrapper 根投影、设置保存后全部 BrowserWindow 原生底色同步、独立 Agent 有界 appearance 镜像；左素材轨与 Workbench/Focus/Review 通过单一自然异步模块接入且 canonical canvas 持续挂载，Glass Lab/CSS 跟随设置外观异步边界，artwork 保持不透明。新增 `test:glass-theme`、`test:workspace-glass-ui`、`test:aidebug-glass-workspace` 与 `aidebug:glass-workspace` 映射；最终 Bundle 为 initial 684,208 B、core async 190,127 B、core 874,335 B、plugin 19,042 B、CSS 267,530 B、dist 1,209,732 B，hard gate 全部通过，三项 advisory 仅保留趋势预警，不为门禁数字引入高风险重构或复杂拆分。 |
| 2026-07-30 | 1.0.6-dev | Workspace Chrome 补齐原型生产合同：左侧素材栏正式保留成果、图层、需求、历史、导入与设置，全部入口接既有真实业务且 Agent 保持唯一控制中心；新增真实图片/需求/会话搜索、Ctrl/Cmd K 与精确标题→前缀→内容排序，结果选择回到 canonical 状态；Navigator/Workbench/Focus/Review 跨节点选择统一使用 explicit replace，避免 selection `focus` 保守忽略；Focus/Review 选择需求或未完成图片时自动回 Workbench 定位；Focus“继续生成”只打开已有成果编辑器、不派发或扣费，Review“当前方向”使用并持久化 canonical `selectedNodeId`。`test:workspace-glass-ui` 为 50 cases，最终真实 Glass GUI 为 25 checks / 30 screenshots / 0 应用级 console error / 0 生图网络请求。 |
| 2026-07-30 | 1.0.6-dev | Glass 完成审计补齐非默认主题冷启动：`settingsWithGlassBootstrap` 让首个 React frame 与 React 前安全 snapshot 一致，避免恢复主题短暂跳回 `light-sky + frosted`；GUI 逐项操作六个 range、accent、noise 和 reduced-motion，验证推荐值恢复、canvas/node DOM identity 与 geometry、884 x 640 Shell/设置/菜单，并在同一 config/user-data 下真实关闭 Electron 后冷重启。启动外观轨迹保留 bootstrap 首项和最多七项 React layout 投影，逐项锁定全部 Glass 字段，不允许中间 fallback；最小窗口把唯一 selected DOM 精确绑定 canonical `selectedNodeId`。浅色主题 muted token 同步提高到至少 4.5:1 实色 surface 对比，registry、bootstrap、首帧 CSS、HTML 默认值和独立 Agent fallback/运行态别名均由 `test:glass-theme` 锁步。权威报告为 `.diagnostics/electron/glass-workspace-2026-07-30T12-50-53-462Z/report.json`。 |
| 2026-07-30 | 1.0.6-dev | 修复独立 AIDEBUG runner 同毫秒启动时共享证据目录并覆盖 report 的竞态：目录改为时间戳加 UUID 后缀且独占创建，4 路并发 runner 专项验证路径唯一；触发问题的 workpack 已保存失败 closure，后续 wave 被 barrier 正确拒绝。 |
| 2026-07-30 | 1.0.6-dev | SUPER GOAL 完整 workpack 首轮 closure 以 6/6 lanes、17/17 tasks、4/4 人工视觉 review、20 张协议认可截图和零输入漂移通过；closure SHA-256 为 `0c6df74e42a01be739d07c3443d7d9fa7ce28825a3547b2cf62f690634114e6e`。新增独立 profile 合同校验器和真实 CLI 负向 fixture，缺 owner lane 或 verification task 会在 `--check`/emit 前 fail closed。 |
| 2026-07-30 | 1.0.6-dev | Graph CLI 增加权威 state、严格选择、连接/断开、归组/解散、批量位移和 Requirement 创建/更新/执行；共享 schema 驱动 Renderer、CLI 参考与测试。所有 mutation 强制项目 guard、canvas revision CAS 可选、Requirement update/execute revision 必需；图 mutation 与 create/update 整批提交，execute 只在异步派发前 fence。真实 Electron loopback CLI 以 5 场景、0 failures 完成 `900x640` Renderer 视口截图、montage 与人工 review，未记录 BrowserWindow bounds；stop fence 以失败保留/可重试/成功收尾三态闭环，`test:agent-window` 更新为 44+54，IPC 当前为 95/92/3。 |
| 2026-07-30 | 1.0.6-dev | 跨境电商新增共享 `commerce-set` 计划层：JSON 同步语言、限制、probe/ramp 和七张默认槽位，TypeScript 提供 generate/translate 归一化、单/多母图矩阵、请求/费用计数与稳定 snapshot material；自然异步配置 UI 支持逐图/逐语言 Prompt 和 Requirement/Skill 保存意图。现有插件入口继续以兼容适配执行翻译模式，完整共享 runtime 接入前不宣称 generate 或持久化已落地；新增 `test:commerce-set`。 |
| 2026-07-29 | 1.0.6-dev | 远程图片资产改为 Main 受管链路：首跳/重定向逐跳限制公网 HTTP(S)，拒绝编码回环、私网、链路本地、保留和混合 DNS，固定解析结果、禁共享连接池并复核真实 socket；全局真实下载限制为 2 并发且同 URL 在途去重；Provider URL 结果先落盘再进画布，历史 recorded URL 只经 `naimage-asset:`，Renderer CSP 禁止直接 HTTP(S) 图片加载。AIDEBUG 新增 `remote-asset-security` 专项。 |
| 2026-07-29 | 1.0.6-dev | AIDEBUG 多 Agent workpack 升级为 v2 闭环：精确 manifest/integrity/目标与控制面 hash，原子 claim、wave barrier、跨 workpack 资源锁、哈希链 checkpoint、parent/child PID 保守 stale reclaim、确定性 runner result、真实 GUI screenshot/montage/reviewer 绑定及不可变 closure 历史；新增 `test:aidebug-workpack`，不影响 Renderer Bundle。 |
| 2026-07-29 | 1.0.6-dev | Agent run 增加 Renderer owner：同项目/会话双窗口的暂停与停止互相隔离，重叠节点继续互斥；窗口消失停止其全部 run 并立即拒绝 pending CLI，最后一个 run 回收 scope，应用退出先 `stopAll` 再拆 transport。共享 CLI schema/Skill 与 owner、automation、生命周期、真实双 Renderer 专项同步。 |
| 2026-07-29 | 1.0.6-dev | 生图 SOURCE/REFERENCE 与上游结果统一支持 PNG/JPEG/WebP，默认 PNG；新增原生 Save 授权的本地 PNG/JPEG/WebP/AVIF/TIFF 导出，真实解码识别、非 JPEG alpha 保留、同目标串行和无授权 no-clobber，Sharp 转码零模型调用且不修改受管源图，分层 PSD 保持独立；共享 schema 同步驱动 Main、Renderer、CLI `canvas.export-image` 和测试，真实失败不再包装成成功。 |
| 2026-07-29 | 1.0.6-dev | Bundle 门禁改为分层策略：initial/core async/plugin/CSS 为 hard，initial 670,000 B 另有 1,024 B 测量容差；core JS/dist 为 advisory；`aidebug:performance:product` 继续作为独立产品性能发布硬门禁。最终构建 initial 670,694 B、core async 88,534 B、plugin 9,258 B、CSS 199,454 B，hard gate 全部通过；core 759,228 B 与 dist 1,015,956 B 为 advisory。 |
| 2026-07-29 | 1.0.6-dev | 新增当前画布全部合格图片容器 Goal：两阶段预览/确认冻结 TaskScope，Main 拒绝 hash drift，runtime 以一次 `all-goal-sources` 工具调用逐 binding 展开；1–2 个不同容器代表图串行 probe 通过确定性落盘/解码/画幅验证后按 2→4→配置上限放量，并在 probe、保护性或集中失败时停止/熔断。GUI、独立窗、CLI、共享 schema 与逻辑专项已同步；`aidebug:goal` 已以 4 个场景、0 failures 完成真实可见验证，最终分层 Bundle 也已通过。 |
| 2026-07-29 | 1.0.6-dev | session 升级为 v5：新增顶层字段 mutation clock、writer checkpoint 30 天保留与 delete/restore causal barrier GC；真实双 Renderer 专项覆盖编辑/删除、删除/撤销、快速保存与窗口异常退出。steer 补齐 SOURCE/REFERENCE 独立 keep/replace/merge/clear、可见 GUI 模式、动态节点锁与 queued-phase 竞态保护；CLI schema/Skill/参考和专项同步。 |
| 2026-07-29 | 1.0.6-dev | 项目 session 升级为 v4 `nodeMutationJournal`：Renderer 记录 upsert/delete/restore，Main 分配 commitRevision 并以 tombstone 阻止旧窗口复活节点；Agent 新增同一父运行内的文本 steer，可中断当前模型/工具 phase、保留节点锁并重新规划。新增 `test:node-mutation-journal` 与 `test:agent-steer`。 |
| 2026-07-29 | 1.0.6-dev | steer 增加显式 TaskScope update，Main 在中断 child phase 前归一化、重哈希并保存新快照，runtime 可在同一父运行中替换 SOURCE、替换/追加 REFERENCE 或清空附件；`agent.steer` CLI schema 与专项测试同步更新。 |
| 2026-07-28 | 1.0.6 | 新增画布 Ctrl+C/X/V、剪贴板图片与外部拖入成容器、左键框选和多源批量连需求；图片任务按设置中的每批 1–10 张顺序派发。新增 Main 级 pause/resume/stop、真实 Abort、项目+会话节点锁和二次确认；运行中切换项目或新建会话会打开隔离 Renderer。旧 revision 保存改为读取最新 session 后合并，并以 `persistenceOriginId` 解决并行窗口节点 ID 冲突。专项、项目 IO、typecheck、正式 build 和 Bundle 已通过，未运行全量 AIDebug。 |
| 2026-07-28 | 1.0.6 | 插件运行时、插件设置和插件专属对话框改为独立自然异步 chunk；Bundle 门禁分别统计 core/plugin JS，插件不得进入首屏图。账号登录模式同步采用所选账户 Key 的 `/v1/responses + image_generation` 优先链路，与自定义 Base URL/API Key 模式一致，不支持时才回退 Images API。 |
| 2026-07-28 | 1.0.6 | 新增 `naimage-theme v1` 自定义主题编辑和原生导入/导出：浅/深色各 10 个严格十六进制语义色、64 KiB 文件上限、画布实时预览与独立 Agent 同步。电商/Project Graph 长 Prompt 移到 Electron 受信任服务，IPC 更新为 88 invoke/85 preload/3 internal；快速 GUI、专项测试与 719,928 B 总 JS Bundle 已通过。 |
| 2026-07-28 | 1.0.6 | 新增 `sparkai.project-graph`：Electron 只读解析 `.prg`/JSON 为有界图 DTO，Renderer 以 GRAPH 作为唯一知识 SOURCE 提交视觉学习任务；禁止附件/扩展执行、绝对路径暴露和 session 直写。新增 `test:project-graph`，IPC 增至 85 个 invoke，两个真实 Project Graph 样例与生产 Bundle 已通过。 |
| 2026-07-28 | 1.0.6 | 新增受信任声明式插件系统：内置 manifest、双侧状态清洗、安装/授权/启停/卸载、命令权限复核和画布工具栏贡献；首个 `sparkai.commerce-toolkit` 支持最多 10 种语言的套图翻译任务。完整插件 Runtime 按启用状态进入异步 chunk，插件不能注入脚本或直接写项目 session。 |
| 2026-07-28 | 1.0.6 | 账户密钥额度新增独立换算 owner：原始 quota ÷ `quota_per_unit` = R/USD，再乘 `usd_exchange_rate` 得到人民币；设置页主显 `￥` 并保留 R/原始值审计，充值 `price` 不作为汇率。状态参数随手动刷新获取并进入无敏感信息的 v2 快照，打开设置仍保持零网络懒加载。 |
| 2026-07-28 | 1.0.6 | 新增真正可移出主应用的独立 Electron Agent 窗口；`desktop/agent-window-service.cjs` 管理生命周期和 owner 中继，`src/agent-window-sync.ts` 在打开时按需加载并生成脱敏有界快照，独立表面将发送/停止/会话/图片上下文/记忆/收回命令转回唯一主 Renderer。双窗口 mock Agent 往返、关闭与上方收回均已验证。 |
| 2026-07-28 | 1.0.6 | 产品定义固化为 Codex/Claude Code 式通用 Runtime 与 naimage 图片创作 Agent 的组合；新增 `src/agent-panel-layout.ts`，完成四向停靠、应用内浮动、rAF + CSS preview 拖动和松手单次持久化；提示词复制操作与滚动轨道分离，新增纯布局与 Electron 定向 UI 测试。 |
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
| 2026-07-23 | 1.0.4 | 抽出 `desktop/aidebug-image-fixture.cjs`，集中持有 AIDebug mock 图片的图层提示、尺寸归一化与确定性 PNG；Main 仅消费两个编排契约，`test:new-api-transport` 固定四类 base64 SHA-256、尺寸与 hint 输出。 |
| 2026-07-23 | 1.0.4 | 抽出 `scripts/aidebug/options.mjs`，集中持有 AIDebug CLI alias、env/CLI 特殊优先级、数值/路径/references 归一化与 `rawArgs` 快照；GUI 入口保持原 suite 顺序和启动编排，三个 supervisor 不再动态读取 argv。 |
| 2026-07-23 | 1.0.4 | New API 设置拆为 `accountBaseUrl`、可继承的 `relayBaseUrl` 和 `updateBaseUrl`；新装默认 SparkAPI；旧 `serverUrl` 只读迁移，模型缓存按 account+relay+user+group 隔离，异源 Relay Cookie 不回写账户 session，canonical Session Relay 路由切换为 `/naimage/v1/*`。 |
| 2026-07-23 | 1.0.5 | 产品身份统一为 naimage：目录、App ID、EXE、安装器、IPC、新项目格式、资源协议、存储键、memory 与 canonical 路由均使用当前名称；更名前本地数据仅保留只读迁移。首版通过签名 manifest 与 `minimum_version=1.0.5` 强制当前 1.0.4 客户端完整安装升级。 |
| 2026-07-24 | 1.0.5 | 从 `agent-runtime.cjs` 抽出 `runtime/controlled-shell-command.cjs`，集中持有只读命令 allowlist、cwd/路径边界、文件读取限制、输出裁剪和无 shell 子进程执行；新增独立安全 selftest，Runtime facade 只保留调用与工具摘要编排。 |
| 2026-07-24 | 1.0.5 | 参考 New API 调色盘分类新增明暗模式与 10 套 naimage 独立配色；`themePalette` 由 Renderer/Electron 双侧迁移，预设仅覆盖 `--theme-*` 桥接变量；主题选择器与现有对话框合并进 `studio-dialogs` 异步 chunk，并由设置持久化、UI foundation、Bundle 与快速 AIDebug 验证。 |
| 2026-07-24 | 1.0.5 | SparkAI 品牌默认值统一为 `org.sparkai.naimage`、`SparkAI` 与 `https://sparkapi.org`；安装器文案改为跨境电商套图；New API 用户分组可在设置中选择并透传到模型/图片请求；设置抽屉改为四分页，登录恢复先走缓存身份再后台校验。 |
| 2026-07-24 | 1.0.5 | 新增账号 Session Relay 与自定义 OpenAI-compatible API 双接入模式；新增随机安装设备授权、激活码哈希存储、24 小时校验缓存、72 小时离线宽限和账号 Relay 服务端门禁；设置抽屉新增“接入”页，IPC 扩展为 72 个 handler/69 个公开 invoke。 |
| 2026-07-24 | 1.0.5 | 图片链路恢复 Node 原生 HTTP 为默认，新增不影响全局配置的可选 HTTP(S) 代理；generation/edit 默认使用 `stream=true + partial_images=3`，工具卡显示临时中间预览并在最终结果后清理；明确不支持流式时回退一次非流式请求，统一图片并发上限为 10，transport selftest 覆盖 JSON body、显式代理、generation/edit SSE、JSON fallback、空流和 unsupported fallback。 |
| 2026-07-24 | 1.0.6 | 设置保存与模型目录加载状态解耦；Base URL、API Key 或接入模式发生修改后可立即保存，不再因旧渠道模型请求缓慢或失败而禁用保存按钮。 |
| 2026-07-27 | 1.0.6 | 修复图片恢复、选择菜单、AskUser 重载和新用户任务续跑的异步竞争；Requirement GUI 改用独立六层轻量 fixture，不再重复运行完整 Layer Stack，正式发布仍保留需求节点真实可视闭环。 |
| 2026-07-27 | 1.0.6 | 固化版本文档前置规则：发布冻结提交必须同步版本说明、文档索引、上下文地图与 Release notes；跨仓契约变化同时更新工作区地图，避免制品生成后修改源码指纹。 |
| 2026-07-27 | 1.0.6 | `release:verify` 新增带证据的失败点续跑：必须引用同项目旧报告、确认旧源码稳定与祖先关系、复用点前门禁全绿，并显式 allowlist 本次变化路径；新报告记录复用来源和变更范围，失败点及后续步骤仍真实执行。 |
| 2026-07-27 | 1.0.6 | 私有 GitHub 正式版 `v1.0.6` 已发布，tag 指向 `9f1d290`；Setup、Restart ASAR、签名 manifest、sidecar 与 SHA 清单共 5 项资产上传并复核，1.0.5 → 1.0.6 Restart 更新和隔离安装全链路通过。 |
| 2026-07-27 | 1.0.6 | 对照 archive 中原版 AIEYRA 后恢复自定义 Images 为非流式 JSON，修复 custom `newApiRelayJson` 构造请求体后未传给 transport 导致的 `invalid JSON request body`；账号 Session Relay 继续保留三阶段 SSE 预览。新增请求体转发回归断言、脱敏生图 metadata 和可指定只读源设置的隔离 AIDebug，当前真实 `gpt-5.6-sol + gpt-image-2` 单图闭环通过。 |
| 2026-07-27 | 1.0.6 | 账号模式改为登录 session 管理账户与 `/api/token/*`，所选密钥直连账户 `/v1/*`；新增密钥列表、选择、创建、分组/额度/状态编辑与删除，完整 Key 仅在 Main 内存并兼容原生 New API 直接返回 Key。新增 loopback 自动化桥、正式 naimage CLI 及 Codex/Claude Code/OpenCode/OpenClaw Skill 检测安装；设置页同步加入账户密钥与 Agent 集成管理。 |
