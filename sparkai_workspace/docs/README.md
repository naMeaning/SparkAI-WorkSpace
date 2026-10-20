# SparkAI WorkSpace 文档索引

- [AI-Native 第三期本地验证与交付](AI_NATIVE_CONTEXT_VALIDATION_2026-10-20.md)：项目知识、成果检索与便携需求模板；本地合同证据与模型能力边界。
- [AI-Native 第二期本地验证与交付](AI_NATIVE_CREATION_VALIDATION_2026-10-20.md)：结构化创作要求、成果验收与定向修改；当前开发证据与未验证边界。

当前公开正式版本为 1.0.9。仓库 `main` 的后续本地开发改进不代表已进入该 Release；下载版本与正式发布状态以 [GitHub Releases](https://github.com/naMeaning/SparkAI-WorkSpace/releases) 为准。当前开发版的本地验证状态见 [Progress](../PROGRESS.md)。

## 面向用户的使用文档

这些教程覆盖公开版的创作路径及明确标注的开发版功能，分享时请附上适用版本。无需 Pro 的自定义接入属于 2026-10-17 主分支改动，公开 v1.0.9 安装包尚未更新：

- [第一次让 Agent 完成一张图](./tutorials/01-first-agent-image.md)：从导入图片、设置原图/参考图到查看和导出成果。
- [编辑、批量、多款与可复用需求](./tutorials/02-edit-and-reuse-results.md)：理解编辑、替换、多款、分层、抠图、重绘和需求节点。
- [用本地 CLI/MCP 控制 Agent](./tutorials/03-automation-cli.md)：读取状态、发送自然语言任务和处理版本冲突。
- [电商、社媒与科研工作台示例](./tutorials/04-workspace-recipes.md)：按工作台选择可复用的任务路径。
- [隐私与发布前检查清单](./PRIVACY_AND_PUBLISHING.md)：发布源码、文档和 Release 资产前排除凭据、用户数据和本机路径。
- [第三方参考项目与许可证](./THIRD_PARTY_REFERENCES.md)：列明 New API、Sub2API、GPT Image Playground 与 Infinite Canvas 的固定源码版本、许可证和参考范围。
- [原生 New API 双接入说明](./NEW_API_DUAL_ACCESS_AND_ACTIVATION.md)：说明账号登录、Base URL + API Key、自定义接口和可选扩展服务的边界。
- [推广文案](./PROMOTION_COPY.md)：面向朋友和社群分享的简短介绍，可直接复制后替换链接。

教程版本分层：01–04 的创作路径适用于公开 v1.0.9，01 的免费双接入步骤另标开发版范围；05–06 是主分支开发版预览，尚未进入公开安装包。

## 当前入口

- [AI-Native 第一期本地验证与交付（2026-10-19）](./AI_NATIVE_TASKS_VALIDATION_2026-10-19.md)：稳定任务、共同回答、重启/图片一致性和双窗口任务卡的Mock证据与交付状态。
- [真实 AI Native 九图展示与 CLI 完善（2026-10-18）](./AI_NATIVE_SHOWCASE_2026-10-18.md)：无对话框建项目、UTF-8 CLI、真实图片制作与本地交付证据。
- [Agent 工作流与图片上下文合同](./AGENT_WORKFLOW_CONTRACT.md)：结构化询问、冻结素材/配置、观察与生成证据分离、内容命名及共享 CLI/MCP；实际验证和本地交付见 Progress。
- [Agent 工作流本地验证与交付（2026-10-18）](./AGENT_WORKFLOW_VALIDATION_2026-10-18.md)：逐项证据、真实模型未测边界，以及本轮开发包交付入口。
- [工作台优化设计与执行交接（2026-10-16）](./WORKSPACE_OPTIMIZATION_DESIGN_2026-10-16.md)：接口真实性、画布交互、失败恢复、布局、配置与性能六个工作包，含实施顺序、验收和执行 Prompt；设计文档交付不代表功能已实施。
- [工作台优化实施与本地验收（2026-10-17）](./WORKSPACE_OPTIMIZATION_VALIDATION_2026-10-17.md)：逐阶段实现、Electron/重启/性能证据、密集拖动回归及本地制品/安装/Git交付状态。
- [Agent 工作流、图片上下文与更新功能交接（2026-10-17）](./AGENT_WORKFLOW_UPDATE_HANDOFF_2026-10-17.md)：`ask_user`、`view_image`/参考图、软件更新、运行中图片范围、内容命名、选中图片配置、真实参数联调和四向连线的诊断、方案、验收与 `gpt-6.1-sol max` 执行 Prompt；本文保留实施起点，最新本地完成与未验证边界见本轮验证和 Progress。
- [上下文地图](./CONTEXT_MAP.md)：进程拓扑、入口调用链、模块所有权、跨边界契约、状态位置、修改影响和测试映射。新增或移动模块以及改变公共契约时必须同步更新。
- [项目结构](./PROJECT_STRUCTURE.md)：源码分区、生成目录、安全清理和最低验证。
- [工作区上下文地图](../../WORKSPACE_CONTEXT_MAP.md)：桌面仓库与 `sparkai-extension` 扩展服务的关系、技术栈和跨仓修改导航。
- [本地工具链](../../LOCAL_TOOLCHAIN.md)：从代码实际用途出发的 Node/pnpm、便携 Go/Bun/gh、可选 .NET/Python/R 配置、诊断与发布前置条件。
- [安装说明](./INSTALLATION.md)：Windows 安装包、当前 1.0.9 哈希、安装、卸载和数据目录。
- [品牌安装器架构](./BRANDED_INSTALLER_ARCHITECTURE.md)：自绘安装/卸载界面、静默 NSIS 内核、数据安全与自动化验证。
- [Agent 与画布交互原则](./AGENT_CANVAS_INTERACTION_PRINCIPLES.md)：单 Agent、成果画布与操作因果边界。
- [电商使用场景矩阵](./COMMERCE_USE_CASE_MATRIX.md)：商品、服装、文案、品牌与批量设计能力覆盖。

根目录 `PRODUCT_INTENT.md` 是产品意图总纲，`AGENTS.md` 是编码与验证约束，`CONTEXT_MAP.md` 是当前实现导航；三者优先级高于日期阶段文档。

## 发布基线

2026-10-10：1.0.9 已正式发布。完整 `release:final` 报告为 `.diagnostics/release/final-release-2026-10-10T05-57-58-538Z/orchestrator-report.json`，远端资产核验为 `.diagnostics/release/publish-v1.0.9-2026-10-10/remote-assets-verification.json`；Release 位于 [GitHub v1.0.9](https://github.com/naMeaning/SparkAI-WorkSpace/releases/tag/v1.0.9)。

- [正式发布清单](./RELEASE_CHECKLIST.md)：每个版本的文档冻结、完整门禁、制品验签、GitHub Release 上传与复核顺序。
- 发布项目/GitHub Release 展示名：`SparkAI-WorkSpace`；应用内展示名仍为 `SparkAI WorkSpace`，`naimage-studio` 更新 product 和 `naimage-*` 兼容标识不变。
- [1.0.0 发布说明](./RELEASE_1.0.0.md)
- [1.0.1 发布说明](./RELEASE_1.0.1.md)
- [1.0.2 发布说明](./RELEASE_1.0.2.md)
- [1.0.3 发布说明](./RELEASE_1.0.3.md)
- [1.0.5 发布说明](./RELEASE_1.0.5.md)
- [1.0.6 发布说明](./RELEASE_1.0.6.md)
- [1.0.7 发布说明](./RELEASE_1.0.7.md)
- [1.0.9 发布说明](./RELEASE_1.0.9.md)
- [1.0.0 测试矩阵](./TEST_MATRIX_1.0.0.md)

发布说明是对应版本的历史证据，不自动代表当前 `package.json` 版本已经完成同样验证。

1.0.9 正式版本包含图片 Provider Adapter、画布素材选取、原格式成果、脱敏日志、集中图片配置、共享斜杠命令，以及 NewAPI/Sub2API 模型获取和 Grok 图片配置保留。原更新私钥丢失，新完整安装包使用新公钥，1.0.8 及更早版本必须手动完整安装；最低更新版本为 1.0.9。配置与备份方法见 [安装说明](./INSTALLATION.md)。

本仓库有 Git 元数据。此前同名开发 EXE、历史哈希和局部分项验证不能充当本次正式 Release 证据；1.0.9 新制品的大小、哈希和发布状态以同一次 `release:final` 报告及远端核验为准。

软件验证使用隔离测试账户与项目数据。根据用户最新边界，不创建本机 Windows 测试账户；1.0.9 正式编排已在隔离 Windows 安装面完成安装、升级与卸载验证，不能用日常安装替代后续版本的发布保护。

## 历史阶段记录

`docs/history/` 中以 `YYYY-MM-DD_` 开头的 Markdown 是对应阶段的计划、审计或收敛记录，用于追溯设计原因，不代表需要恢复旧实现。若历史记录与当前产品边界冲突，以 `PRODUCT_INTENT.md`、`AGENTS.md`、`CONTEXT_MAP.md` 和当前代码为准。

- 2026-07-11：Agent 隔离、编辑器、时间线、容器与连接设计。
- 2026-07-12：分层 PNG、性能、电商场景、AIDebug 契约与持续加固。
- 2026-07-13：Codex 原生协议、性能真值、UI Surface 与持续交付。
- 2026-07-14：图片生成交付收敛、选择和时间线闭环。
- 2026-07-16：真实 Image 2 交付审计、状态与布局性能收敛。
- 2026-07-20：发布后收敛、任务图和执行门禁。

最初从后端仓库分离 GUI 的来源说明见 [history/SOURCE_INFO_2026-07-08.md](./history/SOURCE_INFO_2026-07-08.md)。已完成的透明玻璃迁移记录见 [history/LIQUID_GLASS_MIGRATION.md](./history/LIQUID_GLASS_MIGRATION.md)。
