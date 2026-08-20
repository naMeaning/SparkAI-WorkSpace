# CRM Contracts

`@ai-native/crm-contracts` 是 CRM 前后端共享契约包。跨端可见的 DTO、枚举、模块定义和稳定业务常量都先在这里收敛，再由 `services/crm-api` 和 `services/ai-gateway/new-api/web/default` 消费。

## 当前内容

当前契约必须服务 [`docs/new-api-centered-crm-monorepo-governance.md`](../../docs/new-api-centered-crm-monorepo-governance.md) 的业务模型：

- `new-api` 是账号、登录态、角色、quota、模型计费和用量日志源头。
- CRM 只保存分销影子用户和业务扩展数据。
- 所有普通 `new-api` 用户默认都是代理；`role >= 100` 是平台管理。
- 代理标签分为普通代理和深度合作代理。
- 普通代理和深度合作代理佣金规则独立配置。

当前导出内容覆盖代理层级、代理标签和非支付运营闭环：

```ts
crmModules
crmPageCapabilities
crmRolePageGroups
agentStatuses
agentCategories
agentLevels
standardAgentLevelRules
agentCommissionRuleSets
parentAgentServiceFeeRules
platformCommissionCaps
effectiveCustomerRules
accountEventTypes
accountEventStatuses
ledgerEventTypes
ledgerDirections
agentRelationshipBindSources
agentRelationshipStatuses
commissionTypes
commissionStatuses
orderKinds
riskStatuses
withdrawalStatuses
offlineRechargeMethods
offlineRechargeStatuses
defaultOfflineRechargeAccounts
defaultCrmSettings
CrmUserProfileDto
CrmUserDto
CrmSessionDto
CrmApiSuccessPayload
CrmApiErrorPayload
CrmApiPayload
PageResult
AgentDto
AgentRelationshipDto
AgentCustomerDto
CrmAgentDashboardDto
AccountEventDto
LedgerEntryDto
CrmUsageLogDto
CrmUsageSyncResultDto
EffectiveCustomerMaintenanceResultDto
CommissionDto
EffectiveCustomerDto
WithdrawalDto
OfflineRechargeRequestDto
OfflineRechargeAccount
RiskCaseDto
AuditLogEntryDto
CrmSettingsDto
```

## 业务常量

- 所有普通 `new-api` 用户默认都是代理，代理记录和随机邀请码由 CRM 自动确保；CRM 影子用户使用 `new_api_user_id` 绑定当前登录用户。
- 新用户首次进入 CRM 分销模块后由 CRM 幂等发放 2 元 New API 试用额度；有效邀请码只绑定客户归属并保留一次首充 8.8 折。
- 代理标签由超管维护：普通代理、深度合作代理。
- 普通代理和深度合作代理佣金规则独立配置。
- 默认普通代理等级按有效付费客户数升级：45% / 50% / 55% / 60% 首单佣金，复购佣金为 13.5% / 15% / 16.5% / 18%。
- 直属上级代理服务费由平台额外支付：首单 10%，复购 3%。
- 平台总佣金封顶：首单 70%，复购 21%。
- 保存佣金规则时必须校验代理佣金比例加直属上级服务费不超过平台封顶。
- `online_topup` 只作为未来支付事件类型预留。
- `OfflineRechargeRequestDto.paymentEvidenceUrl` 和 `WithdrawalDto.paidEvidenceUrl` 分别承载线下充值付款凭证链接和线下打款凭证链接；链接只是运营凭证字段，不表示已接入真实支付或真实打款通道。
- `offlineRechargeMethods` 和 `offlineRechargeStatuses` 描述代理线下充值申请和超管审核状态；审核通过后由 CRM API 创建统一入账事件。
- `OfflineRechargeAccount` 和 `defaultOfflineRechargeAccounts` 描述支付宝 / 微信线下收款配置，包括收款方、账号、二维码链接和转账说明；该配置属于 `CrmSettingsDto.offlineRechargeAccounts`。
- `ledgerEventTypes` 覆盖入账、试用金、模型消耗、佣金冻结、佣金释放、佣金提现和佣金追回；佣金阻断只记录状态和审计，不产生资金流水。
- `commissionTypes.enterpriseFixedPerImage` 用于大客户图片消耗的固定单张佣金；该佣金由 CRM API 根据 `new-api` 消耗日志生成，前端只消费最终佣金 DTO。

## 使用场景

- 嵌入 `new-api` 的 CRM 页面和 `crm-api` 共享 DTO、枚举、模块定义和接口契约。
- CRM 前后端共享 API envelope：成功为 `{ ok: true, data }`，失败为 `{ ok: false, error_code, err_msg }`；`err_msg` 是后端返回给前端直接展示的中文文案。
- 列表接口使用 `PageResult<T>`；代理侧直属客户使用 `AgentCustomerDto`，包含用户名、邮箱和绑定关系，内部 CRM 用户 ID 只作为行 key 和管理端操作标识。
- 分销业务结构变更时，优先把跨端稳定契约放在这里。
- 不放具体服务实现，也不放 UI 组件。

## 脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm --filter @ai-native/crm-contracts typecheck` | 使用 TypeScript 检查共享契约。 |
| `pnpm --filter @ai-native/crm-contracts test` | 使用 Node test runner + `tsx` 运行契约测试。 |
| `pnpm --filter @ai-native/crm-contracts check` | 先 typecheck，再运行契约测试。 |
