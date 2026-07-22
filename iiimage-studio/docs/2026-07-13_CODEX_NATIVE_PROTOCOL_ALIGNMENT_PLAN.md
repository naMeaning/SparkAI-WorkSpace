# Codex 原生协议对齐与交付收敛计划

## 目标

IIimage 继续保留右侧项目 Agent、`image_gen`、Experience 和成果画布，但主模型的通用工具调用、Responses 上下文与事件语义以本机 `codex-cli 0.144.1` 为唯一事实来源。任何 Agent 理解或调用失败，先修 Prompt、Schema、原生协议与工具容错，不新增关键词路由、强制 tool choice、synthetic user 或外层搜索重试器。

## 已确认的 Codex 事实

- CLI `--search` 明确启用 Responses 原生 `web_search`，不是普通 function。
- 原生搜索返回 `web_search_call`，动作包含 `search`、`open_page`、`find_in_page`，不需要 IIimage 再请求 Bing 或 DuckDuckGo。
- `view_image` 是本地 function，公开参数只有 `path` 与 `detail=high|original`；回执是 Responses `function_call_output` 中的 `input_image`，由同一个主模型继续观察。
- 当前模型目录中 `gpt-5.5`、`gpt-5.6-sol/terra/luna` 支持图片输入、并行工具调用和搜索；其 shell 类型为 `shell_command`。
- Codex 会保留 reasoning、message、function_call、function_call_output、web_search_call 和 compaction 等 ResponseItem，而不是每轮退化成纯聊天文本。
- Codex 的本地图片输入采用文本边界标签加 `input_image`，图片 detail 默认 high，并支持 original。

## 本轮改造

1. 删除自建网页抓取与 HTML 解析路径；公开工具改为原生 `{ type: "web_search" }`。
2. 将 `command` 收敛为 Codex 命名的 `shell_command`，仍执行 IIimage 项目内只读 allowlist，避免扩大产品权限。
3. 将 `view_image` 改为 `path/detail`，不再另起视觉模型请求；图片以 data URL 的 `input_image` 回到当前工具轮。
4. Responses 请求同时支持原生工具和 custom function，固定 `store=false`、并行工具调用与 encrypted reasoning 回传。
5. 工具轮保留原始 ResponseItem；跨用户轮按项目与会话持久化最近完整协议 turn，图片像素不永久写入协议历史，需要时重新调用 `view_image`。
6. 原生搜索的开始与完成作为两条独立时间线事件，搜索动作不伪装成 function tool result。
7. 清理聊天同时删除 FastMemory、compact summary 和协议历史；新会话/新项目依靠不同 scope 天然隔离。
8. 没有节点被选中时，不显示顶部“当前选中”或输入框“将基于画布”，也不向 Agent 传递画布选择。

## 验收

- `test:agent-protocol`：验证混合工具 Schema、developer role、原始 ResponseItem、图片型 function output、Responses 请求封装。
- `test:agent-text`：验证 `view_image → image_gen → final`、原生 `web_search → image_gen → final`、失败回灌、会话隔离和 Image Gen Schema。
- AIDebug：验证空选择不渲染两处选择提示；单选/多选仍同步高亮、可清除且不会被普通点击破坏。
- 真实 Agent：验证自然搜索、图片观察、命令、Experience、图片生成、compact 后反馈续图，不出现自建搜索 provider、参数纠偏或内部元数据泄漏。
- 基础交付：`build`、`test:bundle`、`test:agent-text-ui`、GUI 与 evidence audit 全部通过。

## 2026-07-13 收敛结果

- 空画布不再是一种伪造的“当前选择”。没有成果节点被选中时，顶部选择提示、输入区“将基于”提示和 Agent 请求中的 `selectedNodeId/selectedNodeIds` 都保持为空；运行时也不会再把 `undefined` 字面量写成节点 ID。
- AIDebug 已删除旧 `canvasSelected` 假设，直接验证“无成果选择 + 两处选择 UI 均不存在”；单选、多选、Ctrl 点选、高亮、普通点击保持选择、显式 X 清除均通过。
- 跨轮 Responses 协议历史会过滤 Experience 的废弃私有参数，避免 `selector/keywords/sourceEntryIds` 等旧元数据重新进入主模型上下文；reasoning、原生搜索和合法函数调用仍按原始 ResponseItem 保存。
- `view_image` 的真实模型链路使用 128×128 有效 PNG 探针验证，图片型 `function_call_output` 已被 New API 接受；2×2 测试图被上游拒绝的问题已归因于测试素材尺寸，而不是协议封装。
- 真实 `web_search` 开始与完成事件保留 `nativeTool/nativeEventType`，AIDebug 能区分 Responses 原生搜索与自定义函数工具。
- 真实 Agent 专项在 `gpt-5.6-sol` 下完成 `shell_command`、Canvas、Experience、`view_image`、原生 `web_search` 和 `image_gen` 六项自主调用，未出现 model-force、强制 tool choice 或参数纠正事件。
- 真实 gpt-image-2 已生成并落盘一张无 AIDebug/SELFTEST/temp/placeholder 污染的 Java 语言娘化主视觉，画布节点、文件像素、提示词折叠块、工具开始/完成卡和最终回复顺序全部通过。
- 上游图片服务可能返回与请求比例不同的真实尺寸；运行时已保存服务实际宽高，标准图片节点底部改为优先显示真实像素尺寸，请求比例仍保留在编辑器中，避免 UI 假装精确命中。

## 本轮证据

- Mock Agent 完整 GUI：`.diagnostics/electron/aidebug-2026-07-13T13-30-31-029Z/report.json`
- 真实 Agent 原生工具：`.diagnostics/electron/aidebug-2026-07-13T13-05-14-038Z/report.json`
- 真实 gpt-image-2 清洁成品：`.diagnostics/electron/aidebug-2026-07-13T13-16-12-274Z/report.json`
- 清洁成品 PNG：`.diagnostics/electron/aidebug-2026-07-13T13-16-12-274Z/config/projects/default/output/imagegen/agent-agent-1783948638339-1-01.png`
- 性能基线：`.diagnostics/electron/aidebug-2026-07-13T13-06-50-311Z/report.json`
- 性能基线无错误；开发态仍记录拖动 p95 27.8ms 与一次 69ms long task，作为下一轮生产性能预算输入，不伪装为生产阈值已完成。
