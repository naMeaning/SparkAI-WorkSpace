# SparkAI WorkSpace

SparkAI WorkSpace 是一个免费的 Windows Agent 生图工作台：在同一个项目中管理图片素材、用自然语言发起生图和编辑，并在无限画布上比较、整理和追溯成果。

适合需要反复看图、改图和复用素材的创作者。一个项目 Agent 负责理解任务，画布保留原图、参考图和新成果之间的关系；电商、社媒、科研和日常创作共用同一套项目与素材。

> 当前公开安装包为 [v1.0.9](https://github.com/naMeaning/SparkAI-WorkSpace/releases/tag/v1.0.9)。取消自定义接口 Pro 门槛的免费双接入改动已进入 `main` 和本地开发包，尚未更新该公开安装包；旧包仍可能显示 Pro 提示。体验免费双接入请使用包含 2026-10-17 改动的开发构建，后续公开下载以 Releases 页面为准。

软件本身免费。当前开发版保留 SparkAPI 及已有 New API 协议的账号登录，通用版也可直接填写你有权使用的 Base URL + API Key；两种方式共用同一项目、无限画布和 Agent。模型调用费用由你选择的上游服务商收取。SparkAPI 专用版仍只接受官方账号登录；更广泛的 New API/Sub2API 站点账号适配属于后续目标，不能保证任意站点的登录协议均兼容。

## 先看这几个入口

- [下载 1.0.9](https://github.com/naMeaning/SparkAI-WorkSpace/releases/tag/v1.0.9)
- [第一次使用教程](./docs/tutorials/01-first-agent-image.md)
- [账号登录与 Base URL + API Key 双接入](./docs/NEW_API_DUAL_ACCESS_AND_ACTIVATION.md)
- [全部 tutorials](./docs/tutorials/README.md)
- [第三方参考项目与许可证](./docs/THIRD_PARTY_REFERENCES.md)
- [可直接转发的推广文案](./docs/PROMOTION_COPY.md)
- [隐私与发布前检查](./docs/PRIVACY_AND_PUBLISHING.md)
- [完整文档索引](./docs/README.md)

当前公开安装目标是 Windows 10/11 x64。应用内名称为 `SparkAI WorkSpace`，GitHub 项目和 Release 名称为 `SparkAI-WorkSpace`。

## 它是怎么工作的

SparkAI WorkSpace 只有一个项目 Agent 作为智能操作入口。画布负责保存和呈现素材、图片组、视频、需求和成果的关系；它不是需要用户手动连接的工作流节点编辑器。

一次任务通常只有四步：

1. **准备来源**：新建项目，把图片拖到画布或素材栏。拖入的文件会复制进项目，原始文件不会被改写。
2. **说明角色**：在素材栏把图片标成“原图”或“参考图”。原图表示要编辑的对象，参考图表示只借鉴风格、颜色、构图或内容。
3. **描述结果**：在右侧 Agent 说明主体、场景、比例、必须保留的内容和输出数量。选中的图片会自动成为当前上下文。
4. **检查并导出**：查看 Agent 时间线、图片组和来源关系，确认结果后再从查看器或导出中心保存。

Agent 会根据请求读取当前项目上下文，并在需要时调用 `image_gen`。默认图片模型为 `gpt-image-2`；可用模型、质量和费用取决于你配置的服务商。发送前请确认素材、提示词、Base URL 和账户额度。

## 五分钟完成第一次任务

### 1. 安装并打开应用

从 [v1.0.9 Release](https://github.com/naMeaning/SparkAI-WorkSpace/releases/tag/v1.0.9) 下载对应的安装包：

- `SparkAI-WorkSpace-Unrestricted-Setup-<version>-x64.exe`：通用版本，适合自定义 Base URL 或中转服务。
- `SparkAI-WorkSpace-SparkAPI-Setup-<version>-x64.exe`：SparkAPI 账号专用版本。

包含免费双接入改动的通用开发包不需要 Pro 兑换码或设备授权。安装后在登录页选择“账号登录”或“自定义接口”，按[双接入教程](./docs/NEW_API_DUAL_ACCESS_AND_ACTIVATION.md)完成一种配置即可。公开 v1.0.9 保留旧自定义授权流程，可先使用其账号登录；不要把同名、同版本号的本地开发包与公开资产混用。

当前公开构建没有商业代码签名证书，Windows 可能显示发布者未知。请只从受信发布页下载，并按同一页面提供的 SHA-256 清单核对文件。完整安装、卸载和升级边界见 [安装说明](./docs/INSTALLATION.md)；1.0.8 及更早版本因为更新签名轮换必须手动安装 1.0.9 完整包。

### 2. 创建项目并导入素材

新建项目时选择一个你有权限管理的目录。把图片拖到画布，或者从素材栏选择文件。需要文字生图时可以跳过导入。

### 3. 发送一条清楚的请求

选中图片，在右侧 Agent 输入：

```text
保留原图中的白色陶瓷杯、杯口形状和印刷文字，放到明亮的早餐桌面上；
画面干净，右侧留出文案空间，不添加新的品牌标志，输出 1 张 1:1 商品主图。
```

没有原图时可以直接写：

```text
生成一张 1:1 的极简黑色耳机产品海报，深灰背景，柔和侧光，主体居中；
不要出现品牌名称、二维码或多张拼贴。
```

点击“发送给 Agent”，或按 `Ctrl/Cmd + Enter`。输入 `/help`、`/status`、`/config` 可以查看本地帮助、运行状态和图片配置。

### 4. 复核结果

生成结果会作为新的画布成果保存，原图仍然保留。先确认主体、文字和来源关系，再导出或继续编辑。一次请求可能把提示词、选定图片和参数发送到你配置的上游服务，也可能产生费用；失败后先看时间线和脱敏状态，不要连续重复发送。

## 你可以让 Agent 做什么

| 目标 | 可以这样说 | 需要检查 |
| --- | --- | --- |
| 文字生图 | “生成一张 1:1 的极简产品主图……” | 主体、比例、文字和品牌元素 |
| 继续编辑 | “保留主体结构，只把背景换成……” | 原图是否选对，未要求改变的内容是否保留 |
| 替换元素 | “把杯子换成黑色，其他保持不变” | 替换范围和来源关系 |
| 多款方案 | “基于当前原图生成 4 张独立风格方案” | 是否得到 4 张独立图片，而不是一张拼贴 |
| 分层 PNG | “拆成背景、主体、文字和阴影图层” | 图层透明度、合成预览和输出尺寸 |
| AI 抠图 | “提取杯子主体，背景透明” | 选区、透明边缘和导出格式 |
| AI 重绘 | “把选区里的天空改成日落” | 蒙版范围和原图保留情况 |

底部的直接生图入口适合已经确定提示词和参数的单次请求；需要读取画布、连续修改或复用上下文时，使用右侧 Agent。

## Tutorials

先从已发布版教程开始：

| 教程 | 适合谁 | 你会完成什么 |
| --- | --- | --- |
| [01 · 第一次让 Agent 完成一张图](./docs/tutorials/01-first-agent-image.md) | 第一次使用 | 导入素材、区分原图/参考图、生成并导出 |
| [02 · 编辑、批量、多款与可复用需求](./docs/tutorials/02-edit-and-reuse-results.md) | 已完成第一次生成 | 继续编辑、批量 Goal、保存需求节点 |
| [03 · 用本地 CLI/MCP 控制 Agent](./docs/tutorials/03-automation-cli.md) | 需要脚本或 MCP | 读取状态、提交任务、处理版本冲突 |
| [04 · 电商、社媒与科研工作台示例](./docs/tutorials/04-workspace-recipes.md) | 有明确业务场景 | 从计划到执行，复用四种工作台 |

主分支还补充了两篇开发版预览教程，所述界面尚未进入公开 v1.0.9 安装包：

| 教程 | 适用版本 | 主题 |
| --- | --- | --- |
| [05 · 模型连接与运行状态](./docs/tutorials/05-model-connections-and-status.md) | 主分支开发版 | 区分模型目录、文生图和编辑的实际运行证据 |
| [06 · 安全恢复图片结果](./docs/tutorials/06-recover-image-results.md) | 主分支开发版 | 查询原任务或保存已有结果，避免不确定时重复提交 |

教程示例都使用虚构提示词和占位符。请不要把真实 API Key、Cookie、License 码、客户资料、私人图片或本机绝对路径替换进公开文档、Issue、截图和日志。旧 License 字段只为历史配置和扩展兼容保留，不是通用版当前使用条件。

## 四种工作台

- **通用创作**：从空白画布开始探索、改图和整理成果。
- **电商创作**：管理商品、变体和 SKU，按平台规格制作套图并导出。
- **社媒创作**：先生成结构化卡片/镜头计划，再确认执行图片或视频任务。
- **科研绘图**：导入受管数据，创建图形计划，执行项目内脚本并导出可复核图形。

四个工作台共享同一个项目、画布、会话和 Agent。切换工作台不会复制画布，也不会因为创建计划或连线就自动调用模型。

## 隐私、费用与发布安全

项目图片、画布、会话和导出结果保存在你选择的项目目录。拖入外部文件时应用复制文件，不修改源文件。Agent 请求中的提示词、选定图片和参数会按你的配置发送到对应服务商；请在使用前确认对方的数据处理政策和费用。

公开仓库不应包含以下内容：

- API Key、Bearer Token、Cookie、License 码、更新私钥和签名 URL；
- `config/`、`.diagnostics/`、`output/`、`release/`、`dist/`、`.dev-logs/`、`node_modules/` 中的本地数据；
- 客户资料、私人图片、完整提示词、绝对路径和未脱敏截图。

提交前先看 [隐私与发布前检查](./docs/PRIVACY_AND_PUBLISHING.md)，再执行 `git status`、`git diff --cached --check` 和敏感信息扫描。自动化 CLI/MCP 也只应记录脱敏状态，不要把 `ArgsJson` 原文、连接文件或桥接 Token 写进日志。

## 已知边界

- 单张正面商品图只能支持可见结构范围内的角度推断，不能证明真实背面结构；需要高保真背面或侧面时请补充对应参考图。
- 计划、需求节点和画布连线用于组织上下文，不会替用户自动执行；批量、视频和平台导出都需要明确确认。
- PSD 已通过图层、透明度、合成像素和回读自测；当前验证不等同于安装 Photoshop 后的 GUI 实机验证。
- 图片服务和 Agent 依赖远端模型渠道；模型能力、可用性、费用和内容政策由服务商决定。

## 参考与致谢

感谢 [New API](https://github.com/QuantumNous/new-api)（AGPL-3.0）、[Sub2API](https://github.com/Wei-Shaw/sub2api)（LGPL-3.0）、[GPT Image Playground](https://github.com/CookSleep/gpt_image_playground)（MIT）和 [Infinite Canvas](https://github.com/basketikun/infinite-canvas)（MIT）的开源工作。本项目参考了它们的接口合同和画布交互设计；固定源码版本、许可证链接、具体范围及代码纳入边界见[第三方参考项目与许可证](./docs/THIRD_PARTY_REFERENCES.md)。上游版权归各自贡献者所有。

## 开发者入口

桌面端源码位于 `sparkai_workspace/`。Windows 开发环境需要 Node.js `>=22.12.0`、pnpm `>=10.12.1` 和可用的 Electron 构建依赖：

```powershell
cd sparkai_workspace
corepack pnpm install
corepack pnpm run dev
```

常用检查：

```powershell
corepack pnpm run typecheck
corepack pnpm run build
corepack pnpm run aidebug:gui
```

发布、安装烟测、教程、第三方参考与上下文地图见 [docs/README.md](./docs/README.md)。编码与验证约束见 [AGENTS.md](./AGENTS.md)；产品意图见 [PRODUCT_INTENT.md](./PRODUCT_INTENT.md)。
