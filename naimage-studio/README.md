# naimage

naimage 是独立维护的 Electron + React 傻瓜式 AI 生图工作台。右侧项目 Agent 是唯一任务入口，可折叠为窄栏但不会被卸载或创建子 Agent；无限画布只展示图片成果、图片组、分层栈及其来源关系。`image_gen` 是唯一图片执行工具，默认使用 `gpt-image-2`，支持文字/参考图生图、连续或最多 10 张并行图片、元素替换、单图多款、分层 PNG、AI 抠图和带蒙版区域重绘。Agent 可在内部使用文件查看、命令、联网检索、经验与 compact 等通用能力，但不会把这些过程放到画布。设置中可以直接编辑/恢复主 Agent 纯文本 Prompt；Agent 标题栏可以编辑当前项目当前会话的 FastMemory，Prompt、工具 Schema、会话压缩摘要和 FastMemory 彼此独立。
外部图片和文件夹可直接拖入：拖到聊天区域会加入参考图容器，拖到画布会复制进当前项目图片库并归入可视图片容器；用户原始文件不会被修改。

## 安装与发布

- Windows 10/11 x64 安装包使用 `naimage-Setup-<version>-x64.exe` 命名，安装后的主程序为 `naimage.exe`。
- 安装器支持选择当前用户可写路径，并创建带正式图标的桌面与开始菜单快捷方式。
- 客户端支持更新清单签名校验、断点下载和重启更新；需要重新安装的大版本由软件更新中心下载完整安装包。
- 当前构建未配置商业代码签名证书，Authenticode 状态为 `NotSigned`；只应从受信发布源获取安装包并核对发布页提供的 SHA-256。
- 完整安装、卸载、数据迁移和源码发布说明见 [docs/INSTALLATION.md](./docs/INSTALLATION.md)。旧版本的制品名、哈希和验收事实保留在 `docs/RELEASE_*.md` 历史记录中。

## 当前入口

| 命令 | 作用 |
| --- | --- |
| `pnpm run dev` | 启动 Vite 与 Electron 桌面端。 |
| `pnpm run dev:web` | 仅启动渲染端，地址为 `127.0.0.1:5173`。 |
| `pnpm run build` | 构建渲染端到 `dist/`。 |
| `pnpm run package:win` | 构建正式 Windows x64 NSIS 安装包。 |
| `pnpm run package:smoke` | 验证解压后的正式程序、Preload 桥接、项目 IO、图片、PSD 与语义抠图。 |
| `pnpm run package:installer-smoke` | 隔离安装、启动验证、检查快捷方式并卸载，确认无安装文件残留。 |
| `pnpm run aidebug:gui` | 启动隔离配置的 GUI 基线测试并生成截图、状态和报告。 |
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
