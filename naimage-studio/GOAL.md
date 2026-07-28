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
- 产品定义：naimage Agent = Codex/Claude Code 式通用 Agent Runtime + naimage 图片创作 Agent。这里不是把 Codex 源码或产品直接嵌入应用，而是复用其长上下文、原生工具循环、协议历史、checkpoint、Skills/CLI 与多步骤执行语义，同时由 naimage 领域工具拥有画布、TaskScope、图片容器、Image Gen、素材和绘画经验。
- 用户补充：GPT/Codex 策略不应继续沿用 32K 的过早压缩阈值；应按模型上下文窗口（Codex 类模型约 256K 量级，最终以模型目录或用户配置为准）分配可用预算，并为输出与安全余量预留空间。
- 当前实现：`runtime/context-strategy.cjs` 按模型族解析窗口和预算；GPT 5.5/5.6 使用 272K 总窗口、95% 有效窗口、244.8K 自动 checkpoint、20K 用户意图保留预算和 Responses 协议历史；Claude 使用普通消息历史与 200K/1M 窗口；未知模型使用 128K 平衡策略。
- checkpoint 契约：生成 handoff summary，替换旧 Responses 协议基础，清除旧 encrypted reasoning，随后重新注入当前画布、TaskScope 和 FastMemory。Codex 单条协议消息不再固定截断为 12K 字符。
- 权威文件：`runtime/context-strategy.cjs`、`agent-runtime.cjs`、`runtime/memory-store.cjs`、`desktop/agent-responses-adapter.cjs`、`src/settings-persistence.ts`。
- 证明：`test:context-strategy` 29 cases、`test:context-checkpoint` 16 cases、`test:settings-persistence` 57 cases、`test:agent-protocol`、`typecheck`。

### 2. 电商多语言工具栏

- 状态：`已验证`
- 已实现：首个内置声明式插件 `sparkai.commerce-toolkit` 提供画布顶部“套图翻译”命令；用户安装并授权后可启用、停用或卸载，可勾选最多 10 种目标语言。任务把当前画布选择冻结为唯一 SOURCE，要求每种语言分别调用一次 `image_gen` 并进入独立结果组，保留商品/品牌/型号/尺寸/数字/版式，禁止虚构卖点、认证和优惠，阿拉伯语使用 RTL；存在 SOURCE 时禁止用 `generate` 重画商品。
- 权威文件：`plugins/builtin-manifests.json`、`src/plugins/commerce-translation.ts`、`src/commerce-translation-dialog.tsx`、`src/main.tsx`。
- 证明：`test:plugin-system` 30 cases、`test:settings-persistence` 62 cases、`typecheck`、正式 `build` 与 `test:bundle`。插件 Runtime 已进入独立异步 chunk；本批没有运行全量 AIDebug。

### 3. 接入状态懒加载与手动刷新

- 状态：`已验证`
- 已实现：Electron Main 按 `accountBaseUrl + serverUserId` 保存最多 8 份账户密钥脱敏快照；模型目录继续使用独立磁盘缓存。设置抽屉挂载时只读取本地密钥/模型快照，切换到“接入”页不再触发网络请求；用户点击“刷新密钥与分组”或“刷新模型”后才访问 New API，单击即强制刷新，不再保留隐藏的六次点击逻辑。
- 安全：账户快照不保存完整或掩码 Key、Cookie、`allowIps`、`modelLimits`；完整 Key 仍只在 Main 内存。无模型快照时只使用设置中已保存的模型池，不联网。
- 权威文件：`desktop/new-api-client.cjs`、`desktop/account-token-service.cjs`、`desktop/ipc/server-ipc.cjs`、`src/main.tsx`。
- 证明：`test:account-token`、`test:settings-lazy-load` 12 cases、`test:ipc-registration`、`test:settings-persistence` 59 cases、`typecheck`、正式 `build` 与 `test:bundle`。本批没有运行全量 AIDebug。

### 4. Agent 自由浮动窗口与四向停靠

- 状态：`已验证`
- 已实现：右、左、上、下四向停靠、应用内浮动，以及可移出主窗口的独立 Electron Agent 窗口。横向/纵向停靠使用对应宽度/高度 resize handle，折叠 rail 随方向切换，布局设置已迁移并持久化。
- 独立窗契约：主 Renderer 始终是 Agent、画布和项目状态的唯一权威；独立窗只消费脱敏、有界快照并把提示词、停止、新建/清理/切换会话、原图/参考图、记忆和收回停靠命令转回主窗口，禁止创建第二个 Agent Runtime 或重复写项目。主窗口关闭时独立窗同步关闭。
- 权威文件：`src/main.tsx`、`src/agent-panel-layout.ts`、`src/agent-window-sync.ts`、`desktop/agent-window-service.cjs`、`agent-window-*` 表面、窗口 IPC。
- 证明：`test:agent-panel-layout` 16 cases、`test:agent-panel-ui` 17 cases、`test:agent-window` 54 cases、`test:agent-window-ui` 15 cases、`test:ipc-registration`、`test:lifecycle`、`typecheck`、正式 `build` 与 `test:bundle`。

### 5. “手工添加模型”改为“自定义模型”

- 状态：`已验证`
- 已实现：模型配置入口和空状态统一使用“自定义模型”，源码 UI 中不再残留“手工添加模型”。
- 权威文件：`src/model-config-dialog.tsx` 及设置相关文案。
- 证明：源码文本搜索无旧文案；`typecheck`、正式 `build`。

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

- 状态：`已验证`
- 已实现：账号 Images SSE 与自定义 Responses image generation 的 partial 统一进入 `image-preview`；手动画布请求和 Agent 请求都携带父 operation 与一基并发槽位，分层任务还为每个图层保留独立槽位。Renderer 按 operation、生成节点和布局 host 把最新 partial 放入目标单图/批量容器/连续系列/分层占位组的 pending tile，完成、失败或停止时按槽位清理，不再创建独立画布预览节点。
- 对话边界：中间图不再复制到 Agent 时间线消息，也不在主对话框或独立 Agent 窗口显示；它只存在于运行时 Renderer state，不写项目 session、会话历史或图片库。
- 权威文件：`desktop/new-api-client.cjs`、`desktop/ipc/server-ipc.cjs`、`agent-runtime.cjs`、`src/streaming-image-preview.ts`、`src/main.tsx`。
- 证明：`test:image-stream-preview` 17 cases、`test:image-container` 12 cases、`test:new-api-transport`、`test:agent-window`、`test:agent-protocol`、`typecheck`、正式 `build` 与 `test:bundle`。

### 9. 提示词复制按钮布局

- 状态：`已验证`
- 已实现：复制操作移到独立工具行，不再绝对定位覆盖 `<pre>`；提示词滚动区使用稳定 scrollbar gutter，复制成功状态仍可见。
- 参考：用户提供的图 1。
- 证明：`test:agent-panel-ui` 验证按钮位于滚动区上方、二者不相交、滚动区可滚动、gutter 为 stable，并实际点击进入“已复制”；截图位于对应 `.diagnostics/electron/agent-panel-ui-*` 目录。

### 10. Agent 侧边栏拖动性能

- 状态：`已验证`
- 已实现：pointermove 只更新拖动模型，并由 `requestAnimationFrame` 合并为 CSS preview variables；松手后只提交一次 React 状态和设置持久化。纯布局计算已从 `main.tsx` 抽到 `src/agent-panel-layout.ts`。
- 证明：`test:agent-panel-layout` 16 cases；`test:agent-panel-ui` 连续 12 次 pointer move 期间 App、Canvas、Agent feed、Composer React commit 均为 0，preview 生效并在 pointer release 后提交宽度；正式 `build` 与 `test:bundle` 已通过。

### 11. 插件系统与 project-graph 适配

- 状态：`部分实现`
- 目标：插件 manifest、注册表、权限、安装/启用/停用/卸载、Renderer contribution point 和命令注册；电商工具栏作为首个插件。
- 已实现：受信任的声明式内置 manifest、设置持久化与 Electron/Renderer 双侧清洗、安装/启用/停用/卸载、权限复核、命令注册表和画布工具栏 contribution point。插件禁止注入任意 Renderer JavaScript，也不能直接修改项目 session；完整运行时仅在存在启用插件时动态加载。
- project-graph：建立受控适配层，读取思维导图并生成图片需求/成果关系；插件不能直接修改项目 session 文件。
- 外部参考：<https://github.com/graphif/project-graph>
- 当前证明：`test:plugin-system` 30 cases、`test:settings-persistence` 62 cases、`typecheck`、`build`、`test:bundle`；project-graph 导入契约仍待实现和验证。

### 12. 账户密钥额度人民币显示

- 状态：`已验证`
- 已实现：账户密钥保留 New API 原始 `remain_quota`，按 `/api/status.quota_per_unit` 换算 R，并固定解释为 `1 R = 1 USD`，再使用 `/api/status.usd_exchange_rate` 换算人民币。设置页以 `￥` 为主显示，同时展示 R 和原始 quota；完整换算口径保留在审计提示中。`price` 充值价格倍率不参与余额汇率计算。
- 懒加载：用户显式刷新密钥时并行读取公开状态与密钥列表；打开设置只读取按账户隔离的本地快照，不联网。快照保存原始公开额度和换算参数，不保存派生显示字符串、Key、Cookie、IP 或模型限制；旧 v1 快照可读，下一次刷新升级为 v2。
- 编辑边界：创建/编辑密钥仍向 New API 写原始 quota，界面明确标注“原始额度”，不会把人民币或 R 数值误写回 `remain_quota`。
- 权威文件：`desktop/account-token-quota.cjs`、`desktop/account-token-service.cjs`、`src/core.ts`、`src/main.tsx`、`src/styles/04-settings-appearance.css`。
- 证明：`test:account-token-quota` 10 cases、`test:account-token`、`test:settings-lazy-load` 12 cases、`test:ipc-registration`、`typecheck`、正式 `build` 与 `test:bundle`。

## 已固化基线

### 2026-07-28 · 账户密钥与 Agent 自动化

- Git：`3923017 feat: add account tokens and agent automation`
- 能力：New API 账户密钥选择与 CRUD、账号模式账户 Key 直连、naimage loopback 自动化、Agent Skill 安装、Agent 面板和提示词交互的上一批改进。
- 已有验证证据：`typecheck`、账户令牌 selftest、设置持久化 48 cases、IPC 注册、自动化服务、Agent 集成、Skill quick validation、正式 build 与 bundle。
- 正式 bundle 证据：initial JS 630714 B，total JS 687209 B，CSS 185388 B，dist 928386 B。

## 变更日志

- 2026-07-28：建立受信任的声明式插件系统并交付首个跨境电商多语言套图插件；支持安装、授权、启停、卸载、画布工具栏贡献和最多 10 种语言选择，插件 Runtime 进入异步 chunk，project-graph 受控导入适配仍待继续。
- 2026-07-28：完成账户密钥额度人民币显示；动态读取 New API 公开额度单位和美元汇率，保留 R/原始 quota 审计信息，快照懒加载不额外联网且不持久化派生文案。
- 2026-07-28：完成图片容器流式中间预览；手工与 Agent 并发生图按 operation/槽位归入目标容器，移除独立预览节点及对话窗口内 partial，最终态按槽位清理。
- 2026-07-28：完成设置接入状态懒加载；账户密钥与模型/分组优先读取本地脱敏快照，显式按钮单击才访问 New API，并移除六次点击强刷逻辑。
- 2026-07-28：完成真正的独立 Electron Agent 窗口；主 Renderer 权威状态与独立表面双向同步，浮窗可发送/停止任务、管理会话和图片上下文并收回任一停靠方向，定向双窗口测试完成真实 mock Agent 往返。
- 2026-07-28：完成 Agent 四向停靠与应用内浮动，独立窗口仍待实现；完成自定义模型文案、提示词复制区布局和 resize 零 React 高频提交优化，并新增 16 项纯布局测试与 17 项 Electron 定向 UI 验证。
- 2026-07-28：完成模型感知上下文策略和 Codex 式 checkpoint；修复 Codex 长消息仍被 12K 字符截断的问题，新增 16 项 Runtime checkpoint 专项验证。
- 2026-07-28：创建长程目标文档；开始目标 1/7 的上下文策略系统。
