# iiimage Studio 1.0.2 发布说明

发布日期：2026-07-19

1.0.2 是现代品牌安装器与可复用需求节点的阶段发布版。产品仍保持“单一项目 Agent + 成果画布”，没有恢复旧式多节点工作流、子 Agent 或关键词强制路由。

## 本次更新

- 增加可复用需求节点，形成“素材 → 需求 → 成果”的三点一线关系；支持创建、编辑、双击打开、断线、重连、重复执行确认、撤销、项目保存和重启恢复。
- 多选图片与多个图片容器可直接从画布提出要求；底层复用现有图片容器，不复制素材，也不创建第二套超级容器数据。
- 统一原图与参考图双入口、稳定素材编号、TaskScope 隔离、发送时项目内入库和历史消息附件复看，降低参考图被误当成批量任务的风险。
- 素材身份拆分为物理 `assetId`、逻辑 `occurrenceId` 与容器槽位 `bindingId`；同字节图片只保存一份，但不同文件夹和导入位置可以独立选择、编辑、移动、归组和交给 Agent。
- 外部文件夹导入保留真实目录边界，多目录自动形成超级容器；项目保存、便携打包再导入后仍保持文件夹、消息附件与逻辑素材身份，不把同图误合并成一个任务。
- Agent Markdown 改为安全轻量实现，保留常用标准 Markdown，同时移除大型 GFM 运行时依赖；正式 JS 仍保持在既有门禁以内。
- Windows 安装与卸载改为 iiimage Studio 自有深色品牌界面；支持路径选择、快捷方式选择、覆盖修复、失败回滚、默认保留用户数据和一致的错误反馈。
- AIDebug 增加画布稳定状态预检，并将长时间分层需求验证改为可轮询的诊断任务，避免过早截图和 CDP Promise 回收造成的误报。

## 更新策略

本版本将兼容标识升级为 `windows-x64-electron-42-runtime-2`。从 1.0.0 或 1.0.1 更新时，客户端会使用需要登录和验证码授权的完整安装包升级，使新的品牌卸载器和系统注册一并落地；不会错误地只替换 `app.asar`。后续兼容版本可继续使用无损重启更新。

## 发布物

- Windows x64 安装包：`iiimage-Studio-Setup-1.0.2-x64.exe`
- 大小：113,159,680 字节
- SHA-256：`142b32c64864fa8802596e4e57c613416e26565d71f930167dbcd5d5e8288981`
- 重启更新资源：`iiimage-Studio-Restart-Update-1.0.2-x64.asar`
- 重启更新大小：45,757,762 字节
- 重启更新 SHA-256：`d91dd3c3e3fe90d53ea364745baa9cd84685ce5cfa60ead1e8c9e3ac1b170f93`
- Authenticode：`NotSigned`

## 验证

- 正式 bundle：初始 JS `582,056 / 600,000 B`，全部 JS `594,679 / 650,000 B`，CSS `183,930 / 220,000 B`，总构建 `829,171 / 1,000,000 B`；账户抽屉已按需加载。
- 生产性能三轮门禁：`.diagnostics/electron/product-performance-2026-07-19T02-58-21-159Z/report.json`，1000 节点视口投影、500 条时间线窗口化、4K 缩略图缓存、交互帧和清理后内存均通过。
- 品牌安装/卸载 19 张 100%、125%、150%、200% DPI 与小屏截图：`.diagnostics/release/branded-installer-ui-2026-07-19T03-01-50-579Z/report.json`。
- 解压正式包运行：`.diagnostics/release/packaged-smoke-2026-07-19T03-00-41-088Z/report.json`。
- 完整安装、覆盖、回滚、受保护目录、快捷方式、保留/彻底卸载及零残留：`.diagnostics/release/installer-smoke-2026-07-19T03-00-19-074Z/report.json`。
- 需求节点完整 GUI：`.diagnostics/electron/aidebug-2026-07-19T02-40-49-073Z/report.json`。
- Agent 文本、设置、登录、FastMemory、动效与需求节点 UI：`.diagnostics/electron/agent-text-ui-2026-07-19T02-55-41-622Z/report.json`。
- 文件夹、重复 occurrence、超级容器与 Agent TaskScope：`.diagnostics/electron/aidebug-2026-07-19T02-42-21-597Z/report.json`。
- 同兼容运行时重启更新：`.diagnostics/release/restart-update-e2e-2026-07-19T03-16-32-008Z/report.json`；会话、FastMemory、设置、备份清理和健康确认均通过。
- 官网登录、验证码、一次性下载票据、完整安装包传输与 SHA 校验：`.diagnostics/release/server-download-check/report.json`。
- 真实旧版迁移：先安装 1.0.1，再由 1.0.2 覆盖，确认 ASAR 哈希替换、路径锁定、品牌卸载注册及最终零残留。

## 已知边界

- 当前未配置商业 Authenticode 证书，Windows SmartScreen 可能显示发布者未知。
- 品牌安装层依赖 Windows 10/11 自带的 .NET Framework 4.8；移除该系统组件的裁剪镜像不在当前支持范围。
- 极小于 920 × 620 工作区的屏幕尚未提供专门的安装器响应式布局，但 100%、150%、200% DPI 已通过。
