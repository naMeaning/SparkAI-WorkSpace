import test from "node:test";
import assert from "node:assert/strict";
import { accountEventTypes, commissionTypes, ledgerEventTypes } from "@ai-native/crm-contracts";
import { createMemoryRepository } from "../test-helpers/repository.js";
import type { CrmRepository, NewApiClient } from "../types.js";
import { bindCustomerAgent, createAgent } from "./agents.js";
import {
  cancelReconcileAccountEvent,
  createAccountEvent,
  reconcileAccountEventLocalEffects,
  refundAccountEvent
} from "./account-events.js";

function quotaClient(calls: unknown[]): Pick<NewApiClient, "manageUserQuota"> {
  return {
    async manageUserQuota(input) {
      calls.push(input);
      return { ok: true };
    }
  };
}

test("createAccountEvent applies paid ledger, quota and two independent commission records", async () => {
  const repository = createMemoryRepository();
  const quotaCalls: unknown[] = [];
  const parentUser = await repository.createCrmUser({ username: "parent", newApiUserId: 1001 });
  const agentUser = await repository.createCrmUser({ username: "agent", newApiUserId: 2001 });
  const customerUser = await repository.createCrmUser({ username: "customer", newApiUserId: 3001 });
  await createAgent({ repository, input: { crmUserId: parentUser.id, operatorCrmUserId: 1, reason: "parent" } });
  await createAgent({
    repository,
    input: {
      crmUserId: agentUser.id,
      parentAgentCrmUserId: parentUser.id,
      operatorCrmUserId: 1,
      reason: "child"
    }
  });
  await bindCustomerAgent({
    repository,
    input: {
      customerCrmUserId: customerUser.id,
      agentCrmUserId: agentUser.id,
      allowRebind: true,
      operatorCrmUserId: 1,
      reason: "bind customer"
    }
  });

  const result = await createAccountEvent({
    repository,
    newApiClient: quotaClient(quotaCalls),
    config: { quotaPerRmb: 500000 },
    input: {
      eventType: accountEventTypes.adminPaidTopup,
      crmUserId: customerUser.id,
      operatorCrmUserId: 1,
      amountRmb: 100,
      idempotencyKey: "paid-3001-100",
      reason: "offline paid"
    }
  });

  assert.equal(result.profile.cumulativePaidRmb, 100);
  assert.deepEqual(quotaCalls, [{ newApiUserId: 3001, mode: "add", value: 50000000 }]);
  const paidLedger = (await repository.listLedger()).items.find((entry) => entry.eventType === ledgerEventTypes.accountEvent);
  assert.equal(paidLedger?.isPaid, true);
  assert.equal(paidLedger?.balanceAfterRmb, 100);

  const commissions = (await repository.listCommissions()).items;
  assert.deepEqual(commissions.map((item) => [item.beneficiaryCrmUserId, item.commissionType, item.rate, item.amountRmb]), [
    [agentUser.id, commissionTypes.agentDirectCommission, 0.45, 45],
    [parentUser.id, commissionTypes.parentAgentServiceFee, 0.1, 10]
  ]);

  const agent = await repository.getAgentByCrmUserId(agentUser.id);
  assert.ok(agent?.id);
  const candidate = await repository.getEffectiveCustomerByAgentAndCustomer(agent.id, customerUser.id);
  assert.equal(candidate?.firstPaidEventId, result.record.id);
  assert.equal(candidate?.firstPaidAmountRmb, 100);
  assert.equal(candidate?.isEffective, false);
  assert.equal(candidate?.countedForLevel, false);
});

test("createAccountEvent writes frozen commission ledger rows for paid commission records", async () => {
  const repository = createMemoryRepository();
  const quotaCalls: unknown[] = [];
  const agentUser = await repository.createCrmUser({ username: "ledger-agent", newApiUserId: 2002 });
  const customerUser = await repository.createCrmUser({ username: "ledger-customer", newApiUserId: 3002 });
  await createAgent({ repository, input: { crmUserId: agentUser.id, operatorCrmUserId: 1, reason: "agent" } });
  await bindCustomerAgent({
    repository,
    input: {
      customerCrmUserId: customerUser.id,
      agentCrmUserId: agentUser.id,
      allowRebind: true,
      operatorCrmUserId: 1,
      reason: "bind customer"
    }
  });

  const result = await createAccountEvent({
    repository,
    newApiClient: quotaClient(quotaCalls),
    config: { quotaPerRmb: 500000 },
    input: {
      eventType: accountEventTypes.adminPaidTopup,
      crmUserId: customerUser.id,
      operatorCrmUserId: 1,
      amountRmb: 100,
      idempotencyKey: "paid-commission-ledger",
      reason: "offline paid"
    }
  });

  const ledger = await repository.listLedger({ page: 1, pageSize: 10 });
  const commissionFreezeRows = ledger.items.filter((entry) => entry.eventType === ledgerEventTypes.commissionFreeze);
  assert.deepEqual(commissionFreezeRows.map((entry) => [
    entry.crmUserId,
    entry.direction,
    entry.amountRmb,
    entry.sourceType,
    entry.reason
  ]), [
    [agentUser.id, "credit", 45, "commission", "佣金冻结"]
  ]);
  assert.equal(commissionFreezeRows[0]?.idempotencyKey, `commission-freeze:${result.record.id}:${agentUser.id}:agent_direct_commission`);
});

test("createAccountEvent returns completed records for duplicate idempotency keys without reapplying quota", async () => {
  const repository = createMemoryRepository();
  const quotaCalls: unknown[] = [];
  const customerUser = await repository.createCrmUser({ username: "customer-dup", newApiUserId: 3001 });
  const input = {
    eventType: accountEventTypes.adminPaidTopup,
    crmUserId: customerUser.id,
    operatorCrmUserId: 1,
    amountRmb: 29.9,
    idempotencyKey: "paid-3001-29",
    reason: "offline paid"
  };

  await createAccountEvent({ repository, newApiClient: quotaClient(quotaCalls), config: { quotaPerRmb: 500000 }, input });
  const duplicate = await createAccountEvent({ repository, newApiClient: quotaClient(quotaCalls), config: { quotaPerRmb: 500000 }, input });

  assert.equal(duplicate.created, false);
  assert.equal(quotaCalls.length, 1);
});

test("createAccountEvent retries a completed discounted first topup without recalculating the consumed discount", async () => {
  const repository = createMemoryRepository();
  const quotaCalls: unknown[] = [];
  const customerUser = await repository.createCrmUser({
    username: "discount-duplicate",
    newApiUserId: 3010,
    firstTopupDiscountRate: 0.88
  });
  const input = {
    eventType: accountEventTypes.adminPaidTopup,
    crmUserId: customerUser.id,
    operatorCrmUserId: 1,
    amountRmb: 100,
    idempotencyKey: "paid-3010-discount-duplicate",
    reason: "discounted first topup"
  };

  const first = await createAccountEvent({
    repository,
    newApiClient: quotaClient(quotaCalls),
    config: { quotaPerRmb: 500000 },
    input
  });
  const duplicate = await createAccountEvent({
    repository,
    newApiClient: quotaClient(quotaCalls),
    config: { quotaPerRmb: 500000 },
    input: { ...input, reason: "retry after response loss" }
  });

  assert.equal(first.record.paidAmountRmb, 88);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.record.id, first.record.id);
  assert.equal(duplicate.record.paidAmountRmb, 88);
  assert.equal(quotaCalls.length, 1);
});

test("createAccountEvent applies invite first-topup discount to commission base only once", async () => {
  const repository = createMemoryRepository();
  const quotaCalls: unknown[] = [];
  const discountUser = await repository.createCrmUser({
    username: "discount-user",
    email: "",
    newApiUserId: 3001,
    firstTopupDiscountRate: 0.88
  });
  const agentUser = await repository.createCrmUser({ username: "discount-agent", newApiUserId: 2001 });
  await createAgent({ repository, input: { crmUserId: agentUser.id, operatorCrmUserId: 1, reason: "agent" } });
  await bindCustomerAgent({
    repository,
    input: {
      customerCrmUserId: discountUser.id,
      agentCrmUserId: agentUser.id,
      allowRebind: true,
      operatorCrmUserId: 1,
      reason: "bind customer"
    }
  });

  const first = await createAccountEvent({
    repository,
    newApiClient: quotaClient(quotaCalls),
    config: { quotaPerRmb: 500000 },
    input: {
      eventType: accountEventTypes.adminPaidTopup,
      crmUserId: discountUser.id,
      operatorCrmUserId: 1,
      amountRmb: 100,
      idempotencyKey: "paid-3001-discount",
      reason: "offline paid"
    }
  });
  const second = await createAccountEvent({
    repository,
    newApiClient: quotaClient(quotaCalls),
    config: { quotaPerRmb: 500000 },
    input: {
      eventType: accountEventTypes.adminPaidTopup,
      crmUserId: discountUser.id,
      operatorCrmUserId: 1,
      amountRmb: 50,
      idempotencyKey: "paid-3001-second",
      reason: "offline paid again"
    }
  });

  assert.equal(first.record.amountRmb, 100);
  assert.equal(first.record.paidAmountRmb, 88);
  assert.equal(first.record.discountAmountRmb, 12);
  assert.equal(first.record.commissionBaseRmb, 88);
  assert.equal(first.profile.cumulativePaidRmb, 88);
  assert.deepEqual(quotaCalls[0], { newApiUserId: 3001, mode: "add", value: 50000000 });

  assert.equal(second.record.paidAmountRmb, 50);
  assert.equal(second.record.discountAmountRmb, 0);
  assert.equal(second.record.commissionBaseRmb, 50);
  assert.equal(second.profile.cumulativePaidRmb, 138);

  const crmUser = await repository.getCrmUserById(discountUser.id);
  assert.notEqual(crmUser?.firstTopupDiscountUsedAt, null);
  const commissions = (await repository.listCommissions()).items;
  assert.deepEqual(commissions.map((item) => [item.commissionType, item.baseAmountRmb, item.amountRmb]), [
    [commissionTypes.agentDirectCommission, 88, 39.6],
    [commissionTypes.agentDirectCommission, 50, 6.75]
  ]);
});

test("createAccountEvent applies compensation grants to New API quota and CRM ledger without paid commission", async () => {
  const repository = createMemoryRepository();
  const quotaCalls: unknown[] = [];
  const customerUser = await repository.createCrmUser({ username: "grant-customer", newApiUserId: 3002 });

  const result = await createAccountEvent({
    repository,
    newApiClient: quotaClient(quotaCalls),
    config: { quotaPerRmb: 500000 },
    input: {
      eventType: accountEventTypes.compensationGrant,
      crmUserId: customerUser.id,
      operatorCrmUserId: 1,
      amountRmb: 12.5,
      idempotencyKey: "grant-3002-1250",
      reason: "manual compensation"
    }
  });

  assert.equal(result.profile.cumulativePaidRmb, 0);
  assert.deepEqual(quotaCalls, [{ newApiUserId: 3002, mode: "add", value: 6250000 }]);
  const ledger = (await repository.listLedger()).items[0];
  assert.equal(ledger?.isPaid, false);
  assert.equal(ledger?.balanceAfterRmb, 12.5);
  assert.equal((await repository.listCommissions()).items.length, 0);
});

test("createAccountEvent supports negative exception adjustments as ledger debits", async () => {
  const repository = createMemoryRepository();
  const quotaCalls: unknown[] = [];
  const customerUser = await repository.createCrmUser({ username: "adjust-customer", newApiUserId: 3003 });
  await repository.saveUserProfile({
    ...(await repository.getUserProfile(customerUser.id)),
    cumulativePaidRmb: 100
  });
  await repository.insertLedgerEntry({
    crmUserId: customerUser.id,
    direction: "credit",
    amountRmb: 20,
    eventType: ledgerEventTypes.accountEvent,
    sourceType: "test_setup",
    sourceId: null,
    idempotencyKey: "adjust-3003-starting-credit",
    operatorCrmUserId: 1,
    reason: "starting ledger balance",
    isPaid: false
  });

  const result = await createAccountEvent({
    repository,
    newApiClient: quotaClient(quotaCalls),
    config: { quotaPerRmb: 500000 },
    input: {
      eventType: accountEventTypes.exceptionAdjustment,
      crmUserId: customerUser.id,
      operatorCrmUserId: 1,
      amountRmb: -5,
      idempotencyKey: "adjust-3003-minus-5",
      reason: "manual debit"
    }
  });

  const ledger = (await repository.listLedger()).items[0];
  assert.equal(result.profile.cumulativePaidRmb, 100);
  assert.equal(result.record.quotaDelta, -2500000);
  assert.deepEqual(quotaCalls, [{ newApiUserId: 3003, mode: "subtract", value: 2500000 }]);
  assert.equal(ledger?.direction, "debit");
  assert.equal(ledger?.amountRmb, 5);
  assert.equal(ledger?.balanceAfterRmb, 15);
  assert.equal(ledger?.isPaid, false);
});

test("createAccountEvent applies all local effects through the repository transaction boundary", async () => {
  const baseRepository = createMemoryRepository();
  let transactionCalls = 0;
  let repository: CrmRepository;
  repository = {
    ...baseRepository,
    async withTransaction(work) {
      transactionCalls += 1;
      return work(repository);
    }
  };
  const user = await repository.createCrmUser({ username: "transaction-user", newApiUserId: 4001 });

  await createAccountEvent({
    repository,
    newApiClient: quotaClient([]),
    config: { quotaPerRmb: 500000 },
    input: {
      eventType: accountEventTypes.compensationGrant,
      crmUserId: user.id,
      operatorCrmUserId: 1,
      amountRmb: 2,
      idempotencyKey: "transaction-local-effects",
      reason: "transaction test"
    }
  });

  assert.equal(transactionCalls, 1);
});

test("reconcileAccountEventLocalEffects safely resumes local_applying events", async () => {
  const repository = createMemoryRepository();
  const user = await repository.createCrmUser({ username: "resume-user", newApiUserId: 4002 });
  const event = await repository.createAccountEvent({
    eventType: accountEventTypes.compensationGrant,
    crmUserId: user.id,
    operatorCrmUserId: 1,
    amountRmb: 2,
    paidAmountRmb: 0,
    discountAmountRmb: 0,
    commissionBaseRmb: 0,
    quotaDelta: 1000000,
    idempotencyKey: "resume-local-applying",
    reason: "resume transaction"
  });
  await repository.markAccountEventQuotaApplying(event.id);
  await repository.markAccountEventQuotaApplied(event.id, { newApiResult: { ok: true } });
  await repository.markAccountEventLocalApplying(event.id);

  const result = await reconcileAccountEventLocalEffects({
    repository,
    accountEventId: event.id,
    operatorCrmUserId: 1,
    reason: "resume local effects"
  });

  assert.equal(result.record.status, "completed");
  assert.equal((await repository.listLedger({ page: 1, pageSize: 10 })).total, 1);
});

test("a late successful quota response overrides a concurrent manual cancellation", async () => {
  const repository = createMemoryRepository();
  const user = await repository.createCrmUser({ username: "cancel-race-user", newApiUserId: 4003 });
  let notifyQuotaStarted!: () => void;
  let releaseQuota!: () => void;
  const quotaStarted = new Promise<void>((resolve) => {
    notifyQuotaStarted = resolve;
  });
  const quotaRelease = new Promise<void>((resolve) => {
    releaseQuota = resolve;
  });
  const creating = createAccountEvent({
    repository,
    newApiClient: {
      async manageUserQuota() {
        notifyQuotaStarted();
        await quotaRelease;
        return { ok: true, requestId: "late-success" };
      }
    },
    config: { quotaPerRmb: 500000 },
    input: {
      eventType: accountEventTypes.compensationGrant,
      crmUserId: user.id,
      operatorCrmUserId: 1,
      amountRmb: 3,
      idempotencyKey: "cancel-race-event",
      reason: "cancel race"
    }
  });

  await quotaStarted;
  const event = await repository.findAccountEventByIdempotencyKey("cancel-race-event");
  assert.ok(event);
  const cancelled = await cancelReconcileAccountEvent({
    repository,
    accountEventId: event.id,
    operatorCrmUserId: 1,
    reason: "incorrectly believed quota was not applied"
  });
  assert.equal(cancelled.record.status, "cancelled");
  releaseQuota();

  const completed = await creating;
  assert.equal(completed.record.status, "completed");
  assert.deepEqual(completed.record.newApiResult, { ok: true, requestId: "late-success" });
  assert.equal((await repository.listLedger({ page: 1, pageSize: 10 })).total, 1);
});

test("concurrent account event refunds subtract New API quota exactly once", async () => {
  const repository = createMemoryRepository();
  const user = await repository.createCrmUser({ username: "refund-concurrent", newApiUserId: 5001 });
  const source = await createAccountEvent({
    repository,
    newApiClient: quotaClient([]),
    config: { quotaPerRmb: 500000 },
    input: {
      eventType: accountEventTypes.adminPaidTopup,
      crmUserId: user.id,
      operatorCrmUserId: 1,
      amountRmb: 20,
      idempotencyKey: "refund-concurrent-source",
      reason: "paid source"
    }
  });
  let quotaCalls = 0;
  const refundClient = {
    async manageUserQuota() {
      quotaCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { ok: true };
    }
  };
  const input = {
    repository,
    newApiClient: refundClient,
    accountEventId: source.record.id,
    operatorCrmUserId: 1,
    reason: "concurrent refund"
  };

  const results = await Promise.allSettled([
    refundAccountEvent(input),
    refundAccountEvent(input)
  ]);

  assert.equal(quotaCalls, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(
    (await repository.listLedger({ eventType: ledgerEventTypes.refund, page: 1, pageSize: 10 })).total,
    1
  );
});
