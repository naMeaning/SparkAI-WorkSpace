# Task Brief: 图片编辑与 SparkAPI 原生账户体验

## Classification

- Mode: goal / implement / build
- Owner: sparkai_workspace
- User outcome: 完成三项目标：固定 GPT Image Playground/New API/Sub2API 源码核对与当前配置少量实测；完善图片编辑 UI/接口、移除无功能按钮；让登录用户在工作区管理原生密钥、额度和使用日志。
- Why now: 首次请求/小窗口/简洁主题修复之后继续完整 Goal，并沿用用户要求交付 EXE。

## Scope

- In scope: Main 账户 DTO、原生额度显示与输入换算、日志过滤/分页与凭据脱敏；原密钥 owner 的期限/IP/模型/状态/跨组字段及缓存编辑完整性；统一图片编辑/mask 参数与明确拒绝兼容；原主题/Agent 按钮工作保留，按钮归属清单与开发 EXE。
- Explicit non-goals: 外部 New API 管理后台、Extension/线上部署、视频/Seedance、批量模型、付款、真实账户破坏性写入、Git push/发布/签名/实际日常安装。
- Source of truth: 当前 owner 代码与 `docs/CONTEXT_MAP.md` 6.1.1；上游固定 commit、API/证据表在 `docs/UPSTREAM_ACCOUNT_IMAGE_CONTRACT_2026-10-07.md`。
- Decisions: `GOAL.md` 当前完整 Goal；根 ledger D-03/D-05/D-06/D-09/D-12/D-14；用户授权已有 Base URL/API Key 少量测试与 7897 GitHub 代理。

## Acceptance

- 三个项目下载并固定 commit；生成/编辑/mask/async 原生合同有对照，真实请求不重建未知创建。
- 图片结果为真实可解码受管文件；mask 外保持原像素；账户单位来自状态数据，缺失不编造货币，日志过滤/分页由服务端完成。
- 原生密钥 CRUD owner 唯一，Key 保持 Main-only；全量按钮有归属，受影响 UI 有实际点击/可见性/截图；production build 和用户授权开发 EXE 有证据。
- 更新 Goal/Progress、owner/IPC/DTO/测试地图；mock、真实服务、开发打包与正式发布证据明确区分。

## Risk And Authorization

- 已授权公开 GitHub 下载、现有模型连接小量图片验证、本地修复/构建/EXE；不得扩大费用、账户写入或发布。
- 保留原工作树所有未提交改动，不 reset/cleanup；探针凭据只在原 Electron userData 下解密，报告不含 Key/cookie/signed URL。
- 探针发生一次认证轮换未持久化错误，旧 refresh cookie 已失效；现在诊断禁止轮换凭据。用户于 2026-10-07 选择先交付本地结果，重新登录后的真实账户复验 deferred。

## Execution Record

- Implemented: new-api-account/image-mask-compat owner、原生 Drawer/密钥字段、preload/query/DTO、统一 edit 推断/GPT Image 2 参数、按钮审计与生产账户 smoke。
- Verified: 三张真实图片、mask 外 965,601 像素差异 0；账户专项 38 cases；图片/密钥/额度/IPC/登录专项；最小窗口原生账户 6 checks/7 screenshots，静态 441 按钮无未绑定项。最新报告/构建/制品以 PROGRESS 首节为准。
- Verified surface: `.diagnostics/electron/aidebug-2026-10-07T00-45-42-192Z/report.json`，15 场景、0 failures；所有失败报告保留。
- Verified follow-up: 账户 shell/body 实色阅读表面通过两个生产程序 alpha=1/截图。原生额度输入和缓存编辑补项的 Main 专项、typecheck、账户 GUI 7 checks/8 screenshots 已通过，最终 EXE 更新中。
- Unverified: 用户重新登录后的真实只读账户验收；当前服务异步路径和其他部署；真实密钥破坏性写入/支付/视频；正式发布/签名/完整安装卸载。探针不再主动轮换账户凭据。
- 2026-10-07 续做：生产 smoke 复现公开设置删除 serverUserId 后阻止快照加载；设置 account 模式直接读 Main 本地快照，Main 独占认证校验，编辑时仍取得完整元数据。开发/生产测试均覆盖打开管理页后直接编辑缓存条目。
- 用户选择“暂时无法登录，先交付本地结果”：真实账户复验 deferred，当前本地交付继续构建两种最终 EXE；不新增图片请求，不等待登录。
- Final evidence: 两种 production build/开发 EXE、实际生产程序的缓存编辑/主题/账户/独立窗口均通过；当前安装器 UI 19 截图通过。大小/哈希/签名和报告汇总 `.diagnostics/release/local-delivery-01a11418-2026-10-07.json`；两包 NotSigned，正式 CSS 门槛失败，未正式发布。
- Status: complete（用户接受的本地交付）；真实账户后续项 deferred，其他真实上游与正式发布边界仍未验证。
