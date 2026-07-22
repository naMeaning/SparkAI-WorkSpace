# Real Image 2 Showcase

## Java 语言娘化主视觉

- 文件：
  - `2026-07-13-java-language-visual.png`
  - `2026-07-14-java-language-visual-v2.png`
  - `2026-07-14-java-language-visual-v3.png`
  - `2026-07-14-java-language-visual-v4.png`
  - `2026-07-16-java-language-visual-v5.png`
- 生成时间：2026-07-13 至 2026-07-14
- Agent 模型：`gpt-5.6-sol`
- 图片模型：`gpt-image-2`
- 参数：`9:16`、`2K`、`PNG`、`high`
- 任务：成年二次元女性、极近景冲出屏幕构图，融合 JVM、字节码、咖啡热流与跨平台意象，避免兽耳。
- 真实报告：`.diagnostics/electron/aidebug-2026-07-13T03-56-38-835Z/report.json`
- 结果：Agent 自主完成 command、画布查询、Experience 与 Image Gen；无 force tool choice、参数纠偏或 synthetic user；GUI 与独立 evidence audit 均为 0 error / 0 warning。
- v2 报告：`.diagnostics/electron/aidebug-2026-07-13T19-33-51-049Z/report.json`，真实 Image 2 生成与画布落地成功，并暴露出大图 `view_image` 回传后的 413。
- v3 报告：`.diagnostics/electron/aidebug-2026-07-13T19-43-58-223Z/real-agent-suite.json`，修复后完整完成 `gpt-5.6-sol → image_gen → gpt-image-2 → view_image → gpt-5.6-sol` 审图闭环；生图专项本体成功，随后 884px 截图控制问题也已在独立复验中修复。
- v4 报告：`.diagnostics/electron/aidebug-2026-07-14T00-14-47-287Z/report.json`，真实 `gpt-5.6-sol` 自主完成 command、workflow、experience、原生 web search、`image_gen`、真实 `gpt-image-2` 和 `view_image` 质检；提示词未泄漏 nonce、路径或内部 ID，GUI 与 evidence audit 为 `0 error / 0 warning`。文件实际尺寸为 `864x1821`，已记录为后续严格比例审计样本。
- v5 报告：`.diagnostics/electron/aidebug-2026-07-16T11-33-34-140Z/report.json`，真实 `gpt-5.6-sol` 从聊天入口自主完成 `shell_command`、画布查询、Experience、`view_image`、原生 Web Search 与 `image_gen`，六步均未触发 force tool choice 或参数纠偏；真实 `gpt-image-2` 成果为 `1152x2048` PNG，GUI 与 evidence audit 均为 `0 error / 0 warning`。

## 东方青瓷香水跨境电商系列

- 文件：
  - `2026-07-16-celadon-perfume-real-hero.png`
  - `2026-07-16-celadon-perfume-cold-landscape.png`
  - `2026-07-16-celadon-perfume-warm-sunset.png`
  - `2026-07-16-celadon-perfume-minimal-studio.png`
- Agent 模型：`gpt-5.6-sol`
- 图片模型：`gpt-image-2`
- 参数：`4:5`、`2K`、`PNG`、`high`、不透明背景。
- 任务：先生成一张克制的东方青瓷香水跨境电商主视觉，再由 Agent 基于首图自主并行规划冷青山水、暖玉夕照、极简棚拍三张独立完整变体，并在生成后使用 `view_image` 审核。
- 真实报告：`.diagnostics/electron/aidebug-2026-07-16T06-11-28-788Z/report.json`。
- 结果：首图与三张变体均为独立文件，最终画布保持一个标准单图节点和一个三图容器节点；工具调用、图片落地、Agent 审图、像素证据与 GUI 证据均通过。

## 2026-07-17 跨领域真实案例

- NOVA FORGE Logo：`2026-07-17-nova-forge-logo-base.png`、`-negative-space.png`、`-emblem.png`、`-wordmark.png`；真实报告 `.diagnostics/electron/aidebug-2026-07-16T19-31-20-335Z/report.json`。
- AI 素材管理 UI：`2026-07-17-ai-asset-ui-base.png`、`-compact.png`、`-creator.png`、`-enterprise.png`；真实报告 `.diagnostics/electron/aidebug-2026-07-16T19-42-06-994Z/report.json`。
- 服装上身：`2026-07-17-garment-try-on-crane-jacket.png`；真实报告 `.diagnostics/electron/aidebug-2026-07-16T20-15-46-111Z/report.json`，验证 `identity + garment + inputFidelity=high`。
- 东方游戏角色设定表：`2026-07-17-eastern-game-character-sheet.png`；真实报告 `.diagnostics/electron/aidebug-2026-07-16T20-23-47-123Z/report.json`。
- 青瓷香水 4:5 4K 修正版：`2026-07-17-celadon-perfume-4x5-4k-refined.png`，实际 `2576×3216`；真实报告 `.diagnostics/electron/aidebug-2026-07-16T21-14-40-717Z/report.json`。
- 东方未来都市极近景微海报：`2026-07-17-eastern-future-closeup-poster.png`，实际 `1280×1920`；真实报告 `.diagnostics/electron/aidebug-2026-07-16T21-53-23-296Z/report.json`，`targetAspectRatio=0.6667`、`outputRatioOk=true`。

以上案例都由 `gpt-5.6-sol` 在 `tool_choice=auto` 下自主调用 `gpt-image-2`，成果真实落盘并进入画布；图片复核默认使用受控的 `view_image detail=high`，不把 mock、参考图或临时夹具列为正式成果。

该目录只保存经过真实模型生成并通过像素/文件/GUI 证据验证的可复用样图，不放用户原图或临时 fixture。
