# 统一 New API 分销中台落地实施文档

本文档按当前设计落地：统一中台前端同时调用 New API 和 CRM，CRM 后端只保留分销扩展能力。

## 第一阶段：清理展示型 New API 复制逻辑

目标：

- 代理侧用量流水由前端直接调用 New API `/api/log/self`。
- CRM 用量同步领域逻辑只服务有效客户、佣金和大客户月结。
- 文档按统一前端双接口边界描述余额和用量。

改动：

- `services/ai-gateway/new-api/web/default/src/features/crm/api.ts`
  - 增加 New API 用量查询方法。
  - 删除 CRM usage logs 调用。
- `services/ai-gateway/new-api/web/default/src/features/crm/index.tsx`
  - 代理侧用量流水使用 New API 用量接口。
  - 展示字段按 New API log 数据映射。
- `services/crm-api/src/server.ts`
  - 只保留分销扩展路由。
- `services/crm-api/src/scripts/smoke-real.ts`
  - smoke 覆盖 CRM 分销业务链路。
- 测试
  - 保留用量同步、有效客户、佣金和月结相关测试。

## 第二阶段：余额事实源收敛

目标：

- New API 是余额事实源。
- 中台前端余额展示优先来自 New API `/api/user/self` 或 New API 管理接口。
- CRM 只保留业务流程中的金额事件、分销账本和结算快照。

改动：

- 代理侧账户余额展示来自 New API `/api/user/self`。
- CRM 用户列表不展示 CRM profile 余额。
- CRM 用户资料接口不把余额当普通资料字段编辑，`crm_user_profiles` 不保存余额字段。
- New API 注册流程按 `QuotaForNewUser` 一次性发放试用金；CRM 不再重复修改注册送额度。
- CRM 线下充值和退款继续调用 New API quota 接口并写 CRM 业务记录。
- CRM 账本中的 `balanceAfterRmb` 是分销业务账本快照，由 CRM 账本流水累计得出，不是 New API 余额副本。

## 第三阶段：中台能力归属整理

目标：

- 已敲定中台能力不删。
- New API 已有能力复用 New API 接口或组件。
- CRM 只扩展分销能力。

改动：

- 梳理平台管理页面：
  - 用户资产、quota、token、渠道、模型、New API 系统设置归 New API。
  - 邀请、客户归属、代理、佣金、提现、线下充值、风控、审计、大客户月结归 CRM。
- 统一页面可以组合两边接口，但不在 CRM API 中复制 New API 通用管理接口。

## UI 回归核对

当前统一前端以 `feat/crm` 的嵌入式 CRM 页面为基线核对，保留同一组 CRM 菜单：

- 分销中心：经营概览、我的客户、团队代理、佣金明细、提现记录、线下充值、用量流水。
- 平台管理：经营概览、用户管理、代理管理、客户归属、有效客户、入账事件、账本流水、佣金管理、线下充值审核、提现审核、风控、大客户、审计日志、系统设置。

当前实现相对基线的变化：

- CRM 工作区隐藏 New API 顶部导航、账户跳转项和侧栏返回入口，避免用户进入 New API 原后台。
- 代理侧余额与用量流水来自 New API；CRM 只展示分销权益、收款信息、提现和佣金等业务数据。
- 平台管理列表保持分页与搜索能力，并为运营队列提供筛选表单。
- 客户归属页使用专用归属列，展示客户、归属代理、绑定来源、首充权益和关系状态。
- 涉及 CRM 用户的管理表单使用用户搜索选择器，避免要求运营人员直接填写 CRM ID。
- 代理管理页支持编辑已有代理的类型、状态和直属上级。
- 风控单按关联对象类型切换输入方式：用户对象使用用户选择器，佣金、提现、大客户月结等对象使用对象标识输入框。
- 线下充值、提现、佣金、入账事件、有效客户复核、风控状态、大客户月结等审核操作使用页面内确认弹窗，不使用浏览器 `prompt`。
- 系统设置页可编辑佣金规则、上级服务费、平台封顶、提现门槛、大客户默认佣金和线下收款信息。

## 第四阶段：生产保障

目标：

- 把数据库可靠性归到运维层。
- 不再用数据库丢失解释架构解耦。

改动：

- runbook 写清 New API DB、CRM DB、附件目录分别备份和恢复。
- 增加恢复后一致性检查清单。
- 增加 CRM 用量同步、有效客户维护、大客户月结任务的监控项。

## 验证命令

每阶段至少运行：

```bash
pnpm run check
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

涉及 New API Go 控制器时，再运行对应 Go 测试或构建。
