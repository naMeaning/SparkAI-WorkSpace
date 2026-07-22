import type { IncomingMessage } from "node:http";
import { accountEventStatuses, accountEventTypes, type AccountEventStatus, type AccountEventType } from "@ai-native/crm-contracts";
import {
  cancelReconcileAccountEvent,
  createAccountEvent,
  reconcileAccountEventLocalEffects,
  refundAccountEvent
} from "../domain/account-events.js";
import { httpError, parsePositiveInteger, readJsonBody } from "../http.js";
import type { AccountEventListOptions, CrmConfig, CrmRepository, NewApiClient } from "../types.js";
import { parsePageOptions } from "./pagination.js";

export async function listAccountEventsRoute({ repository, url }: { repository: Pick<CrmRepository, "listAccountEvents">; url: URL }) {
  const crmUserId = url.searchParams.get("crmUserId");
  const eventType = url.searchParams.get("eventType");
  const status = url.searchParams.get("status");
  const options: AccountEventListOptions = parsePageOptions(url);
  if (crmUserId) options.crmUserId = parsePositiveInteger(crmUserId, "crmUserId");
  const parsedEventType = parseAccountEventType(eventType);
  if (parsedEventType) options.eventType = parsedEventType;
  const parsedStatus = parseAccountEventStatus(status);
  if (parsedStatus) options.status = parsedStatus;
  return repository.listAccountEvents(options);
}

function parseAccountEventType(value: string | null): AccountEventType | undefined {
  if (!value) return undefined;
  if (!Object.values(accountEventTypes).includes(value as AccountEventType)) {
    throw httpError("account event type is invalid", 400, "invalid_request");
  }
  return value as AccountEventType;
}

function parseAccountEventStatus(value: string | null): AccountEventStatus | undefined {
  if (!value) return undefined;
  if (!Object.values(accountEventStatuses).includes(value as AccountEventStatus)) {
    throw httpError("account event status is invalid", 400, "invalid_request");
  }
  return value as AccountEventStatus;
}

function manualAccountEventIdempotencyKey(): string {
  return `manual-account-event:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

export async function createAccountEventRoute({
  req,
  repository,
  newApiClient,
  config,
  operatorCrmUserId
}: {
  req: IncomingMessage;
  repository: CrmRepository;
  newApiClient: Pick<NewApiClient, "manageUserQuota">;
  config: CrmConfig;
  operatorCrmUserId: number;
}) {
  const body = await readJsonBody(req);
  return createAccountEvent({
    repository,
    newApiClient,
    config,
    input: {
      ...body,
      idempotencyKey: typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
        ? body.idempotencyKey
        : manualAccountEventIdempotencyKey(),
      operatorCrmUserId
    }
  });
}

export async function reconcileAccountEventRoute({
  req,
  repository,
  accountEventId,
  operatorCrmUserId
}: {
  req: IncomingMessage;
  repository: CrmRepository;
  accountEventId: string;
  operatorCrmUserId: number;
}) {
  const body = await readJsonBody(req);
  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (action === "cancel") {
    const reason = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "已确认模型服务额度未入账";
    return cancelReconcileAccountEvent({
      repository,
      accountEventId: parsePositiveInteger(accountEventId, "accountEventId"),
      operatorCrmUserId,
      reason
    });
  }
  if (action !== "confirm_quota_applied") {
    throw httpError("account event reconcile action is invalid", 400, "invalid_request");
  }
  const reason = typeof body.reason === "string" && body.reason.trim()
    ? body.reason.trim()
    : "已人工确认模型服务额度已入账";
  return reconcileAccountEventLocalEffects({
    repository,
    accountEventId: parsePositiveInteger(accountEventId, "accountEventId"),
    operatorCrmUserId,
    reason
  });
}

export async function refundAccountEventRoute({
  req,
  repository,
  newApiClient,
  accountEventId,
  operatorCrmUserId
}: {
  req: IncomingMessage;
  repository: CrmRepository;
  newApiClient: Pick<NewApiClient, "manageUserQuota">;
  accountEventId: string;
  operatorCrmUserId: number;
}) {
  const body = await readJsonBody(req);
  const reason = typeof body.reason === "string" && body.reason.trim()
    ? body.reason.trim()
    : "人工登记退款";
  return refundAccountEvent({
    repository,
    newApiClient,
    accountEventId: parsePositiveInteger(accountEventId, "accountEventId"),
    operatorCrmUserId,
    reason
  });
}
