import type { IncomingMessage } from "node:http";
import {
  enterpriseMonthlySettlementStatuses,
  type EnterpriseMonthlySettlementStatus
} from "@ai-native/crm-contracts";
import { generateEnterpriseMonthlySettlements } from "../domain/enterprise-settlements.js";
import { httpError, matchPath, parsePositiveInteger, readJsonBody } from "../http.js";
import type { CrmConfig, CrmRepository, NewApiClient } from "../types.js";
import { parsePageOptions } from "./pagination.js";

function optionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "boolean") {
    throw httpError(`${name} must be a boolean`, 400, "invalid_request");
  }
  return value;
}

function optionalPeriod(value: unknown): string | undefined {
  const text = optionalText(value);
  if (!text) return undefined;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    throw httpError("enterprise monthly settlement period is invalid", 400, "invalid_request");
  }
  return text;
}

function optionalStatus(value: string | null): EnterpriseMonthlySettlementStatus | undefined {
  if (!value) return undefined;
  if (!Object.values(enterpriseMonthlySettlementStatuses).includes(value as EnterpriseMonthlySettlementStatus)) {
    throw httpError("enterprise monthly settlement status is invalid", 400, "invalid_request");
  }
  return value as EnterpriseMonthlySettlementStatus;
}

export async function listEnterpriseMonthlySettlementsRoute({
  repository,
  url
}: {
  repository: Pick<CrmRepository, "listEnterpriseMonthlySettlements">;
  url: URL;
}) {
  const crmUserId = url.searchParams.get("crmUserId");
  return repository.listEnterpriseMonthlySettlements({
    ...parsePageOptions(url),
    period: optionalPeriod(url.searchParams.get("period")),
    status: optionalStatus(url.searchParams.get("status")),
    crmUserId: crmUserId ? parsePositiveInteger(crmUserId, "crmUserId") : undefined
  });
}

export async function generateEnterpriseMonthlySettlementsRoute({
  req,
  repository,
  newApiClient,
  config
}: {
  req: IncomingMessage;
  repository: CrmRepository;
  newApiClient: Pick<NewApiClient, "getUser" | "listConsumeLogs">;
  config: Pick<CrmConfig, "quotaPerRmb">;
}) {
  const body = await readJsonBody(req);
  return generateEnterpriseMonthlySettlements({
    repository,
    newApiClient,
    quotaPerRmb: config.quotaPerRmb,
    period: optionalPeriod(body.period),
    syncConsumption: optionalBoolean(body.syncConsumption, "syncConsumption") ?? true
  });
}

export function matchEnterpriseMonthlySettlementAction(pathname: string): {
  settlementId: number;
  status: EnterpriseMonthlySettlementStatus;
} | null {
  const paid = matchPath(pathname, "/crm/admin/enterprise/monthly-settlements/:settlementId/mark-paid");
  if (paid) {
    return {
      settlementId: parsePositiveInteger(paid.settlementId, "settlementId"),
      status: enterpriseMonthlySettlementStatuses.paid
    };
  }
  const cancel = matchPath(pathname, "/crm/admin/enterprise/monthly-settlements/:settlementId/cancel");
  if (cancel) {
    return {
      settlementId: parsePositiveInteger(cancel.settlementId, "settlementId"),
      status: enterpriseMonthlySettlementStatuses.cancelled
    };
  }
  return null;
}

export async function updateEnterpriseMonthlySettlementRoute({
  req,
  repository,
  settlementId,
  status,
  operatorCrmUserId
}: {
  req: IncomingMessage;
  repository: Pick<
    CrmRepository,
    "getEnterpriseMonthlySettlementById" | "updateEnterpriseMonthlySettlement" | "insertAuditLog" | "withTransaction"
  >;
  settlementId: number;
  status: EnterpriseMonthlySettlementStatus;
  operatorCrmUserId: number;
}) {
  const body = await readJsonBody(req);
  const current = await repository.getEnterpriseMonthlySettlementById(settlementId);
  if (!current) {
    throw httpError("enterprise monthly settlement was not found", 404, "not_found");
  }
  if (current.status !== enterpriseMonthlySettlementStatuses.pending) {
    throw httpError("enterprise monthly settlement status is invalid", 409, "enterprise_monthly_settlement_status_invalid");
  }
  const paidReference = optionalText(body.paidReference);
  const paidEvidenceUrl = optionalText(body.paidEvidenceUrl);
  const notes = optionalText(body.notes) || (status === enterpriseMonthlySettlementStatuses.paid ? "线下已收款" : "取消月结单");
  if (status === enterpriseMonthlySettlementStatuses.paid && !paidReference) {
    throw httpError("paidReference is required", 400, "invalid_request");
  }
  return repository.withTransaction(async (transactionRepository) => {
    const settlement = await transactionRepository.updateEnterpriseMonthlySettlement(settlementId, {
      status,
      paidReference,
      paidEvidenceUrl,
      notes
    }, enterpriseMonthlySettlementStatuses.pending);
    if (!settlement) {
      throw httpError(
        "enterprise monthly settlement status is invalid",
        409,
        "enterprise_monthly_settlement_status_invalid"
      );
    }
    await transactionRepository.insertAuditLog({
      operatorCrmUserId,
      targetType: "enterprise_monthly_settlement",
      targetId: settlementId,
      action: `enterprise_monthly_settlement.${status}`,
      reason: notes,
      before: current,
      after: settlement
    });
    return settlement;
  });
}
