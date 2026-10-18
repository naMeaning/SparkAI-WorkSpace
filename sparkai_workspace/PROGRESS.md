# SparkAI WorkSpace 进度

## 当前开发状态（2026-10-18）

- 状态：八项桌面修复及本地交付完成，源码与文档已普通push。免费 Agent 生图工作台与双接入保留；[逐项验证/限制](docs/AGENT_WORKFLOW_VALIDATION_2026-10-18.md)、[长期合同](docs/AGENT_WORKFLOW_CONTRACT.md)与地图已同步。
- 实现：结构化Ask恢复冻结快照；view_image同轮像素与独立生成字节清单；更新地址/传输/路由/响应/签名分层；原TaskScope紧凑范围菜单；同轮观察短名/manual保护/稳定消歧；完整启用模型池与有效参数冻结；Grok能力归一；四侧端口、实际命中、路径及取消手势。
- 现场：main / 8889db1db5f002226d10634f3c066b24f69cff8a开始，预存相关文档及免费双接入均保留；所有子代理gpt-6.1-sol/max。0真实模型请求，未改外部New API/Extension/生产地址。
- 最终完整UI：[59项/18截图](.diagnostics/agent-workflow-ui-2026-10-18T08-39-52-010Z/report.json)，mode=full/ok=true，19owner前后稳定；图片↔容器32侧向组合、键盘、取消、0.5/1.2缩放、移动/撤销/保存重载、平移/框选/resize、普通点击/拖动阈值/尾随事件、实际手动命名与884×640菜单全部通过。38条端点最大误差0.0005603px。主/子代理已看[截图总览](.diagnostics/agent-workflow-ui-2026-10-18T08-39-52-010Z/review-montage.png)及小窗/重载原图。
- Ask/更新：Ask/Goal真实Electron14项/8截图；更新HTTP/IPC22项、生产Renderer7项/11截图/两次启动，保留验签/回滚/续传/失败恢复。匿名探针实证生产合法URL却HTTP404（New API status200），缺少桌面更新路由仍未恢复；无害EXE交接仅证明更新状态链，不能当真实新版本安装。
- 最终安装版Main：[5项/3截图](.diagnostics/agent-workflow-main-2026-10-18T08-36-34-460Z/report.json)，13owner与最终ASAR匹配，真实preload修改live设置后，3次loopback Responses/唯一1次图片POST仍按冻结xAI/direct/high/1:1/1K/n1；生成PNG1024²/hash与磁盘一致，同主模型后续回合收到像素。保存、实际重载、正常退出后三处均1node/1asset/outputs1且身份不变；revision4终态done、无running、malformedProgress=[]，4条trace均internalOnly。正常exit0/441ms、forced=false、进程树为空；截图已看。
- 资产/配置专项：Runtime最终11项、merge94项、projectIO单/多资产实际保存重开与322资产、双Renderer5例（edit/edit、edit/delete、delete/undo、连续保存、ack周围关闭）、命名13项、容器事务5项、selection16、图356曲线采样、协议/Adapter/IPC/CLI/MCP等受影响专项与typecheck通过。失败复现保留，见下方历史和验证文档。
- 最终EXE：[SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe](release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)，109,866,496 B，SHA-256 `c94cfb0132b6738c7d12ad66723b837460d89d4bd36510bf2cf3fbed1f52a3ba`。package:win:unrestricted退出0，production build1688 modules/22.39s；421源/公开契约文件冻结hash `33b9b0d524a88e2f0858f997ef76323f68d4c294808cda7b3c968c13e23e8592`，main.tsx为`e5d1ffe933e1d806ffecd3264ae934765467706332916fbdf523520acbd035a3`。包内122dist/139owner/生产package元数据逐字节核对，无env/diagnostics，双接入策略保留；[审计](.diagnostics/agent-workflow-delivery-2026-10-18/package-audit.json)。ASAR52,105,899 B / `6e143954c3ee861e35a523bcab10635e18e654a8306bb9850f21c0ca8608bd24`。此前同名EXE均已替换，不能按版本号混淆。
- 原位安装：[品牌/S安装](.diagnostics/agent-workflow-delivery-2026-10-18/install.json)exit0/17,431ms，安装前无同名进程、无强杀；原注册目录/1.0.9、项目/设置保留，凭据sidecar只核对metadata、未读内容。安装EXE232,754,176 B / Product1.0.9.0 / SHA256 `d972ef5665e04df8d7c7afb3369c59e2600d40e072f6140966f4052dbaf3090f`，ASAR匹配。脚本首次被本机执行策略拦截，随后仅进程级Bypass，未改系统策略。
- 免费双接入复验：[最终安装版6项/4截图/两次启动](.diagnostics/agent-workflow-delivery-2026-10-18/auth-ui-1792312696078/report.json)通过，账号表单、过期旧License不阻custom、实际提交与重启恢复、普通设置无fixture key；0模型POST/0License请求。已看重启工作台截图，未读取/覆盖日常凭据。
- 交付后preflight：[最终核对](.diagnostics/agent-workflow-delivery-2026-10-18/preflight.json)通过，安装器/安装EXE/ASAR身份未变，日常配置与项目列表及凭据sidecar metadata保持，未读secret内容；同名进程为空。
- 未验证：本地Mock不能证明主模型自主ask/view、真实主体识别/参考遵从或具体Grok渠道能力；真实测试清单已提出，等待范围对应凭据，实际请求0。生产更新路由仍缺失；历史500/1000节点拖动性能、正式CSS门槛保留，未扩大正式门禁。不上传EXE、不创建Release/tag。
- Git交付：57个源码/测试/文档文件提交 `c7787f2b90e4c2c0cf2e585da8f5ca4a4d81e36b` 已普通push到origin/main；ls-remote实查远端、本地HEAD、upstream三者一致，工作树干净。提交范围仅桌面源码/合同/测试/文档，无EXE/诊断/私有配置；凭据样式扫描未发现疑似secret。
- 文档收尾：Goal/Progress、Product Intent、地图v112、共享schema/CLI/MCP、合同/验证/索引已同步；39处新增链接与差异检查通过，源码421文件再次核对零漂移。本完成记录随纯文档提交归档，最终Git与证据哈希集中于[本地交付索引](.diagnostics/agent-workflow-delivery-2026-10-18/delivery.json)。
- 下一步：本轮授权的本地交付已完成；真实模型、生产更新路由、历史性能/正式门禁与正式发布均按上方限制保留，不重复已完成的付费历史请求。

### 2026-10-18 八项实施过程（历史checkpoint，按上方最终快照判断当前状态）

以下记录保留当时失败、候选包与修复顺序；其中“待/下一步/in progress”是历史状态，已由上方最终证据替代。

- 当前任务（最新）：八项 Agent 工作流/图片上下文/更新/范围入口/内容命名/有效配置/参数兼容/四向连线直接实施，状态 in progress。保留下方免费双接入交付，不把历史制品计为本轮完成。
- 接受现场（本轮）：main / 8889db1db5f002226d10634f3c066b24f69cff8a；预存 Goal、Progress、docs/README 和交接文档草稿保留。代码、运行证据是事实来源，交接假设待验证。
- 本轮实现：TaskScope 白名单冻结模型池/能力/本轮配置，历史参数分开；view_image/ask_user 脱敏协议 trace；图片请求按真实上传字节核对原图/参考/用途顺序；同轮观察后命名并保护手动名称；Grok 质量按显式连接能力处理；独立更新地址解析/分层诊断；紧凑范围入口与四侧连接几何已落到 owner。
- 本轮证据：Runtime [11项合同](.diagnostics/agent-workflow/2026-10-18T07-10-08-324Z/report.json)通过，包含同轮像素实际续跑、multipart字节顺序、冻结SHA变化零派发、Main bridge冻结配置及手动后缀保护；[本地更新 HTTP](.diagnostics/update-http-2026-10-18T06-50-27-453Z/report.json)22项通过，含迁移/URL/HTTP/响应/签名/下载续传/失败恢复与无害EXE安全交接。均为本地 Mock，0真实模型请求。
- 新增里程碑：[八项验证记录](docs/AGENT_WORKFLOW_VALIDATION_2026-10-18.md)。Ask/Goal真实Electron14项/8截图通过；扩展重载测试发现并修复Main丢imageConfig、Renderer丢imageRatio/imageResolution，改变当前选择/16:9/2K/high/count3后仍从原1:1/1K/auto/count1和M/N绑定续跑；Goal确认hash与派发配置一致。
- 更新结论：匿名脱敏探针确认地址合法、HTTP404且status路由200，实际为生产服务没有桌面更新接口，未替换地址或修改外部服务。HTTP/IPC22项、生产RendererUI7项/11截图/两次启动通过；修复live进度误报中断及check成功残留busy，验签/回滚保留。无害EXE仅证明安全交接，不是实际安装。
- 能力/命名：native xAI已消费归一quality，prepared/wire/画像一致；默认high→medium与显式连接high隔离。自动标题/手动保护/稳定批次suffix及Main保存往返专项通过。真实模型/主体识别仍未测，0付费请求。
- 中间制品（待替换）：production build与品牌EXE曾成功，122个dist/18个Main与Runtime owner审计、原位安装退出0/18,928ms且配置保留；该EXE 109,864,448 B / `1084d26fdef17efe9d82a51727d4cf662057c4928931e1431295d7ce537687b0`。后续真实四向UI发现容器悬浮工具条挡住目标端口，已修为连线时暂隐单选/多选快捷条，故该包不能作为最终交付。原始包/安装报告归档为`.diagnostics/agent-workflow-delivery-2026-10-18/intermediate-*`，必须重建与安装最终源码。
- 最新 Main 证据：[真实 Electron Main loopback](.diagnostics/agent-workflow-main-2026-10-18T07-25-43-958Z/report.json)4项/2截图通过，3轮 Responses、1次图片POST；首轮暂停时用真实preload保存另一套live配置，实际native xAI/direct/high/1:1/1K/n1仍来自冻结快照，PNG哈希/尺寸和实际session持久化匹配。此前helper/static证据不再代替Main实际执行；均为本地Mock。
- 最新缺口：只读 Main JSON 往返复现手动“红色圆形 · 2”及“图片成果”仍可被后续自动命名覆盖；补`contentName.source=manual`与真实编辑入口所有权，避免数字suffix/通用名推断覆盖用户。四向UI第四轮已过32组合和取消/撤销，其余交互仍在运行，不计完整通过。
- 收口修复：manual所有权已落到normalizer、presentation、编辑器node/asset目标及GUI/CLI容器事务；13项命名、5项容器事务与typecheck通过，正在补实际编辑UI。另通过恶意额外tool imageConfig复现冻结策略可被覆盖，派发已改为只取冻结settings；[最新Runtime11合同](.diagnostics/agent-workflow/2026-10-18T07-35-06-434Z/report.json)通过，明确`extraToolConfigurationIgnored:true`，0真实请求。
- 质量边界收口：真实设置清洗的空quality列表曾使兼容Grok发high，13组adapters回归先失败后修复通过；空列表继承家族/协议默认，非空显式能力仍优先。adapters、service及[最终Runtime11合同](.diagnostics/agent-workflow/2026-10-18T07-43-04-664Z/report.json)通过，源码冻结待最终UI/打包。
- UI后半阻断：[remaining-ui第六轮](.diagnostics/agent-workflow-ui-2026-10-18T07-44-38-905Z/report.json)仅partial，17owner稳定；真实平移+Escape取消后延迟触发图片查看器，挡住下一框选。截图确认是产品误触发，修复原pan/click抑制owner并补释放后650ms（超过实际500ms图片点击定时器）no-viewer断言，不能清除浮层掩盖。该轮不计完整UI通过。
- 平移修复已冻结：原canvas手势捕获记录pan消费点击，start/stop/总取消清延迟图片timer，click/dblclick捕获拒绝尾随事件，下一次真实pointerdown即恢复普通点击，无任意冷却时间。typecheck、selection-state16项和canvas-wheel通过；419个产品/公开契约源文件冻结，开始最终候选package，实际UI仍待后半及完整复验，不计安装/最终交付。
- 第二候选已生成/安装但待替换：EXE109,867,008 B / `49a80a3f0944157453dcd328fa7112dabcc79708c26f16bbeb1a5dad41852e3a`，122dist/137owner/生产package元数据核对通过；品牌`/S`退出0/16,467ms，配置/注册目录保留、EXE/ASAR匹配。安装版双接入6项/4截图/2启动通过（`.diagnostics/agent-workflow-delivery-2026-10-18/auth-ui-1792310053501/report.json`）。UI第7/8轮确认普通A单图tap被beginNodeDrag立即setPointerCapture重定向到flow-node，tile点击未收到；这是产品故障，继续修复后重建重装，该候选归档为`candidate-49a80-*`，不能代替最终交付。
- 单图tap修复：真实pointer轨迹确认按下即capture使up/click落在flow-node，tile handler未收到；现沿原5px阈值延后capture，window统一监听/清理，active pointer guard防覆盖。typecheck、selection16及diff检查通过，main冻结SHA256 `e40c8000ce350e59cfa2d4b4d68e5dd3173a49551517e9948c42d3d3f5e46a34`，完整UI仍待。
- 安装版Main失败：[正常模式候选报告](.diagnostics/agent-workflow-main-2026-10-18T08-00-06-907Z/report.json)3前置断言通过，3轮Responses/唯一图片POST，冻结xAI/direct/high/1:1/1K/n1及同轮像素正确；实际session两个相同assetId/occurrenceId/path成果，严格单成果断言失败。另测试退出超时后forced，不能记正常退出。保留报告，继续定位合并与退出边界；之前开发态绿色不代替安装版结果。
- 成果身份修复：`runtime/image-asset-identity.mjs`统一Main merge/normalizer/Renderer图片组，所有已知locator作为同run别名，保留独立导入occurrence、不同run/不同文件与manual。merge92项、真实project-io写盘重开和typecheck通过，421源文件冻结hash `273e02afe7d049c11d5e437b29770edcd21713ee23d196e8d10d18964dd516a1`，开始最终候选打包。单独零生成关闭探针exit0/1383ms/子进程[]，只证明重开图片可关闭，不代替完整生成生命周期。
- d7历史候选制品/安装（已被最终c94制品替换）：production build1688 modules/22.54s与NSIS品牌EXE通过；[EXE](release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)109,866,496 B，SHA256 `d7e829c06cf811b8779ed937dc89207d5a3480c2f949c1d319f90468ac128bcf`；ASAR52,103,212 B / `f9c9c42bcd1501ca2826dfb5da509c35f4f2c2128eabbad5e4287cf7887a2015`。[历史包内审计](.diagnostics/agent-workflow-delivery-2026-10-18/candidate-d7e829-package-audit.json)122dist/139owner与生产package元数据匹配，421源码前后稳定。品牌`/S`[历史原位安装](.diagnostics/agent-workflow-delivery-2026-10-18/candidate-d7e829-install.json)exit0/17,783ms，注册`E:\\sparkai-workspace\\naimage`/1.0.9不变、配置保留；已安装EXE232,754,176 B / `67c8ec2ecf3779625f2aaec5c744940724b8505b6c5a6e065553ad30016739f7`、ASAR与候选相符。安装前无同名进程；脚本首次受本机执行策略拦截未启动安装器，随后仅进程级Bypass执行，未更改系统策略。
- d7候选复验与新增修复：`.diagnostics/agent-workflow-main-2026-10-18T08-23-51-994Z/report.json`13owner匹配，3Responses/唯一图片POST，保存/真实重载/正常关闭后三处1node/1asset/outputs1，exit0/430ms/forced:false/进程树[]。前轮reload抢在320ms autosave前，已修测试等待实际终态；另真实发现protocol-trace对象被timeline显示并持久为[object Object]。Runtime三个诊断事件已加既有internalOnly，最新Runtime11（08:25:45）及view-image通过；最终安装版需严格malformedProgress=0。
- 多资产槽映射失败：`.diagnostics/agent-workflow/asset-merge-repro-2026-10-18/slot-map/report.json`真实merge→serialize→写盘→reopen将[A,replayA,B]去重为2assets却留3items，第二项从occ-A错绑occ-B，直接save控制正确。不是静态假设，继续修Main merge的writer槽映射；候选d7不计最终，原package/install/freeze报告归档为candidate-d7e829-*。
- 下一步（本轮）：收口槽映射及完整命名/四侧/范围Electron，重建并安装最终包、Main无对象诊断/唯一成果/重载/正常退出复验后更新文档、commit/push。真实能力待已提出用例的凭据回复，外部服务变更、EXE上传及正式Release不在范围。

### 2026-10-17 免费双接入交付快照（历史，行为在本轮保留并复验）

- 当前任务：免费 Agent 生图工作台与双接入已交付；取消通用版 Pro 门槛、保留账号登录，更新 README/教程与推广文案。广泛 New API/Sub2API 账号适配属于后续目标。
- 接受现场：main / 211307c83fea1324ff05e826c987ef436d8d309d；本轮已有 Goal/Progress/Product Intent/地图草稿，随后完成免费双接入代码、专项回归、最终 EXE 和原位安装。
- 既有交付：第三方署名与教程已推送；工作台优化已本地交付。公开 Release 仍为冻结 v1.0.9，密集拖动性能与正式 CSS 门槛问题继续保留，详见历史交付记录。
- 当前证据：production build、包内审计、原位安装和已安装程序的免费接入/重启专项均通过；根 README、桌面 README、教程、第三方参考入口与推广文案已同步。真实模型、全面 New API/Sub2API 账号兼容和完整登录专项仍未验证。
- Git 交付：源码与文档提交 `0909be79d9620f4430d410844b3b31fa3b5d2c83`（19 files）已普通 push 到 `origin/main`，`ls-remote` 实查远端与本地 HEAD/upstream 一致。本完成记录随纯文档提交归档，最终身份保存在[本地交付索引](.diagnostics/free-access-2026-10-17/delivery.json)。另一任务的 Agent 工作流交接草稿及其三处索引记录保留在工作树，未混入本次提交。
- 下一步：本轮免费接入及文档范围已交付，后续按新需求推进。本轮改动尚未进入公开 v1.0.9，文档已明确区分开发包与公开资产；不把源码 push 视作 EXE 发布。

### 2026-10-17 免费双接入制品、安装与源码交付 / delivered; scoped verification passed

- 打包：`package:win:unrestricted` 完成 NSIS 和品牌安装器；production build 1685 modules 通过。当前[通用版 EXE](release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe) 109,853,696 B，SHA-256 `8dd49ccf4a0dfab85919bcf3ed9d295f435beb9f83e5449d9157c60e8124cab3`；ASAR 52,050,396 B / `1b7c4d9f9526fcd83f64292e14703d93c9f0f18accf4dc300d34b92a09061c5c`。[包内审计](.diagnostics/free-access-2026-10-17/package-audit.json)逐字节核对 122 个 dist 文件与 8 个 Main/runtime owner，确认 dual-access 策略、免费文案和模型入口无 `requireActive`，无 `.env`/诊断目录。
- 安装：[品牌安装器原位升级](.diagnostics/free-access-2026-10-17/install.json) `/S` 退出 0 / 24,920ms；安装前无运行中 SparkAI 实例，注册目录/1.0.9 保留，安装 EXE/ASAR 匹配当前候选。设置与项目列表哈希/时间戳、密钥 sidecar 大小/时间戳不变；密钥内容未读取。未使用诊断绕过、强制退出或清除数据参数。
- 已安装程序实际 UI：[免费接入报告](.diagnostics/free-access-2026-10-17/auth-ui-1792229509852/report.json) `ok:true`，2 次启动、6 项检查、4 张截图。普通运行模式经真实 Main IPC 和 loopback HTTP 验证账号表单保留、过期旧 License 不阻止自定义配置、包含 `/v1` 的地址正确请求 `/v1/models`、真实点击进入项目、普通设置不含测试 Key、重启恢复工作台；0 模型 POST、0 License 请求。已查看免费接入及重启工作台截图。
- 失败证据保留：此前两次 `aidebug:auth-gate` 在 CDP `Runtime.evaluate` 超时，没有形成完整专项通过报告；原始记录在 `.diagnostics/electron/aidebug-2026-10-17T09-14-31-700Z/` 和 `09-17-23-978Z/`。安装版首轮输入脚本没有全选原地址，拼接出的无效 URL 被表单拦截；[首轮报告](.diagnostics/free-access-2026-10-17/auth-ui-1792229425233/report.json)保持失败，修正测试输入后上条复验通过，产品源码未再修改。
- 文档：补充仓库根 README、桌面 README 的四个参考项目署名入口，保留固定上游版本/许可证说明；更新教程、双接入说明和[推广文案](docs/PROMOTION_COPY.md)。免费指软件使用，模型费用由所接服务商收取；免费自定义接入属于本轮开发包，公开 v1.0.9 未替换。未上传 EXE、未创建 Release/tag，原正式 CSS 与密集拖动性能限制仍属历史待解决边界。
- 收尾核对：[本地 preflight](.diagnostics/free-access-2026-10-17/preflight.json)通过，UI 测试后 3 个日常配置表面与安装 EXE/ASAR 身份均未变；本轮新增 27 处本地文档链接、Harness 10 项及差异检查通过。时间戳由 .NET 原精度比较，避免 Node 毫秒取整差异；密钥内容未读取。只验证了 Electron 免费接入实际路径，浏览器开发回退没有新增 UI 实测，完整账号登录/登出套件仍保留前述未完成边界。

### 2026-10-17 免费双接入运行时实现 / partially verified

- 已修改桌面 Renderer、Electron Main、Server IPC 和浏览器回退桥：通用版通过账号登录或 Base URL + API Key 进入工作台；Agent 对话和图片请求不再调用 `licenseService.requireActive()`；自定义配置返回本地免费状态。SparkAPI 专用版的构建期 `customApiAccess=false` 限制仍保留。
- 旧 `LicenseStatus` 类型、IPC、设备字段和 `desktop/license-service.cjs` 未删除，用于旧设置/旧扩展兼容；新版正常产品入口不访问远端 License 服务，也不显示兑换码。旧 Electron License IPC 仍保留显式 verify/activate 能力，浏览器开发回退状态查询本地返回免费状态。全面 New API/Sub2API 账号协议兼容仍是后续目标。
- 实际验证：`test:access-variant`、`test:custom-api-transport`（40 cases）、`test:ipc-registration`（152/149/3）、`test:license`（9 cases）、`test:agent-protocol`、`test:image-generation-service` 和 `typecheck` 均退出 0；未发起真实模型请求。此 checkpoint 当时尚待 build/EXE/安装/Git，后续结果见上方交付记录。

### 2026-10-17 Agent 工作流、图片上下文与更新功能交接 / documentation completed; implementation pending

- 用户追加范围：诊断 `ask_user` 选项不弹出、`view_image` 未可靠进入模型 continuation、参考图可能未进入 generation request、更新检查 `Invalid URL`、运行中图片范围入口冗余；并增加图片容器基于内容命名、Agent 读取勾选图片及有效配置、真实生图参数学习/脱敏记录、上下左右四向连线。
- 已确认 owner：`src/ask-user-dialog.tsx`、`src/main.tsx`、`agent-runtime.cjs`、`runtime/tool-schemas.cjs`、`desktop/agent-responses-adapter.cjs`、`desktop/new-api-client.cjs`、`desktop/updater-service.cjs`、`src/project-agent-composer.tsx`、`src/image-content-title.ts`、`src/styles/02-canvas-workspace.css` 及现有 AIDebug/更新专项。现有 TaskScope、selection、imageParams 和 graph 语义必须复用。
- 交接文档：[Agent 工作流、图片上下文与更新功能交接](docs/AGENT_WORKFLOW_UPDATE_HANDOFF_2026-10-17.md)，包含截图证据与代码事实区分、诊断 trace、local Mock、八个工作包、验收矩阵、安全边界和交给 `gpt-6.1-sol max` 的完整 Prompt。
- 本轮状态：只新增交接/索引和 Goal/Progress 记录，未改产品代码；未进行真实图片/视频/对话/更新请求，未索取或保存 Base URL/API Key，未生成/安装 EXE，未 commit/push。本文件不宣称上述功能已完成。
- 后续验收：执行 Agent 需先用 deterministic model/HTTP Mock 分层定位，再做真实 Electron 交互、typecheck/build；产品代码改动后按桌面规则生成并安装 EXE，分别记录制品、安装、文档和 Git 结果。真实联调仍需用户明确授权具体次数、模型和素材。

### 2026-10-17 免费双接入方向变更 / in progress

- 用户把产品定位收敛为免费的“Agent 生图工作台”：保留 New API/SparkAPI 账号登录，同时让无限制版的 Base URL + API Key 直接可用；后续接入 New API、Sub2API 等兼容服务时沿用同一双接入模型。
- 影响边界：旧 src/auth-gate.tsx、src/main.tsx、desktop/ipc/server-ipc.cjs、electron-main.cjs 仍把自定义模式绑定到 Pro License；本轮将移除这些运行时门槛，保留旧 License IPC、设备字段和 Extension 文档作为兼容能力，不修改外部 New API 或 Extension。
- 文档边界：README、教程、PRODUCT_INTENT.md、双接入说明、桌面/工作区上下文地图需要同步“软件免费；模型调用费用由用户自己的账号或 API Key 对应上游承担”，不能继续把 Pro 兑换码写成当前必需步骤。
- 计划验证：test:access-variant、test:custom-api-transport、test:ipc-registration、test:license（兼容回归）、typecheck、production build；随后按桌面规则生成并核对 Windows EXE、品牌安装器原位升级、安装身份和 Git push。真实模型、真实 New API/Sub2API 和正式 Release 仍不验证。
- 当前工作树：main，接受方向前工作树干净，远端与本地同步；本条记录建立后开始实现，后续每个测试/打包里程碑追加实际证据。

### 2026-10-17 第三方署名与教程交付 / completed

- 当前任务：整理公开 README、第三方参考与许可证说明，并补充主分支新增能力的教程；本轮只改文档，不改软件、制品或服务。
- 接受现场：根仓库 `main` / `dd1d170f5077c372cec026fd2669ad71bcc5b85b`，工作树干净；`origin/main` 实测与 HEAD 一致。上游许可证已查询固定 commit：New API AGPL-3.0、Sub2API LGPL-3.0、GPT Image Playground 与 Infinite Canvas MIT。
- 既有产品状态：工作台优化实施已完成本地交付，阶段5部分验证；性能回归、正式 Bundle CSS 门槛及真实服务未验证情况见下方 2026-10-17 交付记录。该主分支开发包不是新的正式 Release。
- 完成：新增 [第三方参考项目与许可证](docs/THIRD_PARTY_REFERENCES.md)，固定列出 New API `973cf8e`（AGPL-3.0）、Sub2API `b8dece9`（LGPL-3.0）、GPT Image Playground `cdc171d`（MIT）和 Infinite Canvas `3a6b64b`（MIT），并说明它们是兼容/交互参考而非桌面运行时依赖；README、文档索引和教程索引已区分公开 v1.0.9 与主分支开发版。
- 新增教程：[模型连接与运行状态](docs/tutorials/05-model-connections-and-status.md)和[安全恢复图片结果](docs/tutorials/06-recover-image-results.md)，均明确开发版适用范围。根 `node scripts/verify-harness.mjs` 10 项通过，改动文档 `git diff --check` 通过，本地 Markdown 链接检查通过。
- 交付边界：本轮为文档整理，不重打包、不新增真实模型请求。提交 `935eb61` 已普通推送到 `origin/main`，随后以远端 `ls-remote` 核对；工作树在收尾后保持干净。

### 2026-10-17 最终交付 / delivered; performance partially verified

- 首次最终候选EXE已完成审计并原位安装：安装器退出码0、配置3项保留，身份见[安装报告](.diagnostics/workspace-optimization-install.json)。随后真实安装程序在884×640下复测发现画布与Agent高度约18,081px；失败证据为[150% DPI](.diagnostics/workspace-layout-config-2026-10-17T06-28-25-328Z/report.json)和[100% DPI](.diagnostics/workspace-layout-config-2026-10-17T06-35-34-399Z/report.json)，根因为`src/styles/06-responsive.css`的`max-width:900px`把正式最小窗口884px切成纵向布局。该候选EXE `109,858,304 B` / SHA-256 `7c2dc05a45d204bb097354f794816fdfe1c504ca50b115a94c5c474501b39657`不作为本轮交付结果。
- 修复已将窄屏断点改为883px；`test:production-symbol-compaction`验证883px媒体块从生产CSS移除、884px块保留。修复后[真实Electron布局/配置专项](.diagnostics/workspace-layout-config-2026-10-17T06-49-35-476Z/report.json)通过：884/1280/1920×640/820/1080边界布局、画布472px与Agent348px、工具搜索/键盘命中、保存失败重试和重启读回均通过，0模型POST/目录GET。
- 最终包由[包内审计](.diagnostics/workspace-optimization-exe-audit.json)验证：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`为109,854,720 B，SHA-256 `b9f42418f252f8a02235b772d685b40e64f17ca3508ee0b31aedb0c7546634b0`；123个dist文件和17个Main/runtime owner与候选ASAR/源码一致。品牌安装器`/S`退出码0、耗时24,009ms，沿用`E:\sparkai-workspace\naimage`、注册版本1.0.9；安装EXE 232,754,176 B / SHA-256 `606264f3f14eaf409f997a9cbd8db5d8c02d687164b08f2e9c8e6fb4a6e22343`，安装ASAR SHA-256 `3f0309145dc245f1afb0ac378fc9dceb92062e1f8fdf0e378e4df8a5d95722b`与候选相同。`app-settings.json`与`project-list.json`哈希不变，secret sidecar大小/时间戳不变且未读取内容；摘要见[最终安装记录](.diagnostics/workspace-optimization-install-final.json)。
- 安装版[布局与配置](.diagnostics/workspace-layout-config-2026-10-17T07-06-19-398Z/report.json)在150% DPI通过两次应用启动、12项、7截图；884×640画布472px/Agent348px、无溢出，工具搜索/保存失败恢复/重启读回通过，0模型POST/目录GET。[双连接故障隔离](.diagnostics/image-generation-failure-ui-2026-10-17T07-08-08-080Z/report.json)使用本地HTTP模拟通过：1次图片POST、3轮模拟Agent、A连接502失败不传播到B、0真实请求/无敏感信息泄漏。
- 状态：最终候选已安全原位安装并验收，未上传/未发布Release。阶段5的500/1000拖动视觉P95回归、33.4ms建议目标未达；正式`test:bundle` CSS为281,539 B，超270,000 B硬门槛11,539 B；真实供应商协议/生图仍未验证，150% DPI最大窗口只能达到1708×934，1920×1080未覆盖。源码与文档commit `9c8967f5ed069c71d8d1565721827ff762b98989`已push，`origin/main`实测指向同一commit，工作树干净。

- [06:10画布复验](.diagnostics/workspace-optimization-ui-2026-10-17T06-10-19-345Z/report.json)ok:true，150% DPI/28项/8截图；精确坐标与恢复断言通过，已人工核对双端屏外关系截图。最终typecheck、view-image、IPC152/149和automation契约通过。quick GUI六场景仅最小窗旧`projectAgentFixedOk`失败（要求350–430，实际348，截图/溢出均通过）；按现有320–720偏好边界并额外要求画布≥463修正测试，06:13 quick GUI [通过](.diagnostics/electron/aidebug-2026-10-17T06-13-13-434Z/report.json)，未改产品尺寸。
- 同一canvas专项100% [.diagnostics/workspace-optimization-ui-2026-10-17T06-15-15-494Z/report.json]、125% [.diagnostics/workspace-optimization-ui-2026-10-17T06-16-11-433Z/report.json]均28项/8截图通过；连同150%共3档。`test:bundle`已按开发规则运行：initial JS 4,133B、plugin JS 86,177B通过硬限；CSS281,539B超正式270,000B硬限11,539B；core async1,327,603B/core JS1,331,736B/dist1,763,981B为advisory超限。命令退出1，正式release不满足；开发包按AGENTS可继续，保留数值，不为门槛机械拆分。
- 已复核main / 15a126b和全部未提交改动，保留接受时文档与此前实现。06:04恢复UI报告ok:true（5次启动、8次本地POST/6 polls）；保存失败列表已刷新并保留本地恢复入口。
- 06:05画布报告前27项通过；新增双端屏外关系断言失败。实际坐标A1298/C2025均在复位视口右侧，原因是公开nudge沿用视口夹紧，未构成穿视口夹具。仅修测试：跟随目标切换viewport、断言精确坐标、恢复原位置，再运行真实Electron；不据此改产品几何。

### 2026-10-17 最终本地验收收口 / verification in progress

- 当前源码最终候选bundle `020daad12aa2ea8d32bd17ce65be90cb326aef092465ec6cf4a494f9a8880499`。100/500/1000及标准前后数据汇总在[性能比较](.diagnostics/workspace-optimization-performance-comparison.json)，排除注入CSS/强制合成层试验。标准三轮原门禁通过；100小场景平移109.8→16.6ms、拖动130.1→45.6ms；500/1000加载与平移改善，但拖动P95分别397.6→499.5ms、477→816.1ms回归，明确未达，不以事件回调耗时或平均帧掩盖。33.4ms建议目标未达。
- [12轮内存循环](.diagnostics/electron/product-performance-2026-10-17T06-02-18-194Z/report.json)实际切项目/打开原图查看器/交互：GC后JS6.92→7.69MiB，第7–12轮7.45–7.69MiB；8进程树私有内存第7–12轮933.16–983.54MiB、末轮936.36MiB，Working Set约834–853MiB，有限循环内波动趋于平台，不能据此承诺无限运行无泄漏。匹配前后比较仍使用6轮100节点报告。
- [混合100节点本地视频](.diagnostics/electron/product-performance-2026-10-17T06-00-54-049Z/report.json)：有效640×360/2秒WebM，播放帧5→59，时间0→0.11669s后继续至1.430818s；画布缩放/平移/拖动与21条Mock进度共存，暂停/切项目后播放数0，0真实模型请求。播放与交互后两张截图已核对，播放器保持可见。恢复UI补充复验和最终交付继续。

### 2026-10-17 性能收敛后续 / verification in progress

- 当前源码bundle `020daad12aa2ea8d32bd17ce65be90cb326aef092465ec6cf4a494f9a8880499`：[标准三轮](.diagnostics/electron/product-performance-2026-10-17T05-55-21-221Z/report.json)，ready2889ms/boot1969.3ms/heap15,126,276B，视觉P95 zoom78/pan40/drag92.9ms、long task0，原门禁通过。[1000混合三轮](.diagnostics/electron/product-performance-2026-10-17T05-51-34-093Z/report.json)ready26,071ms、zoom353/pan66.5/drag816.1ms，选择1000/初始挂载9、最终关系285；加载/缩放/平移改善，拖动P95回归保留为未达项，不能称全部性能通过。[500混合](.diagnostics/electron/product-performance-2026-10-17T05-56-22-870Z/report.json)ready12,651ms、zoom226/pan62.3/drag499.5ms，仍有起始拖动长帧。持续强制合成层的忽略目录对照出现14,962.3ms拖动长帧，明确排除，不进入产品；最终汇总必须排除带compositorProbe/edgeMotionProbe的试验报告。100节点内存、视频与交付验证继续。
- 曲线几何纯测试通过3000组采样/356组有可见点，双端屏外曲线保留；[候选三轮](.diagnostics/electron/product-performance-2026-10-17T05-48-29-025Z/report.json)关系挂载285、ready23,387ms、zoom338.8/pan74.4/drag863.8ms，拖动仍有起始长帧。候选还额外强制拖动次选从概览升级为完整图片表面，引入手势时才加载图片；撤回该额外升级，保持原概览级别的可拖组件，后续作为最终测量候选。
- [实际表面复杂度候选](.diagnostics/electron/product-performance-2026-10-17T05-40-49-175Z/report.json)单轮zoom491.3/pan92.3/drag741.4ms；尚未回到拖动基线，不算阶段5达标。进一步在既有关系owner加入与实际path同源的曲线相交计算，收敛控制点外框的误保留，同时保护播放视频的可见性；纯几何与最终本地场景待验证。
- ea03f4b[1000三轮](.diagnostics/electron/product-performance-2026-10-17T05-30-38-928Z/report.json)ready24,282ms、zoom80.1/pan77.3/drag996.5ms，canonical1000/overview196，拖动仍回归。[正确暂停动画的对照](.diagnostics/electron/product-performance-2026-10-17T05-38-20-304Z/report.json)明确以稳定data属性验证动画为none，仍drag969.9ms；不把该假设当优化成果，不改产品动画。渲染轨迹显示较长GPU栅格化；检查发现概览未挂载的图片仍计入复杂度，使视口操作隐藏关系层并96ms后整体恢复，拖动长帧集中于恢复时。下一候选统一概览集合/实际完整表面计数，同时保留拖动节点完整显示；最终测量待执行。
- 最新源码[标准三轮](.diagnostics/electron/product-performance-2026-10-17T05-29-50-659Z/report.json)ok:true/everyRoundHealthy:true，bundle `ea03f4bc995b3a841a38351eb5a0bce4cf9a0c623289419497e94455e2944276`：ready3009ms/boot2115.9ms/heap12,073,924B，视觉P95 zoom70.2/pan43.2/drag86.4ms，慢帧率12.5%、操作long task58ms；33.4ms建议仍未达到。05:27运行只有首轮截图，无完整报告，发现即使awaitPromise:false也会与同步关闭Renderer竞争；测试改为先确认CDP求值后100ms触发正常关闭，并在断连时拒绝未决请求，不把退出0算成功。重跑复用同bundle，三轮全部正常退出，有截图。
- 混合100节点/本地视频发现实际功能回归：缩放后非主选播放器被概览/视口虚拟化卸载（`perf-delivery-video.log`中paused为undefined）。下一步在原Renderer渲染集合加入项目隔离的临时播放状态，暂停/结束/删除/切项目释放；随后重新测量当前源码，不沿用旧bundle的成功结论。
- 有界SVG[1000节点三轮](.diagnostics/electron/product-performance-2026-10-17T05-17-53-754Z/report.json)拖动P95仍845.3ms，无改善，已撤回绘制面改动。继续定位发现全选会绕过既有低缩放概览，197个可见次选仍挂完整图片表面。现让次选使用原概览、保留selected/aria-pressed，主项/活动项/运行任务完整；probe及真实交互增加canonical数量和概览高亮断言，尚待新测量决定是否成立。
- 有界关系SVG后[标准三轮](.diagnostics/electron/product-performance-2026-10-17T05-16-12-958Z/report.json)全部原门禁通过：ready2799ms/boot1900.9ms/heap12,186,144B，视觉P95 zoom71.5/pan39.5/drag79.2ms、慢帧率8.33%、操作long task 0。仍未达到33.4ms建议目标；100/500/1000最终混合后测继续运行。
- [本地视频基础验证](.diagnostics/electron/product-performance-2026-10-17T05-17-36-453Z/report.json)ok:true：640×360/2秒WebM实际解码播放，时间0→0.088s，画布交互与21条本地Mock进度共存，0真实模型请求。混合100节点视频及持续帧断言继续验证。
- MediaRecorder在当前远程桌面仅产生110字节EBML头，即使挂载/显式帧请求也无轨道；以本地Sharp编码VP8关键帧和有界WebM容器替换夹具，不安装依赖、不修改产品视频协议。先前error4只证明无效素材不能播放，协议stream权限试验已撤销；原失败报告保留。
- 工具栏稳定尺寸订阅后标准门禁通过，但密集hub拖动回归仍在首轮后测中；暂停动画的旧CSS实验未适配生产类名，不能用其结果判断动画成本。后续使用稳定data属性的隐藏关系诊断仅用于定位绘制成本，实验副本留在忽略目录，正式测量脚本已移除隐藏开关；产品不隐藏关系。当前仅收敛关系SVG绘制面，世界坐标、端口与原路径不变，最终前后测及UI验收尚待收口。

### 2026-10-17 真实资产性能前测 / measured, not within budget

- 首轮[1000节点后测](.diagnostics/electron/product-performance-2026-10-17T04-54-01-669Z/report.json)真实选择1000项/挂载9组件，ready23,873ms、heap27,901,244B；zoom258.5/pan247.1ms改善，drag830.9ms较前测477ms恶化。保留失败结果并补[CPU profile](.diagnostics/electron/product-performance-2026-10-17T04-59-02-112Z/round-1/renderer-interactions.cpuprofile)：主要JS热点为工具栏useLayoutEffect的getBoundingClientRect（两处原生调用208/342 samples）。children每次父渲染重建导致重复强制layout。修为稳定command身份、容器与各按钮真实ResizeObserver触发，重跑最终后测；不以响应事件返回快替代视觉帧结论。
- 额外[Main hydration剖析](.diagnostics/hydration-profile-before.json)：旧Renderer退出后已持久化为2000节点的诊断项目，独立hydrate19,346.8ms/save13,283.6ms；27,465次realpath合计24,918.2ms、27,450次exists约4,975ms。它定位重复根目录解析热点，不作为1000节点启动数字。计划只在同步单次hydrate/save复用项目根解析，保留逐文件校验与操作间重新检查；随后以同一2000节点项目复测和路径安全回归。
- [1000节点三轮](.diagnostics/electron/product-performance-2026-10-17T04-37-55-554Z/report.json)每轮运行健康，但预算失败。1000节点/999条hub关系/500消息、2K/4K PNG/JPEG/WebP、真实Ctrl+A；就绪中位72,687ms、boot71,744.8ms，选中1000项后实际挂载1000组件；视觉帧P95 zoom1026.9/pan1706.3/drag477ms，操作long task最大2080ms，heap54,131,792B。
- 旧Renderer冻结bundle SHA-256 `8dcc08d3abc479e3483e0393bbfaf4f7a1e152b375ec194697f273d29a9e2b01`；同机器/1280×720/DPR1/暗色/每轮隔离冷应用缓存、共享系统磁盘缓存。100/500早期有效前测使用文件复制，1000用同卷hard link；为严格比较，100/500以hard link夹具补测，后测保持同一脚本与素材字节。未改预算，不把运行健康当成性能通过。
- 当前源码只针对测到的屏外次选及一跳关系强挂移除完整组件，保留canonical选择和关系几何。标准及混合后测、视频和内存循环尚在执行，不能提前宣称提速。

### 2026-10-17 画布与恢复扩展通过 / verified locally

- 布局配置[125%](.diagnostics/workspace-layout-config-2026-10-17T04-18-55-790Z/report.json)与[150%](.diagnostics/workspace-layout-config-2026-10-17T04-19-38-054Z/report.json)均ok:true，各12项/7截图/2次启动；修正后的搜索标签实际截图可读。实际884最小窗画布472px/Agent348px，恢复650px偏好；150%最大窗受屏幕约束实际1708×934，未声称该DPI下达到1920。自动保存失败/重试/重启与主独立Agent同源均通过，0模型POST/0目录GET。
- 阶段5内存夹具首次真实查看器断言失败，最终定位到图片原放output根目录，被既有受管资产规则排除；须位于output/imagegen或assets。旧03:57/04:02及04:20—04:25的失败记录保留，不能作为完整2K/4K解码验收。更新受管目录、assetUrl、独立路径/合法occurrence与实际解码/查看器断言后重新测量；后续用同卷hard link减少重复夹具字节复制，不改解码字节。标准无图片基线不受此夹具问题影响。

- [150%画布](.diagnostics/workspace-optimization-ui-2026-10-17T04-17-22-798Z/report.json) ok:true /28项/8截图。真实CDP指针覆盖连接头轻点、Escape/pointercancel/空白取消、实际建边及单undo；框选跨Agent捕获未挂载D，回视口高亮且Agent SOURCE一致。Computer Use正常激活隔离Electron再切Chrome，收到isTrusted blur，拖动坐标与选择均回滚。
- 重载验收发现无createdAt的旧节点会重复：Renderer sanitizeNode曾先补展示时间再生成legacy origin，与Main原始空日期不一致。现两侧统一以原始字段生成origin，展示日期独立；实际重载断言严格5节点、资产与关系保留。
- [恢复扩展UI](.diagnostics/image-recovery-ui-2026-10-17T04-18-15-377Z/report.json) ok:true，5次Electron启动、8个本地创建POST/6次poll，0真实请求。真实session原子写失败显示脱敏错误，重试只做本地保存、不增加POST/poll/节点；取消accepted任务本地等待后重启恢复原task。CLI、4xx/429/502/断连/缺taskId不重放、部分成功、二次重启稳定身份均通过。服务10进程蒙版证据仍保留。
- 下一步：布局125/150%复验与性能同条件后测；尚无本轮EXE/安装/Git交付。

### 2026-10-17 布局配置首轮通过、遮罩恢复补齐 / partially verified

- [布局配置GUI](.diagnostics/workspace-layout-config-2026-10-17T03-45-17-007Z/report.json) ok:true，100% DPI、2次Electron正常启动/退出、7截图，0图片POST/0目录GET；884×640画布472px/Agent348px/输入323px，无横溢；1280/1920恢复650px偏好。搜索/键盘/菜单滚轮、实际registry模板动作、最近使用落盘通过。真实原子保存失败阻止完成/Escape静默关闭，重试和快速数量修改后重启读回5张/3:2；独立Agent /config同源。修复菜单行样式与DialogShell抢占portalled下拉Escape的真实UI问题。
- [遮罩恢复](.diagnostics/image-recovery-x6Rh9i/report.json) ok:true，10个子进程，1POST/3poll/2download；原结果合成连续失败仍保留processed:false，第三进程恢复蒙版内绿/外蓝，源realpath/hash与已保存资产缺失校验补齐。
- 画布扩展首20条通过的[中间报告](.diagnostics/workspace-optimization-ui-2026-10-17T03-46-10-964Z/report.json)整体仍ok:false，关系线中点被节点遮挡导致夹具右键命中错误，正在修正可见hit-target采样。新增Ctrl SOURCE、空框、不同zoom的CSS阈值/提交/单undo、resize和pointercancel、容器槽位；不能计完整阶段通过。
- 性能测量发现原脚本左键拖空白现为框选，阶段5先修正为中键平移并建立新基线；旧pan数字仅作历史，不与新合同混算。尚未实施性能优化，无EXE/安装/push。

### 2026-10-17 扩展画布与性能前测 / in progress

- [125%画布](.diagnostics/workspace-optimization-ui-2026-10-17T04-01-07-217Z/report.json) ok:true /25条/6截图；新增真实滚轮、Space在pan工具中不反转、关系线菜单、过期菜单拒绝及项目重载。检查发现过期提示只写设置页消息，已补画布状态栏；后续150%扩展连接/世界框选仍在运行，中间失败报告保留。
- 人工复核布局配置截图发现快捷键的双平台ARIA字符串挤没了首项标签；改为同一registry的人类可读快捷键、ARIA保留语义，工具搜索宽度提高选择器精度，并新增标签可读宽度断言。待新GUI验证。
- 修正输入合同后的[标准三轮前测](.diagnostics/electron/product-performance-2026-10-17T03-55-44-537Z/report.json) ok:true：ready3353ms/boot2076.8ms/heap12,245,780B；视觉zoom71.5/pan37/drag82ms，建议33.4未达。旧1000混合初测03:57保留；当时select-all session字段未被产品读取，不能据此声称多选。
- [1000混合+999 hub关系+实际Ctrl+A前测](.diagnostics/electron/product-performance-2026-10-17T04-02-16-480Z/report.json)三轮完整、ok:false：ready17370ms/boot16471.3ms/heap69,460,500B，视觉zoom976.9/pan1944.5/drag385ms，long task2261ms；预算原样保留。实际多选会强挂全部屏外组件，关系也会在初始可见区扩展屏外节点。按测量仅去掉次选/关系强挂，保留主项/活动任务与独立几何绘线；后测待运行。
- 恢复补充夹具加入真实session原子写盘失败、可见错误、重复本地保存无POST/poll，以及取消本地等待后重启查询原任务。Main session写失败返回脱敏中文并不推进已应用revision；这些最新场景待运行。

### 2026-10-17 恢复首轮通过，布局配置在制 / partially verified

- Main应用链审查修正：`operation`原为generate/edit语义，曾被误当journal记录，已拆为`operationRecord`，真正提交前和accepted事件现在落盘。服务恢复测试7个Node子进程通过：[报告](.diagnostics/image-recovery-o0thHP/report.json)，1 POST/3 polls/2 downloads，含换凭据拒绝、429查询、503下载、ENOSPC、缓存重启、不确定不重发、部分成功与敏感扫描。
- [应用级恢复报告](.diagnostics/image-recovery-ui-2026-10-17T03-19-59-214Z/report.json) ok:true，4次Electron启动，7个独立模拟场景各1 POST/合计4 polls；受理后崩溃、重启GUI原任务恢复、重复恢复和项目再重启保持1份资产/节点，实际隔离PowerShell CLI成功。4xx/429/502/断连/缺taskId均不重放，两图一坏保留成功项；0真实请求。03:13/03:16/03:18夹具失败报告保留，不能计通过。
- 新合同：Main项目journal、原结果二进制暂存、`image.operations`/`image.recover` GUI/共享命令/CLI/MCP、2个IPC同步，注册152 invoke/149 preload；图片成功DTO不再透传provider URL/base64。遮罩原结果与处理描述已接入，续接审查修正失败slot处理标记丢失、已保存文件缺失检查和恢复请求元数据；这些最新补充待验证。
- 阶段4在制：工具条使用常用入口+全部工具搜索/领域分组/最近使用，沿用command registry和MenuSurface；小窗临时夹紧与用户宽度偏好分开；图片配置cacheOnly打开、保存串行/失败重试/关闭保护；共享模型默认/quality政策。首轮续接typecheck发现设置归一化引用遗漏已修正，随后typecheck、layout16项、settings155项、image service和view-image通过；最新扩展改动仍待编译/UI。
- 新增设置`canvasWheelMode`、`recentCanvasToolCommands`和共享纯策略`canvas-wheel`；轮滚按明确模式和deltaMode处理，默认鼠标锚点缩放、可选双指平移、Ctrl/Meta捏合缩放，不猜设备。

### 2026-10-17 接口收口与画布首轮 / partially verified

- 接口补充：Main复用真实凭据解析生成脱敏connectionSummaries；账户Key摘要仅使用内存缓存，不联网取Key。Renderer按当前connectionId/协议/传输过滤证据，逐模型与全局草稿更改均失效。一次旧连接迁移冻结原Sub2API出口并记录legacy-migration；新连接不按域名字符串推断异步；不支持的协议/参数派发前拒绝。
- 新失败与修正：摘要异步化后，server-ipc缓存登录分支未await DTO导致启动等待；已修正全部调用方。中间失败报告02:44/02:49原样保留，不计通过。最终[本地HTTP Electron](.diagnostics/image-generation-failure-ui-2026-10-17T02-51-57-607Z/report.json) ok:true，双Key目录/失败归属隔离，1图片POST/3Agent轮次，错误可见且脱敏；0真实请求。model-ux/runtime-evidence/typecheck与selection/canvas-commands通过。
- 画布实现：轻点/空框保留；中键与Space覆盖作品平移；pan/marquee/node/resize/connect取消分离；框选使用canonical projection世界几何与rAF预览；节点移动阈值5px，resize临时DOM预览/最终一次提交；右键未选B只操作B且保留集合，空白保留创建与集合动作分组，菜单记录项目revision/槽位身份并拒绝过期；图片计时器清理，慢双击窗口500ms。旧产品文字/快捷键提示已同步。
- 首轮[真实Electron指针报告](.diagnostics/workspace-optimization-ui-2026-10-17T02-59-36-965Z/report.json) ok:true /12条/4截图：空白、A/B多选右键C、只选C、中键作品平移、Escape回滚/集合保留、Space作品平移、节点取消坐标不变、blur框选取消、340ms慢双击编辑。尚未覆盖全部DPI、菜单过期/锁、重载和resize/连线边界，不把这12条当完整阶段2验收。
- 阶段3在制：新增Main项目`.naimage/image-operations/journal.json`，提交前记录operationId/requestIndex/连接身份，accepted立即持久化taskId，结果只在内存或二进制暂存，不落Key/URL/base64；恢复只查询原任务或处理已有字节，禁止新POST。GUI/IPC/共享image.operations、image.recover命令同步中，重启/失败矩阵尚未运行。

### 2026-10-17 阶段0基线与阶段1归属修复 / partially verified, in progress

- 修复：`modelConnectionIdentity` 使用归一化真实URL与Key内部指纹；Main请求在凭据实际解析后冻结身份，只回写精确profile，不给同provider其他连接补模型。画像schema v2追加协议/传输/操作/参数范围/阶段/时间/脱敏类别；缺身份证明的旧成功降为历史。图片上游响应和受管资产交付分开观察；摘要纯策略移至既有`src/model-ux.ts`，较新失败优先于旧成功，显示失败时间，落盘失败单列。
- 专项：`test:model-runtime-evidence`、`test:model-catalog`、`test:custom-api-transport`（40项）、`test:image-generation-service`、`test:image-generation-async`、`test:model-ux`、`typecheck`通过。服务自测原新增断言未提供回调，已用传入回调补齐同步/异步透传验证。
- 本地HTTP Electron：[报告](.diagnostics/image-generation-failure-ui-2026-10-17T02-33-28-651Z/report.json) ok:true；A/B两个Key身份不同，各自目录模型隔离，A失败只记A，B无新模型/运行观察；1次图片POST、3轮Agent模拟请求，中文错误可见、无敏感正文，截图`main-error.png`。0真实模型请求。
- 阶段0：[三轮性能报告](.diagnostics/electron/product-performance-2026-10-17T02-19-46-552Z/report.json) ok:true / everyRoundHealthy:true，1000节点/199关系/500消息；工作区就绪中位2783ms、Renderer1854.5ms、heap11,367,888B、交互Long Task最大0ms；视觉缩放P95 73ms/拖动99.2ms仍未达到新增33.4ms建议目标。运行时Bundle1,766,837B超1.2MB advisory，未改阈值。全部轮次正常退出0并有截图。
- 测量限制：先前两次运行（01:55与02:16）仅有第一轮截图，无最终报告，不能计基线。根因为关闭IPC销毁Renderer导致CDP等待未决；运行器改为不等待关闭Promise后生成完整报告。尚未覆盖100/500、真实2K/4K混合素材和内存循环；后续阶段5扩展。
- 尚未完成：当前配置身份/协议变化的完整摘要与迁移、其余阶段验收、最终EXE、安装和Git同步。真实OpenAI/xAI/Gemini/Sub2API/Extension/Seedance服务均未新增验证。

### 2026-10-17 优化实施 / accepted, in progress

- 契约见Goal顶部。设计§5的中键平移/左键框选/Space临时平移替代旧产品文字；其他已接受产品工作与历史证据保持。
- 尚未运行本轮测试/基线、生成EXE、安装或push；不会把源码检查当交互/恢复/性能验收。

### 上一轮状态快照（2026-10-16，历史）

- 当前任务：按用户要求固化[工作台优化设计与执行交接](docs/WORKSPACE_OPTIMIZATION_DESIGN_2026-10-16.md)，documentation completed / verified；产品实施待启动。已核对 main / 15a126b、当前源码和已有截图/报告；设计覆盖六个工作包，含第 12 节执行 Prompt，本轮不改变产品行为。
- 评审证据：本地纯函数复现确认运行验证标记会传播到其他同 provider 连接；源码显示空白点击/中键契约与产品文档不一致、框选取消与提交共用处理，以及 Sub2API 传输依赖地址推断。已有截图与工具栏记录用于布局设计；性能项属于待测量候选，没有新性能达标结论。
- 最近功能交付：Grok 502 定位及客户端防重复生图修复已完成，客户端/EXE/安装/Git同步verified。真实单张测试各一次（现有连接4.649s，用户新增连接1.159s）均返回HTTP502，没有图片且均无重试；用户表示渠道端若无法修复就到此为止，已停止真实请求。28项模拟回归及开发/已安装程序的主Agent隔离UI通过：错误可见、无敏感上游文本、一次图片POST、模型试图再次生图被阻止。渠道端故障未恢复。
- 最新本地EXE（2026-10-16开发包）：[无限制版1.0.9安装包](release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)，109,842,944 B，SHA-256 `8a8d06f5fe1cb6fba86ab4cbbbe90fc57021f3a65a76c95d62419232d3191427`。production build/打包退出0，122个dist文件及8个Main/runtime源码与包内精确匹配；[制品审计](.diagnostics/grok-fix-2026-10-16/package-audit.json)。未上传二进制或发布Release，正式CSS门禁沿用下方历史未通过边界。
- 安装与包内验证：[原位安装](.diagnostics/grok-fix-2026-10-16/install.json)退出0 /25.146s，注册目录/版本/3个配置表面保留，EXE及ASAR匹配；[已安装UI](.diagnostics/image-generation-failure-ui-2026-10-15T23-56-41-348Z/report.json)ok:true，截图已核验，一次图片POST/三轮对话均为本地模拟、无新真实请求。[测试后核对](.diagnostics/grok-fix-2026-10-16/installed-ui-verification.json)确认日常配置、安装身份及8个源码owner未变，无残留同名程序；未读取secrets内容。
- Git同步：源码/测试/上下文11个文件提交`5a270e649530fa6821ef871949b7e2ec16f371e8`已普通push到origin/main，[实查记录](.diagnostics/grok-fix-2026-10-16/git-source-push.json)确认远端/本地/缓存upstream一致且当时工作树干净；本完成记录单独随纯文档提交归档，最终分支/制品/安装身份汇总见[交付索引](.diagnostics/grok-fix-2026-10-16/delivery.json)。
- 下一步：用户将 Prompt 交给 gpt-6.1-sol 后，从设计阶段 0、1 开始持续实施；Grok 渠道仍停止真实请求。快照中的 EXE/Git 与2026-10-15记录均是已有功能交付证据，不是本次设计已实施的证明。

### 2026-10-16 优化设计文档交付 / documentation completed, verified

- 变更：新增 470 行设计与执行交接文档，记录当前证据、候选交互合同、六个工作包/实施阶段、owner、专项验收、性能基线、交付流程与完整 Prompt；Goal/Progress、docs 索引与上下文地图只补设计导航，不将候选合同登记为已实施。
- 验证：Node 本地只读检查 5 个文档、61 处链接、13 个 package.json 命令、13 节编号与代码围栏全部通过；git diff --check 通过。工作树仅包含本轮 5 个文档变更，未修改业务源码。
- 边界：本轮文档不触发产品构建/EXE/安装或打包后的 Git 提交推送；没有新 GUI、性能基准、真实服务请求或发布。此前本地纯函数复现和历史截图/报告的证据范围见设计第 2 节。
- 后续：用户明确执行后，先登记实施 Goal，从基线和接口验证归属修复开始，按阶段验收；不能把这次文档验证当作产品功能验证。

### 上一轮状态快照（2026-10-15，历史）

- 最新用户请求：优化逐模型连接/密钥布局、图片配置勾选与默认操作，窗口从四边四角均可调整；所有子代理统一 `gpt-6.1-sol` / `max`。UI、EXE、安装及已安装启动已 verified，Git同步已verified；契约见GOAL顶部。
- 当前现场：main / `9926f7d` 之上的本轮模型配置、图片池状态与8向resize源码已完成验证及新开发包。本轮EXE、原位安装和隔离已安装启动均通过；源码/文档已普通push并核对远端。此前字体/画布功能仍在本轮包中，正式发布与同版本历史制品按哈希区分。

| 最近开发内容 | 当前结果与证据 |
| --- | --- |
| 模型配置布局与全方向 resize | 14场景/27截图，双尺寸/明暗、最小尺寸列表、草稿保存取消、渠道/手动模型、图片取消→设置刷新保存→reload、停用连接恢复、8向/键盘/视口全部通过。[最终UI](.diagnostics/model-connection-layout-2026-10-15T11-43-30-439Z/report.json)；相关自检/typecheck通过，Main→public→Renderer迁移155项通过。 |
| 打包后自动安装 | 本轮品牌EXE /S退出0 /27.383s，原目录与注册1.0.9保留；EXE/ASAR匹配，3个配置表面保留，secrets内容未读。已安装EXE[隔离启动](.diagnostics/release/packaged-smoke-2026-10-15T12-14-12-464Z/report.json) ok:true，退出后日常配置仍不变；[安装证据](.diagnostics/model-ui-install-2026-10-15.json)。 |
| 打包后自动更新上下文并 push | 本轮21文件提交 a2702ca71d7deecc687a7476a79da5529b5b9604 已普通push到origin/main，实际远端/本地/缓存一致且工作树干净；本完成记录仅补文档收尾，最终核对写入本地交付索引。生成物和私有配置仍忽略。 |
| 最新 EXE 打包 | package:win:unrestricted退出0，production build 1682 modules /28.28s；无限制版1.0.9为 109,842,432 B，SHA-256 f492636ba7378733626cdca6c5a04482a6914ffc489f3a0d01303919c6e38636。包内122个dist文件与8个Main等源码owner精确匹配，11个UI/状态源码冻结哈希未变；[审计](.diagnostics/model-ui-exe-audit.json) ok:true，已安装/启动，未上传或发布。 |
| 功能修改交付 EXE 的持续规则 | 根/桌面 `AGENTS.md` 已要求每轮功能新增/修改/修复及 UI/交互调整在交付前生成当前源码对应的本地 Windows EXE，默认无限制版，报告真实路径/大小/SHA-256；无需逐轮再确认本地打包，正式发布仍独立授权。纯文档不触发打包；Harness 10 项、链接/命令与差异核对通过。 |
| 画布工具栏分页 | 全部 17 工具在 1280×820 的 4 页、884×640 的 17 页可达，无裁切/横向滚动，滚轮不改页码/视口；最终 Enter/Space、悬停连续翻页/焦点、Escape、固定与安全工具入口 19 checks/5 截图通过。最终 quick GUI 6 scenes、自检/typecheck 与 build（1681 modules / 26.54s）通过；分段证据及原失败边界见下方完成记录与 [交付索引](.diagnostics/canvas-toolbar-pagination-delivery.json)。 |
| 字体与画布可读性 | 九主题 GUI 132 checks/63 截图、最终 125% DPR 127/41、最终 150% DPR 强反差背景 127/41、最小窗口长标题/需求补充 27/12 全部通过；采样最低 4.99:1，操作条全局设备像素坐标检查通过。selftest/typecheck、最终 quick GUI 6 results、canvas clarity 5 results 及 production build（23.90s）通过，报告见下方完成记录。 |
| 渠道模型自动发现 | NewAPI / Sub2API / OpenAI Compatible 经 Main `/v1/models` 读取目录，共享 15 分钟缓存；弹窗按勾选模型保留连接，手动补充作为兼容入口。隔离模型 UI 通过；两个已授权真实测试渠道均返回目录且各仅创建一次 `n=1` 图片。见 [模型 UI 报告](.diagnostics/electron/model-discovery-ui-2026-10-11T07-47-56-428Z/report.json) 与 [真实渠道报告](.diagnostics/real-channel-image-2026-10-11T13-42-05-735Z/report.json)。 |
| Infinite Canvas 交互适配 | 参考提交 `3a6b64b602ad062b29fac66902ed18a7ef5fd9dc` 的导航、小地图、选中/悬停快捷操作，复用现有画布、选择和动作 owner。实际画布专项及小窗口状态通过，见 [画布报告](.diagnostics/electron/aidebug-2026-10-11T10-25-27-813Z/report.json)。 |
| 相关弹窗和抽屉可调尺寸 | 内容型弹窗通过 `DialogShell.resizable` 调整宽高；设置/账户抽屉左边缘与方向键调宽、Home 还原；内容在最小尺寸下滚动，尺寸不写入项目/设置。隔离 UI 9 个代表表面/23 截图通过，包内查看器和最终成果编辑器追加专项通过；见下方 2026-10-13 功能记录。短确认提示沿用内容尺寸。 |
| 此前 Windows 开发包 | 2026-10-13 的 `package:win:unrestricted` 与当时 `typecheck`/`test:ui-foundation` 记录保留为历史；同名文件已由 2026-10-15 新包替换，最新状态见上方。 |

最新本地 EXE（2026-10-15 开发包）：[SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe](release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)，**109,839,872 bytes**，SHA-256 `aed98423e66d921be0bcb45d5085d8f7a475bda8ad3d3d7cb49f5033412dd3d2`。[制品审计](.diagnostics/canvas-toolbar-exe-audit.json) 为 `ok:true`：121 个 dist 文件集/逐文件哈希与当前构建匹配，8 个 Main/preload/Agent/access owner 与打包前源码哈希一致，包含本轮分页编译标记，dual-access 策略正确；ASAR/解包资源无 `.env`，ASAR 无诊断目录。包含当前字体/画布优化与工具栏分页；已完成本机原位安装及已安装 EXE 隔离启动冒烟，证据见下方自动安装记录，未上传或发布。

历史正式版本：2026-10-10 的 [v1.0.9 发布](https://github.com/naMeaning/SparkAI-WorkSpace/releases/tag/v1.0.9) 冻结在 `33e3ba12aaeaf142e38865c8bd5b60a0bd7e14d6`，同次发布编排已通过；见 [正式编排报告](.diagnostics/release/final-release-2026-10-10T05-57-58-538Z/orchestrator-report.json) 和本文件 2026-10-10 记录。当前同名本地 EXE 已由后续开发打包替换，不能用它代表已发布资产；本次没有更新远端发布状态。

仍需明确的验证边界：

- 最新分页源码构建的 `test:bundle` 本轮仍失败：CSS **281,539 B > 270,000 B**；唯一硬失败为CSS，initial JS 4,133 B 和plugin JS 86,177 B在门槛内，无诊断标记泄漏；其他advisory超限保留在 [Bundle日志](.diagnostics/model-ui-bundle.log)。此前字体任务的 CSS 278,748 B、EXE 的 CSS 277,505 B 与 `bundleEnforced:false` 各属当时记录；当前源码尚不满足正式发布门禁。
- 100%/125%/150% DPR 是隔离 Electron 的模拟显示密度；实际多显示器切换、各设备 GPU/ClearType 尚未验证。本轮已安装并隔离启动，不代表日常用户数据下的全部字体/分页/DPR 组合已复测。强反差背景覆盖了受管 WebP、0 遮罩/0 背景模糊、最低透明度 10% 与开启纹理的代表配置，不等于穷举所有自定义组合。
- [首轮包内 resize 报告](.diagnostics/release/dialog-resize-ui-2026-10-13T04-23-25-804Z/report.json) 为 `ok:false`：5 个代表检查完成，后续查看器入口超时；其后的 [查看器专项](.diagnostics/release/dialog-resize-ui-2026-10-13T04-28-05-365Z/report.json) 和 [最终编辑器专项](.diagnostics/release/dialog-resize-ui-2026-10-13T04-32-32-769Z/report.json) 各 `ok:true` / 1 check / 3 截图。保留各自证据范围，未把首轮整套改写为通过。
- 最新开发包已验证本机同版本原位安装、配置保留和已安装 EXE 隔离启动；卸载、完整跨版本升级矩阵、正式发布或逐个插件业务未复验；此前 Agent Text UI 的“放弃后恢复焦点”断言仍未修复/整套复跑。已有正式版本的安装升级证据属于其冻结制品。
- 真实渠道证据仅覆盖已授权的两个目录和各一次图片请求；其他渠道、视频/Seedance及历史领域的未验证项仍需按各自记录处理，不因本快照自动追加请求。

下一步：本轮UI、打包、安装和源码同步已完成；后续按最新用户需求继续，正式发布门禁仍独立。

## 2026-10-16 Grok 生图失败定位与客户端防重试修复 / completed, verified；渠道未恢复

- 完成交付：本轮11个源码/测试/上下文文件普通提交`5a270e649530fa6821ef871949b7e2ec16f371e8`并push，远端main从`8d5db36`前进到`5a270e6`；ls-remote、本地HEAD和origin/main一致。[源码同步证据](.diagnostics/grok-fix-2026-10-16/git-source-push.json)。Harness10项、13处新增本地链接、暂存差异/凭据与私有路径检查通过。以下checkpoint保留各阶段事实；本条为最终状态，后续纯文档收尾的实际Git身份记入[本地交付索引](.diagnostics/grok-fix-2026-10-16/delivery.json)。未上传EXE、未发布Release/tag、无新增真实模型请求。
- 安装及包内验证 checkpoint：品牌安装器`/S`原位升级退出0 /25.146s，无运行中应用，安装目录/注册1.0.9/3个配置表面均保留，安装EXE/ASAR与新包一致；[安装报告](.diagnostics/grok-fix-2026-10-16/install.json)。对已安装EXE运行`test:image-generation-failure-ui --exe=<registered installed EXE>`通过，一次图片POST、三轮Agent请求均为本地HTTP模拟；可见中文错误、无敏感上游文本、无伪成功，已查看[截图](.diagnostics/image-generation-failure-ui-2026-10-15T23-56-41-348Z/main-error.png)。[测试后核对](.diagnostics/grok-fix-2026-10-16/installed-ui-verification.json)确认日常配置及源码/安装身份未变、同名程序全部退出。0新真实请求，Git同步待执行。
- 打包 checkpoint：`corepack pnpm run package:win:unrestricted`（会话62784）退出0，production build1682 modules /27.40s，NSIS与品牌安装器成功。最终[EXE](release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)109,842,944 B，SHA-256 `8a8d06f5fe1cb6fba86ab4cbbbe90fc57021f3a65a76c95d62419232d3191427`；[包内审计](.diagnostics/grok-fix-2026-10-16/package-audit.json)ok:true，122个dist文件集合/哈希与8个Main/runtime owner源码匹配，dual-access策略正确，无.env或诊断目录。审计脚本初次写错service路径导致零修改退出，修正为实际desktop owner后通过；产品源码未改。安装及Git同步尚待执行，本轮仍为本地开发包，bundleEnforced:false，未发布。
- 请求：检查并修复截图中的 Grok Image Gen 失败。范围先落在桌面图片 Adapter、连接解析、参考图请求与错误传播；外部 New API 保持独立。
- 现场：main / `8d5db36` 干净。截图仅证明两次快速返回相同错误，不能据此判断服务故障、模型/接口错误或生成请求已经被接受。
- 验证计划：本地诊断与脱敏连接画像、模拟上游回归及受影响专项，必要的隔离 UI 路径；最终 EXE、原位安装、身份/配置保留核对及源码文档推送。当前尚未执行新验证，未发送真实模型请求。
- 定位/授权 checkpoint：安装版诊断确认截图两次请求为 xai-images / sync，HTTP 502 / UPSTREAM_ERROR，耗时 1285ms、900ms；没有图片响应或落盘。当前设置选择 Grok，连接未显式覆盖图片协议。Agent 的 upstream_5xx 建议允许重试；用户已明确允许一次简单风景 n=1、无参考图、无重试的真实验证，除此之外无新付费请求授权。
- 实测 checkpoint：现有连接仅派发1次 `/v1/images/generations`，n=1、1:1、1k、b64_json、无参考图，4.649s收到HTTP502及相同泛化上游错误；[脱敏报告](.diagnostics/grok-fix-2026-10-16/live-probe.json)。首次测试启动因隔离安全存储尚未就绪而零派发退出，修正隔离读取后仅派发上述1次。用户随后提供连接并明确要求再测试，新增1次相同范围授权；凭据不得写入配置或报告。
- 实现 checkpoint：JSON/multipart 的图片 POST 5xx/断连/超时由 `protectImageCreationError` 标记 `image_generation_uncertain` / ambiguous / unsafeToRetry；凭据解析在保护外，明确4xx、取消和普通对话保持原行为；中文提示不复制上游敏感正文。Agent沿用既有运行内保护阻止改Prompt再生成，诊断白名单接受新分类。27项边界/Agent回归通过，UI与最终交付进行中。
- 2026-10-16 验证 checkpoint：新提供的 `supeai.top` 连接只派发一次 n=1 风景请求，无参考图/无自动重试，1.159s返回 HTTP502、无图片；[脱敏报告](.diagnostics/grok-fix-2026-10-16/supplied-connection-probe.json)。用户随后表示外部渠道故障若无法修复就停止，已停止真实请求。最终28项模拟回归 `test:image-generation-failure` ok:true；`test:image-generation-failure-ui` ok:true，真实隔离Electron经本地HTTP模拟 1 次图片POST、3轮Agent对话、主面板可见中文错误且不泄漏上游敏感文本，[UI报告与截图](.diagnostics/image-generation-failure-ui-2026-10-15T23-46-31-466Z/report.json)。相关 `test:custom-api-transport` 40项、`test:image-generation-service`、`test:image-generation-async`、`test:image-mask-compat` 66像素断言、`test:runtime-diagnostics`、`test:view-image`、`test:agent-post-image` 10场景和 typecheck 均通过；Harness 10项及 git diff --check 通过。当前剩余最终EXE、安装和push。

## 2026-10-15 模型配置布局、图片勾选与全方向 resize / completed, verified

- 用户两张截图分别指向逐模型连接被嵌套短滚动区挤压、图片配置的勾选/默认状态不清晰及只有右下角可以调整弹窗。范围合并为一次本地 UI 功能交付；不改模型费用或协议。
- 已检查原组件：模型目录与逐模型多卡表单共用固定高度分区并叠加两层高度限制；DialogShell 当前依赖浏览器原生右下角 resize。先调整实际组件结构和交互 owner，再替换对应样式。
- 用户明确指定子代理模型后，已中断之前代理并用 `gpt-6.1-sol` / `max` 重新派发共享 resize、图片选择和隔离 UI 验证；主代理统一维护文档及模型连接布局。该模型偏好同步根 AGENTS 与决策记录。
- 中途验收发现与修正：首轮自动 UI 10/11场景通过，但最小720×460的目录只有29px；已提升模型弹窗最小高度并为渠道展开保留工作区。独立审查又复现设置刷新归一化会将带连接/能力的已取消模型并回池，范围补到 core/加载兼容 owner；Main/Renderer镜像与真实Electron155项已补齐，UI刷新→保存→reload回归仍验收中。首轮脚本还需修正背景设置遮挡和loopback元数据分类，原失败报告保留，尚不宣称最终通过。
- 实现里程碑：模型目录和单个连接详情分栏，勾选与查看分开，主要地址/密码字段优先展示；图片勾选源只读显式 imageModel/pool，连接/能力保留为候选，取消后不再被配置重新勾回；默认按钮独立并带文字。共享 `useDialogResize` 拥有8向、捕获清理、键盘和视口夹紧，尺寸不持久化。相关自检如顶部表格，实际 UI/包/安装尚待验证。
- 第二轮发现：图片弹窗原最小480×360同样将模型目录压为0，已将最小高度调560并保留120px模型列表/正文滚动；键盘summary与新回归由UI代理继续定位/复验。最终相关自检/typecheck和 quick GUI（6 scenes，报告 `.diagnostics/electron/aidebug-2026-10-15T11-30-23-243Z/report.json`）通过，尚待UI最终证据后冻结打包。
- 验证计划：1280×820/884×640、明暗主题的目录/详情可达、草稿/保存/取消、独立模型密钥与全局/账号继承、目录发现和手动模型、图片选择/默认、8方向及键盘resize；之后相关自检/typecheck、最终 EXE/安装/已安装启动和 Git 同步。尚未收集本轮验证，0 真实模型请求。

- 最终实现：目录与单模型详情分栏，主要地址/密码字段优先展示，接口/结果设置可折叠；模型勾选与查看详情分开，视频主体保留启用动作。共享DialogShell提供四边四角、方向键/Shift/Home和捕获清理，原生summary纳入focus trap。模型窗与图片窗最小高度560，目录分别保留可用工作区/120px列表，展开渠道或短视口可滚动正文，footer可达。
- 真实状态修复：core的显式imageModel/pool决定启用状态；Main migrateSettings与Renderer mergeSettings只在缺池旧数据时一次迁入连接/能力模型，设置候选独立保留。小窗及图片大窗停用后均保留连接/能力，设置刷新保存/重启不反向勾回，再启用恢复原连接；不改IPC/运行时gpt-image-2优先或存储格式。
- 最终[UI报告](.diagnostics/model-connection-layout-2026-10-15T11-43-30-439Z/report.json) ok:true：14场景、27截图，light/dark classic的1280×820/884×640布局、最小尺寸目录可用、8方向真实拖拽与min/max/viewport、SE键盘/Home、Tab/Enter折叠表单与roving、草稿Key/URL/Token/adapter切换及保存/取消、停用再启用恢复、图片默认/Space/最后一项保护、刷新保存reload均通过。已查看最终最小模型窗与暗色图片窗截图；只访问1次loopback目录+1次元数据，0真实模型请求。
- 前两轮失败报告保持原样：11:30首轮最小目录29px及fixture分类/遮挡，11:38新增检查抓到图片最小目录0px、CDP原生summary Enter帧缺keypress；已修最小布局与测试Enter输入，11:42键盘专项与11:43最终整套真实复验通过，未把早期失败改成通过。
- 专项：typecheck、settings persistence155项（真实隔离Electron Main→public DTO→Renderer，显式池roundtrip/旧数据迁移/Key脱敏）、model UX、settings lazy73、UI foundation、workspace glass164、Agent binding4与quick GUI6 scenes通过。[检查索引](.diagnostics/model-ui-checks.json)。独立审查发现的池反弹、Main迁移镜像和视频主体问题已修；最后预提交审查代理服务503中断，由主代理接手源码/差异/凭据范围核对。
- [打包结果](.diagnostics/model-ui-exe-package-result.json)：默认unrestricted退出0 /180.234s，build1682 modules /28.28s，bundleEnforced:false；[日志](.diagnostics/model-ui-exe-package.log)。本轮[EXE](release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe) 109,842,432 B / SHA-256 f492636ba7378733626cdca6c5a04482a6914ffc489f3a0d01303919c6e38636；ASAR SHA-256 b0857b46f4e46c92c3f232f2edbd7c1f43ad58c55c2234486c8ba11eb7e2dd7b。[审计](.diagnostics/model-ui-exe-audit.json) ok:true，19源码指纹冻结、122 dist集合和逐文件匹配、8打包owner匹配、功能编译标记/dual-access策略/无.env或诊断成立。
- [安装](.diagnostics/model-ui-install-2026-10-15.json)：安装前无任何同名应用进程，正常品牌/S退出0 /27.383s，沿用注册目录/1.0.9，EXE与ASAR匹配，3个既有配置表面保留；secrets只stat不读。已安装程序[隔离Mock冒烟](.diagnostics/release/packaged-smoke-2026-10-15T12-14-12-464Z/report.json)退出0 /ok:true，runtime/IPC/SQLite/保存读回/导入/局部分层/PSD通过、网络跳过，工作区截图已查看，结束后日常配置仍与安装前一致。用户安装绝对目录只保留在本地忽略报告。
- 交付边界：本轮本地开发包，不上传EXE/Release/tag，不发送真实模型请求；本轮Bundle唯一硬失败CSS281,539 B >270,000 B，保持原开发包例外，不宣称正式发布门禁通过。未复验卸载/完整跨版本升级/全部插件或用户日常真实服务。Git源码/文档已普通push并实查一致，详见下条。

- Git收口：Harness10项、新增14处本地链接和差异检查通过；主代理审查本轮新增内容未发现实际凭据/用户私有目录，无Extension或生成物/私有配置候选。实际提交 a2702ca71d7deecc687a7476a79da5529b5b9604（21 files，1172 insertions/675 deletions）并普通push，远端main从9926f7d前进到a2702ca；随后独立ls-remote核对远端、本地HEAD和origin/main一致、工作树干净。[源码推送证据](.diagnostics/model-ui-git-source-push.json)。本完成记录随纯文档提交收尾，最终分支身份、EXE/安装与证据索引见 [.diagnostics/model-ui-delivery.json](.diagnostics/model-ui-delivery.json)，无二进制上传/Release/tag。

## 2026-10-15 打包后自动安装 / completed, verified

- 用户追加持续本机安装授权；本轮复用现有 `release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，不改产品或安装器源码、不重复打包。
- 现场：main / `000a560` 干净；检测到 HKCU 注册 1.0.9，无 SparkAI 进程。品牌安装器 `/S` 采用正常当前用户升级路径，已有安装位置优先，默认保留快捷方式偏好；不启用诊断绕过、强制降级或清除数据。
- 根/桌面 AGENTS、决策/交付协议/授权矩阵与两层地图已同步打包→核验→自动安装→核验→上下文/Git 流程。安装前保留现场，若未保存内容/活动任务不能安全退出则待安装，不强杀。
- [安装证据](.diagnostics/automatic-install-2026-10-15.json)：品牌 EXE `/S` 退出 0 / 25.526s；注册版本 1.0.9 和原目录保留，已安装 EXE SHA-256 与 `release/win-unpacked` 一致，ASAR SHA-256 为 `1e440f9d574e53f82246ab7485bdd118e4c72d3ed280d7f32c23cfb0ec367ea2`，与本次打包审计一致。3 个已有配置表面保留：设置/项目列表文件哈希及 mtime 不变，secrets 只核对文件大小/mtime，未读取内容。安装位置和具体基线仅保存在本地忽略诊断。
- 独立安装器审阅发现 NSIS 会处理当前用户所有同名进程，桌面 AGENTS 已明确必须先确认全部同名安装/开发实例安全退出，不能依赖内核关闭。本次前置检查无任何同名实例，不涉及强杀。
- 已安装程序启动：`node scripts/release/packaged-smoke.mjs --exe=<registered installed EXE>` 退出 0，[实际报告](.diagnostics/release/packaged-smoke-2026-10-15T10-44-01-798Z/report.json) `ok:true`；设置/项目/Agent 均使用本地隔离 Mock，网络检查跳过，无真实模型请求。runtime/IPC、SQLite、保存/读回/导入、局部分层与 PSD 检查通过；已查看 [实际工作区截图](.diagnostics/release/packaged-smoke-2026-10-15T10-44-01-798Z/packaged-workspace.png)，品牌/右侧 Agent/画布导航/工具栏 1/4 页可见。冒烟结束后无 SparkAI 进程，日常配置仍与安装前基线一致。
- 规则/文档交付：本轮只改 9 个交付文档，不更改产品/安装器源码，无需重打包。根 `node scripts/verify-harness.mjs` 10 项、6 处新增本地链接、`git diff --check` 及无新增未跟踪候选核对均通过，文档未写入用户安装绝对路径；本记录随规则提交普通推送，最终 Git 结果保存在本地 `.diagnostics/automatic-install-git-sync-2026-10-15.json`，不把用户安装路径、配置基线、EXE 或诊断上传仓库。
- 本轮验证了现有同版本开发包原位安装和隔离启动，未重新执行卸载/完整升级矩阵、日常用户数据业务、真实模型或正式发布；旧快照的“未安装/启动”由本完成记录补齐相应边界，不改写历史原始报告。

## 2026-10-15 打包后更新上下文及自动 push / completed, verified

- 用户持续授权每次打包完成后同步源码与上下文到远程仓库。本轮将刚完成 EXE 对应的渠道模型发现、画布/字体/分页、resize 与 Harness/上下文改动归档到 `origin/main`；生成的 EXE/dist/诊断与私有配置保持忽略。
- 根/桌面 AGENTS、Harness 决策/协议/授权矩阵与两层上下文入口已更新，明确打包结果、文档和 push 状态分别记录，正式二进制上传/Release 仍独立授权。
- 推送前只读实查：本地 HEAD、origin/main 缓存、远端 `refs/heads/main` 都是 `f156b3e5a5ac22d6a562df8f3e69ce2f0a287ac2`，upstream 为 origin/main。
- 提交前核对：独立只读审查确认 49 个 tracked 修改与 4 个新增文件均属当前包的功能、验证脚本和上下文；2,795 行新增内容未发现实际凭据，无 Extension 修改或二进制/诊断/私有配置候选。根 `node scripts/verify-harness.mjs` 10 项通过，75 处新增本地链接、12 个包内源码哈希和 EXE 大小/SHA-256 均与当前现场一致，`git diff --check` 退出 0。范围与制品复核见 [.diagnostics/package-push-preflight-2026-10-15.json](.diagnostics/package-push-preflight-2026-10-15.json)。
- 暂存补充：首次 `git add` 被 2026-10-14 遗留的零字节 `.git/index.lock` 阻塞；两次确认没有 Git/SSH 进程后，将该锁移为同目录带日期备份并恢复暂存。`git diff --cached --check` 检出了原未跟踪 `canvas-interaction-toolbar.tsx` 的一个末尾空行，现已删除；TypeScript 修正前后输出逐字节相同，未改变功能或包内行为，格式证据为 `.diagnostics/package-push-formatting-2026-10-15.json`。
- 实际提交与推送：最终 `git diff --cached --check`、无未暂存差异及 Harness 10 项均通过；提交 `b45ca17fd68539130faa5a458e0e53724e99e3bc`（`feat: improve canvas readability and desktop workflows`），53 files / 2,792 insertions / 291 deletions。`git push origin HEAD:refs/heads/main` 退出 0，远端从 `f156b3e` 前进到 `b45ca17`；随后独立 `ls-remote` 实查远端 main、本地 HEAD 和 origin/main 三者均为完整提交 `b45ca17fd68539130faa5a458e0e53724e99e3bc`，工作树干净。本完成记录随单独文档提交归档，最终分支 HEAD 与 `.diagnostics/package-push-delivery-2026-10-15.json` 保存收尾核对结果。
- 交付边界：此次 Git 同步只包含对应源码、测试及上下文；EXE/ASAR/dist、诊断和私有配置保持忽略，未上传二进制、发布 Release/标签或调用模型。EXE 沿用上方实查制品，纯规则与完成记录不重复打包；既有正式 CSS 门禁和包内未安装/启动边界不变。

## 2026-10-15 最新源码本地 EXE 打包 / completed, verified

- 用户明确要求立即打包，执行默认 `corepack pnpm run package:win:unrestricted`，不改版本；当前 main 未提交功能源码全部保留并作为本次输入。
- 只做本地开发打包及制品核验，不上传/发布、不运行真实模型、不安装覆盖现有用户环境。既有 CSS 279,001 B > 270,000 B 是正式发布门禁边界，按开发包规则不阻断本轮 NSIS 打包。
- 结果：[打包结果](.diagnostics/canvas-toolbar-exe-package-result.json) 退出 0，`test:access-variant` 通过、production build 1681 modules / 23.76s，NSIS 和品牌包装完成，`bundleEnforced:false`。日志见 [.diagnostics/canvas-toolbar-exe-package.log](.diagnostics/canvas-toolbar-exe-package.log)；本轮未修改产品源码或版本号。
- 新制品：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，109,839,872 B，SHA-256 `aed98423e66d921be0bcb45d5085d8f7a475bda8ad3d3d7cb49f5033412dd3d2`。同名 2026-10-13 本地包被本轮新包替换，旧哈希及旧审计仍保留在当时记录中，不能混用。
- [本轮静态审计](.diagnostics/canvas-toolbar-exe-audit.json) `ok:true`：121 个 dist 文件精确集合与逐文件 SHA-256 匹配，8 个 Main/preload/独立 Agent/access owner 匹配本轮准备阶段的源码哈希，分页编译标记存在，dual-access/custom API 策略正确；ASAR/解包资源无 `.env`，ASAR 无诊断目录，未读取凭据。审计脚本为 `.diagnostics/canvas-toolbar-exe-audit.mjs`，记录本轮源码哈希与制品身份。
- 边界：本轮仅完成本地构建、打包和静态一致性核验，没有安装/启动应用、请求模型、上传或发布。当前 dist CSS 实测仍为 279,001 B，既有正式发布门禁超限边界保持。

## 2026-10-15 每次功能修改交付 EXE 的持续规则 / completed, verified

- 用户要求已写入根/桌面 `AGENTS.md`：功能新增、修改、修复及 UI/交互调整交付前必须打包最终源码对应的本地 Windows EXE；默认 `package:win:unrestricted`，指定变体时遵循用户选择，报告路径、大小、SHA-256 和打包结果。打包流程内的成功 build 满足构建要求，无需重复构建或逐轮询问本地打包授权。
- 同批替换 `harness/CONVERSATION_DECISIONS.md` 中旧的逐次授权偏好，保留独立正式发布授权与既有开发/正式门禁区别；失败必须报告 EXE 未生成/未更新。纯文档修改、规划和只读诊断不触发打包。
- 本轮仅修改开发规则和任务记录，保留全部产品未提交工作；`node scripts/verify-harness.mjs` 通过 10 项结构检查，根→桌面规则链接、实际打包命令和 `git diff --check` 均通过。未执行产品构建、打包或发布。

## 2026-10-15 画布工具栏分页 / completed, verified

- 结果：底部工具栏用上一页/下一页与页码浏览，按真实按钮宽度保持完整工具，窗口变化保留当前浏览锚点；原命令、禁用条件、快捷键与固定/悬停设置仍由现有 owner 提供。点击不会让画布抢焦点，Enter/空格使用按钮原生激活，Escape 收起并返回入口焦点。新增 owner 见 `docs/CONTEXT_MAP.md`。
- 双尺寸证据：[布局/遍历报告](.diagnostics/electron/canvas-toolbar-pagination-2026-10-15T01-55-16-823Z/report.json) 有 44 项通过，包含全部 17 工具逐页可达（1280×820：4 页；884×640：17 页）、首末禁用、无裁切/横向溢出、滚轮不改页码/画布、末页 resize 到合法页。该报告随后在 Enter 检查失败，整体 `ok:false` 原样保留；后续唯一产品改动为工具栏 Enter/空格停止冒泡。
- 修复后的 [最终补充专项](.diagnostics/electron/canvas-toolbar-pagination-2026-10-15T02-01-51-708Z/report.json) 为 `ok:true` / 19 checks / 5 screenshots，真实验证 Enter 下一页、Space 上一页、SKU 安全弹窗、悬停收起/展开、悬停连续两次翻页与按钮焦点、Escape 收起/入口焦点、重新固定后移出仍展开，模型请求 0。没有把原失败报告改写为整套通过。诊断脚本 `.diagnostics/canvas-toolbar-pagination-check.mjs --tail-only` 保留该补充路径。
- 最终 `corepack pnpm run aidebug:gui` [quick GUI 报告](.diagnostics/electron/aidebug-2026-10-15T02-02-19-302Z/report.json) `ok:true` / 6 scenes；最终 `typecheck`、`test:workspace-glass-ui` 164 cases、`test:plugin-system` 115 cases 全部退出 0；[production build](.diagnostics/canvas-toolbar-pagination-build-result.json) 退出 0 / 1681 modules / 26.54s。[Bundle](.diagnostics/canvas-toolbar-pagination-bundle-result.json) 唯一硬失败仍为 CSS 279,001 B > 270,000 B，无诊断标记泄漏。
- [交付索引](.diagnostics/canvas-toolbar-pagination-delivery.json) 保存最终源码哈希、分段验收范围与报告、构建和 Bundle 结果；[工具栏截图](.diagnostics/canvas-toolbar-pagination-preview.png) 来自最终固定模式原始截图裁切。未打包新 EXE、未请求真实模型、未提交或发布；隔离测试进程已清理。
- 最后文档与现场核对：当前任务 19 处本地链接存在，5 个源码哈希仍与交付索引一致，`git diff --check` 退出 0；既有未提交工作保留。

以下为本轮接受与诊断过程的当时状态，后续已由上述记录完成：

- UI 里程碑：`.diagnostics/electron/canvas-toolbar-pagination-2026-10-15T01-55-16-823Z/report.json` 已实际通过双尺寸完整工具遍历（1280：4 页；884：17 页）、完整按钮/首末边界、滚轮惰性及末页 resize，随后在键盘 Enter 检查真实失败：全局画布快捷键打开了编辑成果。该报告仍为 `ok:false`，不当作完整通过。工具栏现在对 Enter/空格只停止冒泡，保留按钮原生激活；等待修正后的最终专项。此前生产构建通过（1681 modules / 40.58s），最终源码构建和检查正在重跑。
- 启动诊断：首次受限环境的 quick GUI 因 Windows 安全存储不可用未创建 Renderer，外部隔离启动也曾在工作台出现前超时；专项延长启动等待并使用隔离 Mock 配置后已进入实际 UI。启动失败报告保留，不视为分页断言或通过证据；未更改产品安全配置或请求真实模型。
- 实现里程碑：新增 `src/canvas-toolbar-pages.tsx`，使用实际按钮宽度和 `ResizeObserver` 分页；当前工具作为 resize 锚点，工具集合变化回第一页；隐藏测量按钮不可交互/不可聚焦。样式 owner 移除横向滚动与旧窄屏宽度覆盖，`main.tsx` 保留原工具命令与展开设置。
- 复核修正：工具栏 `data-canvas-no-zoom` 复用既有画布点击/滚轮/平移隔离，避免翻页时画布抢焦点；内部转焦不重新展开 Escape 收起的工具栏。`test:workspace-glass-ui` 164 cases、`test:plugin-system` 115 cases 通过；首次 typecheck 因 ES2020 不支持 `findLastIndex` 失败，替换为兼容迭代后退出 0。真实 UI 专项和 quick GUI 进行中，production build 待运行。
- 用户明确要求将横向滚动改为翻页；保留工具顺序、动作与展开设置，只改变 Renderer 临时展示逻辑。已有 main 分支 dirty changes 全部保留，本轮相关文件基线见 `.diagnostics/canvas-toolbar-pagination-baseline/`。
- 计划验证：1280×820/884×640 的完整按钮分页、全部工具可达、首末边界、滚轮与视口隔离、键盘翻页、resize、固定/悬停/Escape 和安全工具入口；随后运行相关 selftest/typecheck、quick GUI 与 production build。本轮未运行验证、未请求真实模型、未打包或发布。

## 2026-10-15 最终 DPR 复测与交付 / completed, verified

- 已修正操作条局部对齐遗漏画布原点的问题。最终 [125% DPR](.diagnostics/electron/canvas-readability-2026-10-14T16-15-15-043Z/report.json) 与 [150% DPR 强反差背景](.diagnostics/electron/canvas-readability-2026-10-14T16-18-49-771Z/report.json) 各 `ok:true` / 127 checks / 41 screenshots；新增检查证明实际操作条 left/top × DPR 在 0.02 设备像素容差内接近整数，四角/多选/长标题/需求/独立窗与原交互检查均保留。最低文字采样仍为 5.20:1 / 4.99:1。
- 最后 `typecheck` 退出 0；[production build](.diagnostics/canvas-readability-build-result.json) 退出 0 / 1680 modules / 23.90s。最后 [Bundle](.diagnostics/canvas-readability-bundle-result.json) 退出 1，仍仅 CSS 278,748 B > 270,000 B，无诊断标记泄漏。最后 quick GUI 与 canvas clarity 的其他 owner 此后未变。
- 交付证据索引为 [.diagnostics/canvas-readability-delivery.json](.diagnostics/canvas-readability-delivery.json)，包含当前源码 SHA-256、报告与构建结果、实际验证边界。本轮没有生成新 EXE 或发布。
- 文档本地链接与 `git diff --check` 在写入最终记录后核对；下方各 checkpoint 保留当时证据，续接以本快照和该最终记录为准。

## 2026-10-15 最终差异核对补充：全局设备像素对齐 / 当时 in progress，已由上方完成记录验证

- 125% 旧报告中操作条 y×DPR 为 162.5 / 464.5 等半整数；原因是 `ActionBar` 仅对局部坐标取整，遗漏画布原点（82 CSS px）。现已同时纳入 canvas left/top，并在实际 GUI 中追加操作条全局坐标乘 DPR 接近整数的检查。
- 该问题只证明位置对齐遗漏，不单独证明所有字体模糊的原因。之前文字对比、交互、主题和强反差背景证据保留；当时等待 DPR 复测与最终 build，现见上方完成记录。

## 2026-10-15 字体与画布执行完成：verified（本地源码与构建）

- 结果：统一主/独立 Agent 的 Windows 字体回退和常用辅助字号，恢复浏览器原生文字渲染；保留既有 DPR 对齐/交互后 2D settle。主题 muted/warning、占位文字与稳定阅读面同步；修正背景模块 inline 覆盖及通用 Glass 样式 specificity，移除阅读区斜纹。画布导航分组/100%、插件分行、固定字号标题与操作条实测夹紧/底部避让完成，节点阴影减轻。
- [九主题报告](.diagnostics/electron/canvas-readability-2026-10-14T15-54-04-404Z/report.json)：`ok:true` / 132 checks / 63 screenshots / 142 文本样本，最低 5.09:1；含六缩放、两窗口尺寸、四边/多选、100%/小地图/Esc 焦点、查看/编辑/引用、容器归组、需求仅保存及独立 Agent 明暗同步。
- [125% DPR](.diagnostics/electron/canvas-readability-2026-10-14T15-57-23-384Z/report.json)：96 checks / 39 screenshots / 58 样本，最低 5.20:1；[150% DPR 与强反差背景](.diagnostics/electron/canvas-readability-2026-10-14T15-59-49-752Z/report.json)：96/39/58，最低 4.99:1。实际 `devicePixelRatio` 分别为 1.25 / 1.5，背景经真实 Main 加载受管 WebP，0 遮罩/0 背景模糊，透明度实际归一至最低 10%。
- [长标题/需求最小窗口补充](.diagnostics/electron/canvas-readability-2026-10-14T16-05-53-479Z/report.json)：`ok:true` / 27 checks / 12 screenshots，884×640 的工具条仍在画布内且按钮可命中，长标题截断并保留完整 title；需求保存/取消不执行模型。实际查看了最小窗口长标题、需求节点、独立浅色窗及 150% 强反差背景截图。
- 最终 [quick GUI](.diagnostics/electron/aidebug-2026-10-14T16-03-31-015Z/report.json)：`ok:true` / 6 results；[canvas clarity](.diagnostics/electron/aidebug-2026-10-14T00-47-00-585Z/report.json)：`ok:true` / 5 results。`test:glass-theme`（38 settings cases）、`test:workspace-glass-ui`（164 cases）、`test:ui-foundation`、`test:agent-window`（44+68 cases）及 typecheck 通过；没有以旧 EXE 或撤回实验代替本轮 UI 证据。
- 最终 [production build](.diagnostics/canvas-readability-build-result.json) 退出 0 / 1680 modules / 21.93s；[构建日志](.diagnostics/canvas-readability-build.log) 保留。`test:bundle` 退出 1，唯一硬失败 CSS 278,748 B > 270,000 B；未为开发 UI 优化扩大到发布或高风险 Bundle 重构。0 真实模型请求，无新 EXE、提交、推送或发布；实际多显示器切换与新包内优化仍未验证。
- 差异复核：与保存基线核对字体/主题/画布 owner，保留此前渠道、画布与 resize 工作；背景与 Agent header 两个原干净 owner 是本轮新增改动，旧固定 alpha 样式断言和调宽手柄诊断分类同步修正。GOAL/PROGRESS/上下文地图同步，完成后的本地链接与 whitespace 核对记录见下方诊断交付摘要。

## 2026-10-14 字体与画布执行：九主题及操作链 verified

- 最新完整 [GUI 报告](.diagnostics/electron/canvas-readability-2026-10-14T15-54-04-404Z/report.json) 为 `ok:true` / 132 checks / 63 screenshots；九主题、六缩放、两窗口尺寸、四边/多选、100%/小地图/Esc 焦点、长标题完整提示、查看/编辑/引用、容器归组、需求仅保存和独立 Agent 明暗同步均通过。实际可见文字背景采样含设置、画布/主 Agent 和独立窗，最低 5.09:1，包含危险操作标签。
- 新采样曾发现 Agent 浅色占位文字 4.39:1，以及 silver/sky/blush 辅助文字 4.04–4.25:1；已分别修正占位透明度、`glass-background.ts` 旧 inline 阅读底色、通用 Glass 分组规则的过高 specificity。修正后真实截图采样通过；背景加载/资产/IPC 不变，阅读底色 owner 与地图同步。
- 探针等待布局稳定后再采样；旧失败包含采样 DOM 序列化、resize 过渡、查看器选择器、标题 trim 与悬停状态误判，相关历史报告保留。固定 alpha 的旧样式断言已更新到稳定阅读面；`test:glass-theme`（38 cases）、`test:workspace-glass-ui`（164 cases）和 typecheck 通过。
- 第一轮可确认 production build 退出 0 / 1680 modules / 35.95s；随后继续修正背景/CSS owner，因此该日志将由最终构建替代。该轮 `test:bundle` 唯一硬失败为 CSS 278,722 B > 270,000 B；正式发布门禁不作为本轮开发打包授权。125%/150% DPR 和最终构建仍待收尾，0 真实模型请求。

## 2026-10-14 字体与画布执行：通用冒烟与清晰度 milestone

- 修正诊断分类后的 [quick GUI](.diagnostics/electron/aidebug-2026-10-14T00-45-13-385Z/report.json) 为 `ok:true` / 6 results；[canvas clarity](.diagnostics/electron/aidebug-2026-10-14T00-47-00-585Z/report.json) 为 `ok:true` / 5 results。原手柄分类失败保留在下方历史记录。
- 续接检查发现独立 Agent 仍保留全窗斜纹和旧透明阅读底色；已在 `agent-window.css` owner 中同步近实色底和 14px 基线，模型辅助信息 12px；`test:agent-window` 44+68 cases 再次通过。
- 当前仍在验证长标题/容器/需求、主/独立窗口的合成文字对比与模拟 DPR；最终构建尚未收集可确认的退出码。0 真实模型请求，无新 EXE/提交/发布。

## 2026-10-14 字体与画布执行：实现 / partially verified

- 已实现：主/独立窗统一 Segoe UI + 微软雅黑回退与字号；可读 muted 投影与 bootstrap 同步，浅色 warning 调深；阅读面使用稳定近实色底，纹理避开 Agent/弹窗；画布导航分组/100%、插件工具行、固定字号选中/悬停标题、按实际工具条矩形/DPR 夹紧并避让底部控件，减轻节点阴影。
- 工程验证：`typecheck`、`test:glass-theme`（38 settings cases）、`test:ui-foundation`、`test:workspace-glass-ui`（164 cases）、`test:agent-window`（44+68 cases）通过；样式专项更新了过时的固定 10px/半透明节点断言。
- 实窗：`.diagnostics/electron/canvas-readability-2026-10-14T00-42-09-617Z/report.json` 为 `ok:true`，79 checks / 36 screenshots，9 主题、6 缩放、1280×820/884×640 与四边/多选、100%、小地图、Esc 焦点通过；设置文字截图背景采样最低 5.22:1。第一轮 `00-36-16` 报告失败在采样没有有效点，不能计为完整通过；截图发现的底部操作条避让已修复并复核。
- quick GUI 首轮 `.diagnostics/electron/aidebug-2026-10-14T00-40-50-103Z/report.json` 失败在既有 `.ui-drawer-resize-handle` 被当成非 primitive 按钮；诊断 owner 已新增专门宽度/标签检查并保留其他断言，待复跑。
- 下一步：补画布文字/长标题/需求/容器及独立 Agent、模拟 DPR，完成 quick/canvas clarity/build。0 真实模型请求，无新 EXE/发布。

## 2026-10-14 执行已交付字体与画布计划：任务接受 / in progress

- 新授权：用户明确要求按计划执行，本轮实现字体/字号、文字对比和画布导航、节点层级、浮动操作条边界。
- 现场：main dirty worktree 保留；15 个相关文件与 SHA-256 保存于 `.diagnostics/canvas-readability-implementation-baseline/`，用于区分本轮改动与此前工作。
- 验证：主题 owner selftest、UI foundation/typecheck；实际 Mock Electron 中检查默认/明暗/代表玻璃主题、50%–240% 缩放、四角操作条、1280×820 和 884×640；quick GUI/canvas clarity 与 production build。
- 边界：0 真实模型请求，无 EXE 打包、提交、推送或发布；旧撤回实验检查不作为本轮证据。

## 2026-10-14 用户澄清：仅提供计划 / verified（规划与撤回核对）

- 用户明确只要求计划；先前将“先列计划”当成持续实施授权的解释已 superseded。
- 已停止产品实现，选择性撤回仅由本轮引入的改动、保留原有 dirty worktree 和两个未跟踪的画布组件，并关闭本轮隔离预览进程树。
- 曾进行的主题、UI foundation、typecheck 与清晰度实验检查属于撤回过程前的历史记录，不能证明当前代码已完成优化；没有生产构建、新 EXE、真实模型请求或发布。
- 撤回证据：5 个原本无改动的文件与 HEAD 归一换行后内容相同；画布 CSS 恢复此前 286 行新增、0 行删除的差异，两个画布组件恢复原有结构与行为；其余相关差异核对为此前的渠道/画布/resize 工作。14 处相关本地文档链接存在，`git diff --check` 退出 0。
- 当前交付是计划和状态纠正；未将未来实现、GUI 验收或构建列为本轮待办。

## 2026-10-14 文字与画布优化：具体计划 / 历史记录，持续实施解释已 superseded

- 用户补充要求：先列出具体改进计划。已写入 [计划](docs/CANVAS_READABILITY_PLAN_2026-10-14.md)，按字体、渲染、对比度、工具布局、节点层级、浮动边界、验证分成 7 步；这是拟实施项，不是已完成实现。
- 新证据：隔离基线 [.diagnostics/electron/canvas-readability-2026-10-13T14-20-24-760Z/before-default.png](.diagnostics/electron/canvas-readability-2026-10-13T14-20-24-760Z/before-default.png) 已实际查看，导航条覆盖底部插件操作、55% 画布标题很小、密集文字区域存在斜纹。未量化对比度，未断言强制文字渲染属性就是模糊根因。
- 代码/参考：确认画布多处 9–10px、小字 760 字重、工具条只夹紧中心点；既有视口已具备设备像素对齐和交互后 2D settle。用户指定仓库 API 返回 main `3a6b64b602ad062b29fac66902ed18a7ef5fd9dc`，与本地参考一致。
- 续接审计：上一轮为 progress，产生了任务文档与基线证据；原预览进程句柄已不存在，记录端口也未响应，不把旧连接文件当作运行中的应用。本轮未重启或修改用户应用。
- 完成边界：计划整理完成，整体 Goal 未完成；本轮产品代码尚未修改，0 新真实模型请求，无新 EXE/发布。后续需实际实现、截图/状态证据和构建。

## 2026-10-13 文字清晰度与画布 UI：任务接受 / 历史记录，实施解释已 superseded

- 结果 / 范围：改善中文、小字号、对比度与画布视觉层级；在桌面字体/主题/画布 owner 中修改，参考用户指定的公开 Infinite Canvas 仓库。
- 现场：main 已有多项未提交实现，包括 canvas-interaction-toolbar、canvas-navigation-controls 与相关 CSS；不重置或覆盖其他任务修改。
- 验证计划：隔离 Mock Electron 中检查明暗主题、分数缩放、画布操作及 884×640 小窗口，保留截图与真实状态；针对性 selftest、typecheck、production build。
- 边界：0 新真实模型请求；未提交、推送、打包或发布。旧 EXE/旧 UI 报告不证明本轮改动。
- 下一步：比对实时源码、主题投影、现有画布截图与参考项目，先确定模糊和低对比的具体原因。

## 2026-10-13 新会话上下文入口同步：verified

- 范围：根/桌面 AGENTS 增加必读顺序，PROGRESS 顶部作为动态状态入口，GOAL 保留当前任务契约，两层地图与 Harness 同步导航和历史 checkpoint 语义。
- 已核对：当前分支/dirty worktree、共享 resize/probe-models 源码入口、现有 UI/包内/正式发布报告的真实状态、当前 EXE 大小/SHA-256 与审计一致；没有运行新的软件构建、UI 或真实模型请求。
- 文档验证：工作区根 `node scripts/verify-harness.mjs` 10 项结构检查通过；一次性 Node 只读核对 9 份相关文档的本地链接、当前快照的制品元数据/未通过门禁/报告范围，并从 preload 源码确认 147 个公开 invoke，退出 0；`git diff --check` 退出 0。同步时还修正了根地图的过期发布准备、无 Git 描述、旧 Bundle 规则和两层地图的当前 IPC 数量。
- 完成边界：本轮改动仅 9 份上下文文档；没有新增软件功能验证、重建 EXE、重复真实请求、提交/推送或发布。后续任务按入口恢复最新状态，再选择尚未完成的验收项。

## 阶段记录

下列记录保留任务当时的计划、失败和后续 checkpoint；其中“待构建”“待发布”“未验证”等字样应按日期读取，并查找更新的完成证据。最新状态从本文件顶部进入，历史哈希不得用于识别当前同名制品。

## 2026-10-13 全部相关弹窗可调尺寸：verified

- 用户将最初的模型配置 resize 范围扩展到所有相关弹窗；已检查 dirty worktree 并保留渠道、画布等先前改动。配置/编辑/选择/导出通过共享 `DialogShell` 接入，设置/账户抽屉保持停靠并允许拉动左边缘调整宽度，短确认保持内容尺寸；只改 Renderer 交互与布局。
- 原局部 CSS（模型初始 760×720、右下角 resize）尚不代表最终完成。`aidebug:agent-text-ui` 报告 `agent-text-ui-2026-10-11T14-33-28-761Z` 在提示词编辑器显式放弃后的旧焦点断言超时，63 个前置检查通过，尚未执行到模型表面；未为本目标扩大提示词业务修复范围。`aidebug:gui:surface` 的 `aidebug-2026-10-11T14-37-21-881Z/report.json` 为 ok:true/15 scenes，但没有实际拖拽 resize，保留作为原布局 evidence。
- 计划验证：共享尺寸属性与各布局最小边界、真实鼠标拉大/缩小和视口缩小时的按钮/滚动状态；不重复其他画布/渠道专项或真实模型请求。最终 build 与本地开发 EXE 待执行。
- 实现 checkpoint：`DialogShell.resizable` 默认开启，共享 CSS 原生调整宽高与视口边界、owner 最小尺寸、右下角提示；模型 body 可收缩/滚动，导出和科研布局跟随弹窗容器宽度；浮动表面的尺寸约束读取 CSS，避免 header 移动重新套用旧硬编码下限。`DrawerShell` 用捕获指针的左边缘调整宽度，箭头键 ±24px、Home 还原，不保存尺寸到项目/设置；账户 360px 以下的概览/筛选单列排列。
- 真实 UI 证据：`node .diagnostics/dialog-resize-probe.mjs` 最新报告 `.diagnostics/electron/dialog-resize-ui-2026-10-13T03-48-28-078Z/report.json` 为 `ok:true` / 9 checks / 23 screenshots / 0 真实模型请求。7 个内容表面覆盖实际拉大、拉到最小值、再放大后收窄应用到 884×640，草稿状态保持、header/footer 可见、body 在表面内且无横向溢出；设置抽屉 420→540→360→384→420，账户 390→510→320→344→390，最窄 body 无横向溢出。
- 探针修正：导出中心初次断言把 `minmax(300px, 0.46fr)` 内的空格错误拆为多列，截图与 computed CSS 证明实际已经切换窄布局；Home 初次断言错误要求重置一定缩小，已按恢复默认初始宽度校验。仅修正忽略目录中的探针，没有为这些失败改业务逻辑。
- 编译证据：`corepack pnpm run test:ui-foundation`（10 required tokens / 5 layer contracts）、`corepack pnpm run typecheck`、`git diff --check` 退出 0；`corepack pnpm run build` 1680 modules、23.91s、退出 0。随后账户窄栏 CSS 已由上述真实 UI 验证，将在本地 EXE 打包时再次 production build；制品与包内 smoke 尚未完成。
- 包内 checkpoint：首个开发 EXE 已生成，模型/导出/设置/账户/成果编辑器尺寸路径通过，查看器独立 probe 也通过；`.env` 与 2 组测试 Key 均不在 ASAR，121 个 dist 文件与 4 个 Main/preload owner 字节一致。探针旧 close selector 误选最大化、画布查看入口 selector 未覆盖压缩 class，仅调整忽略目录脚本。检查成果编辑器 compact 截图发现提示词行在 460px 高度被表单 hidden overflow 裁切，改为表单内部纵向滚动，重新构建制品后只复查此表面。
- 开发体积记录：首次 `test:bundle` 退出 1，CSS 277,513 B 超过正式 270,000 B 门槛；无 AIDebug 标记泄漏，plugin JS 86,177 B 在限额内，`bundleEnforced:false` 开发打包不因此阻断，不为本次弹窗改动扩大到发布体积重构。最终值待最新构建更新。
- 最终收口：成果编辑器表单纵向滚动已纳入最新 EXE，`node .diagnostics/dialog-resize-probe.mjs --exe=<包内 SparkAIWorkSpace.exe> --only=node-editor` 报告 `.diagnostics/release/dialog-resize-ui-2026-10-13T04-32-32-769Z/report.json` 为 `ok:true` / 1 check / 3 screenshots；提示词在最小高度下可滚动到完整可见且可命中，header 拖动保留缩小宽度，最大化/还原保留原尺寸，884×640 不越出表面边界。查看器独立报告 `04-28-05-365Z` 为 `ok:true` / 1 check / 3 screenshots；前一个包内 `04-23-25-804Z` 完成模型/导出/设置/账户/编辑器 5 个 checks，但后续查看器探针入口超时，未把整套报告宣称通过，相关入口选择器修正后只追加查看器验证。
- 最终构建：`corepack pnpm run package:win:unrestricted` 退出 0，含接入变体专项、production build 1680 modules / 22.09s、Electron/NSIS/品牌封装；`test:ui-foundation` 最终复核通过，TypeScript 没有后续变化，之前 `typecheck` 退出 0 保留有效。最终 Bundle 的 CSS 277,505 B 超过正式门槛，其他硬尺寸项通过、无 AIDebug 标记泄漏，core async/core JS/dist advisory 仍超限；不以该开发包宣称正式 Release。
- 最新制品：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，109,836,288 B，SHA-256 `a4c78c35fc328ce72e437c176fa7840ad9d69966fb54d8347a2bd1f2ff46b8e4`。`.diagnostics/dialog-resize-artifact-audit.json` 为 `ok:true`：MZ、121 个 dist 文件与 4 个 Main/preload owner 字节匹配、无 incomplete marker；`.env` 被忽略且未跟踪，ASAR/包外资源无 dotenv、ASAR 无两组真实 Key。
- 未验证：实际安装/卸载、正式发布与所有插件业务逐个复跑；原 Agent Text UI 焦点断言仍按前述边界保留。此轮实际请求只使用隔离 Mock，0 真实模型/图片/视频/Seedance 请求，没有提交、推送、发布或触碰日常配置。

## 2026-10-11 Unrestricted Windows EXE 开发打包：verified

- 用户要求将当前自定义渠道与 Infinite Canvas 交互改动打包成 EXE；执行 `corepack pnpm run package:win:unrestricted` 成功，包含接入策略专项、安装器资源生成、production build（1680 modules）和 NSIS 封装。
- 制品：[SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe](release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)，109,835,264 bytes，SHA-256 `f7c27e16a619568dce6f9fd438aff1c9559fe98032c6da7c496b18f023e3256a`。
- 隔离核验：`release/.naimage-release-incomplete.json` 不存在；`release/win-unpacked` 没有 `.env` 文件；`app.asar` 不含两组真实 Base URL 或 API Key。`.env` 仍由 `.gitignore` 忽略，未被 Git 跟踪。
- 这是当前 dirty worktree 的开发包，`bundleEnforced:false`；本轮未执行安装/卸载 smoke、提交、推送或正式发布。

## 2026-10-11 真实渠道目录与图片验证：verified

- 用户提供两组可撤销测试凭据，并授权逐个读取 `/v1/models`、每个渠道最多一次 `n=1` 图片请求；本轮未测试视频或 Seedance。
- 已写入本机 `sparkai_workspace/.env`：qiuqiu `https://api2.qiuqiutoken.net` 与 supeai `https://supeai.top`，只保存本地测试变量；`sparkai_workspace/.gitignore:22` 忽略 `.env`，`git ls-files` 确认为未跟踪。
- 只读目录结果：qiuqiu HTTP 200、14 个模型并包含 `gpt-image-2`；supeai HTTP 200、11 个模型并包含 `grok-imagine-image-2.0`。
- 真实图片结果：`.diagnostics/real-channel-image-2026-10-11T13-42-05-735Z/report.json` 为 `ok:true`；两个渠道各返回 1 张图片，POST 计数均为 1，未发生重试。报告只保存渠道、模型、协议、结果类型/长度等脱敏信息，不含 API Key 或 Authorization。
- 本轮未提交、推送或发布；未访问其他渠道、未测试视频/Seedance，也未把 `.env` 或真实响应复制到代码、普通设置或 GitHub。

## 2026-10-11 参考范围扩展到 UI 和画布交互：verified

- 用户追加 UI、交互和画布优化范围；原渠道模型发现保持，本轮已完成对照 Infinite Canvas 的适用产品交互。
- 当前工作区保留本轮未提交改动，没有提交、推送或发布；固定参考提交与本仓库导航/选择/工具栏 owner 已核对，未引入旧工作流或第二套画布状态。
- 验证增量已完成：画布专项实际覆盖新导航、选中和悬停 UI，并保留截图证据；真实模型、Seedance、外部服务部署和安装包不在本轮范围。

## 2026-10-11 Infinite Canvas 交互适配：verified

- 对照固定提交 `3a6b64b602ad062b29fac66902ed18a7ef5fd9dc` 的 `canvas-selection-toolbar`、`canvas-node-hover-toolbar`、`canvas-toolbar`、`canvas-mini-map` 和 `canvas-zoom-controls`，确认 SparkAI 已有缩放/小地图/框选/空格平移和右键菜单，但选中后的高频动作仍集中在菜单里。
- 采用范围：新增轻量选中快捷栏和节点悬停快捷栏，所有动作回调现有 `main.tsx` owner；不复制参考项目的任意节点注册表、文本/音频节点、第二套 viewport/session 或供应商选择编码。
- 证据：Electron 画布专项 `.diagnostics/electron/aidebug-2026-10-11T10-25-27-813Z/report.json` 实际覆盖小地图、缩放滑杆、选择/平移、撤销、选中快捷栏、节点悬停快捷栏和“引用到 Agent”焦点转移，所有 navigation proof 为 true；`smallWindowProof.ok:true`、`documentOverflowX:false`，截图为 `canvas-interaction-toolbar.png`。`corepack pnpm run aidebug:canvas-clarity`、`corepack pnpm run typecheck`、`corepack pnpm run build`（1680 modules）和 `git diff --check` 通过。真实模型与外部渠道保持不访问。

## 2026-10-11 开源画布对照并扩展渠道入口：verified

- 状态：verified；用户希望模型列表像开源画布一样从渠道自动读取，而不是先手动填模型名。调研了 Infinite Canvas、其 NewAPI/Sub2API 变体、Jaaz 和 Open Canvas。
- 设计决定：采用“渠道连接 → `/v1/models` 读取 → 勾选模型 → 选中模型携带连接”的最小路径；已有自动刷新和手动补充保留。探测凭据只经 Main IPC 使用，不进入缓存或返回 DTO。
- 当前事实：Infinite Canvas 的 `ModelSelectModal` 已验证这种交互；本仓库现已补齐 Main 只读探测桥、弹窗渠道输入/模型合并，以及只给明确勾选模型写入的连接绑定。目录查询复用 Main 15 分钟缓存，凭据不进入模型缓存或返回 DTO。
- 验证：本地 loopback `/v1/models` UI 专项通过：1 次真实本地目录请求、第二次点击缓存命中、返回模型全部可见筛选、Grok 模型勾选保存、普通设置 JSON/密文文件均未出现明文 Key；截图与报告在 `.diagnostics/electron/model-discovery-ui-2026-10-11T07-47-56-428Z/`。另通过 `test:ipc-registration`、`test:settings-lazy-load`、`typecheck` 和 production build。
- 未验证：真实 NewAPI/Sub2API 目录、真实生图/视频/Seedance、正式安装包和发布边界均不在本轮范围。

## 2026-10-11 渠道模型自动发现：verified

- 状态：verified；用户明确要求自定义模型列表自动从 NewAPI、Sub2API 或其他兼容渠道读取模型，不再依赖手动输入模型名。
- 当前事实：Main 已有按全局连接、账户 Token 和逐模型连接聚合 `/v1/models` 的目录 owner；本轮把模型配置弹窗改为打开即调用既有刷新回调，并让图片配置的显式刷新传 `forceRefresh`，同时把“自定义模型”改成可选的手动补充说明。
- 验证：从桌面仓库执行 `corepack pnpm run test:settings-lazy-load`（67 cases）、`corepack pnpm run test:model-ux`、`corepack pnpm run test:model-catalog`、`corepack pnpm run typecheck` 和 `corepack pnpm run build`（1678 modules）均通过；既有 Electron `test:agent-text-ui` 中的模型 picker 可见性/键盘交互检查通过，报告 `.diagnostics/electron/agent-text-ui-2026-10-11T01-26-56-181Z/report.json` 为 155 checks、0 failures、networkUsed=false。
- 未验证：真实 NewAPI 目录、真实生图/视频/Seedance、正式安装包和发布边界均不在本轮范围。
- 下一步：如果需要验证某个具体部署，只做一次只读 `/v1/models` 目录检查；真实生图、视频与正式发布不属于本轮。

## 2026-10-10 1.0.9 正式发布完成：verified

- 状态：verified；用户授权的 Windows x64 打包、正式门禁、完整安装升级、推送 tag 和 GitHub Release 已完成。后续只同步发布状态文档，不重新生成或移动正式制品。
- 冻结源码：`33e3ba12aaeaf142e38865c8bd5b60a0bd7e14d6`；`v1.0.9^{}` 与 `origin/main` 冻结提交一致，正式编排前后源码指纹一致，`release/.naimage-release-incomplete.json` 已清除。
- 正式报告：`.diagnostics/release/final-release-2026-10-10T05-57-58-538Z/orchestrator-report.json`，`ok:true`；`release:verify` 124/124 门禁通过，production build 1678 modules，Bundle CSS 269,827 B，package:smoke、installer smoke、1.0.8→1.0.9 完整安装升级、update manifest、签名、helper 和 SHA-256 复核均通过。
- 正式资产：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`（109,829,632 B，SHA-256 `e4c2c3b9b9a52403375857b2cb4f346ce2fa951ec1c8ff4e37d6b6973ac30684`）、`naimage-Restart-Update-1.0.9-x64.asar`（51,933,346 B，SHA-256 `62eb5eb8cf179a71b046110461b41d53325c3d2236b2a41ad941912e9b291417`），另有 `desktop-release.json`、EXE sidecar 和 `SHA256SUMS.txt`。
- 远端证据：`.diagnostics/release/publish-v1.0.9-2026-10-10/remote-assets-verification.json`，GitHub [v1.0.9 Release](https://github.com/naMeaning/SparkAI-WorkSpace/releases/tag/v1.0.9) 为 latest、非 draft、非 prerelease，5/5 资产大小、远端 digest 和本地 SHA-256 全部一致。
- 未验证/边界：正式编排使用隔离 Mock，不代表其他供应商、真实视频或 Seedance 协议已在线验证；未发布 SparkAPI-only 变体。下一步为提交并推送本次文档状态收口，保留 `v1.0.9` tag 不动。

## 2026-10-10 1.0.9 正式发布收口：superseded by verified release entry above

- 状态：superseded；用户已授权 commit、push、annotated tag 和 GitHub Release；发布范围聚焦当前模型配置功能及其必要的异步菜单竞态修复。继续禁止真实生图、视频、Seedance 和付费请求。
- 修复 `src/main.tsx`：`focusWorkflowNode`/`focusWorkflowNodes` 增加 `closeCanvasMenu` 选项，后台布局重定位回调传入 `false`，避免延迟定位在上下文菜单已打开后把菜单清除；用户主动定位仍保持关闭菜单的原行为。
- 专项证据：`corepack pnpm run test:agent-text-ui` 通过，`155 checks`、`23 screenshots`、`0 failures`、`networkUsed:false`；报告 `.diagnostics/electron/agent-text-ui-2026-10-10T04-16-28-739Z/report.json`。`corepack pnpm run typecheck`、`corepack pnpm run build`（1678 modules）和 `git diff --check` 通过。
- 以上“尚未创建 tag 或 Release”的状态已由同日正式编排和远端核验取代；保留本段作为发布前决策记录。

## 2026-10-10 1.0.9 模型配置功能发布准备：superseded by verified release entry above

- 状态：superseded；用户授权打包新的 Windows EXE、推送冻结提交、创建 v1.0.9 GitHub Release，并要求验证聚焦本次模型配置功能。
- 范围：当前 1.0.9 工作树中的 NewAPI/Sub2API 模型获取、Grok 图片配置保留、发布说明、Windows 制品、签名清单和远端 Release；不重复真实生图、视频或付费请求。
- 已有证据：模型 UX、设置持久化（127 cases）、懒加载（67 cases）、typecheck、production build（1678 modules）和 `git diff --check` 均通过；本地 CCS 只读目录联调已在上一条记录完成。首次 `release:final` 已完成源码、打包、安装/卸载、完整安装升级和清单生成，但最终 Windows 元数据门禁发现编排器残留旧 `naimage`/`SparkAI` 断言；实际品牌安装器元数据为 `SparkAI WorkSpace`/`namean`，已修正断言，待重新冻结编排。
- 计划证据：按发布编排生成同一批 Setup、Restart ASAR、manifest、sidecar、SHA256SUMS；远端推送只使用冻结提交和该批制品。
- 当时未完成的发布门禁已由同日冻结提交、`release:final` 和远端 Release 核验完成；本段保留发布前状态记录。

## 2026-10-10 继续审计与 CCS 只读联调：partially verified

- 状态：partially verified；本轮完成最后的 Renderer 依赖审计和 CCS 目录请求，真实 NewAPI 目录、正式安装和发布仍未验证。
- 变更：`main.tsx` 的图片模型可用列表和 Composer 派生值现在同时依赖 `imageModelBindings` 与 `imageModelConfigs`；懒加载专项增加配置弹窗回调及“获取模型”按钮的最小静态断言。模型配置弹窗保存时继续按 `nextPool` 清理被取消的图片配置，未发现需要改动的取消路径。
- 证据：`corepack pnpm run test:model-ux`、`corepack pnpm run test:settings-persistence`（127 cases）、`corepack pnpm run test:settings-lazy-load`（67 cases）、`corepack pnpm run typecheck`、`corepack pnpm run build`（1678 modules）和 `git diff --check` 均通过。
- CCS 证据：只读读取 Grokbuild/Codex 的 Sub2API 配置并请求 `/v1/models`，分别得到 HTTP 200/14 个模型（含 `grok-imagine-image-2.0`）和 HTTP 200/27 个模型（含 `gpt-6.1-sol`）；凭据只在内存中使用，未输出或保存 Key、Cookie、原始响应，也未调用生图、视频或付费接口。
- 下一步：如需升级为完全 verified，使用独立 NewAPI 配置再做一次只读 `/v1/models` 检查；否则可按当前部分验证结果交付实现。

## 2026-10-10 保留 Grok 配置并补齐模型获取：partially verified

- 用户把当前优先级切换为配置持久化与模型目录获取：图片模型和对话模型都需要支持 NewAPI/Sub2API 获取，并且更新或迁移后不能清理已有 Grok 图片模型配置。
- 已完成：修复模型池归一化、模型目录分类和缓存指纹对 `imageModelConfigs` 的遗漏；配置弹窗增加显式“获取模型”；Main 的自定义和账号模式均按全局/逐模型连接聚合 `/v1/models`，错误时保留旧目录并写入脱敏状态，缓存不含 Key/Cookie。临时 Electron 自检导出的 `newApiModelSettings` 已移除，运行时 IPC 依赖仍保持 Main 内部注入。
- 影响边界：设置 persistence/migration、Main 模型目录缓存与 IPC、图片配置、Agent 对话模型配置；保持外部 New API 和 Extension 独立。
- 证据：`test:model-ux`（含 model catalog）、`test:settings-persistence`（127 cases）、`test:settings-lazy-load`（67 cases）、`typecheck`、`node --check` 和 `corepack pnpm run build`（1678 modules）通过；隔离 Mock 验证对话与 Grok 图片模型进入正确目录。本轮从 CCS 的 Grokbuild Sub2API 配置只读 `/v1/models` 返回 HTTP 200/14 个模型并含 `grok-imagine-image-2.0`，同一 CCS 的 Codex Sub2API 配置返回 27 个对话模型；未调用生图/视频。
- 清理：已删除本机 Mock 目录 `本机临时 Mock 目录`，未留下工作树未跟踪文件。
- 状态：partially verified；真实 NewAPI `/v1/models`、正式安装和发布仍未验证。

## 2026-10-09 推送与 GitHub Release：in progress

- CSS 修复已完成并通过最小验证：`test:production-symbol-compaction` 通过；`corepack pnpm run build` 通过（1,678 modules、20.61 s）；`test:bundle` 通过，CSS 269,827 B、plugin JS 86,177 B、无 AIDebug 泄漏。生产压缩器把 LightningCSS range 归一为 CSSO 可处理的 min/max 形式，保留 884px 最小 BrowserWindow 会命中的 `max-width:900/980/1000/1100/1280/1320` 规则，移除低于 884px 的 viewport 媒体块，并启用 forceMediaMerge；容器/高度/无障碍媒体仍保留。dist 静态核对确认 `max-width:820px` 与原始 `width<=` 不存在，884px 相关规则存在。未重复源码全量门禁、真实模型请求或安装操作；下一步只打包当前候选并做隔离 884×640 冒烟。

- 当前候选已重新打包：`build-access-variants.mjs --variant=dual-access --package --enforce-bundle` 通过，Unrestricted EXE 为 109,828,608 B，SHA-256 `00f0615c1d365b5a521d0615645166d167e6cbeecc17943244ca4b0a87c8f3ac`。默认 packaged smoke 与 884×640 主题/素材/JPEG 冒烟均通过，报告 `.diagnostics/release/packaged-smoke-2026-10-09T15-40-52-622Z/report.json`，结果 `realProviderRequests=0`。诊断脚本只放宽 1px 的窗口边界舍入以吸收 Chromium 几何取整，不改产品代码；正式安装/升级仍未验证。

- 提交 `7a9e6ae` 已推送 `origin/main`，`git rev-parse HEAD` 与 `git ls-remote origin refs/heads/main` 一致。正式安装/升级、同次 `release:final`、tag 与 GitHub Release 仍未执行，原因是当前环境没有可用的干净 Windows 安装隔离面；不触碰日常安装来伪造该证据。

- 2429ea1 的 124 项源码门禁、签名候选和 223 个源码/dist 对应文件完整性复核通过，Unrestricted EXE 109,827,584 B，安装器 UI 19 captures 通过。包内程序真实 JPEG 导入/回读、画布原图/参考图选择通过，后在 884×640 主题按钮命中检查失败。只读诊断确认 LightningCSS 将宽度媒体查询改为 range，CSSO 5.x 再压缩会删除这些块，生产 dist 只剩 reduced-motion 媒体块，截图显示顶栏标签重叠；“移除二次优化调用”的初步方案已 superseded，实际修复见上方 CSS 记录。完整发布目标不缩减，旧候选不能发布；本轮 0 新付费请求。

- Glass GUI 修正专项已通过：.diagnostics/electron/glass-workspace-2026-10-09T08-32-21-412Z/report.json ok=true，29 checks、37 screenshots、0 failures、0 应用 console error；884×640 保存后复开 saveDisabled=true、关闭正常、无横向溢出，冷重启和真实拖动提交/清理均通过，已查看设置截图。静态 Glass selftest 通过，生产 build exit0/22.91s。仅变更一个测试与三份文档，四路径凭据扫描无命中；提交推送后从 Glass workspace GUI 精确续跑，复用前 114 项并实际执行后 10 项，随后打包当前 EXE。

- 本次续跑报告 verify-2026-10-09T08-17-00-330Z 源码稳定，前 114 项通过，Skill/Goal/commerce GUI 均通过；第 115 项 Glass GUI 在 884×640 复开外观后关闭进入未保存设置确认。已查看 failure-state.png，原因是无登录的空账户夹具与 Mock 目录固定 token 1/default 不一致，重新加载元数据改变草稿。仅对齐测试假账户字段并新增复开后保存按钮 disabled 断言，不跳过关闭保护、不改生产设置；第一次专项已通过关闭和冷重启，后在 compositor 提示旧断言失败：系统 prefers-reduced-motion=true，现有最终可访问性样式将 will-change 设为 auto，而真实 transform 位移 133/78、按下和松手漂移 0、保存位移及结束清理均正确。测试按系统策略核验 promotion hint，仍要求所有真实位移、状态和清理；再次专项待运行。build exit0/22.91s。本轮付费图片请求仍为已完成的 1 次。

- Skill GUI 测试对齐已通过：报告 `.diagnostics/electron/aidebug-2026-10-09T07-47-34-056Z/report.json` 为 ok=true、6 主场景、0 failures；8 项验收全 true，主窗口真实键盘选 replace-source、独立窗选 clear-attachments，发送进入 Mock Runtime 并完成，复读均为 auto。主窗等待 listbox 实际焦点初始化，保留选项命中/可见和字段布局；已查看主窗截图。假运行夹具不在 Main 中，正确 stale-run 清理不再误判为忙碌失败；复读夹具不设置 scope mode。修正后 build exit0/20.61s。仅改变一个 suite 与三份文档，生产行为不变；冻结后允许从旧稳定报告 Skill node GUI 精确续跑，复用前 111 项。


- 9c33434 从头源码验证前 111 项通过（包含菜单和图片容器/Graph CLI），第 112 项 Skill GUI 超时等待 `.project-agent-steer-mode select`；报告 `.diagnostics/release/verify-2026-10-09T07-01-40-139Z/report.json` 源码稳定。正在核实现有 GlassSelect 与 main/独立窗 TaskScope 的测试入口，保留可见键盘交互和 reset 合同，不恢复旧 UI。生产生图未改动，本轮真实请求仍仅 1 次，EXE 尚未重打。


- 菜单生产修复已验证：共享 `src/ui/menu-surface.tsx` 保留 preventScroll，只滚动菜单自身，使键盘焦点项可见。`aidebug:menus` 报告 `.diagnostics/electron/aidebug-2026-10-09T06-56-17-031Z/report.json` 为 8 场景/0 failures；19 按钮小窗口 End 后 scrollTop 0→70、末项聚焦且完整可见，截图已查看。修正后 build exit0，未改断言、字号或画布滚动，0 新模型请求。地图 v87 和发布四份说明已在冻结前同步；本轮将重新完整验证，不复用旧源码门禁。


- 本轮真实 Grok 隔离验证已完成：`.diagnostics/electron/grok-live-2026-10-09T06-38-41-634Z/report.json` ok=true，唯一 POST HTTP 200/18239ms；原始 JPEG 1024×1024/152995 B，Main 原字节保存一致，SHA-256 86ffd6f49ebe9a7763a59b6963cccc03d09b62a990c47ced9fdc4b7b259854a2，创建重试为 0，已人工查看内容。仅证明真实供应商→service→Main 落盘；未把它表述为本轮真实主 Agent 工具调用。凭据只在内存，日常登录未改动。
- 0856252 已提交推送。源码续跑复用前 103 项稳定证据，image import/selection/requirement/recovery/clarity GUI 均通过，第 109 项 context menus GUI 失败：小窗口分层菜单 End 聚焦删除成果，但末项不可见且滚动位置不推进。报告 `.diagnostics/release/verify-2026-10-09T06-37-50-373Z/report.json`；正在定位菜单 owner 与测试滚动断言，不将失败报告描述为通过，EXE 尚未重打。


- 用户最新澄清：真实生图验证使用软件 Agent 配置和已提供 BaseURL/API Key，不需要 Windows 测试账户。允许一次隔离 Grok 文生图（n=1、0 自动创建重试），保留软件配置/项目隔离；不刷新或改动日常账户。生图功能验证与 EXE 安装/升级事务分别记录，仍不创建 Windows 用户。
- 第 104 项最终诊断修正已验证：`.diagnostics/electron/aidebug-2026-10-09T06-21-04-855Z/report.json` 与 `image-import-suite.json` 均 ok=true，failures=[]；生产 build 20.85s 通过，Bundle CSS 264672 B、plugin JS 86177 B、无诊断泄漏。变更只在 AIDebug 编译移除块、GUI 测试和三份文档，生产 CSS/行为无净变化；将冻结推送 5 文件，以旧稳定报告从 image import GUI 窄续跑，前 103 项证据由编排器复核，后续全部真实执行。正式安装环境仍未满足，Release 未发布。


- 5c0b3f8 从头源码验证前 103 项通过，第 104 项 image import GUI 失败；报告 verify-2026-10-09T05-43-25-522Z 源码稳定。导入/取消/响应性/资产身份/附件与混合角色均通过；文件夹断言仍只读旧 sourceAssets，而实际 canonical materials 完整保留两 occurrence。初步动画归因被松开前样式快照否定，动画改动已撤回；实际 transform 为有效位移矩阵、left/top 未变化，系统减少动态效果按现有最终样式将 will-change 设为 auto。AIDebug 断言遵守该策略，保留 transform 位移和结束后清理断言；专项与 build 待验证，0 真实请求。

- 正式源码门禁的 `image import` 暴露 Windows 8.3 临时路径误判：`Windows 8.3 临时路径` 经 `realpath` 展开后被当作符号链接，主进程又把规范化后的输出路径判成越界。修正 `image-import-worker.cjs` 的逐级 `lstat` 链接检测和 `image-import.cjs` 的已存在路径规范比较；真实联接/路径逃逸仍拒绝。隔离 selftest 已通过：506 个入口、502 个唯一资产、来源/输出联接保护、16 次快速导入及超时/关闭清理均通过。因涉及产品代码，后续正式验证必须从头运行；Release 仍保持 incomplete。
- 本轮软件内隔离验证通过：`test:agent-text` 验证公开 parentId 指向第二素材、上游 editImage/参考图和最终来源 provenance；`test:view-image`、`test:goal-runtime`（43 cases）通过。`aidebug:ask-user` 报告 `.diagnostics/electron/aidebug-2026-10-09T04-22-32-477Z/report.json` 为 10/10 checks、5 scenes、0 failures；L/M 各有独立 N/O batch-result，冻结 hash 一致且来源 binding 正确，最终截图已人工查看。修正后 production build 退出 0（21.01s）。0 真实模型请求，0 新 Windows 账户。
- 发布准备文档已补充多素材来源修复与软件测试边界，地图 v84；10 文件凭据扫描 0 findings、diff check 通过。修正后 `test:bundle` 退出 0，CSS 264,672 B、plugin JS 86,177 B 均在硬门槛内，无 AIDebug 泄漏；core/dist 仅保留既有 advisory。待冻结提交并推送；完整正式发布仍受干净 Windows 安装环境限制，不使用旧 EXE/旧报告替代，下一次 release:final 需从头验证。冻结后的实际提交/编排状态只写忽略目录 `.diagnostics/release/formal-publish-status.json`。
- 续跑第 52 项失败原因已确认是测试路径表示差异；`corepack pnpm run test:image-collection-export` 在修正后通过。变更仅为 `scripts/image-collection-export-selftest.cjs` 的实际路径 canonicalization；提交后允许从旧稳定报告的 `image collection export` 门禁续跑，后续门禁仍全部真实执行。
- AskUser 新诊断：`.diagnostics/electron/aidebug-2026-10-09T04-13-54-102Z/report.json` 仍为 9/10。Mock 已从 Responses protocol 历史继承原确认任务并派发 parentId=L/M 两请求；真实 Runtime 第二条返回内部校验错误 `SOURCE L1 不属于 parentId=M`。根因是 normalizeImageToolArgs 在有 parentId、无私有 bindingId/assetIndex 时仍使用全局第一个素材。按既有普通模型公开 parentId 合同修正节点内首素材回退，保留显式 selector 与冻结范围校验；专项与最终 build 待跑。之前 build 已退出 0，但不能替代该修正后构建。
- 用户澄清“测试用户”指软件内账户，要求删除本次 SparkRel Windows 用户。停止系统账户验证方案，按已记录的精确 name/SID 撤销私钥 ACL、清理 Profile 与账户；不创建替代 Windows 用户，不触碰日常安装。清理已实际核验：`.diagnostics/release/isolated-user/cleanup.json` 的 keyPermissionRevoked/profileRemoved/accountRemoved 均 true、failure 为空；再次查询本地账户、Win32_UserProfile 和 C:\Users 均无 SparkRel 残留，私钥 ACL 仅 SYSTEM/当前管理员。控制器已退出 0。
- 继续发布前检查：正式 release:final 拒绝当前用户已有安装；Windows Sandbox 与 Hyper-V 当前均 Disabled。保留该保护条件，软件内 Mock 可继续完成产品门禁，但不能据此宣称安装/升级或正式 Release 已通过。最新 AskUser 独立报告 `.diagnostics/electron/aidebug-2026-10-09T03-37-42-566Z/report.json` 为 9/10 功能检查通过；确认回答仅包含“按阶段分批生成”，Mock 的旧请求查找排除了“基于当前两个 SOURCE”的原任务，导致仍只请求一张。下一步修正 Mock 对确认中的原始任务意图继承并保留两来源成果断言。
- 4af35ea 正式前 102 项通过；AskUser 的恢复成果实际成功且冻结比例为 1:1/1K，但旧按钮读取为空；多来源分批的 Mock 只读旧 SOURCE Prompt，实际只派发一张。修正测试读取 canonical 设置；Mock 模型支持最新普通 materials Prompt 的明确逐图意图，以公开 parentId 保持来源，不恢复普通任务的隐藏 bindingId，不自动把全部参考素材当数量。Goal SOURCE 解析保留。专项/相关 Mock 合同/build 待跑，正式 Release 未发布。
- 58c0c1c 正式前 101 项通过（包含素材、成图后对话、UI surface）。登录专项的退出、pending 清理、唯一登录 gate、刷新隔离、注册切换、错误和重新登录已通过；聚合失败仅因 settingsAccessPolicyOk 仍查原生 select option。接入 owner 已为 GlassSelect，修正 GUI 读取真实展开 listbox 的可见/启用 account/custom 选项，SparkAPI-only 分支保留无自定义控件与只读官方地址约束。产品代码不变，专项待跑；Release 保持 incomplete。
- 修正后的 `aidebug:auth-gate` 完整通过：9 scenes、0 failures，报告 `.diagnostics/electron/aidebug-2026-10-09T03-26-11-465Z/report.json`。展开后才读取动态 aria-controls，关闭选单不改变接入模式；退出/刷新隔离和重新登录仍真实演练。build 后冻结此测试变化，从 authentication gate GUI 续跑，复用前 101 项稳定证据。
- 登录断言修正后 production build 退出 0，3 文件凭据扫描 0 findings、diff check 通过；已查看 884px 退出登录截图，无工作台/弹窗残留。最新正式冻结和发布状态由忽略目录报告承接，尚未上传 Release。
- 8eb7f53 的正式续跑前 98 项通过；素材 GUI 的 11 个操作/落盘检查通过，最后重载复读时仍停在接入页，未点击到生图模型配置。调整原生点击 helper：滚动立即执行、目标几何连续稳定后再检查裁切/命中并发送鼠标事件，点击模型分类后明确等待激活；不重试点击、不绕过可视断言，不改变产品。专项待运行。
- 修改后的素材专项通过：12 checks、9 screenshots、0 real model requests，含 providerReload；报告 `.diagnostics/electron/canvas-materials-2026-10-09T03-14-46-949Z/report.json`。下一步完成 build 和冻结提交，以稳定的 `.diagnostics/release/verify-2026-10-09T03-09-37-423Z/report.json` 为来源复用 98 项，从 canvas materials UI 续跑，制品仍不可发布。
- 素材修正后的 production build 退出 0，3 文件凭据扫描/差异检查通过；已人工查看生图模型配置截图。冻结后的运行结果继续只写忽略目录的正式状态报告，直到所有门禁、打包、安装升级、签名和远端资产核验完成。
- 会话持续 Goal 已实际创建并 active，目标为推送、正式稳定版 EXE/签名更新/Release、远端资产复核和临时账户清理；尚未发布。67dd980 从头编排前 96 项通过，第 97 项 Agent 文本 UI 在 Escape 等待处失败。
- 初步确认现有 Drawer 正确打开 settings-unsaved，真实确认框小视口可见，保存选择也能关闭。进一步诊断精确发现仅 modelGroup 不一致：旧初始账户没有选定 Token/分组，但 Mock 目录固定选择 token 1/default。修正隔离初始夹具匹配 Mock 账户，撤销诊断用 React 内部读取和临时断言，保留原 Escape、焦点、可视/裁切检查；产品代码不变，专项尚待运行，制品继续 incomplete。
- 最终夹具专项 `node scripts/agent-text-ui-aidebug.mjs` 通过：155 checks、23 screenshots、0 failures；报告 `.diagnostics/electron/agent-text-ui-2026-10-09T03-06-07-381Z/report.json`。`corepack pnpm run build` 通过（20.57 s），凭据扫描 3 文件/0 findings，diff check 通过。冻结并推送该窄变化后，按前次稳定源码报告复用 96 项，后续所有门禁与制品在新正式编排中真实执行；发布仍未完成。
- 第四次编排通过前 64 项，在 Goal Runtime 的“Renderer/runtime 哈希一致”实测失败。实际镜像缺陷：Renderer canonical materials 哈希与 Runtime 旧 source/reference 哈希不一致。修正 Runtime 的哈希材料字段，保留全套 Goal 执行/费用/漂移字段；这不是测试放宽。此改动属于产品 Runtime，将专项验证和 build 后从头运行正式门禁。
- Runtime hash 修正完成：Goal Runtime 43 场景、普通 TaskScope/Goal TaskScope/执行门禁、context checkpoint 和 production build 通过。补充 source+reference canonical materials 及顺序镜像断言，顺序变化仍改变冻结 hash。前次测试账户已撤销权限并删除 Profile/账户，清理无失败；重新提交推送后创建干净账户从头验证，不复用旧门禁。
- 第三次从头编排（fc3ea89）通过前 54 项，第 55 项 streaming selftest 的源码检查仍要求普通生图走旧 Responses→Images SSE 回退，和当前 Provider service 不一致。对齐生产入口与 service 的可选预览回调检查，保留分槽/替换/安全 data URL/下帧清理/查看器全部行为断言；底层 SSE transport 专项此前已在该次编排通过。此次不修改产品请求和 Provider 参数。
- 修正后的 test:image-stream-preview 通过（30 cases）；窄续跑仅允许该 selftest 与 GOAL/PROGRESS 三个路径变化，旧报告 54 项证据、稳定指纹和提交祖先由编排器重新校验。当前 release 保持 incomplete，后续门禁和制品仍须完成同次正式编排。
- 第二次正式编排（53a17c1）通过前 45 项，UI foundation 发现素材序号使用了未定义 glass-fill，以及画布序号绕过共享 Field。修正真实 owner：复用现有 glass-surface-fill 和 Field，保留尺寸/事件/序号数据链。此轮涉及产品 Renderer/CSS，因此不列入窄续跑 allowlist，完成专项/可见 GUI/build 后从头运行 124 项。
- UI foundation 和 typecheck 修正后通过；production build 与 Bundle 通过（CSS 264,672 B）。素材 GUI 发现旧夹具只有自定义 Key、没有 Base URL，被正确停在授权入口；改用与命令 GUI 一致的隔离 Mock 账户快照，不绕过产品授权、不使用真实登录或服务。正在验证序号与素材完整可见路径。
- 素材可见 GUI 完成：`.diagnostics/electron/canvas-materials-2026-10-09T02-20-53-620Z/report.json` 12 项检查通过、9 张截图、0 真实请求；已查看容器成员/序号控件截图。UI foundation/typecheck/build/Bundle 均通过；本次 7 个源码/文档/夹具路径重新冻结，下一编排不复用前两次门禁。
- 正式编排第一次运行在第 10 项 context checkpoint 停止，前 9 项通过，源码指纹前后一致；当前制品保持 incomplete。失败来自旧断言要求普通任务公开 bindingId，而现有普通 TaskScope Prompt 已按材料列表提供 assetId，Goal 才使用绑定投影。测试改为检查压缩后当前素材身份和 materialCount；不改 Runtime、不恢复旧 SOURCE/REFERENCE 普通任务分类。冻结提交 46b734c 已推送 origin/main；此测试修正需再次提交/推送后重新编排。
- checkpoint 专项修正后通过（16 cases、244,800 Token 自动阈值和新窗口）；本次续跑只允许该 selftest 与 GOAL/PROGRESS 三个路径变化，按正式清单复用前 9 项，其余门禁、打包、安装与升级仍实际运行。运行结果继续写入冻结状态入口的生成报告。
- 续跑 checkpoint：CLI 使用本机现有代理完成设备授权，实际登录 naMeaning；此前无代理的授权在 token 兑换时超时，未误报成功。用户已允许临时标准 Windows 测试账户及短暂读取发布密钥，结束后撤销权限并清理账户；未触碰日常安装/进程。
- 已修复唯一审查 P1：整个遮罩客户端合成阶段的失败都标记已生成且禁止重生；坏 Base64、坏下载字节、批量局部失败、结果返回后取消四场景通过，0 真实请求。image service/adapters/result-download、typecheck、更新自测、发布编排专项通过。
- 新 Ed25519 公私钥配对验证通过，私钥忽略且 ACL 仅本人与 SYSTEM；minimum_version=1.0.9，旧客户端手动完整 EXE 安装升级。CSSO 5.0.5 使用现有生产 CSS owner 压缩，production build 与 Bundle 通过：CSS 264,552 < 270,000 B，没有抬高门限。正式验证目录扩充到 124 项，包含本版供应商/素材/命令/日志专项。
- 新 Unrestricted 独立打包通过；109,828,096 B。实际程序 packaged smoke `.diagnostics/release/packaged-smoke-2026-10-09T01-45-16-486Z/report.json` 和配置/命令 GUI `.diagnostics/release/composer-command-ui-2026-10-09T01-45-15-823Z/report.json` 通过（9 checks、10 screenshots、884×640 配置无溢出、0 真实请求）。此包尚不是冻结源码的同次正式编排产物，不能直接发布稳定版。
- 官方 v1.0.8 完整安装器已从 GitHub 下载并对照资产 SHA-256 验证，提取基线程序 ProductVersion=1.0.8.0/ProductName=naimage。下一步验证临时账户下的安装隔离、完整 EXE 升级和清理，再冻结/推送并运行 release:final。
- 隔离账户验证已通过：标准用户/独立 Profile/HKCU、屏幕 2560×1440、pnpm 10.12.1/.NET 9.0.316 均可用。安装/重装/回滚/卸载完整 smoke `.diagnostics/release/installer-smoke-2026-10-09T01-54-12-906Z/report.json` 为 ok=true，0 遗留文件、0 孤儿进程和操作锁。
- 完整 EXE 升级专项 `.diagnostics/release/full-installer-upgrade-2026-10-09T01-59-35-749Z/report.json` 通过：安装官方 1.0.8、升级到 1.0.9、登记路径不迁移、程序版本/候选 ASAR 一致、设置/项目会话/图片字节保留、实际程序 smoke 和卸载保留数据。第一次失败是测试错误（InstallLocation 应从 install registry 读取，以及 PowerShell 输出须使用 UTF-8）；未修改产品安装器以迎合测试。
- 新 owner `full-installer-upgrade-e2e.mjs` 已接入正式 `package:update-e2e` 的完整安装分支，不再跳过低于 minimum_version 的基线。新增 baseline installer 显式输入，上下文地图/安装说明同步；编排自测通过。接下来冻结源码、推送 main，在新临时账户下执行完整 release:final；当前还未创建 tag 或发布稳定制品。
- 预检账户已清理：发布私钥临时 Read ACL 撤销、该账户 Profile 和本地账户均删除，清理报告无失败。122 个当前改动文件的发布凭据扫描为 0 findings，harness 10 个结构检查通过。新包公钥与当前源码逐字节一致；独立核验完整品牌 EXE 为 NotSigned，SHA-256 8d85c1768c64186eba3d307de57c35cee1aeb3ba07930a885429102a1e1d2673（先前打包日志哈希对应内层 NSIS，不能当作完整 EXE 哈希）。
- 源码冻结 checkpoint：所有版本/最低版本/更新边界/验证入口与发行文档先进入提交；正式编排和远端发布结果写入忽略的 `.diagnostics/release/formal-publish-status.json` 及编排报告，以免构建过程中改变源码指纹。只有同次完整通过且远端资产核验成功才能将本次状态记为 complete；当前尚未发布。
- 唯一只读审查已完成：发现遮罩兼容结果的 Sharp 解码/合成失败缺少 generationCompleted/unsafeToRetry，可能重复计费；五项相关本地 selftest 通过，未修改文件或调用真实服务。用户明确要求修复后发布。接下来补齐整个客户端合成阶段的结果失败边界，验证损坏 Base64、损坏下载结果和取消均不会变成可重生请求。
- 用户明确授权当前源码 push 和发布 Release；保留本轮所有桌面未提交功能和既有任务历史，未更改 Extension/外部 New API。适用正式发布清单要求先冻结源码，再由同次 release:final 生成可发布制品。
- 当前已观测：main/远端 HEAD 为 0dd3f67，SSH ls-remote 成功；远端已有 v1.0.5–v1.0.8，当前 package 1.0.9 未有远端 tag。便携 gh 2.96.0 可执行但未登录。
- 正式前置条件：CSS 288,546 > 270,000 B；既有更新公钥存在，匹配私钥默认文件与环境配置均不存在；本机存在当前用户安装登记及 6 个 SparkAIWorkSpace 进程。不会为通过 smoke 卸载日常应用或创建不兼容的新信任密钥。先完成可独立交付的源码推送与具体发布材料，再解决发布边界。
- 用户澄清：选择正式稳定版，要求先解决全部发布前置条件；确认原私钥丢失并授权更换密钥、完整安装包升级。上述“不创建新信任密钥”的限制由此 superseded，旧版在线签名验证不能兼容新公钥，必须在 release notes/manifest 最低版本/安装说明中明确手动完整安装边界。新私钥不进 Git、制品或报告。
- GitHub 插件连接已实际确认：账户 naMeaning，仓库 public/main，push/admin 为 true；不再要求重复连接。便携 gh 的独立设备授权仍未完成，后续采用可用的授权能力，不把插件连接误报为 gh 登录。用户请求的唯一只读审查 Agent 正在覆盖 staged/unstaged/untracked，未自行重做审查或启动其他 Agent；审查结束后才能稳定冻结当前内容。

## 2026-10-08 图片配置入口与斜杠命令：verified（两种开发 EXE 已交付）

- 用户方向：收起图片参数，删除目标按钮，通过 `/goal` 设置目标；旧普通/Goal 模式切换方向 superseded，既有两阶段确认/冻结/计费边界继续保留。
- 已检查主 Composer → Panel → Main 的设置和 Goal owner，以及独立窗快照/命令中继。设置和执行链复用，不新增 Provider 或重复 Runtime。
- 计划：自然异步图片配置表面，共用斜杠目录/解析，主/独立窗只负责输入交互并调用原动作；未知和空命令本地提示，禁止传给模型或直接生图。
- 验收为隔离 Mock UI、持久化/reload、相关合同专项、quick GUI、build 和两种开发 EXE；尚未实施或测试，0 新真实上游请求。
- 用户追加（实施中）：参考 DeepSeek harness、Codex、Claude Code；具体落地为命令候选/键盘、集中图片配置、/status 本地任务反馈和可恢复运行控制。现已接入共享解析及主/独立表面，待样式、专项和 GUI 验证；尚未宣称可交付。
- 实现里程碑：共享 8 命令、异步图片配置、主/独立窗口与 `agent.image-config` schema/CLI/MCP owner 已接入；取消普通/Goal 触发器，保留原两阶段确认和运行控制。配置真实写入同一 AppSettings，保存异常在弹窗显示；移除旧模式/画幅 CSS。
- 验证：typecheck、commands、model-ux、agent-window、automation-service、workspace-glass-ui、settings-lazy-load 通过；production build 通过（1678 modules）。quick GUI `aidebug-2026-10-08T07-29-45-293Z` 与 Goal 四场景 `aidebug-2026-10-08T07-29-45-288Z` 均 0 failures。专用 GUI `composer-command-ui-2026-10-08T07-35-34-050Z` 为 7 checks/10 screenshots/0 真实模型请求，已查看配置、命令、小窗口与独立窗截图。早期专用脚本失败来自 reload 就绪等待、测试素材误放受管范围之外、独立窗 DOM 就绪和原生 confirm 的 CDP 等待；已逐项修正测试，不弱化产品边界。
- Bundle 趋势：CSS 288,566 B 超正式门禁 270,000 B（此前 292,379 B）；build 本身成功。本轮延续开发 EXE，未准备正式发布，按仓库开发打包规则不阻断；补充 /new/IME 交互及受影响旧测试后打包。
- 源码验收完成：最新专用 GUI `composer-command-ui-2026-10-08T07-40-07-197Z` 为 9 checks/10 screenshots，/new 保留画布、IME Enter 不误执行、580px 配置弹窗在 884×640 可见且 0 横向溢出。Agent Panel 专项 `agent-panel-ui-2026-10-08T07-41-24-273Z` 通过模型搜索/多选/默认与上下停靠/拖动/素材/图片附带历史路径，typecheck 再次通过。旧 lazy-load/Panel/Glass typography 断言已跟随新的配置 owner，移除过时模式/画幅按钮预期；正在顺序打包并验证两变体。
- Unrestricted 开发包已构建（exit 0、bundleEnforced=false），独立复核为 109,827,584 B、MZ、NotSigned、SHA-256 46e7324817b2d88bf5aa70d1b4cafa76a3c7b155f61206e8dcfa5a971dd404a0。实际程序 GUI `composer-command-ui-2026-10-08T07-48-54-080Z` 通过 9 checks/10 screenshots，0 真实模型请求；包内容核验 `composer-command-unrestricted-contents.json` 为 129 文件逐字节匹配（含完整 dist、新命令模块、独立窗与 CLI/MCP 文档/schema），策略 dual-access。
- 包测试证据修正：初次 `07-46-22-347Z` 的“small”截图实际仍为 1280×720；测试现用 CDP viewport override 并强制断言 884×640，最新报告才作为包内小视口证据（580×604 配置弹窗可见且无横向溢出）。原包代码未因此改变；ASAR 首次临时核验的深层路径未按 Windows sep 归一化，修正核验调用后全部匹配。下一步仅打包/验证 SparkAPI，不重复已有真实 Grok 授权。
- 最终交付完成：SparkAPI production build（1678 modules）/NSIS/品牌安装器 exit 0，bundleEnforced=false。实际程序 GUI `.diagnostics/release/composer-command-ui-2026-10-08T07-52-36-757Z/report.json` 通过 9 checks/10 screenshots/0 真实模型请求；884×640 配置表面可见、无横向溢出。已查看两包配置、命令、小视口和独立窗口成果截图；两包各 129 文件与源码/dist 逐字节匹配，SparkAPI 策略为 sparkapi-account。
- 独立核验：两 EXE 均 109,827,584 B、MZ、NotSigned；Unrestricted SHA-256 46e7324817b2d88bf5aa70d1b4cafa76a3c7b155f61206e8dcfa5a971dd404a0，SparkAPI SHA-256 3bdd520c8563ba85f21baf08226c6454f34a005d478510869f2ec6ff8b01113f。汇总 `.diagnostics/release/composer-command-delivery-2026-10-08.json` 替代旧同名安装包元数据，分别保留 artifact/contents 和 GUI 报告。
- 最终 Bundle 复测仅 CSS 288,546 > 270,000 B 失败，无诊断控制面泄漏；build 与本地开发打包均成功，未宣称正式发布。Harness 10 项结构检查通过、测试脚本语法及 diff whitespace 检查通过。主/独立窗口的新配置和普通文本路径已练习，运行中 /pause→/resume→/stop 完整 slash 往返仍未专项端到端实测（共享状态约束与复用 owner 合同已有专项）；本轮 0 真实账户/模型/图片/视频请求，实际安装/卸载、签名与正式发布未验证。当前 UI 目标 complete，下一步从新用户要求继续。

## 成图后对话 502 修复（2026-10-08）

Date: 2026-10-08
Status: in progress
Outcome: 成图后上游对话失败仍交付已完成成果，区分图片完成与后续质检/回复未完成。
Scope: 现有 Agent runtime/model transport/IPC/Renderer 回执，以及受影响专项和修订开发 EXE。
Change: 已检查 live dirty worktree，保留所有已有工作；读取截图与 owner 链，确认后续模型异常直接抛出导致成果回执和协议保存被跳过。Main 已有一次有限临时重试，不能叠加重试或重放工具。
Evidence: 当前仅源码与截图诊断，尚未修改产品代码或运行本轮测试。
Unverified: 上游 502 的内部服务原因、真实账户仍未验证；本轮无新真实请求授权。
Next: 修复 owner 数据回执并建立精确 Mock 回归，然后验证 UI、build 与两包。

### 继续检查与日志边界

- 当前会话的 app Goal 已按用户请求重新接续；继续保留既有脏改动。主/独立窗口成图后 502 专项通过，报告 .diagnostics/electron/agent-post-image-ui-2026-10-08T05-56-31-909Z/report.json，两张截图已查看，实际 image_gen/view_image 各一次、协议保留、0 真实请求。独立窗口原失败是测试直接调用 IPC 绕过 Renderer owner 开窗同步，已改为真实菜单路径，未新增产品补丁。
- 新日志 owner/IPC/preload/设置工具页/共享命令已接入；图片 service 增加可选诊断回调，区分 Adapter 生成与 Main 成果保存，白名单记录协议、模型、数量、耗时及故障分类。test:runtime-diagnostics 通过脱敏、300 条容量、重启、导出成功/取消/失败、日志故障不阻塞调用；test:ipc-registration 为 149/146/3，test:automation-service 通过。
- 本轮最新授权允许正常软件使用原始 Main 受管配置/secret sidecar与刷新持久化进行一次 Grok 生图及后续读图/回复；不复制刷新凭据到隔离配置，不创建额外真实图片。真实测试、日志 GUI 与 EXE 尚待完成。

### 实际 EXE 与真实用户登录通过

- 用户澄清后改用实际打包 EXE，所有 Mock 开关关闭，直接读取已安装软件使用的 canonical 用户目录和现有 settings-secret sidecar；真实 `/me` 成功且有普通账户 user，未配置测试登录或复制刷新凭据。源码窗口此前尝试点击经观察确认没有消息、诊断或成图，0 实际请求，结束后恢复项目选择。
- 本轮仅一次 Grok n=1 真实生成，Adapter 为 xai-images，经现有绑定；18,125 ms 后返回有效 JPEG，Main 保存原始 1024×1024/171,985 B 图片。gpt-6.1-sol 三轮均 HTTP 200，第二轮派发 view_image 并完成，第三轮描述真实图片，最终 UI 为 Agent 思考完成。没有模型重试或再次生图。
- 真实软件报告 .diagnostics/electron/grok-software-live-2026-10-08T06-12-35-404Z/report.json；结果和真实日志页截图已查看。`/me` DTO 没有 authenticated 属性，报告初版误将不存在字段推导为 false，已移除并改为 verifiedByUserApi（根据实际 ok/user 校验），未重新请求。图片副本 release/Grok-Login-Verified-2026-10-08.jpg，SHA-256 9b6dba1f977b4d548cc7da7794f61b86f1cc9bb62959cf1711465254930ae405；测试项目保留在软件项目列表，原活跃项目选择已恢复。
- Unrestricted 的 production build/NSIS/品牌安装器成功，实际 EXE 的 partial 主/独立窗口及日志 GUI 专项通过，报告 .diagnostics/release/agent-post-image-ui-2026-10-08T06-12-33-569Z/report.json。第二变体仍在构建；第一次包内容快照晚于第二次 archive 覆写，已按实际 policy 修正为 SparkAPI 快照，不作为第一变体源码哈希证据。
- 最终专项：runtime 10 场景、view_image、Agent 协议、HTTP/SSE transport、日志、IPC 149/146、automation 命令、typecheck 和显式 build 均通过。test:bundle 仍因既有 CSS 292,379 > 270,000 B 未通过，未发现 AIDebug 泄漏；按开发包规则不阻断此次本地打包，未宣称正式发布。
- 下一步：第二个实际程序 GUI 与源码核查、制品 MZ/哈希/签名独立复核、同步交付记录。

### 本轮开发交付完成

- SparkAPI 变体的 production build/NSIS/品牌安装器成功，实际 EXE 主窗口/独立窗口 partial 与日志 GUI 专项通过，报告 .diagnostics/release/agent-post-image-ui-2026-10-08T06-17-51-050Z/report.json；8 个受影响 Main/runtime/IPC/preload 文件与源码一致，policy 为 sparkapi-account，见 .diagnostics/release/post-image-sparkapi-contents.json。两变体 GUI 各 3 张截图，0 额外真实请求。
- 独立 PowerShell 核验：Unrestricted EXE 109,821,952 B、MZ、SHA-256 ee4ac093b652c8d4cc573102e09c80ff2001704edcab30712890cc5cbd88ff0b；SparkAPI EXE 109,824,000 B、MZ、SHA-256 aec95b5709576dc202a3dcd5e1b9323509a5e6d59c90a9e2e156474d7fa9a413；两者 Authenticode 均为 NotSigned。真实 JPEG 副本哈希与项目文件完全一致，实际测试项目仍在本地软件列表，原项目选择已恢复。
- Goal/地图 v78/当前 IPC 数字/日志与真实测试入口已同步；根 harness 10 个结构检查通过。权威交付汇总 .diagnostics/release/post-image-delivery-2026-10-08.json，取代同名旧 EXE 的记录。
- 本次 Goal 完成；这是本地开发包，未进行实际安装卸载、正式发布、代码签名或其他供应商/编辑真实测试。上游未来 502 仍可发生，客户端已修正 Chat 图片协议，并在此类故障时准确保留成果；本次正常真实调用不能证明上游内部故障原因已消失。

### 本地实现与授权更新

- runtime 已在后续模型失败时保留实际图片 actions/toolResults，保存本轮协议并明确返回 completion=partial；图片读取成功不再当作视觉质检完成。工具失败/批量失败保留错误语义，取消和 steer 不走成果部分回执。
- 既有协议 Adapter 补齐 Runtime Responses 内容到 Chat Completions 的转换：tool 只发文本，图片以 user image_url 回到同一主模型，批量 tool 输出全部配对后再发送图片。Main 与旧 direct fallback 共享转换；没有按模型名扩大 Responses 路由。
- 10 个 Mock runtime 场景通过，报告 .diagnostics/electron/agent-post-image-2026-10-08T05-40-03-070Z/report.json；持续 502、成图后尚未读图、读图失败、批量部分失败、部分流输出、首轮失败、生图失败、取消、steer、正常完成。0 真实请求、后续错误不重放生图、协议保留。
- test:agent-text、test:view-image、test:agent-protocol、test:custom-api-transport、test:ipc-registration、model-ux 和 agent-window-sync 通过；typecheck 通过。GUI 首次 fixture 未取得 output path，正在检查测试工具参数/错误结果，尚未声称 UI 通过。
- 用户新增授权使用本地登录会话；本轮允许验证已有成图的真实后续对话，0 新真实生图。不再次探测旧刷新凭据；先定位当前 Main 受管凭据链并避免复制/记录凭据。
- 用户随后明确授权软件内真实生图测试，并要求本地日志查看/导出；本轮计划一次 n=1 Grok → view_image → 主模型回复，图片不自动重建。该最新授权 supersedes 前条的 0 新真实生图限制，凭据只在 Main/测试进程内存使用。

## 原格式图片与哆啦A梦真实验证（2026-10-08）

Date: 2026-10-08
Status: verified
Outcome: 按供应商原格式直接保存和显示图片，真实生成一张 Grok 哆啦A梦并更新两种开发 EXE。
Scope: 既有 service/Adapter/transport/Main 资产链、相关 selftest、隔离在线探针和打包程序素材冒烟。
Change: 用户明确替代上一轮 JPEG 转 PNG 的决定；移除生成结果强制编码，保留安全解码、受管路径与已生成结果不可重生成保护。continue 已核对脏工作树，既有素材/供应商功能与其他改动保留。
Evidence: 三 Adapter × 三格式原字节保存与 Agent direct fallback 专项通过；本次一张真实哆啦A梦 JPEG 与供应商原图完全一致。build、两种修订开发 EXE、各实际程序的实图保存/导入/素材检查、源码与包内文件、MZ/哈希/签名状态均已核验，汇总 .diagnostics/release/grok-doraemon-delivery-2026-10-08.json。上轮两张真实测试仅为历史，不计入本次单张授权。
Unverified: 真实账户继续 deferred，其他真实供应商/Grok 编辑/实际安装卸载/签名/正式发布未验证。
Next: 本次开发交付完成；从新的用户要求继续，不重复创建已完成的真实生图。

### 原格式本地链路通过

- Main 已移除转码与请求格式强制匹配；生成结果直接保存供应商字节，真实 MIME/扩展名/尺寸/outputFormat 和 response 参数同步。仅为转码新增的 Adapter 属性及 Agent/手动 IPC 落盘协议上下文已删除；WebP 只解码到 raw 验证，导出链保持独立。
- test:image-result-download 通过：三 Adapter × 三格式的原字节完全一致，错误 MIME/格式元数据和默认 PNG 不影响有效结果，PNG 请求 WebP 也保留原图；损坏/空/超限结果拒绝且标记已生成不可重试，URL 下载分类/原路径仍通过。报告 .diagnostics/electron/image-result-download-2026-10-08T04-58-19-513Z/report.json，0 真实网络/模型请求。
- test:image-generation-adapters、test:image-generation-service、test:ipc-registration（147/144）、test:image-generation-metadata（13）、test:view-image、encoded-image-format-selftest 通过；在线探针及 packaged-smoke 语法通过。Agent 专项仍在运行。
- 在线探针已改为用户要求的哆啦A梦，一次 n=1；报告比对供应商原图与受管结果字节，不自动再次创建。生产冒烟素材输入现按真实 JPEG/PNG/WebP 解码与命名。
- 下一步：执行该一次授权真实请求，查看实际图片并记录原字节证据，再 build 和两包生产验证。

### 真实哆啦A梦通过，准备修订 EXE

- 用户授权的本次一次 n=1 请求已完成：supeai.top /v1/images/generations，grok-imagine-image-2.0、xai-images/newapi/sync，HTTP 200、20,253 ms、0 自动创建重试。实际返回 JPEG Base64，1024×1024、172,830 B；Main 受管 .jpg 与供应商原始图片逐字节相同，SHA-256 bb8d3598b80cdf3cebfb967708f968515072f3c6363a96c23f26165e98b2be15。
- 脱敏在线报告 .diagnostics/electron/grok-live-2026-10-08T04-59-15-321Z/report.json；原图、受管结果和交付副本 release/Grok-Doraemon-2026-10-08.jpg 哈希一致。已实际查看成图，内容为用户要求的哆啦A梦。没有写入测试密钥、日常账户/设置或外部后台。
- 初次显式 corepack pnpm run build 通过（1676 modules、22.50s）。Agent test:agent-text 通过，已生成的解码失败后模型改变参数仍只调用一次 provider。
- 补齐 agent-runtime.cjs 的旧 direct fallback：有效结果不再以请求编码拒绝，实际格式写入 response 元数据，正常 Electron 仍只走原统一服务。本地 test:image-format 新增三格式真实 runTool Mock 的原字节断言，通过；首次夹具尺寸 8×6 被既有 1K 交付画幅重采样导致断言失败，改为符合原画幅合同的 1024×1024 夹具。Windows Sharp 文件缓存导致测试清理 EPERM，禁用该测试的 Sharp 缓存后通过，未修改产品画幅行为。
- 根 harness 10 个结构检查、git diff --check 通过；补充的 runtime 改动将由最终专项和打包内的 production build 复核。
- 下一步：两种开发变体依次构建/打包，各自核查包内修订文件并用本次真实 JPEG 做 production 程序冒烟，之后记录当前制品哈希。

### Unrestricted 修订包通过

- 最终 runtime 的 test:agent-text 与 test:view-image 均通过；package:win:unrestricted 内的 corepack pnpm run build 通过（1676 modules、20.19s），NSIS/品牌安装器退出 0，bundleEnforced=false。
- 新 Unrestricted EXE 109,817,856 B，SHA-256 de94e93aea74ed0d725976db6959ff6e0f27a1bdc95041fc85db64e7872a7d01。6 个图片链文件与当前源码完全匹配、接入策略 dual-access、MZ 通过，报告 .diagnostics/release/grok-doraemon-dual-access-contents.json。
- 实际打包程序使用本次真实 JPEG 的 --check-image-adaptation --check-theme-entry --check-native-account --material-image 验证通过，报告 .diagnostics/release/packaged-smoke-2026-10-08T05-06-44-291Z/report.json：JPEG 保存/读回/导入、画布素材/右键/配置 reload、主题与隔离账户检查全部通过，0 新真实 provider 请求。接下来完成 SparkAPI 变体及制品独立核查；签名状态尚待本轮读取，未宣称安装卸载或正式发布通过。

### 原格式修订交付完成

- package:win:sparkapi 的 production build、NSIS/品牌安装包退出 0，bundleEnforced=false；每包 6 个图片链文件分别匹配当前源码、接入策略正确。两个实际程序使用同一真实 JPEG 的完整冒烟全部通过：Unrestricted .diagnostics/release/packaged-smoke-2026-10-08T05-06-44-291Z/report.json，SparkAPI 05-09-49-467Z/report.json，各 16 张截图，0 新真实 provider 请求。
- 已查看 Unrestricted 画布原图图库截图，哆啦A梦 JPEG 可见；读回 data URL 完全一致，两个程序保存与导入后的文件都与在线原图逐字节相同。图片保持 image/jpeg/.jpg、1024×1024、172,830 B，未转码。
- Unrestricted：release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe，109,817,856 B，SHA-256 de94e93aea74ed0d725976db6959ff6e0f27a1bdc95041fc85db64e7872a7d01。
- SparkAPI：release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe，109,817,856 B，SHA-256 6d739478e6e2892000f7349540c3f73ca24eb6a5fe67287f842191c12fa2e970。
- 独立汇总验证 MZ/大小/哈希、当前源码与包内快照、图片原始字节、两个程序的保存/导入字节和签名，均通过；两包实际 Authenticode=NotSigned。汇总 .diagnostics/release/grok-doraemon-delivery-2026-10-08.json，替代同名旧制品记录。汇总脚本首次 WinPS 5 安全模块加载失败，改用现有 PowerShell 7 后真实签名读取通过，不影响安装包或生图结果。
- 本次累计仅一张授权的真实 Grok 哆啦A梦、0 自动创建重试；探针/本次在线与程序报告未发现测试凭据。日常账户/配置与外部 New API 未修改，真实账户仍 deferred。Grok 编辑、其他真实供应商、实际安装卸载、签名/正式发布未验证；本地开发交付完成。

## Grok 真实中转复验（2026-10-07）

Date: 2026-10-07
Status: verified
Outcome: 使用用户明确授权的中转测试凭据取得真实 Grok 图片，修复既有客户端链路并更新开发 EXE。
Scope: 既有图片 service/Adapter/transport/Main 落盘；独立隔离探针与相关专项，不修改真实账户和设置。
Change: 用户反馈上一修订仍失败并授权 https://supeai.top 真实生图；新授权替代此前 0 新真实请求限制，旧 Mock 验证不能证明此次中转可用。自动 Goal 已恢复；保留当前大量未提交改动。
Evidence: 本轮尚未发出真实请求。已检查现有 xAI 默认 b64_json 和结果下载错误修订；此前 HTTP 200/AggregateError 仅为历史证据。
Unverified: Grok 编辑/参考图、其他真实供应商/渠道、deferred 真实账户、完整安装/卸载、签名和正式发布。
Next: 本次真实文生图及修订开发 EXE 已交付；新的真实服务范围需要依据后续用户目标处理，不恢复已延后的账户验证。

### 真实复现检查点

- 首个授权请求实际耗时 19,365 ms，HTTP 200，n=1；中转返回 229,460 字符 b64_json、mime_type=image/jpeg，实际字节签名也是 JPEG。
- 现有 Adapter/service 正常识别结果，实际 Electron Main 落盘失败为 NAIMAGE_IMAGE_OUTPUT_FORMAT_MISMATCH；当前默认要求 PNG，而 xAI 请求没有指定输出编码。此次已经确认生成成功，不能把落盘失败当成上游生成失败。
- 脱敏报告：.diagnostics/electron/grok-live-2026-10-07T15-35-13-295Z/report.json；仅一次 POST，未保存密钥、原始响应或签名 URL。此前历史 AggregateError 的内层网络错误仍未还原。
- 修复方向：由 Adapter 声明是否支持请求输出编码，既有受管落盘在编码由供应商决定时做本地真实格式转换，OpenAI 的既有严格格式校验保留；下载和格式保存失败继续禁止重新生成。

### 修订链路真实通过

- Adapter 新增 outputFormatControl，Main 根据实际连接 protocol 转换供应商编码；Agent 和手动 IPC 均传递协议，无前端请求分叉。OpenAI 的严格校验保留；WebP 完整解码验证；已返回图片的处理失败保留不可重生成标记和具体 advice。
- 修订后的第二次明确验证请求 21,984 ms、HTTP 200，真实 JPEG 175,415 B 已经 Main 落盘为 PNG 803,210 B、1024×1024；已查看真实成图。来源 JPEG 和 PNG 解码像素逐字节相同，像素哈希 156a3997bb05eb09fabdb1f994680019f11a64b29a87abbfed9af4502a9058fe；PNG SHA-256 b03effb5bbbdad55aa545cc9e6b3d104c785b8d36195533f4762307c5ffa58ad。
- 在线报告：.diagnostics/electron/grok-live-2026-10-07T15-48-10-078Z/report.json；像素报告同目录 pixel-verification.json，真实成果位于其 project/output/imagegen/grok-real-main-01.png。本轮合计两次各一张的 POST、0 自动创建重试；首个探针漏存原图，未将第二个请求描述为下载重试。
- 专项通过：test:image-result-download（JPEG→PNG、WebP 像素保留、JPEG 原字节、别名模型、错误 MIME、OpenAI 严格校验、损坏结果和下载分类）、test:agent-text（处理失败后模型改 quality 仍只调用一次 provider）、test:image-generation-adapters、test:image-generation-service、test:ipc-registration（147/144）、encoded-image-format-selftest、test:view-image、test:image-mask-compat（66 像素/5 禁重建）。
- 下一步：从最终源码 build 并重打包两种开发 EXE，各变体使用本次真实 PNG 做实际程序画布/素材显示检查，核查包内修订与制品哈希。未改日常配置或账户，未做其他真实模型/编辑请求、登录刷新、部署或发布。

### 构建与打包检查点（2026-10-08，Asia/Shanghai）

- 显式 corepack pnpm run build 通过，1676 modules、21.42s；Unrestricted 开发打包也通过，bundleEnforced=false。6 个包内图片链修订文件匹配当前源码，接入策略为 dual-access。
- 首轮实际程序冒烟 .diagnostics/release/packaged-smoke-2026-10-07T15-56-57-515Z/report.json 整体失败；真实 PNG 的保存/readBack/import/PSD、主题、账户和素材/供应商配置均通过，失败项是 semantic。原因是新冒烟参数把 1024px 真图替换进旧 64px 分层夹具；已为分层夹具保留独立 64px 预览，不改产品逻辑，重跑中。
- 首包 MZ/包内核查通过，Authenticode=NotSigned；当前等待完整冒烟通过后继续 SparkAPI 开发变体。尚未宣称安装/卸载或正式发布通过。

### 修订开发 EXE 交付完成（2026-10-08，Asia/Shanghai）

- 两种构建/NSIS/品牌安装包退出 0，开发 bundleEnforced=false。实际 Unrestricted 程序报告 .diagnostics/release/packaged-smoke-2026-10-07T16-00-39-486Z/report.json、SparkAPI 程序 16-05-43-936Z/report.json 全部通过，各 17 张截图；真实 PNG 的保存/readBack/import/PSD、画布图库/右键素材、供应商配置持久化/reload、主题和隔离账户检查通过。程序冒烟 0 新模型请求，没有把素材显示验证当成另一次真实生图。
- 每包 6 个图片链文件分别匹配当前源码，接入策略正确；内容报告 .diagnostics/release/grok-live-{dual-access,sparkapi-account}-contents.json。已查看无限制版画布原图图库截图，机器人实图可见，保存读回哈希与在线成果一致。
- Unrestricted EXE：release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe，109,818,368 B，SHA-256 621FAB611E00B68ACC7B6EC691E293A3BDB4C8EF53B3AEF9629A6495294AA335。
- SparkAPI EXE：release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe，109,818,368 B，SHA-256 F5F32864332F708C98780A18C2B7DD22C6DCDA8838CD70F953CCF12C3C7BA978。
- 两包 MZ/大小/哈希独立核查、Authenticode=NotSigned；这是本地开发交付，未签名/正式发布/实际安装卸载。真实图副本 release/Grok-Real-Image-2026-10-08.png 与 Main 受管成果哈希相同。当前权威汇总 .diagnostics/release/grok-live-delivery-2026-10-08.json，替代同名旧制品的元数据。
- 根 harness 10 个结构检查及 git diff --check 通过；探针源码、隔离配置/报告中未发现测试凭据。用户未提交工作保留，日常账户/配置和外部 New API 未修改；本轮累计两次 n=1 真实生成、0 自动创建重试。
- 本目标验收完成。未在线验证其他供应商或 Grok 编辑；真实账户复验仍 deferred，未推送、部署或发布。

## 2026-10-07：Grok 已消费但 AggregateError（verified：本地修复与修订 EXE）

- 从当前交付回归继续，保留现有脏改动。只读核对实际安装版脱敏日志、连接设置和当前项目失败回执，没有生成或重试真实图片。
- 实际两次 Grok 请求返回 HTTP 200，统一图片服务识别各 1 张；失败在响应归一化后的成果阶段。xAI 请求未指定 response_format，默认 URL 需要 Main 再下载；其 native HTTP 多地址异常可能为 message 为空的 AggregateError。历史回执没有保存 cause/errors，不能据此声称真实 ECONN/超时细项已查明。
- Agent 批处理把失败重建为普通 Error，丢失 code/category/unsafeToRetry；最终 unknown/retriable=true 导致模型建议再次调用，解释消费增加但画布无成果的风险。下一步离线复现并修复既有返回/错误链，再 build 和生成修订开发 EXE。真实供应商联调不在本轮授权内。
- 已复现：`.diagnostics/grok-result-download-2026-10-07/before.json` 为 responseFormat=null、空正文 AggregateError/code=ETIMEDOUT/两个嵌套网络错误；Agent 重建后只剩 AggregateError，code 与 unsafeToRetry 丢失。所有错误/URL 均为合成夹具，0 真实网络/模型调用。
- 已修正 xAI 默认 b64_json（生成/编辑，显式 url 保留）；Main 和 mask 结果下载只公开有界错误代码/状态。单张及多 items 保留原 Error，已生成失败的工具回执 image_result_download/retriable=false，并对本 turn 后续 image_gen 加硬阻止，即使模型改变 quality 也不重建。
- `test:image-generation-adapters`、`test:image-generation-service`、`test:image-mask-compat`（66 像素/5 禁止重建）、`test:remote-asset-security`、`test:view-image`、`test:agent-text` 均通过。Agent 专项新增故意改变 quality 再生的模型夹具，工具回执 2 次、实际 Mock provider 仅 1 次；多 items 保留分类通过。
- 首轮新增 batch 夹具的 count=1 与 2 个 items 不一致，改为合法 count=2 后通过；mask 私有地址断言曾暴露错误摘要丢失拒绝原因，已恢复固定安全中文描述，未弱化私有地址规则或删除断言。
- 新增实际 Main 验证 `test:image-result-download`，报告 `.diagnostics/electron/image-result-download-2026-10-07T06-32-13-822Z/report.json`：现有 service → Main/native 解码 → 受管 PNG 写入，Base64 无额外下载，显式公网 URL 正常落盘；中转忽略 Base64 返回 URL 时，空 AggregateError 正确分类/脱敏且不重复调用生成。真实网络/模型请求均 0，三个生成为本地 Mock。
- `corepack pnpm run build` 通过（1676 modules、19.92s），`git diff --check`、根 harness 10 checks 通过。源码局部修复已验证，正在按已授权的开发交付范围重新生成两种 EXE；历史网络细项、真实供应商与真实账户复验继续未验证。
- 后续 `test:ipc-registration` 通过（147 注册/144 preload invoke）。双接入与 SparkAPI 变体的 production build、NSIS 和品牌安装包均退出 0；仍为 1.0.9 x64 本地开发版，bundleEnforced=false，没有进行正式发布或签名。
- 每个变体打包后分别运行实际程序 `package:smoke`，双接入 `.diagnostics/release/packaged-smoke-2026-10-07T06-39-04-402Z/report.json` 与 SparkAPI `06-42-54-281Z/report.json` 均通过，各 1 张工作区截图已人工查看；覆盖启动、原有桥接/受管资产与运行时冒烟，network skipped。本轮未重跑未改动的安装器 UI 套件，也未把启动截图当作真实 Grok 联调。
- 每个 ASAR 的 Main、Agent、service、Adapter、errors 5 文件分别逐字节匹配当前源码，策略分别为 dual-access 与 sparkapi-account；报告 `packaged-grok-result-{dual-access,sparkapi}-contents.json`。首轮读取多级 ASAR 路径失败，改用 Windows 原生规范化路径后核查通过；实际包没有缺文件。
- 新双接入 EXE 109,817,344 B，SHA-256 `5EB8C0061766797FCD1CC9EB6FF74135946AF643F345EFAD549708A2C70A73D6`；新 SparkAPI EXE 109,817,856 B，SHA-256 `4E3B947F21E6A12827C394124EF8CBFE05C43C40F4136975B8B16871E1A3570A`。均复读 MZ/大小/hash/NotSigned。安装包路径沿用 `release/SparkAI-WorkSpace-{Unrestricted,SparkAPI}-Setup-1.0.9-x64.exe`，此前同名文件 hash 为历史值。
- 当前权威交付汇总 `.diagnostics/release/grok-result-download-delivery-2026-10-07.json`。本地修复及 EXE 交付完成；本轮 0 新真实模型请求，不修改真实项目/配置，不推送/部署/正式发布。真实中转是否按 b64_json 返回、历史下载具体网络错误、真实账户及完整安装/卸载仍未验证。

## 2026-10-07：画布素材与供应商适配 EXE 交付（verified）

- 用户追加要求打包 EXE；此前仅交付源码与 dist 的边界已扩为双接入/SparkAPI 两种本地开发安装包。最新 live 工作树核查后保留全部原有未提交改动，功能专项和源码 build 已有上一节证据，不机械重跑。
- 使用现有变体构建/NSIS/品牌安装器；每个变体打包后立即运行实际程序冒烟，防止第二次构建覆盖 win-unpacked 后误用同一程序证明两个变体。
- 验收包括本轮素材/供应商入口、接入策略、启动/主题/账户/独立窗口与安装器 UI，以及独立读取两 EXE 的大小、MZ、SHA-256、签名状态。0 新模型请求，不安装到日常目录、不签名/推送/部署或正式发布。
- 双接入 production build（1676 modules、21.00s）和 NSIS/品牌壳打包通过；制品 109,817,856 B，独立 SHA-256 为 `C2801C496C8BE9893AF8740870EE6C7312759C5B61714E4A15A7ED71F92990E1`，Authenticode 为 NotSigned。ASAR 中 Main/Adapter/新 UI 等 12 文件逐字节匹配当前源码或 dist，策略为 dual-access。
- 实际程序首两轮 smoke 的启动/主题/原生账户通过，新增素材右键检查未通过（04-55/04-56 两个报告保留）。截图和归一化后的 session 表明测试图片错误放在 output/image，被既有受管目录策略清除；已改用正常 output/imagegen，并增加失败截图/状态证据，正在复测。未改变产品代码或放松断言。
- 双接入实际程序完整 smoke 已通过：`.diagnostics/release/packaged-smoke-2026-10-07T05-07-43-579Z/report.json`。884×640 中节点右键添加、原图/参考图图库、source→reference 角色迁移、Grok 的 OpenAI Compatible/NewAPI/sync 与 Gemini 原生配置在 Main 保存/reload 均通过；主题、账户和独立 Agent 同轮通过，0 真实 provider 请求。
- 前几轮后续失败均保留：04-58 为检查脚本假设 surface 值未被生产压缩，05-05 为普通参考图标题假设，05-06 为 reload 后设置关闭确认未处理；均依据真实截图/状态修正脚本，没有改产品或放松功能断言。
- 双接入安装器 UI `.diagnostics/release/branded-installer-ui-2026-10-07T05-08-46-057Z/report.json` 通过，19 captures。
- SparkAPI production build（1676 modules、19.91s）和 NSIS/品牌壳打包通过；制品 109,816,320 B，独立 SHA-256 为 `FB0A8A12B74DAE5395987A7875B857ECEE2B9F2A17B89D4FE3BE9B41F754CE89`，Authenticode 为 NotSigned。ASAR 中 12 文件匹配当前源码/dist，策略实读 sparkapi-account/customApiAccess=false/固定 sparkapi.org。
- SparkAPI 实际程序 `.diagnostics/release/packaged-smoke-2026-10-07T05-12-34-021Z/report.json` 通过，本轮素材/供应商保存与 reload、主题/账户/独立窗口均通过；双接入报告同为 18 张截图，0 真实模型请求。已人工查看双接入原图图库和 SparkAPI 的 Grok 配置重载截图。
- SparkAPI 安装器 UI `.diagnostics/release/branded-installer-ui-2026-10-07T05-13-17-876Z/report.json` 通过，19 captures；两安装器的欢迎页截图已查看。此专项是 UI/诊断验证，不替代完整实际安装/卸载。
- 最终交付汇总 `.diagnostics/release/image-adaptation-delivery-2026-10-07.json`：记录两个 EXE 的 MZ/大小/SHA-256/NotSigned、正确接入策略、各 ASAR 12 文件匹配、两种实际程序 18 截图及两个安装器各 19 截图。汇总时再次读取两个 EXE 并校验文件头、大小和 SHA-256；同名旧制品元数据仅作历史记录。
- 当前状态：开发 EXE 交付完成；真实模型/账户、完整安装/卸载、签名和正式发布仍未验证。开发打包 bundleEnforced=false，不运行无关全量门禁、不沿用旧 Bundle 测量作为本次结果。

## 2026-10-07：画布素材与既有生图供应商适配（verified，本地源码交付）

- 最终验收：`corepack pnpm run aidebug:canvas-materials` 退出 0；`.diagnostics/electron/canvas-materials-2026-10-07T04-41-50-994Z/report.json` 为 12 checks、9 screenshots、0 真实模型请求。覆盖 884×640 原生小窗口、原图图库/取消、节点角色/去重、多选、40 张参考图容量、整容器/具体成员、精确 source/reference provenance、不重复附件容器；两次发送到达 Main/runtime，显式 OpenAI Compatible + NewAPI 与 Gemini auto 配置在 Main 保存并 reload 恢复。已人工查看小窗口图库、容量和供应商配置截图。
- 快速 GUI：`corepack pnpm run aidebug:gui` 退出 0，`.diagnostics/electron/aidebug-2026-10-07T04-43-35-350Z/report.json` 为 quick-smoke、ok=true、failures=[]。
- 源码阶段最终生产构建：`corepack pnpm run build` 退出 0，1676 modules、22.07s。保留 Vite 大 chunk 与 symbol-compaction 时间提示；当时未执行正式发布门禁或重新生成 EXE，后续开发打包见上节。代码 diff whitespace 检查通过。
- 交付边界：沿用现有生图页面、统一 Main 服务、上传/凭据 owner、Adapter 注册表、传输和成果展示；显式配置优先、模型 ID 原样保留。真实供应商/各中转站未联调，Google 新 Interactions API 未接入；旧账户复验 deferred。源码阶段的旧 EXE 不包含新功能，现已被上节两个新制品替换。

以下记录实施过程；其中“待验证”描述当时状态，最终状态以上述证据为准。

- 用户进一步明确供应商适配：模型/供应商/协议/BaseURL/Key 独立，显式配置决定 Adapter。现有 runtime 已有三种 Adapter，但 known/inferred model 当前覆盖显式 protocol，xAI 编辑仍发 multipart；这些只是代码观察，待官方合同核对。将先报告现有完整链，再最小修复配置 precedence、输入/Body/响应差异及对应 UI/契约，保留素材任务。
- 实现里程碑：共用本轮列表的画布绑定、图库草稿、单图/容器成员/多选右键与 agent.add-canvas-materials 已接通；显式角色优先、去重和缺失来源校验；发送跳过已有画布附件 materialize，并过滤精确成员。素材/容器专项 15 cases 与 automation 契约通过；真实 Electron 专项运行中，尚不标记 UI verified。
- 供应商官方只读合同已获取：xAI generation/edit/multi-image（JSON image 或 images，最多 5 输入）、Google generateContent 参考与当前 image-generation 页面、Open WebUI images.py。已报告现有调用链与保留点；实现 binding protocol/gateway/transport 优先、模型原样保留、xAI JSON、Gemini 内容/图片、受控远程输入和统一输出；UI 复用逐模型连接。Adapter/service 专项通过；custom transport 新增测试发现 /v1beta BaseURL 拼成 /v1betaa 的既有错误，已修正，待重跑。
- 用户追加 Grok/Gemini 生图接口核对及所选模型供应商自动路由；当前已扩展素材 owner 与画布图库草稿 UI，发送绑定/菜单/CLI 尚在实现，未验证。先完成原素材边界，再核对 provider 官方合同和既有 runtime 适配，新增受影响 Mock 专项；0 新真实模型请求。
- 用户新增素材弹窗“从画布选取”和节点右键添加两类素材；恢复后核查 live main 工作树，保留上一 Goal 全部未提交改动。当前无本功能实现，不将旧 EXE 作为此功能证据。
- 归属桌面：ReferencePickerDialog、selection-reference-images、Composer/右键与发送 TaskScope；新增共享命令 agent.add-canvas-materials 使用同一 owner。原图片/账户本地交付保留，真实账户复验 deferred。
- 已确认风险：当前附件全部 materialize 为新容器；从画布选择必须保留绑定并跳过附件复制，发送单成员不能意外扩成整个容器；显式角色不能被自动选中默认角色覆盖。
- 验证计划：受影响素材/容器纯逻辑、automation 契约、隔离 Electron 点击与截图、发送 Mock 附件/来源检查、quick GUI、生产 build。0 真实模型请求。
- 实测修复：容器成员右键传入 canonical 原节点，素材 owner 使用画布投影，导致成员添加失败；已复用 assetSourcesByHost 转换具体槽位。ReferenceImage 保留 binding/owner/container 元数据，原图和参考图发送沿用同一成员身份；GUI 混合多选过滤无完成图片，CLI 仍严格整批验证。
- 复核修复：Agent 参考图本轮容量是 40，splitComposerMaterials 原先截为普通弹窗 9，现统一沿用 Agent 上限；素材/容器专项扩至 17 cases。xAI 文档质量值为 auto/low/medium，统一 high/standard 映射为 medium；runtime 与 transport 两处 /v1beta 路径镜像已修复。
- 当前通过：Adapter/service/custom transport（40 cases）、settings persistence（127）、settings secret store、settings lazy（67）、素材/容器（17）、automation/shared schema、typecheck、根 harness（10 checks）。相关旧异步/Agent 发送/IPC/遮罩与远程安全专项在本轮前半段已通过，不无差别重复。
- Electron 素材专项迭代证据：04-20 节点ID修复后原图/取消/角色/去重通过；04-21/23 为夹具 ID/容量/返回值假设，04-24 定位真实成员映射缺陷；04-26 精确原图发送通过，04-31 参考成员来源通过但设置下拉被旧外部点击监听关闭；已将设置的 MenuSurface portal 视作内部操作。04-35 两种接口配置实际保存至 Main JSON（显式和 auto）成功，脚本误以为“保存设置”自动关闭而超时；现按现有保存后停留语义验证，并追加 reload。失败报告保留，不把这些整轮报告冒充通过。
- 下一步：本轮素材与供应商适配本地验收完成，Goal 收口；从用户新的任务继续。本轮无新 EXE。

## 2026-10-07：恢复首次请求修复会话，完整图片与账户目标本地交付（verified）

- 从会话 `01a1105e-0b40-7df3-bad0-adae92761872` 恢复最新完整 Goal；当前 main 工作树保留全部已有未提交改动，未更改 Extension 或外部 New API。
- 本轮验收：生产程序实际点击缓存密钥编辑，显示原生额度单位并保留 IP/模型限制；两种开发 EXE 包含最终源码并通过主题、账户和独立窗口 smoke，核对文件及哈希。源码改动后必须 build。
- 续做起点：上次生产 smoke 未找到“编辑当前密钥”，由隔离账户快照/当前选择与 Main 返回值追踪原因；该阻点已在本节后续验证中解决。
- 授权沿用原目标的本地修改、构建与双变体开发 EXE；三张真实图片已有证据，不增加模型用量。真实账户只读验收仅使用有效会话，诊断不得轮换 cookie；不执行真实账户写入、部署、推送、签名或正式发布。
- 续做时待验证：缓存编辑、两种最终制品与真实账户只读合同；前两项已完成，后一项已由用户选择 deferred。旧制品/旧报告保留为历史证据。
- 复现报告 `.diagnostics/release/packaged-smoke-2026-10-07T02-05-42-695Z/report.json` 仍失败；ASAR 的 token IPC/quota/service 与当前源码逐字节一致，排除旧 Main 制品。确认 `electron-main.cjs publicSettings` 有意删除 serverUserId，设置 useEffect 却依赖该字段；已改为 account 模式读取只读快照，由 Main 校验会话。开发/生产 smoke 收紧为不先手动刷新，验证缓存编辑自动取得完整限制。
- 用户方向更新：选择“暂时无法登录，先交付本地结果”，真实账户复验由本轮必验项改为 deferred；本轮继续构建、验证和交付两种开发 EXE，不等待登录。
- 用户要求恢复会话 Goal 后，已通过 Goal 工具正式创建当前会话完整三项目标（active，无 token budget），保留最新本地交付/真实账户 deferred 边界；此前仅文件恢复不代表 Goal 状态继承。
- 已重新运行并通过 settings lazy load（67）、account token（61 请求/2 transport）、quota（6 单位策略/7 拒绝输入）、new-api-account（38/0 网络）和开发账户 GUI。三个上游 commit 与原记录一致；三张图片文件的 SHA-256 均匹配。生成图所在整轮报告 ok=false 是随后 mask 被明确 400 拒绝，不是生成图成功报告；普通编辑与兼容 mask 报告 ok=true。
- 本轮 typecheck、脚本语法、441 按钮审计、5 个 props 转发 owner 人工复核、diff whitespace、根 harness 10 结构检查通过。账户 GUI `.diagnostics/electron/glass-workspace-2026-10-07T02-07-39-392Z/report.json` 为 7 checks/8 screenshots，quick GUI `.diagnostics/electron/aidebug-2026-10-07T02-09-13-048Z/report.json` 通过；已查看账户日志与额度截图，均为隔离 Mock、0 模型请求。
- 双接入开发构建/NSIS 已通过（production build 21.73s）；实际程序 smoke `.diagnostics/release/packaged-smoke-2026-10-07T02-12-07-083Z/report.json` 通过。884×640 窗口自动快照加载、缓存编辑 amount=10/USD、IP=203.0.113.7、model=gpt-image-2；账户 shell/body alpha=1、服务端第二页 5 条、失败筛选 1 条、主题入口和独立 Agent 均通过。已查看生产快照与额度截图。
- 阶段性双接入制品 109,812,736 B，SHA-256 `B611D2BEA980886B28454B64E3B74600881AE24938DE113DD2DF86BC22E78A39`，独立读取文件头为 MZ；当时继续更新 SparkAPI 最终包。正式 bundle 仅 CSS 291,659 > 270,000 B 失败，leakedMarkers=[]，本轮不宣称正式发布。
- 最终 SparkAPI production build 21.35s/NSIS 通过，ASAR 内策略实读为 sparkapi-account、customApiAccess=false、固定 sparkapi.org。实际程序 smoke `.diagnostics/release/packaged-smoke-2026-10-07T02-14-45-049Z/report.json` 通过，缓存单位/限制、主题入口、原生账户和独立窗口均通过；已人工查看生产账户及编辑器截图。
- 安装器 UI `.diagnostics/release/branded-installer-ui-2026-10-07T02-15-30-628Z/report.json` 通过，19 截图及键盘/Automation、关闭、watchdog、操作锁、版本/数据策略、文件夹选择专项通过；已查看欢迎页。本项是 UI/诊断验证，不是完整实际安装/卸载。
- 最终双接入：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，109,812,736 B，SHA-256 `B611D2BEA980886B28454B64E3B74600881AE24938DE113DD2DF86BC22E78A39`。
- 最终 SparkAPI：`release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe`，109,813,248 B，SHA-256 `4795E3DC0F48DD4242D9B1B874415D29F3F284FCFAF72E62E754B1A66BE2783A`。两者 MZ/大小/哈希独立复核，Authenticode 实读均 NotSigned；同名旧制品元数据只作历史证据。
- 交付汇总：`.diagnostics/release/local-delivery-01a11418-2026-10-07.json`，记录两包完整元数据、两种实际生产 smoke、19 安装器截图、441 静态按钮与 5 转发 owner、真实账户 deferred 及正式 Bundle CSS 失败。本轮 0 新增模型请求，未进行真实账户写入、安装到日常目录、部署、推送或正式发布。
- 本地验收已完成；当前 Goal 按用户接受范围完成，重新登录后的真实只读账户验收为 deferred 后续项。没有将静态审计/Mock 说成全部 441 按钮或真实账号逐项实测。
- 完整 Goal 最终审计补证：当前源码重新运行 image adapters/service/async、mask compatibility（66 像素断言/5 禁止重建场景/0 网络）、remote asset security、IPC（147 注册/144 invoke）及 automation contract 全部通过；逐项检查了测试覆盖的 edit 参数、密钥限制/额度 PUT、日志请求序号与 auth epoch 边界。对原真实来源/mask/成果重新解码并独立逐像素计算，1254×1254、遮罩外 965,601 像素差异 0、遮罩内 606,333 像素变化；证据 `.diagnostics/release/restored-mask-pixel-verification.json`。这次审计未发起新的上游模型调用。

## 2026-10-07：图片与原生账户实现已验证，继续最终构建（active）

- 保留当前全部主题、Agent、密钥和新接口未提交改动。三个上游只读快照已通过 7897 代理克隆，固定 commit 见 `docs/UPSTREAM_ACCOUNT_IMAGE_CONTRACT_2026-10-07.md`。
- 账户金额改用 `/api/status` 原生单位，未知单位显示原始 quota；日志复用 `/api/log/self` 做服务端过滤/分页，Main 白名单脱敏；密钥补齐状态、期限、IP、模型限制与跨组重试编辑，账户入口直达现有密钥管理。
- 图片编辑按输入推断 edit，GPT Image 2 不发送 input_fidelity。网关明确拒绝遮罩时仅补试一次无 mask 编辑并在 Main 本地合成；超时、结果未知和已接受任务不得重建。真实生成/普通编辑/遮罩兼容共 3 张图，报告分别为 `.diagnostics/upstream-probe-2026-10-06T18-08-03.540Z/report.json`、`18-10-42.060Z/report.json`、`19-16-52.145Z/report.json`（后两项同一 upstream-probe 前缀）；遮罩外 965,601 像素差异 0，遮罩内 606,333 像素发生变化。
- `test:new-api-account` 33 cases、`test:image-mask-compat` 15 cases/64 pixel assertions、图片 service/adapters/async、密钥/quota、settings lazy load、view_image、IPC 与 workspace UI 专项通过；生产 build 已通过，最后字幕改动后还需再构建。静态按钮审计 430 项未发现未绑定项，不能替代所有按钮的逐项 UI 实测。
- Electron 原生账户路径报告 `.diagnostics/electron/glass-workspace-2026-10-06T19-24-12-134Z/report.json` 为 6 checks、7 screenshots、0 failures；覆盖最小窗口、详情展开、服务端分页/筛选、密钥入口与扩展字段编辑。最终 native quota 字幕还需重跑截图。
- `test:automation-service` 在旧 native option 静态断言处失败；当前组件已使用 GlassSelect，正按同一 TaskScope 语义修正测试，不恢复旧布局。
- 探针首次成功账户刷新后未把轮换凭据落盘，导致保存的旧 refresh cookie 失效。已向用户说明并修正探针只安全落盘认证字段；重新登录请求仍待回复，未重复刷新失效凭据。真实新认证持久化仍待验证，不把模拟测试写成真实验证。
- 后续本轮：账户专项扩为 38 cases，负余额和缺失单位已补齐；遮罩专项 66 pixel assertions、5 类禁止重建错误、私有 URL/取消通过，复用既有公网下载 owner。`test:automation-service`、账户 token/quota 已修正旧 native option/R 文案断言并通过。按钮清单已覆盖独立 Agent 窗口，共 441 项、未绑定 0；5 个 props 转发 owner 已人工检查。
- Native GUI 最新报告 `.diagnostics/electron/glass-workspace-2026-10-06T19-29-37-236Z/report.json` 为 6 checks/7 screenshots/0 failures；已人工查看展开日志和密钥编辑器。增加实际生产 Renderer 的原生账户 smoke，并保留主题/独立窗口验证。
- 最后 `corepack pnpm run build` 通过（1676 modules，19.38s）。`test:bundle` 仍仅 CSS 硬门槛失败：291,585 > 270,000 B；未泄漏 AIDebug 控制面，其他体积超限是 advisory。开发 EXE 不强制该正式门槛，仍不宣称正式发布。
- 全界面 surface 冒烟首轮 15 场景中 3 项失败（`.diagnostics/electron/aidebug-2026-10-07T00-33-22-051Z/report.json`）：手动生图检查仍操作已替换的 native select。已改为真实点击 GlassSelect；次轮只剩提交断言失败（`00-36-42-194Z/report.json`），原因是脱敏 debug DTO 不包含 message id，旧差集误删全部新消息。改用可见 append 区间，且收紧双击只一次任务/一组 timeline 的断言；当前重跑该单一 suite，未恢复旧控件或放宽结果要求。
- Surface 第三轮 `.diagnostics/electron/aidebug-2026-10-07T00-39-46-383Z/report.json`：手动两图、3:4/精细、双击一次请求入口、一个 user 消息和一组 start/result 均通过；仅选择上下文视觉证据未通过。素材列表此前没有旧单成果 context 的选中 kind/count/ids，检查器也只查直系 strong，无法证明画布与素材同源。已在组件由 canonical selectedArtifacts 投影同一组选中元数据与可访问名称，并让 checker 验证可见素材名称及相同 ID；修正其空白归一化转义。`typecheck`、`test:materials-provenance` 与 441 按钮审计通过，正在最终复测。
- 最终 `aidebug:gui:surface` 通过：`.diagnostics/electron/aidebug-2026-10-07T00-45-42-192Z/report.json`，15 场景、0 failures；手动生图真实 GlassSelect 比例/质量/两图、双击只有一个任务/一个用户消息/一组 start/result、素材/画布选中同 ID 和可见性均通过。此前失败报告保留，未冒充成功。
- 首批两种开发 EXE 均构建/打包成功，双接入生产 smoke `.diagnostics/release/packaged-smoke-2026-10-07T00-51-31-132Z/report.json` 的按钮/账户状态检查通过；但人工截图发现账户抽屉透出 Agent 文字，不能把该绿灯视作可读性验收。追加真实背景 alpha 门槛后，SparkAPI 生产失败报告 `packaged-smoke-2026-10-07T00-54-36-007Z/report.json` 实测 shell alpha=0.302、body alpha=0。
- 已将账户页并入 `07j-liquid-glass-surfaces.css` 既有阅读表面规则及输入框皮肤，未追加尾部覆盖；`test:workspace-glass-ui` 164 cases 通过。下一步重建两种 EXE 并验证生产背景 alpha/截图；上述首批包将被替换。认证重新登录回复仍待用户，真实轮换持久化未验证。
- 阅读表面修复后的两个 EXE 已通过生产 smoke：双接入 `packaged-smoke-2026-10-07T00-57-03-756Z`、SparkAPI `00-58-37-528Z`（均在 `.diagnostics/release/`），shell/body alpha=1；已人工查看主题卡、日志和密钥编辑器。完整 Goal 复核发现额度输入仍暴露内部 quota，而且缓存条目有意省略 IP/模型限制，直接编辑会带入默认空值；继续补齐 Main 原生额度输入合同与编辑前元数据刷新。这两个包是中间制品，完成新补项后再替换。
- 额度输入补项已实现：Main inputUnit/remainAmount 与 remainAmount+quotaInput IPC 核对；未改额度不覆盖最新余额，非法输入在 status_only/元数据写入之前拒绝。UI 编辑缓存前刷新完整限制；空名称有明确错误。账户 token 专项 61 mock requests/2 transport calls，quota 专项 6 policies/7 invalid inputs，native account 38 cases、settings lazy 67、IPC/typecheck/441 按钮审计均通过；实际账户 GUI `.diagnostics/electron/glass-workspace-2026-10-07T01-30-27-890Z/report.json` 为 7 checks/8 screenshots/0 failures/0 模型调用。现在更新两种开发 EXE；真实账户恢复仍待用户重新登录，探针已禁止独立进程自动 auth/refresh。

## 2026-10-07：继续完整 Goal（active，需求与现状核对中）

- Goal 工具确认原三项目标仍为 active、无 token budget；上一轮完成生产主题按钮修复并验证两种打包程序，属于 progress，不能作为图片接口/全部按钮/原生账户体验的完成证据。
- 保留当前未提交的账户密钥、Agent 请求、窄屏控件、主题及打包验证改动。当前文件中较早的“无真实请求”限制只描述旧轮次；本 Goal 的现有配置少量真实图片测试已有用户明确授权，仍不涉及视频或线上账户破坏性写入。
- 已确认上游项目：CookSleep/gpt_image_playground、QuantumNous/new-api、Wei-Shaw/sub2api。将下载到隔离诊断目录并固定 commit，读取生成、编辑、遮罩、异步任务和用户密钥/额度/日志合同。
- 当前账户面板存在日志展示，但只有本地对已加载数组分页；界面仍把余额、单张损耗和免费张数直接写死为人民币/图片场景。密钥管理主要位于设置接入页，需要依据原生接口和当前账户体验补齐，而不能仅以已有 UI 存在宣称完成。
- 下一步：下载源码快照、检查真实配置可用性并建立逐项验收证据，再实现首个明确缺口。

## 2026-10-07：简洁主题入口可见性修复（完成，两种开发 EXE 已更新）

- 用户反馈在 UI 找不到简洁主题按钮。本轮检查正常入口和生产 UI，保留原工作区改动。
- 当前源码顶栏仍标为“Glass Lab”，1100px 以下隐藏文字；设置分类共享同一个滚动容器且切页未归零。上一轮只重打包 Unrestricted，SparkAPI EXE 仍是较早制品，不能由前者的验证推断后者已含新 UI。
- 已复现：Agent 设置滚动后切到外观，保留 666px 的旧滚动位置，黑白主题按钮落在可视区上方。失败专项和实际截图：`.diagnostics/electron/glass-workspace-2026-10-06T17-15-57-634Z/`。
- 修复：顶栏改为明确的“主题”文字和“切换界面主题”可访问名称，移除小窗口隐藏文字的规则；外观页改为“界面主题”。SettingsDrawer 按分类创建新的 SurfaceBody 滚动容器，草稿状态仍在 Drawer，不重挂画布。
- 修复后 `aidebug:classic-themes` 通过，6 组检查、15 张截图：`.diagnostics/electron/glass-workspace-2026-10-06T17-19-00-936Z/report.json`。真实小窗口入口和两张主题卡可见且能被鼠标命中；从已滚动的 Agent 分类返回时 scrollTop 为 0，实际点击两套主题、冷启动和独立 Agent 外观均通过，0 真实模型请求。已人工查看入口及按钮截图。
- `test:settings-lazy-load`（67）、`test:workspace-glass-ui`（164）、typecheck 与快速 GUI 通过；快速 GUI 报告：`.diagnostics/electron/aidebug-2026-10-06T17-22-22-490Z/report.json`。
- 快速 GUI、typecheck 和首次修复后的双接入构建通过，但实际生产按钮验证失败：分组标题可见、卡片缺失。证据：`.diagnostics/release/packaged-smoke-2026-10-06T17-26-12-917Z/report.json` 和 `packaged-theme-buttons.png`，已查看截图。
- 已确认缺失根因：`vite.config.ts` 的 Terser `booleans_as_integers: true` 把 Glass Lab 分组的 boolean 字段编译成 1/0，`isSolidTheme(option.id) === group.solid` 跨模块严格比较因此始终为 false，两组主题均被过滤。关闭该不保留布尔类型的优化，保留正常压缩与严格类型契约；重建后的代码保持真实 boolean。首次修复包已被最终制品取代。
- 最终双接入 `corepack pnpm run build` 与 NSIS 打包通过；`package:win:sparkapi` 含独立 production build 与 NSIS 打包，也通过。重打包途中一次 `release:assets` 的 BMP 写入报 `UNKNOWN`，已确认既有 BMP 文件头和内容大小有效，双接入复用该资产完成打包；后续 SparkAPI 重新生成资产成功。
- 两种实际生产程序均通过 `package:smoke -- --check-theme-entry --check-agent-window`：双接入 `.diagnostics/release/packaged-smoke-2026-10-06T17-32-47-070Z/report.json`，SparkAPI `.diagnostics/release/packaged-smoke-2026-10-06T17-36-13-011Z/report.json`。真实窗口 884×640；“主题”文字可见且鼠标命中，设置旧滚动位置 666px 在切页后归零，黑白按钮均在首屏，实际鼠标切换两套主题成功，关闭草稿后恢复已保存外观，独立 Agent 同步通过。已查看生产按钮及纯色截图；network skipped，未调用真实模型。
- 最终双接入制品：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，109,807,616 bytes，SHA-256 `A671B3F4B7364F05CDB447CD9DD05AB906625448B98E50A507C9DFE71EF67320`。
- 最终 SparkAPI 制品：`release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe`，109,809,152 bytes，SHA-256 `76BF85ACB6479696092349B5987631774881487F3714173F5B5441D1DB3B0594`。两者实际 Authenticode 均为 `NotSigned`；上述两个哈希代表当前同名文件，下方旧任务元数据仅作历史记录。
- 开发交付边界：双接入构建的 `test:bundle` 仍报 CSS 289,409 > 270,000 bytes，未发现 AIDebug 标记泄漏；开发打包不强制正式 Bundle 门槛。未执行完整实际安装/卸载、签名或正式发布，未对线上 provider 联调。
- 后续：本次按钮问题已完成；从新的用户请求继续，先读取本节，不重复使用下方旧制品的哈希或验证范围。

## 2026-10-07：普通黑白主题与生图工作台评估（完成，开发 EXE 已验证）

- 已核对工作区，保留账号密钥、请求修复和对话框布局的已有改动。
- 实现范围：两套无背景模糊、无彩色装饰、无噪点的纯色主题；保留玻璃主题及其自定义配置，同步启动投影和独立 Agent 外观。
- 评估范围：现有生图交互、参考素材、任务恢复与成果筛选；只提出有当前代码或界面证据的建议。
- 已完成两套纯色主题和设置分组；同步启动脚本、原生窗口底色及独立 Agent ID/变量白名单，并修复独立窗口漏识别 light-silver 的问题。
- `test:glass-theme`、`test:settings-persistence`、`test:agent-window`、`test:settings-lazy-load`、`test:aidebug-glass-workspace` 和 typecheck 通过。工作台静态专项在新增主题后通过。
- `aidebug:classic-themes` 通过：13 张截图、两次真实冷启动、独立 Agent 窗口、884×640 小窗口、画布身份/节点/视口和玻璃参数往返保持；0 真实模型请求。证据：`.diagnostics/electron/glass-workspace-2026-10-06T16-32-12-534Z/report.json`（UTC 目录名）。
- 首轮截图发现旧画布渐变伪元素和浅色选中标签对比问题，已修正；专项脚本早期两次失败分别为新独立窗口 DOM 尚未加载、误把未保存草稿的 bootstrap 当作当前控件值，修正等待和断言后完整专项通过。
- 工作台评估已记录在 `docs/WORKSPACE_UX_REVIEW_2026-10-07.md`；建议尚未实现。优先收拢工具栏入口、明确直接生图与 Agent 处理两种动作，其后完善失败项恢复与成果比较。本轮沿用此前 EXE 授权更新本地开发安装包。
- 通用 GUI 快速冒烟现已通过：`.diagnostics/electron/aidebug-2026-10-06T16-42-17-545Z/report.json`。新增主题计数镜像已同步为 9；打包与 Vite 同时运行曾因 release 文件锁中断测试，随后分开重跑通过。
- 首次制品验证查出生产构建独立窗口同步缺陷：Vite 压缩 appearance 变量名，但独立窗口 renderer/CSS 未经过 Vite，导致其背景仍为旧棕色、header 仍为透明 glass。证据：`.diagnostics/release/packaged-smoke-2026-10-06T16-52-05-199Z/report.json`。已将独立窗口消费的符号加入生产压缩保护边界并补回归断言；重建和重打包后两套主题的主窗口与独立窗口均通过。该首次 EXE 已被最终制品取代。
- 最终 `corepack pnpm run build`、生产符号压缩专项与 NSIS 开发打包通过。实际生产程序黑色主题报告：`.diagnostics/release/packaged-smoke-2026-10-06T16-57-20-195Z/report.json`；白色主题报告：`.diagnostics/release/packaged-smoke-2026-10-06T16-58-13-608Z/report.json`。两者均验证主窗口及独立 Agent 的实测颜色、无模糊/噪点/装饰背景，并捕获截图；网络探测跳过，未消耗模型额度。
- 安装器 UI 专项通过，19 张安装器/卸载器截图及控件无障碍、缩放、版本策略和操作锁等证据：`.diagnostics/release/branded-installer-ui-2026-10-06T16-58-20-066Z/report.json`。已查看欢迎页截图；此专项不替代完整实际安装/卸载验收。
- 最终制品：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，109,808,640 bytes，SHA-256 `DEE8BCFB3ED40FE1139DCB27168BC241D455D4E276FC64C0490F5189B63BEC89`，Authenticode `NotSigned`。这是本地双接入开发安装包，不是正式发布；下文旧任务的 Unrestricted 哈希不代表当前同名文件，SparkAPI 变体未在本轮重打包。
- 正式 Bundle 门槛仍未通过：`test:bundle` 报 CSS 288,844 > 270,000 bytes，未发现源码标记泄漏；其余体积提示属于 advisory。开发构建按仓库规则不强制该门槛，未宣称正式发布或全量检查通过。
- 后续：从新的用户目标继续；本轮建议仅为评估，若实施定向重试等公开操作，需要同步共享命令、CLI/MCP 合同和专项验证。

## 账号密钥选用与图片工具调用（2026-10-03）

Date: 2026-10-03
Status: complete
Outcome: 修复登录账户密钥无法进入模型请求的问题，并消除图片工具调用时的 `aidebugMockImage is not defined`。
Scope: 账号 Token 服务、New API 凭据路由、全局/逐模型密钥选用、Electron 图片入口与直接专项测试。
Change: 将 `aidebugMockImage` 提升到 Electron Main 模块作用域，修复 `callNewApiImageWithSession` 的未定义引用；账号密钥选择现在校验启用/过期状态、选择时预取并缓存完整 Key、支持空值清除，聊天/图片继续按全局或逐模型 `accountTokenId` 路由；设置与逐模型选择器会禁用已停用/已过期密钥。
Evidence: `corepack pnpm run test:account-token`（含真实账号服务到对话 JSON 与图片模型绑定，输出 `imageAccountCredential: true`）、`test:new-api-login`、`test:custom-api-transport`、`test:image-generation-service`、`test:image-generation-adapters`、`typecheck` 均通过；`corepack pnpm run build` 通过。最新 AIDebug 图片场景产出 2 次成功生图，报告与截图位于 `.diagnostics/electron/aidebug-2026-10-03T08-06-45-469Z/`，其中 `agent-image-suite.json` 含 `Image API 已返回 1 张图片` 和 `图片生成完成`，截图 `agent-image-suite-1280.png` 可见完成态。
Unverified: 完整 `aidebug:image` 命令仍以退出码 1 结束，原因是既存的 `selectionSurfaces`/`projectAgentContext` 证据门槛，不是图片工具调用失败；未执行真实模型、远端写操作、发布或安装包签名。
Next: 如需安装包，按发布流程另行打包并执行安装器验证。

## 当前状态

Date: 2026-09-28
Status: partially verified
Outcome: 收口 Agent 发送、设置可读性、图片网关自动适配，并从当前 `main` 源码生成双接入 Windows x64 开发安装包。
Scope: Agent Composer/Main IPC、Goal/TaskScope/独立 Agent 窗口、设置 Glass 表面、图片 provider 适配与响应归一化、Vite/Electron/NSIS 构建。
Authorization: 用户已授权在 `main` 提交并 push，且要求编译 EXE；没有授权真实图片/视频或付费模型调用。
Method: 后续先实现用户明确功能，只运行受改动直接影响的专项和必要构建检查；同步上下文时压缩当前状态、替换过时表述，不机械追加历史或运行无关全量测试。

## 已完成

1. **Agent 发送链路**
   - 普通点击、`Ctrl+Enter`、stale busy 恢复、显式 `replace-source` TaskScope、Goal 确认后派发均已进入 Main IPC。
   - 独立 Agent 窗口消息往返已通过；Main 日志只记录 `chat/steer` 到达和 TaskScope 模式，不记录 prompt、凭据或响应内容。
   - 根因确认：运行结束时 `activeRunRef` 已清空，但 React `setAgentStatus` 的 effect 尚未把 `agentStatusRef` 更新为 idle；在 `runStatus` bridge 不可用时，`sendPrompt` 会 fail-closed，消息因此不会进入 `naimage:agent:chat`。新增 `setAgentStatusSync()` 在每个状态切换点同步写 ref，保留真实跨窗口运行的 fail-closed 保护。
   - 修正 `scripts/agent-send-ipc-selftest.mjs` 的时序：stale chat 只在真正回到 idle 且没有 active run 后才切换 debug running fixture，避免把仍在收尾的旧 run 误判为产品发送失败。
   - 继续审计确认 `applyProjectSession()` 在同一调用内同步更新项目/会话 refs；项目或会话切换后立即发送的竞态目前未复现，没有新增代码修复。
   - `desktop/ipc/agent-ipc.cjs`、`scripts/agent-send-ipc-selftest.mjs`、`scripts/aidebug-goal-mode-suite.mjs` 与上下文映射已同步。

2. **设置面板可读性**
   - 深色主题输入/辅助文字对比度为 `16.98`/`11.84`，浅色主题为 `19.03`/`7.49`；两种主题的抽屉背景均为不透明实色。
   - 设置抽屉和模型配置表面使用近实色背景与 `ink-soft` 辅助文字，避免 Glass 透底影响阅读。

3. **图片协议与逐模型连接**
   - 已支持每个模型自定义 Base URL/API Key，并保持 Main-only 凭据、旧配置兼容和 SparkAPI 专用版访问策略。
   - 当前自动适配覆盖 OpenAI Images、xAI/Grok Images、Gemini Native，以及 NewAPI、Sub2API、direct gateway；同步/异步请求和 URL、Base64、`inlineData` 等多层响应均有 mock 归一化。
   - 用户界面不要求手动填写 protocol、gateway、transport 或 capability。
   - 审计发现异步创建/轮询路径原先固定发送 Bearer；现已复用统一凭据头策略，保留 NewAPI/Sub2API 默认 Bearer，并支持 Gemini 直连的 `x-goog-api-key`。

## 验证证据

- 通过：`corepack pnpm run test:agent-send-ipc`（最新运行 `chat` 4 次、`steer` 2 次、显式 `replace-source` 1 次；覆盖状态同步修复，先前一次失败已定位为专项时序竞态并修正）。
- 通过：`corepack pnpm run aidebug:goal`（`confirmedGoalDispatched:true`、`confirmedGoalReachedMainIpc:true`、`origin:"goal"`、`runtimeRequest:true`）。
- 通过：`corepack pnpm run test:image-generation-adapters`、`corepack pnpm run test:image-generation-async`（含 Gemini 异步创建/轮询认证头回归）、`corepack pnpm run test:custom-api-transport`、`corepack pnpm run test:agent-window-ui`、`corepack pnpm run test:glass-theme`、`corepack pnpm run test:workspace-glass-ui`。
- 通过：`corepack pnpm run build`（1676 modules）；`node --check` 与 `git diff --check`。
- 通过：`corepack pnpm run package:win:variants`，当前源码双变体构建报告 `bundleEnforced:false`；Unrestricted SHA-256 `BA86020B96C12CA0632DD14D9881EC63B87B6993CE453EA9A3066210F8B1BA64`，SparkAPI SHA-256 `3E13961DE6A6E754693516049455BD0DF1DAA718F1BD1C7B9FD17FD572D3EE22`。

## 历史制品（2026-09-28）

- [Unrestricted EXE]：109,803,520 bytes，`MZ`，SHA-256 `BA86020B96C12CA0632DD14D9881EC63B87B6993CE453EA9A3066210F8B1BA64`。
- [SparkAPI EXE]：109,803,520 bytes，`MZ`，SHA-256 `3E13961DE6A6E754693516049455BD0DF1DAA718F1BD1C7B9FD17FD572D3EE22`。
- 两个 EXE 的 `Authenticode` 状态均为 `NotSigned`；这是开发构建，不是正式发布制品。

## 未验证边界

- 未调用真实图片、视频、Seedance 或付费模型，也未与线上 provider 做联调。
- 未运行真实安装/卸载 smoke，未通过正式 `release:final`/Bundle 门禁，未验证数字签名。
- 构建保留既有大 chunk、.NET nullable 和 Node child-process deprecation 警告；这些警告未阻断本次开发打包。

## 上下文与继续方式

- `GOAL.md` 保存当前目标、范围、授权和验收条件；`docs/CONTEXT_MAP.md` 保存模块所有权、IPC/API 边界和测试入口。
- 先前的“图片协议与逐模型连接”目标已完成并作为本轮基础；Extension 的 `/v1/image-tasks*`、New API 管理边界、旧工作流和真实模型安全边界保持不变。
- 后续 `continue` 先检查 `git status`、本文件和 `GOAL.md`，从当前用户目标开始；验证只覆盖直接受影响的专项和必要构建，只有正式发布或用户明确要求时才扩大范围。

## 下一步

后续继续开发时先读取 `GOAL.md`、本文件和 `docs/CONTEXT_MAP.md`，从未验证边界或新的用户目标开始。若转入正式发布，再另行执行正式门禁、安装/卸载 smoke 和签名验证，并重新记录制品哈希。
