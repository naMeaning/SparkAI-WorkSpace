import test from "node:test";
import assert from "node:assert/strict";
import type { CrmConfig } from "../types.js";
import { ledgerDirections, ledgerEventTypes } from "@ai-native/crm-contracts";
import { createMemoryRepository } from "../test-helpers/repository.js";
import {
  buildBusinessUserScope,
  createMysqlRepositoryForExecutor,
  createRepository
} from "./mysql.js";

function config(input: Partial<CrmConfig> = {}): CrmConfig {
  return {
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
    attachmentMaxBytes: 5 * 1024 * 1024,
    ...input
  };
}

test("createRepository requires CRM_DATABASE_URL for durable CRM writes", () => {
  assert.throws(
    () => createRepository(config({ databaseUrl: "" })),
    /CRM_DATABASE_URL is required/
  );
});

test("buildBusinessUserScope excludes new-api root users", () => {
  const scope = buildBusinessUserScope({
    userAlias: "crm_user"
  });

  assert.equal(scope.joinSql, "");
  assert.deepEqual(scope.whereParts, ["crm_user.new_api_role < ?"]);
  assert.deepEqual(scope.params, [100]);
});

test("CRM repositories expose a transaction boundary", async () => {
  const repository = createMemoryRepository();

  const result = await repository.withTransaction(async (transactionRepository) => {
    assert.equal(transactionRepository, repository);
    return "committed";
  });

  assert.equal(result, "committed");
});

test("transactional ledger inserts lock the CRM user before calculating balance", async () => {
  const calls: string[] = [];
  const executor = {
    async query(sql: string) {
      calls.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("SELECT * FROM crm_ledger_entries")) return [[], []];
      if (sql.includes("SELECT id FROM crm_users")) return [[{ id: 7 }], []];
      if (sql.includes("AS balance")) return [[{ balance: 0 }], []];
      if (sql.includes("INSERT INTO crm_ledger_entries")) return [{ insertId: 11 }, []];
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
  const repository = createMysqlRepositoryForExecutor(executor as never, { transactional: true });

  await repository.insertLedgerEntry({
    crmUserId: 7,
    direction: ledgerDirections.credit,
    amountRmb: 2,
    eventType: ledgerEventTypes.signupTrialGrant,
    sourceType: "crm_signup_trial_grant",
    sourceId: 70,
    idempotencyKey: "signup-trial:7",
    operatorCrmUserId: 7,
    reason: "test",
    isPaid: false
  });

  const lockIndex = calls.findIndex((sql) => sql.includes("SELECT id FROM crm_users") && sql.includes("FOR UPDATE"));
  const idempotencyIndex = calls.findIndex((sql) => (
    sql.includes("SELECT * FROM crm_ledger_entries") && sql.includes("FOR UPDATE")
  ));
  const balanceIndex = calls.findIndex((sql) => sql.includes("AS balance"));
  const insertIndex = calls.findIndex((sql) => sql.includes("INSERT INTO crm_ledger_entries"));
  assert.ok(lockIndex >= 0);
  assert.ok(idempotencyIndex > lockIndex);
  assert.ok(balanceIndex > idempotencyIndex);
  assert.ok(insertIndex > balanceIndex);
});
