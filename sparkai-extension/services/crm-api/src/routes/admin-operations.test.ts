import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import {
  accountEventTypes,
  commissionStatuses,
  defaultCrmSettings,
  enterpriseMonthlySettlementStatuses,
  ledgerDirections,
  ledgerEventTypes,
  withdrawalMethods,
  withdrawalStatuses
} from "@ai-native/crm-contracts";
import { createMemoryRepository } from "../test-helpers/repository.js";
import type { CrmRepository } from "../types.js";
import { createAccountEventRoute } from "./account-events.js";
import { matchCommissionAction, updateCommissionStatusRoute } from "./commissions.js";
import { updateEnterpriseMonthlySettlementRoute } from "./enterprise-settlements.js";
import { createRiskCaseRoute, updateRiskCaseRoute } from "./risk-cases.js";
import { updateSettingsRoute } from "./settings.js";
import { updateWithdrawalRoute } from "./withdrawals.js";

const payout = {
  payoutMethod: withdrawalMethods.alipay,
  payoutAccountName: "张三",
  payoutAccount: "zhangsan@example.com",
  payoutBankName: ""
} as const;

function request(body: Record<string, unknown>): IncomingMessage {
  const req = Readable.from([JSON.stringify(body)]) as Readable & {
    headers: Record<string, string>;
  };
  req.headers = {
    authorization: "Bearer secret"
  };
  return req as unknown as IncomingMessage;
}

async function seedReleasableCommission(
  repository: CrmRepository,
  beneficiaryCrmUserId: number,
  amountRmb: number
) {
  const [commission] = await repository.insertCommissionRecords([{
    sourceType: "seed",
    sourceId: beneficiaryCrmUserId * 1000 + amountRmb,
    beneficiaryCrmUserId,
    customerCrmUserId: beneficiaryCrmUserId + 100,
    commissionType: "agent_direct_commission",
    orderKind: "first_order",
    agentLevel: "standard",
    baseAmountRmb: amountRmb,
    rate: 1,
    amountRmb
  }]);
  await repository.updateCommissionStatus(
    commission.id || 0,
    commissionStatuses.releasable,
    1,
    "test release"
  );
}

test("createAccountEventRoute uses unified account events instead of admin topup terminology", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({ username: "customer", newApiUserId: 3001 });
  const result = await createAccountEventRoute({
    req: request({
      eventType: accountEventTypes.adminPaidTopup,
      crmUserId: crmUser.id,
      amountRmb: 29.9,
      idempotencyKey: "route-event-1",
      reason: "offline paid"
    }),
    repository,
    newApiClient: {
      async manageUserQuota() {
        return { ok: true };
      }
    },
    operatorCrmUserId: 1,
    config: {
      port: 17861,
      host: "127.0.0.1",
      databaseUrl: "",
      databaseName: "ai_native_crm",
      newApiBaseUrl: "http://127.0.0.1:17860",
      newApiAdminUserId: 0,
      newApiAdminAccessToken: "",
      quotaPerRmb: 500000,
      crmEmbedTrustSecret: "test-embed-secret",
      corsAllowedOrigins: ["*"],
      effectiveCustomerMaintenanceIntervalMinutes: 0,
      usageSyncMaintenanceIntervalMinutes: 0,
      enterpriseMonthlySettlementIntervalMinutes: 0,
      attachmentStorageDir: "data/attachments",
      attachmentMaxBytes: 5 * 1024 * 1024
    }
  });

  assert.equal(result.record.eventType, accountEventTypes.adminPaidTopup);
  assert.equal((await repository.listAccountEvents()).items.length, 1);
});

test("createAccountEventRoute generates idempotency keys for manual admin events", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({ username: "customer", newApiUserId: 3001 });
  const result = await createAccountEventRoute({
    req: request({
      eventType: accountEventTypes.adminPaidTopup,
      crmUserId: crmUser.id,
      amountRmb: 10,
      reason: "offline paid"
    }),
    repository,
    newApiClient: {
      async manageUserQuota() {
        return { ok: true };
      }
    },
    operatorCrmUserId: 1,
    config: {
      port: 17861,
      host: "127.0.0.1",
      databaseUrl: "",
      databaseName: "ai_native_crm",
      newApiBaseUrl: "http://127.0.0.1:17860",
      newApiAdminUserId: 0,
      newApiAdminAccessToken: "",
      quotaPerRmb: 500000,
      crmEmbedTrustSecret: "test-embed-secret",
      corsAllowedOrigins: ["*"],
      effectiveCustomerMaintenanceIntervalMinutes: 0,
      usageSyncMaintenanceIntervalMinutes: 0,
      enterpriseMonthlySettlementIntervalMinutes: 0,
      attachmentStorageDir: "data/attachments",
      attachmentMaxBytes: 5 * 1024 * 1024
    }
  });

  assert.match(result.record.idempotencyKey, /^manual-account-event:/);
});

test("commission release action makes frozen commissions withdrawable", () => {
  const action = matchCommissionAction("/crm/admin/commissions/12/release");

  assert.equal(action?.commissionId, 12);
  assert.equal(action?.status, commissionStatuses.releasable);
});

test("updateCommissionStatusRoute refuses release when commission has blocking risk", async () => {
  const repository = createMemoryRepository();
  const user = await repository.createCrmUser({ username: "agent", newApiUserId: 3001 });
  const [commission] = await repository.insertCommissionRecords([{
    sourceType: "seed",
    sourceId: 1,
    beneficiaryCrmUserId: user.id,
    customerCrmUserId: user.id,
    commissionType: "agent_direct_commission",
    orderKind: "first_order",
    agentLevel: "standard",
    baseAmountRmb: 100,
    rate: 0.45,
    amountRmb: 45
  }]);
  await repository.createRiskCase({
    targetType: "commission",
    targetId: String(commission.id),
    riskType: "异常订单",
    notes: "复核前不能释放",
    blocksWithdrawal: false,
    blocksCommissionRelease: true,
    createdByCrmUserId: 1
  });

  await assert.rejects(
    () => updateCommissionStatusRoute({
      repository,
      commissionId: commission.id || 0,
      status: commissionStatuses.releasable,
      operatorCrmUserId: 1,
      reason: "release"
    }),
    (error: unknown) => (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "commission_release_risk_blocked"
    )
  );
});

test("updateCommissionStatusRoute writes commission release and clawback ledger rows", async () => {
  const repository = createMemoryRepository();
  const originalWithTransaction = repository.withTransaction.bind(repository);
  let transactionCalls = 0;
  repository.withTransaction = async (work) => {
    transactionCalls += 1;
    return originalWithTransaction(work);
  };
  const user = await repository.createCrmUser({ username: "ledger-agent", newApiUserId: 3001 });
  const [commission] = await repository.insertCommissionRecords([{
    sourceType: "seed",
    sourceId: 1,
    beneficiaryCrmUserId: user.id,
    customerCrmUserId: user.id,
    commissionType: "agent_direct_commission",
    orderKind: "first_order",
    agentLevel: "standard",
    baseAmountRmb: 100,
    rate: 0.45,
    amountRmb: 45
  }]);

  await updateCommissionStatusRoute({
    repository,
    commissionId: commission.id || 0,
    status: commissionStatuses.releasable,
    operatorCrmUserId: 1,
    reason: "人工释放佣金"
  });
  await updateCommissionStatusRoute({
    repository,
    commissionId: commission.id || 0,
    status: commissionStatuses.clawedBack,
    operatorCrmUserId: 1,
    reason: "异常订单追回"
  });

  const ledger = await repository.listLedger({ page: 1, pageSize: 10 });
  assert.deepEqual(ledger.items.map((entry) => [
    entry.eventType,
    entry.direction,
    entry.amountRmb,
    entry.crmUserId,
    entry.sourceType,
    entry.sourceId,
    entry.reason
  ]), [
    [ledgerEventTypes.commissionClawback, ledgerDirections.debit, 45, user.id, "commission", commission.id, "异常订单追回"],
    [ledgerEventTypes.commissionRelease, ledgerDirections.credit, 45, user.id, "commission", commission.id, "人工释放佣金"]
  ]);
  assert.equal(transactionCalls, 2);
});

test("updateWithdrawalRoute enforces pending approval before offline paid registration", async () => {
  const repository = createMemoryRepository();
  const user = await repository.createCrmUser({ username: "withdraw-user", newApiUserId: 3001 });
  await seedReleasableCommission(repository, user.id, 100);
  const withdrawal = await repository.createWithdrawal({ beneficiaryCrmUserId: user.id, amountRmb: 100, ...payout });

  await assert.rejects(
    () => updateWithdrawalRoute({
      req: request({ reviewReason: "直接登记打款", paidReference: "offline-1" }),
      repository,
      withdrawalId: withdrawal.id,
      status: "paid",
      operatorCrmUserId: 1
    }),
    (error: unknown) => (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "withdrawal_status_invalid"
    )
  );

  const approved = await updateWithdrawalRoute({
    req: request({ reviewReason: "审核通过" }),
    repository,
    withdrawalId: withdrawal.id,
    status: "approved",
    operatorCrmUserId: 1
  });
  assert.equal(approved.status, "approved");

  const paid = await updateWithdrawalRoute({
    req: request({
      reviewReason: "线下已打款",
      paidReference: "bank-20260705-1",
      paidEvidenceUrl: "https://example.com/withdrawals/bank-20260705-1.png"
    }),
    repository,
    withdrawalId: withdrawal.id,
    status: "paid",
    operatorCrmUserId: 1
  });
  assert.equal(paid.status, "paid");
  assert.equal(paid.paidReference, "bank-20260705-1");
  assert.equal(paid.paidEvidenceUrl, "https://example.com/withdrawals/bank-20260705-1.png");

  await assert.rejects(
    () => updateWithdrawalRoute({
      req: request({ reviewReason: "重复驳回" }),
      repository,
      withdrawalId: withdrawal.id,
      status: "rejected",
      operatorCrmUserId: 1
    }),
    (error: unknown) => (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "withdrawal_status_invalid"
    )
  );
});

test("concurrent withdrawal approval and rejection allow only one pending transition", async () => {
  const repository = createMemoryRepository();
  const user = await repository.createCrmUser({ username: "withdraw-review-race", newApiUserId: 3005 });
  await seedReleasableCommission(repository, user.id, 100);
  const withdrawal = await repository.createWithdrawal({ beneficiaryCrmUserId: user.id, amountRmb: 100, ...payout });
  let reads = 0;
  let releaseReads!: () => void;
  const bothRead = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  const concurrentRepository: CrmRepository = {
    ...repository,
    async getWithdrawalById(id) {
      const current = await repository.getWithdrawalById(id);
      reads += 1;
      if (reads === 2) releaseReads();
      await bothRead;
      return current;
    }
  };

  const results = await Promise.allSettled([
    updateWithdrawalRoute({
      req: request({ reviewReason: "approve race" }),
      repository: concurrentRepository,
      withdrawalId: withdrawal.id,
      status: withdrawalStatuses.approved,
      operatorCrmUserId: 1
    }),
    updateWithdrawalRoute({
      req: request({ reviewReason: "reject race" }),
      repository: concurrentRepository,
      withdrawalId: withdrawal.id,
      status: withdrawalStatuses.rejected,
      operatorCrmUserId: 1
    })
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejectedResult = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejectedResult.reason?.code, "withdrawal_status_invalid");
  assert.ok([
    withdrawalStatuses.approved,
    withdrawalStatuses.rejected
  ].includes((await repository.getWithdrawalById(withdrawal.id))?.status as typeof withdrawalStatuses.approved));
  assert.equal((await repository.listAuditLogs({ targetType: "withdrawal", page: 1, pageSize: 10 })).total, 1);
});

test("concurrent enterprise settlement payment and cancellation allow only one pending transition", async () => {
  const repository = createMemoryRepository();
  const user = await repository.createCrmUser({ username: "settlement-review-race", newApiUserId: 3006 });
  const { settlement } = await repository.saveEnterpriseMonthlySettlement({
    crmUserId: user.id,
    period: "2026-06",
    usageRmb: 88,
    ledgerEntryCount: 4,
    notes: "race seed"
  });
  let reads = 0;
  let releaseReads!: () => void;
  const bothRead = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  const concurrentRepository: CrmRepository = {
    ...repository,
    async getEnterpriseMonthlySettlementById(id) {
      const current = await repository.getEnterpriseMonthlySettlementById(id);
      reads += 1;
      if (reads === 2) releaseReads();
      await bothRead;
      return current;
    }
  };

  const results = await Promise.allSettled([
    updateEnterpriseMonthlySettlementRoute({
      req: request({ paidReference: "settlement-paid", notes: "paid race" }),
      repository: concurrentRepository,
      settlementId: settlement.id,
      status: enterpriseMonthlySettlementStatuses.paid,
      operatorCrmUserId: 1
    }),
    updateEnterpriseMonthlySettlementRoute({
      req: request({ notes: "cancel race" }),
      repository: concurrentRepository,
      settlementId: settlement.id,
      status: enterpriseMonthlySettlementStatuses.cancelled,
      operatorCrmUserId: 1
    })
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejectedResult = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejectedResult.reason?.code, "enterprise_monthly_settlement_status_invalid");
  assert.ok([
    enterpriseMonthlySettlementStatuses.paid,
    enterpriseMonthlySettlementStatuses.cancelled
  ].includes((await repository.getEnterpriseMonthlySettlementById(settlement.id))?.status as typeof enterpriseMonthlySettlementStatuses.paid));
  assert.equal((await repository.listAuditLogs({ targetType: "enterprise_monthly_settlement", page: 1, pageSize: 10 })).total, 1);
});

test("updateWithdrawalRoute writes a commission withdrawal ledger row when offline payment is registered", async () => {
  const repository = createMemoryRepository();
  const user = await repository.createCrmUser({ username: "withdraw-ledger-user", newApiUserId: 3001 });
  await seedReleasableCommission(repository, user.id, 120);
  const withdrawal = await repository.createWithdrawal({ beneficiaryCrmUserId: user.id, amountRmb: 120, ...payout });

  await updateWithdrawalRoute({
    req: request({ reviewReason: "审核通过" }),
    repository,
    withdrawalId: withdrawal.id,
    status: "approved",
    operatorCrmUserId: 1
  });
  await updateWithdrawalRoute({
    req: request({ reviewReason: "线下已打款", paidReference: "bank-20260705-2" }),
    repository,
    withdrawalId: withdrawal.id,
    status: "paid",
    operatorCrmUserId: 1
  });

  const ledger = await repository.listLedger({ page: 1, pageSize: 10 });
  assert.deepEqual(ledger.items.map((entry) => [
    entry.eventType,
    entry.direction,
    entry.amountRmb,
    entry.crmUserId,
    entry.sourceType,
    entry.sourceId,
    entry.reason
  ]), [
    [ledgerEventTypes.commissionWithdrawal, ledgerDirections.debit, 120, user.id, "withdrawal", withdrawal.id, "线下已打款"]
  ]);
  assert.equal(ledger.items[0]?.idempotencyKey, `commission-withdrawal:${withdrawal.id}:paid`);
});

test("paid withdrawals allocate releasable commissions in FIFO order", async () => {
  const repository = createMemoryRepository();
  const user = await repository.createCrmUser({ username: "allocation-agent", newApiUserId: 3101 });
  const [first, second] = await repository.insertCommissionRecords([
    {
      sourceType: "seed",
      sourceId: 1,
      beneficiaryCrmUserId: user.id,
      customerCrmUserId: user.id + 10,
      commissionType: "agent_direct_commission",
      orderKind: "first_order",
      agentLevel: "standard",
      baseAmountRmb: 50,
      rate: 1,
      amountRmb: 50
    },
    {
      sourceType: "seed",
      sourceId: 2,
      beneficiaryCrmUserId: user.id,
      customerCrmUserId: user.id + 11,
      commissionType: "agent_direct_commission",
      orderKind: "first_order",
      agentLevel: "standard",
      baseAmountRmb: 80,
      rate: 1,
      amountRmb: 80
    }
  ]);
  await repository.updateCommissionStatus(first.id || 0, commissionStatuses.releasable, 1, "release first");
  await repository.updateCommissionStatus(second.id || 0, commissionStatuses.releasable, 1, "release second");
  const withdrawal = await repository.createWithdrawal({ beneficiaryCrmUserId: user.id, amountRmb: 90, ...payout });
  await updateWithdrawalRoute({
    req: request({ reviewReason: "审核通过" }),
    repository,
    withdrawalId: withdrawal.id,
    status: "approved",
    operatorCrmUserId: 1
  });
  await updateWithdrawalRoute({
    req: request({ reviewReason: "线下已打款", paidReference: "fifo-paid-1" }),
    repository,
    withdrawalId: withdrawal.id,
    status: "paid",
    operatorCrmUserId: 1
  });

  const commissions = (await repository.listCommissions({ beneficiaryCrmUserId: user.id, page: 1, pageSize: 10 })).items;
  const storedFirst = commissions.find((commission) => commission.id === first.id);
  const storedSecond = commissions.find((commission) => commission.id === second.id);
  assert.equal(storedFirst?.releasedAmountRmb, 50);
  assert.equal(storedFirst?.status, commissionStatuses.released);
  assert.equal(storedSecond?.releasedAmountRmb, 40);
  assert.equal(storedSecond?.status, commissionStatuses.releasable);
  assert.deepEqual(await repository.getCommissionSummary(user.id), {
    frozenCommissionRmb: 0,
    releasableCommissionRmb: 40,
    releasedCommissionRmb: 90
  });
});

test("commission transitions reject releasing a blocked commission", async () => {
  const repository = createMemoryRepository();
  const user = await repository.createCrmUser({ username: "blocked-agent", newApiUserId: 3102 });
  const [commission] = await repository.insertCommissionRecords([{
    sourceType: "seed",
    sourceId: 1,
    beneficiaryCrmUserId: user.id,
    customerCrmUserId: user.id + 10,
    commissionType: "agent_direct_commission",
    orderKind: "first_order",
    agentLevel: "standard",
    baseAmountRmb: 50,
    rate: 1,
    amountRmb: 50
  }]);
  await updateCommissionStatusRoute({
    repository,
    commissionId: commission.id || 0,
    status: commissionStatuses.blocked,
    operatorCrmUserId: 1,
    reason: "block"
  });

  await assert.rejects(
    () => updateCommissionStatusRoute({
      repository,
      commissionId: commission.id || 0,
      status: commissionStatuses.releasable,
      operatorCrmUserId: 1,
      reason: "invalid release"
    }),
    (error: unknown) => (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "commission_status_invalid"
    )
  );
});

test("createRiskCaseRoute marks user profiles as risky for user risk cases", async () => {
  const repository = createMemoryRepository();
  const user = await repository.createCrmUser({ username: "risky-user", newApiUserId: 3001 });

  await createRiskCaseRoute({
    req: request({
      targetType: "user",
      targetId: String(user.id),
      riskType: "异常注册",
      notes: "触发风控",
      blocksWithdrawal: true,
      blocksCommissionRelease: true
    }),
    repository,
    operatorCrmUserId: 1
  });

  const profile = await repository.getUserProfile(user.id);
  assert.equal(profile.isRisk, true);
});

test("createRiskCaseRoute rejects unknown risk target types", async () => {
  const repository = createMemoryRepository();

  await assert.rejects(
    () =>
      createRiskCaseRoute({
        req: request({
          targetType: "seed_internal_case",
          targetId: "1",
          riskType: "异常注册",
          notes: "非法对象类型",
          blocksWithdrawal: true,
          blocksCommissionRelease: true
        }),
        repository,
        operatorCrmUserId: 1
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "invalid_request");
      return true;
    }
  );
});

test("updateRiskCaseRoute clears user risk profile after user risk case is resolved", async () => {
  const repository = createMemoryRepository();
  const user = await repository.createCrmUser({ username: "resolved-risk-user", newApiUserId: 3002 });
  const riskCase = await createRiskCaseRoute({
    req: request({
      targetType: "user",
      targetId: String(user.id),
      riskType: "异常注册",
      notes: "触发风控",
      blocksWithdrawal: true,
      blocksCommissionRelease: true
    }),
    repository,
    operatorCrmUserId: 1
  });

  await updateRiskCaseRoute({
    req: request({
      status: "resolved",
      notes: "复核通过"
    }),
    repository,
    riskCaseId: riskCase.id,
    operatorCrmUserId: 1
  });

  const profile = await repository.getUserProfile(user.id);
  assert.equal(profile.isRisk, false);
});

test("updateSettingsRoute rejects commission settings above platform caps", async () => {
  const repository = createMemoryRepository();

  await assert.rejects(
    () =>
      updateSettingsRoute({
        req: request({
          ...defaultCrmSettings,
          parentAgentServiceFeeRules: { firstOrderRate: 0.2, repurchaseRate: 0.03 }
        }),
        repository,
        operatorCrmUserId: 1
      }),
    /first-order commission settings exceed/
  );
});
