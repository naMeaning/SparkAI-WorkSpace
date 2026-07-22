import {
  agentCategories,
  defaultCrmSettings,
  signupTrialGrantStatuses,
  withdrawalMethods,
  type CrmSettingsDto
} from "@ai-native/crm-contracts";
import type {
  AccountEventRecord,
  AgentDto,
  AgentRelationshipDto,
  AuditLogEntryDto,
  CommissionDto,
  CrmUserProfileDto,
  CrmUserRecord,
  EffectiveCustomerDto,
  EnterpriseMonthlySettlementDto,
  LedgerEntryDto,
  OfflineRechargeRequestDto,
  RiskCaseDto,
  WithdrawalCommissionAllocationDto,
  WithdrawalDto
} from "../types.js";
import type { DbRow } from "./mysql-support.js";

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function numberValue(value: unknown): number {
  return Number(value || 0);
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

export function jsonValue(value: unknown): unknown {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

export function mergeSettingsWithDefaults(value: unknown): CrmSettingsDto {
  const stored = value && typeof value === "object" ? value as Partial<CrmSettingsDto> : {};
  return {
    ...defaultCrmSettings,
    ...stored,
    agentCommissionRuleSets: stored.agentCommissionRuleSets || defaultCrmSettings.agentCommissionRuleSets,
    parentAgentServiceFeeRules: stored.parentAgentServiceFeeRules || defaultCrmSettings.parentAgentServiceFeeRules,
    platformCommissionCaps: stored.platformCommissionCaps || defaultCrmSettings.platformCommissionCaps,
    effectiveCustomerRules: stored.effectiveCustomerRules || defaultCrmSettings.effectiveCustomerRules,
    withdrawalMinAmountRmb: stored.withdrawalMinAmountRmb ?? defaultCrmSettings.withdrawalMinAmountRmb,
    enterpriseDefaultFixedCommissionPerImage: stored.enterpriseDefaultFixedCommissionPerImage ?? defaultCrmSettings.enterpriseDefaultFixedCommissionPerImage,
    offlineRechargeAccounts: stored.offlineRechargeAccounts || defaultCrmSettings.offlineRechargeAccounts
  };
}

export function defaultProfile(crmUserId: number): CrmUserProfileDto {
  return {
    crmUserId,
    phone: "",
    wechat: "",
    remark: "",
    cumulativePaidRmb: 0,
    isEnterprise: false,
    enterprisePriceRmb: null,
    enterpriseFixedCommissionPerImage: null,
    isRisk: false
  };
}

export function mapProfile(row: DbRow | undefined): CrmUserProfileDto | null {
  if (!row) return null;
  return {
    crmUserId: numberValue(row.crm_user_id),
    phone: stringValue(row.phone),
    wechat: stringValue(row.wechat),
    remark: stringValue(row.remark),
    cumulativePaidRmb: numberValue(row.cumulative_paid_rmb),
    isEnterprise: Boolean(row.is_enterprise),
    enterprisePriceRmb: nullableNumber(row.enterprise_price_rmb),
    enterpriseFixedCommissionPerImage: nullableNumber(row.enterprise_fixed_commission_per_image),
    isRisk: Boolean(row.is_risk)
  };
}

export function mapCrmUser(row: DbRow | undefined): CrmUserRecord | null {
  if (!row) return null;
  return {
    id: numberValue(row.id),
    username: stringValue(row.username),
    email: stringValue(row.email),
    newApiUserId: nullableNumber(row.new_api_user_id),
    newApiRole: numberValue(row.new_api_role) || 1,
    firstTopupDiscountRate: nullableNumber(row.first_topup_discount_rate),
    firstTopupDiscountUsedAt: row.first_topup_discount_used_at ? String(row.first_topup_discount_used_at) : null,
    signupTrialGrantStatus: (stringValue(row.signup_trial_grant_status) || signupTrialGrantStatuses.granted) as CrmUserRecord["signupTrialGrantStatus"],
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined
  };
}

export function mapAgent(row: DbRow | undefined): AgentDto | null {
  if (!row) return null;
  return {
    id: numberValue(row.id),
    crmUserId: numberValue(row.crm_user_id),
    username: stringValue(row.crm_username) || undefined,
    email: stringValue(row.crm_email) || undefined,
    status: stringValue(row.status) as AgentDto["status"],
    category: (stringValue(row.category) || agentCategories.normal) as AgentDto["category"],
    inviteCode: stringValue(row.invite_code),
    parentAgentId: nullableNumber(row.parent_agent_id),
    parentAgentCrmUserId: nullableNumber(row.parent_agent_crm_user_id),
    parentAgentUsername: stringValue(row.parent_agent_username) || undefined,
    level: (stringValue(row.level) || "standard") as AgentDto["level"],
    effectivePaidCustomerCount: numberValue(row.effective_paid_customer_count),
    levelEffectiveAt: row.level_effective_at ? String(row.level_effective_at) : null,
    levelExpiresAt: row.level_expires_at ? String(row.level_expires_at) : null,
    lastLevelEvaluatedAt: row.last_level_evaluated_at ? String(row.last_level_evaluated_at) : null,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined
  };
}

export function mapRelationship(row: DbRow | undefined): AgentRelationshipDto | null {
  if (!row) return null;
  return {
    id: numberValue(row.id),
    customerCrmUserId: numberValue(row.customer_crm_user_id),
    customerUsername: stringValue(row.customer_username) || undefined,
    agentCrmUserId: numberValue(row.agent_crm_user_id),
    agentUsername: stringValue(row.agent_username) || undefined,
    bindSource: stringValue(row.bind_source) as AgentRelationshipDto["bindSource"],
    status: stringValue(row.status) as AgentRelationshipDto["status"],
    bindReason: stringValue(row.bind_reason)
  };
}

export function mapAccountEvent(row: DbRow | undefined): AccountEventRecord | null {
  if (!row) return null;
  return {
    id: numberValue(row.id),
    eventType: stringValue(row.event_type) as AccountEventRecord["eventType"],
    crmUserId: numberValue(row.crm_user_id),
    crmUsername: stringValue(row.crm_username),
    operatorCrmUserId: nullableNumber(row.operator_crm_user_id),
    operatorUsername: stringValue(row.operator_username),
    amountRmb: numberValue(row.amount_rmb),
    paidAmountRmb: numberValue(row.paid_amount_rmb),
    discountAmountRmb: numberValue(row.discount_amount_rmb),
    commissionBaseRmb: numberValue(row.commission_base_rmb),
    quotaDelta: numberValue(row.quota_delta),
    status: stringValue(row.status) as AccountEventRecord["status"],
    idempotencyKey: stringValue(row.idempotency_key),
    reason: stringValue(row.reason),
    newApiResult: jsonValue(row.new_api_result),
    metadata: jsonValue(row.metadata_json),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : null
  };
}

export function mapLedger(row: DbRow): LedgerEntryDto {
  return {
    id: numberValue(row.id),
    crmUserId: numberValue(row.crm_user_id),
    crmUsername: stringValue(row.crm_username),
    direction: stringValue(row.direction) as LedgerEntryDto["direction"],
    amountRmb: numberValue(row.amount_rmb),
    paidAmountRmb: numberValue(row.paid_amount_rmb),
    discountAmountRmb: numberValue(row.discount_amount_rmb),
    commissionBaseRmb: numberValue(row.commission_base_rmb),
    balanceAfterRmb: numberValue(row.balance_after_rmb),
    eventType: stringValue(row.event_type) as LedgerEntryDto["eventType"],
    sourceType: stringValue(row.source_type),
    sourceId: nullableNumber(row.source_id),
    idempotencyKey: stringValue(row.idempotency_key),
    operatorCrmUserId: nullableNumber(row.operator_crm_user_id),
    operatorUsername: stringValue(row.operator_username),
    reason: stringValue(row.reason),
    isPaid: Boolean(row.is_paid),
    createdAt: row.created_at ? String(row.created_at) : undefined
  };
}

export function mapCommission(row: DbRow): CommissionDto {
  return {
    id: numberValue(row.id),
    sourceType: stringValue(row.source_type),
    sourceId: numberValue(row.source_id),
    beneficiaryCrmUserId: numberValue(row.beneficiary_crm_user_id),
    beneficiaryUsername: stringValue(row.beneficiary_username) || undefined,
    customerCrmUserId: numberValue(row.customer_crm_user_id),
    customerUsername: stringValue(row.customer_username) || undefined,
    commissionType: stringValue(row.commission_type) as CommissionDto["commissionType"],
    orderKind: stringValue(row.order_kind) as CommissionDto["orderKind"],
    agentLevel: stringValue(row.agent_level) as CommissionDto["agentLevel"],
    status: stringValue(row.status) as CommissionDto["status"],
    baseAmountRmb: numberValue(row.base_amount_rmb),
    rate: numberValue(row.rate),
    amountRmb: numberValue(row.commission_amount_rmb),
    releasedAmountRmb: numberValue(row.released_amount_rmb),
    riskCaseId: nullableNumber(row.risk_case_id),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined
  };
}

export function mapEffectiveCustomer(row: DbRow | undefined): EffectiveCustomerDto | null {
  if (!row) return null;
  return {
    id: numberValue(row.id),
    agentId: numberValue(row.agent_id),
    agentCrmUserId: nullableNumber(row.agent_crm_user_id) ?? undefined,
    agentUsername: stringValue(row.agent_username) || undefined,
    customerCrmUserId: numberValue(row.customer_crm_user_id),
    customerUsername: stringValue(row.customer_username) || undefined,
    customerEmail: stringValue(row.customer_email) || undefined,
    firstPaidEventId: numberValue(row.first_paid_event_id),
    firstPaidAmountRmb: numberValue(row.first_paid_amount_rmb),
    firstPaidAt: row.first_paid_at ? String(row.first_paid_at) : "",
    sevenDayCheckedAt: row.seven_day_checked_at ? String(row.seven_day_checked_at) : null,
    paidBalanceConsumedRate: numberValue(row.paid_balance_consumed_rate),
    isRefunded: Boolean(row.is_refunded),
    isRelatedAccount: Boolean(row.is_related_account),
    isRisk: Boolean(row.is_risk),
    isEffective: Boolean(row.is_effective),
    countedForLevel: Boolean(row.counted_for_level)
  };
}

export function mapWithdrawal(row: DbRow): WithdrawalDto {
  return {
    id: numberValue(row.id),
    beneficiaryCrmUserId: numberValue(row.beneficiary_crm_user_id),
    beneficiaryUsername: stringValue(row.beneficiary_username) || undefined,
    amountRmb: numberValue(row.amount_rmb),
    payoutMethod: (stringValue(row.payout_method) || withdrawalMethods.alipay) as WithdrawalDto["payoutMethod"],
    payoutAccountName: stringValue(row.payout_account_name),
    payoutAccount: stringValue(row.payout_account),
    payoutBankName: stringValue(row.payout_bank_name),
    status: stringValue(row.status) as WithdrawalDto["status"],
    reviewerCrmUserId: nullableNumber(row.reviewer_crm_user_id),
    reviewerUsername: stringValue(row.reviewer_username) || undefined,
    reviewReason: stringValue(row.review_reason),
    paidReference: stringValue(row.paid_reference),
    paidEvidenceUrl: stringValue(row.paid_evidence_url),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    paidAt: row.paid_at ? String(row.paid_at) : null
  };
}

export function mapWithdrawalCommissionAllocation(row: DbRow): WithdrawalCommissionAllocationDto {
  return {
    id: numberValue(row.id),
    withdrawalId: numberValue(row.withdrawal_id),
    commissionId: numberValue(row.commission_id),
    amountRmb: numberValue(row.amount_rmb),
    createdAt: row.created_at ? String(row.created_at) : undefined
  };
}

export function mapOfflineRechargeRequest(row: DbRow): OfflineRechargeRequestDto {
  return {
    id: numberValue(row.id),
    crmUserId: numberValue(row.crm_user_id),
    crmUsername: stringValue(row.crm_username) || undefined,
    method: stringValue(row.method) as OfflineRechargeRequestDto["method"],
    amountRmb: numberValue(row.amount_rmb),
    payerName: stringValue(row.payer_name),
    paymentReference: stringValue(row.payment_reference),
    paymentEvidenceUrl: stringValue(row.payment_evidence_url),
    notes: stringValue(row.notes),
    status: stringValue(row.status) as OfflineRechargeRequestDto["status"],
    reviewerCrmUserId: nullableNumber(row.reviewer_crm_user_id),
    reviewerUsername: stringValue(row.reviewer_username) || undefined,
    reviewReason: stringValue(row.review_reason),
    accountEventId: nullableNumber(row.account_event_id),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null
  };
}

export function mapEnterpriseMonthlySettlement(row: DbRow): EnterpriseMonthlySettlementDto {
  return {
    id: numberValue(row.id),
    crmUserId: numberValue(row.crm_user_id),
    crmUsername: stringValue(row.crm_username) || undefined,
    period: stringValue(row.period),
    usageRmb: numberValue(row.usage_rmb),
    ledgerEntryCount: numberValue(row.ledger_entry_count),
    status: stringValue(row.status) as EnterpriseMonthlySettlementDto["status"],
    paidReference: stringValue(row.paid_reference),
    paidEvidenceUrl: stringValue(row.paid_evidence_url),
    notes: stringValue(row.notes),
    generatedAt: row.generated_at ? String(row.generated_at) : undefined,
    paidAt: row.paid_at ? String(row.paid_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined
  };
}

export function mapRiskCase(row: DbRow): RiskCaseDto {
  return {
    id: numberValue(row.id),
    targetType: stringValue(row.target_type),
    targetId: stringValue(row.target_id),
    riskType: stringValue(row.risk_type),
    status: stringValue(row.status) as RiskCaseDto["status"],
    evidence: jsonValue(row.evidence_json),
    notes: stringValue(row.notes),
    blocksWithdrawal: Boolean(row.blocks_withdrawal),
    blocksCommissionRelease: Boolean(row.blocks_commission_release),
    createdByCrmUserId: numberValue(row.created_by_crm_user_id),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined
  };
}

export function mapAudit(row: DbRow): AuditLogEntryDto {
  return {
    id: numberValue(row.id),
    operatorCrmUserId: numberValue(row.operator_crm_user_id),
    operatorUsername: stringValue(row.operator_username),
    targetType: stringValue(row.target_type),
    targetId: stringValue(row.target_id),
    action: stringValue(row.action),
    reason: stringValue(row.reason),
    beforeSnapshot: jsonValue(row.before_snapshot),
    afterSnapshot: jsonValue(row.after_snapshot),
    requestIp: stringValue(row.request_ip),
    userAgent: stringValue(row.user_agent),
    createdAt: row.created_at ? String(row.created_at) : undefined
  };
}
