# New API Centered CRM And Monorepo Governance

本文档是当前 `naimage` 产品形态、CRM 职责和仓库治理的源头说明。

## 产品边界

`naimage` 只有一个对外产品入口：

```text
Browser / Client
  -> services/ai-gateway
  -> services/ai-gateway/new-api
```

CRM 是统一产品里的内部分销业务服务。统一前端可以同时调用 New API 原生接口和
CRM 分销接口：

```text
naimage frontend
  -> New API native APIs for account, assets, usage, model and admin capabilities
  -> /api/crm/* for CRM distribution capabilities
```

核心原则：

- `new-api` 负责账号、登录态、角色、quota、模型路由、模型计费和用量日志。
- `crm-api` 负责分销、客户归属、账本、佣金、提现、线下充值、风控和审计。
- `services/ai-gateway/new-api/web/default` 是唯一 GUI。
- `services/ai-gateway` 是唯一公开后端入口。
- `services/crm-api` 只作为内部服务运行，CRM 请求经 New API CRM proxy 进入。
- New API 已有能力不在 CRM API 中重写，统一前端直接调用 New API。
- CRM 业务 DTO 和常量先放在 `packages/crm-contracts`，再由前后端消费。

## 仓库结构

```text
services/
  ai-gateway/
    new-api/
      web/default/
  crm-api/

packages/
  crm-contracts/
  shared/

scripts/
docs/
```

职责：

| 路径 | 职责 |
| --- | --- |
| `services/ai-gateway` | 统一后端入口，构建并启动内嵌 New API。 |
| `services/ai-gateway/new-api` | New API 后端、账号、session、角色、quota、模型计费和 CRM proxy。 |
| `services/ai-gateway/new-api/web/default` | 唯一前端 GUI，承载用户中心、分销中心和平台管理。 |
| `services/crm-api` | 内部分销业务服务。 |
| `packages/crm-contracts` | CRM 共享 DTO、枚举、显示常量和模块契约。 |
| `packages/shared` | 跨包通用运行时工具。 |

根目录脚本围绕统一产品组织：

```bash
pnpm run dev
pnpm run start
pnpm run build
pnpm run check
pnpm run crm:check
```

本地 `pnpm run dev` 会启动 New API gateway、CRM API 和前端 dev server。开发页面访问
`http://127.0.0.1:17862`，该入口支持前端热更新并代理到 `http://127.0.0.1:17860`。
`17860` 保留为 gateway 和生产嵌入式产物入口。

## 身份和权限

浏览器登录态来自 `new-api`。CRM API 只读取 gateway 注入的 embedded identity：

```text
x-crm-embed-user-id
x-crm-embed-username-b64
x-crm-embed-display-name-b64
x-crm-embed-email-b64
x-crm-embed-role
x-crm-embed-inviter-id
x-crm-embed-timestamp
x-crm-embed-nonce
x-crm-embed-signature
```

签名密钥：

```text
CRM_EMBED_TRUST_SECRET
```

权限规则：

```text
new-api role >= 100  平台管理
new-api role < 100   分销中心，默认代理身份
```

用户首次访问 CRM 接口时，CRM 按 embedded identity 中的 `new_api_user_id` 创建或复用
CRM 影子用户。CRM 影子用户保存分销扩展资料，不保存浏览器密码、浏览器 session 或
用户可见模型 key。

平台管理用户进入 CRM 后可看到平台管理页面，但不会计入业务用户数，也不会出现在业务
用户列表里。

## 注册、邀请和试用额度

注册由 `new-api` 完成。注册页可带邀请码字段，New API 将邀请人标识通过 CRM proxy
传给 `crm-api`。

CRM 首次看到普通用户时执行以下业务初始化：

1. 创建 CRM 影子用户。
2. 如果 embedded identity 带邀请人 ID，确保邀请人成为代理并绑定客户归属。
3. 为被邀请用户保留一次首充 8.8 折权益。
4. 将注册送权益兼容状态置为已发放，不修改 New API quota。

2 元注册送额度由 New API 注册流程根据 `QuotaForNewUser=1000000` 一次性写入。CRM session、
重复访问和 CRM 重启都不得再次增加额度。平台管理保留旧的 retry 路由仅用于把历史 pending
状态确认为 granted，不调用额度管理接口。

## 模型调用、余额和用量

聊天、生图、图片编辑和模型列表由 New API 产品接口提供。CRM 不参与实时模型请求链路。

余额展示、用户资产管理和用量明细展示直接来自 New API。CRM 不为 UI 展示复制 New API
余额、用户资产或用量日志。

CRM 只在分销业务需要时读取 New API 用量事实，并生成以下 CRM 业务数据：

- 分销侧消耗账本。
- 有效客户候选。
- 佣金释放或阻断的判断依据。
- 大客户月结用量。

## 充值、退款和佣金

当前已实现线下充值审核流：

```text
用户提交线下充值申请
  -> 平台管理审核通过
  -> CRM 调用 New API 增加 quota
  -> CRM 写入 account event
  -> CRM 写入 ledger
  -> CRM 按客户归属生成佣金
```

首充折扣规则：

- 邀请关系带来一次首充 8.8 折权益。
- 审核通过的第一次充值按折后实付、折扣金额和佣金基数分别入账。
- 权益使用后记录 `first_topup_discount_used_at`。

退款规则：

- 平台管理人工登记退款。
- CRM 调用 New API 扣减 quota。
- CRM 写入退款账本。
- 同源佣金进入追回或冲正流程。
- 有效客户状态重新计算。

真实线上支付回调和真实提现打款通道尚未接入。现阶段充值和提现均为运营审核流程。

## 代理和客户归属

所有普通用户默认可进入分销中心。代理能力由 `crm_agents` 表承载：

- `category = normal`：普通代理。
- `category = deep_cooperation`：深度合作代理。
- `level = standard | advanced | enterprise`：代理等级。
- `invite_code`：CRM 生成的邀请码。
- `parent_agent_id`：直属上级代理。

客户归属由 `crm_agent_relationships` 承载。当前支持：

- 注册邀请绑定。
- 平台管理手动绑定或改绑。
- 归属状态保留在 CRM，不写入 New API。

## 有效客户和等级

有效客户候选来自充值与消耗同步。CRM 维护以下判断材料：

- 首次付费事件。
- 7 天窗口内付费余额消耗率。
- 退款状态。
- 关联账号和风险状态。
- 是否已计入代理等级。

平台管理可手动复核候选，也可触发批量维护任务。代理等级刷新后写回 `crm_agents`。

## 风控和审计

CRM 风控影响分销权益、提现、佣金释放和运营审核。CRM 不保存模型服务封禁字段；
模型调用权限仍由 New API 用户状态、渠道配置、模型配置和 quota 决定。

审计日志记录平台管理操作：

- 操作人 CRM 用户 ID。
- 目标类型和目标 ID。
- 动作。
- 原因。
- 变更前后快照。
- 请求 IP 和 User-Agent。

## 当前 API

公开：

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 健康检查。 |

当前用户：

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/crm/session/self` | 当前 CRM 用户、首充权益、页面能力和可见菜单。 |
| `POST` | `/crm/attachments` | 上传线下充值或提现凭证。 |
| `GET` | `/crm/attachments/:fileName` | 读取凭证附件。 |
| `GET` | `/crm/agent/dashboard` | 当前代理概览。 |
| `GET` | `/crm/agent/customers` | 当前代理直属客户。 |
| `GET` | `/crm/agent/sub-agents` | 当前代理直属下级代理。 |
| `GET` | `/crm/agent/commissions` | 当前代理佣金记录。 |
| `GET` | `/crm/agent/withdrawals` | 当前代理提现记录。 |
| `GET` | `/crm/agent/offline-recharge-requests` | 当前代理线下充值申请记录。 |
| `GET` | `/crm/agent/offline-recharge-settings` | 当前代理可见收款配置。 |
| `POST` | `/crm/agent/offline-recharge-requests` | 当前代理提交线下充值申请。 |
| `POST` | `/crm/agent/withdrawals` | 当前代理提交提现申请。 |
平台管理：

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/crm/modules` | CRM 模块契约。 |
| `GET` | `/crm/admin/dashboard/summary` | 经营概览。 |
| `GET` | `/crm/admin/users` | 分页查询业务用户。 |
| `GET` | `/crm/admin/users/:crmUserId` | 查询业务用户详情。 |
| `PATCH` | `/crm/admin/users/:crmUserId/profile` | 更新业务用户资料。 |
| `POST` | `/crm/admin/users/:crmUserId/signup-trial/retry` | 兼容旧数据：确认注册送权益状态，不修改 New API quota。 |
| `GET` | `/crm/admin/agents` | 分页查询代理。 |
| `POST` | `/crm/admin/agents` | 创建或确保代理记录。 |
| `PATCH` | `/crm/admin/agents/:agentId` | 调整代理标签、直属上级或状态。 |
| `POST` | `/crm/admin/agent-relationships` | 绑定或改绑客户归属。 |
| `GET` | `/crm/admin/effective-customers` | 分页查询有效客户候选。 |
| `POST` | `/crm/admin/effective-customers/evaluate` | 复核有效客户候选。 |
| `POST` | `/crm/admin/effective-customers/sync-consumption` | 同步客户消耗并刷新候选。 |
| `POST` | `/crm/admin/effective-customers/maintenance` | 批量维护有效客户和代理等级。 |
| `GET` | `/crm/admin/account-events` | 分页查询入账事件。 |
| `POST` | `/crm/admin/account-events` | 创建人工入账、补偿或异常调整事件。 |
| `POST` | `/crm/admin/account-events/:accountEventId/reconcile` | 人工处理需对账事件。 |
| `POST` | `/crm/admin/account-events/:accountEventId/refund` | 登记人工退款。 |
| `GET` | `/crm/admin/offline-recharge-requests` | 分页查询线下充值申请。 |
| `POST` | `/crm/admin/offline-recharge-requests/:id/approve` | 审核通过线下充值。 |
| `POST` | `/crm/admin/offline-recharge-requests/:id/reject` | 驳回线下充值。 |
| `GET` | `/crm/admin/ledger` | 分页查询账本。 |
| `GET` | `/crm/admin/commissions` | 分页查询佣金。 |
| `POST` | `/crm/admin/commissions/:commissionId/release` | 释放佣金。 |
| `POST` | `/crm/admin/commissions/:commissionId/block` | 阻断佣金。 |
| `POST` | `/crm/admin/commissions/:commissionId/clawback` | 追回佣金。 |
| `GET` | `/crm/admin/withdrawals` | 分页查询提现申请。 |
| `POST` | `/crm/admin/withdrawals/:withdrawalId/approve` | 审核通过提现。 |
| `POST` | `/crm/admin/withdrawals/:withdrawalId/reject` | 驳回提现。 |
| `POST` | `/crm/admin/withdrawals/:withdrawalId/mark-paid` | 登记线下已打款。 |
| `GET` | `/crm/admin/risk-cases` | 分页查询风险单。 |
| `POST` | `/crm/admin/risk-cases` | 创建风险单。 |
| `PATCH` | `/crm/admin/risk-cases/:riskCaseId` | 更新风险单。 |
| `GET` | `/crm/admin/audit-logs` | 分页查询审计日志。 |
| `GET` | `/crm/admin/settings` | 查询系统设置。 |
| `PATCH` | `/crm/admin/settings` | 更新系统设置。 |
| `GET` | `/crm/admin/enterprise/monthly-settlements` | 分页查询大客户月结单。 |
| `POST` | `/crm/admin/enterprise/monthly-settlements/generate` | 生成大客户月结单。 |
| `POST` | `/crm/admin/enterprise/monthly-settlements/:id/mark-paid` | 登记月结已收款。 |
| `POST` | `/crm/admin/enterprise/monthly-settlements/:id/cancel` | 取消月结单。 |

## 响应协议

成功：

```json
{ "ok": true, "data": {} }
```

分页：

```json
{ "items": [], "total": 0, "page": 1, "pageSize": 20 }
```

失败：

```json
{ "ok": false, "error_code": "crm_user_required", "err_msg": "请先登录后再继续操作。" }
```

前端展示 `err_msg`。后端不得向前端暴露 SQL、堆栈、数据库表名或内部异常。

## 数据库

CRM 迁移脚本定义当前 schema：

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
```

关键关系：

- `crm_users.new_api_user_id` 绑定 New API 用户身份。
- `crm_users.new_api_role` 缓存角色，用于页面能力和后台过滤。
- `crm_user_profiles.crm_user_id` 保存 CRM 业务资料，不保存 New API 余额或用户资产。
- `crm_agents.crm_user_id` 保存代理资料和邀请码。
- `crm_agent_relationships.customer_crm_user_id` 保存客户归属。
- `crm_account_events` 保存充值、退款、补偿和试用额度事件。
- `crm_ledger_entries` 保存用户侧账本。
- `crm_commissions` 保存佣金记录。
- `crm_effective_customers` 保存有效客户候选和复核状态。

本地开发库如与当前 schema 不一致，可直接重建 CRM 数据库后重新运行迁移。

## 配置

CRM API：

| 变量 | 说明 |
| --- | --- |
| `CRM_API_PORT` | CRM API 服务端口，默认 `17861`。 |
| `CRM_API_HOST` | CRM API 监听地址，默认 `127.0.0.1`。 |
| `CRM_DEV_STORAGE` | 统一本地栈 CRM 存储模式，默认 `memory`，可设为 `mysql`。 |
| `NAIMAGE_WEB_PORT` | 本地前端 dev server 端口，默认 `17862`。 |
| `CRM_DATABASE_URL` | MySQL 连接字符串。 |
| `CRM_DATABASE_NAME` | CRM 数据库名，默认 `ai_native_crm`。 |
| `NEW_API_BASE_URL` | New API 服务地址。 |
| `NEW_API_ADMIN_USER_ID` | CRM 服务端调用 New API 管理接口的管理员用户 ID。 |
| `NEW_API_ADMIN_ACCESS_TOKEN` | CRM 服务端调用 New API 管理接口的 access token。 |
| `CRM_QUOTA_PER_RMB` | RMB 到 New API quota 的换算倍率。 |
| `CRM_EMBED_TRUST_SECRET` | embedded identity 签名密钥。 |
| `CRM_ALLOWED_ORIGINS` | CRM API CORS 来源。 |
| `CRM_USAGE_SYNC_MAINTENANCE_INTERVAL_MINUTES` | 用量同步任务间隔。 |
| `CRM_EFFECTIVE_CUSTOMER_MAINTENANCE_INTERVAL_MINUTES` | 有效客户维护任务间隔。 |
| `CRM_ENTERPRISE_MONTHLY_SETTLEMENT_INTERVAL_MINUTES` | 大客户月结任务间隔。 |
| `CRM_ATTACHMENT_STORAGE_DIR` | 凭证附件目录。 |
| `CRM_ATTACHMENT_MAX_BYTES` | 单个凭证大小上限。 |

## 前端治理

前端只在 `services/ai-gateway/new-api/web/default` 中实现。这个统一前端可以按需调用
New API 原生接口和 CRM 分销接口：

- 用户中心展示 New API 余额、CRM 首充权益和试用额度状态。
- 分销中心展示代理概览、客户、下级代理、佣金、提现、线下充值和 New API 用量流水。
- 平台管理展示经营概览、业务用户、代理、客户归属、有效客户、账本、佣金、
  线下充值、提现、风控、审计、系统设置和大客户月结。
- 平台管理的代理、客户归属、有效客户、风控和结算动作应使用当前 CRM 业务语义：
  代理可编辑类型、状态和直属上级；客户归属展示归属代理和绑定来源；高风险审核动作
  通过页面内确认弹窗提交。
- 页面能力来自 `/crm/session/self` 的 `capabilities` 和 `pageGroups`。
- 普通用户只看到分销中心；`role >= 100` 用户只看到平台管理。

CRM 分销请求通过 New API 同源 `/api/crm/*` 进入，不直接请求内部 CRM API。

## 测试和校验

常规校验：

```bash
pnpm run verify:workspace
pnpm run check
```

CRM 后端单独校验：

```bash
pnpm run crm:check
```

New API 前端 CRM 相关改动：

```bash
cd services/ai-gateway/new-api/web/default
bun run typecheck
bun test \
  src/features/crm/section.test.ts \
  src/features/crm/column-policy.test.ts \
  src/features/crm/display.test.ts \
  src/features/crm/operations-coverage.test.ts \
  src/features/crm/settings-form.test.ts \
  src/components/layout/lib/crm-shell-visibility.test.ts \
  src/components/layout/lib/sidebar-view-registry.test.ts
```

真实服务 smoke：

```bash
CRM_SMOKE_BASE_URL='http://127.0.0.1:17861' \
CRM_SMOKE_EMBED_TRUST_SECRET='local-dev-secret' \
CRM_SMOKE_USER_NEW_API_USER_ID='2002' \
CRM_SMOKE_USERNAME='crm-smoke-user' \
CRM_SMOKE_ADMIN_NEW_API_USER_ID='1' \
CRM_SMOKE_ADMIN_USERNAME='root' \
CRM_SMOKE_STRICT='1' \
pnpm --filter @ai-native/crm-api smoke:real
```

## 发布检查

发布前确认：

- New API 能登录、注册并保持 session。
- `role >= 100` 用户能进入平台管理。
- 普通用户能进入分销中心。
- 普通用户首次进入 CRM 后生成 CRM 影子用户和代理资料。
- New API `QuotaForNewUser=1000000`，新用户注册后获得 2 元额度。
- 重复访问和重启 CRM 后用户额度保持不变，CRM 不生成注册送额度账本。
- 邀请注册能绑定客户归属并保留首充 8.8 折权益。
- 线下充值通过后 New API quota、CRM 入账事件、账本和佣金一致。
- 线下充值驳回不生成入账事件。
- New API 用量流水能在中台页面展示。
- CRM 用量同步能生成分销账本和有效客户候选。
- 平台管理用户不计入业务用户数。
- 风控、提现、佣金、审计和大客户月结页面能分页查询。
- 凭证附件目录使用持久化存储。
- 真实线上支付回调和真实提现打款通道接入前，产品文案保持运营审核口径。
