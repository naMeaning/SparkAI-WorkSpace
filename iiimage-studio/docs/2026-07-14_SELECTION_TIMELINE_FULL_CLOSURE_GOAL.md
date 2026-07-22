# IIIMAGE STUDIO 选择、时间线与全功能闭环超长 Goal

更新时间：2026-07-14

状态：执行中

## 目标

本 Goal 以当前新版 IIIMAGE STUDIO 为唯一产品主线，持续收敛选择交互、Agent 工具时间线、成果画布、图片容器、分层 PNG、编辑与导出、会话隔离、UI、性能和代码结构，直到项目达到可阶段性交接、可真实连续使用、可通过压力测试的状态。

旧版本不是回归目标。只允许参考用户明确认可的连接点、无箭头曲线动画和部分成熟窗口布局；不得恢复旧 Agent 节点、旧手动工作流、旧信息架构、旧 Prompt 或旧上下文体系。

## 当前真实证据

### 1. 节点选择状态过度粘滞

当前 `setSelectedNodeId` 在已有选择时只允许把焦点切换到现有集合成员，普通单选 A 后再单击 B 无法切换为 B。这与最新交互要求冲突。

根因不是缺少一条点击判断，而是当前选择逻辑没有显式区分 `none`、`single`、`multiple` 三种状态，点击、框选、拖动、键盘和 Agent 当前上下文分别维护了部分规则。

### 2. 同一次 image_gen 被展示为两次工具执行

真实项目会话：

- `config/projects/project-mrjp2zlr-z2f2fu/session.json`
- 任务：把宣传图拆成背景、产品和文字三个 PNG 图层。

同一次实际执行被持久化为两套 UI 身份：

- 模型工具调用 ID：`call_U5aNyPvpvHgi2EOQ5fynFWat`
- 运行时回退 ID：`run-mrjpd0t0-0hb5cr-image_gen`

两套身份分别产生 start 和 result，因此用户看到了两张相同的开始卡和两张相同的完成卡。最终分层任务实际成功完成 `3/3`，本次主要是 operation identity 和展示状态的问题，不是 Agent 真正执行了两次完整任务。

### 3. 图层重试被提升为独立工具卡

背景、产品、文字属于同一个父级分层操作，但子图层重试使用自己的 `toolRunId`，渲染层将其当成新的完整 Image Gen 工具卡。正确表现应是父卡中的分层子状态，例如“产品层正在重试 1/5”。

### 4. ResizeObserver 反馈循环

`.diagnostics/electron/latest.log` 在 2026-07-14 05:03 左右连续记录数十条：

`ResizeObserver loop completed with undelivered notifications.`

需要找到触发布局读写反馈循环的具体组件，不能简单屏蔽错误。

### 5. Electron/AIDebug 生命周期存在噪声

同一日志中出现多个不同 boot age 的周期性本地服务检查，说明可能有多个长时间存活的 Electron/AIDebug 进程或计时器。需要验证测试退出、窗口关闭和辅助进程回收。

## 不可违反的产品边界

- 右侧项目 Agent 是唯一智能控制中心。
- 画布只展示图片成果、图片容器、分层 PNG 和成果关系。
- 不创建子 Agent，不恢复 Agent 画布节点或手动工作流。
- `image_gen` 是唯一图片执行工具。
- Agent 依靠 Prompt、Schema、上下文和工具容错自主调用工具。
- 不增加关键词路由、首轮强制 tool choice、synthetic user 或前端伪造工具调用。
- Prompt、工具 Schema、compact summary 与 FastMemory 保持独立。
- 新建会话和新建项目继续严格隔离。
- 用户原图必须先复制进项目库，不能直接修改原路径。
- 不用旧版全量测试作为新版交付门槛。

## 选择状态机规范

选择核心状态固定为：

- `none`：没有成果上下文。
- `single`：一个成果被选中并作为 Agent 当前上下文。
- `multiple`：多个成果组成稳定上下文，防止普通误触破坏。

| 当前状态 | 普通单击节点 | Ctrl/Meta 单击 | 中键框选 |
| --- | --- | --- | --- |
| none | 单选目标 | 单选目标 | 用框内节点建立新选择 |
| single A | 点击 B 时切换为 B | 增加或取消目标 | 直接替换为框内节点；包含 A 时自然保留 A |
| multiple A+B | 保持原多选，避免误触破坏 | 增加或移除目标 | 直接替换为框内节点 |
| 有效空框 | 保持原选择 | 保持原选择 | 保持原选择 |

补充规则：

- 中键框选移动不足阈值时视为无操作，不能清空选择。
- 普通空白画布单击和左键平移不能清空选择。
- 当前选中区域中的 X、删除成果、项目切换和明确的上下文重置可以取消选择。
- 多选集合中的所有节点都必须高亮，主焦点可增加轻微的二级视觉差异。
- 拖动已选集合成员时整体移动选择集合；拖动未选节点不得意外改写已有多选上下文。
- Ctrl/Meta 取消到只剩一个节点时自动回到 `single`；全部取消时回到 `none`。
- 容器宿主、容器成员、分层组成员和折叠/展开状态必须映射到稳定选择身份。
- 节点删除、解组、重组、项目切换和会话恢复后必须清理不存在的选择 ID。
- 鼠标、键盘、AIDebug 和程序化定位必须使用同一选择 reducer，禁止各自维护规则。

## 工具时间线协议

每一次用户可见工具操作只有一个稳定 `operationId`。

关联字段：

- `operationId`：用户可见操作的唯一身份。
- `callId`：模型返回的 function call ID，只是 operation alias。
- `runId`：本轮 Agent 请求身份，只是 operation 上下文。
- `childTaskId`：并行图片、图层或重试子任务身份。
- `assetId/nodeId`：成果提交后的资产和画布身份。

一次工具执行的固定 UI 顺序：

1. Agent 的简短自然语言说明。
2. 一张独立的“正在使用工具”开始卡。
3. 开始卡内部更新耗时、进度、图层状态和重试。
4. 一张独立的“工具已完成/失败”结果卡。
5. Agent 的最终结果说明。

协议要求：

- 同一 `operationId` 最多一张开始卡和一张结果卡。
- call ID 与 runtime fallback ID 必须通过 alias map 合并。
- start、poll、image-request、image-retry 更新同一开始卡。
- done/error 创建独立结果卡，不能覆盖开始卡，也不能重复创建。
- 子图层重试只能更新父卡的 child task 列表。
- 完成卡必须在资产保存、节点 commit 和画布可见状态完成后出现。
- 历史会话加载时要归并已有的重复 call/run 卡，避免旧会话继续重复显示。
- UI 去重不能替代运行时幂等；两层都必须有测试。
- 内部参数校验、系统兜底、entry ID、路径和凭证不得出现在用户时间线。

## AIDebug 强化计划

### 选择观测

- 暴露只读选择快照：状态、primary ID、selected IDs、来源手势。
- 自动执行 none/single/multiple 状态转换矩阵。
- 覆盖 Ctrl/Meta、中键框选、节点拖动、容器和分层组。
- 同时检查内部状态、DOM 高亮、Agent 当前上下文和持久化结果。

### 工具观测

- 记录 `operationId -> callId -> runId -> childTaskId` 映射。
- 记录每个 phase、时间戳、卡片 ID、资产数和节点数。
- 自动断言开始卡与结果卡各一张。
- 自动检测重复 Brief、重复 Prompt、重复完成文案和 result-before-commit。
- 区分“真实工具执行重复”和“仅 UI 展示重复”。

### UI 与性能观测

- 捕获 ResizeObserver、React error、未处理 Promise 和控制台异常。
- 记录资产落盘到节点可见的延迟。
- 记录拖动、缩放、框选、容器排版和时间线更新的 frame p95。
- 检查 884、1280、1920 宽度和 Windows 缩放。
- 测试完成后检查 Electron、Vite、worker、辅助进程和定时器是否释放。
- 所有报告禁止输出 API Key、cookie、relay token 或用户敏感路径内容。

## 分批实施

### Round 0：基线与文档

- 固化本计划、真实日志证据和交付门槛。
- 保留主工作树全部既有成果，不 reset、不 checkout 覆盖。
- 建立专项报告命名和证据索引。

### Round 1：AIDebug 观测能力

- 增加选择转换测试工具。
- 增加 operation identity 事件录制器。
- 增加重复工具卡和成果提交延迟断言。
- 增加 ResizeObserver 与进程生命周期报告。

### Round 2：统一选择状态机

- 抽离纯选择 reducer。
- 接管普通点击、Ctrl/Meta、键盘和中键框选。
- 统一拖动、容器和分层组选择语义。
- 修复 Agent 当前成果上下文和画布高亮同步。
- 增加持久化、项目切换和删除后的清理测试。

### Round 3：工具时间线 operationId

- 运行时生成并传递稳定 operation identity。
- 建立 call/run/child alias map。
- 渲染层改为 operation reducer。
- 合并历史重复工具卡。
- 保留开始与结果两张独立卡，同时消除重复。

### Round 4：成果提交与画布显示闭环

- 保证资产落盘、节点 commit、容器/分层布局和完成卡的顺序。
- 修复成果已生成但节点晚显示。
- 统一普通图片、容器图片和分层成员的高清源。
- 校验关系线、连接头、zOrder 和选择高亮。

### Round 5：UI 全局收敛

- 统一编辑器、查看器、设置、模型、抠图、重绘和导出窗口。
- 清理空白区域、无意义边框、按钮错位、滚动/拉伸冲突。
- 修复 ResizeObserver 根因。
- 优化工具卡、Agent 状态和长 Prompt 折叠动画。

### Round 6：全功能闭环

- 单张生图。
- 连续多张单图。
- 最多十张并行生成。
- 多提示词图片容器。
- 图片导入、归组、移出和自动解组。
- 元素替换、多款设计和商品多角度。
- AI 抠图、AI 重绘。
- 分层 PNG 展开、显隐、重组、合并、PNG/文件夹/PSD 导出。
- 节点编辑、重新生图、查看与另存为。
- 新项目、新会话、FastMemory 和 compact 隔离。

### Round 7：性能与代码结构

- 选择框只计算必要节点，避免每帧全 DOM 扫描。
- 限制时间线和节点更新的无效 React 渲染。
- 审计大图、缩略图和图片容器内存。
- 验证 100-300 节点、200 条对话和 10 张并行图片。
- 收敛选择、时间线、成果提交和容器布局模块边界。
- 清理测试进程、worker、轮询和 ResizeObserver 生命周期。

### Round 8 及以后：真实模型与修复循环

- 使用真实 `gpt-5.6-sol + gpt-image-2` 验证。
- 覆盖电商宣传图、主体/文案替换、服装上身、多角度、多款式和分层素材。
- Agent 在生图后使用 `view_image` 检查成果。
- 覆盖 429、5xx、断网、超时、部分失败和重试。
- 每轮根据证据修复根因，再重复专项、GUI、真实 Agent 和压力测试。

## 统一功能闭环

任何功能必须完成以下链路才可标记完成：

`用户意图 -> Agent 理解 -> 工具调用 -> 状态可见 -> 资产落盘 -> 节点立即可见 -> 关系与选择正确 -> Agent 查看成果 -> 可继续编辑 -> 可保存/导出 -> 重启恢复正确`

不能以“接口返回成功”“DOM 元素存在”或“测试脚本全绿”单独作为完成证据。

## 性能目标

- 普通拖动、缩放、框选和线路更新 frame p95 目标不超过 16.7ms。
- 不出现持续超过 100ms 的交互主线程任务。
- 资产完成后，节点本地 commit 到可见状态应处于同一交互节拍，不允许秒级延迟。
- 100-300 节点时仍可稳定选择、拖动、缩放和打开编辑器。
- 10 张并行任务的状态更新不得造成时间线重复或画布冻结。
- 无持续 ResizeObserver 循环、计时器泄漏和测试辅助进程残留。

## 每轮执行模板

1. 从真实日志、会话或 AIDebug 报告记录问题。
2. 判断是局部缺陷还是泛化根因。
3. 修改数据链路或组件本体。
4. 运行专项测试。
5. 运行构建和 bundle 检查。
6. 运行 AIDebug GUI 并审查截图与报告。
7. 运行真实 Agent 操作。
8. 运行压力或故障注入测试。
9. 审计相邻功能和持久化恢复。
10. 更新本文档的轮次记录并进入下一轮。

## 最终交付门槛

- 选择状态矩阵全部通过，DOM 高亮与 Agent 上下文一致。
- 每个工具 operation 恰好一张开始卡和一张结果卡。
- 工具真实执行无重复，失败与重试可恢复且不污染 UI。
- 成果节点及时显示，容器、图层和关系正确。
- 全功能闭环矩阵通过。
- 连续两轮完整验证结果一致。
- 冷启动、重启恢复、项目和会话隔离通过。
- 无 ResizeObserver、未处理异常和辅助进程残留。
- 构建、bundle、AIDebug GUI、性能审计和证据审计通过。
- 代码边界清晰，没有通过堆叠临时条件或末尾 CSS 覆盖完成修复。

## 轮次记录

### 2026-07-14 / Goal 启动

- 用户完整采纳总体计划。
- 已建立超长 Goal。
- 已确认首批顺序：AIDebug 观测、选择状态机、工具时间线 operation identity。
- 下一步：补齐专项观测与自动化失败用例，再修改生产选择逻辑。

### 2026-07-14 / Round 1-3 首批闭环

- 新增 `src/selection-state.ts`，将 none/single/multiple、普通单击、Ctrl/Meta、框选、移除和显式清理收敛为纯 reducer。
- 新增 `pnpm run test:selection`，覆盖单选切换、多选防误触、Ctrl 增删、框选替换、有效空框保持、删除降级和不可变输入。
- AIDebug 新增单选切换与中键框选真实手势场景；新版 `--agent-only` 21 个场景通过，证据审计为 0 error / 0 warning。
- 新增 `operationId / childTaskId` 工具时间线协议。分层预览、图层重试、图层结果和最终完成共享父 operation，子图层不再升级为独立工具卡。
- `image-response` 只更新进行中的开始卡，只有 `tool-done/tool-error` 产生独立结果卡。
- 新增 `src/tool-timeline.ts`、`pnpm run test:timeline` 和 Agent runtime 分层 operation identity 断言。
- 历史会话加载会收敛相邻的旧 call/run 重复卡；实际测试会话已从重复开始/结果恢复为一张开始卡和一张结果卡。
- AIDebug 状态增加选择手势、选择模式和工具时间线重复 operation 证据。
- 新增 Electron 单实例保护、开发进程树清理和 AIDebug 独立日志。已清理 04:08 的旧开发进程树，保留 04:46 当前用户窗口。
- 最新隔离 GUI 日志中 ResizeObserver 错误为 0，AIDebug 结束后无 Electron 残留，用户 `latest.log` 不再被测试覆盖。
- 下一步：继续审查 ResizeObserver 的历史触发组件、成果提交显示延迟、图片容器/分层显示闭环和真实模型工具卡。

### 2026-07-14 / Round 4 成果提交与完成卡时序闭环

- 分层 `image_gen` 的用户可见完成结果不再直接跟随主进程 `tool-done`；先等待客户端完成透明色键移除、同尺寸校验、合成保存、六个独立 PNG 节点提交和 DOM 可见，再结算唯一结果卡。
- 本地成果提交可以独立结算 operation；真实 Agent 后到的 `tool-done` 只作为同一 operation 的确认，不会制造第二张结果卡。AIDebug 直接工具路径即使没有外层 `tool-done`，也能正确完成开始卡与结果卡闭环。
- `workflow.layer.group` 与 `workflow.layer.merge` 统一携带父 `operationId`，并将父 operation 映射到顶部图层节点；图层内部 `toolRunId` 继续只承担图层组执行身份。
- 项目切换、新建/清理/切换会话和画布清理会释放本地分层结算状态；operation alias、完成集合和证据映射均设置有界容量，防止长会话内存持续增长。
- AIDebug 新增 `runtime image response -> node state commit -> node DOM visible -> result card scheduled` 顺序证据，并检查完成 operation 恰好一张 start、一张 result，图层 retry 的 childTaskId 不得生成独立工具卡。
- 分层 GUI 专项通过：`.diagnostics/electron/aidebug-2026-07-13T22-16-03-742Z/report.json`，8 个真实画面场景全绿，证据审计 `0 error / 0 warning`。
- 新版 Agent GUI 回归通过：`.diagnostics/electron/aidebug-2026-07-13T22-16-49-779Z/report.json`，21 个场景全绿，证据审计 `0 error / 0 warning`。
- 选择、时间线、Agent 文本协议、Agent 原生协议、项目 IO、生产构建和 bundle 泄漏检查均通过。
- 下一步：按功能矩阵继续验证图片容器、AI 抠图、AI 重绘、导入/导出、高清预览、性能和真实模型压力路径。

### 2026-07-14 / Round 4.5 长会话、选择与视口闭环

- AIDebug mock 模型的工具结果判断改为只检查最后一条用户消息之后的当前轮次；完整历史仍用于读取选中成果、画布信息、FastMemory 和 compact summary。
- AIDebug 每次工具调用使用新的 call/operation identity，跨轮的 experience、workflow、command 与 image_gen 不再因为固定 call ID 被合并为同一个操作。
- Agent 请求在发送瞬间从 `nodesRef / layoutGroupsRef / selectedNodeIdsRef` 构造实时画布快照，修复“直接生图后立刻续图”将新选择与旧节点数组组合、导致 image_gen 内部参数校验失败的问题。
- Agent 生成成果不再擅自改写用户明确选择；画布自动将“当前选中成果 + 新成果”共同纳入视口，既保留稳定上下文，也保证新成果可见。
- 混合压力的 DOM 断言已与画布虚拟化统一：运行时总节点精确校验，DOM 只校验可见节点、选中节点、像素和交互，不再要求全部屏外节点同时挂载。
- AIDebug data URL 像素探针不再通过 fetch 触发 `connect-src`，生产 CSP 无需放宽，诊断日志中的 data URL CSP 噪声归零。
- 支持最小窗口证据改为当前产品实际支持的 884px 内容宽度；移除已废弃 Agent 核心画布节点的计数假设，并允许发送按钮保持靠右的宽按钮设计。
- 1 轮混合压力通过：`.diagnostics/electron/aidebug-2026-07-13T23-12-54-682Z/report.json`，8 个场景、证据审计 `0 error / 0 warning`。
- 3 轮 compact 长会话压力通过：`.diagnostics/electron/aidebug-2026-07-13T23-15-36-034Z/report.json`；7 次 compact、7 次压缩后继续执行、3 次压缩后续图、8 张图片成果和早期摘要标记回注全部成功，证据审计 `0 error / 0 warning`。
- 下一步：进入 Round 5 全局 UI 回归，重点审查编辑器、弹窗、滚动/拉伸冲突、最小窗口、Agent 时间线和相邻功能回归。
