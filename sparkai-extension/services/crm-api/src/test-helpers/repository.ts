import {
  accountEventStatuses,
  agentCategories,
  agentLevels,
  agentRelationshipStatuses,
  defaultCrmSettings,
  enterpriseMonthlySettlementStatuses,
  ledgerDirections,
  ledgerEventTypes,
  offlineRechargeStatuses,
  signupTrialGrantStatuses,
  withdrawalMethods,
  type AgentDto,
  type AgentRelationshipDto,
  type AuditLogEntryDto,
  type CommissionDto,
  type CrmSettingsDto,
  type CrmUserProfileDto,
  type EffectiveCustomerDto,
  type EnterpriseMonthlySettlementDto,
  type LedgerEntryDto,
  type OfflineRechargeRequestDto,
  type PageResult,
  type RiskCaseDto,
  type WithdrawalCommissionAllocationDto,
  type WithdrawalDto
} from "@ai-native/crm-contracts";
import type {
  AccountEventInput,
  AccountEventRecord,
  AuditLogEntryCreate,
  CommissionCreateInput,
  CrmUserCreateInput,
  CrmUserIdentityUpdateInput,
  CrmUserRecord,
  CrmRepository,
  EffectiveCustomerSaveInput,
  EnterpriseMonthlySettlementPatch,
  EnterpriseMonthlySettlementSaveInput,
  LedgerEntryCreate,
  LedgerSummaryOptions,
  RiskCaseCreateInput,
  RiskCasePatch,
  WithdrawalCreateInput,
  WithdrawalPatch
} from "../types.js";
import { httpError } from "../http.js";
import { getCrmRequestContext } from "../request-context.js";

function paginate<T>(rows: T[], options: { page?: number; pageSize?: number } = {}): PageResult<T> {
  const page = options.page || 1;
  const pageSize = options.pageSize || 20;
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize
  };
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ledgerInRange(entry: LedgerEntryDto, options: LedgerSummaryOptions): boolean {
  const createdAt = parseDate(entry.createdAt);
  const from = parseDate(options.createdAtFrom);
  const before = parseDate(options.createdAtBefore);
  if (from && (!createdAt || createdAt.getTime() < from.getTime())) return false;
  if (before && (!createdAt || createdAt.getTime() >= before.getTime())) return false;
  return true;
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

export function createMemoryRepository(): CrmRepository {
  const crmUsers = new Map<number, CrmUserRecord>();
  const crmUsernames = new Map<string, number>();
  const profiles = new Map<number, CrmUserProfileDto>();
  const accountEvents = new Map<string, AccountEventRecord>();
  const ledgerEntries: LedgerEntryDto[] = [];
  const audits: AuditLogEntryDto[] = [];
  const agents = new Map<number, AgentDto>();
  const relationships = new Map<number, AgentRelationshipDto>();
  const effectiveCustomers: EffectiveCustomerDto[] = [];
  const commissions: CommissionDto[] = [];
  const withdrawals: WithdrawalDto[] = [];
  const withdrawalCommissionAllocations: WithdrawalCommissionAllocationDto[] = [];
  const enterpriseMonthlySettlements: EnterpriseMonthlySettlementDto[] = [];
  const offlineRechargeRequests: OfflineRechargeRequestDto[] = [];
  const riskCases: RiskCaseDto[] = [];
  const withdrawalLocks = new Map<number, Promise<void>>();
  let settings: CrmSettingsDto = defaultCrmSettings;

  async function withWithdrawalLock<T>(crmUserId: number, work: () => Promise<T>): Promise<T> {
    const previous = withdrawalLocks.get(crmUserId) || Promise.resolve();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    withdrawalLocks.set(crmUserId, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (withdrawalLocks.get(crmUserId) === tail) withdrawalLocks.delete(crmUserId);
    }
  }

  const rootUser: CrmUserRecord = {
    id: 1,
    username: "root",
    email: "",
    newApiUserId: 1,
    newApiRole: 100,
    firstTopupDiscountRate: null,
    firstTopupDiscountUsedAt: null,
    signupTrialGrantStatus: signupTrialGrantStatuses.granted
  };
  crmUsers.set(rootUser.id, rootUser);
  crmUsernames.set(rootUser.username, rootUser.id);

  function findAccountEventById(id: number): AccountEventRecord {
    const record = [...accountEvents.values()].find((item) => item.id === id);
    if (!record) throw new Error("account event not found");
    return record;
  }

  function saveAccountEvent(record: AccountEventRecord): AccountEventRecord {
    accountEvents.set(record.idempotencyKey, record);
    return record;
  }

  function userSummary(crmUserId: number): { username: string; email: string } {
    const user = crmUsers.get(crmUserId);
    return {
      username: user?.username || "",
      email: user?.email || ""
    };
  }

  function withAgentDisplay(agent: AgentDto): AgentDto {
    const user = userSummary(agent.crmUserId);
    return {
      ...agent,
      username: user.username,
      email: user.email,
      parentAgentUsername: agent.parentAgentCrmUserId ? userSummary(agent.parentAgentCrmUserId).username : undefined
    };
  }

  function withRelationshipDisplay(relationship: AgentRelationshipDto): AgentRelationshipDto {
    return {
      ...relationship,
      customerUsername: userSummary(relationship.customerCrmUserId).username,
      agentUsername: userSummary(relationship.agentCrmUserId).username
    };
  }

  function withCommissionDisplay(commission: CommissionDto): CommissionDto {
    return {
      ...commission,
      beneficiaryUsername: userSummary(commission.beneficiaryCrmUserId).username,
      customerUsername: userSummary(commission.customerCrmUserId).username
    };
  }

  function withWithdrawalDisplay(withdrawal: WithdrawalDto): WithdrawalDto {
    return {
      ...withdrawal,
      beneficiaryUsername: userSummary(withdrawal.beneficiaryCrmUserId).username,
      reviewerUsername: withdrawal.reviewerCrmUserId ? userSummary(withdrawal.reviewerCrmUserId).username : undefined
    };
  }

  function withOfflineRechargeDisplay(request: OfflineRechargeRequestDto): OfflineRechargeRequestDto {
    return {
      ...request,
      crmUsername: userSummary(request.crmUserId).username,
      reviewerUsername: request.reviewerCrmUserId ? userSummary(request.reviewerCrmUserId).username : undefined
    };
  }

  function withEnterpriseMonthlySettlementDisplay(settlement: EnterpriseMonthlySettlementDto): EnterpriseMonthlySettlementDto {
    return {
      ...settlement,
      crmUsername: userSummary(settlement.crmUserId).username
    };
  }

  const repository: CrmRepository = {
    async close() {},
    async withTransaction(work) {
      return work(repository);
    },
    async createCrmUser(input: CrmUserCreateInput) {
      if (crmUsernames.has(input.username)) {
        throw new Error("CRM username already exists");
      }
      const stored: CrmUserRecord = {
        id: crmUsers.size + 1,
        username: input.username,
        email: input.email || "",
        newApiUserId: input.newApiUserId ?? null,
        newApiRole: input.newApiRole ?? 1,
        firstTopupDiscountRate: input.firstTopupDiscountRate ?? null,
        firstTopupDiscountUsedAt: null,
        signupTrialGrantStatus: input.signupTrialGrantStatus || signupTrialGrantStatuses.granted
      };
      crmUsers.set(stored.id, stored);
      crmUsernames.set(stored.username, stored.id);
      return stored;
    },
    async getCrmUserById(crmUserId) {
      return crmUsers.get(crmUserId) || null;
    },
    async getCrmUserByUsername(username) {
      const id = crmUsernames.get(username);
      return id ? crmUsers.get(id) || null : null;
    },
    async getCrmUserByNewApiUserId(newApiUserId) {
      return [...crmUsers.values()].find((user) => user.newApiUserId === newApiUserId) || null;
    },
    async updateCrmUserIdentity(crmUserId, input: CrmUserIdentityUpdateInput) {
      const user = crmUsers.get(crmUserId);
      if (!user) throw new Error("CRM user not found");
      const owner = crmUsernames.get(input.username);
      if (owner && owner !== crmUserId) throw new Error("CRM username already exists");
      crmUsernames.delete(user.username);
      const next = {
        ...user,
        username: input.username,
        email: input.email,
        newApiRole: input.newApiRole
      };
      crmUsers.set(crmUserId, next);
      crmUsernames.set(next.username, crmUserId);
      return next;
    },
    async listCrmUsers(options = {}) {
      const keyword = (options.keyword || "").toLowerCase();
      const page = options.page || 1;
      const pageSize = options.pageSize || 20;
      const rows = [...crmUsers.values()]
        .filter((user) => user.newApiUserId !== null)
        .filter((user) => !options.excludeSuperAdmins || user.newApiRole < 100)
        .filter((user) => !options.hasAgentRelationship || relationships.get(user.id)?.status === "active")
        .filter((user) => !options.enterpriseOnly || profiles.get(user.id)?.isEnterprise)
        .filter((user) => !keyword || user.username.toLowerCase().includes(keyword) || user.email.toLowerCase().includes(keyword))
        .sort((left, right) => right.id - left.id);
      return {
        items: rows.slice((page - 1) * pageSize, page * pageSize),
        total: rows.length
      };
    },
    async markFirstTopupDiscountUsed(crmUserId, usedAt) {
      const user = crmUsers.get(crmUserId);
      if (!user) throw new Error("CRM user not found");
      const next = { ...user, firstTopupDiscountUsedAt: usedAt };
      crmUsers.set(crmUserId, next);
      return next;
    },
    async markSignupTrialGrantStatus(crmUserId, status) {
      const user = crmUsers.get(crmUserId);
      if (!user) throw new Error("CRM user not found");
      const next = { ...user, signupTrialGrantStatus: status };
      crmUsers.set(crmUserId, next);
      return next;
    },
    async getUserProfile(crmUserId) {
      return profiles.get(crmUserId) || defaultProfile(crmUserId);
    },
    async saveUserProfile(profile) {
      profiles.set(profile.crmUserId, { ...profile });
      return profiles.get(profile.crmUserId) || defaultProfile(profile.crmUserId);
    },
    async findAccountEventByIdempotencyKey(idempotencyKey) {
      return accountEvents.get(idempotencyKey) || null;
    },
    async getAccountEventById(id) {
      return [...accountEvents.values()].find((event) => event.id === id) || null;
    },
    async createAccountEvent(record: AccountEventInput) {
      if (accountEvents.has(record.idempotencyKey)) {
        throw Object.assign(new Error("duplicate account event"), { code: "ER_DUP_ENTRY" });
      }
      const stored: AccountEventRecord = {
        ...record,
        id: accountEvents.size + 1,
        status: accountEventStatuses.pending,
        newApiResult: null,
        metadata: record.metadata || null
      };
      return saveAccountEvent(stored);
    },
    async markAccountEventQuotaApplying(id) {
      const record = findAccountEventById(id);
      if (record.status !== accountEventStatuses.pending) return { ...record, didMutate: false };
      return saveAccountEvent({ ...record, status: accountEventStatuses.quotaApplying, didMutate: true });
    },
    async markAccountEventQuotaApplied(id, patch) {
      const record = findAccountEventById(id);
      if (
        record.status !== accountEventStatuses.quotaApplying &&
        record.status !== accountEventStatuses.reconcileRequired &&
        record.status !== accountEventStatuses.cancelled
      ) return { ...record, didMutate: false };
      return saveAccountEvent({ ...record, status: accountEventStatuses.quotaApplied, newApiResult: patch.newApiResult, didMutate: true });
    },
    async markAccountEventLocalApplying(id) {
      const record = findAccountEventById(id);
      if (record.status !== accountEventStatuses.quotaApplied) {
        return { ...record, didMutate: false };
      }
      return saveAccountEvent({ ...record, status: accountEventStatuses.localApplying, didMutate: true });
    },
    async completeAccountEvent(id, patch) {
      const record = findAccountEventById(id);
      return saveAccountEvent({
        ...record,
        status: accountEventStatuses.completed,
        quotaDelta: patch.quotaDelta,
        newApiResult: patch.newApiResult
      });
    },
    async markAccountEventReconcileRequired(id, reason) {
      const record = findAccountEventById(id);
      return saveAccountEvent({
        ...record,
        status: accountEventStatuses.reconcileRequired,
        metadata: {
          ...(record.metadata && typeof record.metadata === "object" ? record.metadata : {}),
          reconcileReason: reason
        }
      });
    },
    async cancelAccountEvent(id, reason) {
      const record = findAccountEventById(id);
      if (
        !new Set<string>([
          accountEventStatuses.pending,
          accountEventStatuses.quotaApplying,
          accountEventStatuses.reconcileRequired
        ]).has(record.status) ||
        (record.newApiResult !== null && record.newApiResult !== undefined)
      ) {
        return { ...record, didMutate: false };
      }
      return saveAccountEvent({
        ...record,
        status: accountEventStatuses.cancelled,
        metadata: { ...(record.metadata && typeof record.metadata === "object" ? record.metadata : {}), cancelReason: reason },
        didMutate: true
      });
    },
    async listAccountEvents(options = {}) {
      const rows = [...accountEvents.values()]
        .filter((event) => !options.crmUserId || event.crmUserId === options.crmUserId)
        .filter((event) => !options.eventType || event.eventType === options.eventType)
        .filter((event) => !options.status || event.status === options.status)
        .reverse()
        .map((event) => ({
          ...event,
          crmUsername: crmUsers.get(event.crmUserId)?.username || "",
          operatorUsername: event.operatorCrmUserId ? crmUsers.get(event.operatorCrmUserId)?.username || "" : ""
        }));
      return paginate(rows, options);
    },
    async insertLedgerEntry(entry: LedgerEntryCreate) {
      const existing = ledgerEntries.find((item) => item.idempotencyKey === entry.idempotencyKey);
      if (existing) return { ...existing, didMutate: false };
      const currentBalance = ledgerEntries
        .filter((item) => item.crmUserId === entry.crmUserId)
        .reduce((sum, item) => sum + (item.direction === ledgerDirections.credit ? item.amountRmb : -item.amountRmb), 0);
      const signedAmount = entry.direction === ledgerDirections.credit ? entry.amountRmb : -entry.amountRmb;
      const stored: LedgerEntryDto = {
        ...entry,
        id: ledgerEntries.length + 1,
        paidAmountRmb: entry.paidAmountRmb ?? (entry.isPaid ? entry.amountRmb : 0),
        discountAmountRmb: entry.discountAmountRmb ?? 0,
        commissionBaseRmb: entry.commissionBaseRmb ?? (entry.isPaid ? entry.amountRmb : 0),
        sourceId: entry.sourceId || null,
        operatorCrmUserId: entry.operatorCrmUserId || null,
        reason: entry.reason || "",
        balanceAfterRmb: Math.round((currentBalance + signedAmount) * 100) / 100,
        createdAt: entry.createdAt
      };
      ledgerEntries.push(stored);
      return { ...stored, didMutate: true };
    },
    async findLedgerEntryByIdempotencyKey(idempotencyKey) {
      return ledgerEntries.find((entry) => entry.idempotencyKey === idempotencyKey) || null;
    },
    async sumLedgerAmount(options) {
      const summary = await this.summarizeLedger(options);
      return summary.amountRmb;
    },
    async summarizeLedger(options) {
      const rows = ledgerEntries
        .filter((entry) => entry.crmUserId === options.crmUserId)
        .filter((entry) => !options.eventType || entry.eventType === options.eventType)
        .filter((entry) => !options.direction || entry.direction === options.direction)
        .filter((entry) => ledgerInRange(entry, options));
      return {
        amountRmb: Math.round(rows.reduce((sum, entry) => sum + entry.amountRmb, 0) * 100) / 100,
        entryCount: rows.length
      };
    },
    async listLedger(options = {}) {
      const rows = [...ledgerEntries]
        .filter((entry) => !options.crmUserId || entry.crmUserId === options.crmUserId)
        .filter((entry) => !options.eventType || entry.eventType === options.eventType)
        .filter((entry) => !options.direction || entry.direction === options.direction)
        .reverse()
        .map((entry) => ({
          ...entry,
          crmUsername: crmUsers.get(entry.crmUserId)?.username || "",
          operatorUsername: entry.operatorCrmUserId ? crmUsers.get(entry.operatorCrmUserId)?.username || "" : ""
        }));
      return paginate(rows, options);
    },
    async insertAuditLog(entry: AuditLogEntryCreate) {
      const requestContext = getCrmRequestContext();
      const stored: AuditLogEntryDto = {
        id: audits.length + 1,
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
      audits.push(stored);
      return stored;
    },
    async listAuditLogs(options = {}) {
      const rows = [...audits]
        .filter((entry) => !options.operatorCrmUserId || entry.operatorCrmUserId === options.operatorCrmUserId)
        .filter((entry) => !options.targetType || entry.targetType === options.targetType)
        .filter((entry) => !options.targetId || entry.targetId === options.targetId)
        .filter((entry) => !options.action || entry.action === options.action)
        .reverse()
        .map((entry) => ({
          ...entry,
          operatorUsername: crmUsers.get(entry.operatorCrmUserId)?.username || ""
        }));
      return paginate(rows, options);
    },
    async getAgentById(agentId) {
      const agent = [...agents.values()].find((item) => item.id === agentId);
      return agent ? withAgentDisplay(agent) : null;
    },
    async getAgentByCrmUserId(crmUserId) {
      const agent = agents.get(crmUserId);
      return agent ? withAgentDisplay(agent) : null;
    },
    async getAgentByInviteCode(inviteCode) {
      const agent = [...agents.values()].find((item) => item.inviteCode === inviteCode);
      return agent ? withAgentDisplay(agent) : null;
    },
    async saveAgent(input) {
      const stored: AgentDto = {
        id: input.id || agents.size + 1,
        crmUserId: input.crmUserId,
        status: input.status,
        category: input.category || agentCategories.normal,
        inviteCode: input.inviteCode,
        parentAgentId: input.parentAgentId,
        parentAgentCrmUserId: input.parentAgentCrmUserId,
        level: input.level || agentLevels.standard,
        effectivePaidCustomerCount: input.effectivePaidCustomerCount || 0,
        levelEffectiveAt: input.levelEffectiveAt || null,
        levelExpiresAt: input.levelExpiresAt || null,
        lastLevelEvaluatedAt: input.lastLevelEvaluatedAt || null
      };
      agents.set(stored.crmUserId, stored);
      return withAgentDisplay(stored);
    },
    async listAgents(options = {}) {
      const businessUserIds = new Set(
        [...crmUsers.values()]
          .filter((user) => user.newApiUserId !== null)
          .filter((user) => user.newApiRole < 100)
          .map((user) => user.id)
      );
      const rows = [...agents.values()].reverse();
      return paginate(rows
        .filter((agent) => !options.businessOnly || businessUserIds.has(agent.crmUserId))
        .filter((agent) => !options.parentAgentCrmUserId || agent.parentAgentCrmUserId === options.parentAgentCrmUserId)
        .map(withAgentDisplay), options);
    },
    async countSubAgents(agentCrmUserId) {
      return [...agents.values()].filter((agent) => agent.parentAgentCrmUserId === agentCrmUserId && agent.status === "active").length;
    },
    async getAgentRelationshipByCustomer(crmUserId) {
      const relationship = relationships.get(crmUserId);
      return relationship ? withRelationshipDisplay(relationship) : null;
    },
    async saveAgentRelationship(customerCrmUserId, relationship) {
      const stored = {
        ...relationship,
        id: relationship.id || relationships.size + 1,
        customerCrmUserId,
        status: agentRelationshipStatuses.active
      };
      relationships.set(customerCrmUserId, stored);
      return withRelationshipDisplay(stored);
    },
    async listAgentCustomers(agentCrmUserId, options = {}) {
      const keyword = (options.keyword || "").toLowerCase();
      const page = options.page || 1;
      const pageSize = options.pageSize || 20;
      const rows = [...relationships.entries()]
        .filter(([, relationship]) => relationship.agentCrmUserId === agentCrmUserId && relationship.status === "active")
        .map(([customerCrmUserId, relationship]) => {
          const customer = crmUsers.get(customerCrmUserId);
          return {
            customerCrmUserId,
            customer: {
              crmUserId: customerCrmUserId,
              username: customer?.username || "",
              email: customer?.email || "",
              createdAt: customer?.createdAt
            },
            relationship: withRelationshipDisplay(relationship)
          };
        })
        .filter((row) => !keyword || row.customer.username.toLowerCase().includes(keyword) || row.customer.email.toLowerCase().includes(keyword))
        .sort((left, right) => right.customerCrmUserId - left.customerCrmUserId);
      return rows.slice((page - 1) * pageSize, page * pageSize);
    },
    async countAgentCustomers(agentCrmUserId, options = {}) {
      const keyword = (options.keyword || "").toLowerCase();
      return [...relationships.entries()]
        .filter(([, relationship]) => relationship.agentCrmUserId === agentCrmUserId && relationship.status === "active")
        .filter(([customerCrmUserId]) => {
          if (!keyword) return true;
          const customer = crmUsers.get(customerCrmUserId);
          return Boolean(customer?.username.toLowerCase().includes(keyword) || customer?.email.toLowerCase().includes(keyword));
        })
        .length;
    },
    async getEffectiveCustomerByAgentAndCustomer(agentId, customerCrmUserId) {
      return effectiveCustomers.find((item) => item.agentId === agentId && item.customerCrmUserId === customerCrmUserId) || null;
    },
    async saveEffectiveCustomer(input: EffectiveCustomerSaveInput) {
      const index = effectiveCustomers.findIndex((item) => item.agentId === input.agentId && item.customerCrmUserId === input.customerCrmUserId);
      const stored: EffectiveCustomerDto = {
        ...input,
        id: index >= 0 ? effectiveCustomers[index].id : effectiveCustomers.length + 1
      };
      if (index >= 0) {
        effectiveCustomers[index] = stored;
      } else {
        effectiveCustomers.push(stored);
      }
      return stored;
    },
    async listEffectiveCustomers(options = {}) {
      const rows = [...effectiveCustomers]
        .filter((item) => !options.agentId || item.agentId === options.agentId)
        .filter((item) => !options.customerCrmUserId || item.customerCrmUserId === options.customerCrmUserId)
        .filter((item) => options.isEffective === undefined || item.isEffective === options.isEffective)
        .filter((item) => options.countedForLevel === undefined || item.countedForLevel === options.countedForLevel)
        .map((item) => {
          const agent = [...agents.values()].find((candidate) => candidate.id === item.agentId);
          const agentUser = agent ? crmUsers.get(agent.crmUserId) : null;
          const customerUser = crmUsers.get(item.customerCrmUserId);
          return {
            ...item,
            agentCrmUserId: agent?.crmUserId,
            agentUsername: agentUser?.username,
            customerUsername: customerUser?.username,
            customerEmail: customerUser?.email
          };
        })
        .reverse();
      return paginate(rows, options);
    },
    async countEffectiveCustomers(agentId, options = {}) {
      return effectiveCustomers
        .filter((item) => item.agentId === agentId && item.countedForLevel)
        .filter((item) => !options.firstPaidAtFrom || item.firstPaidAt >= options.firstPaidAtFrom)
        .length;
    },
    async getCommissionSummary(beneficiaryCrmUserId) {
      return commissions.reduce(
        (summary, commission) => {
          if (commission.beneficiaryCrmUserId !== beneficiaryCrmUserId) return summary;
          if (commission.status === "frozen") summary.frozenCommissionRmb += commission.amountRmb - commission.releasedAmountRmb;
          if (commission.status === "releasable") summary.releasableCommissionRmb += commission.amountRmb - commission.releasedAmountRmb;
          summary.releasedCommissionRmb += commission.releasedAmountRmb;
          return summary;
        },
        { frozenCommissionRmb: 0, releasableCommissionRmb: 0, releasedCommissionRmb: 0 }
      );
    },
    async listCommissions(options = {}) {
      return paginate(commissions.filter((commission) => (
        (!options.beneficiaryCrmUserId || commission.beneficiaryCrmUserId === options.beneficiaryCrmUserId) &&
        (!options.status || commission.status === options.status) &&
        (!options.sourceType || commission.sourceType === options.sourceType) &&
        (!options.sourceId || commission.sourceId === options.sourceId)
      )).map(withCommissionDisplay), options);
    },
    async insertCommissionRecords(rows: CommissionCreateInput[]) {
      const startId = commissions.length + 1;
      const stored = rows.map((row, index) => ({
        ...row,
        id: startId + index,
        status: "frozen" as const,
        releasedAmountRmb: 0
      }));
      commissions.push(...stored);
      return stored.map(withCommissionDisplay);
    },
    async updateCommissionStatus(id, status) {
      const index = commissions.findIndex((commission) => commission.id === id);
      if (index < 0) throw new Error("commission not found");
      const current = commissions[index];
      const allowed = (
        (current.status === "frozen" && ["releasable", "blocked", "clawed_back"].includes(status)) ||
        (current.status === "releasable" && ["blocked", "clawed_back"].includes(status)) ||
        (current.status === "blocked" && status === "clawed_back")
      );
      if (!allowed || (status === "clawed_back" && current.releasedAmountRmb > 0)) {
        throw httpError("commission status transition is invalid", 409, "commission_status_invalid");
      }
      commissions[index] = { ...commissions[index], status };
      return withCommissionDisplay(commissions[index]);
    },
    async createWithdrawal(input: WithdrawalCreateInput) {
      const stored: WithdrawalDto = {
        id: withdrawals.length + 1,
        beneficiaryCrmUserId: input.beneficiaryCrmUserId,
        amountRmb: input.amountRmb,
        payoutMethod: input.payoutMethod || withdrawalMethods.alipay,
        payoutAccountName: input.payoutAccountName || "",
        payoutAccount: input.payoutAccount || "",
        payoutBankName: input.payoutBankName || "",
        status: "pending",
        reviewerCrmUserId: null,
        reviewReason: "",
        paidReference: "",
        paidEvidenceUrl: ""
      };
      withdrawals.push(stored);
      return withWithdrawalDisplay(stored);
    },
    async createWithdrawalWithBalanceCheck(input) {
      return withWithdrawalLock(input.beneficiaryCrmUserId, async () => {
        if (input.amountRmb < settings.withdrawalMinAmountRmb) {
          throw httpError("withdrawal amount is below the minimum", 400, "withdrawal_min_amount");
        }
        const blocked = await repository.hasBlockingRisk(
          "user",
          String(input.beneficiaryCrmUserId),
          "withdrawal"
        );
        if (blocked) {
          throw httpError("withdrawal is blocked by risk case", 409, "withdrawal_risk_blocked");
        }
        const summary = await repository.getCommissionSummary(input.beneficiaryCrmUserId);
        const reserved = withdrawals
          .filter((withdrawal) => withdrawal.beneficiaryCrmUserId === input.beneficiaryCrmUserId)
          .filter((withdrawal) => ["pending", "approved"].includes(withdrawal.status))
          .reduce((sum, withdrawal) => sum + withdrawal.amountRmb, 0);
        const available = Math.max(0, Math.round((summary.releasableCommissionRmb - reserved) * 100) / 100);
        if (available < input.amountRmb) {
          throw httpError("releasable commission balance is insufficient", 400, "withdrawal_insufficient_balance");
        }
        return repository.createWithdrawal(input);
      });
    },
    async getWithdrawalById(id) {
      const withdrawal = withdrawals.find((item) => item.id === id);
      return withdrawal ? withWithdrawalDisplay(withdrawal) : null;
    },
    async listWithdrawals(options = {}) {
      return paginate(withdrawals.filter((withdrawal) => (
        (!options.beneficiaryCrmUserId || withdrawal.beneficiaryCrmUserId === options.beneficiaryCrmUserId) &&
        (!options.status || withdrawal.status === options.status)
      )).slice().reverse().map(withWithdrawalDisplay), options);
    },
    async sumWithdrawals(options = {}) {
      return withdrawals
        .filter((withdrawal) => (
          (!options.beneficiaryCrmUserId || withdrawal.beneficiaryCrmUserId === options.beneficiaryCrmUserId) &&
          (!options.status || withdrawal.status === options.status)
        ))
        .reduce((sum, withdrawal) => sum + withdrawal.amountRmb, 0);
    },
    async updateWithdrawal(id, patch: WithdrawalPatch, expectedStatus) {
      const index = withdrawals.findIndex((withdrawal) => withdrawal.id === id);
      if (index < 0) throw new Error("withdrawal not found");
      if (withdrawals[index].status !== expectedStatus) return null;
      withdrawals[index] = {
        ...withdrawals[index],
        status: patch.status,
        reviewerCrmUserId: patch.reviewerCrmUserId,
        reviewReason: patch.reviewReason,
        paidReference: patch.paidReference || withdrawals[index].paidReference,
        paidEvidenceUrl: patch.paidEvidenceUrl || withdrawals[index].paidEvidenceUrl
      };
      return withWithdrawalDisplay(withdrawals[index]);
    },
    async markWithdrawalPaidWithAllocations(input) {
      const current = withdrawals.find((withdrawal) => withdrawal.id === input.withdrawalId);
      if (!current) throw httpError("withdrawal was not found", 404, "not_found");
      return withWithdrawalLock(current.beneficiaryCrmUserId, async () => repository.withTransaction(async () => {
        const withdrawalIndex = withdrawals.findIndex((withdrawal) => withdrawal.id === input.withdrawalId);
        const withdrawal = withdrawals[withdrawalIndex];
        if (withdrawal.status !== "approved") {
          throw httpError("withdrawal status transition is invalid", 409, "withdrawal_status_invalid");
        }
        const candidates = commissions
          .filter((commission) => commission.beneficiaryCrmUserId === withdrawal.beneficiaryCrmUserId)
          .filter((commission) => commission.status === "releasable")
          .filter((commission) => commission.amountRmb > commission.releasedAmountRmb)
          .sort((left, right) => Number(left.id || 0) - Number(right.id || 0));
        const available = candidates.reduce(
          (sum, commission) => sum + commission.amountRmb - commission.releasedAmountRmb,
          0
        );
        if (Math.round(available * 100) < Math.round(withdrawal.amountRmb * 100)) {
          throw httpError("releasable commission balance is insufficient", 409, "withdrawal_insufficient_balance");
        }

        let remaining = withdrawal.amountRmb;
        const allocations: WithdrawalCommissionAllocationDto[] = [];
        for (const commission of candidates) {
          if (remaining <= 0) break;
          const commissionIndex = commissions.findIndex((item) => item.id === commission.id);
          const availableAmount = Math.round((commission.amountRmb - commission.releasedAmountRmb) * 100) / 100;
          const allocatedAmount = Math.min(availableAmount, remaining);
          const releasedAmountRmb = Math.round((commission.releasedAmountRmb + allocatedAmount) * 100) / 100;
          commissions[commissionIndex] = {
            ...commission,
            releasedAmountRmb,
            status: releasedAmountRmb >= commission.amountRmb ? "released" : "releasable"
          };
          const allocation: WithdrawalCommissionAllocationDto = {
            id: withdrawalCommissionAllocations.length + 1,
            withdrawalId: withdrawal.id,
            commissionId: Number(commission.id),
            amountRmb: allocatedAmount
          };
          withdrawalCommissionAllocations.push(allocation);
          allocations.push(allocation);
          remaining = Math.round((remaining - allocatedAmount) * 100) / 100;
        }

        withdrawals[withdrawalIndex] = {
          ...withdrawal,
          status: "paid",
          reviewerCrmUserId: input.operatorCrmUserId,
          reviewReason: input.reviewReason,
          paidReference: input.paidReference,
          paidEvidenceUrl: input.paidEvidenceUrl || withdrawal.paidEvidenceUrl,
          reviewedAt: new Date().toISOString(),
          paidAt: new Date().toISOString()
        };
        await repository.insertLedgerEntry({
          crmUserId: withdrawal.beneficiaryCrmUserId,
          direction: ledgerDirections.debit,
          amountRmb: withdrawal.amountRmb,
          paidAmountRmb: 0,
          discountAmountRmb: 0,
          commissionBaseRmb: 0,
          eventType: ledgerEventTypes.commissionWithdrawal,
          sourceType: "withdrawal",
          sourceId: withdrawal.id,
          idempotencyKey: `commission-withdrawal:${withdrawal.id}:paid`,
          operatorCrmUserId: input.operatorCrmUserId,
          reason: input.reviewReason,
          isPaid: false
        });
        await repository.insertAuditLog({
          operatorCrmUserId: input.operatorCrmUserId,
          targetType: "withdrawal",
          targetId: withdrawal.id,
          action: "withdrawal.paid",
          reason: input.reviewReason,
          before: withdrawal,
          after: { withdrawal: withdrawals[withdrawalIndex], allocations }
        });
        return {
          withdrawal: withWithdrawalDisplay(withdrawals[withdrawalIndex]),
          allocations
        };
      }));
    },
    async listWithdrawalCommissionAllocations(withdrawalId) {
      return withdrawalCommissionAllocations.filter((allocation) => allocation.withdrawalId === withdrawalId);
    },
    async saveEnterpriseMonthlySettlement(input: EnterpriseMonthlySettlementSaveInput) {
      const existingIndex = enterpriseMonthlySettlements.findIndex((settlement) => (
        settlement.crmUserId === input.crmUserId &&
        settlement.period === input.period
      ));
      if (existingIndex >= 0) {
        const existing = enterpriseMonthlySettlements[existingIndex];
        if (existing.status !== enterpriseMonthlySettlementStatuses.pending) {
          return { settlement: withEnterpriseMonthlySettlementDisplay(existing), created: false, updated: false };
        }
        const changed = existing.usageRmb !== input.usageRmb || existing.ledgerEntryCount !== input.ledgerEntryCount;
        enterpriseMonthlySettlements[existingIndex] = {
          ...existing,
          usageRmb: input.usageRmb,
          ledgerEntryCount: input.ledgerEntryCount,
          notes: input.notes ?? existing.notes
        };
        return {
          settlement: withEnterpriseMonthlySettlementDisplay(enterpriseMonthlySettlements[existingIndex]),
          created: false,
          updated: changed
        };
      }
      const stored: EnterpriseMonthlySettlementDto = {
        id: enterpriseMonthlySettlements.length + 1,
        crmUserId: input.crmUserId,
        period: input.period,
        usageRmb: input.usageRmb,
        ledgerEntryCount: input.ledgerEntryCount,
        status: enterpriseMonthlySettlementStatuses.pending,
        paidReference: "",
        paidEvidenceUrl: "",
        notes: input.notes || ""
      };
      enterpriseMonthlySettlements.push(stored);
      return { settlement: withEnterpriseMonthlySettlementDisplay(stored), created: true, updated: false };
    },
    async getEnterpriseMonthlySettlementById(id) {
      const settlement = enterpriseMonthlySettlements.find((item) => item.id === id);
      return settlement ? withEnterpriseMonthlySettlementDisplay(settlement) : null;
    },
    async listEnterpriseMonthlySettlements(options = {}) {
      const rows = enterpriseMonthlySettlements
        .filter((settlement) => !options.crmUserId || settlement.crmUserId === options.crmUserId)
        .filter((settlement) => !options.period || settlement.period === options.period)
        .filter((settlement) => !options.status || settlement.status === options.status)
        .slice()
        .reverse()
        .map(withEnterpriseMonthlySettlementDisplay);
      return paginate(rows, options);
    },
    async updateEnterpriseMonthlySettlement(id, patch: EnterpriseMonthlySettlementPatch, expectedStatus) {
      const index = enterpriseMonthlySettlements.findIndex((settlement) => settlement.id === id);
      if (index < 0) throw new Error("enterprise monthly settlement not found");
      if (enterpriseMonthlySettlements[index].status !== expectedStatus) return null;
      enterpriseMonthlySettlements[index] = {
        ...enterpriseMonthlySettlements[index],
        status: patch.status,
        paidReference: patch.paidReference ?? enterpriseMonthlySettlements[index].paidReference,
        paidEvidenceUrl: patch.paidEvidenceUrl ?? enterpriseMonthlySettlements[index].paidEvidenceUrl,
        notes: patch.notes ?? enterpriseMonthlySettlements[index].notes,
        paidAt: patch.status === enterpriseMonthlySettlementStatuses.paid ? "2026-07-01 00:00:00" : enterpriseMonthlySettlements[index].paidAt
      };
      return withEnterpriseMonthlySettlementDisplay(enterpriseMonthlySettlements[index]);
    },
    async createOfflineRechargeRequest(input) {
      const stored: OfflineRechargeRequestDto = {
        id: offlineRechargeRequests.length + 1,
        crmUserId: input.crmUserId,
        method: input.method,
        amountRmb: input.amountRmb,
        payerName: input.payerName,
        paymentReference: input.paymentReference,
        paymentEvidenceUrl: input.paymentEvidenceUrl,
        notes: input.notes,
        status: offlineRechargeStatuses.pending,
        reviewerCrmUserId: null,
        reviewReason: "",
        accountEventId: null
      };
      offlineRechargeRequests.push(stored);
      return withOfflineRechargeDisplay(stored);
    },
    async getOfflineRechargeRequestById(id) {
      const request = offlineRechargeRequests.find((item) => item.id === id);
      return request ? withOfflineRechargeDisplay(request) : null;
    },
    async listOfflineRechargeRequests(options = {}) {
      return paginate(offlineRechargeRequests.filter((request) => (
        (!options.crmUserId || request.crmUserId === options.crmUserId) &&
        (!options.status || request.status === options.status)
      )).slice().reverse().map(withOfflineRechargeDisplay), options);
    },
    async updateOfflineRechargeRequest(id, patch, expectedStatus) {
      const index = offlineRechargeRequests.findIndex((request) => request.id === id);
      if (index < 0) throw new Error("offline recharge request not found");
      if (offlineRechargeRequests[index].status !== expectedStatus) return null;
      offlineRechargeRequests[index] = {
        ...offlineRechargeRequests[index],
        status: patch.status,
        reviewerCrmUserId: patch.reviewerCrmUserId,
        reviewReason: patch.reviewReason,
        accountEventId: patch.accountEventId ?? offlineRechargeRequests[index].accountEventId
      };
      return withOfflineRechargeDisplay(offlineRechargeRequests[index]);
    },
    async createRiskCase(input: RiskCaseCreateInput) {
      const stored: RiskCaseDto = {
        id: riskCases.length + 1,
        targetType: input.targetType,
        targetId: input.targetId,
        riskType: input.riskType,
        status: "open",
        evidence: input.evidence || null,
        notes: input.notes,
        blocksWithdrawal: input.blocksWithdrawal,
        blocksCommissionRelease: input.blocksCommissionRelease,
        createdByCrmUserId: input.createdByCrmUserId
      };
      riskCases.push(stored);
      return stored;
    },
    async listRiskCases(options = {}) {
      return paginate(riskCases.filter((riskCase) => (
        (!options.status || riskCase.status === options.status) &&
        (!options.targetType || riskCase.targetType === options.targetType) &&
        (!options.targetId || riskCase.targetId === options.targetId)
      )).slice().reverse(), options);
    },
    async updateRiskCase(id, patch: RiskCasePatch) {
      const index = riskCases.findIndex((riskCase) => riskCase.id === id);
      if (index < 0) throw new Error("risk case not found");
      riskCases[index] = { ...riskCases[index], ...patch };
      return riskCases[index];
    },
    async hasBlockingRisk(targetType, targetId, block) {
      return riskCases.some((riskCase) => (
        riskCase.targetType === targetType &&
        riskCase.targetId === targetId &&
        ["open", "reviewing"].includes(riskCase.status) &&
        (block === "withdrawal" ? riskCase.blocksWithdrawal : riskCase.blocksCommissionRelease)
      ));
    },
    async getSettings() {
      return settings;
    },
    async saveSettings(nextSettings) {
      settings = nextSettings;
      return settings;
    },
    async getDashboardSummary() {
      const businessUserIds = new Set(
        [...crmUsers.values()]
          .filter((user) => user.newApiUserId !== null)
          .filter((user) => user.newApiRole < 100)
          .map((user) => user.id)
      );
      const paidTopupRmb = ledgerEntries
        .filter((entry) => entry.isPaid && entry.direction === "credit" && entry.eventType !== ledgerEventTypes.signupTrialGrant)
        .reduce((sum, entry) => sum + entry.paidAmountRmb, 0);
      const commissionSummary = commissions.reduce(
        (summary, commission) => {
          if (commission.status === "frozen") summary.frozenCommissionRmb += commission.amountRmb - commission.releasedAmountRmb;
          if (commission.status === "releasable") summary.releasableCommissionRmb += commission.amountRmb - commission.releasedAmountRmb;
          summary.releasedCommissionRmb += commission.releasedAmountRmb;
          return summary;
        },
        { frozenCommissionRmb: 0, releasableCommissionRmb: 0, releasedCommissionRmb: 0 }
      );
      return {
        paidTopupRmb,
        ...commissionSummary,
        pendingWithdrawalRmb: withdrawals
          .filter((withdrawal) => ["pending", "approved"].includes(withdrawal.status))
          .reduce((sum, withdrawal) => sum + withdrawal.amountRmb, 0),
        reconcileRequiredAccountEvents: [...accountEvents.values()]
          .filter((event) => event.status === accountEventStatuses.reconcileRequired).length,
        pendingOfflineRecharges: offlineRechargeRequests
          .filter((request) => request.status === offlineRechargeStatuses.pending).length,
        pendingWithdrawals: withdrawals.filter((withdrawal) => withdrawal.status === "pending").length,
        approvedWithdrawals: withdrawals.filter((withdrawal) => withdrawal.status === "approved").length,
        openRiskCases: riskCases.filter((riskCase) => riskCase.status === "open").length,
        userCount: businessUserIds.size,
        agentCount: [...agents.keys()].filter((crmUserId) => businessUserIds.has(crmUserId)).length
      };
    }
  };
  return repository;
}
