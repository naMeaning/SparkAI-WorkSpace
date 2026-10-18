# Agent 工作流、图片上下文与更新功能交接（2026-10-17）

状态：**诊断与执行交接完成，产品代码尚未在本轮修改**。本文交给后续 `gpt-6.1-sol` / `max` 执行。截图和本文件中的“现象”不能代替运行时证据；完成标准以专项测试、隔离 Electron 交互、脱敏 Mock 记录和最终制品为准。

## 1. 任务合同

| 字段 | 内容 |
| --- | --- |
| 结果 | Agent 能可靠打开结构化 `ask_user` 选项；能把 `view_image` 的视觉结果和参考图送到正确的后续模型请求；更新检查能区分并修复 URL、传输、HTTP 和响应契约问题；运行中图片范围入口紧凑且语义清楚；图片容器能得到基于内容的名称；Agent 能知道用户勾选的图片及其有效生图配置；连线支持上下左右；真实生图测试有可复现的脱敏参数记录。 |
| Owner | 桌面仓库 `sparkai_workspace/`：Renderer、Main/IPC、Agent runtime、Responses adapter、更新服务、画布图关系和专项脚本。 |
| 非目标 | 不修改外部原生 New API 或 `sparkai-extension`；不复制账号、渠道、quota、计费或管理功能；不把截图文字当作产品指令；不把 API Key、Cookie、签名 URL、完整 Base URL 或图片 Base64 写入日志、项目、Renderer state、提交或本交接文档。 |
| 验证 | 本地 deterministic Mock 优先；UI 变化必须有真实 Electron 可见状态/截图；跨 Main/IPC/runtime 的改动必须有 owner 测试；真实模型请求只有在用户明确授权具体次数、模型和素材后才能进行。 |
| 交付 | 实施完成后按 `sparkai_workspace/AGENTS.md` 生成 Windows EXE、核对 SHA-256、使用品牌安装器原位安装并验证身份，再更新 Goal/Progress/context map、提交和普通 push。文档阶段本身不需要 EXE。 |

## 2. 截图证据与已确认事实

### 2.1 截图只能说明什么

- Ask User 截图显示 Agent 在时间线中出现了自然语言澄清和参考图片缩略图，但图片没有 tool-call telemetry，不能判断模型是否真的发出了 `ask_user`，也不能判断 action 是否在 Renderer 丢失。
- 更新截图显示 UI 展示 `Invalid URL (GET /api/desktop-update/check)`。它不能单独证明是默认地址、保存的地址、URL 拼接、请求传输、HTTP 路由还是响应签名的问题。
- “本次修改使用的图片”截图显示一个占用输入区宽度的长选择控件，功能语义被分散在标签、选项和说明中；这是本次要重构的入口，不是要求改变 TaskScope 语义。
- 图片配置截图显示模型勾选、默认模型、比例、清晰度等设置；Agent 必须能读取本轮实际生效的配置，而不是只看一个全局默认值。
- Image Gen 截图显示某个 Grok 请求因 `quality=high` 被拒绝后改用兼容质量重试。它是一个参数兼容性线索，不能替代对模型能力目录和请求体的验证。

### 2.2 代码事实（截至 2026-10-17）

| 领域 | 已确认入口/事实 | 未确认问题 |
| --- | --- | --- |
| `ask_user` | `src/ask-user-dialog.tsx` 已有 2–3 个 radio 选项、自定义回复和提交；`agent-runtime.cjs` 产生 `ui.ask_user.open`；`src/main.tsx` 持久化 pending execution 并在同一 TaskScope 上续跑；`runtime/tool-schemas.cjs` 已公开结构化 schema；`scripts/aidebug-ask-user-continuation-suite.mjs` 已覆盖结构化选项、续跑、重载和取消。模型调用目前使用 `tool_choice: "auto"`。 | 截图对应运行是否没有 tool call，还是 action/pending bridge 没到 Renderer。不能用正则解析问号、项目符号或 “Clarifying...” 文字来强开弹窗。 |
| `view_image`/参考图 | `agent-runtime.cjs` 已暴露 `view_image`，校验项目路径后返回 `modelOutput` 的 `input_image`；`desktop/agent-responses-adapter.cjs` 可将图片输出并入下一次 Responses/Chat context；TaskScope 已带 source/reference materials；`image_gen` 与 `view_image` 是两条独立路径。 | 成功调用 `view_image` 不等于该视觉结果进入同一模型 continuation；TaskScope 有参考图也不等于最终 generation request body 带上正确文件、角色、用途和顺序。 |
| 更新 | `src/settings-persistence.ts` 和 `electron-main.cjs` 的默认更新地址为 `https://sparkapi.org`；`desktop/new-api-client.cjs` 根据 `service: "update"` 解析绝对地址；`desktop/updater-service.cjs` 请求 `/api/desktop-update/check`；已有 `test:update`、`test:update-rollback`、`test:update-helper`。 | 需要用本地 Mock 分开验证保存设置归一化、绝对 URL、传输、HTTP 错误、JSON/签名/版本契约。不要仅凭截图改成另一个生产地址。 |
| 运行中范围 | `src/project-agent-composer.tsx` 当前使用 `auto`、`keep`、`replace-source` 三个值；`main.tsx::steerAgentRun` 把它们解析为 `TaskScope` 的 source/reference mode，Goal 运行时锁定范围。 | 入口可变紧凑，不改变这三个语义，也不增加持久化字段。 |
| 内容命名 | `src/image-content-title.ts` 已有 `normalizeGeneratedImageContentPresentation`、`imageContentSummaryTitle` 和通用标题过滤；runtime 仍有多处 `shortTitle(prompt)`、`图片组` 等生成式回退。 | 尚未保证“哆啦A梦”这类主体名来自实际图像内容，也没有把命名来源/置信度作为可审计信息。 |
| 选中图片/配置 | `main.tsx` 的 canonical selection 是 `selectedNodeId` + `selectedNodeIds`；`selectedNodes` 经过 `buildComposerMaterials` 形成 `composerMaterials`，再构造 `TaskScope`。生图配置来自全局设置，同时每个图片节点保留 `imageParams`。 | 需要让模型上下文明确列出本轮选中图片的稳定 display code、节点/资产身份、角色、用途和有效 ratio/resolution/size/quality/model；不能让模型猜配置或读取私有路径。 |
| 连线 | `main.tsx::connectNodes` 和 `connectCanvasRelations` 持有图语义、循环检查和 requirement 约束；Renderer 目前渲染单一 input/output `.node-port`，CSS 在 `src/styles/02-canvas-workspace.css` 中定位左右两侧。 | 需要把视觉连接点扩展为上下左右，且区分“几何起点/终点”与既有 source→target 关系语义，保持循环和 requirement 规则。 |

## 3. 实施方案

### A. `ask_user` 选项不弹出

1. 在模型请求、工具解析、`executeToolCall`、`flushParallelToolCalls`、Main action bridge、pending persistence 和 Renderer open handler 增加短期脱敏 trace。每条只记录 `runId`、`conversationId`、`modelRound`、tool name、`requestId`、action type、options 数量/ID、状态和耗时，不记录问题正文、答案、凭据或路径。
2. 先用 scripted model 重放两条用例：确实发出 `ask_user` 的结构化调用；只输出自然语言而没有 tool call。两者必须在报告中明确区分。只有前者要求 `ui.ask_user.open`；后者应显示普通 Agent 回复，不得用文本正则伪造弹窗。
3. 若 tool call 存在而 UI 不开，修复 action/pending 的桥接、持久化或恢复竞态；若 tool call 不存在，修复 schema、prompt、模型适配或测试 mock，保持 `tool_choice: "auto"` 的真实语义。提交选项后验证同一 `snapshotHash`、image frame 和 conversation 续跑。
4. 扩展现有 `aidebug:ask-user`：结构化 options、reload 后恢复、取消后不续跑、错误后可重试、自然语言无 tool call 不弹窗。不要降低已有 `minItems=2/maxItems=3` 和自定义回复约束。

### B. `view_image` 与参考图闭环

1. 给每一轮模型请求生成 `continuationId`，把 `view_image` 的 `modelOutput`、adapter 转换后的 input parts 和下一次模型请求的脱敏摘要关联起来。验收必须能看到 `input_image` 的数量、detail、asset identity hash，而不是只看到“工具成功”。
2. 为 generation 构造不可变 `reference manifest`：`displayCode`、`assetId`、`contentHash`、`role`（source/reference）、`purpose`、`nodeId`、`assetIndex`、顺序和 snapshot hash。请求前记录 manifest hash，请求后从实际 adapter body 记录同一 manifest 的可验证摘要；不得把本地绝对路径或 Base64 写入报告。
3. 维持顺序：用户明确选中/TaskScope 冻结顺序优先，模型不得自行用“全局首素材”替换；`view_image` 只读当前项目授权路径。Goal 的冻结 SOURCE/REFERENCE 规则继续有效，普通任务的 materials 规则继续有效。
4. 加入失败用例：视觉 review 成功但 generation 漏参考、参考角色错位、续跑后 snapshot 变化、路径越界、重复素材。模型若承诺“已查看”但没有对应 tool result，timeline 应标为未完成，不能静默当作完成。
5. 对图片生成后的视觉质检，保留“单图必须 review、多图按代表/首尾/异常 review”的策略；实现可审计的 review-required 状态，避免仅靠 prompt 文案。

### C. 软件更新报错

1. 在 `resolveNewApiBaseUrl(settings, "update")`、`newApiRequest`、`performDesktopUpdateCheck` 周围输出脱敏诊断：`configuredOrigin`、`resolvedOrigin`、`endpointPath`、是否绝对 URL、transport 阶段、HTTP status、响应 JSON schema 结果。禁止输出 API key、Cookie、完整 URL query、签名下载地址。
2. 增加本地 HTTP Mock，分别覆盖：默认地址、空/损坏的 `updateBaseUrl`、旧弃用地址迁移、同源/异源 HTTPS、`Invalid URL`、DNS/连接失败、404/405、非 JSON、签名不匹配、版本不兼容和合法“无更新”。每类都要有稳定错误码或可读状态，不能把所有问题显示成 `Invalid URL`。
3. 只在证据确认后改 URL 或归一化逻辑。更新 check、authorize、captcha、下载和回滚的 endpoint/响应契约必须一起核对；不能通过把相对路径直接交给 `fetch` 来掩盖 base URL 为空。
4. 保留现有签名验证、可信下载路径、磁盘空间、回滚和安装安全门槛。真实更新服务只在用户明确授权时联调，本轮不请求外部更新服务。

### D. 紧凑化“本次修改使用的图片”

1. 保留 `auto`、`keep`、`replace-source` 和 Goal 锁定语义，只改呈现：输入区内显示图片图标 + 短标签，例如 `范围：自动跟随`；点击后打开锚定 radio popover。
2. 建议标签：`自动跟随`、`保留现有范围`、`改用当前选中`。每项用一行解释影响，当前选项有 `aria-checked`，支持 Escape、方向键、Enter、点击外部关闭，按钮有 tooltip。不要再显示一整块长 select 和重复说明。
3. popover 关闭后只保留短摘要；当没有当前选中图片时，`改用当前选中` 可禁用并说明原因。Goal 运行中显示锁定状态，不可偷偷更换范围。
4. 复用 `steerAgentRun` 的 mode 映射和 `TaskScope` 候选快照，不新增 settings 字段。用 884px 最小窗口、键盘操作、屏幕阅读器属性和截图验证无溢出。

### E. 图片容器基于内容命名

1. 统一所有 `workflow.node.create` / image collection / asset presentation 的命名入口，优先级为：用户明确名称 > 已有非通用名称 > 同一模型 continuation 的视觉命名结果 > 结构化 prompt subject > 安全的通用回退。不能让 runtime 各处继续拼接互相冲突的 `shortTitle`。
2. 生成成功并完成 `view_image` 后，让同一模型 continuation 按严格 JSON 返回短名称（例如 `{"displayName":"哆啦A梦","confidence":"high"}`），只允许 1–48 字符，禁止路径、模型名、测试 nonce、内部 ID、营销句子和敏感信息。解析失败时使用 `image-content-title.ts` 的 deterministic fallback，不阻塞图片交付。
3. 容器名、每个 asset title 和 timeline 显示名分别保留；多张相同主体自动用稳定序号消歧。名称来源和置信度可进入内部脱敏 metadata，不能把模型原始长回复写入项目。
4. 测试真实可识别 fixture（哆啦A梦、商品、人物、抽象图）、无文字提示、重复批量和模型命名失败。验收要求容器和缩略图至少显示主体名，不再默认显示“图片成果/批量图片组”作为最终名称。

### F. 让 Agent 知道勾选图片及有效配置

1. 继续以 `selectedNodeIds`/`selectedNodes` 为唯一选择来源；在 dispatch 前生成 `selection manifest`，包含稳定 display code、nodeId/assetId、asset index、标题、source/reference role、purpose、content hash、容器槽位和选中顺序。
2. 对每个选中图片计算有效配置：节点 `imageParams` 覆盖项目默认值，项目默认值覆盖 provider/model capability fallback；至少列出 model、ratio、resolution、size、quality、count、output format 和 protocol/capability compatibility。配置值来自同一份 frozen TaskScope，不让 Agent 读取过期 React state。
3. 将 manifest 以受限结构化上下文同时放入模型 prompt/tool input 和 generation request metadata；对模型隐藏绝对路径、API key、Cookie、签名 URL。必要时只显示项目相对素材标识和 content hash 前缀。
4. 增加一个 `selection/config snapshot` 调试视图或脱敏报告，让测试能证明用户勾选的是哪些图、Agent 收到哪些图、generation 实际用了哪些图和配置。选中后 reload、steer、Goal 冻结和多选顺序都要验证。

### G. 真实生图参数学习与授权边界

1. 先用本地 Mock 覆盖 OpenAI-compatible、New API/Sub2API 和 Grok-like 参数适配，尤其验证 `quality=high` 不被不支持的模型发送；能力目录必须决定可用 quality/size/ratio，而不是盲目重试。
2. 只有开始真实联调前，向用户明确询问：Base URL、API Key、模型、次数（默认 1）、素材、是否允许写入脱敏诊断。用户明确授权后才执行；创建不明时不重发。
3. 凭据只在内存和一次隔离进程使用，测试结束立即清理。记录内容仅包括 provider/protocol、模型、endpoint path、ratio、resolution/size、quality、count、reference count/roles、HTTP status、耗时、错误类别、适配决策和生成结果 hash/尺寸；不记录 key、cookie、完整 URL、prompt 原文、图片 Base64 或 signed URL。
4. 记录“参数来自哪里”和“是否因 capability 归一化”：例如 `requestedQuality=high`, `effectiveQuality=standard`, `reason=model-does-not-support-high`。这份记录用于后续 Agent 学习，不把一次偶然成功当成所有供应商都兼容。

### H. 连线支持上下左右

1. 保留 `connectNodes`/`connectCanvasRelations` 的 source→target、循环检测、需求节点输入角色和 `replaceExisting` 语义；只扩展端口几何和拖拽方向。
2. 每个节点提供 top/right/bottom/left 的可访问 connection handle。拖拽可以从任一侧开始并在任一侧结束；拖拽起点只决定 source/target 的连接方向，关系箭头和 timeline 仍表达真实 graph 方向。若从 input 侧反向拖出，必须有明确视觉提示，不要隐式改写关系类型。
3. 用统一的端口 hit-area、nearest-side 计算和正交/曲线路径算法绘制关系；不把 CSS 位移当作图语义。旧关系加载后默认按端点最近侧渲染，保存结构不需要新增持久化字段，除非证据表明必须保存用户指定侧。
4. 覆盖 16 种 side-to-side 组合、拖拽取消、节点重叠、缩放/DPI、屏外节点、键盘可达、循环/非法 requirement 关系和 reload。连线交互不能破坏画布平移、框选、节点 resize 或移动端/小窗口布局。

## 4. 诊断与 Mock 顺序

1. **基线**：运行 `git status --short`，保留用户 dirty changes；读取当前 Goal/Progress；先运行现有针对性测试，保存未修改基线。
2. **协议 trace**：为 Agent、update 和 TaskScope 增加脱敏 trace，并用 scripted model/HTTP Mock 重放；先判断故障层级，再改代码。
3. **runtime/contract**：先修数据流和 snapshot/manifest，再修 UI。每个 manifest 都要能从 dispatch 对到 adapter 或 server request。
4. **Renderer**：实现紧凑范围 popover、四向端口和命名显示，加入真实 Electron screenshot/observable-state 证据。
5. **真实联调（可选）**：仅在用户对具体请求授权后，向用户索取 Base URL/API Key；不要把凭据写进本交接、Git 或诊断附件。
6. **收口**：运行受影响专项、typecheck、production build、EXE/安装/身份核验；更新 Goal、Progress、context map 和文档索引，分开报告已验证、未验证和真实服务限制。

## 5. 验收矩阵

| 工作包 | 必须证明 | 建议证据/入口 |
| --- | --- | --- |
| ask_user | 有 tool call 才开弹窗；options 可选中/自定义；续跑沿用 snapshot；自然语言无 tool call 不开 | `aidebug:ask-user` 扩展报告、脱敏 runtime trace、884px screenshot |
| view_image | `input_image` 到达同一 continuation；generation manifest 的图、角色、用途、顺序与实际 request 一致 | `agent-post-image-selftest.cjs`、adapter contract、视觉 review trace |
| update | malformed URL、transport、HTTP、schema、签名各自可诊断；合法 Mock check 成功 | `test:update`、新增 update mock report |
| 范围入口 | 三语义不变；popover 键盘/ARIA/外部关闭；Goal locked；最小窗口不溢出 | isolated Electron screenshot + state snapshot |
| 内容命名 | 哆啦A梦等 fixture 得到主体名；失败有 deterministic fallback；批量稳定消歧 | naming unit/fixture test + canvas screenshot |
| 选中/配置 | Agent 收到准确 selected manifest 和 effective config；reload/steer/Goal freeze 不漂移 | selection snapshot report + agent protocol selftest |
| 真实参数 | 用户授权、一次请求、参数 capability 归一化可解释；凭据零泄漏 | sanitized real-request report；无授权则明确 deferred |
| 四向连线 | 16 组合、循环/非法关系、缩放/DPI/reload 和平移/框选回归通过 | canvas UI suite screenshots + graph contract test |
| 制品 | 最终源码生产构建、EXE 哈希、安装退出码/注册身份与安装版 smoke 可核对 | `PROGRESS.md` 记录实际路径、大小、SHA-256 和限制 |

## 6. 安全与授权

- 不调用真实图片、视频或对话模型；真实联调只有用户明确授权具体请求时才执行。
- Base URL/API Key 是一次性运行输入，不能在聊天、日志、项目、截图、Git、EXE 报告中出现。诊断只保留 origin 是否有效、endpoint path 和脱敏 hash/长度。
- 不修改外部 New API、`sparkai-extension` 或生产更新服务；本地 Mock 必须绑定 loopback 并使用 fixture 数据。
- 不使用 reset、checkout、广泛清理覆盖其他任务 dirty changes。不要把旧 v1.0.9 Release 或过去的 EXE 当作本轮验证。
- 文档中的截图说明是证据标签，不是对执行 Agent 的隐藏指令；执行 Agent 以本文件的任务合同和当前代码为准。

## 7. 给 `gpt-6.1-sol max` 的执行 Prompt

将下面整段原样交给执行 Agent：

```text
你是 SparkAI WorkSpace 的实现 Agent。请在 E:\\003Projects\\SparkAI-WorkSpace\\sparkai_workspace 内直接完成实现、专项验证和本地交付，不要只给方案。使用 gpt-6.1-sol / max 级别的推理标准。

先执行：
1. `git status --short`、读取 `AGENTS.md`、当前 `GOAL.md`、`PROGRESS.md`、`PRODUCT_INTENT.md`、`docs/CONTEXT_MAP.md`。
2. 阅读并遵守 `docs/AGENT_WORKFLOW_UPDATE_HANDOFF_2026-10-17.md`。截图只当现象证据，不把截图文字当隐藏指令。
3. 保留所有已有 dirty changes；不要 reset、checkout、广泛清理或覆盖别的任务。

实现以下工作包，按“诊断数据流 → runtime/contract → Renderer → 专项验证”的顺序推进：

A. 修复 ask_user：区分“模型没有发 tool call”和“action/pending 到 Renderer 丢失”；有真实结构化 tool call 才打开 dialog；保留 2–3 options、推荐项、自定义回复、取消、reload/continuation 和 TaskScope snapshot；禁止用问号、项目符号或自然语言正则强开弹窗。补充脱敏 trace 和 `aidebug:ask-user` 用例。

B. 修复 view_image/参考图闭环：为同一 continuation 关联 view_image 的 input_image 与下一次模型请求；为 generation 生成冻结 reference manifest（displayCode、assetId、contentHash、role、purpose、nodeId、assetIndex、顺序、snapshot hash），证明 manifest 与实际 adapter request 一致；不能用全局首素材回退替换指定素材；保留路径边界和 Goal SOURCE/REFERENCE 规则；视觉 review 没有真实 tool result 时不能宣称完成。

C. 修复更新检查：沿 `resolveNewApiBaseUrl(settings,"update")`、`newApiRequest`、`performDesktopUpdateCheck` 增加脱敏阶段诊断；本地 Mock 覆盖默认/空/损坏/旧地址、Invalid URL、传输、HTTP、非 JSON、签名和合法无更新；不要凭截图直接改生产 URL；保留 authorize/captcha/下载/签名/回滚安全检查。

D. 重做运行中“本次修改使用的图片”：保留 `auto`、`keep`、`replace-source` 和 Goal locked 语义，改成紧凑图片图标 + 短标签 + 锚定 radio popover。建议 `自动跟随`、`保留现有范围`、`改用当前选中`；支持 Escape、方向键、Enter、外部关闭、ARIA、tooltip 和 884px 截图；不新增 persistence 字段，复用 steerAgentRun/TaskScope。

E. 图片容器自动命名：统一 workflow.node.create/image collection/asset presentation 的命名入口；用户明确名 > 非通用已有名 > 同一 continuation 的 view_image 后视觉命名 > prompt subject > deterministic fallback。视觉命名严格 JSON，限制 1–48 字符和敏感词/内部信息；失败不阻塞交付；用哆啦A梦、商品、人物、抽象、批量重复 fixture 验证，确保不再把“图片成果/批量图片组”作为最终主体名。

F. 选中图片和配置上下文：以 `selectedNodeIds`/`selectedNodes`/`composerMaterials` 为唯一 authority；dispatch 时生成 selection manifest，包含稳定 display code、node/asset identity、角色、用途、容器槽位、content hash 前缀、顺序；为每个选中图计算节点 imageParams 覆盖项目默认、项目默认覆盖 capability fallback 后的有效 model/ratio/resolution/size/quality/count/output format/protocol。把同一 frozen snapshot 放进模型上下文和实际 generation metadata，隐藏绝对路径/API key/Cookie。补 snapshot report 与 reload/steer/Goal freeze 测试。

G. 真实生图参数：先用本地 Mock 验证 OpenAI-compatible/New API/Sub2API/Grok-like 适配，尤其不要把不支持的 quality=high 盲目发给模型。需要真实联调时，只有在我明确授权具体请求后，才能向我索取 Base URL/API Key，并默认只发 1 次 n=1 隔离请求；创建不明绝不重发。凭据只在内存使用，报告只记录 provider/protocol、模型、endpoint path、尺寸/质量/数量、参考角色数量、HTTP status、耗时、错误类别、capability 归一化原因和结果 hash/尺寸，不记录 key、cookie、完整 URL、prompt 原文、Base64 或 signed URL。

H. 四向连线：保留 connectNodes/connectCanvasRelations 的 source→target、循环检查、需求 input role、replaceExisting 语义；每个节点提供 top/right/bottom/left 可访问 handle，任一侧可开始/结束，关系箭头仍表达 graph 方向；使用统一 hit-area、nearest-side 和路径算法；覆盖 16 side pairs、取消、重叠、缩放/DPI、屏外、键盘、循环/非法 requirement、reload，并确保不破坏平移/框选/resize。

验证要求：
- 先跑现有针对性测试，再跑新增专项、typecheck、production build。
- UI 必须用真实隔离 Electron 证明可见状态、键盘/ARIA、最小窗口和截图；静态搜索不能作为完成证据。
- 不调用真实模型，除非我在当前会话明确授权具体次数/模型/素材；不要因测试失败自动重试真实请求。
- 完成桌面代码改动后，按 `sparkai_workspace/AGENTS.md` 生成本地 Windows EXE，报告实际路径、大小、SHA-256；使用现有品牌安装器原位安装并核对退出码、注册版本、安装 EXE/ASAR 身份和配置保留。文档-only 不需要 EXE，但本次若改产品代码就必须执行。
- 同步 GOAL.md、PROGRESS.md、相关 CONTEXT_MAP/README；分开写清已验证、未验证、真实服务 deferred、包/安装/Git 状态。按现有持续授权正常 commit 和 push，不上传 EXE、不创建正式 Release，除非我另行授权。

遇到失败时保留最小复现和脱敏报告，先修 owner 数据流，不用 CSS 或自然语言提示掩盖 contract 问题。最终回复必须给出改动文件、关键证据、制品身份、安装/Git 结果和剩余限制。
```

## 8. 交接完成条件

- [ ] 执行 Agent 先读取本文件和当前 Goal/Progress，未覆盖用户 dirty changes。
- [ ] 每个工作包都有代码 owner、脱敏 trace、最小 Mock 和对应 acceptance evidence。
- [ ] 真实 Base URL/API Key 仅在用户明确授权后询问和使用，且不进入任何持久化/报告。
- [ ] 产品代码完成后才进入 EXE、安装、Goal/Progress/context map、commit/push 收口；本文件本轮不宣称功能已完成。
