# ComfyUI Phase 1 连接配置验证

这份记录对应 Phase 1 的 Main-owned ComfyUI connection profile 边界。验证只使用 `127.0.0.1` loopback fixture；没有连接真实 LAN、远程 ComfyUI，没有下载模型或依赖，也没有发送真实生成请求。

任务合同见 [Goal](../GOAL.md)，当前实现状态见 [Progress](../PROGRESS.md)，owner 与调用链见 [上下文地图](CONTEXT_MAP.md)。连接配置由 `desktop/comfyui-connection-service.cjs` 持有，Renderer/Agent/CLI/MCP 只应看到 `connectionId` 与脱敏 profile summary。

## 验证入口

| 命令 | 覆盖 | 结果 |
| --- | --- | --- |
| `corepack pnpm run test:comfyui-connection` | `local`/`lan`/`remote` scope、URL 凭据/query/fragment 拒绝、HTTPS 默认策略、授权主机、credentialRef 脱敏、credential header、DNS pin/rebinding、TLS handshake 失败、旧 `baseUrl` 迁移、loopback fake 的认证与重定向 | Phase 1 连接专项 |
| `corepack pnpm run test:comfyui-transport` | 实际 HTTP/HTTPS/WSS socket、DNS pin/实际对端校验、Bearer/Basic/mTLS、TLS 信任链/主机名、精确 endpoint、损坏 profile fail closed、fake remote 重启恢复/取消 | 17 例通过 |
| `corepack pnpm run test:comfyui-credentials` | 保护存储与原生文件导入：格式拒绝、取消、不可用、持久化/读取及清理 | 8 例通过 |
| `corepack pnpm run test:comfyui-executor` | ComfyUI HTTP/WS fake：HTTP 400/401/429 与 ambiguous 408/5xx、唯一 prompt POST、未知提交零重发、WS 断线/重定向后 history 恢复、输出下载、排队定向取消、运行中不调用全局 interrupt | 现有执行器专项 |
| `corepack pnpm run test:comfyui-main` | Main IPC/journal 脱敏、旧 v1 journal/baseUrl 兼容读取、prepared/accepted 持久化、唯一提交与恢复 | Main 专项 |
| `corepack pnpm run test:comfyui-ui` | Electron 原生交互：连接保存/切换、原生凭据入口与无秘密输入、LAN/remote 可见网络边界、参数派发、重启恢复、定向取消与 884×640 最小窗口 | 10 组 / 19 截图通过 |
| `corepack pnpm run test:image-generation-metadata` | local/lan/remote 来源标签、请求/响应 ID 与 scope、项目持久化、Renderer/Main 镜像、非法 scope 的幂等 unknown 边界 | 21 例通过 |
| `corepack pnpm run typecheck` | Renderer/IPC/共享 options 类型同步 | exit 0 |

2026-10-23 当前 loopback 结果：`test:comfyui-connection` 通过 15 个 case；`test:comfyui-executor` 已通过 35 个 case（32 次 fake prompt POST、3 次定向 queue delete、4 个 fake WebSocket、0 真实模型请求）。连接报告为 `.diagnostics/comfyui-connection/report.json`，其中 `realNetworkRequests=0`、`realModelRequests=0`；执行器报告为 `.diagnostics/comfyui-executor/report.json`。该结果尚不代表真实远程证书链、LAN 路由或模型节点兼容性已验证。

新增专项脚本是 [scripts/comfyui-connection-selftest.cjs](../scripts/comfyui-connection-selftest.cjs)。其中 `createFakeRemoteServer()` 和 `createTlsFailureServer()` 只监听本机回环，供后续 connection IPC/GUI 测试复用。fixture 会记录请求方法、路径、prompt POST 次数和定向 queue delete，不记录 token 或完整凭据。

实际 transport 报告为 `.diagnostics/comfyui-transport/report.json`：17 例、65 次 HTTP、7 次 prompt POST、6 次输出下载、1 次定向 delete、3 次 WebSocket upgrade、3 次认证拒绝、3 次 TLS 错误和 73 次 pinned socket lookup。fake remote 的网络替身显式标记 `fixtureNetworkOverride=true`、`fakeRemoteLoopbackRouting=true`，仅在测试注入回环地址；生产策略另行断言 remote 到 loopback/混合私网解析在 socket 前拒绝。不是实际 LAN/远程服务证据。

## 连接安全合同

- `local` 只允许 localhost/loopback；`lan` 只允许明确授权的私网地址；`remote` 默认要求 HTTPS、固定授权主机并拒绝私网/回环 DNS 结果。
- profile URL 不接受用户名、密码、查询参数或 fragment。请求 URL 由 Main 的授权策略生成；未审核 endpoint、额外 query、跨主机/跨端口、重定向都必须 fail closed。
- `none`/`bearer`/`basic`/`mtls` 只保存 `credentialRef`。公开 DTO 仅包含 `credentialMode` 与 `credentialConfigured`；Bearer、Basic、证书、私钥和 token 不能进入 Renderer、日志、项目文件或 MCP 返回。
- 每次 DNS 解析结果在请求内固定并复核网络范围，发现 DNS rebinding、空解析或地址族漂移立即拒绝。WebSocket 使用与 HTTP 相同的 host/port/path/TLS 策略，且不跟随 30x。
- 旧任务仍可通过显式 `baseUrl` 兼容读取并迁移到标记为 `legacy` 的 profile；历史恢复不要求新的 `capabilitiesHash`，也不因迁移重新提交图片。

## Electron UI 实际证据

最终源码 UI 报告：`.diagnostics/comfyui-ui-2026-10-23T01-08-36-810Z/report.json`，`ok=true`、10 组检查、19 张截图。4 次 prompt POST、3 次 `/view`、1 次受管图片上传和 1 次定向 queue delete 全部指向 loopback fake；没有真实模型请求，两次应用正常退出均为 exit 0、未强杀。此前 `00-59-02-918Z` 的报告保留为增量验证，最终 UI 使用当前新报告。

- 真实点击保存和选择本机连接；保存元数据不产生请求，明确测试后读取 fixture 能力。生成后项目中的 `comfyui` 配置包含 `connectionId`，不保存新任务 `baseUrl`。相同 submission 重放不增加 POST，异内容在网络前拒绝。
- 界面提供 `none`/`bearer`/`basic`/`mtls` 选择和原生凭据导入按钮，没有 Token、密码、证书、私钥或 `credentialRef` 文本输入。选择认证但尚未导入时，测试连接在网络前拒绝。本次 UI 没有打开原生文件选择器或导入真实凭据；原生导入处理与保护存储由 Main 专项验证。
- LAN 和 remote 只保存测试元数据并切换选择，未调用这两个连接的测试或生成。两种范围都实际滚动到可见提示，明确“这个连接不属于严格离线”。`connection-lan-boundary.png`、`connection-remote-boundary.png` 记录提示，`connection-local-manager.png` 与 `connection-native-credential-boundary.png` 记录管理表单。
- 删除已选择的 remote profile 后切换 provider 重新挂载表单，原 ID 仍保留并可见“连接不可用 · 请重新选择”，网络范围显示未知；没有静默切到首个本机连接或发请求。只有用户明确选择本机连接后才继续；观察字段 `missingConnection` 与可见几何记录在报告内。
- `minimum-connection-manager.png`、`minimum-local-template-controls.png`、`minimum-local-sampling-controls.png`、`minimum-local-template.png` 覆盖正式最小 884×640 窗口：连接/参数/Prompt/提交可滚动访问，断言几何边界、无横向溢出和指针命中。管理区域默认折叠，展开后不挤压主任务表单。已用图片查看工具逐张核对本机管理、远程提示及最小窗口关键截图。
- 真实 Electron 重启后通过恢复对话框找回 unknown 原任务，不增加 POST 或重复资产；可见取消仅删除目标排队任务。源图 hash 保持不变。
- 最终生成结果的 request/response metadata 都包含相同 `connectionId` 与 `networkScope=local`，实际成果编辑器仍显示本地执行。另以纯数据专项验证 LAN、remote 与 unknown 的来源标签及项目保存，不发远程生成；显式非法范围清洗为 `unknown` 并在重复清洗中保持，旧无 scope 记录才按历史本机兼容。21 例 metadata 专项和最终 typecheck 都已通过。

## 证据边界

连接专项和现有 executor fake 只证明 schema、脱敏、网络准入和任务控制流程。它们不证明真实 ComfyUI 版本、真实节点/模型兼容性、GPU 性能、远程证书链或 LAN 路由；这些边界需要另行授权与独立记录。`test:comfyui-connection` 运行时的 `realNetworkRequests`/`realModelRequests` 必须保持为 0。

## 最终源码与本地开发包

- 最终 Main 报告 `.diagnostics/electron/comfyui-main-1792717876186/report.json`：12组，8 fake prompt/5 view/1 upload；真正无 connectionId 的旧 v1 journal 连续恢复通过，旧连接身份不被新 ID 替换。新 journal 只持 ID/scope/connectionHash，profile 漂移和跨 profile 同 submission 在网络前拒绝；prepared/accepted 两个回调缺失时提交前拒绝。
- automation-service、MCP 123 tools、IPC 170注册/167 preload、template14、executor35、credentials8、connection15、transport17、metadata21、typecheck与view-image通过。全部真实服务/模型/下载/依赖安装计数为0。原生凭据文件选择器的真实操作未执行，保护与导入合同使用隔离 Main fixture 验证。
- 714 源文件冻结 SHA-256 `c0d32f1ead17771427d511e291c379eb92e631152593e21f7d07321a797478ce`；`package:win:unrestricted` exit0。[Windows EXE](../release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe) 110,055,936 B，SHA-256 `82325b465d01deb9258e07b55ec0d6e5a9bdf45eb62b0ee0fb061eac3d557875`。
- 包内 132 dist/191 owner 与冻结源码逐字节匹配；ASAR 53,161,113 B / `36b80970dd8818d1f1316466b15bed2ed51c2d5da251ef12cc0574ea485b1954`，production metadata、dual-access 与无 env/diagnostics 核对通过。证据 `.diagnostics/comfyui-connections-delivery/package.log`、`frozen-source.json`、`package-audit.json`。
- Bundle诊断exit1，仅既有CSS预算292,392 >270,000 B；initial JS4,310/plugin JS86,613 B合格，无AIDebug泄漏，core/dist advisory超限。按AGENTS开发包规则记录，不宣称正式发布门禁通过；未上传EXE或创建Release/tag。
- 安装和Git最终结果见同目录 `install.json`、`delivery.json` 及 [Progress](../PROGRESS.md)；打包成功本身不构成安装成功。
