import {
  ledgerDirections,
  ledgerEventTypes,
  type EnterpriseMonthlySettlementGenerationResultDto
} from "@ai-native/crm-contracts";
import { syncNewApiConsumptionForCrmUser } from "./usage-consumption.js";
import type { CrmRepository, NewApiClient } from "../types.js";

type EnterpriseSettlementRepository = Pick<
  CrmRepository,
  | "withTransaction"
  | "listCrmUsers"
  | "summarizeLedger"
  | "saveEnterpriseMonthlySettlement"
  | "getCrmUserById"
  | "getUserProfile"
  | "findLedgerEntryByIdempotencyKey"
  | "insertLedgerEntry"
  | "sumLedgerAmount"
  | "listEffectiveCustomers"
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

type EnterpriseSettlementNewApiClient = Pick<NewApiClient, "getUser" | "listConsumeLogs">;

export function previousMonthPeriod(evaluatedAt = new Date()): string {
  const date = new Date(evaluatedAt);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function periodBounds(period: string): { from: string; before: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error("enterprise monthly settlement period must be YYYY-MM");
  }
  const [year, month] = period.split("-").map(Number);
  const fromDate = new Date(Date.UTC(year, month - 1, 1));
  const beforeDate = new Date(Date.UTC(year, month, 1));
  const format = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");
  return {
    from: format(fromDate),
    before: format(beforeDate)
  };
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return String((error as { code?: string }).code);
  }
  return "sync_failed";
}

async function listAllEnterpriseUsers(repository: Pick<CrmRepository, "listCrmUsers">) {
  const pageSize = 100;
  const users = [];
  for (let page = 1; page <= 1000; page += 1) {
    const result = await repository.listCrmUsers({ page, pageSize, enterpriseOnly: true });
    users.push(...result.items);
    if (users.length >= result.total || result.items.length < pageSize) break;
  }
  return users;
}

export async function generateEnterpriseMonthlySettlements({
  repository,
  newApiClient,
  quotaPerRmb,
  period = previousMonthPeriod(),
  syncConsumption = true
}: {
  repository: EnterpriseSettlementRepository;
  newApiClient: EnterpriseSettlementNewApiClient;
  quotaPerRmb: number;
  period?: string;
  syncConsumption?: boolean;
}): Promise<EnterpriseMonthlySettlementGenerationResultDto> {
  const bounds = periodBounds(period);
  const users = await listAllEnterpriseUsers(repository);
  const result: EnterpriseMonthlySettlementGenerationResultDto = {
    period,
    customersScanned: users.length,
    customersSynced: 0,
    syncFailures: [],
    settlementsGenerated: 0,
    settlementsSkipped: 0,
    totalUsageRmb: 0
  };

  for (const user of users) {
    if (syncConsumption) {
      try {
        await syncNewApiConsumptionForCrmUser({
          repository,
          newApiClient,
          crmUserId: user.id,
          quotaPerRmb
        });
        result.customersSynced += 1;
      } catch (error) {
        result.syncFailures.push({ crmUserId: user.id, errorCode: errorCode(error) });
      }
    }

    const summary = await repository.summarizeLedger({
      crmUserId: user.id,
      eventType: ledgerEventTypes.imageConsume,
      direction: ledgerDirections.debit,
      createdAtFrom: bounds.from,
      createdAtBefore: bounds.before
    });
    if (summary.amountRmb <= 0 || summary.entryCount <= 0) {
      result.settlementsSkipped += 1;
      continue;
    }
    result.totalUsageRmb = Math.round((result.totalUsageRmb + summary.amountRmb) * 100) / 100;
    const saved = await repository.saveEnterpriseMonthlySettlement({
      crmUserId: user.id,
      period,
      usageRmb: summary.amountRmb,
      ledgerEntryCount: summary.entryCount,
      notes: "大客户月结自动生成"
    });
    if (saved.created || saved.updated) {
      result.settlementsGenerated += 1;
    } else {
      result.settlementsSkipped += 1;
    }
  }
  return result;
}
