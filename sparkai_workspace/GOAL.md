# SparkAI WorkSpace 目标

## 当前任务：保留 Grok 配置并补齐 NewAPI/Sub2API 模型获取（2026-10-10，partially verified）

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
- 当前验证诊断（2026-10-09）：正式源码门禁的 `image import` 在本机 Windows 临时目录使用 `C:\Users\ADMINI~1` 短路径时，将合法 8.3 路径误判为符号链接并阻断导入。修正 worker 的逐级 `lstat` 链接检查与主进程结果目录比较：只以 `lstat` 发现的实际链接/联接拒绝路径，规范化比较接受普通短路径；`test:image-import` 已通过（506 入口、502 唯一资产、来源/输出联接拒绝、16 次并发导入、超时/关闭清理）。该产品代码变化会使正式门禁从头重新验证，Release 仍未发布。

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

当前整备轨道（2026-08-16）：大量图片卡顿治理、统一导出中心、真实模型与真实 C 盘迁移的显式授权验收工具，以及受影响 AIDebug 稳定性均已完成实现和专项验证。最终源码稳定报告 [verify-2026-08-15T22-12-37-714Z/report.json](/E:/019创业项目/nimage/naimage-studio/.diagnostics/release/verify-2026-08-15T22-12-37-714Z/report.json) 为 `113/113`、`sourceStable:true`；此前暴露的共享弹层焦点竞态和 AskUser 窄屏裁剪残片误报均已修复。Commerce、Glass、Graph CLI 和导出 UI AIDebug 现在都使用显式隔离项目 fixture，不依赖废弃的 AppData 默认项目；Session mutation journal 也已补上待提交事件保留回归。正式 `release:final` 仍因本机现有安装在零步骤预检退出而保留 incomplete，强制 Bundle、本地双版本候选和针对性门禁已通过，但不冒充正式发布。SparkAI Extension 生产部署、真实图片/视频模型调用、真实 AppData 迁移或清理、旧 New API/CRM 源码删除、Git tag、远端推送与 GitHub Release 均不在当前授权范围内。

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
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)：175,979,520 bytes（167.83 MiB），2026-08-26 15:30:01 +08:00，SHA-256 `7DB90B013E7341E3B7BD1D38FDA1C7755870C071F2BD0C12606E32D268CC719E`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe)：175,979,520 bytes（167.83 MiB），2026-08-26 15:31:15 +08:00，SHA-256 `4846618581E72C38E80E8F0DC9336FEE8344489BE773CA8B4B2E64E44F712662`。
- 两个安装器的 Authenticode 状态均为 `NotSigned`。本轮未运行受既有 Electron GPU 启动限制影响的 `test:new-api-transport`，未做真实安装/卸载 smoke，未访问真实 New API、License、图片或视频模型，未执行正式 Bundle/发布验收，也未提交、推送或发布。

## 本地整备收口（2026-08-16）

- 最终本地发布门禁 [report.json](/E:/019创业项目/nimage/naimage-studio/.diagnostics/release/verify-2026-08-15T22-12-37-714Z/report.json) 完成 113/113 项，`sourceStable:true`；覆盖 typecheck、协议/IPC、项目 Session、迁移/导出、图片性能、UI Surface、更新/回滚和 Bundle hard gate。
- AIDebug/导出 UI 已改为每次运行创建隔离项目列表和项目目录，Commerce、Glass、Graph CLI、Skill、图片生成与 Commerce Export UI 不再依赖测试机上的默认项目；这只影响测试夹具，不改变用户项目路径策略。
- `project-session-merge.cjs` 保留尚未获得 `commitRevision` 的新 mutation，避免旧已提交事件在保存协调器盖章前把图层状态丢掉；对应 selftest 覆盖重组与可见性连续保存。
- 本地验证不等于外部验收：正式安装/升级/卸载、Windows 签名、真实模型供应商服从度、真实 C 盘迁移清理和 SparkAI Extension 生产部署仍需在用户明确授权和实际环境中完成。

## 图片组项目目录与连线交互核验（2026-08-15）

- `desktop/image-collection-export-service.cjs` 将普通图片组批量导出固定到当前项目的 `image-groups/<稳定图片组名>/`；多组导出共享 staging、备份与整批回滚，一个组选中后得到一个同名文件夹和 `image-group.json`。旧 `exports/image-groups/` 只用于历史 manifest 打开兼容，新导出不再写入旧目录；项目受管原图不移动、不覆盖。
- 画布连接头只有超过拖动阈值才尝试建边，目标必须真实包含指针；输入/输出连接头单击、空白松手、`Escape` 与 `pointercancel` 都只取消草稿。连线使用 18 px 透明命中区，单击或右键可打开具体关系菜单并断开一条底层真实边，节点右键继续提供全部输入/输出批量断开；图片容器投影边保留真实 source/target ID。
- 专项 `test:image-collection-export`、`test:requirement-graph`、`test:image-container`（12 cases）、`test:image-layout`（14 cases）、`test:image-collection-mutation`（4 cases）、`test:image-export`、`test:psd-export`、`test:image-stream-preview`（30 cases）、`test:automation-service`、`test:ipc-registration`（141/138/3）、`test:workspace-glass-ui`（155 cases）、`test:ui-foundation`、`test:aidebug-glass-workspace`、`automation:generate --check`、`typecheck` 与 Harness 10 项结构检查均退出 0。
- 隔离 Requirement AIDebug [report.json](/E:/019创业项目/nimage/naimage-studio/.diagnostics/electron/aidebug-2026-08-15T10-17-03-869Z/report.json) 为 `ok:true`、9 scenes、0 failures；`connectionCancelSafety` 明确记录输入连接头单击、输出连接头单击、空白松手和 `pointercancel` 四条路径都不修改关系，并验证具体断线与撤销恢复。
- 最终图片集合 AIDebug [report.json](/E:/019创业项目/nimage/naimage-studio/.diagnostics/electron/aidebug-2026-08-15T10-47-24-790Z/report.json) 为 `ok:true`、11 scenes、0 failures。成果编辑器最大化实测 `1256×796`，四周约 12 px；查看器连续切图有 12 个状态采样、0 空白帧、最大表面位移 0，A→B→C 延迟解码竞态最终 `target/displayed/final` 均为 C，`buffering:false` 且 `staleRollback:false`。
- 最终 `corepack pnpm run typecheck`、`git diff --check` 与 Harness 10 项检查退出 0；独立 production build 转换 1667 modules、7.70 s。`corepack pnpm run package:win:variants` 退出 0，内含两次 production build（6.17 s、6.05 s）和双 Electron/NSIS/品牌封装，`bundleEnforced:false`；当前版本没有旧 `naimage-Setup/Core` 公开命名。
- [SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)：175,965,696 bytes（167.81 MiB），2026-08-15 19:00:17 +08:00，SHA-256 `2FFC43A1822A484C1DE783D6762538E74618CE6B1B8E0FF455485DDA14133D3B`。
- [SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe](/E:/019创业项目/nimage/naimage-studio/release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe)：175,969,280 bytes（167.82 MiB），2026-08-15 19:01:09 +08:00，SHA-256 `3249EE0BDFCF16DEDF75FA1BFFE5B3976F8BD3C53745B80B2DCB3B3C2477F7A4`。
- 本轮没有调用真实图片/视频模型或 Seedance；未执行正式 Bundle/发布验收、Windows 数字签名验证或真实安装/卸载 smoke，代码未提交或推送。

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
