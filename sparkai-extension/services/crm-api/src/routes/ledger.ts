import { ledgerDirections, ledgerEventTypes, type LedgerDirection, type LedgerEventType } from "@ai-native/crm-contracts";
import { httpError, parsePositiveInteger } from "../http.js";
import type { CrmRepository, LedgerListOptions } from "../types.js";
import { parsePageOptions } from "./pagination.js";

export async function listLedger({ repository, url }: { repository: Pick<CrmRepository, "listLedger">; url: URL }) {
  const crmUserId = url.searchParams.get("crmUserId");
  const options: LedgerListOptions = parsePageOptions(url);
  if (crmUserId) options.crmUserId = parsePositiveInteger(crmUserId, "crmUserId");
  const eventType = parseLedgerEventType(url.searchParams.get("eventType"));
  if (eventType) options.eventType = eventType;
  const direction = parseLedgerDirection(url.searchParams.get("direction"));
  if (direction) options.direction = direction;
  return repository.listLedger(options);
}

function parseLedgerEventType(value: string | null): LedgerEventType | undefined {
  if (!value) return undefined;
  if (!Object.values(ledgerEventTypes).includes(value as LedgerEventType)) {
    throw httpError("ledger event type is invalid", 400, "invalid_request");
  }
  return value as LedgerEventType;
}

function parseLedgerDirection(value: string | null): LedgerDirection | undefined {
  if (!value) return undefined;
  if (!Object.values(ledgerDirections).includes(value as LedgerDirection)) {
    throw httpError("ledger direction is invalid", 400, "invalid_request");
  }
  return value as LedgerDirection;
}
