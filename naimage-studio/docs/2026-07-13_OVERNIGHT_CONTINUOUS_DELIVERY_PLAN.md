# iiimage Studio 持续交付计划

更新时间：2026-07-13

## 1. 本轮目标

本轮继续把 iiimage Studio 收束为一个以右侧 Agent 为唯一智能入口、以无限画布呈现和整理图片成果的桌面工作台。成功标准不是增加更多模式按钮，而是让以下链路可靠闭环：

`自然语言 / 参考图 / 当前选中 → Agent 原生判断 → Tool Schema → 工具执行 → 项目资产落盘 → 画布呈现与关系 → 编辑、归组、导出 → 重启恢复 → AIDebug 证据`

持续执行，不把单次“测试全绿”当成交付。每一轮都要重新检查因果关系、真实手势、截图、性能、项目隔离和失败边界。

## 2. 不可破坏的产品原则

1. Agent 自己理解任务和选择工具；不增加关键词路由、强制 tool choice、synthetic user 修正、隐藏参数改写或无限重试层。
2. 参数失败优先修公开 Schema、Prompt 说明和工具的无损规范化。等价输入应被兼容，只有存在真实歧义或会改变用户意图时才返回模型内部错误。
3. 系统预检、内部 ID、路径、缓存策略和 fastmemory 写入标识不进入用户时间线。用户只看到 Agent 的简短说明、独立工具调用、折叠 Prompt 和独立完成/失败结果。
4. 画布不是手动工作流编辑器。节点只代表图片成果、图片容器、独立 PNG 图层及其来源关系。
5. AIDebug 是产品感官。复杂交互先补可观测性，再改产品；不能用内部函数成功或旧报告代替真实手势和截图。
6. UI 修改必须进入统一组件、Token 和 Surface 规范；禁止在样式表尾部为单个截图继续叠加不可追溯覆盖。

## 3. 当前已确认基线

- 画布 pan 使用瞬时 DOM transform，松手后才提交 React 状态；Agent feed 与 composer 在画布交互期间保持各 1 次提交。
- 最新性能报告：`.diagnostics/electron/aidebug-2026-07-13T00-12-19-336Z/report.json`。
  - 200 节点运行时完整保留，视口挂载 57 个节点。
  - 画布交互提交由历史 99 次降到 39 次；Agent feed / composer 均为 1 次。
  - pan p95 14ms，zoom p95 34.6ms，drag p95 20.8ms。
  - 10 张 4K PNG/JPEG/WebP 冷缓存最大并发 2，热缓存 10/10 命中，画布为 512×288 thumbnail，查看器主图为 original。
- 图片集合回归：`.diagnostics/electron/aidebug-2026-07-13T00-12-57-923Z/report.json`，0 failure。
- 分层 PNG 回归：`.diagnostics/electron/aidebug-2026-07-13T00-18-36-516Z/report.json`，0 failure。AIDebug 现在必须等待 700ms 归位动画结束、六个独立节点真正共享稳定画板后才允许通过。
- Agent 文本与工具链自测已覆盖：单图 items 兼容、placeholder 过滤、原生多工具循环、失败 role=tool 回传、不同参数调用允许、精确重复阻断、参考图 role/purpose、容器 assetIndex、画布上下文预算和项目隔离。
- 普通图片单图层 PSD、分层 PSD、文件夹和合成 PNG 已具备结构/像素自测；尚无 Adobe Photoshop GUI 打开证据。

## 4. 连续推进顺序

### Round A：异步导入与项目资产安全

- 将目录扫描、真实格式识别、流式 SHA-256、复制和去重全部移出 Electron 主线程。
- 输入顺序稳定；PNG/JPEG/WebP 使用魔数与真实解码校验；拒绝损坏文件、symlink、junction 及任意符号链接路径层级。
- 统一复制到当前项目资产库，永不直接修改用户原图。
- 未知 `projectId` 必须拒绝，禁止回退到当前活动项目。
- 聊天区拖入进入参考图容器；画布多图拖入进入图片容器；分层 PNG 成员不得误入普通容器。
- 建立 500 文件导入、取消、关闭、staging 清理和 UI 响应证据。

### Round B：性能真实性契约 v2

- 增加 1000 节点、500 条消息、1000 次流式 delta、50 次工具事件。
- 分阶段记录 Canvas / Agent feed / composer commit、Long Task、heap 和清理后 heap。
- 保存链路记录请求数、真实磁盘写入数、合并写入数和 flush 时间。
- 当前 development + full AIDebug 只作为诊断数据；再建立 production-like 最小只读性能 bridge，正式包继续禁止完整控制面。
- zoom p95 和 drag p95 仍高于一帧预算，只有在真实对比证明改善且没有 GPU/内存回归时才接受优化。

### Round C：UI Surface 与动效收束

- 统一登录、设置、模型选择、Prompt 编辑、FastMemory 编辑、成果编辑、独立图层编辑、图片查看器、图层查看器、AI 重绘、AI 抠图和确认框。
- 审查中英混排、冗余 eyebrow、内部说明、空白区域、按钮优先级、Footer 密度、窄窗口裁切、滚轮/resize 冲突和焦点恢复。
- 工具调用与工具完成保持独立时间线项；Image Gen Prompt 默认折叠；Brief 只显示正文，不显示 `Brief` 标签；内部预检和 memory ID 永不显示。
- 动效只用于跟手、吸附、归组、拆组、图层归位和状态反馈；支持 reduced-motion，禁止持续高成本装饰。

### Round D：Agent 原生能力与工具参数

- 继续删除外层终止、跳过、硬编码收尾和 synthetic user 纠错策略。
- Tool result 后回到原生模型循环，由 Agent 决定继续观察、搜索、记录经验、生图或回复。
- Image Gen 保持：单图顶层 prompt；相同要求多版使用 count；不同要求多图使用 2–10 个有效 items；分层只用 layers；区域任务必须有来源和用户区域。
- 将真实失败按可行动类别返回模型，不在前端展示内部校验；参数安全等价形式在工具层规范化。
- 验证 compact、长会话、清理聊天、新会话、新项目和 FastMemory 范围隔离。

### Round E：电商任务闭环

不为行业词增加独立功能岛，使用同一组图片原语组合完成：

- 商品单图与同提示词多版挑选。
- 商品正面、侧面、背面、细节等多角度系列。
- 商品主体置换、背景置换、文案置换和多市场语言版式。
- 服装上身与模特图，分别保护服装细节、人物一致性、姿态和场景。
- 实物图转宣传图、SKU 图案裂变、平台比例适配。
- UI/直播切片的独立透明 PNG 图层、展开/重组、文件夹、PSD 和合成图。

每类验收都必须同时检查参考图路径、Prompt、数量、容器布局、来源关系、继续编辑、另存为、PSD、项目重启恢复和失败回退。外部市场调研在没有实际浏览证据前保持为待完成，不把主观判断写成用户数据。

## 5. 每轮硬门

1. 专项自测、`tsc --noEmit`、生产 build、bundle 预算和 `git diff --check`。
2. 相关 Electron AIDebug GUI 套件与独立 evidence audit。
3. 真实文件哈希、alpha、尺寸、项目路径、revision、staging 和导出读回证据。
4. 人工查看关键截图；自动几何通过不能替代排版和审美判断。
5. GUI 运行时冻结源码，避免 HMR 污染报告。
6. 不回滚、不 reset、不清理用户或历史模型留下的无关工作树改动。

## 6. 阶段完成定义

只有在核心图片任务、Agent 原生调用、画布手势、图片/图层容器、导出、项目隔离、UI、性能和证据同时闭环时，才进入人工交付验证。单项全绿、单张截图正常或某个功能“可以运行”都不等于完成。

## 7. 实际推进记录

### 异步图片导入闭环

- `image-import.cjs` / `image-import-worker.cjs` 已接入 Electron、preload、前端拖入和 AIDebug，不再是未接线模块。
- 真实报告：`.diagnostics/electron/aidebug-2026-07-13T00-31-13-721Z/report.json`。
- 500/500 张图片在独立进程完成入库，默认最大文件并发 4，耗时约 958ms；renderer 期间 119 次定时器 tick、138 帧，最大间隔 9.9ms。
- 运行中取消得到 `IMAGE_IMPORT_CLOSED`，Importer 自动重建，随后单图导入成功；staging 无残留。
- 未知项目拒绝；项目切换后的迟到结果不加入新画布。
- 画布两图进入普通图片容器，聊天两图进入参考图容器；向分层 PNG 节点拖入普通图片时另建容器，原六个图层、资产和组信息完全不变。
- 原图片集合 8 个真实场景回归报告：`.diagnostics/electron/aidebug-2026-07-13T00-32-24-058Z/report.json`，0 error / 0 warning。

### Agent 抠图参数方向修正

- `image_gen(operation=cutout)` 现在原生请求 `outputFormat=png + background=transparent`，不再先让 Image 2 输出不透明背景后依赖外层算法完成主体工作。
- 前端连通背景处理只保留为兼容与透明度质量校验；已有可靠 alpha 时直接保留原生透明像素。
- Agent 工具自测增加来源图、mask、透明背景和 PNG 参数透传硬门。

### Surface、工具时间线与图片集合收束

- 图片集合最新专项：`.diagnostics/electron/aidebug-2026-07-13T01-56-58-616Z/report.json`，8 个场景、0 error / 0 warning；覆盖单图、连续系列、十图批量组、图片查看器、普通成果编辑器、884 宽度和拖出/归组回归。
- AIDebug 图片查看器关闭已统一使用 `data-ui-surface="image-viewer"`，并新增公开副标题检查；副标题改为“图片 n/总数 · 尺寸”，不再展示内部节点 ID。
- 实时工具 trace、最终回复和历史消息共用同一套内部 metadata 消毒；Experience 的 `fmem-*`、entry id、selector 等不会在实时 brief/error 边界泄漏。
- 模型流式正文与工具 Brief 只在同 run、空白规范化后完全相同时去重；工具完成与极短 final answer 也只做同 run 精确去重，不改 Agent 决策。
- 伪 `Parallel` 聚合器不再单独产生只有 start 没有 done 的工具卡；真实并行工具各自保留独立 start/result 生命周期。
- Style Library、Frame Picker、Card Wizard 已确认无活跃产品组件，遗留 CSS 与浮窗注册删除；CSS 一次减少约 34KB，Reduced Motion fixture 改为专用测试类。
- Settings Drawer 已迁移到共享 DrawerShell/SurfaceHeader/SurfaceBody/ActionButton，884×720 焦点圈定、Escape、焦点恢复和模型按钮排版通过；对应旧 CSS 再减少约 10KB。
- Account Drawer 已迁移到同一 DrawerShell；账户概览、三列余额、充值/退出、日志分页、busy 关闭门禁和焦点恢复通过。退出登录后只保留唯一的登录壳，登录/注册、输入框和错误态样式完整；报告 `.diagnostics/electron/agent-text-ui-2026-07-13T02-49-16-648Z/report.json`。

### 性能真值与时间线分区

- 最新权威开发态报告：`.diagnostics/electron/aidebug-2026-07-13T02-45-39-651Z/report.json`。
- session 保存观测已补齐：9 次触发、8 次防抖合并、1 次真实提交、pending=0、failed=0、平均 flush 约 13.6ms；严格审计 `knownGaps=[]`、`truthContractReady=true`。
- Agent Feed / Composer 已拆成独立 memo 分区；500 消息输入约 11–19ms，1000 delta 时 Composer commit 为 0。
- 无 Markdown 语法消息使用纯文本快路径，500 消息构建约 103.5ms；Markdown、代码、链接和表格仍走完整渲染。
- 自动贴底现在在 commit、下一帧、80ms 和 240ms 四个时点收口，1000 delta 最终正文、状态、单消息和底部间距均通过。
- 画布 stage 使用 `translate3d` 与明确 transform 合成层，zoom p95 从约 34.7ms 降至约 7.1ms。
- 严格 warning 从 9 条降至 2 条；development baseline 产品阈值和最大约 104ms Long Task 继续保留为真实优化方向。
- 普通节点拖动已改为“帧内同步更新节点与受影响连线、松手一次提交真实状态”；Canvas commit 从 39 降到 4，drag p95 从 34.6ms 降到 7.1ms。最新报告 `.diagnostics/electron/aidebug-2026-07-13T03-42-40-552Z/report.json`，随后 Agent-only 20 场景回归 `.diagnostics/electron/aidebug-2026-07-13T03-43-21-243Z/report.json` 与独立 audit 全绿。

### 真实 Agent 与 Image 2 链路

- 主 Agent 运行时已移除 command / Experience / Web Search / Image Gen 的关键词兜底路由，以及 model-force、强制 tool choice、参数纠偏和 synthetic user 修正路径；主循环保持 `tool_choice=auto`，工具结果以原生 tool role 返回模型。
- 真实工具专项 `.diagnostics/electron/aidebug-2026-07-13T03-55-39-815Z/report.json`：`gpt-5.6-sol` 自主调用 command、画布查询和 Experience，工具完成后继续第二轮模型，两个真实窗口场景与独立 audit 均为 0 error / 0 warning。
- 真实图片专项 `.diagnostics/electron/aidebug-2026-07-13T03-56-38-835Z/report.json`：同一 Agent 自主调用 `gpt-image-2`，成功输出 9:16、2K、高质量 PNG Java 语言娘化主视觉；单图没有 `items`/temp 占位，图片同步到画布，工具开始/完成分离，文件和截图像素证据通过。
- 可复用样图归档到 `showcase/real-image2/2026-07-13-java-language-visual.png`，不混入用户原图或临时 fixture。
