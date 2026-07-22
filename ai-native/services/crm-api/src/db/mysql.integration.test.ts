import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createConnection } from "mysql2/promise";
import {
  accountEventStatuses,
  accountEventTypes,
  commissionStatuses,
  ledgerDirections,
  ledgerEventTypes,
  withdrawalMethods
} from "@ai-native/crm-contracts";
import { runMigrations } from "./migrations.js";
import { createMysqlRepository } from "./mysql.js";
import type { CrmConfig, CrmRepository } from "../types.js";

const configuredDatabaseUrl = process.env.CRM_TEST_DATABASE_URL || "";
const integrationEnabled = Boolean(configuredDatabaseUrl);
const databaseName = `ai_native_crm_test_${process.pid}_${Date.now()}`;
let repository: CrmRepository | null = null;

function testConfig(): CrmConfig {
  return {
    port: 17861,
    host: "127.0.0.1",
    databaseUrl: configuredDatabaseUrl,
    databaseName,
    newApiBaseUrl: "http://127.0.0.1:17860",
    newApiAdminUserId: 0,
    newApiAdminAccessToken: "",
    quotaPerRmb: 500000,
    crmEmbedTrustSecret: "integration-test-secret",
    corsAllowedOrigins: ["*"],
    effectiveCustomerMaintenanceIntervalMinutes: 0,
    usageSyncMaintenanceIntervalMinutes: 0,
    enterpriseMonthlySettlementIntervalMinutes: 0,
    attachmentStorageDir: "data/attachments",
    attachmentMaxBytes: 5 * 1024 * 1024
  };
}

function serverUrl(): string {
  const url = new URL(configuredDatabaseUrl);
  url.pathname = "/";
  url.search = "";
  return url.toString();
}

before(async () => {
  if (!integrationEnabled) return;
  assert.match(databaseName, /^ai_native_crm_test_[A-Za-z0-9_]+$/);
  await runMigrations(testConfig());
  await runMigrations(testConfig());
  repository = createMysqlRepository(testConfig());
});

after(async () => {
  if (!integrationEnabled) return;
  await repository?.close();
  const connection = await createConnection(serverUrl());
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
  } finally {
    await connection.end();
  }
});

test("MySQL migrations are repeatable and ledger transactions serialize balances", { skip: !integrationEnabled }, async () => {
  assert.ok(repository);
  const user = await repository.createCrmUser({ username: "ledger-user", newApiUserId: 91001 });

  await Promise.all([
    repository.insertLedgerEntry({
      crmUserId: user.id,
      direction: ledgerDirections.credit,
      amountRmb: 10,
      eventType: ledgerEventTypes.accountEvent,
      sourceType: "integration",
      sourceId: 1,
      idempotencyKey: "mysql-ledger-concurrent-1",
      operatorCrmUserId: user.id,
      reason: "concurrent ledger 1",
      isPaid: false
    }),
    repository.insertLedgerEntry({
      crmUserId: user.id,
      direction: ledgerDirections.credit,
      amountRmb: 15,
      eventType: ledgerEventTypes.accountEvent,
      sourceType: "integration",
      sourceId: 2,
      idempotencyKey: "mysql-ledger-concurrent-2",
      operatorCrmUserId: user.id,
      reason: "concurrent ledger 2",
      isPaid: false
    })
  ]);

  const ledger = await repository.listLedger({ crmUserId: user.id, page: 1, pageSize: 10 });
  assert.equal(ledger.total, 2);
  assert.equal(ledger.items[0].balanceAfterRmb, 25);

  await assert.rejects(
    () => repository!.withTransaction(async (transactionRepository) => {
      await transactionRepository.insertLedgerEntry({
        crmUserId: user.id,
        direction: ledgerDirections.credit,
        amountRmb: 99,
        eventType: ledgerEventTypes.accountEvent,
        sourceType: "integration",
        sourceId: 3,
        idempotencyKey: "mysql-ledger-rollback",
        operatorCrmUserId: user.id,
        reason: "forced rollback",
        isPaid: false
      });
      throw new Error("force transaction rollback");
    }),
    /force transaction rollback/
  );
  assert.equal(await repository.findLedgerEntryByIdempotencyKey("mysql-ledger-rollback"), null);

  const event = await repository.createAccountEvent({
    eventType: accountEventTypes.compensationGrant,
    crmUserId: user.id,
    operatorCrmUserId: user.id,
    amountRmb: 2,
    paidAmountRmb: 0,
    discountAmountRmb: 0,
    commissionBaseRmb: 0,
    quotaDelta: 1000000,
    idempotencyKey: "mysql-late-quota-success",
    reason: "late quota success"
  });
  await repository.markAccountEventQuotaApplying(event.id);
  await repository.cancelAccountEvent(event.id, "cancelled before response");
  const recovered = await repository.markAccountEventQuotaApplied(event.id, {
    newApiResult: { ok: true, requestId: "mysql-late-success" }
  });
  assert.equal(recovered.status, accountEventStatuses.quotaApplied);
  assert.equal(recovered.didMutate, true);
  assert.deepEqual(recovered.newApiResult, { ok: true, requestId: "mysql-late-success" });
});

test("MySQL withdrawal reservation rejects concurrent requests above available commission", { skip: !integrationEnabled }, async () => {
  assert.ok(repository);
  const user = await repository.createCrmUser({ username: "withdrawal-user", newApiUserId: 91002 });
  const [commission] = await repository.insertCommissionRecords([{
    sourceType: "integration",
    sourceId: 1,
    beneficiaryCrmUserId: user.id,
    customerCrmUserId: user.id,
    commissionType: "agent_direct_commission",
    orderKind: "first_order",
    agentLevel: "standard",
    baseAmountRmb: 250,
    rate: 1,
    amountRmb: 250
  }]);
  await repository.updateCommissionStatus(
    Number(commission.id),
    commissionStatuses.releasable,
    user.id,
    "integration release"
  );

  const input = {
    beneficiaryCrmUserId: user.id,
    amountRmb: 160,
    payoutMethod: withdrawalMethods.alipay,
    payoutAccountName: "Integration User",
    payoutAccount: "integration@example.com",
    payoutBankName: ""
  };
  const results = await Promise.allSettled([
    repository.createWithdrawalWithBalanceCheck(input),
    repository.createWithdrawalWithBalanceCheck(input)
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const failure = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(failure.reason?.code, "withdrawal_insufficient_balance");
  assert.equal((await repository.listWithdrawals({ beneficiaryCrmUserId: user.id, page: 1, pageSize: 10 })).total, 1);
});
