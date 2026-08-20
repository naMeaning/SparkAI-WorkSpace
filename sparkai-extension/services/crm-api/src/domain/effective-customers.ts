import { defaultCrmSettings, effectiveCustomerRules, type AgentDto, type EffectiveCustomerDto } from "@ai-native/crm-contracts";
import type { AccountEventRecord, CrmRepository } from "../types.js";
import { httpError } from "../http.js";
import { formatMysqlTimestamp } from "../time.js";
import { resolveAgentLevel } from "./commissions.js";

type EffectiveCustomerRepository = Pick<
  CrmRepository,
  | "getAgentByCrmUserId"
  | "getAgentById"
  | "getAgentRelationshipByCustomer"
  | "getEffectiveCustomerByAgentAndCustomer"
  | "getUserProfile"
  | "saveEffectiveCustomer"
  | "countEffectiveCustomers"
  | "saveAgent"
>;

export interface EffectiveCustomerEvaluationInput {
  agentId: number;
  customerCrmUserId: number;
  paidBalanceConsumedRate?: number;
  isRefunded?: boolean;
  isRelatedAccount?: boolean;
  isRisk?: boolean;
  evaluatedAt?: string;
}

function levelChanged(agent: AgentDto, nextLevel: AgentDto["level"], nextCount: number): boolean {
  return agent.level !== nextLevel || Number(agent.effectivePaidCustomerCount || 0) !== nextCount;
}

function addDaysMysqlTimestamp(value: string, days: number): string | null {
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return formatMysqlTimestamp(parsed);
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSevenDayObservationComplete(firstPaidAt: string, evaluatedAt: string): boolean {
  const firstPaidDate = parseDate(firstPaidAt);
  const evaluatedDate = parseDate(evaluatedAt);
  if (!firstPaidDate || !evaluatedDate) return false;
  const threshold = new Date(firstPaidDate);
  threshold.setUTCDate(threshold.getUTCDate() + effectiveCustomerRules.refundObservationDays);
  return evaluatedDate.getTime() >= threshold.getTime();
}

function roundRate(value: number): number {
  return Math.max(0, Math.round(Number(value || 0) * 1_000_000) / 1_000_000);
}

export async function refreshAgentLevelFromEffectiveCustomers({
  repository,
  agentCrmUserId,
  evaluatedAt = formatMysqlTimestamp(),
  firstPaidAtFrom
}: {
  repository: EffectiveCustomerRepository;
  agentCrmUserId: number;
  evaluatedAt?: string;
  firstPaidAtFrom?: string;
}): Promise<AgentDto> {
  const agent = await repository.getAgentByCrmUserId(agentCrmUserId);
  if (!agent) {
    throw new Error("agent not found");
  }
  const count = await repository.countEffectiveCustomers(agent.id, { firstPaidAtFrom });
  const nextLevel = resolveAgentLevel(count);
  const changed = levelChanged(agent, nextLevel, count);
  return repository.saveAgent({
    ...agent,
    level: nextLevel,
    effectivePaidCustomerCount: count,
    levelEffectiveAt: changed ? evaluatedAt : agent.levelEffectiveAt,
    levelExpiresAt: changed ? addDaysMysqlTimestamp(evaluatedAt, defaultCrmSettings.effectiveCustomerRules.levelRetentionDays) : agent.levelExpiresAt,
    lastLevelEvaluatedAt: evaluatedAt
  });
}

export async function recordPaidEventEffectiveCustomerCandidate({
  repository,
  event,
  evaluatedAt = formatMysqlTimestamp()
}: {
  repository: EffectiveCustomerRepository;
  event: AccountEventRecord;
  evaluatedAt?: string;
}): Promise<EffectiveCustomerDto | null> {
  if (event.paidAmountRmb < effectiveCustomerRules.minFirstPaidRmb) return null;
  const relationship = await repository.getAgentRelationshipByCustomer(event.crmUserId);
  if (!relationship || relationship.agentCrmUserId === event.crmUserId) return null;
  const agent = await repository.getAgentByCrmUserId(relationship.agentCrmUserId);
  if (!agent) return null;
  const existing = await repository.getEffectiveCustomerByAgentAndCustomer(agent.id, event.crmUserId);
  if (existing) return existing;
  const profile = await repository.getUserProfile(event.crmUserId);
  const firstPaidAt = event.completedAt || event.createdAt || evaluatedAt;
  const saved = await repository.saveEffectiveCustomer({
    agentId: agent.id,
    customerCrmUserId: event.crmUserId,
    firstPaidEventId: event.id,
    firstPaidAmountRmb: event.paidAmountRmb,
    firstPaidAt,
    sevenDayCheckedAt: null,
    paidBalanceConsumedRate: 0,
    isRefunded: false,
    isRelatedAccount: false,
    isRisk: Boolean(profile.isRisk),
    isEffective: false,
    countedForLevel: false
  });
  await refreshAgentLevelFromEffectiveCustomers({
    repository,
    agentCrmUserId: agent.crmUserId,
    evaluatedAt
  });
  return saved;
}

export async function evaluateEffectiveCustomerCandidate({
  repository,
  agentId,
  customerCrmUserId,
  paidBalanceConsumedRate,
  isRefunded,
  isRelatedAccount,
  isRisk,
  evaluatedAt = formatMysqlTimestamp()
}: {
  repository: EffectiveCustomerRepository;
} & EffectiveCustomerEvaluationInput): Promise<{ effectiveCustomer: EffectiveCustomerDto; agent: AgentDto }> {
  const existing = await repository.getEffectiveCustomerByAgentAndCustomer(agentId, customerCrmUserId);
  if (!existing) {
    throw httpError("effective customer candidate was not found", 404, "effective_customer_not_found");
  }
  const agent = await repository.getAgentById(agentId);
  if (!agent) {
    throw httpError("agent not found", 404, "agent_not_found");
  }
  const nextRate = roundRate(paidBalanceConsumedRate === undefined ? existing.paidBalanceConsumedRate : paidBalanceConsumedRate);
  const nextRefunded = isRefunded === undefined ? existing.isRefunded : isRefunded;
  const nextRelated = isRelatedAccount === undefined ? existing.isRelatedAccount : isRelatedAccount;
  const nextRisk = isRisk === undefined ? existing.isRisk : isRisk;
  const observationComplete = isSevenDayObservationComplete(existing.firstPaidAt, evaluatedAt);
  const isEffective = (
    observationComplete &&
    existing.firstPaidAmountRmb >= effectiveCustomerRules.minFirstPaidRmb &&
    nextRate >= effectiveCustomerRules.minPaidBalanceConsumedRate &&
    !nextRefunded &&
    !nextRelated &&
    !nextRisk
  );
  const effectiveCustomer = await repository.saveEffectiveCustomer({
    ...existing,
    paidBalanceConsumedRate: nextRate,
    isRefunded: nextRefunded,
    isRelatedAccount: nextRelated,
    isRisk: nextRisk,
    sevenDayCheckedAt: observationComplete ? evaluatedAt : existing.sevenDayCheckedAt,
    isEffective,
    countedForLevel: isEffective
  });
  const refreshedAgent = await refreshAgentLevelFromEffectiveCustomers({
    repository,
    agentCrmUserId: agent.crmUserId,
    evaluatedAt
  });
  return { effectiveCustomer, agent: refreshedAgent };
}
