import {
  commissionStatuses,
  ledgerDirections,
  ledgerEventTypes,
  withdrawalStatuses,
  type CommissionDto,
  type CommissionStatus,
  type WithdrawalDto
} from "@ai-native/crm-contracts";
import type { CrmRepository } from "../types.js";

type CommissionLedgerRepository = Pick<CrmRepository, "insertLedgerEntry">;

function requireCommissionId(commission: CommissionDto): number {
  if (!Number.isSafeInteger(commission.id) || Number(commission.id) <= 0) {
    throw new Error("commission id is required for commission ledger entry");
  }
  return Number(commission.id);
}

export async function recordCommissionFreezeLedgerRows({
  repository,
  commissions,
  sourceEventId,
  idempotencyScope,
  operatorCrmUserId
}: {
  repository: CommissionLedgerRepository;
  commissions: CommissionDto[];
  sourceEventId: number;
  idempotencyScope?: string;
  operatorCrmUserId: number;
}): Promise<void> {
  const ledgerScope = idempotencyScope || String(sourceEventId);
  for (const commission of commissions) {
    await repository.insertLedgerEntry({
      crmUserId: commission.beneficiaryCrmUserId,
      direction: ledgerDirections.credit,
      amountRmb: commission.amountRmb,
      paidAmountRmb: 0,
      discountAmountRmb: 0,
      commissionBaseRmb: commission.baseAmountRmb,
      eventType: ledgerEventTypes.commissionFreeze,
      sourceType: "commission",
      sourceId: commission.id || null,
      idempotencyKey: `commission-freeze:${ledgerScope}:${commission.beneficiaryCrmUserId}:${commission.commissionType}`,
      operatorCrmUserId,
      reason: "佣金冻结",
      isPaid: false
    });
  }
}

export async function recordCommissionStatusLedger({
  repository,
  commission,
  status,
  operatorCrmUserId,
  reason
}: {
  repository: CommissionLedgerRepository;
  commission: CommissionDto;
  status: CommissionStatus;
  operatorCrmUserId: number;
  reason: string;
}): Promise<void> {
  const commissionId = requireCommissionId(commission);
  if (status === commissionStatuses.releasable) {
    await repository.insertLedgerEntry({
      crmUserId: commission.beneficiaryCrmUserId,
      direction: ledgerDirections.credit,
      amountRmb: commission.amountRmb,
      paidAmountRmb: 0,
      discountAmountRmb: 0,
      commissionBaseRmb: commission.baseAmountRmb,
      eventType: ledgerEventTypes.commissionRelease,
      sourceType: "commission",
      sourceId: commissionId,
      idempotencyKey: `commission-release:${commissionId}:releasable`,
      operatorCrmUserId,
      reason,
      isPaid: false
    });
  }
  if (status === commissionStatuses.clawedBack) {
    await repository.insertLedgerEntry({
      crmUserId: commission.beneficiaryCrmUserId,
      direction: ledgerDirections.debit,
      amountRmb: commission.amountRmb,
      paidAmountRmb: 0,
      discountAmountRmb: 0,
      commissionBaseRmb: commission.baseAmountRmb,
      eventType: ledgerEventTypes.commissionClawback,
      sourceType: "commission",
      sourceId: commissionId,
      idempotencyKey: `commission-clawback:${commissionId}:clawed_back`,
      operatorCrmUserId,
      reason,
      isPaid: false
    });
  }
}

export async function recordWithdrawalPaidLedger({
  repository,
  withdrawal,
  operatorCrmUserId,
  reason
}: {
  repository: CommissionLedgerRepository;
  withdrawal: WithdrawalDto;
  operatorCrmUserId: number;
  reason: string;
}): Promise<void> {
  if (withdrawal.status !== withdrawalStatuses.paid) return;
  await repository.insertLedgerEntry({
    crmUserId: withdrawal.beneficiaryCrmUserId,
    direction: ledgerDirections.debit,
    amountRmb: withdrawal.amountRmb,
    paidAmountRmb: 0,
    discountAmountRmb: 0,
    commissionBaseRmb: 0,
    eventType: ledgerEventTypes.commissionWithdrawal,
    sourceType: "withdrawal",
    sourceId: withdrawal.id,
    idempotencyKey: `commission-withdrawal:${withdrawal.id}:paid`,
    operatorCrmUserId,
    reason,
    isPaid: false
  });
}
