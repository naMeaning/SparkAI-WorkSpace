# SparkAI WorkSpace 进度

## 2026-10-09 推送与 GitHub Release：in progress

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

- [Unrestricted EXE](/E:/003Projects/SparkAI-WorkSpace/sparkai_workspace/release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)：109,803,520 bytes，`MZ`，SHA-256 `BA86020B96C12CA0632DD14D9881EC63B87B6993CE453EA9A3066210F8B1BA64`。
- [SparkAPI EXE](/E:/003Projects/SparkAI-WorkSpace/sparkai_workspace/release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe)：109,803,520 bytes，`MZ`，SHA-256 `3E13961DE6A6E754693516049455BD0DF1DAA718F1BD1C7B9FD17FD572D3EE22`。
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
