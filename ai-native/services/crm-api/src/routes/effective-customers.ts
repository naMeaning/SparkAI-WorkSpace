import type { IncomingMessage } from "node:http";
import { runEffectiveCustomerMaintenance } from "../domain/effective-customer-maintenance.js";
import { evaluateEffectiveCustomerCandidate } from "../domain/effective-customers.js";
import { syncNewApiConsumptionForCrmUser } from "../domain/usage-consumption.js";
import { httpError, parsePositiveInteger, readJsonBody } from "../http.js";
import type { CrmRepository, NewApiClient } from "../types.js";
import { parsePageOptions } from "./pagination.js";

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "boolean") {
    throw httpError(`${name} must be a boolean`, 400, "invalid_request");
  }
  return value;
}

function optionalTimestamp(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw httpError("evaluatedAt is invalid", 400, "invalid_request");
  }
  return value.trim();
}

function optionalQueryInteger(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  return value ? parsePositiveInteger(value, name) : undefined;
}

function optionalQueryBoolean(url: URL, name: string): boolean | undefined {
  const value = url.searchParams.get(name);
  if (!value) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw httpError(`${name} must be true or false`, 400, "invalid_request");
}

export async function listEffectiveCustomersRoute({
  repository,
  url
}: {
  repository: CrmRepository;
  url: URL;
}) {
  return repository.listEffectiveCustomers({
    ...parsePageOptions(url),
    agentId: optionalQueryInteger(url, "agentId"),
    customerCrmUserId: optionalQueryInteger(url, "customerCrmUserId"),
    isEffective: optionalQueryBoolean(url, "isEffective"),
    countedForLevel: optionalQueryBoolean(url, "countedForLevel")
  });
}

export async function evaluateEffectiveCustomerRoute({
  req,
  repository
}: {
  req: IncomingMessage;
  repository: CrmRepository;
}) {
  const body = await readJsonBody(req);
  return evaluateEffectiveCustomerCandidate({
    repository,
    agentId: parsePositiveInteger(body.agentId, "agentId"),
    customerCrmUserId: parsePositiveInteger(body.customerCrmUserId, "customerCrmUserId"),
    isRefunded: optionalBoolean(body.isRefunded, "isRefunded"),
    isRelatedAccount: optionalBoolean(body.isRelatedAccount, "isRelatedAccount"),
    isRisk: optionalBoolean(body.isRisk, "isRisk"),
    evaluatedAt: optionalTimestamp(body.evaluatedAt)
  });
}

export async function syncEffectiveCustomerConsumptionRoute({
  req,
  repository,
  newApiClient,
  quotaPerRmb
}: {
  req: IncomingMessage;
  repository: CrmRepository;
  newApiClient: Pick<NewApiClient, "getUser" | "listConsumeLogs">;
  quotaPerRmb: number;
}) {
  const body = await readJsonBody(req);
  return syncNewApiConsumptionForCrmUser({
    repository,
    newApiClient,
    crmUserId: parsePositiveInteger(body.customerCrmUserId, "customerCrmUserId"),
    quotaPerRmb
  });
}

export async function runEffectiveCustomerMaintenanceRoute({
  req,
  repository,
  newApiClient,
  quotaPerRmb
}: {
  req: IncomingMessage;
  repository: CrmRepository;
  newApiClient: Pick<NewApiClient, "getUser" | "listConsumeLogs">;
  quotaPerRmb: number;
}) {
  const body = await readJsonBody(req);
  return runEffectiveCustomerMaintenance({
    repository,
    newApiClient,
    quotaPerRmb,
    evaluatedAt: optionalTimestamp(body.evaluatedAt),
    syncConsumption: optionalBoolean(body.syncConsumption, "syncConsumption") ?? true
  });
}
