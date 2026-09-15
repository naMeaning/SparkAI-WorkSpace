# iiimage Studio 1.0.0 发布说明

发布日期：2026-07-17

## 产品形态

1.0.0 收敛为“单一项目 Agent + 成果画布”。Agent 负责理解用户意图并自主调用原生工具；画布只承载图片成果、图片容器、分层 PNG 栈和成果关系，不恢复旧工作流、子 Agent、关键词路由、强制 `tool_choice` 或外层模型参数纠正。

## 核心能力

- `gpt-5.6-sol` 主 Agent 与 `gpt-image-2` 图片执行链路。
- 单图、连续多图、最多 10 张并行独立图片，以及按数量和比例自适应的统一图片容器。
- 参考图生图、元素/主体替换、文案替换、多款设计、服装上身、商品多角度和角色/UI/Logo 设计。
- 真实分层 PNG：同尺寸透明图层、独立节点叠放、展开、一键重组、合并、文件夹导出和 PSD 导出。
- AI 抠图必须先绘制区域并填写描述；AI 重绘使用蒙版，提交后编辑窗口自动退出阻塞态。
- 图片查看、节点编辑、右键另存为、PSD 导出、图片容器归组/拆出、批量导入和项目内统一素材路径。
- 单选、Ctrl 多选、中键框选、Delete/Escape、全选、归组/解组、撤销和方向键等画布快捷操作。
- Prompt、工具 Schema、compact summary 与按项目/会话隔离的 FastMemory 独立维护；新会话和新项目不继承旧 FastMemory。
- Codex 风格原生 `web_search`、`view_image`、`shell_command` 与上下文压缩；图片质检会在同一回合并行查看成图与必要参考图。

## 可靠性与性能

- 图片请求支持 5 分钟长任务超时；普通可恢复错误最多重试 5 次，超时只重试 1 次。
- 画布只保留一个主要动态执行状态，节点与输入区不重复显示“生成中”。
- 1000 个画布成果采用视口投影；500 条对话保留窗口化渲染；1000 次流式增量约 0.54 秒。
- 最终生产性能三轮：工作台就绪约 1.21 秒、渲染启动约 0.77 秒、堆约 22.96 MB、交互 Long Task 最大 54 ms。
- 正式 JS `630,224 / 650,000 B`，CSS `174,637 / 220,000 B`，总构建 `855,423 / 1,000,000 B`；生产包不含 AIDebug 控制面。

## 真实能力证据

- 单图、连续三图、并行十图、混合提示词组、归组/拆出、编辑、PSD 与继续生成：`.diagnostics/electron/aidebug-2026-07-17T08-39-30-805Z/report.json`。
- 六层透明 PNG：`.diagnostics/electron/aidebug-2026-07-17T04-40-30-198Z/report.json`。
- AI 抠图：`.diagnostics/electron/aidebug-2026-07-17T03-08-51-233Z/report.json`。
- AI 重绘：`.diagnostics/electron/aidebug-2026-07-17T03-12-57-321Z/report.json`。
- 商品主体替换：`.diagnostics/electron/aidebug-2026-07-17T08-01-06-820Z/report.json`。
- 商品文案替换：`.diagnostics/electron/aidebug-2026-07-17T08-10-04-862Z/report.json`。
- 服装上身：`.diagnostics/electron/aidebug-2026-07-16T20-15-46-111Z/report.json`。

## 发布物

- Windows x64 安装包：`iiimage-Studio-Setup-1.0.0-x64.exe`
- 大小：113,047,393 字节
- SHA-256：`09e52c1cf6ad7d89c95106b7564a0bcd62b2bf55602242e9d2764da4db547da6`
- Authenticode：`NotSigned`
- 精选案例包：`iiimage-Studio-Showcase-1.0.0.zip`，81,365,519 字节，SHA-256 `ae9174b609e6c6322f98244cdff03d2d01b7fda5bbfa05d28e3b4598b08db784`
- 校验清单：`SHA256SUMS.txt`
- 安装器烟测：`.diagnostics/release/installer-smoke-2026-07-17T09-23-48-402Z/report.json`

## 已知边界

- 只有正面参考图时，背面与不可见结构属于模型推断，不能承诺真实还原。多角度高保真任务应提供正面、侧面和背面参考。
- PSD 已完成内部解析、透明度与像素合成验证；当前测试机没有 Adobe Photoshop，不宣称已通过 Photoshop GUI 实机打开验证。
- 当前安装包未使用商业证书签名，Windows 可能显示发布者未知。
- 上游模型渠道或账号池不可用时，本地重试无法替代外部服务恢复。
