# 2026-07-11 Agent 隔离、工具透明度与图片编辑器推进计划

依据：[AGENT_CANVAS_INTERACTION_PRINCIPLES.md](./AGENT_CANVAS_INTERACTION_PRINCIPLES.md)

## Round 1：数据边界与清理入口

- 审计项目会话持久化、conversation summary、FastMemory scope 和新项目初始化。
- 增加 Agent Header“清理聊天”按钮及确认弹窗。
- 增加 runtime IPC：按当前 `projectId + conversationId` 清除 FastMemory、conversation summary 和会话上下文。
- 新建会话生成全新 ID，不继承 FastMemory；旧会话仍可切回。
- 新建项目始终返回空画布、全新会话 ID 和空会话历史。
- 增加清理、新会话、跨项目隔离专项。

## Round 2：工具时间线与 Prompt 可见性

- 恢复 Brief 内容但不恢复 `Brief` 标签。
- 为 Experience、Image Gen 和其他工具建立统一的人类可读状态映射。
- 屏蔽 `fmem-*`、entry id、内部 target/action 等实现文案。
- 为 Image Gen 增加单 Prompt/多 Prompt 的默认折叠块。
- 同一工具的 start/poll/request 合并为一条执行卡，done/error 另起独立结果卡；既避免轮询重复，也清楚拆开过程与结果。
- 验证模型正文与工具卡能共同存在。

## Round 3：选择稳定与图片自动归组

- 空白画布点击和平移不清除选中；当前选中 X 是主要取消入口。
- 图片内容拖拽与节点窗口拖拽分离。
- 实现单图到单图、单图到容器、容器拖出、容器剩一图自动降级。
- 保证资产路径、Prompt、来源关系、选中高亮和持久化一致。

## Round 4：AI 抠图、AI 重绘与统一编辑器

- 将立即执行的抠图改为先选区、再描述、再提交。
- 抽象 AI 图片局部编辑弹窗骨架，重排画布与要求面板，减少边框。
- 新增统一节点编辑器，并接入双击图片、双击标题和右键菜单。
- 支持编辑 Prompt 后继续生图，不覆盖原成果。

## Round 5：全链路回归

- 更新 `PRODUCT_INTENT.md` 和 AIDebug 断言，删除被本轮覆盖的旧规则。
- 运行静态检查、构建、Agent GUI、拖拽、弹窗、会话隔离、项目隔离、自然语言工具透明度测试。
- 检查截图、溢出、最小宽度、重启持久化和真实模型调用。
- 修复全部有效失败后再标记 Goal 完成。

## 进度记录

- [x] 建立本轮总方针与执行计划。
- [x] Round 1 完成并回归：清理聊天、新会话、新项目均通过真实 UI 与 FastMemory scope 隔离验证。
- [x] Round 2 完成并回归：Brief、Experience 友好回执、Image Gen 单/多 Prompt 折叠和同一工具调用去重通过 mock 与真实 Agent 验证。
- [x] Round 3 完成并回归：空白平移保留选择；单图自动归组只更新 `layoutGroups`，来源节点与生成因果保持不变；容器剩一图自动解组和持久化通过图片集合专项。
- [x] Round 4 完成并回归：AI 抠图先选区、AI 重绘、双击图片/标题、右键编辑成果、统一扁平编辑器和窄窗布局通过专项。
- [x] Round 5 完成并交付：静态检查、生产构建、Agent GUI、真实 Agent 工具调用及全部专项无有效失败。

## 最终验证

- `node --check agent-runtime.cjs electron-main.cjs scripts/aidebug-gui.mjs scripts/aidebug-human-suite.mjs`
- `pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters`
- `pnpm run build`
- Agent UI 全套（含工具执行/完成拆分）：`.diagnostics/electron/aidebug-2026-07-11T14-32-55-452Z/report.json`
- AI 抠图：`.diagnostics/electron/aidebug-2026-07-11T14-20-40-951Z/report.json`
- AI 重绘与节点编辑器：`.diagnostics/electron/aidebug-2026-07-11T14-23-19-548Z/report.json`
- 图片组、单图归组与自动降级：`.diagnostics/electron/aidebug-2026-07-11T14-23-47-832Z/report.json`
- 真实 `gpt-5.6-sol` Agent 工具调用：`.diagnostics/electron/aidebug-2026-07-11T14-28-22-254Z/report.json`
