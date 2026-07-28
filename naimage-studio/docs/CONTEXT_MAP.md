# naimage 上下文地图

> 地图版本：6
> 最近同步：2026-07-28
> 对应桌面版本：1.0.6
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
  ├─ desktop/ipc/register-desktop-ipc.cjs：84 个 invoke handler + 4 个 send handler 的唯一注册顺序
  │    └─ config / automation / updater / session / agent / window / debug / project / asset / server registrar
  ├─ 项目、session、账户密钥脱敏快照、模型缓存、更新状态
  ├─ desktop/project-save-coordinator.cjs
  ├─ desktop/model-catalog.cjs
  ├─ desktop/agent-responses-adapter.cjs
  ├─ desktop/new-api-transport.cjs：默认 Node HTTP、显式 HTTP(S) 代理时的 Windows curl 传输与取消
  ├─ desktop/new-api-client.cjs：account/relay/update 基址解析、重试、会话 cookie、JSON/通用 SSE 与 Images SSE relay
  ├─ desktop/account-token-service.cjs：New API 用户密钥 CRUD、按账户隔离的脱敏磁盘快照与 Main-only 完整 Key 内存缓存
  ├─ desktop/automation-service.cjs：127.0.0.1 随机端口、随机 Bearer Token 与 Renderer 命令转发
  ├─ desktop/agent-integration-service.cjs：Codex/Claude Code/OpenCode/OpenClaw Skill 检测、安装与移除
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
  index.html → src/main.tsx → App
  ├─ src/core.ts：共享类型、bridge contract、图片与 session 规则
  ├─ src/settings-persistence.ts：默认设置、迁移与浏览器回退存储
  ├─ src/plugin-state.ts / src/plugin-system.ts：声明式插件状态、manifest、权限、命令与工具栏贡献
  ├─ src/plugins/*：内置插件领域任务契约；不直接修改项目 session
  ├─ src/agent-panel-layout.ts：Agent 停靠/浮动布局、边界限制与 CSS 拖动预览
  ├─ src/agent-window-sync.ts：按需加载的独立窗快照与命令校验
  ├─ src/asset-identity.ts / src/paste-blocks.ts：纯数据域
  ├─ src/agent.ts：Agent 请求和时间线适配
  ├─ src/ui.tsx：基础 UI 兼容 façade；真实实现位于 src/ui/*
  ├─ auth / image viewer / reference picker / theme palette / window controls 表面模块
  ├─ src/styles.css → src/styles/01…08：01 语义 token 与命名调色盘，04 设置外观表面，07 再按 07a→07i 有序展开
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
  → window.naimageConfig.windowControl({ action })
  → preload IPC "naimage:window:control"
  → desktop/ipc/window-ipc.cjs
  → 当前 BrowserWindow minimize / maximize / restore / close
```

`WindowControls` 只负责按钮和可访问性，不应读取项目或 Agent 状态。公共 bridge 类型位于 `src/core.ts` 的 `ConfigBridge`。

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
  ├─ account：所选 New API Key 直连 /v1/images/generations 或 /v1/images/edits
  └─ custom：纯文生图 /v1/responses + image_generation；编辑 /v1/images/edits
  → 项目 output 资产
  → workflow action
  → Renderer 归组与溯源
```

`generate/edit/replace/variants/layers/cutout/redraw` 是桌面 Agent 的业务语义；远端边界是 OpenAI-compatible relay、用户会话、模型、计费和图片结果。

桌面有两种互斥但可运行时切换的接入模式：

- `account`：用户名/密码登录 SparkAPI/New API；Cookie + `New-Api-User` 只用于 `/api/user/*`、`/api/token/*`、设备授权和更新。登录后桌面列出、创建、编辑、分组、启停和删除用户密钥，并用用户选择的完整 Key 直连 `accountBaseUrl/v1`。完整 Key 优先兼容原生 New API 在 token 列表/详情中的返回值，脱敏部署则通过 `POST /api/token/:id/key` 按需取回；两者都只缓存在 Electron Main 内存，不进入 Renderer、设置文件、模型缓存或日志。`account-token-cache.json` 只按账户地址 + user ID 保存最多 8 份公开元数据快照，不保存任何 Key、Cookie、IP 白名单或模型限制。
- `custom`：用户提供 Base URL、API Key、Agent 模型和生图模型；桌面直接请求标准 `/v1/models`、`/v1/chat/completions`、`/v1/responses`、`/v1/images/generations` 与 `/v1/images/edits`，不发送 SparkAPI `group`。

两个模式共用安装级 `licenseDeviceId` 与激活令牌。切换到自定义模式不会删除账号 session，切回账号模式可以快速恢复；自定义 Base URL 已含 `/v1` 时，client 必须去重路径而不能产生 `/v1/v1/*`。Responses 请求允许标准 SSE，也允许 HTTP 200 JSON 回退；空 JSON、空 SSE 和只有 `[DONE]` 的 SSE 都必须作为空输出失败，不能伪装为 Agent 成功。

设置页数据加载是显式的离线优先边界：挂载时 `tokens({ preferCached: true })` 与 `models({ cacheOnly: true })` 只读 Main 本地快照；没有模型快照时回退到设置内模型池。切换设置分区不会联网；只有“刷新密钥与分组”“刷新模型”、密钥 CRUD 或切换密钥等明确用户动作可以请求 New API。模型磁盘快照即使超过 60 秒，在 `cacheOnly` 模式下也可用于离线显示，并标记来源/更新时间；正常运行时的 60 秒缓存规则仍保持。

账号模式的标准 Images API 默认发送 `stream=true` 与 `partial_images=3`；`desktop/new-api-client.cjs` 解析 generation/edit partial 与 completed 事件，并在服务端明确表示不支持 `stream/partial_images` 时用新的幂等键安全回退一次非流式 JSON。密钥分组由 New API token 自身决定，桌面不得再向模型/生图 JSON 或 multipart 注入 `group`。自定义模式的纯文生图优先请求图片渠道的 `POST /v1/responses`：顶层模型使用 `agentModel`，完整 Prompt 放入 `input`，`tools[0]` 为 `image_generation`，其中携带 `action=generate`、画幅、格式、审核、质量和 `partial_images=3`；图片模型由该工具对应的上游渠道选择。客户端只把索引 0–2 映射成 `1/3`、`2/3`、`3/3` 中间预览，忽略上游额外的最终态 partial，并从 `response.output_item.done.item.result` 或 `response.completed.response.output[]` 收口、去重最终图片。只有 400/404/422 明确表示 Responses、模型或 image_generation 工具不受支持时，才回退 `/v1/images/generations` 非流式 JSON；HTTP 200 空流、已有 partial 后断流或不完整响应不得补发，避免重复计费。自定义编辑/参考图仍走 `/v1/images/edits` multipart 非流式链路。

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

`integrations/naimage-control` 是随安装包分发的正式 Skill；设置页可检测并复制到各 Agent 的 `skills/naimage-control`。安装目录的 `.naimage-connection.json` 只保存 endpoint 文件位置与 EXE 路径，不保存 Bearer Token；CLI 每次从应用私有 endpoint 文件读取当前 Token。服务只监听 loopback，Renderer 不使用任何 AIDebug hook。公开命令覆盖项目、画布状态/选择/容器/导入和 Agent 会话；清空全部或删除所选还必须传 `confirmed=true`。

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
  → 有界、脱敏 AgentWindowSnapshot
  → preload.cjs / window.naimageAgentWindow
  → desktop/agent-window-service.cjs
  → agent-window-preload.cjs
  → agent-window.html + agent-window-renderer.js
  → 用户命令经相反方向回到主 Renderer 执行
```

独立窗没有 Node integration，不持有 API Key、Cookie、项目写权限或第二个 Agent Runtime。它支持发送/停止、会话切换、新建/清理、原图/参考图入口、FastMemory 入口和收回五种主窗口位置；涉及图片选择或记忆编辑时服务先聚焦主窗口。独立窗关闭后主面板自动展开，主 Renderer 销毁时独立窗同步关闭。快照 JSON 最大 16 MiB、命令最大 512 KiB，消息/提示词/中间预览还有 Renderer 侧逐字段上限。专项入口为 `test:agent-window` 与 `test:agent-window-ui`。

### 4.6.2 声明式插件与电商套图翻译

```text
plugins/builtin-manifests.json
  → desktop/plugin-state.cjs + src/plugin-state.ts 双侧清洗安装状态
  → 设置页安装 / 授权 / 启用 / 停用 / 卸载
  → 启用插件时动态 import src/plugin-system.ts
  → PluginCommandRegistry 在执行前复核安装状态、启用状态和权限
  → 画布顶部 toolbar contribution
  → src/plugins/commerce-translation.ts 生成受控 Agent 任务
  → sendPrompt() → image_gen → 按语言形成独立结果组
```

插件只接受随应用发布的受信任声明式 manifest，不允许任意 JavaScript 注入 Renderer，也没有项目文件写权限。插件命令只能经主 Renderer 已登记的 handler 调用现有产品动作；`sparkai.commerce-toolkit` 当前申请 `canvas.read-selection`、`agent.submit-task`、`canvas.write-results` 三项权限。翻译任务以当前选择作为唯一 SOURCE，最多选择 10 种语言，禁止虚构商品信息并要求有 SOURCE 时使用编辑语义而非重画。`src/plugin-system.ts` 是异步 chunk，首屏只静态持有轻量 `src/plugin-state.ts`。专项入口为 `test:plugin-system`。

### 4.7 项目 session 保存

```text
Renderer 自动保存 / 显式保存
  → window.naimageConfig.saveSession(session + revision)
  → preload IPC "naimage:config:save-session"
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
| `desktop/ipc/register-desktop-ipc.cjs`, `desktop/ipc/*-ipc.cjs` | Settings → Automation → Updater → Session → Agent → Window → Debug → Project → Asset → Server 的固定注册顺序和各域 handler | 桌面服务实现、React 状态、跨域业务复制；依赖必须由 Main 显式注入 | `registerDesktopIpc`, `registerAutomationIpc`, `registerSettingsIpc`, `registerAgentIpc`, `registerAssetIpc`, `registerServerIpc` | `test:ipc-registration`, `test:lifecycle`, `aidebug:gui` |
| `agent-runtime.cjs` | Prompt/画布上下文组装、模型感知 checkpoint/model/tool 协议循环、工具执行、runtime action 编排 | React state、窗口原语、直接画布 mutation、SQLite/JSON memory CRUD、重复实现已抽出的策略/schema/响应解析/图片帧/观察副本规则 | `createAgentRuntime`, `chat`, `runTool`, `buildPromptMessages`, `compactConversationIfNeeded` | `test:context-checkpoint`, `test:agent-text`, `test:agent-protocol`, `test:view-image` |
| `desktop/project-store.cjs` | 项目列表与 active/default 项目、项目目录/session/manifest v2、当前元数据路径，以及更名前元数据的只读迁移 | session 字段清洗、资产扫描/hydration、保存队列或 IPC | `createProjectStore`, `projectSessionFromDisk`, `writeProjectManifest`, `ensureProjectFiles` | `test:project-io`, `test:project-save-coordinator` |
| `desktop/project-session-normalizer.cjs` | session/node/message 清洗、资产身份修复、容器迁移、pending execution 兼容 | 项目路径选择、磁盘 IO、资产扫描或 IPC | `sanitizeSession`, `hydrateSessionAssets`, `repairSessionAssetIdentities`, `sanitizePersistedPendingAgentExecution` | `test:project-io`, `test:asset-identity`, `test:image-container` |
| `desktop/project-asset-repository.cjs` | 项目 asset index、recorded paths、session hydrate 与保存归一化；新写入使用 `naimage-asset:` 与 `.naimage/assets`，读取兼容更名前资产 | 项目列表、manifest 版本、package/export/import 或 IPC | `createProjectAssetRepository`, `buildProjectAssetIndex`, `projectAssetRoots`, `projectWritableAssetRoots`, `sessionForProjectSave`, `sessionWithProjectAssets` | `test:project-io`, `test:project-save-coordinator` |
| `desktop/project-package-service.cjs` | `.naimage` 项目包校验、大小/数量限制、可移植资产收集、导出写入、旧包导入恢复与路径重写 | 项目列表、active project、IPC/dialog 或普通 session 保存队列 | `createProjectPackageService`, `packageProject`, `validateProjectPackageData`, `sessionFromPackage`, `importProjectPackage` | `test:project-io`, `test:project-save-coordinator` |
| `desktop/project-save-coordinator.cjs` | 按项目串行保存、revision 规范化、旧写入拒绝 | session 清洗、路径选择、磁盘格式 | `createProjectSaveCoordinator`, `normalizeSessionRevision`, `enqueue` | `test:project-save-coordinator`, `test:project-io` |
| `desktop/model-catalog.cjs` | 模型响应解析、大小写去重、Agent/Image 默认模型选择、缓存键与缓存归一化 | 网络请求、磁盘缓存时机、IPC | `uniqueModelIds`, `modelIdsFromResponse`, `splitModelSettings`, `cachedModelSettings` | `test:model-catalog`, `test:new-api-transport`, `test:lifecycle` |
| `desktop/agent-responses-adapter.cjs` | Chat Completions 请求到 Responses API input/tool/tool-choice 的纯转换 | HTTP、流读取、凭据或重试 | `responsesRequestFromChatRequest`, `responsesInputFromChatMessages`, `responsesToolsFromChatTools` | `test:agent-responses-adapter`, `test:agent-protocol` |
| `desktop/aidebug-image-fixture.cjs` | AIDebug mock 图片尺寸归一化、显式/旧 prompt 图层提示与确定性 PNG base64 | 真实图片服务、项目资产、用户图片、GUI suite 编排或 Main 生命周期 | `aidebugImageBase64`, `aidebugLayerFixtureHint` | `test:new-api-transport`, `aidebug:image-recovery`, `aidebug:gui` |
| `desktop/ipc/update-ipc.cjs` | 桌面更新 IPC channel 注册、操作错误到公开失败 DTO/进度事件的映射 | 更新清单校验、下载、回滚或安装进程实现 | `registerUpdateIpc` | `test:ipc-registration`, `test:update`, `test:update-rollback` |
| `desktop/new-api-transport.cjs` | 默认 Node HTTP、显式应用代理时的 Windows curl、请求/响应大小限制、流取消、活跃 curl 生命周期 | 设置持久化、登录、重试策略、Updater 状态；不得读取或修改 Git/系统全局代理 | `createNewApiTransport`, `newApiTransportFetch`, `stopActiveNewApiCurlTransports` | `test:new-api-transport`, `test:lifecycle` |
| `desktop/new-api-client.cjs` | New API URL、会话 cookie、重试、JSON request、managed relay JSON/SSE、Images SSE、Responses image_generation partial/final 解析与受限回退分类 | 账户 UI、模型选择、图片落盘、raw socket/curl 实现 | `createNewApiClient`, `newApiFetch`, `newApiRequest`, `newApiRelayStream`, `newApiRelayImage`, `newApiRelayResponsesImage` | `test:custom-api-transport`, `test:new-api-transport`, `test:agent-protocol`, `test:lifecycle` |
| `desktop/account-token-service.cjs` | New API `/api/token/*` 列表/选择/CRUD、原生 token 响应与脱敏 `/key` 扩展兼容、按账户隔离的公开元数据磁盘快照、所选 token 元数据持久化、完整 Key Main-only 内存缓存与账号 `/v1` credentials | Renderer 表单、模型请求体、项目数据、磁盘 Key/Cookie/IP 白名单/模型限制或日志 | `createAccountTokenService`, `credentials`, `ensureSelection`, `list`, `select` | `test:account-token`, `test:settings-lazy-load`, `test:ipc-registration`, `typecheck` |
| `desktop/automation-service.cjs` | loopback HTTP 服务、每次启动随机 Bearer Token、endpoint 文件、Renderer 请求关联与超时 | 业务命令实现、AIDebug hook、远端监听或长期 Token | `createAutomationService`, `rendererReady`, `resolveRendererResponse` | `test:automation-service`, `test:ipc-registration`, `test:bundle` |
| `desktop/agent-integration-service.cjs`, `integrations/naimage-control/` | Agent 配置目录检测、内置 Skill/PowerShell CLI 安装更新和受控移除 | 修改 Agent 全局设置、读取/输出 endpoint Token、直接编辑项目文件 | `createAgentIntegrationService`, `naimage.ps1`, `SKILL.md` | `test:agent-integration`, `test:automation-service`, Skill `quick_validate.py`, `test:bundle` |
| `desktop/agent-window-service.cjs`, `agent-window-*` | 独立 Agent BrowserWindow 生命周期、主 Renderer owner 绑定、有界状态/命令中继与隔离表面 | Agent Runtime、模型请求、项目写入、凭据、画布 reducer | `createAgentWindowService`, `publishState`, `forwardCommand`, `naimageAgentWindowSurface` | `test:agent-window`, `test:agent-window-ui`, `test:ipc-registration`, `test:lifecycle` |
| `desktop/license-service.cjs` | 安装设备 ID 授权状态、激活/校验端点选择、24 小时缓存与 72 小时离线宽限 | 激活码生成、数据库、账户计费、Renderer 表单 | `createLicenseService`, `verify`, `activate`, `requireActive` | `test:license`, `test:ipc-registration`, `aidebug:gui` |
| `runtime/context-strategy.cjs` | 模型族识别、上下文窗口、有效窗口、自动 checkpoint、保留用户意图及 Prompt/协议/画布/记忆预算 | 模型调用、消息持久化、设置 UI 或画布读取 | `contextStrategyForSettings`, `contextModelFamily`, `autoCompactTokenLimit`, `protocolMessageMaxChars` | `test:context-strategy`, `test:context-checkpoint` |
| `runtime/memory-store.cjs` | SQLite 初始化与 CRUD、Prompt/FastMemory/memorycontext/datememory JSON、context/experience、toolmemory、conversation summary/protocol 持久化、协议基础替换和按会话清理 | 模型调用、compact 决策、画布状态、工具执行或 Renderer | `createMemoryStore`, `getFastMemory`, `appendConversationProtocolTurn`, `replaceConversationProtocolItems` | `test:context-checkpoint`, `test:agent-text`, `test:agent-protocol` |
| `runtime/tool-schemas.cjs` | 公开/内部 Agent tool schema、图片模型工具契约与 schema 选择 | 模型请求发送、工具执行、Prompt 或 runtime 状态 | `agentToolSchemas`, `toolSchemas`, `imageModelContractForSettings` | `test:agent-text`, `test:agent-protocol` |
| `runtime/responses-parser.cjs` | Chat/Responses 非流式响应归一化、文本/推理 delta 读取、tool-call 与 Responses output 流式聚合 | HTTP/SSE 读取、原生工具进度编排、Agent loop 或工具执行 | `messageFromResponse`, `responseFromStreamChunks`, `mergeResponsesToolCallEvent` | `test:agent-text`, `test:agent-protocol` |
| `runtime/controlled-shell-command.cjs` | `shell_command` 的只读 allowlist、cwd/路径越界防护、输出裁剪和无 shell 子进程执行 | Agent loop、模型 Prompt、Renderer、IPC 或任意写入命令 | `controlledCommandPlan`, `executeControlledCommand`, `isExploreCommand` | `test:controlled-shell-command`, `test:agent-text`, `test:agent-protocol`, `aidebug:gui` |
| `runtime/image-frame.cjs` | Image 2 比例、分辨率、质量与 delivery/request size 归一化 | 模型请求发送、项目资产落盘 | `normalizeImage2Size`, `normalizeImageToolFrame`, `validateImageFrameFields` | `test:agent-text`, `test:agent-protocol` |
| `runtime/image-batch-normalization.cjs` | `image_gen` 单项 `items` 兼容提升、占位项过滤、真实批次数与逐项画幅归一化 | 模型调用、图片服务请求、工具进度或画布 action | `createImageBatchNormalization`, `normalizeSingleImageItemCompatibility`, `normalizeImageBatchItems` | `test:agent-text`, `test:agent-protocol` |
| `runtime/view-image-payload.cjs` | `view_image` 允许根、安全读取、格式/尺寸识别、批量 payload 预算与 WebP 观察副本 | 会话持久化、画布预览、原图覆盖 | `prepareViewImageModelPayload`, `viewImagePathAllowed`, `viewImagePayloadBudgetForBatch` | `test:view-image`, `test:agent-protocol` |
| `update-release.cjs` | 更新清单 canonical text | 下载、安装、UI | `canonicalDesktopRelease` | `test:update`, `release:verify`, `package:update-e2e` |
| `src/server.ts` | Vite/AIDebug 浏览器服务回退 | 正式 Electron 文件系统或完整 Agent bridge | `installBrowserServerBridge`, `LOCAL_NEW_API_PROXY` | `build`, `aidebug:gui`, `test:new-api-transport` |

### 5.2 Renderer 核心模块

| 路径 | Owns | Must not own | 关键导出/检索词 | 主要验证 |
| --- | --- | --- | --- | --- |
| `src/main.tsx` | App 状态、画布交互、项目/会话、Agent 调用、runtime action 落地和跨域编排 | 主进程文件 IO、真实 relay token、已抽出表面的内部实现 | `App`, `sendPrompt`, `applyRuntimeActions` | `build`, `aidebug:gui` 及对应专项 suite |
| `src/core.ts` | 共享类型与 bridge contract、会话清洗、图片/mask 与画布纯逻辑；保留资产/paste 兼容重导出 | React 渲染、长运行 Agent 状态、设置持久化与 alpha 归一化的新实现 | `ThemeChoice`, `ThemePaletteChoice`, `WorkflowNode`, `AgentTaskScope`, `ConfigBridge`, `ServerBridge`, `AgentBridge` | `typecheck`, `test:agent-text`, `test:layer-alpha` |
| `src/layer-alpha-normalization.ts` | 图层 RGBA alpha 像素归属归一化、透明图层互斥重建与归一化报告 | 分层合成编排、mask 生成、`core.ts` façade 重导出 | `normalizeLayerAlphaPixelBuffers`, `normalizeTransparentLayerAlphaExclusivity` | `test:layer-alpha`, `test:layer-mask-replay`, `typecheck`, `build`, `test:bundle` |
| `src/settings-persistence.ts` | 默认设置、明暗/调色盘与旧字段迁移、模型池清洗、Storage Keys、`readJson`/`writeJson` | Electron 磁盘设置、远端账户状态 | `defaultSettings`, `THEME_PALETTE_VALUES`, `mergeSettings`, `STORAGE_*` | `test:settings-persistence`, `typecheck`, `build` |
| `src/plugin-state.ts`, `desktop/plugin-state.cjs` | Renderer/Electron 插件安装状态、授权集合和启用状态清洗镜像 | manifest 解析、命令执行、UI 或项目修改 | `normalizePluginStates`, `normalizePluginPermissions` | `test:plugin-system`, `test:settings-persistence` |
| `src/plugin-system.ts`, `plugins/builtin-manifests.json` | 受信任 manifest、生命周期操作、权限复核、命令注册表与工具栏 contribution；按启用状态动态加载 | 任意脚本执行、直接 session 写入、Agent Runtime 或文件 IO | `PluginCommandRegistry`, `activePluginToolbarItems`, `installBuiltinPlugin` | `test:plugin-system`, `typecheck`, `build`, `test:bundle` |
| `src/plugins/commerce-translation.ts`, `src/commerce-translation-dialog.tsx` | 跨境电商多语言目录、最多 10 种选择和受控 Agent 翻译任务契约 | 图片网络请求、结果落盘、插件权限或画布 reducer | `commerceTranslationPrompt`, `normalizeCommerceLanguageCodes` | `test:plugin-system`, `typecheck`, `build` |
| `src/agent-panel-layout.ts` | Agent 面板设置读取、四向停靠/应用内浮动转换、边界限制、pointer delta 与 CSS preview variables | React 状态、Electron 独立窗口、设置磁盘 IO | `agentPanelLayoutFromSettings`, `agentPanelLayoutForPlacement`, `agentPanelLayoutFromPointer`, `applyAgentPanelLayoutPreview` | `test:agent-panel-layout`, `test:agent-panel-ui`, `typecheck`, `build`, `test:bundle` |
| `src/agent-window-sync.ts` | 独立窗脱敏有界快照、状态文案与命令 allowlist；只在打开独立窗时动态加载 | IPC、BrowserWindow、Agent 执行、项目持久化 | `buildAgentWindowSnapshot`, `normalizeAgentWindowCommand`, `agentWindowStatusText` | `test:agent-window`, `test:agent-window-ui`, `typecheck`, `build`, `test:bundle` |
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
| `src/styles.css`, `src/styles/01…08` | 有序样式入口与 base/canvas/legacy/dialog/desktop/responsive/workbench/motion 区域；`01-theme-palettes.css` 只覆盖 `--theme-*`，`04-settings-appearance.css` 只拥有设置外观表面，07 仅按 07a→07i 聚合 | 数据修复、运行时状态补丁、直接在预设中重复 canonical token、跨文件随意改 import 顺序 | `@import`, `01-theme-palettes.css`, `04-settings-appearance.css`, `07a-foundation-consolidation.css`, `07i-auth-gate.css` | `test:ui-foundation`, `aidebug:gui`, `test:bundle` |
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
| `src/auth-gate.tsx` | 启动检查、账号/自定义接入切换、激活输入、登录/注册表面与认证标题栏 | `test:custom-api-transport`, `test:license`, `aidebug:gui`, `test:lifecycle` |
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

## 6. 跨边界契约

### 6.1 Preload 与 IPC

| Bridge | Renderer 入口 | 主进程职责 |
| --- | --- | --- |
| `window.naimageConfig` | 设置、项目、session、导入/导出、窗口控制 | 本地文件、项目目录、BrowserWindow、原子保存 |
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
| Session revision | Renderer 自动保存、`desktop/project-save-coordinator.cjs`、项目 manifest/session | revision 单调且旧写不覆盖新写；运行 `test:project-save-coordinator`, `test:project-io` |
| 服务返回清洗 | `electron-main.cjs` 正式路径、`src/server.ts` 浏览器回退 | 登录、用户、模型、日志和图片 DTO 不能静默分叉；正式行为以 Electron 路径为准 |
| Agent 文本清洗 | `agent-runtime.cjs` tool envelope、`src/core.ts` 持久化消息清洗、`src/agent.ts` 时间线 | 不泄露 entry id/FastMemory metadata，不重复最终文本；运行 `test:agent-text`, `test:timeline` |
| 更新清单 | `package.json`, `update-release.cjs`, `electron-main.cjs`, `build/update-public-key.pem`, `ai-native` release manifest | canonical 清单的 product、version、minimum version、compatibility、hash、size 与制品必须一致，并独立验签 |

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
| 模型目录/缓存 | `desktop/model-catalog.cjs`, `electron-main.cjs` | 服务响应 DTO、60 秒运行缓存、`cacheOnly` 离线磁盘快照、设置/Agent 共用模型 | `test:model-catalog`, `test:settings-lazy-load`, `test:ipc-registration`, `test:new-api-transport` |
| 账户密钥快照/显式刷新 | `desktop/account-token-service.cjs`, server IPC, `src/main.tsx` | 按账户隔离、脱敏字段、preload bridge、设置页不得自动联网 | `test:account-token`, `test:settings-lazy-load`, `test:ipc-registration`, `typecheck`, `build`, `test:bundle` |
| 设置/浏览器回退存储 | `settings-persistence.ts` | `AppSettings` 类型、Electron ConfigBridge、当前 `naimage.*` LocalStorage 键、更名前键的只读迁移、账户切换认证边界 | `test:settings-persistence`, `test:ipc-registration`, `typecheck`, `aidebug:gui` |
| 明暗模式/主题调色盘 | `theme-palette-picker.tsx`, `settings-persistence.ts`, `styles/01-theme-palettes.css`, `styles/04-settings-appearance.css` | `AppSettings.theme/themePalette`、Electron `defaultSettings/migrateSettings` 镜像、Vite `studio-dialogs` 懒加载 chunk | `test:settings-persistence`, `test:ui-foundation`, `typecheck`, `build`, `test:bundle`, `aidebug:gui` |
| 插件/电商工具栏 | `plugin-state.ts`, `plugin-system.ts`, `plugins/builtin-manifests.json`, `src/plugins/*` | Electron/Renderer 状态清洗镜像、设置持久化、权限、动态 chunk、主 Renderer 命令 handler；禁止直接 session 写入 | `test:plugin-system`, `test:settings-persistence`, `typecheck`, `build`, `test:bundle` |
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

可用 `NAIMAGE_CONFIG_DIR`、`NAIMAGE_DEBUG_DIR` 等诊断变量覆盖隔离测试目录；不得把真实用户数据写入随机源码目录。

### 9.2 应用与项目文件

| 路径/文件 | 内容 | 所有者 |
| --- | --- | --- |
| `app-settings.json` | App 设置、账号 session、所选账户密钥的 ID/名称/分组元数据、自定义 API Key、可选应用级代理 URL、随机安装 ID 与授权令牌 | Electron Main；账户完整 Key 不得写入该文件、日志、模型缓存或项目文件 |
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
- 浏览器回退键统一为 `naimage.settings.v1`、`naimage.ideSession.v1`、`naimage.imageGenerationStats.v1`、`naimage.serverAuth.v1`；只有当前键不存在时才只读迁移更名前值，正常保存只写当前品牌键。
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

- `desktop/project-save-coordinator.cjs` 的 project queue 与 revision Map。
- `desktop/account-token-service.cjs` 的账户完整 Key cache；Renderer 只接收脱敏密钥元数据，进程重启后通过登录 session 再次按需获取。
- 当前 BrowserWindow、模型 inflight 请求和模型 memory cache。
- Agent 当前执行、取消控制器、流式文本和工具轮次。
- Images/Responses 生图流的最新中间预览；只显示当前 partial，不进入 `validMessages` 或项目 session。
- Renderer 当前 selection、drawer/dialog、拖拽和未保存 UI 状态。

进程重启后必须从磁盘/服务端恢复权威状态，不得依赖这些 Map 或 React state。

## 10. 测试映射

所有代码改动至少执行 `corepack pnpm run build`；TypeScript/TSX 结构调整同时执行 `corepack pnpm run typecheck`。下面是专项入口：

| 领域 | 命令 |
| --- | --- |
| Agent Prompt/FastMemory/tool contract | `corepack pnpm run test:agent-text` |
| Agent/Responses/TaskScope protocol | `corepack pnpm run test:agent-protocol` |
| Responses 请求转换 | `corepack pnpm run test:agent-responses-adapter` |
| New API transport / AIDebug image fixture / Images SSE / 显式代理 | `corepack pnpm run test:new-api-transport` |
| New API 账户密钥列表/选择/CRUD、原生 Key 响应兼容与账号 `/v1` 直连 | `corepack pnpm run test:account-token` |
| 设置页账户/模型离线快照与显式刷新 | `corepack pnpm run test:settings-lazy-load` |
| 本机 loopback 自动化鉴权与正式 CLI | `corepack pnpm run test:automation-service` |
| Codex/Claude Code/OpenCode/OpenClaw Skill 检测、安装与移除 | `corepack pnpm run test:agent-integration` + Skill `quick_validate.py` |
| 自定义 API `/v1`、JSON/SSE 回退 | `corepack pnpm run test:custom-api-transport` |
| 设备激活、缓存与离线宽限 | `corepack pnpm run test:license` |
| `view_image` | `corepack pnpm run test:view-image` |
| 项目 IO | `corepack pnpm run test:project-io` |
| 保存 revision/队列 | `corepack pnpm run test:project-save-coordinator` |
| 模型目录/缓存纯逻辑 | `corepack pnpm run test:model-catalog` |
| 设置迁移与 localStorage 回退 | `corepack pnpm run test:settings-persistence` |
| 粘贴块 | `corepack pnpm run test:paste-blocks` |
| Agent 文本 UI | `corepack pnpm run test:agent-text-ui` |
| AIDebug CLI/options 纯解析 | `corepack pnpm run test:aidebug-options` |
| 布局/容器 | `corepack pnpm run test:image-layout`, `corepack pnpm run test:image-container` |
| 需求/TaskScope/gate | `test:requirement-signature`, `test:requirement-graph`, `test:task-scope`, `test:execution-gate`；GUI 专项为 `aidebug:requirements`，完整 Layer Stack 仅按需运行 `aidebug:requirements:full` |
| UI primitives | `corepack pnpm run test:ui-foundation` |
| Agent 面板布局/拖动/提示词复制区/独立窗口 | `corepack pnpm run test:agent-panel-layout`, `corepack pnpm run test:agent-panel-ui`, `corepack pnpm run test:agent-window`, `corepack pnpm run test:agent-window-ui` |
| alpha/mask/matting | `test:chroma-key`, `test:layer-alpha`, `test:layer-mask-replay`, `test:semantic-matting` |
| 选择/画布/资产 | `test:selection`, `test:canvas-commands`, `test:asset-identity` |
| 工具时间线 | `corepack pnpm run test:timeline` |
| PSD/缩略图/导入 | `test:psd-export`, `test:thumbnail-cache`, `test:image-import` |
| IPC 注册顺序/preload 对称性 | `corepack pnpm run test:ipc-registration` |
| Electron 生命周期 | `corepack pnpm run test:lifecycle` |
| 更新 | `test:update`, `test:update-rollback`, `test:update-helper` |
| 正式 bundle | `corepack pnpm run test:bundle` |
| 日常 GUI 快速冒烟（主画布宽/窄、Agent、设置） | `corepack pnpm run aidebug:gui` |
| 完整 UI surface 基线 | `corepack pnpm run aidebug:gui:surface` |
| 正式发布 | `corepack pnpm run release:final` |

测试存在不代表所有改动都要执行全量套件。日常开发优先跑纯逻辑 selftest 和一个受影响领域专项；一般 Renderer/UI 改动在一批功能完成后只跑一次快速 `aidebug:gui`，跨页面或全局 surface 改动才跑 `aidebug:gui:surface`。Electron、项目或 Agent 非可视改动无需机械追加 GUI；正式制品仍必须通过 `test:bundle` 和发布编排器的完整要求。

当前 Renderer bundle 上限为初始 JS 650,000 B、异步 JS 180,000 B、总 JS 720,000 B、CSS 220,000 B、完整 dist 1,000,000 B。首屏上限的本次放宽只覆盖账号密钥管理与本机 Agent 自动化桥；后续稳定化应优先把完整 `SettingsDrawer` 移入现有 `studio-dialogs` 异步边界。

独立 Agent 窗口批次后的正式证据为：initial JS 639,365 B、async JS 60,073 B、total JS 699,438 B、CSS 187,824 B、dist 943,051 B。首屏只剩约 10.6 KB；`src/agent-window-sync.ts` 已保持为打开独立窗时才加载的动态 chunk，后续 Renderer 功能仍必须同步审计 chunk 归属并运行 `build + test:bundle`。

## 11. 当前高风险热点

- `src/main.tsx`、`electron-main.cjs`、`agent-runtime.cjs` 和 `src/core.ts` 仍较大，但已分别建立 renderer surface、desktop domain、runtime domain 与纯数据模块边界；Main 的 84 个 invoke handler 与 4 个 send handler 已由 `desktop/ipc/*` 独立拥有，`agent-runtime.cjs` 的 memory store、tool schema 与 Responses/Chat parser 也已有独立 owner，后续继续沿现有边界拆，不要重新内联。
- `src/styles.css` 是 28 行有序入口；`src/styles/07-workbench-flattening.css` 也只是保持 07a→07i 顺序的二级入口，workbench 规则分别归属对应 slice。任何样式调整都必须同时保持 01→08、07a→07i import 顺序和最终 reduced-motion gate。
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
