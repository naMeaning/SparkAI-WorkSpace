import {
  commissionTypes,
  ledgerDirections,
  ledgerEventTypes,
  orderKinds,
  type CrmUsageLogDto,
  type CrmUsageSyncResultDto
} from "@ai-native/crm-contracts";
import { httpError } from "../http.js";
import type { CrmRepository, NewApiClient } from "../types.js";
import { recordCommissionFreezeLedgerRows } from "./commission-ledger.js";
import { evaluateEffectiveCustomerCandidate } from "./effective-customers.js";

type UnknownRecord = Record<string, unknown>;
export type NormalizedNewApiUsageLog = CrmUsageLogDto & { imageCount: number };

type UsageSyncRepository = Pick<
  CrmRepository,
  | "withTransaction"
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

type UsageSyncNewApiClient = Pick<NewApiClient, "getUser" | "listConsumeLogs">;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function readNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function readOtherRecord(value: unknown): UnknownRecord {
  if (value && typeof value === "object") return asRecord(value);
  const text = readText(value).trim();
  if (!text) return {};
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return {};
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRate(value: number): number {
  return Math.max(0, Math.round(value * 1_000_000) / 1_000_000);
}

function timestampToIso(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  const text = readText(value).trim();
  if (!text) return "";
  if (/^\d+$/.test(text)) {
    return new Date(Number(text) * 1000).toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function isImageUsageLog(log: UnknownRecord, modelName: string, content: string): boolean {
  const other = readOtherRecord(log.other ?? log.Other);
  const requestPath = readText(other.request_path ?? other.requestPath).toLowerCase();
  const model = modelName.toLowerCase();
  const detail = content.toLowerCase();
  return (
    requestPath.includes("/images/") ||
    model.includes("gpt-image") ||
    model.includes("dall-e") ||
    detail.includes("image generation")
  );
}

function readImageCount(log: UnknownRecord, modelName: string, content: string): number {
  const other = readOtherRecord(log.other ?? log.Other);
  const directCount = readNumber(
    log.image_count ??
    log.imageCount ??
    log.image_num ??
    log.imageNum ??
    log.n
  );
  const otherCount = readNumber(
    other.image_count ??
    other.imageCount ??
    other.image_num ??
    other.imageNum ??
    other.n
  );
  const imageCount = Math.max(0, Math.floor(directCount || otherCount));
  if (imageCount > 0) return imageCount;
  return isImageUsageLog(log, modelName, content) ? 1 : 0;
}

export function unwrapNewApiUsageLogs(payload: unknown): { items: UnknownRecord[]; total: number } {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const items =
    (Array.isArray(root.items) && root.items) ||
    (Array.isArray(root.data) && root.data) ||
    (Array.isArray(data.items) && data.items) ||
    (Array.isArray(data.data) && data.data) ||
    [];
  return {
    items: items.map(asRecord),
    total: readNumber(root.total ?? data.total ?? items.length)
  };
}

export function normalizeNewApiUsageLog({
  log,
  crmUserId,
  username,
  quotaPerRmb
}: {
  log: UnknownRecord;
  crmUserId: number;
  username: string;
  quotaPerRmb: number;
}): NormalizedNewApiUsageLog {
  const quota = readNumber(log.quota ?? log.used_quota ?? log.usedQuota);
  const createdAt = timestampToIso(log.created_at ?? log.createdAt);
  const modelName = readText(log.model_name ?? log.modelName);
  const content = readText(log.content ?? log.message);
  const id = readText(log.id) || `${createdAt}:${modelName}:${quota}`;
  return {
    id,
    crmUserId,
    username,
    modelName,
    promptTokens: readNumber(log.prompt_tokens ?? log.promptTokens),
    completionTokens: readNumber(log.completion_tokens ?? log.completionTokens),
    quota,
    rmbCost: quotaPerRmb > 0 ? roundMoney(Math.abs(quota) / quotaPerRmb) : 0,
    content,
    createdAt,
    imageCount: readImageCount(log, modelName, content)
  };
}

export function usageLedgerIdempotencyKey(crmUserId: number, usageLogId: string): string {
  return `new-api-consume-log:${crmUserId}:${usageLogId}`;
}

async function insertUsageLogLedgerIfMissing({
  repository,
  log
}: {
  repository: UsageSyncRepository;
  log: CrmUsageLogDto;
}): Promise<boolean> {
  if (log.rmbCost <= 0) return false;
  const idempotencyKey = usageLedgerIdempotencyKey(log.crmUserId, log.id);
  const record = await repository.insertLedgerEntry({
    crmUserId: log.crmUserId,
    direction: ledgerDirections.debit,
    amountRmb: log.rmbCost,
    paidAmountRmb: 0,
    discountAmountRmb: 0,
    commissionBaseRmb: 0,
    eventType: ledgerEventTypes.imageConsume,
    sourceType: "new_api_consume_log",
    sourceId: null,
    idempotencyKey,
    operatorCrmUserId: log.crmUserId,
    reason: "模型消耗同步",
    isPaid: false
  });
  return record.didMutate !== false;
}

function usageLogSourceId(log: NormalizedNewApiUsageLog): number {
  const value = Number(log.id);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

async function createEnterpriseFixedCommissionIfEligible({
  repository,
  log,
  operatorCrmUserId
}: {
  repository: UsageSyncRepository;
  log: NormalizedNewApiUsageLog;
  operatorCrmUserId: number;
}): Promise<void> {
  if (log.imageCount <= 0) return;
  const profile = await repository.getUserProfile(log.crmUserId);
  if (!profile.isEnterprise) return;
  const relationship = await repository.getAgentRelationshipByCustomer(log.crmUserId);
  if (!relationship || relationship.agentCrmUserId === log.crmUserId) return;
  const agent = await repository.getAgentByCrmUserId(relationship.agentCrmUserId);
  if (!agent) return;
  const settings = await repository.getSettings();
  const fixedCommissionPerImage = Number(
    profile.enterpriseFixedCommissionPerImage ?? settings.enterpriseDefaultFixedCommissionPerImage
  );
  if (!Number.isFinite(fixedCommissionPerImage) || fixedCommissionPerImage <= 0) return;
  const amountRmb = roundMoney(log.imageCount * fixedCommissionPerImage);
  if (amountRmb <= 0) return;

  const sourceId = usageLogSourceId(log);
  const commissions = await repository.insertCommissionRecords([{
    sourceType: "new_api_consume_log",
    sourceId,
    beneficiaryCrmUserId: agent.crmUserId,
    customerCrmUserId: log.crmUserId,
    commissionType: commissionTypes.enterpriseFixedPerImage,
    orderKind: orderKinds.repurchase,
    agentLevel: null,
    baseAmountRmb: log.imageCount,
    rate: fixedCommissionPerImage,
    amountRmb
  }]);
  await recordCommissionFreezeLedgerRows({
    repository,
    commissions,
    sourceEventId: sourceId,
    idempotencyScope: usageLedgerIdempotencyKey(log.crmUserId, log.id),
    operatorCrmUserId
  });
}

export async function refreshEffectiveCustomerConsumption({
  repository,
  customerCrmUserId
}: {
  repository: UsageSyncRepository;
  customerCrmUserId: number;
}) {
  const candidates = await repository.listEffectiveCustomers({
    page: 1,
    pageSize: 100,
    customerCrmUserId
  });
  if (!candidates.items.length) return [];

  const consumedRmb = await repository.sumLedgerAmount({
    crmUserId: customerCrmUserId,
    eventType: ledgerEventTypes.imageConsume,
    direction: ledgerDirections.debit
  });

  const updated = [];
  for (const candidate of candidates.items) {
    const paidAmount = Math.max(0, Number(candidate.firstPaidAmountRmb || 0));
    const paidBalanceConsumedRate = paidAmount > 0 ? roundRate(consumedRmb / paidAmount) : 0;
    const result = await evaluateEffectiveCustomerCandidate({
      repository,
      agentId: candidate.agentId,
      customerCrmUserId,
      paidBalanceConsumedRate
    });
    updated.push(result.effectiveCustomer);
  }
  return updated;
}

export async function syncUsageLogsToLedgerAndEffectiveCustomers({
  repository,
  logs,
  crmUserId
}: {
  repository: UsageSyncRepository;
  logs: NormalizedNewApiUsageLog[];
  crmUserId: number;
}): Promise<{ syncedLogs: number; effectiveCustomers: Awaited<ReturnType<typeof refreshEffectiveCustomerConsumption>> }> {
  const syncedLogs = await syncUsageLogsToLedger({ repository, logs });
  return {
    syncedLogs,
    effectiveCustomers: await refreshEffectiveCustomerConsumption({ repository, customerCrmUserId: crmUserId })
  };
}

async function syncUsageLogsToLedger({
  repository,
  logs
}: {
  repository: UsageSyncRepository;
  logs: NormalizedNewApiUsageLog[];
}): Promise<number> {
  let syncedLogs = 0;
  for (const log of logs) {
    const inserted = await repository.withTransaction(async (transactionRepository) => {
      if (!await insertUsageLogLedgerIfMissing({ repository: transactionRepository, log })) {
        return false;
      }
      await createEnterpriseFixedCommissionIfEligible({
        repository: transactionRepository,
        log,
        operatorCrmUserId: log.crmUserId
      });
      return true;
    });
    if (inserted) {
      syncedLogs += 1;
    }
  }
  return syncedLogs;
}

export async function syncNewApiConsumptionForCrmUser({
  repository,
  newApiClient,
  crmUserId,
  quotaPerRmb,
  pageSize = 100,
  maxPages = 20
}: {
  repository: UsageSyncRepository;
  newApiClient: UsageSyncNewApiClient;
  crmUserId: number;
  quotaPerRmb: number;
  pageSize?: number;
  maxPages?: number;
}): Promise<CrmUsageSyncResultDto> {
  const crmUser = await repository.getCrmUserById(crmUserId);
  if (!crmUser || !crmUser.newApiUserId) {
    throw httpError("CRM user was not found", 404, "crm_user_not_found");
  }
  const newApiUser = await newApiClient.getUser(crmUser.newApiUserId);
  const newApiUsername = readText(newApiUser.username).trim();
  if (!newApiUsername) {
    throw httpError("CRM new-api user is not linked", 409, "crm_new_api_user_unlinked");
  }

  let logsRead = 0;
  let syncedLogs = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await newApiClient.listConsumeLogs({ page, pageSize, username: newApiUsername });
    const pageData = unwrapNewApiUsageLogs(payload);
    const logs = pageData.items.map((log) => normalizeNewApiUsageLog({
      log,
      crmUserId,
      username: crmUser.username,
      quotaPerRmb
    }));
    logsRead += logs.length;
    syncedLogs += await syncUsageLogsToLedger({ repository, logs });
    if (pageData.items.length < pageSize || page * pageSize >= pageData.total) break;
  }

  return {
    crmUserId,
    newApiUsername,
    logsRead,
    syncedLogs,
    skippedLogs: Math.max(0, logsRead - syncedLogs),
    effectiveCustomers: await refreshEffectiveCustomerConsumption({ repository, customerCrmUserId: crmUserId })
  };
}
