# Java 生图时间线、多图容器与成果连线整改计划

更新时间：2026-07-11

## 本轮准确问题

1. 模型流式正文已经显示后，`assistant-message` 结束事件又创建普通时间线消息，导致 Java 生图前置说明重复。
2. 真实会话 `project-mrggz2em-usqstr` 的 `image_gen.items` 包含有效 Java Prompt 和 `temp` 占位项；占位项被真实提交并生成图片，随后污染图片组、标题和画布节点。
3. Brief 虽然恢复，但与工具卡内容挤在同一边框中，层级不清楚。
4. Agent 批量图片组与用户图片容器视觉割裂，2-10 张图片没有根据数量采用最优直接展示尺寸。
5. 成果连线缺少连接头和方向头；同一来源的多条曲线共用控制路线，容易重叠或冲突。

## 实施方针

- 流式正文是唯一正文来源；结束事件只负责收束状态，不再创建同文案时间线。
- 在工具开始事件之前清洗批量 items，并在运行时归一化阶段再次清洗；下游只使用 `batchItems`。
- Brief 作为工具卡外的普通说明，Prompt 仍留在工具执行卡内的折叠块中；完成卡继续独立显示。
- 批量结果保留 `imageCollection` 元数据，但渲染使用统一的图片容器网格、数量自适应尺寸和可拖出单图能力。
- 连接头只编辑 `parentId/relationType` 溯源关系，不恢复工作流执行。加入拖拽预览、循环阻止和重复阻止；线路保持旧版无箭头的单段贝塞尔样式。

## 验收清单

- Java 前置说明只显示一次。
- `temp` 不出现在执行卡 Prompt、真实生图请求、图片资产、标题或新节点中。
- Brief 位于工具卡边框外，工具开始卡与完成卡分离。
- 2、3、4、6、9、10 张批量成果的容器尺寸和网格均无裁切、挤压、溢出。
- 每个图片成果显示输入/输出连接头；输出拖到输入可建立关系，重复、自己连接和循环连接不会产生边。
- 同源多分支轻微错层；不显示箭头，不做障碍物避让，节点与线路按画布层级自然遮挡。
- TypeScript、构建、GUI 基线、图片容器专项和真实 Agent 工具链全部通过。

## 最终验证结果

- 静态检查：`node --check agent-runtime.cjs`、AIDebug 脚本语法检查、TypeScript `--noEmit --noUnusedLocals --noUnusedParameters` 全部通过。
- 构建：`pnpm run build` 通过。
- Agent UI、Brief、连接头与真实 Pointer 拖线：`.diagnostics/electron/aidebug-2026-07-11T15-10-20-415Z/report.json` 通过。
- 自适应多图容器、连续三图、并行十图、不同 Prompt 图片组、拖出、续图、归组和降级：`.diagnostics/electron/aidebug-2026-07-11T15-09-52-075Z/report.json` 通过。
- 真实 `gpt-5.6-sol` Java 请求、单有效 item、零占位项、零参数修正：`.diagnostics/electron/aidebug-2026-07-11T15-21-40-819Z/report.json` 通过。
- 真实 `gpt-image-2` Java 主视觉生成并落盘：`.diagnostics/electron/aidebug-2026-07-11T15-23-19-877Z/report.json` 通过。
- 最终时间线顺序“说明 → 工具执行 → 工具完成 → 最终回复”和窄窗口 UI：`.diagnostics/electron/aidebug-2026-07-11T15-42-35-296Z/report.json` 通过。

## 旧版连接点与线路二次迁移（2026-07-12）

- 以 Git 历史 `8c042f46` 为交互基准，恢复窗口级 Pointer 拖线、拖到节点本体命中、4px 拖动阈值、输出单击断开、输入单击断开、连接态绿色、hover/active/resize 淡入放大和端口遮挡隐藏。
- 继续只修改 `parentId/relationType` 成果溯源，不恢复任何工作流执行或 Agent 子节点语义。
- 线路恢复旧版 3px、0.7 默认透明度与选中后 `edge-flow 0.8s` 流动动画；不显示额外方向箭头，与旧版保持一致。
- 所有关系线采用旧版中点单段贝塞尔曲线；同源多线只做轻微错层。线路不做障碍物避让，也不添加箭头，节点通过自身层级自然遮挡线路。
- AIDebug 新增真实窗口级 Pointer 拖到节点本体、输入/输出断开、循环阻止、连接态、遮挡隐藏、旧版单段线型/动画和无箭头断言。
- 修复最终样式层将 `.flow-node.selected` 覆盖为 `outline: 0` 的问题；单选、多选和画布平移后的保留选择均显示持续的实色外圈、间隔与柔和光晕，同时保留节点左侧状态色。
- 最终严格 TypeScript、正式构建与 Agent GUI 全量专项通过：`.diagnostics/electron/aidebug-2026-07-11T17-11-37-902Z/report.json`，失败项为 0；旧版无箭头线路和选中节点可见高亮断言均通过。
