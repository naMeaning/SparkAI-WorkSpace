import {
  accountEventStatuses,
  accountEventTypes,
  commissionStatuses,
  ledgerDirections,
  ledgerEventTypes,
  orderKinds,
  signupTrialGrantStatuses,
  type AccountEventStatus,
  type AccountEventType,
  type CrmUserProfileDto
} from "@ai-native/crm-contracts";
import type { AccountEventInput, AccountEventRecord, CrmConfig, CrmRepository, NewApiClient, NewApiQuotaPayload } from "../types.js";
import { httpError } from "../http.js";
import { formatMysqlTimestamp } from "../time.js";
import { calculateStandardCommissions } from "./commissions.js";
import { recordCommissionFreezeLedgerRows, recordCommissionStatusLedger } from "./commission-ledger.js";
import { evaluateEffectiveCustomerCandidate, recordPaidEventEffectiveCustomerCandidate } from "./effective-customers.js";
import { convertSignedRmbToNewApiQuota } from "./new-api-quota.js";

const paidEventTypes = new Set<AccountEventType>([accountEventTypes.adminPaidTopup, accountEventTypes.onlineTopup]);

function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw httpError(`${name} is required`, 400, "invalid_request");
  }
  return value.trim();
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw httpError(`${name} must be a positive integer`, 400, "invalid_request");
  }
  return value;
}

function parseMoneyAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw httpError("amountRmb must be a finite number", 400, "invalid_request");
  }
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 1e-8) {
    throw httpError("amountRmb must use at most two decimal places", 400, "invalid_request");
  }
  return cents / 100;
}

function requireAmount(value: unknown, eventType: AccountEventType): number {
  const amount = parseMoneyAmount(value);
  if (amount === 0) {
    throw httpError("amountRmb must not be zero", 400, "invalid_request");
  }
  if (
    amount < 0 &&
    eventType !== accountEventTypes.exceptionAdjustment &&
    eventType !== accountEventTypes.refund
  ) {
    throw httpError("only exception adjustments can be negative", 400, "invalid_request");
  }
  return amount;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function ledgerDirectionForAmount(amountRmb: number) {
  return amountRmb >= 0 ? ledgerDirections.credit : ledgerDirections.debit;
}

function requireEventType(type: unknown): AccountEventType {
  if (typeof type !== "string" || !Object.values(accountEventTypes).includes(type as AccountEventType)) {
    throw httpError("account event type is invalid", 400, "invalid_request");
  }
  return type as AccountEventType;
}

function buildQuotaPayload(newApiUserId: number, quotaDelta: number): NewApiQuotaPayload {
  return {
    newApiUserId: newApiUserId,
    mode: quotaDelta >= 0 ? "add" : "subtract",
    value: Math.abs(quotaDelta)
  };
}

function isSameIdempotencyPayload(record: AccountEventRecord, input: AccountEventInput): boolean {
  return (
    Number(record.crmUserId) === input.crmUserId &&
    Number(record.operatorCrmUserId || 0) === input.operatorCrmUserId &&
    record.eventType === input.eventType &&
    Number(record.amountRmb) === input.amountRmb &&
    Number(record.paidAmountRmb) === input.paidAmountRmb &&
    Number(record.discountAmountRmb) === input.discountAmountRmb &&
    Number(record.commissionBaseRmb) === input.commissionBaseRmb &&
    Number(record.quotaDelta) === input.quotaDelta
  );
}

function isSameCompletedIdempotencyRequest(
  record: AccountEventRecord,
  input: Pick<AccountEventInput, "eventType" | "crmUserId" | "operatorCrmUserId" | "amountRmb" | "quotaDelta">
): boolean {
  return (
    Number(record.crmUserId) === input.crmUserId &&
    Number(record.operatorCrmUserId || 0) === input.operatorCrmUserId &&
    record.eventType === input.eventType &&
    Number(record.amountRmb) === input.amountRmb &&
    Number(record.quotaDelta) === input.quotaDelta
  );
}

function throwReconcileRequired(status: string): never {
  throw httpError(`account event is in ${status} status and requires manual reconciliation`, 409, "account_event_reconcile_required");
}

function didStorageMutate(record: unknown): boolean {
  return (record as { didMutate?: boolean }).didMutate !== false;
}

function storageErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}

function updateAccountEventProfile(profile: CrmUserProfileDto, paidAmountRmb: number, isPaid: boolean): CrmUserProfileDto {
  if (!isPaid) {
    return profile;
  }
  const cumulativePaidRmb = roundMoney(Number(profile.cumulativePaidRmb || 0) + paidAmountRmb);
  return {
    ...profile,
    cumulativePaidRmb
  };
}

function updateRefundedPaidEventProfile(profile: CrmUserProfileDto, event: AccountEventRecord): CrmUserProfileDto {
  const cumulativePaidRmb = roundMoney(Math.max(0, Number(profile.cumulativePaidRmb || 0) - event.paidAmountRmb));
  return {
    ...profile,
    cumulativePaidRmb
  };
}

function accountEventMetadata(record: AccountEventRecord): Record<string, unknown> {
  return record.metadata && typeof record.metadata === "object"
    ? record.metadata as Record<string, unknown>
    : {};
}

export function accountEventRefundIdempotencyKey(accountEventId: number): string {
  return `account-event-refund:${accountEventId}`;
}

function resolvePaidAmounts({
  eventType,
  amountRmb,
  currentPaidRmb,
  crmUser,
  requestedPaidAmountRmb
}: {
  eventType: AccountEventType;
  amountRmb: number;
  currentPaidRmb: number;
  crmUser: Awaited<ReturnType<CrmRepository["getCrmUserById"]>>;
  requestedPaidAmountRmb?: number;
}) {
  const isPaid = paidEventTypes.has(eventType);
  if (!isPaid) {
    return { paidAmountRmb: 0, discountAmountRmb: 0, commissionBaseRmb: 0, shouldMarkFirstTopupDiscountUsed: false };
  }

  const hasFirstTopupDiscount = currentPaidRmb <= 0 &&
    Boolean(crmUser?.firstTopupDiscountRate) &&
    !crmUser?.firstTopupDiscountUsedAt;

  if (hasFirstTopupDiscount) {
    const paidAmountRmb = roundMoney(amountRmb * Number(crmUser?.firstTopupDiscountRate));
    return {
      paidAmountRmb,
      discountAmountRmb: roundMoney(amountRmb - paidAmountRmb),
      commissionBaseRmb: paidAmountRmb,
      shouldMarkFirstTopupDiscountUsed: true
    };
  }

  const paidAmountRmb = requestedPaidAmountRmb === undefined ? amountRmb : requireAmount(requestedPaidAmountRmb, eventType);
  return {
    paidAmountRmb,
    discountAmountRmb: roundMoney(Math.max(0, amountRmb - paidAmountRmb)),
    commissionBaseRmb: paidAmountRmb,
    shouldMarkFirstTopupDiscountUsed: false
  };
}

async function applyAccountEventLocalEffectsWithinTransaction({
  repository,
  localRecord,
  operatorCrmUserId,
  reason,
  auditAction
}: {
  repository: CrmRepository;
  localRecord: AccountEventRecord;
  operatorCrmUserId: number;
  reason: string;
  auditAction: string;
}) {
  if (localRecord.eventType === accountEventTypes.refund) {
    const sourceAccountEventId = requirePositiveInteger(
      accountEventMetadata(localRecord).sourceAccountEventId,
      "sourceAccountEventId"
    );
    const sourceEvent = await repository.getAccountEventById(sourceAccountEventId);
    if (!sourceEvent || sourceEvent.status !== accountEventStatuses.completed || !paidEventTypes.has(sourceEvent.eventType)) {
      throw httpError("account event cannot be refunded", 409, "account_event_refund_not_allowed");
    }

    const beforeProfile = await repository.getUserProfile(sourceEvent.crmUserId);
    const profile = await repository.saveUserProfile(updateRefundedPaidEventProfile(beforeProfile, sourceEvent));
    await repository.insertLedgerEntry({
      crmUserId: sourceEvent.crmUserId,
      direction: ledgerDirections.debit,
      amountRmb: Math.abs(sourceEvent.amountRmb),
      paidAmountRmb: Math.abs(sourceEvent.paidAmountRmb),
      discountAmountRmb: Math.abs(sourceEvent.discountAmountRmb),
      commissionBaseRmb: Math.abs(sourceEvent.commissionBaseRmb),
      eventType: ledgerEventTypes.refund,
      sourceType: "account_event",
      sourceId: sourceEvent.id,
      idempotencyKey: localRecord.idempotencyKey,
      operatorCrmUserId,
      reason,
      isPaid: true
    });

    const sourceCommissions = await repository.listCommissions({
      page: 1,
      pageSize: 100,
      sourceType: "account_event",
      sourceId: sourceEvent.id
    });
    const clawedBackCommissions = [];
    for (const commission of sourceCommissions.items) {
      if (!commission.id || commission.status === commissionStatuses.clawedBack) continue;
      const clawedBack = await repository.updateCommissionStatus(
        commission.id,
        commissionStatuses.clawedBack,
        operatorCrmUserId,
        reason
      );
      await recordCommissionStatusLedger({
        repository,
        commission: clawedBack,
        status: commissionStatuses.clawedBack,
        operatorCrmUserId,
        reason
      });
      clawedBackCommissions.push(clawedBack);
    }

    const effectiveCustomers = await repository.listEffectiveCustomers({
      page: 1,
      pageSize: 100,
      customerCrmUserId: sourceEvent.crmUserId
    });
    const refundedEffectiveCustomers = [];
    for (const candidate of effectiveCustomers.items) {
      if (candidate.firstPaidEventId !== sourceEvent.id) continue;
      const result = await evaluateEffectiveCustomerCandidate({
        repository,
        agentId: candidate.agentId,
        customerCrmUserId: sourceEvent.crmUserId,
        isRefunded: true
      });
      refundedEffectiveCustomers.push(result.effectiveCustomer);
    }

    await repository.insertAuditLog({
      operatorCrmUserId,
      targetType: "account_event",
      targetId: sourceEvent.id,
      action: "account_event.refund",
      reason,
      before: { event: sourceEvent, profile: beforeProfile },
      after: { refundEvent: localRecord, profile, clawedBackCommissions, refundedEffectiveCustomers }
    });
    const record = await repository.completeAccountEvent(localRecord.id, {
      quotaDelta: localRecord.quotaDelta,
      newApiResult: localRecord.newApiResult
    });
    return {
      record,
      sourceRecord: sourceEvent,
      profile,
      clawedBackCommissions,
      refundedEffectiveCustomers
    };
  }

  const crmUserId = localRecord.crmUserId;
  const currentProfile = await repository.getUserProfile(crmUserId);
  const crmUser = await repository.getCrmUserById(crmUserId);
  const isPaid = paidEventTypes.has(localRecord.eventType);
  const isSignupTrialGrant = localRecord.eventType === accountEventTypes.signupTrialGrant;
  const orderKind = Number(currentProfile.cumulativePaidRmb || 0) > 0 ? orderKinds.repurchase : orderKinds.firstOrder;
  const profile = await repository.saveUserProfile(updateAccountEventProfile(
    currentProfile,
    localRecord.paidAmountRmb,
    isPaid
  ));

  await repository.insertLedgerEntry({
    crmUserId,
    direction: ledgerDirectionForAmount(localRecord.amountRmb),
    amountRmb: Math.abs(localRecord.amountRmb),
    paidAmountRmb: localRecord.paidAmountRmb,
    discountAmountRmb: localRecord.discountAmountRmb,
    commissionBaseRmb: localRecord.commissionBaseRmb,
    eventType: isSignupTrialGrant ? ledgerEventTypes.signupTrialGrant : ledgerEventTypes.accountEvent,
    sourceType: isSignupTrialGrant ? "crm_signup_trial_grant" : "account_event",
    sourceId: isSignupTrialGrant ? crmUser?.newApiUserId || null : localRecord.id,
    idempotencyKey: localRecord.idempotencyKey,
    operatorCrmUserId,
    reason,
    isPaid
  });

  if (isPaid) {
    const relationship = await repository.getAgentRelationshipByCustomer(crmUserId);
    const agent = relationship ? await repository.getAgentByCrmUserId(relationship.agentCrmUserId) : null;
    const parentAgent = agent?.parentAgentCrmUserId
      ? await repository.getAgentByCrmUserId(agent.parentAgentCrmUserId)
      : null;
    const settings = await repository.getSettings();
    const commissionRows = calculateStandardCommissions({
      amountRmb: localRecord.commissionBaseRmb,
      orderKind,
      customerCrmUserId: crmUserId,
      relationship,
      agent,
      parentAgent,
      sourceType: "account_event",
      sourceId: localRecord.id,
      settings
    });
    if (commissionRows.length > 0) {
      const commissions = await repository.insertCommissionRecords(commissionRows);
      await recordCommissionFreezeLedgerRows({
        repository,
        commissions,
        sourceEventId: localRecord.id,
        operatorCrmUserId
      });
    }
    await recordPaidEventEffectiveCustomerCandidate({
      repository,
      event: {
        ...localRecord,
        completedAt: formatMysqlTimestamp()
      }
    });
  }

  if (isPaid && localRecord.discountAmountRmb > 0 && crmUser && !crmUser.firstTopupDiscountUsedAt) {
    await repository.markFirstTopupDiscountUsed(crmUser.id, formatMysqlTimestamp());
  }

  if (isSignupTrialGrant) {
    await repository.markSignupTrialGrantStatus(crmUserId, signupTrialGrantStatuses.granted);
  }

  await repository.insertAuditLog({
    operatorCrmUserId,
    targetType: "account_event",
    targetId: localRecord.id,
    action: auditAction,
    reason,
    before: currentProfile,
    after: profile
  });

  const record = await repository.completeAccountEvent(localRecord.id, {
    quotaDelta: localRecord.quotaDelta,
    newApiResult: localRecord.newApiResult
  });

  return {
    record,
    profile
  };
}

async function applyAccountEventLocalEffects({
  repository,
  localRecord,
  operatorCrmUserId,
  reason,
  auditAction
}: {
  repository: CrmRepository;
  localRecord: AccountEventRecord;
  operatorCrmUserId: number;
  reason: string;
  auditAction: string;
}) {
  return repository.withTransaction((transactionRepository) => applyAccountEventLocalEffectsWithinTransaction({
    repository: transactionRepository,
    localRecord,
    operatorCrmUserId,
    reason,
    auditAction
  }));
}

export async function createAccountEvent({
  repository,
  newApiClient,
  config,
  quotaDeltaOverride,
  input
}: {
  repository: CrmRepository;
  newApiClient: Pick<NewApiClient, "manageUserQuota">;
  config: Pick<CrmConfig, "quotaPerRmb">;
  quotaDeltaOverride?: number;
  input: Partial<Omit<AccountEventInput, "operatorCrmUserId" | "quotaDelta">> & { operatorCrmUserId?: number };
}) {
  const eventType = requireEventType(input.eventType);
  const crmUserId = requirePositiveInteger(input.crmUserId, "crmUserId");
  const operatorCrmUserId = requirePositiveInteger(input.operatorCrmUserId, "operatorCrmUserId");
  const amountRmb = requireAmount(input.amountRmb, eventType);
  const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
  const reason = requireText(input.reason, "reason");
  const quotaDelta = quotaDeltaOverride === undefined
    ? convertSignedRmbToNewApiQuota(amountRmb, config.quotaPerRmb)
    : quotaDeltaOverride;
  if (!Number.isSafeInteger(quotaDelta) || quotaDelta === 0) {
    throw httpError("quota delta is invalid", 400, "invalid_request");
  }
  const currentProfile = await repository.getUserProfile(crmUserId);
  const crmUser = await repository.getCrmUserById(crmUserId);
  if (!crmUser || !crmUser.newApiUserId) {
    throw httpError("CRM user was not found", 404, "crm_user_not_found");
  }
  let event = await repository.findAccountEventByIdempotencyKey(idempotencyKey);
  if (event?.status === accountEventStatuses.completed) {
    if (!isSameCompletedIdempotencyRequest(event, {
      eventType,
      crmUserId,
      operatorCrmUserId,
      amountRmb,
      quotaDelta
    })) {
      throw httpError("idempotency key payload mismatch", 409, "idempotency_payload_mismatch");
    }
    return {
      created: false,
      record: event,
      profile: await repository.getUserProfile(crmUserId)
    };
  }
  const paidAmounts = resolvePaidAmounts({
    eventType,
    amountRmb,
    currentPaidRmb: Number(currentProfile.cumulativePaidRmb || 0),
    crmUser,
    requestedPaidAmountRmb: input.paidAmountRmb
  });
  const eventInput: AccountEventInput = {
    eventType,
    crmUserId,
    operatorCrmUserId,
    amountRmb,
    paidAmountRmb: paidAmounts.paidAmountRmb,
    discountAmountRmb: paidAmounts.discountAmountRmb,
    commissionBaseRmb: paidAmounts.commissionBaseRmb,
    quotaDelta,
    idempotencyKey,
    reason,
    metadata: input.metadata
  };
  let wasCreated = false;
  if (!event) {
    try {
      event = await repository.createAccountEvent(eventInput);
      wasCreated = true;
    } catch (error) {
      if (storageErrorCode(error) !== "ER_DUP_ENTRY") throw error;
      event = await repository.findAccountEventByIdempotencyKey(idempotencyKey);
      if (!event) throw error;
    }
  }

  if (!isSameIdempotencyPayload(event, eventInput)) {
    throw httpError("idempotency key payload mismatch", 409, "idempotency_payload_mismatch");
  }
  if (event.status === accountEventStatuses.completed) {
    return {
      created: false,
      record: event,
      profile: await repository.getUserProfile(crmUserId)
    };
  }
  if (
    event.status === accountEventStatuses.quotaApplying ||
    event.status === accountEventStatuses.localApplying ||
    event.status === accountEventStatuses.reconcileRequired
  ) {
    throwReconcileRequired(event.status);
  }

  let quotaRecord = event;
  if (event.status === accountEventStatuses.pending) {
    const quotaApplyingRecord = await repository.markAccountEventQuotaApplying(event.id);
    if (!didStorageMutate(quotaApplyingRecord)) {
      throwReconcileRequired(quotaApplyingRecord.status);
    }
    try {
      const newApiResult = await newApiClient.manageUserQuota(buildQuotaPayload(crmUser.newApiUserId, quotaDelta));
      quotaRecord = await repository.markAccountEventQuotaApplied(quotaApplyingRecord.id, { newApiResult });
    } catch (error) {
      await repository.markAccountEventReconcileRequired(quotaApplyingRecord.id, error instanceof Error ? error.message : "new-api quota failed");
      throw error;
    }
  }

  if (quotaRecord.status !== accountEventStatuses.quotaApplied) {
    throwReconcileRequired(quotaRecord.status);
  }

  const localRecord = await repository.markAccountEventLocalApplying(quotaRecord.id);
  if (!didStorageMutate(localRecord) || localRecord.status !== accountEventStatuses.localApplying) {
    throwReconcileRequired(localRecord.status);
  }

  let applied;
  try {
    applied = await applyAccountEventLocalEffects({
      repository,
      localRecord,
      operatorCrmUserId,
      reason,
      auditAction: "account_event.create"
    });
  } catch (error) {
    await repository.markAccountEventReconcileRequired(
      localRecord.id,
      error instanceof Error ? error.message : "CRM local effects failed"
    );
    throw error;
  }

  return {
    created: wasCreated,
    ...applied
  };
}

export async function reconcileAccountEventLocalEffects({
  repository,
  accountEventId,
  operatorCrmUserId,
  reason
}: {
  repository: CrmRepository;
  accountEventId: number;
  operatorCrmUserId: number;
  reason: string;
}) {
  const event = await repository.getAccountEventById(accountEventId);
  if (!event) {
    throw httpError("account event was not found", 404, "not_found");
  }
  const confirmableStatuses = new Set<AccountEventStatus>([
    accountEventStatuses.quotaApplying,
    accountEventStatuses.quotaApplied,
    accountEventStatuses.reconcileRequired,
    accountEventStatuses.localApplying
  ]);
  if (!confirmableStatuses.has(event.status)) {
    throw httpError("account event status is invalid", 409, "account_event_status_invalid");
  }

  let quotaRecord = event;
  if (
    event.status === accountEventStatuses.quotaApplying ||
    event.status === accountEventStatuses.reconcileRequired
  ) {
    quotaRecord = await repository.markAccountEventQuotaApplied(event.id, {
      newApiResult: event.newApiResult ?? { manuallyConfirmed: true, reason }
    });
    if (!didStorageMutate(quotaRecord) || quotaRecord.status !== accountEventStatuses.quotaApplied) {
      throw httpError("account event status is invalid", 409, "account_event_status_invalid");
    }
  }

  let localRecord = quotaRecord;
  if (quotaRecord.status === accountEventStatuses.quotaApplied) {
    localRecord = await repository.markAccountEventLocalApplying(quotaRecord.id);
    if (!didStorageMutate(localRecord) || localRecord.status !== accountEventStatuses.localApplying) {
      throw httpError("account event status is invalid", 409, "account_event_status_invalid");
    }
  }
  return applyAccountEventLocalEffects({
    repository,
    localRecord,
    operatorCrmUserId,
    reason,
    auditAction: "account_event.reconcile_complete"
  });
}

export async function cancelReconcileAccountEvent({
  repository,
  accountEventId,
  operatorCrmUserId,
  reason
}: {
  repository: CrmRepository;
  accountEventId: number;
  operatorCrmUserId: number;
  reason: string;
}) {
  const event = await repository.getAccountEventById(accountEventId);
  if (!event) {
    throw httpError("account event was not found", 404, "not_found");
  }
  const cancellableStatuses = new Set<AccountEventStatus>([
    accountEventStatuses.pending,
    accountEventStatuses.quotaApplying,
    accountEventStatuses.reconcileRequired
  ]);
  if (!cancellableStatuses.has(event.status)) {
    throw httpError("account event status is invalid", 409, "account_event_status_invalid");
  }
  if (event.newApiResult !== null && event.newApiResult !== undefined) {
    throw httpError("account event quota application is already proven", 409, "account_event_cancel_not_allowed");
  }
  const record = await repository.cancelAccountEvent(accountEventId, reason);
  if (!didStorageMutate(record) || record.status !== accountEventStatuses.cancelled) {
    throw httpError("account event status is invalid", 409, "account_event_status_invalid");
  }
  const profile = await repository.getUserProfile(event.crmUserId);
  await repository.insertAuditLog({
    operatorCrmUserId,
    targetType: "account_event",
    targetId: accountEventId,
    action: "account_event.reconcile_cancel",
    reason,
    before: event,
    after: record
  });
  return {
    record,
    profile
  };
}

export async function refundAccountEvent({
  repository,
  newApiClient,
  accountEventId,
  operatorCrmUserId,
  reason
}: {
  repository: CrmRepository;
  newApiClient: Pick<NewApiClient, "manageUserQuota">;
  accountEventId: number;
  operatorCrmUserId: number;
  reason: string;
}) {
  const event = await repository.getAccountEventById(accountEventId);
  if (!event) {
    throw httpError("account event was not found", 404, "not_found");
  }
  if (event.status !== accountEventStatuses.completed || !paidEventTypes.has(event.eventType)) {
    throw httpError("account event cannot be refunded", 409, "account_event_refund_not_allowed");
  }

  const idempotencyKey = accountEventRefundIdempotencyKey(event.id);
  const existingRefund = await repository.findAccountEventByIdempotencyKey(idempotencyKey);
  if (existingRefund?.status === accountEventStatuses.completed) {
    throw httpError("account event was already refunded", 409, "account_event_already_refunded");
  }
  const result = await createAccountEvent({
    repository,
    newApiClient,
    config: { quotaPerRmb: 1 },
    quotaDeltaOverride: -Math.abs(event.quotaDelta),
    input: {
      eventType: accountEventTypes.refund,
      crmUserId: event.crmUserId,
      operatorCrmUserId,
      amountRmb: -Math.abs(event.amountRmb),
      idempotencyKey,
      reason,
      metadata: { sourceAccountEventId: event.id }
    }
  });
  return {
    ...result,
    record: event,
    refundRecord: result.record
  };
}
