import { parsePositiveInteger } from "../http.js";
import type { AuditLogListOptions, CrmRepository } from "../types.js";
import { parsePageOptions } from "./pagination.js";

export async function listAuditLogsRoute({ repository, url }: { repository: Pick<CrmRepository, "listAuditLogs">; url: URL }) {
  const operatorCrmUserId = url.searchParams.get("operatorCrmUserId");
  const options: AuditLogListOptions = parsePageOptions(url);
  if (operatorCrmUserId) options.operatorCrmUserId = parsePositiveInteger(operatorCrmUserId, "operatorCrmUserId");
  const targetType = optionalText(url.searchParams.get("targetType"));
  if (targetType) options.targetType = targetType;
  const targetId = optionalText(url.searchParams.get("targetId"));
  if (targetId) options.targetId = targetId;
  const action = optionalText(url.searchParams.get("action"));
  if (action) options.action = action;
  return repository.listAuditLogs(options);
}

function optionalText(value: string | null): string | undefined {
  const text = String(value || "").trim();
  return text || undefined;
}
