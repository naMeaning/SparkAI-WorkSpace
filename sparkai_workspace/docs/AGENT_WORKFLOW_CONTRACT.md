# Agent 工作流与图片上下文合同

本文描述桌面 GUI、主 Agent Runtime 和本机 CLI/MCP 共用的边界。验证与制品状态以 [PROGRESS.md](../PROGRESS.md) 为准。

## 项目知识、成果检索与创作模板

项目长期知识由 Main `desktop/project-knowledge-service.cjs` 拥有，独立保存在项目 `.naimage/project-knowledge.json`。只有明确保存的 user 内容参与后续任务；Agent 推测先保存为 suggested，必须显式 promote 才能变为长期规则。临时反馈、FastMemory、旧会话摘要和搜索本身不自动升级为知识。保存、停用、删除与提升使用 store/entry revision CAS，历史版本不可变，删除保留 tombstone；写盘先 fsync 再原子替换，失败保留真实错误与原记录。

同一项目/会话内折叠、展开或分离Agent窗口不丢弃主窗尚未保存的知识草稿。另一窗口保存后，陈旧编辑器保留用户输入并显示版本冲突、禁止用旧revision提交，不能静默覆盖新记录或用轮询结果清空草稿。

知识作用于项目、商品、变体或 SKU。项目规则在项目内跨会话共享，对象规则只随精确的已选来源身份和 Catalog 归属生效，模糊或多归属不猜商品。商品事实和品牌规范仍以 commerce catalog 为唯一可编辑 owner，知识只生成带 catalog 修订引用的只读投影；不复制一份商品库。优先级为用户本次明确要求、项目长期偏好、当前会话经验；事实冲突需解释并结构化 ask_user，不把缺失参数补成事实。风格基准保存 asset/occurrence/contentHash，必须是实际采用且仍有效的受管成果，撤销采用、内容变化或删除使其不再进入新任务。

`runtime/project-knowledge-contract.mjs` 归一化有界完整快照及 refs/summary 回执。新任务 prepare 固定实际知识、对象与可用风格材料；TaskScope.projectKnowledge 保存完整内容，TaskScope.template 保存模板版本、展开指纹与有限变量值，两者都进入 Renderer/Runtime 的同一 scope hash。任务 ledger 只保存引用和摘要；项目 session 的 `projectTaskContexts` 保存每个 task 的完整不可变知识快照及模板引用，必须绑定 project/conversation/task、原回执 createdAt，按时间排序，陈旧窗口合并取不可变并集，不淘汰旧任务。

reserve/admit 比对冻结回执与完整 TaskScope；历史内容只有对应 durable task receipt 和仍在知识历史中的引用才能恢复。校验和只用于确定内容身份，不能授权自编快照。追问、重载、重启和文字 steer 复用原冻结知识及配置；编辑知识只影响新任务，同一 submission 携带不同有效知识或模板时拒绝，不另开请求。已用知识与当前知识分别显示，不能把今天的规则冒充昨天执行时采用的版本。

升级前没有知识快照的旧 waiting 任务，领取原问题回答后仍按原 TaskScope 续接，不向原任务补入升级后规则；新任务必须冻结当前知识，不能通过省略字段或借用其他已受理 task 绕过校验。

Main 保存 session 时按实际目标项目验证上下文身份，跨项目或损坏内容在合并/写盘前拒绝并保留原记录。项目便携包导出与导入均清空本机 pending 和 task contexts；导入拥有新项目身份，不继承旧本机任务的已用知识或续跑权限。

本地成果检索由 `desktop/project-result-index.cjs` 从原 session/受管文件、creation 验收及 catalog 采用状态派生。文件 hash 缓存可删除、损坏后重建，不拥有资产或验收事实，不调用 embedding、模型或远端搜索。结果区分已消费像素形成的 observed、生成 Prompt 的 intended 和用户标签，命中原因保留来源；Prompt 描述和名称不能冒充视觉观察。内容、要求、来源或采用变化使相应证据失效，实际 occurrence 不因同字节被合并。查询支持用途、对象、来源、采用状态、描述来源及确定性分页。

知识与检索读取由原 project-store 的 `projectSessionMetadataFromDisk` 选择权威 session 与旧 manifest/export 来源，和正常项目打开共享选择规则；它只读元数据，不 hydrate 所有图片、不迁移或回写项目。Main 随后按实际 project ID 清洗快照，索引将同一份快照传给 creation 的私有 `searchSnapshot`，避免重复打开项目。canonical session 或已选中的旧 manifest/export 无法解析、顶层或内嵌session类型错误时明确拒绝，不写回原文件、不新建canonical文件、不记录私有路径；普通项目打开保留原迁移行为。元数据中的文件引用不等于文件授权：每次检索刷新或明确使用仍重新验证实际路径、stat 和内容hash；同轮可共用物理文件检查和受管根解析，根解析闭包不跨查询复用，SOURCE/REFERENCE 的每个 occurrence 仍单独比对目标hash。

搜索和定位不改变 TaskScope，也不派发图片。用户明确沿用成果后，`project.results.use` 或主 Agent `project_context(operation="use_results")` 按稳定三元身份重新校验实际文件。Runtime 使用既有材料绑定器；Main 在首次图片派发前校验 task/run、保留原素材、要求、知识、模板和配置，通过 run-control 原子预检跨任务锁，再提交 ledger 和活动 scope。新 reference 也必须锁定实际节点；锁冲突或持久化失败不提交新范围。同一稳定身份的原 source/reference 用途不能原地改变，同用途重复绑定保持幂等。Goal 不能借检索扩展冻结材料，已开始图片派发的任务不能迟到绑定。

可复用方法继续保存在既有安装级 `requirement-library.json`，不新建模板库。v2 模板仅声明 text/enum/number/image 有限变量、场景、普通需求正文及验收要求；图片变量必须重新绑定当前项目稳定素材。保存方法剥离旧项目路径、资产/任务/要求实例、凭据、signed URL、已采用/已验收状态。应用只展开普通需求草稿并列出未绑定图片，零模型请求，不自动执行；明确执行仍经过原 requirement/TaskScope/agent.task/image_gen 链。模板更新不改写已冻结任务，导入不覆盖现有同 ID，导出只包含便携字段。

当前项目素材重绑复用原需求编辑器，按模板图片变量名称和SOURCE/REFERENCE用途选择当前画布图片，来源计数即时预览。缺少required图片可以保存草稿，不能执行。保存由原 `saveRequirementEditor` 同时更新普通inputBindings与templateDraft，只有用户没有改动原正文时才把系统的“待绑定图片”占位文字替换为“当前素材”；用户编辑过的正文保留，不重新套用新版模板或改写已冻结任务。

主 Agent 的 `apply_template` 携带有限变量和 `imageBindings` 进入 Main `applyTemplate`，校验公开 `requirement-library.use` 合同后定位当前会话 Renderer，再派发原需求模板命令；不经只接收图片的 workflow action 过滤器。原 Renderer 仍校验当前项目和素材节点、原 library 校验模板版本与变量。模板 IPC 的本地读写错误仅保留错误码和安全提示，只有显式 `RequirementLibraryError` 的业务提示及安全 details 可以公开。

公开业务入口为 `project.context.get`、`project.knowledge.list/save/status/promote/history`、`project.results.search/use` 及既有 `requirement-library.*` 扩展。GUI、独立 Agent 窗、CLI/MCP 与 `project_context` 复用相同 Main owner；公开返回值不包含私有文件路径、连接凭据或上游签名地址。专项、实际报告与剩余验证见 [第三期验证记录](AI_NATIVE_CONTEXT_VALIDATION_2026-10-20.md)，本地 Mock 不能证明真实识图、审美、风格遵从或计费行为。

## 版本化要求、验收与定向修改

完整创作合同位于 Main 项目 owner 的 `.naimage/creation.json`。合同含目标/用途、稳定槽位、保留/可变/可验收条件、文件约束和 user/assumption 来源；TaskScope.creation 仅引用要求版本及冻结修订计划，不另建素材或配置 authority。旧项目没有此字段时保持可读，不补造历史验收。新任务可直接以明确用户原文建立轻量要求，主 Agent 通过公开 `creation` 工具细化，tool_choice 保持 auto，不增加独立规划模型请求。

精确区域修改复用原涂抹编辑器及 `creation.revision.start`，一次绑定一个稳定成果身份。Main `desktop/creation-mask-service.cjs` 完整解码并保存同尺寸、有透明选区的 PNG，私有项目目录 `.naimage/creation-masks/` 及 manifest 记录其会话/目标/字节身份；保存失败不启动任务。修订计划只保存 `targets[].mask` 三元身份，TaskScope.maskAssets 是完整冻结蒙版材料的唯一执行来源；它不混入 source/reference，不生成画布节点。公开 CLI/MCP 不接受路径、URL、dataURL 或额外蒙版字段。首次受理前校验身份/目标绑定、项目路径及真实字节；Runtime 再校验源图与蒙版 hash、尺寸、解码和选区后，从验证过的相同 bytes 执行唯一 image_gen redraw。模型不得覆盖蒙版。已有 durable 回执重复查询不依赖蒙版当前存在，也不重新派发。

要求更新使用 expectedRevision CAS；定向提交使用调用方 submissionId，重复查询原计划，异内容冲突。任务 ledger 保存 initial/current 引用、摘要及必要关联，不保存完整合同、Prompt、路径或任意工具参数。主 Agent 在首个图片请求前细化本次要求时，由 Main 校验当前 run、旧引用及冻结素材/配置后关联新版本；Renderer 使用 effectiveTaskScope 保存追问和恢复。已生成成果的要求版本不被后续编辑改写，Goal 的素材、数量和授权不扩展。

验收分三类：A 是文件存在、实际完整解码、尺寸/格式/透明像素等本地检测；B 是主模型基于已消费像素提交的有限观察；C 是用户决定。完成或 saved 不自动取得 B/C。每条证据绑定项目、asset/occurrence、内容 hash、要求版本、检查项和时间。view_image 成功后，只有实际带对应像素的后续成功模型回合可以签发进程内 proof；record_review 必须通过 Runtime 验证，来源一致性还需来源图相同证明。公开 CLI 不接收 proof 或模型观察字段。内容、要求或依赖来源漂移使旧证据失效，移动和改名不使像素验收失效；历史记录保留。

图片工具返回已落盘成果后自动调用同一 Main 本地检查，初次生成、定向修改和蒙版修改均按冻结要求版本记录 A；每目标/ref 只检查一次。视觉保留和修改要求仍须由后续实际看图消费后提交 B，不能用尺寸或格式通过替代。文件规则失败显示本地未通过；验收记录写入失败单独显示，已保存图片及执行成功保留，不重调图片模型。用户可在原成果上重新执行无模型费用的本地检查。

验收持久化失败包括序列化、8MiB容量拒绝和文件系统写失败。显式检查失败与图片保存后自动检查未能记入的结果均进入Runtime本run的不可重生保护；后续主模型即使再次提出image_gen也在派发前拒绝，已成功的图片actions和回执保持。该内部保护不进入公开DTO或持久化参数，不以Prompt文字指引代替。

主窗与独立 Agent 窗使用相同的要求草稿转换；交付项改名、条件改写保留原 slotId/criterionId 与来源图绑定，未编辑的 Agent 假设仍为 assumption。成果选择使用 asset/occurrence/hash，不以当前列表顺序或名称代替身份。两个表面从同一 owner 的 invalidReasons 映射证据：要求版本或目标资产变化时，旧 A 显示“本地检查已过期”，不能继续显示当前通过/失败；仅 B 依赖的来源变化时，A 的独立文件检测可保留，B 显示过期。失效不改写历史 C，也不重新生成图片。

折叠汇总中的目标数量取当前要求 slots 数，已保存数量取 owner 的 saved，待检查数量取缺少或过期 A/B 的成果；有疑问数量只取有效 A 失败或当前 B 建议修改/无法确定，历史通过和历史失败均不能冒充当前结论。A 失败且 B 未检查的成果可同时计入有疑问与待检查；已采用仍展示 catalog 的实际用户决定。主窗和独立窗使用同一计算，不因展开或列表重排改变数量。

创作操作的失败与记录读取失败分别反馈。成功刷新 Main 记录不能清除保存冲突、修订拒绝或丢失回执的操作错误；该错误在主窗与独立窗保留到用户再次操作或切换项目/会话，读取故障恢复则只清除读取错误。过期窗口命令在 IPC 派发前拒绝并显示原因，不自动重发。

用户采用通过原 commerce catalog candidate/approved/rejected 状态及 A/B 原子终选，导出仍读取这个唯一 owner。AI观察不修改用户终选，硬文件检查失败不能被采用覆盖。保存/观察/验收写失败分别报告，已保存图片保留，不重调图片模型。

`creation.requirements.get/update`、`creation.acceptance.get/check/decide` 与 `creation.revision.start` 共用共享 schema、registry、preload/IPC、CLI/MCP 和 Skill。定向计划冻结 asset/occurrence/hash、要求版本和每目标 delta；模型只调用原 image_gen，Runtime 每目标执行一张，并保留原配置/来源/槽位与修改基准。改动产生新要求修订和关联原成果的新任务。保留主体属于生成/验收约束，不承诺区域像素绝对不变。创建不明、超时/5xx、停止、下载或保存失败均沿用原错误恢复合同，不能自动改 Prompt、模型或 submission 重发。

## 配置与素材的冻结

`runtime/image-config-snapshot.mjs` 是图片请求配置快照的共享 owner。它只保存已勾选模型池、默认模型、画幅、质量、数量、格式，以及对应模型的协议、网关、传输方式、轮询限制和能力白名单。已保存但未勾选的模型连接不能进入模型池。模型匹配和去重不区分大小写，与图片服务解析规则一致。

快照不包含 API Key、账户 Token、Cookie、Base URL 或连接地址。执行时通过 Main 当前的凭据解析链获取连接秘密；凭据不进入 TaskScope、其哈希或模型可见合同。能力来自同一设置源与 `runtime/image-generation/types.cjs`，配置能力不能描述成真实渠道已经验证的能力。

| 路径 | 素材范围 | 图片配置 |
| --- | --- | --- |
| 新任务 | 按提交时的选择与附件建立 TaskScope | 冻结当前配置 |
| Ask User 回复或重载恢复 | 复用原快照；明确添加附件才扩展范围并重算哈希 | 复用原配置 |
| 运行中 steer | 按 keep/replace/merge/clear 修改附件并重算哈希 | 保留初始配置 |
| Goal | 确认前冻结完整素材与执行矩阵；运行中只允许文字 steer | 确认前加入快照与授权指纹 |

`src/core.ts` 与 `agent-runtime.cjs` 的 TaskScope 哈希必须包含同一个归一化 `imageConfig`，并排除瞬时坐标、绝对项目位置与未知配置字段。`src/task-scope.ts` 深拷贝快照和嵌套能力数组。`desktop/project-session-normalizer.cjs` 与 Renderer 的 pending-execution 清洗保留冻结配置、画幅及统一 `materials` 的顺序和角色，才能在保存、重载后恢复同一个任务。

历史节点的 `imageParams` 只解释旧图。运行时的 Image Model Contract、Current Request Configuration、工具 schema 和实际请求使用本轮冻结配置；旧图的模型、质量和比例不能覆盖它。配置变更影响新任务。

Runtime到Main携带的内部`imageConfig`始终从已冻结settings构造；模型工具参数中的同名额外字段不能替换它。公开工具仍只允许schema内的用户请求字段。

## 观察、生成与命名

`view_image` 成功读取的像素作为图片内容返回当前主模型的同一次工具续跑。工具成功和请求体包含像素可由本地协议夹具验证；模型是否正确识别主体需要另行授权真实模型验证。

识图与生图素材有各自的核对边界。`runtime/image-input-manifest.cjs` 按实际上传顺序记录来源和参考图的身份、用途及内容哈希，图片服务在发送请求前核对字节。清单不匹配必须在模型请求前失败，不能通过再次生成来探测。

内容命名使用同一轮已观察的像素：主 Agent 调用 `workflow(operation="update_node", visualName={path,displayName,confidence})`；`path` 必须已在当前轮成功观察，且后续成功的模型回合实际消费了这些像素。`runtime/image-content-name.mjs` 清洗短名、维护自动命名元数据、区分相同内容的多个槽位。编辑器的`titleTouched`保留明确改名的意图；节点、独立成果与容器成员按实际目标写入`contentName.source="manual"`，GUI/CLI容器显式重命名也写入同一标记。保存重开、标题格式化、批次消歧及进度合并不得覆盖manual，数字后缀、通用名和改回原名同样受保护；只改提示词不锁名称。命名失败不阻止成果保存，也不额外发起图片生成。

Grok 的质量矩阵由实际连接配置的能力决定。没有显式非空质量列表时仍使用 Grok 默认能力，设置清洗生成的空列表也表示继承；切换兼容协议或网关不能将其变成 GPT Image 能力。未知模型别名继承所选协议默认，明确非空列表（包括仅auto）优先。发送前归一化请求质量并记录 requested/effective 决策，不通过失败重试猜测可用值。

生成成果的保存和进度重放共用`runtime/image-asset-identity.mjs::coalesceImageAssets`。同run的绝对/相对locator是同一成果的别名，后续补relativePath不能重复入画布；导入的不同occurrence继续保留，不能以相同像素全局合并。Main merge、旧session清洗与Renderer图片组同步使用该规则，旧重复收敛后容器槽位必须映射到同一实际资产，已有手动名称保留。

## CLI/MCP 与验证入口

### 稳定任务与共同续接

`agent.task.start/get/wait/answer` 由 Main 的 `desktop/agent-task-service.cjs` 提供，公开动作通过同一 schema、CLI、MCP 及 preload 转发。`start` 必须指定项目、会话和调用方 `submissionId`；目标必须在一个生产主窗口打开。来源只取明确的 `sourceNodeIds`（省略为空），不读取当前选择或附件。目标、忙闲、素材及保存校验完成后，Main 将冻结范围投影与 run 身份落盘，才返回 `accepted:true`；Renderer 随后进入原 requestAgent。已有任务返回忙碌，不隐式 steer；`agent.chat` 保留原兼容语义。

同一项目/会话/提交标识使用同一规范化 prompt、来源顺序、输出规格及标题时返回原任务；换内容返回 `TASK_SUBMISSION_CONFLICT`。规范化只统一换行、首尾空白、重复来源和空默认值，不把不同来源顺序混同。任务及幂等摘要位于 `<project>/.naimage/agent/tasks.json` 同一 fsync/原子替换 ledger；不保存完整 prompt、凭据、连接 URL 或素材路径。accepted 前写入失败零派发。每次 run 和每个回答必须先持久化一次性领取；回执传输丢失或重连不重发。准备中断或未受理的提交保留原记录，需要新用户意图和新提交标识才能另开任务。

回执版本包含执行阶段、问题、成果及保存投影变化。`wait(afterVersion, timeoutMs)` 最长30000ms，超时返回原 task/cursor 与 `timedOut:true`，只结束等待；旧游标立即获得最新快照，超前游标返回 `TASK_CURSOR_EXPIRED`，调用方重新 get。首期回执/幂等索引不自动淘汰，项目最多2000任务后 fail closed；关联图片journal同样保留，journal容量不足也拒绝派发。不得分别清理索引与任务记录，使旧提交静默变为新执行。

`answer` 携带项目、会话、任务、questionId 和 get/wait 的 expectedVersion。Main 原子领取选项或自定义回答，再由原 Renderer 的 `resumePendingAgentExecution` 续接原 pending execution；GUI 也通过同一领取入口，竞争者最多一个成功。旧问题/版本/任务、跨项目/会话和另一个窗口 owner 均不能消费。续接中的 resuming 状态不得提前清除 pending。文字回答包装为原任务续接，沿用原要求、TaskScope、图片配置；当前选择和设置只影响新任务。来源/参考图补充继续使用 GUI 原素材选择器。

session 持有完整 pending 和冻结素材；run control 继续拥有暂停/停止/窗口 owner；图片 journal 继续拥有原远端 taskId、缓存字节、落盘和恢复。Runtime 将父 Agent runId 通过内部参数传给图片服务，Main 将子图片操作关联稳定 taskId。回执从 journal、文件存在性及权威已保存session按原 asset/occurrence 身份确认成果，不增加 Runtime、自动 create 重试或独立规划调用。

GUI首消息先保存当前空白会话身份，再受理任务。受理准备失败应及时记录interrupted并保留旧提交，不悬留preparing；回答领取后若保存或续接准备失败，也结算interrupted而不悬留resuming。旧session中的pending快照不能复活已终结的稳定任务；未关联回执的legacy pending继续fail closed。Main journal已保存资产不由Runtime重新改画幅/字节；哈希及实际尺寸必须继续对应同一落盘文件，保证后续冻结素材可复用。旧direct fallback保留原画幅规则。历史节点/operation身份字段也经公开投影脱敏。

重启后保留可校验的等待问题；其他无法安全续接的活动执行变为 interrupted。accepted图片只经原恢复链轮询/下载/保存，uncertain创建不重发。执行完成只表示执行与保存状态，不表示视觉验收通过。主窗口和独立 Agent 窗口共享脱敏任务卡；内部身份只用于协议校验，不显示在普通任务卡。

公开动作仍通过 [共享命令 schema](../integrations/naimage-control/references/commands.schema.json)、[命令参考](../integrations/naimage-control/references/commands.md) 和 [Skill](../integrations/naimage-control/SKILL.md) 调用既有 owner。`agent.chat`、`agent.goal`、`agent.steer` 与 GUI 共享 TaskScope 规则；调用方不能传入任意 TaskScope、凭据或图片路径。内容识别/命名通过 `agent.chat` 请求，手动图片组改名使用 `canvas.rename-image-collections`。`visualName` 只属于内部主 Agent 工具合同。

相关最小验证：

- `test:task-scope`：配置克隆、双侧哈希、Main pending JSON 往返、设置漂移、16 种 steer 组合、Goal 保留与模型池/能力一致性。
- `test:goal-task-scope`：确认前的配置冻结、配置变化导致旧确认失效、一次性授权与素材边界。
- `test:image-content-title`：内容名称/手动标题保护以及 Main 保存恢复后的命名元数据。
- `test:agent-workflow`：本地 Mock 的结构化询问、同轮像素续跑、实际上传字节清单、质量适配和观察后命名。
- `test:agent-workflow-main`：真实Electron Renderer/preload/Main/图片服务到loopback HTTP、PNG与session落盘；首轮暂停后保存另一套live配置，验证模型上下文与实际请求仍沿用冻结配置。支持`--exe=绝对路径`核对安装包内owner并验证已安装程序。
- `aidebug:ask-user` 与 `test:agent-workflow-ui`：真实 Electron 的可见交互、重载及截图；具体覆盖以报告断言为准。
- `test:automation-service`、`test:mcp-wrapper`：共享公开 schema、CLI/MCP 转发及命令参考一致性。
- `test:agent-task`：持久化幂等、并发、游标、回答一次消费、隔离及重启状态；`test:agent-task-ui`：真实隔离Electron→正式bridge/PowerShell CLI→Main Runtime→loopback图片POST→权威session，双窗口卡、共同回答、冻结配置、重载/重启和脱敏（支持`--exe`）。

以上本地验证不产生真实模型请求，不证明某个上游渠道当前可用，也不替代最终源码的 Windows EXE、安装或正式发布验证。
