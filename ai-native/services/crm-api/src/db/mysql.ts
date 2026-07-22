import { createPool, type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import {
  accountEventStatuses,
  agentCategories,
  commissionStatuses,
  defaultCrmSettings,
  enterpriseMonthlySettlementStatuses,
  ledgerDirections,
  ledgerEventTypes,
  signupTrialGrantStatuses,
  withdrawalMethods,
  type AgentCustomerDto,
  type CrmSettingsDto
} from "@ai-native/crm-contracts";
import type {
  AccountEventInput,
  AccountEventRecord,
  AuditLogEntryCreate,
  AuditLogEntryDto,
  CommissionCreateInput,
  CommissionDto,
  CrmConfig,
  CrmRepository,
  CrmUserCreateInput,
  CrmUserIdentityUpdateInput,
  CrmUserProfileDto,
  CrmUserRecord,
  EffectiveCustomerDto,
  EffectiveCustomerSaveInput,
  EnterpriseMonthlySettlementDto,
  LedgerEntryCreate,
  LedgerEntryDto,
  OfflineRechargeRequestDto,
  RiskCaseCreateInput,
  RiskCaseDto,
  RiskCasePatch,
  WithdrawalCreateInput,
  WithdrawalCommissionAllocationDto,
  WithdrawalDto,
  WithdrawalPatch,
  AgentDto,
  AgentRelationshipDto
} from "../types.js";
import { buildDatabaseUrl } from "./migrations.js";
import { formatMysqlTimestamp } from "../time.js";
import { httpError } from "../http.js";
import { getCrmRequestContext } from "../request-context.js";

type DbRow = RowDataPacket & Record<string, unknown>;

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return Number(value || 0);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function jsonValue(value: unknown): unknown {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function mergeSettingsWithDefaults(value: unknown): CrmSettingsDto {
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

function defaultProfile(crmUserId: number): CrmUserProfileDto {
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

function mapProfile(row: DbRow | undefined): CrmUserProfileDto | null {
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

function mapCrmUser(row: DbRow | undefined): CrmUserRecord | null {
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

function mapAgent(row: DbRow | undefined): AgentDto | null {
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

function mapRelationship(row: DbRow | undefined): AgentRelationshipDto | null {
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

function mapAccountEvent(row: DbRow | undefined): AccountEventRecord | null {
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

function mapLedger(row: DbRow): LedgerEntryDto {
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

function mapCommission(row: DbRow): CommissionDto {
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

function mapEffectiveCustomer(row: DbRow | undefined): EffectiveCustomerDto | null {
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

function mapWithdrawal(row: DbRow): WithdrawalDto {
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

function mapWithdrawalCommissionAllocation(row: DbRow): WithdrawalCommissionAllocationDto {
  return {
    id: numberValue(row.id),
    withdrawalId: numberValue(row.withdrawal_id),
    commissionId: numberValue(row.commission_id),
    amountRmb: numberValue(row.amount_rmb),
    createdAt: row.created_at ? String(row.created_at) : undefined
  };
}

function mapOfflineRechargeRequest(row: DbRow): OfflineRechargeRequestDto {
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

function mapEnterpriseMonthlySettlement(row: DbRow): EnterpriseMonthlySettlementDto {
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

function mapRiskCase(row: DbRow): RiskCaseDto {
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

function mapAudit(row: DbRow): AuditLogEntryDto {
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

export function buildBusinessUserScope({
  userAlias
}: {
  userAlias: string;
}): { joinSql: string; whereParts: string[]; params: number[] } {
  return {
    joinSql: "",
    whereParts: [`${userAlias}.new_api_role < ?`],
    params: [100]
  };
}

type MysqlQueryExecutor = Pick<Pool, "query">;

interface MysqlRepositoryExecutorOptions {
  transactional?: boolean;
  close?: () => Promise<void>;
  withTransaction?: <T>(work: (repository: CrmRepository) => Promise<T>) => Promise<T>;
}

export function createMysqlRepositoryForExecutor(
  executor: MysqlQueryExecutor,
  options: MysqlRepositoryExecutorOptions = {}
): CrmRepository {
  let repository: CrmRepository;
  repository = {
    async close() {
      await options.close?.();
    },

    async withTransaction(work) {
      if (options.transactional) return work(repository);
      if (!options.withTransaction) {
        throw new Error("CRM repository transaction support is not configured");
      }
      return options.withTransaction(work);
    },

    async createCrmUser(input: CrmUserCreateInput) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_users
          (username, email, new_api_user_id, new_api_role, first_topup_discount_rate,
           signup_trial_grant_status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          input.username,
          input.email || "",
          input.newApiUserId || null,
          input.newApiRole ?? 1,
          input.firstTopupDiscountRate || null,
          input.signupTrialGrantStatus || signupTrialGrantStatuses.granted
        ]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_users WHERE id = ? LIMIT 1", [result.insertId]);
      const mapped = mapCrmUser(rows[0]);
      if (!mapped) throw new Error("CRM user was not found after insert");
      return mapped;
    },

    async getCrmUserById(crmUserId) {
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_users WHERE id = ? LIMIT 1", [crmUserId]);
      return mapCrmUser(rows[0]);
    },

    async getCrmUserByUsername(username) {
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_users WHERE username = ? LIMIT 1", [username]);
      return mapCrmUser(rows[0]);
    },

    async getCrmUserByNewApiUserId(newApiUserId) {
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_users WHERE new_api_user_id = ? LIMIT 1", [newApiUserId]);
      return mapCrmUser(rows[0]);
    },

    async updateCrmUserIdentity(crmUserId, input: CrmUserIdentityUpdateInput) {
      await executor.query(
        `UPDATE crm_users
         SET username = ?, email = ?, new_api_role = ?
         WHERE id = ?`,
        [input.username, input.email, input.newApiRole, crmUserId]
      );
      const user = await this.getCrmUserById(crmUserId);
      if (!user) throw new Error("CRM user not found");
      return user;
    },

    async listCrmUsers({
      page = 1,
      pageSize = 20,
      keyword = "",
      excludeSuperAdmins = false,
      hasAgentRelationship = false,
      enterpriseOnly = false
    } = {}) {
      const search = `%${keyword}%`;
      const businessScope = excludeSuperAdmins
        ? buildBusinessUserScope({
          userAlias: "crm_users"
        })
        : null;
      const whereParts = [
        ...(keyword ? ["(crm_users.username LIKE ? OR crm_users.email LIKE ?)"] : []),
        ...(hasAgentRelationship ? ["relationship.id IS NOT NULL"] : []),
        ...(enterpriseOnly ? ["profile.is_enterprise = 1"] : []),
        ...(businessScope ? businessScope.whereParts : [])
      ];
      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
      const params = [...(keyword ? [search, search] : []), ...(businessScope ? businessScope.params : [])];
      const joins = [
        businessScope?.joinSql || "",
        hasAgentRelationship
          ? `LEFT JOIN crm_agent_relationships relationship
             ON relationship.customer_crm_user_id = crm_users.id
              AND relationship.status = 'active'`
          : "",
        enterpriseOnly
          ? "JOIN crm_user_profiles profile ON profile.crm_user_id = crm_users.id"
          : ""
      ].filter(Boolean).join("\n");
      const from = `FROM crm_users ${joins}`;
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total ${from} ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT crm_users.* ${from} ${where} ORDER BY crm_users.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map((row) => mapCrmUser(row)).filter((row): row is CrmUserRecord => Boolean(row)),
        total: numberValue(countRows[0]?.total)
      };
    },

    async markFirstTopupDiscountUsed(crmUserId, usedAt) {
      await executor.query(
        "UPDATE crm_users SET first_topup_discount_used_at = ? WHERE id = ? AND first_topup_discount_used_at IS NULL",
        [usedAt, crmUserId]
      );
      const user = await this.getCrmUserById(crmUserId);
      if (!user) throw new Error("CRM user not found");
      return user;
    },

    async markSignupTrialGrantStatus(crmUserId, status) {
      await executor.query(
        "UPDATE crm_users SET signup_trial_grant_status = ? WHERE id = ?",
        [status, crmUserId]
      );
      const user = await this.getCrmUserById(crmUserId);
      if (!user) throw new Error("CRM user not found");
      return user;
    },

    async getUserProfile(crmUserId) {
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_user_profiles WHERE crm_user_id = ? LIMIT 1", [crmUserId]);
      return mapProfile(rows[0]) || defaultProfile(crmUserId);
    },

    async saveUserProfile(profile) {
      await executor.query(
        `INSERT INTO crm_user_profiles
          (crm_user_id, phone, wechat, remark, cumulative_paid_rmb,
           is_enterprise, enterprise_price_rmb, enterprise_fixed_commission_per_image, is_risk)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          phone = VALUES(phone),
          wechat = VALUES(wechat),
          remark = VALUES(remark),
          cumulative_paid_rmb = VALUES(cumulative_paid_rmb),
          is_enterprise = VALUES(is_enterprise),
          enterprise_price_rmb = VALUES(enterprise_price_rmb),
          enterprise_fixed_commission_per_image = VALUES(enterprise_fixed_commission_per_image),
          is_risk = VALUES(is_risk)`,
        [
          profile.crmUserId,
          profile.phone,
          profile.wechat,
          profile.remark,
          profile.cumulativePaidRmb,
          profile.isEnterprise ? 1 : 0,
          profile.enterprisePriceRmb,
          profile.enterpriseFixedCommissionPerImage,
          profile.isRisk ? 1 : 0
        ]
      );
      return this.getUserProfile(profile.crmUserId);
    },

    async findAccountEventByIdempotencyKey(idempotencyKey) {
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE idempotency_key = ? LIMIT 1", [idempotencyKey]);
      return mapAccountEvent(rows[0]);
    },

    async getAccountEventById(id) {
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      return mapAccountEvent(rows[0]);
    },

    async createAccountEvent(record) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_account_events
          (event_type, crm_user_id, operator_crm_user_id, amount_rmb, paid_amount_rmb, discount_amount_rmb,
           commission_base_rmb, quota_delta, idempotency_key, reason, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.eventType,
          record.crmUserId,
          record.operatorCrmUserId,
          record.amountRmb,
          record.paidAmountRmb,
          record.discountAmountRmb,
          record.commissionBaseRmb,
          record.quotaDelta,
          record.idempotencyKey,
          record.reason,
          JSON.stringify(record.metadata || null)
        ]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [result.insertId]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event was not found after insert");
      return mapped;
    },

    async markAccountEventQuotaApplying(id) {
      const [result] = await executor.query<ResultSetHeader>(
        "UPDATE crm_account_events SET status = 'quota_applying' WHERE id = ? AND status = 'pending'",
        [id]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event not found");
      return { ...mapped, didMutate: result.affectedRows > 0 };
    },

    async markAccountEventQuotaApplied(id, patch) {
      const [result] = await executor.query<ResultSetHeader>(
        "UPDATE crm_account_events SET status = 'quota_applied', new_api_result = ? WHERE id = ? AND status IN ('quota_applying', 'reconcile_required', 'cancelled')",
        [JSON.stringify(patch.newApiResult || null), id]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event not found");
      return { ...mapped, didMutate: result.affectedRows > 0 };
    },

    async markAccountEventLocalApplying(id) {
      const [result] = await executor.query<ResultSetHeader>(
        "UPDATE crm_account_events SET status = 'local_applying' WHERE id = ? AND status = 'quota_applied'",
        [id]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event not found");
      return { ...mapped, didMutate: result.affectedRows > 0 };
    },

    async completeAccountEvent(id, patch) {
      await executor.query(
        "UPDATE crm_account_events SET status = 'completed', quota_delta = ?, new_api_result = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'local_applying'",
        [patch.quotaDelta, JSON.stringify(patch.newApiResult || null), id]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event not found");
      return mapped;
    },

    async markAccountEventReconcileRequired(id, reason) {
      await executor.query(
        `UPDATE crm_account_events
         SET status = ?,
             metadata_json = JSON_SET(COALESCE(metadata_json, JSON_OBJECT()), '$.reconcileReason', ?)
         WHERE id = ?`,
        [accountEventStatuses.reconcileRequired, reason, id]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event not found");
      return mapped;
    },

    async cancelAccountEvent(id, reason) {
      const [result] = await executor.query<ResultSetHeader>(
        `UPDATE crm_account_events
         SET status = ?,
             metadata_json = JSON_SET(COALESCE(metadata_json, JSON_OBJECT()), '$.cancelReason', ?)
         WHERE id = ?
           AND status IN (?, ?, ?)
           AND new_api_result IS NULL`,
        [
          accountEventStatuses.cancelled,
          reason,
          id,
          accountEventStatuses.pending,
          accountEventStatuses.quotaApplying,
          accountEventStatuses.reconcileRequired
        ]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event not found");
      return { ...mapped, didMutate: result.affectedRows > 0 };
    },

    async listAccountEvents({ crmUserId, eventType, status, page = 1, pageSize = 20 } = {}) {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (crmUserId) {
        clauses.push("event.crm_user_id = ?");
        params.push(crmUserId);
      }
      if (eventType) {
        clauses.push("event.event_type = ?");
        params.push(eventType);
      }
      if (status) {
        clauses.push("event.status = ?");
        params.push(status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const [countRows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total FROM crm_account_events event ${where}`,
        params
      );
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          event.*,
          crm_user.username AS crm_username,
          operator.username AS operator_username
         FROM crm_account_events event
         LEFT JOIN crm_users crm_user ON crm_user.id = event.crm_user_id
         LEFT JOIN crm_users operator ON operator.id = event.operator_crm_user_id
         ${where}
         ORDER BY event.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map((row) => mapAccountEvent(row)).filter((row): row is AccountEventRecord => Boolean(row)),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async insertLedgerEntry(entry) {
      if (!options.transactional) {
        return this.withTransaction((transactionRepository) => transactionRepository.insertLedgerEntry(entry));
      }
      await executor.query(
        "SELECT id FROM crm_users WHERE id = ? FOR UPDATE",
        [entry.crmUserId]
      );
      const [existingRows] = await executor.query<DbRow[]>(
        "SELECT * FROM crm_ledger_entries WHERE idempotency_key = ? LIMIT 1 FOR UPDATE",
        [entry.idempotencyKey]
      );
      if (existingRows[0]) {
        return { ...mapLedger(existingRows[0]), didMutate: false };
      }
      const [balanceRows] = await executor.query<DbRow[]>(
        `SELECT COALESCE(SUM(CASE WHEN direction = ? THEN amount_rmb ELSE -amount_rmb END), 0) AS balance
         FROM crm_ledger_entries
         WHERE crm_user_id = ?`,
        [ledgerDirections.credit, entry.crmUserId]
      );
      const signedAmount = entry.direction === ledgerDirections.credit ? entry.amountRmb : -entry.amountRmb;
      const balanceAfterRmb = roundMoney(numberValue(balanceRows[0]?.balance) + signedAmount);
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_ledger_entries
          (crm_user_id, direction, amount_rmb, paid_amount_rmb, discount_amount_rmb, commission_base_rmb,
           balance_after_rmb, event_type, source_type, source_id, idempotency_key, operator_crm_user_id, reason, is_paid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.crmUserId,
          entry.direction,
          entry.amountRmb,
          entry.paidAmountRmb || 0,
          entry.discountAmountRmb || 0,
          entry.commissionBaseRmb || 0,
          balanceAfterRmb,
          entry.eventType,
          entry.sourceType,
          entry.sourceId || null,
          entry.idempotencyKey,
          entry.operatorCrmUserId || null,
          entry.reason || "",
          entry.isPaid ? 1 : 0
        ]
      );
      return {
        ...entry,
        id: result.insertId,
        paidAmountRmb: entry.paidAmountRmb || 0,
        discountAmountRmb: entry.discountAmountRmb || 0,
        commissionBaseRmb: entry.commissionBaseRmb || 0,
        sourceId: entry.sourceId || null,
        operatorCrmUserId: entry.operatorCrmUserId || null,
        reason: entry.reason || "",
        balanceAfterRmb,
        didMutate: true
      };
    },

    async findLedgerEntryByIdempotencyKey(idempotencyKey) {
      const [rows] = await executor.query<DbRow[]>(
        "SELECT * FROM crm_ledger_entries WHERE idempotency_key = ? LIMIT 1",
        [idempotencyKey]
      );
      return rows[0] ? mapLedger(rows[0]) : null;
    },

    async sumLedgerAmount(options) {
      const summary = await this.summarizeLedger(options);
      return summary.amountRmb;
    },

    async summarizeLedger({ crmUserId, eventType, direction, createdAtFrom, createdAtBefore }) {
      const clauses = ["crm_user_id = ?"];
      const params: unknown[] = [crmUserId];
      if (eventType) {
        clauses.push("event_type = ?");
        params.push(eventType);
      }
      if (direction) {
        clauses.push("direction = ?");
        params.push(direction);
      }
      if (createdAtFrom) {
        clauses.push("created_at >= ?");
        params.push(createdAtFrom);
      }
      if (createdAtBefore) {
        clauses.push("created_at < ?");
        params.push(createdAtBefore);
      }
      const [rows] = await executor.query<DbRow[]>(
        `SELECT COALESCE(SUM(amount_rmb), 0) AS amount, COUNT(*) AS entry_count
         FROM crm_ledger_entries WHERE ${clauses.join(" AND ")}`,
        params
      );
      return {
        amountRmb: Math.round(numberValue(rows[0]?.amount) * 100) / 100,
        entryCount: numberValue(rows[0]?.entry_count)
      };
    },

    async listLedger({ crmUserId, eventType, direction, page = 1, pageSize = 20 } = {}) {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (crmUserId) {
        clauses.push("entry.crm_user_id = ?");
        params.push(crmUserId);
      }
      if (eventType) {
        clauses.push("entry.event_type = ?");
        params.push(eventType);
      }
      if (direction) {
        clauses.push("entry.direction = ?");
        params.push(direction);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const [countRows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total FROM crm_ledger_entries entry ${where}`,
        params
      );
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          entry.*,
          crm_user.username AS crm_username,
          operator.username AS operator_username
         FROM crm_ledger_entries entry
         LEFT JOIN crm_users crm_user ON crm_user.id = entry.crm_user_id
         LEFT JOIN crm_users operator ON operator.id = entry.operator_crm_user_id
         ${where}
         ORDER BY entry.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapLedger),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async insertAuditLog(entry) {
      const requestContext = getCrmRequestContext();
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_audit_logs
          (operator_crm_user_id, target_type, target_id, action, reason, before_snapshot, after_snapshot,
           request_ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.operatorCrmUserId,
          entry.targetType,
          String(entry.targetId),
          entry.action,
          entry.reason || "",
          JSON.stringify(entry.before || null),
          JSON.stringify(entry.after || null),
          requestContext?.requestIp || "",
          requestContext?.userAgent || ""
        ]
      );
      return {
        id: result.insertId,
        operatorCrmUserId: entry.operatorCrmUserId,
        targetType: entry.targetType,
        targetId: String(entry.targetId),
        action: entry.action,
        reason: entry.reason || "",
        beforeSnapshot: entry.before || null,
        afterSnapshot: entry.after || null,
        requestIp: requestContext?.requestIp || "",
        userAgent: requestContext?.userAgent || ""
      };
    },

    async listAuditLogs({ operatorCrmUserId, targetType, targetId, action, page = 1, pageSize = 20 } = {}) {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (operatorCrmUserId) {
        clauses.push("audit.operator_crm_user_id = ?");
        params.push(operatorCrmUserId);
      }
      if (targetType) {
        clauses.push("audit.target_type = ?");
        params.push(targetType);
      }
      if (targetId) {
        clauses.push("audit.target_id = ?");
        params.push(targetId);
      }
      if (action) {
        clauses.push("audit.action = ?");
        params.push(action);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const [countRows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total FROM crm_audit_logs audit ${where}`,
        params
      );
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          audit.*,
          operator.username AS operator_username
         FROM crm_audit_logs audit
         LEFT JOIN crm_users operator ON operator.id = audit.operator_crm_user_id
         ${where}
         ORDER BY audit.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapAudit),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async getAgentById(agentId) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          agent.*,
          crm_user.username AS crm_username,
          crm_user.email AS crm_email,
          parent.crm_user_id AS parent_agent_crm_user_id,
          parent_user.username AS parent_agent_username
         FROM crm_agents agent
         LEFT JOIN crm_agents parent ON agent.parent_agent_id = parent.id
         LEFT JOIN crm_users crm_user ON crm_user.id = agent.crm_user_id
         LEFT JOIN crm_users parent_user ON parent_user.id = parent.crm_user_id
         WHERE agent.id = ? LIMIT 1`,
        [agentId]
      );
      return mapAgent(rows[0]);
    },

    async getAgentByCrmUserId(crmUserId) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          agent.*,
          crm_user.username AS crm_username,
          crm_user.email AS crm_email,
          parent.crm_user_id AS parent_agent_crm_user_id,
          parent_user.username AS parent_agent_username
         FROM crm_agents agent
         LEFT JOIN crm_agents parent ON agent.parent_agent_id = parent.id
         LEFT JOIN crm_users crm_user ON crm_user.id = agent.crm_user_id
         LEFT JOIN crm_users parent_user ON parent_user.id = parent.crm_user_id
         WHERE agent.crm_user_id = ? LIMIT 1`,
        [crmUserId]
      );
      return mapAgent(rows[0]);
    },

    async getAgentByInviteCode(inviteCode) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          agent.*,
          crm_user.username AS crm_username,
          crm_user.email AS crm_email,
          parent.crm_user_id AS parent_agent_crm_user_id,
          parent_user.username AS parent_agent_username
         FROM crm_agents agent
         LEFT JOIN crm_agents parent ON agent.parent_agent_id = parent.id
         LEFT JOIN crm_users crm_user ON crm_user.id = agent.crm_user_id
         LEFT JOIN crm_users parent_user ON parent_user.id = parent.crm_user_id
         WHERE agent.invite_code = ? LIMIT 1`,
        [inviteCode]
      );
      return mapAgent(rows[0]);
    },

    async saveAgent(agent) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_agents
          (crm_user_id, status, category, invite_code, parent_agent_id, level, level_effective_at, level_expires_at,
           last_level_evaluated_at, effective_paid_customer_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          category = VALUES(category),
          invite_code = VALUES(invite_code),
          parent_agent_id = VALUES(parent_agent_id),
          level = VALUES(level),
          level_effective_at = VALUES(level_effective_at),
          level_expires_at = VALUES(level_expires_at),
          last_level_evaluated_at = VALUES(last_level_evaluated_at),
          effective_paid_customer_count = VALUES(effective_paid_customer_count)`,
        [
          agent.crmUserId,
          agent.status,
          agent.category,
          agent.inviteCode,
          agent.parentAgentId,
          agent.level,
          agent.levelEffectiveAt,
          agent.levelExpiresAt,
          agent.lastLevelEvaluatedAt,
          agent.effectivePaidCustomerCount
        ]
      );
      const stored = await this.getAgentByCrmUserId(agent.crmUserId);
      if (!stored) throw new Error("agent record not found after save");
      return { ...stored, didMutate: result.insertId > 0 || result.changedRows > 0 } as AgentDto;
    },

    async listAgents({ page = 1, pageSize = 20, parentAgentCrmUserId, businessOnly = false } = {}) {
      const params: unknown[] = [];
      const whereParts: string[] = [];
      if (parentAgentCrmUserId) {
        whereParts.push("parent.crm_user_id = ?");
        params.push(parentAgentCrmUserId);
      }
      if (businessOnly) {
        whereParts.push("crm_user.id IS NOT NULL");
        whereParts.push("crm_user.new_api_role < ?");
        params.push(100);
      }
      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
      const countParams = [...params];
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          agent.*,
          crm_user.username AS crm_username,
          crm_user.email AS crm_email,
          parent.crm_user_id AS parent_agent_crm_user_id,
          parent_user.username AS parent_agent_username
         FROM crm_agents agent
         LEFT JOIN crm_agents parent ON agent.parent_agent_id = parent.id
         LEFT JOIN crm_users crm_user ON crm_user.id = agent.crm_user_id
         LEFT JOIN crm_users parent_user ON parent_user.id = parent.crm_user_id
         ${where}
         ORDER BY agent.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      const [countRows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total
         FROM crm_agents agent
         LEFT JOIN crm_agents parent ON agent.parent_agent_id = parent.id
         LEFT JOIN crm_users crm_user ON crm_user.id = agent.crm_user_id
         ${where}`,
        countParams
      );
      return {
        items: rows.map((row) => mapAgent(row)).filter((agent): agent is AgentDto => Boolean(agent)),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async countSubAgents(agentCrmUserId) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total
         FROM crm_agents child
         JOIN crm_agents parent ON child.parent_agent_id = parent.id
         WHERE parent.crm_user_id = ? AND child.status = 'active'`,
        [agentCrmUserId]
      );
      return numberValue(rows[0]?.total);
    },

    async getAgentRelationshipByCustomer(crmUserId) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          relationship.id,
          relationship.customer_crm_user_id,
          customer_user.username AS customer_username,
          agent.crm_user_id AS agent_crm_user_id,
          agent_user.username AS agent_username,
          relationship.bind_source,
          relationship.status,
          relationship.bind_reason
         FROM crm_agent_relationships relationship
         JOIN crm_agents agent ON relationship.agent_id = agent.id
         LEFT JOIN crm_users customer_user ON customer_user.id = relationship.customer_crm_user_id
         LEFT JOIN crm_users agent_user ON agent_user.id = agent.crm_user_id
         WHERE relationship.customer_crm_user_id = ? AND relationship.status = 'active'
         LIMIT 1`,
        [crmUserId]
      );
      return mapRelationship(rows[0]);
    },

    async saveAgentRelationship(customerCrmUserId, relationship) {
      const [agentRows] = await executor.query<DbRow[]>("SELECT id FROM crm_agents WHERE crm_user_id = ? LIMIT 1", [relationship.agentCrmUserId]);
      const agentId = numberValue(agentRows[0]?.id);
      if (!agentId) throw new Error("agent record not found");
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_agent_relationships
          (customer_crm_user_id, agent_id, bind_source, bind_reason, status)
         VALUES (?, ?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE
          agent_id = VALUES(agent_id),
          bind_source = VALUES(bind_source),
          bind_reason = VALUES(bind_reason),
          status = 'active'`,
        [customerCrmUserId, agentId, relationship.bindSource, relationship.bindReason]
      );
      const saved = await this.getAgentRelationshipByCustomer(customerCrmUserId);
      if (!saved) throw new Error("agent relationship not found after save");
      return { ...saved, didMutate: result.insertId > 0 || result.changedRows > 0 } as AgentRelationshipDto;
    },

    async listAgentCustomers(agentCrmUserId, { page = 1, pageSize = 20, keyword = "" } = {}) {
      const search = `%${keyword}%`;
      const whereParts = [
        "agent.crm_user_id = ?",
        "relationship.status = 'active'",
        ...(keyword ? ["(customer_user.username LIKE ? OR customer_user.email LIKE ?)"] : [])
      ];
      const params = [agentCrmUserId, ...(keyword ? [search, search] : [])];
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          relationship.id,
          relationship.customer_crm_user_id,
          agent.crm_user_id AS agent_crm_user_id,
          agent_user.username AS agent_username,
          relationship.bind_source,
          relationship.status,
          relationship.bind_reason,
          customer_user.username AS customer_username,
          customer_user.email AS customer_email,
          customer_user.created_at AS customer_created_at
         FROM crm_agent_relationships relationship
         JOIN crm_agents agent ON relationship.agent_id = agent.id
         LEFT JOIN crm_users agent_user ON agent_user.id = agent.crm_user_id
         JOIN crm_users customer_user ON customer_user.id = relationship.customer_crm_user_id
         WHERE ${whereParts.join(" AND ")}
         ORDER BY relationship.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return rows.map((row) => ({
        customerCrmUserId: numberValue(row.customer_crm_user_id),
        customer: {
          crmUserId: numberValue(row.customer_crm_user_id),
          username: stringValue(row.customer_username),
          email: stringValue(row.customer_email),
          createdAt: row.customer_created_at ? String(row.customer_created_at) : undefined
        },
        relationship: mapRelationship(row) as AgentRelationshipDto
      }));
    },

    async countAgentCustomers(agentCrmUserId, { keyword = "" } = {}) {
      const search = `%${keyword}%`;
      const whereParts = [
        "agent.crm_user_id = ?",
        "relationship.status = 'active'",
        ...(keyword ? ["(customer_user.username LIKE ? OR customer_user.email LIKE ?)"] : [])
      ];
      const params = [agentCrmUserId, ...(keyword ? [search, search] : [])];
      const [rows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total
         FROM crm_agent_relationships relationship
         JOIN crm_agents agent ON relationship.agent_id = agent.id
         JOIN crm_users customer_user ON customer_user.id = relationship.customer_crm_user_id
         WHERE ${whereParts.join(" AND ")}`,
        params
      );
      return numberValue(rows[0]?.total);
    },

    async getEffectiveCustomerByAgentAndCustomer(agentId, customerCrmUserId) {
      const [rows] = await executor.query<DbRow[]>(
        "SELECT * FROM crm_effective_customers WHERE agent_id = ? AND customer_crm_user_id = ? LIMIT 1",
        [agentId, customerCrmUserId]
      );
      return mapEffectiveCustomer(rows[0]);
    },

    async saveEffectiveCustomer(input: EffectiveCustomerSaveInput) {
      await executor.query(
        `INSERT INTO crm_effective_customers
          (agent_id, customer_crm_user_id, first_paid_event_id, first_paid_amount_rmb, first_paid_at,
           seven_day_checked_at, paid_balance_consumed_rate, is_refunded, is_related_account, is_risk,
           is_effective, counted_for_level)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          first_paid_event_id = VALUES(first_paid_event_id),
          first_paid_amount_rmb = VALUES(first_paid_amount_rmb),
          first_paid_at = VALUES(first_paid_at),
          seven_day_checked_at = VALUES(seven_day_checked_at),
          paid_balance_consumed_rate = VALUES(paid_balance_consumed_rate),
          is_refunded = VALUES(is_refunded),
          is_related_account = VALUES(is_related_account),
          is_risk = VALUES(is_risk),
          is_effective = VALUES(is_effective),
          counted_for_level = VALUES(counted_for_level)`,
        [
          input.agentId,
          input.customerCrmUserId,
          input.firstPaidEventId,
          input.firstPaidAmountRmb,
          input.firstPaidAt,
          input.sevenDayCheckedAt,
          input.paidBalanceConsumedRate,
          input.isRefunded ? 1 : 0,
          input.isRelatedAccount ? 1 : 0,
          input.isRisk ? 1 : 0,
          input.isEffective ? 1 : 0,
          input.countedForLevel ? 1 : 0
        ]
      );
      const saved = await this.getEffectiveCustomerByAgentAndCustomer(input.agentId, input.customerCrmUserId);
      if (!saved) throw new Error("effective customer record not found after save");
      return saved;
    },

    async listEffectiveCustomers({ page = 1, pageSize = 20, agentId, customerCrmUserId, isEffective, countedForLevel } = {}) {
      const whereParts: string[] = [];
      const params: unknown[] = [];
      if (agentId) {
        whereParts.push("effective.agent_id = ?");
        params.push(agentId);
      }
      if (customerCrmUserId) {
        whereParts.push("effective.customer_crm_user_id = ?");
        params.push(customerCrmUserId);
      }
      if (isEffective !== undefined) {
        whereParts.push("effective.is_effective = ?");
        params.push(isEffective ? 1 : 0);
      }
      if (countedForLevel !== undefined) {
        whereParts.push("effective.counted_for_level = ?");
        params.push(countedForLevel ? 1 : 0);
      }
      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
      const from = `
        FROM crm_effective_customers effective
        JOIN crm_agents agent ON agent.id = effective.agent_id
        LEFT JOIN crm_users agent_user ON agent_user.id = agent.crm_user_id
        LEFT JOIN crm_users customer_user ON customer_user.id = effective.customer_crm_user_id
      `;
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total ${from} ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          effective.*,
          agent.crm_user_id AS agent_crm_user_id,
          agent_user.username AS agent_username,
          customer_user.username AS customer_username,
          customer_user.email AS customer_email
         ${from}
         ${where}
         ORDER BY effective.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map((row) => mapEffectiveCustomer(row)).filter((row): row is EffectiveCustomerDto => Boolean(row)),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async countEffectiveCustomers(agentId, options = {}) {
      const clauses = ["agent_id = ?", "counted_for_level = 1"];
      const params: unknown[] = [agentId];
      if (options.firstPaidAtFrom) {
        clauses.push("first_paid_at >= ?");
        params.push(options.firstPaidAtFrom);
      }
      const [rows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total FROM crm_effective_customers WHERE ${clauses.join(" AND ")}`,
        params
      );
      return numberValue(rows[0]?.total);
    },

    async getCommissionSummary(beneficiaryCrmUserId) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          COALESCE(SUM(CASE WHEN status = 'frozen' THEN commission_amount_rmb - released_amount_rmb ELSE 0 END), 0) AS frozen_commission_rmb,
          COALESCE(SUM(CASE WHEN status = 'releasable' THEN commission_amount_rmb - released_amount_rmb ELSE 0 END), 0) AS releasable_commission_rmb,
          COALESCE(SUM(released_amount_rmb), 0) AS released_commission_rmb
         FROM crm_commissions
         WHERE beneficiary_crm_user_id = ?`,
        [beneficiaryCrmUserId]
      );
      return {
        frozenCommissionRmb: numberValue(rows[0]?.frozen_commission_rmb),
        releasableCommissionRmb: numberValue(rows[0]?.releasable_commission_rmb),
        releasedCommissionRmb: numberValue(rows[0]?.released_commission_rmb)
      };
    },

    async listCommissions({ beneficiaryCrmUserId, status, sourceType, sourceId, page = 1, pageSize = 20 } = {}) {
      const clauses = [];
      const params: unknown[] = [];
      if (beneficiaryCrmUserId) {
        clauses.push("commission.beneficiary_crm_user_id = ?");
        params.push(beneficiaryCrmUserId);
      }
      if (status) {
        clauses.push("commission.status = ?");
        params.push(status);
      }
      if (sourceType) {
        clauses.push("commission.source_type = ?");
        params.push(sourceType);
      }
      if (sourceId) {
        clauses.push("commission.source_id = ?");
        params.push(sourceId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const from = `FROM crm_commissions commission
        LEFT JOIN crm_users beneficiary ON beneficiary.id = commission.beneficiary_crm_user_id
        LEFT JOIN crm_users customer ON customer.id = commission.customer_crm_user_id`;
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total ${from} ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          commission.*,
          beneficiary.username AS beneficiary_username,
          customer.username AS customer_username
         ${from}
         ${where}
         ORDER BY commission.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapCommission),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async insertCommissionRecords(rows) {
      if (!rows.length) return [];
      const values = rows.map((row) => [
        row.sourceType,
        row.sourceId,
        row.beneficiaryCrmUserId,
        row.customerCrmUserId,
        row.commissionType,
        row.orderKind,
        row.agentLevel,
        row.baseAmountRmb,
        row.rate,
        row.amountRmb
      ]);
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_commissions
          (source_type, source_id, beneficiary_crm_user_id, customer_crm_user_id, commission_type, order_kind,
           agent_level, base_amount_rmb, rate, commission_amount_rmb)
         VALUES ?`,
        [values]
      );
      return rows.map((row, index) => ({
        ...row,
        id: result.insertId ? result.insertId + index : undefined,
        status: "frozen",
        releasedAmountRmb: 0
      }));
    },

    async updateCommissionStatus(id, status, operatorCrmUserId, reason) {
      const [currentRows] = await executor.query<DbRow[]>(
        "SELECT * FROM crm_commissions WHERE id = ? LIMIT 1",
        [id]
      );
      if (!currentRows[0]) throw httpError("commission was not found", 404, "not_found");
      const current = mapCommission(currentRows[0]);
      const allowed = (
        (current.status === commissionStatuses.frozen && (
          status === commissionStatuses.releasable ||
          status === commissionStatuses.blocked ||
          status === commissionStatuses.clawedBack
        )) ||
        (current.status === commissionStatuses.releasable && (
          status === commissionStatuses.blocked ||
          status === commissionStatuses.clawedBack
        )) ||
        (current.status === commissionStatuses.blocked && status === commissionStatuses.clawedBack)
      );
      if (!allowed || (status === commissionStatuses.clawedBack && current.releasedAmountRmb > 0)) {
        throw httpError("commission status transition is invalid", 409, "commission_status_invalid");
      }
      const [updateResult] = await executor.query<ResultSetHeader>(
        `UPDATE crm_commissions
         SET status = ?
         WHERE id = ? AND status = ? AND released_amount_rmb = ?`,
        [status, id, current.status, current.releasedAmountRmb]
      );
      if (updateResult.affectedRows !== 1) {
        throw httpError("commission status transition is invalid", 409, "commission_status_invalid");
      }
      await this.insertAuditLog({
        operatorCrmUserId,
        targetType: "commission",
        targetId: id,
        action: `commission.${status}`,
        reason,
        before: current
      });
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          commission.*,
          beneficiary.username AS beneficiary_username,
          customer.username AS customer_username
         FROM crm_commissions commission
         LEFT JOIN crm_users beneficiary ON beneficiary.id = commission.beneficiary_crm_user_id
         LEFT JOIN crm_users customer ON customer.id = commission.customer_crm_user_id
         WHERE commission.id = ? LIMIT 1`,
        [id]
      );
      if (!rows[0]) throw new Error("commission not found");
      return mapCommission(rows[0]);
    },

    async createWithdrawal(input) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_withdrawals
          (beneficiary_crm_user_id, amount_rmb, payout_method, payout_account_name, payout_account, payout_bank_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          input.beneficiaryCrmUserId,
          input.amountRmb,
          input.payoutMethod,
          input.payoutAccountName,
          input.payoutAccount,
          input.payoutBankName
        ]
      );
      const [rows] = await executor.query<DbRow[]>(
        `SELECT withdrawal.*, beneficiary.username AS beneficiary_username
         FROM crm_withdrawals withdrawal
         LEFT JOIN crm_users beneficiary ON beneficiary.id = withdrawal.beneficiary_crm_user_id
         WHERE withdrawal.id = ? LIMIT 1`,
        [result.insertId]
      );
      return mapWithdrawal(rows[0]);
    },

    async createWithdrawalWithBalanceCheck(input) {
      if (!options.transactional) {
        return this.withTransaction((transactionRepository) => (
          transactionRepository.createWithdrawalWithBalanceCheck(input)
        ));
      }
      await executor.query(
        "SELECT id FROM crm_users WHERE id = ? FOR UPDATE",
        [input.beneficiaryCrmUserId]
      );
      const settings = await this.getSettings();
      if (input.amountRmb < settings.withdrawalMinAmountRmb) {
        throw httpError("withdrawal amount is below the minimum", 400, "withdrawal_min_amount");
      }
      const blocked = await this.hasBlockingRisk(
        "user",
        String(input.beneficiaryCrmUserId),
        "withdrawal"
      );
      if (blocked) {
        throw httpError("withdrawal is blocked by risk case", 409, "withdrawal_risk_blocked");
      }
      const summary = await this.getCommissionSummary(input.beneficiaryCrmUserId);
      const [pending, approved] = await Promise.all([
        this.sumWithdrawals({ beneficiaryCrmUserId: input.beneficiaryCrmUserId, status: "pending" }),
        this.sumWithdrawals({ beneficiaryCrmUserId: input.beneficiaryCrmUserId, status: "approved" })
      ]);
      const available = Math.max(
        0,
        roundMoney(summary.releasableCommissionRmb - pending - approved)
      );
      if (available < input.amountRmb) {
        throw httpError("releasable commission balance is insufficient", 400, "withdrawal_insufficient_balance");
      }
      return this.createWithdrawal(input);
    },

    async getWithdrawalById(id) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          withdrawal.*,
          beneficiary.username AS beneficiary_username,
          reviewer.username AS reviewer_username
         FROM crm_withdrawals withdrawal
         LEFT JOIN crm_users beneficiary ON beneficiary.id = withdrawal.beneficiary_crm_user_id
         LEFT JOIN crm_users reviewer ON reviewer.id = withdrawal.reviewer_crm_user_id
         WHERE withdrawal.id = ? LIMIT 1`,
        [id]
      );
      return rows[0] ? mapWithdrawal(rows[0]) : null;
    },

    async listWithdrawals({ beneficiaryCrmUserId, status, page = 1, pageSize = 20 } = {}) {
      const clauses = [];
      const params: unknown[] = [];
      if (beneficiaryCrmUserId) {
        clauses.push("withdrawal.beneficiary_crm_user_id = ?");
        params.push(beneficiaryCrmUserId);
      }
      if (status) {
        clauses.push("withdrawal.status = ?");
        params.push(status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const from = `FROM crm_withdrawals withdrawal
        LEFT JOIN crm_users beneficiary ON beneficiary.id = withdrawal.beneficiary_crm_user_id
        LEFT JOIN crm_users reviewer ON reviewer.id = withdrawal.reviewer_crm_user_id`;
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total ${from} ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          withdrawal.*,
          beneficiary.username AS beneficiary_username,
          reviewer.username AS reviewer_username
         ${from}
         ${where}
         ORDER BY withdrawal.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapWithdrawal),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async sumWithdrawals({ beneficiaryCrmUserId, status } = {}) {
      const clauses = [];
      const params: unknown[] = [];
      if (beneficiaryCrmUserId) {
        clauses.push("beneficiary_crm_user_id = ?");
        params.push(beneficiaryCrmUserId);
      }
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const [rows] = await executor.query<DbRow[]>(`SELECT COALESCE(SUM(amount_rmb), 0) AS total FROM crm_withdrawals ${where}`, params);
      return numberValue(rows[0]?.total);
    },

    async updateWithdrawal(id, patch, expectedStatus) {
      const [result] = await executor.query<ResultSetHeader>(
        `UPDATE crm_withdrawals
         SET status = ?, reviewer_crm_user_id = ?, review_reason = ?, paid_reference = COALESCE(?, paid_reference),
             paid_evidence_url = COALESCE(?, paid_evidence_url),
             reviewed_at = CURRENT_TIMESTAMP,
             paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END
         WHERE id = ? AND status = ?`,
        [
          patch.status,
          patch.reviewerCrmUserId,
          patch.reviewReason,
          patch.paidReference || null,
          patch.paidEvidenceUrl || null,
          patch.status,
          id,
          expectedStatus
        ]
      );
      if (result.affectedRows === 0) return null;
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          withdrawal.*,
          beneficiary.username AS beneficiary_username,
          reviewer.username AS reviewer_username
         FROM crm_withdrawals withdrawal
         LEFT JOIN crm_users beneficiary ON beneficiary.id = withdrawal.beneficiary_crm_user_id
         LEFT JOIN crm_users reviewer ON reviewer.id = withdrawal.reviewer_crm_user_id
         WHERE withdrawal.id = ? LIMIT 1`,
        [id]
      );
      if (!rows[0]) throw new Error("withdrawal not found");
      return mapWithdrawal(rows[0]);
    },

    async markWithdrawalPaidWithAllocations(input) {
      if (!options.transactional) {
        return this.withTransaction((transactionRepository) => (
          transactionRepository.markWithdrawalPaidWithAllocations(input)
        ));
      }
      const [withdrawalRows] = await executor.query<DbRow[]>(
        "SELECT * FROM crm_withdrawals WHERE id = ? FOR UPDATE",
        [input.withdrawalId]
      );
      if (!withdrawalRows[0]) throw httpError("withdrawal was not found", 404, "not_found");
      const current = mapWithdrawal(withdrawalRows[0]);
      if (current.status !== "approved") {
        throw httpError("withdrawal status transition is invalid", 409, "withdrawal_status_invalid");
      }
      await executor.query(
        "SELECT id FROM crm_users WHERE id = ? FOR UPDATE",
        [current.beneficiaryCrmUserId]
      );
      const [commissionRows] = await executor.query<DbRow[]>(
        `SELECT * FROM crm_commissions
         WHERE beneficiary_crm_user_id = ?
           AND status = 'releasable'
           AND commission_amount_rmb > released_amount_rmb
         ORDER BY created_at ASC, id ASC
         FOR UPDATE`,
        [current.beneficiaryCrmUserId]
      );
      const candidates = commissionRows.map(mapCommission);
      const available = candidates.reduce(
        (sum, commission) => sum + commission.amountRmb - commission.releasedAmountRmb,
        0
      );
      if (Math.round(available * 100) < Math.round(current.amountRmb * 100)) {
        throw httpError("releasable commission balance is insufficient", 409, "withdrawal_insufficient_balance");
      }

      let remaining = current.amountRmb;
      const allocations: WithdrawalCommissionAllocationDto[] = [];
      for (const commission of candidates) {
        if (remaining <= 0) break;
        const remainingCommission = roundMoney(commission.amountRmb - commission.releasedAmountRmb);
        const allocatedAmount = Math.min(remainingCommission, remaining);
        const [allocationResult] = await executor.query<ResultSetHeader>(
          `INSERT INTO crm_withdrawal_commission_allocations
            (withdrawal_id, commission_id, amount_rmb)
           VALUES (?, ?, ?)`,
          [current.id, commission.id, allocatedAmount]
        );
        await executor.query(
          `UPDATE crm_commissions
           SET status = CASE
                 WHEN released_amount_rmb + ? >= commission_amount_rmb THEN 'released'
                 ELSE status
               END,
               released_amount_rmb = released_amount_rmb + ?
           WHERE id = ? AND status = 'releasable'`,
          [allocatedAmount, allocatedAmount, commission.id]
        );
        allocations.push({
          id: allocationResult.insertId,
          withdrawalId: current.id,
          commissionId: Number(commission.id),
          amountRmb: allocatedAmount
        });
        remaining = roundMoney(remaining - allocatedAmount);
      }

      const [updateResult] = await executor.query<ResultSetHeader>(
        `UPDATE crm_withdrawals
         SET status = 'paid', reviewer_crm_user_id = ?, review_reason = ?, paid_reference = ?,
             paid_evidence_url = COALESCE(?, paid_evidence_url), reviewed_at = CURRENT_TIMESTAMP,
             paid_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'approved'`,
        [
          input.operatorCrmUserId,
          input.reviewReason,
          input.paidReference,
          input.paidEvidenceUrl || null,
          current.id
        ]
      );
      if (updateResult.affectedRows !== 1) {
        throw httpError("withdrawal status transition is invalid", 409, "withdrawal_status_invalid");
      }
      const withdrawal = await this.getWithdrawalById(current.id);
      if (!withdrawal) throw httpError("withdrawal was not found", 404, "not_found");
      await this.insertLedgerEntry({
        crmUserId: current.beneficiaryCrmUserId,
        direction: ledgerDirections.debit,
        amountRmb: current.amountRmb,
        paidAmountRmb: 0,
        discountAmountRmb: 0,
        commissionBaseRmb: 0,
        eventType: ledgerEventTypes.commissionWithdrawal,
        sourceType: "withdrawal",
        sourceId: current.id,
        idempotencyKey: `commission-withdrawal:${current.id}:paid`,
        operatorCrmUserId: input.operatorCrmUserId,
        reason: input.reviewReason,
        isPaid: false
      });
      await this.insertAuditLog({
        operatorCrmUserId: input.operatorCrmUserId,
        targetType: "withdrawal",
        targetId: current.id,
        action: "withdrawal.paid",
        reason: input.reviewReason,
        before: current,
        after: { withdrawal, allocations }
      });
      return { withdrawal, allocations };
    },

    async listWithdrawalCommissionAllocations(withdrawalId) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT * FROM crm_withdrawal_commission_allocations
         WHERE withdrawal_id = ? ORDER BY id ASC`,
        [withdrawalId]
      );
      return rows.map(mapWithdrawalCommissionAllocation);
    },

    async saveEnterpriseMonthlySettlement(input) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_enterprise_monthly_settlements
          (crm_user_id, period, usage_rmb, ledger_entry_count, notes)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          usage_rmb = IF(status = 'pending', VALUES(usage_rmb), usage_rmb),
          ledger_entry_count = IF(status = 'pending', VALUES(ledger_entry_count), ledger_entry_count),
          notes = IF(status = 'pending', VALUES(notes), notes)`,
        [
          input.crmUserId,
          input.period,
          input.usageRmb,
          input.ledgerEntryCount,
          input.notes || ""
        ]
      );
      const [rows] = await executor.query<DbRow[]>(
        `SELECT settlement.*, crm_user.username AS crm_username
         FROM crm_enterprise_monthly_settlements settlement
         LEFT JOIN crm_users crm_user ON crm_user.id = settlement.crm_user_id
         WHERE settlement.crm_user_id = ? AND settlement.period = ? LIMIT 1`,
        [input.crmUserId, input.period]
      );
      const settlement = mapEnterpriseMonthlySettlement(rows[0]);
      const updated = settlement.status === enterpriseMonthlySettlementStatuses.pending &&
        settlement.usageRmb === input.usageRmb &&
        settlement.ledgerEntryCount === input.ledgerEntryCount;
      return {
        settlement,
        created: result.affectedRows === 1,
        updated: result.affectedRows > 1 && updated
      };
    },

    async getEnterpriseMonthlySettlementById(id) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT settlement.*, crm_user.username AS crm_username
         FROM crm_enterprise_monthly_settlements settlement
         LEFT JOIN crm_users crm_user ON crm_user.id = settlement.crm_user_id
         WHERE settlement.id = ? LIMIT 1`,
        [id]
      );
      return rows[0] ? mapEnterpriseMonthlySettlement(rows[0]) : null;
    },

    async listEnterpriseMonthlySettlements({ period, status, crmUserId, page = 1, pageSize = 20 } = {}) {
      const clauses = [];
      const params: unknown[] = [];
      if (period) {
        clauses.push("settlement.period = ?");
        params.push(period);
      }
      if (status) {
        clauses.push("settlement.status = ?");
        params.push(status);
      }
      if (crmUserId) {
        clauses.push("settlement.crm_user_id = ?");
        params.push(crmUserId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const from = `FROM crm_enterprise_monthly_settlements settlement
        LEFT JOIN crm_users crm_user ON crm_user.id = settlement.crm_user_id`;
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total ${from} ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT settlement.*, crm_user.username AS crm_username
         ${from}
         ${where}
         ORDER BY settlement.period DESC, settlement.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapEnterpriseMonthlySettlement),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async updateEnterpriseMonthlySettlement(id, patch, expectedStatus) {
      const [result] = await executor.query<ResultSetHeader>(
        `UPDATE crm_enterprise_monthly_settlements
         SET status = ?,
             paid_reference = COALESCE(?, paid_reference),
             paid_evidence_url = COALESCE(?, paid_evidence_url),
             notes = COALESCE(?, notes),
             paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END
         WHERE id = ? AND status = ?`,
        [
          patch.status,
          patch.paidReference || null,
          patch.paidEvidenceUrl || null,
          patch.notes || null,
          patch.status,
          id,
          expectedStatus
        ]
      );
      if (result.affectedRows === 0) return null;
      const settlement = await this.getEnterpriseMonthlySettlementById(id);
      if (!settlement) throw new Error("enterprise monthly settlement not found");
      return settlement;
    },

    async createOfflineRechargeRequest(input) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_offline_recharge_requests
          (crm_user_id, method, amount_rmb, payer_name, payment_reference, payment_evidence_url, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.crmUserId,
          input.method,
          input.amountRmb,
          input.payerName,
          input.paymentReference,
          input.paymentEvidenceUrl,
          input.notes
        ]
      );
      const request = await this.getOfflineRechargeRequestById(result.insertId);
      if (!request) throw new Error("offline recharge request not found after insert");
      return request;
    },

    async getOfflineRechargeRequestById(id) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          request.*,
          crm_user.username AS crm_username,
          reviewer.username AS reviewer_username
         FROM crm_offline_recharge_requests request
         LEFT JOIN crm_users crm_user ON crm_user.id = request.crm_user_id
         LEFT JOIN crm_users reviewer ON reviewer.id = request.reviewer_crm_user_id
         WHERE request.id = ? LIMIT 1`,
        [id]
      );
      return rows[0] ? mapOfflineRechargeRequest(rows[0]) : null;
    },

    async listOfflineRechargeRequests({ crmUserId, status, page = 1, pageSize = 20 } = {}) {
      const clauses = [];
      const params: unknown[] = [];
      if (crmUserId) {
        clauses.push("request.crm_user_id = ?");
        params.push(crmUserId);
      }
      if (status) {
        clauses.push("request.status = ?");
        params.push(status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const from = `FROM crm_offline_recharge_requests request
        LEFT JOIN crm_users crm_user ON crm_user.id = request.crm_user_id
        LEFT JOIN crm_users reviewer ON reviewer.id = request.reviewer_crm_user_id`;
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total ${from} ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          request.*,
          crm_user.username AS crm_username,
          reviewer.username AS reviewer_username
         ${from}
         ${where}
         ORDER BY request.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapOfflineRechargeRequest),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async updateOfflineRechargeRequest(id, patch, expectedStatus) {
      const [result] = await executor.query<ResultSetHeader>(
        `UPDATE crm_offline_recharge_requests
         SET status = ?, reviewer_crm_user_id = ?, review_reason = ?, account_event_id = ?,
             reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = ?`,
        [patch.status, patch.reviewerCrmUserId, patch.reviewReason, patch.accountEventId || null, id, expectedStatus]
      );
      if (result.affectedRows === 0) return null;
      const request = await this.getOfflineRechargeRequestById(id);
      if (!request) throw new Error("offline recharge request not found");
      return request;
    },

    async createRiskCase(input) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_risk_cases
          (target_type, target_id, risk_type, evidence_json, notes, blocks_withdrawal, blocks_commission_release, created_by_crm_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.targetType,
          input.targetId,
          input.riskType,
          JSON.stringify(input.evidence || null),
          input.notes,
          input.blocksWithdrawal ? 1 : 0,
          input.blocksCommissionRelease ? 1 : 0,
          input.createdByCrmUserId
        ]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_risk_cases WHERE id = ? LIMIT 1", [result.insertId]);
      return mapRiskCase(rows[0]);
    },

    async listRiskCases({ status, targetType, targetId, page = 1, pageSize = 20 } = {}) {
      const clauses = [];
      const params: unknown[] = [];
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      if (targetType) {
        clauses.push("target_type = ?");
        params.push(targetType);
      }
      if (targetId) {
        clauses.push("target_id = ?");
        params.push(targetId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total FROM crm_risk_cases ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT * FROM crm_risk_cases ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapRiskCase),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async updateRiskCase(id, patch) {
      const currentRows = await this.listRiskCases({ page: 1, pageSize: 1 });
      await executor.query(
        `UPDATE crm_risk_cases
         SET status = COALESCE(?, status),
             evidence_json = COALESCE(?, evidence_json),
             notes = COALESCE(?, notes),
             blocks_withdrawal = COALESCE(?, blocks_withdrawal),
             blocks_commission_release = COALESCE(?, blocks_commission_release)
         WHERE id = ?`,
        [
          patch.status || null,
          patch.evidence === undefined ? null : JSON.stringify(patch.evidence),
          patch.notes || null,
          patch.blocksWithdrawal === undefined ? null : patch.blocksWithdrawal ? 1 : 0,
          patch.blocksCommissionRelease === undefined ? null : patch.blocksCommissionRelease ? 1 : 0,
          id
        ]
      );
      void currentRows;
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_risk_cases WHERE id = ? LIMIT 1", [id]);
      if (!rows[0]) throw new Error("risk case not found");
      return mapRiskCase(rows[0]);
    },

    async hasBlockingRisk(targetType, targetId, block) {
      const column = block === "withdrawal" ? "blocks_withdrawal" : "blocks_commission_release";
      const [rows] = await executor.query<DbRow[]>(
        `SELECT 1 FROM crm_risk_cases WHERE target_type = ? AND target_id = ? AND status IN ('open', 'reviewing') AND ${column} = 1 LIMIT 1`,
        [targetType, targetId]
      );
      return Boolean(rows[0]);
    },

    async getSettings() {
      const [rows] = await executor.query<DbRow[]>("SELECT setting_value FROM crm_settings WHERE setting_key = 'crm_settings' LIMIT 1");
      return mergeSettingsWithDefaults(jsonValue(rows[0]?.setting_value));
    },

    async saveSettings(settings, operatorCrmUserId) {
      await executor.query(
        `INSERT INTO crm_settings (setting_key, setting_value, updated_by_crm_user_id)
         VALUES ('crm_settings', ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by_crm_user_id = VALUES(updated_by_crm_user_id)`,
        [JSON.stringify(settings), operatorCrmUserId]
      );
      return this.getSettings();
    },

    async getDashboardSummary() {
      const [ledgerRows] = await executor.query<DbRow[]>(
        "SELECT COALESCE(SUM(CASE WHEN is_paid = 1 AND direction = 'credit' THEN paid_amount_rmb ELSE 0 END), 0) AS paid_topup_rmb FROM crm_ledger_entries"
      );
      const [commissionRows] = await executor.query<DbRow[]>(
        `SELECT
          COALESCE(SUM(CASE WHEN status = 'frozen' THEN commission_amount_rmb - released_amount_rmb ELSE 0 END), 0) AS frozen_commission_rmb,
          COALESCE(SUM(CASE WHEN status = 'releasable' THEN commission_amount_rmb - released_amount_rmb ELSE 0 END), 0) AS releasable_commission_rmb,
          COALESCE(SUM(released_amount_rmb), 0) AS released_commission_rmb
         FROM crm_commissions`
      );
      const [withdrawalRows] = await executor.query<DbRow[]>(
        `SELECT
          COALESCE(SUM(CASE WHEN status IN ('pending', 'approved') THEN amount_rmb ELSE 0 END), 0) AS pending_withdrawal_rmb,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_withdrawals,
          COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_withdrawals
         FROM crm_withdrawals`
      );
      const [accountEventRows] = await executor.query<DbRow[]>(
        "SELECT COUNT(*) AS reconcile_required_account_events FROM crm_account_events WHERE status = 'reconcile_required'"
      );
      const [offlineRechargeRows] = await executor.query<DbRow[]>(
        "SELECT COUNT(*) AS pending_offline_recharges FROM crm_offline_recharge_requests WHERE status = 'pending'"
      );
      const [riskRows] = await executor.query<DbRow[]>("SELECT COUNT(*) AS open_risk_cases FROM crm_risk_cases WHERE status = 'open'");
      const businessScope = buildBusinessUserScope({
        userAlias: "crm_user"
      });
      const businessUserJoin = `
        FROM crm_users crm_user
        ${businessScope.joinSql}
        WHERE ${businessScope.whereParts.join(" AND ")}
      `;
      const [crmUserRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS crm_user_count ${businessUserJoin}`, businessScope.params);
      const [agentRows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS agent_count
         FROM crm_agents agent
         JOIN crm_users crm_user ON crm_user.id = agent.crm_user_id
         ${businessScope.joinSql}
         WHERE ${businessScope.whereParts.join(" AND ")}`,
        businessScope.params
      );

      return {
        paidTopupRmb: numberValue(ledgerRows[0]?.paid_topup_rmb),
        frozenCommissionRmb: numberValue(commissionRows[0]?.frozen_commission_rmb),
        releasableCommissionRmb: numberValue(commissionRows[0]?.releasable_commission_rmb),
        releasedCommissionRmb: numberValue(commissionRows[0]?.released_commission_rmb),
        pendingWithdrawalRmb: numberValue(withdrawalRows[0]?.pending_withdrawal_rmb),
        reconcileRequiredAccountEvents: numberValue(accountEventRows[0]?.reconcile_required_account_events),
        pendingOfflineRecharges: numberValue(offlineRechargeRows[0]?.pending_offline_recharges),
        pendingWithdrawals: numberValue(withdrawalRows[0]?.pending_withdrawals),
        approvedWithdrawals: numberValue(withdrawalRows[0]?.approved_withdrawals),
        openRiskCases: numberValue(riskRows[0]?.open_risk_cases),
        userCount: numberValue(crmUserRows[0]?.crm_user_count),
        agentCount: numberValue(agentRows[0]?.agent_count)
      };
    }
  };
  return repository;
}

export function createMysqlRepository(config: CrmConfig): CrmRepository {
  const pool = createPool(buildDatabaseUrl(config.databaseUrl, config.databaseName));
  return createMysqlRepositoryForExecutor(pool, {
    close: () => pool.end(),
    withTransaction: async (work) => {
      const connection = await pool.getConnection();
      await connection.beginTransaction();
      const transactionRepository = createMysqlRepositoryForExecutor(connection, {
        transactional: true
      });
      try {
        const result = await work(transactionRepository);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  });
}

export function createRepository(config: CrmConfig): CrmRepository {
  if (!config.databaseUrl) {
    throw new Error("CRM_DATABASE_URL is required for durable CRM persistence");
  }
  return createMysqlRepository(config);
}
