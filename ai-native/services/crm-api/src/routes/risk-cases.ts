import type { IncomingMessage } from "node:http";
import { riskStatuses, riskTargetTypes, type RiskStatus, type RiskTargetType } from "@ai-native/crm-contracts";
import { httpError, parsePositiveInteger, readJsonBody } from "../http.js";
import type { CrmRepository } from "../types.js";
import { parsePageOptions } from "./pagination.js";

function parseRiskStatus(value: unknown): RiskStatus | undefined {
  if (!value) return undefined;
  if (!Object.values(riskStatuses).includes(value as RiskStatus)) {
    throw httpError("risk status is invalid", 400, "invalid_request");
  }
  return value as RiskStatus;
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw httpError(`${name} is required`, 400, "invalid_request");
  }
  return value.trim();
}

function parseRiskTargetType(value: unknown): RiskTargetType {
  const targetType = requireText(value, "targetType");
  if (!Object.values(riskTargetTypes).includes(targetType as RiskTargetType)) {
    throw httpError("risk target type is invalid", 400, "invalid_request");
  }
  return targetType as RiskTargetType;
}

const activeRiskStatuses: RiskStatus[] = [riskStatuses.open, riskStatuses.reviewing];

async function syncUserProfileRisk({
  repository,
  targetType,
  targetId
}: {
  repository: Pick<CrmRepository, "getUserProfile" | "saveUserProfile" | "listRiskCases">;
  targetType: string;
  targetId: string;
}): Promise<void> {
  if (targetType !== "user") return;
  const crmUserId = parsePositiveInteger(targetId, "targetId");
  const activeCounts = await Promise.all(
    activeRiskStatuses.map((status) => repository.listRiskCases({
      targetType,
      targetId,
      status,
      page: 1,
      pageSize: 1
    }))
  );
  const nextIsRisk = activeCounts.some((page) => page.total > 0);
  const profile = await repository.getUserProfile(crmUserId);
  if (profile.isRisk === nextIsRisk) return;
  await repository.saveUserProfile({
    ...profile,
    isRisk: nextIsRisk
  });
}

export async function listRiskCasesRoute({ repository, url }: { repository: Pick<CrmRepository, "listRiskCases">; url: URL }) {
  return repository.listRiskCases({
    ...parsePageOptions(url),
    status: parseRiskStatus(url.searchParams.get("status")),
    targetType: url.searchParams.get("targetType") || undefined,
    targetId: url.searchParams.get("targetId") || undefined
  });
}

export async function createRiskCaseRoute({
  req,
  repository,
  operatorCrmUserId
}: {
  req: IncomingMessage;
  repository: Pick<CrmRepository, "createRiskCase" | "insertAuditLog" | "getUserProfile" | "saveUserProfile" | "listRiskCases">;
  operatorCrmUserId: number;
}) {
  const body = await readJsonBody(req);
  const riskCase = await repository.createRiskCase({
    targetType: parseRiskTargetType(body.targetType),
    targetId: requireText(body.targetId, "targetId"),
    riskType: requireText(body.riskType, "riskType"),
    evidence: body.evidence ?? null,
    notes: typeof body.notes === "string" ? body.notes : "",
    blocksWithdrawal: Boolean(body.blocksWithdrawal),
    blocksCommissionRelease: Boolean(body.blocksCommissionRelease),
    createdByCrmUserId: operatorCrmUserId
  });
  await repository.insertAuditLog({
    operatorCrmUserId,
    targetType: "risk_case",
    targetId: riskCase.id,
    action: "risk_case.create",
    reason: riskCase.notes,
    after: riskCase
  });
  await syncUserProfileRisk({
    repository,
    targetType: riskCase.targetType,
    targetId: riskCase.targetId
  });
  return riskCase;
}

export async function updateRiskCaseRoute({
  req,
  repository,
  riskCaseId,
  operatorCrmUserId
}: {
  req: IncomingMessage;
  repository: Pick<CrmRepository, "updateRiskCase" | "insertAuditLog" | "getUserProfile" | "saveUserProfile" | "listRiskCases">;
  riskCaseId: number;
  operatorCrmUserId: number;
}) {
  const body = await readJsonBody(req);
  const riskCase = await repository.updateRiskCase(riskCaseId, {
    status: parseRiskStatus(body.status),
    evidence: body.evidence,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    blocksWithdrawal: typeof body.blocksWithdrawal === "boolean" ? body.blocksWithdrawal : undefined,
    blocksCommissionRelease: typeof body.blocksCommissionRelease === "boolean" ? body.blocksCommissionRelease : undefined
  });
  await repository.insertAuditLog({
    operatorCrmUserId,
    targetType: "risk_case",
    targetId: riskCaseId,
    action: "risk_case.update",
    reason: riskCase.notes,
    after: riskCase
  });
  await syncUserProfileRisk({
    repository,
    targetType: riskCase.targetType,
    targetId: riskCase.targetId
  });
  return riskCase;
}

export function parseRiskCaseId(value: unknown): number {
  return parsePositiveInteger(value, "riskCaseId");
}
