# IIIMAGE STUDIO 文档索引

## 当前入口

- [上下文地图](./CONTEXT_MAP.md)：进程拓扑、入口调用链、模块所有权、跨边界契约、状态位置、修改影响和测试映射。新增或移动模块以及改变公共契约时必须同步更新。
- [项目结构](./PROJECT_STRUCTURE.md)：源码分区、生成目录、安全清理和最低验证。
- [工作区上下文地图](../../WORKSPACE_CONTEXT_MAP.md)：桌面仓库与 `ai-native` 后端仓库的关系、技术栈和跨仓修改导航。
- [本地工具链](../../LOCAL_TOOLCHAIN.md)：当前便携 Bun/Go/.NET/pnpm 激活、诊断与 New API Web 深路径限制。
- [安装说明](./INSTALLATION.md)：Windows 安装包、校验、安装、卸载和数据目录。
- [品牌安装器架构](./BRANDED_INSTALLER_ARCHITECTURE.md)：自绘安装/卸载界面、静默 NSIS 内核、数据安全与自动化验证。
- [Agent 与画布交互原则](./AGENT_CANVAS_INTERACTION_PRINCIPLES.md)：单 Agent、成果画布与操作因果边界。
- [电商使用场景矩阵](./COMMERCE_USE_CASE_MATRIX.md)：商品、服装、文案、品牌与批量设计能力覆盖。

根目录 `PRODUCT_INTENT.md` 是产品意图总纲，`AGENTS.md` 是编码与验证约束，`CONTEXT_MAP.md` 是当前实现导航；三者优先级高于日期阶段文档。

## 发布基线

- [1.0.0 发布说明](./RELEASE_1.0.0.md)
- [1.0.1 发布说明](./RELEASE_1.0.1.md)
- [1.0.2 发布说明](./RELEASE_1.0.2.md)
- [1.0.3 发布说明](./RELEASE_1.0.3.md)
- [1.0.0 测试矩阵](./TEST_MATRIX_1.0.0.md)

发布说明是对应版本的历史证据，不自动代表当前 `package.json` 版本已经完成同样验证。

## 历史阶段记录

文件名以 `YYYY-MM-DD_` 开头的 Markdown 是对应阶段的计划、审计或收敛记录，用于追溯设计原因，不代表需要恢复旧实现。若历史记录与当前产品边界冲突，以 `PRODUCT_INTENT.md`、`AGENTS.md`、`CONTEXT_MAP.md` 和当前代码为准。

- 2026-07-11：Agent 隔离、编辑器、时间线、容器与连接设计。
- 2026-07-12：分层 PNG、性能、电商场景、AIDebug 契约与持续加固。
- 2026-07-13：Codex 原生协议、性能真值、UI Surface 与持续交付。
- 2026-07-14：图片生成交付收敛、选择和时间线闭环。
- 2026-07-16：真实 Image 2 交付审计、状态与布局性能收敛。
- 2026-07-20：发布后收敛、任务图和执行门禁。

最初从后端仓库分离 GUI 的来源说明已归档到 [history/SOURCE_INFO_2026-07-08.md](./history/SOURCE_INFO_2026-07-08.md)。
