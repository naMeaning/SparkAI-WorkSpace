import type { CrmRepository, NewApiClient } from "../types.js";
import { formatMysqlTimestamp } from "../time.js";
import { syncNewApiConsumptionForCrmUser } from "./usage-consumption.js";

type UsageSyncMaintenanceRepository = Pick<
  CrmRepository,
  | "withTransaction"
  | "listCrmUsers"
  | "getCrmUserById"
  | "findLedgerEntryByIdempotencyKey"
  | "insertLedgerEntry"
  | "sumLedgerAmount"
  | "listEffectiveCustomers"
  | "getUserProfile"
  | "getAgentRelationshipByCustomer"
  | "getEffectiveCustomerByAgentAndCustomer"
  | "getAgentById"
  | "getAgentByCrmUserId"
  | "countEffectiveCustomers"
  | "saveAgent"
  | "saveEffectiveCustomer"
  | "getSettings"
  | "insertCommissionRecords"
>;

type UsageSyncMaintenanceNewApiClient = Pick<NewApiClient, "getUser" | "listConsumeLogs">;

export interface UsageSyncMaintenanceFailure {
  crmUserId: number;
  errorCode: string;
}

export interface UsageSyncMaintenanceResult {
  evaluatedAt: string;
  usersScanned: number;
  usersSynced: number;
  usageLogsSynced: number;
  syncFailures: UsageSyncMaintenanceFailure[];
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return String((error as { code?: string }).code);
  }
  return "sync_failed";
}

export async function runUsageSyncMaintenance({
  repository,
  newApiClient,
  quotaPerRmb,
  evaluatedAt = formatMysqlTimestamp(),
  pageSize = 100,
  maxPages = 1000
}: {
  repository: UsageSyncMaintenanceRepository;
  newApiClient: UsageSyncMaintenanceNewApiClient;
  quotaPerRmb: number;
  evaluatedAt?: string;
  pageSize?: number;
  maxPages?: number;
}): Promise<UsageSyncMaintenanceResult> {
  const result: UsageSyncMaintenanceResult = {
    evaluatedAt,
    usersScanned: 0,
    usersSynced: 0,
    usageLogsSynced: 0,
    syncFailures: []
  };

  for (let page = 1; page <= maxPages; page += 1) {
    const users = await repository.listCrmUsers({ page, pageSize, excludeSuperAdmins: true });
    for (const user of users.items) {
      if (!user.newApiUserId) continue;
      result.usersScanned += 1;
      try {
        const syncResult = await syncNewApiConsumptionForCrmUser({
          repository,
          newApiClient,
          crmUserId: user.id,
          quotaPerRmb
        });
        result.usersSynced += 1;
        result.usageLogsSynced += syncResult.syncedLogs;
      } catch (error) {
        result.syncFailures.push({ crmUserId: user.id, errorCode: errorCode(error) });
      }
    }
    if (page * pageSize >= users.total || users.items.length < pageSize) break;
  }

  return result;
}
