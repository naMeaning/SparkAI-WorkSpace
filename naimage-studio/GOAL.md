# naimage 长程目标

本文档记录当前用户目标、完成证据和下一步。状态只能依据当前源码与专项验证更新，不能以计划或推测代替完成证明。

状态枚举：`未开始`、`进行中`、`部分实现`、`已实现待验证`、`已验证`。

## 总体原则

- 保持项目上下文地图同步：`docs/CONTEXT_MAP.md`；跨仓库/发布契约变化时同步根目录 `WORKSPACE_CONTEXT_MAP.md`。
- 日常开发运行影响范围内的最小专项测试，不默认运行全量 AIDebug。
- Renderer 功能优先进入自然异步边界；正式构建后运行 `test:bundle` 检查分层体积策略，正式性能由独立的 `aidebug:performance:product` 硬门禁负责。
- 账户凭证、上游 Key、relay token 和 session cookie 不进入 UI、日志、缓存文档或测试输出。
- CRM 不属于后续产品目标；相关旧代码最终删除，不在新架构上继续扩展。

## 目标清单

### 1. 模型感知的上下文控制

- 状态：`已验证`
- 目标：提供 `自动`、`Codex`、`Claude Code`、`naimage 平衡`、`自定义`策略。自动模式按模型族选择；用户可覆盖。
- 产品定义：naimage Agent = Codex/Claude Code 式通用 Agent Runtime + naimage 图片创作 Agent。这里不是把 Codex 源码或产品直接嵌入应用，而是复用其长上下文、原生工具循环、协议历史、checkpoint、Skills/CLI 与多步骤执行语义，同时由 naimage 领域工具拥有画布、TaskScope、图片容器、Image Gen、素材和绘画经验。
- 用户补充：GPT/Codex 策略不应继续沿用 32K 的过早压缩阈值；应按模型上下文窗口（Codex 类模型约 256K 量级，最终以模型目录或用户配置为准）分配可用预算，并为输出与安全余量预留空间。
- 当前实现：`runtime/context-strategy.cjs` 按模型族解析窗口和预算；GPT 5.5/5.6 使用 272K 总窗口、95% 有效窗口、244.8K 自动 checkpoint、20K 用户意图保留预算和 Responses 协议历史；Claude 使用普通消息历史与 200K/1M 窗口；未知模型使用 128K 平衡策略。
- checkpoint 契约：生成 handoff summary，替换旧 Responses 协议基础，清除旧 encrypted reasoning，随后重新注入当前画布、TaskScope 和 FastMemory。Codex 单条协议消息不再固定截断为 12K 字符。
- 权威文件：`runtime/context-strategy.cjs`、`agent-runtime.cjs`、`runtime/memory-store.cjs`、`desktop/agent-responses-adapter.cjs`、`src/settings-persistence.ts`。
- 证明：`test:context-strategy` 35 cases、`test:context-checkpoint` 16 cases、`test:settings-persistence` 66 cases、`test:agent-protocol`、`typecheck`；快速 `aidebug:gui` 已真实切换到自定义策略并确认五种策略与四项预算输入可见、无裁切。

### 2. 跨境电商工具栏与一键套图

- 状态：`已实现待验证`
- 已实现：内置声明式插件 `sparkai.commerce-toolkit` 在画布顶部提供“一键生成套图”和“一键多国语言”入口；用户安装并授权后可启用、停用或卸载。用户可以选中一张或多张母图/图片容器，选择每组套图张数（1–12），为每个槽位分别填写标题与完整 Prompt，也可选择最多 10 种目标语言并为每种语言填写要求。生成模式按“冻结 SOURCE × 语言版本 × 套图槽位”展开；未选语言时沿用母图语言。翻译模式按“冻结 SOURCE × 目标语言”展开，保留商品、品牌、型号、尺寸、数字和版式，禁止虚构卖点、认证、优惠或配件，RTL 语言保留正确方向。
- 批量与复用：多张母图共享同一套槽位/语言计划，每张母图生成一组独立且可追溯的成果。用户可以只执行，也可把完整计划保存为 Requirement 或 Skill 节点，并保留全部母图输入关系；可复用节点只在用户完成两阶段确认且 Goal 派发被接受后创建，取消、过期或拒绝确认不创建节点。
- 费用与信任边界：GUI 与 `commerce.compose-set` CLI 都先规范化计划并生成确定性受信任 Prompt，再复用 `agent.goal` 的预览/明确确认账本；确认快照冻结 `operationsPerAsset`、`requestCount` 和 `commercePlanHash`。单次矩阵最多 200 个图片请求，超限在派发前阻断；任何母图、槽位、Prompt、语言或保存目标变化都要求重新预览。小批量 probe、渐进放量和已派发请求仍可能计费的边界与普通 Goal 完全一致。
- 权威文件：`plugins/builtin-manifests.json`、`plugins/commerce-set-schema.json`、`src/plugins/commerce-set.ts`、`src/commerce-set-dialog.tsx`、`desktop/plugin-task-prompts.cjs`、`desktop/ipc/plugin-ipc.cjs`、`src/goal-task-scope.ts`、`src/automation-command-runtime.ts`、`agent-runtime.cjs`、`src/main.tsx` 与 `integrations/naimage-control/`。
- 当前证据：`test:commerce-set`、`test:goal-task-scope`、`test:goal-runtime`、`test:automation-service`、`typecheck` 与 `aidebug:commerce-set` 已通过；最新真实 Electron 报告为 `.diagnostics/electron/commerce-set-2026-07-30T03-25-55-222Z/report.json`（15 项检查、14 张截图），未调用真实 provider。该专项证据证明当前功能，但 2026-07-29 的 SUPER GOAL closure 早于本批输入；本项目状态要回到 `已验证` 仍须生成并收集输入 hash 与当前工作树一致的新 workpack closure。

### 3. 接入状态懒加载与手动刷新

- 状态：`已验证`
- 已实现：Electron Main 按 `accountBaseUrl + serverUserId` 保存最多 8 份账户密钥脱敏快照；模型目录继续使用独立磁盘缓存。设置抽屉挂载时只读取本地密钥/模型快照，切换到“接入”页不再触发网络请求；用户点击“刷新密钥与分组”或“刷新模型”后才访问 New API，单击即强制刷新，不再保留隐藏的六次点击逻辑。
- 安全：账户快照不保存完整或掩码 Key、Cookie、`allowIps`、`modelLimits`；完整 Key 仍只在 Main 内存。无模型快照时只使用设置中已保存的模型池，不联网。
- 权威文件：`desktop/new-api-client.cjs`、`desktop/account-token-service.cjs`、`desktop/ipc/server-ipc.cjs`、`src/main.tsx`。
- 证明：`test:account-token`、`test:settings-lazy-load` 12 cases、`test:ipc-registration`、`test:settings-persistence` 59 cases、`typecheck`、正式 `build` 与 `test:bundle`。本批没有运行全量 AIDebug。

### 4. Agent 自由浮动窗口与四向停靠

- 状态：`已验证`
- 已实现：右、左、上、下四向停靠、应用内浮动，以及可移出主窗口的独立 Electron Agent 窗口。横向/纵向停靠使用对应宽度/高度 resize handle，折叠 rail 随方向切换，布局设置已迁移并持久化。
- 独立窗契约：主 Renderer 始终是 Agent、画布和项目状态的唯一权威；独立窗只消费脱敏、有界快照并把提示词、停止、新建/清理/切换会话、原图/参考图、记忆和收回停靠命令转回主窗口，禁止创建第二个 Agent Runtime 或重复写项目。主窗口关闭时独立窗同步关闭。
- 权威文件：`src/main.tsx`、`src/agent-panel-layout.ts`、`src/agent-window-sync.ts`、`desktop/agent-window-service.cjs`、`agent-window-*` 表面、窗口 IPC。
- 证明：`test:agent-panel-layout` 16 cases、`test:agent-panel-ui` 17 cases、`test:agent-window` 44+54 cases、`test:agent-window-ui` 15 cases、`test:ipc-registration`、`test:lifecycle`、`typecheck`、正式 `build` 与 `test:bundle`。

### 5. “手工添加模型”改为“自定义模型”

- 状态：`已验证`
- 已实现：模型配置入口和空状态统一使用“自定义模型”，源码 UI 中不再残留“手工添加模型”。
- 权威文件：`src/model-config-dialog.tsx` 及设置相关文案。
- 证明：源码文本搜索无旧文案；`typecheck`、正式 `build`。

### 6. 外观导入与自定义配置

- 状态：`已验证`
- 已实现：设置页新增第 11 套“自定义”配色，可分别编辑浅色/深色的应用背景、画布、表面、文字、边框、主色、危险色和成功色共 10 个语义颜色；主题名称、恢复陶土模板和画布实时预览已贯通，独立 Agent 窗口同步使用同一主题。
- 导入导出：原生 Electron 文件对话框读写严格的 `naimage-theme v1` JSON；文件最大 64 KiB，只接受完整的浅/深色字段和 `#RGB`/`#RRGGBB`，不接受 CSS、URL 或脚本内容，非法文件不覆盖当前主题。
- 权威文件：`desktop/theme-preset-service.cjs`、`desktop/ipc/config-ipc.cjs`、`src/theme-palette-picker.tsx`、`src/settings-persistence.ts`、`src/styles/01-theme-palettes.css`、`src/styles/04-settings-appearance.css`。
- 证明：`test:theme-preset` 24 cases（每模式 10 色）、`test:settings-persistence` 66 cases、`test:agent-window`、`test:ipc-registration`、`test:ui-foundation`、`typecheck`、正式 `build + test:bundle`；快速 `aidebug:gui` 已验证明暗编辑切换、画布颜色即时变化、抽屉内部滚动和操作按钮无裁切。

### 7. 用户自选上下文策略

- 状态：`已验证`
- 已实现：设置页可选择自动、Codex、Claude Code、naimage 平衡和自定义；自定义模式可设置总窗口、有效窗口比例、自动压缩点和保留用户消息 Token，Electron/Renderer 持久化与边界修复已覆盖。画布、FastMemory、普通消息和协议历史的细分预算继续由同一策略协调器按所选总预算自动分配，避免产生互相矛盾的公开参数。
- 证明：`test:context-strategy` 35 cases、`test:settings-persistence` 66 cases、`test:context-checkpoint` 16 cases；快速 `aidebug:gui` 已切换到“自定义”并验证五种选项和四项预算输入真实显示、无裁切。

### 8. 图片容器流式中间预览

- 状态：`已验证`
- 已实现：账号 Images SSE 与自定义 Responses image generation 的 partial 统一进入 `image-preview`；手动画布请求和 Agent 请求都携带父 operation 与一基并发槽位，分层任务还为每个图层保留独立槽位。Renderer 按 operation、生成节点和布局 host 把最新 partial 放入目标单图/批量容器/连续系列/分层占位组的 pending tile，完成、失败或停止时按槽位清理，不再创建独立画布预览节点。
- 对话边界：中间图不再复制到 Agent 时间线消息，也不在主对话框或独立 Agent 窗口显示；它只存在于运行时 Renderer state，不写项目 session、会话历史或图片库。
- 权威文件：`desktop/new-api-client.cjs`、`desktop/ipc/server-ipc.cjs`、`agent-runtime.cjs`、`src/streaming-image-preview.ts`、`src/main.tsx`。
- 证明：`test:image-stream-preview` 17 cases、`test:image-container` 12 cases、`test:new-api-transport`、`test:agent-window`、`test:agent-protocol`、`typecheck`、正式 `build` 与 `test:bundle`。

### 9. 提示词复制按钮布局

- 状态：`已验证`
- 已实现：复制操作移到独立工具行，不再绝对定位覆盖 `<pre>`；提示词滚动区使用稳定 scrollbar gutter，复制成功状态仍可见。
- 参考：用户提供的图 1。
- 证明：`test:agent-panel-ui` 验证按钮位于滚动区上方、二者不相交、滚动区可滚动、gutter 为 stable，并实际点击进入“已复制”；截图位于对应 `.diagnostics/electron/agent-panel-ui-*` 目录。

### 10. Agent 侧边栏拖动性能

- 状态：`已验证`
- 已实现：pointermove 只更新拖动模型，并由 `requestAnimationFrame` 合并为 CSS preview variables；松手后只提交一次 React 状态和设置持久化。纯布局计算已从 `main.tsx` 抽到 `src/agent-panel-layout.ts`。
- 证明：`test:agent-panel-layout` 16 cases；`test:agent-panel-ui` 连续 12 次 pointer move 期间 App、Canvas、Agent feed、Composer React commit 均为 0，preview 生效并在 pointer release 后提交宽度；正式 `build` 与 `test:bundle` 已通过。

### 11. 插件系统、project-graph 与科研绘图适配

- 状态：`已验证`
- 目标：插件 manifest、注册表、权限、安装/启用/停用/卸载、Renderer contribution point 和命令注册；电商工具栏作为首个插件。
- 已实现：受信任的声明式内置 manifest、设置持久化与 Electron/Renderer 双侧清洗、安装/启用/停用/卸载、权限复核、命令注册表和画布工具栏 contribution point。插件禁止注入任意 Renderer JavaScript，也不能直接修改项目 session；完整运行时仅在存在启用插件时动态加载。
- Project Graph：第二个内置插件 `sparkai.project-graph` 可只读选择 `.prg` 或图结构 JSON。Electron 适配器从 ZIP 中只读取 `stage.msgpack` 并解析 MessagePack 对象引用，不执行扩展脚本、附件或任意插件代码，不暴露绝对路径；文件、舞台、节点、关系、文本和遍历复杂度均有上限。Renderer 显式清空画布选择与附件继承，把 GRAPH 作为唯一知识 SOURCE，要求 Agent 按规模生成 1 张总览或 2–6 张独立学习图片，并禁止虚构图中不存在的事实或直接写项目 session。
- 科研绘图：第三个内置插件 `sparkai.scientific-figure` 参考 `Yuan1z0825/nature-skills` 的科研绘图工作流，内置可拆包的受信任 Agent 契约；定量绘图先选 Python 或 R，之后单后端完成绘制、预览、导出和 QA，禁止虚构数据。插件目录预留 `naimage-plugin-v1` 在线目录格式，不携带上游图库、示例或 Python/R 依赖。
- Bundle 边界：插件运行时、设置表面、Glass Lab、workspace chrome 和插件专属对话框保持自然异步 chunk；`test:bundle` 对插件 JS 120,000 B 与插件不得进入首屏图执行硬门禁。首屏目标为 685,000 B，并保留 1,024 B 测量容差；core async JS 190,000 B、core JS 870,000 B 与完整 dist 1,200,000 B 只报告 advisory，不能替代 `aidebug:performance:product` 的产品性能硬门禁。
- 外部参考：<https://github.com/graphif/project-graph>
- 权威文件：`desktop/project-graph-adapter.cjs`、`desktop/plugin-task-prompts.cjs`、`desktop/ipc/project-ipc.cjs`、`desktop/ipc/plugin-ipc.cjs`、`plugins/builtin-manifests.json`、`src/plugin-system.ts`、`src/main.tsx`。
- 证明：`test:project-graph` 23 cases、`test:plugin-system` 65 cases、当前 `test:ipc-registration` 为 95 invoke handlers/92 preload invokes/3 internal Agent invokes、`test:settings-persistence` 66 cases、正式 `build` 与 `test:bundle`。该 Project Graph 批次的历史 Bundle 基线为 initial 648,314 B、core JS 710,952 B、plugin JS 9,266 B；最新分层门禁证据见第 16 节。真实仓库样例 `ProjectGraph开发进程图.prg` 解析为 119 节点/117 关系/21 Section，`服务器.prg` 解析为 9 节点/5 关系/5 Section；均无警告。长 Prompt 已移出 Renderer，本批未修改任何 `.prg`、项目 session 或用户数据。

### 12. 账户密钥额度人民币显示

- 状态：`已验证`
- 已实现：账户密钥保留 New API 原始 `remain_quota`，按 `/api/status.quota_per_unit` 换算 R，并固定解释为 `1 R = 1 USD`，再使用 `/api/status.usd_exchange_rate` 换算人民币。设置页以 `￥` 为主显示，同时展示 R 和原始 quota；完整换算口径保留在审计提示中。`price` 充值价格倍率不参与余额汇率计算。
- 懒加载：用户显式刷新密钥时并行读取公开状态与密钥列表；打开设置只读取按账户隔离的本地快照，不联网。快照保存原始公开额度和换算参数，不保存派生显示字符串、Key、Cookie、IP 或模型限制；旧 v1 快照可读，下一次刷新升级为 v2。
- 编辑边界：创建/编辑密钥仍向 New API 写原始 quota，界面明确标注“原始额度”，不会把人民币或 R 数值误写回 `remain_quota`。
- 权威文件：`desktop/account-token-quota.cjs`、`desktop/account-token-service.cjs`、`src/core.ts`、`src/main.tsx`、`src/styles/04-settings-appearance.css`。
- 证明：`test:account-token-quota` 10 cases、`test:account-token`、`test:settings-lazy-load` 12 cases、`test:ipc-registration`、`typecheck`、正式 `build` 与 `test:bundle`。

### 13. 画布批处理、Agent 运行控制与多窗口持久化

- 状态：`已实现待验证`
- 画布：支持 Ctrl+C/Ctrl+X/Ctrl+V；剪贴板图片和外部拖入图片均进入项目资产链路并生成容器。左键空白拖动用于框选，中键或 Space/Alt+左键平移；多选图片可从统一连接头批量连接到需求节点。
- Agent/CLI 图操作：共享 automation command schema 同时驱动 Renderer 注册表、PowerShell CLI 参考和契约测试。`canvas.state` 返回权威 `canvasRevision`、锁、关系与活动状态；`canvas.select` 在改变选择前校验全部 ID 和 primary，不允许 stale 集合部分生效。所有图 mutation 强制 `expectedProjectId`，并可携带 `expectedCanvasRevision` 做 canvas compare-and-set；Requirement update/execute 额外强制 `expectedRevision`。连接/断开、归组/解散、位移及 Requirement create/update 在完整存在性、锁、关系、循环和 binding 预校验后一次提交，任一项失败则整批不落盘；execute 在派发 Agent 前完成 revision/TaskScope fence，随后复用 GUI 的生产执行链路，异步 provider 和结果持久化不属于同一原子提交。
- 批次：新增 `imageBatchSize`，默认 3、范围 1–10。Agent 多图工具和手工生图均按批次顺序派发，批内并行；Runtime 总任务参数可承载更大批量，产品不声明未经人工验证的固定总上限。
- 运行控制：Main 以 `projectId + conversationId + Renderer owner` 持有父 AbortController、暂停状态、运行节点锁、有界 steer 队列和可中断 child phase；即使两个窗口打开同一项目/会话，暂停和结束也互不串扰，重叠节点仍互斥。Renderer 关闭或崩溃会一次性停止该 owner 的全部运行并立即拒绝它挂起的 CLI 请求；最后一个 run 结束会回收 scope，应用退出先停止所有 run，再拆 transport。暂停停止派发后续边界，恢复继续，结束真实中断父运行；Renderer 以同步 stop fence 阻止重复 IPC，并在 Main 返回有效 `ok: true` 前保持 active run、reservation、占位、stream 与 paused 状态，失败后解除 pending 并允许重试，不能先进入假 idle。“修改”只中断当前模型/工具 phase，在同一协议历史追加新用户意图后重新规划。queued steer 会阻止边界后新 phase 启动；替换 TaskScope 时节点锁随权威 SOURCE 重算，并在应用前复核跨会话锁冲突。主窗口与独立窗口都可显式选择保留、替换、追加或清空 SOURCE/REFERENCE；Main 在中断前归一化、重哈希并保存新快照，CLI 也可独立传 `sourceMode`/`referenceMode`。已完成图片保留；上游已接受的 provider 请求仍按 admission 排空且可能计费。
- 并行：运行中切换项目或新建会话会打开独立 Renderer，避免旧项目异步结果写入新项目。项目 session 升级为 v5：`nodeMutationJournal` 记录 upsert/delete/restore 及顶层 `fields`，Main 串行分配 commitRevision；writer checkpoint 只由真实写入窗口续命，30 天未活跃 writer 可退出 GC quorum；已确认的 delete/restore 可压缩为 causal barrier。delete tombstone 阻止旧窗口复活节点，显式 undo 可恢复自己已观察的 tombstone；并行创建的冲突 ID 与引用仍按 `persistenceOriginId` 自动重映射。
- 合并边界：不同顶层字段按各自 mutation clock 合并，同字段仍以 Main 提交顺序决胜；assets、生成终态/进度、provenance 等保留专用兼容策略。它不是递归字段 CRDT，也不覆盖跨进程/远程多人协作；上游已接受的模型/图片请求在 steer 后仍可能计费。
- 权威文件：`src/canvas-clipboard.ts`、`src/project-agent-composer.tsx`、`src/agent-stop-request.ts`、`src/automation-command-runtime.ts`、`runtime/image-batch-scheduler.cjs`、`desktop/agent-run-control.cjs`、`desktop/project-session-merge.cjs`、`desktop/ipc/{agent,server,config,window}-ipc.cjs`、`agent-runtime.cjs`、`src/main.tsx`、`agent-window-*`、`integrations/naimage-control`。
- 证明：`test:node-mutation-journal` 22 cases、`test:project-session-merge` 70 cases、`test:project-save-coordinator` 18 cases、`test:project-session-dual-renderer` 5 类真实双 Renderer 场景、`test:project-io`、`test:canvas-commands`、`test:selection`、`test:requirement-graph`、`test:agent-run-control`（owner 隔离/销毁/stopAll/scope GC/IPC）、`test:agent-steer` 24 cases、`test:goal-probe-dual-renderer`、`test:lifecycle`、`test:agent-window` 44+54 cases、`test:agent-window-ui` 15 cases、`test:agent-panel-ui` 17 cases、`test:automation-service`（共享 schema、Graph CLI 与 Renderer pending 立即拒绝）、`test:ipc-registration`（95/92/3）、`typecheck`。`aidebug:graph-cli` 的最终 5 场景/0 failures 报告为 `.diagnostics/electron/aidebug-graph-cli-2026-07-29T16-05-00-768Z/report.json`，配套 review/montage 位于 `.diagnostics/aidebug-review/review-graph-cli-2026-07-29T16-05-00-768Z/`；`aidebug:stop-pending` 的失败保留、可重试与成功收尾报告为 `.diagnostics/electron/stop-pending-2026-07-29T15-46-22-746Z/report.json`。这些直接专项已通过，但新完整 workpack 还必须分别执行 `session-consistency-agent` 与 `agent-control-agent` 的全部声明任务，并绑定 control lane 的 `gui-stop-pending` review；collect 前本项保持 `已实现待验证`。

### 14. 当前画布全图片容器 Goal 模式

- 状态：`已实现待验证`
- 冻结范围：普通 Goal 默认对当前画布全部合格图片容器执行同一要求；GUI/CLI 显式给出节点范围或电商选择母图时，只纳入该精确边界。预检排除空、纯 REFERENCE、生成中或 stale 的容器，并保留容器内每个图片槽位的独立 `bindingId`。确认时冻结有序 `all-image-containers` TaskScope、容器/binding 计数、并发策略、`operationsPerAsset`、`requestCount`、可选 `commercePlanHash` 和 `snapshotHash`；派发前再次校验，画布、Prompt、每图操作数、费用或电商计划变化都必须重新预览和确认，禁止静默扩大、缩小或改写范围。
- 并发保护：先从 1–2 个不同容器各取一张代表图串行 probe。每个 probe 只有在请求成功、项目资产落盘、完整图片解码、宽高均非零且交付画幅验证通过后才算成功；全部 probe 通过后按 `2 → 4 → 设置中的并发上限` 渐进放量。所有 Renderer 共享 Main 进程 Goal admission：等待 probe 优先于新 ramp，多个已通过 Goal 公平共享冻结进程容量；同一项目同时只允许一个已确认 Goal。任一 probe 失败立即停止未派发任务，后续基础设施/落盘/验证等保护性失败或集中失败打开跨 Goal circuit。
- 计费边界：限流、5xx 或网络重试会暂停全部新 ramp；窗口退出、停止或 Abort 后，已经启动的请求仍占用 admission token，直到真实 provider Promise 收尾。probe、取消和熔断只能阻止尚未派发的工作；已经被上游接受的模型或图片请求仍可能完成并产生费用，客户端不能追回该费用。真实视觉质量属于人工判断，不能替代落盘、解码和画幅这些确定性 probe 条件。
- 输出矩阵：每个 binding 的输出数由冻结的 `operationsPerAsset` 决定，`requestCount = bindingCount × operationsPerAsset` 且总数不得超过 200。模型对整个 Goal 仍只能调用一次 `image_gen(scopeExecution="all-goal-sources")`，由 runtime 展开完整矩阵并保留独立来源/provenance；只支持 `edit | replace | variants`。普通 Goal 在 `operationsPerAsset > 1` 时，相同 Prompt 可省略 `items` 由 runtime 重复，逐项 Prompt 则必须提供与冻结输出数等长的 `items`；layers、cutout、redraw 和额外 REFERENCE 仍不支持。
- 电商矩阵合同：电商 Goal 必须从可信任务 Prompt 恢复与冻结值一致的计划，并原样提交 `commercePlanHash`。多项计划必须使用与 `operationsPerAsset` 完全等长的 `items`，每项按可信顺序携带自己的 `slotId`、`slotIndex`、`localeCode`，顶层不得重复这些元数据；单项计划必须省略 `items`，把同三项元数据放在顶层。没有冻结 `commercePlanHash` 的普通 Goal 禁止注入计划标记、hash 或任何槽位/语言元数据，所有不匹配都在 provider 派发前拒绝。
- 运行中边界：Goal 的 SOURCE/REFERENCE 与费用范围来自用户确认的冻结快照，因此运行中只允许文字 steer，不允许替换、追加或清空素材；改变范围必须结束并重新确认新的 Goal。普通非 Goal Agent 任务仍可使用显式 TaskScope 替换协议修改 SOURCE/REFERENCE。
- 镜像不变量：主窗口、独立 Agent 窗口、runtime、`agent.goal`/`commerce.compose-set` CLI、共享 automation command schema、Skill 文档和专项测试必须共享同一预览/确认协议、冻结计数/hash、矩阵形状、`all-goal-sources` 枚举、probe/放量/熔断说明和费用边界，任一表面不得自行枚举 binding、修改计划或绕过确认。
- 权威文件：`src/goal-task-scope.ts`、`src/goal-mode.ts`、`src/plugins/commerce-set.ts`、`src/core.ts`、`src/project-agent-composer.tsx`、`src/main.tsx`、`runtime/goal-image-execution.cjs`、`runtime/goal-probe-admission.cjs`、`runtime/image-batch-scheduler.cjs`、`runtime/tool-schemas.cjs`、`agent-runtime.cjs`、`src/automation-command-runtime.ts`、`integrations/naimage-control/` 与 `agent-window-*`。
- 证明与缺口：`test:goal-task-scope`、`test:goal-runtime`、`test:goal-probe-admission`、`test:goal-probe-dual-renderer`、`test:image-batch-scheduler`、`test:automation-service`、`test:agent-window`、`test:agent-steer`、`test:commerce-set` 和 `typecheck` 已提供当前定向逻辑/协议证明；`aidebug:goal` 的 2026-07-29 报告只证明当时的基础 Goal UI，当前电商 UI 由 `.diagnostics/electron/commerce-set-2026-07-30T03-25-55-222Z/report.json` 直接证明。两者都不能替代绑定当前全部输入 hash 的 SUPER GOAL workpack；在新 closure 的 `inputDrift=0` 且对应 lane/task/review 全部通过前，本项保持 `已实现待验证`。

### 15. 图片格式与本地导出

- 状态：`已验证`
- 上游格式：生图 SOURCE/REFERENCE 输入与上游图片结果支持 PNG、JPEG、WebP；未显式指定时，`image_gen.outputFormat` 默认 PNG。Electron Main 在发起模型请求前拒绝未知输出格式；Main、Agent fallback 与浏览器回退都校验 base64 实际魔数必须匹配请求格式，失配作为验证失败而不是按错误扩展名落盘。生成结果仍进入项目受管资产链路，不能用导出副本替换其身份。
- 本地另存：单张画布图片可导出 PNG、JPEG、WebP、AVIF 或 TIFF；分层成果继续保留现有 Photoshop PSD 导出，不把 PSD 降级为单张栅格格式。
- 远程结果边界：Provider 返回 URL 时不再把 URL 直接交给画布。Main 对首跳和每个重定向目标执行公网 HTTP(S) 解析，拒绝 localhost、回环、RFC1918、链路本地、保留地址和混合公网/私网 DNS；实际请求禁用共享连接池、固定已验证 DNS，并复核真实 socket 地址。全局最多并行 2 个真实远程下载，相同 URL 的并发消费者共用一个在途结果，避免批量结果形成 `N × 128 MiB` 峰值。下载结果通过真实格式、尺寸和完整解码后落为项目受管文件。历史项目中已记录的远程 URL 只可经 `naimage-asset:` 兼容代理读取，Renderer CSP 禁止直接 HTTP(S) 图片请求。
- 计费与文件边界：格式转换在 Electron Main 内使用 Sharp 本地完成，不调用 Agent 或图片模型，也不消耗生图额度。JPEG 不支持 alpha，导出时固定以白色背景展平；其他格式按各自透明度能力处理。Main 以真实解码格式而非扩展名决定复制或转码，以真实路径和 `dev + ino` 拒绝同路径、符号链接或硬链接覆盖，并先写临时文件、完整解码；确认覆盖使用原子替换，新目标优先以同卷 hard-link 原子发布，不支持 hard-link 的文件系统回退到 `COPYFILE_EXCL` 排他复制且绝不覆盖抢先创建的文件。所有另存都必须经原生 Save 对话框由用户选择目标；既有目标还要在 Main 目标锁内最终确认，转换只读取受管源图并写入用户授权位置，不覆盖或修改项目中的源资产。
- CLI 镜像：`canvas.export-image` 与 GUI 共用同一 `saveAssetAs`/原生对话框链路，参数只选择 `nodeId`、`assetIndex` 与格式，不接受命令 JSON 直接指定任意目标路径。
- 权威文件：`runtime/encoded-image-format.cjs`、`desktop/image-export-service.cjs`、`desktop/public-http-resource.cjs`、`desktop/remote-asset-proxy.cjs`、`desktop/ipc/asset-ipc.cjs`、`preload.cjs`、`src/core.ts`、`src/remote-asset-source.ts`、`src/main.tsx`、`src/server.ts`、`src/automation-command-runtime.ts` 与 `integrations/naimage-control/`。
- 证明：`test:image-export` 覆盖五种格式、PNG/JPEG/WebP 输入矩阵、错误扩展名、截断图片完整解码拒绝、硬链接源保护、既有目标原子替换、不支持 hard-link 时的排他复制、picker 返回竞态最终确认、cleanup 终态隔离、JPEG 白底像素与原生 picker；`test:remote-asset-security` 覆盖编码/数字主机、IPv4/IPv6 私有地址、混合 DNS、逐跳重定向、DNS pin、真实 socket 复核、连接池禁用、响应上限、URL 结果落盘与 Renderer 直连禁止；`test:automation-service` 覆盖 `canvas.export-image` CLI/schema、真实失败的顶层 `ok:false` 与非零退出码，`test:ipc-registration` 保持 preload/IPC 对称。

### 16. Bundle 与产品性能分层门禁

- 状态：`已固化`
- Bundle 硬门禁：initial JS 目标 685,000 B，并允许额外 1,024 B 测量容差；超过目标但未超过 686,024 B 时记录 advisory，超过 686,024 B 才失败。plugin JS 120,000 B 与 CSS 270,000 B 为无额外容差的硬门禁；插件 chunk 必须存在且保持异步，AIDebug marker 泄漏或无法识别首屏入口同样失败。
- Bundle advisory：core async JS 190,000 B、core JS 870,000 B 与完整 dist 1,200,000 B 保留为增量趋势目标和告警，不再单独导致 `test:bundle` 失败。advisory 不是删除优化工作的理由，后续 Renderer 增量仍优先迁入自然异步模块，但不得为旧基线增加高风险重构或复杂拆分。
- 性能硬门禁：`aidebug:performance:product` 独立验证正式产品的启动、内存、缩放、平移、拖动与 long task；Bundle advisory 通过不能替代该门禁，正式发布编排必须同时执行两者。
- 证明：`test:bundle-policy` 固定 hard/advisory 分类和 1,024 B 容差，`test:bundle` 检查生产制品分层、插件异步与诊断泄漏，`aidebug:performance:product` 是独立发布硬门禁。2026-07-30 透明玻璃与素材 Rail 批次把 workspace chrome 迁入 7,420 B 自然异步 chunk、Glass Lab 拆为 7,790 B JS + 12,410 B CSS 异步资源；构建为 initial JS 682,657 B、core async JS 185,368 B、plugin JS 19,042 B、CSS 262,872 B、core JS 868,025 B、dist 1,198,764 B。新功能基线保留 initial/plugin/CSS 硬门禁，core async/core/dist 只作趋势 advisory；不得仅为跨越旧数字牺牲可维护性、引入高风险重构或复杂拆分。

## 已固化基线

### 2026-07-28 · 账户密钥与 Agent 自动化

- Git：`3923017 feat: add account tokens and agent automation`
- 能力：New API 账户密钥选择与 CRUD、账号模式账户 Key 直连、naimage loopback 自动化、Agent Skill 安装、Agent 面板和提示词交互的上一批改进。
- 已有验证证据：`typecheck`、账户令牌 selftest、设置持久化 48 cases、IPC 注册、自动化服务、Agent 集成、Skill quick validation、正式 build 与 bundle。
- 正式 bundle 证据：initial JS 630714 B，total JS 687209 B，CSS 185388 B，dist 928386 B。

## 变更日志

- 2026-07-30：跨境电商工具栏升级为一键生成套图与一键多国语言；支持多母图、1–12 个逐槽 Prompt、逐语言要求和 Requirement/Skill 计划复用。Goal 同步冻结 `operationsPerAsset`、`requestCount`、`commercePlanHash`，按最多 200 请求的矩阵执行，并在 runtime 严格校验多项 `items`、单项顶层元数据和普通 Goal 禁止 commerce 元数据。当前定向逻辑、类型和 15 项/14 图 Electron GUI 报告已通过；最终完成状态仍等待与当前输入 hash 一致的新 SUPER GOAL closure。
- 2026-07-30：最终 workpack 复验捕获并修复 AIDEBUG 并发证据目录竞态：两个独立 runner 同毫秒启动时不再共用 `run-<timestamp>`，现改为时间戳加 UUID 后缀并独占创建；专项以 4 个并发 runner 验证报告目录互不覆盖。原失败 workpack 保留不可变失败 closure，不覆盖历史证据。
- 2026-07-30：SUPER GOAL 首个完整 workpack closure 对其 2026-07-29 冻结输入通过：6/6 owner lanes、17/17 定向任务、4/4 人工视觉 review、20 张协议认可截图且零输入漂移；不可变历史 closure SHA-256 为 `0c6df74e42a01be739d07c3443d7d9fa7ce28825a3547b2cf62f690634114e6e`。它保留为对应旧输入的历史证据，不能证明随后加入的电商矩阵/费用门禁、session v5 journal、真实双 Renderer 冲突和显式 TaskScope steer；当前完成证明必须来自重新 emit/collect、manifest 输入 hash 与当前 `GOAL.md`、`AIDEBUG/SUPER_GOAL.*` 及控制面完全一致且 `inputDrift=0` 的新 workpack closure。
- 2026-07-30：补齐共享 schema 驱动的画布 Graph CLI：`canvas.state` 提供权威 revision，严格选择不接受 stale 子集；图 mutation 强制项目 guard、可选 canvas revision CAS，Requirement update/execute 强制自身 revision。图变更在完整预校验后一次提交，execute 只在异步派发前建立 fence。真实 Electron CLI 闭环以 5 场景、0 failures 在 `900x640` Renderer CSS 视口完成截图、montage 与人工 review；未记录原生 BrowserWindow bounds。Agent stop fence 同步以真实失败保留、重试成功三态证据闭环，`test:agent-window` 更新为 44+54 cases，IPC 当前为 95/92/3。
- 2026-07-30：session v5 在旧 journal 基线上增加顶层字段时钟、writer checkpoint、30 天 quorum 过期和 delete/restore causal barrier GC；真实双 Renderer 覆盖编辑/删除、删除/撤销、连续快速保存与窗口异常退出。图片格式/五格式本地导出、Goal probe-first 并发与 TaskScope steer 的 GUI/CLI 镜像保持同步。
- 2026-07-30：透明玻璃工作台加入六主题、三材质、Glass Lab、真实左侧素材 Rail 与 Workbench/Focus/Review；workspace chrome 和 Glass Lab 维持自然异步边界。Bundle 以本次实质功能重置可维护基线：initial 685,000 B + 1,024 B 容差、plugin 120,000 B、CSS 270,000 B 继续 hard；core async 190,000 B、core 870,000 B、dist 1,200,000 B 改为趋势 advisory。
- 2026-07-29：AIDEBUG 多 Agent 工作包从静态分派单升级为 workpack v2 可恢复闭环：固化目标与控制面 hash，提供原子 claim、wave 屏障、跨 workpack 资源锁、checkpoint、stale reclaim、确定性结果回链、真实 GUI 截图/montage/reviewer 绑定和不可变 closure report；新增单一 `test:aidebug-workpack` 专项，不运行全量测试。
- 2026-07-29：统一图片格式与导出合同：上游输入/结果支持 PNG、JPEG、WebP，且默认 PNG；本地可经原生 Save 对话框用 Sharp 导出 PNG/JPEG/WebP/AVIF/TIFF，JPEG 白底展平且不修改受管源图，不调用模型或消耗生图额度；分层 PSD 保留，CLI 同步 `canvas.export-image`。
- 2026-07-29：Bundle 改为分层门禁：initial/core async/plugin/CSS 为 hard，其中 initial 670,000 B 另有 1,024 B 测量容差；core JS/dist 为 advisory；正式交互性能继续由 `aidebug:performance:product` 独立硬门禁负责。
- 2026-07-29：新增当前画布全图片容器 Goal 模式：确认时冻结全部合格容器与 binding，runtime 以一次工具调用展开；先串行 probe 1–2 个不同容器代表图，确定性验证通过后按 2→4→配置上限放量，失败立即停止或熔断。GUI、独立窗、`agent.goal` CLI、共享 schema 和定向逻辑测试已同步；专用 `aidebug:goal` 已以 4 个场景、0 failures 完成真实可见验证，Goal 模式和最终分层 Bundle 均已验证。
- 2026-07-29：完成节点 mutation journal 与 Agent steer 的初版：Main commitRevision、delete tombstone 和显式 restore 解决同进程多窗口编辑/删除旧节点；运行中“修改”可中断当前模型/图片 phase、保留父运行并按新意图继续。该持久化合同随后已升级到上方记录的 session v5。`naimage-control` 同步新增 steer/pause/resume CLI 命令；专项、IPC/typecheck、正式构建、Bundle 与快速 GUI 均通过。
- 2026-07-28：完成画布复制/剪切/粘贴、剪贴板与拖入图片成容器、框选与多源需求连接；新增可配置图片批次、Agent 暂停/恢复/真实结束、项目+会话节点锁和隔离 Renderer 并行。旧 revision 保存改为合并最新 session 并重映射并行节点冲突；专项、项目 IO、正式构建和 Bundle 已通过。
- 2026-07-28：完成 `naimage-theme v1` 自定义主题导入、导出、编辑和浅/深色实时预览；长插件 Prompt 移到 Electron 受信任服务，IPC 更新为 88/85/3；快速 GUI、专项测试、正式构建和 Bundle 已验证，总 JS 719,928 B。
- 2026-07-28：交付 `sparkai.project-graph` 视觉学习插件；新增受限 `.prg`/JSON 适配、MessagePack 解码、只读 IPC 和独立异步 Prompt 模块，真实 Project Graph 样例与生产 Bundle 已验证。
- 2026-07-28：建立受信任的声明式插件系统并交付首个跨境电商多语言套图插件；支持安装、授权、启停、卸载、画布工具栏贡献和最多 10 种语言选择，插件 Runtime 进入异步 chunk；Project Graph 适配随后在独立批次完成。
- 2026-07-28：完成账户密钥额度人民币显示；动态读取 New API 公开额度单位和美元汇率，保留 R/原始 quota 审计信息，快照懒加载不额外联网且不持久化派生文案。
- 2026-07-28：完成图片容器流式中间预览；手工与 Agent 并发生图按 operation/槽位归入目标容器，移除独立预览节点及对话窗口内 partial，最终态按槽位清理。
- 2026-07-28：完成设置接入状态懒加载；账户密钥与模型/分组优先读取本地脱敏快照，显式按钮单击才访问 New API，并移除六次点击强刷逻辑。
- 2026-07-28：完成真正的独立 Electron Agent 窗口；主 Renderer 权威状态与独立表面双向同步，浮窗可发送/停止任务、管理会话和图片上下文并收回任一停靠方向，定向双窗口测试完成真实 mock Agent 往返。
- 2026-07-28：完成 Agent 四向停靠与应用内浮动，独立窗口仍待实现；完成自定义模型文案、提示词复制区布局和 resize 零 React 高频提交优化，并新增 16 项纯布局测试与 17 项 Electron 定向 UI 验证。
- 2026-07-28：完成模型感知上下文策略和 Codex 式 checkpoint；修复 Codex 长消息仍被 12K 字符截断的问题，新增 16 项 Runtime checkpoint 专项验证。
- 2026-07-28：创建长程目标文档；开始目标 1/7 的上下文策略系统。
