# Agent 工作流与图片上下文合同

本文描述桌面 GUI、主 Agent Runtime 和本机 CLI/MCP 共用的边界。验证与制品状态以 [PROGRESS.md](../PROGRESS.md) 为准。

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
