import type { IncomingMessage } from "node:http";
import { withdrawalStatuses, type WithdrawalStatus } from "@ai-native/crm-contracts";
import { httpError, matchPath, parsePositiveInteger, readJsonBody } from "../http.js";
import type { CrmRepository } from "../types.js";
import { parsePageOptions } from "./pagination.js";

function parseWithdrawalStatus(value: unknown): WithdrawalStatus | undefined {
  if (!value) return undefined;
  if (!Object.values(withdrawalStatuses).includes(value as WithdrawalStatus)) {
    throw httpError("withdrawal status is invalid", 400, "invalid_request");
  }
  return value as WithdrawalStatus;
}

export async function listWithdrawalsRoute({ repository, url }: { repository: Pick<CrmRepository, "listWithdrawals">; url: URL }) {
  const beneficiary = url.searchParams.get("beneficiaryCrmUserId");
  return repository.listWithdrawals({
    ...parsePageOptions(url),
    status: parseWithdrawalStatus(url.searchParams.get("status")),
    beneficiaryCrmUserId: beneficiary ? parsePositiveInteger(beneficiary, "beneficiaryCrmUserId") : undefined
  });
}

export function matchWithdrawalAction(pathname: string): { withdrawalId: number; status: WithdrawalStatus } | null {
  const approve = matchPath(pathname, "/crm/admin/withdrawals/:withdrawalId/approve");
  if (approve) return { withdrawalId: parsePositiveInteger(approve.withdrawalId, "withdrawalId"), status: withdrawalStatuses.approved };
  const reject = matchPath(pathname, "/crm/admin/withdrawals/:withdrawalId/reject");
  if (reject) return { withdrawalId: parsePositiveInteger(reject.withdrawalId, "withdrawalId"), status: withdrawalStatuses.rejected };
  const paid = matchPath(pathname, "/crm/admin/withdrawals/:withdrawalId/mark-paid");
  if (paid) return { withdrawalId: parsePositiveInteger(paid.withdrawalId, "withdrawalId"), status: withdrawalStatuses.paid };
  return null;
}

function assertWithdrawalTransition(currentStatus: WithdrawalStatus, nextStatus: WithdrawalStatus, paidReference: string): void {
  if (nextStatus === withdrawalStatuses.approved && currentStatus === withdrawalStatuses.pending) return;
  if (nextStatus === withdrawalStatuses.rejected && currentStatus === withdrawalStatuses.pending) return;
  if (nextStatus === withdrawalStatuses.paid && currentStatus === withdrawalStatuses.approved && paidReference) return;
  throw httpError("withdrawal status transition is invalid", 409, "withdrawal_status_invalid");
}

export async function updateWithdrawalRoute({
  req,
  repository,
  withdrawalId,
  status,
  operatorCrmUserId
}: {
  req: IncomingMessage;
  repository: Pick<
    CrmRepository,
    "getWithdrawalById" | "updateWithdrawal" | "insertAuditLog" | "markWithdrawalPaidWithAllocations" | "withTransaction"
  >;
  withdrawalId: number;
  status: WithdrawalStatus;
  operatorCrmUserId: number;
}) {
  const body = await readJsonBody(req);
  const reviewReason = typeof body.reviewReason === "string" && body.reviewReason.trim() ? body.reviewReason.trim() : status;
  const paidReference = typeof body.paidReference === "string" ? body.paidReference.trim() : "";
  const paidEvidenceUrl = typeof body.paidEvidenceUrl === "string" ? body.paidEvidenceUrl.trim() : "";
  const current = await repository.getWithdrawalById(withdrawalId);
  if (!current) {
    throw httpError("withdrawal was not found", 404, "not_found");
  }
  assertWithdrawalTransition(current.status, status, paidReference);
  if (status === withdrawalStatuses.paid) {
    const result = await repository.markWithdrawalPaidWithAllocations({
      withdrawalId,
      operatorCrmUserId,
      reviewReason,
      paidReference,
      paidEvidenceUrl
    });
    return result.withdrawal;
  }
  return repository.withTransaction(async (transactionRepository) => {
    const withdrawal = await transactionRepository.updateWithdrawal(withdrawalId, {
      status,
      reviewerCrmUserId: operatorCrmUserId,
      reviewReason,
      paidReference,
      paidEvidenceUrl
    }, withdrawalStatuses.pending);
    if (!withdrawal) {
      throw httpError("withdrawal status transition is invalid", 409, "withdrawal_status_invalid");
    }
    await transactionRepository.insertAuditLog({
      operatorCrmUserId,
      targetType: "withdrawal",
      targetId: withdrawalId,
      action: `withdrawal.${status}`,
      reason: reviewReason,
      before: current,
      after: withdrawal
    });
    return withdrawal;
  });
}
