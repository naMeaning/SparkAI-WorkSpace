# AI-Native 第二期本地验证与交付

本期仅桌面与本地 Runtime，0 真实图片/视频/对话请求。完整合同见 [工作流合同](AGENT_WORKFLOW_CONTRACT.md)，动态执行记录及最终制品见 [Progress](../PROGRESS.md)。不实施第三期，不修改外部 New API/Extension，不上传 EXE 或创建 Release/tag。

## 实现与验证

项目要求/验收 Main owner、Runtime 像素 proof、同一 catalog 采用状态、逐目标定向计划和 GUI/公开命令已接通。第一期 agent-task 幂等与恢复 owner 直接复用。完整要求位于项目 `.naimage/creation.json`，任务回执只保留引用与摘要；原 TaskScope 继续拥有素材、配置及受管蒙版。

首轮失败保留：新增 IPC 后测试仍断言旧数量，已同步合同；GUI保存空可选字段与HTTP JSON省略undefined的差异曾使要求编辑失败，已在公共命令入口统一JSON值边界并补回归。HMR曾干扰早期测试，但不能替代上述确定根因。

Runtime [19组报告](../.diagnostics/creation-runtime/2026-10-20T03-52-30-926Z/report.json)通过，11次本地图片POST、0真实；七图倒序完成、3/6失败后五个保存成果经最终action、normalizer、JSON重读及Main owner仍精确对应原槽。包括无像素消费/伪造/跨图/跨run/旧要求拒绝，实际消费可写观察、同run journal已落盘但未入session的观察、要求写入失败保留图片、追问序列化恢复与延后修订交接。

真实 Electron [中间报告](../.diagnostics/creation-ui-2026-10-20T03-49-58-748Z/report.json)完成最小窗口、GUI要求编辑及原2/5精确两次图片POST。随后发现同字节独立生成成果的旧normalizer全局哈希归并ID，导致任务等待保存；保留此失败，修复与最终重跑结果另行登记。专项和中间报告不能替代完整UI/安装版证据。

收口Runtime[24组](../.diagnostics/creation-runtime/2026-10-20T04-18-32-804Z/report.json)通过，12本地图片POST/0真实。精确区域以Main登记的单目标mask三元冻结到TaskScope，真实PNG完整解码/同尺寸/透明区域/原图与mask哈希均检查，同字节注入唯一redraw；坏绑定、文件变化、截断、空mask、多mask/多目标及模型重复/override均零额外派发，mask base64不进入持久tool memory。creation15组、merge96、asset-identity28、真实Main project-io通过；后者新增两张同字节独立生成成果逐次merge→save→manifest→reopen身份保持，任务completed/savedCount2。typecheck、view-image、task-scope及steer24通过。

自动A阶段 Runtime [27组报告](../.diagnostics/creation-runtime/2026-10-20T04-38-12-973Z/report.json)通过，13次本地图片POST、0真实请求。新增自动本地检查：初次、定向和蒙版生成的已保存图片都通过相同 Main 文件检查，不生成 AI 视觉结论。真实 `fs.rename` EACCES 夹具验证验收写入失败仍保留1次POST/1张已保存图片、旧验收文件不变，后续主模型收到不可重新生成的说明。相同目标/要求重复回执不重复解码。

最终资产专项36项、merge96项通过；真实 Electron project-io 覆盖 Renderer→Main merge→保存→manifest→重开，并核对两张同字节独立生成图片的身份以及 `completed/savedCount=2`。双 Renderer6例验证旧 session 无法覆盖 Main 的新要求版本。内容、要求或依赖来源变化使对应证据失效，移动和重命名保留验收；用户决定仍由 catalog 统一管理，本地硬检查失败不能靠采用动作改写。

原蒙版编辑器进入同一 `creation.revision.start`；编辑器冻结目标/要求revision/提交身份，保存失败不启动图片，回执失败重试复用同一mask及提交内容。region4组验证首次并发保存共用Promise、丢回执重试、内容变更拒绝和重排/删除后按稳定身份定位。mask8组、hook7组、共享status10组及内容命名15项通过。

[最终相关回归](../.diagnostics/creation-delivery-2026-10-20/final-regression.json)12个专项全部exit0：agent-task、automation-service、MCP（95工具）、IPC（159注册/156 preload/3 send）、run-control、task-scope、view-image、region、mask、hook、status及内容命名。另已运行creation15组、steer24、image-recovery（10子进程，1本地POST/3 polls/2 downloads）、agent-window sync97、catalog82及typecheck。未机械运行无关全量测试。

真实隔离 Electron [最终6组/13截图](../.diagnostics/creation-ui-2026-10-20T04-45-17-383Z/report.json)全部通过，4本地模型回合/3图片POST/0真实。七选二场景只有2POST，分别上传原2/原5且修改文本不串用，保留原7张；随后实际pointer涂抹再产生1个蒙版绑定的新任务，multipart原图/mask哈希与Main冻结记录一致。自动A通过/B未检查、前后基准、采用/撤销、独立窗同owner修改、重载和正常重启10成果/要求第4版均通过；原定向及蒙版submission重试零新增POST。两次退出均0、未强杀。已人工查看最小窗、比较、涂抹、独立窗及重启截图，无关键控件裁切。独立窗脚本原data selector不存在，改为实际id、可见性、10行和摘要视口断言后重跑，产品未因此修改。

第一期任务卡[最终回归10组/9截图](../.diagnostics/agent-task-ui-2026-10-20T04-44-19-768Z/report.json)通过，9本地模型回合/2图片POST/0真实；双窗回答、保存失败、重载/重启和两次正常退出覆盖。此前04:39独立窗textarea超时根因未证实，保留失败；只补主窗实际完成/已保存等待和独立窗失败诊断，最终全程通过，未据此臆断产品或HMR原因。

## 验证边界

Mock/loopback 只能证明合同、像素递交/消费门槛、身份、持久化、请求次数和控制流程，不能证明真实视觉识别、Logo保持、文字准确率、参考遵从或审美质量。真实上游兼容、计费与正式发布不在本期授权内。

## 中间包与故障修复（历史）

中间包 `corepack pnpm run package:win:unrestricted` exit0，production build1696 modules/24.23s；647个产品/测试/公开契约文件冻结hash `ccf3f8f6468067e3ff53a0155b00bb44720dae7feacd8763f2e36e0bc018bd5d`。包内124dist与156个必需owner存在性及逐字节核对、生产元数据、免费dual-access策略与无环境/诊断文件均通过。此包随后发现容量边界缺口，须由最终包替代。

中间EXE：109,924,864 B，SHA-256 `38f9a0e6d6ccb1c3fa87523fc09bff074685383da67bc675ef3e2f93e9fccb92`。ASAR52,413,939 B / SHA-256 `46d746f5c1c8332c1bbfcd58e34683f05de86eb54792f68f36f7f2d6a75e8613`。品牌`/S`原位安装exit0/23,123ms，目录/配置保留，安装EXE/ASAR匹配；不能代替后续最终包。

[容量末检](../.diagnostics/creation-capacity-audit-1792471852653/report.json)用距8MiB仅100B的合法记录复现：`CREATION_STORE_FULL`未标记creationPersistenceFailed，下一模拟回合仍调用一次serverGenerateImage（0真实/0HTTP，旧记录保持）。最小owner修复和Runtime零派发回归正在进行，之后重新冻结/打包/安装及安装版UI。未上传EXE、未创建Release/tag，正式发布门禁未运行。

owner[16组修复报告](../.diagnostics/creation-delivery-2026-10-20/owner-capacity-selftest.json)通过，容量/序列化均进入creation_save，保留原code；check/update/revision容量拒绝后原bytes/currentRef不变，无tmp和任务派发。中间[安装版6组/13截图](../.diagnostics/creation-ui-2026-10-20T04-51-38-166Z/report.json)通过、两次正常退出；最终安装版仍需在故障保护修复后重新验证。

最终故障[Runtime29组](../.diagnostics/creation-runtime/2026-10-20T05-00-18-171Z/report.json)通过，14本地图片POST/0真实。容量失败后主模型实际继续调用image_gen，server/POST均0，旧记录/七原图不变。另严格复现自动A原先只有文字指引时[2POST漏洞](../.diagnostics/creation-runtime/2026-10-20T04-57-48-295Z/automatic-check-guard.json)；现私有Symbol接Runtime原unsafe guard，真实EACCES后3模型回合仅1POST、保留1成功成果，后续请求被不可重试拦截。蒙版失败续轮亦1POST/1成果，成功actions不丢、标记不入JSON/公开DTO。最终view-image/语法/diff通过。

## 最终本地交付

`package:win:unrestricted` exit0，production build1696 modules/23.28s；647文件冻结hash `237c19bf48d4d7853f643ca5174340511492b2702e4be0ee0db26e2800b0d43c`，124dist/156必需source owner存在及逐字节、生产元数据、dual-access及无env/diagnostics核对通过。[包审计](../.diagnostics/creation-delivery-2026-10-20/package-audit.json)。

[最终Windows EXE](../release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)：109,925,376 B，SHA-256 `3e8a84ffdc4bb169c7b6c817118a65cc325dcc05b4292679852b11cb9226788e`。ASAR 52,414,483 B / `78e58fe36313c5cf28bcff2a56a975ca0afadd9f1b7ca150bc46558b303374b5`。

品牌`/S`原位安装exit0/17,463ms，原注册目录/1.0.9、配置及快捷方式偏好保留；安装EXE/ASAR匹配，安装前无同名进程，未强杀。 [安装报告](../.diagnostics/creation-delivery-2026-10-20/install.json)。[最终安装版UI](../.diagnostics/creation-ui-2026-10-20T05-05-36-980Z/report.json)6组/13截图通过，4本地模型回合/3图片POST/0真实，七选二2POST和实际pointer蒙版第3POST准确；最小窗/双窗、比较/采用撤销、重载/重启及原提交零重派发通过，2次正常退出exit0/forced=false。

对应源码/文档待commit并普通push，最终Git记录见Progress。EXE未上传，未创建Release/tag；本期完成后停止，不启动第三期。
