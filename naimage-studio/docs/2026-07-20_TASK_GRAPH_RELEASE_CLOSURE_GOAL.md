# IIIMAGE STUDIO 任务图与发布收官总 Goal

更新时间：2026-07-20

状态：完成（IIIMAGE STUDIO 1.0.3 已冻结、发布并通过生产闭环验收）

## 1. 最终目标

将当前新版 IIIMAGE STUDIO 收敛为一个可被普通用户稳定理解、可由 Agent 自主完成图片任务、可通过画布复用任务关系、可安装和在线更新的正式产品。

产品必须同时满足三件事：

1. 右侧 Agent 仍是唯一智能主体。没有母体 Agent、子 Agent 或画布 Agent 节点。
2. 画布不再是无意义的手动工作流；它只表达真实可复用的任务事实：原图、参考图、需求、执行中成果、完成成果及关系。
3. 用户一旦发起任务，界面必须立即承认这项工作：Agent 时间线有完整要求，画布有运行中占位，执行入口防重复，失败后可以继续而不是丢失上下文。

统一闭环：

`用户意图 → 明确任务作用域 → Agent 时间线镜像 → 任务被接纳 → 运行中节点立即出现 → Agent 原生调用工具 → 可治愈执行 → 成果替换占位 → 关系和角色保持 → 可继续编辑/复用/导出 → 重启后恢复`

## 2. 对历史方向的正式修正

历史文档中的“画布只展示成果、不得出现手动工作流”不再被机械解释为“画布不可操作”。正确边界是：

- 不恢复旧版任意串联的流程组件、Agent 核心节点、子 Agent 或关键词路由。
- 保留并强化有真实用户价值的任务图：来源节点、参考节点、需求节点、执行节点、成果节点。
- 连线不是装饰。只有连入需求节点的原图/参考图才进入该次任务作用域；画布上未连接的素材不得污染任务。
- 需求节点可先于图片创建，可保存、编辑、复用和重新连接来源。
- Agent 仍负责理解和执行，任务图负责让“基于什么、参考什么、要做什么、做到哪里”可见且可复用。

## 3. 用户心理预期

每个交互都必须回答四个问题：

- 系统有没有收到我的要求？
- 它正在基于哪些图工作？
- 当前做到哪里，是否重复执行？
- 失败后我的要求和已完成成果是否还在？

因此统一采用以下反馈顺序：

1. 操作入口立即进入不可重复触发状态。
2. Agent 时间线立即显示用户要求和关键参数。
3. 画布立即创建对应的运行中节点或占位成果。
4. 工具开始卡更新唯一主状态，其他区域只显示静态状态，不四处重复“正在生成”。
5. 成功时原位替换为成果；失败时保留失败节点、来源、要求和可继续入口。

## 4. 核心数据模型

### 4.1 图片节点角色

图片及图片容器统一使用 `imageRole`：

- `source`：需要被修改、分层、翻译、换物或批量处理的原图。
- `reference`：只用于风格、颜色、人物、服装、商品或版式参考。
- `neutral`：尚未指定角色的普通图片或容器。

规则：

- 右键空白画布可创建原图容器、参考图容器、普通图片容器。
- 普通容器可在右键菜单中转换角色。
- 对话输入区的原图/参考图与画布角色使用同一数据结构。
- 同一需求可连接多个原图和多个参考图。
- 只有连接到当前需求节点的素材生效；未连接节点不进入任务上下文。
- 角色转换必须同步到画布上下文、Agent 任务作用域、持久化和 AIDebug。

### 4.2 可复用需求节点

需求节点允许两种创建方式：

- 基于已有图片/容器创建，自动建立来源连线。
- 在空白画布直接创建，暂时没有来源，后续再连接原图/参考图。

需求节点至少保存：

- 稳定 `requirementId`。
- 标题、完整自然语言要求、版本号。
- 用户选择的比例、分辨率/精细程度、数量和其他显式参数。
- 已连接的原图节点、参考图节点。
- 最近一次执行签名、执行次数和最后状态。
- 可编辑、可断线、可换来源、可再次执行。

无来源的需求可以执行纯文生图；如果要求语义明显依赖原图但没有连接来源，由 Agent 原生判断并使用 `ask_user` 对账。

### 4.3 统一任务执行记录

所有会触发 Agent 的入口统一创建 `TaskExecution`：

- `executionId`：一次真实执行的唯一身份。
- `operationId`：时间线工具卡身份。
- `requirementId`：可选，来源于需求节点。
- `sourceNodeIds` / `referenceNodeIds`：冻结后的本次作用域。
- `requestText` / `imageParams`：用户要求与完整显式参数。
- `status`：`accepted | running | retrying | succeeded | failed | cancelled`。
- `placeholderNodeIds`：执行一开始就创建的画布占位成果。
- `resultNodeIds`：成功提交后的真实成果。
- `attempt` / `failureKind` / `recoverable`：失败与恢复信息。

任务执行签名由需求版本、连线来源身份、角色、参数和目标数量组成。相同签名正在运行时必须拒绝重复执行。

## 5. 全局防重入与可操作边界

Agent 工作期间，所有会发送消息、执行需求、启动生图/抠图/重绘/分层/翻译/反推的入口统一禁用并呈现同一灰态。以下操作仍可用：

- 浏览图片、时间线和提示词。
- 平移、缩放、选择和整理不参与当前执行的节点。
- 打开只读信息、保存已有成果。
- 停止当前任务。

不得只禁用发送按钮而遗漏画布右键、需求节点执行按钮、节点编辑器提交按钮或快捷入口。

防重入分两层：

1. UI 能力层：所有执行控件读取统一 `agentExecutionBusy`。
2. 运行时幂等层：即使重复事件穿透，具有相同执行签名的运行中任务也只能被接纳一次。

## 6. Agent 时间线同步

从画布发起的任务也必须像对话发起一样进入右侧时间线。用户可见信息包括：

- 简短自然语言说明。
- 完整要求正文。
- 来源数量、参考图数量及对应编号。
- 图片比例、分辨率/精细程度、数量、生成模式。
- 可折叠的 Agent 实际生图提示词。
- 一张开始卡和一张完成/失败卡。

禁止显示内部路由、参数兜底、entry ID、FastMemory 文件 ID、系统重试规则或路径隐私。

手动“创建生图工作”不能绕过 Agent 时间线。它只是一种更结构化的用户输入方式，提交后必须转成与聊天一致的用户任务消息和 `TaskExecution`。

## 7. 运行中占位节点

所有会产出画布成果的任务都先创建占位节点：

- 单图任务：一个标准运行中图片节点。
- 多图任务：一个使用统一图片容器架构的运行中容器，内部按目标数量显示槽位。
- 分层任务：按目标图层数创建同组的独立运行中 PNG 图层节点，叠放显示；不得先只出现一个假容器。
- 批量文件夹/超级容器任务：每个来源分区拥有自己的运行中成果分区。

占位节点必须在工具网络请求前提交到画布，并与需求节点连线。成功时原位补全资产；部分失败时保留成功槽位和失败槽位；完全失败时保留可重试的失败节点。

主状态只在 Agent 时间线显示动态文案。画布节点只使用克制的静态运行视觉和单一进度，不重复堆叠“运行中/生成中/正在生图”。

## 8. 分层任务可治愈性

“图层覆盖缺失 47%/54%”不能直接把整个用户任务变成不可继续的死路。

工具内部按以下顺序恢复：

1. 保留已成功生成且通过透明度、尺寸和归属校验的图层。
2. 仅重试缺失或归属不可靠的图层，不重复生成已成功图层。
3. 对可确定的透明底、色键、语义蒙版和对齐问题执行确定性本地修复。
4. 再次合成并验证总覆盖、互斥性、透明度和主体完整度。
5. 仍无法可靠归属时返回结构化失败：成功图层、失败图层、缺失比例、建议动作和 `recoverable=true/false`。

Agent 收到可行动的工具返回后自行决定继续调用、调整提示词或询问用户；外层系统不得伪造用户消息或无限强制重试。

重复执行必须创建新的 `executionId`，但复用原需求、来源和已确认参数；失败任务不得污染下一次调用的 operation identity。

## 9. AIDebug 作为执行感官

新增并长期保留以下专项：

### 9.1 任务接纳与时间线

- 从手动生图工作提交任务。
- 断言用户要求、比例、精细程度、数量进入 Agent 时间线。
- 断言一个 `executionId` 对应一张开始卡、一张结果卡。
- 断言网络调用前占位节点已经可见。

### 9.2 空白需求与角色连线

- 空白画布创建无来源需求。
- 创建原图容器、参考图容器并连接。
- 普通容器转换角色。
- 多个未连线素材不进入当前任务作用域。
- 断线、换来源、编辑需求、再次执行后签名正确变化。

### 9.3 全局防重入

- Agent 忙碌时扫描全部执行入口，断言统一禁用。
- 连续点击、键盘回车、右键菜单和程序化重复事件只接纳一个任务。
- 停止或完成后入口恢复。

### 9.4 占位与成果提交

- 单图、多图、分层和批量任务均先出现占位。
- 成功成果原位提交，不产生幽灵节点或重复容器。
- 部分失败保留成功槽位。
- 画布、React state、refs、持久化和 DOM 身份一致。

### 9.5 分层失败恢复

- 注入覆盖缺失、单层失败、超时和部分成功。
- 断言只重试失败层。
- 断言成功层不被覆盖。
- 断言失败后可再次执行且 operation 不重复。

### 9.6 证据真实性

- Electron 改变内容尺寸后先预热 compositor，再采集双帧证据。
- 弹窗打开手势不得泄漏为 backdrop 关闭。
- 报告记录任务签名、占位提交时间、工具请求时间、节点可见时间和最终结算时间。
- 性能只保留一次代表性门禁；达到“交互无明显卡顿、无长时间冻结、无持续泄漏”后不再无限重复。

## 10. 分批 Round

### Round 0：收官基线与诊断可靠性

- 写入本总 Goal。
- 修复分层文字层微小鼠标抖动导致误脱离。
- 修复 AIDebug 改变窗口尺寸后的旧 compositor 帧。
- 修复弹窗打开手势泄漏导致立即关闭。
- 保持生产首包小于 600,000 bytes。

### Round 1：执行占用与时间线参数闭环

- 建立统一 `agentExecutionBusy` 能力。
- 覆盖聊天、需求节点、画布菜单、手动生图、编辑器和图片工具入口。
- 手动生图要求及全部显式参数进入 Agent 时间线。
- 建立执行签名和运行时幂等。

### Round 2：空白需求与图片角色

- 空白画布创建需求节点。
- 无来源需求支持纯文生图或 Agent 对账。
- 创建原图/参考图容器，普通容器可转换角色。
- 连线决定任务作用域，持久化和上下文同步。

### Round 3：统一运行中节点

- 抽出占位规划器。
- 单图、多图、分层、容器和超级容器使用同一执行/成果提交协议。
- 画布先可见，再调用工具；完成卡晚于节点可见。

### Round 4：分层可治愈执行

- 将覆盖缺失拆分为可恢复层级错误。
- 保留成功层、只重试失败层、结构化返回恢复信息。
- 验证重复执行、取消、超时和部分成功。

### Round 5：UI 与用户观感收敛

- 任务灰态、运行视觉、失败视觉、重试入口使用统一 primitive。
- Agent 时间线与画布不重复动态状态。
- 原图/参考图/需求/成果在视觉上可识别但不过度着色。
- 884、1280、1536 和紧凑高度下排版稳定。

### Round 6：真实 Agent 与发布

- 使用固定 `gpt-5.6-sol + gpt-image-2` 验证文生图、参考图、电商改图、批量和分层。
- Agent 生成后使用 `view_image` 核对成果。
- 只跑必要专项和一次完整发布验收。
- 冻结现代安装/卸载、启动、在线更新、回滚和签名制品。
- 推送 Studio 与 CRM 到 Forge，部署并核验下载、验证码、认证、遥测和更新元数据。

## 11. 每轮实际推进要求

每个 Round 必须产生至少一项可验证的真实成果：

- 生产代码修复或底层契约实现；
- AIDebug/自测新增并能够复现或证明问题；
- UI 截图和状态证据；
- 安装、更新、部署或线上链路成果。

禁止只写计划、只统计、只重复运行同一性能测试。每轮顺序固定为：

1. 从真实日志/测试记录确认因果链。
2. 修改底层模型或共享基础设施。
3. 运行最小专项。
4. 审查相邻入口和持久化。
5. 更新本文件的推进记录。
6. 进入下一 Round。

## 12. 阶段性交付标准

- 用户从聊天或画布发起任务都能在 Agent 时间线看到完整要求。
- 空白需求、原图容器、参考图容器和连线作用域可用。
- 任意时刻同一任务不会被重复接纳。
- 任务被接纳后画布立即有运行中成果。
- 单图、多图、分层和批量任务的占位/成果提交逻辑统一。
- 分层覆盖失败可恢复、可继续、不会丢失成功层。
- 新项目、新会话、FastMemory、任务图和执行状态互相隔离。
- UI、安装、卸载、更新和线上下载链路达到用户可验收状态。
- 关键专项通过，并完成一次收束式正式发布验收；不以无限性能轮次拖延交付。

## 13. 推进记录

### 2026-07-20 / Round 0 启动

- 已建立本权威总 Goal，并吸收桌面 `prob.txt` 的全部测试记录。
- 已修复分层 PNG 文字层在 `1px/-3px` 指针抖动下被错误 detached；图片导入/分层专项 0 失败。
- AIDebug 双帧截图增加窗口 resize 后 compositor 预热，消除第一帧旧尺寸假失败。
- 统一 Dialog 基建增加 200ms 打开手势保护，避免新弹窗被同一打开手势泄漏成 backdrop 关闭。
- 需求节点 GUI 专项已恢复 0 失败。
- 生产首包仍受 600,000 bytes 硬门限制，后续新增逻辑优先进入独立 core/async 模块，不继续膨胀 `main.tsx` 首包。
- 下一步：直接进入 Round 1，先统一执行防重入和手动生图任务到 Agent 时间线的数据闭环。

### 2026-07-20 / Round 1 完成，Round 2 启动

- 手动“创建生图工作”已进入统一 Agent 时间线：用户原始要求、比例、分辨率、精细程度、数量和参考图数量均可见，生图 Prompt 保持折叠展示。
- Agent 请求、手动生图、需求执行、图片节点工具与编辑器提交已共享统一执行忙碌判断；手动任务在额度检查期间也持有同步 reservation。
- AIDebug 手动生图探针已升级为同一同步事件连续提交两次，实际只产生 `1` 条用户消息、`1` 个并行图片容器、`1` 个 operation、`1` 张开始卡和 `1` 张完成卡。
- 修复 AIDebug 场景切换未关闭提示词/记忆编辑器的问题，避免旧弹窗遮挡造成 FastMemory 假失败；完成卡不再被错误要求重复携带长 Prompt。
- UI surface 专项 0 失败：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-19T21-39-34-578Z\report.json`。
- 生产门禁通过：`typecheck`、`build`、`test:bundle`；初始 JS 为 `599,009 bytes`，仍低于 `600,000 bytes` 硬上限。
- Round 2 直接进入实现：空白画布需求节点、原图/参考图容器角色、角色转换及仅连线素材生效的任务作用域。

### 2026-07-20 / Round 2 完成，Round 3 启动

- 右键空白画布现可直接创建需求节点、原图容器、参考图容器和普通图片容器；空白需求可先保存，纯文生图不再被强制要求已有来源。
- `CanvasRequirement` 已升级为显式多输入任务图：同一需求可连接多个原图与参考图，`parentId` 只保留兼容性的主输入，真实作用域由带角色的 `inputBindings` 决定。
- 原图/参考图连线分别以实线/虚线表达；输入端可断开全部任务素材，删除节点、断开输出和容器角色变化都会同步修正需求绑定。
- 普通图片容器可转换为原图容器、参考图容器或恢复未指定角色；角色同步到资产、容器绑定、需求绑定、持久化和 Agent TaskScope。
- Agent 执行需求时只读取已连接节点；画布上未连接容器不会进入 `sourceAssets`、`referenceAssets` 或对应容器 ID。空容器、失效连线会在执行前给出精确提示。
- AskUser 暂停任务的安全快照已从单来源扩展为多输入 ID + 内容/角色签名；任意连线、角色或内容变化都会阻止旧任务错误恢复。
- 新增 `requirement-graph` 自测并扩展 requirement signature 测试，覆盖旧单来源迁移、多输入去重、角色/内容敏感签名、断线及多输入 continuation。
- 需求节点 GUI 专项 0 失败，真实证明：原图仅 `K`、参考图仅 `L`，未连线容器 `M` 未进入 Agent 作用域，并验证普通容器角色往返转换：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-19T22-13-44-766Z\report.json`。
- UI surface 专项在异步拆分 Agent 文本编辑器后仍为 0 失败：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-19T22-13-03-767Z\report.json`。
- Agent 提示词/FastMemory 编辑器与需求编辑器已拆为独立异步块；生产首包为 `599,047 bytes`，继续通过 `600,000 bytes` 硬门禁。
- Round 3 直接进入实现：统一 `TaskExecution` 与单图、多图、分层、批量任务的运行中占位/成果原位提交协议。

### 2026-07-20 / Round 3 完成，Round 4 启动

- `image_gen operation=layers` 在任何远程图片请求前发出 `workflow.layer.placeholders`；画布立即按目标层数创建同组、同坐标的独立 PNG 运行中节点，不再等网络完成后才突然出现成果。
- 分层最终提交现复用占位节点身份、层组编号、坐标、Z 序和来源连线；AIDebug 实际记录 6 个占位节点 `A–F`，最终成果仍为 `A–F`，没有第二套幽灵节点。
- 完成卡时序已闭环：`placeholderCommitAt <= toolRequestAt`，占位在图片响应前可见，最终节点提交并可见后才创建工具完成卡。分层专项实际证据中 `placeholderLifecycleOk=true`、`orderOk=true`。
- 分层缺少合成数据、工具终态失败、用户停止、清画布、切项目、切会话和退出登录均会结算或释放运行中占位；失败节点保留原需求与图层身份，允许后续恢复，不再永久卡在 `generating`。
- 修复取消单层拖动后 React 状态已回滚、DOM 却残留瞬时 `left/top` 的问题；该问题曾使一个图层真实偏移 `+72,+44` 并遮挡相邻标签。现在 pointer cancel 会同步恢复实时 DOM、节点状态和连线。
- 独立 PNG 图层编辑器字段区改为可滚动，提示词输入区达到设计高度下限；1280 与 884 宽度下图层标签、查看器和编辑器全部通过专项。
- 为守住首包硬门禁，将模型配置选择器和 AskUser 对账弹窗拆为按需加载块；生产首包为 `599,027 bytes`，仍低于 `600,000 bytes`，没有放宽任何门禁。
- 验证证据：
  - 分层专项 0 失败：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-19T22-38-20-939Z\report.json`
  - AskUser continuation 0 失败：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-19T22-48-40-935Z\report.json`
  - 需求节点与原图/参考图作用域 0 失败：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-19T22-49-19-671Z\report.json`
  - `typecheck`、`build`、`test:bundle` 全部通过。
- Round 4 直接进入实现：保留已成功图层，把覆盖缺失、单层失败和局部校验失败转为结构化可恢复结果，只定向重试失败层。

### 2026-07-20 / Round 4 第一批：覆盖缺失不再整组报废

- 将分层透明提取、语义细化、覆盖修复与质量门禁从 `main.tsx` 拆入按需模块 `src/layer-composition-runtime.ts`；主界面不再承担低频重型图片处理代码，生产首包降至 `591,011 bytes`。
- 新增结构化 `LayerCompositionPreparationError`：携带 `recoverable`、部分合成数据、成功图层 ID、失败图层 ID、失败阶段和覆盖报告，不再只有一条不可行动的字符串错误。
- 覆盖缺失超过门槛时，先把当前各层保存到项目图片库，再结算画布：可靠背景层保持完成态，待修复透明层保留可查看资产并进入错误态；节点身份、图层顺序、需求关系和原提示词不丢失。
- AIDebug 新增强制 54% 覆盖缺失场景，对应历史真实日志中的 47%/54% 故障；实测结果：
  - `A / background`：`imageState=done`，`assetCount=1`；
  - `B / subject`：`imageState=error`，`assetCount=1`；
  - `C / text`：`imageState=error`，`assetCount=1`；
  - 随后清理故障注入并继续执行正常六层任务，完整分层仍通过。
- 分层专项 0 失败：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-19T23-00-26-934Z\report.json`。
- `typecheck`、`build`、`test:bundle`、`git diff --check` 全部通过；当前生产首包 `591,011 bytes`，总 JS 仍低于 `650,000 bytes`。
- 下一批：把失败阶段与失败图层身份写入可持久化图层组契约，并为 `image_gen operation=layers` 增加复用成功层、只请求失败层的原生 schema/工具参数；随后注入单层网络失败验证成功层不会被覆盖。

### 2026-07-20 / Round 4 完成：失败图层定向重试形成闭环

- `ImageLayerNodeGroup.recovery` 已成为可持久化恢复契约；Workbench Snapshot 向 Agent 明确提供组 ID、失败层和成功层，公开 `image_gen` schema 原生支持 `resumeLayerGroupId + retryLayerIds`。
- 恢复参数不依赖外层强制路由：Agent 必须复制真实可恢复组 ID，并完整覆盖 `failed` 列表；运行时拒绝猜测组 ID、夹带 `successful` 层或把尚未成功的层当作可复用资产。
- 分层恢复原位复用旧图层组：只把失败节点切换为 `generating`，成功节点保持完成态；占位、失败结算、重复动作、最终提交均不会删除已有成功层。
- 最终提交保持原节点 ID、组编号、坐标、Z 序和来源关系；成功层使用 `prepared` 模式绕过重复透明提取，并直接复用原项目资产及预览，不再产生内容相同但路径不同的副本。
- 修复恢复动作被旧组误判为“已有完成结果”的幂等冲突；每次恢复使用新的 operation identity，重复回放仍可被当前 tool run 正确去重。
- AIDebug 的覆盖缺失夹具改为固定视觉种子，消除随机组 ID 导致质量门禁偶发通过/失败的诊断噪声。
- 完整分层专项 0 失败：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-19T23-31-51-596Z\report.json`。恢复步骤实际证明：
  - `sameNodeIds=true`；
  - `backgroundIdentityStable=true`（节点、assetId、contentHash、path 均不变）；
  - `targetedRetryDeclared=true`（只请求 `subject + title`，不请求 `background`）；
  - 三个节点最终均为 `done`，且 `recovery` 已清除。
- Agent Prompt/schema 自测通过，确保真实模型可见恢复字段且不会被公共参数层过滤：`pnpm run test:agent-text`。
- 发布门禁通过：`typecheck`、`build`、`test:bundle`、`git diff --check`；生产首屏 JS 为 `594,591 bytes`，继续低于不可放宽的 `600,000 bytes` 硬上限，总 JS 为 `645,087 bytes`。
- Round 5 现在开始：统一 Agent 时间线与画布运行/失败/恢复视觉，减少重复状态，审查 884/1280/1536 与紧凑高度下的按钮、间距、弹窗和节点控制界面。

### 2026-07-20 / Round 5 第一批：运行状态唯一性门禁

- UI surface 专项在 1280 与 884 宽度下继续 0 失败：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-19T23-36-02-108Z\report.json`。
- AIDebug 新增 `agentImageGenSingleDynamicStatusOk`：生图计时器存在时，Agent 侧只能有一个可见动态状态拥有者；顶部状态、工具卡或其他区域不能重复滚动“正在生成/正在工作”。
- 1280 与 884 两个真实运行态捕获均证明：
  - 动态状态拥有者数量为 `1`；
  - 唯一动态文本为 `Image Gen 正在绘图 Ns`；
  - `canvasDynamicStatusCount=0`；
  - `canvasExecutionChromeCount=0`。
- 证据来自：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-19T23-41-04-457Z\report.json` 中 `project-agent-image-running-1280` 与 `project-agent-image-running-min-884`；这两个捕获自身均为 0 state issue。
- 同一次 Agent-only 全域测试暴露出旧诊断场景的身份债务：连接、选择和容器脚本仍硬编码 `A/B/C/D`，而当前统一分配器实际产生 `D/G/H`、`K/L` 等身份，导致多个后续断言级联失效。这不是产品回滚依据；下一批先把 AIDebug 场景改为从动作结果/实时状态捕获稳定节点 ID，再用可信诊断判断真实 UI/交互问题。
- `node --check scripts/aidebug-gui.mjs` 与 `git diff --check` 通过。

### 2026-07-20 / Round 5 第二批：动态身份与统一容器闭环

- Agent-only 旧场景中的来源、衍生、目标和变体身份已全部改为从夹具动作与实时状态读取；视觉证据审计也使用报告内的 `fixtureIds` 计算节点、端口、边和选中目标，不再把合法的动态节点 `E` 误判为旧固定节点 `B`。
- 图片容器诊断契约已对齐当前统一底层架构：持久化形态是一个规范化容器边界和两个仍然存在的真实图片成员，而不是把容器宿主删除后伪装成两个无边界节点。布局组只负责展示，`imageContainerSpec` 才是角色、成员绑定和持久化的权威事实。
- 文件夹拖入空容器、拆出两张单图、重新归组、解散和再次归组已形成完整闭环；最终会话中：
  - 容器宿主 `J` 与成员 `K` 均保留，布局顺序为 `[J, K]`；
  - 两张项目库图片路径和 SHA-256 均完整持久化；
  - 原文件大小、修改时间和 SHA-256 前后完全不变；
  - `canonicalHostOk=true`、`sourcesRetained=true`、`copiedHashesOk=true`。
- AIDebug 的直接工具调用不再绕过真实请求协议：它使用与正式聊天相同的画布投影和 TaskScope。容器设为 REFERENCE 后，`image_gen(operation=generate)` 实际收到两张且仅两张参考图，没有把任何一张伪装为 SOURCE，成果仍以 `derived-from` 正确连接到容器。
- Agent 原生契约进一步明确：只要 Current Task Scope 存在 SOURCE，`generate` 就不会读取原图，模型必须自主选择 `edit / replace / variants / layers / cutout / redraw`；只有纯文本或 REFERENCE-only 任务使用 `generate`。新增运行时自测证明两张 REFERENCE 会各传一次且不会产生虚假的 `editImage`。
- 图片瓦片增加稳定的来源节点/来源槽位 DOM 身份，AIDebug 现在可以从真实渲染结果核对容器中每张图的归属，而不是依靠数组位置猜测。
- UI 基建自测已纳入异步拆分后的模型配置与 Agent 提示词/FastMemory 编辑器，确认二者均使用 `DialogShell layerLevel="nested"`，没有重新引入局部 z-index 覆盖。
- 最新 Agent-only 全域专项 0 失败：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T00-12-35-647Z\report.json`。其中成果关系场景视觉状态为 `verified`，图片容器运行、网格、项目库路径、成员保留、Agent 参考图和持久化断言全部为 `true`。
- 本批门禁通过：`typecheck`、`test:agent-text`、`test:image-container`、`test:agent-protocol`、`test:ui-foundation`、`build`、`test:bundle`、`git diff --check`。生产首屏 JS 为 `596,209 bytes`，继续低于不可放宽的 `600,000 bytes`；总 JS 为 `646,705 bytes`，低于 `650,000 bytes`。
- 下一批继续 Round 5：根据只读 UI 审计收敛节点控制按钮、间距和紧凑高度排版；随后只跑受影响专项与一次代表性全域验证，不重复无意义性能轮次。

### 2026-07-20 / Round 5 第三批：编辑器收束与共享菜单基础设施

- 普通成果编辑器已取消短提示词人为高度上限，提示词区域现在填满右侧剩余空间；AIDebug 不再豁免短提示词尾部空白。
- 独立 PNG 图层编辑器删除重复“当前图层卡片”，当前层只在统一图层列表中高亮；紧凑高度下可直接看到至少三行图层，提示词区与拉伸控件不再争抢空白。
- 最新可信专项均为 0 失败：
  - UI surface：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T00-22-09-399Z\report.json`；
  - 图片组完整闭环：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T00-29-31-859Z\report.json`；
  - 分层/编辑器完整闭环：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T00-31-09-313Z\report.json`。
- 右键菜单已建立共享 `MenuItem / MenuSeparator / MenuSummary` 基建并完成画布、普通节点、需求节点、分层节点、多选和素材菜单迁移：
  - 图标、正文、快捷键固定三列，长文案统一截断；
  - busy、disabled 由同一组件处理；
  - 删除、解散等破坏性操作使用明确的 `danger` 层级；
  - 菜单摘要和分隔线不再由各业务入口自行拼装。
- UI 基建自测已增加菜单语义、三列布局、危险层级和 separator 契约；迁移后生产首包由 `595,797 bytes` 降为 `595,312 bytes`，不是以复制样式换统一性。
- 最新 UI surface 真实 Electron 专项 0 失败：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T00-42-39-074Z\report.json`。
- 多选命令专项 0 失败：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T00-44-39-518Z\report.json`；分层完整菜单/编辑器专项 0 失败：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T00-45-01-562Z\report.json`。
- 新增可长期复用的 `pnpm run aidebug:menus`：空白画布、普通图片、真实分层图片和多选菜单在 1280×820、884×720 共 8 个场景全部通过；门禁验证视口约束、滚动到末项、按钮重叠、统一间距、三列对齐、`End` 键访问和危险操作视觉，且 fixture 身份来自运行时返回而非硬编码。报告：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T00-52-35-066Z\report.json`。
- 当前冻结门禁通过：`typecheck`、`test:ui-foundation`、`node --check scripts/aidebug-gui.mjs`、`build`、`test:bundle`、`git diff --check`；总 JS `645,808 bytes`，首屏 JS `595,312 bytes`，继续守住不可放宽的 `600,000 bytes` 硬门。
- 当前执行队列：菜单视觉/键盘门禁已结算；下一步完成 Round 5 一次代表性全域验证并冻结 UI 收敛证据，再进入 Round 6 真实 Agent、安装更新和 Forge/服务器发布收官。未通过源码冻结前不得推送或执行 `release:final`。

### 2026-07-20 / Round 5 完成，Round 6 启动

- Round 5 只执行了一次代表性的 Agent-only 全域验收，没有继续堆叠性能轮次；22 个结果、0 failure：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T00-56-41-422Z\report.json`。
- 本轮证明共享菜单与编辑器基础设施没有破坏 Agent 时间线、任务图作用域、成果关系、图片容器、分层恢复和画布交互；Round 5 UI 收敛正式冻结。
- Round 6 当前安全配置已核对为 `gpt-5.6-sol + gpt-image-2`，推理强度 `max`。下一步先跑真实 Agent 自主工具调用专项，要求 `shell_command / workflow / experience / view_image / web_search / image_gen` 全部由模型原生选择，不允许 model-force、tool-choice 强制或参数修正兜底冒充成功；通过后再进入真实图片与发布制品冻结。

### 2026-07-20 / Round 6 第一批：真实 Agent 与真实 Image2 闭环

- 第一次真实 Agent 专项准确暴露 AIDebug 认证隔离缺口：临时配置未复用产品登录态，全部请求被拒绝为 `Unauthorized`。修复后，`--real-agent-suite` 会自动安全复用本机已登录配置，不再依赖隐含的第二参数；该旧失败报告仅保留为因果证据：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T01-00-13-482Z\report.json`。
- AIDebug 真实配置使用完会自动抹除 `agentApiKey / imageApiKey / serverToken / serverSessionCookie / serverUserId`；同时已清理历史诊断目录中 344 份遗留敏感配置，最新真实测试结束后的临时配置复核全部为空。
- 真实 `gpt-5.6-sol` 自主工具专项 6/6 通过、0 issue：`shell_command`、`workflow`、`experience`、`view_image`、Responses 原生 `web_search`、`image_gen` 均由模型自主选择；所有步骤 `model-force=0`、`tool-choice=0`、参数修正 `=0`。报告：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T01-02-01-719Z\report.json`。
- 真实 `gpt-image-2` 闭环 6/6 通过、0 issue：Agent 自主生成 Java 语言娘化 9:16 主视觉，使用 593 字符完整提示词，明确包含 Java、JVM、字节码、咖啡和禁止兽耳；真实成果为 1152×2048 PNG，并在成果落盘后自主调用 `view_image(detail=high)` 复核，再完成回复。报告：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T01-07-52-435Z\report.json`。
- 真实成果：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T01-07-52-435Z\config\projects\default\output\imagegen\agent-agent-1784509773860-1-01.png`。画面达到成年角色、极近景、冲出屏幕、咖啡热流、代码空间和无兽耳要求，且无 temp、placeholder、测试标识或水印。
- 真实 Agent 门禁现进一步要求：live image 成功后必须在 `image_gen tool-done` 之后使用项目 `output/imagegen` 路径完成一次 `view_image`，不能只生成后直接宣称完成。
- 下一批：完成修改后的静态/生产门禁与发布制品审计，冻结客户端源码；随后构建现代安装/卸载、Restart 更新制品与签名 Manifest，执行安装、更新、回滚和服务器下载链路验收，最终统一推送 Forge/部署。

### 2026-07-20 / Round 6 第二批：发布总门禁暴露并修复跨域状态债务

- Agent 文本 UI 发布 E2E 改为使用真实设置抽屉关闭/重开交互验证提示词编辑器 remount，不再用会清空全部弹窗的广域 debug reset；同时将旧的“断开来源图片”断言升级为多输入契约“断开全部输入素材”。完整文本 UI、FastMemory 隔离、需求执行、Markdown 和退出登录样式现全部通过：`E:\项目\iiimage-studio\.diagnostics\electron\agent-text-ui-2026-07-20T01-31-34-127Z\report.json`。
- 发布门禁由此捕获一个真实产品故障：`workflow.canvas.clear` 只清理 React `imageRunStarts`，未同步清理权威 `imageRunStartsRef`，导致已删除的运行中节点永久占用 Agent，后续需求按钮表面可点、运行时却拒绝执行。现清画布会在提交节点状态前同步清理 ref 与 state；AIDebug 状态增加 reservation、active run 和 image run 身份，防止此类隐性占用再次逃逸。
- AskUser continuation 专项删除硬编码节点 `A`，改为从真实 seed 状态读取并持久记录需求来源/需求节点 identity；澄清、SOURCE/REFERENCE 补充、结构化确认、取消、新会话隔离、重载恢复和双来源 staged 结果全部 0 failure：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T01-38-27-534Z\report.json`。
- 图片恢复专项对齐真实 TaskScope：每个独立无来源恢复用例先显式清空选择，避免前一张成果被错误继承为 SOURCE；无来源多提示词局部失败改为原生 `generate + items`，不再滥用 `variants`。限流、402、5xx、网络、socket、超时和局部五次重试全部通过，工具卡身份保持一开始/一结果：`E:\项目\iiimage-studio\.diagnostics\electron\aidebug-2026-07-20T01-49-36-321Z\report.json`。
- 一次且唯一的完整发布源码门禁现为 36/36 PASS，`sourceStable=true`：`E:\项目\iiimage-studio\.diagnostics\release\verify-2026-07-20T01-54-38-418Z\report.json`。覆盖 Agent、New API、图片、分层、PSD、导入、生命周期、UI、AskUser、恢复、画布清晰度、容器、产品性能、生产构建、更新与回滚助手。
- 当前生产包：总 JS `645,822 bytes`，首屏 JS `595,326 bytes`，继续通过 `600,000 bytes` 硬门。下一步执行唯一正式编排 `pnpm run release:final`；只有安装、启动、更新、回滚、SHA 与签名全部通过后才移除 incomplete marker。

### 2026-07-20 / Round 6 完成：客户端 1.0.3 正式冻结

- 第一次正式编排准确阻断在同版本修复安装：外层品牌安装器持有全局操作锁，electron-builder NSIS 在升级时使用 `/S --updated` 调用已注册的品牌卸载器，内层卸载器被误判为并发操作并返回 `1618`，NSIS 因而持续等待到 300 秒超时。失败报告：`E:\项目\iiimage-studio\.diagnostics\release\final-release-2026-07-20T02-02-46-475Z\orchestrator-report.json`；不可发布标记在失败后被正确保留。
- 安装/卸载基础设施现使用一次性操作 token 支持受控嵌套：只有同一父升级链中的 `silent + --updated` 卸载器可以验证 token 后加入；错误 token、普通并发安装和独立卸载仍被拒绝。锁探针证明首次获取、并发拒绝、合法继承、伪 token 拒绝和释放后重获全部通过：`E:\项目\iiimage-studio\.diagnostics\installer-operation-lock-token-probe.json`。
- 安装器 smoke 执行器由同步等待升级为可观测异步进程树；任何超时会在 wrapper 仍存在时执行整树终止，最终报告强制要求 `forcedCleanupCount=0`、无孤儿进程、无 operation lock 残留，避免测试失败后污染下一轮。
- 修复后的独立完整安装专项通过：首次安装、两次修复安装、已安装路径锁定、快捷方式偏好保持、受保护目录拒绝、故障/取消回滚、默认卸载保留数据、显式清理受管数据且保留外部项目、零残留文件、零孤儿进程、零强制清理、零锁残留。报告：`E:\项目\iiimage-studio\.diagnostics\release\installer-smoke-2026-07-20T02-34-11-783Z\report.json`。
- 唯一正式发布编排随后从头完成，结果 `ok=true`，源码前后 digest 完全一致，不可发布标记已移除：`E:\项目\iiimage-studio\.diagnostics\release\final-release-2026-07-20T02-35-25-546Z\orchestrator-report.json`。
- 正式编排覆盖并通过：36 项源码门禁、生产构建、品牌安装/卸载 UI、打包运行、安装/修复/卸载、桌面更新协议、更新 helper、Ed25519 Manifest、Restart `1.0.2 → 1.0.3` E2E、设置/登录会话/FastMemory 保留、备份与临时源清理、最终 SHA/元数据/签名校验。
- 最终客户端制品：
  - Setup：`E:\项目\iiimage-studio\release\iiimage-Studio-Setup-1.0.3-x64.exe`，`113,210,880 bytes`，SHA-256 `f98407a4f6607da35851977cdb2d4466992b34d85267768d294f773d0d46d5c2`；
  - Restart ASAR：`E:\项目\iiimage-studio\release\iiimage-Studio-Restart-Update-1.0.3-x64.asar`，`45,892,810 bytes`，SHA-256 `aa136758104bb8c7c433d16022e08b49e66e17d4ae2215237a99b8744fb81de5`；
  - Manifest：`E:\项目\iiimage-studio\release\desktop-release.json`，SHA-256 `8c83b2e9716f247b91e00389b5be0ed2424bfa19ba64916181ff37f3f89ff597`，签名验证通过；
  - 桌面交付副本：`C:\Users\29488\Desktop\iiimage-Studio-Setup-1.0.3-x64.exe`，哈希与正式 Setup 完全一致。
- 客户端本地冻结已经完成，但总 Goal 尚未结束：Studio 与 CRM 仍需提交/推送到可信 Forge，服务器需部署 1.0.3 制品与 Manifest，并完成官网登录下载、验证码、防打、Telemetry、在线更新和真实客户端升级的生产 E2E。

## 14. 客户端冻结后的发布任务图

后续只允许按以下门推进；任何一步失败都必须保留线上旧版本并修复根因，不得用手工替换或跳过验证冒充发布成功。

### Gate A：仓库冻结与敏感信息审计

- 审查 Studio 与 CRM 的全部 staged/unstaged/untracked 变更，确认不存在 cookie、API Key、私钥、服务器 token、诊断临时登录配置或用户图片隐私。
- 保留项目内发布公钥与已签名公开元数据；更新私钥只能存在项目本地受控配置中，不得进入提交。
- Studio 与 CRM 分别运行其最终静态门禁和 `git diff --check`；生成明确提交边界与发布说明。

### Gate B：Forge 推送

- Studio 推送到可信仓库 `https://git.aieyra.cn/aieyra/iiimage-studio.git`。
- CRM/后端以 `E:\项目\ai-native` 当前整合结果为准，推送到自身可信 Forge origin；不得把 Gitee token 或服务器 SSH 私钥写入仓库。
- 推送后再次读取远端 commit，证明本地冻结提交与 Forge 目标一致。

### Gate C：服务器原子部署

- 使用 CRM 已完成的发布脚本验证 Setup、Restart ASAR、Manifest、sidecar、SHA-256 与 Ed25519 签名，再执行原子切换；任一校验失败必须保留线上 `1.0.2`。
- 部署官网下载入口、登录后下载、每次验证码、IP/账号限频、受控 Telemetry 和客户端认证；不得扩大日志采集到用户图片、提示词正文或无关隐私。
- SSH 保持可用，同时核验 Fail2ban/基础限流不会封死正常登录、下载和更新请求。

### Gate D：生产 E2E 与交付

- 未登录访问下载入口必须得到登录引导；已登录并完成验证码后可下载，错误验证码、频率超限和未授权请求被明确拒绝。
- 线上 Setup 哈希必须等于 `f98407a4f6607da35851977cdb2d4466992b34d85267768d294f773d0d46d5c2`；线上 Restart ASAR 哈希必须等于 `aa136758104bb8c7c433d16022e08b49e66e17d4ae2215237a99b8744fb81de5`。
- 已安装 `1.0.2` 的隔离客户端从生产 Manifest 检查更新、下载、重启至 `1.0.3`，并证明登录会话、项目、设置和 FastMemory 保持；失败路径证明可以回滚。
- 官网、CRM 账务/流水、New API Agent 调用、`gpt-5.6-sol + gpt-image-2`、Telemetry 和封禁/认证链路完成一次收束式核验后，才可将总 Goal 标记为完成。

## 15. 持续执行约束

- 本文件继续是唯一权威任务图；不建立重复计划文档，不因临时问题丢失总目标。
- 每次动作必须至少产生一种实质成果：代码差异、可复现诊断、通过/失败报告、冻结制品、远端 commit 或生产 E2E 证据。
- 不以重复跑相同测试代替进度；专项通过后立即推进下一 Gate。
- 不把“本地构建成功”等同于“已经发布”，也不把“服务器同步成功”等同于“用户链路可用”。最终结论必须同时具备仓库、服务器、下载、安装、更新和业务链路证据。

## 16. 最终收官执行计划与状态

本节是后续动作的唯一短期执行队列；完成一项即写入证据，不再创建平行计划文档。

| 顺序 | 工作项 | 验收证据 | 当前状态 |
| --- | --- | --- | --- |
| 1 | 客户端 1.0.3 冻结与正式制品 | `release:final`、安装/修复/卸载、Restart 更新、回滚、签名与 SHA | 已完成 |
| 2 | Studio 与 CRM 推送 Forge | 本地 HEAD 等于各自 `origin/main` | 已完成 |
| 3 | 服务器原子部署 | Forge HEAD、服务器仓库 HEAD、deployed SHA 一致；服务健康 | 已完成 |
| 4 | 官网下载与更新生产 E2E | 登录、验证码、限频、Range、票据单次使用、Restart/Installer 分流 | 已完成 |
| 5 | Managed Agent 与图片生产 E2E | Responses、generation、edit、幂等重放与冲突、真实图片审看 | 已完成 |
| 6 | 账务、渠道与隐私核验 | New API 单次消费记录、渠道归属、Telemetry 白名单入库及越界拒绝 | 已完成 |
| 7 | 短期票据清理、总纲回写与文档提交 | 无原始 challenge/ticket；Studio 文档提交并推送 Forge | 已完成 |
| 8 | 最终一致性复核并结束 Goal | 两仓干净，线上 Manifest/哈希/部署 SHA 不漂移 | 已完成 |

所有后续动作仍必须产生代码差异、诊断、制品、远端提交或生产证据之一。若只得到重复的既有通过结果，不计为推进。

## 17. Round 6 发布与生产闭环

### 17.1 Forge、服务器与制品一致性

- Studio 正式提交 `cd6274aaaf50166c4b0a9e7f6fef8d3013400fa6` 已推送 Forge，执行生产 E2E 前本地 HEAD 与 `origin/main` 一致。
- CRM/后端正式提交 `f5f29b141d99f084e056db196d4038a10a8726bb` 已 fast-forward 到 Forge `main`；生产服务器 `/opt/iiimage/src` 的仓库 HEAD、Forge main 与 deployed SHA 均一致。
- 首次自动部署因旧脚本缺少 New API 状态备份而正确回滚；新脚本生成 `/opt/iiimage/src/deploy/production/runtime/backups/new-api-state-20260720-031341.tar.gz` 后重试成功，没有绕过回滚门禁。
- `2026-07-20T03:14:39Z` 生产核验通过：New API、CRM、MySQL、Caddy、部署 watcher、SSH key-only、Fail2ban、TLS、安全头、私有端口、匿名 401 与超大请求 413 均符合发布要求。

### 17.2 官网下载、在线更新与 Telemetry

- 证据目录：`E:\项目\iiimage-studio\.diagnostics\production-e2e-20260720T0315Z`。
- 登录态验证码授权返回 200；安装包先下载 1 MiB 后使用 Range 续传返回 206，最终大小和 SHA 与正式 Setup 完全一致。
- 同一下载票据重放返回 403 `desktop_download_ticket_invalid`；错误验证码返回 400 `download_captcha_invalid`。
- `1.0.2 → 1.0.3` 返回 `update_type=restart`，不要求验证码，线上 ASAR SHA 正确且票据不可重放；`1.0.0 → 1.0.3` 返回 `update_type=installer` 且 `requires_captcha=true`。
- 合法聚合 Telemetry 返回 200；包含 `prompt` 的越界字段返回 400 `desktop_client_event_invalid`。生产日志窗口内只有一条 `desktop_client.event` 入库，参数仅含版本、平台、架构、发布通道、组件、计数和耗时；拒绝请求没有第二条记录，也没有提示词、图片路径、项目名或设备标识。

### 17.3 Managed Agent、生成、编辑与幂等计费

- `/iiimage/v1/models` 返回 200，并包含固定的 `gpt-5.6-sol` 与 `gpt-image-2`。
- `/iiimage/v1/responses` 返回 200 并正确输出 `IIIMAGE_PRODUCTION_OK`，历史 New API 404 已从生产链路消失。
- 生产 generation 首次返回 200；同键同请求返回完全一致的 200，同键不同 payload 返回 409 `idempotency_payload_mismatch`。成果为 `managed-image-generation.png`，已完成真实审图。
- 新增可复用命令 `pnpm run release:production:image-edit`，只从项目忽略配置读取登录态，输出摘要不包含 cookie、用户票据、API Key 或提示词正文。
- 生产 `/iiimage/v1/images/edits` 实测：首次 200，耗时 `70,700 ms`；同键重放 200，耗时 `1,835 ms` 且响应成果身份完全一致；同键不同请求返回 409 `idempotency_payload_mismatch`。
- 编辑证据：`E:\项目\iiimage-studio\.diagnostics\production-image-edit-2026-07-20T03-28-05.989Z\summary.json`；成果 `managed-image-edit.png` 为 `2,373,104 bytes`，SHA-256 `b876e734ac360033abb03fda884ddc7d0ece97d0902b518bd319e6ae7aebc4aa`。
- 人工原图审看确认：成年东方女性身份、脸部结构和极近景构图被保留，主视觉成功调整为翡翠青，朱红印章克制可见，无文字、水印、兽耳或明显画面损坏。
- 生产 New API 日志在该编辑时段只有一条对应 `gpt-image-2` 消费记录：`quota=24665`、`prompt_tokens=1634`、`completion_tokens=1372`、`use_time=67`、`channel_id=1`。同键重放和 409 冲突均未产生第二条消费记录，证明没有二次计费或二次生成。
- Responses、generation、edit 三类真实调用均归属启用中的渠道 `channel_id=1 / shengtu`；日志拥有独立 request ID，usage、quota 和渠道归属字段完整。

### 17.4 收官结论

- 生产 E2E 目录内的 `captcha-response.json`、`captcha-invalid-response.json` 与 `authorize-response.json` 已删除；只保留不含短期 challenge/ticket 的状态、哈希和成果证据。
- 新增生产 edit E2E 脚本已通过 `node --check`、`git diff --check`、`package.json` 解析与实际敏感值比对；没有提交 cookie、API Key、私钥或服务器 token。
- 脚本、命令入口和第一版生产收官证据已由 Studio 提交 `24a1d0ff04d932e3a09bbad093b66934fd38cccb` 推送 Forge。
- 最终复核时 Studio 本地 HEAD 等于 Forge `origin/main`；CRM 本地与 Forge 均为 `f5f29b141d99f084e056db196d4038a10a8726bb`，生产服务器仓库 HEAD 仍为同一提交。
- 生产服务器上的 Setup、Restart ASAR、Manifest SHA 分别仍为 `f98407a4...d46d5c2`、`aa136758...b81de5`、`8c83b2e9...89ff597`；线上更新检查返回 `current=latest=1.0.3`、`update_available=false`，同时返回完整签名与正确的两个制品 SHA。
- 客户端、Agent、Image2、画布任务图、安装/卸载、更新/回滚、Forge、服务器、下载、认证、Telemetry、账务与渠道链路均已有对应代码、测试、制品或生产证据。本总 Goal 达到阶段性正式发布标准，可以结束；后续新需求应建立新的版本 Goal，而不是重新打开本次发布收官。
