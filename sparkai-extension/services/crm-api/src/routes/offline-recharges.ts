import type { IncomingMessage } from "node:http";
import {
  accountEventTypes,
  offlineRechargeMethods,
  offlineRechargeStatuses,
  type OfflineRechargeMethod,
  type OfflineRechargeStatus
} from "@ai-native/crm-contracts";
import { createAccountEvent } from "../domain/account-events.js";
import { httpError, parsePositiveInteger, readJsonBody } from "../http.js";
import type { CrmConfig, CrmRepository, CrmUserContext, NewApiClient } from "../types.js";
import { parsePageOptions } from "./pagination.js";

function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw httpError(`${name} is required`, 400, "invalid_request");
  }
  return value.trim();
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requireMoneyAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw httpError("amountRmb must be positive", 400, "invalid_request");
  }
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 1e-8) {
    throw httpError("amountRmb must use at most two decimal places", 400, "invalid_request");
  }
  return cents / 100;
}

function requireMethod(value: unknown): OfflineRechargeMethod {
  if (!Object.values(offlineRechargeMethods).includes(value as OfflineRechargeMethod)) {
    throw httpError("offline recharge method is invalid", 400, "invalid_request");
  }
  return value as OfflineRechargeMethod;
}

function parseStatus(value: string | null): OfflineRechargeStatus | undefined {
  if (!value) return undefined;
  if (!Object.values(offlineRechargeStatuses).includes(value as OfflineRechargeStatus)) {
    throw httpError("offline recharge status is invalid", 400, "invalid_request");
  }
  return value as OfflineRechargeStatus;
}

function accountEventIdempotencyKey(requestId: number): string {
  return `offline-recharge-request:${requestId}:approve`;
}

export async function createAgentOfflineRechargeRequestRoute({
  req,
  context,
  repository
}: {
  req: IncomingMessage;
  context: CrmUserContext;
  repository: Pick<CrmRepository, "createOfflineRechargeRequest">;
}) {
  const body = await readJsonBody(req);
  return repository.createOfflineRechargeRequest({
    crmUserId: context.crmUserId,
    method: requireMethod(body.method),
    amountRmb: requireMoneyAmount(body.amountRmb),
    payerName: optionalText(body.payerName),
    paymentReference: requireText(body.paymentReference, "paymentReference"),
    paymentEvidenceUrl: optionalText(body.paymentEvidenceUrl),
    notes: optionalText(body.notes)
  });
}

export async function listAgentOfflineRechargeRequestsRoute({
  context,
  repository,
  url
}: {
  context: CrmUserContext;
  repository: Pick<CrmRepository, "listOfflineRechargeRequests">;
  url: URL;
}) {
  return repository.listOfflineRechargeRequests({
    ...parsePageOptions(url),
    crmUserId: context.crmUserId,
    status: parseStatus(url.searchParams.get("status"))
  });
}

export async function getAgentOfflineRechargeSettingsRoute({
  repository
}: {
  repository: Pick<CrmRepository, "getSettings">;
}) {
  const settings = await repository.getSettings();
  return {
    accounts: settings.offlineRechargeAccounts
  };
}

export async function listAdminOfflineRechargeRequestsRoute({
  repository,
  url
}: {
  repository: Pick<CrmRepository, "listOfflineRechargeRequests">;
  url: URL;
}) {
  return repository.listOfflineRechargeRequests({
    ...parsePageOptions(url),
    status: parseStatus(url.searchParams.get("status"))
  });
}

export function matchOfflineRechargeAction(pathname: string): { requestId: number; action: "approve" | "reject" } | null {
  const matched = /^\/crm\/admin\/offline-recharge-requests\/(\d+)\/(approve|reject)$/.exec(pathname);
  if (!matched) return null;
  return {
    requestId: parsePositiveInteger(matched[1], "offlineRechargeRequestId"),
    action: matched[2] as "approve" | "reject"
  };
}

export async function updateOfflineRechargeRequestRoute({
  req,
  repository,
  newApiClient,
  config,
  requestId,
  action,
  operatorCrmUserId
}: {
  req: IncomingMessage;
  repository: CrmRepository;
  newApiClient: Pick<NewApiClient, "manageUserQuota">;
  config: Pick<CrmConfig, "quotaPerRmb">;
  requestId: number;
  action: "approve" | "reject";
  operatorCrmUserId: number;
}) {
  const current = await repository.getOfflineRechargeRequestById(requestId);
  if (!current) {
    throw httpError("offline recharge request was not found", 404, "offline_recharge_not_found");
  }
  const canResumeApproval = action === "approve" &&
    current.status === offlineRechargeStatuses.approved &&
    current.accountEventId === null;
  if (current.status !== offlineRechargeStatuses.pending && !canResumeApproval) {
    throw httpError("offline recharge request status is invalid", 409, "offline_recharge_status_invalid");
  }
  const body = await readJsonBody(req);
  const reviewReason = optionalText(body.reviewReason) || (action === "approve" ? "已核对到账" : "未通过线下充值审核");
  if (action === "reject") {
    return repository.withTransaction(async (transactionRepository) => {
      const rejected = await transactionRepository.updateOfflineRechargeRequest(requestId, {
        status: offlineRechargeStatuses.rejected,
        reviewerCrmUserId: operatorCrmUserId,
        reviewReason,
        accountEventId: null
      }, offlineRechargeStatuses.pending);
      if (!rejected) {
        throw httpError("offline recharge request status is invalid", 409, "offline_recharge_status_invalid");
      }
      await transactionRepository.insertAuditLog({
        operatorCrmUserId,
        targetType: "offline_recharge_request",
        targetId: requestId,
        action: "offline_recharge.reject",
        reason: reviewReason,
        before: current,
        after: rejected
      });
      return rejected;
    });
  }

  let approved = current;
  if (!canResumeApproval) {
    approved = await repository.withTransaction(async (transactionRepository) => {
      const claimed = await transactionRepository.updateOfflineRechargeRequest(requestId, {
        status: offlineRechargeStatuses.approved,
        reviewerCrmUserId: operatorCrmUserId,
        reviewReason,
        accountEventId: null
      }, offlineRechargeStatuses.pending);
      if (!claimed) {
        throw httpError("offline recharge request status is invalid", 409, "offline_recharge_status_invalid");
      }
      await transactionRepository.insertAuditLog({
        operatorCrmUserId,
        targetType: "offline_recharge_request",
        targetId: requestId,
        action: "offline_recharge.approve",
        reason: reviewReason,
        before: current,
        after: claimed
      });
      return claimed;
    });
  }

  const idempotencyKey = accountEventIdempotencyKey(current.id);
  let result;
  try {
    result = await createAccountEvent({
      repository,
      newApiClient,
      config,
      input: {
        eventType: accountEventTypes.adminPaidTopup,
        crmUserId: current.crmUserId,
        operatorCrmUserId,
        amountRmb: current.amountRmb,
        idempotencyKey,
        reason: reviewReason,
        metadata: {
          offlineRechargeRequestId: current.id,
          method: current.method,
          paymentReference: current.paymentReference,
          paymentEvidenceUrl: current.paymentEvidenceUrl
        }
      }
    });
  } catch (error) {
    const existingEvent = await repository.findAccountEventByIdempotencyKey(idempotencyKey);
    if (existingEvent) {
      await repository.updateOfflineRechargeRequest(requestId, {
        status: offlineRechargeStatuses.approved,
        reviewerCrmUserId: operatorCrmUserId,
        reviewReason,
        accountEventId: existingEvent.id
      }, offlineRechargeStatuses.approved);
    }
    throw error;
  }
  const completed = await repository.updateOfflineRechargeRequest(requestId, {
    status: offlineRechargeStatuses.approved,
    reviewerCrmUserId: operatorCrmUserId,
    reviewReason,
    accountEventId: result.record.id
  }, offlineRechargeStatuses.approved);
  if (!completed) {
    throw httpError("offline recharge request status is invalid", 409, "offline_recharge_status_invalid");
  }
  return completed;
}
