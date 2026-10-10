# SparkAI WorkSpace

SparkAI WorkSpace 是独立维护的 Electron + React 桌面 AI 视觉工作台，在同一项目、无限画布和单一 Agent Runtime 中提供通用、电商、社媒与科研四种工作台。项目 Agent 是唯一智能操作入口，可停靠或打开为独立窗口；画布只展示图片、视频、图片组、科研成果、需求节点及其来源关系，不把内部计划和工具步骤暴露成工作流节点。`image_gen` 是唯一图片执行工具，默认使用 `gpt-image-2`，支持文字/参考图生图、批量生成、元素替换、多款、分层 PNG、AI 抠图和蒙版重绘。
外部图片和文件夹可直接拖入：拖到聊天区域会加入参考图容器，拖到画布会复制进当前项目图片库并归入可视图片容器；用户原始文件不会被修改。

## 给第一次使用的人

最短路径是：新建项目 → 导入或拖入图片 → 选中要处理的图片 → 在右侧 Agent 用自然语言描述结果 → 检查生成图片组和来源关系 → 从查看器或右键菜单导出。选中图片会自动成为当前 Agent 上下文；需要控制角色时，在素材栏把图片标成“原图”或“参考图”。

Agent 会根据请求决定是否读取本地图片、检索公开资料或调用 `image_gen`。工具时间线会显示正在执行的动作，生成结果会作为新的画布成果保存，原图不会被覆盖。发送请求可能产生你配置的 Base URL、中转站或模型提供商费用，正式发送前请确认素材、提示词和账户额度。

面向用户的完整教程：

- [第一次让 Agent 完成一张图](./docs/tutorials/01-first-agent-image.md)
- [编辑、批量、多款与可复用需求](./docs/tutorials/02-edit-and-reuse-results.md)
- [用本地 CLI/MCP 控制 Agent](./docs/tutorials/03-automation-cli.md)
- [电商、社媒与科研工作台示例](./docs/tutorials/04-workspace-recipes.md)
- [隐私与发布前检查清单](./docs/PRIVACY_AND_PUBLISHING.md)

如果只想在软件里查看说明，打开“帮助与政策”即可；其中的“快速开始”“AI 示例教学”“使用帮助”和“隐私政策”与这些文档保持同一套边界。

## 安装与发布

- 发布项目/GitHub Release 展示名固定为 `SparkAI-WorkSpace`；应用内展示名仍为 `SparkAI WorkSpace`。`naimage-studio`、App ID、协议、CLI、用户数据目录和 Restart ASAR 的 `naimage-*` 前缀是升级兼容标识，不随展示名改变。
- Windows 10/11 x64 公开安装包使用 `SparkAI-WorkSpace-Unrestricted-Setup-<version>-x64.exe` 或 `SparkAI-WorkSpace-SparkAPI-Setup-<version>-x64.exe`；安装后的主程序为 `SparkAIWorkSpace.exe`。
- 安装器支持选择当前用户可写路径，并创建带正式图标的桌面与开始菜单快捷方式。
- 客户端支持更新清单签名校验、断点下载和重启更新；需要重新安装的大版本由软件更新中心下载完整安装包。
- 当前构建未配置商业代码签名证书，Authenticode 状态为 `NotSigned`；只应从受信发布源获取安装包并核对发布页提供的 SHA-256。
- 完整安装、卸载、数据迁移和源码发布说明见 [docs/INSTALLATION.md](./docs/INSTALLATION.md)。当前 1.0.9 测试包哈希以安装说明为准；更早版本的制品名和验收事实只保留在 `docs/RELEASE_*.md`。

## 当前入口

| 命令 | 作用 |
| --- | --- |
| `pnpm run dev` | 启动 Vite 与 Electron 桌面端。 |
| `pnpm run dev:web` | 仅启动渲染端，地址为 `127.0.0.1:5173`。 |
| `pnpm run build` | 构建渲染端到 `dist/`。 |
| `pnpm run package:win` | 构建 dual-access 的正式 Windows x64 NSIS 安装包。 |
| `pnpm run package:win:variants` | 生成 Unrestricted 与 SparkAPI 两个品牌测试安装包。 |
| `pnpm run package:smoke` | 验证解压后的正式程序、Preload 桥接、项目 IO、图片、PSD 与语义抠图。 |
| `pnpm run package:installer-smoke` | 隔离安装、启动验证、检查快捷方式并卸载，确认无安装文件残留。 |
| `pnpm run aidebug:gui` | 日常快速 GUI 冒烟，仅覆盖主画布宽/窄、Agent 面板和设置抽屉 4 个关键画面。 |
| `pnpm run aidebug:gui:surface` | 运行较完整的 UI surface 基线；仅在跨页面、全局布局或发布收口时使用。 |
| `pnpm run aidebug:evidence -- --report=<report.json>` | 独立复核截图哈希、窗口/DPR/缩放、遮挡、素材差异和五层证据，防止断言全绿但视觉不可交付。 |
| `pnpm run aidebug:gui -- --image-collection-persistence` | 跨两个 Electron 进程验证单图、连续系列、10 图并行、不同提示词图片组、拖出与继续生成。 |
| `pnpm run aidebug:gui -- --region-redraw-suite` | 验证区域重绘蒙版、Image 2 结果、来源关系和 884px 布局。 |
| `pnpm run aidebug:gui -- --real-agent-suite --real-agent-tools-only --live-config` | 使用真实 Agent 配置验证主工具边界。 |
| `pnpm run test:agent-text` | 验证纯文本 Prompt、独立工具 Schema、会话级 FastMemory 与清理隔离。 |
| `pnpm run test:view-image` | 验证大图观察副本的尺寸/请求体上限，以及 `original` 分辨率语义。 |
| `pnpm run test:agent-text-ui` | 启动真实 Electron 窗口验证 Prompt/FastMemory 编辑器与窄屏布局。 |
| `pnpm run test:image-layout` | 验证图片视觉编组不改写成果因果、跨组移动和自动解组。 |
| `pnpm run test:psd-export` | 验证分层 PNG 导出 PSD 的图层、透明度和合成像素。 |
| `pnpm run aidebug:human:list` | 列出可连接真实 Agent 的人类化测试套件。 |
| `pnpm run aidebug:human -- --port=9370 --suite=tool-natural` | 连接已启动的 AIDebug Electron，验证自然语言工具路由和画布闭环。 |
| `pnpm run maintenance:clean` | 预览可安全清理的历史诊断、旧发布物和开发日志。 |
| `pnpm run maintenance:clean:apply` | 执行经过路径边界和文档证据保护的工作区清理。 |

## 目录

| 路径 | 说明 |
| --- | --- |
| `electron-main.cjs` | Electron 主进程、项目文件、远端服务会话和 Agent IPC。 |
| `agent-runtime.cjs` | Agent Prompt、工具、FastMemory、上下文压缩和运行时。 |
| `src/` | React 工作台、共享数据、服务端浏览器回退与样式。 |
| `config/` | 本地设置、登录会话、项目列表和项目缓存。 |
| `output/` | 生图与本地资产输出。 |
| `.diagnostics/` | AIDebug 报告、截图和 Electron 日志。 |

详细源码职责、生成目录和安全清理规则见 [docs/PROJECT_STRUCTURE.md](./docs/PROJECT_STRUCTURE.md)，全部文档入口见 [docs/README.md](./docs/README.md)。

## 能力边界

- 单张正面商品参考图只能支持可见结构范围内的多角度推断，不能证明真实背面结构；需要高保真背面或侧面时必须补充对应参考图。
- PSD 已通过图层、透明度、合成像素与回读自测，但当前测试机没有安装 Adobe Photoshop，因此不把内部解析验证表述为 Photoshop GUI 实机验证。
- 图片服务与 Agent 依赖远端模型渠道；本地失败恢复可以处理瞬时错误，但无法消除上游账号池或服务不可用。

产品意图、历史方向和明确废弃项见 [PRODUCT_INTENT.md](./PRODUCT_INTENT.md)。后续编码约束见 [AGENTS.md](./AGENTS.md)。最终测试矩阵见 [docs/TEST_MATRIX_1.0.0.md](./docs/TEST_MATRIX_1.0.0.md)。
