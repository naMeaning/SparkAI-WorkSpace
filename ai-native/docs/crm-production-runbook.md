# CRM Production Runbook

本文档只覆盖当前统一产品形态：`IIIMAGE STUDIO` 有一个公开后端入口、一个嵌入的
`new-api` 运行时、一个内部 CRM API 和一个嵌入 `new-api` 前端 GUI。

架构源头见：

```text
docs/new-api-centered-crm-monorepo-governance.md
```

真实线上支付回调和真实提现打款通道尚未实现。线下充值和提现仍是运营审核流程。

## 服务

- `services/ai-gateway`：公开后端入口，构建并启动嵌入的 `new-api`，服务唯一 GUI。
- `services/ai-gateway/new-api`：账号、session、角色、quota、模型路由、计费和用量日志。
- `services/crm-api`：内部 CRM 分销业务服务。
- MySQL：CRM 分销数据。

## 配置文件

使用以下样例作为模板：

```text
services/ai-gateway/.env.example
services/crm-api/.env.example
```

真实 `.env` 和密钥不得提交到 git。生产密钥应由部署平台、secret store 或进程管理器
注入。

## 首次部署

1. 安装依赖：

```bash
pnpm install
```

2. 构建统一产品：

```bash
pnpm run build
```

3. 准备 `new-api` 管理员账号。平台管理权限来自 `new-api role >= 100`，不是 CRM 表。

4. 准备 CRM 服务间调用 `new-api` 的管理凭证：

```text
NEW_API_ADMIN_USER_ID
NEW_API_ADMIN_ACCESS_TOKEN
```

`NEW_API_ADMIN_ACCESS_TOKEN` 必须使用管理员个人资料中生成的“系统访问令牌”，不是
`sk-` 开头的模型 API Key。该凭证只供 `crm-api` 服务端调用 `new-api` 管理接口，不能
作为浏览器登录态，也不得下发到前端。

5. 生成并在 gateway 与 CRM API 两侧配置相同的 embedded identity 签名密钥：

```text
CRM_EMBED_TRUST_SECRET
```

6. 运行 CRM 迁移：

```bash
CRM_DATABASE_URL='mysql://crm_user:password@127.0.0.1:3306/ai_native_crm' pnpm --filter @ai-native/crm-api migrate
```

迁移执行记录保存在 `crm_schema_migrations`。部署时可以重复运行迁移命令；已应用版本会跳过，
新版本按名称顺序执行。迁移失败时应修复数据库权限或 SQL 问题后重跑，不要手工伪造迁移记录。

7. 启动 `services/crm-api`，仅允许 gateway / new-api 或可信内网访问。

8. 启动 `services/ai-gateway`。

9. 将公开 HTTPS 流量指向 `services/ai-gateway`。

平台管理员来自 `new-api` 用户角色。需要创建平台管理员时，在 `new-api` 用户体系中把
对应用户角色设为 `100` 或更高。

## 反向代理要求

- 公网只暴露 `services/ai-gateway`。
- 保留 `Origin`、`Cookie`、`Set-Cookie`、`X-Forwarded-For`、`X-Real-IP`。
- 允许同源 `/api/crm/*` 由 `new-api` proxy 到内部 `services/crm-api`。
- 不要把 `services/crm-api` 直接暴露给公网。
- 生产使用 HTTPS。
- `CRM_ALLOWED_ORIGINS` 设置为准确的公开产品 origin。

CRM API 自身不使用浏览器 session cookie。浏览器 session 属于 `new-api`。

## Smoke

对已运行的 CRM API 执行真实服务 smoke：

```bash
CRM_SMOKE_BASE_URL='https://crm-api.internal.example.com' \
CRM_SMOKE_EMBED_TRUST_SECRET='same-as-production-secret' \
CRM_SMOKE_USER_NEW_API_USER_ID='2002' \
CRM_SMOKE_USERNAME='crm-smoke-user' \
CRM_SMOKE_ADMIN_NEW_API_USER_ID='1' \
CRM_SMOKE_ADMIN_USERNAME='root' \
CRM_SMOKE_STRICT='1' \
pnpm --filter @ai-native/crm-api smoke:real
```

Smoke 构造签名 embedded identity，覆盖：

- `/health`。
- 当前用户 session。
- 注册 2 元权益状态兼容检查。
- 线下充值申请。
- 平台管理审核。
- 用户列表、经营概览、风险单、大客户月结单。

## 运营检查

- `new-api role >= 100` 的用户能进入平台管理。
- 平台管理用户列表不统计 `role >= 100` 用户。
- 普通 new-api 用户首次访问 CRM 后创建 CRM 影子用户。
- New API `QuotaForNewUser` 配置为 `1000000`（按 `500000 quota/RMB` 即 2 元）。
- 新用户注册后额度为 2 元；重复访问和重启 CRM 都不得改变该额度。
- 邀请关系进入 CRM 客户归属，首充 8.8 折权益保留一次。
- 线下充值审核通过后，`new-api` quota、CRM 入账事件、账本和佣金记录一致。
- 线下充值驳回不创建入账事件。
- 人工退款会扣减 `new-api` quota、写退款账本、追回同源佣金，并刷新有效客户状态。
- 模型调用、余额展示和用量流水直接走 `new-api`。
- 用量同步任务幂等写入 `image_consume` 账本。
- CRM 风控或封禁只影响分销权益、提现、佣金释放和运营审核；如需阻断模型调用，
  必须同步禁用或调整 `new-api` 用户状态。
- 凭证附件目录挂载持久化存储。
- 客户端最小事件通过 `POST /api/desktop-client/events` 写入 New API 系统日志；只接收稳定事件码、版本、组件、平台、耗时和聚合次数，不接收提示词、图片路径、项目名、原始错误文本或设备标识。客户端运行观测仍以 New API 为唯一数据源，不复制进 CRM 账本。
- 管理员在 New API 禁用账号后，桌面下载、更新、事件上报和托管 Agent/图片请求会在下一次请求重新核对当前用户状态并立即拒绝，不依赖旧 session 自然过期。

## 入账事件人工对账

当事件处于 `quota_applying`、`local_applying` 或 `reconcile_required` 时：

1. 在 New API 管理后台核对目标用户额度和相关操作记录。
2. 已确认额度加减成功时，选择“确认额度并入账”。接口发送
   `action=confirm_quota_applied`，只继续 CRM 本地事务，不重复调用额度接口。
3. 已确认额度请求完全未执行，且事件没有 `newApiResult` 时，才选择
   `action=cancel`。
4. 已有 `newApiResult`、处于 `local_applying` 或本地入账失败的事件不得取消，应继续本地入账。
5. 对账完成后核对用户 profile、账本、佣金、有效客户和审计日志是否一致。

不要对不明确的额度结果执行自动重试。超时可能发生在 New API 已完成操作但响应未返回之后，
盲目重试会造成重复加款或重复扣款。

## 提现与佣金结清

- 提现提交会原子预留可提现佣金；并发提交不能超出余额。
- 审批、驳回和登记已打款都使用条件状态流转，并发管理员操作只有一个能成功。
- 登记已打款要求外部流水号，系统按佣金创建时间和 ID 执行 FIFO 分配。
- 分配记录保存在 `crm_withdrawal_commission_allocations`，同时累计
  `crm_commissions.released_amount_rmb`。
- 佣金状态 `releasable` 表示仍可用于提现，`released` 表示已通过提现打款结清。
- 当前登记已打款是人工运营动作，不会调用银行、支付宝或微信打款 API。

## 调度监控

`GET /health` 返回三个调度任务：

- `usageSync`
- `effectiveCustomerMaintenance`
- `enterpriseMonthlySettlement`

每个任务包含 `enabled`、`intervalMinutes`、`running`、`lastStartedAt`、`lastSuccessAt`、
`lastFailureAt`、`lastErrorCode` 和 `lastErrorMessage`。建议告警条件：

- 启用后超过两个任务间隔仍无成功记录。
- `lastFailureAt` 晚于 `lastSuccessAt`。
- `running=true` 持续超过一个任务间隔。
- `lastErrorCode` 持续非空。

调度器阻止同一任务重入；失败不会停止后续周期，但必须根据错误信息排查 New API、MySQL
或数据问题。

## 备份与恢复

建议备份：

- `new-api` 数据库或数据目录。
- CRM MySQL 数据库。
- `CRM_ATTACHMENT_STORAGE_DIR`。

恢复顺序：

1. 恢复 `new-api` 数据。
2. 恢复 CRM 数据库。
3. 恢复 CRM 附件目录。
4. 启动服务后通过 smoke 检查 embedded identity 和线下充值链路。
5. 在统一前端检查 New API 余额、用量流水和 CRM 分销数据。

数据库可靠性属于备份、恢复、监控和对账。`new-api`、CRM 数据库和附件目录都需要独立
备份；任何一侧恢复后都要做用户绑定、资产、入账事件、佣金、提现和用量同步水位检查。

## 已知限制

- 真实线上支付回调尚未接入。
- 真实提现打款通道尚未接入。
- 公开注册前仍需要补充更强反作弊，例如验证码、邮箱或手机号验证、设备指纹。
- `pnpm run dev` 默认使用 CRM memory 数据并会随服务重启丢失；需要持久化时使用
  `CRM_DEV_STORAGE=mysql pnpm run dev`。
