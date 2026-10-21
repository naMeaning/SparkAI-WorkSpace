# SparkAI WorkSpace 目标

## 当前任务：GitHub 仓库展示层（2026-10-21，公开推送中）

- 结果：README 已重写为 GitHub 产品首页；新增 `docs/GITHUB_SHOWCASE.md` 与 `docs/assets/github/`，包含 9 张真实模型原图、7 种真实 Electron 界面视角、使用示例及逐图来源/模型/尺寸/格式/SHA-256；`docs/README.md` 已加入入口，既有教程与技术文档保留。
- 范围：仅仓库根首页、桌面首页、展示文档、索引、公开图片及 Goal/Progress 记录；复用 2026-10-18 已验证原图，未新增图片/对话/视频生成请求，未改业务代码、打包 EXE、创建 Release 或上传安装包。
- 界面证据：AI Native CLI 选择与定位真实九图项目，CDP 捕获已安装 Electron 界面；另建隔离公开示例，仅导入真实作品 02、03 并连接尚未执行的可复用需求。安装 ASAR 与 Progress 第三期开发构建身份一致；截图明确标为开发版。
- 事实边界：重新核对 `package.json`、GitHub Release 与 Progress；公开下载为 v1.0.9，`main` 同版本号的后续能力不代表已进入 Release。软件本身免费，模型费用由上游服务商决定；不声称所有模型、站点或视频能力已验证，未添加许可证/开源徽章。
- 验证：9 张 1024 × 1024 JPEG 原图逐字节匹配历史 manifest，7 张 1584 × 992 WebP 截图逐张人工审阅；16 图完整解码、哈希、无 EXIF/XMP、77 处相对链接及页内锚点、两个 GitHub Release 入口、敏感信息扫描和 `git diff --check` 通过。源码/包未变，无 EXE 打包要求。
- 最新授权：用户明确要求将展示图片与文档提交并推送到远程，用于正式开源项目展示。仓库根 README 是 GitHub 首页入口，同步加入真实画布主图、商品前后对比与展示页入口；仅普通提交并推送 origin/main，不创建 Release 或上传 EXE，不擅自选择项目许可证。
- 当前交付：本地展示素材已完成；继续核对暂存范围、链接、图片哈希和敏感信息，提交/推送后实查远端分支、页面引用与图片字节。所有模型/站点/视频的通用能力及上游计费仍不在本次验证范围。

## 当前任务：AI-Native 第三期——项目知识、成果检索与可复用创作模板（2026-10-20，本地交付完成）

- 结果：用户明确保存项目长期规范，跨同项目会话使用并看见实际采用版本；按用途/对象/来源/描述/采用状态检索真实历史成果，明确使用后才绑定素材；成功任务保存到现有需求模板库，在其他项目重新绑定素材。
- 范围：仅桌面与本地Runtime；复用第一期任务/幂等/恢复、第二期要求/验收/采用/修订、TaskScope、Catalog、FastMemory与requirement/Commerce模板owner。知识按项目/商品对象隔离，用户事实与Agent建议分开；派发冻结知识与模板展开，追问/恢复不读新规则。本地派生索引不建第二资产库，不调用embedding/新模型服务。
- 验收：本地Mock/loopback验证跨会话/跨项目/商品隔离、CAS与停用删除、运行冻结/续接、新任务版本、观察/Prompt/标签分源、失效重建、组合检索/稳定分页/不同occurrence；100/500/1000元数据冷/热耗时实测；A任务跨项目B模板不带实例秘密，应用零请求、执行幂等；真实隔离Electron覆盖知识/检索/定位/模板/实际知识展示、最小窗、双窗及重启，旧项目真实保存重开。
- 授权：0真实图片/视频/对话请求，不复用历史付费授权；不改外部New API/Extension/生产/计费，不安装远端检索服务或模型依赖。最终package:win:unrestricted、包内核对、正常安全退出、品牌/S原位安装、文档与仅本期commit/普通upstream push已授权；不上传EXE/Release/tag。
- 接受现场：main / 55ea6cd160254d0694f2a64047bcfee1696b94df，工作树干净；第二期已完成并停止的方向由本次明确第三期请求继续，不回退工作树。子代理仍按gpt-6.1-sol/max分担单一owner，主代理集成公开能力、双窗、验证和本地交付。
- 已落地：Main知识历史/CAS与Catalog只读投影、派生检索与精确使用、既有模板v2有限变量、TaskScope/ledger/session冻结、公开命令及双窗接线。知识13组、索引10组、模板8组、Runtime10组、旧任务升级3组及受影响保存专项已实际通过。真实UI发现的Requirement SOURCE被composer覆盖与命名重绑占位状态问题已修复并通过完整复验。
- 性能里程碑：真实Electron检索100/500/1000资产首查43/70/131ms、UI573/179/222ms；1000热查保留3751ms离群。Main实际owner专项含1000不同文件、安全失效与legacy只读；元数据不再hydrate整项目、不迁移写回，损坏fail closed。项目打开耗时未优化。
- 双窗复验：打开独立窗会折叠主窗并卸载知识编辑草稿的实测缺陷已修为同key保留挂载；最新typecheck、投影7组及真实双窗草稿保留/CAS冲突均通过。
- 实际UI：源码完整7组/15截图通过，4本地模型POST/2图片POST、两次正常退出0、0真实请求；命名重绑与用户改文保留、跨项目精确素材、检索比较/显式使用、双窗草稿/CAS、停用历史版本、保存重载/重启与重复提交均实跑，关键截图已检查。
- 最终制品：最终[Windows EXE](release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe) 109,981,696 B / SHA-256 `adfa00602cbc2f2bc0fa8d67e287be256540f99b572cf9371f0cc87e343b6604`；ASAR 52,736,636 B / `72a19260ed610072f0104c3d8517533011a9a74969ca60e66901d6985b9054a5`。681个产品/测试/公开契约源冻结hash `ff8f8719af3cf1b81c3034d5b58e6cd2c8131ef0b60b357b3abe1c609eeed4a4`，130dist/175必需owner存在及逐字节核对通过。
- 安装：品牌`/S`原位安装exit0/21,706ms，注册目录E:\sparkai-workspace\naimage/1.0.9保留，配置与快捷方式偏好不变；安装EXE/ASAR与候选包相同。安装前所有同名实例为空，未强杀；凭据sidecar仅核对metadata，未读内容。
- 安装版复验：[最终安装版UI](.diagnostics/project-context-ui-2026-10-20T06-30-51-276Z/report.json)7组/15截图通过，4本地模型POST/2图片POST、两次正常退出0/未强杀；关键截图已检查。
- 文档/Git：Goal/Progress、产品合同、上下文地图、共享schema/registry、CLI/MCP/Skill及验证记录已同步；79个对应文件提交 `3823bd9ec716ba667ef6db1977ac5f3b9b20493b` 已普通push至origin/main，HEAD/upstream/远端实查一致、工作树干净。本完成记录随纯文档收尾提交，最终身份见[本地交付索引](.diagnostics/project-context-delivery-2026-10-20/delivery.json)。
- 边界/停止：0真实模型/图片/视频请求；本地Mock不证明通用语义、真实视觉识别、Logo/文字/风格保持、审美或计费。1000项热检索3751ms离群及原项目打开耗时限制保留；1000独立文件冷/热2408.70/1095.42ms。未改外部New API/Extension/生产，未上传EXE、创建Release/tag；不自行启动后续阶段。

## 当前任务：AI-Native 第二期——结构化创作要求、成果验收与定向修改（2026-10-20，本地交付完成）

- 结果：用户可查看/修订创作要求，区分生成、保存、本地检测、AI观察和用户采用；按稳定身份只修改指定成果，原图/非目标保留，主窗、独立Agent、CLI/MCP和重启共用权威数据。
- 范围/授权：仅桌面和本地Runtime，复用第一期任务/幂等/恢复、TaskScope、唯一image_gen、图片journal与catalog；0真实图片/视频/对话请求，不复用付费授权。不改New API/Extension/生产，不实施第三期；最终本地EXE、安全安装及commit/普通upstream push已授权，不上传EXE/Release/tag。
- 合同：Main项目owner持久完整版本要求及验收历史，ledger只引用/摘要；TaskScope唯一拥有素材/配置。像素观察必须由view_image后成功模型回合消费证明，用户采用仍归catalog；定向目标冻结asset/occurrence/hash/revision，失败不能自动重生。
- 实际验收：owner16组、Runtime29组（14本地图片POST）、相关12专项、typecheck/view-image通过；真实Electron七选二仅2POST、实际涂抹另1POST、自动A/B分离、比较/采用撤销、双窗口与保存重开/重启均通过。最终安装版6组/13截图、两次正常退出；第一期任务卡10组/9截图回归通过。具体报告和失败历史见[第二期验证](docs/AI_NATIVE_CREATION_VALIDATION_2026-10-20.md)。
- 制品：最终[Windows EXE](release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe) 109,925,376 B / SHA-256 `3e8a84ffdc4bb169c7b6c817118a65cc325dcc05b4292679852b11cb9226788e`；ASAR 52,414,483 B / `78e58fe36313c5cf28bcff2a56a975ca0afadd9f1b7ca150bc46558b303374b5`。647个产品/测试/公开契约文件冻结hash `237c19bf48d4d7853f643ca5174340511492b2702e4be0ee0db26e2800b0d43c`，124dist/156必需owner存在及逐字节核对通过。
- 安装：品牌`/S`原位安装exit0/17,463ms，原注册目录/1.0.9、配置及快捷方式偏好保留；安装EXE/ASAR匹配，安装前无同名进程，未强杀。
- 文档/Git：产品合同、地图、公开schema/registry、CLI/MCP/Skill及本期验证记录已同步；79个对应文件提交为 `cb3b774d9813382f8f02f24a663bb9ca4e83b06b`，普通push到origin/main，HEAD/upstream/远端实查一致、工作树干净。本完成记录随纯文档收尾同步，最终分支身份见Progress的本地交付索引。
- 限制/停止：Mock仅证明合同、身份、持久化及控制流程，不能证明真实识别、Logo保持、文字准确率、参考遵从、审美或实际计费；正式发布门禁未运行。本期交付完成，停止，不启动第三期。

## 当前任务：AI-Native 第一期——稳定任务回执与人机共同续接（2026-10-19，本地交付完成）

- 模式/结果：直接实施桌面与本地 Runtime 的稳定异步任务，GUI、内置 Agent、CLI/MCP 共用原执行链；超时、重复提交、重载与重启不得重建图片请求。
- 范围：`agent.task.start/get/wait/answer`；Main 原子持久化回执/幂等索引与 run/image-operation 关联；Renderer 冻结 TaskScope、pending execution、原恢复/保存入口；主/独立 Agent 紧凑任务卡。保留 `agent.chat` 兼容语义。
- 一致性：Main 回执只投影原生产状态，不另建 Runtime；accepted 必须已落盘并冻结目标/范围；同项目/会话/提交标识同规范请求复用、异内容冲突；结构化回答校验任务/问题/版本并一次消费。首期不自动清理回执及幂等标识，达到容量上限拒绝新任务，旧提交不得因淘汰静默重发。
- 验收：先记录失败 Mock 场景，再验证并发去重/唯一图片 POST、冲突零派发、有界等待/游标、GUI/CLI 回答竞争与冻结配置、重启/原图片恢复、uncertain/interrupted、隔离/停止/部分成功/保存失败、脱敏；真实隔离 Electron 覆盖正式最小窗和独立 Agent 窗、回答及重载并保留截图。运行受影响专项、typecheck、Runtime 的 view-image 门禁。
- 授权：0 真实图片/视频/对话模型请求；历史九图授权不复用。不改外部 New API/Extension、生产服务、后续视觉验收/项目知识/语义检索。按持续授权最终 `package:win:unrestricted`、核对包内源码/EXE身份、安全正常退出后品牌安装器原位升级、文档同步、仅本期提交及普通 push/远端核对；不上传 EXE、不创建正式 Release/tag。用户追加提醒远端 GitHub、release 目录打包和敏感信息检索。
- 接受现场：根仓库 main，工作树干净；以当前源码为准，92afbc4 仅历史设计基线；保留下方已完成工作及历史证据。
- 实现里程碑：Main 回执/幂等持久化、Renderer 原生产链受理/续接、图片 journal 关联、公开四命令和双窗口紧凑卡已接入。Mock先记录缺失模块失败，再通过并发/冲突/游标/回答CAS/重启隔离；现有受影响专项通过情况见Progress，不把Mock计数当HTTP唯一POST证据。
- 当前验证：真实隔离Electron九组检查通过，唯一单图POST、CLI超时、GUI/CLI竞争、冻结配置/选择、问题重载、双窗口回答、活动运行重载interrupted及正常重启，8截图/2本地图片POST/0真实模型请求；保存失败后权威状态回投、部分成功、幂等丢回执/容量/损坏和原图片关联恢复异常测试通过。具体报告/历史失败保留于Progress。
- 收尾验证：首条GUI消息受理前显式保存空白会话，发送/键盘/陈旧busy与显式素材替换实跑通过；新增3:2/2K实际POST与落盘哈希断言。Main journal已保存字节不再被Runtime画幅归一化改写；恶意历史节点/operation字段进入回执前脱敏；GUI受理失败及时interrupted且同标识不重发。quick GUI通过，详见Progress。
- 最终故障补充：GUI回答领取后真实session写失败先复现resuming悬留，再修为interrupted、旧回答零派发；旧session待回答快照不能复活已终结回执。最终源码十组UI/9截图/9本地模型POST/2图片POST/2次正常退出通过，0真实请求；敏感信息扫描只命中已核实的合成测试值。首包为intermediate，重新冻结最终源码打包。
- 本地交付：最终unrestricted EXE109,879,808 B / SHA256 `9e60c32dc0cd51d446be7f3bd9db87b1fcf7864fedf631cce08899c8e901aecb`；620源文件冻结为`198d4d72…820057`，122dist/140owner与生产包核对通过。最终品牌/S原位安装exit0/16,997ms，原注册目录/1.0.9与配置保留；安装EXE/ASAR与已通过十组/9截图/2次正常退出的安装版逐字节相同。完整身份、失败记录及限制见Progress和[本轮验证](docs/AI_NATIVE_TASKS_VALIDATION_2026-10-19.md)。
- Git交付：41个对应源码/测试/文档文件已提交为 `3285f9153bb4de0a9277077088f9a0a1301c1035` 并普通push至origin/main，远端、HEAD及upstream实查一致。最终制品/安装/冻结源码复核通过；本完成记录随纯文档收尾提交，最终Git身份见[本地交付索引](.diagnostics/agent-task-delivery-2026-10-19/delivery.json)。
- 下一步：本轮授权的桌面本地交付完成；真实模型、视觉验收、实际计费与正式发布另行安排，不复用历史付费请求授权。

## 当前素材任务：真实 AI Native 九图展示（2026-10-18，已完成）

- 用户方向：制作供朋友圈和 GitHub 使用的 9 张图片，以实际生成作品及宣传展示为主，辅以简短教学；使用已安装最新版和用户现有真实生图配置。用户明确要求不使用 Computer Use，改由软件自带 AI Native CLI 操作。
- 范围：创建独立展示项目，通过正式 authenticated automation bridge / `naimage-control` 执行真实生图，保留成果、提示词、模型与实际参数；整理九张统一视觉的发布图、九宫格预览与使用说明。原项目和私人配置保留。
- 授权：本任务真实图片请求已明确授权；默认每个构图一张，创建结果不明不重复提交。若已有 CLI 无法完成必要步骤，用户已允许补齐功能；仅在确有缺口时修改产品并执行打包、安装和 Git 交付流程。
- 验收：9 张实际可解码图片、逐图视觉检查、真实项目资产及模型证据、可直接分享的本地文件。仅制作素材时不触发 EXE 打包；发布到朋友圈/GitHub、视频请求和外部服务修改不在本次执行范围。
- 实现：`project.create.parentDirectory` 支持无对话框建项目，Main验证现有绝对父目录、同名不覆盖；取消/忙碌/失败如实返回。Windows PowerShell CLI stdout 统一无 BOM UTF-8，实际中文/emoji子进程往返通过。GUI、preload类型、schema/registry、CLI/MCP和文档同源。
- 成果：真实默认 `grok-imagine-image-2.0` / 1:1 / 1K / auto，共9个operation、9张JPEG1024²，全部saved；第03张以第02张为SOURCE编辑并保留来源关系。另制作9张1440²宣传JPG、9张GitHub WebP、九宫格与提示词/发布文案；逐原图与最终总览已看，18张原图/宣传图解码/hash/尺寸及9处README图片链接通过。
- 软件现场：原生CLI创建独立“SparkAI 九图创作展”项目，9原图排3×3，9宣传图导入同一图片组；正常退出、最终升级与重启后实查仍10节点/18图片、9operation均saved、Agent idle、B→C关系保留。旧项目8节点保持。
- 本地交付：目录策略27项、automation专项/typecheck、production build和122dist/139owner包内核对通过。最终EXE109,867,520 B / SHA256 `f129ae192aec54a72de1feeeb4941814d1eb2907d509915f0db61312bc6589c5`；品牌/S原位安装exit0/17,374ms，配置/注册目录保留，安装EXE/ASAR一致。完整路径与证据见[本轮记录](docs/AI_NATIVE_SHOWCASE_2026-10-18.md)和Progress。
- 素材：`artifacts/showcase-2026-10-18/SparkAI-九图展示包.zip`，9,907,688 B / SHA256 `530ebf2089b5d098a2dc26f360af5370b3c3f28c042cea97dbf548489a4d7647`；33个条目，不含凭据/自动化连接/项目内部记录。朋友圈、GitHub素材和EXE未发布。
- Git：17个对应源码/测试/文档文件已提交为 `e664f992bbf5e878ea69c60b0a1f1ce239b207e1` 并普通push至origin/main；远端、HEAD及upstream实查一致、工作树干净。本完成记录随纯文档收尾提交，最终分支实查身份保存在 `.diagnostics/native-showcase-delivery-2026-10-18/delivery.json`。

## 当前任务：Agent 工作流、图片上下文、更新与四向连线（2026-10-18，本地交付完成；真实模型能力另行验证）

- 结果：八项桌面修复已实施，受影响专项、隔离 Electron 交互、typecheck、production build、最终 EXE 和原位安装已完成。逐项证据与限制见[本轮验证](docs/AGENT_WORKFLOW_VALIDATION_2026-10-18.md)，长期 owner 见[合同](docs/AGENT_WORKFLOW_CONTRACT.md)。
- 依据：[交接文档](docs/AGENT_WORKFLOW_UPDATE_HANDOFF_2026-10-17.md)作为实施起点；通过实际代码/运行复现确认根因。旧 imageParams 仅作历史信息，不能覆盖本轮冻结设置。
- 范围：真实结构化 ask_user 与恢复链；view_image 同轮像素及生图原图/参考字节清单；更新分层诊断；原 TaskScope 紧凑范围入口；同轮内容命名与手动所有权；统一冻结选择/模型池/有效配置；Grok 能力归一；四侧关系端口与手势取消。
- 边界：仅桌面及本地 Runtime；保留免费双接入、取消/重载/续跑、Goal 画幅锁定、签名/回滚、来源关系/循环/需求规则。未修改外部 New API、Extension 或生产更新服务，未上传 EXE/创建 Release。
- 接受现场：main / 8889db1db5f002226d10634f3c066b24f69cff8a；预存 Goal、Progress、docs/README 和交接草稿均保留。所有子代理使用 gpt-6.1-sol / max。
- 关键修复：Main/Renderer pending 原本丢失配置/画幅；额外 tool imageConfig 可覆盖冻结策略；空 quality 列表抹掉 Grok 默认能力；手动通用名/数字后缀所有权丢失；pointer capture 吞单击与取消尾随点击；成果绝对/相对路径别名造成重复及容器旧槽错绑。均有失败复现与修后证据，未降低断言。
- 验收：Ask/Goal 14项/8截图；最终完整交互 59项/18截图（32侧向组合、小窗884×640、命名实际编辑/重载）；安装版 Main 5项/3截图（唯一1次Mock图片POST、1成果、像素续轮、重载、正常退出）；更新 HTTP22项及UI7项/11截图；免费双接入6项/4截图/两次启动；资产merge94项、真实projectIO及双Renderer5例；其余专项/typecheck通过。
- 最终制品：421个产品/公开契约文件冻结，sourceHash `33b9b0d524a88e2f0858f997ef76323f68d4c294808cda7b3c968c13e23e8592`；production build1688 modules/22.39s，品牌Windows EXE109,866,496 B / SHA256 `c94cfb0132b6738c7d12ad66723b837460d89d4bd36510bf2cf3fbed1f52a3ba`。品牌/S原位安装exit0/17,431ms，原注册目录/配置保留，安装EXE/ASAR核验一致；完整身份在[Progress](PROGRESS.md)。
- 未验证：真实模型请求0；自主工具选择、真实主体识别/参考遵从与具体Grok渠道能力未测。具体联调清单已提出，等待对应范围凭据回复；默认n=1、创建不明不重发。生产更新地址合法但HTTP404缺路由，客户端无法补齐外部接口。历史密集拖动性能与正式CSS门槛仍保留。
- Git交付：57个源码/测试/文档文件已提交为 `c7787f2b90e4c2c0cf2e585da8f5ca4a4d81e36b` 并普通push到origin/main，实查远端/HEAD/upstream一致，提交后工作树干净。本完成记录随纯文档收尾提交归档，最终分支身份见Progress的本地交付索引。
- 下一步：本轮桌面本地交付完成；可选真实联调等待已提出范围的凭据回复，生产更新接口及正式发布另行处理。

## 已完成任务：免费 Agent 生图工作台与双接入（2026-10-17，delivered；公开发布另行安排）

- 结果：把产品统一定位为免费的“Agent 生图工作台”，保留现有账号登录，通用版 Base URL + API Key 不再需要 Pro 授权。更广泛的 New API/Sub2API 账号登录适配是后续目标，不把接口兼容当成所有站点账号均已兼容。
- 范围：桌面免费双接入行为、登录/启动门槛、图片与 Agent 请求授权、README/教程/双接入说明、产品意图、上下文地图和推广文案；账号、渠道、quota、计费和 New API 管理仍由用户自己的服务负责。
- 非目标：不修改外部原生 New API 或 sparkai-extension 生产部署；不发起真实图片/视频/对话请求；不上传 EXE 或创建正式 Release；不删除旧 License IPC/数据字段，以便旧设置和旧扩展继续可读。
- 验收：双发行策略仍保留（SparkAPI 专用版拒绝自定义接口）；无限制版自定义连接不再显示或要求 Pro 兑换码，配置后可进入工作台；Agent/图片请求不再调用 Pro License 门槛；README、教程和双接入说明准确写明“软件免费、上游服务费用由用户自己的账号/Key承担”；专项测试、production build、Windows EXE、原位安装、提交和 push 均记录真实结果。
- 当前状态：Renderer、Electron Main、Server IPC 和浏览器回退已移除自定义模式的 Pro 门槛；旧 Electron License IPC/存储保留原兼容行为，正常入口不调用。专项、typecheck、production build、122 个 dist 文件/8 个 Main owner 包内核对及原位安装均完成。已安装程序免费接入专项 6 项/4 截图/2 次启动通过，覆盖过期旧 License、自定义配置和重启恢复，0 真实模型请求。根/桌面 README、教程、第三方署名和推广文案已同步，源码/文档提交 `0909be79d9620f4430d410844b3b31fa3b5d2c83` 已普通 push，并实查远端 main 一致。
- 新增待交接范围（2026-10-17）：用户追加 `ask_user` 选项弹窗、`view_image`/参考图闭环、软件更新、运行中图片范围入口、图片容器内容命名、选中图片与有效生图配置上下文、真实生图参数联调、四向连线；方案与执行 Prompt 见 [Agent 工作流、图片上下文与更新功能交接](docs/AGENT_WORKFLOW_UPDATE_HANDOFF_2026-10-17.md)。这些是待实施工作，不改变本 Goal 的免费双接入结果和授权边界。
- 制品与安装：本地无限制版 1.0.9 EXE，109,853,696 B，SHA-256 `8dd49ccf4a0dfab85919bcf3ed9d295f435beb9f83e5449d9157c60e8124cab3`；品牌安装器 `/S` 退出 0 / 24,920ms，注册目录与配置保留、安装 EXE/ASAR 匹配。完整证据见 Progress。
- 下一步：本轮范围已交付。本完成记录随纯文档提交归档，最终分支身份见 Progress 的本地交付索引。公开 v1.0.9 尚未包含本次免费改动；真实模型、全面 New API/Sub2API 账号联调及正式发布不在本轮范围。

### 旧方向已被替代

2026-10-17 用户明确将“自定义 Base URL 需要 Pro License”的旧商业门槛替换为免费双接入。旧文档和历史发布说明保留当时事实，但不再作为当前产品行为或宣传依据；旧 License IPC、扩展和设置字段只做向后兼容，不再决定工作区访问或模型请求。

## 已完成任务：参考项目署名与公开教程整理（2026-10-17，completed）

- 结果：按固定上游版本和实际许可证补全 New API、Sub2API、GPT Image Playground 与 Infinite Canvas 的参考说明；整理 README、教程索引及面向用户的教程。
- 范围：桌面 README、docs 导航、第三方参考说明、已发布版教程与主分支开发版预览教程；不改软件行为、应用版本、安装包或远端服务。
- 现场：根仓库 `main` / `dd1d170f5077c372cec026fd2669ad71bcc5b85b`，工作树干净，`origin/main` 实测与 HEAD 一致。
- 验收：使用已核对的上游固定 commit/许可证信息；明确参考与代码纳入的区别；文档链接和 Markdown 差异检查通过；开发版新增能力不得描述成 v1.0.9 已有。
- 授权边界：文档工作无需 EXE；不新增真实模型请求或 Release。当前请求未授权提交/push 本轮文档。
- 完成：新增 [第三方参考项目与许可证](docs/THIRD_PARTY_REFERENCES.md)、README/文档索引版本分层，以及主分支开发版的模型连接和图片结果恢复教程；本地 Markdown 链接、Harness 结构检查和 `git diff --check` 通过。
- 交付：本轮只改文档，未重打包；文档提交 `935eb61` 已普通推送到 `origin/main`，远端核对见最新进度记录。

## 已完成任务：工作台优化实施（2026-10-17，delivered；阶段5部分验证）

- 模式 / 结果：实施[优化设计](docs/WORKSPACE_OPTIMIZATION_DESIGN_2026-10-16.md)第12节，按阶段0→1→2→3→4→5交付可验证的本地产品增量。
- 范围：基线；连接/凭据/协议/操作级证据与脱敏摘要；画布点击、拖动、取消、右键冻结目标；图片原任务/本地成果恢复；小窗口布局、工具搜索与有效配置；同条件性能收敛。复用既有画像、统一图片服务、凭据解析、selection reducer、项目保存及共享命令。
- 现场：main / `15a126bd73b0852236e8d8768030de81a5de8e3f`；接受时仅Goal/Progress/地图/索引及设计5处文档改动，保留原文档和其他产品历史。
- 替代关系：设计§5固化中键平移、选择工具左键框选、Space始终临时平移、空白轻点保留选择；替代PRODUCT_INTENT中旧中键框选文字，实施时同步提示、源码和行为验证。
- 验收：本地HTTP模拟精确身份与协议、失败/恢复和POST计数；真实隔离Electron指针/可见高亮/截图；恢复经过进程重启；性能保留同机器/窗口/DPI/主题/缓存的前后原始记录。新增公开动作同步GUI、共享schema、CLI/MCP、契约测试。
- 授权：0新真实图片/视频/对话模型请求，Grok渠道保持未恢复；不安装依赖、不改变外部生产、不正式发布。完整功能交付批次按现有持续授权完成最终unrestricted EXE、身份核对、安全原位安装、文档、提交及普通push/远端核对。
- 当前状态：阶段0/1本地基线、连接身份/协议/证据隔离通过；阶段2的100/125/150% DPI真实指针、原生失焦、屏外世界框选和重载均有证据。阶段3服务10子进程、应用5次启动及06:04保存失败列表刷新复验通过。阶段4在100/125/150% DPI完成布局/配置验收；另发现并修复`max-width:900px`误覆盖884px正式最小窗口，修订后884×640真实Electron专项通过。150%大窗实际1708×934，未覆盖该DPI下1920×1080。
- 阶段5：最终候选Renderer bundle `020daad12aa2ea8d32bd17ce65be90cb326aef092465ec6cf4a494f9a8880499`，标准三轮原门禁通过；100/500/1000真实2K/4K混合资产前后测、12轮内存和本地视频/Mock进度已完成。加载/平移改善；500/1000拖动P95分别397.6→499.5ms、477→816.1ms回归，33.4ms建议目标未达，保持部分验证状态。原始失败与撤回试验保留在Progress，不降低门槛。
- 当前复验：100/125/150%三档画布各28项/8截图通过，双端屏外穿视口关系可见；typecheck、view-image、IPC152/149、automation契约通过；修订Agent宽度及画布断言后的quick GUI通过。生产CSS边界自检与修复后的884/1280/1920真实Electron布局/工具/配置/重启专项通过，0模型POST。test:bundle开发测量CSS281,539B，超过正式270,000B门槛11,539B；initial/plugin硬限制通过，JS/dist advisory超限，不为开发包机械重构，正式release仍不可据此放行。
- 候选纠正：首次1.0.9 EXE `7c2dc05a45d204bb097354f794816fdfe1c504ca50b115a94c5c474501b39657`曾安装成功但已安装UI在884×640时画布/Agent高度约18,081px，已由本轮最终包替换；原因是`06-responsive.css`的900px窄屏规则覆盖正式最小窗口。源码已收至883px，生产压缩自检及开发/安装版Electron布局均通过。
- 最终制品：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，109,854,720 B，SHA-256 `b9f42418f252f8a02235b772d685b40e64f17ca3508ee0b31aedb0c7546634b0`；ASAR审计123个dist/17个Main与Runtime owner通过。已用品牌安装器`/S`原位升级，退出码0，注册版本1.0.9，安装EXE 232,754,176 B / `606264f3f14eaf409f997a9cbd8db5d8c02d687164b08f2e9c8e6fb4a6e22343`，ASAR匹配候选；设置、项目列表及密钥sidecar保留。
- 安装版UI：[150% DPI布局/配置报告](.diagnostics/workspace-layout-config-2026-10-17T07-06-19-398Z/report.json)与[本地双连接故障报告](.diagnostics/image-generation-failure-ui-2026-10-17T07-08-08-080Z/report.json)通过，0真实模型请求。性能500/1000节点拖动回归及33.4ms目标未达、CSS正式Bundle门槛超11,539 B、真实服务未验证、150%最大窗1920×1080未覆盖，均作为剩余限制；未上传EXE或发布Release。
- 交付同步：源码与文档提交`9c8967f5ed069c71d8d1565721827ff762b98989`已普通push；`origin/main`与本地HEAD一致，工作树干净。当前授权范围已交付；500/1000拖动性能回归作为独立后续优化项，真实服务仍需单独授权验证。


## 已完成任务：优化设计文档与执行交接（2026-10-16，documentation completed / verified；产品实施待启动）

- 最新请求：把本轮架构评审的六项设计写入项目文档，并提供交给 gpt-6.1-sol 的执行 Prompt。
- 范围：[工作台优化设计](docs/WORKSPACE_OPTIMIZATION_DESIGN_2026-10-16.md)、文档导航及 Goal/Progress 交接记录；覆盖接口真实性、画布交互、失败恢复、布局、配置和性能。
- 边界：本轮只固化设计，不实施产品功能、不改变已接受的产品规则；设计中的行为变更在用户后续明确要求执行后成为对应实施任务。保留此前 Grok 修复、制品和渠道未恢复的事实。
- 验收：设计包含当前证据、目标行为、owner、依赖顺序、专项验收及授权边界；检查文档链接、差异和执行 Prompt 的一致性。
- 当前状态：470 行设计文档与第 12 节执行 Prompt 已完成，Goal/Progress、文档索引和地图候选导航已同步；5 个文档、61 处本地链接、13 个 package 命令与结构检查通过，git diff --check 通过。本轮没有新 GUI/性能基准或真实模型验证，不触发 EXE 打包、安装或发布。
- 下一步：用户将执行 Prompt 交给 gpt-6.1-sol 后，从设计阶段 0、1 开始并按阶段推进；本轮文档完成不代表产品优化完成。

## 已完成任务：Grok 生图失败定位与客户端防重试修复（2026-10-16，completed / verified；渠道未恢复）

- 最新请求：用户截图显示 Agent 两次 Grok 生图在 0–1 秒内失败，均为 `Upstream service temporarily unavailable`，要求检查并修复；随后用户明确表示渠道端若修不了就算了。本轮仅交付已证实的客户端防重复生图修复，不再尝试客户端绕过渠道故障。
- 结果与范围：根据本机脱敏诊断、实际连接画像和图片请求链路定位原因，修复可证实的桌面问题；沿用统一 image_gen、连接优先级及受管成果落盘，不改外部 New API 或扩展生产服务。
- 验收：以回归测试复现失败边界并验证修复；涉及可见行为时补隔离 Mock Electron 证据；最终 production build/本地 Windows EXE、正常退出后的原位安装和身份核对、上下文同步及普通提交/push。
- 授权边界：用户先允许 1 次现有连接的真实 Grok 测试，已返回 502；随后提供连接凭据并要求再次测试，新增授权 1 次相同简单风景、n=1、无参考图、无重试验证。新凭据只在进程内使用，不写入项目配置/报告，不把历史成功视为当前可用证明。
- 接受现场：根仓库 main / `8d5db36`，工作树干净；此前模型配置布局与 resize 已完成，保留历史证据。
- 定位里程碑：安装版诊断确认两次 xai-images / sync 请求分别在 1285ms、900ms 返回 HTTP 502 / UPSTREAM_ERROR，尚未进入下载/落盘；Agent 的 upstream_5xx 建议允许立即重试。连接未显式覆盖协议，模型族推断为 xAI。
- 修复里程碑：同步 JSON/multipart 图片 POST 的 5xx/网络不确定失败获得中文提示、image_generation_uncertain 和 unsafeToRetry；Agent 复用运行内保护阻止改提示词重发，对话/凭据查找/明确4xx不受该保护影响。28项回归与主 Agent 隔离UI通过，1次模拟图片POST、3轮模拟Agent对话、可见错误及截图通过。
- 真实边界：现有连接及用户新增连接分别各1次单张测试，都返回 HTTP 502，无图片、无自动重试；渠道端故障未修复。用户已要求到此为止，不再对渠道发请求。
- 打包里程碑：最终 `package:win:unrestricted` 退出0，production build 1682 modules /27.40s；本轮无限制版1.0.9 EXE为109,842,944 B，包内122个dist文件及8个Main/runtime owner逐字节匹配，完整身份见PROGRESS。渠道真实验证不再重复。
- 安装里程碑：品牌安装器正常`/S`原位升级退出0 /25.146s，注册目录与1.0.9、3个配置表面保留；安装EXE/ASAR匹配。已安装程序隔离UI通过：一次模拟图片POST、三轮模拟对话、错误可见/无敏感文本、截图核验通过，测试后日常配置与安装身份仍一致，0新真实请求。
- Git交付：源码/测试/上下文11个文件提交`5a270e649530fa6821ef871949b7e2ec16f371e8`已普通push到origin/main，实际远端、本地HEAD和缓存upstream一致；本完成状态随纯文档收尾提交归档，最终身份见PROGRESS链接的本地交付索引。
- 下一步：本轮客户端修复已交付；渠道端需由渠道商排查，按用户方向停止真实请求，不把客户端防重试描述成渠道恢复。EXE未上传、未发布Release。

## 已完成任务：模型连接布局、图片模型勾选及全方向调整尺寸（2026-10-15，completed / verified）

- 最新方向：用户截图指出逐模型密钥表单被挤到列表底部的极短滚动区，要求优化布局并解决只能右下角调尺寸；追加优化图片配置的模型勾选/默认操作。所有子代理仅使用 `gpt-6.1-sol` / `max`，原模型子代理已停止并按指定配置重新派发。
- 范围：模型配置改为目录与单模型详情并排，启用勾选与查看连接分开，主要地址/密钥清楚可见；图片配置修正选择/默认状态和点击区域；共享 DialogShell 支持四边四角、键盘、视口与最小尺寸约束，Drawer 保持自身宽度逻辑。
- 不变量：沿用原 Agent/Image 绑定和 Main 凭据/安全存储、接口/渠道/传输优先级、目录缓存与发现、默认接替规则、草稿保存/取消/未保存保护；不改 IPC/CLI/模型协议或新增真实模型请求，不读取用户截图中的密钥。
- 状态修复：显式 imageModel/pool 是启用状态唯一来源；独立连接/能力保留为候选，不能在设置刷新、保存或重启后反向启用。无显式池的旧配置只在加载时兼容迁移，运行时 gpt-image-2 优先规则不改。
- 验收：隔离 Mock Electron 在 1280×820/884×640、明暗代表主题中验证表单/列表/footer可达、模型切换草稿与保存/取消、渠道与手动模型、图片选择/默认互不误触、最后一个保护；实拖8方向、min/max/视口和键盘/focus；相关自检/typecheck、最终 production build/EXE、安装身份/配置保留和已安装 EXE 冒烟，随后更新上下文并普通 push。
- 接受时现场：main / `9926f7d` 干净；上轮开发 EXE 及安装证据保留为历史，不代替本轮交付。主代理统一维护文档，三个指定模型子代理分别处理共享resize、图片勾选和隔离UI验证。
- 验证结果：最终隔离UI 14场景/27截图通过；相关自检/typecheck与真实Main→公开DTO→Renderer迁移155项通过。最终EXE production build/包内122个dist及19个源码指纹核验通过，已自动原位安装并用已安装程序完成隔离冒烟，3个日常配置表面保留。制品与完整证据集中在 PROGRESS 本轮记录。
- 交付：源码与上下文提交 a2702ca71d7deecc687a7476a79da5529b5b9604 已普通推送origin/main，实际远端/本地/缓存upstream一致；本完成记录仅补文档收尾，最终分支核对见本地交付索引。CSS 281,539 B > 正式270,000 B门槛保留为独立发布边界；本轮为本地开发包，未发布Release。

## 已完成任务：打包后自动安装，并安装当前开发包（2026-10-15，completed / verified）

- 最新授权：用户要求“你可以每次都帮我自动安装好不”，在既有自动打包/上下文/推送流程中增加持续本机安装授权；本轮一并安装刚生成的无限制版 1.0.9。
- 范围：根/桌面 AGENTS、Harness 与地图维护安装交付流程；使用现有品牌安装器 `/S` 原位升级已注册安装，保留目录、用户数据和快捷方式偏好，不修改产品/安装器源码或版本，不为纯文档重打包。
- 验收：核对现有 EXE 大小/SHA-256、运行状态与注册安装位置；安装退出 0、注册版本/路径和安装后的 EXE/ASAR 与当前构建一致，配置只做不解析内容的保留核对；同步文档并正常推送，报告真实结果。
- 接受时现场：main 干净，HEAD 为 `000a5606c7107ab7c4094293600ea141fe54c8f5`；存在当前用户安装，版本 1.0.9，无 SparkAI 进程。安装目录仅记录在本地诊断，不把用户绝对路径写入入库文档。
- 边界：沿用正常安装，无诊断绕过/强制降级/清除数据/强杀；未保存内容或活动任务无法安全退出时保持现场并报告待安装。0 真实模型请求，不上传二进制或发布 Release，不把安装成功等同整套功能/升级/卸载验收。
- 安装里程碑：品牌 EXE `/S` 退出 0 / 25.526s，原目录与 1.0.9 注册保留，已安装 EXE/ASAR 与当前打包 runtime 一致；3 个已有配置表面保留（设置/项目列表核对哈希，secrets 文件只核对大小/mtime，不读取内容）。本地证据见 `.diagnostics/automatic-install-2026-10-15.json`。
- 启动验证：对已安装 EXE 运行 `scripts/release/packaged-smoke.mjs --exe=<registered installed EXE>`，报告 `ok:true`，实际工作区截图可见工具栏页码 1/4；配置/Agent Mock 完全隔离，网络检查跳过，0 真实模型请求。已复核冒烟后日常配置仍与安装前一致；不等同日常数据的全部业务、DPR 或卸载验收。
- 交付：根/桌面规则、Harness 与地图已同步持续安装授权与证据；纯文档无需重打包，规则和完成记录随本次普通提交/push 归档，最终 Git 核对见本地 `.diagnostics/automatic-install-git-sync-2026-10-15.json`。
- 下一步：本轮安装已完成；后续每次成功打包均按规则自动安装、核验、更新上下文和提交/push。

## 已完成任务：固化打包后更新上下文及自动 push，并同步当前包（2026-10-15，completed / verified）

- 最新授权：用户要求“每次打包都自动push到远程仓库并且更新上下文文档”，构成成功打包后的源码/文档提交与普通 push 的持续授权。
- 范围：根/桌面 AGENTS、Harness 决策/交付协议/授权矩阵及上下文地图同步该流程；补齐刚完成无限制版 EXE 对应的当前桌面源码、功能与验证文档提交并推送 `origin/main`。
- 验收：规则一致、Harness/差异核对通过，提交内容不含忽略的二进制、诊断或私有配置，核对远端实际提交与本地一致；分别记录包、文档和 Git 状态。
- 当前事实：53 个文件已提交为 `b45ca17fd68539130faa5a458e0e53724e99e3bc`，普通推送 `origin/main` 退出 0；随后 `ls-remote`、本地 HEAD 和缓存 upstream 三者一致，提交后的工作树干净。规则、实现、功能证据和 EXE 身份已同步；本条完成记录单独随文档收尾提交归档。
- 验证：独立只读范围/凭据审查、75 处新增本地链接、12 个包内源码哈希与 EXE 身份、Harness 10 项及最终暂存差异检查通过；新增组件的末尾空行仅作格式修正，TypeScript 输出逐字节相同，未改变产品行为。本轮没有重复打包或运行真实模型。
- 边界：保留无关工作；本轮提交现有打包输入对应的桌面改动与上下文规则，不 force push、不上传 EXE、不发布 Release、不运行真实模型或再次打包文档修改。
- 下一步：本轮交付已完成；后续每次成功打包继续执行上下文更新、对应源码/文档提交、普通 push 与远端核对。

## 已完成任务：打包最新 Windows EXE（2026-10-15，completed / verified）

- 最新授权：用户要求“现在打包程exe”，按默认无限制版执行 `corepack pnpm run package:win:unrestricted`。
- 结果与范围：将当前 main 工作树（包含字体/画布可读性、工具栏分页及既有已验证功能）构建为本地 Windows 安装 EXE；保留全部未提交工作，不改版本或业务源码。
- 验收：打包命令退出 0，核对新 EXE 的路径、大小、SHA-256 与包内当前 dist/Main/preload/接入策略，记录对应源码及已知开发 Bundle 边界。
- 边界：只生成本地开发包，不上传、不发布、不运行真实模型请求、不安装覆盖用户环境；正式 CSS 体积门禁仍按既有记录保留。
- 当前状态：`package:win:unrestricted` 退出 0，access-variant selftest 与 production build（1681 modules / 23.76s）通过，NSIS/品牌安装包生成成功；默认无限制版 1.0.9 已更新。
- 制品：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，109,839,872 B，SHA-256 `aed98423e66d921be0bcb45d5085d8f7a475bda8ad3d3d7cb49f5033412dd3d2`。
- 核验：[制品审计](.diagnostics/canvas-toolbar-exe-audit.json) `ok:true`：ASAR 的 121 个 dist 文件集/逐文件哈希与当前构建一致，8 个 Main/preload/Agent/access owner 与当前源码一致，包含分页编译标记，接入策略为 dual-access；未打入 `.env` 或诊断目录。未执行安装/启动测试，未发布，真实模型请求为 0。
- 下一步：本轮本地 EXE 已交付，后续按新需求继续；正式发布仍需 CSS 门禁及同次候选验证。

## 已完成任务：固化每次功能修改必须打包 EXE（2026-10-15，completed / verified）

- 最新授权：用户要求“把每次功能修改都要打包为exe写进agents.md里面”。
- 结果与范围：根/桌面 `AGENTS.md` 明确每轮功能新增、修改、修复及 UI/交互调整交付前都生成最终源码对应的本地 Windows EXE；默认无限制版，用户指定变体时按指定执行，报告路径/大小/SHA-256，无需每轮重新询问本地打包授权。
- 同步：替换决策记录中旧的“仅单次要求才编译 EXE”偏好；保留正式发布的独立授权和门禁。纯文档修改、仅规划及只读诊断不触发打包。
- 验收与边界：本轮只更新规则与任务记录，检查 Harness 结构、链接和差异；不改产品源码、不运行产品构建或生成 EXE。
- 验证：根 `node scripts/verify-harness.mjs` 通过 10 项结构检查；根→桌面规则链接、打包命令存在性和 `git diff --check` 通过。既有未提交产品改动保留。
- 下一步：本轮规则更新已完成；以后功能交付执行新增的本地 EXE 打包要求。

## 已完成任务：画布工具栏改为分页（2026-10-15，completed / verified）

- 最新授权：用户要求“把画布的工具栏改为翻页的逻辑，而不是滚轮”。
- 结果与范围：底部画布工具栏用上一页、下一页和页码浏览工具，按实际可用宽度容纳完整按钮；保留原工具命令、禁用条件、快捷键、固定/悬停展开与 Escape 行为。分页只属于 Renderer 临时展示状态。
- 验收：真实隔离 Mock Electron 检查 1280×820 与 884×640 下的逐页可达性、边界禁用、按钮裁切、滚轮不切页/不缩放画布、键盘翻页、resize 和原工具入口；相关 selftest、typecheck、quick GUI 与 production build。
- 边界：保留 main 分支全部既有未提交工作；不调用真实模型、不改 IPC/CLI/持久化、不打包 EXE、不提交或发布。
- 当前状态：`CanvasToolbarPages` 按实测按钮宽度分页并提供页码/首末禁用，resize 保留浏览锚点；移除横向滚动与旧窄屏 max-width 规则。工具栏隔离画布抢焦点/全局 Enter 与空格，Escape 收起后焦点返回入口。
- 验证：真实 Electron 双尺寸通过全部 17 工具遍历（1280：4 页；884：17 页）、首末边界、无裁切、滚轮隔离和末页 resize，原报告 44 项通过但整体仍保留 `ok:false` 的 Enter 失败；最终修正后补充专项 `ok:true` / 19 checks / 5 截图，覆盖 Enter/Space、悬停连续翻页/焦点、Escape、固定与安全工具入口。最终 quick GUI 6 scenes、typecheck、`test:workspace-glass-ui` 164 cases、`test:plugin-system` 115 cases、production build（1681 modules / 26.54s）通过。证据见 [.diagnostics/canvas-toolbar-pagination-delivery.json](.diagnostics/canvas-toolbar-pagination-delivery.json)。
- 交付边界：本地源码与 dist 已更新；真实模型请求为 0，未打包 EXE 或发布。Bundle 仍唯一硬失败于既有 CSS 门禁：279,001 B > 270,000 B。
- 最后核对：19 处当前任务文档本地链接、5 个最终源码哈希与 `git diff --check` 均通过。
- 下一步：本轮本地实现已完成，后续按新需求继续；正式发布仍需 CSS 体积处理和同次候选验证。

## 已完成任务：执行文字清晰度与画布 UI 改进计划（2026-10-14 接受，2026-10-15 completed / verified）

- 最新授权：用户明确“按照计划进行执行”，执行 [已交付计划](docs/CANVAS_READABILITY_PLAN_2026-10-14.md)。此前仅规划任务已完成，本轮新授权本地实现与验证。
- 结果：统一主/独立 Agent 字体与可读字号，改善主题文字对比和玻璃文字表面；画布导航分组、100% 还原、节点信息层级和浮动操作条边界可用。
- 范围：桌面字体/主题/画布 owner；保留 main 分支既有渠道、画布与 resize 未提交工作。已保存本轮改动前的 15 个相关文件基线。
- 验收：真实隔离 Mock Electron 截图与状态检查覆盖主题、分数缩放、四边工具条及 884×640；运行相关 selftest、typecheck、quick GUI、canvas clarity 与 production build。
- 边界：复用现有画布、选择、视口与动作；不改模型/远端协议，不调用真实模型、不打包 EXE、不提交/推送/发布。
- 当前状态：字体/字号、主题文字投影与稳定阅读面、导航/插件分行、100% 还原、固定标题及工具条实际边界/底部避让已完成；独立 Agent 字体/底色同步，背景 inline 与 Glass 级联覆盖已修正。完整九主题 132 checks / 63 截图、最终 125% DPR 127/41、最终 150% DPR 强反差背景 127/41、最小窗口长标题/需求补充 27/12 均通过；可见文字合成背景采样最低 4.99:1，操作条全局坐标对齐设备像素。相关 selftest/typecheck、最终 quick GUI 6 results、canvas clarity 5 results 和 production build（退出 0 / 1680 modules / 23.90s）通过。
- 验证边界：DPR 使用隔离 Electron 参数模拟，未验证实际多显示器切换；真实模型请求为 0。最新 `test:bundle` 唯一硬失败为 CSS 278,748 B > 270,000 B，正式发布门禁仍不满足；本轮重建 dist，旧 EXE 不包含本轮优化。
- 最后核对：补齐原局部取整遗漏的画布原点后，125%/150% 实际操作条 x/y 乘 DPR 接近整数、四边和小窗口边界通过；最后 production build 退出 0。实际报告见 PROGRESS 顶部。
- 下一步：本轮本地优化已完成。后续从新需求继续；正式发布前需处理 CSS 体积门禁并完成同次候选验证。

## 已完成任务：文字清晰度与画布 UI 改进计划（2026-10-14，仅规划，已完成）

- 最新用户澄清：“我是让你给计划就好了”。此前将规划误读为实施的任务契约已 superseded；本轮只交付计划。
- 模式 / 结果：根据当前源码、上下文和 basketikun/infinite-canvas 参考，列出字体清晰度、对比度和画布 UI 的具体改进建议、优先级与未来验收办法。
- 范围：[详细计划](docs/CANVAS_READABILITY_PLAN_2026-10-14.md) 与任务状态记录；保留原有渠道、画布工具和弹窗 resize 未提交工作。
- 验收：计划区分已观察问题、待验证原因与拟实施项；撤回本轮越过范围的产品改动，仅核对差异与文档，不继续实现或构建。
- 当前状态：计划已整理；误实施的产品改动已选择性撤回，本轮隔离预览已关闭，原有 dirty worktree 和两个画布组件保留。已有实验测试不作为当前产品的优化证据。
- 核对证据：5 个本轮开始时无改动的文件与 HEAD 内容一致；画布 CSS 恢复此前 286 行新增、0 行删除的差异；14 处相关本地文档链接与 `git diff --check` 通过。
- 下一步：本轮规划任务结束；未来实现需用户另行提出，不能从旧 Goal 自动续做。

## 已完成任务：新会话开发上下文同步（2026-10-13，verified）

- 结果：从根目录或桌面目录开始的新会话都能定位最新软件实现、验证证据、开发 EXE 和下一步，避免沿用过期发布准备或旧任务状态。
- 范围：根/桌面 `AGENTS.md`、两层上下文地图、Harness 读取协议与决策、现有 `GOAL.md`/`PROGRESS.md`；动态软件状态集中放在 [PROGRESS.md](PROGRESS.md) 顶部的“当前开发状态”。
- 验收：入口明确必读顺序；当前快照与现有源码/报告及 EXE 大小、SHA-256 一致；区分 2026-10-10 正式发布和 2026-10-13 本地开发包；Harness、文档链接与 `git diff --check` 通过。
- 证据：`node scripts/verify-harness.mjs` 10 项结构检查通过；9 份相关文档的本地链接和快照元数据核对通过，当前 preload 源码 147 个 invoke 与地图一致；`git diff --check` 退出 0。既有应用验证与未通过门禁完整保留在进度中。
- 边界：本次只同步开发文档；不改变软件行为、重建制品、重复 GUI/付费模型测试或发布；保留渠道、画布和弹窗的既有未提交实现。
- 下一步：本次文档同步已完成；后续软件开发按最新用户请求或明确选定的未验证项继续，并在新任务开始时刷新顶部状态。

以下任务块保留各日期的原始方向与验收过程；历史“当前任务”标题不代表仍在执行。最新软件状态和制品元数据以进度顶部快照及其对应证据为入口，事实仍需与当前源码和制品核对。

## 已完成任务：所有相关配置与编辑弹窗可调尺寸（2026-10-13，verified）

- 结果：模型配置、Agent 提示词/记忆、图片配置、手动图片/视频、素材选择、需求/成果编辑及插件配置/导出等内容型弹窗统一支持右下角拖拽调整宽高，尺寸受到视口边界和各表面最小可用尺寸约束。
- 范围：`src/ui/dialog-shell.tsx` 与对应样式 owner；复用现有 focus、close policy、草稿和滚动链，不改变 Main/IPC/模型请求或项目持久化。
- 范围变更：最初仅调整模型 picker 的方案被用户“所有相关弹窗”扩展取代；设置/账户侧栏通过左边缘调整宽度，短确认/未保存提示仍使用内容尺寸，浮窗定位保持当前 owner。
- 验收：实际鼠标拖动后尺寸改变，扩大/缩小后的内容可访问、关闭/保存按钮可见，884×640 小窗口不溢出；覆盖共享路径与不同布局的代表弹窗，只运行直接相关专项、typecheck 和 production build；随后按现有 EXE 授权生成本地开发包。
- 授权：本地实现、隔离 Mock UI 与 Windows 开发 EXE；0 新真实图片/视频/Seedance 请求，不提交/推送/发布，不回显真实密钥，`.env` 仅用于本机打包隔离核验。
- 完成证据：隔离 resize 探针 `.diagnostics/electron/dialog-resize-ui-2026-10-13T03-48-28-078Z/report.json` 为 `ok:true` / 9 个代表表面 / 23 张截图；7 个内容表面实际拉大/缩小与 884×640 边界通过，设置/账户左边缘、方向键/Home 和最小宽度布局通过。包内模型、导出及双抽屉的已完成 checks 见 `release/dialog-resize-ui-2026-10-13T04-23-25-804Z/report.json`（该运行在后续查看器探针入口超时，整套未记通过）；查看器专项 `04-28-05-365Z` 和最终成果编辑器专项 `04-32-32-769Z` 均为 `ok:true`，后者验证收缩后提示词可完整访问、header 移动不撑大、最大化/还原保留尺寸。上述包内报告均位于 `.diagnostics/release/`。
- 构建/制品：`test:ui-foundation`、`typecheck`、production build（1680 modules，最终打包 build 22.09s）和差异检查通过；`package:win:unrestricted` 退出 0。最新 `release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe` 为 109,836,288 B，SHA-256 `a4c78c35fc328ce72e437c176fa7840ad9d69966fb54d8347a2bd1f2ff46b8e4`；121 个 dist 文件与 4 个 Main/preload owner 和 ASAR 字节一致，`.env`/两组测试 Key 不在包内，见 `.diagnostics/dialog-resize-artifact-audit.json`。
- 边界：这是未发布的本地开发包，未验证真实安装/卸载或逐个插件业务流程；`test:bundle` 的 CSS 277,505 B 超过正式 270,000 B 门槛，按开发打包规则记录，未为此扩大重构。此前 Agent Text UI 的无关放弃后焦点断言未在本轮修复或整套复跑。

## 已完成任务：参考 Infinite Canvas 优化渠道模型、UI 和画布交互（2026-10-11，verified）

- 状态：verified；渠道模型发现、配置 UI、画布导航和局部交互均已按用户追加要求落地，适合现有单画布/项目 Agent 产品结构的优化已完成。
- 当前优先级：固定参考提交 `3a6b64b602ad062b29fac66902ed18a7ef5fd9dc` 已完成对照；导航、选择、工具栏和模型 UI 的适用优化已接到现有 owner，没有复制参考项目的节点体系或第二套画布状态。
- 范围：`src/model-config-dialog.tsx` 的渠道入口与批量模型选择、`src/main.tsx`/preload/IPC 的只读探测桥、既有 Main 模型目录聚合/缓存链路，以及画布导航与局部 UI/交互 owner。
- 非目标：不新增服务端管理后台，不复制渠道/账户管理，不发送视频或 Seedance 请求，不上传或打印凭据；本轮真实图片验证仅限用户授权的每个测试渠道一次 `n=1`；手动补充模型仍作为渠道目录缺失时的兼容入口。
- 验收：打开图片/对话模型配置弹窗会自动使用缓存或触发 Main 读取已配置渠道目录；独立渠道输入后可从 `/v1/models` 得到可勾选模型并把连接绑定到所选模型；显式刷新绕过旧缓存；已有模型和逐模型连接仍保留；画布提供可拖动小地图、选中对象快捷操作、节点悬停快捷操作，动作复用现有归组/解散/删除/查看/编辑/导出/重试 owner，且不引入第二套画布状态；新增画布交互须有真实可见状态和截图证据，保留项目、选择与运行状态；只运行相关专项、typecheck 和 production build。
- 授权边界：用户提供两组可撤销测试凭据，并明确授权逐渠道读取 `/v1/models`、每渠道最多一次 `n=1` 图片请求；不测试视频或 Seedance。
- 证据：已完成开源画布实现调研；本地 loopback `/v1/models` UI 专项成功验证渠道读取、15 分钟缓存命中、全部模型可见筛选、模型勾选、设置保存和凭据未进入普通 JSON/密文文件；截图见 `.diagnostics/electron/model-discovery-ui-2026-10-11T07-47-56-428Z/`。真实探针 `.diagnostics/real-channel-image-2026-10-11T13-42-05-735Z/report.json` 显示 qiuqiu `HTTP 200/14`、`gpt-image-2` 图片 1 张，supeai `HTTP 200/11`、`grok-imagine-image-2.0` 图片 1 张，两个渠道 POST 均严格为 1；`.env` 被忽略且未被 Git 跟踪，报告未包含凭据标记。画布专项 `.diagnostics/electron/aidebug-2026-10-11T10-25-27-813Z/report.json` 的导航 proof 覆盖小地图、缩放、选择/平移、撤销、选中快捷栏、悬停快捷栏和“引用到 Agent”焦点转移；`smallWindowProof.ok:true` 且 `documentOverflowX:false`。`test:ipc-registration`、`test:settings-lazy-load`、`typecheck`、production build 和 `git diff --check` 通过。
- 边界：真实测试仅覆盖上述两个渠道的模型目录和各一次图片请求；未测试视频、Seedance、其他渠道或正式发布。

## 已完成任务：冻结并发布 SparkAI WorkSpace 1.0.9（2026-10-10，verified）

- 状态：verified/completed；正式制品、完整安装升级、远端 Release 和资产哈希均已由同一次编排核验，后续文档收口不改变冻结 tag 或制品。
- 范围：模型目录获取/Grok 配置保留修复、异步画布定位菜单竞态修复、正式 `release:final`、1.0.8→1.0.9 完整安装升级、Unrestricted 正式安装包和 GitHub Release。未发布 SparkAPI-only 包。
- 非目标：不调用真实生图、视频、Seedance 或付费接口；不修改外部 New API/Extension、不触碰日常安装、不提交密钥、用户数据或诊断制品。
- 授权边界：Git commit/push/tag/release 已获用户明确授权；新签名私钥仅由正式编排从本地忽略目录读取，不上传。
- 证据：`.diagnostics/release/final-release-2026-10-10T05-57-58-538Z/orchestrator-report.json` 的 `ok:true`，`release:verify` 124/124 门禁通过，production build 1678 modules，Bundle CSS 269,827 B；打包 smoke、品牌安装/卸载 smoke、1.0.8→1.0.9 完整安装升级、更新清单/签名/helper/SHA-256 均通过。
- 远端：GitHub Release [v1.0.9](https://github.com/naMeaning/SparkAI-WorkSpace/releases/tag/v1.0.9) 为 latest、非 draft、非 prerelease；5 个资产的大小和 SHA-256 与本地报告一致。冻结源码为 `33e3ba12aaeaf142e38865c8bd5b60a0bd7e14d6`，`v1.0.9^{}` 指向该提交。
- 正式 Unrestricted EXE：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，109,829,632 B，SHA-256 `e4c2c3b9b9a52403375857b2cb4f346ce2fa951ec1c8ff4e37d6b6973ac30684`。
- 下一步：保持 `v1.0.9` 指向冻结提交；后续功能从新的 Goal 开始，不重新打包本次已发布版本。

## 已完成实现：保留 Grok 配置并补齐 NewAPI/Sub2API 模型获取（2026-10-10，partially verified）

- 状态：partially verified；本地实现、隔离 Mock、读目录联调和 production build 已完成，真实 NewAPI 目录与正式安装/发布仍未验证。
- 结果：设置迁移、保存、重载和模型目录刷新都会保留 `imageModelBindings`/`imageModelConfigs` 中的 Grok 图片模型；图片/对话模型配置弹窗提供显式“获取模型”，Main 按全局连接和逐模型连接读取 NewAPI/Sub2API `/v1/models`，合并分类结果并安全缓存。
- 根因：模型池归一化和目录分类只读取 `imageModelPool`/绑定，遗漏 `imageModelConfigs`，刷新后把仅保存在配置对象中的 Grok 模型误判为未选中；缓存指纹也没有包含逐模型图片 Base URL。
- 范围：Electron 设置持久化、Main 模型目录/缓存与 IPC、图片和对话模型配置表面、必要的专项与上下文文档。保持 Extension 与外部 New API 管理后台独立。
- 非目标：不复制服务端账户/渠道/配额管理到桌面端，不删除或重命名现有供应商配置，不发起真实生图/视频/付费模型请求；联网模型目录只做只读 `/v1/models` 验证。
- 证据：`test:model-ux`、`test:settings-persistence`（127 cases）、`test:settings-lazy-load`（67 cases）、`typecheck`、Node 语法检查和 `corepack pnpm run build`（1678 modules）通过；补齐 `main.tsx` 对 `imageModelBindings`/`imageModelConfigs` 的派生依赖，并为配置弹窗“获取模型”入口增加静态断言。隔离 Mock 聚合同时得到对话与 Grok 图片目录。本轮从 CCS 的 Grokbuild Sub2API 配置只读请求返回 HTTP 200/14 个模型并包含 `grok-imagine-image-2.0`，同一 CCS 的 Codex Sub2API 配置返回 HTTP 200/27 个对话模型并包含 `gpt-6.1-sol`。未保存凭据或原始响应。
- 下一步：若要把本目标升级为完全 verified，在独立环境用实际 NewAPI `/v1/models` 做一次只读目录检查；不重复生图/视频或付费调用。

- 发布 checkpoint（2026-10-10）：首次正式编排已通过源码、打包、隔离安装/卸载、1.0.8→1.0.9 完整安装升级和清单生成，最终门禁因发布编排器残留旧 Windows 元数据断言失败；品牌安装器实际元数据为 `SparkAI WorkSpace`/`namean`，已修正门禁，待重新冻结后继续发布。

## 上一任务：推送当前源码并发布 GitHub Release（2026-10-09）

- 状态：partially verified；源码修复已推送到 `origin/main`，正式安装、tag 和 GitHub Release 仍等待干净 Windows 环境；本次模型配置任务完成后再恢复。

## 历史任务详情：推送当前源码并发布 GitHub Release（2026-10-09）

- 状态：partially verified；源码发布准备继续，正式安装环境 blocked。用户明确要求将当前改动推送远端并发布 Release，替代此前“未授权 push/发布”的边界；Windows 临时账户方案已按最新指示撤销并清理。
- 结果：当前桌面功能和相关文档提交到 origin/main；GitHub Release 对应冻结源码、真实安装包、版本说明与完整性信息。
- 范围：当前桌面 dirty worktree、工作区上下文/决策文档、Git 提交/远端、Windows 发行和 GitHub Release；保持 Extension 与外部 New API 独立。
- 验收：提交内容无凭据/配置/诊断/用户数据；远端提交一致；用户选择正式稳定版，需解决全部前置条件、同次 release:final 全部通过并核验远端 Release 资产。
- 授权：用户已授权本次 commit、push、tag 与 GitHub Release；用户确认原发布私钥丢失，明确允许更换更新签名密钥并通过完整安装包升级旧版。用户最新指示允许用此前提供的 BaseURL/API Key 与软件 Agent 配置完成一次真实 Grok 生图验证（n=1，创建结果不明不重发）；此前本次发布的 0 新生图限制 superseded。真实调用只使用隔离项目，不刷新/修改日常登录，不执行真实视频，不卸载/关闭日常应用或修改生产服务；新私钥只保存本地忽略目录，不提交或上传。
- 当前事实：远端最新 tag v1.0.8，package 为 1.0.9；GitHub CLI 已实际登录 naMeaning，SSH 可访问。新 Ed25519 密钥配对已验证，私钥只在忽略目录并受本机 ACL 保护；生产 CSS 修复后 Bundle 为 269,827 B，仍在 270,000 B 硬门禁内。正式 BrowserWindow 最小宽度 884px，压缩链保留该宽度会命中的媒体查询，只移除低于产品最小宽度的 viewport 媒体块；容器查询、窄高度和 reduced-motion 规则保留。唯一审查的 P1 已修复并通过结果失败专项；旧正式证据不代表本轮同次完整发布。
- 本轮新增证据：一次隔离真实 Grok 请求已返回有效 JPEG，Main 保留供应商原字节；未使用 Windows 测试账户、未刷新日常登录。当前 Unrestricted 候选 EXE 已生成：109,828,608 B，SHA-256 `00f0615c1d365b5a521d0615645166d167e6cbeecc17943244ca4b0a87c8f3ac`。正式安装/升级仍未验证。
- 更新边界：新完整安装包内嵌新公钥；minimum_version 将提高到本次版本，旧客户端须手动下载并安装完整 EXE，不承诺其使用旧公钥接受新清单或 Restart ASAR。保留应用/项目身份、受管数据及现有生图能力。
- 审查结论与授权：唯一只读审查完成，发现遮罩兼容请求已返回图片后，本地合成失败仍可能被重试的 P1；用户明确选择“修复后再发布”。先在图片 service 的结果处理边界补齐禁止重复生图标志，使用 Mock 验证，不执行真实付费请求。
- 隔离授权更新（2026-10-09）：用户澄清“测试用户”指软件内测试账户，明确要求删除 SparkRel Windows 临时用户；此前系统账户方案 superseded。清理已实际核验：账户、Profile、用户目录均无 SparkRel 残留，私钥临时 ACL 已撤销，cleanup.json 全部清理项 true、failure 为空；后续不创建 Windows 用户。使用软件内隔离 Mock；正式安装验证如受环境限制，必须如实记录，不能触碰日常安装来替代。
- 当前打包验证：`packaged-smoke` 默认隔离冒烟通过；针对当前 EXE 的 884×640 顶栏、主题入口、素材选择与既有 JPEG 导入/回读冒烟通过，报告为 `.diagnostics/release/packaged-smoke-2026-10-09T15-40-52-622Z/report.json`，`realProviderRequests=0`。旧诊断脚本仅放宽了 1px 的窗口边界舍入，不改产品代码。
- 当前提交：`7a9e6ae` 已推送 `origin/main`，本地与远端分支一致。正式安装/升级、同次 `release:final`、tag 与 GitHub Release 仍以干净 Windows 环境和正式报告为前置，当前不宣称稳定版已发布。真实 Grok 不再重复，不创建 Windows 用户或触碰日常安装；发布私钥仅留本地。
- 首次正式验证 checkpoint：第 10 项旧 context 测试错误地要求普通材料 Prompt 暴露 bindingId；按现有 assetId/materialCount 合同修正测试后重新冻结，Runtime 不变。前 9 项的报告可按发布清单的窄 allowlist 安全续跑，后续所有门禁和所有制品必须在新编排中实际完成。
- 当前 checkpoint：第二次编排通过前 45 项，修正 UI foundation 报告的素材序号 token/Field owner 问题；本次改变产品 Renderer/CSS，前述窄续跑方向 superseded，验证后从头运行完整正式编排。
- 当前 checkpoint：从头编排已通过前 54 项，第 55 项仍要求所有图片生成使用旧 Responses→Images SSE 路径；按已有生产 Provider service 与可选预览回调修正检查，保留真实分槽/替换/清理与底层 SSE transport 验证。产品代码和请求参数不变；此次可用窄 allowlist 从该项续跑。
- 当前 checkpoint：第 65 项发现真实镜像合同缺陷，Renderer 哈希已使用 canonical materials，Runtime 仍使用旧 sourceAssets/referenceAssets。统一 Runtime 哈希到既有 Renderer 材料表示，保留 Goal 字段、冻结源投影与漂移校验；因改变产品 Runtime，窄续跑 superseded，专项/build 后从头验证。
- 当前 checkpoint：67dd980 从头验证前 96 项通过；第 97 项 Agent 文本 UI 的初始账户未选择 Token/分组，但 Mock 账户目录固定选择 token 1/default，元数据因此改变草稿并进入未保存设置确认。隔离夹具改为匹配该 Mock 账户，保留 Escape、焦点和可视保护断言，产品代码不变；独立专项 155 checks/23 screenshots 与 build 已通过，只改变该测试及 Goal/Progress，可从该门禁按窄 allowlist 续跑。会话级持续 Goal 已实际创建并 active。
- 当前 checkpoint：8eb7f53 续跑后正式前 98 项通过；第 99 项素材 GUI 的配置已落盘，但重载后原坐标点击未切到模型页。测试原生点击前要求目标几何稳定，再检查命中/裁切并明确等待模型页激活；产品代码不变，专项通过后只允许该测试及 Goal/Progress 的窄续跑。
- 当前 checkpoint：58c0c1c 正式前 101 项通过，登录专项的设置接入策略检查仍读取已被 GlassSelect 取代的原生 select。改为展开当前接入控件，核验可见启用的 account/custom 选项，专用版仍要求无自定义控件且官方地址只读；真实退出/刷新/清理/登录断言保持。只改变 GUI 测试及 Goal/Progress，专项/build 后按窄 allowlist 续跑。
- 当前 checkpoint：4af35ea 正式前 102 项通过。询问确认的比例检查仍依赖已移入配置弹窗的按钮；Mock 后台只读取旧 SOURCE Prompt，无法模拟普通材料的逐图要求。专项读 canonical 配置，Mock 只在明确逐图意图时从最新材料段派发独立请求，保留 Goal SOURCE 解析。专项、相关 Mock 合同与 build 后重新完整验证，避免发布源码与旧证据失配。
- 最新诊断：Mock 必须读取 Responses 历史中的原确认任务；修正后两条 image_gen 均已返回，但第二条被 Runtime 的“全局首素材”回退误拒绝（parentId=M、却取 L1）。修正真实来源解析，显式 parentId 优先选取该节点的冻结素材；保留范围/槽位检查，补 Runtime 回归并复跑 AskUser，0 真实请求。
- 当前验证诊断（2026-10-09）：正式源码门禁第 52 项 `image collection export` 首次续跑因 Windows 临时目录的 8.3 用户路径与完整用户路径直接比较而失败；修正 selftest 使用 `realpathSync.native` 规范化已存在目录，生产导出逻辑不变。专项已通过，需在新冻结提交上从该门禁续跑。
- 当前验证诊断（2026-10-09）：正式源码门禁的 `image import` 在本机 Windows 临时目录使用 `Windows 8.3 临时路径` 短路径时，将合法 8.3 路径误判为符号链接并阻断导入。修正 worker 的逐级 `lstat` 链接检查与主进程结果目录比较：只以 `lstat` 发现的实际链接/联接拒绝路径，规范化比较接受普通短路径；`test:image-import` 已通过（506 入口、502 唯一资产、来源/输出联接拒绝、16 次并发导入、超时/关闭清理）。该产品代码变化会使正式门禁从头重新验证，Release 仍未发布。

## 当前任务：图片配置入口与斜杠命令（2026-10-08）

- 状态：complete（2026-10-08）；图片配置、共享斜杠命令及两种更新开发 EXE 已完成本地验收，保留此前已验证的生图、素材与对话修复。
- 结果：Agent 输入区只保留素材和图片配置；模型、比例、清晰度、数量与质量通过同一配置弹窗修改；输入 `/` 提供候选和键盘选择，`/goal 要求` 复用原批量 Goal 确认，另支持 /config、/help、/new、/pause、/resume、/stop。
- 范围：主 Composer、独立 Agent 表面、主 Renderer 设置 owner、独立窗命令合同、CLI/MCP 对应动作说明与相关验证；不重建生图工作台，不更改 Adapter、凭据或外部服务。
- 验收：配置修改持久化及 reload；斜杠/普通文本/未知命令/缺参/运行中命令；Goal 预览取消与冻结范围；主和独立窗口可见交互及小窗口截图；专项、quick GUI、build、两种开发 EXE 实际程序冒烟。
- 授权：本地改造、隔离 Mock 与延续用户的开发 EXE 交付；0 新真实模型、图片、视频或账户请求，不重复上一轮已执行的 Grok 授权，不推送、部署或正式发布。
- 完成证据：源码专项、quick GUI、Goal 四场景及配置保存/reload 通过；两种开发 EXE 的实际程序 GUI 各 9 checks/10 screenshots/0 真实模型请求，884×640 视口配置弹窗可见且无横向溢出。每包 129 文件与源码/dist 一致，策略、MZ、大小、SHA-256/NotSigned 独立复核通过；汇总 .diagnostics/release/composer-command-delivery-2026-10-08.json 替代同名旧 EXE 元数据。
- 交付与边界：两种 1.0.9 x64 EXE 均为 109,827,584 B，用户自定义中转使用 Unrestricted。本轮未重复真实生成、安装/卸载或签名；运行中 /pause→/resume→/stop 完整 slash 往返未专项端到端演练，共享状态约束与原 owner 合同已验证。正式 Bundle 仍因 CSS 288,546 > 270,000 B 失败，按仓库规则交付开发包，未正式发布。
- 下一步：本轮目标完成，从新的用户要求继续；不自动重复已执行的真实 Grok 授权或扩大正式发布。
- 用户追加方向：参考 DeepSeek harness、Codex、Claude Code 的命令发现、集中配置和可恢复任务交互；在本轮界面边界内增加 /status 本地状态查询，保留显式 Goal/停止确认与单一 Runtime，不扩展供应商或重建 harness。

## 当前任务：成图后的对话 502 恢复与成果交付（2026-10-08）

- 状态：complete（2026-10-08）；10 个精确 runtime 场景、主/独立窗口及日志 GUI、实际 EXE 使用本地真实用户登录的 Grok → 读图 → 回复和两种开发 EXE 均已验证。
- 结果：生成成功后对话服务故障不得丢失已有成果或误报生图失败；按真实完成步骤提示尚未完成的视觉质检/最终回复，保留正常错误、取消与修改需求语义。
- 范围：既有 Agent 模型调用、runtime 回执/协议保存、Main IPC 与主/独立窗口状态；复用图片服务与 Adapter，不重建生图流程，不改外部 New API。
- 验收：Mock 精确覆盖 image_gen → view_image → 502、持续故障、首轮故障、工具失败/部分失败、取消/steer；已有成果和协议保留，恢复只重试当前对话请求，图片工具不重放；Electron 可见场景/截图、相关专项、build 与两种开发 EXE 的实际程序冒烟。
- 授权：本地实现、隔离 Mock 与沿用用户要求的 EXE 交付；本轮 0 新真实图片/视频/对话请求，不刷新账户、不更改凭据、不 push/部署/正式发布。延后的真实账户复验仍 deferred。
- 授权更新（用户 2026-10-08 新指示）：允许使用现有本地登录会话验证本故障；限定为已有成图的后续对话/读图验证，0 新图片/视频请求，不把旧会话复制到报告、不记录或公开凭据。上述 0 对话请求限制由此 superseded；其他真实供应商与账号管理范围不恢复。
- 最新范围/授权（2026-10-08）：用户明确要求在软件中真实生图并添加日志功能。允许使用当前本地登录会话执行一次 n=1 Grok 生图和同一主模型的读图/最终回复，创建不明或结果处理失败不重发图片请求；添加本地脱敏诊断日志查看/导出，记录真实调用阶段、协议、模型、状态码、数量及耗时。此前 0 新生图限制 superseded；不记录凭据、Prompt/图片 Base64、原始上游响应、签名 URL 或私有绝对路径，不修改外部服务或正式发布。
- 当前事实：Main 保留无流输出时的一次对话重试；Chat 图片内容协议已修正，成图后的模型故障返回已有 actions/toolResults 和 partial 并保存协议，主/独立窗口准确区分成果与后续未完成。设置→工具可查看/导出最近 300 条脱敏日志。
- 完成证据：实际 EXE /me 校验现有真实账户，唯一一次 n=1 Grok 返回 JPEG 1024×1024/171,985 B，view_image 完成，三轮 gpt-6.1-sol 均 HTTP 200、0 重生。报告 .diagnostics/electron/grok-software-live-2026-10-08T06-12-35-404Z/report.json；两包实际程序的 partial/日志 GUI、production build、MZ/SHA-256/NotSigned 核验完成，汇总 .diagnostics/release/post-image-delivery-2026-10-08.json。
- 交付与边界：两种 1.0.9 x64 开发 EXE 和真实图片副本 release/Grok-Login-Verified-2026-10-08.jpg；其他真实供应商/编辑、实际安装卸载、签名和正式发布未验证。正式 Bundle 仍因既有 CSS 超限失败，不属于本次开发 EXE 验收。
- 下一步：本次目标完成；从新的用户要求继续，不自动重复真实生成或扩展正式发布。
- 用户澄清：真实验证必须使用本地桌面软件的真实登录状态；采用实际打包 EXE、原始用户数据目录和受管凭据，所有 Mock 开关关闭，0 复制登录到隔离配置。源码窗口此前尝试发送未进入模型/图片请求链路，0 实际创建；下一次仅执行原授权的一张图。

## 当前任务：保留供应商原格式，真实生成哆啦A梦并更新 EXE（2026-10-08）

- 状态：complete；用户最新要求已实现，一张真实哆啦A梦及两种修订开发 EXE 已验证（2026-10-08）。
- 结果：在既有统一生图链路直接保存、展示供应商返回的 PNG/JPEG/WebP，以实际字节确定扩展名、MIME、尺寸和 outputFormat，不因默认请求 PNG 拒绝有效的其他格式。
- 范围：Main 受管落盘、移除仅服务转码的 Adapter/上下文字段、受影响专项与现有打包冒烟；保留已有生图页面、配置、素材功能和其他未提交工作。不重建工作台、不扩大重构。
- 验收：各 Adapter 下原始字节完全保留、正确 MIME/扩展名/尺寸、无效图片与下载失败不可重生成；用 grok-imagine-image-2.0 经用户指定中转实际生成一张哆啦A梦，核对原图与受管结果哈希；build、两种开发 EXE、各包真实图片显示与素材操作冒烟。
- 授权：最新用户请求明确授权本次一张哆啦A梦的真实 Grok 请求（n=1、0 自动创建重试）及本地修订/EXE 交付。密钥仅在测试进程内存使用，不写源码/配置/报告；不读写日常账户/项目、不刷新登录、不修改外部 New API、不推送/部署/正式发布。真实账户复验继续 deferred。
- 当前事实：Main 与 Agent 旧 direct fallback 已保存真实格式；三 Adapter × 三格式原字节专项、下载/无效图片保护和 Agent 禁重生通过。本次唯一真实请求 HTTP 200，JPEG 1024×1024/172,830 B，原图与 Main 文件逐字节相同，已查看哆啦A梦内容。在线证据 .diagnostics/electron/grok-live-2026-10-08T04-59-15-321Z/report.json，交付原图 release/Grok-Doraemon-2026-10-08.jpg；初次显式 build 已通过。
- 完成证据：最终 Agent/view_image 专项、两次 production build/NSIS 与两个实际程序使用本次 JPEG 的冒烟通过（各 16 截图、0 新模型请求）；每包 6 个图片链文件匹配当前源码，保存与导入字节一致，MZ/大小/SHA-256/NotSigned 独立复核。权威汇总 .diagnostics/release/grok-doraemon-delivery-2026-10-08.json；该记录替代同名旧 EXE 元数据。
- 交付：release/Grok-Doraemon-2026-10-08.jpg；两种 1.0.9 x64 EXE 均为 109,817,856 B，Unrestricted SHA-256 de94e93aea74ed0d725976db6959ff6e0f27a1bdc95041fc85db64e7872a7d01，SparkAPI SHA-256 6d739478e6e2892000f7349540c3f73ca24eb6a5fe67287f842191c12fa2e970。用户自定义中转使用 Unrestricted。
- 后续：本次目标完成；从新的用户请求继续，其他真实供应商/Grok 编辑、延后的真实账户、实际安装卸载/签名/正式发布仍未验证，不自动恢复这些范围。

## 当前任务：真实 Grok 中转复验与修订交付（2026-10-07）

- 状态：complete（2026-10-08，真实 Grok 文生图与两种修订开发 EXE 已验证）。用户反馈上一修订仍失败，并明确提供 https://supeai.top 的测试凭据、授权真实生图；本任务替代上一诊断任务的“0 新真实模型请求”限制。旧本地证据保留为历史，不能作为真实服务可用性证明。
- 结果：查实 grok-imagine-image-2.0 已消费但客户端失败的原因，沿现有 service → Adapter → transport → Main 受管图片链修复，取得真实可解码图片并交付修订 EXE。
- 范围：既有生图后端、返回归一化/下载/落盘及必要专项；保留既有前端、素材功能、其他 Adapter 和未提交工作。
- 验收：隔离真实请求（单次 n=1、无自动创建重试），脱敏响应结构证据、真实图片解码/尺寸/哈希与 Main 落盘验证；受影响专项、build、修订 Windows EXE 和实际程序冒烟。
- 授权：本次 Grok 真实测试及其图片读取、本地实现/打包已获用户授权；创建状态不明不重发，已有结果优先继续下载。密钥只在测试进程内存中使用，不写文件/日志/报告；不读写真实账户、项目或设置，不刷新登录、不推送/部署/正式发布。真实账户复验仍 deferred。
- 真实复现：首个授权请求 HTTP 200、19,365 ms，返回有效 JPEG Base64；现有 Main 按默认 PNG 校验，失败为 NAIMAGE_IMAGE_OUTPUT_FORMAT_MISMATCH。首个探针未保存图片字节，脱敏结构和失败证据已保存；格式问题修复后再发起一张明确验证请求，分别记录次数，不把该次生成称为下载重试。
- 历史实现（superseded，2026-10-08）：Adapter.outputFormatControl 与 Main 本地转换曾按请求编码交付；用户现要求直接保存真实格式。保留已返回图片的处理失败禁止再次生成。
- 完成证据：真实第二请求 HTTP 200、21,984 ms；受管 PNG 1024×1024/803,210 B，解码像素与供应商 JPEG 完全相同。相关 Adapter/service/Main/Agent/IPC/格式/view_image/mask 专项和显式 build 通过；两种 NSIS 开发 EXE 各自实际程序使用该真图的完整冒烟通过（各 17 截图），每包 6 个图片链文件匹配当前源码。两 EXE 为 109,818,368 B、MZ、NotSigned，当前权威哈希/证据汇总 .diagnostics/release/grok-live-delivery-2026-10-08.json，替代同名旧制品记录。
- 交付：release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe（用户自定义中转使用此版）、release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe，以及 release/Grok-Real-Image-2026-10-08.png。
- 后续边界：本任务完成；Grok 编辑/参考图、其他真实供应商/渠道、deferred 真实账户、完整安装/卸载、签名及正式发布仍未由本轮验证，不在本次授权目标中恢复。

## 当前任务：Grok 已消费但 AggregateError 的诊断与局部修复（2026-10-07）

- 状态：complete（本地诊断、修复与修订开发 EXE 已验证）；用户反馈交付版 Grok 失败且中转已有图片消费，继续原供应商适配的可用性目标。真实中转是否遵守 Base64 仍未在线复验。
- 结果：区分上游生成与结果下载失败；Grok 默认请求内联图片，结果下载失败不能建议再次付费生成。
- 故障诊断证据：实际安装版日志在 14:14:29、14:16:38（Asia/Shanghai）记录 Grok generations HTTP 200、xai-images/newapi 各识别 1 张图片；项目会话随后只有 AggregateError，没有记录底层网络原因。当时 xAI Adapter 没有默认 response_format，Main 使用直连公网下载并把下载异常交给 Agent，后者重建 Error 时丢失属性；本轮已修复该链。
- 范围：既有 xAI 请求格式、Main 结果落盘错误、Agent 错误传播与对应专项；保留其他 Adapter、素材及已有未提交改动。
- 验收：离线复现原 AggregateError；验证默认 Base64 与显式 URL、嵌套网络错误脱敏、已生成结果下载失败的不可重生成标记、实际 Agent 工具回执；build 与本地修订 EXE。
- 授权：延续已授权的本地适配与 EXE 交付；0 新真实模型请求，不修改真实配置/项目，不推送/部署/正式发布。
- 证据：离线 before.json、实际 Electron service→Main 解码/落盘报告 `image-result-download-2026-10-07T06-32-13-822Z`、Agent 改 quality 再生成被阻止与多 items 分类专项、mask/public-http/IPC/view_image、build 全通过。两种 1.0.9 修订 EXE 已生成，各自实际程序 smoke 与 5 个包内修订文件比对通过；MZ/大小/SHA-256/NotSigned 独立复核。当前权威汇总 `.diagnostics/release/grok-result-download-delivery-2026-10-07.json`，替代同名旧制品元数据。
- 下一步：本地修订安装包交付；真实供应商/中转、真实账户、完整安装/卸载和正式发布仍未验证。历史日志没有内层网络错误，不能宣称两次真实失败的具体连接代码已还原。

## 当前任务：交付包含画布素材与供应商适配的开发 EXE（2026-10-07）

- 状态：complete（开发 EXE 已生成并验证）；用户明确追加“要打包好 exe”，源码验收之后继续交付安装包。
- 结果：从当前工作树生成 Unrestricted 双接入版与 SparkAPI 专用版 1.0.9 Windows x64 EXE，包含本轮画布选取/右键素材和显式供应商配置。
- 范围：现有接入变体构建、Electron/NSIS/品牌安装器及实际打包程序冒烟；保留原有未提交改动。
- 验收：两次 production build、两种 EXE、各变体实际程序的启动/相关 UI 检查、安装器 UI 检查；独立复核文件头、大小、SHA-256、接入策略与签名状态，并记录报告。
- 授权：本地编译、打包和隔离验证；不调用真实模型/账户、不安装到日常目录、不推送/部署/签名或正式发布。按仓库规则使用开发打包，不强制正式 Bundle 门禁。
- 证据：两次 production build/NSIS/品牌壳退出 0；双接入实际程序报告 `.diagnostics/release/packaged-smoke-2026-10-07T05-07-43-579Z/report.json`、SparkAPI `05-12-34-021Z/report.json` 均通过，每轮 18 截图。本轮素材/供应商保存与 reload、主题/账户/独立窗口通过，0 真实 provider 请求；两个安装器 UI 报告 `branded-installer-ui-2026-10-07T05-08-46-057Z`、`05-13-17-876Z` 均通过，每轮 19 截图。已查看素材/配置及两安装器欢迎页截图。
- 制品：`release/SparkAI-WorkSpace-{Unrestricted,SparkAPI}-Setup-1.0.9-x64.exe`；MZ/大小/SHA-256/NotSigned 独立复核，两种 ASAR 中 12 文件分别匹配当时源码/dist，接入策略正确。汇总 `.diagnostics/release/image-adaptation-delivery-2026-10-07.json`。
- 后续边界：真实 provider/各中转站、deferred 真实账户、完整实际安装/卸载、签名和正式发布未验证。开发打包为 bundleEnforced=false，没有把旧 Bundle 结果说成本次正式门禁。
- 下一步：开发 EXE 交付完成；从用户新的任务继续。

## 当前 Goal：画布素材与现有生图供应商适配（2026-10-07）

- 状态：complete（本地实现与验收）。此前图片/账户 Goal 的本地交付已完成，真实账户复验继续 deferred；本节的新功能已完成源码交付。
- 结果：素材菜单的“添加原图 / 添加参考图”可从本地文件或画布图库添加；单图、图片容器成员、容器和多选图片右键可加入对应本轮列表，取消选择画布后仍保留。
- 供应商结果：原统一图片服务按显式连接配置选择 OpenAI Compatible、xAI JSON 或 Gemini generateContent Adapter；协议、渠道、传输、模型 ID、BaseURL 与 Key 保持独立，原 OpenAI Compatible 与前端成果链保留。
- 范围：桌面参考图弹窗、素材归一化、Composer/右键编排和发送 TaskScope；同步共享 CLI/MCP 命令与契约。复用 agentSourceImages/agentReferenceImages；供应商部分改造既有 Main 图片服务、Adapter/传输和逐模型连接，不另建素材 authority 或生图工作台。
- 不变量：显式添加的角色优先于自动画布选择，重复添加不重复计数；保留 occurrence/asset 身份及节点来源，容器成员按具体资产发送，不因添加或发送重复创建已有画布素材；保存/取消及既有容量限制有效。
- 验收：相关纯逻辑/automation 与供应商请求响应合同；真实隔离 Electron 中两类素材入口、右键单图/容器成员、去重、取消、容量、精确发送来源与附件断言/截图、接口配置保存与 reload；一次 quick GUI 和 corepack pnpm run build。
- 授权：本地实现与隔离 Mock 验证；不增加真实模型请求、账户写入、部署、推送、签名或正式发布。源码交付后用户明确追加本地开发 EXE，结果见上方任务。
- 任务说明：docs/TASK_CANVAS_COMPOSER_MATERIALS_2026-10-07.md。
- 当前证据：素材/容器 17 cases、设置归一化 127、automation/shared schema、Adapter/service/transport 与密钥存储专项、typecheck 均通过。Electron 素材/配置报告 `.diagnostics/electron/canvas-materials-2026-10-07T04-41-50-994Z/report.json` 为 12 checks/9 screenshots/0 真实模型请求；两次素材发送到达 Main/runtime，显式与 auto 配置保存/reload 通过。已查看小窗口图库、容量及供应商配置截图。quick GUI `.diagnostics/electron/aidebug-2026-10-07T04-43-35-350Z/report.json` 通过；生产 build 退出 0（1676 modules、22.07s）。
- 后续边界：真实供应商/各中转站联调未验证；Google 新 Interactions API 未接入。源码交付时未打包，之后已按用户追加要求生成包含本轮功能的两种开发 EXE。
- 下一步：本轮本地 Goal 已完成；从用户新的任务继续，真实供应商联调另按授权开展。
- 用户追加（2026-10-07）：核对 Grok / Gemini 官方生成与编辑接口，验收增加 provider 请求/响应专项和配置路由证据；不发起真实付费请求。最初自动路由表述已由下条明确配置优先替代。
- 供应商要求更新（2026-10-07）：上条“按模型供应商自动路由”仅作为默认/迁移策略；显式渠道 Adapter 配置优先，模型与供应商/协议不得强绑定。先完整核查页面→统一 IPC/API→服务/传输→输入/响应/落盘，告知保留点、OpenAI 耦合、Adapter 插入位置和具体文件，再小范围实现。参考 Open WebUI 抽象；保留现有 OpenAI Compatible、NewAPI/Sub2API 和全部前端成果链，不另建工作台或大规模重写。

## 当前完整 Goal：图片接口、有效 UI 与 SparkAPI 原生账户体验（2026-10-07 本地交付完成）

- 状态：complete（用户接受的本地交付范围）；用户于 2026-10-07 选择“暂时无法登录，先交付本地结果”，重新登录后的真实账户复验为 deferred 后续项。静态按钮审计与受影响 UI 验证不等于全部按钮逐个实测，开发 EXE 不等于正式发布。
- 用户目标：下载 GPT Image Playground、New API、Sub2API，核对图片修改/编辑接口并用软件已有 Base URL/API Key 测试；完善对应接口与 UI，核查全部按钮并移除无功能入口；优化登录账户的 API Key、额度管理与使用日志，依据原生 New API 接口提供 SparkAPI 站点账户体验。
- 范围：上游只读源码快照与接口映射；桌面图片适配/来源/蒙版/重试合同、相应 UI 与按钮清单；Main-only 账户凭据、原生用户密钥与额度、日志请求/过滤/分页及客户端展示。复用现有 owner，不复制外部 New API 管理后端，不修改 Extension 或线上站点。
- 验收 1：三个项目已下载并固定 commit；逐项对照生成、编辑、遮罩和异步接口；当前配置的真实图片调用有脱敏结果与受管文件证据，控制图片数和费用，不重复未知已接受请求。
- 验收 2：接口/UI/IPC/公开命令保持一致；全部产品按钮有功能归属清单，无未绑定占位按钮；受影响路径有真实 Electron 可见状态与截图，必须运行 production build。
- 验收 3：登录后的密钥选择/创建/编辑/停用/删除与额度来源、用户日志筛选/分页/刷新有 New API 原生合同和针对性测试；凭据始终留在 Main，金额遵守服务端单位，不编造价格或免费张数；实际账户接口证据与 mock 验证明确区分。
- 授权：当前完整 Goal 授权下载三个公开项目、使用现有配置进行必要且少量的真实图片接口测试和本地实现；保留“注意用量”。不发起视频/Seedance、批量生图、线上账户破坏性测试、服务部署、推送、签名或正式发布。
- 当前证据：三个上游快照 commit 与三张真实生成/普通编辑/遮罩兼容图的文件哈希已复核，遮罩外 965,601 像素全部保持。账户/日志/密钥与额度专项、typecheck、账户 GUI 7 checks/8 screenshots、quick GUI、441 按钮静态审计、两种 production build/开发 EXE 及实际程序的主题/账户/独立窗 smoke 均通过，安装器 UI 19 截图通过。生成阶段所在整轮探针报告因后续 mask 400 拒绝而 ok=false，不将其冒充整体成功。
- 持续任务 brief：`docs/TASK_NATIVE_ACCOUNT_IMAGE_2026-10-07.md`；按钮清单现覆盖 React 与独立窗共 441 项。原生账户专项已扩到 38 cases，缺失展示单位与负余额已补齐；遮罩结果改用现有公网下载 owner。
- 后续验证（deferred）：首次账户探针刷新凭据后未落盘使旧凭据失效，探针已禁止主动轮换；用户暂缓重新登录，真实只读账户复验留待后续，不重复使用失效凭据。真实密钥破坏性写入、其他服务异步路径、完整安装卸载与正式发布未验证。
- 验收补项已完成：两种实际程序的账户背景 alpha=1；Main 派生原生额度输入单位并转换，未知单位保留 raw quota；缓存编辑前取得完整 IP/模型限制。设置快照加载由 Main 校验会话，不再依赖公开 DTO 已删除的身份字段。生产缓存编辑实测 USD 10、原 IP 白名单和模型限制保持。
- 交付：`release/SparkAI-WorkSpace-{Unrestricted,SparkAPI}-Setup-1.0.9-x64.exe`；当前大小、SHA-256、签名与测试报告汇总在 `.diagnostics/release/local-delivery-01a11418-2026-10-07.json`、`PROGRESS.md` 首节。两包均 NotSigned；正式 Bundle 仍仅 CSS 291,659 > 270,000 B 失败，本轮未正式发布。
- 下一步：当前本地交付完成；用户具备有效登录后再恢复 deferred 真实只读账户复验，不重复三张图片测试，不新增视频请求。

## 当前任务：简洁主题入口可见性修复（2026-10-07）

- 类型：桌面 UI 修复与开发 EXE；状态：完成（两种生产程序的按钮已实测）。
- 验收：小窗口仍能辨认“主题”入口；从滚动过的其他设置分类进入外观页，无需再次滚动即可看见并点击“简洁白色 / 简洁黑色”；两种接入变体的实际生产程序均通过该路径。
- 边界：主题注册表、已有草稿保存/放弃逻辑、玻璃参数与画布保持；不实现此前评估中的其他功能，不调用真实模型。
- 验证：复现设置分类间滚动位置、真实 Electron 的按钮可见/裁切/命中与点击、对应专项及 GUI 快速冒烟、production build 和两种开发安装包。
- 结果：关闭生产布尔值转整数的压缩选项，修复两组主题卡片被全部过滤的根因；设置切页滚动归零，小窗口保留“主题”文字。真实生产程序的双接入 / SparkAPI 版均验证首屏黑白按钮和鼠标切换，最终 EXE 元数据见 `PROGRESS.md` 首节。
- 发布边界：两种安装包为未签名开发测试版；本轮正式 Bundle CSS 门槛仍未通过（双接入测量 289,409 > 270,000 bytes），未执行完整实际安装/卸载或正式发布。
- 沿用用户此前打包授权；不安装到用户日常目录、不签名、不正式发布。

## 当前任务：普通黑白主题与生图工作台评估（2026-10-07）

- 类型：桌面外观实现 + 只读产品评估 + 开发 EXE；状态：历史交付（后续生产按钮缺失由上方当前任务修复）。
- 验收：新增“简洁白色 / 简洁黑色”纯色主题；设置切换、首帧恢复、独立 Agent 窗口保持一致，切换保留画布和已有玻璃配置。
- 边界：沿用外观注册表与语义变量，不改远端接口或图片执行链路；评估已有生图流程，按优先级记录改进建议，不自动实现建议中的新增功能。
- 验证：外观镜像与持久化专项、真实 Electron 主题切换及冷启动、小窗口截图、生产构建、实际打包程序的黑白主题与独立 Agent 窗口、安装器 UI 均通过。使用隔离的本地素材，未发起真实模型请求。
- 交付：简洁白色 / 简洁黑色、`docs/WORKSPACE_UX_REVIEW_2026-10-07.md` 与更新的 Unrestricted 1.0.9 x64 开发 EXE；当前大小、哈希和报告见 `PROGRESS.md` 首节。
- 限制：开发安装包未签名；正式 Bundle CSS 门槛未通过（288,844 > 270,000 bytes），未执行完整实际安装/卸载或正式发布。评估中的后续功能建议尚未实现。
- 原有账号密钥、Agent 请求修复及窄屏按钮改动保留；此前 EXE 哈希是历史证据，不代表当前 `release/` 中的 Unrestricted EXE。

版本：3.0
规格来源：`docs/sparkaiworkspace.txt`

## 当前 Goal：账号密钥选用与图片工具调用（2026-10-03）

- **Outcome**：登录账号选中的密钥和逐模型指定的账户密钥都能稳定进入对话与图片请求；选择结果按账户隔离、可持久化、失效时给出可操作错误；`image_gen` 在 AIDebug 与生产图片服务分支都能完成执行并返回受管成果。
- **Scope**：`desktop/account-token-service.cjs`、`desktop/new-api-client.cjs`、`electron-main.cjs` 图片入口、设置/模型密钥选择器、相关 IPC 与专项测试。
- **Rules**：凭据只由 Electron Main/runtime 解析，Renderer 不接触完整 Key；不调用真实图片、视频或付费模型；不复制 New API 管理后台；保留全局密钥作为默认值，逐模型密钥只对对应模型生效。
- **Acceptance**：AIDebug 图片请求不再出现 `aidebugMockImage is not defined`；账号模式的对话 JSON、图片 JSON/multipart/异步请求均使用当前选用或逐模型绑定的账户 Key；停用、过期、账户切换和缺少可用密钥均有明确错误或自动选择逻辑；专项测试与 `corepack pnpm run build` 通过。
- **Authorization**：沿用当前用户已授权的本地代码修改、专项验证和开发构建；不因此授权真实模型请求、发布、签名或远端写操作。
- **Status**：complete（生产构建与账号/图片专项已通过；AIDebug 图片场景功能通过，完整 GUI 套件另有既存证据门槛未通过）。
- **Next**：如需交付安装包，再按发布流程执行打包；本 Goal 不发起真实模型请求。

## 当前 Goal：Agent 发送、设置可读性与图片网关简化（2026-09-28）

- **Outcome**：Agent 消息可从普通输入、快捷键、Goal、TaskScope 和独立窗口进入 Main IPC；设置面板在浅色和深色主题下可读；图片请求按模型和响应特征自动选择适配器，用户不需要填写协议、网关、传输模式或能力开关；当前源码可生成双接入 Windows x64 开发安装包。
- **Scope**：`src/project-agent-composer.tsx`、`src/main.tsx`、Agent preload/Main IPC、设置 Glass 表面、`runtime/image-generation` 适配与响应归一化、图片模型配置 UI、专项验证和 EXE 构建。
- **Rules**：优先实现当前用户明确提出的功能；不伪造 Agent 成功；没有项目、会话或桥接时给出可见错误；不泄露 Key/Token/Cookie；兼容旧图片字段并在内部自动派生；不调用真实图片/视频模型。验证只覆盖本次改动直接影响的专项和必要的构建检查，不机械运行无关全量测试。
- **Non-goals**：不复制 New API 管理后台，不删除 Extension 的 `/v1/image-tasks*` 合同，不恢复旧工作流，不发起 Seedance 或付费模型请求。
- **Acceptance**：隔离 Electron/专项证据覆盖发送边界、Goal 确认后实际派发、设置 computed style 和图片 mock 路由；每次功能改动完成后运行对应最小专项，交付前保留必要的 `corepack pnpm run build` 证据；仅在用户明确要求正式发布时扩大验证范围。
- **Authorization**：用户已授权在当前 `main` 分支提交未提交记录、push，并要求编译 EXE；不因此授权真实模型调用、正式发布或签名。
- **Status**：partially verified。代码边界和开发构建已验证；真实 provider、安装/卸载、签名和正式发布门禁仍未验证。
- **Evidence**：`test:agent-send-ipc`、`aidebug:goal`、`test:image-generation-adapters`、`test:image-generation-async`、`test:custom-api-transport`、`test:agent-window-ui`、`test:glass-theme`、`test:workspace-glass-ui`、`node --check`、`git diff --check` 均通过；Agent 专项已加入 stale chat 收尾等待和同步状态 ref，最新结果为 `chat=4`、`steer=2`、显式 `replace-source=1`。图片异步专项新增 Gemini `x-goog-api-key` 创建/轮询断言。`corepack pnpm run build` 最新通过并转换 1676 modules。当前源码重新执行 `package:win:variants` 通过且 `bundleEnforced:false`：Unrestricted SHA-256 `BA86020B96C12CA0632DD14D9881EC63B87B6993CE453EA9A3066210F8B1BA64`，SparkAPI SHA-256 `3E13961DE6A6E754693516049455BD0DF1DAA718F1BD1C7B9FD17FD572D3EE22`，均 109,803,520 bytes、文件头 `MZ`。
- **Next**：本轮异步图片认证头兼容修复已提交并 push；后续继续开发时先读取本节和 `PROGRESS.md`，从真实 provider 联调授权或其他未验证边界开始。若进入正式发布，再单独执行 `release:final`、安装/卸载 smoke 和签名检查；`runStatus` bridge 不可用时的跨窗口 stale 状态仍保持 fail-closed。

## 已完成目标：图片协议与逐模型连接（2026-09-26）

- **Outcome**：图片生成统一通过声明式协议/网关配置发送；每个图片模型可独立覆盖 Base URL、API Key，并正确作用于 JSON、multipart 和 async 任务请求。
- **Scope**：`runtime/image-generation` 配置解析与适配器、Electron Main 图片传输、设置持久化与 safeStorage、SparkAPI 专用版门禁、相关上下文文档。
- **Rules**：Base URL 与 API Key 独立继承；账号凭据只在 Main 解析；逐模型明文 Key 不进入普通设置、Renderer、日志或项目文件；默认生成/编辑仍分别使用官方 Images API 的 `/v1/images/generations` 与 `/v1/images/edits`。
- **Non-goals**：不发起真实图片/视频请求，不改变 Extension 的可选 `/v1/image-tasks*` 合同，不把账号或计费管理复制到桌面端。
- **Acceptance**：逻辑专项覆盖模型级 URL/Key 的独立覆盖和继承、三种图片传输路径的目标 URL/Authorization、专用版拒绝自定义连接；`corepack pnpm run build` 通过。
- **Superseded**：旧文档中“账号模式忽略逐模型 Base URL”的限制由当前用户请求取代；专用版的构建级限制仍有效。
- **Status**：实现已提交并推送到 `main`；本轮两个 Windows x64 安装包已编译并完成 SHA-256 核对。专项、安装运行和真实 provider 仍未验证。
- **Next**：后续补图片路由专项；若要发布，再按 `release:final` 完成正式发布门禁。

当前里程碑（2026-09-15）：阶段 1–13 与 8 月整备保留。当前产品已把生图默认收口到官方 Images API，画布选中即素材（可改序号与原图/参考），图片容器可一键重新生图，缩略图按内容哈希缓存，模型目录 TTL 15 分钟。当前测试安装包为 Unrestricted `F186275E90428C70A7A54950EDFDDE8E6AD06F9A3D85C64AA6A2A197D0B1B9F4` 与 SparkAPI `C374370FAE03262B632DFA194EB7BD3BEA99FB6C61E8BF86EE0E874DBA835991`（均 1.0.9，`d88fae2`）。下文 8 月哈希与 512 变体缓存数字是历史验收，不再代表当前 `release/`。新建项目必须由用户选择目录，无项目时不写全局 Session；Session、受管资产、项目级 Agent 状态与导出均受当前项目根目录约束。Agent 普通消息允许原生选中和 `Ctrl+C`。顶部 Agent 对话框选择的比例和清晰度会冻结为本次任务的权威生图规格。纯文生图默认 `POST /v1/images/generations`，编辑 `POST /v1/images/edits`；`sparkai-extension` 的 `/v1/image-tasks*` 只作可选长任务包装。全程未调用真实模型。

当前优先兼容轨道（2026-08-26）：桌面账号模式兼容原生 New API `v1.0.0-rc.23` 的 access token + HttpOnly refresh cookie + auth session 协议，同时保留旧版 `session` cookie + `New-Api-User` 回退。登录凭据只能由 Electron Main 持有并进入 Windows `safeStorage` sidecar；受保护账户请求在 access token 到期或明确 401 时至多刷新并重放一次，并发刷新必须合并。登录返回关键路径只等待 `/api/user/login`、认证 bundle 安全持久化和本地/缓存模型设置，用户资料、账户 Token/额度和模型目录在工作区打开后后台预热。账号登录不得改变模型连接优先级：逐模型自定义 API Key 继续优先于模型绑定账户 Token 和全局账户 Token，provider 请求的 Authorization 只能由解析后的模型连接生成。该轨道不访问真实 New API 或模型服务，以 `test:new-api-login` loopback 专项、相关纯逻辑回归和 production build 收口。

当前交互质量轨道（2026-08-26，已完成实现与专项验证）：修复最小支持窗口下 Agent 对话区和设置/模型配置表面的控件挤压、换行与弹层裁切；框选多个普通图片后拖入图片容器把完整选区一次性归组，不能只迁移指针命中的单图；连接头拖线、空白取消、`Escape`/`pointercancel`、具体边选中与断开采用与 Project Graph 一致的明确选择和零副作用取消语义；账户密钥与逐模型账户密钥选择器改为应用内可键盘操作的透明玻璃菜单，避免操作系统原生白色下拉破坏主题。实现复用 canonical selection、layout group 与 relation 状态，不增加第二套画布或模型配置 authority；隔离 fixture、专项与真实 Electron 最小窗口验证已通过，未调用模型。

并行治理轨道：已完成工作区 Agent Harness。它把历史对话中的稳定用户意图、任务路由、授权边界、验证分级与完成审计固化为根目录 `AGENTS.md`、`HARNESS.md`、`harness/` 及结构校验器；该轨道不覆盖阶段 10 的产品目标，也不扩大其测试范围。

当前整备轨道（2026-08-16）：大量图片卡顿治理、统一导出中心、真实模型与真实 C 盘迁移的显式授权验收工具，以及受影响 AIDebug 稳定性均已完成实现和专项验证。最终源码稳定报告 [verify-2026-08-15T22-12-37-714Z/report.json] 为 `113/113`、`sourceStable:true`；此前暴露的共享弹层焦点竞态和 AskUser 窄屏裁剪残片误报均已修复。Commerce、Glass、Graph CLI 和导出 UI AIDebug 现在都使用显式隔离项目 fixture，不依赖废弃的 AppData 默认项目；Session mutation journal 也已补上待提交事件保留回归。正式 `release:final` 仍因本机现有安装在零步骤预检退出而保留 incomplete，强制 Bundle、本地双版本候选和针对性门禁已通过，但不冒充正式发布。SparkAI Extension 生产部署、真实图片/视频模型调用、真实 AppData 迁移或清理、旧 New API/CRM 源码删除、Git tag、远端推送与 GitHub Release 均不在当前授权范围内。

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
- 窗口、启动/登录界面、帮助与政策、安装/卸载界面和 Windows 产品元数据统一显示 `SparkAI WorkSpace`。安装后的主程序为 `SparkAIWorkSpace.exe`，公开卸载器为 `SparkAIWorkSpace-uninstaller.exe`。旧版 `naimage.exe` 仅作为升级探测兼容名。App ID、协议、CLI 和用户数据目录仍沿用既有路径，避免丢失项目。
- 同一代码库通过构建期接入开关产出两个 Windows 发行版：无限制版保留 SparkAPI 账号与自定义 Base URL/API Key，SparkAPI 专用版只允许官方账号登录；公开制品分别使用 `SparkAI-WorkSpace-Unrestricted-*` 与 `SparkAI-WorkSpace-SparkAPI-*`，主程序为 `SparkAIWorkSpace.exe`；限制必须同时落在 Renderer 与 Electron Main，不能只隐藏按钮。
- 测试开发阶段以代码轻量、真实交互性能和功能可用为优先，Bundle 只记录趋势、不阻断开发 EXE；正式发布时再恢复完整 Bundle 与发布门禁。
- AIDebug 的画布修改控制面只能在 Main 已确认临时 `user-data` 与临时 config 同时隔离后暴露；仅启动 Vite、仅设置编译期开关或遗漏 `NAIMAGE_CONFIG_DIR` 都不得读取、修改或自动保存真实项目。
- 同一生成任务的同一受管落盘文件必须以 `runId + normalized managed locator` 保持幂等；不同保存窗口或归一化轮次产生的新 occurrence 不得增加资产、`outputs`、图片组槽位或容器绑定。普通导入继续以 occurrence 表达用户可见的重复选择，旧 Session 加载时只收敛可证明为同一生成文件的重复项，并保留失败/停止槽位。
- 图片组名称是持久化的项目数据：单组和多组选中的重命名必须经过 NFKC、Windows 非法字符/保留名、长度和稳定去重处理，并同步画布标题、导出目录和 Agent 查询。
- 图片组替换只能引用当前项目已受管节点与资产索引；原槽位、requestIndex、prompt、title、taskProvenance 和原图必须保留，替换关系进入独立 `collectionRole:"defects"` 节点，整批校验失败或重复执行不得产生部分写入/重复副本。
- 普通图片组批量导出必须由 Electron Main 在当前项目的 `image-groups/` 下完成；一个组对应一个由持久组名清洗得到的同名文件夹，多选一次发布多个同级文件夹，并使用 staging、备份与整批回滚、稳定槽位文件名和 `image-group.json` manifest。Renderer、Agent、CLI、MCP 均不得提交任意绝对目标路径或非本项目资产；旧 `exports/image-groups/` 仅兼容打开，不再接收新导出。
- 连接头只有形成拖动手势后才尝试建边；单击输入/输出连接头、空白松手、`Escape` 与 `pointercancel` 只取消草稿，不得隐式删除关系。目标必须真实包含指针；具体连线提供宽命中区和单边断开菜单，节点右键菜单才提供明确的全部输入/输出断开。图片容器投影线必须携带底层真实 source/target，不能用可见宿主 ID 误删关系。
- 普通 PNG/JPEG/WebP/AVIF/TIFF 另存、单图 PSD、分层 PSD 使用互不隐式调用的 IPC/UI 链路；普通导出不能改变 PSD 状态，PSD 不能改写普通导出配置或目标。
- 图片查看器保留双缓冲并以 identity/token、source/identity/target 校验和 decode 完成作为换帧条件；过期 preload/decode/DOM load 不得覆盖最新选择，真实 `data-final-asset`、`data-target-asset`、`data-displayed-asset`、`data-buffering` 状态必须可验证。
- 2026-08-11 性能审计历史基线：冷缩略图请求由 Main 侧最多 2 个 Sharp 子进程排队处理，而且每个 cache miss 都会重新 `fork()` 一个只处理单次请求的进程；10 张 4K fixture 共请求 11 个 256/512 变体，首次生成约 4.57 秒而 Renderer Long Task 为 0，同一批缓存命中约 83 毫秒。默认缓存仅保留 96 个变体，单张生成成果又可能在画布直接解码原图，因此图片规模上升时还会叠加缓存淘汰/重复生成与 Chromium 解码/GPU 压力。该条只保留为优化前基线；当前实现和新证据见下一条。
- 本轮性能整备已把冷缩略图改为最多 2 个常驻 Worker 的 `requestId` 任务池，并验证进程复用、崩溃恢复与 Main 退出清理。当前磁盘缓存按文件内容哈希 + 256/512/1024 三档复用，上限 2000 个文件 / 1 GiB；画布大图优先使用 1024 缩略图桶，最终图片查看器继续解码受管原图。8 月 15 日证据中的 512 个/512 MiB 是优化前上限。
- 每个对话模型可独立覆盖 Base URL/API Key 或绑定账户 Token，留空继承全局对话连接；Chat Completions 与 Responses 对话按实际请求模型路由，Responses 生图继续使用图片连接。账号模式仍保留逐模型自定义 API Key，优先于模型绑定账户 Token 和全局账户 Token；逐模型自定义 Base URL 只在 `custom` 模式生效。逐模型 Key 只保存在 Windows `safeStorage` sidecar，Renderer 和普通 JSON 仅见占位符；模型缓存用单向指纹区分 URL/Key/Token 变化。SparkAPI 专用版继续强制账号地址，但不得移除账号登录后的逐模型自定义 Key。
- 软件通行条件是“成功登录中转站账号”或“设备持有有效 Pro License 且配置自定义 Base URL”。账号登录本身授权使用且不请求 License；自定义模式只接受服务端 `pro` 兑换码，默认最多 3 台设备，沿用永久/限时、禁用撤销、24 小时在线校验和 72 小时离线宽限。License 请求不得携带用户 Base URL、API Key 或账号 Cookie。
- 每张最终生成图片必须独立保存版本化请求快照、服务器实际返回参数和运行耗时；Images/Responses 的重复最终事件只补齐同一图片参数，不能串到其他输出。最终比例、像素尺寸和文件格式只取受管成图实测值；服务器未返回的清晰度、质量、格式等不得由请求值反推为响应。持久化严格使用白名单，不含 Key、Token、Cookie、Prompt、上游绝对 URL 或签名 URL；本地导入图不得继承节点默认生图参数。
- 顶部 Agent 对话框每次派发时必须把当前比例和清晰度冻结到该运行快照；冻结值同时约束公开工具 Schema、顶层与 `items[*]` 工具参数、普通/批量/Goal/分层/区域执行和最终交付尺寸。模型或旧参数提交冲突值时按钮值获胜；真实上游 Prompt 必须追加画面比例、清晰度和最终像素说明，成果节点、图片组及编辑器仍保留用户原始可编辑 Prompt。该运行锁不得写回项目设置或污染后续任务。
- 当前导出中心整备已将图片、图片组与 PSD 的入口统一到同一表面，并提供命名模板、项目级预设、冲突策略、本地串行队列、内容指纹增量跳过和项目级历史；真正的路径解析、文件系统写入与最终冲突复核仍只由 Electron Main 持有，Renderer 不接收或提交任意绝对路径。跨领域统一 manifest 仍属于后续扩展，不影响本轮本地导出闭环。
- 新安装不得创建 AppData 默认项目或全局画布 Session。创建项目与导入项目必须先取得用户选择的目标目录；取消选择不得创建目录、切换项目或写入索引。移除最后一个项目后进入内存空画布，自动保存、导入、生成和导出均不得伪造 `default` 项目。
- 旧 AppData 项目只做显式迁移，不在启动时自动移动或删除。迁移必须先预检源项目、目标冲突和空间，复制到目标 staging，校验受管文件数量、大小与 SHA-256，原子发布并更新项目索引；源数据清理必须在迁移成功后由用户单独确认。安装目录不作为项目数据目标，避免更新、卸载和权限导致数据丢失。
- 普通图片、单图 PSD、分层 PSD 与图层文件夹继续写入当前项目的 `exports/` 子目录；图片组写入项目级 `image-groups/`，Main 在最终提交前复核目标仍在项目根内。普通图片需先明确格式，图片组需提供格式、图片数、槽位失败、预计体积和导出统计预检。
- 桌面和网页生图默认调用官方 OpenAI 兼容 Images API：`POST /v1/images/generations`（JSON）与 `POST /v1/images/edits`（multipart/`image[]`）。该合同同时覆盖原生 New API、sub2api、球球 Token，以及 GPT Image / Grok / Gemini 等网关；请求体只使用上游公开字段，不以 SparkAI `/v1/image-tasks` 或对话模型 Responses `image_generation` 作为默认生图协议。`sparkai-extension` 的 `/v1/image-tasks*` 仍可包装原生 Images API，但不再是客户端默认路径。
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
| 当前追加：Cloudflare 图片长请求任务化（已完成） | Extension 图片任务创建立即返回，后台经 Docker 内网调用原生同步 New API；Electron 轮询直到最终结果 | `queued/running/succeeded/failed`、HMAC owner 隔离、内存 Bearer、失败与崩溃不重放、旧同步接口兼容；Extension loopback、Compose、桌面传输专项和生产构建均已核验，不调用真实模型。 |
| 当前追加：Agent 原生复制、内容摘要标题与迁移确认修复（已完成） | 恢复普通消息文本选择复制；让生成成果标题表达图片内容；修复 production 安装包迁移确认被压缩为数字导致的拒绝 | 普通消息无新增按钮且真实 Selection/`Ctrl+C` 通过；标题纯函数与无网络 Electron action 通过；真实 preload VM 只提升 `true`/`1`，Main 保持严格布尔校验；专项、production build、最终 ASAR 与双 Windows x64 测试包均已核验。 |
| 当前追加：账号登录与 Pro 自定义接入授权（已完成） | 账号登录直接进入工作区；自定义 Base URL 先激活 Pro；账号模式完整保留逐模型自定义 API Key | 后端计划/设备/撤销合同、桌面登录门禁、官方 License 域名、凭据隔离和逐模型 Key 优先级已实现；双仓专项、隔离登录 GUI、typecheck 和最终 production build 均通过。 |
| 当前追加：原生 New API 外置扩展（已完成） | 保持用户已部署 New API 原生可升级；`sparkai-extension` 只运行 License 与 image-task 扩展 | 根入口、SQLite/HMAC License、管理员 CLI、内存凭据图片队列、强制 Docker 内网、宿主机/Docker Caddy 示例、包内 Codex `AGENTS.md`、ZIP/TAR.GZ 打包器和双仓文档已闭环；旧 fork 待真实部署/备份/回滚验证后另行删除。 |
| 当前追加：图片组项目目录与连线交互（已完成） | 图片组名称直接映射项目级交付文件夹；多组选中导出多个同级目录；连线与取消必须非破坏且可精确断开 | Main-only 新目录、旧目录兼容、整批原子发布、真实边身份、精确目标、单边/批量断开、隔离 GUI、最终 build 与双 Windows x64 测试包均已核验。 |
| 当前整备：大量图片、统一导出与安全验收（已完成实现） | 常驻缩略图 Worker、扩大缓存、项目级统一导出中心，以及默认拒绝真实请求/真实迁移的验收工具 | 10 张 4K 冷热缓存证据、导出逻辑/UI、迁移/模型验收专项、15 场景 UI Surface 和三轮产品性能门禁均通过；Agent Text UI 与 AskUser GUI 修复后均连续两轮通过。最终 `release:verify` 为 113/113 且源码稳定。正式发布仍只接受同一次完整 `release:final`，现有安装阻断时生成的双版本包只能称本地候选。 |

## 交互质量与玻璃控件核验（2026-08-26）

- Agent composer 和设置抽屉改用自身容器宽度的响应式网格；模式、素材、模型、比例、清晰度和实际尺寸在窄面板中分行/整行收纳，弹层保持在可视区内。设置账户密钥和逐模型账户密钥统一使用 `GlassSelect` Portal/listbox，支持禁用项、键盘移动、Escape/Tab 关闭和焦点返回，菜单沿用 Glass token。
- 画布框选拖动从 canonical `selectedNodeIdsRef` 收集全部普通单图；命中图片容器后先回滚临时 transform，再以一次 layout mutation 原子归组，排除所有源节点作为目标且不改写 `parentId`/`relationType`。失败保持原布局并显示可见错误。
- Project Graph 风格连线保留底层真实 source/target、relation type 和 Requirement input role；单击连接头、空白松手、Escape、pointercancel 只取消草稿，具体边菜单使用精确关系 CAS，旧菜单不能误删替换后的新边。
- 通过 `test:workspace-glass-ui`（164）、`test:agent-panel-ui`（52）、`test:selection`（16）、`test:image-layout`（15）、`test:image-container`（12）、`test:requirement-graph`、`test:custom-api-transport`（39）、`test:new-api-login`、`test:ui-foundation`、`typecheck` 与 `git diff --check`；真实 Electron 窄面板/四类玻璃菜单截图已人工复核，未调用模型。文档冻结后的 production build 与双变体 Windows x64 package 已完成。

## 原生 New API rc.23 登录兼容与提速核验（2026-08-26）

- `completeNewApiLogin()` 登录返回关键路径只等待 `/api/user/login`、rc.23/旧 session 认证数据解析、安全持久化和 `cacheOnly` 模型设置；用户资料、账户 Token/额度和模型目录由 Renderer 进入工作区后的既有 `refreshServerState()` 后台刷新。登录时清理旧 `serverToken`、旧账户 Token 选择和 Main 完整 Key cache，认证 epoch 继续拒绝迟到的旧账户响应。
- `test:new-api-login` 把 `/api/user/self`、Token/额度与模型目录 fixture 固定延迟 1.5 秒，最终复跑登录为 111 ms 且只请求一次 `/api/user/login`；专项同时证明 rc.23 auth bundle 进入加密 sidecar、普通设置和返回 DTO 无明文、旧账户 Token 选择被清空。
- 本轮 `test:custom-api-transport` 39 cases、`test:account-token`、`test:settings-secret-store`、`test:settings-lazy-load` 67 cases、`test:settings-persistence` 124 cases、`test:agent-model-binding` 4 cases、`test:access-variant`、`test:ipc-registration` 147/144/3、三个 CJS 语法检查、`typecheck` 与 `git diff --check` 均退出 0。传输专项明确覆盖 refresh single-flight、401 单次重放、provider Authorization 锁定和“逐模型自定义 Key → 模型账户 Token → 全局账户 Token”。
- 独立 production build 转换 1674 modules、15.71 s；`package:win:variants` 退出 0，内含两次 production build 和双 Electron/NSIS/品牌封装，`bundleEnforced:false`。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe]：175,979,520 bytes（167.83 MiB），2026-08-26 15:30:01 +08:00，SHA-256 `7DB90B013E7341E3B7BD1D38FDA1C7755870C071F2BD0C12606E32D268CC719E`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe]：175,979,520 bytes（167.83 MiB），2026-08-26 15:31:15 +08:00，SHA-256 `4846618581E72C38E80E8F0DC9336FEE8344489BE773CA8B4B2E64E44F712662`。
- 两个安装器的 Authenticode 状态均为 `NotSigned`。本轮未运行受既有 Electron GPU 启动限制影响的 `test:new-api-transport`，未做真实安装/卸载 smoke，未访问真实 New API、License、图片或视频模型，未执行正式 Bundle/发布验收，也未提交、推送或发布。

## 本地整备收口（2026-08-16）

- 最终本地发布门禁 [report.json] 完成 113/113 项，`sourceStable:true`；覆盖 typecheck、协议/IPC、项目 Session、迁移/导出、图片性能、UI Surface、更新/回滚和 Bundle hard gate。
- AIDebug/导出 UI 已改为每次运行创建隔离项目列表和项目目录，Commerce、Glass、Graph CLI、Skill、图片生成与 Commerce Export UI 不再依赖测试机上的默认项目；这只影响测试夹具，不改变用户项目路径策略。
- `project-session-merge.cjs` 保留尚未获得 `commitRevision` 的新 mutation，避免旧已提交事件在保存协调器盖章前把图层状态丢掉；对应 selftest 覆盖重组与可见性连续保存。
- 本地验证不等于外部验收：正式安装/升级/卸载、Windows 签名、真实模型供应商服从度、真实 C 盘迁移清理和 SparkAI Extension 生产部署仍需在用户明确授权和实际环境中完成。

## 图片组项目目录与连线交互核验（2026-08-15）

- `desktop/image-collection-export-service.cjs` 将普通图片组批量导出固定到当前项目的 `image-groups/<稳定图片组名>/`；多组导出共享 staging、备份与整批回滚，一个组选中后得到一个同名文件夹和 `image-group.json`。旧 `exports/image-groups/` 只用于历史 manifest 打开兼容，新导出不再写入旧目录；项目受管原图不移动、不覆盖。
- 画布连接头只有超过拖动阈值才尝试建边，目标必须真实包含指针；输入/输出连接头单击、空白松手、`Escape` 与 `pointercancel` 都只取消草稿。连线使用 18 px 透明命中区，单击或右键可打开具体关系菜单并断开一条底层真实边，节点右键继续提供全部输入/输出批量断开；图片容器投影边保留真实 source/target ID。
- 专项 `test:image-collection-export`、`test:requirement-graph`、`test:image-container`（12 cases）、`test:image-layout`（14 cases）、`test:image-collection-mutation`（4 cases）、`test:image-export`、`test:psd-export`、`test:image-stream-preview`（30 cases）、`test:automation-service`、`test:ipc-registration`（141/138/3）、`test:workspace-glass-ui`（155 cases）、`test:ui-foundation`、`test:aidebug-glass-workspace`、`automation:generate --check`、`typecheck` 与 Harness 10 项结构检查均退出 0。
- 隔离 Requirement AIDebug [report.json] 为 `ok:true`、9 scenes、0 failures；`connectionCancelSafety` 明确记录输入连接头单击、输出连接头单击、空白松手和 `pointercancel` 四条路径都不修改关系，并验证具体断线与撤销恢复。
- 最终图片集合 AIDebug [report.json] 为 `ok:true`、11 scenes、0 failures。成果编辑器最大化实测 `1256×796`，四周约 12 px；查看器连续切图有 12 个状态采样、0 空白帧、最大表面位移 0，A→B→C 延迟解码竞态最终 `target/displayed/final` 均为 C，`buffering:false` 且 `staleRollback:false`。
- 最终 `corepack pnpm run typecheck`、`git diff --check` 与 Harness 10 项检查退出 0；独立 production build 转换 1667 modules、7.70 s。`corepack pnpm run package:win:variants` 退出 0，内含两次 production build（6.17 s、6.05 s）和双 Electron/NSIS/品牌封装，`bundleEnforced:false`；当前版本没有旧 `naimage-Setup/Core` 公开命名。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe]：175,965,696 bytes（167.81 MiB），2026-08-15 19:00:17 +08:00，SHA-256 `2FFC43A1822A484C1DE783D6762538E74618CE6B1B8E0FF455485DDA14133D3B`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe]：175,969,280 bytes（167.82 MiB），2026-08-15 19:01:09 +08:00，SHA-256 `3249EE0BDFCF16DEDF75FA1BFFE5B3976F8BD3C53745B80B2DCB3B3C2477F7A4`。
- 本轮没有调用真实图片/视频模型或 Seedance；未执行正式 Bundle/发布验收、Windows 数字签名验证或真实安装/卸载 smoke，代码未提交或推送。

## 登录与 Pro 自定义接入授权核验（2026-08-15）

- New API `go test ./model ./controller ./router -count=1` 退出 0，覆盖账号 Managed Relay 不再依赖 License、设备端点只接受 `pro`、默认 3 台、永久授权、设备上限、非 Pro 不消费激活数和禁用后撤销。
- Desktop `test:license`（9 cases）、`test:access-variant`、`test:custom-api-transport`（31 cases）、`test:agent-model-binding`（4 cases）、`test:settings-secret-store`、`test:settings-persistence`（124 cases）、`test:model-catalog`、`test:settings-lazy-load`（67 cases）、`test:ipc-registration`（141/138/3）、相关 CJS 语法检查和 `typecheck` 均退出 0。
- 隔离 `aidebug:auth-gate` 报告 [report.json] 为 9 scenes、0 failures；账号退出、错误态、注册切换、重新登录和 `884×720` 窄窗口均无状态、裁切或横向溢出问题，使用 mock 账号且未访问真实 License/模型服务。
- 最终 `corepack pnpm run build` 退出 0，Vite 转换 1667 modules、8.42 s，仅有既有大 chunk advisory。本轮未调用真实兑换码、模型或生产服务，未打包 EXE、未提交或推送代码。

## Agent 复制、内容摘要标题与迁移确认核验（2026-08-15）

- Agent 普通正文、Markdown、thinking、工具说明和完成文本显式使用 `user-select:text`。隔离 `test:agent-panel-ui` 通过 52 cases：普通消息内按钮数为 0，computed `user-select`/`-webkit-user-select` 均为 `text`，真实 Selection 得到完整正文，CDP 发送 `Ctrl+C` 后 copy event 得到同一文本；已有生图提示词专用按钮未移除。
- `src/image-content-title.ts` 新增 `imageContentSummaryTitle()` 与 `normalizeGeneratedImageContentPresentation()`，结构化 Prompt 优先提取主体、场景和用途，泛化标题/完整 Prompt 被替换，已有简短人工标题保持，同 Prompt 多图追加稳定序号；节点、图片组、资产和槽位同步且输入对象/原始 Prompt 不变。`test:image-content-title` 7 cases 和 Agent Panel 无网络 runtime action 通过，示例节点标题为“Grok · xAI AI 助手 · 宽幅 AI 产品宣传海报”。
- C 盘迁移失败根因是 production Terser 把 Renderer `confirmed:true` 与 `confirmedCleanup:true` 压成数字 `1`，而 Main 正确地只接受布尔 `true`。`preload.cjs` 现仅把字面 `true`/数字 `1` 复制归一化为布尔 `true`；`"1"`、`2`、`false` 和缺失值均不提升，原对象不修改。`test:ipc-registration` 通过真实 preload VM 验证该边界，仍登记 141/138/3；`test:project-data-migration` 41 cases 继续通过。
- `test:image-container`（12）、`test:image-layout`（14）、`test:image-collection-mutation`（4）、`test:image-stream-preview`（30）、`test:workspace-glass-ui`（155）、`test:project-io`、`test:image-export`、`test:psd-export`、`test:image-collection-export`、`test:automation-service`、`typecheck` 与 `git diff --check` 均退出 0。普通图片导出仅有既有 libvips `tiffSubifd` warning，断言成功。
- 文档后的最终 `corepack pnpm run build` 退出 0，Vite 转换 1667 modules、9.00 s，仅有既有大 chunk advisory。`corepack pnpm run package:win:variants` 退出 0，包含接入策略专项、两次 1667-module production build（8.87 s、9.35 s）与双 Electron/NSIS/品牌封装，`bundleEnforced:false`。
- 最终 SparkAPI `app.asar` 只读核验同时发现 Renderer `confirmed:1`/`confirmedCleanup:1` 与 preload `normalizeExplicitConfirmation` 的 `value !== true && value !== 1` 边界，证明安装包覆盖真实压缩形态。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe]：175,967,232 bytes，2026-08-15 12:34:31 +08:00，SHA-256 `928A6F73C1F30EA2DCDAFB94EE03B430DEFDCEDF9F9C0001799F1678DD299DD4`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe]：175,967,232 bytes，2026-08-15 12:35:53 +08:00，SHA-256 `380E22389355812DED477013A94B051E238D77B44A8A82C73D44098B446FCF5A`。
- 未调用真实图片/视频模型，未直接迁移或删除用户真实 AppData 数据；未执行正式 Bundle/发布验收、Windows 数字签名验证或真实安装/卸载 smoke，代码未提交或推送。

## SparkAI Extension 外置服务核验（2026-08-15）

- `sparkai-extension` 的活跃根入口是独立 Node 24 SparkAI Extension，仅提供 `/api/naimage/license*` 与 `/v1/image-tasks*`；账号、Token、渠道、quota、计费和管理后台继续完全属于用户现有的原生 New API。新兑换码以 HMAC 匹配并加密保存供管理员重复查看，管理页可按精确 Origin 白名单嵌入现有 Admin。旧 `ai-gateway`、CRM 与 production 部署树已退出根构建/运行入口，只作为部署验证后的待清理输入保留。
- Extension 使用自己的 SQLite/HMAC 保存兑换码、设备授权、任务 owner 与状态；调用者 Bearer Key 只在进程内存中存在，并通过 `SPARKAI_NEW_API_UPSTREAM` 私网调用原生 `/v1/images/generations`。创建立即返回 `task_id`，进程重启将未完成任务置为 failed 且不重放，结果按保留期启动时及每 15 分钟清理。
- 本地管理员 CLI 已真实完成“创建 2 枚测试码 → 列表查询 → 禁用 1 枚”闭环，测试码只写入隔离 `.diagnostics` 数据库且临时服务已停止。Extension `build` 与 5 项 loopback 测试（含限时授权/兑换截止）、Compose 静态配置、桌面 `test:license`（9 cases）、`test:custom-api-transport`（31 cases）、`typecheck` 和 production `build`（1667 modules）均退出 0。
- 本轮没有部署生产、访问真实 License/New API、调用真实图片模型或删除旧 fork。独立浏览器开发回退 `src/server.ts` 仍是历史 session-relay 适配，不作为当前 Electron + Extension 合同的验证证据；若以后发布独立 Web 版，需要另行定义不暴露账户 Key 的服务端凭据桥。
- 交付包默认要求现有 `SPARKAI_DOCKER_NETWORK`，内部上游使用容器 DNS；包根 `AGENTS.md` 固化只读发现、secret 保护、Compose 启动、Docker 内网状态检查、宿主机/Docker 代理分流、无费用验收、备份升级和禁止 `down -v` 的回滚边界。`package:extension` 只包含 25 个扩展/部署文件，并生成 bundle manifest、内部/外部 SHA-256、ZIP 与 TAR.GZ；旧网关/CRM、`.env`、数据库、诊断和用户数据均不进入包。

## Cloudflare 图片长请求任务化核验（历史实现，已由外置扩展替代）

- v42 曾把 `POST /v1/image-tasks` 与 `GET /v1/image-tasks/:id` 直接加入 New API，并复用其 `Task`、`SystemTask`、`ExecuteRelay -> ImageHelper`。该实现在当时通过验证，但会形成用户不接受的 New API 二开维护负担，已由上面的独立 SparkAI Extension 架构取代，不再是活跃构建或部署入口。
- 当时 Desktop 与浏览器使用同一 `task_id` 轮询并通过对应专项；这些历史证据只用于审计，不能证明当前原生 New API + Extension 部署已经在线联调。
- New API `go test ./controller ./router ./model ./service -count=1` 退出 0；Desktop `test:custom-api-transport` 29 cases、两个 CJS 语法检查、`typecheck`、OpenAPI JSON 解析和 `git diff --check` 均退出 0。独立 `corepack pnpm run build` 退出 0，Vite 转换 1666 modules、10.61 s，仅有既有大 chunk advisory。
- `corepack pnpm run package:win:variants` 退出 0，包含 `test:access-variant`、安装器资源、两次 production build、两个 Electron/NSIS 内核与品牌安装器封装，`bundleEnforced:false`。公开 `release/` 中不存在当前版本旧命名 `naimage-Setup/Core-1.0.9`。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe]：175,965,696 bytes（167.81 MiB），2026-08-15 11:26:41 +08:00，SHA-256 `E9638C6DFC7AA519E132218299FC66ABC3099397ED24663A5FD277B7C0409F4C`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe]：175,965,184 bytes（167.81 MiB），2026-08-15 11:27:58 +08:00，SHA-256 `F60E19A1A39271FF52CC1ED2CCC144AE613D2DED9DFB52F2754A6D200680F718`。
- 未调用真实图片/视频模型或 Seedance，未在真实 Cloudflare 域名和线上 provider 验证 3-5 分钟生成；未执行正式 Bundle/发布验收、Windows 数字签名验证或真实安装/卸载 smoke，代码未提交或推送。

## 顶部对话框生图规格绑定核验（2026-08-14）

- `desktop/ipc/agent-ipc.cjs` 在 `agent:chat` 派发时把 Renderer 的 `imageDefaults` 冻结为仅属于本次运行的 `imageFrameLocked` 快照；`runtime/tool-schemas.cjs` 将公开比例/清晰度枚举缩为按钮值，`agent-runtime.cjs` 再覆盖顶层和 `items[*]` 冲突值，并在真实上游 Prompt 追加画幅、清晰度、最终像素与禁止拉伸说明。成果资产、图片组和编辑器继续保存追加前的原始 Prompt。AskUser 中途补充信息时，`PendingAgentExecution` 只保存同一任务的合法 `imageRatio/imageResolution`，恢复后重新生成运行锁，避免读取变化后的全局默认值。
- 本轮 `test:image-frame-contract`、`test:agent-run-control`、`test:goal-runtime`（43 cases）、`test:agent-text`、`test:custom-api-transport`（24）、`test:image-generation-metadata`（13）、`test:ipc-registration`（141/138/3）、`test:image-stream-preview`（30）、`test:project-io`、`test:workspace-glass-ui`（155）、`typecheck`、相关 CJS 语法检查、`git diff --check` 与 Harness 10 项结构检查均退出 0。规格合同实际覆盖 `3:4 + 2K → request 1024x1536 / delivery 1536x2048` 和 `16:9 + 4K → request 1536x1024 / delivery 3840x2160`，并验证模型冲突参数被覆盖、上游 Prompt 含交付规格、成果保留原始 Prompt；项目 IO 证明挂起任务的 `3:4 / 2K` 经保存和重启仍保持。
- 隔离 `aidebug:ask-user` 报告 [report.json] 中全部 10 项功能 checks 为 true，新增 `frameContractSurvivesContinuation:true`；实际观察到 composer、pending 与 resumed frame 均为 `1:1 / 1K`，提示词中的 `3:4` 未覆盖按钮值。整套命令仍退出 1，未描述为整体通过：既有 `ask-user-structured-options` 概览把节点 B 缩到约 2 px 可见宽度，触发 `visual-area-too-small`，最终场景因此记录聚合 suite failure；其余目标场景状态、溢出和功能断言通过。
- 补丁后的最终 `pnpm.cmd build` 退出 0，Vite 转换 1666 modules、7.64 s，仅有既有大 chunk advisory。
- 获得授权后，固定命令 `pnpm.cmd package:win:variants` 退出 0，包含 `test:access-variant`、安装器资源生成、两次 production build（7.71 s、7.88 s）和双 Electron/NSIS/品牌安装器封装，`bundleEnforced:false`。公开 `release/` 中不存在当前版本旧命名 `naimage-Setup/Core-1.0.9`。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe]：175,960,576 bytes（167.81 MiB），2026-08-14 17:08:56 +08:00，SHA-256 `FEAF4D033C6E2B0BDD57B2EB0A9FE65311D3E9C6FF642039B950662B3215FC2A`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe]：175,964,160 bytes（167.81 MiB），2026-08-14 17:10:06 +08:00，SHA-256 `17CE9B3AB71CE3E9C3A2ECF903B0D2C23FABDE7863D92C0C70B46408CA260130`。
- 未调用真实图片/视频模型或 Seedance，代码未提交或推送；未执行正式 Bundle/发布验收、Windows 数字签名验证或真实安装/卸载 smoke。

## 成果图片生成参数展示核验（2026-08-14）

- `runtime/image-generation-metadata.cjs` 与 `src/image-generation-metadata.ts` 分别持有 Main/Runtime 白名单元数据和 Renderer 展示逻辑；Images/Responses 每个最终图片保留独立 `actualParams`，Electron Main/Agent 落盘 `ImageAsset.generation v1`。最终宽高、比例和文件格式来自受管文件解码；旧生成图可使用节点请求快照，本地导入不继承默认生图参数。
- 本轮复跑 `test:image-generation-metadata`（13 cases）、`test:custom-api-transport`（24）、`test:workspace-glass-ui`（155）、`test:image-stream-preview`（30）、`test:ipc-registration`（141/138/3）与 `typecheck` 均退出 0。此前同一工作树的图片容器、布局、普通/PSD 导出、Automation 等 Goal 必需专项也均已通过；未调用真实模型。
- 参数面板的隔离 Electron 截图 [1280] 与 [884] 人工复核无重叠、裁切或溢出，目标探针均为 `generationPanelOk:true`，同时观察到响应与成图来源。
- 完整 `aidebug:image-collection` 最新报告 [report.json] 仍退出 1，未描述为整套通过：9 个可见场景均为 `stateIssues=0`、`overflow=0`、`captureIssues=0`，19 个图片组操作步骤通过；唯一产品场景失败是既有首图 A 在 3 秒探针窗口内 `visibility-timeout`，最终节点和截图实际可见，后续 B/C/D/F 顺序通过。该失败不属于参数面板，但仍作为未收口边界保留。
- 独立 `pnpm.cmd build` 退出 0，Vite 转换 1666 modules、8.77 s，仅有既有大 chunk advisory；沙箱内首次 `corepack pnpm run build` 因无权写 `node_modules/.vite-temp` 返回 EPERM，获批后在沙箱外同一生产构建成功。
- `pnpm.cmd package:win:variants` 退出 0，包含 `test:access-variant`、安装器资源、两次 production build（7.94 s、7.45 s）、两个 Electron/NSIS 内核与品牌安装器，`bundleEnforced:false`。公开 `release/` 中不存在当前版本旧命名 `naimage-Setup/Core-1.0.9`。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe]：175,959,552 bytes（167.81 MiB），2026-08-14 16:00:26 +08:00，SHA-256 `528CF5EB71F625A069574EB2F903B45EE0A32C132A82F2732DBA620B844DB404`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe]：175,963,136 bytes（167.81 MiB），2026-08-14 16:01:29 +08:00，SHA-256 `67222A0BCFCF91FC52068C359CC27B15EA42B88C9D5AA7DB0E310CE21B9C414D`。
- 本轮未执行正式 Bundle/签名/真实安装卸载验收，未调用真实图片/视频模型或 Seedance，代码未提交或推送。

## 项目迁移与导出核验（2026-08-14）

- 项目根与迁移专项通过：`test:project-data-migration`（41 cases，包含空间预检、SHA-256、索引回滚、项目 Agent 状态迁移与二次确认清理）、`test:project-root-policy`（19）、`test:project-save-coordinator`（21）、`test:agent-run-control`、`test:goal-task-scope`、`test:aidebug-isolation` 和 `typecheck`。`test:aidebug-isolation` 首次因沙箱拒绝写 `.diagnostics` 失败，获得授权后按同一命令通过；这次失败不属于产品逻辑。
- 图片与导出专项通过：`test:image-container`（12）、`test:image-layout`（14）、`test:image-collection-mutation`（4）、`test:image-export`、`test:psd-export`、`test:image-collection-export`、`test:image-stream-preview`（30）、`test:workspace-glass-ui`（149）、`test:automation-service` 和 `test:ipc-registration`（141/138/3）。
- 对话模型独立密钥专项通过：`test:agent-model-binding`（4）、`test:settings-secret-store`、`test:settings-persistence`（124）、`test:settings-lazy-load`（67）、`test:model-catalog`、`test:custom-api-transport`（23）和 `test:agent-text`。
- 隔离 `aidebug:image-collection` 最终报告 [report.json] 为 9 scenes、0 failures；其中首次 CDP 探针超时但产品仍响应，第二次发现并修复 884 px 项目操作区 4 px 横向溢出，最终复跑通过。
- 隔离 `aidebug:isolation` 报告 [report.json] 证明临时 Session 只写隔离项目、仓库配置不变。
- 最终 `typecheck` 退出 0；独立 production build 退出 0，Vite 转换 1665 modules、12.29 s 完成，仅有既有大 chunk advisory。首次沙箱内 build 因 Vite 无权写 `node_modules/.vite-temp` 返回 EPERM，获批后同一命令通过。
- `package:win:variants` 退出 0，内含 `test:access-variant`、安装器资源、两次 production build（8.65 s、8.27 s）、两个 Electron/NSIS 内核与品牌安装器，`bundleEnforced: false`。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe]：175,955,456 bytes，2026-08-14 12:26:52 +08:00，SHA-256 `063039857E54C5ABFBEC677C25F74F9551A11906A860E20C4884C8E8BFCD8CE0`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe]：175,955,456 bytes，2026-08-14 12:28:01 +08:00，SHA-256 `C2AFEC28A55B9C9AE4763D5697E96F363700B1E03C2E77670FF860B766CBBEF0`。公开 `release/` 中不存在当前版本旧命名 `naimage-Setup/Core-1.0.9`。

## 当前 Goal 核验（2026-08-12）

- 本地 mock 专项通过：`test:agent-model-binding`（4 cases）、`test:settings-persistence`（124 cases）、`test:settings-secret-store`、`test:custom-api-transport`（23 cases）、`test:model-catalog`、`test:settings-lazy-load`（67 cases）、`test:access-variant`、`test:ipc-registration`（137/134/3）、`test:agent-text`、`typecheck` 和相关 Node 语法检查。
- 隔离 Glass GUI [report.json] 为 `ok: true`、29 checks、35 screenshots、0 应用级 console error、0 生成网络请求，并完成真实 Electron 重启。
- Agent 文本 UI [report.json] 中，逐模型弹窗在 `884×720` 的容纳、焦点陷阱和 Arrow/Home/End roving Tab 均通过；整套命令仍退出 1，只剩两个与本 Goal 无关的既有动效断言。通用 `aidebug:gui` 也因已知 CDP `Promise was collected` / Renderer `Illegal invocation` 退出 1，失败记录保留在 `.diagnostics/electron/aidebug-2026-08-12T03-48-59-238Z`。
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
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe]：175,943,680 bytes，2026-08-12 16:09:44 +08:00，SHA-256 `7012D3F6A3D9C339824724DA25E7CE9065399711FE1BB9D76229CFB11906896E`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe]：175,943,680 bytes，2026-08-12 16:11:00 +08:00，SHA-256 `6B1926F1CE82CC8A50DEFCF3C55C1AF7DF13D9C17D9E146302616347907006C0`。
- 未直接清理真实项目，未调用真实图片/视频模型或 Seedance，未执行正式 Bundle/签名/真实安装卸载验收，代码未提交。

## 阶段 13 本轮核验（2026-08-11）

- 图片组 mutation/export、普通图片导出、PSD、流式查看器、automation、IPC、Glass UI、Agent 文本与类型检查均通过：`test:image-collection-mutation`（4 cases）、`test:image-collection-export`、`test:image-container`（12）、`test:image-layout`（14）、`test:image-export`（PNG/JPEG/WebP/AVIF/TIFF，普通/PSD 隔离为 true）、`test:psd-export`、`test:image-stream-preview`（30）、`test:automation-service`、`test:ipc-registration`（137/134/3）、`test:workspace-glass-ui`（142）、`test:agent-text`、`typecheck`。
- 真实隔离 AIDebug：`aidebug:image-collection` 报告 [summary.md] 为 `ok: true`、9 scenes、0 failures；`aidebug:glass-workspace` 报告 [report.json] 为 `ok: true`、29 checks、35 screenshots、0 console errors，最小窗口 `884×640`，真实重启通过，未使用生图网络。
- 最终 `corepack pnpm run build` 及 `corepack pnpm run package:win:variants` 均退出 0；Vite 转换 1665 modules，构建仅有大 chunk advisory。打包脚本报告 `bundleEnforced: false`，公开目录中当前版本旧命名 `naimage-Setup-1.0.9*`/`naimage-Core-1.0.9*` 均不存在。
- 最终测试安装包（PowerShell 独立 `Get-FileHash` 核验）：
  - [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe]：175,941,120 bytes，2026-08-11 18:04:34 +08:00，SHA-256 `753F135BE1EB8756CF3C584CAF6E0BE67016A9E140E9ACDB0A022B1EA41B1BB6`。
  - [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe]：175,942,144 bytes，2026-08-11 18:05:36 +08:00，SHA-256 `559A71F0E14AA53B6949D55AA98E78C08926608266B6D89B0C12F1BF4DB5A083`。
- 本轮未做正式 Bundle/发布验收、Windows 数字签名验证、真实安装/卸载 smoke；未调用真实图片/视频模型、Seedance 或付费生图。代码未提交。

## 完成标准

- 四模式在同一画布中稳定切换；电商复用已存在能力，社媒与科研工作流可真正执行。
- 旧项目兼容、资产与任务状态保持，收费/视频创建边界不被绕过。
- 文档、共享 command schema、CLI Skill、IPC/自动化契约与代码同步。
- 图片组命名、导出、替换/瑕疵关系、目录入口、查看器 identity/token 和普通/PSD 导出边界必须以当前代码、专项测试、真实隔离 AIDebug 与最终制品核验为证据；旧报告不能替代本轮结果。
- 最终发布前再执行完整验收；当前开发以每阶段的直接专项验证作为证据。
