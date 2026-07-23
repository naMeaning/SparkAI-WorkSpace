# IIIMAGE STUDIO GUI 初始来源记录

记录时间：2026-07-08 Asia/Shanghai

> 这是仓库刚分离时的历史快照，不是当前架构说明。当前结构见 `docs/PROJECT_STRUCTURE.md`，当前产品边界见根目录 `PRODUCT_INTENT.md` 与 `AGENTS.md`。

这个目录最初从 `E:\项目\ai-native` 的 Electron GUI 分离而来。

初始来源：

- 基础版本：`backup/dev-main-before-origin-main-20260708-201131`
- 基础提交：`6a0c39a feat(gateway): simplify iiimage studio shell`
- 当时本地 GUI 改动：`stash@{0}: pre-origin-main-merge-20260708-201131`
- 当时 Gitee 的 `dev/main` 分支也是 `6a0c39a`

最初主要入口：

- Electron 主进程：`electron-main.cjs`
- Electron preload：`preload.cjs`
- React GUI：`src/main.tsx`
- GUI 样式：`src/styles.css`
- Agent runtime：`agent-runtime.cjs`
- 启动脚本：`scripts/dev.mjs`

该记录仅用于追溯仓库分离历史。项目后来已经形成独立 Forge 仓库、单 Agent 成果画布、正式安装包和在线更新体系，不能再按“旧 GUI”理解或回退。
