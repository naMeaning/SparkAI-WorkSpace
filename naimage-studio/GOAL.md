# SparkAI WorkSpace 目标

版本：3.0
规格来源：`docs/sparkaiworkspace.txt`

当前里程碑：阶段 1–13 的既有产品实现保留。当前 Goal 的项目根、旧数据迁移、导出完善、成果图片生成参数展示、顶部对话框生图规格绑定、Cloudflare 图片长请求任务化 MVP，以及 Agent 文本原生复制、图片内容摘要标题、production 迁移确认兼容均已完成实现：新建项目必须由用户选择目录，无项目时不写全局 Session；Session、受管资产、项目级 Agent 状态与导出均受当前项目根目录约束。旧数据迁移工具显式扫描 AppData 中的旧项目/全局 Session，复制到用户选择的项目目录，并在目标空间预检、完整哈希校验、原子发布、索引切换后才允许单独确认清理源数据；preload 只对 production 压缩产生的数字 `1` 做有界布尔恢复，Main 仍严格要求显式确认。Agent 普通消息允许原生选中和 `Ctrl+C`，不增加逐消息按钮。生成成果由本地纯函数从 Prompt 提炼内容摘要，统一节点、图片组、资产和槽位标题，不修改原始 Prompt、不增加模型调用。应用级设置、加密密钥、账号/模型缓存、项目索引和迁移回执继续留在系统应用数据目录，不进入项目或安装目录。每张生成图独立保留白名单请求/响应/耗时元数据，编辑成果按请求、响应、成图实测和本次运行分源展示；缺失响应字段不推测，本地导入不继承虚假请求。顶部 Agent 对话框选择的比例和清晰度会冻结为本次任务的权威生图规格，模型提交的冲突参数不得覆盖；请求同时携带结构化画幅参数，并在上游 Prompt 中明确画幅、清晰度和最终像素。纯文生图默认向独立 SparkAI Extension 创建任务并轮询短 GET，扩展进程再通过私网同步调用用户现有的原生 New API；不再要求维护 New API fork。编辑/参考图及第三方同步接口保持兼容。全程未调用真实模型。

并行治理轨道：已完成工作区 Agent Harness。它把历史对话中的稳定用户意图、任务路由、授权边界、验证分级与完成审计固化为根目录 `AGENTS.md`、`HARNESS.md`、`harness/` 及结构校验器；该轨道不覆盖阶段 10 的产品目标，也不扩大其测试范围。

## 结果

以 **SparkAI WorkSpace** 作为唯一用户可见产品名称：用户可在同一个项目、同一张无限画布中自由切换通用创作、电商创作、社媒创作和科研绘图四个工作台。

## 不变约束

- 四种工作台共用 Electron、Renderer、画布、Agent Runtime、项目 Session、资产、TaskScope、Requirement、provenance、插件和 CLI/MCP 注册表；不得复制平行实现。
- 切换模式不重挂画布、不丢失选择/任务/关系、不自动调用模型或产生费用。
- 右侧 Agent 始终是唯一控制中心；只复用现有生产动作与受管资产链路。
- 旧项目默认 `general` 并可正常打开、保存、继续编辑；不得泄露凭据或绝对受限路径。
- 日常仅运行改动直接相关的专项测试；真实图片/视频模型调用必须获得用户明确授权。
- 保留统一透明玻璃视觉：工作台、图片容器、成果/Requirement/Panel 节点和新功能表面使用同一 Glass token、圆角、描边与层次；实际图片/视频内容保持不透明、清晰且无滤镜，文字和菜单必须可读，不能以高成本特效牺牲响应速度。
- 内置 Glass 主题保持轻量共享实现：新装默认“蜜橘融光” (`dark-ember`)，并提供与安装程序观感一致的“雾银玻璃” (`light-silver`)；新装默认对话模型为真实可用的 `gpt-5.6-terra`，默认生图模型为 `gpt-image-2`。
- 新手教学复用真实 Commerce、Agent、Requirement 与受管资产动作；导入和定位可零费用演练，教学不能自动触发付费生成。用户主动点击生成即视为执行授权，不再追加费用确认弹窗。
- Goal/套图执行前只要求可执行来源、计划矩阵与并发保护所需的最小 TaskScope；不得因缺少试用额度、单价、预计费用或完整冻结费用字段拒绝运行。New API 若在生成完成后返回实际用量或费用，可作为可选结果记录，缺失时不影响成果交付。
- 上游返回的 1–3 张 partial image 只在目标画布容器的同一请求槽位实时替换；最终图、失败或停止后立即清理，不写入项目、会话、图片库或 Agent 消息。
- 图片查看器只读取已受管落地的最终资产，采用“上方单张大图 + 下方单行横向滚动缩略图”的稳定结构；生成中的 partial 不得进入查看器或缩略图列表，最终图到达后临时预览必须立即消失。
- 普通图片成果与图片容器在画布中拖动时使用合成层位移预览，松手后再单次提交真实坐标并清理临时 transform；拖动期间不得以逐帧 `left/top` 布局写入造成明显卡顿，关系线仍需同步跟随。松手后必须能够立即再次按住并连续拖动；移动节点时新暴露的可拖图片块不得用原生 HTML drag 接管指针或触发 `pointercancel`。
- 当前多选集合全部为图片容器或图片组时，从任一已选容器的可拖区域开始鼠标拖动，全部成员必须保持相对位置并使用同一 transform 位移预览，关系线按整组新坐标同步更新，松手后一次性提交全部坐标且保留多选；`pointercancel` 必须恢复全部坐标、关系线和临时样式。混合选择、未选中容器、单节点、图片瓦片归组和图层组不得被扩张为该批量语义。
- 画布滚轮缩放必须按动画帧合并瞬时 transform，不能让每个 wheel 事件都触发 DOM 写入或 React commit；密集图片画布在缩放/平移期间可暂时隐藏高成本媒体、关系线和阴影，并在手势结束后恢复完整内容。低缩放远景允许使用保留位置、尺寸、选择和拖动能力的轻量节点投影。
- 整体关键界面字号在现有紧凑 IDE 密度上提高一个可读层级，优先覆盖全局 UI token、Agent 正文/状态/输入与搜索结果；搜索下拉框使用更实的菜单底色和更清晰的文字，不得因 Glass 透底影响阅读。
- 普通并行生图在用户并发上限内同批启动，每张完成后立即增量写入同一图片组，最终资产按实际完成顺序展示；Goal 按每个母图归为一个图片组，同时保留每张结果的槽位、语言、SKU 与幂等 provenance。
- 设置中的工具复选框只控制底部工具栏和领域工具菜单是否显示；隐藏不得卸载或停用插件，也不得阻止快捷键、Agent 或 CLI 调用。只有插件本身停用或卸载才禁用能力。
- 窗口、启动/登录界面、帮助与政策、安装/卸载界面和 Windows 产品元数据统一显示 `SparkAI WorkSpace`；`naimage.exe`、App ID、协议、CLI、项目元数据和数据目录继续作为兼容标识，不做破坏性迁移。
- 同一代码库通过构建期接入开关产出两个 Windows 发行版：无限制版保留 SparkAPI 账号与自定义 Base URL/API Key，SparkAPI 专用版只允许官方账号登录；公开制品分别使用 `SparkAI-WorkSpace-Unrestricted-*` 与 `SparkAI-WorkSpace-SparkAPI-*`，`naimage` 只保留为主程序、App ID、数据目录与更新协议兼容标识；限制必须同时落在 Renderer 与 Electron Main，不能只隐藏按钮。
- 测试开发阶段以代码轻量、真实交互性能和功能可用为优先，Bundle 只记录趋势、不阻断开发 EXE；正式发布时再恢复完整 Bundle 与发布门禁。
- AIDebug 的画布修改控制面只能在 Main 已确认临时 `user-data` 与临时 config 同时隔离后暴露；仅启动 Vite、仅设置编译期开关或遗漏 `NAIMAGE_CONFIG_DIR` 都不得读取、修改或自动保存真实项目。
- 同一生成任务的同一受管落盘文件必须以 `runId + normalized managed locator` 保持幂等；不同保存窗口或归一化轮次产生的新 occurrence 不得增加资产、`outputs`、图片组槽位或容器绑定。普通导入继续以 occurrence 表达用户可见的重复选择，旧 Session 加载时只收敛可证明为同一生成文件的重复项，并保留失败/停止槽位。
- 图片组名称是持久化的项目数据：单组和多组选中的重命名必须经过 NFKC、Windows 非法字符/保留名、长度和稳定去重处理，并同步画布标题、导出目录和 Agent 查询。
- 图片组替换只能引用当前项目已受管节点与资产索引；原槽位、requestIndex、prompt、title、taskProvenance 和原图必须保留，替换关系进入独立 `collectionRole:"defects"` 节点，整批校验失败或重复执行不得产生部分写入/重复副本。
- 普通图片组批量导出必须由 Electron Main 在当前项目内完成，使用 staging 与原子发布、稳定槽位文件名和 `image-group.json` manifest；Renderer、Agent、CLI、MCP 均不得提交任意绝对目标路径或非本项目资产。
- 普通 PNG/JPEG/WebP/AVIF/TIFF 另存、单图 PSD、分层 PSD 使用互不隐式调用的 IPC/UI 链路；普通导出不能改变 PSD 状态，PSD 不能改写普通导出配置或目标。
- 图片查看器保留双缓冲并以 identity/token、source/identity/target 校验和 decode 完成作为换帧条件；过期 preload/decode/DOM load 不得覆盖最新选择，真实 `data-final-asset`、`data-target-asset`、`data-displayed-asset`、`data-buffering` 状态必须可验证。
- 2026-08-11 性能审计确认：冷缩略图请求由 Main 侧最多 2 个 Sharp 子进程排队处理，而且每个 cache miss 都会重新 `fork()` 一个只处理单次请求的进程；10 张 4K fixture 共请求 11 个 256/512 变体，首次生成约 4.57 秒而 Renderer Long Task 为 0，同一批缓存命中约 83 毫秒。默认缓存仅保留 96 个变体，单张生成成果又可能在画布直接解码原图，因此图片规模上升时还会叠加缓存淘汰/重复生成与 Chromium 解码/GPU 压力。后续优化应优先考虑持久 worker/预生成、合并缩略图变体和扩大/改进缓存策略；查看器主图继续保留原图以维持清晰度，不能用缩略图替代最终查看。
- 每个对话模型可独立覆盖 Base URL/API Key 或绑定账户 Token，留空继承全局对话连接；Chat Completions 与 Responses 对话按实际请求模型路由，Responses 生图继续使用图片连接。账号模式仍保留逐模型自定义 API Key，优先于模型绑定账户 Token 和全局账户 Token；逐模型自定义 Base URL 只在 `custom` 模式生效。逐模型 Key 只保存在 Windows `safeStorage` sidecar，Renderer 和普通 JSON 仅见占位符；模型缓存用单向指纹区分 URL/Key/Token 变化。SparkAPI 专用版继续强制账号地址，但不得移除账号登录后的逐模型自定义 Key。
- 软件通行条件是“成功登录中转站账号”或“设备持有有效 Pro License 且配置自定义 Base URL”。账号登录本身授权使用且不请求 License；自定义模式只接受服务端 `pro` 兑换码，默认最多 3 台设备，沿用永久/限时、禁用撤销、24 小时在线校验和 72 小时离线宽限。License 请求不得携带用户 Base URL、API Key 或账号 Cookie。
- 每张最终生成图片必须独立保存版本化请求快照、服务器实际返回参数和运行耗时；Images/Responses 的重复最终事件只补齐同一图片参数，不能串到其他输出。最终比例、像素尺寸和文件格式只取受管成图实测值；服务器未返回的清晰度、质量、格式等不得由请求值反推为响应。持久化严格使用白名单，不含 Key、Token、Cookie、Prompt、上游绝对 URL 或签名 URL；本地导入图不得继承节点默认生图参数。
- 顶部 Agent 对话框每次派发时必须把当前比例和清晰度冻结到该运行快照；冻结值同时约束公开工具 Schema、顶层与 `items[*]` 工具参数、普通/批量/Goal/分层/区域执行和最终交付尺寸。模型或旧参数提交冲突值时按钮值获胜；真实上游 Prompt 必须追加画面比例、清晰度和最终像素说明，成果节点、图片组及编辑器仍保留用户原始可编辑 Prompt。该运行锁不得写回项目设置或污染后续任务。
- 导出优化下一批优先范围：先统一“导出中心”入口、增加格式/透明度/命名冲突/文件数/预计体积预检，并提供命名模板和可保存预设；后台队列、增量导出、导出历史和跨领域统一 manifest 放到后续阶段。本轮仅完成审计和建议，不把这些建议写成已实现功能。
- 新安装不得创建 AppData 默认项目或全局画布 Session。创建项目与导入项目必须先取得用户选择的目标目录；取消选择不得创建目录、切换项目或写入索引。移除最后一个项目后进入内存空画布，自动保存、导入、生成和导出均不得伪造 `default` 项目。
- 旧 AppData 项目只做显式迁移，不在启动时自动移动或删除。迁移必须先预检源项目、目标冲突和空间，复制到目标 staging，校验受管文件数量、大小与 SHA-256，原子发布并更新项目索引；源数据清理必须在迁移成功后由用户单独确认。安装目录不作为项目数据目标，避免更新、卸载和权限导致数据丢失。
- 普通图片、单图 PSD、分层 PSD、图层文件夹与图片组导出均默认写入当前项目的 `exports/` 子目录，Main 在最终提交前复核目标仍在项目根内；普通图片需先明确格式，图片组需提供格式、图片数、槽位失败、预计体积和导出统计预检。
- 纯文生图默认使用 `POST /v1/image-tasks` 立即取得 `task_id`，再每 2.5 秒查询 `GET /v1/image-tasks/:id`；该端点由独立 SparkAI Extension 提供，不修改原生 New API。扩展服务使用自己的 SQLite 状态和进程内队列，把调用者 Bearer Key 仅保留在内存并通过私网调用原生 `/v1/images/generations`；不引入 Redis、独立 Worker、SSE 或 WebSocket。创建成功或结果不明后不得自动重建任务，短暂查询失败只重试 GET；进程崩溃留下的 queued/running 标记失败而不重放上游。编辑/参考图继续原路径，只有创建端点明确不支持才回退同步兼容链路。
- Agent 普通消息、Markdown、thinking 和工具说明必须允许浏览器原生文本选择及 `Ctrl+C`；普通消息不得增加逐条复制按钮，已有生图提示词专用复制动作保持不变。
- 生成图片节点、图片组、资产和槽位标题必须表达图片内容摘要，不再复用完整 Prompt 或泛化成果名；摘要只由本地纯函数生成，优先提取结构化主体/场景/用途，保留已有简短人工标题，不修改原始 Prompt、不调用额外模型，同 Prompt 多图使用稳定序号。
- 项目迁移与清理的 Main handler 继续只接受真正布尔 `true`。preload 只允许把字面 `true` 或 production 压缩后的数字 `1` 归一化为布尔 `true`；字符串 `"1"`、数字 `2`、其他 truthy 值及缺失确认不得提升，归一化也不得修改输入对象。

## 阶段与完成条件

| 阶段 | 目标 | 完成条件 |
| --- | --- | --- |
| 1. 四模式基础 | 统一领域注册表、顶部切换、新项目入口、Session 持久化、领域 Prompt 和基础自动化命令 | 四模式可切换，旧项目兼容，画布/任务不中断。 |
| 2. 电商投影 | 将现有 Commerce 插件、素材轨快捷区、工具、设置引导和 Agent 提示投影到电商模式 | 不重写现有 Commerce 业务，GUI/CLI 行为一致。 |
| 3. 社媒工作台 | `sparkai.social-content`、小红书图文、抖音短视频、首次引导、发布包和命令 | 复用 Requirement、图片/视频任务、模板、资产和 provenance。 |
| 4. 科研绘图 | 增强科研插件、图表计划、安全 Python/R Runner、Panel、导出和命令 | 不虚构研究结果，脚本/输出均受管并可恢复。 |
| 5. AI 示例教学 | 以跨境电商套图为首个陪练，逐步引导复制/导入母图、定位套图工具、使用 Agent、授权生成并庆祝完成 | 教学读取真实状态、允许跳过/恢复，不复制业务；产生费用前必须明确同意。 |
| 6. MCP 与调试 | MCP 同注册表包装、Agent Skill/命令文档、受控调试和脱敏状态 | GUI、CLI、MCP 复用同一生产动作，调试不暴露敏感信息。 |
| 7. 双发行接入 | 构建期策略、SparkAPI 专用门禁、双 EXE 构建入口和迁移兼容 | 专用版固定官方服务并拒绝自定义 IPC；无限制版保持双接入，两种安装包可从同一源码独立产出。 |
| 8. Agent 输入体验收尾（已完成） | 紧凑玻璃画幅选择、普通/Goal 单入口切换、减少输入区冗余控件与未保存关闭确认 | 比例/清晰度显示值而非重复标签、下拉保持玻璃质感；Goal 可从一个可发现的扇形入口切换；有未保存内容的可关闭表面提供保存、放弃或继续编辑选择。 |
| 9. 四工作台可发现性（已完成） | 让通用、电商、社媒、科研入口在最小窗口仍可识别，并让第一方工作台能力首装即用 | 入口始终显示当前工作台文字；电商、社媒、科研第一方组件首次迁移默认启用，用户后续停用或卸载仍被保留；真实 Electron 覆盖四种切换和工具可见性。 |
| 10. 套图执行可靠性与画布引导（已完成） | 取消执行前费用元数据硬依赖，修复一键套图；优化连接点、原图聚焦、教学高亮、素材组预览、电商工具入口、画布流式中间图、最终图查看、拖动性能、关键字号、搜索层与工具栏显隐 | 套图可进入受控小批量执行且不因费用字段缺失失败；普通并发同批启动并逐张归入同一图片组，Goal 每个母图只创建一个结果组；中间图同槽替换且不持久化；查看器仅显示最终图并保持单行缩略图；普通图片/容器拖动走合成层预览；关键文字和搜索层可读；其余预览、聚焦和工具显隐行为闭环。 |
| 11. 密集画布缩放性能（已完成） | 合并高频 wheel 输入，降低图片密集画布缩放/平移期间的绘制成本，并在远景使用轻量节点投影 | 80 次 wheel burst 的 stage 写入不超过 20 次且交互状态正确恢复；production-like 三轮性能门禁通过；两个指定名称的 1.0.9 x64 测试安装包已重新生成并核验。 |
| 12. 测试项目隔离（已完成） | 修复 AIDebug/GUI/性能测试的数据根解析与 Renderer 调试控制面门禁，防止 fixture、节点和自动保存进入真实用户画布 | 显式临时 `--user-data-dir` 即使未设置 `NAIMAGE_CONFIG_DIR` 也只写 `<user-data>/data`；危险配置目录 fail closed；Renderer 只在 Main 确认隔离后暴露 AIDebug；隔离专项、build、真实 GUI 冒烟和两个测试 EXE 重建通过。 |
| 13. 图片组生命周期与查看器稳定性（已完成） | 图片组单/多选重命名、受管槽位替换与独立瑕疵组、Main-only 批量导出/目录入口、普通导出与 PSD IPC 解耦，以及快速 A→B→C 查看器 identity/token 防护 | 名称、替换关系和 provenance 持久化一致；全批 mutation 可回滚且幂等；导出只落在当前项目并生成 manifest；普通/PSD 路径互不绑定；decode 后换帧和真实 DOM 状态通过专项/AIDebug，最终 build 与双 Windows x64 测试包已完成核验。 |
| 当前 Goal：对话模型独立连接与导出审计（已完成） | 每个对话模型独立配置自定义 Base URL/API Key 或账户 Token，留空继承全局连接；请求、安全存储、缓存和 Runtime 同步；审计导出能力并给出下一批建议 | 逐模型设置在 Renderer 只见占位符、实际密钥由 Main/safeStorage 解析；Chat Completions/Responses 按请求模型路由；专项、隔离 GUI 和最终 production build 完成，导出建议不冒充已实现功能。 |
| 当前追加：多选图片容器整体拖动（已完成） | 修复多选图片容器后鼠标只移动一个容器；整组使用合成层预览、关系线同步、单次坐标提交与取消回滚 | 仅全图片容器/图片组选择进入批量路径；成功拖动和 `pointercancel` 的隔离 Electron 指针场景通过，选择、相对位置、关系和邻接单节点/归组语义保持。 |
| 当前追加：重复生成资产防护（已完成） | 修复同一落盘生成文件在 Session 合并、重载或移动后因新 occurrence 被反复追加 | 新写入按生成 run/受管 locator 幂等；旧 Session 同步收敛资产、`outputs`、collection 和 binding；合法重复导入及成功/失败混合槽位保持；AIDebug 隔离继续 fail closed。 |
| 当前追加：项目根与旧数据迁移（已完成） | 停止 AppData 默认项目/全局 Session 写入，所有项目数据受项目根约束；提供旧 AppData 项目与全局 Session 的显式事务式迁移 | 空项目不落盘；新建/打开/移除最后项目闭环；空间预检、staging、哈希校验、原子发布、索引更新及显式源清理通过专项与隔离 UI。 |
| 当前追加：导出完善（已完成） | 普通图片、PSD、图层目录和图片组导出收口到项目 `exports/`，补格式与预检/确认/统计 | Main 目标边界不可绕过；格式与扩展名一致；图片组预检和事务发布真实通过；GUI/Automation/IPC 契约与文档同步。 |
| 当前追加：成果图片生成参数展示（已完成） | 参考 GPT Image Playground，把每张图的请求配置、服务器实际返回参数、成图实测规格与本次运行信息保存并显示在成果编辑器 | 每图 response metadata 独立；响应缺失不推测；最终比例/像素/文件格式来自真实受管文件；本地导入不显示伪请求；白名单持久化不含凭据/URL；宽/窄编辑器无重叠或溢出；编辑器支持最大化/还原，参数文字保持可读字号。 |
| 当前追加：顶部对话框生图规格绑定（已完成） | 顶部 Agent 对话框的比例与清晰度成为本次生成任务的权威配置，并与实际上游请求、Prompt 和最终交付尺寸一致 | 派发时冻结按钮值；Schema 与 runtime 覆盖模型冲突值；普通、批量、Goal、分层与区域操作复用同一合同；上游 Prompt 明确画幅、清晰度和最终像素；成果仍保存原始 Prompt；最终 build 与双 Windows x64 测试包完成核验。 |
| 当前追加：Cloudflare 图片长请求任务化（已完成） | New API 图片任务创建立即返回，后台调用原同步上游；Desktop/Web 轮询直到最终结果 | `queued/running/succeeded/failed`、用户隔离、Task CAS、SystemTask 租约、失败与崩溃不重放、旧同步接口兼容；本地 mock/fixture 专项、最终 build 与双 Windows x64 测试包均已核验，不调用真实模型。 |
| 当前追加：Agent 原生复制、内容摘要标题与迁移确认修复（已完成） | 恢复普通消息文本选择复制；让生成成果标题表达图片内容；修复 production 安装包迁移确认被压缩为数字导致的拒绝 | 普通消息无新增按钮且真实 Selection/`Ctrl+C` 通过；标题纯函数与无网络 Electron action 通过；真实 preload VM 只提升 `true`/`1`，Main 保持严格布尔校验；专项、production build、最终 ASAR 与双 Windows x64 测试包均已核验。 |
| 当前追加：账号登录与 Pro 自定义接入授权（已完成） | 账号登录直接进入工作区；自定义 Base URL 先激活 Pro；账号模式完整保留逐模型自定义 API Key | 后端计划/设备/撤销合同、桌面登录门禁、官方 License 域名、凭据隔离和逐模型 Key 优先级已实现；双仓专项、隔离登录 GUI、typecheck 和最终 production build 均通过。 |
| 当前追加：原生 New API 外置扩展（进行中） | 保持用户已部署 New API 原生可升级；`ai-native` 只运行 License 与 image-task 扩展 | 根入口、SQLite/HMAC License、管理员 CLI、内存凭据图片队列、Docker/Caddy 同域路由和双仓文档已迁移；旧 fork 待扩展部署验证后另行删除。 |

## 登录与 Pro 自定义接入授权核验（2026-08-15）

- New API `go test ./model ./controller ./router -count=1` 退出 0，覆盖账号 Managed Relay 不再依赖 License、设备端点只接受 `pro`、默认 3 台、永久授权、设备上限、非 Pro 不消费激活数和禁用后撤销。
- Desktop `test:license`（9 cases）、`test:access-variant`、`test:custom-api-transport`（31 cases）、`test:agent-model-binding`（4 cases）、`test:settings-secret-store`、`test:settings-persistence`（124 cases）、`test:model-catalog`、`test:settings-lazy-load`（67 cases）、`test:ipc-registration`（141/138/3）、相关 CJS 语法检查和 `typecheck` 均退出 0。
- 隔离 `aidebug:auth-gate` 报告 [report.json](/E:/019创业项目/nimage/naimage-studio/.diagnostics/electron/aidebug-2026-08-15T05-23-48-437Z/report.json) 为 9 scenes、0 failures；账号退出、错误态、注册切换、重新登录和 `884×720` 窄窗口均无状态、裁切或横向溢出问题，使用 mock 账号且未访问真实 License/模型服务。
- 最终 `corepack pnpm run build` 退出 0，Vite 转换 1667 modules、8.42 s，仅有既有大 chunk advisory。本轮未调用真实兑换码、模型或生产服务，未打包 EXE、未提交或推送代码。

## Agent 复制、内容摘要标题与迁移确认核验（2026-08-15）

- Agent 普通正文、Markdown、thinking、工具说明和完成文本显式使用 `user-select:text`。隔离 `test:agent-panel-ui` 通过 52 cases：普通消息内按钮数为 0，computed `user-select`/`-webkit-user-select` 均为 `text`，真实 Selection 得到完整正文，CDP 发送 `Ctrl+C` 后 copy event 得到同一文本；已有生图提示词专用按钮未移除。
- `src/image-content-title.ts` 新增 `imageContentSummaryTitle()` 与 `normalizeGeneratedImageContentPresentation()`，结构化 Prompt 优先提取主体、场景和用途，泛化标题/完整 Prompt 被替换，已有简短人工标题保持，同 Prompt 多图追加稳定序号；节点、图片组、资产和槽位同步且输入对象/原始 Prompt 不变。`test:image-content-title` 7 cases 和 Agent Panel 无网络 runtime action 通过，示例节点标题为“Grok · xAI AI 助手 · 宽幅 AI 产品宣传海报”。
- C 盘迁移失败根因是 production Terser 把 Renderer `confirmed:true` 与 `confirmedCleanup:true` 压成数字 `1`，而 Main 正确地只接受布尔 `true`。`preload.cjs` 现仅把字面 `true`/数字 `1` 复制归一化为布尔 `true`；`"1"`、`2`、`false` 和缺失值均不提升，原对象不修改。`test:ipc-registration` 通过真实 preload VM 验证该边界，仍登记 141/138/3；`test:project-data-migration` 41 cases 继续通过。
- `test:image-container`（12）、`test:image-layout`（14）、`test:image-collection-mutation`（4）、`test:image-stream-preview`（30）、`test:workspace-glass-ui`（155）、`test:project-io`、`test:image-export`、`test:psd-export`、`test:image-collection-export`、`test:automation-service`、`typecheck` 与 `git diff --check` 均退出 0。普通图片导出仅有既有 libvips `tiffSubifd` warning，断言成功。
- 文档后的最终 `corepack pnpm run build` 退出 0，Vite 转换 1667 modules、9.00 s，仅有既有大 chunk advisory。`corepack pnpm run package:win:variants` 退出 0，包含接入策略专项、两次 1667-module production build（8.87 s、9.35 s）与双 Electron/NSIS/品牌封装，`bundleEnforced:false`。
- 最终 SparkAPI `app.asar` 只读核验同时发现 Renderer `confirmed:1`/`confirmedCleanup:1` 与 preload `normalizeExplicitConfirmation` 的 `value !== true && value !== 1` 边界，证明安装包覆盖真实压缩形态。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)：175,967,232 bytes，2026-08-15 12:34:31 +08:00，SHA-256 `928A6F73C1F30EA2DCDAFB94EE03B430DEFDCEDF9F9C0001799F1678DD299DD4`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe)：175,967,232 bytes，2026-08-15 12:35:53 +08:00，SHA-256 `380E22389355812DED477013A94B051E238D77B44A8A82C73D44098B446FCF5A`。
- 未调用真实图片/视频模型，未直接迁移或删除用户真实 AppData 数据；未执行正式 Bundle/发布验收、Windows 数字签名验证或真实安装/卸载 smoke，代码未提交或推送。

## SparkAI Extension 外置服务核验（2026-08-15）

- `ai-native` 的活跃根入口已改为独立 Node 24 SparkAI Extension，仅提供 `/api/naimage/license*` 与 `/v1/image-tasks*`；账号、Token、渠道、quota、计费和管理后台继续完全属于用户现有的原生 New API。旧 `ai-gateway`、CRM 与 production 部署树已退出根构建/运行入口，只作为部署验证后的待清理输入保留。
- Extension 使用自己的 SQLite/HMAC 保存兑换码、设备授权、任务 owner 与状态；调用者 Bearer Key 只在进程内存中存在，并通过 `SPARKAI_NEW_API_UPSTREAM` 私网调用原生 `/v1/images/generations`。创建立即返回 `task_id`，进程重启将未完成任务置为 failed 且不重放，结果按保留期启动时及每 15 分钟清理。
- 本地管理员 CLI 已真实完成“创建 2 枚测试码 → 列表查询 → 禁用 1 枚”闭环，测试码只写入隔离 `.diagnostics` 数据库且临时服务已停止。Extension `build` 与 5 项 loopback 测试（含限时授权/兑换截止）、Compose 静态配置、桌面 `test:license`（9 cases）、`test:custom-api-transport`（31 cases）、`typecheck` 和 production `build`（1667 modules）均退出 0。
- 本轮没有部署生产、访问真实 License/New API、调用真实图片模型或删除旧 fork。独立浏览器开发回退 `src/server.ts` 仍是历史 session-relay 适配，不作为当前 Electron + Extension 合同的验证证据；若以后发布独立 Web 版，需要另行定义不暴露账户 Key 的服务端凭据桥。

## Cloudflare 图片长请求任务化核验（历史实现，已由外置扩展替代）

- v42 曾把 `POST /v1/image-tasks` 与 `GET /v1/image-tasks/:id` 直接加入 New API，并复用其 `Task`、`SystemTask`、`ExecuteRelay -> ImageHelper`。该实现在当时通过验证，但会形成用户不接受的 New API 二开维护负担，已由上面的独立 SparkAI Extension 架构取代，不再是活跃构建或部署入口。
- 当时 Desktop 与浏览器使用同一 `task_id` 轮询并通过对应专项；这些历史证据只用于审计，不能证明当前原生 New API + Extension 部署已经在线联调。
- New API `go test ./controller ./router ./model ./service -count=1` 退出 0；Desktop `test:custom-api-transport` 29 cases、两个 CJS 语法检查、`typecheck`、OpenAPI JSON 解析和 `git diff --check` 均退出 0。独立 `corepack pnpm run build` 退出 0，Vite 转换 1666 modules、10.61 s，仅有既有大 chunk advisory。
- `corepack pnpm run package:win:variants` 退出 0，包含 `test:access-variant`、安装器资源、两次 production build、两个 Electron/NSIS 内核与品牌安装器封装，`bundleEnforced:false`。公开 `release/` 中不存在当前版本旧命名 `naimage-Setup/Core-1.0.9`。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)：175,965,696 bytes（167.81 MiB），2026-08-15 11:26:41 +08:00，SHA-256 `E9638C6DFC7AA519E132218299FC66ABC3099397ED24663A5FD277B7C0409F4C`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe)：175,965,184 bytes（167.81 MiB），2026-08-15 11:27:58 +08:00，SHA-256 `F60E19A1A39271FF52CC1ED2CCC144AE613D2DED9DFB52F2754A6D200680F718`。
- 未调用真实图片/视频模型或 Seedance，未在真实 Cloudflare 域名和线上 provider 验证 3-5 分钟生成；未执行正式 Bundle/发布验收、Windows 数字签名验证或真实安装/卸载 smoke，代码未提交或推送。

## 顶部对话框生图规格绑定核验（2026-08-14）

- `desktop/ipc/agent-ipc.cjs` 在 `agent:chat` 派发时把 Renderer 的 `imageDefaults` 冻结为仅属于本次运行的 `imageFrameLocked` 快照；`runtime/tool-schemas.cjs` 将公开比例/清晰度枚举缩为按钮值，`agent-runtime.cjs` 再覆盖顶层和 `items[*]` 冲突值，并在真实上游 Prompt 追加画幅、清晰度、最终像素与禁止拉伸说明。成果资产、图片组和编辑器继续保存追加前的原始 Prompt。AskUser 中途补充信息时，`PendingAgentExecution` 只保存同一任务的合法 `imageRatio/imageResolution`，恢复后重新生成运行锁，避免读取变化后的全局默认值。
- 本轮 `test:image-frame-contract`、`test:agent-run-control`、`test:goal-runtime`（43 cases）、`test:agent-text`、`test:custom-api-transport`（24）、`test:image-generation-metadata`（13）、`test:ipc-registration`（141/138/3）、`test:image-stream-preview`（30）、`test:project-io`、`test:workspace-glass-ui`（155）、`typecheck`、相关 CJS 语法检查、`git diff --check` 与 Harness 10 项结构检查均退出 0。规格合同实际覆盖 `3:4 + 2K → request 1024x1536 / delivery 1536x2048` 和 `16:9 + 4K → request 1536x1024 / delivery 3840x2160`，并验证模型冲突参数被覆盖、上游 Prompt 含交付规格、成果保留原始 Prompt；项目 IO 证明挂起任务的 `3:4 / 2K` 经保存和重启仍保持。
- 隔离 `aidebug:ask-user` 报告 [report.json](/E:/019创业项目/nimage/naimage-studio/.diagnostics/electron/aidebug-2026-08-14T08-59-46-927Z/report.json) 中全部 10 项功能 checks 为 true，新增 `frameContractSurvivesContinuation:true`；实际观察到 composer、pending 与 resumed frame 均为 `1:1 / 1K`，提示词中的 `3:4` 未覆盖按钮值。整套命令仍退出 1，未描述为整体通过：既有 `ask-user-structured-options` 概览把节点 B 缩到约 2 px 可见宽度，触发 `visual-area-too-small`，最终场景因此记录聚合 suite failure；其余目标场景状态、溢出和功能断言通过。
- 补丁后的最终 `pnpm.cmd build` 退出 0，Vite 转换 1666 modules、7.64 s，仅有既有大 chunk advisory。
- 获得授权后，固定命令 `pnpm.cmd package:win:variants` 退出 0，包含 `test:access-variant`、安装器资源生成、两次 production build（7.71 s、7.88 s）和双 Electron/NSIS/品牌安装器封装，`bundleEnforced:false`。公开 `release/` 中不存在当前版本旧命名 `naimage-Setup/Core-1.0.9`。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)：175,960,576 bytes（167.81 MiB），2026-08-14 17:08:56 +08:00，SHA-256 `FEAF4D033C6E2B0BDD57B2EB0A9FE65311D3E9C6FF642039B950662B3215FC2A`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe)：175,964,160 bytes（167.81 MiB），2026-08-14 17:10:06 +08:00，SHA-256 `17CE9B3AB71CE3E9C3A2ECF903B0D2C23FABDE7863D92C0C70B46408CA260130`。
- 未调用真实图片/视频模型或 Seedance，代码未提交或推送；未执行正式 Bundle/发布验收、Windows 数字签名验证或真实安装/卸载 smoke。

## 成果图片生成参数展示核验（2026-08-14）

- `runtime/image-generation-metadata.cjs` 与 `src/image-generation-metadata.ts` 分别持有 Main/Runtime 白名单元数据和 Renderer 展示逻辑；Images/Responses 每个最终图片保留独立 `actualParams`，Electron Main/Agent 落盘 `ImageAsset.generation v1`。最终宽高、比例和文件格式来自受管文件解码；旧生成图可使用节点请求快照，本地导入不继承默认生图参数。
- 本轮复跑 `test:image-generation-metadata`（13 cases）、`test:custom-api-transport`（24）、`test:workspace-glass-ui`（155）、`test:image-stream-preview`（30）、`test:ipc-registration`（141/138/3）与 `typecheck` 均退出 0。此前同一工作树的图片容器、布局、普通/PSD 导出、Automation 等 Goal 必需专项也均已通过；未调用真实模型。
- 参数面板的隔离 Electron 截图 [1280](/E:/019创业项目/nimage/naimage-studio/.diagnostics/electron/aidebug-2026-08-14T07-27-05-879Z/standard-node-editor-space-1280.png) 与 [884](/E:/019创业项目/nimage/naimage-studio/.diagnostics/electron/aidebug-2026-08-14T07-27-05-879Z/standard-node-editor-space-min-884.png) 人工复核无重叠、裁切或溢出，目标探针均为 `generationPanelOk:true`，同时观察到响应与成图来源。
- 完整 `aidebug:image-collection` 最新报告 [report.json](/E:/019创业项目/nimage/naimage-studio/.diagnostics/electron/aidebug-2026-08-14T07-37-55-904Z/report.json) 仍退出 1，未描述为整套通过：9 个可见场景均为 `stateIssues=0`、`overflow=0`、`captureIssues=0`，19 个图片组操作步骤通过；唯一产品场景失败是既有首图 A 在 3 秒探针窗口内 `visibility-timeout`，最终节点和截图实际可见，后续 B/C/D/F 顺序通过。该失败不属于参数面板，但仍作为未收口边界保留。
- 独立 `pnpm.cmd build` 退出 0，Vite 转换 1666 modules、8.77 s，仅有既有大 chunk advisory；沙箱内首次 `corepack pnpm run build` 因无权写 `node_modules/.vite-temp` 返回 EPERM，获批后在沙箱外同一生产构建成功。
- `pnpm.cmd package:win:variants` 退出 0，包含 `test:access-variant`、安装器资源、两次 production build（7.94 s、7.45 s）、两个 Electron/NSIS 内核与品牌安装器，`bundleEnforced:false`。公开 `release/` 中不存在当前版本旧命名 `naimage-Setup/Core-1.0.9`。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)：175,959,552 bytes（167.81 MiB），2026-08-14 16:00:26 +08:00，SHA-256 `528CF5EB71F625A069574EB2F903B45EE0A32C132A82F2732DBA620B844DB404`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe)：175,963,136 bytes（167.81 MiB），2026-08-14 16:01:29 +08:00，SHA-256 `67222A0BCFCF91FC52068C359CC27B15EA42B88C9D5AA7DB0E310CE21B9C414D`。
- 本轮未执行正式 Bundle/签名/真实安装卸载验收，未调用真实图片/视频模型或 Seedance，代码未提交或推送。

## 项目迁移与导出核验（2026-08-14）

- 项目根与迁移专项通过：`test:project-data-migration`（41 cases，包含空间预检、SHA-256、索引回滚、项目 Agent 状态迁移与二次确认清理）、`test:project-root-policy`（19）、`test:project-save-coordinator`（21）、`test:agent-run-control`、`test:goal-task-scope`、`test:aidebug-isolation` 和 `typecheck`。`test:aidebug-isolation` 首次因沙箱拒绝写 `.diagnostics` 失败，获得授权后按同一命令通过；这次失败不属于产品逻辑。
- 图片与导出专项通过：`test:image-container`（12）、`test:image-layout`（14）、`test:image-collection-mutation`（4）、`test:image-export`、`test:psd-export`、`test:image-collection-export`、`test:image-stream-preview`（30）、`test:workspace-glass-ui`（149）、`test:automation-service` 和 `test:ipc-registration`（141/138/3）。
- 对话模型独立密钥专项通过：`test:agent-model-binding`（4）、`test:settings-secret-store`、`test:settings-persistence`（124）、`test:settings-lazy-load`（67）、`test:model-catalog`、`test:custom-api-transport`（23）和 `test:agent-text`。
- 隔离 `aidebug:image-collection` 最终报告 [report.json](/E:/019创业项目/nimage/naimage-studio/.diagnostics/electron/aidebug-2026-08-14T03-54-29-294Z/report.json) 为 9 scenes、0 failures；其中首次 CDP 探针超时但产品仍响应，第二次发现并修复 884 px 项目操作区 4 px 横向溢出，最终复跑通过。
- 隔离 `aidebug:isolation` 报告 [report.json](/E:/019创业项目/nimage/naimage-studio/.diagnostics/electron/aidebug-isolation-gui-2026-08-14T03-59-42-933Z/report.json) 证明临时 Session 只写隔离项目、仓库配置不变。
- 最终 `typecheck` 退出 0；独立 production build 退出 0，Vite 转换 1665 modules、12.29 s 完成，仅有既有大 chunk advisory。首次沙箱内 build 因 Vite 无权写 `node_modules/.vite-temp` 返回 EPERM，获批后同一命令通过。
- `package:win:variants` 退出 0，内含 `test:access-variant`、安装器资源、两次 production build（8.65 s、8.27 s）、两个 Electron/NSIS 内核与品牌安装器，`bundleEnforced: false`。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)：175,955,456 bytes，2026-08-14 12:26:52 +08:00，SHA-256 `063039857E54C5ABFBEC677C25F74F9551A11906A860E20C4884C8E8BFCD8CE0`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe)：175,955,456 bytes，2026-08-14 12:28:01 +08:00，SHA-256 `C2AFEC28A55B9C9AE4763D5697E96F363700B1E03C2E77670FF860B766CBBEF0`。公开 `release/` 中不存在当前版本旧命名 `naimage-Setup/Core-1.0.9`。

## 当前 Goal 核验（2026-08-12）

- 本地 mock 专项通过：`test:agent-model-binding`（4 cases）、`test:settings-persistence`（124 cases）、`test:settings-secret-store`、`test:custom-api-transport`（23 cases）、`test:model-catalog`、`test:settings-lazy-load`（67 cases）、`test:access-variant`、`test:ipc-registration`（137/134/3）、`test:agent-text`、`typecheck` 和相关 Node 语法检查。
- 隔离 Glass GUI [report.json](/E:/019创业项目/nimage/naimage-studio/.diagnostics/electron/glass-workspace-2026-08-12T03-54-44-185Z/report.json) 为 `ok: true`、29 checks、35 screenshots、0 应用级 console error、0 生成网络请求，并完成真实 Electron 重启。
- Agent 文本 UI [report.json](/E:/019创业项目/nimage/naimage-studio/.diagnostics/electron/agent-text-ui-2026-08-12T04-03-40-595Z/report.json) 中，逐模型弹窗在 `884×720` 的容纳、焦点陷阱和 Arrow/Home/End roving Tab 均通过；整套命令仍退出 1，只剩两个与本 Goal 无关的既有动效断言。通用 `aidebug:gui` 也因已知 CDP `Promise was collected` / Renderer `Illegal invocation` 退出 1，失败记录保留在 `.diagnostics/electron/aidebug-2026-08-12T03-48-59-238Z`。
- 最终 `corepack pnpm run build` 退出 0：Vite 转换 1665 modules，7.89 s 完成，仅有既有大 chunk advisory。本轮未打包 EXE、未调用真实模型、未运行全量或正式发布验收，代码未提交。

## 多选图片容器拖动核验（2026-08-12）

- `test:selection`（16 cases）、`test:image-container`（12 cases）、`test:image-layout`（14 cases）和最终 `typecheck` 均退出 0。
- 隔离 Electron `aidebug:image-collection` 中新增的 `multi-selected-image-containers-move-together` 与 `multi-selected-image-containers-pointercancel-rolls-back` 连续三次均通过。最新 suite 记录两个容器提交位移均为 `(225, 140)`，拖动中 DOM 位移均约为 `(73.958, 46.018)`，React 坐标延迟提交、关系线同步、选择保持、临时 transform/`will-change` 清理及取消回滚均通过；证据位于 `.diagnostics/electron/aidebug-2026-08-12T04-48-20-926Z/canvas-image-collection-suite.json`。
- 完整 `aidebug:image-collection` 命令仍退出 1：最新运行中的新增两步和图片组拖出路径均通过，但既有 `standard-single-body-moves-node` 夹具将起点采到画布可视边界外，随后 `windows-drag-removed` 未渲染查看器；失败诊断又出现既有 CDP `Runtime.evaluate` 20 秒超时，分类为 `probe-command-stalled-product-responsive`。未把该命令描述为整体通过。
- 最终 `corepack pnpm run build` 退出 0：Vite 转换 1665 modules，8.88 s 完成，仅有既有大 chunk advisory。本轮未打包 EXE、未调用真实模型、未运行正式发布验收，代码未提交。

## 重复资产与最终制品核验（2026-08-12）

- 真实“项目 4”只读验证确认，节点 C 的 42 条重复资产/41 个 collection item 可收敛为 1/1；节点 D 的 26 条重复资产可收敛为 1 个成功资产，同时保留第 2 个真实失败槽位。连续两次归一化结果一致，源 `session.json` 的内容、大小和修改时间未变化。
- `test:project-session-merge`（87 cases）、`test:project-save-coordinator`（18）、`test:project-session-dual-renderer`（5 个双窗口场景）、`test:node-mutation-journal`（22）、`test:project-io`、`test:image-container`（12）、`test:image-layout`（14）、`test:image-collection-mutation`（4）、`test:aidebug-isolation` 与 `typecheck` 均退出 0；隔离报告为 `.diagnostics/electron/aidebug-isolation-2026-08-12T07-45-04-110Z/report.json`。
- 独立 `corepack pnpm run build` 退出 0，Vite 转换 1665 modules、7.08 s 完成；文档收口后的最终复跑同样退出 0，1665 modules、6.99 s。两次均仅有既有大 chunk advisory；`corepack pnpm run package:win:variants` 退出 0，内含两次 production build（7.92 s、15.02 s）及两个 Electron/NSIS 变体，`bundleEnforced: false`。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)：175,943,680 bytes，2026-08-12 16:09:44 +08:00，SHA-256 `7012D3F6A3D9C339824724DA25E7CE9065399711FE1BB9D76229CFB11906896E`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe)：175,943,680 bytes，2026-08-12 16:11:00 +08:00，SHA-256 `6B1926F1CE82CC8A50DEFCF3C55C1AF7DF13D9C17D9E146302616347907006C0`。
- 未直接清理真实项目，未调用真实图片/视频模型或 Seedance，未执行正式 Bundle/签名/真实安装卸载验收，代码未提交。

## 阶段 13 本轮核验（2026-08-11）

- 图片组 mutation/export、普通图片导出、PSD、流式查看器、automation、IPC、Glass UI、Agent 文本与类型检查均通过：`test:image-collection-mutation`（4 cases）、`test:image-collection-export`、`test:image-container`（12）、`test:image-layout`（14）、`test:image-export`（PNG/JPEG/WebP/AVIF/TIFF，普通/PSD 隔离为 true）、`test:psd-export`、`test:image-stream-preview`（30）、`test:automation-service`、`test:ipc-registration`（137/134/3）、`test:workspace-glass-ui`（142）、`test:agent-text`、`typecheck`。
- 真实隔离 AIDebug：`aidebug:image-collection` 报告 [summary.md](/E:/019创业项目/nimage/naimage-studio/.diagnostics/electron/aidebug-2026-08-11T06-06-17-278Z/summary.md) 为 `ok: true`、9 scenes、0 failures；`aidebug:glass-workspace` 报告 [report.json](/E:/019创业项目/nimage/naimage-studio/.diagnostics/electron/glass-workspace-2026-08-11T06-08-40-560Z/report.json) 为 `ok: true`、29 checks、35 screenshots、0 console errors，最小窗口 `884×640`，真实重启通过，未使用生图网络。
- 最终 `corepack pnpm run build` 及 `corepack pnpm run package:win:variants` 均退出 0；Vite 转换 1665 modules，构建仅有大 chunk advisory。打包脚本报告 `bundleEnforced: false`，公开目录中当前版本旧命名 `naimage-Setup-1.0.9*`/`naimage-Core-1.0.9*` 均不存在。
- 最终测试安装包（PowerShell 独立 `Get-FileHash` 核验）：
  - [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)：175,941,120 bytes，2026-08-11 18:04:34 +08:00，SHA-256 `753F135BE1EB8756CF3C584CAF6E0BE67016A9E140E9ACDB0A022B1EA41B1BB6`。
  - [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe)：175,942,144 bytes，2026-08-11 18:05:36 +08:00，SHA-256 `559A71F0E14AA53B6949D55AA98E78C08926608266B6D89B0C12F1BF4DB5A083`。
- 本轮未做正式 Bundle/发布验收、Windows 数字签名验证、真实安装/卸载 smoke；未调用真实图片/视频模型、Seedance 或付费生图。代码未提交。

## 完成标准

- 四模式在同一画布中稳定切换；电商复用已存在能力，社媒与科研工作流可真正执行。
- 旧项目兼容、资产与任务状态保持，收费/视频创建边界不被绕过。
- 文档、共享 command schema、CLI Skill、IPC/自动化契约与代码同步。
- 图片组命名、导出、替换/瑕疵关系、目录入口、查看器 identity/token 和普通/PSD 导出边界必须以当前代码、专项测试、真实隔离 AIDebug 与最终制品核验为证据；旧报告不能替代本轮结果。
- 最终发布前再执行完整验收；当前开发以每阶段的直接专项验证作为证据。
