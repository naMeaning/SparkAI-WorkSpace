# 2026-07-16 Image 2 真实能力交付审计

## 审计原则

- `mock-agent` 与本地图片夹具用于稳定回归，不得替代真实 `gpt-image-2` 能力证据。
- 真实能力必须同时证明：请求参数、上游执行、项目文件落盘、画布成果提交、关系与 UI 闭环。
- Agent 自主调用必须保持 `tool_choice=auto`，不得通过关键词路由、强制工具或参数纠正获得绿灯。
- 图片生成结束后，动态状态只在右侧 Agent 时间线出现；画布仅保留静态占位和必要终态。

## 当前证据矩阵

| 能力 | 当前真实证据 | 结论 | 后续动作 |
| --- | --- | --- | --- |
| 单张生成 + Agent 自主调用 + View Image 复核 | `.diagnostics/electron/aidebug-2026-07-16T11-33-34-140Z/report.json` | 已充分 | 后续改动后复验一次 |
| 连续生成三张独立变体 | `.diagnostics/electron/aidebug-2026-07-16T06-11-28-788Z/report.json` | 已充分 | 保留父级、variant 与多资产断言 |
| 十张并行生成 | `.diagnostics/electron/aidebug-2026-07-17T08-39-30-805Z/report.json` | 已充分 | 真实单图、连续三图、十图并行、混合提示词组、拖出、归组、编辑、PSD 与继续生成均通过 |
| 图片容器归组、拆出、另存为、继续生成 | `.diagnostics/electron/aidebug-2026-07-16T12-01-26-278Z/report.json` | UI/数据闭环已充分 | 与真实十图结果联合复验 |
| 分层 PNG | `.diagnostics/electron/aidebug-2026-07-17T04-40-30-198Z/report.json` | 已充分 | 真实六层同尺寸 PNG、透明层、独立节点叠放、展开/重组、合并与 PSD 闭环通过 |
| AI 抠图 | `.diagnostics/electron/aidebug-2026-07-17T03-08-51-233Z/report.json` | 已充分 | 先绘制区域再执行、真实 alpha、来源关系与独立视觉审计通过 |
| AI 重绘 | `.diagnostics/electron/aidebug-2026-07-17T03-12-57-321Z/report.json` | 已充分 | 真实蒙版、窗口自动退出阻塞态、成果提交与独立视觉审计通过 |
| 多款设计 / variants | `.diagnostics/electron/aidebug-2026-07-16T17-18-57-270Z/electron.log`；`showcase/real-image2/2026-07-17-day-night-tea-perfume-*.png` | 已充分 | 已完成同一商品的水墨、几何、夜色三款并行设计与逐张 View Image 复核 |
| 电商商品主视觉 | `showcase/real-image2/2026-07-17-day-night-tea-perfume-hero.png` 及三款衍生成果 | 已充分 | 商品、标签与材质保持一致，三款版式方向明确 |
| Logo 概念与多版 | `.diagnostics/electron/aidebug-2026-07-16T19-31-20-335Z/report.json` | 已充分 | 基础标志、负形、徽章与横向字标均为独立文件；文字准确，缩小辨识度与系列身份稳定 |
| UI 视觉与多版 | `.diagnostics/electron/aidebug-2026-07-16T19-42-06-994Z/report.json` | 已充分 | 生成基础界面及紧凑专业、创作者友好、企业克制三套 16:9 独立完整方案，逐张 `view_image detail=high` 成功 |
| 服装上身 | `.diagnostics/electron/aidebug-2026-07-16T20-15-46-111Z/report.json` | 已充分 | 模特身份、姿态、背景、鞋、夹克材质、滚边、拉链、仙鹤刺绣和袖条纹均得到高保真保持 |
| 角色定制 / 游戏设定表 | `.diagnostics/electron/aidebug-2026-07-16T20-23-47-123Z/report.json` | 已充分 | 正面、侧面、背面和两种面部视图保持同一角色，可作为专业角色设定表使用 |
| 商品多角度 | `.diagnostics/electron/aidebug-2026-07-17T08-17-33-866Z/report.json` | 链路完成、质量边界已明确 | Agent 首批质检后只修正一次；顶部俯视和左前角改善，但单张正面参考不能证明真实背面，所谓右后 135° 仍偏右前，因此该报告不列为绿色质量证据 |
| 非方形 4K 交付 | `.diagnostics/electron/aidebug-2026-07-16T21-14-40-717Z/report.json`；`.diagnostics/electron/aidebug-2026-07-16T21-53-23-296Z/report.json` | 已充分 | `4:5 / 4K` 实际输出 `2576×3216`；修复后专项的 `2:3 / 1080P` 实际输出 `1280×1920`，`targetAspectRatio=0.6667`、`outputRatioOk=true` |
| 元素 / 主体替换 | `.diagnostics/electron/aidebug-2026-07-17T08-01-06-820Z/report.json` | 已充分 | 自主 `replace → 同轮并行查看成图/底图/商品参考 → 最终回答`，4K 结果与画布关系通过 |
| 文案替换 | `.diagnostics/electron/aidebug-2026-07-17T08-10-04-862Z/report.json` | 已充分 | 成图真实显示“青岚 / 山水香氛”，商品和场景保持稳定 |
| PSD 导出 | 本地 PSD 自测、分层专项与临时源隔离已通过 | 本地能力充分 | 用真实分层成果导出并解析回读 |

## 本轮新收敛

- 4–10 张混合比例图片不再仅交替极值并使用等高行；现在相近比例进入同一比较行，行高按代表比例加权。
- 六图混合比例 GUI 实测顺序为 `0,1,2,5,4,3`，竖图行 249px、横图行 91px；十张同尺寸仍保持稳定 5×2。
- 生成中的画布节点取消 `active-build` 与 `is-generating` 执行态视觉，只保留静态占位。
- AIDebug 同时检查画布动态文案和执行态视觉残留；两者必须为零。
- AI 抠图、AI 重绘专项已支持真实图片模式的 5 分钟级执行等待，报告显式记录 `liveImage`，避免把 mock 结果误认成真实证据。

## 真实验证顺序

1. AI 抠图：成本和链路最小，先验证真实透明 alpha。
2. AI 重绘：复用单张来源图，验证真实蒙版与编辑请求。
3. 分层 PNG：验证多次图片请求、透明层修复、重组、导出与回读。
4. 十张并行：验证服务器压力、失败恢复、容器排版、提交延迟和时间线唯一性。
5. 电商替换与多款：以真实商品图完成主体替换和三款独立设计，作为交付体验样例。

上述真实证据已经完成；正式发布仍以最终生产门禁、安装器复验和 Forge 推送为结束条件。

## 2026-07-17 真实电商体验推进

- 使用真实 `gpt-5.6-sol + gpt-image-2` 生成「昼夜茶事」东方茶香香水 3:4 主视觉；图片真实落盘后进入画布。
- 在原成果上下文中，Agent 自主以 `operation=variants`、`count=3`、`generationMode=parallel` 生成水墨留白、现代几何、夜色霓虹三个独立版本，没有关键词路由、强制 `tool_choice` 或外层参数改写。
- 三张并行成果完成后，Agent 分别调用三次 `view_image detail=original`，再给出商品一致性、标签、版式差异、主体清晰度与审美结论。
- 人工查看四张原图确认：均为清晰 3:4 商业成品；瓶型、琥珀色液体与「昼夜茶事 / 东方茶香」标签识别保持一致，三个衍生方向区分明确。
- 首次自动序列在首图完成后的复核阶段遇到号池 `auth_unavailable`；号池恢复后直接沿用首图与会话继续三款任务，没有重复生成首图。该外部故障不影响四个真实图片文件，但原自动报告保留失败状态，避免把恢复前的报告伪装成全绿。

真实成果：

- `showcase/real-image2/2026-07-17-day-night-tea-perfume-hero.png`
- `showcase/real-image2/2026-07-17-day-night-tea-perfume-ink.png`
- `showcase/real-image2/2026-07-17-day-night-tea-perfume-geometric.png`
- `showcase/real-image2/2026-07-17-day-night-tea-perfume-neon.png`

## AIDebug keep-open 根因修复

- 真实三款任务在图片和 View Image 都完成后，最终 Markdown 回答触发懒加载；旧 `--keep-open` 只保留 Electron，却在 `finally` 中关闭 Vite，导致 `src/markdown.tsx` 动态导入失败并触发主 UI ErrorBoundary。
- `scripts/aidebug-gui.mjs` 现已把 Electron 与 Vite 作为同一 keep-open 生命周期管理：只有非 keep-open 运行才同时关闭两者。
- 针对性复验 `.diagnostics/electron/aidebug-2026-07-16T17-39-06-854Z/report.json` 通过；套件结束后 5173 与 9343 继续监听，后续真实输入保持 `agentStatus=idle`，日志无动态导入或主 UI 错误。

## 2026-07-17 跨领域真实 Agent 收敛

- 所有专项均从真实聊天输入进入 `gpt-5.6-sol`，保持 `tool_choice=auto`，由模型自行选择 `image_gen`、`view_image` 与参考图角色；没有关键词路由、强制工具、synthetic user 或外层参数纠正。
- Logo 专项生成一个基础方案和三个独立方向；UI 专项生成一套基础界面和三个独立产品方向，验证了同一底层图片容器、父级关系、独立提示词和多图复核。
- 服装上身专项把模特图标记为 `edit_target + identity`，把夹克图标记为 `garment`，并使用 `inputFidelity=high`；结果证明参考图角色和“只改变目标变量”契约有效。
- 角色设定表专项证明同一 Agent 能把角色身份、服装结构、配色和标志性道具保持到多视图成品，而不需要新增角色工作流或领域按钮。
- 商品多角度专项暴露“商品一致但机位差异不够明显”的审美问题。Prompt contract 已升级到 v10：每个角度项必须给出方位角、俯仰角、应显露的侧面/顶部结构和投影变化；同一回合并行比较成图与必要参考图，质检后只允许修正一次；单正面参考不能证明背面时必须说明推断边界。
- 三张并行 `view_image` 曾因全部使用 `detail=original` 触发 New API 413。现改为常规质检默认 `detail=high`，同轮原始图片总预算 1.2 MB，`original` 只保留给单张原生像素检查；三图 UI 专项已证明修复有效。
- 同一 Agent 运行中的同种非图片工具现在共享一组可见开始/完成状态。并行三图复核不再显示三组 `View Image` 卡片；Image Gen 的 Brief、折叠提示词和完成结果仍保持独立。

## 最终比例与视觉证据

- 修复前，Image 2 的像素上限会使 `4:5 + 4K` 退化为方形。`normalizeImage2Size()` 现在先保留目标比例，再在像素上限内求最大交付尺寸；上游继续使用稳定支持的源尺寸，最终资产按用户比例交付。
- `.diagnostics/electron/aidebug-2026-07-16T21-14-40-717Z` 生成两张真实 `2576×3216` 4:5 文件，第二张是 Agent 视觉复核后的原生自我修正。
- `.diagnostics/electron/aidebug-2026-07-16T21-53-23-296Z` 是解析器修复后的最终廉价专项：模型原生传入 `ratio=2:3`、`resolution=1080P`、`count=1`，落盘 `1280×1920`，完成 View Image 复核，报告同时记录非零 `targetAspectRatio` 与 `outputRatioOk=true`。
- 最终专项成品已归档为 `showcase/real-image2/2026-07-17-eastern-future-closeup-poster.png`；人物为真正极近景，设计动势集中，无兽耳、粒子堆砌、可读伪文字或中景偏差。

## 成果归档

- 新增 `pnpm run archive:images`，只收录正式项目图片输出、`showcase`，以及报告明确标记 `liveImage=true` 的真实诊断运行。
- 导入参考图与 mock 夹具不进入归档；源文件只复制、不移动，按 SHA-256 去重并记录全部来源路径。
- 桌面 `C:\Users\29488\Desktop\IMAGE` 已于 2026-07-17 最终重建，当前归档 280 张、435,224,808 字节：`final-posters` 33 张、`historical` 174 张、`layered` 73 张；清单与实际图片数量一致。
- `manifest.json` 提供完整机器可读映射，`manifest.md` 提供用户可读清单。

## 2026-07-17 最终交付门禁

- 真实比例专项：`.diagnostics/electron/aidebug-2026-07-16T21-53-23-296Z/report.json`，`ok=true`，自主 Image Gen、真实落盘、2:3 尺寸与 View Image 复核全部通过。
- 完整 GUI：`.diagnostics/electron/aidebug-2026-07-17T09-14-27-474Z/report.json`，12 个主界面、Agent、设置、模型、账户和菜单场景经独立 evidence audit 检查，`0 error / 0 warning`。
- 选择与快捷键：`.diagnostics/electron/aidebug-2026-07-17T09-15-10-579Z/report.json`，全选、Ctrl/Meta 多选、中键框选、Delete、Escape、Ctrl+G、Ctrl+Shift+G、Ctrl+Z、方向键与多选右键专项通过，独立 evidence audit 为 `0 error / 0 warning`。
- 失败恢复：`.diagnostics/electron/aidebug-2026-07-17T09-15-27-448Z/report.json`，图片错误重试、工具时间线和成果提交恢复通过，独立 evidence audit 为 `0 error / 0 warning`。
- 产品性能：`.diagnostics/electron/product-performance-2026-07-17T09-16-50-891Z/report.json`，三轮全部健康；工作台就绪 1205ms、渲染启动约 771ms、堆约 22.96MB、缩放/平移/拖动交互 P95 约 1.0/0.2/0.2ms，交互 Long Task 最大 54ms，strict evidence audit 为 `0 error / 0 warning`。
- 生产构建：JS `630,224 / 650,000 B`、CSS `174,637 / 220,000 B`、总包 `855,423 / 1,000,000 B`；保留只读表格、删除线、任务列表、裸链接与脚注渲染，同时无 `__iiimageAIDebug`、`runLayerStackSuite`、`runMixedStressSuite` 等诊断控制面泄漏。
- 静态、协议、项目持久化、生命周期、FastMemory 隔离、View Image 请求体预算、画布命令、图片容器排版、导入、缩略图、PSD、透明图层、语义抠图和图层重组自测全部通过；`git diff --check` 无空白错误。

## Windows 1.0.0 发布闭环

- 解压版正式运行时：`.diagnostics/release/packaged-smoke-2026-07-17T09-18-38-105Z/report.json`，项目 IO、Agent 工具、图片保存/读取、导入、语义抠图、PSD 和缩略图桥接全部通过。
- 安装器：`release/iiimage-Studio-Setup-1.0.0-x64.exe`，113,047,393 字节，SHA-256 `09e52c1cf6ad7d89c95106b7564a0bcd62b2bf55602242e9d2764da4db547da6`。
- 精选案例包：`release/iiimage-Studio-Showcase-1.0.0.zip`，81,365,519 字节，SHA-256 `ae9174b609e6c6322f98244cdff03d2d01b7fda5bbfa05d28e3b4598b08db784`；通过 Forge Release 分发，不写入普通 Git 历史。
- 安装复验：`.diagnostics/release/installer-smoke-2026-07-17T09-23-48-402Z/report.json`，自定义路径安装、正式程序启动、桌面/开始菜单快捷方式、卸载和零文件残留全部通过。
- Authenticode 状态为 `NotSigned`；当前没有商业代码签名证书，不得宣称安装包已签名。
