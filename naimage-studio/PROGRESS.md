# SparkAI WorkSpace 进度

当前：阶段 1–12 已完成。AIDebug/GUI/性能测试现在必须使用隔离的 `user-data` 与 config，危险目录会 fail closed，测试 fixture 和自动保存不再进入真实画布；两个 Windows 1.0.9 x64 测试安装包已重新生成。
下一步：交由本地安装与交互测试；不自动删除无法可靠归因的现有用户图片。正式发布时仍需执行 Bundle、签名及完整发布验收。

Harness 治理轨道：已完成。历史对话、产品意图与双仓边界已归纳为工作区入口、决策账本、任务协议、验证矩阵、完成审计及零依赖结构校验；`node scripts/verify-harness.mjs` 已通过。该轨道不改动阶段 10 的产品实现或其专项验收范围。

视觉基线：共享 Glass token 已覆盖图片容器、成果/Requirement/科研 Panel 和 AI 教练表面；现有七套主题新增“雾银玻璃”，新装默认“蜜橘融光”；作品内容保持清晰不透明，`test:workspace-glass-ui` 142 cases 通过。
模型默认：对话使用目录中真实存在的 `gpt-5.6-terra`，生图使用 `gpt-image-2`；模型目录仍完整保留上游原始 ID 与大小写。
品牌：用户可见名称已统一为 `SparkAI WorkSpace`；内部 `naimage` 兼容标识保持不变。
近期专项验证：四工作台逻辑专项与真实 Electron 切换通过，`884×640` 仍显示工作台文字，5 张截图、0 Renderer 错误、0 模型请求；未执行全量测试。

| 阶段 | 状态 | 简要进度 |
| --- | --- | --- |
| 基线 | 已完成 | 现有通用画布、Commerce、插件、TaskScope、Requirement、图片/视频受管链路和共享 automation registry 可复用。 |
| 1. 四模式基础 | 已完成 | 四领域注册表、顶部切换、新项目入口、Session/独立窗/Agent 上下文、插件投影和 `workspace.domain.*` 已闭环。 |
| 2. 电商投影 | 已完成 | 电商 Agent 提示、底部工具栏和左素材轨共用现有六个 Commerce 命令；未启用时直达相关设置。 |
| 3. 社媒工作台 | 已完成 | 社媒插件、小红书/抖音计划与 Requirement/provenance、首次引导、视频 journal、原生发布包和共享命令已闭环。 |
| 4. 科研绘图 | 已完成 | 计划、Requirement、受控 Python/R Runner、Panel/组合图、导出、7 个共享命令、科研工具投影与玻璃 GUI 已闭环。 |
| 5. AI 示例教学 | 已完成 | 已交付状态驱动的跨境套图陪练：导入/粘贴、选图、切换工作台、套图工具/Agent 两路引导、费用边界、真实成果检测、成功特效与徽章。 |
| 6. MCP 与调试 | 已完成 | 76 个共享命令由同一 schema 驱动；MCP stdio 只转发 loopback bridge，7 个 `debug.*` 命令受开发态/白名单/脱敏/固定目录约束，生产默认拒绝。 |
| 7. 双发行接入 | 已完成 | `dual-access` / `sparkapi-account` 共用代码；专用版固定 SparkAPI、强制账号模式并由 Main 拒绝自定义配置。两种 Vite 产物、登录 GUI 和独立 NSIS 测试安装包均已生成验证。 |
| 8. Agent 输入体验收尾 | 已完成 | 比例/清晰度改为宽版玻璃菜单；模型、素材、模式和画幅组成紧凑工具栏；普通/Goal 由单按钮展开双瓣扇形；具备保存语义的关闭入口统一提供保存、放弃和继续编辑。 |
| 9. 四工作台可发现性 | 已完成 | Renderer/Electron 以一次性版本迁移默认启用电商、社媒、科研第一方组件，并保留用户后续停用/卸载；最小窗口显示工作台文字，真实 GUI 覆盖四种切换与 6/5/6 项工具。 |
| 10. 套图执行可靠性与画布引导 | 已完成 | 执行前费用/完整冻结字段为非阻断；普通并发生图同批启动、逐张增量更新同一图片组并按完成顺序展示，Goal 每个母图归为一个结果组。画布 partial 按请求槽位原位替换、不持久化，最终图到达后下一动画帧清理；查看器只读取最终资产并使用上方大图、下方单行横向列表；普通图片/容器拖动使用合成层 transform 预览，松手单次提交坐标；关键字号和搜索下拉实色可读性已提高。连接点、原图聚焦、教学、素材组预览、电商菜单和工具显隐均已闭环。 |
| 11. 密集画布缩放性能 | 已完成 | wheel 输入按 `requestAnimationFrame` 合并为每帧一次 stage transform；图片 tile 达到 10 个时，缩放/平移交互暂时停绘媒体、关系线和高成本阴影，结束后恢复；低缩放远景使用仍可选择和拖动的轻量节点轮廓。AIDebug、production-like 门禁、production build 与双版本 EXE 重建均已通过。 |
| 12. 测试项目隔离 | 已完成 | 显式 `--user-data-dir` 默认写 `<user-data>/data`；AIDebug 对仓库 config、真实 AppData 或隔离根外目录非零拒绝；preload 只读运行时标记与 Renderer 双门禁只有在 Main 确认隔离后才开放可写调试控制面。Main 与真实 GUI 隔离专项、production build 和双版本 EXE 重建均通过。 |

阶段 1 验证：`typecheck`、`test:workspace-domain`、`test:plugin-system`、`test:agent-window`、`test:automation-service` 与单一 Electron `aidebug:workspace-domain` 均通过；未运行全量测试。
阶段 2 验证：`typecheck`、`test:workspace-domain`、`test:plugin-system` 与单一 Electron `aidebug:workspace-domain` 均通过；0 Renderer console error，未调用真实模型。
阶段 3 验证：`typecheck`、社媒计划/导出、领域、插件、视频、automation、IPC 专项均通过；IPC 为 128/125/3。单一 Electron `aidebug:social-content` 通过，3 张截图、0 Renderer console error、0 模型/生成请求。
阶段 4 验证：`typecheck`、科研 Runner、automation、IPC（135/132/3）和 130 项 Glass 合同已通过；`aidebug:scientific-figure` 通过，报告为 `.diagnostics/electron/glass-workspace-2026-08-03T09-53-46-537Z/report.json`，3 张截图、0 Renderer 错误、0 模型请求、0 Runner 执行。
阶段 5 验证：`typecheck`、130 项 Glass 合同与 `aidebug:commerce-tutorial` 通过；报告为 `.diagnostics/electron/glass-workspace-2026-08-03T10-13-20-954Z/report.json`，3 张截图、0 Renderer 错误、0 模型/Provider 请求。
阶段 6 验证：`automation:generate --check`、`test:automation-debug`、`test:mcp-wrapper` 与本批 `typecheck` 通过；MCP 共投影 76 个工具，调试专项覆盖脱敏、生产拒绝、无 Renderer service 分流和 stdio 转发，未调用模型。
阶段 7 验证：`test:access-variant`、`test:ipc-registration`（135/132/3）、`typecheck`、Node/JSON 语法检查、`build:unrestricted`、`build:sparkapi` 及两次 `aidebug:auth-gate` 均通过；专用版专项明确检查登录页无自定义入口、设置页官方地址只读且 Main IPC 拒绝绕过。双 NSIS 测试开发安装包于 2026-08-04 生成，未调用模型。
阶段 8 验证：`typecheck`、`test:settings-lazy-load`（63 cases）、`test:ui-foundation`、`test:commerce-catalog-ui`（82 cases）和 `test:agent-panel-ui`（50 cases）通过；`test:agent-text-ui` 的本轮未保存关闭路径通过，总体 153/155，剩余两个为模型列表 roving Tab 与运行中 composer 的旧静态断言，未按本轮专项范围扩张处理。GUI 证据位于 `.diagnostics/electron/agent-panel-ui-2026-08-04T06-46-31-282Z` 和 `.diagnostics/electron/agent-text-ui-2026-08-04T06-52-51-923Z/report.json`。
阶段 9 验证：`typecheck`、`test:settings-persistence`（118 cases）、`test:plugin-system`（115 cases）、`test:workspace-domain`（47 cases）、`test:access-variant` 与 `node --check electron-main.cjs` 通过；真实 `aidebug:workspace-domain` 报告为 `.diagnostics/electron/glass-workspace-2026-08-04T07-36-40-071Z/report.json`，5 张截图、0 Renderer 错误、0 模型请求，切换保持同一画布、选择与 Agent 状态。
阶段 10 最终验证：`test:workspace-glass-ui`（142 cases）、`test:image-stream-preview`（23 cases）、`test:custom-api-transport`（18 cases）、`test:image-batch-scheduler`、`test:goal-runtime`（43 cases）、`test:commerce-catalog`、`typecheck` 与 `test:aidebug-glass-workspace` 均通过。Agent 夹具强制两张并发请求逆序完成，验证逐张 `image-result`、同一 operation 图片组增量为 1→2 张及最终完成顺序。真实 Glass GUI 报告为 `.diagnostics/electron/glass-workspace-2026-08-05T05-45-00-365Z/report.json`：28 checks / 34 screenshots / 0 应用级 console error / 0 生图网络；查看器为 3 张最终图、0 partial、单行横向滚动，容器拖动期间 `transform=matrix(1, 0, 0, 1, 133, 78)` 且 `left/top` 不变，松手坐标由 `160,170` 更新为 `293,248`，临时变量与 `will-change` 已清理；body/Agent 状态/输入框/模型字号分别为 14/12/14/13 px，搜索层 alpha 为 1 且 `backdrop-filter=none`。无付费 partial 报告为 `.diagnostics/electron/aidebug-2026-08-05T05-51-40-277Z/agent-image-suite.json`：3 个图片任务均观察到 `1/3 → 2/3 → 3/3` 和不同源指纹，`maxConcurrentTiles=1`、`finalPreviewCount=0`。未调用真实模型、全量测试或 Bundle 门禁。
阶段 11 性能验证（2026-08-06）：`typecheck`、`node --check scripts/aidebug/suites/performance.mjs` 与 `git diff --check` 通过。完整 AIDebug 性能报告 `.diagnostics/electron/aidebug-2026-08-06T09-33-39-213Z/report.json` 为 `ok: true`、`failures: []`；10 图 4K 容器上的 `denseViewportZoom` 将 80 次 wheel 合并为 10 次 stage 样式写入，帧 P95 5.7 ms、交互阶段 0 Long Task，降载 class 在结束后正确清理。三轮 production-like 报告 `.diagnostics/electron/product-performance-2026-08-06T09-34-48-686Z/report.json` 为 `productPerformanceReady: true`，zoom frame P95 33.1 ms、交互 Long Task 最大值 0，全部 checks 通过；总 runtime bundle 仅保留 advisory 超限，不阻断测试开发 EXE。
图片容器即时复拖修复（2026-08-06）：根因是移动中的容器露出下层 `.node-image-tile` 后，Chromium 原生 `dragstart` 会中断节点 pointer stream。当前活动节点拖动会取消这次原生资产拖动，正常图片提取/归组仍保持可用。`test:automation-debug` 通过（7 个命令、脱敏、生产拒绝）；CLI `canvas.state` 读取当前项目为 17 节点、16 图片节点及 6/11 图容器。真实 AIDebug `.diagnostics/electron/aidebug-2026-08-06T08-19-03-782Z/canvas-image-collection-suite.json` 中 layout mutation 与 `immediateContainerRedrag` 全部通过，第二次按下/移动立即生效、最终位移提交、无原生 drag 接管、无 `pointercancel`、无阻塞动画。完整图片集合套件仍仅有既有 `canvas-mixed-prompts-batch` 与 `collection-member-editor-preserves-asset-index` 两项无关失败。`typecheck`、Workspace Glass 142 cases、图片容器 12 cases、图片布局 14 cases 与 production build 通过。
阶段 12 最终验证（2026-08-06）：`test:aidebug-options`、`test:aidebug-isolation`、`typecheck`、真实 `aidebug:isolation` 与 production `build` 均通过。Main 隔离报告 `.diagnostics/electron/aidebug-isolation-2026-08-06T10-13-44-879Z/report.json` 证明临时配置文件和默认项目全部位于 `<user-data>/data`、仓库 config 哈希/时间戳不变，并对显式仓库 config 非零拒绝。真实 Vite + Electron + CDP 报告 `.diagnostics/electron/aidebug-isolation-gui-2026-08-06T10-24-52-327Z/report.json` 证明运行时双门禁开启、创建与移动容器后的 session commit 只写临时项目、仓库 config 不变，截图为同目录 `isolated-canvas.png`。未自动删除现有画布图片，也未调用真实模型。
测试开发安装包（2026-08-06 重新生成）：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`（175,926,272 B / 167.78 MiB，2026-08-06 18:31:28 +08:00，SHA-256 `9DCE84E46286910653201C7CF320D8C77D47578C097891962A770F466FBBE142`）和 `release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe`（175,926,272 B / 167.78 MiB，2026-08-06 18:32:29 +08:00，SHA-256 `19603331D15F92A59BBF4121A80DD36F39FB7C771BFB3FDB737AE1CB507CBF3F`）；两者以 `bundleEnforced: false` 的测试开发策略构建，`test:access-variant`、安装器资源生成、两种 Vite production build、两次 Electron/NSIS、品牌安装器与品牌卸载器编译均成功。当前版本公开目录不存在 `naimage-Setup-1.0.9*` 或 `naimage-Core-1.0.9*`；较早的 1.0.7/1.0.8 历史包未改动。完成页自动关闭沿用已通过的安装器 UI smoke `.diagnostics/release/branded-installer-ui-2026-08-06T09-49-00-249Z/report.json`（`ok: true`、19 captures、约 241.3 ms 自动关闭）；本轮未重复真实安装器 UI smoke。当前未执行正式 Bundle/发布验收、Windows 数字签名验证或真实安装/卸载 smoke；最近一次隔离无网络 `package:smoke` 仍为 `.diagnostics/release/packaged-smoke-2026-08-04T10-40-27-747Z/report.json`。
已废止的错误命名产物：`release/naimage-Setup-1.0.9-x64.exe` 曾于 2026-08-05 生成（175,925,760 B，SHA-256 `91D72860279321ADD74526383EC1BB78BE846C4C9915C2918E2CD803C10DB032`），现已由统一构建脚本自动删除且不再作为测试入口；该名称只保留在本行和 v27 历史记录中用于审计。当前 `release/` 也不存在公开的 `naimage-Core-1.0.9-x64.exe` 或对应 blockmap。
品牌改名验证：安装器品牌资源生成、旧名称残留审计、JSON/Node 语法、Automation 文档一致性、`typecheck`、`test:agent-window`、`test:project-io` 与安装/卸载器 C# 编译均通过；Windows 产品元数据为 `SparkAI WorkSpace` / `namean`。
已知边界：R Runner 尚未在真实 R 环境验证；AI 陪练的完成分支未通过真实付费生图触发；Seedance 仍未进行真实付费验证。开发阶段 Bundle 超限只记录趋势，不再阻断测试 EXE；正式 Release 候选仍需通过原有门禁。未运行全量测试或正式发布验收。
