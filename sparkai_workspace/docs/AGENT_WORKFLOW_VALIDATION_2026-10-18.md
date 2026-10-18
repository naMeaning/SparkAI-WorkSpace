# Agent 工作流本地验证与交付（2026-10-18）

范围由[本轮交接](AGENT_WORKFLOW_UPDATE_HANDOFF_2026-10-17.md)与当前 Goal 确定；[合同](AGENT_WORKFLOW_CONTRACT.md)描述长期 owner。免费双接入保持原行为，未修改外部 New API/Extension。下表将本地协议、真实 Electron 交互及真实模型能力区分记录。

| 项目 | 实现与实际证据 | 限制 |
| --- | --- | --- |
| Ask User | 仅结构化工具产生 action；真实 Electron 14 项通过，含选项/自定义/取消、普通问句不弹窗、真实重载后冻结素材/模型配置/画幅续跑、Goal 确认与锁定 | 主模型用本地脚本应答，未测真实模型自主选择工具 |
| 识图/参考图 | view_image 像素进入同一 Responses continuation；Runtime→图片服务→multipart 实际字节哈希验证 B 为 SOURCE、A 为 style REFERENCE，顺序/用途一致；篡改清单零发送 | 纯色夹具，不能证明真实主体识别或模型遵从参考图 |
| 软件更新 | 配置地址匿名探针得到合法绝对 URL、HTTP404及 New API status200；本地HTTP/IPC22项、生产Renderer UI7项/11截图，含签名拒绝/续传/SHA/失败恢复/pending重启/授权验证码 | 生产服务缺路由仍未恢复；无害EXE验证启动与安全退出交接，非真实安装 |
| 紧凑范围 | 输入区内 GlassSelect 锚定菜单保留 auto/keep/replace-source；Goal原冻结范围无替换菜单 | 完整UI59项/18截图验证菜单键盘、焦点恢复、884×640无溢出；Goal冻结由Ask/Goal专项覆盖 |
| 自动命名 | 同轮成功观察路径 gate，visualName 短名，经现有 node update/create；自动导入/生成短回退，手动标题保护；同名suffix按持久身份保存 | 导入不另发付费识别；首次现有 Agent 观察后命名。脚本中的主体名不代表真实识别 |
| 选择/配置 | TaskScope统一materials顺序/角色/用途；白名单冻结启用模型池、默认模型、能力/协议/传输与本次参数；Main/Renderer持久化镜像；Goal确认前hash含配置 | Key/地址不进入快照；执行仍用Main凭据解析，历史imageParams只作历史解释 |
| 参数兼容 | Grok家族能力独立于网关/协议；缺省high→medium在发送前完成并记录decision；显式连接能力覆盖独立生效。native xAI prepared/wire/returned一致 | 未测真实渠道。默认矩阵是配置策略，不是所有同名模型的实测限制 |
| 四向连线 | 四侧同一端口/拖拽命中/路径owner；图继续存来源→目标、循环/撤销/需求规则，不触发生图 | 完成后端口随几何位置选最近侧，不另存起拖侧；完整UI32组合、取消/缩放/移动/重载与交互冲突通过 |

本地证据：

- Ask/Goal：`.diagnostics/electron/aidebug-2026-10-18T06-55-40-745Z/report.json`，14业务检查、8截图、0基础布局失败；源文件前后哈希一致，记录在`.diagnostics/ask-user-validation-source-stability.json`。
- Runtime全链：`.diagnostics/agent-workflow/2026-10-18T08-25-45-276Z/report.json`，11合同通过，0真实模型请求；含同名批次重排/JSON稳定、手动“· 定稿”保护、同response提前命名拒绝、像素真正进入下一模型回合后才命名、冻结SHA改变时零派发。Runtime携带同一无凭据imageConfig进入Main图片bridge后再执行服务，配置漂移回归验证native xAI/direct/high的prepared与实际wire一致；恶意额外tool imageConfig先失败复现、修复后`extraToolConfigurationIgnored:true`，派发内部策略始终从冻结settings构造。诊断trace实际带既有internalOnly，避免进入用户timeline；view-image专项同步通过。该专项对Main callback的检查仍是静态合同，真实Main执行由下条Electron测试独立证明。
- Scope/持久化审计：`.diagnostics/agent-workflow/scope-audit-2026-10-18T07-02-48-479Z/report.json`；完整120模型池不截断、16种steer组合、Goal配置确认、Main pending JSON、手动名称元数据、项目322资产实际保存恢复、CLI/MCP等通过。
- 真实 Main 冻结配置：`.diagnostics/agent-workflow-main-2026-10-18T07-25-43-958Z/report.json`，4项/2截图，真实Renderer提交→preload→Main Runtime→统一图片服务→loopback HTTP→受管PNG和session；暂停首轮Responses期间通过preload保存另一套live配置，3轮模型上下文与唯一图片POST仍使用原冻结xAI/direct/high/1:1/1K/n1，最后同轮收到图片像素。该测试使用现有明确Responses路由的gpt-5.6-sol脚本夹具，不是实际模型请求。
- 手动名称所有权：`.diagnostics/agent-workflow/manual-naming-2026-10-18T07-36-39-512Z/report.json`，命名13项、图片组事务5项、typecheck与共享自动化契约通过。覆盖manual清洗/JSON往返、通用名和数字后缀、传入visual不能覆盖已有manual、同名显式rename取得manual后重放不变；真实编辑/重载UI独立验收。
- 冻结策略失败→修复证据：`.diagnostics/agent-workflow-delivery-2026-10-18/frozen-tool-policy-regression.json`，同一专项先以额外tool imageConfig得到openai/newapi/medium而失败，修复后保留xai/direct/high。
- 空质量列表回归：真实`core.normalizeImageModelConfigs`产生的`[]`曾抹掉Grok默认质量，使兼容协议发high；修复前adapters回归以high≠medium失败，修复后13组exact/inferred/alias×协议/空与非空能力通过。只让空quality列表继承family/protocol默认，不改变其他能力数组语义；adapters/service/workflow全部通过。
- 更新来源探针：`.diagnostics/agent-workflow-delivery-2026-10-17/update-origin-probe.json`，未认证、未改变设置；仅脱敏originHash和状态，不记录地址/凭据。
- 更新HTTP/IPC：`.diagnostics/update-http-2026-10-18T06-50-27-453Z/report.json`，22项通过；UI：`.diagnostics/update-ui-2026-10-18T06-51-20-049Z/report.json`，7项/11截图/2次启动通过，截图已查看。
- Quick GUI：`.diagnostics/electron/aidebug-2026-10-18T06-59-28-256Z/report.json`通过。
- 受影响专项：view-image、agent-protocol、agent-responses-adapter、agent-steer24、goal-runtime43、requirement-graph356曲线采样、image-generation-adapters/service/failure、model-runtime-evidence、task-scope、goal-task-scope、image-content-title、project-session-merge、project-io、IPC152/149、MCP85工具、automation-service通过；typecheck通过。最终构建/安装结果从 Progress 查阅。

真实联调清单已向用户提出，尚无凭据/范围回复，实际请求数为0：gpt-6.1-sol最多4次对话（512px红圆/蓝方、读图/询问/命名），grok-imagine-image-2.0最多2次创建（生成n=1、1:1/1K、high兼容归一；编辑n=1、medium、红圆SOURCE/蓝方style参考）。未执行，不能作为验证过的渠道规则。用户提供该范围凭据后可继续，无需重复确认已授权步骤，结果不明不重发。

失败原始记录保留：初轮Ask基础行高/handle断言、源码HMR导致导航中断、扩大重载测试揭示Main配置和Renderer画幅丢失；四侧UI前轮被浮动工具条遮挡或HMR中断，均不计完整通过。修复数据链后才重跑，不降低业务断言。

历史失败（后续最终安装版已修复并复验）：安装版正常运行模式的额外验收发现`.diagnostics/agent-workflow-main-2026-10-18T08-00-06-907Z/report.json`实际仅一次n=1图片POST，冻结配置与同轮像素正确，但session出现两个同身份成果，单成果断言失败；测试退出超时且forced。该候选不计最终通过；owner修复后由下方最终EXE独立复验。单图普通tap与阈值前后取消的尾随点击修复已由完整UI确认。

生成资产身份与容器槽位修复已验证：`.diagnostics/agent-workflow/asset-merge-repro-2026-10-18/report.json`记录原n1重复和后续[A,replayA,B]成员错绑的真实失败、修复及最终owner哈希。共享coalesceImageAssets/remapImageAssetSlots处理绝对/相对别名和每侧writer旧槽映射；94项merge回归、单资产/多资产各3次真实保存重开、独立原失败fixture复验与typecheck通过。普通导入不同occurrence、不同run/不同输出文件、manual、pending/error仍保留。最终EXE复验独立记录，不用这些局部证据代替。

最终收口（2026-10-18，本地验证与安装完成）：

- 完整隔离Electron：`.diagnostics/agent-workflow-ui-2026-10-18T08-39-52-010Z/report.json`，mode=full、ok=true、59项/18截图、19owner sourceStable=true。图片→容器及容器→图片32侧向组合；38条geometry最大误差0.0005603px；原生可信键盘、Escape/blank/pointercancel/CtrlZ/overlay取消；0.5/1.2缩放、移动/撤销、平移/框选/resize冲突通过。单击查看512px图片、双击实际编辑、5px阈值后capture、取消后650ms无查看器、下一次真实点击恢复均有交互证据。
- 范围入口：884×640实际原生窗口，auto/keep/replace-source三项可见；锚定菜单180×154、坐标613,474→793,628，方向键/Enter/Tab/Escape与焦点恢复通过、无溢出。复用原TaskScope，没有第二套状态；Goal锁定由Ask/Goal14项补证。
- 命名UI：实际编辑单图、容器标题、成员、collection/spec/item，同名改回、数字suffix与通用手动名均写manual；stale视觉action不能覆盖，prompt-only不锁名；5图decode/名称/有向关系实际保存重载保持。视觉名称动作由fixture回放，不是模型识别实测。主/子代理已核对截图总览及scope/names-reloaded原图，见同目录`visual-review.json`。
- 最终安装版Main：`.diagnostics/agent-workflow-main-2026-10-18T08-36-34-460Z/report.json`，5项/3截图、13owner与ASAR匹配；3次loopback Responses与唯一1次图片POST。首轮暂停时真实preload改live配置仍冻结xAI/direct/high/1:1/1K/n1，PNG1024²/hash实际落盘，同主模型续轮收到像素。保存/实际Page.reload/正常退出后三处严格1node/1asset/outputs1且assetId/occurrenceId一致；revision4根消息/activeConversation终态done、无running，malformedProgress=[]、4条trace internalOnly=true。正常exit0/441ms、forced=false、processesAfter=[]。这里high来自显式fixture连接能力，不等同默认Grok能力规则或真实渠道支持。
- 双Renderer保存回归：`.diagnostics/agent-workflow-delivery-2026-10-18/dual-renderer-final.log`，真实2窗口，edit/edit、edit/delete、delete/undo、连续save、ack附近销毁5例通过。
- 最终构建：`package:win:unrestricted`退出0，1688 modules/22.39s；421产品/公开契约文件冻结hash `33b9b0d524a88e2f0858f997ef76323f68d4c294808cda7b3c968c13e23e8592`。EXE109,866,496 B / SHA256 `c94cfb0132b6738c7d12ad66723b837460d89d4bd36510bf2cf3fbed1f52a3ba`；122dist/139owner与生产package元数据匹配，ASAR `6e143954c3ee861e35a523bcab10635e18e654a8306bb9850f21c0ca8608bd24`。最终/S原位安装exit0/17,431ms，注册/配置保留、EXE/ASAR匹配、无强杀；身份与路径见[Progress](../PROGRESS.md)，本地`package-audit.json`/`install.json`位于`.diagnostics/agent-workflow-delivery-2026-10-18/`。
- 最终安装版免费双接入：同交付目录`auth-ui-1792312696078/report.json`，6项/4截图/两次启动通过，账号表单、旧过期License、自定义提交/重启与秘密隔离；0模型POST/0License请求。已看重启工作台截图。

本轮为本地开发包，不上传EXE、不建正式Release。历史密集画布拖动性能与正式CSS门槛限制不因本轮通过而消失。
