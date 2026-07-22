export const crmModules = [
  { key: "dashboard", label: "经营概览" },
  { key: "users", label: "用户管理" },
  { key: "accountEvents", label: "入账事件" },
  { key: "ledger", label: "账本流水" },
  { key: "agents", label: "代理管理" },
  { key: "relationships", label: "客户归属" },
  { key: "effectiveCustomers", label: "有效客户" },
  { key: "commissions", label: "佣金管理" },
  { key: "offlineRecharges", label: "线下充值" },
  { key: "withdrawals", label: "提现审核" },
  { key: "enterprise", label: "大客户" },
  { key: "risk", label: "风控" },
  { key: "audit", label: "审计日志" },
  { key: "settings", label: "系统设置" }
] as const;

export const crmPageCapabilities = {
  agent: "agent",
  superAdmin: "super_admin"
} as const;

export const crmRolePageGroups = [
  { key: crmPageCapabilities.agent, label: "我的分销" },
  { key: crmPageCapabilities.superAdmin, label: "平台管理" }
] as const;

export const agentStatuses = {
  active: "active",
  disabled: "disabled"
} as const;

export const agentCategories = {
  normal: "normal",
  strategic: "strategic"
} as const;

export const agentLevels = {
  standard: "standard",
  advanced: "advanced",
  core: "core",
  gold: "gold"
} as const;

export interface AgentLevelRule {
  level: AgentLevel;
  label: string;
  effectivePaidCustomerThreshold: number;
  firstOrderRate: number;
  repurchaseRate: number;
}

export interface AgentCommissionRuleSet {
  category: AgentCategory;
  label: string;
  rules: AgentLevelRule[];
}

export const standardAgentLevelRules = [
  { level: agentLevels.standard, label: "普通代理", effectivePaidCustomerThreshold: 0, firstOrderRate: 0.45, repurchaseRate: 0.135 },
  { level: agentLevels.advanced, label: "进阶代理", effectivePaidCustomerThreshold: 10, firstOrderRate: 0.5, repurchaseRate: 0.15 },
  { level: agentLevels.core, label: "核心代理", effectivePaidCustomerThreshold: 30, firstOrderRate: 0.55, repurchaseRate: 0.165 },
  { level: agentLevels.gold, label: "金牌代理", effectivePaidCustomerThreshold: 80, firstOrderRate: 0.6, repurchaseRate: 0.18 }
] satisfies AgentLevelRule[];

const strategicAgentLevelRules = [
  { level: agentLevels.standard, label: "普通代理", effectivePaidCustomerThreshold: 0, firstOrderRate: 0.45, repurchaseRate: 0.135 },
  { level: agentLevels.advanced, label: "进阶代理", effectivePaidCustomerThreshold: 10, firstOrderRate: 0.5, repurchaseRate: 0.15 },
  { level: agentLevels.core, label: "核心代理", effectivePaidCustomerThreshold: 30, firstOrderRate: 0.55, repurchaseRate: 0.165 },
  { level: agentLevels.gold, label: "金牌代理", effectivePaidCustomerThreshold: 80, firstOrderRate: 0.6, repurchaseRate: 0.18 }
] satisfies AgentLevelRule[];

export const agentCommissionRuleSets = [
  { category: agentCategories.normal, label: "普通代理", rules: standardAgentLevelRules },
  { category: agentCategories.strategic, label: "深度合作代理", rules: strategicAgentLevelRules }
] satisfies AgentCommissionRuleSet[];

export const parentAgentServiceFeeRules = {
  firstOrderRate: 0.1,
  repurchaseRate: 0.03
} as const;

export const platformCommissionCaps = {
  firstOrderRate: 0.7,
  repurchaseRate: 0.21
} as const;

export const effectiveCustomerRules = {
  minFirstPaidRmb: 29.9,
  minPaidBalanceConsumedRate: 0.3,
  refundObservationDays: 7,
  levelRetentionDays: 90
} as const;

export const signupTrialGrantRmb = 2 as const;

export const signupTrialGrantStatuses = {
  pending: "pending",
  granted: "granted"
} as const;

export const inviteFirstTopupDiscountRate = 0.88 as const;

export const accountEventTypes = {
  adminPaidTopup: "admin_paid_topup",
  compensationGrant: "compensation_grant",
  exceptionAdjustment: "exception_adjustment",
  onlineTopup: "online_topup",
  signupTrialGrant: "signup_trial_grant",
  refund: "refund"
} as const;

export const accountEventStatuses = {
  pending: "pending",
  quotaApplying: "quota_applying",
  quotaApplied: "quota_applied",
  localApplying: "local_applying",
  completed: "completed",
  reconcileRequired: "reconcile_required",
  cancelled: "cancelled"
} as const;

export const ledgerEventTypes = {
  onlineTopup: "online_topup",
  accountEvent: "account_event",
  signupTrialGrant: "signup_trial_grant",
  imageConsume: "image_consume",
  refund: "refund",
  commissionFreeze: "commission_freeze",
  commissionRelease: "commission_release",
  commissionWithdrawal: "commission_withdrawal",
  commissionClawback: "commission_clawback"
} as const;

export const ledgerDirections = {
  credit: "credit",
  debit: "debit"
} as const;

export const agentRelationshipBindSources = {
  inviteCode: "invite_code",
  adminBind: "admin_bind",
  adminRebind: "admin_rebind"
} as const;

export const agentRelationshipStatuses = {
  active: "active",
  rebound: "rebound",
  cancelled: "cancelled"
} as const;

export const commissionTypes = {
  agentDirectCommission: "agent_direct_commission",
  parentAgentServiceFee: "parent_agent_service_fee",
  enterpriseFixedPerImage: "enterprise_fixed_per_image"
} as const;

export const commissionStatuses = {
  frozen: "frozen",
  releasable: "releasable",
  released: "released",
  blocked: "blocked",
  clawedBack: "clawed_back"
} as const;

export const orderKinds = {
  firstOrder: "first_order",
  repurchase: "repurchase"
} as const;

export const riskStatuses = {
  open: "open",
  reviewing: "reviewing",
  resolved: "resolved",
  ignored: "ignored"
} as const;

export const riskTargetTypes = {
  user: "user",
  agent: "agent",
  agentRelationship: "agent_relationship",
  accountEvent: "account_event",
  commission: "commission",
  withdrawal: "withdrawal",
  enterpriseMonthlySettlement: "enterprise_monthly_settlement"
} as const;

export const riskCaseTypes = {
  abnormalRegistration: "异常注册",
  relatedAccount: "关联账号",
  abnormalUsage: "异常用量",
  paymentDispute: "支付争议",
  commissionRisk: "佣金风险",
  withdrawalRisk: "提现风险",
  manualReview: "人工复核"
} as const;

export const withdrawalStatuses = {
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
  paid: "paid",
  cancelled: "cancelled"
} as const;

export const withdrawalMethods = {
  alipay: "alipay",
  wechat: "wechat",
  bank: "bank"
} as const;

export const enterpriseMonthlySettlementStatuses = {
  pending: "pending",
  paid: "paid",
  cancelled: "cancelled"
} as const;

export const offlineRechargeMethods = {
  alipay: "alipay",
  wechat: "wechat"
} as const;

export const offlineRechargeStatuses = {
  pending: "pending",
  approved: "approved",
  rejected: "rejected"
} as const;

export interface OfflineRechargeAccount {
  method: OfflineRechargeMethod;
  label: string;
  recipientName: string;
  account: string;
  qrCodeUrl: string;
  instructions: string;
}

export const defaultOfflineRechargeAccounts = [
  {
    method: offlineRechargeMethods.alipay,
    label: "支付宝",
    recipientName: "",
    account: "",
    qrCodeUrl: "",
    instructions: ""
  },
  {
    method: offlineRechargeMethods.wechat,
    label: "微信",
    recipientName: "",
    account: "",
    qrCodeUrl: "",
    instructions: ""
  }
] satisfies OfflineRechargeAccount[];

export const defaultCrmSettings = {
  agentCommissionRuleSets,
  parentAgentServiceFeeRules,
  platformCommissionCaps,
  effectiveCustomerRules,
  withdrawalMinAmountRmb: 100,
  enterpriseDefaultFixedCommissionPerImage: 0.02,
  offlineRechargeAccounts: defaultOfflineRechargeAccounts
} as const;

type ValueOf<T> = T[keyof T];

export type CrmModuleKey = (typeof crmModules)[number]["key"];
export type CrmPageCapability = ValueOf<typeof crmPageCapabilities>;
export type AgentStatus = ValueOf<typeof agentStatuses>;
export type AgentCategory = ValueOf<typeof agentCategories>;
export type AgentLevel = ValueOf<typeof agentLevels>;
export type AccountEventType = ValueOf<typeof accountEventTypes>;
export type AccountEventStatus = ValueOf<typeof accountEventStatuses>;
export type LedgerEventType = ValueOf<typeof ledgerEventTypes>;
export type LedgerDirection = ValueOf<typeof ledgerDirections>;
export type AgentRelationshipBindSource = ValueOf<typeof agentRelationshipBindSources>;
export type AgentRelationshipStatus = ValueOf<typeof agentRelationshipStatuses>;
export type CommissionType = ValueOf<typeof commissionTypes>;
export type CommissionStatus = ValueOf<typeof commissionStatuses>;
export type OrderKind = ValueOf<typeof orderKinds>;
export type RiskStatus = ValueOf<typeof riskStatuses>;
export type RiskTargetType = ValueOf<typeof riskTargetTypes>;
export type RiskCaseType = ValueOf<typeof riskCaseTypes>;
export type WithdrawalStatus = ValueOf<typeof withdrawalStatuses>;
export type WithdrawalMethod = ValueOf<typeof withdrawalMethods>;
export type EnterpriseMonthlySettlementStatus = ValueOf<typeof enterpriseMonthlySettlementStatuses>;
export type OfflineRechargeMethod = ValueOf<typeof offlineRechargeMethods>;
export type OfflineRechargeStatus = ValueOf<typeof offlineRechargeStatuses>;
export type SignupTrialGrantStatus = ValueOf<typeof signupTrialGrantStatuses>;

export interface CrmUserProfileDto {
  crmUserId: number;
  phone: string;
  wechat: string;
  remark: string;
  cumulativePaidRmb: number;
  isEnterprise: boolean;
  enterprisePriceRmb: number | null;
  enterpriseFixedCommissionPerImage: number | null;
  isRisk: boolean;
}

export interface CrmUserDto extends CrmUserProfileDto {
  username: string;
  displayName: string;
  email: string;
  newApiRole: number;
  firstTopupDiscountRate: number | null;
  firstTopupDiscountAvailable: boolean;
  signupTrialGrantStatus: SignupTrialGrantStatus;
  createdAt: string | null;
  agentRelationship: AgentRelationshipDto | null;
  agent: AgentDto | null;
}

export interface CrmSessionDto {
  currentUser: CrmUserDto;
  agent: AgentDto | null;
  capabilities: CrmPageCapability[];
  pageGroups: Array<{
    key: CrmPageCapability;
    label: string;
  }>;
}

export interface CrmApiSuccessPayload<T> {
  ok: true;
  data: T;
}

export interface CrmApiErrorPayload {
  ok: false;
  error_code: string;
  err_msg: string;
}

export type CrmApiPayload<T> = CrmApiSuccessPayload<T> | CrmApiErrorPayload;

export interface PageResult<T> {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
}

export interface AgentDto {
  id: number;
  crmUserId: number;
  username?: string;
  email?: string;
  status: AgentStatus;
  category: AgentCategory;
  inviteCode: string;
  parentAgentId: number | null;
  parentAgentCrmUserId: number | null;
  parentAgentUsername?: string;
  level: AgentLevel;
  effectivePaidCustomerCount: number;
  levelEffectiveAt: string | null;
  levelExpiresAt: string | null;
  lastLevelEvaluatedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentRelationshipDto {
  id?: number;
  customerCrmUserId: number;
  customerUsername?: string;
  agentCrmUserId: number;
  agentUsername?: string;
  bindSource: AgentRelationshipBindSource;
  status: AgentRelationshipStatus;
  bindReason: string;
}

export interface AgentCustomerDto {
  customerCrmUserId: number;
  customer: {
    crmUserId: number;
    username: string;
    email: string;
    createdAt?: string;
  };
  relationship: AgentRelationshipDto;
}

export interface CrmAgentDashboardDto {
  agent: AgentDto;
  customerCount: number;
  subAgentCount: number;
  frozenCommissionRmb: number;
  releasableCommissionRmb: number;
  pendingWithdrawalRmb: number;
  availableCommissionRmb: number;
  releasedCommissionRmb: number;
  paidWithdrawalRmb: number;
}

export interface AccountEventDto {
  id: number;
  eventType: AccountEventType;
  crmUserId: number;
  crmUsername?: string;
  operatorCrmUserId: number | null;
  operatorUsername?: string;
  amountRmb: number;
  paidAmountRmb: number;
  discountAmountRmb: number;
  commissionBaseRmb: number;
  quotaDelta: number;
  status: AccountEventStatus;
  idempotencyKey: string;
  reason: string;
  newApiResult: unknown;
  metadata: unknown;
  createdAt?: string;
  completedAt?: string | null;
}

export interface AccountEventCreateInput {
  eventType: AccountEventType;
  crmUserId: number;
  amountRmb: number;
  idempotencyKey?: string;
  reason: string;
}

export interface LedgerEntryDto {
  id: number;
  crmUserId: number;
  crmUsername?: string;
  direction: LedgerDirection;
  amountRmb: number;
  paidAmountRmb: number;
  discountAmountRmb: number;
  commissionBaseRmb: number;
  balanceAfterRmb: number;
  eventType: LedgerEventType;
  sourceType: string;
  sourceId: number | null;
  idempotencyKey: string;
  operatorCrmUserId: number | null;
  operatorUsername?: string;
  reason: string;
  isPaid: boolean;
  createdAt?: string;
}

export interface CrmUsageLogDto {
  id: string;
  crmUserId: number;
  username: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  quota: number;
  rmbCost: number;
  content: string;
  createdAt: string;
}

export interface CrmUsageSyncResultDto {
  crmUserId: number;
  newApiUsername: string;
  logsRead: number;
  syncedLogs: number;
  skippedLogs: number;
  effectiveCustomers: EffectiveCustomerDto[];
}

export interface EffectiveCustomerMaintenanceResultDto {
  evaluatedAt: string;
  candidatesScanned: number;
  customersSynced: number;
  usageLogsSynced: number;
  syncFailures: Array<{
    customerCrmUserId: number;
    errorCode: string;
  }>;
  candidatesEvaluated: number;
  agentsChecked: number;
  agentsRechecked: number;
  agentsDowngraded: number;
}

export interface EnterpriseMonthlySettlementDto {
  id: number;
  crmUserId: number;
  crmUsername?: string;
  period: string;
  usageRmb: number;
  ledgerEntryCount: number;
  status: EnterpriseMonthlySettlementStatus;
  paidReference: string;
  paidEvidenceUrl: string;
  notes: string;
  generatedAt?: string;
  paidAt?: string | null;
  updatedAt?: string;
}

export interface EnterpriseMonthlySettlementGenerationResultDto {
  period: string;
  customersScanned: number;
  customersSynced: number;
  syncFailures: Array<{
    crmUserId: number;
    errorCode: string;
  }>;
  settlementsGenerated: number;
  settlementsSkipped: number;
  totalUsageRmb: number;
}

export interface CommissionDto {
  id?: number;
  sourceType: string;
  sourceId: number;
  beneficiaryCrmUserId: number;
  beneficiaryUsername?: string;
  customerCrmUserId: number;
  customerUsername?: string;
  commissionType: CommissionType;
  orderKind: OrderKind;
  agentLevel: AgentLevel | null;
  status: CommissionStatus;
  baseAmountRmb: number;
  rate: number;
  amountRmb: number;
  releasedAmountRmb: number;
  riskCaseId?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EffectiveCustomerDto {
  id: number;
  agentId: number;
  agentCrmUserId?: number;
  agentUsername?: string;
  customerCrmUserId: number;
  customerUsername?: string;
  customerEmail?: string;
  firstPaidEventId: number;
  firstPaidAmountRmb: number;
  firstPaidAt: string;
  sevenDayCheckedAt: string | null;
  paidBalanceConsumedRate: number;
  isRefunded: boolean;
  isRelatedAccount: boolean;
  isRisk: boolean;
  isEffective: boolean;
  countedForLevel: boolean;
}

export interface WithdrawalDto {
  id: number;
  beneficiaryCrmUserId: number;
  beneficiaryUsername?: string;
  amountRmb: number;
  payoutMethod: WithdrawalMethod;
  payoutAccountName: string;
  payoutAccount: string;
  payoutBankName: string;
  status: WithdrawalStatus;
  reviewerCrmUserId: number | null;
  reviewerUsername?: string;
  reviewReason: string;
  paidReference: string;
  paidEvidenceUrl: string;
  createdAt?: string;
  reviewedAt?: string | null;
  paidAt?: string | null;
}

export interface WithdrawalCommissionAllocationDto {
  id: number;
  withdrawalId: number;
  commissionId: number;
  amountRmb: number;
  createdAt?: string;
}

export interface OfflineRechargeRequestDto {
  id: number;
  crmUserId: number;
  crmUsername?: string;
  method: OfflineRechargeMethod;
  amountRmb: number;
  payerName: string;
  paymentReference: string;
  paymentEvidenceUrl: string;
  notes: string;
  status: OfflineRechargeStatus;
  reviewerCrmUserId: number | null;
  reviewerUsername?: string;
  reviewReason: string;
  accountEventId: number | null;
  createdAt?: string;
  reviewedAt?: string | null;
}

export interface RiskCaseDto {
  id: number;
  targetType: string;
  targetId: string;
  riskType: string;
  status: RiskStatus;
  evidence: unknown;
  notes: string;
  blocksWithdrawal: boolean;
  blocksCommissionRelease: boolean;
  createdByCrmUserId: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuditLogEntryDto {
  id: number;
  operatorCrmUserId: number;
  operatorUsername?: string;
  targetType: string;
  targetId: string;
  action: string;
  reason: string;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  requestIp?: string;
  userAgent?: string;
  createdAt?: string;
}

export interface CrmSchedulerHealthDto {
  enabled: boolean;
  intervalMinutes: number;
  running: boolean;
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string;
  lastErrorMessage: string;
}

export interface CrmSchedulersHealthDto {
  usageSync: CrmSchedulerHealthDto;
  effectiveCustomerMaintenance: CrmSchedulerHealthDto;
  enterpriseMonthlySettlement: CrmSchedulerHealthDto;
}

export interface CrmSettingsDto {
  agentCommissionRuleSets: AgentCommissionRuleSet[];
  parentAgentServiceFeeRules: typeof parentAgentServiceFeeRules;
  platformCommissionCaps: typeof platformCommissionCaps;
  effectiveCustomerRules: typeof effectiveCustomerRules;
  withdrawalMinAmountRmb: number;
  enterpriseDefaultFixedCommissionPerImage: number;
  offlineRechargeAccounts: OfflineRechargeAccount[];
}
