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

公开动作仍通过 [共享命令 schema](../integrations/naimage-control/references/commands.schema.json)、[命令参考](../integrations/naimage-control/references/commands.md) 和 [Skill](../integrations/naimage-control/SKILL.md) 调用既有 owner。`agent.chat`、`agent.goal`、`agent.steer` 与 GUI 共享 TaskScope 规则；调用方不能传入任意 TaskScope、凭据或图片路径。内容识别/命名通过 `agent.chat` 请求，手动图片组改名使用 `canvas.rename-image-collections`。`visualName` 只属于内部主 Agent 工具合同。

相关最小验证：

- `test:task-scope`：配置克隆、双侧哈希、Main pending JSON 往返、设置漂移、16 种 steer 组合、Goal 保留与模型池/能力一致性。
- `test:goal-task-scope`：确认前的配置冻结、配置变化导致旧确认失效、一次性授权与素材边界。
- `test:image-content-title`：内容名称/手动标题保护以及 Main 保存恢复后的命名元数据。
- `test:agent-workflow`：本地 Mock 的结构化询问、同轮像素续跑、实际上传字节清单、质量适配和观察后命名。
- `test:agent-workflow-main`：真实Electron Renderer/preload/Main/图片服务到loopback HTTP、PNG与session落盘；首轮暂停后保存另一套live配置，验证模型上下文与实际请求仍沿用冻结配置。支持`--exe=绝对路径`核对安装包内owner并验证已安装程序。
- `aidebug:ask-user` 与 `test:agent-workflow-ui`：真实 Electron 的可见交互、重载及截图；具体覆盖以报告断言为准。
- `test:automation-service`、`test:mcp-wrapper`：共享公开 schema、CLI/MCP 转发及命令参考一致性。

以上本地验证不产生真实模型请求，不证明某个上游渠道当前可用，也不替代最终源码的 Windows EXE、安装或正式发布验证。
