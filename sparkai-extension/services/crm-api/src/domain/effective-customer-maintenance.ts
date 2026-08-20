import { agentLevels, defaultCrmSettings, type AgentDto, type EffectiveCustomerMaintenanceResultDto } from "@ai-native/crm-contracts";
import type { CrmRepository, NewApiClient } from "../types.js";
import { formatMysqlTimestamp } from "../time.js";
import { evaluateEffectiveCustomerCandidate, refreshAgentLevelFromEffectiveCustomers } from "./effective-customers.js";
import { syncNewApiConsumptionForCrmUser } from "./usage-consumption.js";

type MaintenanceRepository = CrmRepository;
type MaintenanceNewApiClient = Pick<NewApiClient, "getUser" | "listConsumeLogs">;

const agentLevelOrder = [
  agentLevels.standard,
  agentLevels.advanced,
  agentLevels.core,
  agentLevels.gold
];

function parseDate(value: string): Date | null {
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function subtractDaysMysqlTimestamp(value: string, days: number): string {
  const parsed = parseDate(value) || new Date();
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return formatMysqlTimestamp(parsed);
}

function isExpired(mysqlTimestamp: string | null | undefined, evaluatedAt: string): boolean {
  if (!mysqlTimestamp) return false;
  const expiresAt = parseDate(mysqlTimestamp);
  const evaluatedDate = parseDate(evaluatedAt);
  return Boolean(expiresAt && evaluatedDate && evaluatedDate.getTime() >= expiresAt.getTime());
}

function isDowngrade(before: AgentDto["level"], after: AgentDto["level"]): boolean {
  return agentLevelOrder.indexOf(after) < agentLevelOrder.indexOf(before);
}

async function listAllEffectiveCustomers(repository: Pick<CrmRepository, "listEffectiveCustomers">) {
  const pageSize = 100;
  const all = [];
  for (let page = 1; page <= 1000; page += 1) {
    const result = await repository.listEffectiveCustomers({ page, pageSize });
    all.push(...result.items);
    if (all.length >= result.total || result.items.length < pageSize) break;
  }
  return all;
}

async function listAllBusinessAgents(repository: Pick<CrmRepository, "listAgents">): Promise<AgentDto[]> {
  const pageSize = 100;
  const all: AgentDto[] = [];
  for (let page = 1; page <= 1000; page += 1) {
    const result = await repository.listAgents({ page, pageSize, businessOnly: true });
    all.push(...result.items);
    if (all.length >= result.total || result.items.length < pageSize) break;
  }
  return all;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return String((error as { code?: string }).code);
  }
  return "sync_failed";
}

export async function runEffectiveCustomerMaintenance({
  repository,
  newApiClient,
  quotaPerRmb,
  evaluatedAt = formatMysqlTimestamp(),
  syncConsumption = true
}: {
  repository: MaintenanceRepository;
  newApiClient: MaintenanceNewApiClient;
  quotaPerRmb: number;
  evaluatedAt?: string;
  syncConsumption?: boolean;
}): Promise<EffectiveCustomerMaintenanceResultDto> {
  const candidates = await listAllEffectiveCustomers(repository);
  const agentsBefore = await listAllBusinessAgents(repository);
  const expiredAgentIds = new Set(
    agentsBefore
      .filter((agent) => isExpired(agent.levelExpiresAt, evaluatedAt))
      .map((agent) => agent.crmUserId)
  );
  const result: EffectiveCustomerMaintenanceResultDto = {
    evaluatedAt,
    candidatesScanned: candidates.length,
    customersSynced: 0,
    usageLogsSynced: 0,
    syncFailures: [],
    candidatesEvaluated: 0,
    agentsChecked: agentsBefore.length,
    agentsRechecked: 0,
    agentsDowngraded: 0
  };

  if (syncConsumption) {
    const customerIds = Array.from(new Set(candidates.map((candidate) => candidate.customerCrmUserId)));
    for (const customerCrmUserId of customerIds) {
      try {
        const syncResult = await syncNewApiConsumptionForCrmUser({
          repository,
          newApiClient,
          crmUserId: customerCrmUserId,
          quotaPerRmb
        });
        result.customersSynced += 1;
        result.usageLogsSynced += syncResult.syncedLogs;
      } catch (error) {
        result.syncFailures.push({ customerCrmUserId, errorCode: errorCode(error) });
      }
    }
  }

  for (const candidate of candidates) {
    await evaluateEffectiveCustomerCandidate({
      repository,
      agentId: candidate.agentId,
      customerCrmUserId: candidate.customerCrmUserId,
      evaluatedAt
    });
    result.candidatesEvaluated += 1;
  }

  const retentionStart = subtractDaysMysqlTimestamp(evaluatedAt, defaultCrmSettings.effectiveCustomerRules.levelRetentionDays);
  for (const agentCrmUserId of expiredAgentIds) {
    const before = await repository.getAgentByCrmUserId(agentCrmUserId);
    if (!before) continue;
    const after = await refreshAgentLevelFromEffectiveCustomers({
      repository,
      agentCrmUserId,
      evaluatedAt,
      firstPaidAtFrom: retentionStart
    });
    result.agentsRechecked += 1;
    if (isDowngrade(before.level, after.level)) {
      result.agentsDowngraded += 1;
    }
  }

  return result;
}
