# CRM API

`@ai-native/crm-api` 是 `IIIMAGE STUDIO` 的内部分销业务服务。它不提供独立
浏览器产品，不拥有账号登录体系。CRM 请求经过嵌入 `new-api` 的同源 CRM proxy：

```text
Browser -> new-api session -> /api/crm/* -> signed embedded identity -> crm-api /crm/*
```

当前源头设计见：

```text
../../docs/new-api-centered-crm-monorepo-governance.md
```

## 边界

`new-api` 负责：

- 登录、注册、session。
- 用户角色。
- quota、模型路由、模型计费和用量日志。
- 支付能力中已经由 `new-api` 原生支持的部分。
- `/api/crm/*` 同源代理和签名身份注入。

`crm-api` 负责：

- CRM 影子用户和分销资料。
- 默认代理身份、代理标签、代理等级、邀请码和直属上级。
- 客户归属、有效客户候选、佣金、提现。
- 线下充值审核、入账事件、账本、退款登记。
- 注册 2 元权益状态兼容；实际额度由 New API 注册配置统一发放。
- 首充 8.8 折权益。
- 风控、审计、系统设置。
- 用于分销结算的 `new-api` 用量同步、分销账本和运营风控。

当前不包含真实线上支付回调和自动提现打款渠道。线下充值、月结收款和提现打款均由
运营人员核验外部凭证后登记，CRM 只负责状态、账务、额度协调和审计。

浏览器账号、session、角色、模型 key 和模型调用限制都由 `new-api` 产品能力处理，
CRM 只接收 gateway 注入的 signed identity，并只保存分销风控字段。

## 身份

`crm-api` 只接受签名 embedded new-api identity headers。身份由
`services/ai-gateway/new-api/controller/crm_proxy.go` 注入，签名密钥为：

```text
CRM_EMBED_TRUST_SECRET
```

权限规则：

```text
new-api role >= 100  平台管理
new-api role < 100   分销中心，默认代理身份
```

用户首次访问 CRM 接口时，`crm-api` 根据当前 `new_api_user_id` 创建或复用
CRM 影子用户。影子用户只保存分销扩展数据，不保存浏览器密码或登录态。

## 当前路由

公开：

| 路径 | 说明 |
| --- | --- |
| `GET /health` | 健康检查。 |

当前用户：

| 路径 | 说明 |
| --- | --- |
| `GET /crm/session/self` | 当前 CRM 用户、首充权益、页面能力和可见菜单。 |
| `POST /crm/attachments` | 上传线下充值或提现凭证，支持 PNG/JPEG/WebP/PDF。 |
| `GET /crm/attachments/:fileName` | 读取凭证附件，需要 embedded 身份。 |
| `GET /crm/agent/dashboard` | 当前代理概览。 |
| `GET /crm/agent/customers` | 当前代理直属客户，支持 `page`、`pageSize`、`keyword`。 |
| `GET /crm/agent/sub-agents` | 当前代理直属下级代理。 |
| `GET /crm/agent/commissions` | 当前代理佣金记录。 |
| `GET /crm/agent/withdrawals` | 当前代理提现记录。 |
| `GET /crm/agent/offline-recharge-requests` | 当前代理线下充值申请记录。 |
| `GET /crm/agent/offline-recharge-settings` | 当前代理可见的支付宝 / 微信收款配置。 |
| `POST /crm/agent/offline-recharge-requests` | 当前代理提交线下充值申请。 |
| `POST /crm/agent/withdrawals` | 当前代理提交提现申请。 |

平台管理：

| 路径 | 说明 |
| --- | --- |
| `GET /crm/modules` | CRM 模块契约。 |
| `GET /crm/admin/dashboard/summary` | 经营概览。 |
| `GET /crm/admin/users` | 分页查询业务用户；排除 `new-api role >= 100` 用户。 |
| `GET /crm/admin/users/:crmUserId` | 查询业务用户详情。 |
| `PATCH /crm/admin/users/:crmUserId/profile` | 更新业务用户资料。 |
| `POST /crm/admin/users/:crmUserId/signup-trial/retry` | 兼容旧数据：把待确认的注册送权益状态标记为已发放，不修改 New API quota。 |
| `GET /crm/admin/agents` | 分页查询代理。 |
| `POST /crm/admin/agents` | 创建或确保代理记录。 |
| `PATCH /crm/admin/agents/:agentId` | 调整代理标签、直属上级或状态。 |
| `POST /crm/admin/agent-relationships` | 绑定或改绑客户归属。 |
| `GET /crm/admin/effective-customers` | 分页查询有效客户候选。 |
| `POST /crm/admin/effective-customers/evaluate` | 复核有效客户候选。 |
| `POST /crm/admin/effective-customers/sync-consumption` | 同步客户消耗并刷新候选。 |
| `POST /crm/admin/effective-customers/maintenance` | 批量维护有效客户和代理等级。 |
| `GET /crm/admin/account-events` | 分页查询入账事件。 |
| `POST /crm/admin/account-events` | 创建人工入账、补偿或异常调整事件。 |
| `POST /crm/admin/account-events/:accountEventId/reconcile` | 人工处理需对账事件。 |
| `POST /crm/admin/account-events/:accountEventId/refund` | 登记人工退款。 |
| `GET /crm/admin/offline-recharge-requests` | 分页查询线下充值申请。 |
| `POST /crm/admin/offline-recharge-requests/:id/approve` | 审核通过线下充值。 |
| `POST /crm/admin/offline-recharge-requests/:id/reject` | 驳回线下充值。 |
| `GET /crm/admin/ledger` | 分页查询账本。 |
| `GET /crm/admin/commissions` | 分页查询佣金。 |
| `POST /crm/admin/commissions/:commissionId/release` | 释放佣金。 |
| `POST /crm/admin/commissions/:commissionId/block` | 阻断佣金。 |
| `POST /crm/admin/commissions/:commissionId/clawback` | 追回佣金。 |
| `GET /crm/admin/withdrawals` | 分页查询提现申请。 |
| `POST /crm/admin/withdrawals/:withdrawalId/approve` | 审核通过提现。 |
| `POST /crm/admin/withdrawals/:withdrawalId/reject` | 驳回提现。 |
| `POST /crm/admin/withdrawals/:withdrawalId/mark-paid` | 登记线下已打款。 |
| `GET /crm/admin/risk-cases` | 分页查询风险单。 |
| `POST /crm/admin/risk-cases` | 创建风险单。 |
| `PATCH /crm/admin/risk-cases/:riskCaseId` | 更新风险单。 |
| `GET /crm/admin/audit-logs` | 分页查询审计日志。 |
| `GET /crm/admin/settings` | 查询系统设置。 |
| `PATCH /crm/admin/settings` | 更新系统设置。 |
| `GET /crm/admin/enterprise/monthly-settlements` | 分页查询大客户月结单。 |
| `POST /crm/admin/enterprise/monthly-settlements/generate` | 生成大客户月结单。 |
| `POST /crm/admin/enterprise/monthly-settlements/:id/mark-paid` | 登记月结已收款。 |
| `POST /crm/admin/enterprise/monthly-settlements/:id/cancel` | 取消月结单。 |

## 响应协议

CRM 业务接口成功响应：

```json
{ "ok": true, "data": {} }
```

分页响应：

```json
{ "items": [], "total": 0, "page": 1, "pageSize": 20 }
```

失败响应：

```json
{ "ok": false, "error_code": "crm_user_required", "err_msg": "请先登录后再继续操作。" }
```

前端只展示 `err_msg`。后端不得向前端暴露 SQL、堆栈、数据库表名或内部异常。

## 入账事件对账

所有会修改 New API quota 的 CRM 操作都通过 `crm_account_events` 协调。额度调用结果不明确
时，系统不会自动重试，以避免重复加减额度。管理员必须先在 New API 后台核对实际额度，
再调用对账接口：

```json
{ "action": "confirm_quota_applied", "reason": "已在 New API 后台确认额度已执行" }
```

该动作不会再次调用 New API，而是把 `quota_applying` 或 `reconcile_required` 事件推进到
本地事务入账。只有已确认额度请求未执行、且事件没有 `newApiResult` 成功证据时，才可取消：

```json
{ "action": "cancel", "reason": "已确认额度请求未执行" }
```

`local_applying` 或已有额度执行证据的事件不得取消，必须继续完成本地账本、佣金和审计。

## 余额、用量和模型调用

CRM 不重复实现 `new-api` 模型计费、余额展示和用量明细。统一中台前端需要展示账户
余额、用户资产或用量流水时，直接调用 New API 已有接口。

聊天、生图和图片编辑请求直接进入 `new-api` 产品接口。CRM 只在分销业务需要时读取
`new-api` 用量事实，用于生成分销侧消耗账本、有效客户候选、佣金记录和大客户月结。

## 脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm --filter @ai-native/crm-api dev` | 使用 `tsx watch` 启动服务。 |
| `pnpm --filter @ai-native/crm-api dev:memory` | 内存模式，供 `pnpm run dev` 本地统一栈使用。 |
| `pnpm --filter @ai-native/crm-api start` | 使用 `tsx` 启动服务。 |
| `pnpm --filter @ai-native/crm-api migrate` | 初始化并迁移 CRM MySQL 数据库。 |
| `pnpm --filter @ai-native/crm-api smoke:real` | 对已运行服务执行 embedded identity smoke。 |
| `pnpm --filter @ai-native/crm-api typecheck` | TypeScript 检查。 |
| `pnpm --filter @ai-native/crm-api test` | Node test runner 测试。 |
| `pnpm --filter @ai-native/crm-api check` | typecheck + test。 |

根目录只保留统一产品入口：

```bash
pnpm run dev
pnpm run start
pnpm run crm:check
```

根目录只提供统一产品启动和校验脚本。

`pnpm run dev` 默认让 CRM 使用内存模式。需要本地持久化 CRM MySQL 时，使用：

```bash
CRM_DEV_STORAGE=mysql pnpm run dev
```

本地统一栈会同时启动 New API gateway、CRM API 和前端 dev server。调 UI 时访问
`http://127.0.0.1:17862/crm`；该入口支持前端热更新，并将 `/api`、`/mj`、`/pg`
代理到 `http://127.0.0.1:17860`。`17860` 仍是 gateway 和嵌入式产物入口。

未显式设置 `CRM_DATABASE_URL` 时，MySQL 模式默认使用
`mysql://root@127.0.0.1:3306/ai_native_crm`，并在启动 CRM API 前自动执行当前迁移。

## 配置

默认监听：

```text
http://127.0.0.1:17861
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CRM_API_PORT` | `17861` | CRM API 服务端口。 |
| `CRM_API_HOST` | `127.0.0.1` | CRM API 监听地址；容器间访问时设为 `0.0.0.0`。 |
| `PORT` | 无 | 通用端口变量，低优先级兼容。 |
| `CRM_DEV_STORAGE` | `memory` | 统一本地栈 CRM 存储模式；可设为 `mysql` 使用持久化 CRM MySQL。 |
| `CRM_DATABASE_URL` | 必填 | MySQL 连接字符串，例如 `mysql://root:pass@127.0.0.1:3306/ai_native_crm`；服务启动需要持久化数据库。 |
| `CRM_DATABASE_NAME` | `ai_native_crm` | 迁移脚本创建的数据库名。 |
| `NEW_API_BASE_URL` | `http://127.0.0.1:17860` | `new-api` 服务地址。 |
| `IIIMAGE_WEB_PORT` | `17862` | 根目录 `pnpm run dev` 启动的前端热更新服务端口。 |
| `NEW_API_ADMIN_USER_ID` | 无 | 服务间调用 `new-api` 管理接口的管理员用户 ID。 |
| `NEW_API_ADMIN_ACCESS_TOKEN` | 无 | 服务间调用 `new-api` 管理接口的管理员系统 access token；来自管理员个人资料的“系统访问令牌”，不是 `sk-` 模型 API Key。内存模式未同时配置管理员 ID 和该令牌时仅模拟额度与用量调用。 |
| `CRM_QUOTA_PER_RMB` | `500000` | RMB 到 `new-api` quota 的换算倍率。 |
| `CRM_EMBED_TRUST_SECRET` | 本地默认，生产必填 | embedded identity 签名密钥，必须和 gateway 一致。 |
| `CRM_ALLOWED_ORIGINS` | 非生产默认 `*` | credentialed CORS 允许来源。 |
| `CRM_USAGE_SYNC_MAINTENANCE_INTERVAL_MINUTES` | 非生产 `0`，生产 `15` | 全量用量同步任务间隔。 |
| `CRM_EFFECTIVE_CUSTOMER_MAINTENANCE_INTERVAL_MINUTES` | 非生产 `0`，生产 `60` | 有效客户维护任务间隔。 |
| `CRM_ENTERPRISE_MONTHLY_SETTLEMENT_INTERVAL_MINUTES` | 非生产 `0`，生产 `1440` | 大客户月结任务间隔。 |
| `CRM_ATTACHMENT_STORAGE_DIR` | `data/attachments` | 凭证附件存储目录。 |
| `CRM_ATTACHMENT_MAX_BYTES` | `5242880` | 单个凭证附件大小上限。 |

环境变量样例见 [`.env.example`](./.env.example)。

## 真实服务 smoke

`smoke:real` 面向已运行的 CRM API，不启动服务。它使用签名 embedded identity。

核心变量：

| 变量 | 说明 |
| --- | --- |
| `CRM_SMOKE_BASE_URL` | 已运行的 CRM API 地址。 |
| `CRM_SMOKE_EMBED_TRUST_SECRET` | 与服务端一致的 embedded identity 签名密钥。 |
| `CRM_SMOKE_USER_NEW_API_USER_ID` | 普通 new-api 用户 ID。 |
| `CRM_SMOKE_USERNAME` | 普通用户显示名。 |
| `CRM_SMOKE_ADMIN_NEW_API_USER_ID` | 可选，平台管理 new-api 用户 ID。 |
| `CRM_SMOKE_ADMIN_USERNAME` | 可选，平台管理显示名。 |
| `CRM_SMOKE_STRICT` | 设置 `1` 时缺少配置或服务不可达会失败。 |

## 数据库

初始化命令：

```bash
CRM_DATABASE_URL='mysql://root:password@127.0.0.1:3306/ai_native_crm' pnpm --filter @ai-native/crm-api migrate
```

迁移按名称记录在 `crm_schema_migrations`，缺失版本按顺序执行，已完成版本不会重复执行。
迁移可以在每次部署启动前安全重复运行；不得手工删除迁移记录来绕过失败版本。

当前 CRM 表：

```text
crm_users
crm_user_profiles
crm_agents
crm_agent_relationships
crm_account_events
crm_ledger_entries
crm_commissions
crm_effective_customers
crm_enterprise_monthly_settlements
crm_withdrawals
crm_offline_recharge_requests
crm_risk_cases
crm_audit_logs
crm_settings
crm_schema_migrations
crm_withdrawal_commission_allocations
```

`crm_user_profiles` 只保存分销业务资料，不保存 New API 余额、用户资产或模型服务封禁字段。

提现登记已打款时，系统在一个事务内按佣金创建时间和 ID 进行 FIFO 分配，写入
`crm_withdrawal_commission_allocations`，更新 `released_amount_rmb`，并将完全支付的佣金标记为
`released`。`released` 表示已经通过提现打款结清，不是仍可提现余额。

## 调度健康

`GET /health` 的 `schedulers` 字段包含 `usageSync`、`effectiveCustomerMaintenance` 和
`enterpriseMonthlySettlement`。每个快照包含：

```text
enabled intervalMinutes running
lastStartedAt lastSuccessAt lastFailureAt
lastErrorCode lastErrorMessage
```

生产监控应在启用任务长时间没有 `lastSuccessAt`、连续出现 `lastFailureAt`、或 `running`
超过一个任务间隔时告警。调度器会阻止同一任务重入，但不会隐藏最近一次失败。

## 验证

```bash
pnpm --filter @ai-native/crm-api check
pnpm run verify:workspace
```

本机 MySQL 集成验证使用随机临时数据库并在结束后删除：

```bash
CRM_TEST_DATABASE_URL='mysql://root@127.0.0.1:3306/ai_native_crm_test' \
pnpm --filter @ai-native/crm-api exec tsx --test src/db/mysql.integration.test.ts
```

涉及 shared contracts 时同时运行：

```bash
pnpm --filter @ai-native/crm-contracts check
```
