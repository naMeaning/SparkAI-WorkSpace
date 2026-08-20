import type {
  AccountEventDto,
  AccountEventStatus,
  AccountEventType,
  AgentCustomerDto,
  AgentCategory,
  AgentDto,
  AgentLevel,
  AgentStatus,
  AgentRelationshipDto,
  AuditLogEntryDto,
  CommissionDto,
  CommissionStatus,
  CrmAgentDashboardDto,
  CrmSettingsDto,
  CrmUserDto,
  CrmUserProfileDto,
  EffectiveCustomerMaintenanceResultDto,
  EffectiveCustomerDto,
  EnterpriseMonthlySettlementDto,
  EnterpriseMonthlySettlementStatus,
  EnterpriseMonthlySettlementGenerationResultDto,
  LedgerDirection,
  LedgerEntryDto,
  OfflineRechargeMethod,
  OfflineRechargeRequestDto,
  OfflineRechargeStatus,
  LedgerEventType,
  OrderKind,
  PageResult,
  RiskCaseDto,
  RiskStatus,
  SignupTrialGrantStatus,
  WithdrawalCommissionAllocationDto,
  WithdrawalMethod,
  WithdrawalDto,
  WithdrawalStatus
} from "@ai-native/crm-contracts";

export interface CrmConfig {
  port: number;
  host: string;
  databaseUrl: string;
  databaseName: string;
  newApiBaseUrl: string;
  newApiAdminUserId: number;
  newApiAdminAccessToken: string;
  quotaPerRmb: number;
  crmEmbedTrustSecret: string;
  corsAllowedOrigins: string[];
  effectiveCustomerMaintenanceIntervalMinutes: number;
  usageSyncMaintenanceIntervalMinutes: number;
  enterpriseMonthlySettlementIntervalMinutes: number;
  attachmentStorageDir: string;
  attachmentMaxBytes: number;
}

export interface CrmUserContext {
  crmUserId: number;
  newApiUserId: number;
  isSuperAdmin: boolean;
}

export interface CrmHttpError extends Error {
  statusCode?: number;
  code?: string;
}

export interface NewApiUser {
  id: number;
  username?: string;
  display_name?: string;
  displayName?: string;
  email?: string;
  status?: number | string | null;
  quota?: number;
  used_quota?: number;
  usedQuota?: number;
  request_count?: number;
  requestCount?: number;
  group?: string;
  created_at?: number | string | null;
  createdAt?: number | string | null;
}

export interface NewApiQuotaPayload {
  newApiUserId: number;
  mode: "add" | "subtract";
  value: number;
}

export interface NewApiClient {
  getUser(newApiUserId: number): Promise<NewApiUser>;
  manageUserQuota(input: NewApiQuotaPayload): Promise<unknown>;
  listTopups(input?: { page?: number; pageSize?: number; keyword?: string }): Promise<unknown>;
  listConsumeLogs(input?: {
    page?: number;
    pageSize?: number;
    username?: string;
    startTimestamp?: string;
    endTimestamp?: string;
  }): Promise<unknown>;
}

export interface AccountEventInput {
  eventType: AccountEventType;
  crmUserId: number;
  operatorCrmUserId: number;
  amountRmb: number;
  paidAmountRmb: number;
  discountAmountRmb: number;
  commissionBaseRmb: number;
  quotaDelta: number;
  idempotencyKey: string;
  reason: string;
  metadata?: unknown;
}

export interface AccountEventRecord extends AccountEventDto {
  didMutate?: boolean;
}

export interface LedgerEntryCreate {
  crmUserId: number;
  direction: LedgerDirection;
  amountRmb: number;
  paidAmountRmb?: number;
  discountAmountRmb?: number;
  commissionBaseRmb?: number;
  eventType: LedgerEventType;
  sourceType: string;
  sourceId?: number | null;
  idempotencyKey: string;
  operatorCrmUserId?: number | null;
  reason?: string;
  isPaid: boolean;
  createdAt?: string;
}

export interface LedgerEntryRecord extends LedgerEntryDto {
  didMutate?: boolean;
}

export interface CrmUserRecord {
  id: number;
  username: string;
  email: string;
  newApiUserId: number | null;
  newApiRole: number;
  firstTopupDiscountRate: number | null;
  firstTopupDiscountUsedAt: string | null;
  signupTrialGrantStatus: SignupTrialGrantStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface CrmUserCreateInput {
  username: string;
  email?: string;
  newApiUserId?: number | null;
  newApiRole?: number;
  firstTopupDiscountRate?: number | null;
  signupTrialGrantStatus?: SignupTrialGrantStatus;
}

export interface CrmUserIdentityUpdateInput {
  username: string;
  email: string;
  newApiRole: number;
}

export interface AuditLogEntryCreate {
  operatorCrmUserId: number;
  targetType: string;
  targetId: number | string;
  action: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
}

export interface DashboardSummary {
  paidTopupRmb: number;
  frozenCommissionRmb: number;
  releasableCommissionRmb: number;
  releasedCommissionRmb: number;
  pendingWithdrawalRmb: number;
  reconcileRequiredAccountEvents: number;
  pendingOfflineRecharges: number;
  pendingWithdrawals: number;
  approvedWithdrawals: number;
  openRiskCases: number;
  userCount: number;
  agentCount: number;
}

export interface CommissionSummary {
  frozenCommissionRmb: number;
  releasableCommissionRmb: number;
  releasedCommissionRmb: number;
}

export interface AgentCreateInput {
  crmUserId: number;
  category?: AgentCategory;
  status?: AgentStatus;
  parentAgentCrmUserId?: number | null;
  operatorCrmUserId: number;
  reason: string;
}

export interface AgentRelationshipInput {
  customerCrmUserId: number;
  agentCrmUserId?: number;
  inviteCode?: string;
  allowRebind?: boolean;
  operatorCrmUserId: number;
  reason: string;
}

export interface CommissionCreateInput {
  sourceType: string;
  sourceId: number;
  beneficiaryCrmUserId: number;
  customerCrmUserId: number;
  commissionType: CommissionDto["commissionType"];
  orderKind: OrderKind;
  agentLevel: AgentLevel | null;
  baseAmountRmb: number;
  rate: number;
  amountRmb: number;
}

export interface WithdrawalCreateInput {
  beneficiaryCrmUserId: number;
  amountRmb: number;
  payoutMethod: WithdrawalMethod;
  payoutAccountName: string;
  payoutAccount: string;
  payoutBankName: string;
}

export interface OfflineRechargeRequestCreateInput {
  crmUserId: number;
  method: OfflineRechargeMethod;
  amountRmb: number;
  payerName: string;
  paymentReference: string;
  paymentEvidenceUrl: string;
  notes: string;
}

export interface OfflineRechargeRequestPatch {
  status: OfflineRechargeStatus;
  reviewerCrmUserId: number;
  reviewReason: string;
  accountEventId?: number | null;
}

export type EffectiveCustomerSaveInput = Omit<EffectiveCustomerDto, "id">;

export interface WithdrawalPatch {
  status: WithdrawalStatus;
  reviewerCrmUserId: number;
  reviewReason: string;
  paidReference?: string;
  paidEvidenceUrl?: string;
}

export interface WithdrawalPaymentInput {
  withdrawalId: number;
  operatorCrmUserId: number;
  reviewReason: string;
  paidReference: string;
  paidEvidenceUrl?: string;
}

export interface EnterpriseMonthlySettlementSaveInput {
  crmUserId: number;
  period: string;
  usageRmb: number;
  ledgerEntryCount: number;
  notes?: string;
}

export interface EnterpriseMonthlySettlementPatch {
  status: EnterpriseMonthlySettlementStatus;
  paidReference?: string;
  paidEvidenceUrl?: string;
  notes?: string;
}

export interface LedgerSummaryOptions {
  crmUserId: number;
  eventType?: LedgerEventType;
  direction?: LedgerDirection;
  createdAtFrom?: string;
  createdAtBefore?: string;
}

export interface LedgerSummary {
  amountRmb: number;
  entryCount: number;
}

export interface RiskCaseCreateInput {
  targetType: string;
  targetId: string;
  riskType: string;
  evidence?: unknown;
  notes: string;
  blocksWithdrawal: boolean;
  blocksCommissionRelease: boolean;
  createdByCrmUserId: number;
}

export interface RiskCasePatch {
  status?: RiskStatus;
  evidence?: unknown;
  notes?: string;
  blocksWithdrawal?: boolean;
  blocksCommissionRelease?: boolean;
}

export interface ListPageOptions {
  page?: number;
  pageSize?: number;
}

export type AccountEventListOptions = ListPageOptions & {
  crmUserId?: number;
  eventType?: AccountEventType;
  status?: AccountEventStatus;
};

export type LedgerListOptions = ListPageOptions & {
  crmUserId?: number;
  eventType?: LedgerEventType;
  direction?: LedgerDirection;
};

export type AuditLogListOptions = ListPageOptions & {
  operatorCrmUserId?: number;
  targetType?: string;
  targetId?: string;
  action?: string;
};

export interface CrmRepository {
  close(): Promise<void>;
  withTransaction<T>(work: (repository: CrmRepository) => Promise<T>): Promise<T>;

  createCrmUser(input: CrmUserCreateInput): Promise<CrmUserRecord>;
  getCrmUserById(crmUserId: number): Promise<CrmUserRecord | null>;
  getCrmUserByUsername(username: string): Promise<CrmUserRecord | null>;
  getCrmUserByNewApiUserId(newApiUserId: number): Promise<CrmUserRecord | null>;
  updateCrmUserIdentity(crmUserId: number, input: CrmUserIdentityUpdateInput): Promise<CrmUserRecord>;
  listCrmUsers(options?: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    excludeSuperAdmins?: boolean;
    hasAgentRelationship?: boolean;
    enterpriseOnly?: boolean;
  }): Promise<{ items: CrmUserRecord[]; total: number }>;
  markFirstTopupDiscountUsed(crmUserId: number, usedAt: string): Promise<CrmUserRecord>;
  markSignupTrialGrantStatus(crmUserId: number, status: SignupTrialGrantStatus): Promise<CrmUserRecord>;

  getUserProfile(crmUserId: number): Promise<CrmUserProfileDto>;
  saveUserProfile(profile: CrmUserProfileDto): Promise<CrmUserProfileDto>;

  findAccountEventByIdempotencyKey(idempotencyKey: string): Promise<AccountEventRecord | null>;
  getAccountEventById(id: number): Promise<AccountEventRecord | null>;
  createAccountEvent(record: AccountEventInput): Promise<AccountEventRecord>;
  markAccountEventQuotaApplying(id: number): Promise<AccountEventRecord>;
  markAccountEventQuotaApplied(id: number, patch: { newApiResult: unknown }): Promise<AccountEventRecord>;
  markAccountEventLocalApplying(id: number): Promise<AccountEventRecord>;
  completeAccountEvent(id: number, patch: { quotaDelta: number; newApiResult: unknown }): Promise<AccountEventRecord>;
  markAccountEventReconcileRequired(id: number, reason: string): Promise<AccountEventRecord>;
  cancelAccountEvent(id: number, reason: string): Promise<AccountEventRecord>;
  listAccountEvents(options?: AccountEventListOptions): Promise<PageResult<AccountEventDto>>;

  insertLedgerEntry(entry: LedgerEntryCreate): Promise<LedgerEntryRecord>;
  findLedgerEntryByIdempotencyKey(idempotencyKey: string): Promise<LedgerEntryDto | null>;
  sumLedgerAmount(options: LedgerSummaryOptions): Promise<number>;
  summarizeLedger(options: LedgerSummaryOptions): Promise<LedgerSummary>;
  listLedger(options?: LedgerListOptions): Promise<PageResult<LedgerEntryDto>>;

  insertAuditLog(entry: AuditLogEntryCreate): Promise<AuditLogEntryDto>;
  listAuditLogs(options?: AuditLogListOptions): Promise<PageResult<AuditLogEntryDto>>;

  getAgentById(agentId: number): Promise<AgentDto | null>;
  getAgentByCrmUserId(crmUserId: number): Promise<AgentDto | null>;
  getAgentByInviteCode(inviteCode: string): Promise<AgentDto | null>;
  saveAgent(input: Omit<AgentDto, "id" | "createdAt" | "updatedAt"> & { id?: number }): Promise<AgentDto>;
  listAgents(options?: ListPageOptions & { parentAgentCrmUserId?: number; businessOnly?: boolean }): Promise<PageResult<AgentDto>>;
  countSubAgents(agentCrmUserId: number): Promise<number>;

  getAgentRelationshipByCustomer(crmUserId: number): Promise<AgentRelationshipDto | null>;
  saveAgentRelationship(customerCrmUserId: number, relationship: AgentRelationshipDto): Promise<AgentRelationshipDto>;
  listAgentCustomers(agentCrmUserId: number, options?: { page?: number; pageSize?: number; keyword?: string }): Promise<AgentCustomerDto[]>;
  countAgentCustomers(agentCrmUserId: number, options?: { keyword?: string }): Promise<number>;

  getEffectiveCustomerByAgentAndCustomer(agentId: number, customerCrmUserId: number): Promise<EffectiveCustomerDto | null>;
  saveEffectiveCustomer(input: EffectiveCustomerSaveInput): Promise<EffectiveCustomerDto>;
  listEffectiveCustomers(options?: ListPageOptions & {
    agentId?: number;
    customerCrmUserId?: number;
    isEffective?: boolean;
    countedForLevel?: boolean;
  }): Promise<PageResult<EffectiveCustomerDto>>;
  countEffectiveCustomers(agentId: number, options?: { firstPaidAtFrom?: string }): Promise<number>;

  getCommissionSummary(beneficiaryCrmUserId: number): Promise<CommissionSummary>;
  listCommissions(options?: {
    beneficiaryCrmUserId?: number;
    status?: CommissionStatus;
    sourceType?: string;
    sourceId?: number;
  } & ListPageOptions): Promise<PageResult<CommissionDto>>;
  insertCommissionRecords(rows: CommissionCreateInput[]): Promise<CommissionDto[]>;
  updateCommissionStatus(id: number, status: CommissionStatus, operatorCrmUserId: number, reason: string): Promise<CommissionDto>;

  createWithdrawal(input: WithdrawalCreateInput): Promise<WithdrawalDto>;
  createWithdrawalWithBalanceCheck(input: WithdrawalCreateInput): Promise<WithdrawalDto>;
  getWithdrawalById(id: number): Promise<WithdrawalDto | null>;
  listWithdrawals(options?: ListPageOptions & { beneficiaryCrmUserId?: number; status?: WithdrawalStatus }): Promise<PageResult<WithdrawalDto>>;
  sumWithdrawals(options?: { beneficiaryCrmUserId?: number; status?: WithdrawalStatus }): Promise<number>;
  updateWithdrawal(
    id: number,
    patch: WithdrawalPatch,
    expectedStatus: WithdrawalStatus
  ): Promise<WithdrawalDto | null>;
  markWithdrawalPaidWithAllocations(input: WithdrawalPaymentInput): Promise<{
    withdrawal: WithdrawalDto;
    allocations: WithdrawalCommissionAllocationDto[];
  }>;
  listWithdrawalCommissionAllocations(withdrawalId: number): Promise<WithdrawalCommissionAllocationDto[]>;

  saveEnterpriseMonthlySettlement(input: EnterpriseMonthlySettlementSaveInput): Promise<{
    settlement: EnterpriseMonthlySettlementDto;
    created: boolean;
    updated: boolean;
  }>;
  getEnterpriseMonthlySettlementById(id: number): Promise<EnterpriseMonthlySettlementDto | null>;
  listEnterpriseMonthlySettlements(options?: ListPageOptions & {
    period?: string;
    status?: EnterpriseMonthlySettlementStatus;
    crmUserId?: number;
  }): Promise<PageResult<EnterpriseMonthlySettlementDto>>;
  updateEnterpriseMonthlySettlement(
    id: number,
    patch: EnterpriseMonthlySettlementPatch,
    expectedStatus: EnterpriseMonthlySettlementStatus
  ): Promise<EnterpriseMonthlySettlementDto | null>;

  createOfflineRechargeRequest(input: OfflineRechargeRequestCreateInput): Promise<OfflineRechargeRequestDto>;
  getOfflineRechargeRequestById(id: number): Promise<OfflineRechargeRequestDto | null>;
  listOfflineRechargeRequests(options?: ListPageOptions & {
    crmUserId?: number;
    status?: OfflineRechargeStatus;
  }): Promise<PageResult<OfflineRechargeRequestDto>>;
  updateOfflineRechargeRequest(
    id: number,
    patch: OfflineRechargeRequestPatch,
    expectedStatus: OfflineRechargeStatus
  ): Promise<OfflineRechargeRequestDto | null>;

  createRiskCase(input: RiskCaseCreateInput): Promise<RiskCaseDto>;
  listRiskCases(options?: ListPageOptions & { status?: RiskStatus; targetType?: string; targetId?: string }): Promise<PageResult<RiskCaseDto>>;
  updateRiskCase(id: number, patch: RiskCasePatch): Promise<RiskCaseDto>;
  hasBlockingRisk(targetType: string, targetId: string, block: "withdrawal" | "commission_release"): Promise<boolean>;

  getSettings(): Promise<CrmSettingsDto>;
  saveSettings(settings: CrmSettingsDto, operatorCrmUserId: number): Promise<CrmSettingsDto>;

  getDashboardSummary(): Promise<DashboardSummary>;
}

export interface ListUsersResult {
  items: CrmUserDto[];
  total: number;
  page: number;
  pageSize: number;
}

export {
  type AccountEventDto,
  type AgentDto,
  type AgentRelationshipDto,
  type AuditLogEntryDto,
  type CommissionDto,
  type CrmAgentDashboardDto,
  type CrmSettingsDto,
  type CrmUserDto,
  type CrmUserProfileDto,
  type EffectiveCustomerMaintenanceResultDto,
  type EffectiveCustomerDto,
  type EnterpriseMonthlySettlementDto,
  type EnterpriseMonthlySettlementGenerationResultDto,
  type LedgerEntryDto,
  type OfflineRechargeRequestDto,
  type RiskCaseDto,
  type WithdrawalCommissionAllocationDto,
  type WithdrawalDto
};
