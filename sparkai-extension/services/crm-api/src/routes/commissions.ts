import { commissionStatuses, type CommissionStatus } from "@ai-native/crm-contracts";
import { recordCommissionStatusLedger } from "../domain/commission-ledger.js";
import { httpError, matchPath, parsePositiveInteger } from "../http.js";
import type { CrmRepository } from "../types.js";
import { parsePageOptions } from "./pagination.js";

function parseCommissionStatus(value: unknown): CommissionStatus | undefined {
  if (!value) return undefined;
  if (!Object.values(commissionStatuses).includes(value as CommissionStatus)) {
    throw httpError("commission status is invalid", 400, "invalid_request");
  }
  return value as CommissionStatus;
}

export async function listCommissionsRoute({ repository, url }: { repository: Pick<CrmRepository, "listCommissions">; url: URL }) {
  const beneficiary = url.searchParams.get("beneficiaryCrmUserId");
  return repository.listCommissions({
    ...parsePageOptions(url),
    status: parseCommissionStatus(url.searchParams.get("status")),
    beneficiaryCrmUserId: beneficiary ? parsePositiveInteger(beneficiary, "beneficiaryCrmUserId") : undefined
  });
}

export function matchCommissionAction(pathname: string): { commissionId: number; status: CommissionStatus } | null {
  const release = matchPath(pathname, "/crm/admin/commissions/:commissionId/release");
  if (release) return { commissionId: parsePositiveInteger(release.commissionId, "commissionId"), status: commissionStatuses.releasable };
  const block = matchPath(pathname, "/crm/admin/commissions/:commissionId/block");
  if (block) return { commissionId: parsePositiveInteger(block.commissionId, "commissionId"), status: commissionStatuses.blocked };
  const clawback = matchPath(pathname, "/crm/admin/commissions/:commissionId/clawback");
  if (clawback) return { commissionId: parsePositiveInteger(clawback.commissionId, "commissionId"), status: commissionStatuses.clawedBack };
  return null;
}

export async function updateCommissionStatusRoute({
  repository,
  commissionId,
  status,
  operatorCrmUserId,
  reason
}: {
  repository: Pick<CrmRepository, "withTransaction">;
  commissionId: number;
  status: CommissionStatus;
  operatorCrmUserId: number;
  reason: string;
}) {
  return repository.withTransaction(async (transactionRepository) => {
    if (status === commissionStatuses.releasable) {
      const blocked = await transactionRepository.hasBlockingRisk(
        "commission",
        String(commissionId),
        "commission_release"
      );
      if (blocked) {
        throw httpError("commission release is blocked by risk case", 409, "commission_release_risk_blocked");
      }
    }
    const commission = await transactionRepository.updateCommissionStatus(
      commissionId,
      status,
      operatorCrmUserId,
      reason
    );
    await recordCommissionStatusLedger({
      repository: transactionRepository,
      commission,
      status,
      operatorCrmUserId,
      reason
    });
    return commission;
  });
}
