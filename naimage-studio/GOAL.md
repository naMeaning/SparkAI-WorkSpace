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
- 证明：`test:context-strategy` 35 cases、`test:context-checkpoint` 16 cases、`test:settings-persistence` 66 cases、`test:agent-protocol`、`typecheck`；快速 `aidebug:gui` 已真实切换到自定义策略并确认五种策略与四项预算输入可见、无裁切。

### 2. 电商多语言工具栏

- 状态：`已验证`
- 已实现：首个内置声明式插件 `sparkai.commerce-toolkit` 提供画布顶部“套图翻译”命令；用户安装并授权后可启用、停用或卸载，可勾选最多 10 种目标语言。任务把当前画布选择冻结为唯一 SOURCE，要求每种语言分别调用一次 `image_gen` 并进入独立结果组，保留商品/品牌/型号/尺寸/数字/版式，禁止虚构卖点、认证和优惠，阿拉伯语使用 RTL；存在 SOURCE 时禁止用 `generate` 重画商品。
- 权威文件：`plugins/builtin-manifests.json`、`src/plugins/commerce-translation.ts`、`src/commerce-translation-dialog.tsx`、`desktop/plugin-task-prompts.cjs`、`desktop/ipc/plugin-ipc.cjs`、`src/main.tsx`。
- 证明：`test:plugin-system` 48 cases、`test:settings-persistence` 66 cases、`test:ipc-registration`、`typecheck`、正式 `build` 与 `test:bundle`。插件 Runtime 已进入独立异步 chunk；长 Prompt 由 Electron 受信任服务生成，不占 Renderer Bundle。

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

- 状态：`已验证`
- 已实现：设置页新增第 11 套“自定义”配色，可分别编辑浅色/深色的应用背景、画布、表面、文字、边框、主色、危险色和成功色共 10 个语义颜色；主题名称、恢复陶土模板和画布实时预览已贯通，独立 Agent 窗口同步使用同一主题。
- 导入导出：原生 Electron 文件对话框读写严格的 `naimage-theme v1` JSON；文件最大 64 KiB，只接受完整的浅/深色字段和 `#RGB`/`#RRGGBB`，不接受 CSS、URL 或脚本内容，非法文件不覆盖当前主题。
- 权威文件：`desktop/theme-preset-service.cjs`、`desktop/ipc/config-ipc.cjs`、`src/theme-palette-picker.tsx`、`src/settings-persistence.ts`、`src/styles/01-theme-palettes.css`、`src/styles/04-settings-appearance.css`。
- 证明：`test:theme-preset` 24 cases（每模式 10 色）、`test:settings-persistence` 66 cases、`test:agent-window`、`test:ipc-registration`、`test:ui-foundation`、`typecheck`、正式 `build + test:bundle`；快速 `aidebug:gui` 已验证明暗编辑切换、画布颜色即时变化、抽屉内部滚动和操作按钮无裁切。

### 7. 用户自选上下文策略

- 状态：`已验证`
- 已实现：设置页可选择自动、Codex、Claude Code、naimage 平衡和自定义；自定义模式可设置总窗口、有效窗口比例、自动压缩点和保留用户消息 Token，Electron/Renderer 持久化与边界修复已覆盖。画布、FastMemory、普通消息和协议历史的细分预算继续由同一策略协调器按所选总预算自动分配，避免产生互相矛盾的公开参数。
- 证明：`test:context-strategy` 35 cases、`test:settings-persistence` 66 cases、`test:context-checkpoint` 16 cases；快速 `aidebug:gui` 已切换到“自定义”并验证五种选项和四项预算输入真实显示、无裁切。

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

### 11. 插件系统、project-graph 与科研绘图适配

- 状态：`已验证`
- 目标：插件 manifest、注册表、权限、安装/启用/停用/卸载、Renderer contribution point 和命令注册；电商工具栏作为首个插件。
- 已实现：受信任的声明式内置 manifest、设置持久化与 Electron/Renderer 双侧清洗、安装/启用/停用/卸载、权限复核、命令注册表和画布工具栏 contribution point。插件禁止注入任意 Renderer JavaScript，也不能直接修改项目 session；完整运行时仅在存在启用插件时动态加载。
- Project Graph：第二个内置插件 `sparkai.project-graph` 可只读选择 `.prg` 或图结构 JSON。Electron 适配器从 ZIP 中只读取 `stage.msgpack` 并解析 MessagePack 对象引用，不执行扩展脚本、附件或任意插件代码，不暴露绝对路径；文件、舞台、节点、关系、文本和遍历复杂度均有上限。Renderer 显式清空画布选择与附件继承，把 GRAPH 作为唯一知识 SOURCE，要求 Agent 按规模生成 1 张总览或 2–6 张独立学习图片，并禁止虚构图中不存在的事实或直接写项目 session。
- 科研绘图：第三个内置插件 `sparkai.scientific-figure` 参考 `Yuan1z0825/nature-skills` 的科研绘图工作流，内置可拆包的受信任 Agent 契约；定量绘图先选 Python 或 R，之后单后端完成绘制、预览、导出和 QA，禁止虚构数据。插件目录预留 `naimage-plugin-v1` 在线目录格式，不携带上游图库、示例或 Python/R 依赖。
- Bundle 边界：插件运行时、设置表面和插件专属对话框保持自然异步 chunk；`test:bundle` 单独约束 120,000 B 插件 JS，核心仍按 720,000 B 计量，插件进入首屏图即失败。
- 外部参考：<https://github.com/graphif/project-graph>
- 权威文件：`desktop/project-graph-adapter.cjs`、`desktop/plugin-task-prompts.cjs`、`desktop/ipc/project-ipc.cjs`、`desktop/ipc/plugin-ipc.cjs`、`plugins/builtin-manifests.json`、`src/plugin-system.ts`、`src/main.tsx`。
- 证明：`test:project-graph` 23 cases、`test:plugin-system` 65 cases、`test:ipc-registration` 88 invoke handlers/85 preload invokes/3 internal Agent invokes、`test:settings-persistence` 66 cases、正式 `build` 与 `test:bundle`。当前 Bundle 为 initial 648,314 B、core JS 710,952 B、plugin JS 9,266 B。真实仓库样例 `ProjectGraph开发进程图.prg` 解析为 119 节点/117 关系/21 Section，`服务器.prg` 解析为 9 节点/5 关系/5 Section；均无警告。长 Prompt 已移出 Renderer，本批未修改任何 `.prg`、项目 session 或用户数据。

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

- 2026-07-28：完成 `naimage-theme v1` 自定义主题导入、导出、编辑和浅/深色实时预览；长插件 Prompt 移到 Electron 受信任服务，IPC 更新为 88/85/3；快速 GUI、专项测试、正式构建和 Bundle 已验证，总 JS 719,928 B。
- 2026-07-28：交付 `sparkai.project-graph` 视觉学习插件；新增受限 `.prg`/JSON 适配、MessagePack 解码、只读 IPC 和独立异步 Prompt 模块，真实 Project Graph 样例与生产 Bundle 已验证。
- 2026-07-28：建立受信任的声明式插件系统并交付首个跨境电商多语言套图插件；支持安装、授权、启停、卸载、画布工具栏贡献和最多 10 种语言选择，插件 Runtime 进入异步 chunk；Project Graph 适配随后在独立批次完成。
- 2026-07-28：完成账户密钥额度人民币显示；动态读取 New API 公开额度单位和美元汇率，保留 R/原始 quota 审计信息，快照懒加载不额外联网且不持久化派生文案。
- 2026-07-28：完成图片容器流式中间预览；手工与 Agent 并发生图按 operation/槽位归入目标容器，移除独立预览节点及对话窗口内 partial，最终态按槽位清理。
- 2026-07-28：完成设置接入状态懒加载；账户密钥与模型/分组优先读取本地脱敏快照，显式按钮单击才访问 New API，并移除六次点击强刷逻辑。
- 2026-07-28：完成真正的独立 Electron Agent 窗口；主 Renderer 权威状态与独立表面双向同步，浮窗可发送/停止任务、管理会话和图片上下文并收回任一停靠方向，定向双窗口测试完成真实 mock Agent 往返。
- 2026-07-28：完成 Agent 四向停靠与应用内浮动，独立窗口仍待实现；完成自定义模型文案、提示词复制区布局和 resize 零 React 高频提交优化，并新增 16 项纯布局测试与 17 项 Electron 定向 UI 验证。
- 2026-07-28：完成模型感知上下文策略和 Codex 式 checkpoint；修复 Codex 长消息仍被 12K 字符截断的问题，新增 16 项 Runtime checkpoint 专项验证。
- 2026-07-28：创建长程目标文档；开始目标 1/7 的上下文策略系统。
