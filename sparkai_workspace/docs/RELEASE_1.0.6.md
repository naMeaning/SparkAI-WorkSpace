# naimage 1.0.6 发布说明

版本日期：2026-07-27

1.0.6 聚焦 New API 双接入、图片长连接稳定性、模型分组、登录恢复、设备授权和桌面交互可靠性。桌面端继续保持单 Agent、无限画布和本地项目资产边界；服务端账号、额度、渠道、计费和激活授权由工作区中的 New API 扩展负责。

## 本次更新

- 新增两种接入模式：账号密码登录 SparkAPI/New API Session Relay，或自行配置 OpenAI-compatible Base URL、API Key、Agent 模型与图片模型；两种模式严格隔离凭据。
- 账号模式可读取并选择 New API 用户分组，分组进入模型目录、Chat/Responses 和 Images Relay，由服务端继续执行权限、渠道选择、额度扣除和用量记录。
- 新增随机安装 ID 与激活码授权：服务端只保存激活码和授权令牌哈希，客户端支持 24 小时校验缓存与 72 小时离线宽限；账号 Relay 可由服务端强制授权。
- 图片生成与编辑统一最多 10 路并发，优先使用 Images SSE 和最多三张中间预览；不支持流式时仅回退一次非流式请求。
- 恢复 Node 原生 HTTP 为默认传输，新增仅作用于 naimage 请求的可选 HTTP(S) 代理；不修改 Git、系统或环境的全局代理配置。
- 修复 Images 请求的 JSON/multipart 参数归一化、空流、错误回退和连接超时处理，避免把成功但无最终图片的响应误报为完成。
- Base URL、API Key 或接入模式修改后可立即保存，不再被旧渠道模型列表的加载状态阻塞。
- 启动时优先恢复本地缓存身份，再后台校验用户会话和日志；修复 Agent 在旧任务结束后不能可靠承接新用户请求的问题。
- 更新黄色 SparkAI/naimage 品牌图标、登录与安装器视觉，并保持陶土暖色默认主题与画布背景联动。
- 加固图片恢复、选择菜单、AskUser 重载和 Requirement GUI 的确定性；Requirement 默认专项不再重复执行完整 Layer Stack。

## 架构与服务边界

- 账号服务、Session Relay 和更新服务默认地址均为 `https://sparkapi.org`；Relay 地址留空时继承账号服务地址。
- 账号模式使用 `/naimage/v1/*`，携带 New API session、用户 ID、可选模型分组与设备授权；客户端不接触服务端托管渠道 Key。
- 自定义模式使用标准 `/v1/models`、`/v1/chat/completions`、`/v1/responses`、`/v1/images/generations` 和 `/v1/images/edits`，只发送用户明确配置的 API Key，不发送 SparkAPI cookie 或分组。
- 更新继续使用签名 `naimage-studio` manifest、SHA-256、Restart ASAR 和完整安装器。私有 GitHub 仓库 Token 不进入客户端；在线更新由 SparkAPI 更新服务提供受控清单和下载。

## 正式发布物

- Windows x64 安装包：`naimage-Setup-1.0.6-x64.exe`
- Restart 更新资源：`naimage-Restart-Update-1.0.6-x64.asar`
- 更新清单：`desktop-release.json`
- 完整性与签名：manifest sidecar、制品 sidecar 和 `SHA256SUMS`
- Authenticode：未配置商业代码签名证书时为 `NotSigned`；应用内部更新仍使用 Ed25519 与 SHA-256 验证。

## 正式发布结果

- 私有 GitHub Release：[naimage 1.0.6](https://github.com/naMeaning/naimage/releases/tag/v1.0.6)
- 发布 tag/源码提交：`v1.0.6` → `9f1d290e67ad1ea5572fb25555ce5a5593b58d88`
- Windows 安装包：`175,511,552` 字节；SHA-256 `6e6e7064008b97a10315845897e77811aa6a4cb06e440944a381863fd44c3077`
- Restart ASAR：`49,423,860` 字节；SHA-256 `cdd2590030f6f29a0c291f901d3ff3bff30e950eecda9dc738fa4fe9f3f850fd`
- `desktop-release.json`：SHA-256 `71ce116cd4320735a0ef90c894effc8469ad46213574dfdbab8680b327119248`
- 安装包 sidecar：SHA-256 `09d7747dc2542f82cc632da4e6f89bd4c57d3f2f9606fc223e91782351451b3c`
- Manifest Ed25519 签名验证通过；EXE Authenticode 为 `NotSigned`。
- GitHub 复核：Release 为正式版、仓库保持 `PRIVATE`、5 项资产均为 `uploaded`，GitHub 返回的四项制品 digest 与本地正式清单一致。

## 验证契约

- `release:verify`：39 项类型、协议、项目、图片、GUI、性能、构建、Bundle 和更新门禁。
- `package:win`、`package:smoke`：正式安装包及解压程序运行。
- `package:installer-smoke`：隔离安装、重装、卸载、快捷方式、数据保留/清理、外部项目保护、故障回滚与进程锁。
- `test:update`、`test:update-helper`、`package:update-e2e`：签名更新、辅助进程与 1.0.5 → 1.0.6 重启升级。
- `release:sha-verify`：Setup、Restart ASAR、manifest、sidecar 和校验清单相互一致。

只有同一次 `corepack pnpm run release:final` 完整成功并清除 `release/.naimage-release-incomplete.json` 后，才允许创建 GitHub `v1.0.6` Release。详细顺序见 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)。

本次正式验证使用安全失败点续跑：前 29 项门禁来自源码稳定的失败报告，修复只涉及 Requirement 测试/续跑器及其文档，并由显式 allowlist 校验；从 `requirement GUI` 开始的 10 项门禁及全部打包、安装、更新、签名和哈希步骤重新真实执行。权威证据：

- 正式编排：`.diagnostics/release/final-release-2026-07-27T03-28-55-841Z/orchestrator-report.json`
- 39 项门禁与续跑来源：`.diagnostics/release/verify-2026-07-27T03-29-00-769Z/report.json`
- 品牌安装器 UI：`.diagnostics/release/branded-installer-ui-2026-07-27T03-34-08-491Z/report.json`
- 打包程序 smoke：`.diagnostics/release/packaged-smoke-2026-07-27T03-34-58-453Z/report.json`
- 隔离安装/重装/卸载：`.diagnostics/release/installer-smoke-2026-07-27T03-35-01-861Z/report.json`
- 1.0.5 → 1.0.6 Restart 更新：`.diagnostics/release/restart-update-e2e-2026-07-27T03-36-31-293Z/report.json`

## 已知边界

- 原生 New API 可以直接用于账号、额度和标准 OpenAI-compatible 文本能力；要使用账号 Session Relay、设备激活、桌面更新和针对 Images SSE/分组的完整行为，需要部署工作区中的 New API 扩展。
- 上游渠道不支持标准 Images SSE 时客户端会回退非流式请求，但无法消除上游本身的超时、限流、空结果或模型不兼容。
- 私有 GitHub Release 适合作为受控发布存档，不应通过把长期 GitHub Token 内置进桌面端来实现公开更新。
