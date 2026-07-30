---
schemaVersion: 1
goalId: naimage-super-goal-2026-07
status: implemented-awaiting-current-closure
sourceOfTruth: ../GOAL.md
machineState: ./SUPER_GOAL.json
suiteCatalog: ./catalog.json
runPolicy: explicit-changed-scope-only
defaultSuite: null
evidenceRoot: ../.diagnostics/aidebug-agents
workstreams:
  - id: interaction-speed
    state: verified
    ownerLane: node-interaction-agent
    verificationTasks: [canvas-commands, selection-state, requirement-graph, gui-graph-cli]
  - id: skills-import-cli
    state: verified
    ownerLane: skills-cli-agent
    verificationTasks: [skill-import, automation-contract, gui-skills]
  - id: parallel-image-generation
    state: implemented-awaiting-current-closure
    ownerLane: parallel-image-agent
    verificationTasks: [image-batch-scheduler, image-stream-preview, goal-probe-admission, goal-probe-dual-renderer, gui-goal]
  - id: cross-border-commerce
    state: implemented-awaiting-current-closure
    ownerLane: commerce-set-agent
    verificationTasks: [commerce-set-contract, goal-task-scope, goal-runtime, gui-commerce-set]
  - id: session-consistency
    state: implemented-awaiting-current-closure
    ownerLane: session-consistency-agent
    verificationTasks: [node-mutation-journal, project-session-merge, project-save-coordinator, project-session-dual-renderer, project-io]
  - id: agent-control
    state: implemented-awaiting-current-closure
    ownerLane: agent-control-agent
    verificationTasks: [agent-run-control, agent-steer, agent-window, lifecycle, ipc-registration, gui-stop-pending]
  - id: aidebug-closed-loop
    state: verified
    ownerLane: aidebug-agent
    verificationTasks: [aidebug-options, aidebug-reporting, aidebug-fixture-bridge, aidebug-visual-review, aidebug-workpack-closure]
  - id: ui-runtime-observation
    state: verified
    ownerLane: gui-smoke-agent
    verificationTasks: [typecheck, production-build, bundle-policy, bundle-gate, gui-smoke]
  - id: asset-delivery-safety
    state: verified
    ownerLane: asset-delivery-agent
    verificationTasks: [image-format, image-export, remote-asset-security]
completionRule: every changed workstream has direct passing evidence and reviewed visual evidence when user-visible, and the current full workpack closure matches every current input hash with zero drift
goalModeState: implemented-awaiting-current-closure
historicalGoalModeAidebug: verified-2026-07-29T06-08-23-398Z
commerceSetState: implemented-awaiting-current-closure
commerceSetAidebug: verified-2026-07-30T03-25-55-222Z
closureState: pending-current-input-hash
closureWorkpack: null
closureSha256: null
historicalClosureState: verified-for-frozen-2026-07-29-inputs
historicalClosureWorkpack: workpack-2026-07-29T17-05-37-525Z-192677e4
historicalClosureSha256: 0c6df74e42a01be739d07c3443d7d9fa7ce28825a3547b2cf62f690634114e6e
---

# naimage SUPER GOAL × AIDEBUG

这份清单把长期目标与可执行专项绑定起来。`SUPER_GOAL.json` 是可机器读取和更新的权威状态，YAML front matter 是人类导航；`AIDEBUG/run.mjs` 会校验状态里的 lane/task 映射，并把它连同本文件、根目录 `GOAL.md` 的 SHA-256、大小与修改时间写入每个 workpack、run plan 和聚合报告，防止测试证据脱离目标版本。

当前长期目标保持不收缩：优化交互与速度；增加 Skills 导入并同步 Agent CLI；支持需求/Skills 节点、节点关系、快捷键、多节点操作与并行生图；持续升级真实 UI 观察、功能闭环和多 Agent 专项验证。

## 当前画布 Goal 模式

Goal 能力属于本 SUPER GOAL 的 `parallel-image-generation` workstream；当前实现已通过直接专项，但 workstream 与整体 `status` 仍等待绑定当前输入 hash 的新 closure。普通 Goal 默认把用户的一条要求应用到当前画布全部合格图片容器；GUI/CLI 显式范围和电商母图选择只冻结该精确边界。预检排除纯 REFERENCE、空、生成中和 stale 容器，为每个图片槽位保留独立 binding，并在确认时冻结有序 TaskScope、容器/图片计数、并发策略、`operationsPerAsset`、`requestCount`、可选 `commercePlanHash` 与 `snapshotHash`。主窗口、独立 Agent 窗口、`agent.goal` 和 `commerce.compose-set` CLI 必须共享先预览、后明确确认的两阶段协议；画布、Prompt、每图操作数、费用或电商计划变化后必须重新预览，hash drift 必须零请求拒绝。

高并发保护固定为：先从 1–2 个不同容器各取一张代表图串行 probe；请求成功、项目资产落盘、完整解码、非零尺寸与交付画幅验证全部通过后，才按 `2 → 4 → 配置上限` 渐进放量。所有 Renderer 共享 Main 进程 Goal admission；等待 probe 优先于新 ramp，已通过 Goal 公平共享冻结容量，限流/5xx/网络重试暂停新波次，同项目重复 Goal 被拒绝，保护性失败打开跨 Goal circuit。Renderer 退出或 Abort 后，已启动请求继续占用 token，直到真实 provider Promise 收尾；该保护不能取消上游已经接受的请求，也不能追回对应费用。

Goal v1 只支持 `edit | replace | variants`；每个 binding 的输出数由冻结 `operationsPerAsset` 决定，`requestCount = bindingCount × operationsPerAsset` 且不得超过 200。模型整个 Goal 只调用一次 `image_gen(scopeExecution="all-goal-sources")`，由 runtime 展开矩阵并保留独立来源/provenance。普通 Goal 的多输出可以复用同一顶层 Prompt，也可以提交与冻结输出数等长的逐项 `items`；额外 REFERENCE、layers、cutout、redraw 和运行中换范围仍不支持，Goal 运行中只允许文字 steer。

同步不变量覆盖 GUI、独立窗、`runtime/goal-image-execution.cjs`、`agent-runtime.cjs`、`runtime/tool-schemas.cjs`、共享 automation command registry、`integrations/naimage-control` CLI/Skill 与专项测试。当前定向逻辑入口为 `test:goal-task-scope`、`test:goal-runtime`、`test:goal-probe-admission`、`test:goal-probe-dual-renderer`、`test:image-batch-scheduler`、`test:automation-service`、`test:agent-window` 和 `test:agent-steer`。`aidebug:goal` 于 2026-07-29 通过的 4 场景/0 failures 与人工 review 是基础 Goal UI 的历史直接证据，不覆盖后来增加的每 binding 多输出、电商计划 hash 和费用矩阵合同。

## 跨境电商套图

`cross-border-commerce` 是独立 workstream 和 `commerce-set-agent` lane，避免把基础 Goal GUI 与电商 GUI 混在一份视觉 review 中。画布工具栏支持“一键生成套图”和“一键多国语言”：用户可选择一张或多张母图，配置 1–12 个套图槽位及各自 Prompt，选择最多 10 种语言并填写逐语言要求。生成模式按 SOURCE × 语言版本 × 槽位展开，未选语言时沿用母图语言；翻译模式按 SOURCE × 目标语言展开。完整计划可以只执行，也可以在 Goal 派发被接受后保存为带全部母图输入关系的 Requirement 或 Skill 节点；取消、过期、hash drift 或拒绝确认不创建可复用节点。

电商任务先由受信任服务规范化并生成确定性 Prompt/`commercePlanHash`，再进入同一 Goal 预览/确认账本。TaskScope 同时冻结 `operationsPerAsset`、`requestCount` 与 `commercePlanHash`，总请求最多 200。运行时必须从可信 Prompt 恢复同 hash 计划：多项计划强制使用与 `operationsPerAsset` 等长的 `items`，每项按顺序携带 `slotId`、`slotIndex`、`localeCode`，顶层不得重复这些元数据；单项计划强制省略 `items` 并把三项元数据放在顶层。普通 Goal 没有冻结 `commercePlanHash` 时，计划标记、hash、槽位或语言元数据全部禁止，任一形状、顺序、数量或 hash 不匹配都在 provider 派发前拒绝。

直接证据为 `test:commerce-set`、`test:goal-task-scope`、`test:goal-runtime`、`test:automation-service`、`typecheck` 与 `aidebug:commerce-set`；最新真实 Electron 报告 `.diagnostics/electron/commerce-set-2026-07-30T03-25-55-222Z/report.json` 通过 15 项检查并记录 14 张截图，未调用真实 provider。该报告证明电商表面和 mock 执行闭环，但最终完成还必须由包含 `commerce-set-agent`、当前 Goal lanes 和对应视觉 review 的新 workpack closure 证明。

Renderer-owned 运行生命周期归入独立 `agent-control` workstream：运行 scope 由 `projectId + conversationId + Renderer owner` 隔离；窗口关闭/崩溃停止该 owner 全部 run 并立即拒绝 automation pending；空闲 scope 自动回收；应用退出在 transport 拆除前执行全局停止。在途 provider Promise 仍由 Goal admission 排空，不能把本地 Abort 解释为免单。直接证据为 `test:agent-run-control`、`test:lifecycle`、`test:agent-steer`、`test:agent-window`、`test:ipc-registration` 与 `aidebug:stop-pending`；当前 IPC 注册为 95 invoke handlers、92 preload invokes、3 internal Agent invokes、5 receives、2 sends，Electron 退出报告位于 `.diagnostics/electron/lifecycle-selftest-2026-07-29T08-52-13-363Z/report.json`。这些报告继续保留为直接证据，但 lane 在新 workpack collect 前保持 `implemented-awaiting-current-closure`。

节点关系与 Agent CLI 共用一套生产合同：共享 schema 同时驱动 Renderer 命令注册、CLI 文档/参数和测试；`canvas.state` 返回权威 canvas revision、锁、关系和活动状态，严格 `canvas.select` 不接受 stale 子集。所有图 mutation 强制项目 guard，可选携带 canvas revision 做 CAS；Requirement update/execute 额外强制自身 revision。连接/断开、归组/解散、位移及 Requirement create/update 在完整节点/边集合、锁、循环和 binding 预校验后一次提交，不执行有效子集；execute 只在异步 Agent 派发前建立 revision/TaskScope fence。最终真实 Electron CLI 证据为 `.diagnostics/electron/aidebug-graph-cli-2026-07-29T16-05-00-768Z/report.json`，5 个场景、0 failures；人工审查与 montage 位于 `.diagnostics/aidebug-review/review-graph-cli-2026-07-29T16-05-00-768Z/`，报告/review/montage SHA-256 依次为 `5f724445453d3aa9a97dbe53210e3886c445db7cef9ef7426e84db562b1a81c3`、`55fbfcf3cf648c2d8d17b4ee7ade2625ab7fc0bf39ac2d73f7bb3313aa495adf`、`109abc94a7e581341d11af508e6a9fb90c23f77de24bf7c84d8804018b64ee28`。截图验证的是 Electron 内 `900x640` Renderer CSS 视口；原生 BrowserWindow bounds 未记录。

Agent stop fence 已有独立可见证据：Renderer 只在 Main 返回结构有效的 `{ok:true}` 后才清除 active run；首次结束失败继续保持 busy、reservation、占位、stream 和可重试能力，第二次成功才进入 idle。`test:agent-run-control`、`test:agent-window`（44+54 cases）和 `aidebug:stop-pending`（20 cases）均通过；真实 Electron 报告为 `.diagnostics/electron/stop-pending-2026-07-29T15-46-22-746Z/report.json`，SHA-256 `b32331ecda7038e1cf7bb0fa25e0787ac7cd9d9a3088cf0a19f30b4ce48487d7`。

项目 session v5 归入独立 `session-consistency` workstream：顶层字段 mutation clock、只由真实写入窗口续命的 writer checkpoint、30 天 quorum 过期和 delete/restore causal barrier GC 共同阻止旧 Renderer 复活已删节点，并允许显式 undo 恢复自己观察过的 tombstone。`test:node-mutation-journal` 22 cases、`test:project-session-merge` 70 cases、`test:project-save-coordinator` 18 cases、`test:project-session-dual-renderer` 五类真实场景与 `test:project-io` 覆盖 edit/edit、edit/delete、delete/undo、连续快速保存、回执前后窗口销毁和持久化往返。边界仍是同一 Electron Main 进程；它不是递归字段或远程多人 CRDT，同字段按 Main 提交顺序决胜，assets、生成终态/进度和 provenance 继续使用专用兼容策略。直接专项已通过，但该 lane 在新 workpack collect 前保持 `implemented-awaiting-current-closure`。

远程受管图片的 `asset-delivery-safety` workstream 已验证：新 provider URL 结果先经 Main 下载、真实格式/尺寸/解码校验并落入项目资产，再向 Renderer 暴露 `naimage-asset:`；历史项目中已记录的远程 URL 只能通过同一受管协议兼容读取。首跳与每个重定向只允许公网 HTTP(S)，DNS 结果固定到禁用共享连接池的一次性连接并复核真实 socket 地址；全局最多 2 个真实下载并发，相同 URL 在途去重；Renderer CSP 不再允许直接 HTTP(S) 图片加载。`remote-asset-security` AIDEBUG lane 与图片格式、导出、CLI、类型和 Bundle 专项均通过。该改动没有新增可见控件，不机械运行独立 GUI。

图片合同现为：上游输入/结果只接受真实 PNG/JPEG/WebP 字节，默认 PNG，未知生图格式在发起模型请求前拒绝；本地经同一原生 Save 授权链路导出 PNG/JPEG/WebP/AVIF/TIFF，JPEG 白底展平，其他适用格式保留 alpha，转换不调用模型、不消耗额度且不修改受管源图。GUI 与 `canvas.export-image` 共享 schema 格式注册表。Bundle 继续保留 initial/core async/plugin/CSS 硬门禁，core JS/dist 仅作 advisory；产品交互性能由独立发布硬门禁验证。后续优先使用自然异步边界，但不得仅为跨越任何 Bundle 硬门禁或 advisory 数字牺牲可维护性、引入高风险重构或复杂拆分。

AIDEBUG 多 Agent 分派已升级为 workpack v2 协议：manifest 与独立 integrity sidecar 固化目标、catalog、package scripts、runner、SUPER GOAL profile 合同校验器和协议文件；wrapper 使用原子 claim、前波全通过屏障、跨 workpack 资源锁和追加式哈希链 checkpoint；异常退出仅在 parent/child PID 均消失且 heartbeat 超时后允许显式 reclaim。每个独立 runner 的证据目录使用“毫秒时间戳 + UUID 后缀”并以非递归方式独占创建，避免同一毫秒并发进程覆盖 `report.json`。`run.mjs --result-file` 提供确定性报告回链，collect 重新验证精确 Agent/task、文件 hash 和输入漂移并保存不可变 closure 历史。完整 profile 会 fail-closed 校验每个 workstream 的 owner lane 及其全部 verificationTasks；CLI fixture 同时覆盖缺 lane、缺 task和完整 profile，另以 4 个并发 runner 验证目录唯一性。首次生产 closure `.diagnostics/aidebug-agents/workpack-2026-07-29T17-05-37-525Z-192677e4/state/closures/closure-2026-07-29T17-15-26-049Z-30ab311c.json`（SHA-256 `0c6df74e42a01be739d07c3443d7d9fa7ce28825a3547b2cf62f690634114e6e`）只验证它冻结的 2026-07-29 输入：6/6 lanes、17/17 tasks、4/4 reviews、20 张协议认可截图且零输入漂移。它是不可变历史证据，不能证明随后加入的电商矩阵/费用门禁、session v5 journal、真实双 Renderer 冲突、显式 TaskScope steer 或当前目标档案。当前 `closureState` 保持 `pending-current-input-hash`；只有重新 emit/collect 的 workpack manifest 精确匹配当前 `GOAL.md`、`AIDEBUG/SUPER_GOAL.md`、`AIDEBUG/SUPER_GOAL.json`、catalog、package scripts、runner和协议输入，且 closure 为 `inputDrift=0`、所有 owner lane/task/review 通过，才能恢复整体 `verified`。

执行纪律：

- 没有 `--profile` 或 `--task` 时不运行任何测试。
- `super-goal-specialists` 与 `ui-specialists` 必须再显式指定一个或多个 `--agent`，避免把长期目标误当成日常全量门禁。
- 每个 Agent lane 只拥有清单内的直接相关测试；独立日志写入 `workers/<agent>/`，聚合状态写入本轮 `report.json`。
- 逻辑专项可并行；共享 `electron-ui` 的 GUI 专项在同一 runner 内互斥。真正的 Codex 多 Agent 分派使用 `--emit-workpack` 生成 wave 与任务清单，runner 本身不会暗中创建模型实例或访问网络。
- 用户可见改动至少需要一次对应 GUI 专项、截图人工检查；纯逻辑或文档改动不机械运行 GUI。
- 正式发布与全量测试仍由用户明确触发，不属于本清单的默认行为。

状态更新约定：完成一个 workstream 时，只在有对应 `report.json`（以及可见改动的 `review.json`/`montage.png`）且这些证据被当前输入 hash 的 workpack closure 接受后，才把 front matter 中该项的 `state` 改为 `verified`。需求继续演进时保留历史报告和 closure，不覆盖旧证据，也不把旧 hash 的 closure 重新标成当前完成证明。
