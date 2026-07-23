# iiimage Studio 1.0.3 发布说明

发布日期：2026-07-20

1.0.3 是 Agent、任务画布、图片容器、分层恢复与 Windows 发布链路的收束版本。产品继续保持单一 Agent：模型自主理解要求并调用原生工具；画布只表达原图、参考图、需求、执行中成果、完成成果及其可复用关系，不引入母体或子 Agent。

## 本次更新

- 空白画布可创建需求、原图容器和参考图容器；只有连入需求节点的素材进入本次 TaskScope，未连接图片不会污染 Agent 上下文。
- 原图、参考图、普通图片、文件夹容器与多图成果统一到同一图片容器底层架构，保留物理资产、逻辑导入位置、容器槽位和来源关系。
- 手动生图、画布需求与聊天任务统一进入 Agent 时间线；要求、比例、精细程度、数量和参考范围可见，并使用统一忙碌状态与运行时幂等防止重复执行。
- 单图、多图和分层任务在网络请求前创建画布占位；成功成果原位提交，失败保留要求、来源和可恢复节点，不再产生幽灵节点或永久占用 Agent。
- 分层 PNG 支持结构化恢复：保留成功层，只重试失败层；节点身份、组号、顺序、位置、原资产和提示词保持不变。
- 统一右键菜单、节点编辑器、紧凑高度排版、危险操作层级和 Agent 动态状态；新增 884 与 1280 宽度的菜单和编辑器视觉门禁。
- AIDebug 改为读取运行时节点身份和真实 TaskScope，补齐 AskUser、图片恢复、容器、分层、安装、更新和真实 Agent 自主工具调用证据。
- 真实 `gpt-5.6-sol + gpt-image-2` 已验证模型自主调用 shell、workflow、experience、view image、原生 web search 与 image gen；生图完成后会再次 view image 核对成果。
- Windows 品牌安装/卸载支持路径锁定、修复安装、快捷方式偏好保持、失败回滚、默认保留数据与显式清理受管数据。
- 修复同版本静默升级的嵌套锁死：同一升级链使用一次性 token 受控加入，错误 token 和真正并发仍被拒绝；测试超时会终止完整进程树，不遗留安装内核或操作锁。
- 无损 Restart 更新从 1.0.2 升级至 1.0.3 时保留登录会话、项目设置与 FastMemory，并校验 Ed25519 签名、SHA-256、健康启动及失败回滚。

## 正式发布物

- Windows x64 安装包：`iiimage-Studio-Setup-1.0.3-x64.exe`
- 安装包大小：`113,210,880` 字节
- 安装包 SHA-256：`f98407a4f6607da35851977cdb2d4466992b34d85267768d294f773d0d46d5c2`
- 重启更新资源：`iiimage-Studio-Restart-Update-1.0.3-x64.asar`
- 重启更新大小：`45,892,810` 字节
- 重启更新 SHA-256：`aa136758104bb8c7c433d16022e08b49e66e17d4ae2215237a99b8744fb81de5`
- 更新 Manifest SHA-256：`8c83b2e9716f247b91e00389b5be0ed2424bfa19ba64916181ff37f3f89ff597`
- Manifest Ed25519 签名：验证通过
- Authenticode：`NotSigned`

## 验证证据

- 正式源码与发布编排：`.diagnostics/release/final-release-2026-07-20T02-35-25-546Z/orchestrator-report.json`
- 36 项源码门禁：`.diagnostics/release/verify-2026-07-20T02-35-28-450Z/report.json`
- 品牌安装/卸载 UI：`.diagnostics/release/branded-installer-ui-2026-07-20T02-42-38-992Z/report.json`
- 打包程序运行：`.diagnostics/release/packaged-smoke-2026-07-20T02-43-30-667Z/report.json`
- 安装、修复、卸载与零残留：`.diagnostics/release/installer-smoke-2026-07-20T02-43-33-767Z/report.json`
- Restart 1.0.2 → 1.0.3：`.diagnostics/release/restart-update-e2e-2026-07-20T02-44-46-494Z/report.json`
- 真实 Agent 自主工具：`.diagnostics/electron/aidebug-2026-07-20T01-02-01-719Z/report.json`
- 真实 Image2 与成果复核：`.diagnostics/electron/aidebug-2026-07-20T01-07-52-435Z/report.json`

正式编排确认源码前后摘要一致、不可发布标记已移除、Setup/Restart/Manifest/sidecar/SHA256SUMS 相互一致。桌面交付副本与正式 Setup 哈希一致。

## 已知边界

- 当前没有商业 Authenticode 证书，Windows SmartScreen 可能显示未知发布者；程序内部更新仍使用项目 Ed25519 公钥和 SHA-256 验证真实性与完整性。
- 品牌安装/卸载界面依赖 Windows 10/11 自带的 .NET Framework 4.8。
- 本地客户端制品已经冻结；官网、验证码下载、Telemetry 和生产更新链路必须在服务器原子部署与生产 E2E 完成后才视为正式对外发布。
