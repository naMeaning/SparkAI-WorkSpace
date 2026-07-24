# naimage 项目结构

本仓库只维护 Windows Electron 客户端与本地单 Agent runtime。服务端 New API、账户渠道与下载站属于独立 `ai-native` 仓库，不复制到这里。符号级所有权、进程调用链与测试影响见 [CONTEXT_MAP.md](./CONTEXT_MAP.md)。

## 源码分区

| 路径 | 职责 | 说明 |
| --- | --- | --- |
| `src/` | React 工作台、画布、Agent 对话与共享前端逻辑 | `main.tsx` 只做跨域编排；独立表面和纯数据域放入专用模块。公共符号移动时同步上下文地图和调用方。 |
| `src/auth-gate.tsx`, `src/image-viewer.tsx`, `src/reference-picker-dialog.tsx`, `src/theme-palette-picker.tsx`, `src/window-controls.tsx` | 已抽出的 Renderer 表面 | 由 `main.tsx` 传入状态和回调；主题选择器随设置页懒加载，不反向持有 App 全局状态。 |
| `src/studio-dialogs.ts` | Renderer 异步表面 barrel | 聚合设置、账户、编辑对话框、主题选择器与 Markdown 的命名导出；保持自然 async chunk，不承载业务状态。 |
| `src/settings-persistence.ts`, `src/asset-identity.ts`, `src/paste-blocks.ts` | 设置/存储、资产身份与粘贴块纯逻辑 | 设置默认值、明暗/调色盘迁移直接由 `settings-persistence.ts` 拥有；资产和粘贴仍由 `core.ts` 兼容重导出。 |
| `src/styles.css`, `src/styles/` | 样式入口与 8 个有序语义区域 | import 顺序 01→08 是级联合同；01 内含语义 token 与命名调色盘，04 内含设置外观表面；`08-motion-accessibility.css` 必须最后。 |
| `src/window-controls.tsx` | Renderer 窗口控制按钮 | 只调用 `ConfigBridge.windowControl`；BrowserWindow 原语仍由主进程处理。 |
| `desktop/` | 可独立测试的 Electron 主进程域模块 | 当前包含保存协调器、模型目录与 Responses 请求转换；网络/IPC 时序仍留在 `electron-main.cjs`。 |
| `runtime/` | 可独立测试的 Agent runtime 图片域模块 | 当前包含 Image 2 画幅规则与 `view_image` 安全 payload；由 `agent-runtime.cjs` 作为 facade/编排入口。 |
| `electron-main.cjs` | Electron 主进程入口 | 负责窗口、IPC、项目存储、登录会话、远端请求、Worker 与更新调度，是打包清单中的固定入口。 |
| `preload.cjs` | Renderer 安全桥 | 只暴露经过约束的 config/server/updater/agent 能力。 |
| `agent-runtime.cjs` | 单 Agent runtime | 负责 Prompt、工具 Schema、上下文压缩、FastMemory、模型协议与工具执行；返回 action，不直接修改 React。 |
| `*-worker.cjs` | 图片导入、缩略图、抠图与 PSD 的隔离工作线程 | 文件位于根目录是 Electron ASAR/worker 解析约束，不应只为目录美观而移动。 |
| `scripts/` | 自测、AIDebug、性能门禁和发布自动化 | `scripts/release/` 只放发布链路；`scripts/maintenance/` 只放仓库维护。 |
| `tools/dev-launcher/` | 开发快捷启动器源码 | `naimage Dev.exe` 由这里构建。 |
| `tools/windows-installer/` | 品牌安装器与卸载器源码 | WPF 自绘交互层；NSIS 作为用户不可见的静默安装/删除内核。 |
| `assets/` | 人工维护的源素材 | 软件图标母版为 `assets/windows/naimage-icon-master.png`；Windows 多尺寸产物为 `assets/windows/naimage.ico`，安装器构建副本位于 `build/naimage.ico`。 |
| `build/` | Electron Builder 输入 | 安装器资源、更新公钥和辅助脚本；不是普通运行输出。 |
| `public/` | Renderer 静态源资源 | 当前 Vite 配置不会无条件复制整个目录；变更时检查 bundle 是否真实引用。 |
| `docs/` | 当前架构、产品、测试、发布和历史决策记录 | `docs/README.md` 是索引，`CONTEXT_MAP.md` 是当前实现地图，日期文件是历史阶段记录。 |
| `showcase/` | 精选真实成图与说明 | 需要长期保留；原图通常不进入普通 Git 历史。 |

## 本地数据与可再生输出

| 路径 | 类型 | 处理规则 |
| --- | --- | --- |
| `config/` | 开发态项目、会话、设置、memory 与素材库 | 用户/运行数据，不得由普通维护脚本删除。打包态对应 Electron `userData/data/`。 |
| `dist/` | Vite 构建结果 | 可由 `corepack pnpm run build` 重建。 |
| `release/` | 安装包、解压版与更新产物 | 维护脚本只清理低于 `package.json` 当前版本的旧发布物。 |
| `.diagnostics/` | AIDebug、性能和发布验证证据 | 保留文档引用的权威证据与最近运行，其余按维护策略清理。 |
| `.release-tools/` | 启动器和发布辅助构建 | 可再生。 |
| `.dev-logs/` | 开发进程日志 | 可再生。 |
| 工作区根 `.tools/` | 项目级便携工具链 | Bun、Go、.NET 由工作区脚本激活；不写入系统 PATH。见 [本地工具链](../../LOCAL_TOOLCHAIN.md)。 |
| `node_modules/` | pnpm 依赖 | 可由锁文件恢复。 |

所有运行时配置、诊断和输出默认留在仓库、Electron 用户数据目录或用户明确选择的项目目录内。不要把项目数据散落到其他源码目录，也不要直接修改用户拖入的原图。

## 文档同步

新增/移动模块、公共符号、IPC/API/schema、持久化格式或测试入口变化时，必须在同一批改动更新 `docs/CONTEXT_MAP.md`。目录级职责留在本文；符号、依赖、调用链、镜像规则和测试矩阵写入上下文地图，避免两处复制后漂移。

## 安全清理

先预览：

```powershell
corepack pnpm run maintenance:clean
```

确认后执行：

```powershell
corepack pnpm run maintenance:clean:apply
```

清理器有四个明确作用域：`diagnostics`、`release`、`logs`、`legacy-launcher`。默认模式始终只预览；它拒绝删除仓库之外的路径，并扫描 Markdown 引用的诊断运行，避免误删发布证据。

可按需缩小范围：

```powershell
node scripts/maintenance/clean-workspace.mjs --scope=diagnostics,logs --keep-electron=20
```

自动化环境只需要汇总时可追加 `--quiet`。

## 修改后的最低验证

- 任意代码改动：`corepack pnpm run build`
- TypeScript/TSX 结构改动：`corepack pnpm run typecheck`
- 设置/浏览器回退存储：`corepack pnpm run test:settings-persistence`
- 主题 token、设置组件基础约束：`corepack pnpm run test:ui-foundation`
- 模型目录/缓存：`corepack pnpm run test:model-catalog`
- Responses 适配：`corepack pnpm run test:agent-responses-adapter`
- 粘贴块：`corepack pnpm run test:paste-blocks`
- 一般 Renderer/UI 冒烟：一批功能完成后运行一次 `corepack pnpm run aidebug:gui`（4 个关键画面）
- 完整 UI surface 基线：仅在跨页面、全局布局或发布收口时运行 `corepack pnpm run aidebug:gui:surface`
- Electron、项目或 Agent 非可视改动：优先运行对应 selftest；只有影响窗口、preload 或真实交互时才追加 GUI 专项
- 项目 session/save revision：`corepack pnpm run test:project-save-coordinator` 与 `corepack pnpm run test:project-io`
- 正式发布构建：`corepack pnpm run test:bundle`
- 品牌安装/卸载截图：`corepack pnpm run package:installer-ui-smoke`
- 隔离安装、覆盖、快捷方式和卸载：`corepack pnpm run package:installer-smoke`
- 更新链路：`corepack pnpm run test:update`、`corepack pnpm run test:update-helper`，发布前再执行真实重启更新 E2E

完整专项测试映射见 [CONTEXT_MAP.md](./CONTEXT_MAP.md#10-测试映射)。产品边界以根目录 `PRODUCT_INTENT.md` 和 `AGENTS.md` 为准。
