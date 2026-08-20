# SparkAI WorkSpace 上下文地图

> 地图版本：54
> 最近同步：2026-08-16
> 对应桌面版本：1.0.9
> 适用范围：Windows Electron 客户端、四工作台共享的本地单 Agent runtime、项目文件与发布链路

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

- 用户可见产品名称统一为 `SparkAI WorkSpace`。为保证原地升级和既有用户数据兼容，npm 包名、`naimage.exe`、App ID、协议头、Automation CLI、项目元数据目录和应用数据目录继续保留既有 `naimage` 标识。

- Electron 主进程负责窗口、IPC、项目文件、用户会话、远端请求、图片工作线程和更新。
- React Renderer 负责工作台、无限画布、项目 Agent UI、图片容器、需求节点和成果呈现。
- `agent-runtime.cjs` 负责 Prompt/画布上下文组装、压缩编排、模型协议循环与工具执行；SQLite/JSON memory、Prompt/FastMemory 持久化、tool schema 和 Responses/Chat 响应解析由 `runtime/` 专属模块持有，但均不直接修改 React state。
- 用户的原生 New API、账户/角色/quota/计费、渠道和模型服务由外部部署维护；本工作区的 `sparkai-extension` 只拥有 Pro License、兑换码管理和 Cloudflare-safe 图片任务包装。

桌面端不是服务端权威来源。身份、角色、余额、模型可用性、计费和使用日志以远端 New API 返回为准；项目画布、项目素材、对话和 FastMemory 以本地项目及应用数据为准。

产品层把 Agent 定义为“Codex/Claude Code 式通用 Agent Runtime + SparkAI WorkSpace 视觉创作 Agent”。前者拥有目标分解、工具循环、模型协议、上下文 checkpoint、Skills/CLI 和任务恢复；后者拥有画布语义、TaskScope、图片容器、Image Gen、素材归属和绘画经验。它是能力与协议的组合，不是把 Codex 产品或源码直接嵌入应用。

## 3. 进程拓扑

```text
用户
  │
  ▼
Electron Main: electron-main.cjs
  ├─ BrowserWindow / native dialog / shell / desktopCapturer
  ├─ desktop/ipc/register-desktop-ipc.cjs：147 个 invoke handler（144 preload + 3 internal）/9 receive/2 send channel 的唯一注册顺序
  │    └─ settings / glass background / requirement library / commerce / plugin / automation / updater / session / agent / window / debug / export center / project / asset / server / video task registrar
  ├─ 项目、session、账户密钥脱敏快照、模型缓存、更新状态
  ├─ desktop/project-save-coordinator.cjs
  ├─ desktop/project-data-migration.cjs：旧 AppData 项目/全局 Session 预检、空间检查、逐文件 SHA-256、原子迁移、项目级 Agent 状态迁移与独立清理回执
  ├─ desktop/export-center-state-service.cjs：项目级导出预设、内容指纹和历史的原子 JSON 状态
  ├─ desktop/model-catalog.cjs
  ├─ desktop/video-import.cjs：本地视频头校验、流式复制、SHA-256 内容寻址与重复复用
  ├─ desktop/video-task-adapter.cjs：视频 create/poll 端点、兼容请求与响应归一化
  ├─ desktop/video-task-service.cjs：零重试创建、项目 journal、恢复轮询与安全下载落盘
  ├─ desktop/agent-responses-adapter.cjs
  ├─ desktop/new-api-transport.cjs：默认 Node HTTP、显式 HTTP(S) 代理时的 Windows curl 传输与取消
  ├─ desktop/new-api-client.cjs：account/relay/update 基址解析、重试、会话 cookie、图片任务创建/轮询、JSON/通用 SSE 与 Images SSE relay；自定义模型接入按模型配置优先并受限回退
  ├─ desktop/account-token-service.cjs：New API 用户密钥 CRUD、按账户隔离的脱敏磁盘快照与 Main-only 完整 Key 内存缓存
  ├─ desktop/settings-secret-store.cjs：自定义 API Key 的 safeStorage sidecar、Renderer 占位符与旧明文迁移
  ├─ desktop/automation-service.cjs：127.0.0.1 随机端口、随机 Bearer Token、Renderer 命令转发与 Main service command 分流
  ├─ desktop/debug-command-service.cjs：开发/AIDebug 专用的脱敏状态/日志、受限截图、IPC/命令检查与测试白名单
  ├─ integrations/naimage-control/scripts/naimage-mcp.mjs：同一 command schema 的 MCP stdio 工具包装，只转发本机 automation bridge
  ├─ desktop/requirement-library.cjs：安装级个人需求模板库的单文件 JSON、清洗、精确 revision CAS 与删除确认
  ├─ desktop/agent-integration-service.cjs：Codex/Claude Code/OpenCode/OpenClaw Skill 检测、安装与移除
  ├─ desktop/plugin-task-prompts.cjs：电商与 Project Graph 受信任任务 Prompt
  ├─ desktop/theme-preset-service.cjs：自定义主题 schema 与原生导入/导出
  ├─ desktop/glass-background-service.cjs：用户授权背景图的 WebP 受管转码、内容寻址加载与保留式 GC
  ├─ runtime/glass-theme-settings.cjs：共享 Glass registry 的 Electron 设置归一化与原生窗口底色
  ├─ desktop/agent-window-service.cjs：独立 Agent BrowserWindow 生命周期、主 Renderer 权威状态与命令中继
  ├─ desktop/license-service.cjs：自定义 Base URL 的 Pro 设备激活、24 小时校验缓存与 72 小时离线宽限；账号模式直接授权
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
          ├─ runtime/image-frame.cjs：Image 2 画幅、运行冻结、交付规格 Prompt 与请求尺寸
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
  ├─ window.naimageAgentWindow
  └─ 项目迁移/清理确认在 bridge 边界把 production 压缩产生的数字 1 有界恢复为布尔 true
          │
          ▼
React Renderer
  index.html → public/glass-theme-bootstrap.js（React 前安全首帧投影）→ src/main.tsx → App
  ├─ src/core.ts：共享类型、bridge contract、图片与 session 规则
  ├─ runtime/glass-theme-presets.json → src/glass-theme.ts → src/glass-theme-provider.tsx：Glass registry、归一化、根节点投影与无 wrapper Provider
  ├─ src/settings-persistence.ts：默认设置、迁移、浏览器回退存储与无敏感信息的 Glass bootstrap snapshot
  ├─ src/workspace-chrome.tsx：自然异步左侧素材轨、工作台/专注/评审切换、固定上下文栏与原图/生成组只读投影
  ├─ src/glass-lab.tsx：设置外观页内再次按需加载的 Glass Lab
  ├─ src/help-center.tsx：自然异步快速开始、使用帮助、政策与关于表面
  ├─ src/plugin-state.ts / src/plugin-system.ts：声明式插件状态、manifest、权限、工具栏贡献与快捷键默认值/用户覆盖
  ├─ src/plugins/*：内置插件领域任务契约；不直接修改项目 session
  ├─ src/agent-panel-layout.ts：Agent 停靠/浮动布局、边界限制与 CSS 拖动预览
  ├─ src/agent-window-sync.ts：按需加载的独立窗快照与命令校验
  ├─ src/asset-identity.ts / src/paste-blocks.ts：纯数据域
  ├─ src/agent.ts：Agent 请求和时间线适配
  ├─ src/project-agent-composer.tsx：自然异步紧凑 Agent 输入区、玻璃菜单、模式切换与运行控制
  ├─ src/ui.tsx：基础 UI 兼容 façade；真实实现位于 src/ui/*
  ├─ src/ui/unsaved-changes-dialog.tsx：具备保存语义表面的统一关闭确认
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
runtime/glass-theme-presets.json（七套主题、三套材质、强调色与参数范围）
  ├─ runtime/glass-theme-settings.cjs
  │    → Electron 设置归一化
  │    → 主窗口和独立 Agent BrowserWindow 创建时的原生 backgroundColor 使用已保存主题 canvas 色
  │    → 设置保存后 desktop/ipc/config-ipc.cjs onSettingsSaved 更新全部存活 BrowserWindow 的原生底色
  └─ src/glass-theme.ts
       → normalizeGlassThemeSettings()
       → glassAppearanceProjection()
       → applyGlassAppearanceToRoot()

index.html 的静态 dark-ember + frosted fallback
  → public/glass-theme-bootstrap.js 在 React/Vite 入口前读取 naimage.glassTheme.bootstrap.v1
  → 只信任 glassTheme / glassMaterial / glassParameters 并重新计算变量
  → documentElement datasets / classes / CSS variables
  → src/main.tsx settingsWithGlassBootstrap(defaultSettings) 让首个 React frame 复用同一安全外观子集
  → src/main.tsx <GlassThemeProvider settings={settings}>
  → useLayoutEffect 重新投影权威设置并刷新安全 bootstrap snapshot
```

`runtime/glass-theme-presets.json` 是运行时 registry 的 canonical 数据源；`public/glass-theme-bootstrap.js` 为了在 Vite bundle 执行前工作而保留一份启动期投影镜像，必须由 `test:glass-theme` 对七主题、三材质、强调色和变量逐项防漂移。第七套 `light-silver` 显示为“雾银玻璃”，复用同一 token 投影而不增加第二套样式系统。bootstrap snapshot 固定为 `naimage-glass-theme-bootstrap` v1，只包含 `glassTheme`、`glassMaterial`、`glassParameters.{opacity,blur,saturation,highlight,shadow,radius,accent,noise,reduceMotion}` 及可重建投影，不包含账号、Key、Cookie、Prompt 或项目数据；启动脚本忽略持久化的 `variables`，防止任意 CSS 值被直接信任。

根节点合同包括 `data-glass-theme`、`data-glass-mode`、`data-glass-material`、`data-glass-accent`、`data-glass-accent-resolved`、`data-glass-noise`、`data-glass-reduce-motion`，以及 `glass-theme-active`、`theme-light|theme-dark`、`glass-no-noise`、`glass-reduce-motion`。新装默认是“蜜橘融光” (`dark-ember + frosted`)。Electron 的完整设置仍以 Main 磁盘配置为 authority；`settingsWithGlassBootstrap()` 只把无凭据的 Glass 子集借给首个 React frame，避免 bootstrap 已恢复的非默认主题被异步磁盘加载前的默认 state 短暂覆盖。`GlassThemeProvider` 不渲染 DOM wrapper，只更新根 datasets、classes 和 CSS variables；切换主题、材质或自定义参数不得卸载、重建或重新初始化画布。

Glass Lab 的自然异步链路是：顶栏 `.workspace-glass-lab-button` 或素材轨设置按钮 → `LazySettingsDrawer` → 外观 section → `LazyGlassLab` → `src/glass-lab.tsx` 同 chunk 导入 `src/styles/04b-glass-lab.css`。Glass 全局 token/兼容桥由 `src/styles/01-liquid-glass-tokens.css` 持有，chrome、Agent、素材轨、工具栏、菜单/对话框/设置、输入框、浮动控件以及图片容器、成果/Requirement/科研 Panel 节点外壳由 `src/styles/07j-liquid-glass-surfaces.css` 和对应领域异步样式共同持有。节点的框架、标题区和控件可透明玻璃化；实际图片/视频 artwork 与成果预览像素层必须保持不透明、原色，并显式禁用 `filter`、`backdrop-filter` 与混合模式。共享字体 token 由 `src/styles/01-base-controls.css` 维持 12/13/14/15 px 的紧凑可读层级，Agent 正文/状态/输入和模型菜单在 `07g-agent-panel-overrides.css` 使用对应关键字号。项目搜索浮层必须以近实色 `--glass-menu-surface` 绘制并关闭 backdrop filter，避免下层 artwork 穿透；文字、菜单和选中态维持可读对比，玻璃增强不得引入高成本画布特效或拖动延迟。

自定义工作区背景经 `naimage:glass-background:{pick,load,clear}` 进入 Main：原生选择授权后只读取普通文件，限制 64 MiB/1 亿输入像素，使用 Sharp 旋转校正、最长边 3840 px 并统一压缩为单帧 WebP；文件以转码字节 SHA-256 作为 `glass-bg-*` 身份存入 `<configDir>/glass-backgrounds`。Renderer 只接收有界 metadata 与按需 data URL，不接收原始路径或受管路径，AppSettings 也只保存资产 ID、显示名、WebP metadata、启用状态、遮罩强度和模糊值，不保存 base64。clear 不立即物理删除文件，而是刷新 30 天恢复保留期；GC 每次最多删除 8 个超过保留期、未被当前设置引用、文件名和内容哈希均自校验通过的本模块 WebP，未知文件、符号链接、损坏文件和仍被引用的资产一律保留。

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
  ├─ WorkspaceAssetRail：成果 / 图层 / 需求 / 模板 / 历史 + 领域快捷区 + 导入 / 设置
  ├─ WorkspaceTaskContext：当前模式与选中节点摘要
  ├─ WorkspaceFocusStage：多选成果的原图/生成组分栏 + 最近成果胶片条 + 继续生成
  └─ WorkspaceReviewGrid：最近四个成果并排评审 + 当前方向
       → 选择、打开大图、切换会话、导入和设置均回调 src/main.tsx 的生产动作
```

主 Shell 合同是 `.ide-main.canvas-only.has-asset-rail.workspace-mode-{workbench|focus|review}` 与既有 `agent-placement-*`/`agent-collapsed` 的组合。左侧素材栏是正式产品结构，必须保留成果、图层、需求、历史、导入和设置入口，不得再以“原 Shell 无永久侧栏”为由移除。异步加载期间分别使用 `.workspace-direction-switcher.workspace-direction-switcher-loading` 与 `.workspace-asset-rail.is-loading`，不能用空白或第二套临时布局替代。素材轨从 live `canvasNodes` 和 `conversations` 派生成果、图层、需求与历史，最多呈现有界的最近 40 项；它不持有第二份画布、会话或项目状态。`commerce` 模式额外接收主 Renderer 提供的轻量 `WorkspaceDomainTool` DTO，以 SKU、套图、翻译、模板、A/B 和导出顺序优先展示；按钮保留原 plugin command ID 并回调同一个 `executePluginCommand`，不导入插件 Runtime、不复制业务逻辑。插件未安装或停用时显示设置恢复入口；已启用但工具全隐藏时进入“设置 → 工具”，不会自动安装、启用或恢复用户明确隐藏的命令。原型入口必须连接既有生产动作或权威状态；禁止保留无行为按钮、平行 mock 数据或第二套业务实现，Agent 仍是唯一控制中心。

Workbench 始终保留 canonical 无限画布；Focus 与 Review 是挂在同一 `.canvas-panel` 内、位于 canonical canvas 之后的 sibling projection，只改变可见投影，不得条件卸载画布。切换到 Focus/Review 时若当前未选中有效图片，Main 只选择现有图片成果，不创建或改写节点。`WorkspaceSearch` 搜索真实图片、需求和会话，支持按钮与 Ctrl/Cmd K 调用，并按精确标题、标题前缀、内容匹配依次排序；选择结果必须回到 Main 的真实节点/会话选择动作，不能只关闭浮层或修改局部投影。搜索浮层与通用 Glass surface 的选择器优先级必须一致，计算背景 alpha 为 1、`backdrop-filter` 为 `none`，输入、标题和详情字号分别至少为 12/11/10 px。Navigator、Workbench、Focus 与 Review 发起跨节点选择时必须使用 explicit replace 语义，不得复用 selection `focus` 手势；后者会保守忽略已存在选择下的跨节点切换。Focus/Review 只能投影已有图片成果；在这两个模式中搜索到需求或尚无资产的进行中图片时，Main 必须先切回 Workbench，再定位 canonical 节点，避免任务摘要与可见图片不一致。Focus 的“继续生成”只打开所选现有成果的编辑器，不立即派发图片请求或产生费用。Review 的“当前方向”以 canonical `selectedNodeId` 为权威，选择后进入现有项目持久化链，不得另设 Review-only 选择状态。生产 BrowserWindow 最小尺寸为 884 x 640 px；`07j-liquid-glass-surfaces.css` 对 1280/1100/1000 px 逐级收紧顶栏、素材轨和视图投影，AIDebug 的 540 px BrowserWindow 仅用于隔离响应式 fixture，不改变正式窗口门槛。

### 4.2.2 四工作台领域投影

```text
runtime/workspace-domains.json（四领域唯一声明注册表）
  ├─ runtime/workspace-domain.cjs → Main / Agent runtime / session normalizer
  └─ src/workspace-domain.ts → Renderer 类型化投影
       → src/main.tsx workspaceDomain + workspaceDomainRef
       ├─ WorkspaceDomainSwitcher（顶部紧凑菜单）
       ├─ Ctrl/Cmd + 1–4（插件有效自定义快捷键优先）
       ├─ ProjectNameDialog（新项目四张入口卡）
       ├─ availablePluginToolbarItems(..., workspaceDomain) → 命令/快捷键
       ├─ activePluginToolbarItems(..., workspaceDomain) → 可见 Dock/领域菜单
       ├─ WorkspaceAssetRail 领域快捷区（复用 active toolbar DTO）
       ├─ Agent chat payload.workspaceDomain
       └─ workspace.domain.list/get/set + project.create.workspaceDomain
            → 同一 automation schema → Renderer registry / CLI reference / naimage-control Skill
```

`WorkspaceDomain` 固定为 `general | commerce | social | research`。领域只是同一项目的能力投影：切换只更新 `workspaceDomain` 并进入现有 session 自动保存，不替换 `.workflow-canvas`、节点、选择、会话、TaskScope、正在运行的 Agent 或受管资产，不调用模型、不联网、不产生费用。旧项目、非法导入值和缺失字段由 `desktop/project-session-normalizer.cjs` 统一归一为 `general`；新项目与新项目文件夹在首次创建文件时写入所选领域。独立 Agent 快照只公开领域 ID/标题，主 Renderer 仍是唯一 authority。正式最小窗口 `884 x 640` 下，顶部触发器仍必须显示“通用创作 / 电商创作 / 社媒创作 / 科研绘图”中的当前文字，不能退化为无法识别含义的单图标。

`general` 为兼容模式，继续显示全部已安装且启用的插件工具；其他领域显示注册表中归属自身的插件以及未被任何领域声明的全局插件。`commerce` 投影 `sparkai.commerce-toolkit`，`social` 投影 `sparkai.social-content`，`research` 投影已交付的 `sparkai.scientific-figure`；素材轨与底部工具栏都复用各插件同一 active contribution。`AppSettings.workspacePluginDefaultsVersion` 对旧设置只执行一次版本化迁移，默认安装并启用这三个第一方工作台组件；迁移后明确停用的组件保持停用，用户随后卸载全部组件并保存时也不会在下次启动被重新安装。科研工具在左素材轨中以“数据 / 图表 / Panel / 示意 / 重绘 / 导出”紧凑标签呈现。Agent runtime 只注入注册表中的一句领域提示，详细流程由插件 Skill/受信任契约按需提供，不能建立四个 Agent Runtime。领域基础专项入口为 `test:workspace-domain`、`test:plugin-system`、`test:agent-window`、`test:automation-service` 与 `aidebug:workspace-domain`；社媒真实 Electron 证据位于 `.diagnostics/electron/glass-workspace-2026-08-03T07-45-12-422Z/report.json`，科研真实 Electron 证据位于 `.diagnostics/electron/glass-workspace-2026-08-03T09-53-46-537Z/report.json`；两者都为 0 Renderer console error、0 模型请求，科研 GUI 场景也没有执行本地 Runner。

工具显隐采用两层投影：`availablePluginToolbarItems` 只按插件启用、权限和领域生成可执行/快捷键集合；`activePluginToolbarItems` 再应用 `disabledCanvasToolCommands`，生成底部工具栏与素材轨领域菜单的可见集合。该兼容字段现在只表示视觉隐藏，不能参与 `PluginCommandRegistry`、快捷键、Agent 或 CLI 能力判断。设置页即使取消勾选，仍允许修改该工具快捷键；只有插件停用或卸载才真正拒绝命令。

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

确认后的模型只允许一次 `image_gen(scopeExecution="all-goal-sources")`，`runtime/goal-image-execution.cjs` 校验 Goal metadata、TaskScope、SOURCE binding、容器顺序、本地路径和 hash 完全一致，再由 runtime 逐 binding 展开。`runtime/goal-probe-admission.cjs` 是 Main 进程唯一 Goal admission owner：probe 串行且优先于新 ramp，已通过 Goal 在 wave 边界公平共享冻结容量，retry hold、同项目唯一 lease、跨 Goal circuit 和 provider draining 都在这里决定。`runtime/image-batch-scheduler.cjs` 负责每个 Goal 内的 `1–2` probe 与 `2 → 4 → configuredConcurrency` 波次，并且只有请求、资产落盘、Sharp 完整解码、非零尺寸和交付画幅都通过后才完成 token。Goal 结果按 SOURCE 聚合为每个母图一个图片组，组内条目独立保存 Commerce 槽位、语言、SKU 与幂等 provenance；取消和熔断只能阻止未派发请求，已被上游接受的请求仍可能完成并计费。

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
  ├─ 纯文生图：POST /v1/image-tasks → task_id → 每 2.5 秒 GET /v1/image-tasks/:id
  │    └─ SparkAI Extension 内存凭据/SQLite 状态 → 私网原生 New API /v1/images/generations
  ├─ 编辑/参考图/蒙版：继续使用 /v1/images/edits
  └─ image-task 创建端点明确不支持时：回退既有 Responses-first / Images 同步兼容链路
  → 项目 output 资产
  → workflow action
  → Renderer 归组与溯源
```

`generate/edit/replace/variants/layers/cutout/redraw` 是桌面 Agent 的普通业务语义；远端边界是 OpenAI-compatible relay、用户会话、模型、计费和图片结果。新装默认 Agent 模型为 `gpt-5.6-terra`，默认图片模型为 `gpt-image-2`；目录仍保留上游返回的原始模型 ID 与大小写。普通 `parallel` 多图按配置并发上限使用 direct wave 同批启动，每个请求完成时立即发出 `image-result` 并用同一 operation 增量更新一个图片组，最终资产按实际完成顺序排列。Goal v1 刻意缩小为 `edit | replace | variants`，每个冻结 binding 按已确认的 `operationsPerAsset` 输出，总请求不超过 200；跨境电商多项矩阵接受并强制校验等长 `items`，单项矩阵改用顶层槽位/语言元数据。Goal 不接受额外 REFERENCE、layers、cutout、redraw 或运行中 SOURCE/REFERENCE 变化；Goal steer 只允许文字，范围变化必须重新预览和确认。

桌面接入能力由构建产物内的 `dist/sparkai-access-policy.json` 固定，`runtime/access-variant.cjs` 是策略归一化、清单读取和 Main 设置强制的唯一 owner，Renderer 由 Vite 同源注入 `__SPARKAI_ACCESS_POLICY__`：

- `dual-access`（无限制版）：提供两种互斥且可运行时切换的接入模式。
- `sparkapi-account`（SparkAPI 专用版）：固定 `https://sparkapi.org`，强制 `account`、清空 Relay 覆盖，登录页和设置页不展示自定义入口，`naimage:server:configure-custom` 仍在 Electron Main 返回 `CUSTOM_API_ACCESS_DISABLED`。旧配置若来自其他账户地址，还必须清除旧 Session 与所选 Token，防止凭据跨域复用；未激活的自定义凭据可保留以便用户改装无限制版后恢复使用，但在专用版中不得参与传输。

无限制版的两种模式为：

- `account`：用户名/密码登录 SparkAPI/New API 后即可进入工作区，不请求设备 License。Cookie + `New-Api-User` 只用于 `/api/user/*`、`/api/token/*` 和更新；桌面列出、创建、编辑、分组、启停和删除用户密钥，并用用户选择的完整 Key 直连 `accountBaseUrl/v1`。完整 Key 优先兼容原生 New API 在 token 列表/详情中的返回值，脱敏部署则通过 `POST /api/token/:id/key` 按需取回；两者都只缓存在 Electron Main 内存，不进入 Renderer、设置文件、模型缓存或日志。`account-token-cache.json` 只按账户地址 + user ID 保存最多 8 份公开元数据快照，不保存任何 Key、Cookie、IP 白名单或模型限制。
- `custom`：当前设备必须先通过官方 License 服务激活或校验 `pro` 授权，之后用户才能配置 Base URL、API Key、Agent 模型和生图模型；桌面直接请求标准 `/v1/models`、`/v1/chat/completions`、`/v1/responses`、`/v1/images/generations` 与 `/v1/images/edits`，不发送 SparkAPI `group`。License 请求只含兑换码或 License token 与随机设备 ID，不上传 Base URL、API Key 或账号 Cookie。兑换码支持永久/限时、最大设备数和禁用撤销，管理员创建时默认 `pro`、3 台设备。

安装级 `licenseDeviceId` 与 Pro token 只授权自定义模式；账号模式不消费、不校验也不依赖该授权。切换到自定义模式不会删除账号 session，切回账号模式可以快速恢复；自定义 Base URL 已含 `/v1` 时，client 必须去重路径而不能产生 `/v1/v1/*`。Responses 请求允许标准 SSE，也允许 HTTP 200 JSON 回退；空 JSON、空 SSE 和只有 `[DONE]` 的 SSE 都必须作为空输出失败，不能伪装为 Agent 成功。

设置页数据加载是显式的离线优先边界：挂载时 `tokens({ preferCached: true })` 与 `models({ cacheOnly: true })` 只读 Main 本地快照；没有模型快照时回退到设置内模型池。切换设置分区不会联网；只有“刷新密钥与分组”“刷新模型”、密钥 CRUD 或切换密钥等明确用户动作可以请求 New API。模型磁盘快照即使超过 60 秒，在 `cacheOnly` 模式下也可用于离线显示，并标记来源/更新时间；正常运行时的 60 秒缓存规则仍保持。

对话模型和生图模型共用 `ModelConnectionBinding` 结构，但分别持久化为 `agentModelBindings` 与 `imageModelBindings`。自定义模式允许每个已选模型覆盖 Base URL/API Key，字段留空时继承全局连接；账号模式同时允许逐模型自定义 API Key 与账户 Token，顺序为“模型自定义 Key → 模型绑定账户 Token → 全局账户 Token”。账号模式故意忽略绑定中的自定义 Base URL，逐模型 Key 仍只向账号/Relay 地址请求，避免把模型 Key 变成未授权的 Base URL 入口。普通 Chat Completions 和 `/v1/responses` 对话都按请求体中的实际 `model` 解析对话绑定；Responses 生图继续由图片 provider 取图片连接，不能让顶层对话模型绑定抢占图片凭据。Main 在模型列表草稿合并前用当前已解密设置恢复 Renderer 占位符；逐模型 Key 与全局 Key 一样只进入 Windows `safeStorage` sidecar，普通 JSON、Renderer、日志和模型缓存均不含明文。模型缓存身份包含逐模型 Base URL/Key/Token 的 SHA-256 指纹，更换任一绑定后不得复用旧目录。无 Main 注入的 Agent Runtime 直连回退只在 `accessMode=custom` 时应用逐模型 URL/Key；账号 Token 始终由 Main 解析。最低验证为 `test:agent-model-binding`、`test:custom-api-transport`、`test:settings-secret-store`、`test:model-catalog`、`test:settings-lazy-load`、`test:access-variant`、`test:license` 和 `typecheck`。

账号模式纯文生图使用所选账户 Key 向同域 `POST /v1/image-tasks` 提交与 Images generation 相同的 JSON；Caddy 仅把 `/v1/image-tasks*` 分流到独立 SparkAI Extension，其余账号、Token、模型和计费接口继续由用户部署的原生 New API 处理。扩展服务把 Bearer Key 只保留在单进程内存，SQLite 仅保存 HMAC owner 与任务状态，HTTP 202 立即返回 `task_id`；Compose 强制加入现有 `SPARKAI_DOCKER_NETWORK`，后台最多按配置并行两项，以容器 DNS/内部端口形式的 `SPARKAI_NEW_API_UPSTREAM` 调用原生 `/v1/images/generations`，禁止重新经过 Cloudflare。客户端每 2.5 秒只做 GET，queued/running 继续，succeeded 进入原落盘/画布链路，failed 显示服务端错误；短暂 GET 网络错误、408/425/429/5xx 只重查同一 ID。拿到 `task_id` 后的所有错误以及创建结果不明错误都禁止重新 POST；扩展进程重启会把 queued/running 标记失败且不重放，优先避免重复扣费。自定义 Base URL 仍直接访问用户接口并在 task endpoint 明确不支持时回退既有同步链路，用户 Base URL/API Key 不上传 License 服务。任务化不提供 partial image；编辑、参考图和蒙版仍走原 `/v1/images/edits`。

生图 SOURCE/REFERENCE 输入和上游图片结果的受管格式为 PNG、JPEG、WebP；`image_gen.outputFormat` 未指定时默认 PNG，未知格式由 Electron Main 在 provider 派发前拒绝。这里的“上游结果格式”属于模型请求与项目资产落盘合同，本地“另存为”属于另一条完全离线的文件链路，不能混用计费语义或资产身份。

每张最终图片的生成参数使用独立、版本化的数据链路：请求配置先由 `runtime/image-generation-metadata.cjs` 做白名单快照；`desktop/new-api-client.cjs` 把 Images/Responses 最终事件中的实际字段附着为该图自己的 `actualParams`，重复最终事件只合并稍后补齐的参数；Electron Main 或 Agent direct fallback 在受管落盘时写入 `ImageAsset.generation v1`，并记录请求起止时间与耗时。`desktop/project-session-normalizer.cjs` 对顶层资产、分层组和旧分层合成中的所有图片资产统一清洗后才持久化，允许字段仅包括模型、比例、清晰度、请求尺寸、质量、输出格式/压缩、背景、审核、输入保真度、响应创建时间和本次运行时间，不保存 API Key、Token、Cookie、绝对上游 URL 或签名 URL。Renderer 的 `src/image-generation-metadata.ts` 将请求值、服务器响应值、成图实测值和本次运行值分源展示；最终比例、像素尺寸与文件格式来自已解码受管文件，不把请求默认值冒充响应。本地导入图没有 generation 时只显示真实文件信息，旧生成资产仍可从节点 `imageParams` 兼容回退。成果编辑器标题栏提供最大化/还原操作，最大化时整个编辑器铺满可用视口，预览和参数区同步扩展；参数标签、数值和来源标识保持至少 12 px 的可读字号，并在窄屏继续单列滚动。最低验证为 `test:image-generation-metadata`、`test:custom-api-transport`、`test:workspace-glass-ui`、`typecheck` 与 `aidebug:image-collection`。

#### 图片输出规格

`runtime/image-frame.cjs` 是图片画幅与交付清晰度的唯一归一化 owner。可选比例固定为 `1:1`、`16:9`、`9:16`、`4:3`、`3:4`、`3:2`、`2:3`、`21:9`、`9:21`、`4:5`；可选清晰度固定为 `1K`、`2K`、`4K`。设置页默认值、主 Agent 输入、空白画布手动生图表单、`agent.chat` 与 `agent.goal` 的 automation schema/CLI 都必须使用这同一组值。`imageRatio` 与 `imageResolution` 是独立的用户偏好，`imageSize` 是由两者计算的兼容/展示字段，不能被另一入口单独写成冲突尺寸；旧项目的 `720P`/`1080P` 或旧 `imageSize` 只作为读取迁移输入，正常保存统一写入当前规格。

Renderer 通过 `imageDefaults` 把顶部 Agent 对话框当前选择随每次 `agent:chat` 派发；`desktop/ipc/agent-ipc.cjs` 调用 `freezeImageFrameSettings()` 生成仅属于该次运行的 `imageFrameLocked` 快照，不写回设置。锁定后 `runtime/tool-schemas.cjs` 将公开 `ratio`/`resolution` 枚举缩为唯一按钮值，内部 `size` 同步固定为最终交付尺寸；`agent-runtime.cjs` 在普通、批量、Goal、分层及 redraw/cutout 区域路径再次调用 `imageToolArgsWithFrameContract()`，因此模型在顶层或 `items[*]` 返回的冲突值都被覆盖。真实上游请求携带冻结后的比例/清晰度和兼容 `requestSize`，Prompt 通过 `appendImageDeliverySpecification()` 追加画幅、清晰度、最终像素、安全区与禁止拉伸说明；画布成果、图片组和编辑器仍保存追加前的用户原始 Prompt。AskUser continuation 只把合法 `imageRatio/imageResolution` 随 `PendingAgentExecution v2` 保存，恢复时显式传回 `sendPrompt()` 并重新生成运行锁；`imageFrameLocked` 本身仍不持久化，旧挂起任务缺失字段时兼容回退到当前设置。

对 `gpt-image-2`，该模块会将交付尺寸规整为 16 的倍数，并受最长边 3840 px、总像素 8,294,400 px 和比例上限保护；因此非方形 `4K` 可能按安全上限等比收敛（例如 `4:5` 为 `2576x3216`），不应把标签误解成所有方向均为 3840 px。`size` 表示最终交付尺寸，`requestSize` 只是上游兼容请求画布（`1024x1024`、`1536x1024` 或 `1024x1536`）的选择依据；两者都必须经 `normalizeImageToolFrame()` 生成，不能在 Renderer、CLI 或 Main 手工重算。对应最小验证为 `test:image-frame-contract`、`test:agent-run-control`、`test:goal-runtime`、`test:agent-text`、`test:custom-api-transport` 与 `typecheck`。

单张画布资产的另存链路为：Renderer/`canvas.export-image` 只提交节点、槽位和目标格式 → Main 校验并物化项目受管源图 → 原生 Save 对话框取得用户目标授权 → `desktop/image-export-service.cjs` 按真实解码元数据识别源格式并在必要时使用 Sharp 转码 → 写入用户选择的位置。可选格式为 PNG、JPEG、WebP、AVIF、TIFF；JPEG 固定以白色背景展平 alpha，其余格式保留 alpha。相同格式可直接复制，跨格式转换在本机完成，不调用 Agent 或图片模型、不消耗生图额度，也不改变受管源图。新目标优先以同卷 hard-link 原子发布；文件系统不支持 hard-link 时回退到 `COPYFILE_EXCL` 排他复制，两条路径都不得覆盖并发创建的文件。确认覆盖才执行原子替换，Main 以真实父目录规范化目标锁并对所有既有目标执行锁内最终确认。分层成果原有 Photoshop PSD 导出继续独立保留，不经过单图格式转换降级。

#### 图片组命名、替换、导出与查看器竞态

`src/image-collection-mutation.ts` 是图片组纯数据 mutation 的唯一 owner。`renameImageCollections()` 对名称做 NFKC 归一化、Windows 保留名/非法字符清洗、80 字符上限和稳定去重，并一次同步节点标题、`imageCollection.name` 与 `imageContainerSpec.collection.name`；整批校验失败不修改输入。`replaceImageCollectionItems()` 只接受当前项目已经落盘的受管节点/资产，保留原 `requestIndex`、prompt、title、`taskProvenance` 和槽位，向原 item 写入 `replacedByAssetId`，并在单独的 `collectionRole:"defects"` WorkflowNode 中保存原图、`sourceCollectionId`、`defectOfNodeId`、`replacesItemId` 与 `defectReason`。替换先全量预校验，重复提交同一替换是幂等 no-op，失败不会部分写入。

`desktop/image-collection-export-service.cjs` 是 Main-only 文件系统 owner；`desktop/ipc/image-collection-ipc.cjs` 只暴露 `naimage:image-collection:export-preview`、`naimage:image-collection:export` 与 `naimage:image-collection:open-folder` 三个有界桥。Renderer 先刷新项目 session，再以 `expectedProjectId + collectionIds + format` 请求预检；Main 重新读取权威 session，返回 PNG/JPEG/WebP/AVIF/TIFF 格式、图片/槽位/失败/等待数量、源体积、预计体积、固定 `relativeRoot:image-groups` 和内容绑定 `previewToken`。正式导出必须显式确认并提交该令牌，任何受管资产、组内容、格式或项目漂移都会拒绝并要求重新预检。输出固定为项目内 `image-groups/<稳定组名>/`，一个组对应一个同名目录，多组选中先全部写入同一 staging，再统一备份旧目录和原子发布多个同级目录；任一发布失败会删除本批新目录并恢复全部备份。文件按 `requestIndex`/槽位稳定命名并写入 `image-group.json`，manifest 只保存项目/组/关系/哈希等受控元数据，不写入绝对源路径。重导出会替换同组旧目录；打开目录时优先新位置，并兼容读取旧 `exports/image-groups/` manifest；未导出组返回 `IMAGE_COLLECTION_NOT_EXPORTED`。受管原图不移动、不覆盖，避免改变资产身份与历史引用。

普通 PNG/JPEG/WebP/AVIF/TIFF 另存由 `desktop/image-export-service.cjs`/`naimage:asset:save-as` 处理，单图 PSD 与分层 PSD 继续走各自的 PSD IPC/worker，三条路径互不隐式调用或共享目标状态。Main 取得原生授权后仍强制普通图片位于 `<project>/exports/images/`、PSD 位于 `<project>/exports/psd/`、图层目录位于 `<project>/exports/layers/`，最终文件和目录都必须通过真实路径复核，不能借链接或竞态逃逸项目根。`src/image-viewer.tsx` 保留双缓冲：稳定的 `viewerAssetIdentity`、递增 preload sequence、source/identity/target 三重校验和 `decode()` 成功后才切换 displayed frame；旧 preload、旧 decode 或 outgoing DOM load 不能覆盖最新选择。舞台真实状态通过 `data-final-asset`、`data-target-asset`、`data-displayed-asset`、`data-displayed-src`、`data-target-src` 和 `data-buffering` 暴露，最终缩略条只呈现受管最终资产。

中间图只进入 `image-preview` 进度和 Renderer 的临时 `streamingImagePreviews`。`src/streaming-image-preview.ts` 按父 operation、生成节点与一基 request slot 建立归属；分层任务为每个图层传递独立 slot；`src/main.tsx` 再通过 layout projection 把 partial 放进目标单图、批量容器、连续系列或分层占位组的 pending tile。同一 `operationId + requestIndex` 只保留最新一张；最终 `image-result` 到达后在下一动画帧按槽位清理，使同批到达的最后一张 partial 至少真实绘制一次，随后立即由最终受管资产收口；失败、停止或工具终态清理整个 operation。中间图不进入 Agent 时间线卡、主/独立 Agent 对话窗口、项目成果、会话历史或图片库。单次图片计划最多 200 张，实际并发受用户配置和 10 路硬上限保护；任何失败仍按原请求槽位返回，不把中间图伪装成最终成果。Main 只记录模型、尺寸、质量、Prompt 字符/UTF-8 字节数和 body keys 等脱敏 metadata，不记录 Prompt 内容、API Key、Cookie。

Renderer 的预览容器以 `data-stream-preview-count`、`data-preview-index` 和 `data-preview-total` 暴露当前替换状态；同一 `operationId + requestIndex` 永远只保留最新一张。`NAIMAGE_AIDEBUG_IMAGE_PARTIALS=1..3` 可让 Electron mock 分阶段发图；`aidebug:image --image-runs=1` 会并发采样真实 DOM 的索引、槽位和 `src` 指纹并验证终态清零。当前无付费权威报告为 `.diagnostics/electron/aidebug-2026-08-05T05-51-40-277Z/agent-image-suite.json`，3 个图片任务均观测到 `1/3 → 2/3 → 3/3`、每槽 3 个不同源指纹、`maxConcurrentTiles=1` 与 `finalPreviewCount=0`。

AIDebug mock 图片路径由 `electron-main.cjs` 编排，但尺寸归一化、图层提示兼容推断和确定性 PNG base64 只由 `desktop/aidebug-image-fixture.cjs` 实现；真实图片服务请求、项目资产落盘与返回 DTO 不经过该 fixture owner。

### 4.5 本机 Agent 自动化

```text
Codex / Claude Code / OpenCode / OpenClaw
  ├─ integrations/naimage-control/scripts/naimage.ps1（CLI）
  └─ integrations/naimage-control/scripts/naimage-mcp.mjs（MCP stdio）
       → integrations/naimage-control/references/commands.schema.json（唯一命令注册表）
  → <configRoot>/automation/endpoint.json（端口 + 每次启动随机 Token）
  → http://127.0.0.1:<random>/v1/execute
  → desktop/automation-service.cjs
       ├─ Renderer command → preload naimageAutomation request/response → src/main.tsx 生产状态与生产动作
       └─ debug.* service command → desktop/debug-command-service.cjs（仅开发/AIDebug）
```

`integrations/naimage-control` 是随安装包分发的正式 Skill；设置页可检测并复制到各 Agent 的 `skills/naimage-control`。安装目录的 `.naimage-connection.json` 只保存 endpoint 文件位置与 EXE 路径，不保存 Bearer Token；CLI/MCP 每次从应用私有 endpoint 文件读取当前 Token，MCP 工具列表直接由同一 schema 生成，调用仍落到 `/v1/status` 或 `/v1/execute`，不复制任何画布、Agent、持久化或计费逻辑。服务只监听 loopback，Renderer 不使用任何 AIDebug hook。`references/commands.schema.json` 是命令名、surface、参数示例、枚举和图片格式元数据的共享注册表，由 `scripts/automation-command-reference.mjs` 生成 Renderer/service registry 与命令参考，Main 的格式扩展名/MIME/Save 过滤器也读取同一注册表。

`debug.runtime-state`、`debug.renderer-logs`、`debug.main-logs`、`debug.run-targeted-test`、`debug.capture-window`、`debug.inspect-ipc` 和 `debug.inspect-command` 由 Main service 分流，不占用或复制 Renderer handler。它们仅在源代码开发态或显式 AIDebug 可用；生产安装包默认返回 `DEBUG_COMMAND_DISABLED`。日志和状态有界递归脱敏，截图固定写诊断目录且不接受路径/窗口 ID，测试执行固定在仓库根目录、使用 schema 枚举白名单、无 shell、清除凭据型环境变量并裁剪输出；它们不能安装依赖、编辑/删除代码、修改用户项目资产或调用模型。

公开业务命令覆盖项目、工作台领域、画布状态/选择/容器/导入和 Agent 会话；`workspace.domain.list/get/set` 与 `project.create.workspaceDomain` 使用当前项目 guard 和同一 Renderer 状态，不触发模型或计费。GUI/CLI/MCP 同步提供 `canvas.import-video`、`canvas.generate-video`、`canvas.export-image`、`canvas.rename-image-collections`、`canvas.replace-image-collection-item`、`canvas.export-image-collections`、`agent.goal`、`agent.steer`、`agent.pause`、`agent.resume`、`agent.stop`、`commerce.template.*` 与 `commerce.catalog.compare/select`。三条图片组命令都只传 `expectedProjectId`、canvas revision、组/节点/资产身份和明确确认值：重命名与替换由 `src/main.tsx` 提交 `workflow.image-collection.rename/replace`，导出由 `workflow.image-collection.export` 进入 Main-only 文件服务；CLI/MCP 不接受任意绝对路径。`canvas.import-video` 只接受用户授权的本地 MP4/WebM/MOV/M4V 路径，经 Main 复制到当前项目受管视频库后创建独立成果节点，不调用模型。`canvas.generate-video` 必须携带当前 `expectedProjectId` 与 `confirmed=true`，每次只创建一个已预写 journal 的任务；远端 ID 已确认后仅恢复轮询和下载，`ambiguous:true` 不得自动替换或循环重发，当前 Seedance 请求仍待用户授权的一条最小兼容验证。`canvas.export-image` 只接受 `nodeId`、`assetIndex` 和 PNG/JPEG/WebP/AVIF/TIFF 格式，通过 GUI 同一原生 Save 对话框获得目标授权；命令不能传任意目标路径，本地转换不调用模型或消耗额度，真实导出失败必须作为 CLI/MCP 失败传播，只有用户取消是正常 no-op。`agent.goal` 和 `commerce.compose-set` 的一次调用即是用户对上游扣费的授权；Renderer/Main 先构建并消费一次性冻结 receipt，返回 probe、渐进放量、熔断、请求计数和可能已计费边界，不再要求第二个 `confirmed`/snapshot 确认。`agent.steer.taskScopeMode` 提供常用简写，`sourceMode`/`referenceMode` 可独立选择 `keep | replace | merge | clear`，清空全部或删除所选还必须传 `confirmed=true`。`canvas.import-skill` 与画布菜单“导入 SKILL.md”通过 `naimage:project-skill:parse` 共用 `desktop/skill-import.cjs` 的解析、长度限制和 `CanvasSkill` 身份；PowerShell CLI 优先用 `-SkillPath` 在本地读取用户授权文件，只把 Markdown 和 basename 交给 Renderer，再由 Main 解析。当前只导入一个不超过 256 KiB、指令不超过 24,000 字符的 Markdown 文件，不复制同级 scripts/references/assets；绝对源路径不进入请求或 session。导入结果仍是带 Skill 元数据的 requirement，执行继续走 requirement TaskScope、输入关系和重复执行 gate。新增可自动化产品动作时必须同步 schema、Renderer handler、CLI/MCP 文档、Skill 和对应专项合同。

个人需求模板库命令为 `requirement-library.list`、`requirement-library.save`、`requirement-library.delete` 与 `requirement-library.use`。`list` 读取跨项目共享的安装级个人库；`save` 以当前项目 ID 和来源 Requirement 的精确 revision 为 guard，新建模板或用模板精确 revision 做 CAS 覆盖；`delete` 必须携带模板精确 revision 与 `confirmed=true`，且不删除已实例化的画布节点；`use` 必须校验模板精确 revision，可带有序 SOURCE/REFERENCE bindings 及 canvas revision guard，但只在当前画布创建普通 Requirement，不执行需求、不调用模型、也不产生图片额度费用。带 `CanvasSkill` 元数据的条目实例化后仍遵循普通 Requirement 的 TaskScope 与执行 gate。

Graph CLI 与 GUI 共用生产画布关系实现，不维护第二套图模型。`canvas.state` 返回权威 `canvasRevision`、锁、关系和活动状态；严格 `canvas.select` 在改变选择前校验全部 ID 与 primary，不允许 stale 集合部分生效。所有图 mutation 强制 `expectedProjectId`，并可携带 `expectedCanvasRevision` 做 canvas CAS；Requirement update/execute 额外强制 `expectedRevision`。连接/断开、归组/解散、位移及 Requirement create/update 在完整节点/边集合、锁、兼容类型、循环与 binding 预校验后一次提交，任一输入 stale/非法时整批失败；execute 在异步 Agent 派发前完成 revision/TaskScope fence，provider 和结果持久化不属于图提交事务。成功 mutation 返回新 revision/receipt，后续要求严格 CAS 时必须携带最新回执。最终真实 Electron loopback CLI 证据为 `.diagnostics/electron/aidebug-graph-cli-2026-07-29T16-05-00-768Z/report.json`，配套 review/montage 位于 `.diagnostics/aidebug-review/review-graph-cli-2026-07-29T16-05-00-768Z/`；证据覆盖 Electron 内 `900x640` Renderer CSS 视口，未记录原生 BrowserWindow bounds。

### 4.6 Agent 上下文与 checkpoint

`SparkAI WorkSpace Agent = Codex 式通用 Agent Runtime + 视觉创作领域 Agent`。通用部分拥有长上下文、模型协议历史、工具循环和 checkpoint；视觉领域部分拥有画布快照、TaskScope SOURCE/REFERENCE、图片容器、Image Gen 与 FastMemory 绘画经验。

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

`src/agent-panel-layout.ts` 是布局计算、停靠转换、边界限制和 CSS preview 的唯一 owner；`main.tsx` 只编排 pointer capture 与提交。上/下停靠调整高度，左/右停靠调整宽度。`floating` 明确指主 Renderer 内浮动；可拖出主窗口的独立 Electron `BrowserWindow` 由下述窗口服务和 IPC 链路单独拥有。Agent 普通正文、Markdown、thinking 与工具说明显式允许浏览器原生文本选择和 `Ctrl+C`，不为每条普通消息增加复制按钮；已有生图提示词专用复制动作保持不变。面板专项入口为 `test:agent-panel-layout` 和 `test:agent-panel-ui`。

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
  → desktop/plugin-state.cjs + src/plugin-state.ts 双侧清洗安装状态与 canvasToolShortcuts
  → 设置页安装 / 授权 / 启用 / 停用 / 卸载
  → 设置 > 工具录制快捷键、全工具冲突保护、单项恢复 manifest 默认值
  → 启用插件时动态 import src/plugin-system.ts
  → PluginCommandRegistry 在执行前复核安装状态、启用状态和权限
  → activePluginToolbarItems(..., workspaceDomain) 按当前领域投影
  → 画布底部居中 toolbar contribution + 电商素材轨轻量快捷投影
  ├─ plugins/commerce-set-schema.json
  │    → src/plugins/commerce-set.ts 归一化 generate/translate 计划、请求矩阵、费用计数和稳定 snapshot material
  │    → translationItems + planMaterialHash 冻结图片×语言逐单元格要求
  │    → desktop/plugin-task-prompts.cjs 读取同一语言与上限注册表
  ├─ src/commerce-set-dialog.tsx（自然异步完整配置表面）
  │    → src/commerce-translation-dialog.tsx 保留现有翻译命令兼容适配
  │    → preload "naimage:plugin:compose-task"
  │    → desktop/ipc/plugin-ipc.cjs
  │    → desktop/plugin-task-prompts.cjs
  │    → Renderer sendPrompt() → runtime/goal-image-execution.cjs 按 SOURCE×语言逐项派发
  ├─ plugins/commerce-catalog-schema.json
  │    → desktop/project-commerce-catalog.cjs 项目级商品/SKU/素材持久化与 CAS
  │    → desktop/ipc/commerce-catalog-ipc.cjs + preload
  │    → src/commerce-catalog-dialog.tsx（自然异步本地管理表面）
  │    → Renderer 共享命令注册表 + Agent CLI
  │    → src/goal-task-scope.ts 按 SOURCE 冻结无歧义母图归属
  │    → runtime/goal-image-execution.cjs + agent-runtime.cjs 写入结果 provenance/result key
  │    → Renderer 保存 session → Main 按 TaskScope hash 幂等原子归档
  ├─ plugins/commerce-template-schema.json
  │    → desktop/commerce-template-library.cjs 安装级内置/个人模板、严格 portable v1 与 revision CAS
  │    → desktop/ipc/commerce-template-ipc.cjs + preload 原生导入/导出与变更广播
  │    → src/commerce-template-dialog.tsx（自然异步模板市场）
  │    → Renderer 共享命令注册表 + Agent CLI
  ├─ src/commerce-ab-dialog.tsx
  │    → desktop/project-commerce-catalog.cjs 同槽位结果分组、Catalog/Product 双 CAS 原子终选
  │    → desktop/ipc/commerce-catalog-ipc.cjs + preload
  │    → Renderer 共享命令注册表 + Agent CLI commerce.catalog.compare/select
  ├─ desktop/project-commerce-export.cjs
  │    → Amazon/速卖通规则、真实文件/哈希/解码检查与商品/变体/SKU 结果继承
  │    → desktop/ipc/commerce-export-ipc.cjs + preload 原生目录授权
  │    → src/commerce-export-dialog.tsx（自然异步预检与 SKU 包表面）
  │    → Renderer 共享命令注册表 + Agent CLI commerce.export.preview/package
  ├─ preload "naimage:project-graph:import"
       → desktop/project-graph-adapter.cjs 只读 .prg/JSON
       → desktop/plugin-task-prompts.cjs 生成有界 GRAPH Prompt
       → 返回 graph + task DTO
       → Renderer sendPrompt() → 按概念分支形成独立学习图片
  ├─ sparkai.social-content
  │    ├─ 小红书/抖音自然异步配置框 → 结构化 Requirement.socialPlan
  │    ├─ workflow(update_social_content) → revision/workflowId/planHash 原子回写
  │    ├─ 图片 socialContent provenance + 现有视频任务 journal
  │    └─ 原生目录授权发布包 + social.* 共享 Automation/CLI
  └─ sparkai.scientific-figure
       ├─ plugins/scientific-figure-schema.json + runtime/scientific-figure-plan.cjs
       ├─ src/scientific-figure-dialog.tsx（自然异步计划/任务表面）
       ├─ window.naimageScientific → 7 个受限 IPC → desktop/scientific-runner-service.cjs
       ├─ 受管数据、任务 journal、Python/R 单后端运行、Panel/组合图与投稿格式导出
       └─ research.data.* + research.figure.* 共 7 个共享 Automation/CLI 命令
```

插件只接受随应用发布的受信任声明式 manifest，不允许任意 JavaScript 注入 Renderer，也没有项目文件写权限。插件命令只能经主 Renderer 已登记的 handler 调用现有产品动作；`sparkai.commerce-toolkit` 申请 `canvas.read-selection`、`agent.submit-task`、`canvas.write-results`。领域过滤发生在已安装/启用/授权和用户隐藏设置之后，只改变工具可见投影，不自动安装、启用或执行插件。manifest 的 shortcut 是默认值，`AppSettings.canvasToolShortcuts` 只保存不同于默认值的用户覆盖；Renderer/Electron 使用同一规则清洗字母、数字、F1-F12 与 Mod/Ctrl/Alt/Shift 组合，并保守忽略未知、畸形或重复组合。设置页冲突时不修改原值，可单项恢复默认；主 Renderer 分派解析后的有效组合，底部工具按钮和工作台菜单均不渲染快捷键文本，只更新 hover 文案与 `aria-keyshortcuts`。这是本机 UI 偏好，不新增 Agent CLI 动作。`plugins/commerce-set-schema.json` 是电商语言、单次请求上限、probe/ramp 策略和默认七张套图槽位的共享注册表；`src/plugins/commerce-set.ts` 提供 generate/translate 两种计划、单/多母图矩阵、请求/费用计数及按有序 SOURCE 生成的稳定 snapshot material。翻译计划的 `translationItems` 精确绑定零基 SOURCE 序号与语言，标准化后进入 `planMaterialHash` 和 Goal 冻结范围；运行时逐 SOURCE×语言读取对应 Prompt，不允许派发后改变单元格材料。`src/commerce-set-dialog.tsx` 位于现有自然异步插件 chunk，支持图片×语言矩阵、逐单元格 Prompt、整套张数、逐图标题/Prompt、目标语言、Requirement/Skill 保存意图和执行前 probe/费用风险预览；用户点击 Commerce 执行即授权上游扣费并一次直接派发，不再经过第二个费用确认弹窗，Requirement 重跑仍保留 Goal 确认。跨境电商工具栏的一键套图与一键多国语言均接入主 Renderer 和共享 command runtime，派发后可落盘 Requirement/Skill，并可从对应节点复用执行。`src/commerce-translation-dialog.tsx` 继续作为旧翻译入口的兼容适配层。真实 Electron 专项报告为 `.diagnostics/electron/commerce-set-2026-07-31T15-38-04-682Z/report.json`，覆盖标准与 `900×640` 矩阵、模板市场、A/B 终选、快捷键冲突/覆盖、直接派发、过期 SOURCE 拒绝、正常图片容器圆角和工具启停，共 29 checks / 27 screenshots / 0 failures；高 DPI 截图只在原始像素与 CSS 视口同比例时归一化，不掩盖真实裁切。`sparkai.project-graph` 申请 `project.read-graph`、`agent.submit-task`、`canvas.write-results`；它显式清空画布/附件继承，只把导入 GRAPH 作为知识 SOURCE。`.prg` 是 ZIP，适配器只读取最大 16 MiB 的 `stage.msgpack`，最多输出 1000 节点和 3000 关系，不读取附件、不执行扩展、不暴露绝对路径、不修改 `.prg` 或 session。`sparkai.scientific-figure` 以 `plugins/builtin/sparkai.scientific-figure/` 作为可拆包目录，只内置 Agent 工作流契约和 Apache-2.0 notice，不打包上游图库、示例或 Python/R 依赖；定量绘图必须先选择 Python 或 R，之后同一任务不得混用后端，也不得虚构实验值或统计。插件命令的长 Prompt 统一由 `desktop/plugin-task-prompts.cjs` 在受信任 Electron 侧生成；Renderer 只保留计划配置、对话框和有界 task DTO 消费，`src/plugin-system.ts` 仍按启用状态动态加载。专项入口为 `test:commerce-set`、`aidebug:commerce-set`、`test:plugin-system`、`test:project-graph` 与 `test:ipc-registration`。

`plugins/social-content-schema.json` 同时约束小红书和抖音的默认值、枚举与数量上限；`runtime/social-content-plan.cjs` 与 `src/plugins/social-content.ts` 镜像计划归一化、稳定 `workflowId/planHash`、写回校验和成果元数据。计划零模型、零费用地进入现有 Requirement；执行命令才明确授权可能计费的图片/视频生产动作。小红书产出标题、正文、标签、封面与 6–9 张卡片；抖音产出 Hook、文案、5–8 个分镜、字幕、封面并复用独立视频状态机。视频 journal 保留社媒身份且恢复时不得重复创建。`desktop/project-social-export.cjs` 只导出通过 workflow/revision/hash 与受管资产复核的相对发布包，目标目录必须由 Main 原生授权，Renderer/CLI 不接受路径。共享命令为 `social.xiaohongshu.plan/execute/export` 与 `social.douyin.plan/execute/status/export`；专项为 `test:social-content`、`test:social-export`、`test:video-node`、`test:automation-service`、`test:ipc-registration` 和单一 `aidebug:social-content`。

`plugins/scientific-figure-schema.json` 同时驱动 Renderer 与 runtime 的计划归一化、Automation schema 和契约测试。数据必须通过原生选择导入为项目受管 CSV/TSV/TXT；`desktop/scientific-runner-service.cjs` 按项目串行 journal mutation，执行受信任内置脚本，关闭代理/依赖安装通道，并对超时、取消、日志、输出签名、尺寸与受管落盘进行复核。任务固定选择 Python 或 R，不混用后端，不推断显著性、样本量或研究结论。Renderer 仅在 Requirement revision/workflow/hash 仍匹配时将 PNG 组合图和 Panel 预览写回 canonical 画布；SVG/PDF/TIFF、脚本、计划和 QA 继续留在受管输出。共享命令为 `research.data.import/list` 与 `research.figure.plan/render/status/export/cancel`；专项为 `test:scientific-runner`、`test:automation-service`、`test:ipc-registration`、`test:workspace-glass-ui` 和单一 `aidebug:scientific-figure`。Python 专项已验证，R 尚未在真实 R 环境验证。科研对话框以局部 `--ui-surface-radius` 覆盖共享默认值；Glass 全局规则必须消费该 token，不得把所有功能表面重置为固定圆角。

`src/commerce-tutorial.tsx` 是帮助中心启动的项目级零费用陪练编排层。它只读取 live 画布图片数、选择、`workspaceDomain`、Commerce 工具可用性、Agent 忙闲和 Commerce 受管成果计数，再回调 `src/main.tsx` 已有的导入、切换、套图、Agent、Focus 和导出动作；它不持有第二份 Commerce 业务或 Agent runtime。Agent 示例只填入输入框，不自动发送；只有基线之后新增 Commerce 受管成果才进入完成状态。进度以 `projectId` 为 key 保存在便利型 LocalStorage，切换项目时组件重新读取对应进度；设置未关闭时启动教学会先安全等待用户保存或关闭设置。可见专项为 `aidebug:commerce-tutorial`，不调用真实图片模型。

`plugins/commerce-catalog-schema.json` 同时驱动 Main、Renderer、CLI 文档与测试。目录独立保存到项目 `.naimage/commerce-catalog.json`，写操作使用目录与商品 revision CAS；归档商品和解除图片关联都不删除画布节点或源文件。Renderer 关联素材时只提交 `nodeId + assetIndex`，路径与资产身份由 Main 从当前项目验证。Commerce Goal 为每个无歧义 SOURCE 冻结 Catalog/Product revision、owner 和母图 link，运行时把该目标与稳定 result key 写入 provenance；Renderer 完成结果归组并保存实时 session 后，Main 只按项目 ID 与 TaskScope hash 扫描权威结果，校验受管文件、大小与 SHA-256，再跨商品单次原子归档。重放按 result key 幂等；目录、商品或母图归属发生变化时保守拒绝自动归档，已生成图片仍留在画布。多语言矩阵从 Catalog 结果 provenance 还原来源图片、语言与状态，GUI 与 Agent CLI 共用 `commerce.catalog.review`，在 Catalog/Product 双 revision guard 下把一个或多个 result link 标记为 `candidate`、`approved` 或 `rejected`，复核不会删除画布节点或受管图片。A/B 比较使用同一商品归属、SOURCE 关系、槽位/语言/角色分组，排除相同内容哈希；终选一次性更新 winner/siblings 状态并保留所有关系、provenance、画布节点和文件。

`plugins/commerce-template-schema.json` 同时约束内置/个人模板的 portable v1 文档、计划上限和严格未知字段拒绝。个人模板安装级持久化并使用 library revision CAS；导入始终创建新条目，导出由原生 Save 对话框授权，模板计划剥离来源专属翻译单元与 canvas saveTarget。模板市场和 A/B 对话框都走自然异步 chunk，GUI、共享 automation registry、CLI 参考和专项测试从同一命令契约生成/校验。

平台导出由 `desktop/project-commerce-export.cjs` 单独持有。Product 结果继承到全部目标 SKU，Variant 结果只继承到对应变体，SKU 结果只进入自身包；默认只导出 `approved`，可显式包含 `candidate`，始终排除 `rejected`。预检校验受管文件存在、SHA-256、完整解码、尺寸/比例与 Amazon 主图白边；缺失、哈希不符或解码失败阻断，平台合规问题只提醒。`desktop/ipc/commerce-export-ipc.cjs` 是目标目录授权 owner，Renderer 与 CLI 请求都不得携带目标路径；完成包按 `products/<商品>/<SKU>/` 稳定命名，manifest 只记录相对路径和输出 SHA-256。导出先写 staging，全部成功后原子发布，失败不得留下半成品。第一版输出普通目录包，不引入 ZIP 依赖。专项入口为 `test:commerce-export`、`test:commerce-export-ui`、`test:commerce-catalog-ui`、`test:automation-service` 与 `test:ipc-registration`。

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

`desktop/project-save-coordinator.cjs` 只协调顺序和 revision，不决定 session 内容、不直接选择文件路径。`workspaceDomain` 与画布/会话一起进入 session v5，`desktop/project-session-normalizer.cjs` 对缺失或非法值写回 `general`；它不进入节点 journal，也不改变资产身份。`desktop/project-session-merge.cjs` 是 Main 的 baseline 比较、事件采集/compact、字段时钟、提交顺序、tombstone/restore、writer checkpoint、causal barrier 与 stale-save 合并 owner；Renderer 只保存最近一次已确认 baseline 和 Main 回传的权威 mutation 状态。`project-store.cjs` 只拥有显式项目列表、active 项目、路径和 manifest，不再创建 `default` 虚拟项目；无项目时 load 返回内存空 Session，save 返回 `PROJECT_REQUIRED`，全局 `session.json` 仅作为旧数据迁移来源。`apply` 返回 `applied:false` 时不得推进 revision。该机制已由 `test:project-session-dual-renderer` 通过生产 save IPC 覆盖 edit/edit、edit/delete、delete/undo、连续快速保存和回执前后窗口销毁；领域字段的旧项目默认、新建项目/文件夹首写由 `test:workspace-domain` 覆盖。它仍只保护同一 Electron Main 进程，不是递归字段或远程多人协作 CRDT；assets、生成终态/进度和 provenance 保留专用兼容策略。

旧 AppData 数据只允许通过用户显式触发的 `desktop/project-data-migration.cjs` 迁移：预检受管旧项目、未索引目录和非空全局 Session，拒绝敏感文件、链接、AppData/源目录/安装目录目标，并在复制前检查目标可用空间；随后复制到同级 staging，逐文件校验大小与 SHA-256，写入项目级 FastMemory/conversation 状态和迁移标记，再原子发布、更新项目索引并保存 Main-only 回执。源数据在迁移成功后仍保留，只有用户第二次确认清理且源/目标/回执重新校验一致时才移入清理暂存区；任一失败会回滚索引和已发布目录。Main 继续只接受真正的布尔确认；由于 Terser 会把 Renderer 字面量 `true` 压成数字 `1`，`preload.cjs` 仅在迁移/清理 IPC 边界把 `true` 或数字 `1` 归一化为布尔 `true`，字符串 `"1"`、数字 `2` 和其他 truthy 值均不得提升。最低验证为 `test:project-data-migration`、`test:project-root-policy`、`test:ipc-registration` 和隔离 `aidebug:isolation`。

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
| `preload.cjs`, `agent-window-preload.cjs` | 主 Renderer 十组受限 context bridge（其中 `naimageRuntime` 是无 IPC 的只读运行时门禁），迁移/清理 production 数字确认的有界布尔归一化，以及独立 Agent 表面的 state/command 单用途桥 | 业务状态、磁盘实现、凭据展示、宽松 truthy 确认、第二个 Agent Runtime | `normalizeExplicitConfirmation`, `naimageRuntime`, `naimageConfig`, `naimageServer`, `naimageUpdater`, `naimageAgent`, `naimageAutomation`, `naimageAgentIntegrations`, `naimageVideo`, `naimageScientific`, `naimageAgentWindow`, `naimageAgentWindowSurface` | `test:ipc-registration`, `test:agent-window`, `test:lifecycle`, `test:aidebug-isolation`, `aidebug:gui` |
| `desktop/ipc/register-desktop-ipc.cjs`, `desktop/ipc/*-ipc.cjs` | Settings → GlassBackground → RequirementLibrary → CommerceTemplate → CommerceCatalog → CommerceExport → SocialExport → Scientific → Plugin → Automation → Updater → Session → Agent → Window → Debug → ExportCenter → Project → ImageCollection → Asset → Server → VideoTask 的固定注册顺序和各域 handler | 桌面服务实现、React 状态、跨域业务复制；依赖必须由 Main 显式注入 | `registerDesktopIpc`, `registerSettingsIpc`, `registerGlassBackgroundIpc`, `registerRequirementLibraryIpc`, `registerCommerceTemplateIpc`, `registerCommerceCatalogIpc`, `registerCommerceExportIpc`, `registerSocialExportIpc`, `registerScientificIpc`, `registerPluginIpc`, `registerAutomationIpc`, `registerAgentIpc`, `registerExportCenterIpc`, `registerImageCollectionIpc`, `registerAssetIpc`, `registerServerIpc`, `registerVideoTaskIpc` | `test:ipc-registration`, `test:lifecycle`, `aidebug:gui` |
| `agent-runtime.cjs` | Prompt/画布上下文组装、当前 `workspaceDomain` 的一句领域提示、模型感知 checkpoint/model/tool 协议循环、工具执行、runtime action 编排 | React state、窗口原语、直接画布 mutation、四套 Agent Runtime、SQLite/JSON memory CRUD、重复实现已抽出的策略/schema/响应解析/图片帧/观察副本规则 | `createAgentRuntime`, `chat`, `workspaceDomainPrompt`, `runTool`, `buildPromptMessages`, `compactConversationIfNeeded` | `test:workspace-domain`, `test:context-checkpoint`, `test:agent-text`, `test:agent-protocol`, `test:view-image` |
| `desktop/agent-run-control.cjs` | 按项目/会话/Renderer owner 持有父运行取消、暂停、节点锁、有界 steer 队列与可中断 child phase；owner/global 停止和空闲 scope 回收 | 模型/工具执行、协议历史、React UI 或项目持久化 | `createAgentRunControl`, `beginPhase`, `consumeSteers`, `steer`, `stopOwner`, `stopAll`, `isRunnable` | `test:agent-run-control`, `test:agent-steer`, `test:lifecycle`, `test:ipc-registration` |
| `desktop/project-store.cjs` | 显式项目列表与 active 项目、用户选择的项目目录/session/manifest v2、空项目状态和当前元数据路径 | 虚拟 `default` 项目、全局 Session 新写入、用户项目目录删除、session 字段清洗、资产扫描/hydration、保存队列或 IPC | `createProjectStore`, `projectSessionFromDisk`, `writeProjectManifest`, `ensureProjectFiles` | `test:project-root-policy`, `test:project-io`, `test:project-save-coordinator` |
| `desktop/project-data-migration.cjs` | 旧 AppData 项目/全局 Session 与项目级 Agent 状态预检、目标空间/冲突检查、SHA-256 复制验证、staging/原子发布、索引回滚和二次确认清理回执 | 启动时自动迁移、安装目录/AppData 目标、敏感文件复制、Renderer 私有路径、未经复核删除源数据 | `createProjectDataMigrationService`, `previewLegacyData`, `migrateLegacyProjects`, `cleanupMigratedSource` | `test:project-data-migration`, `test:project-root-policy`, `test:ipc-registration`, `aidebug:isolation` |
| `desktop/export-center-state-service.cjs`, `desktop/ipc/export-center-ipc.cjs` | 当前项目的导出预设、内容指纹与最多 200 条历史；项目根复核、严格 schema、临时文件后原子替换，以及 5 个有界 IPC | 任意目标路径、图片/PSD 转码、导出队列执行、Renderer 状态或跨项目共享配置 | `createExportCenterStateService`, `EXPORT_CENTER_STATE_RELATIVE_PATH`, `registerExportCenterIpc` | `test:export-center`, `test:export-center-ui`, `test:ipc-registration` |
| `desktop/project-session-normalizer.cjs` | session v5、`workspaceDomain` 旧项目默认、node mutation journal/writer checkpoint/causal barrier、node/message 清洗、图片资产身份与 `ImageAsset.generation v1` 白名单修复、视频成果清洗/中断恢复、容器迁移、pending execution 及其合法比例/清晰度 continuation 兼容 | 项目路径选择、磁盘 IO、资产扫描、凭据/签名 URL 持久化或 IPC | `sanitizeSession`, `normalizeWorkspaceDomain`, `sanitizePersistedImageAssetGeneration`, `sanitizePersistedVideoAsset`, `hydrateSessionAssets`, `repairSessionAssetIdentities`, `sanitizePersistedPendingAgentExecution` | `test:workspace-domain`, `test:project-io`, `test:video-node`, `test:asset-identity`, `test:image-container`, `test:image-generation-metadata`, `test:node-mutation-journal`, `aidebug:ask-user` |
| `desktop/project-session-merge.cjs` | 已确认 baseline 间的 mutation 事件采集/compact、stale-save 合并、节点 ID 重映射、字段 mutation clock、Main commitRevision、delete/restore barrier、writer checkpoint 30 天保留与安全 GC | React 状态、磁盘 IO、保存队列或远程协作 | `collectNodeMutationEvents`, `mergeProjectSessions`, `normalizeNodeMutationJournal`, `mergeNodeMutationWriterCheckpoints`, `compactNodeMutationJournal` | `test:project-session-merge`, `test:project-session-dual-renderer`, `test:node-mutation-journal`, `test:project-io` |
| `desktop/project-asset-repository.cjs` | 项目 asset index、recorded paths、图片/视频 session hydrate 与保存归一化；视频磁盘会话只保留受管相对路径，运行时重建绝对路径和 `naimage-asset:` URL | 项目列表、manifest 版本、package/export/import 或 IPC | `createProjectAssetRepository`, `buildProjectAssetIndex`, `projectAssetRoots`, `projectWritableAssetRoots`, `hydrateVideoAssetForProject`, `videoAssetForProjectSave`, `sessionForProjectSave`, `sessionWithProjectAssets` | `test:project-io`, `test:video-node`, `test:project-save-coordinator` |
| `desktop/project-package-service.cjs` | `.naimage` 图片项目包校验、大小/数量限制、可移植资产收集、导出写入、旧包导入恢复与路径重写；含视频节点时显式拒绝，避免把大视频塞入图片 Base64 包 | 项目列表、active project、IPC/dialog、视频流式打包或普通 session 保存队列 | `createProjectPackageService`, `packageProject`, `validateProjectPackageData`, `sessionFromPackage`, `importProjectPackage`, `NAIMAGE_PROJECT_PACKAGE_VIDEO_UNSUPPORTED` | `test:project-io`, `test:video-node`, `test:project-save-coordinator` |
| `desktop/project-graph-adapter.cjs` | 只读 `.prg` ZIP/`stage.msgpack` 与有界图结构 JSON 解析、Project Graph 对象引用还原、安全 DTO | 扩展执行、附件读取、Renderer、Agent 调用、项目/session 写入或绝对路径暴露 | `parseProjectGraphFile`, `parseProjectGraphBuffer`, `adaptSerializedStage` | `test:project-graph`, `test:ipc-registration` |
| `desktop/plugin-task-prompts.cjs`, `desktop/ipc/plugin-ipc.cjs` | 受信任内置插件的长 Prompt、语言/GRAPH 输入清洗和 task DTO 生成；插件 compose IPC 只公开有界结果 | Renderer UI、插件安装状态、图片请求、项目/session 写入或任意外部插件代码 | `composePluginTask`, `projectGraphTask`, `projectGraphPromptPayload`, `registerPluginIpc` | `test:plugin-system`, `test:project-graph`, `test:ipc-registration`, `test:bundle` |
| `desktop/theme-preset-service.cjs` | `naimage-theme v1` schema、十六进制颜色归一化、64 KiB 限制、原生导入/导出对话框与安全文件名 | Renderer 状态、CSS 应用、任意 CSS/URL/脚本解释或未授权路径访问 | `normalizeCustomThemePreset`, `parseThemePresetJson`, `createThemePresetService` | `test:theme-preset`, `test:settings-persistence`, `test:ipc-registration`, `aidebug:gui` |
| `desktop/glass-background-service.cjs` | 原生选择后的有界读取、最长边 3840 px 单帧 WebP 转码、SHA-256 内容寻址、严格 ID 加载与 30 天保留式 GC | Renderer/CSS 状态、原始路径公开、任意路径读取、即时删除或扫描删除未知文件 | `createGlassBackgroundService`, `glass-bg-`, `GLASS_BACKGROUND_RETENTION_MS` | `test:glass-background`, `test:settings-persistence`, `test:ipc-registration` |
| `runtime/glass-theme-presets.json`, `runtime/glass-theme-settings.cjs`, `public/glass-theme-bootstrap.js` | 六主题/三材质/强调色/范围 registry、Electron 归一化与原生窗口底色、React 前安全首帧投影 | React/画布状态、凭据或项目数据；bootstrap 不得信任 snapshot 内任意变量，启动期 registry 镜像不得静默漂移 | `naimage-glass-theme-registry`, `normalizeGlassThemeSettings`, `nativeWindowBackgroundColor`, `bootstrapNaimageGlassAppearance` | `test:glass-theme`, `test:settings-persistence`, `test:agent-window`, `test:ipc-registration`, `test:lifecycle`, `test:bundle` |
| `runtime/workspace-domains.json`, `runtime/workspace-domain.cjs`, `src/workspace-domain.ts` | 四领域 ID/标题/说明/图标/插件归属/简短 Prompt/工具名注册表及 TS/CJS 归一化 | 项目状态、React UI、插件安装、模型调用、领域专属业务或平行 Runtime | `WORKSPACE_DOMAIN_IDS`, `workspaceDomainDefinitions`, `normalizeWorkspaceDomain`, `workspaceDomainPrompt`, `workspaceDomainOwnsPlugin` | `test:workspace-domain`, `test:plugin-system`, `test:automation-service`, `typecheck` |
| `runtime/access-variant.cjs`, `src/access-policy.ts`, `vite.config.ts`, `scripts/release/{build-access-variants,build-windows,create-update-release,windows-release-orchestrator}.mjs` | 双接入/仅 SparkAPI 构建策略、产物清单、Renderer 常量、Main 设置强制、公开安装包命名与双安装包编排；公开制品只使用 `SparkAI-WorkSpace-Unrestricted-*` / `SparkAI-WorkSpace-SparkAPI-*`，electron-builder 的 `naimage-Core-*` 仅为嵌入品牌壳的内部临时包；开发 `--package` 默认跳过 Bundle，显式 `--enforce-bundle` 才执行 | 远端兑换码、账号计费、上游 Key、运行时可修改的生产开关、把内部 `naimage` 兼容名重新暴露为公开 Setup，或正式发布门禁豁免 | `SPARKAI_ACCOUNT_ONLY`, `SPARKAI_ACCESS_VARIANT`, `sparkai-access-policy.json`, `applyAccessPolicyToSettings`, `windowsInstallerArtifactName`, `windowsCoreInstallerArtifactName`, `windowsLegacyInstallerArtifactName`（仅清理/历史兼容） | `test:access-variant`, `test:update`, `test:release-orchestrator`, `typecheck`, `build:unrestricted`, `build:sparkapi`, `package:win:variants` |
| `plugins/social-content-schema.json`, `runtime/social-content-plan.cjs` | 社媒平台/类型/默认值/上限、计划与成果元数据归一化、稳定 workflow/hash、结构化写回及 Agent 执行 Prompt | React UI、图片/视频请求、项目 IO 或第二套社媒数据库 | `normalizeSocialContentPlan`, `socialContentWriteback`, `socialRequirementPrompt`, `normalizeSocialContentMetadata` | `test:social-content`, `test:plugin-system`, `test:video-node` |
| `plugins/scientific-figure-schema.json`, `runtime/scientific-figure-plan.cjs`, `desktop/scientific-runner-service.cjs`, `desktop/ipc/scientific-ipc.cjs` | 科研计划 schema/归一化、受管表格数据、项目 journal、受信任 Python/R 单后端执行、超时/取消、输出复核与原生导出授权 | 任意用户脚本、依赖安装、联网、研究结论推断、Renderer 画布 mutation 或绝对受限路径公开 | `normalizeScientificFigurePlan`, `createScientificRunnerService`, `registerScientificIpc`, `research.figure.*` | `test:scientific-runner`, `test:automation-service`, `test:ipc-registration`, `typecheck` |
| `desktop/project-save-coordinator.cjs` | 按项目串行保存、revision 规范化、旧写入拒绝 | session 清洗、路径选择、磁盘格式 | `createProjectSaveCoordinator`, `normalizeSessionRevision`, `enqueue` | `test:project-save-coordinator`, `test:project-io` |
| `desktop/model-catalog.cjs` | 模型响应解析、大小写去重、Agent/Image/Video 可见目录与默认模型选择、缓存键与缓存归一化；显式视频模型不混入对话或生图选择 | 网络请求、磁盘缓存时机、IPC 或视频生成调用 | `uniqueModelIds`, `isExplicitVideoModelId`, `preferredVideoModelFromList`, `splitModelSettings`, `cachedModelSettings` | `test:model-catalog`, `test:settings-persistence`, `test:new-api-transport`, `test:lifecycle` |
| `desktop/video-import.cjs` | 用户授权本地 MP4/WebM/MOV/M4V 的普通文件/大小/文件头验证，流式 SHA-256 复制、原子发布、重复内容复用与脱敏错误 | Renderer 节点 mutation、视频模型调用、项目 session 写入、源文件修改或任意路径扫描 | `importVideoFiles`, `inspectVideoSource`, `VIDEO_FORMATS`, `VideoImportError` | `test:video-node`, `test:ipc-registration` |
| `desktop/video-task-adapter.cjs` | `video-generations`/`videos` 端点选择、Seedance 待验证兼容请求、任务 ID/状态/进度/结果/错误归一化 | HTTP、凭证、重试、项目 IO、Renderer 状态或计费判断 | `createVideoTaskRequest`, `normalizeVideoTaskResponse`, `videoTaskEndpoints` | `test:video-node` |
| `desktop/video-task-service.cjs`, `desktop/ipc/video-task-ipc.cjs` | 视频任务预写 journal、POST 零重试、创建不明保护、GET 轮询/恢复、content→安全 URL 下载回退、受管结果落盘及公开 DTO/IPC | Chat Completions、Renderer mutation、批量派发、Key/绝对路径/签名结果 URL 公开、创建不明自动重建 | `createVideoTaskService`, `publicVideoTask`, `resumeAll`, `retryDownload`, `registerVideoTaskIpc` | `test:video-node`, `test:ipc-registration`, `test:model-catalog`, `test:settings-lazy-load`, `typecheck` |
| `desktop/project-social-export.cjs`, `desktop/ipc/social-export-ipc.cjs` | 社媒成果槽位/身份/受管文件复核、内容/字幕/manifest 生成、staging 原子目录发布和原生目标授权 | Renderer/CLI 目标路径、社媒数据库、模型调用、平台登录或自动发布 | `createProjectSocialExportService`, `preview`, `exportPackage`, `registerSocialExportIpc` | `test:social-export`, `test:automation-service`, `test:ipc-registration` |
| `desktop/agent-responses-adapter.cjs` | Chat Completions 请求到 Responses API input/tool/tool-choice 的纯转换 | HTTP、流读取、凭据或重试 | `responsesRequestFromChatRequest`, `responsesInputFromChatMessages`, `responsesToolsFromChatTools` | `test:agent-responses-adapter`, `test:agent-protocol` |
| `desktop/aidebug-image-fixture.cjs` | AIDebug mock 图片尺寸归一化、显式/旧 prompt 图层提示与确定性 PNG base64 | 真实图片服务、项目资产、用户图片、GUI suite 编排或 Main 生命周期 | `aidebugImageBase64`, `aidebugLayerFixtureHint` | `test:new-api-transport`, `aidebug:image-recovery`, `aidebug:gui` |
| `desktop/image-export-service.cjs` | PNG/JPEG/WebP/AVIF/TIFF 真实解码格式识别、schema 驱动的 Save 过滤器/扩展名/MIME、Sharp 本地转码、no-clobber 发布与确认后的原子替换；JPEG 白底展平 | 原生对话框、项目资产授权、Renderer 状态、模型请求、计费或 PSD 分层导出 | `IMAGE_EXPORT_FORMATS`, `convertImageForExport`, `decodedImageExportFormat`, `imageExportFilters`, `normalizeImageExportFormat` | `test:image-export`, `test:automation-service`, `test:ipc-registration` |
| `desktop/skill-import.cjs` | 单文件 SKILL.md frontmatter/正文解析、显式大小与字段限制、稳定内容 fingerprint，以及原生文件选择/读取 | React mutation、任意 YAML 执行、同级 Skill 资源复制或 TaskScope 执行 | `parseCanvasSkillMarkdown`, `canvasSkillContentFingerprint`, `MAX_SKILL_*`, `importSkillFromDialog` | `test:skill-import`, `test:automation-service`, `test:ipc-registration` |
| `desktop/requirement-library.cjs` | 安装级个人 Requirement 模板的懒读取/单文件 JSON 持久化、最多 200 项、可选 `CanvasSkill` 元数据、精确 revision CAS 与删除确认 | AppSettings、项目 session、画布 mutation、Requirement 执行、模型调用，或 bindings/节点 ID/坐标/运行记录/绝对路径持久化 | `createRequirementLibraryService`, `sanitizeRequirementLibraryDocument`, `RequirementLibraryError`, `reqtpl-` | `test:automation-service`, `test:ipc-registration` |
| `desktop/ipc/update-ipc.cjs` | 桌面更新 IPC channel 注册、操作错误到公开失败 DTO/进度事件的映射 | 更新清单校验、下载、回滚或安装进程实现 | `registerUpdateIpc` | `test:ipc-registration`, `test:update`, `test:update-rollback` |
| `desktop/new-api-transport.cjs` | 默认 Node HTTP、显式应用代理时的 Windows curl、请求/响应大小限制、流取消、活跃 curl 生命周期 | 设置持久化、登录、重试策略、Updater 状态；不得读取或修改 Git/系统全局代理 | `createNewApiTransport`, `newApiTransportFetch`, `stopActiveNewApiCurlTransports` | `test:new-api-transport`, `test:lifecycle` |
| `desktop/new-api-client.cjs` | New API URL、会话 cookie、重试、JSON request、图片任务单次创建与 2.5 秒状态轮询、managed relay JSON/SSE、Images SSE、Responses image_generation partial/final 解析与受限回退分类；自定义模型独立 Base URL/API Key 的 Images SSE 优先级 | 账户 UI、模型选择、图片落盘、raw socket/curl 实现；拿到 task_id 或创建结果不明后不得自动重发 POST | `createNewApiClient`, `newApiFetch`, `newApiRequest`, `newApiRelayImageTask`, `newApiRelayStream`, `newApiRelayImage`, `newApiRelayResponsesImage` | `test:custom-api-transport`, `test:image-stream-preview`, `test:new-api-transport`, `test:agent-protocol`, `test:lifecycle` |
| `desktop/account-token-service.cjs` | New API `/api/token/*` 列表/选择/CRUD、原生 token 响应与脱敏 `/key` 扩展兼容、按账户隔离的公开元数据磁盘快照、所选 token 元数据持久化、完整 Key Main-only 内存缓存与账号 `/v1` credentials | Renderer 表单、模型请求体、项目数据、磁盘 Key/Cookie/IP 白名单/模型限制或日志 | `createAccountTokenService`, `credentials`, `ensureSelection`, `list`, `select` | `test:account-token`, `test:settings-lazy-load`, `test:ipc-registration`, `typecheck` |
| `desktop/settings-secret-store.cjs` | 自定义 Agent/图片/逐模型 API Key 的 Electron `safeStorage` 加密 sidecar、普通设置去明文、Renderer 占位符恢复和旧明文迁移；普通设置损坏恢复不得删除 sidecar | 账号 Token 完整 Key、项目数据、明文日志、Renderer 解密或无加密回退写盘 | `createSettingsSecretStore`, `SETTINGS_SECRET_PLACEHOLDER`, `recover`, `restorePlaceholders` | `test:settings-secret-store`, `test:settings-persistence`, `typecheck`, `build` |
| `desktop/automation-service.cjs` | loopback HTTP 服务、每次启动随机 Bearer Token、endpoint 文件、Renderer 请求关联/超时与 Main service command 分流 | 业务命令实现、调试命令实现、远端监听或长期 Token | `createAutomationService`, `dispatch`, `rendererReady`, `resolveRendererResponse` | `test:automation-service`, `test:automation-debug`, `test:mcp-wrapper`, `test:bundle` |
| `desktop/debug-command-service.cjs` | 开发/AIDebug 的 7 个 service command：有界脱敏状态/日志、诊断目录截图、IPC/command 检查和无 shell 测试白名单；生产默认拒绝 | 任意命令/路径/窗口控制、代码或项目资产修改、依赖安装、模型调用、生产启用或业务动作复制 | `createDebugCommandService`, `TARGETED_TEST_SCRIPTS`, `DEBUG_COMMAND_DISABLED` | `test:automation-debug` |
| `desktop/agent-integration-service.cjs`, `integrations/naimage-control/` | Agent 配置目录检测、内置 Skill/PowerShell CLI/MCP stdio 包装的安装更新和受控移除；CLI/MCP 均读取共享 command schema 并转发 loopback bridge | 修改 Agent 全局设置、读取/输出 endpoint Token、直接编辑项目文件、复制 Renderer/Main 业务逻辑 | `createAgentIntegrationService`, `naimage.ps1`, `naimage-mcp.mjs`, `SKILL.md` | `test:agent-integration`, `test:automation-service`, `test:mcp-wrapper`, Skill `quick_validate.py`, `test:bundle` |
| `desktop/agent-window-service.cjs`, `agent-window-*` | 独立 Agent BrowserWindow 生命周期、已保存主题原生底色、主 Renderer owner 绑定、有界状态/命令中继、allowlist 外观镜像与隔离表面 | Agent Runtime、模型请求、项目写入、凭据、画布 reducer 或第二个设置 authority | `createAgentWindowService`, `getBackgroundColor`, `publishState`, `forwardCommand`, `applyGlassAppearance`, `naimageAgentWindowSurface` | `test:glass-theme`, `test:agent-window`, `test:agent-window-ui`, `test:ipc-registration`, `test:lifecycle` |
| `desktop/license-service.cjs` | 固定官方授权域名、自定义模式 `pro` 计划校验、安装设备 ID、24 小时缓存与 72 小时离线宽限；账号 scope 直接授权且不联网 | 激活码生成、数据库、账户计费、模型 Base URL/API Key 或 Renderer 表单 | `createLicenseService`, `verify`, `activate`, `requireActive` | `test:license`, `test:access-variant`, `test:ipc-registration`, `aidebug:auth-gate` |
| `runtime/context-strategy.cjs` | 模型族识别、上下文窗口、有效窗口、自动 checkpoint、保留用户意图及 Prompt/协议/画布/记忆预算 | 模型调用、消息持久化、设置 UI 或画布读取 | `contextStrategyForSettings`, `contextModelFamily`, `autoCompactTokenLimit`, `protocolMessageMaxChars` | `test:context-strategy`, `test:context-checkpoint` |
| `runtime/memory-store.cjs` | App 级 Prompt/context/tool/date memory 与 SQLite 元数据，以及项目内 `.naimage/agent/fastmemory.json`、`.naimage/agent/conversations.json` 的会话状态持久化和按会话清理 | 模型调用、compact 决策、画布状态、工具执行、把项目 FastMemory/summary/protocol 新写回 AppData | `createMemoryStore`, `getFastMemory`, `writeConversationSummary`, `appendConversationProtocolTurn`, `replaceConversationProtocolItems` | `test:project-data-migration`, `test:context-checkpoint`, `test:agent-text`, `test:agent-protocol` |
| `runtime/tool-schemas.cjs` | 公开/内部 Agent tool schema、图片模型工具契约、运行级画幅锁定枚举与 schema 选择 | 模型请求发送、工具执行、Prompt 或 runtime 状态 | `agentToolSchemas`, `toolSchemas`, `imageModelContractForSettings` | `test:image-frame-contract`, `test:agent-text`, `test:agent-protocol` |
| `runtime/responses-parser.cjs` | Chat/Responses 非流式响应归一化、文本/推理 delta 读取、tool-call 与 Responses output 流式聚合 | HTTP/SSE 读取、原生工具进度编排、Agent loop 或工具执行 | `messageFromResponse`, `responseFromStreamChunks`, `mergeResponsesToolCallEvent` | `test:agent-text`, `test:agent-protocol` |
| `runtime/controlled-shell-command.cjs` | `shell_command` 的只读 allowlist、cwd/路径越界防护、输出裁剪和无 shell 子进程执行 | Agent loop、模型 Prompt、Renderer、IPC 或任意写入命令 | `controlledCommandPlan`, `executeControlledCommand`, `isExploreCommand` | `test:controlled-shell-command`, `test:agent-text`, `test:agent-protocol`, `aidebug:gui` |
| `runtime/image-frame.cjs` | Image 2 比例、分辨率、质量、运行级按钮冻结、冲突参数覆盖、交付规格 Prompt 与 delivery/request size 归一化 | 模型请求发送、项目资产落盘或持久化运行锁 | `freezeImageFrameSettings`, `imageToolArgsWithFrameContract`, `normalizeImage2Size`, `normalizeImageToolFrame`, `appendImageDeliverySpecification`, `validateImageFrameFields` | `test:image-frame-contract`, `test:agent-run-control`, `test:goal-runtime`, `test:agent-text` |
| `runtime/image-generation-metadata.cjs` | 生图请求/逐图响应参数别名归一化、白名单合并、时间与耗时清洗及 `ImageAsset.generation v1` 构建 | 凭据、Prompt、上游 URL、图片解码、React 展示或项目 IO | `normalizeImageGenerationParameters`, `pickImageGenerationResponseMetadata`, `buildImageAssetGenerationMetadata` | `test:image-generation-metadata`, `test:custom-api-transport`, `test:image-stream-preview` |
| `runtime/image-batch-normalization.cjs` | `image_gen` 单项 `items` 兼容提升、占位项过滤、真实批次数与逐项画幅归一化 | 模型调用、图片服务请求、工具进度或画布 action | `createImageBatchNormalization`, `normalizeSingleImageItemCompatibility`, `normalizeImageBatchItems` | `test:agent-text`, `test:agent-protocol` |
| `runtime/goal-image-execution.cjs` | 冻结 Goal TaskScope 的严格校验、1–2 个不同容器代表图排序与 runtime SOURCE job 展开 | UI 确认、图片请求、落盘/解码实现、模型自行枚举 binding 或第二次 Goal 工具调用 | `validateFrozenGoalTaskScope`, `goalSourceJobs`, `goalScopeExecutionValue` | `test:goal-runtime`, `test:goal-task-scope`, `test:agent-text` |
| `runtime/goal-probe-admission.cjs` | Main 进程 Goal probe/ramp 准入、冻结容量、公平 wave、retry hold、同项目 lease、跨 Goal circuit 与 provider draining | Agent 生命周期/steer 语义、图片 transport 实现、Renderer UI | `createGoalAdmissionControl`, `createGoalProbeAdmission` | `test:goal-probe-admission`, `test:image-batch-scheduler`, `test:goal-probe-dual-renderer` |
| `runtime/view-image-payload.cjs` | `view_image` 允许根、安全读取、格式/尺寸识别、批量 payload 预算与 WebP 观察副本 | 会话持久化、画布预览、原图覆盖 | `prepareViewImageModelPayload`, `viewImagePathAllowed`, `viewImagePayloadBudgetForBatch` | `test:view-image`, `test:agent-protocol` |
| `update-release.cjs` | 更新清单 canonical text | 下载、安装、UI | `canonicalDesktopRelease` | `test:update`, `release:verify`, `package:update-e2e` |
| `src/server.ts` | Vite/AIDebug 浏览器服务回退，包括 Session 图片任务创建与轮询 | 正式 Electron 文件系统或完整 Agent bridge；已创建任务的 GET 失败不得回退同步 POST | `installBrowserServerBridge`, `waitForImageTask`, `LOCAL_NEW_API_PROXY` | `build`, `test:custom-api-transport`, `typecheck` |

### 5.2 Renderer 核心模块

| 路径 | Owns | Must not own | 关键导出/检索词 | 主要验证 |
| --- | --- | --- | --- | --- |
| `src/main.tsx` | App 状态、单画布交互、项目/会话、`workspaceDomain` authority、Agent 调用、runtime action 落地、partial 预览终态编排、普通节点 transform-only 拖动预览、wheel 按帧合并、密集画布交互降载和低缩放轻量节点投影 | 主进程文件 IO、真实 relay token、四套画布/Session/Agent state、已抽出表面的内部实现，或拖动期间逐帧提交 React `left/top`、每个 wheel 事件直接提交 React/DOM transform | `App`, `changeWorkspaceDomain`, `sendPrompt`, `applyRuntimeActions`, `NODE_OVERVIEW_MIN_IMAGE_TILES`, `is-viewport-detail-reduced` | `test:workspace-domain`, `test:image-stream-preview`, `test:workspace-glass-ui`, `typecheck`, `aidebug:workspace-domain`, `aidebug:glass-workspace`, `aidebug:performance`, `aidebug:performance:product`, `build` 及对应专项 suite |
| `src/glass-theme.ts`, `src/glass-theme-provider.tsx` | Glass 设置归一化、主题/材质转换、根 datasets/classes/CSS variables 投影，以及不增加 DOM wrapper 的状态保持 Provider | 画布/项目 mutation、组件 remount、Electron IO、独立窗设置持久化或任意 CSS 执行 | `normalizeGlassThemeSettings`, `glassAppearanceProjection`, `applyGlassAppearanceToRoot`, `GlassThemeProvider` | `test:glass-theme`, `test:settings-persistence`, `test:agent-window`, `typecheck`, `build` |
| `src/workspace-chrome.tsx` | 自然异步顶部 `WorkspaceDomainSwitcher`、Workbench/Focus/Review 切换器、项目搜索、按设置过滤且自动修复当前页签的正式左素材栏、固定任务上下文与只读成果投影；Focus 支持多选图片的原图/生成组分栏、资产去重和受限缩略图挂载，并只请求打开已有成果编辑器，Review 把当前方向交回 canonical 选择 | 第二份画布/会话/领域/选择状态、节点 mutation、项目持久化、图片请求/计费或 canonical canvas 生命周期 | `WorkspaceDomainSwitcher`, `WorkspaceDirectionSwitcher`, `WorkspaceSearch`, `WorkspaceAssetRail`, `WorkspaceTaskContext`, `WorkspaceFocusStage`, `WorkspaceReviewGrid` | `test:workspace-domain`, `test:workspace-glass-ui`, `typecheck`, `build`, `aidebug:workspace-domain`, `aidebug:glass-workspace` |
| `src/core.ts` | 共享类型与 bridge contract、`WorkspaceDomain`/Session 字段、session v5 mutation event/checkpoint/barrier 类型、图片/视频资产与模型设置类型、`ImageAsset.generation v1`、图片模型绑定（`ImageModelBinding.customBaseUrl`）及图片/mask 纯逻辑；保留资产/paste 兼容重导出 | React 渲染、长运行 Agent 状态、设置持久化与 alpha 归一化的新实现 | `WorkspaceDomain`, `WorkspaceDomainDefinition`, `WorkflowNode`, `ImageAssetGenerationMetadata`, `VideoAsset`, `ImageModelBinding`, `NodeMutationEvent`, `AgentTaskScope`, `ConfigBridge`, `AgentBridge` | `test:workspace-domain`, `typecheck`, `test:video-node`, `test:agent-text`, `test:custom-api-transport`, `test:image-generation-metadata`, `test:node-mutation-journal` |
| `src/image-generation-metadata.ts` | Renderer 侧 generation 白名单恢复、最终像素比例/文件格式计算、请求/响应/成图/运行值的展示行与本地导入兼容判断 | 网络响应解析、项目写入、凭据、把请求默认值伪装成服务器返回值 | `sanitizeImageAssetGenerationMetadata`, `actualImageAspectRatio`, `imageGenerationDisplayRows`, `imageGenerationSourceLabel` | `test:image-generation-metadata`, `test:workspace-glass-ui`, `typecheck`, `aidebug:image-collection` |
| `src/image-content-title.ts` | 从结构化或自然语言 Prompt 本地提炼图片内容摘要标题，并统一节点、图片组、资产和槽位标题；已有简短人工标题保持不变 | 额外模型调用、修改原始 Prompt、就地修改传入对象或把通用成果名当内容标题 | `imageContentSummaryTitle`, `normalizeGeneratedImageContentPresentation` | `test:image-content-title`, `test:agent-panel-ui`, `typecheck` |
| `src/automation-command-runtime.ts`, `src/automation-command-registry.ts` | 懒加载 Renderer 自动化命令分派与 schema 生成的命令名注册表；`workspace.domain.list/get/set`、带领域的新项目、本地视频、Agent steer、套图模板市场和 A/B 终选与 GUI 共用契约 | loopback 鉴权、PowerShell 进程、React 状态所有权或手工维护第二份命令清单；`canvas.generate-video` 不得循环派发或重建 ambiguous POST | `executeAutomationCommand`, `AutomationCommandContext.workspaceDomain`, `setWorkspaceDomain`, `AUTOMATION_RENDERER_COMMAND_NAMES` | `test:workspace-domain`, `test:automation-service`, `test:ipc-registration`, `test:video-node`, `typecheck`, `build`, `test:bundle` |
| `src/project-agent-composer.tsx` | 自然异步的主 Agent 输入表面与运行控制；模型、素材、当前模式、比例值和清晰度值组成紧凑玻璃工具栏，原图/参考图动作进入素材菜单，普通/Goal 共用单触发器和双瓣扇形菜单，画幅选项使用自定义 listbox；普通用户运行中只选择自动处理、只修改要求或更换处理图片，内部仍映射兼容 TaskScope 协议，每次 steer/运行结束重置自动模式 | Agent 执行、画布 mutation、密钥读取、直接网络请求、IPC 或 run record | `ProjectAgentComposer` | `test:settings-lazy-load`, `test:model-catalog`, `test:agent-panel-ui`, `test:agent-text-ui`, `typecheck`, `build`, `test:bundle` |
| `src/ui/unsaved-changes-dialog.tsx` | 统一承载有保存语义表面的关闭确认，固定提供继续编辑、放弃修改和保存并关闭；临时无保存语义工具仍由所属表面提供明确放弃确认 | 判断各业务表面的 dirty 状态、执行实际保存或替代普通确认框 | `UnsavedChangesDialog`, `UnsavedChangesDialogProps` | `test:agent-text-ui`, `test:commerce-catalog-ui`, `test:ui-foundation`, `typecheck` |
| `src/goal-mode.ts` | Goal 预览、计数/费用摘要和内部一次性授权 receipt DTO | live runtime 展开、图片请求或 React 状态 | `createGoalModePreview`, `publicGoalModePreview` | `test:goal-task-scope`, `test:automation-service`, `typecheck` |
| `src/layer-alpha-normalization.ts` | 图层 RGBA alpha 像素归属归一化、透明图层互斥重建与归一化报告 | 分层合成编排、mask 生成、`core.ts` façade 重导出 | `normalizeLayerAlphaPixelBuffers`, `normalizeTransparentLayerAlphaExclusivity` | `test:layer-alpha`, `test:layer-mask-replay`, `typecheck`, `build`, `test:bundle` |
| `src/settings-persistence.ts` | 默认设置、明暗/11 套调色盘/自定义主题与旧字段迁移、第一方工作台组件的一次性版本迁移、左素材栏五模块显隐及至少一项规范化、底部工具视觉隐藏列表、`canvasToolShortcuts` 覆盖清洗、Glass bootstrap v1 安全快照、首个 React frame 安全外观 seed、上下文策略预算、模型池清洗、Storage Keys、`readJson`/`writeJson` | Electron 磁盘设置、远端账户状态、主题文件 IO；bootstrap snapshot 不得包含凭据、Prompt 或项目数据，也不得覆盖非外观设置 | `defaultSettings`, `mergeSettings`, `WORKSPACE_PLUGIN_DEFAULTS_VERSION`, `normalizeCanvasToolShortcuts`, `normalizeVisibleWorkspaceAssetRailTabs`, `glassThemeBootstrapSnapshot`, `readGlassThemeBootstrapSnapshot`, `settingsWithGlassBootstrap`, `writeGlassThemeBootstrapSnapshot`, `STORAGE_*` | `test:glass-theme`, `test:settings-persistence`, `test:context-strategy`, `test:theme-preset`, `typecheck`, `build` |
| `src/help-center.tsx`, `docs/legal/*` | 快速开始、AI 示例教学入口、工作流帮助、隐私政策、用户协议、上游费用/退款说明和 `namean` 制作者信息 | 远端法律条款 authority、账号账单、项目 mutation 或联网请求 | `HelpCenter`, `HelpCenterSection`, `onStartTutorial` | `test:settings-lazy-load`, `test:ui-foundation`, `typecheck`, `aidebug:commerce-tutorial` |
| `src/commerce-tutorial.tsx`, `src/styles/04i-commerce-tutorial.css` | 按真实画布/领域/工具/Agent/受管成果状态推进的跨境套图陪练，项目级便利进度、玻璃教练卡/聚焦框、成功徽章与减少动态适配 | Commerce/Agent 业务复制、自动发送、自动授权扣费、伪造成果、项目 session authority 或模型调用 | `CommerceTutorial`, `resolveCommerceTutorialStage`, `COMMERCE_TUTORIAL_AGENT_PROMPT` | `typecheck`, `test:workspace-glass-ui`, `aidebug:commerce-tutorial` |
| `src/plugin-state.ts`, `desktop/plugin-state.cjs` | Renderer/Electron 插件安装状态、第一方工作台默认组件版本、授权集合、启用状态与画布工具快捷键规范化/冲突修复镜像 | 命令执行、UI 或项目修改 | `WORKSPACE_PLUGIN_DEFAULTS_VERSION`, `DEFAULT_WORKSPACE_PLUGIN_IDS`, `defaultWorkspacePluginStates`, `normalizePluginStates`, `normalizePluginPermissions`, `normalizeCanvasToolShortcut`, `normalizeCanvasToolShortcuts` | `test:plugin-system`, `test:settings-persistence` |
| `src/plugin-system.ts`, `plugins/builtin-manifests.json` | 受信任 manifest、生命周期操作、权限复核、命令注册表、可执行与可见工具栏 contribution、领域投影与默认/覆盖后快捷键解析；按启用状态动态加载 | 任意脚本执行、直接 session 写入、日常切换时自动安装/启用/执行领域插件、Agent Runtime 或文件 IO | `PluginCommandRegistry`, `availablePluginToolbarItems`, `activePluginToolbarItems`, `workspaceDomainOwnsPlugin`, `installBuiltinPlugin` | `test:workspace-domain`, `test:plugin-system`, `typecheck`, `build`, `test:bundle` |
| `plugins/commerce-set-schema.json`, `src/plugins/commerce-set.ts`, `src/commerce-set-dialog.tsx`, `src/commerce-translation-dialog.tsx`, `runtime/commerce-set-plan.cjs` | 跨境电商共享语言/限制/默认槽位、generate/translate 计划归一化、图片×语言矩阵、逐单元格 `translationItems`、`planMaterialHash`、请求/费用计数、稳定 snapshot material、完整自然异步配置 UI 与旧翻译入口适配 | Agent/automation 执行、SOURCE 冻结、图片网络请求、Requirement/Skill 落盘、插件权限或画布 reducer | `normalizeCommerceSetPlan`, `buildCommerceSetMatrix`, `commerceSetRequestCounts`, `commerceSetSnapshotMaterial`, `commerceSetPromptMaterialHash`, `CommerceSetDialog` | `test:commerce-set`, `test:goal-runtime`, `test:automation-service`, `aidebug:commerce-set`, `typecheck` |
| `plugins/commerce-catalog-schema.json`, `desktop/project-commerce-catalog.cjs`, `desktop/ipc/commerce-catalog-ipc.cjs`, `src/commerce-catalog.ts`, `src/commerce-catalog-dialog.tsx` | 项目级商品/变体/SKU/图片关联、保守 CAS、逐 SOURCE Goal 目标冻结、结果 provenance/result key 与跨商品幂等自动归档、自然异步管理 UI 和共享 Agent CLI schema | 不接受 Renderer 路径或模型提交的 SKU 身份，不删画布节点或图片文件；归档只扫描已保存的权威 session | `readCommerceCatalog`, `saveCommerceCatalogProduct`, `commerceCatalogGoalTargetsForSources`, `CommerceCatalogDialog` | `test:commerce-catalog`, `test:commerce-catalog-ui`, `test:goal-task-scope`, `test:goal-runtime`, `test:project-session-merge`, `test:automation-service`, `test:project-io` |
| `desktop/commerce-template-library.cjs`, `desktop/ipc/commerce-template-ipc.cjs`, `plugins/commerce-template-schema.json`, `src/commerce-template.ts`, `src/commerce-template-dialog.tsx` | 安装级内置/个人套图模板、portable v1 导入导出、revision CAS、同名 `overwrite`/`copy` 冲突策略、自然异步模板市场与 CLI 同步 | 不保存绝对路径、SOURCE 专属翻译单元或 canvas saveTarget；内置模板只读，导入始终另存副本，不删除画布节点/结果 | `createCommerceTemplateLibraryService`, `portableTemplateDocument`, `uniqueCopyTitle`, `CommerceTemplateDialog` | `test:commerce-template`, `test:commerce-catalog-ui`, `test:automation-service`, `test:ipc-registration`, `typecheck` |
| `desktop/project-commerce-catalog.cjs` A/B、`desktop/ipc/commerce-catalog-ipc.cjs`, `src/commerce-ab-dialog.tsx` | 同商品/SOURCE/槽位/语言/角色结果分组、去重、并排预览、Catalog/Product 双 CAS 原子 winner/sibling 状态更新 | 不把 plan hash 当分组身份，不删除关系、provenance、画布节点或受管文件 | `comparisonGroupsForDocument`, `selectComparisonWinner`, `CommerceAbDialog` | `test:commerce-catalog`, `test:commerce-catalog-ui`, `test:automation-service`, `test:ipc-registration`, `typecheck` |
| `desktop/project-commerce-export.cjs`, `desktop/ipc/commerce-export-ipc.cjs`, `src/commerce-export.ts`, `src/commerce-export-dialog.tsx` | Amazon/速卖通导出 profile、Catalog 结果继承与状态筛选、真实文件/哈希/解码/平台检查、稳定 SKU 命名、相对 manifest、staging 原子目录发布、原生目标授权与自然异步 UI | Renderer/CLI 目标路径输入、ZIP 依赖、源图修改、模型调用、账户扣费或平台上传 | `createProjectCommerceExportService`, `preview`, `exportPackage`, `CommerceExportDialog` | `test:commerce-export`, `test:commerce-export-ui`, `test:commerce-catalog-ui`, `test:automation-service`, `test:ipc-registration`, `typecheck` |
| `src/plugins/social-content.ts`, `src/social-content-dialog.tsx` | 小红书/抖音计划与成果元数据镜像、7 页/6 镜默认配置、自然异步首次引导和 SOURCE 摘要 | Agent/图片/视频执行、项目文件、目标目录授权或第二套画布 | `normalizeSocialContentPlan`, `applySocialPlanToRequirementNode`, `SocialContentDialog` | `test:social-content`, `test:workspace-domain`, `test:plugin-system`, `aidebug:social-content`, `typecheck` |
| `src/plugins/scientific-figure.ts`, `src/scientific-figure-dialog.tsx`, `src/styles/04h-scientific-figure-dialog.css` | 科研计划/元数据镜像、数据与 Panel 编排、任务状态/导出表面、局部可覆盖的 `--ui-surface-radius` 与原色成果预览 | 本地进程执行、项目磁盘 IO、研究结论推断、平行画布或直接调用模型 | `ScientificFigureDialog`, `normalizeScientificFigurePlan`, `SCIENTIFIC_FIGURE_*_COMMAND` | `test:scientific-runner`, `test:workspace-domain`, `test:automation-service`, `aidebug:scientific-figure`, `typecheck` |
| `src/theme-palette-picker.tsx` | 11 套配色选择、自定义主题名称、浅/深色 10 项编辑、导入/导出/恢复交互 | 文件 IO、schema 权威校验、任意 CSS 解释或设置磁盘写入 | `ThemePalettePicker`, `defaultCustomTheme`, `transferTheme` | `test:theme-preset`, `test:settings-persistence`, `test:ui-foundation`, `aidebug:gui`, `build`, `test:bundle` |
| `src/agent-panel-layout.ts` | Agent 面板设置读取、四向停靠/应用内浮动转换、边界限制、pointer delta 与 CSS preview variables | React 状态、Electron 独立窗口、设置磁盘 IO | `agentPanelLayoutFromSettings`, `agentPanelLayoutForPlacement`, `agentPanelLayoutFromPointer`, `applyAgentPanelLayoutPreview` | `test:agent-panel-layout`, `test:agent-panel-ui`, `typecheck`, `build`, `test:bundle` |
| `src/project-agent-panel.tsx` | 主 Agent 面板、会话历史弹层、原生文本选择及面板内焦点返回；会话历史在捕获阶段独占 `Escape`，布局提交后恢复触发按钮焦点 | Agent runtime、项目持久化、共享 Dialog/Drawer 实现或画布全局快捷键 | `ProjectAgentPanel`, `PROJECT_AGENT_HISTORY_TOGGLE_ID` | `test:agent-panel-ui`, `test:agent-text-ui`, `typecheck`, `build` |
| `src/agent-window-sync.ts` | 独立窗脱敏有界快照（含领域 ID/标题）、Glass appearance projection、状态文案与命令 allowlist；只在打开独立窗时动态加载 | IPC、BrowserWindow、领域 authority、Agent 执行、项目持久化或独立设置 authority | `AgentWindowGlassAppearance`, `buildAgentWindowSnapshot`, `workspaceDomain`, `normalizeAgentWindowCommand`, `agentWindowStatusText` | `test:workspace-domain`, `test:glass-theme`, `test:agent-window`, `test:agent-window-ui`, `typecheck`, `build`, `test:bundle` |
| `src/streaming-image-preview.ts` | 生图 partial 的运行时状态归一化、`operationId + requestIndex` 同槽替换与目标图片节点归属 | 网络流解析、图片落盘、Agent 时间线消息、项目 session 或最终资产列表 | `upsertStreamingImagePreviewState`, `groupStreamingImagePreviewsByNode` | `test:image-stream-preview`, `test:image-container`, `typecheck`, `build`, `test:bundle` |
| `src/asset-identity.ts` | 稳定 asset/occurrence ID、身份 claim 协调、安全 locator/relative path | 文件复制、项目 manifest IO | `stableImageAssetId`, `stableImageOccurrenceId`, `reconcileImageAssetIdentityClaims` | `test:asset-identity`, `test:project-io`, `test:image-import` |
| `src/paste-blocks.ts` | 大文本粘贴块、可见/模型 prompt 组合、图片粘贴阻断 | Clipboard 文件导入、React 状态 | `composePromptWithPasteBlocks`, `visiblePromptWithPasteBlocks`, `blockImagePaste` | `test:paste-blocks`, `test:agent-text`, `aidebug:gui` |
| `src/agent.ts` | Agent 请求入口、流文本 reducer、工具时间线格式化 | runtime 内部 memory 和模型请求 | `requestAgent`, `reduceAgentStreamEvent` | `test:agent-protocol`, `test:timeline`, `aidebug:gui` |
| `src/aidebug/agent-fixture-bridge.ts` | Renderer Agent action/message fixture 窗口钩子、32ms 流消息合并及安装清理生命周期 | 真实 runtime action 实现、React/项目状态、正式 bundle chunk | `installAgentFixtureBridge`, `__naimageDebugApplyAgentActions`, `__naimageDebugSeedAgentMessages` | `test:aidebug-agent-fixtures`, `typecheck`, `test:agent-text-ui`, `aidebug:gui`, `test:bundle` |
| `src/ui.tsx` | 对现有调用方保持稳定的基础 UI 兼容重导出 façade | primitives 内部实现、产品业务状态 | `DialogShell`, `DrawerShell`, `ButtonBase`, `useFloatingDialogInteractions` | `test:ui-foundation`, `typecheck`, `build` |
| `src/ui/*` | Dialog/Drawer focus 与 close policy、共享 controls、可清空后延迟规范化的数字输入、菜单 surface、overflow tooltip、浮窗拖动；`DialogShell` 正常关闭同步恢复一次焦点，只有调用方直接卸载且当前焦点仍落在 body、断开节点或旧弹层内部时才由 cleanup 兜底 | 产品业务状态、功能页数据获取、卸载后无条件异步抢回旧焦点 | `dialog-shell.tsx`, `primitives.tsx`, `DeferredNumberInput`, `menu-surface.tsx`, `overflow-tooltip.tsx`, `floating-dialog-interactions.ts` | `test:ui-foundation`, `test:commerce-set`, `test:settings-lazy-load`, `test:agent-text-ui`, `aidebug:gui` |
| `src/window-controls.tsx` | 原生窗口最小化、最大化/还原、关闭按钮 | BrowserWindow 实现、项目状态 | `WindowControls`, `windowControl` | `build`, `aidebug:gui`, `test:lifecycle` |
| `src/theme-palette-picker.tsx` | 设置页明暗模式与 10 套命名调色盘选择表面 | 设置持久化、全局 App 状态、CSS canonical token | `ThemePalettePicker`, `aria-pressed`, `data-palette` | `test:settings-persistence`, `test:ui-foundation`, `typecheck`, `aidebug:gui` |
| `src/studio-dialogs.ts` | 设置、账户、编辑对话框、主题与 Markdown 的统一动态 import barrel | 业务状态、手工吸入共享依赖、初始 Renderer chunk | `loadStudioDialogs`, named surface exports | `typecheck`, `build`, `test:bundle`, `aidebug:gui` |
| `src/use-stable-event.ts` | 持久 handler identity、调用最新闭包 | 业务状态或事件策略 | `useStableEvent` | `typecheck`, `build` |
| `src/styles.css`, `src/styles/01…08` | 有序样式入口与 base/canvas/legacy/dialog/desktop/responsive/workbench/motion 区域；`01-base-controls.css` 持有共享字体 token，`01-liquid-glass-tokens.css` 持有 Glass token/旧 `--theme-*` 桥，07a→07i 仍由 workbench 聚合，`07j-liquid-glass-surfaces.css` 在其后持有 Glass surface、近实色搜索菜单和 reduced-motion 直接操作例外；`02-canvas-workspace.css` 的普通拖动只消费 `--node-drag-x/y`，`image-layout-settle` 不得声明 transform，密集 viewport 交互只在 `is-viewport-detail-reduced` 生命周期内停绘媒体、关系线和高成本阴影；共享 `.ui-surface` 消费组件局部可覆盖的 `--ui-surface-radius` | 数据修复、运行时状态补丁、静止态画布 artwork 滤镜、拖动 transition 延迟、布局动画占用 transform、交互结束后残留降载 class、跨文件随意改 import 顺序、固定重置所有功能表面圆角，或把 `04b-glass-lab.css` 提前放入全局首屏入口 | `@import`, `--font-*`, `--ui-surface-radius`, `--node-drag-x`, `--node-drag-y`, `is-viewport-detail-reduced`, `01-liquid-glass-tokens.css`, `07-workbench-flattening.css`, `07j-liquid-glass-surfaces.css`, `08-motion-accessibility.css` | `test:workspace-glass-ui`, `test:ui-foundation`, `test:settings-lazy-load`, `test:aidebug-glass-workspace`, `aidebug:glass-workspace`, `aidebug:performance`, `test:bundle` |
| `src/markdown.tsx` | Agent Markdown 呈现 | 模型协议或工具执行 | Markdown renderer exports | `build`, `aidebug:gui` |

### 5.3 画布、需求与图片组织

| 路径 | Owns | 关键检索词 | 主要验证 |
| --- | --- | --- | --- |
| `src/selection-state.ts` | `none/single/multiple` 选择 reducer | `reduceSelectionState` | `test:selection` |
| `src/main.tsx`（画布拖动编排） | 单节点、分层组和全图片容器多选的指针状态；批量容器拖动用一组起点快照驱动 transform 预览、整组关系线重算、单次 `setNodes` 提交与 `pointercancel` 回滚 | `dragRef.multiNodeStart`, `draggingNodeIdsRef`, `applyTransientNodePositions`, `beginNodeDrag`, `moveNode`, `endNodeDrag` | `test:selection`, `test:image-container`, `test:image-layout`, `aidebug:image-collection`, `typecheck`, `build` |
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
| `src/image-collection-mutation.ts` | 图片组名称清洗/去重、受管槽位替换、瑕疵组关系与全量预校验的纯事务逻辑 | `renameImageCollections`, `replaceImageCollectionItems`, `sanitizeImageCollectionName` | `test:image-collection-mutation`, `typecheck` |
| `src/image-layout.ts` | 2–10 图比例感知布局、排序、拆组与归一化 | layout rows/groups | `test:image-layout`, `aidebug:image-recovery` |
| `src/layer-composition-runtime.ts` | Renderer 分层合成输入准备与校验 | layer composition | `test:layer-alpha`, `test:layer-mask-replay` |

画布鼠标批量移动只在当前选择映射到两个或更多可见宿主、且全部宿主均为 `imageContainer` 或 `imageCollection` 时成立。按下节点必须属于该选择；所有宿主共享同一个世界坐标 `dx/dy`，预览阶段只写 `--node-drag-x/y` 并以整组新端点一次重算受影响 provenance path，React 节点坐标保持不变。松手后一次映射提交全部宿主坐标并保留选择，`pointercancel` 和全局交互取消恢复全部 transform、关系线、z-index 与 `will-change`。未选中容器、混合选择、普通单节点、图片瓦片提取/归组及分层 PNG 继续使用各自既有路径。

### 5.4 对话框与功能表面

| 路径组 | 职责 | 主要验证 |
| --- | --- | --- |
| `src/account-drawer.tsx` | 账户、余额、日志入口 | `aidebug:gui` |
| `src/model-config-dialog.tsx` | Agent/图片模型选择、服务端模型展示和逐模型接入绑定（Base URL/API Key 或账户密钥） | `test:agent-text-ui`, `test:model-catalog`, `test:settings-lazy-load`, `aidebug:gui` |
| `src/agent-text-editor-dialog.tsx` | 主 Prompt 与 FastMemory 编辑 | `test:agent-text`, `test:agent-text-ui` |
| `src/ask-user-dialog.tsx` | `ask_user` 继续执行输入 | `aidebug:ask-user`, `test:execution-gate` |
| `src/requirement-editor-dialog.tsx` | 需求节点编辑与执行入口 | `aidebug:requirements` |
| `src/manual-image-task-dialog.tsx` | 空白画布直接生图表单 | `aidebug:gui`, image generation suites |
| `src/common-dialogs.tsx` | 通用项目、确认和导出弹窗 | `test:ui-foundation`, `aidebug:gui` |
| `src/auth-gate.tsx` | 启动检查、账号/自定义接入切换、激活输入、登录/注册表面与认证标题栏 | `test:custom-api-transport`, `test:license`, `aidebug:gui`, `test:lifecycle` |
| `src/glass-lab.tsx`, `src/styles/04b-glass-lab.css` | 外观 section 内自然异步的六主题、三材质、自定义参数、强调色、噪点/减弱动态和实时预览表面；样式跟随该异步 chunk | 全局主题 authority、设置磁盘写入、画布 remount 或初始 Renderer CSS | `test:glass-theme`, `test:settings-lazy-load`, `test:aidebug-glass-workspace`, `aidebug:glass-workspace` |
| `src/image-viewer.tsx`, `src/styles/04-dialogs-viewers.css` | 只读取已受管最终资产的图片查看器；上方单张大图负责缩放/适配/平移，下方最终图缩略条固定为单行横向滚动，并保留切图与导出入口；稳定 identity、sequence、source/identity/target 校验和 decode 后换帧防止旧 preload 覆盖最新选择，舞台暴露 `data-final-asset`/`data-target-asset`/`data-displayed-asset`/`data-buffering` | `test:workspace-glass-ui`, `test:image-stream-preview`, `aidebug:glass-workspace`, `aidebug:image-collection`, `aidebug:gui` |
| `src/reference-picker-dialog.tsx`, `src/styles/04-dialogs-viewers.css` | SOURCE/REFERENCE 图片选择、分页和上限展示；引用图使用约 96px 透明玻璃缩略容器完整显示 | `aidebug:ask-user`, `aidebug:gui --ui-surface-suite`, `test:commerce-catalog-ui`, `test:execution-gate` |
| `src/export-center-dialog.tsx`, `src/styles/04j-export-center-dialog.css` | 图片、图片组与 PSD 的统一选择/预检表面，命名模板、项目预设、冲突策略、本地串行队列、内容指纹增量跳过和项目历史 | 文件系统路径解析、图片/PSD 转码、跨项目状态或第二套导出实现；实际写入仍调用既有 Main owner | `test:export-center`, `test:export-center-ui`, `test:ui-foundation`, `aidebug:gui:surface` |

### 5.5 图片与 Worker 模块

| 路径 | 职责 | 边界 | 主要验证 |
| --- | --- | --- | --- |
| `image-import.cjs`, `image-import-worker.cjs` | 扫描、校验、复制、哈希、尺寸读取 | 不修改外部原图；防路径逃逸和资源超限 | `test:image-import`, `aidebug:image-import` |
| `thumbnail-cache.cjs`, `image-thumbnail-worker.cjs` | 项目私有 WebP 缩略图、最多 2 个常驻 Sharp 子进程的 `requestId` 任务池、崩溃后按需补充，以及按数量/容量/保留天数节流的保留式 GC；默认保留 512 个变体/512 MiB | 缩略图不替换原资产；单个 Worker 崩溃只拒绝其当前任务；GC 不删除原图、生成结果或正在生成的缩略图；Main 退出必须终止常驻子进程 | `prune`, `test:thumbnail-cache`, `aidebug:performance` |
| `semantic-matting.cjs`, `semantic-matting-worker.cjs` | OpenCV/PNGJS 蒙版细化和 alpha 验证 | worker 隔离；保持尺寸与资源限制 | `test:semantic-matting`, `test:layer-alpha` |
| `background-removal.cjs` | 边缘连通背景移除兼容逻辑 | 不恢复为产品滤镜入口 | `test:chroma-key` |
| `desktop/image-collection-export-service.cjs`, `desktop/ipc/image-collection-ipc.cjs` | Main-only 图片组 session 复核、PNG/JPEG/WebP/AVIF/TIFF 统计预检与内容令牌、项目级 `image-groups/<组名>` 多目录 staging/整批原子发布、受管资产校验、manifest、新目录优先及旧 `exports/image-groups` 兼容解析；preload 仅暴露预检/导出/打开文件夹的有界 payload | 不接受 Renderer 绝对路径、不写入项目外目录、不移动受管原图、不复用漂移令牌、不伪造未导出成功；所有文件操作留在 Main | `test:image-collection-export`, `test:ipc-registration`, `test:automation-service`, `aidebug:image-collection` |
| `desktop/image-export-service.cjs`, `desktop/ipc/asset-ipc.cjs`, `psd-export*.cjs` | 普通图片另存和单图/分层 PSD 的互斥导出链路 | 普通导出不得隐式触发 PSD，PSD 不得改写普通导出目标/配置 | `test:image-export`, `test:psd-export` |
| `psd-export.cjs`, `psd-export-worker.cjs`, `psd-raster-source-worker.cjs` | PSD 隔离导出、源图栅格化、回读校验 | 临时源按进程隔离并清理 | `test:psd-export` |

Worker 文件位于仓库根目录是 Electron ASAR 和 worker 路径解析约束，不能只为目录美观移动。

### 5.6 AIDebug harness 与 suite

| 路径 | Owns | Must not own | 主要验证 |
| --- | --- | --- | --- |
| `scripts/aidebug-gui.mjs` | 已解析参数的消费、suite 选择顺序、运行目录、Vite/Electron/CDP 总编排和最终报告；截图像素验证只采样至少 4×4 px 的可见节点，低于阈值的裁剪残片进入 `skippedNodeSlivers`，但全部可见节点均不可采样时必须以 `no-sampleable-visible-nodes` 失败 | CLI/env 解析、已迁出 suite 的场景函数体、重复实现公共截图/进程/PNG helper，或把边缘残片误写为完整节点像素证据 | `test:aidebug-options`, `test:aidebug-catalog`, `test:aidebug-workpack`, `aidebug:gui` 与各 `--*-suite` 专项 |
| `scripts/aidebug/options.mjs` | AIDebug CLI alias、env/CLI 优先级、数值边界、路径/references 归一化、显式隔离根及 config 必须位于隔离根内的 fail-closed 校验、supervisor `rawArgs` 快照 | suite 选择/dispatch、进程状态读取、运行目录创建或 GUI 启动副作用 | `test:aidebug-options`, `test:aidebug-isolation`, `node --check` |
| `scripts/aidebug-isolation-selftest.cjs` | 启动真实 Electron Main，验证仅传临时 `--user-data-dir` 时自动使用 `<user-data>/data`、默认项目留在该根内、仓库 config 哈希不变，并验证显式指向仓库 config 会非零退出 | Renderer 交互、业务 fixture、真实模型请求、清理或改写现有用户画布 | `test:aidebug-isolation` |
| `scripts/aidebug-isolation-gui.mjs` | 启动真实 Vite + Electron + CDP，在运行时双门禁开启后创建/移动一个容器并等待自动保存，核对节点只进入临时项目、仓库 config 不变并保存截图证据 | 完整 GUI surface、真实用户项目、真实模型请求或通用 AIDebug suite 替身 | `aidebug:isolation` |
| `scripts/aidebug/harness/*` | CDP 连接、受控进程退出、PNG 读取/比较、双帧和原生截图证据 | 产品场景、画布业务断言、suite CLI 决策 | `aidebug:gui`, `node --check` |
| `scripts/aidebug/harness/state-snapshot.mjs` | Renderer DOM、几何、可访问性、画布和 Agent 状态的统一快照表达式；显式接收 evaluator 与 workbench 最小宽度 | suite 路由、进程生命周期、报告写入或产品状态修改 | `aidebug:gui`, `node --check` |
| `scripts/aidebug/suites/selection-command.mjs` | selection/command 场景 probe | 通用 CDP/截图实现、其他 suite | `aidebug:selection` |
| `scripts/aidebug/suites/ui-surface.mjs` | UI surface 场景 probe | 通用 CDP/截图实现、其他 suite | `aidebug:gui` |
| `scripts/aidebug/suites/image-generation.mjs` | 单图、图片恢复和图片集合三个图像 probe | CLI/process/CDP 生命周期、其他 suite | `aidebug:image`, `aidebug:image-recovery`, `aidebug:image-collection` |
| `scripts/aidebug-image-layout-regression.mjs` | 图片容器归组/拆组/跨组/Z-order 回归，以及密集画布容器松手后立即复拖的真实 CDP 手势、原生 drag 取消与 `pointercancel` 证据 | 产品拖动实现、通用 Electron 生命周期、真实模型请求 | `aidebug:image-collection`, `runCanvasLayoutMutationRegression`, `runImmediateContainerRedragRegression` |
| `scripts/aidebug/suites/layer-editing.mjs` | layer stack、抠图、区域重绘 probe 与专属 DOM proof | CLI/process/CDP 生命周期、其他 suite 或通用 PNG/CDP helper | `aidebug:gui` 的 `--layer-stack-suite`、`--cutout-suite`、`--region-redraw-suite` |
| `scripts/aidebug/suites/performance.mjs` | 200/1000 节点、长/流式时间线、10 张 4K 图片、交互、内存、Long Task、持久化与视觉检查点基线 probe；`denseViewportZoom` 固定验证 80 次 wheel/10 帧、stage 写入预算和降载状态恢复 | CLI/process/CDP 生命周期、最终报告路由、其他 suite | `node --check scripts/aidebug/suites/performance.mjs`、模块 import smoke、`aidebug:performance`、`aidebug:performance:product` |
| `scripts/aidebug-requirement-node-suite.mjs` | 需求节点创建、连接、重复执行与六层成果的专项 probe；默认使用轻量六层 fixture，完整 Layer Stack 仅由显式 `--full-suite` 运行 | 重复执行完整 Layer Stack、通用 CDP/进程生命周期、其他 suite | `aidebug:requirements`；需要完整图层回归时使用 `aidebug:requirements:full` |
| `scripts/aidebug-skill-node-suite.mjs` | 经 loopback 自动化正式入口导入 Skill-backed requirement，验证重复聚焦、异常 frontmatter、正常/最小窗口视觉，以及主/独立 Agent TaskScope 模式与发送后复位 | 产品解析/执行实现、任意真实凭证或图片服务、通用 CDP/进程生命周期 | `aidebug:skills`、`aidebug:evidence`、`AIDEBUG/visual-review.mjs` |
| `scripts/real-model-validation.mjs` | 从显式设置文件生成脱敏的比例/清晰度、请求尺寸、交付规格和 endpoint 计划；默认 dry-run，真实网络与费用必须同时通过三项 CLI 确认和独立环境口令 | 默认联网、读取 safeStorage/账户 Key、自动发现凭据、替代 provider 真实服从度结论或调用 Seedance | `test:real-model-validation` |
| `scripts/project-migration-audit.mjs` | 只读扫描用户明确指定的旧项目/全局 Session，计算清单、SHA-256、空间与脱敏备份计划；无参数不扫描 C 盘 | 复制、索引修改、迁移、清理、默认扫描用户目录或替代应用内二次确认流程 | `test:project-migration-audit` |
| `scripts/aidebug-goal-mode-suite.mjs` | 构造真实图片容器 fixture，验证可见普通/Goal 模式、合格容器/图片计数、probe/放量/费用确认文案、画布变化后的 stale hash 零派发及截图健康度 | 真实付费图片请求、Goal runtime 逻辑替身、通用 CDP/进程生命周期 | `aidebug:goal`、`aidebug:evidence`、`AIDEBUG/visual-review.mjs` |
| `scripts/aidebug-glass-workspace-suite.mjs`, `AIDEBUG/catalog.json` | 独立 Electron Glass/Workspace 可见闭环及 catalog/profile 注册：默认外观、六主题、三材质、九类自定义控制、推荐值恢复、canonical canvas/node DOM 身份与 geometry、素材轨四 tab、三视图、surface/图片不透明、884 x 640 Shell/设置/菜单、同配置目录真实关闭冷重启，以及可独立运行的科研工作台和 Commerce AI 陪练场景 | 真实网络/付费生图、真实科研 Runner、产品主题实现、通用截图/报告替身或日常隐式全量 GUI | `test:aidebug-glass-workspace`, `test:aidebug-catalog`, `aidebug:glass-workspace`, `aidebug:scientific-figure`, `aidebug:commerce-tutorial`, `node AIDEBUG/run.mjs --check` |
| `AIDEBUG/run.mjs` | 显式 task/profile/可重复 Agent 选择、单进程并发 runner、毫秒时间戳加 UUID 的独占证据目录、覆盖全部 SUPER GOAL owner lane 的 workpack v2 manifest 生成和确定性 `--result-file` 回链 | 跨进程 claim/recovery、GUI 审阅结论、日常隐式全量测试 | `node AIDEBUG/run.mjs --check`、`test:aidebug-workpack` |
| `AIDEBUG/super-goal-contract.mjs` | fail-closed 校验最终 profile 覆盖每个 workstream owner lane 及其全部 verificationTasks | 执行测试、生成 workpack 或修改目标状态 | `node AIDEBUG/run.mjs --check`、`test:aidebug-workpack` |
| `AIDEBUG/workpack.mjs` | manifest/integrity/目标哈希复核、wave 屏障、原子 claim、追加 checkpoint、跨 workpack 资源锁、stale reclaim、runner/GUI evidence 绑定与不可变 closure | 产品 Renderer、模型分派、未声明的手工 `run.mjs` 进程、自动审美评分 | `test:aidebug-workpack` |
| `AIDEBUG/visual-review.mjs` | 截图收集、严格裁切、montage 和源/裁切/拼接文件哈希清单 | 自动审美 verdict、产品 GUI 断言替身 | `aidebug-visual-review`、`test:aidebug-workpack` |

AIDebug 的 Commerce、Glass、Graph CLI、Skill、图片生成和 Commerce Export UI 套件在启动时都会写入本次运行目录下的显式 `project-list.json` 与项目目录，并以该项目作为 `activeProjectId`；它们不得依赖、读取或修改废弃的 AppData 默认项目。该 fixture 只属于测试 harness，正式 Renderer/Main 的项目根策略仍由 `desktop/project-store.cjs` 和项目 IPC 拥有。Session merge selftest 还必须覆盖“待提交 mutation 与旧 committed event 并存，直到 save coordinator 盖章”的顺序，防止 AIDebug 只修表面断言而遗漏真实保存竞态。

## 6. 跨边界契约

### 6.1 Preload 与 IPC

| Bridge | Renderer 入口 | 主进程职责 |
| --- | --- | --- |
| `window.naimageRuntime` | 只读 `aidebugEnabled` / `isolatedConfig`；Renderer 只有在二者同时为真时才安装可修改画布的 AIDebug 控制面 | Main 先确认显式临时 `user-data`、config 与隔离根均安全，再通过 `webPreferences.additionalArguments` 向 preload 投影两个布尔值；不注册 IPC、不公开路径 |
| `window.naimageScientific` | 原生导入受管数据、数据/任务列表、单任务渲染/查询/取消/导出与状态订阅 | 项目级数据 registry、任务 journal、受信任 Python/R Runner、输出复核与原生目录授权；不公开绝对路径或任意脚本入口 |
| `window.naimageConfig` | 设置、显式项目/session、旧数据迁移预检/执行/清理、导出中心状态/预设/历史、图片组预检/导出/目录、图片另存、受管工作区背景、Project Graph 只读导入、社媒发布包预检/导出、窗口控制 | 本地文件、原生 Open/Save 授权、项目目录、迁移回执、导出中心原子状态、BrowserWindow、原子保存、受限 `.prg` 解析、背景 WebP 转码与社媒原生目录授权 |
| `window.naimageServer` | 登录、自定义 API 配置、激活、用户、余额、日志、模型、账户密钥 CRUD/选择、生图 | New API session、公开脱敏 token DTO、Main-only 完整 Key、授权状态与结果落盘 |
| `window.naimageUpdater` | 检查、下载、应用更新、进度订阅 | 签名、hash、ticket、helper、回滚 |
| `window.naimageAgent` | chat、停止、模型、Prompt、FastMemory | Agent runtime 生命周期、memory、模型与工具循环 |
| `window.naimageAutomation` | Renderer ready、生产命令接收与结果回传 | loopback HTTP 请求关联、随机 Token 与超时 |
| `window.naimageAgentIntegrations` | Agent 目录检测、安装/更新/移除 Skill | 目标路径验证、复制和 `.naimage-connection.json` 生成 |
| `window.naimageVideo` | 单任务创建、列表/查询、显式刷新、重试下载与状态订阅 | 独立视频任务适配器、项目 journal、凭证绑定、恢复轮询与受管落盘；不公开 Key、绝对持久化路径或上游签名结果 URL |

任何 bridge 变更必须同步：

1. `src/core.ts` 类型。
2. `preload.cjs` 暴露方法。
3. 对应 `desktop/ipc/*-ipc.cjs` handler 与 `register-desktop-ipc.cjs` 注册顺序。
4. Renderer 调用方与错误处理。
5. 对应 selftest/AIDebug。

`window.naimageRuntime` 是上述 IPC 对称性规则的只读例外：它没有 handler，变更时必须同步 Main `additionalArguments`、preload 投影、`src/core.ts` 类型、Renderer 门禁以及 `test:aidebug-isolation` / `aidebug:isolation`。

### 6.2 Runtime action

`agent-runtime.cjs` 返回 `AgentRuntimeAction[]`，`src/main.tsx` 的 `applyRuntimeActions` 是唯一主要落地点。新增 action 必须同时更新：

- `src/core.ts` 的 `AgentRuntimeAction` 类型。
- runtime action 创建与错误回执。
- Renderer handler 和幂等/失败行为。
- session 清洗与迁移（若 action 形成持久化节点）。
- Agent protocol、自测和真实 GUI 链路。

### 6.3 TaskScope v2

TaskScope 是每轮 Agent 请求冻结的内部来源合同，区分 `SOURCE` 和 `REFERENCE`，包含 scope、result、confirmation policy 和 snapshot hash；普通用户界面不展示这些协议词，只提供“自动处理 / 只修改要求 / 更换处理图片”三种选择。`ask_user` 继续执行必须沿用同一份作用域，不得根据后续画布变化静默替换来源。运行中 steer 只有携带显式 update 才能改变附件；SOURCE/REFERENCE 在内部协议与 CLI 中仍支持 `keep | replace | merge | clear`。Renderer 生成候选 v2 scope，Main 重新归一化和哈希、重算 SOURCE locks、先写入 run record，再将带权威快照的 steer 交给 runtime continuation。

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

账号模式使用 `accountBaseUrl=https://sparkapi.org` 和 `updateBaseUrl=https://sparkapi.org`；模型 Base URL 由账户地址规范化为 `https://sparkapi.org/v1`。`relayBaseUrl` 仅作为旧设置/后续独立服务保留，当前账号模型请求不再依赖 Session Relay。自定义模式使用独立的 `agentBaseUrl/agentApiKey` 与 `imageBaseUrl/imageApiKey`；当前 UI 用同一组输入初始化 Agent/生图地址和 Key，底层字段仍保持分离，以支持后续拆成不同渠道。`networkProxyUrl` 是可选的应用级 HTTP(S) 代理；留空使用 Node 原生 HTTP，填写如 `http://127.0.0.1:7897` 时只有 SparkAI WorkSpace 服务请求通过 Windows curl 代理，不修改环境、Git 或系统全局配置。读取设置时，旧 `https://image.aieyra.cn`（含尾部斜杠和大小写变体）会强制迁移为 SparkAPI 更新地址；其他合法自定义更新地址仍可保留。若服务端尚未部署桌面更新扩展，客户端会把更新错误显示为不可用，不会把 GitHub 私有仓库密钥打包进客户端。旧 `serverUrl` 仅在读取时迁移到账户地址，不再写回；账户地址变化必须清空 session cookie、user id 和所选 token 元数据，并清除完整 Key 内存缓存。

账户管理认证使用 session cookie 与 `New-Api-User`；标准模型接口认证使用所选 token 的 `Authorization: Bearer <key>`。正式登出尽力调用账户站 `/api/user/logout`，无论远端结果如何都必须清理本地认证、所选 token 元数据和完整 Key 内存缓存。账户密钥额度保留原始 quota，`desktop/account-token-quota.cjs` 使用公开状态中的 `quota_per_unit` 得到 R（`1 R = 1 USD`），再使用 `usd_exchange_rate` 得到人民币分值；`price` 是充值价格倍率，禁止参与余额换算。显式刷新时并行读取状态与密钥，缓存读取不联网。主要契约：

- `/api/status`（公开额度单位与美元汇率）、`/api/user/login`, `/api/user/self`, `/api/user/self/groups`, `/api/user/models?group=...`
- `/api/token/?p=1&size=100`, `POST /api/token/:id/key`, `POST/PUT /api/token/`, `DELETE /api/token/:id/`
- `/api/log/self`
- `/v1/models`, `/v1/chat/completions`, `/v1/responses`
- `POST /v1/image-tasks`, `GET /v1/image-tasks/:id`（由同域 SparkAI Extension 提供的短请求创建/查询）
- `/v1/images/generations`, `/v1/images/edits`（兼容同步接口继续保留；密钥自身决定分组，客户端不传 `group`）
- `/api/naimage/license`, `/api/naimage/license/{activate,verify}`
- `/api/desktop-update/*`, `/api/desktop-download/*`

设备激活由独立 SparkAI Extension 的 `/api/naimage/license*` 校验；新兑换码创建时返回并以 AES-256-GCM 密文保存，管理员可通过受保护的 `/api/naimage/license/admin/codes/:id/reveal` 重复查看，旧 HMAC-only 记录不可恢复。SQLite 不保存模型 Key；客户端只保存随机安装 ID 与授权令牌，不保存兑换码，也不读取硬件指纹。扩展服务不读取 New API 数据库、不验证账号、不接收用户 Base URL/API Key。完整部署与管理员操作见 `docs/NEW_API_DUAL_ACCESS_AND_ACTIVATION.md`。

账号账户管理的 canonical 入口仍是用户原生 New API 的 `/api/user/*` 与 `/api/token/*`，账号模型调用使用其 `/v1/*`；只有 `/v1/image-tasks*` 和 `/api/naimage/license*` 在反向代理层抢先交给 SparkAI Extension。修改这两个扩展路径、认证 header、DTO、请求/结果上限、兑换码 reveal 或同域路由时，必须同步审计独立 `sparkai-extension` 仓库。

## 7. 镜像实现与同步规则

以下逻辑存在于不同进程或技术栈，修改一处时必须核对另一处：

| 镜像合同 | 位置 | 同步要求 |
| --- | --- | --- |
| Automation registry / Renderer / CLI / MCP / debug service | `integrations/naimage-control/references/commands.schema.json`、`scripts/automation-command-reference.mjs`、`src/automation-command-{registry,runtime}.ts`、`desktop/{automation-service,debug-command-service}.cjs`、`integrations/naimage-control/{SKILL.md,scripts/*,references/commands.md}` | command name/surface/schema/destructive 边界必须同源；MCP 只转发 loopback bridge；debug 仅开发/AIDebug、有界脱敏、生产拒绝；业务动作变化同步 Renderer/CLI/MCP/Skill 与专项；运行 `automation:generate --check`, `test:automation-debug`, `test:mcp-wrapper`，实际改动业务命令时再运行对应领域专项与 `test:automation-service` |
| WorkspaceDomain registry / Session / Agent / GUI / CLI | `runtime/workspace-domains.json`、`runtime/workspace-domain.cjs`、`src/{core,workspace-domain,workspace-chrome,main,plugin-system,agent-window-sync,automation-command-runtime}.ts*`、`desktop/project-session-normalizer.cjs`、Project/Agent IPC、`agent-runtime.cjs`、`integrations/naimage-control/` | 四个 ID、默认值、标题/图标/插件归属、简短 Prompt 与公开 DTO 必须同源；旧 Session 默认 `general`；切换不重挂画布、不改选择/任务/关系、不联网或计费；共享 schema 同步 Renderer/CLI 文档/Skill；运行 `test:workspace-domain`, `test:plugin-system`, `test:agent-window`, `test:automation-service`, `typecheck`, `aidebug:workspace-domain` |
| Social plan / Requirement / provenance / video / export / CLI | `plugins/social-content-schema.json`、`runtime/social-content-plan.cjs`、`src/plugins/social-content.ts`、`src/social-content-dialog.tsx`、`src/main.tsx`、session normalizer、video task service、social export service/IPC、automation registry/runtime 与 `integrations/naimage-control/` | 平台/枚举/默认值、workflowId/planHash、revision 写回、成果槽位、视频 journal 身份和命令 schema 必须一致；计划不计费，execute 才授权派发；导出不得接受路径；运行 `test:social-content`, `test:social-export`, `test:video-node`, `test:automation-service`, `test:ipc-registration`, `typecheck`, `aidebug:social-content` |
| TaskScope snapshot hash | `src/core.ts`、`agent-runtime.cjs` | 哈希材料、字段顺序和 v2 前缀必须一致；运行 `test:task-scope`、`test:agent-protocol` |
| Image 2 比例/分辨率/尺寸 | `src/project-agent-composer.tsx`、`src/main.tsx`、`desktop/ipc/agent-ipc.cjs`、`runtime/{image-frame,tool-schemas}.cjs`、`agent-runtime.cjs`、主进程生图参数 | 顶部按钮值在每次派发时冻结；Schema、顶层/子项参数、兼容请求尺寸、上游 Prompt 和最终交付尺寸必须一致，成果仍保留原始 Prompt；运行 `test:image-frame-contract`、`test:agent-run-control`、`test:goal-runtime`、`test:agent-text`、`test:custom-api-transport`、`typecheck` |
| Asset identity | Renderer `src/asset-identity.ts`（由 `core.ts` 兼容重导出）、`electron-main.cjs` 项目/session 清洗、导入 worker | assetId/occurrenceId/content hash 不得因重启或迁移漂移；运行 `test:asset-identity`, `test:project-io`, `test:image-import` |
| Session revision、节点事件与多窗口合并 | Renderer `src/main.tsx` 的确认 baseline/journal 快照、`desktop/project-save-coordinator.cjs`、`desktop/project-session-merge.cjs`、项目 manifest/session | revision 单调；Main 从确认 baseline 采集事件并分配 commitRevision；字段 clock 不得被 legacy richer fallback 覆盖；delete/restore barrier 必须阻止旧事件；只有真实 incoming writer 刷新 checkpoint；运行 `test:node-mutation-journal`, `test:project-save-coordinator`, `test:project-session-merge`, `test:project-session-dual-renderer`, `test:project-io` |
| Agent 运行控制与 steer | 主/独立 Renderer、`preload.cjs`、Agent IPC、`desktop/agent-run-control.cjs`、`agent-runtime.cjs` | pause 等待派发边界；stop 中断父运行；steer 只中断 child phase，queued steer 不得漏启新 phase；TaskScope update 必须先在 Main 归一化、重哈希、重算锁并保存，再补齐工具输出并在同一协议历史注入权威新 scope 与用户意图；运行 `test:agent-run-control`, `test:agent-steer`, `test:agent-window`, `test:ipc-registration` |
| Goal GUI/runtime/CLI/schema | `src/{goal-task-scope,goal-mode,project-agent-composer,automation-command-runtime}.ts*`、`src/main.tsx`、`agent-window-*`、`runtime/{goal-image-execution,goal-probe-admission,image-batch-scheduler,tool-schemas}.cjs`、`agent-runtime.cjs`、`integrations/naimage-control/` | 普通/Goal 在主输入区共用单触发器和双瓣扇形菜单；两阶段确认、hash drift 零派发、`all-goal-sources` 单次调用、逐 binding 输出、串行 probe、等待 probe 优先、公平进程容量、retry hold、provider draining、跨 Goal circuit 与费用边界必须一致；共享 command registry 同时驱动 Renderer、CLI 参考和测试；运行 `test:goal-task-scope`, `test:goal-runtime`, `test:goal-probe-admission`, `test:image-batch-scheduler`, `test:goal-probe-dual-renderer`, `test:automation-service`, `test:agent-window` 和 `aidebug:goal` |
| Glass registry、首帧与独立 Agent 镜像 | `runtime/glass-theme-presets.json`、`runtime/glass-theme-settings.cjs`、`public/glass-theme-bootstrap.js`、`src/{glass-theme,glass-theme-provider,settings-persistence,agent-window-sync}.ts*`、`desktop/ipc/config-ipc.cjs`、`electron-main.cjs`、`preload.cjs`、`desktop/ipc/window-ipc.cjs`、`desktop/agent-window-service.cjs`、`agent-window-renderer.js`、`agent-window.css` | registry/default/range、TS/CJS 归一化和启动期镜像必须一致；bootstrap 只信任安全 appearance 字段并重建变量；首个 React frame 必须用 `settingsWithGlassBootstrap` 保持同一外观，完整磁盘设置随后恢复 authority；主题切换只能投影根节点，不得 remount canvas；浅色 muted 在实色 surface 上至少 4.5:1；主/独立 BrowserWindow 创建和设置保存后的原生底色必须跟随主题 canvas；主 Renderer 是设置 authority，Main 只中继有界快照，独立窗只应用变量 allowlist；运行 `test:glass-theme`, `test:settings-persistence`, `test:settings-lazy-load`, `test:agent-window`, `test:ipc-registration`, `test:workspace-glass-ui`, `test:aidebug-glass-workspace`，需要真实可见证据时才运行 `aidebug:glass-workspace` |
| 自定义 Glass 背景资产 | `desktop/glass-background-service.cjs`、`desktop/ipc/config-ipc.cjs`、`electron-main.cjs`、`preload.cjs`、`src/{core,settings-persistence,glass-background}.ts`、`src/glass-lab.tsx` | AppSettings 的 ID/name/metadata/enable/overlay/blur 必须与 Main 镜像；磁盘仅接受内容寻址文件名，Renderer 不得接收路径或把 data URL 持久化；异步加载必须防止旧请求覆盖新设置，背景图启用时必须保留可读表面最低透明度且不得给作品图应用滤镜；clear 使用 30 天恢复保留，GC 只删除未引用且哈希通过的自有 WebP；运行 `test:glass-background`, `test:settings-persistence`, `test:workspace-glass-ui`, `test:ipc-registration`, `typecheck` |
| 图片格式、本地导出与远程资产 | `runtime/{tool-schemas,encoded-image-format}.cjs`、`electron-main.cjs`、`desktop/{image-export-service,public-http-resource,remote-asset-proxy}.cjs`、Asset IPC/preload、`src/remote-asset-source.ts`、Renderer/automation/CLI | 上游输入/结果限 PNG/JPEG/WebP，默认 PNG，未知格式在 provider 派发前拒绝，真实字节必须与请求格式一致；Provider URL 逐跳限公网 HTTP(S)，DNS 固定到禁用共享连接池的一次性连接并复核真实 socket，全局下载并发 2 且相同 URL 在途去重；新结果必须落盘后再进入画布，历史 URL 只经 recorded-only `naimage-asset:`，CSP 禁止 Renderer 直连；本地导出限 PNG/JPEG/WebP/AVIF/TIFF，格式元数据由共享 schema 驱动，同目标串行且无覆盖授权时 no-clobber；运行 `test:image-format`, `test:image-export`, `test:remote-asset-security`, `test:automation-service`, `typecheck` |
| 视频节点/导入/任务/模型目录 | `desktop/video-import.cjs`、`desktop/video-task-{adapter,service}.cjs`、`desktop/{model-catalog,project-session-normalizer,project-asset-repository,project-package-service}.cjs`、Asset/Agent/Server/VideoTask IPC、`electron-main.cjs`、`preload.cjs`、`src/{core,settings-persistence,settings-runtime,settings-drawer,model-config-dialog,automation-command-runtime,main}.ts*`、CLI schema/Skill、`docs/NEWAPI_INTEGRATION.md` | 本地格式/大小/受管复制与播放；生成任务先写 journal 再做单次 POST，4xx 明确拒绝，5xx/超时/无 ID 进入 `create-unknown` 且不得自动重建；有远端 ID 仅恢复 GET；下载优先 content 端点再回退经安全校验的结果 URL；journal 只留相对路径和凭证指纹，Renderer/CLI 不接收签名结果 URL；`doubao-seedance-2-0-260128` 兼容请求已开发但未真实验证，必须等用户允许后用一条最小任务确认字段与计费；图片 Base64 项目包显式拒绝视频；运行 `test:video-node`, `test:model-catalog`, `test:settings-persistence`, `test:settings-lazy-load`, `test:automation-service`, `test:ipc-registration`, `test:project-io`, `typecheck` |
| 服务返回清洗 | `electron-main.cjs` 正式路径、`src/server.ts` 浏览器回退 | 登录、用户、模型、日志和图片 DTO 不能静默分叉；正式行为以 Electron 路径为准 |
| Agent 文本清洗 | `agent-runtime.cjs` tool envelope、`src/core.ts` 持久化消息清洗、`src/agent.ts` 时间线 | 不泄露 entry id/FastMemory metadata，不重复最终文本；运行 `test:agent-text`, `test:timeline` |
| 更新清单 | `package.json`, `update-release.cjs`, `electron-main.cjs`, `build/update-public-key.pem`, `sparkai-extension` release manifest | canonical 清单的 product、version、minimum version、compatibility、hash、size 与制品必须一致，并独立验签 |

短期内不要为了去重而跨 CommonJS/TypeScript 强行共享运行时代码；优先使用共同 fixture 和契约测试保证一致。

## 8. 修改影响矩阵

| 修改类型 | 首要位置 | 必须联动检查 | 最低专项验证 |
| --- | --- | --- | --- |
| 四工作台领域、切换器或领域插件投影 | `runtime/workspace-domains.json`, `runtime/workspace-domain.cjs`, `src/{workspace-domain,workspace-chrome,main,plugin-system}.ts*` | `WorkspaceDomain` 类型、默认 Session/normalizer、新项目入口、保存恢复、Agent IPC/runtime Prompt、独立窗脱敏快照、automation schema/生成 registry/CLI Skill；切换不 remount、不清选择/任务、不联网/计费 | `test:workspace-domain`, `test:plugin-system`, `test:agent-window`, `test:automation-service`, `typecheck`；真实 UI 只运行 `aidebug:workspace-domain` |
| 顶栏、窗口按钮 | `src/main.tsx`, `src/window-controls.tsx`, `src/styles/01-base-controls.css` 与后续覆盖区域 | `ConfigBridge`, preload, window IPC | `build`, `aidebug:gui`, `test:lifecycle` |
| Glass 主题、材质、Glass Lab 或首帧 | `runtime/glass-theme-presets.json`, `src/glass-theme.ts`, `src/glass-theme-provider.tsx`, `src/settings-persistence.ts`, `public/glass-theme-bootstrap.js`, `src/glass-lab.tsx`, `styles/{01-liquid-glass-tokens,04b-glass-lab,07j-liquid-glass-surfaces}.css` | Electron `runtime/glass-theme-settings.cjs`、主/独立 BrowserWindow 创建底色与 `onSettingsSaved` 实时底色、root dataset/class/variable 合同、bootstrap 安全字段与首个 React seed、浅色 muted 对比、设置懒加载、独立 Agent appearance snapshot/变量 allowlist、画布不得 remount、artwork 必须不透明 | `test:glass-theme`, `test:settings-persistence`, `test:settings-lazy-load`, `test:workspace-glass-ui`, `test:agent-window`, `test:ipc-registration`, `test:aidebug-glass-workspace`；仅需真实视觉证据时运行 `aidebug:glass-workspace` |
| 左素材栏、项目搜索、Workspace 模式或 884 x 640 Shell | `src/workspace-chrome.tsx`, `src/main.tsx`, `src/settings-persistence.ts`, `src/settings-drawer.tsx`, `src/canvas-tools-settings-panel.tsx`, `src/styles/01-base-controls.css`, `src/styles/07j-liquid-glass-surfaces.css`, `electron-main.cjs` | 成果/图层/需求/模板/历史由 `visibleWorkspaceAssetRailTabs` 分别控制，旧设置默认全开且至少保留一项，隐藏当前页签后切至首个可见页签；空白画布右键的“打开当前项目文件夹”必须复用 `openCurrentProjectFolder` 与 Main IPC；模板页必须解释选中需求/Skill 后从顶部保存，节点右键提供同一真实保存动作；live nodes/conversations；Ctrl/Cmd K 与精确标题→前缀→内容排序；搜索真实选择；搜索浮层必须绘制 near-opaque 菜单面且关闭 backdrop filter，输入/标题/详情字号不得回退到旧 micro-text；Navigator/Workbench/Focus/Review 跨节点选择使用 explicit replace，不能使用会保守忽略的 selection `focus`；Focus/Review 选择需求或未完成图片时回到 Workbench 定位；Focus 继续生成只开编辑器且不派发/计费；Review 当前方向使用并持久化 canonical `selectedNodeId`；canonical canvas 持续挂载、Focus/Review sibling projection、全部 agent placement、异步 fallback 与窄屏断点；原型入口不得是无行为 mock | `test:workspace-glass-ui`, `test:settings-persistence`, `typecheck`；视觉或布局变更再运行 `aidebug:glass-workspace` |
| 画布交互/选择与普通节点拖动 | `src/main.tsx`, `selection-state.ts`, `canvas-commands.ts`, `src/styles/02-canvas-workspace.css`, `src/styles/07c-module-and-editor-repair.css`, `src/styles/07j-liquid-glass-surfaces.css` | Agent 当前上下文、容器拖放、关系线瞬时几何；正式关系线和连线草稿必须复用 `workflowNodeBounds` 的左右边框中点，lane 只影响 Bézier 控制点而不得移动端点；连接头只有超过阈值的拖动才建边，目标必须真实包含指针，单击/空白松手/`Escape`/`pointercancel` 只取消；每条可见线用透明命中 path 打开具体边菜单，节点菜单才批量断开，容器投影线同时保存可见宿主和底层真实 relation source/target；普通图片/容器拖动期间只更新 CSS transform 与边路径，`left/top` 保持稳定，hover/selected 和后置样式不得占用或过渡节点 transform，按下与松手都不得改变屏幕坐标，松手后单次提交真实坐标并清理变量/`will-change`；活动节点拖动拥有当前 pointer stream，移动后暴露的 `.node-image-tile` 原生 `dragstart` 必须被取消，不能触发 `pointercancel` 或阻塞立即复拖 | `test:selection`, `test:canvas-commands`, `test:requirement-graph`, `test:workspace-glass-ui`, `typecheck`, `aidebug:requirements`, `aidebug:selection`, `aidebug:canvas-clarity`, `aidebug:glass-workspace`, `aidebug:image-collection` |
| 图片容器/布局与最终图查看 | `image-container-spec.ts`, `image-container-graph.ts`, `task-result-layout.ts`, `image-layout.ts`, `src/image-viewer.tsx`, `src/styles/04-dialogs-viewers.css`；`image-container.ts` 仅作兼容 façade | session migration、TaskScope provenance、layout projection；`image-layout-settle` 不得占用 drag transform；查看器过滤 pending/error/partial，只显示最终资产，上方大图与下方单行横向缩略条保持稳定 | `test:image-container`, `test:image-layout`, `test:workspace-glass-ui`, `typecheck`, `aidebug:glass-workspace` |
| 视频成果节点与生成任务 | `desktop/video-import.cjs`, `desktop/video-task-{adapter,service}.cjs`, `desktop/project-{session-normalizer,asset-repository,store,package-service}.cjs`, Asset/VideoTask IPC, `electron-main.cjs`, `preload.cjs`, `src/{core,main}.ts*`, `src/manual-video-task-dialog.tsx`, `src/styles/02-canvas-workspace.css`, automation registry/runtime 与 CLI Skill | 本地导入仍走 `output/video/imports`；生成结果走 `output/video/generated`，任务状态走项目 journal；每文件/每任务独立节点、原生播放/seek、相对路径持久化、重启恢复、项目包拒绝；创建不明不得重建，Seedance 未授权前不得真实请求 | `test:video-node`, `test:project-io`, `test:model-catalog`, `test:settings-lazy-load`, `test:automation-service`, `test:ipc-registration`, `typecheck`；真实播放或任务 UI 变更时再运行对应 GUI 冒烟 |
| 需求节点 | `requirement-graph.ts`, `requirement-signature.ts`, dialogs, `main.tsx` | TaskScope、重复执行 gate、关系边 | requirement、task-scope、execution-gate、AIDebug suites |
| SKILL.md 导入/Skill 身份 | `skill-import.ts`, `CanvasRequirement.skill`, `main.tsx`, project IPC | 24,000 字符持久化上限、GUI/CLI 同 parser、绝对路径排除、requirement TaskScope/关系边、schema/Skill 文档 | `test:skill-import`, `test:automation-service`, `test:ipc-registration`, `typecheck`, `aidebug:skills` |
| Graph CLI/多节点原子操作 | `src/automation-command-{registry,runtime}.ts`, `src/canvas-relation-graph.ts`, `src/canvas-commands.ts`, `src/main.tsx`, `integrations/naimage-control` | 共享 schema；`canvas.state` 权威 revision/锁/关系，严格选择；项目 guard 必需、canvas revision CAS 可选、Requirement update/execute revision 必需；完整集合预校验，图 mutation 与 create/update 单次 commit/receipt；execute 仅在异步派发前 fence | `test:canvas-commands`, `test:selection`, `test:requirement-graph`, `test:automation-service`, `test:aidebug-graph-cli-harness`, `aidebug:graph-cli` |
| Agent Prompt/tool/schema | `agent-runtime.cjs` | `src/core.ts` 类型、`src/agent.ts`、action handler、产品意图 | `test:agent-text`, `test:agent-protocol`, `aidebug:gui` |
| Agent 暂停/结束/运行中修改 | `desktop/agent-run-control.cjs`, `desktop/ipc/agent-ipc.cjs`, `agent-runtime.cjs`, `src/agent-stop-request.ts`, 主/独立 Renderer composer | preload bridge、run snapshot、child AbortSignal、stop-pending/failure fence、工具协议补齐、节点锁与同会话历史；只有结构有效的 Main `{ok:true}` 才允许 Renderer 清除 active run，失败必须保持 busy 并可重试 | `test:agent-run-control`, `test:agent-steer`, `test:agent-window`（44+68）, `test:agent-window-ui`, `test:ipc-registration`, `aidebug:stop-pending` |
| 当前画布 Goal 模式 | `src/goal-task-scope.ts`, `src/goal-mode.ts`, `src/main.tsx`, `src/project-agent-composer.tsx`, `runtime/goal-image-execution.cjs`, `runtime/goal-probe-admission.cjs`, `runtime/image-batch-scheduler.cjs`, `agent-runtime.cjs` | 独立窗、session continuation 清洗/节点锁、共享 automation schema/Renderer registry/CLI Skill、一次工具调用、输出 provenance、进程 probe/ramp 准入、retry/draining/circuit 与费用文案 | `test:goal-task-scope`, `test:goal-runtime`, `test:goal-probe-admission`, `test:image-batch-scheduler`, `test:goal-probe-dual-renderer`, `test:automation-service`, `test:agent-window`, `test:agent-steer`, `typecheck`, `aidebug:goal` |
| 图片格式/另存为/远程 URL | `runtime/encoded-image-format.cjs`, `desktop/{image-export-service,public-http-resource,remote-asset-proxy}.cjs`, `desktop/ipc/asset-ipc.cjs`, `electron-main.cjs`, `preload.cjs`, `src/remote-asset-source.ts`, `src/main.tsx`, automation registry/runtime 与 CLI schema/Skill | 上游 PNG/JPEG/WebP 真实字节与请求一致、本地五格式、真实解码识别、alpha 规则、共享格式注册表、原生 Save 授权、受管源图只读、同目标串行、no-clobber/确认后原子替换、真实失败传播、PSD 独立；远程结果逐跳公网校验、DNS pin、真实 socket 复核、禁共享 agent、全局并发 2/同 URL 去重、新结果落盘、历史 recorded-only proxy、Renderer CSP 禁止直连；不得引入模型调用或计费 | `test:image-format`, `test:image-export`, `test:remote-asset-security`, `test:automation-service`, `typecheck`, `build`, `test:bundle` |
| `view_image` | `runtime/view-image-payload.cjs`, `agent-runtime.cjs` | 允许根、payload 预算、Sharp、持久化排除 | `test:view-image`, `test:agent-protocol` |
| 模型目录/缓存与逐模型连接 | `desktop/{model-catalog,new-api-client,settings-secret-store}.cjs`, `electron-main.cjs`, `agent-runtime.cjs`, `src/{core,settings-persistence,server,main,project-agent-composer,settings-drawer,model-config-dialog}.ts*`, `docs/NEWAPI_INTEGRATION.md` | 服务响应 DTO、当前账户 Token 或自定义接口的 `/v1/models`、每模型 `supported_endpoint_types`、独立 Agent/Image/Video 状态、能力证据与最近验证时间；`agentModelBindings`/`imageModelBindings` 分域路由，留空继承全局 URL/Key/Token，Responses 生图不得读取对话绑定；60 秒运行缓存、`cacheOnly` 离线磁盘快照、旧缓存先显示/后台刷新和大列表虚拟化；缓存键含逐模型 URL/Key/Token 的单向指纹，更换绑定不得复用旧目录，磁盘缓存仍不得含 Key；Renderer 占位符合并前由 Main 恢复；端点能力是正向证据，缺失或错误时保留图像/视频名称回退，显式视频模型不得混入前两类 | `test:agent-model-binding`, `test:custom-api-transport`, `test:model-catalog`, `test:settings-persistence`, `test:settings-secret-store`, `test:settings-lazy-load`, `test:access-variant`, `test:ipc-registration`, `typecheck` |
| 账户密钥快照/显式刷新 | `desktop/account-token-service.cjs`, server IPC, `src/main.tsx` | 按账户隔离、脱敏字段、preload bridge、设置页不得自动联网 | `test:account-token`, `test:settings-lazy-load`, `test:ipc-registration`, `typecheck`, `build`, `test:bundle` |
| 设置/浏览器回退存储 | `settings-persistence.ts`, `electron-main.cjs`, `desktop/plugin-state.cjs` | `AppSettings` 类型、Electron ConfigBridge、当前 `naimage.*` LocalStorage 键、更名前键的只读迁移、账户切换认证边界、`workspacePluginDefaultsVersion` 一次性第一方组件迁移、`visibleWorkspaceAssetRailTabs`、视觉隐藏专用 `disabledCanvasToolCommands` 与 `canvasToolShortcuts` 的 Renderer/Electron 同构默认值及规范化 | `test:settings-persistence`, `test:plugin-system`, `test:workspace-glass-ui`, `test:ipc-registration`, `typecheck`, `aidebug:workspace-domain` |
| 自定义 API Key 安全存储 | `desktop/settings-secret-store.cjs`, `electron-main.cjs`, `desktop/ipc/config-ipc.cjs`, Renderer 设置表面 | 全局 Agent/图片 Key 与 `agentModelBindings`/`imageModelBindings` 逐模型 Key 的普通 JSON 均不含明文；Renderer 只收占位符；占位符保存/模型列表草稿合并保留旧 Key，显式清空删除 Key；损坏普通设置不删除 sidecar | `test:settings-secret-store`, `test:settings-persistence`, `test:settings-lazy-load`, `typecheck`, `build` |
| 明暗模式/主题调色盘 | `theme-palette-picker.tsx`, `settings-persistence.ts`, `desktop/theme-preset-service.cjs`, `styles/01-theme-palettes.css`, `styles/04-settings-appearance.css` | `AppSettings.theme/themePalette/customTheme`、Electron `defaultSettings/migrateSettings` 镜像、ConfigBridge/IPC、独立 Agent 快照、Vite `studio-dialogs` 懒加载 chunk | `test:theme-preset`, `test:settings-persistence`, `test:agent-window`, `test:ui-foundation`, `test:ipc-registration`, `typecheck`, `build`, `test:bundle`, `aidebug:gui` |
| 插件/电商/Project Graph | `plugin-state.ts`, `plugin-system.ts`, `plugins/builtin-manifests.json`, `src/plugins/*`, `desktop/plugin-task-prompts.cjs`, `desktop/project-graph-adapter.cjs` | Electron/Renderer 状态与快捷键覆盖清洗镜像、设置持久化、权限、动态 chunk、preload/IPC、主 Renderer handler；长 Prompt 归 Main；禁止脚本注入、扩展执行和直接 session 写入 | `test:plugin-system`, `test:project-graph`, `test:settings-persistence`, `test:workspace-glass-ui`, `test:ipc-registration`, `typecheck`, `build`, `test:bundle`, `aidebug:commerce-set` |
| 远端 API/模型/登录 | `runtime/access-variant.cjs`, `src/access-policy.ts`, `desktop/ipc/server-ipc.cjs`, `desktop/new-api-transport.cjs`, `desktop/new-api-client.cjs`, `electron-main.cjs`, `src/server.ts` | 构建策略清单、preload/core bridge、sparkai-extension；SparkAPI 专用版不得接受自定义 Base URL/API Key 或 Relay 覆盖 | `test:access-variant`, `test:new-api-transport`, `test:lifecycle`, `aidebug:auth-gate` |
| 项目保存/session | `main.tsx`, `desktop/ipc/config-ipc.cjs`, `desktop/project-save-coordinator.cjs`, `desktop/project-session-{merge,normalizer}.cjs` | session v5、manifest、revision、writer baseline/sequence/checkpoint、字段事件、delete/restore barrier、节点 ID 重映射、迁移、原子写入；生成资产以 `runId + normalized managed locator` 幂等，首次持久化 occurrence/asset/display identity 保持稳定；普通导入仍按 occurrence 区分。旧 Session 只收敛可证明为同一生成文件的重复项，并同步 assets/outputs/collection/progress/bindings，保留失败槽位 | `test:node-mutation-journal`, `test:project-save-coordinator`, `test:project-session-merge`, `test:project-session-dual-renderer`, `test:project-io`, `test:image-container` |
| 图片导入/缩略图 | `image-import.cjs`, `thumbnail-cache.cjs`, `image-thumbnail-worker.cjs`, `electron-main.cjs`, `src/core.ts`, `src/main.tsx` | 资产身份、路径限制、容器；项目私有 WebP 缓存按来源指纹和 256/512/1024 桶复用，Main 最多保留 2 个常驻 Sharp 子进程并用 `requestId` 串行派发每个槽位，默认保留 512 个变体/512 MiB；画布中长边大于 1024 的普通单图使用 1024 缩略图，多图按实际足迹使用 512/1024 桶，查看器主图始终读取原图。性能诊断必须同时报告 `workerStarts/workerJobs/workerReuses/workerFailures`、冷生成、缓存命中与 Renderer Long Task | `test:image-import`, `test:thumbnail-cache`, `aidebug:performance`, `aidebug:performance:audit:test`, AIDebug import |
| 抠图/alpha/分层 | `layer-alpha-normalization.ts`, `core.ts`, matting/background/layer modules | 尺寸、透明度、mask replay、PSD | alpha、mask、matting、chroma-key、PSD tests |
| 更新/安装器 | main/update/release scripts/build/tools | 独立 `sparkai-extension` 不参与桌面更新；桌面 manifest、签名密钥和回滚仍由发布服务维护；公开 Setup 名称由接入策略统一生成，内部 `naimage.exe` / App ID / 数据目录保持升级兼容；安装/卸载器灰白透明玻璃视觉与品牌文案；真实安装成功后完成反馈自动关闭，错误/取消与截图模式保持独立 | access-variant、update、release-orchestrator、installer UI smoke（含 completion auto-close probe）、installer smoke、update E2E |
| Bundle 分层策略或异步边界 | `scripts/production-bundle-policy.cjs`, `scripts/production-bundle-selftest.cjs`, Vite imports/chunks | initial/plugin/CSS hard gate、core async/core/dist advisory、AIDebug marker 与插件初始图结构门禁；优先复用和自然异步，不为数字引入高风险重构或复杂拆分 | `test:bundle-policy`；只有直接影响 Bundle/chunk 边界或正式发布时再运行 `build` + `test:bundle` |
| 模块移动/拆分 | 原模块与新模块 | public re-export、打包 files、worker/ASAR 路径、本文 | `typecheck`, `build`, `test:bundle` + 对应专项 |

## 9. 状态与持久化位置

### 9.1 开发态与打包态根目录

| 数据 | 开发态 | 打包态 |
| --- | --- | --- |
| config 根 | 普通源码开发且未显式覆盖 `user-data` 时为仓库 `config/`；只要传入 `--user-data-dir`，默认即为 `<user-data>/data` | Electron `userData/data/` |
| Agent workspace | 仓库根目录 | Electron `userData/workspace/` |
| Electron diagnostics | `.diagnostics/electron/` | Electron logs 下的 `runtime/` |

可用 `NAIMAGE_CONFIG_DIR`、`NAIMAGE_DEBUG_DIR` 等诊断变量覆盖隔离测试目录；不得把真实用户数据写入随机源码目录。AIDebug 必须同时提供显式临时 `--user-data-dir`，并让 config 位于 `NAIMAGE_AIDEBUG_ISOLATION_ROOT`（CLI 默认为本次诊断目录）内部；若 config 指向仓库 `config/`、真实 AppData userData，或逃逸隔离根，Main/CLI 必须 fail closed，不能启动可写调试控制面。

### 9.2 应用与项目文件

| 路径/文件 | 内容 | 所有者 |
| --- | --- | --- |
| `app-settings.json` + `app-settings.secrets.json` | 普通文件保存 App 设置、Glass、账号 session、所选账户密钥的 ID/名称/分组和代理等；safeStorage sidecar 加密保存自定义 Agent/图片/逐模型 API Key | Electron Main；普通 JSON、日志、模型缓存和项目文件不得含完整 Key，Renderer 只接收占位符 |
| `requirement-library.json` | 跨项目共享的安装级个人 Requirement 模板，最多 200 项，包含标题、正文、模板 revision、时间戳与可选 `CanvasSkill` 元数据 | Electron Main；独立于 AppSettings 和项目 session，不保存 bindings、节点 ID、坐标、运行记录或绝对路径 |
| `commerce-template-library.json` | 安装级个人套图模板、library/item revision 与便携计划；同名新建显式选择覆盖个人模板或另存副本，导入固定另存副本 | Electron Main；内置模板只读，不保存 SOURCE 专属翻译单元、canvas saveTarget 或绝对路径 |
| Renderer LocalStorage `naimage.glassTheme.bootstrap.v1` | React/bridge 可用前使用的 `naimage-glass-theme-bootstrap` v1 安全外观快照；变量必须由 appearance 字段重建 | `GlassThemeProvider` 写、`public/glass-theme-bootstrap.js` 读；不是设置 authority，不得含凭据、Prompt 或项目数据 |
| Renderer LocalStorage `naimage.workspaceViewMode.v1` | `workbench` / `focus` / `review` 便利视图偏好 | Renderer UI；不进入项目 session，不改变画布或 Agent TaskScope |
| Renderer LocalStorage `naimage.commerceTutorial.v1:<projectId>` | 跨境套图 AI 陪练的当前阶段、初始图片数和成果基线 | Renderer 便利进度；按项目隔离，不是 session authority，不保存 Prompt/凭据或触发执行 |
| `session.json` | 旧版全局 Session，只读扫描并作为显式迁移来源；新版本不再创建或更新 | Electron Main 迁移服务 |
| `model-cache.json` | 60 秒模型运行缓存的磁盘回退；设置页 `cacheOnly` 可读取过期快照 | Electron Main；不得含 token/cookie/key |
| `account-token-cache.json` | 最多 8 个账户的密钥公开元数据、选择状态与更新时间快照 | Electron Main；按账户地址 + user ID 隔离，不得含完整/掩码 Key、Cookie、IP 白名单或模型限制 |
| `project-list.json` | 项目登记与 activeProjectId | Electron Main |
| `projects/<id>/session.json` 或用户选择项目的 session | `workspaceDomain`、画布、会话、容器、需求与资产引用；每张生成图片可保存白名单 `ImageAsset.generation v1` 请求/响应/耗时快照；AskUser 挂起任务可保存合法 `imageRatio/imageResolution`，旧项目缺失领域时归一为 `general` | Renderer 产生、Main 清洗并原子写入；generation 不含 Key、Token、Cookie、Prompt、绝对上游 URL 或签名 URL；运行锁本身不持久化 |
| `<project>/.naimage/project.json` | `naimage-project` manifest v2、revision 和统计 | Electron Main |
| `<project>/.naimage/agent/fastmemory.json` | 按 `projectId + conversationId` 隔离的项目 FastMemory | Agent runtime；不得新写入 AppData memory |
| `<project>/.naimage/agent/conversations.json` | 项目 conversation summary 与 protocol turns | Agent runtime；清理会话只影响当前项目/会话 |
| `<project>/.naimage/export-center.json` | 项目级导出预设、最近内容指纹和最多 200 条导出历史 | Electron Main；严格 schema 与原子替换，不保存绝对路径、凭据或图片字节 |
| `<project>/.naimage/commerce-catalog.json` | 独立目录 revision、商品/变体/SKU 与母图、品牌素材、生成结果关联 | Electron Main；项目路径是持久化范围，Renderer 只提交 `nodeId + assetIndex` |
| `<project>/.naimage/video-task-journal.json` | 视频任务 ID、状态、兼容端点族、请求参数、相对输出路径与凭证单向指纹 | Electron Main；不得保存 Key、绝对路径、`naimage-asset:` 或向 Renderer 公开的签名结果 URL |
| `<project>/.naimage/scientific/` | `data-registry.json`、内容寻址受管数据、`task-journal.json`、任务工作目录和有界日志 | Electron Main 科研 Runner；Renderer/CLI 只使用脱敏 ID/metadata，不接收绝对路径 |
| `<project>/output/` | 生成/衍生图片，以及 `video/imports` 本地受管导入、`video/generated` 上游视频结果和 `scientific/<workflow>/<task>` 科研图/脚本/计划/QA 成果 | Main/Agent 图片链路、视频任务服务与科研 Runner |
| `<project>/references/` | 兼容/受管参考资产 | Electron Main |
| `<project>/exports/images/` | PNG/JPEG/WebP/AVIF/TIFF 普通图片另存 | Electron Main；最终真实路径不得逃逸项目根 |
| `<project>/exports/psd/` | 单图与分层 Photoshop PSD | Electron Main；与普通图片链路隔离 |
| `<project>/exports/layers/` | 分层 PNG、合成图和 `layers.json` 目录包 | Electron Main；staging 后原子发布 |
| `<project>/image-groups/` | 当前单组/多组格式化图片；每个稳定组名一个同级目录与 `image-group.json` | Electron Main；预检令牌、同批 staging、备份、原子发布和整批回滚；受管原图保持原位 |
| `<project>/exports/image-groups/` | 旧版本图片组导出 | Electron Main 仅兼容打开已有 manifest；新导出不再写入 |
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

应用级 memory 位于 `<configRoot>/memory/`：

- `promptcontext.json`：可编辑主 Prompt 与 memory Prompt。
- `fastmemory.json`：仅作为旧项目迁移输入和空兼容壳；项目 FastMemory 的新写入位于 `<project>/.naimage/agent/fastmemory.json`。
- `memorycontext.json`：内部 memory context。
- `datememorycontext.json`：日期维护上下文。
- `naimage-memory.db`：App 级 runtime meta、context、toolmemory、date memory 等 SQLite 数据；项目 summary/protocol 的新写入位于 `<project>/.naimage/agent/conversations.json`。当前库不存在时可从更名前数据库只读迁移，失败时不覆盖或删除来源。

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
| 四工作台领域注册表、旧 Session、新项目、插件投影、Agent/CLI 镜像 | `corepack pnpm run test:workspace-domain`, `corepack pnpm run test:plugin-system`, `corepack pnpm run test:agent-window`, `corepack pnpm run test:automation-service`, `corepack pnpm run typecheck`；单一真实 Electron 冒烟为 `corepack pnpm run aidebug:workspace-domain` |
| 社媒计划/Requirement/provenance、发布包、视频身份和共享命令 | `corepack pnpm run test:social-content`, `corepack pnpm run test:social-export`, `corepack pnpm run test:video-node`, `corepack pnpm run test:automation-service`, `corepack pnpm run test:ipc-registration`, `corepack pnpm run typecheck`；单一真实 Electron 冒烟为 `corepack pnpm run aidebug:social-content` |
| 科研计划/Requirement、受管数据、Python/R Runner、Panel/导出与 7 个共享命令 | `corepack pnpm run test:scientific-runner`, `corepack pnpm run test:automation-service`, `corepack pnpm run test:ipc-registration`, `corepack pnpm run test:workspace-glass-ui`, `corepack pnpm run typecheck`；单一真实 Electron 冒烟为 `corepack pnpm run aidebug:scientific-figure`，该 GUI 场景不执行 Runner |
| 跨境套图 AI 陪练的状态推进、导入/工具/Agent 引导、费用边界、项目进度与成功奖励 | `corepack pnpm run typecheck`, `corepack pnpm run test:workspace-glass-ui`；单一真实 Electron 冒烟为 `corepack pnpm run aidebug:commerce-tutorial`，不发送 Agent 或真实图片请求 |
| Agent Prompt/FastMemory/tool contract | `corepack pnpm run test:agent-text` |
| Agent/Responses/TaskScope protocol | `corepack pnpm run test:agent-protocol` |
| Responses 请求转换 | `corepack pnpm run test:agent-responses-adapter` |
| New API transport / AIDebug image fixture / Images SSE / 显式代理 | `corepack pnpm run test:new-api-transport` |
| New API 账户密钥列表/选择/CRUD、原生 Key 响应兼容与账号 `/v1` 直连 | `corepack pnpm run test:account-token` |
| 设置页账户/模型离线快照与显式刷新 | `corepack pnpm run test:settings-lazy-load` |
| 本机 loopback 自动化鉴权与正式 CLI | `corepack pnpm run test:automation-service` |
| MCP 同注册表包装、stdio JSON-RPC、loopback 转发和 Token 不回显 | `corepack pnpm run test:mcp-wrapper` |
| 开发调试 service command、schema 参数、日志/状态脱敏、固定截图目录、生产拒绝和无 Renderer 分流 | `corepack pnpm run test:automation-debug` |
| 个人需求模板库的 JSON/CAS、IPC/preload 与 CLI list/save/delete/use | `corepack pnpm run test:automation-service`, `corepack pnpm run test:ipc-registration` |
| Goal 冻结范围、runtime 展开与跨 Renderer 高并发保护 | `corepack pnpm run test:goal-task-scope`, `corepack pnpm run test:goal-runtime`, `corepack pnpm run test:goal-probe-admission`, `corepack pnpm run test:image-batch-scheduler`, `corepack pnpm run test:goal-probe-dual-renderer`；GUI 为 `corepack pnpm run aidebug:goal`，验证可见模式、真实计数、确认警告、hash drift 零派发及无重叠/裁切 |
| SKILL.md 解析、限制、CanvasSkill 持久化往返 | `corepack pnpm run test:skill-import` |
| Skill-backed requirement 节点、重复导入、异常 frontmatter、主/独立 TaskScope 控件 | `corepack pnpm run aidebug:skills` |
| Codex/Claude Code/OpenCode/OpenClaw Skill 检测、安装与移除 | `corepack pnpm run test:agent-integration` + Skill `quick_validate.py` |
| 自定义 API `/v1`、JSON/SSE 回退 | `corepack pnpm run test:custom-api-transport` |
| Cloudflare 图片长请求任务化、单次创建、GET 轮询与旧同步接口兼容 | Desktop `corepack pnpm run test:custom-api-transport`、`corepack pnpm run typecheck`、`node --check desktop/new-api-client.cjs`、`node --check electron-main.cjs`；SparkAI Extension `corepack pnpm run check`（仅 loopback fixture，不调用真实模型） |
| 顶部 Agent 比例/清晰度冻结、冲突覆盖、AskUser continuation、上游规格 Prompt 与最终像素 | `corepack pnpm run test:image-frame-contract`、`corepack pnpm run test:agent-run-control`、`corepack pnpm run test:goal-runtime`、`corepack pnpm run test:agent-text`、`corepack pnpm run test:custom-api-transport`、`corepack pnpm run test:project-io`、`corepack pnpm run typecheck`；隔离 UI 用 `corepack pnpm run aidebug:ask-user` 核对 composer/pending/resumed frame |
| 每张最终图片的请求/响应参数、成图实测规格、白名单持久化与本地导入兼容 | `corepack pnpm run test:image-generation-metadata`（13 cases）、`corepack pnpm run test:custom-api-transport`（24 cases）、`corepack pnpm run test:workspace-glass-ui`（155 cases）、`corepack pnpm run typecheck`；编辑成果宽/窄真实 Electron 证据由 `corepack pnpm run aidebug:image-collection` 覆盖 |
| 真实图片模型比例/清晰度验收计划与付费请求授权门禁 | `corepack pnpm run test:real-model-validation`；`node scripts/real-model-validation.mjs --settings <显式设置副本>` 默认只输出脱敏 dry-run，未同时满足 `--live --confirm-network --confirm-cost` 和独立环境口令时不得联网 |
| 双发行接入策略、SparkAPI 专用 Main 门禁、公开安装包命名与构建清单 | `corepack pnpm run test:access-variant`、`corepack pnpm run test:update`、`corepack pnpm run test:release-orchestrator`；Renderer 类型为 `corepack pnpm run typecheck`，需要产物时分别运行 `build:unrestricted` / `build:sparkapi`，双 EXE 使用 `package:win:variants` |
| 设备激活、缓存与离线宽限 | `corepack pnpm run test:license` |
| `view_image` | `corepack pnpm run test:view-image` |
| 项目 IO | `corepack pnpm run test:project-io` |
| 视频文件头/受管复制、独立 create/poll/download、相对 journal、幂等失败、创建不明、重启恢复、下载回退、公开 DTO 与项目包边界 | `corepack pnpm run test:video-node`；模型/设置/CLI/IPC 镜像再运行 `test:model-catalog`, `test:settings-persistence`, `test:settings-lazy-load`, `test:automation-service`, `test:ipc-registration`；真实 Seedance 只在用户明确允许后单独执行一条最小任务 |
| 保存 revision/队列/节点 journal/多窗口合并 | `corepack pnpm run test:node-mutation-journal`, `corepack pnpm run test:project-save-coordinator`, `corepack pnpm run test:project-session-merge`, `corepack pnpm run test:project-session-dual-renderer` |
| Agent 暂停/结束/运行中修改 | `corepack pnpm run test:agent-run-control`, `corepack pnpm run test:agent-steer`；主/独立窗为 `test:agent-window`（44+68 cases），真实失败保留/重试为 `aidebug:stop-pending` |
| 模型目录/缓存纯逻辑 | `corepack pnpm run test:model-catalog` |
| 设置迁移与 localStorage 回退 | `corepack pnpm run test:settings-persistence` |
| Glass registry、首帧 bootstrap/首个 React seed、根投影、浅色 muted 对比、Electron 归一化与原生窗口底色 | `corepack pnpm run test:glass-theme`；设置保存回调与独立窗口底色同时运行 `corepack pnpm run test:ipc-registration`、`corepack pnpm run test:agent-window` |
| 自定义 Glass 背景的 WebP 转码、内容寻址、受限加载与保留式 GC | `corepack pnpm run test:glass-background`, `corepack pnpm run test:settings-persistence`, `corepack pnpm run test:ipc-registration` |
| Workspace 正式左素材栏、项目搜索、Workbench/Focus/Review、项目迁移/图片组导出确认、Glass CSS/artwork 保护、最终图查看器、普通节点合成层拖动与关键字号 | `corepack pnpm run test:workspace-glass-ui`（149 cases，覆盖 Workspace 真实接线、迁移预检与独立清理确认、Main 目录选择、图片组格式/统计预检与令牌刷新、菜单近实色可读性、自定义背景加载防竞态、artwork 无滤镜、最终资产过滤/单行缩略条、拖动 transform 合同和关键字体 token）；设置/Glass Lab 自然异步为 `corepack pnpm run test:settings-lazy-load`；AIDebug 注册静态合同为 `corepack pnpm run test:aidebug-glass-workspace` 与 `corepack pnpm run test:aidebug-catalog`；本轮真实 Electron 图片组/迁移表面由 `aidebug:image-collection` 与 `aidebug:isolation` 覆盖，报告分别为 `.diagnostics/electron/aidebug-2026-08-14T03-54-29-294Z/report.json`（9 scenes / 0 failures）和 `.diagnostics/electron/aidebug-isolation-gui-2026-08-14T03-59-42-933Z/report.json`（隔离项目写入、仓库配置不变） |
| 粘贴块 | `corepack pnpm run test:paste-blocks` |
| Agent 文本 UI | `corepack pnpm run test:agent-text-ui`；焦点/关闭合同稳定性需覆盖设置、账户、Prompt、模型、确认框和会话历史，最新连续报告 `.diagnostics/electron/agent-text-ui-2026-08-15T20-05-54-310Z/report.json`、`.diagnostics/electron/agent-text-ui-2026-08-15T20-06-45-292Z/report.json` 均为 155/155 |
| AIDebug CLI/options 纯解析 | `corepack pnpm run test:aidebug-options` |
| AIDebug 项目隔离、Main 危险目录拒绝、preload/Renderer 运行时双门禁与真实自动保存落点 | `corepack pnpm run test:aidebug-isolation`；真实 Vite + Electron + CDP 专项为 `corepack pnpm run aidebug:isolation`，两者都必须证明仓库 `config/` 未变化 |
| 显式项目根、空项目、无全局 Session 新写入、用户目录不删除与发布 fixture | `corepack pnpm run test:project-root-policy`（19 cases）、`corepack pnpm run test:project-save-coordinator`（21 cases）、`corepack pnpm run test:goal-task-scope`、`corepack pnpm run test:aidebug-isolation` |
| 旧 AppData 项目/全局 Session、项目 Agent 状态、空间预检、SHA-256、原子迁移、回滚、production 数字确认归一化与二次确认清理 | `corepack pnpm run test:project-data-migration`（41 cases）、`corepack pnpm run test:project-root-policy`、`corepack pnpm run test:ipc-registration`（真实 preload VM 覆盖 `1`/`"1"`/`2` 边界）；真实隔离 GUI 为 `corepack pnpm run aidebug:isolation` |
| 用户指定旧项目/全局 Session 的只读迁移清单、SHA-256、空间与备份计划 | `corepack pnpm run test:project-migration-audit`；CLI 无参数不扫描 C 盘，`--execute`/`--cleanup` 明确拒绝 |
| 布局/容器 | `corepack pnpm run test:image-layout`, `corepack pnpm run test:image-container` |
| 画布流式中间图 | `corepack pnpm run test:image-stream-preview`（30 cases，包含同槽替换、最终图下一动画帧清理、Agent/独立窗/项目不持久化合同）；无付费真实 DOM 替换验证使用 `$env:NAIMAGE_AIDEBUG_IMAGE_PARTIALS='3'; node scripts/aidebug-gui.mjs --image-only --mock-agent --image-runs=1`，当前权威报告为 `.diagnostics/electron/aidebug-2026-08-05T05-51-40-277Z/agent-image-suite.json` |
| 图片组命名、受管替换/瑕疵组、项目级多同级目录、PNG/JPEG/WebP/AVIF/TIFF 预检/令牌/统计批量导出与新旧目录入口 | `corepack pnpm run test:image-collection-mutation`（4 cases）、`corepack pnpm run test:image-collection-export`（受管资产、项目级多组目录、旧目录兼容、格式转换、内容漂移、manifest、排序、重命名、整批回滚与目录解析）、`corepack pnpm run test:automation-service`、`corepack pnpm run test:ipc-registration`、`corepack pnpm run typecheck`；真实隔离 Electron 为 `corepack pnpm run aidebug:image-collection` |
| 统一导出中心的项目预设、命名模板、冲突策略、串行队列、增量跳过、历史和图片/组/PSD owner 分流 | `corepack pnpm run test:export-center`、`corepack pnpm run test:export-center-ui`、`corepack pnpm run test:image-export`、`corepack pnpm run test:image-collection-export`、`corepack pnpm run test:psd-export`、`corepack pnpm run test:ipc-registration`、`corepack pnpm run typecheck`；真实可见闭环为 `corepack pnpm run aidebug:gui:surface` |
| 需求/TaskScope/gate | `test:requirement-signature`, `test:requirement-graph`, `test:task-scope`, `test:execution-gate`；GUI 专项为 `aidebug:requirements`，完整 Layer Stack 仅按需运行 `aidebug:requirements:full` |
| UI primitives | `corepack pnpm run test:ui-foundation` |
| Agent 面板布局/拖动/原生文本选择与 Ctrl+C/提示词复制区/紧凑模型与素材工具栏/比例和清晰度玻璃 listbox/普通与 Goal 扇形菜单/引用图/独立窗口 | `corepack pnpm run test:agent-panel-layout`, `corepack pnpm run test:agent-panel-ui`（52 cases，普通消息 0 按钮并验证真实 Selection/copy event）, `corepack pnpm run test:agent-text-ui`, `corepack pnpm run test:agent-window`, `corepack pnpm run test:agent-window-ui` |
| 图片成果内容摘要标题与同 Prompt 多图稳定序号 | `corepack pnpm run test:image-content-title`（7 cases）、`corepack pnpm run test:agent-panel-ui`、`corepack pnpm run typecheck` |
| alpha/mask/matting | `test:chroma-key`, `test:layer-alpha`, `test:layer-mask-replay`, `test:semantic-matting` |
| 选择/画布/资产与 Graph CLI | `test:selection`, `test:canvas-commands`, `test:asset-identity`, `test:requirement-graph`, `test:aidebug-graph-cli-harness`；真实 CLI 闭环为 `aidebug:graph-cli` |
| 工具时间线 | `corepack pnpm run test:timeline` |
| PSD/缩略图/导入/单图本地导出 | `test:psd-export`, `test:thumbnail-cache`, `test:image-import`, `test:image-format`, `test:image-export` |
| IPC 注册顺序/preload 对称性 | `corepack pnpm run test:ipc-registration`；当前合同为 147 invoke handlers / 144 preload invokes / 3 internal Agent invokes / 9 receives / 2 sends |
| 平台导出规则、目录包与真实 UI | `corepack pnpm run test:commerce-export`, `corepack pnpm run test:commerce-catalog-ui`, `corepack pnpm run test:commerce-export-ui` |
| 跨境套图/多语言矩阵与直接派发 | `corepack pnpm run test:commerce-set`, `corepack pnpm run test:goal-runtime`, `corepack pnpm run test:commerce-catalog`, `corepack pnpm run test:commerce-catalog-ui`, `corepack pnpm run aidebug:commerce-set` |
| Project Graph `.prg`/JSON 适配与安全边界 | `corepack pnpm run test:project-graph` |
| 自定义主题 schema/导入导出 | `corepack pnpm run test:theme-preset` |
| Electron 生命周期 | `corepack pnpm run test:lifecycle` |
| 更新 | `test:update`, `test:update-rollback`, `test:update-helper` |
| 正式 bundle | `corepack pnpm run test:bundle` |
| Bundle hard/advisory policy | `corepack pnpm run test:bundle-policy` |
| 大量图片性能证据 schema、Worker 复用/冷热缓存/Long Task 必需字段与旧报告兼容 | `corepack pnpm run aidebug:performance:audit:test`；对最新真实报告复核使用 `corepack pnpm run aidebug:performance:audit` |
| 正式产品性能硬门禁 | `corepack pnpm run aidebug:performance:product` |
| 日常 GUI 快速冒烟（主画布宽/窄、Agent、设置） | `corepack pnpm run aidebug:gui` |
| 完整 UI surface 基线 | `corepack pnpm run aidebug:gui:surface` |
| 正式发布 | `corepack pnpm run release:final` |

测试存在不代表所有改动都要执行全量套件。日常开发优先跑纯逻辑 selftest 和一个受影响领域专项；一般 Renderer/UI 改动在一批功能完成后只跑一次快速 `aidebug:gui`，跨页面或全局 surface 改动才跑 `aidebug:gui:surface`。Electron、项目或 Agent 非可视改动无需机械追加 GUI。双版本测试开发包通过 `scripts/release/build-access-variants.mjs --package` 构建时默认不执行 Bundle 门禁，只有显式传入 `--enforce-bundle` 才追加；正式制品仍必须通过 `test:bundle`、独立的 `aidebug:performance:product` 产品性能硬门禁和发布编排器的完整要求。

当前 Renderer Bundle 采用 hard/advisory 分层策略。硬门禁为：initial JS 目标 685,000 B，并额外允许 1,024 B 测量容差；685,001–686,024 B 记录 advisory，超过 686,024 B 才失败；plugin JS 120,000 B 与 CSS 270,000 B 无额外容差并直接失败。core async JS 190,000 B、core JS 870,000 B 与完整 dist 1,200,000 B 是 advisory 趋势目标，不单独导致 `test:bundle` 失败。AIDebug marker 泄漏、首屏入口无法识别、插件 chunk 缺失或插件进入初始依赖图仍是结构性硬失败；插件 JS 不计入 core JS/core async，但继续受 plugin hard gate。真实启动、堆内存、缩放、平移、拖动和 long task 由 `aidebug:performance:product` 独立硬门禁验证；采集 CPU profile 时只排除不随产品加载的 source map，完整运行资源总量仍仅作趋势预警，任何 Bundle advisory 结果都不能替代产品性能证据。

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

- `src/main.tsx`、`electron-main.cjs`、`agent-runtime.cjs` 和 `src/core.ts` 仍较大，但已分别建立 renderer surface、desktop domain、runtime domain 与纯数据模块边界；Main 的 147 个 invoke handler（144 个 preload invoke + 3 个内部 Agent invoke）、9 个进度/命令接收和 2 个 preload send channel 已由 `desktop/ipc/*` 独立拥有，`agent-runtime.cjs` 的 memory store、tool schema、Responses/Chat parser 与图片批次调度也已有独立 owner，后续继续沿现有边界拆，不要重新内联。
- 同项目并行采用多个 Renderer 窗口隔离运行状态；Main 以 `projectId + conversationId + Renderer owner` 管理暂停、恢复、结束、steer 和节点锁。Renderer 消失会停止其全部 run 并立即拒绝对应 automation pending；最后一个 run 回收 scope，应用退出在拆 transport 前执行 `stopAll`。不同 owner 即使共享项目/会话也不共享暂停状态，重叠节点仍互斥。项目 session 仍是整份 JSON，但 v5 journal 已提供顶层字段 clock、writer checkpoint、30 天保留策略及 delete/restore compact barrier，并由真实双 Renderer 专项覆盖关键竞态。它仍不是递归字段或远程多人 CRDT；同字段按 Main 提交顺序决胜，保护范围只覆盖同一 Electron Main 进程。
- steer 已支持显式 TaskScope update：SOURCE 与 REFERENCE 都可保留/替换/追加/清空；主窗口和独立窗口提供可见模式且每次使用后回到自动，CLI 既支持 `taskScopeMode` 简写也支持独立 `sourceMode`/`referenceMode`。替换 SOURCE 会同步重算节点锁；上游 transport 若未及时响应 `AbortSignal`，已经接受的模型或图片请求仍可能计费。
- Goal 已使用 Main 进程唯一 admission controller：Renderer 间 probe 串行，等待 probe 优先于新 ramp，已通过 Goal 在 wave 边界公平共享冻结容量；限流/5xx/网络 retry 打开全局 ramp hold，保护性失败打开跨 Goal circuit，同项目重复确认被拒绝。reservation 同时等待 scheduler 最终验证与真实 provider Promise；Renderer 退出或 Abort 不会提前释放仍在途的计费槽位。该机制仍只能阻止未来派发，无法取消上游已接受请求或追回费用，真实视觉质量也不能成为确定性自动 gate。Goal v1 仍限制为 edit/replace/variants、每 binding 1 输出和文字 steer；layers、cutout、redraw、额外 REFERENCE 与运行中换范围仍是后续协议工作。逻辑、真实双 Renderer 与可见 AIDEBUG Goal 专项提供分层证据；完整 SUPER GOAL closure 已覆盖对应 owner lane。
- Provider 返回的远程图片 URL 已从 Renderer 直连边界移出：Main 逐跳验证公网 HTTP(S)、固定全部 DNS 结果到禁用连接池的一次性 socket，并核对真实 `remoteAddress`；全局下载准入固定为 2 并发，相同 URL 在途去重。新结果经格式/尺寸/解码验证后落为受管文件，历史项目的已记录 URL 只能经 `naimage-asset:` 兼容读取，CSP 已移除 `img-src https:`。该策略仍依赖操作系统 DNS 给出完整地址集合，正式发布应保留公网 CDN URL 冒烟，但任何私网 fallback 都必须 fail closed。
- `src/styles.css` 是有序入口；`src/styles/07-workbench-flattening.css` 只保持 07a→07i 顺序，`07j-liquid-glass-surfaces.css` 必须紧随其后，`08-motion-accessibility.css` 继续作为最终 reduced-motion gate。`04b-glass-lab.css` 只由懒加载的 `glass-lab.tsx` 导入，不能为了方便移进全局首屏 CSS。任何样式调整都必须同时保持这些级联与 artwork 不透明保护。
- `public/glass-theme-bootstrap.js` 必须在 Vite/React 前独立运行，因此启动期 registry/projection 与 canonical `runtime/glass-theme-presets.json` 存在技术栈镜像；修改主题、材质、范围、强调色或变量时必须同步并运行 `test:glass-theme`。不要把 snapshot 的任意 `variables` 恢复为可信输入。
- `settings-persistence.ts` 直接拥有设置/Storage 导出；新代码不要再从 `core.ts` 查找这些符号。
- `src/server.ts` 是浏览器开发回退，不是正式 Electron 产品能力基线；它仍引用历史 `/naimage/v1` session-relay，不能作为当前原生 New API + SparkAI Extension 合同的完成证据。发布独立 Web 版前需要另行设计不向浏览器 Renderer 暴露账户完整 Key 的服务端凭据桥。
- New API 登录 session 只负责账户、余额、密钥 CRUD、授权和更新管理；账号模式的 Agent、生图与 `/v1/models` 使用所选账户密钥，分组由 token 自身决定，模型 JSON/FormData 不得注入 `group`。模型目录同时保存无凭证的 `supported_endpoint_types` 快照并对错误能力标注保留模型名回退。`/api/user/self/groups` 只用于密钥编辑候选与模型目录查询。设置抽屉按接入、外观、模型、Agent、更新五个分页显示，默认打开接入页。
- Electron 关闭重启时优先使用 `serverSessionCookie + serverUserId` 返回缓存身份，随后后台校验 `/api/user/self` 并异步读取日志；这条快速恢复路径不伪造余额或模型列表。
- Worker 根目录位置受 ASAR 解析约束。
- `public/ui/style-library` 与 `core.ts` 的旧风格库需要先确认真实消费者，再决定删除或隔离；不得恢复为旧复杂风格向导。
- Pro License 与 `/v1/image-tasks` 跨越 `naimage-studio` 与 `sparkai-extension` 两仓，单仓修改不能证明交付完成；账号、计费和更新服务不属于 SparkAI Extension。

## 12. 最近同步记录

| 日期 | 桌面版本 | 同步内容 |
| --- | --- | --- |
| 2026-08-18 | 1.0.9-rc | SparkAI Extension 管理边界更新：仓库根目录改名为 `sparkai-extension`，公共 `/api/naimage/license*` 与 `/v1/image-tasks*` 路径保持不变；新兑换码以 HMAC + AES-256-GCM 密文保存，管理员可重复调用 `GET /api/naimage/license/admin/codes/:id/reveal`，旧 HMAC-only 记录明确不可恢复。License 管理页新增逐码查看/复制，并支持通过 `SPARKAI_EXTENSION_ADMIN_FRAME_ORIGINS` 精确 Origin 白名单受控嵌入；默认 CSP/X-Frame-Options 仍拒绝 iframe。桌面客户端调用合同未改变，扩展专项测试与打包待本轮完成后更新证据。 |
| 2026-08-16 | 1.0.9-rc | 本地整备收口：最终 `release:verify` [report.json](/E:/019创业项目/nimage/naimage-studio/.diagnostics/release/verify-2026-08-15T22-12-37-714Z/report.json) 完成 113/113 项且 `sourceStable:true`，覆盖协议/IPC、项目 Session、迁移/导出、图片性能、UI Surface、更新/回滚和 Bundle 门禁。修复后的 Commerce、Glass、Graph CLI、Skill、图片生成与 Commerce Export UI 套件均使用显式隔离项目 fixture；`project-session-merge.cjs` 保留尚未盖章的 pending mutation，selftest 覆盖图层重组与可见性连续保存。正式 `release:final` 仍因现有安装的零步骤预检阻断，未执行安装/升级/卸载或签名；不调用真实模型、不迁移真实 AppData、不部署 Extension、不清理旧源码。 |
| 2026-08-16 | 1.0.9-rc | 上下文地图 v53 修复 AskUser 门禁的视觉证据误报：窄屏画布左边缘仅剩约 1.757px 的节点 B 无法形成 4×4 像素采样区，现明确记录为 `skippedNodeSlivers`，C/D/E/G/H 仍逐节点采样；如果全部节点都只剩残片，验证器仍以 `no-sampleable-visible-nodes` 失败。AskUser 连续报告 `.diagnostics/electron/aidebug-2026-08-15T20-21-51-512Z/report.json`、`.diagnostics/electron/aidebug-2026-08-15T20-22-42-170Z/report.json` 均为 10 项功能检查和 5 个视觉场景全通过，AIDebug catalog/workpack 与语法检查通过。正式 `release:final` 因本机现有安装在零步骤环境预检退出，未触碰安装环境，incomplete 标记保留；当前只续跑全量门禁并生成强制 Bundle 的本地双版本候选。 |
| 2026-08-16 | 1.0.9-rc | 上下文地图 v52 收口正式门禁暴露的共享焦点竞态：`DialogShell` 正常关闭不再与卸载 cleanup 重复恢复焦点，直接卸载只在焦点仍无有效去向时兜底；Agent 会话历史在捕获阶段独占 `Escape` 并在布局提交后恢复触发按钮。AIDebug 使用显式隔离项目，不再依赖废弃的 AppData 默认项目，同时把运行中 composer 与节点有限入场动画断言对齐当前合同。`test:ui-foundation`、`test:agent-panel-ui`（52）、`typecheck` 和 Agent Text UI 连续两轮 155/155 通过；源码稳定的发布报告此前已通过前 88/113 项，当前只从 `agent text UI` 失败点续跑。未调用真实模型、未迁移真实 AppData、未部署 Extension。 |
| 2026-08-16 | 1.0.9-rc | 上下文地图 v51 冻结本地正式候选边界：大量图片治理、统一导出中心、默认 dry-run 的真实模型验收工具、只读显式来源迁移审计和受影响 UI 测试稳定性已完成。最终 UI Surface `.diagnostics/electron/aidebug-2026-08-15T18-14-40-181Z/report.json` 为 15 scenes / 0 failures；三轮产品性能 `.diagnostics/electron/product-performance-2026-08-15T18-16-46-847Z/report.json` 为 `productPerformanceReady:true`、全部硬检查通过、交互 Long Task 最大值 0，1,661,997 B 完整 runtime bundle 仅保留趋势 advisory。SparkAI Extension 0.2.1 的工作区/源码检查与 6 项 License、管理页、任务测试通过。正式状态仍只由冻结提交后的同一次 `release:final` 报告、两套 x64 EXE 和哈希决定；未调用真实模型、未迁移真实 AppData、未部署 Extension，也不执行 tag、push 或 GitHub Release。 |
| 2026-08-15 | 1.0.9-dev | 上下文地图 v50 登记桌面整备闭环：新增统一导出中心，将图片、图片组与 PSD 交给既有 Main owner 执行，并在项目 `.naimage/export-center.json` 原子保存命名模板、预设、内容指纹和历史；IPC 更新为 147/144/3。真实模型验收工具默认 dry-run 且必须多重显式授权才可联网，迁移审计工具只扫描用户指定来源并拒绝执行/清理。导出中心逻辑/UI、图片组/单图/PSD、迁移 41 cases、两个验收工具、IPC、UI foundation、Workspace Glass、typecheck 均通过；UI Surface 最终为 15 scenes / 0 failures，性能审计 15/15 且最新 10 张 4K 冷缓存报告保持 1.404 s、2 个 Worker、0 图片阶段 Long Task。未调用真实模型、未迁移真实 AppData、未部署 Extension；正式 `release:final` 仍须在文档冻结后执行。 |
| 2026-08-15 | 1.0.9-dev | 上下文地图 v49 完成大量图片冷缓存治理：缩略图服务由每个 miss 新建进程改为最多 2 个常驻 Sharp Worker，以 `requestId` 连续派发，单进程崩溃只拒绝当前任务并在下一请求安全补充；默认缓存由 96 个/96 MiB 扩大到 512 个/512 MiB。画布中大于 1024px 的普通单图固定使用 1024 桶，多图保持 512/1024 自适应，查看器主图继续使用受管原图。`test:thumbnail-cache` 证明顺序复用、同变体并发合并、两进程上限、崩溃恢复和退出清理；性能审计 14 cases 与 typecheck 通过。隔离 `aidebug:performance` 报告 `.diagnostics/electron/aidebug-2026-08-15T11-17-07-790Z/report.json` 为 `ok:true`：10 张 4K 的 11 个变体冷阶段 1.404 s、2 次进程启动/11 次任务/9 次复用，热缓存 27.2 ms，图片阶段 Long Task 0，画布缩略图和查看器原图边界及视觉证据均通过；旧基线为约 4.57 s/11 次一次性进程/83 ms。未调用真实模型。 |
| 2026-08-15 | 1.0.9-dev | 上下文地图 v48 将图片组交付目录固定为项目级 `image-groups/<图片组名>/`，多组选中使用共享 staging、备份与整批回滚发布多个同级目录；旧 `exports/image-groups/` 只保留打开兼容，受管原图不移动。连接头改为只有拖动才建边，真实目标命中替代 180 px 空白吸附；单击、空白松手、Escape 与 pointercancel 均不删关系，连线增加 18 px 命中区、具体边菜单与底层真实 ID，节点菜单保留全部输入/输出断开。成果编辑器最大化同时驱动外层 Dialog Grid，浮窗尺寸钳制改读未受入场 transform 影响的 layout 尺寸。Requirement AIDebug 为 9 scenes / 0 failures；图片集合 AIDebug 为 11 scenes / 0 failures，最大化 `1256×796`，查看器 12 个切图采样无空白帧且延迟解码无旧图回滚。独立 production build 转换 1667 modules；双测试 EXE 已以 `bundleEnforced:false` 生成并独立核验：Unrestricted 175,965,696 B / SHA-256 `2FFC43A1822A484C1DE783D6762538E74618CE6B1B8E0FF455485DDA14133D3B`，SparkAPI 175,969,280 B / SHA-256 `3249EE0BDFCF16DEDF75FA1BFFE5B3976F8BD3C53745B80B2DCB3B3C2477F7A4`。未调用真实模型，未执行正式 Bundle、数字签名或安装 smoke。 |
| 2026-08-15 | 1.0.9-dev | 上下文地图 v47 将外置 Extension 的默认部署固定为现有 New API user-defined Docker network + 容器 DNS/内部端口，移除 `host.docker.internal` 默认；新增宿主机/Docker Caddy 示例、部署专用 `AGENTS.md` 与 `package:extension`。部署包只含 25 个扩展/运维文件，提供 manifest、逐文件/归档 SHA-256、ZIP/TAR.GZ，并通过包内 source check、5 项 loopback 测试、Compose 静态校验和旧 fork/secret 边界检查。Docker daemon 本机未运行，因此没有把静态包校验误写成实际镜像 build 或线上部署。 |
| 2026-08-15 | 1.0.9-dev | 上下文地图 v46 完成外置扩展服务收口：`ai-native` 根入口只运行 Node 24 SparkAI Extension，提供 SQLite/HMAC Pro License、管理员发码 CLI 与内存 Bearer/私网原生 Images 的 `/v1/image-tasks`；旧 New API/CRM/production 树退出活跃入口，等待真实部署、备份和回滚验证后再清理。管理员 CLI 创建/列表/禁用闭环、Extension 5 项 loopback 测试（含限时授权/兑换截止）、Compose 配置、桌面 License 9 cases、任务传输 31 cases、typecheck 与 1667-module production build 通过；未访问生产、真实 License/New API 或图片模型。浏览器开发回退仍属历史 session-relay，不计入当前合同。 |
| 2026-08-15 | 1.0.9-dev | 上下文地图 v45 将服务端边界从定制 New API 改为独立 SparkAI Extension：用户原生 New API 保持可直接升级并继续拥有账号、Token、渠道、quota 与计费；同域仅分流 `/api/naimage/license*`、`/v1/image-tasks*`。扩展服务使用 SQLite/HMAC、管理员独立 Token、单进程内存 Bearer 与私网上游，重启不重放；旧 `ai-native` fork 退出活跃根入口，待部署验证后另行清理。 |
| 2026-08-15 | 1.0.9-dev | 登录与授权合同拆分：账号登录本身允许进入工作区，不再请求设备 License；自定义 Base URL 必须通过官方服务的 `pro` 兑换码，默认 3 台并沿用永久/限时、禁用撤销、24 小时缓存和 72 小时离线宽限。账号模式保留逐模型自定义 API Key，优先于模型/全局账户 Token，但不接受逐模型 Base URL 绕过；Base URL、Key、Cookie 不进入 License 请求。 |
| 2026-08-15 | 1.0.9-dev | 上下文地图 v43 修复用户可见的三项问题：Agent 普通消息恢复原生文本选择与 `Ctrl+C`，不增加逐消息复制按钮；`src/image-content-title.ts` 本地提炼内容摘要并统一生成节点/图片组/资产/槽位标题，不改原始 Prompt、不调用模型；迁移失败定位为 production Terser 把 `confirmed:true` 压成 `confirmed:1`，现由 preload 仅将真正 `true`/数字 `1` 恢复为布尔确认，Main 严格校验保持。内容标题 7 cases、IPC 141/138/3、迁移 41 cases、Agent Panel 52 cases（真实 Selection 与 Ctrl+C）、图片容器/布局/组 mutation/流预览、五类导出/Automation、Workspace Glass、project IO、typecheck、`git diff --check` 和最终 production build（1667 modules、9.00 s）通过。最终 ASAR 同时验证压缩后 `confirmed:1`/`confirmedCleanup:1` 与 preload normalizer；双 Windows x64 测试打包退出 0、`bundleEnforced:false`，Unrestricted 为 175,967,232 bytes / SHA-256 `928A6F73C1F30EA2DCDAFB94EE03B430DEFDCEDF9F9C0001799F1678DD299DD4`，SparkAPI 为 175,967,232 bytes / SHA-256 `380E22389355812DED477013A94B051E238D77B44A8A82C73D44098B446FCF5A`。未调用真实模型，未执行正式 Bundle、签名或安装 smoke，代码未提交。 |
| 2026-08-15 | 1.0.9-dev | 历史 v42 曾把 Cloudflare 图片任务直接加入 New API，使用 Task/SystemTask 与内部 ExecuteRelay；当时的 Go、客户端、OpenAPI、构建和双包测试证据保留用于审计，但该方案已由 v46 的独立 SparkAI Extension 取代，不再是活跃构建或部署入口，也不能证明当前线上联调。 |
| 2026-08-14 | 1.0.9-dev | 上下文地图 v40 完成顶部对话框生图规格绑定收口：补丁后 `typecheck`、`git diff --check` 和独立 production build（1666 modules、7.64 s）通过；`package:win:variants` 通过接入策略专项、安装器资源、两次 production build（7.71 s、7.88 s）与双 Electron/NSIS/品牌封装，`bundleEnforced:false`。PowerShell 独立复核：Unrestricted 为 175,960,576 bytes、2026-08-14 17:08:56 +08:00、SHA-256 `FEAF4D033C6E2B0BDD57B2EB0A9FE65311D3E9C6FF642039B950662B3215FC2A`；SparkAPI 为 175,964,160 bytes、2026-08-14 17:10:06 +08:00、SHA-256 `17CE9B3AB71CE3E9C3A2ECF903B0D2C23FABDE7863D92C0C70B46408CA260130`。公开目录无当前版本旧命名；未调用真实模型，未执行正式 Release/签名/真实安装卸载，代码未提交。 |
| 2026-08-14 | 1.0.9-dev | 上下文地图 v39 补齐同一生图任务的 AskUser continuation：`PendingAgentExecution v2` 可保存合法 `imageRatio/imageResolution`，Session 清洗、重启恢复和继续派发保持首轮按钮值，运行锁仍只在 IPC 派发时重建。`test:project-io`、`test:image-frame-contract`、`test:workspace-glass-ui`（155）、`typecheck` 与语法检查通过；隔离 `aidebug:ask-user` 的 10 项功能 checks 全 true，`frameContractSurvivesContinuation:true`，composer/pending/resumed 均为 `1:1 / 1K`，提示词中的 `3:4` 未覆盖按钮值。完整 AIDebug 仍因既有概览节点 B 仅约 2 px 可见触发 `visual-area-too-small` 而退出 1，未记为整套通过。双版本 EXE 仍待沙箱外打包授权，未调用真实模型，代码未提交。 |
| 2026-08-14 | 1.0.9-dev | 上下文地图 v38 登记顶部 Agent 生图规格绑定：`agent:chat` 派发时冻结 Renderer `imageDefaults`，公开 Schema 只允许按钮比例/清晰度，runtime 对顶层与 `items[*]` 冲突值二次覆盖，并让普通、批量、Goal、分层和区域操作的真实上游 Prompt 明确画幅、清晰度、最终像素与禁止拉伸；成果仍保留原始可编辑 Prompt。`test:image-frame-contract`、`test:agent-run-control`、`test:goal-runtime`（43）、`test:agent-text`、`test:custom-api-transport`（24）、`test:image-generation-metadata`（13）、`test:ipc-registration`（141/138/3）、`test:image-stream-preview`（30）、`typecheck`、语法/差异/Harness 检查和 production build（1666 modules、7.75 s）通过。未调用真实模型。双版本打包先通过接入策略专项，后因沙箱复制安装器图标 `EPERM` 中断；沙箱外审批服务过载，命令未执行，本轮 EXE 尚未重建或核对哈希，代码未提交。 |
| 2026-08-14 | 1.0.9-dev | 上下文地图 v37 登记逐图生成参数链路：`runtime/image-generation-metadata.cjs` 白名单请求/响应/时间字段，New API Images/Responses 每个最终图独立 `actualParams`，Main/Agent 落盘 `ImageAsset.generation v1`，Session 顶层/分层资产统一清洗；Renderer 从受管成图计算真实比例、像素和文件格式，并在成果编辑器区分请求、响应、成图与本次运行，本地导入不继承伪请求。`test:image-generation-metadata`（13）、`test:custom-api-transport`（24）、`test:workspace-glass-ui`（155）、`test:image-stream-preview`（30）、`test:ipc-registration`（141/138/3）、`typecheck` 和 production build（1666 modules、8.77 s）通过。1280/884 参数面板目标证据通过；完整 AIDebug 仍因既有首图 `canvas-image-commit-order` / `visibility-timeout` 退出 1，未记为整套通过。双版本测试打包退出 0、`bundleEnforced:false`：Unrestricted 175,959,552 bytes / 2026-08-14 16:00:26 +08:00 / SHA-256 `528CF5EB71F625A069574EB2F903B45EE0A32C132A82F2732DBA620B844DB404`；SparkAPI 175,963,136 bytes / 2026-08-14 16:01:29 +08:00 / SHA-256 `67222A0BCFCF91FC52068C359CC27B15EA42B88C9D5AA7DB0E310CE21B9C414D`。未调用真实模型、正式 Bundle、签名或安装 smoke，未提交代码。 |
| 2026-08-14 | 1.0.9-dev | 上下文地图 v36 完成显式项目根、旧 AppData 数据迁移与导出收口：新安装无默认/全局 Session 写入；旧项目/全局 Session 及项目 FastMemory/conversation 通过用户选择目录、目标空间预检、staging、逐文件 SHA-256、原子发布、索引回滚和二次确认清理迁移，安装目录明确拒绝。普通图片/PSD/图层/图片组分别受限于项目 `exports/images|psd|layers|image-groups`，图片组增加五格式统计预检和内容漂移令牌。IPC 为 141/138/3，迁移 41 cases、项目根 19、保存协调 21、Workspace Glass 149 及相关图片/模型/Automation 专项通过；真实隔离图片组报告 `.diagnostics/electron/aidebug-2026-08-14T03-54-29-294Z/report.json` 为 9 scenes / 0 failures，隔离写入报告 `.diagnostics/electron/aidebug-isolation-gui-2026-08-14T03-59-42-933Z/report.json` 证明临时项目写入且仓库配置不变。最终 `typecheck` 与独立 production build 退出 0（1665 modules、12.29 s），`package:win:variants` 退出 0并完成两次 production build、两个 Electron/NSIS 变体与品牌封装，`bundleEnforced: false`。PowerShell 独立复核 Unrestricted 为 175,955,456 bytes / 2026-08-14 12:26:52 +08:00 / SHA-256 `063039857E54C5ABFBEC677C25F74F9551A11906A860E20C4884C8E8BFCD8CE0`，SparkAPI 为 175,955,456 bytes / 2026-08-14 12:28:01 +08:00 / SHA-256 `C2AFEC28A55B9C9AE4763D5697E96F363700B1E03C2E77670FF860B766CBBEF0`；公开旧命名不存在。未调用真实模型、正式 Bundle、签名验证或真实安装/卸载 smoke，未提交代码。 |
| 2026-08-12 | 1.0.9-dev | 上下文地图 v35 完成重复资产修复的最终构建与测试制品核验：独立 production build 退出 0（1665 modules、7.08 s），文档收口后的最终复跑同样退出 0（1665 modules、6.99 s）；`package:win:variants` 退出 0并完成两次 production build 与两个 Electron/NSIS 变体，`bundleEnforced: false`。PowerShell 独立复核 Unrestricted 为 175,943,680 bytes / 2026-08-12 16:09:44 +08:00 / SHA-256 `7012D3F6A3D9C339824724DA25E7CE9065399711FE1BB9D76229CFB11906896E`，SparkAPI 为 175,943,680 bytes / 2026-08-12 16:11:00 +08:00 / SHA-256 `6B1926F1CE82CC8A50DEFCF3C55C1AF7DF13D9C17D9E146302616347907006C0`。未调用真实模型，未执行正式 Bundle、数字签名或真实安装/卸载 smoke，未提交代码。 |
| 2026-08-12 | 1.0.9-dev | 上下文地图 v34 修复重复生成资产持久化：`project-session-merge.cjs` 不再让变化的 occurrence 覆盖同一生成 run/受管 locator 的幂等身份，并稳定保留首次 occurrence/asset/display code；`project-session-normalizer.cjs` 在加载历史 Session 时收敛同一生成文件，重建 `outputs`、collection、progress 与 bindings，显式排除完整导入身份和旧 `import-*` run。真实项目只读验证将 C 的 42 条收敛为 1，D 的 26 条收敛为 1 且保留 1 成功/1 失败槽位，源文件内容/mtime 未变。Session 87 cases、保存协调、双 Renderer、node journal、project IO、图片容器/布局/collection mutation、AIDebug 隔离与 typecheck 均通过；隔离报告 `.diagnostics/electron/aidebug-isolation-2026-08-12T07-45-04-110Z/report.json` 证明测试仍只写临时数据。本轮未直接清理真实项目、未调用模型或打包。 |
| 2026-08-11 | 1.0.9-dev | 阶段 13 补缺与性能审计：空白画布右键菜单补齐 `openCurrentProjectFolder` 的真实 Main IPC 入口；`test:workspace-glass-ui` 142 cases、图片组/导出/PSD/查看器相关专项与 `typecheck` 通过。隔离性能 fixture 记录冷缩略图 10 张 4K 的 11 个 256/512 变体约 4.57 s、11 次一次性 worker 启动、Renderer Long Task 0、热缓存约 83 ms；结合默认 96 变体上限及单张成果原图直显，确认当前瓶颈主要在 Main 冷生成队列/缓存淘汰与 Chromium 原图解码，而非同步 React 计算。`aidebug:menus` 的空白画布 1280/884 场景均确认新入口可见、可用且可键盘聚焦；整套仍因两个既有最小窗口选中框视觉证据断言退出 1，报告为 `.diagnostics/electron/aidebug-2026-08-11T10-09-19-541Z/report.json`。未在本轮擅自改动 worker/cache 策略。最终 `build` 与 `package:win:variants` 退出 0；Unrestricted 175,941,120 bytes / SHA-256 `753F135BE1EB8756CF3C584CAF6E0BE67016A9E140E9ACDB0A022B1EA41B1BB6`，SparkAPI 175,942,144 bytes / SHA-256 `559A71F0E14AA53B6949D55AA98E78C08926608266B6D89B0C12F1BF4DB5A083`；公开旧命名不存在。 |
| 2026-08-11 | 1.0.9-dev | 上下文地图 v33 完成阶段 13 收尾：图片组 mutation/export、普通图片与 PSD 解耦、查看器 identity/token 与 decode 后换帧已由当前专项验证（mutation 4、stream 30、Glass UI 142、IPC 137/134/3、automation、Agent 文本、typecheck）覆盖。真实隔离 `aidebug:image-collection` 报告 `.diagnostics/electron/aidebug-2026-08-11T06-06-17-278Z/summary.md` 为 `ok: true` / 9 scenes / 0 failures；真实 `aidebug:glass-workspace` 报告 `.diagnostics/electron/glass-workspace-2026-08-11T06-08-40-560Z/report.json` 为 `ok: true` / 29 checks / 35 screenshots / 0 console errors，最小窗口 884×640、真实重启通过、无生图网络。最终 `build` 与 `package:win:variants` 退出 0，打包 `bundleEnforced: false`；独立 PowerShell 核验两个公开测试包：Unrestricted 175,941,120 bytes / 2026-08-11 14:26:01 +08:00 / SHA-256 `7B6F89DF94FCD88F1482F3BE850783D4AC49492018B342DD3549F12D890FEA09`，SparkAPI 175,942,144 bytes / 2026-08-11 14:27:05 +08:00 / SHA-256 `FB8D30FC76B0CCB6596BD1A15FBF617711E5732949D2F5954E7EF1F17ED1F933`；当前版本旧命名不存在。未执行正式 Bundle/发布验收、数字签名或真实安装/卸载 smoke，未调用真实模型，未提交代码。 |
| 2026-08-06 | 1.0.9-dev | 上下文地图 v31 完成测试项目隔离：显式 `--user-data-dir` 在开发态默认将 config 放到 `<user-data>/data`；AIDebug 要求 config 位于显式隔离根内，并对仓库 `config/`、真实 AppData 或根外目录 fail closed。Main 仅在校验通过后通过 `additionalArguments` 向 preload 投影只读 `naimageRuntime.aidebugEnabled/isolatedConfig`，Renderer 必须同时满足编译期与运行时双门禁才安装可写 AIDebug 控制面。`test:aidebug-options`、`test:aidebug-isolation`、`typecheck`、真实 `aidebug:isolation` 与 production `build` 通过；Main 报告 `.diagnostics/electron/aidebug-isolation-2026-08-06T10-13-44-879Z/report.json` 和 GUI 报告 `.diagnostics/electron/aidebug-isolation-gui-2026-08-06T10-24-52-327Z/report.json` 均证明仓库 config 未变化，后者完成真实容器创建、移动、自动保存和截图。以 `bundleEnforced: false` 重新生成 `SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`（175,926,272 B，SHA-256 `9DCE84E46286910653201C7CF320D8C77D47578C097891962A770F466FBBE142`）和 `SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe`（175,926,272 B，SHA-256 `19603331D15F92A59BBF4121A80DD36F39FB7C771BFB3FDB737AE1CB507CBF3F`）；当前版本旧公开命名不存在。未自动删除无法可靠归因的现有画布图片，未调用真实模型，也未执行正式 Bundle/发布验收、数字签名验证或真实安装/卸载 smoke。 |
| 2026-08-06 | 1.0.9-dev | 上下文地图 v30 优化密集画布缩放：wheel 输入通过 `requestAnimationFrame` 合并为每帧最多一次 stage transform，提交前刷新待处理帧；图片 tile 达到 10 个时，缩放/平移期间暂时停绘图片、视频、关系线和高成本阴影，结束后恢复；低于 0.3 缩放时可用保留选择/拖动能力的轻量节点轮廓。AIDebug `.diagnostics/electron/aidebug-2026-08-06T09-33-39-213Z/report.json` 为 `ok: true` / `failures: []`，`denseViewportZoom` 记录 80 次 wheel、10 次 stage 写入、帧 P95 5.7 ms、交互阶段 0 Long Task；三轮 production-like `.diagnostics/electron/product-performance-2026-08-06T09-34-48-686Z/report.json` 为 `productPerformanceReady: true`、zoom frame P95 33.1 ms、交互 Long Task 最大值 0，全部 checks 通过。production build 与 `package:win:variants` 成功；新制品为 `SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`（175,925,760 B，SHA-256 `5BF115661A57B59BF12D296E49D65611BED7CDFF58C4E24065D3A64CB8A4CCA3`）和 `SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe`（175,926,272 B，SHA-256 `0B0AD87F924EEA5F1241A3A056E6E0F848D4873D9D7532E53DEC04FFD3EDD5D3`）；当前版本旧公开命名不存在。安装器 UI smoke `.diagnostics/release/branded-installer-ui-2026-08-06T09-49-00-249Z/report.json` 为 `ok: true` / 19 captures，完成页出现后约 241.3 ms 自动关闭。未调用真实模型、未执行正式 Bundle/发布验收、数字签名验证或真实安装/卸载 smoke。 |
| 2026-08-06 | 1.0.9-dev | 上下文地图 v29 修复密集画布中图片容器松手后短暂无响应：根因是容器移动后露出下层可拖图片块，Chromium 发起原生 `dragstart` 并以 `pointercancel` 中断当前节点拖动。`beginInternalAssetDrag` 在 `dragRef` 已持有节点拖动时取消该原生资产拖动，同时保留无节点拖动时的正常图片提取/归组。AIDebug CLI 自检确认 7 个受限 `debug.*` 命令、脱敏和生产拒绝合同；生产安全 `canvas.state` 从当前项目读取到 17 节点、16 图片节点及 6/11 图容器。真实 `aidebug:image-collection` 报告 `.diagnostics/electron/aidebug-2026-08-06T08-19-03-782Z/canvas-image-collection-suite.json` 中完整 layout mutation 与新增 `immediateContainerRedrag` 均通过：第二次按下/移动立即进入并保持拖动、合并位移提交、原生 drag 无接管、0 `pointercancel`、0 阻塞动画；完整集合套件仍只被既有 `canvas-mixed-prompts-batch` 与 `collection-member-editor-preserves-asset-index` 两项无关失败阻断。`typecheck`、Workspace Glass 142 cases、图片容器 12 cases、图片布局 14 cases 与 production `vite build` 通过。以 `bundleEnforced: false` 重新生成 `SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`（175,925,760 B，SHA-256 `DC7FBD25661CA22E98022A7306FE238BCBD1CCF8809164E6453E2438BE4FDC71`）和 `SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe`（175,925,760 B，SHA-256 `2E8A5F260F86966F734F24EBC015F39EC8A2D6F77F9DA68ACB6E2F0BD2A89BCB`）；安装器 UI smoke `.diagnostics/release/branded-installer-ui-2026-08-06T08-27-07-298Z/report.json` 为 19 captures / 0 failures，完成页出现后约 249 ms 自动关闭。未调用真实模型、未执行正式 Bundle/发布验收、数字签名验证或真实安装/卸载 smoke。 |
| 2026-08-06 | 1.0.9-dev | 上下文地图 v28 清理 Windows 发行旧命名链路：`runtime/access-variant.cjs` 统一拥有 Unrestricted、SparkAPI、内部 Core 与历史清理文件名；双版本脚本不再重命名或自行拼接旧 Setup，品牌壳编译输出改为 `SparkAI WorkSpace Installer/Uninstaller`。`ai-native` 下载清单与生产校验器从 1.0.9 起只接受 `SparkAI-WorkSpace-Unrestricted-Setup-*`，同时保留 1.0.8 及以前已签名 `naimage-Setup-*` 历史兼容；manifest schema、`naimage-studio` product、Restart ASAR 和下载端点不变。Node 语法、`test:access-variant`、`test:update`、`test:release-orchestrator`、New API controller/model Desktop Go 测试、Shell 语法与差异检查通过。以 `bundleEnforced: false` 重新生成两套 1.0.9 测试 EXE：Unrestricted 175,925,760 B / SHA-256 `A1FC5C406578E4E3382E1167DAFD692248DB56D8458316495EEF1E0014C774F0`，SparkAPI 175,925,760 B / SHA-256 `752FB26D8C7BF66AB4B9010F2BDA3AC4F29616F99C39615117126C2A9F131621`；错误的当前版本 `release/naimage-Setup-1.0.9-x64.exe` 与公开 Core/blockmap 已删除。安装器 UI smoke 报告 `.diagnostics/release/branded-installer-ui-2026-08-06T02-45-56-426Z/report.json` 为 19 captures / 0 failures，完成页显示后约 443.1 ms 自动关闭。未执行正式 Bundle/发布验收、Windows 数字签名或真实安装/卸载。 |
| 2026-08-05 | 1.0.9-dev | 上下文地图 v27 修复图片容器拖动松手时的视觉跳动：普通节点在拖动开始即稳定选中外观，不再到 `pointerup` 才切换边框与阴影；手动移动、重排或取出容器图片的 `commitImageLayout` 提交明确关闭 `active-build` 反馈，图片容器与图片组移除会在布局主体切换时重播的 `image-layout-settle` 透明度/滤镜动画。Glass 静态专项 142 cases、`typecheck` 与生产 `vite build` 通过；真实 Glass GUI 报告 `.diagnostics/electron/glass-workspace-2026-08-05T09-04-46-134Z/report.json` 为 29 checks / 35 screenshots / 0 应用级 console error / 0 failures，在动画开启且容器未预选的条件下测得按下与松手位移均为 0、松手前即完成选中、前后 opacity=1/filter=none/animation=none 且运行中动画为 0。图片容器布局拖放回归中的 `zOrderHostTransfer` 与新增 `directManipulationSettled` 通过；完整 `aidebug:image-collection` 仍被既有的 mixed-prompts/member-editor 映射失败及其后续提取步骤阻断。随后重新生成 `dual-access` Windows x64 本地测试安装包 `release/naimage-Setup-1.0.9-x64.exe`（175,925,760 B / 167.78 MiB，SHA-256 `91D72860279321ADD74526383EC1BB78BE846C4C9915C2918E2CD803C10DB032`），安装器资源、Electron/NSIS、品牌卸载器与品牌安装器编译均成功；该包未做数字签名、正式 Bundle/发布验收或真实安装 smoke。该错误公开命名制品已在 v28 中废止并删除，本行只保留历史审计。未调用真实模型或运行全量测试。 |
| 2026-08-05 | 1.0.9-dev | 上下文地图 v26 调整品牌安装器完成态：真实交互安装仅在内核成功、文件校验完成且可选应用启动已交接后显示完成反馈，并在约 800 ms 后自动关闭引导窗口；错误页保留重试/日志，取消路径保持回滚语义，`--capture-page=complete` 继续稳定取证。新增 `--completion-auto-close-probe` 并接入 `package:installer-ui-smoke`；安装器 C# Release 编译为 0 warning / 0 error，UI smoke 报告 `.diagnostics/release/branded-installer-ui-2026-08-05T08-31-34-961Z/report.json` 为 19 captures / 0 failures，精确探针记录完成态出现、窗口关闭且完成态后耗时约 400.2 ms；生产 `vite build` 通过。未执行真实安装/卸载、NSIS 打包、全量测试或模型请求。 |
| 2026-08-05 | 1.0.9-dev | 上下文地图 v25 修复画布关系线与拖动连续性：`workflowNodeRenderMetrics()` 统一拥有节点 JSX 与关系线端点使用的实际渲染尺寸，包含无持久化宽高的多图容器自适应尺寸；正式边和连线草稿因此锚定可见节点左右边框中点，端口 lane 只作用于曲线控制点。hover/selected 及后置 repair 样式不再拥有或过渡节点 transform，普通节点按下、拖动、松手保持同一坐标基线。`typecheck`、Glass AIDebug 静态专项、Workspace Glass UI 142 cases 与生产 `vite build` 通过；真实 `aidebug:glass-workspace` 报告 `.diagnostics/electron/glass-workspace-2026-08-05T07-45-13-883Z/report.json` 为 29 checks / 35 screenshots / 0 应用级 console error / 0 failures，标准拖动 pointerdown/release shift 均为 0；新增两个未保存宽高、实际自适应宽度约 361 px 的四图容器场景，路径起点到源节点右边框误差约 0.00029 px、终点到目标节点左边框误差约 0.00030 px。分层 Bundle 检查无 AIDebug 泄漏且 plugin JS 79,780 B 在限额内，但当前工作区 initial JS 812,353 B 与 CSS 385,528 B 超过硬门禁，core async/core JS/完整 dist 也保留 advisory 超限；未调用真实模型、未运行全量测试或打包。 |
| 2026-08-05 | 1.0.9-dev | 上下文地图 v24 完成阶段 10：partial 按 `operationId + requestIndex` 同槽替换且不持久化，最终图在下一动画帧清理临时预览；查看器只读取最终受管资产，采用上方大图与下方单行横向缩略条；普通图片/容器拖动改为 CSS 合成层位移预览，布局 settle 动画不再拥有 transform，reduced-motion 也不延迟首帧；共享关键字号与项目搜索 near-opaque 菜单同步提高可读性。`test:workspace-glass-ui`（142）、`test:image-stream-preview`（23）、`test:custom-api-transport`（18）、`test:image-batch-scheduler`、`test:goal-runtime`（43）、`test:commerce-catalog`、`typecheck` 和 Glass AIDebug 静态专项通过。真实 Glass GUI 报告 `.diagnostics/electron/glass-workspace-2026-08-05T05-45-00-365Z/report.json` 为 28 checks / 34 screenshots / 0 应用级 console error / 0 生图网络；无付费 partial 报告 `.diagnostics/electron/aidebug-2026-08-05T05-51-40-277Z/agent-image-suite.json` 观察到三个图片任务的 `1/3 → 2/3 → 3/3`、单槽替换与终态清零。随后以 `bundleEnforced: false` 成功生成无限制版与 SparkAPI 账号专用版两个 Windows x64 测试安装包；未调用真实模型、全量测试或 Bundle 门禁。 |
| 2026-08-04 | 1.0.9-dev | Glass 真实 GUI 回归与制品冒烟：`aidebug:glass-workspace` 覆盖七套主题（含 `light-silver`）与冷重启，25 checks / 32 screenshots / 0 console errors / 0 failures，报告 `.diagnostics/electron/glass-workspace-2026-08-04T10-42-17-938Z/report.json`；隔离无网络 `package:smoke` 验证 SparkAPI unpacked 启动、桥接、项目 IO、图片保存/回读、导入、PSD 和本地处理，报告 `.diagnostics/release/packaged-smoke-2026-08-04T10-40-27-747Z/report.json`。 |
| 2026-08-04 | 1.0.9-dev | 上下文地图 v23：普通并发生图改为在配置上限内 direct 同批派发，并在每张完成时用同一 operation 增量更新单个图片组，最终按实际完成顺序展示；Goal 每个母图聚为一个图片组，条目保留槽位/语言/SKU/幂等 provenance。内置 Glass 扩为七套，新增“雾银玻璃”，新装默认“蜜橘融光”；默认模型统一为 `gpt-5.6-terra` 与 `gpt-image-2`。Agent 逆序完成夹具、流预览、Commerce 归档、模型目录、Agent 模型菜单、主题、设置和 Glass 合同专项通过；双测试开发 EXE 已以 `bundleEnforced: false` 重新生成，当前未做 Windows 代码签名；SparkAPI unpacked 应用通过隔离无网络 `package:smoke`，报告为 `.diagnostics/release/packaged-smoke-2026-08-04T10-40-27-747Z/report.json`。未调用真实模型、全量测试或 Bundle 门禁。 |
| 2026-08-04 | 1.0.9-dev | 上下文地图 v22：图片 partial 在画布目标容器内按 `operationId + requestIndex` 同槽实时替换，终态清理且不持久化；AIDebug 增加 1–3 张无付费分阶段 mock 与真实 DOM 指纹采样。工具设置将兼容字段解释为纯视觉隐藏，`availablePluginToolbarItems` 继续驱动快捷键与显式命令，`activePluginToolbarItems` 只驱动底部 Dock/领域菜单。`typecheck`、插件 115 cases、流预览 23 cases 通过；Commerce Electron mock 为 29 checks / 27 screenshots / 0 failures / 0 network。图片 partial 证明通过，最终双帧截图仍有既有自动聚焦几何变化；未调用真实模型、全量测试或 Bundle 门禁。 |
| 2026-08-04 | 1.0.9-dev | 上下文地图 v21 完成阶段 9：`workspacePluginDefaultsVersion=1` 在 Renderer/Electron 两侧对旧设置执行一次性迁移，默认安装并启用电商、社媒、科研三个第一方组件，同时保留迁移前明确停用和迁移后卸载为空的用户选择；`884 x 640` 顶部入口继续显示当前工作台文字。`typecheck`、设置（118）、插件（115）、领域（47）与接入策略专项通过；真实 `aidebug:workspace-domain` 报告为 `.diagnostics/electron/glass-workspace-2026-08-04T07-36-40-071Z/report.json`，5 张截图、0 Renderer 错误、0 模型请求，电商/社媒/科研分别显示 6/5/6 项工具并保持同一画布、选择与 Agent 状态。双测试开发 EXE 已按默认跳过 Bundle 的策略重新生成；未运行全量测试或真实模型。 |
| 2026-08-04 | 1.0.9-dev | 阶段 8 冻结后执行双发行构建：`test:access-variant` 和两种 Vite production build 通过；最新 Bundle 为 initial JS 809,555 B、CSS 375,338 B，仍超过既有硬门禁，阈值未修改。按测试开发交付范围继续生成并分别保存 `SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe` 与 `SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe`，两者是可安装测试包而非正式 Release 候选；未运行全量测试或真实模型。 |
| 2026-08-04 | 1.0.9-dev | 上下文地图 v20 完成阶段 8：`project-agent-composer.tsx` 将模型、素材、普通/Goal、比例和清晰度收束为紧凑玻璃工具栏，原图/参考图进入素材菜单，普通/Goal 使用单触发器双瓣扇形，比例/清晰度使用最小 160 px 的自定义玻璃 listbox；新增共享 `UnsavedChangesDialog`，让 Prompt/FastMemory、SKU、模型、参考图、Requirement、成果、科研/社媒计划和设置等有保存语义表面在首次关闭时提供继续编辑、放弃或保存并关闭。`typecheck`、设置懒加载、UI foundation、Commerce catalog UI 与 Agent panel UI 专项通过；Agent text UI 的本轮关闭路径通过，两个无关旧断言保留为非本阶段边界。未调用真实模型或运行全量测试。 |
| 2026-08-04 | 1.0.9-dev | 上下文地图 v19 新增构建期双发行接入：`dual-access` 保留账号与自定义 API，`sparkapi-account` 固定官方 SparkAPI、Main 强制账号设置并拒绝自定义 IPC；Vite 将同源策略写入 Renderer 与产物清单，新增两个单独构建入口及双 EXE 编排入口。策略自测、135/132/3 IPC 合同、类型、两种 Vite build 和两次登录 GUI 专项通过；现有 Bundle 门禁仍因 initial JS 808,208 B 与 CSS 370,223 B 超限而失败，未修改门禁或执行 NSIS。当前实现不代表兑换码会话和服务端 Gateway 已完成。 |
| 2026-08-03 | 1.0.9-dev | 上下文地图 v18 将全部用户可见产品名称统一为精确拼写 `SparkAI WorkSpace`，覆盖窗口、启动/认证、帮助与政策、安装/卸载 UI、Windows 产品元数据、快捷方式和随软件分发的 Agent 文案；显式固定旧 `naimage` 用户数据目录与内部 User-Agent，保留 `naimage.exe`、App ID、CLI 和协议作为升级兼容标识。安装器品牌资源、旧名称残留、JSON/Node 语法、Automation 文档一致性、`typecheck`、`test:agent-window`、`test:project-io` 和安装/卸载器 C# 编译均通过；未运行全量测试、Bundle、GUI、安装包或真实模型。 |
| 2026-08-03 | 1.0.9-dev | 上下文地图 v17 完成 SparkAI WorkSpace 阶段 6：共享 command schema 新增 7 个 `debug.*` Main service command，`desktop/debug-command-service.cjs` 提供开发/AIDebug 有界脱敏状态/日志、固定诊断目录截图、IPC/命令检查和无 shell 测试白名单，生产默认拒绝；`naimage-mcp.mjs` 将同一 76 命令注册表包装为 MCP stdio tools 并只转发 authenticated loopback bridge，不复制业务。CLI Skill/命令参考与 package 测试入口已同步；`test:automation-debug`、`test:mcp-wrapper`、schema generation check 通过，未运行全量 Automation、IPC、GUI、Bundle、安装器或真实模型。 |
| 2026-08-03 | 1.0.9-dev | 上下文地图 v16 登记 SparkAI WorkSpace 阶段 4–5 完成：科研工作台现已包含受管数据、结构化 Requirement、安全 Python/R Runner、Panel/组合图、投稿格式导出、7 个共享命令与 research 工具投影；帮助中心新增状态驱动的跨境套图 AI 陪练、项目级便利进度、费用授权边界、真实 Commerce 成果检测和成功奖励。IPC 合同为 135/132/3，`test:workspace-glass-ui` 为 130 cases。科研 GUI 报告为 `.diagnostics/electron/glass-workspace-2026-08-03T09-53-46-537Z/report.json`，AI 陪练 GUI 报告为 `.diagnostics/electron/glass-workspace-2026-08-03T10-13-20-954Z/report.json`；各 3 张截图、0 Renderer 错误、0 模型/Provider 请求，科研 GUI 也未执行 Runner。R Runner、真实付费生图教学完成分支与 Seedance 仍未真实验证；未运行全量测试、Bundle 门禁或发布验收。 |
| 2026-08-03 | 1.0.9-dev | 上下文地图 v15 登记 SparkAI WorkSpace 阶段 3：`sparkai.social-content`、小红书/抖音结构化计划、Requirement/provenance 原子回写、现有视频 journal 社媒身份、原生发布包和七个 `social.*` 共享命令；同时明确图片容器、成果/Requirement/科研 Panel 使用透明玻璃外壳，实际 artwork 保持不透明无滤镜。`typecheck`、社媒计划/导出、领域、插件、视频、automation 与 128/125/3 IPC 专项通过；`aidebug:social-content` 报告为 `.diagnostics/electron/glass-workspace-2026-08-03T07-45-12-422Z/report.json`，3 张截图、0 Renderer console error、0 模型/生成请求。Seedance 未真实付费验证；未运行全量测试。 |
| 2026-08-03 | 1.0.9-dev | 上下文地图 v14 登记 SparkAI WorkSpace 阶段 1：共享四领域注册表、顶部紧凑切换与 Ctrl/Cmd+1–4、新项目四入口、Session/Agent/独立窗持久化镜像、领域插件投影及 `workspace.domain.list/get/set`。automation schema 已重新生成并同步 CLI Skill；`typecheck`、领域/插件/独立窗/automation 专项和单一 Electron `aidebug:workspace-domain` 全部通过，GUI 报告为 `.diagnostics/electron/glass-workspace-2026-08-03T03-55-43-282Z/report.json`，0 console error、0 模型请求；未运行全量测试。 |
| 2026-08-03 | 1.0.9 | 上下文地图 v13 补齐图片输出规格：`runtime/image-frame.cjs` 统一十种比例、1K/2K/4K、旧规格迁移、Image 2 安全交付尺寸与 request/delivery size 区分；设置、主 Agent、手动生图、自动化 schema/CLI 均复用同一合同。最新 Windows 安装包已按常规构建、资源生成和 NSIS 打包生成；未为本次文档同步追加全量测试。 |
| 2026-08-01 | 1.0.9-dev | 上下文地图 v12 登记待验证视频生成链路：独立 adapter/service/IPC、`canvas.generate-video`、POST 零重试与 `create-unknown`、项目相对 journal、凭证指纹、重启只恢复 GET、content→安全结果 URL 下载回退和受管 `output/video/generated`；Renderer/CLI 不接收上游签名结果 URL。模型缓存按自定义 Key 单向指纹隔离；模板同名覆盖/另存策略与当前 126/123/3 IPC 合同同步。未运行测试、构建或真实 Seedance 请求。 |
| 2026-08-01 | 1.0.9-dev | 补齐模板保存可发现性：套图模板市场提供“新建→保存到模板市场”步骤，需求/Skill 可从左侧模板页或节点右键保存。NewAPI `/v1/models` 的 `supported_endpoint_types` 已进入 Main 进程分类与磁盘缓存，同时保留 Seedance 等名称回退；新增官方源码与 qiuqiutoken 实例差异说明，未发起任何计费生成。 |
| 2026-08-01 | 1.0.9-dev | 新增第一阶段视频成果节点：本地 MP4/WebM/MOV/M4V 经格式头和大小校验后流式复制到项目 `output/video`，画布独立播放并保存尺寸/时长，session 只保留相对路径且重启恢复 `naimage-asset:`；共享 CLI 增加 `canvas.import-video`。模型目录新增 Video 分类并以 `doubao-seedance-2-0-260128` 为默认候选，但未伪造视频生成协议；图片 Base64 项目包对视频显式拒绝。IPC 当前为 121 注册 / 118 preload / 3 internal。只运行相关专项，不做全量测试或 Bundle。 |
| 2026-08-01 | 1.0.9-dev | 新手与上架体验、模型接入和性能收口：安装/卸载引导改灰白透明玻璃；每模型独立 Base URL/API Key、Images SSE 优先级、可清空数字输入、Focus 多选投影与缩略图保留式 GC；普通 steer 只暴露三种范围选择；设置关闭增加保存选择；新增帮助、隐私、协议、费用与关于页并标明制作者 `namean`。专项按改动范围执行，不运行全量测试或 Bundle 门禁。 |
| 2026-07-31 | 1.0.8-dev | 完成本轮目标专项收口：模型触发器与默认按钮统一使用 `ButtonBase`，真实 Agent 面板覆盖上游模型搜索、多选恢复、默认切换及紧凑玻璃引用图，共 50 cases；`.diagnostics/electron/aidebug-2026-07-31T15-54-14-505Z/report.json` 覆盖 8 个右键菜单宽/窄场景并为 0 failures。 |
| 2026-07-31 | 1.0.8-dev | 画布工具快捷键支持本机逐项自定义：manifest 保留默认值，`canvasToolShortcuts` 仅持久化覆盖；Renderer/Electron 镜像清洗组合和全工具冲突，设置页冲突不改原值并可单项恢复，实际分派、hover 文案与 ARIA 同步使用覆盖值。最新 `aidebug:commerce-set` 为 29 checks / 27 screenshots / 0 failures，覆盖模板市场、A/B、冲突提示、旧组合失效和新组合生效。 |
| 2026-07-31 | 1.0.8-dev | 完成多语言翻译矩阵：图片×语言单元格、逐项 Prompt、`translationItems` 与 `planMaterialHash` 防篡改、逐项运行时派发、Catalog candidate/approved/rejected 复核和共享 CLI 契约；Commerce 点击一次直接授权派发，Requirement 重跑仍保留 Goal 确认。真实 Electron 证据覆盖标准/900×640、过期 SOURCE、正常图片容器圆角与工具启停，为 24 checks / 22 screenshots / 0 failures。 |
| 2026-07-31 | 1.0.8-dev | 完成结构化套图模板市场与 A/B 方案比较：内置 Amazon/速卖通模板、个人模板 revision CAS、严格 portable v1 导入/导出、模板复用；同商品/SOURCE/槽位/语言/角色结果分组、并排比较与 Catalog/Product 双 CAS 原子终选，保留关系、provenance、画布节点和文件。共享 schema 已生成 Renderer registry/CLI 参考并同步 Skill；IPC 当前为 119 注册 / 116 preload / 3 internal / 7 receive / 2 send。专项为 `test:commerce-template`、`test:commerce-catalog`、`test:commerce-catalog-ui`、`test:automation-service` 与 `test:ipc-registration`。 |
| 2026-07-31 | 1.0.8-dev | 完成平台导出中心：Amazon/速卖通规则预检、Catalog 商品/变体/SKU 结果继承、approved/candidate/rejected 状态边界、JPEG/PNG 转换、稳定 SKU 目录与相对 manifest、staging 原子发布和原生目录授权；GUI 与共享 Agent CLI 同步提供 preview/package，Renderer/CLI 均不能提交目标路径。专项为 `test:commerce-export`、`test:commerce-export-ui`、`test:commerce-catalog-ui`、`test:automation-service` 与 `test:ipc-registration`。 |
| 2026-07-31 | 1.0.8-dev | 新增受管自定义 Glass 背景后端：本地图仅经原生选择读取，限制源大小/像素后统一压缩为最长边 3840 px WebP，以 SHA-256 内容寻址保存；preload/IPC 只公开 metadata 与按需 data URL。clear 采用 30 天恢复保留，GC 仅处理未引用、超期且哈希自校验通过的自有文件。IPC 更新为 102 invoke / 99 preload / 3 internal，专项为 `test:glass-background`、`test:settings-persistence` 与 `test:ipc-registration`。 |
| 2026-07-30 | 1.0.7 | 上下文地图 v9 登记安装级个人需求模板库：`requirement-library.json` 独立于 AppSettings 和项目 session，Main 提供懒读取、最多 200 项、精确 revision CAS 与确认删除；GUI 与共享 automation schema/CLI 同步支持 list/save/delete/use，use 只创建普通 Requirement，不执行、不调用模型、不计费。IPC 更新为 99 invoke / 96 preload / 3 internal，专项映射为 `test:automation-service` 与 `test:ipc-registration`。 |
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
