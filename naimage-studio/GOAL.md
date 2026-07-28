# naimage 长程目标

本文档记录当前用户目标、完成证据和下一步。状态只能依据当前源码与专项验证更新，不能以计划或推测代替完成证明。

状态枚举：`未开始`、`进行中`、`部分实现`、`已实现待验证`、`已验证`。

## 总体原则

- 保持项目上下文地图同步：`docs/CONTEXT_MAP.md`；跨仓库/发布契约变化时同步根目录 `WORKSPACE_CONTEXT_MAP.md`。
- 日常开发运行影响范围内的最小专项测试，不默认运行全量 AIDebug。
- Renderer 功能优先进入自然异步边界；正式构建后运行 `test:bundle` 检查体积。
- 账户凭证、上游 Key、relay token 和 session cookie 不进入 UI、日志、缓存文档或测试输出。
- CRM 不属于后续产品目标；相关旧代码最终删除，不在新架构上继续扩展。

## 目标清单

### 1. 模型感知的上下文控制

- 状态：`已验证`
- 目标：提供 `自动`、`Codex`、`Claude Code`、`naimage 平衡`、`自定义`策略。自动模式按模型族选择；用户可覆盖。
- 产品定义：naimage Agent = Codex 式通用 Agent Runtime + naimage 图片领域 Agent。复用 Codex 的长上下文、原生工具循环、协议历史与压缩语义，同时保留画布、TaskScope、图片容器、Image Gen 和绘画经验。
- 用户补充：GPT/Codex 策略不应继续沿用 32K 的过早压缩阈值；应按模型上下文窗口（Codex 类模型约 256K 量级，最终以模型目录或用户配置为准）分配可用预算，并为输出与安全余量预留空间。
- 当前实现：`runtime/context-strategy.cjs` 按模型族解析窗口和预算；GPT 5.5/5.6 使用 272K 总窗口、95% 有效窗口、244.8K 自动 checkpoint、20K 用户意图保留预算和 Responses 协议历史；Claude 使用普通消息历史与 200K/1M 窗口；未知模型使用 128K 平衡策略。
- checkpoint 契约：生成 handoff summary，替换旧 Responses 协议基础，清除旧 encrypted reasoning，随后重新注入当前画布、TaskScope 和 FastMemory。Codex 单条协议消息不再固定截断为 12K 字符。
- 权威文件：`runtime/context-strategy.cjs`、`agent-runtime.cjs`、`runtime/memory-store.cjs`、`desktop/agent-responses-adapter.cjs`、`src/settings-persistence.ts`。
- 证明：`test:context-strategy` 29 cases、`test:context-checkpoint` 16 cases、`test:settings-persistence` 57 cases、`test:agent-protocol`、`typecheck`。

### 2. 电商多语言工具栏

- 状态：`未开始`
- 目标：作为可安装插件提供一键套图翻译，可勾选多个目标语言，按语言归组结果。
- 权威文件：待插件系统建立后登记。
- 证明：插件命令专项测试、翻译任务契约测试、目标语言多选 UI 冒烟。

### 3. 接入状态懒加载与手动刷新

- 状态：`部分实现`
- 当前基础：模型列表有 Electron 内存缓存；账户登录、密钥与分组链路已存在。
- 缺口：需要脱敏的本地快照、设置页优先读缓存、明确的“刷新密钥/分组/模型”按钮，并避免打开设置即联网。
- 权威文件：`desktop/new-api-client.cjs`、`desktop/account-token-service.cjs`、`desktop/ipc/server-ipc.cjs`、`src/main.tsx`。
- 证明：离线缓存与显式刷新 selftest；设置页专项 UI 冒烟。

### 4. Agent 自由浮动窗口与四向停靠

- 状态：`部分实现`
- 当前基础：Agent 面板已有尺寸和停靠相关交互。
- 缺口：审计上/下/左/右完整性；实现可移出应用主窗口的独立 Electron 浮动窗口及状态同步。
- 权威文件：`src/main.tsx`、Agent UI 模块、Electron 窗口服务与 IPC。
- 证明：窗口生命周期 selftest；四向停靠和浮动窗口专项 GUI 冒烟。

### 5. “手工添加模型”改为“自定义模型”

- 状态：`未开始`
- 权威文件：`src/model-config-dialog.tsx` 及设置相关文案。
- 证明：文本搜索无旧文案；设置专项测试。

### 6. 外观导入与自定义配置

- 状态：`未开始`
- 目标：支持导入、导出和编辑自定义主题，校验颜色字段并安全回退。
- 权威文件：外观设置模块、`src/settings-persistence.ts`、主题 CSS 变量层。
- 证明：主题 schema/persistence selftest；导入专项 GUI 冒烟。

### 7. 用户自选上下文策略

- 状态：`部分实现`
- 已实现：设置页可选择自动、Codex、Claude Code、naimage 平衡和自定义；自定义模式可设置总窗口、有效窗口比例、自动压缩点和保留用户消息 Token，Electron/Renderer 持久化与边界修复已覆盖。
- 剩余：若产品仍需要让普通用户分别控制画布、FastMemory、普通消息和协议历史细分预算，需要再设计高级设置；当前由策略协调器自动分配，避免普通设置过重。
- 证明：`test:context-strategy`、`test:settings-persistence`、`test:context-checkpoint`；设置页专项 GUI 尚未运行。

### 8. 图片容器流式中间预览

- 状态：`部分实现`
- 当前基础：运行时和 Renderer 已有流式图片预览状态与事件。
- 缺口：审计预览是否对单图节点、批量容器、连续系列和分层容器均落在目标容器槽位，结束/失败时是否清理。
- 权威文件：图片 transport、IPC、`src/main.tsx`、图片容器组件。
- 证明：流事件归属 selftest；容器专项 GUI 冒烟。

### 9. 提示词复制按钮布局

- 状态：`未开始`
- 目标：复制按钮与滚动条轨道分离，键盘焦点和窄宽度下均可用。
- 参考：用户提供的图 1。
- 证明：对应工具卡专项 GUI 截图和可点击性检查。

### 10. Agent 侧边栏拖动性能

- 状态：`未开始`
- 目标：pointermove 不触发高频全树 React 更新；使用 `requestAnimationFrame` 与 CSS 变量/局部提交，松手后持久化。
- 证明：拖动期间 render commit 与帧耗时专项指标；GUI 冒烟。

### 11. 插件系统与 project-graph 适配

- 状态：`未开始`
- 目标：插件 manifest、注册表、权限、安装/启用/停用/卸载、Renderer contribution point 和命令注册；电商工具栏作为首个插件。
- project-graph：建立受控适配层，读取思维导图并生成图片需求/成果关系；插件不能直接修改项目 session 文件。
- 外部参考：<https://github.com/graphif/project-graph>
- 证明：manifest/权限/生命周期 selftest；电商插件与 project-graph 导入契约专项测试。

### 12. 账户密钥额度人民币显示

- 状态：`未开始`
- 目标：按 `1 R = 1 USD` 解释账户额度，再使用明确汇率换算为人民币并显示 `￥`；同时保留原始单位以便审计，禁止把倍率误当汇率。
- 权威文件：`desktop/account-token-service.cjs`、账户密钥 UI、货币格式工具。
- 证明：额度单位和舍入 selftest；账户设置专项测试。

## 已固化基线

### 2026-07-28 · 账户密钥与 Agent 自动化

- Git：`3923017 feat: add account tokens and agent automation`
- 能力：New API 账户密钥选择与 CRUD、账号模式账户 Key 直连、naimage loopback 自动化、Agent Skill 安装、Agent 面板和提示词交互的上一批改进。
- 已有验证证据：`typecheck`、账户令牌 selftest、设置持久化 48 cases、IPC 注册、自动化服务、Agent 集成、Skill quick validation、正式 build 与 bundle。
- 正式 bundle 证据：initial JS 630714 B，total JS 687209 B，CSS 185388 B，dist 928386 B。

## 变更日志

- 2026-07-28：完成模型感知上下文策略和 Codex 式 checkpoint；修复 Codex 长消息仍被 12K 字符截断的问题，新增 16 项 Runtime checkpoint 专项验证。
- 2026-07-28：创建长程目标文档；开始目标 1/7 的上下文策略系统。
