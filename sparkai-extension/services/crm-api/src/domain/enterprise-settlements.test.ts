import test from "node:test";
import assert from "node:assert/strict";
import {
  enterpriseMonthlySettlementStatuses,
  ledgerDirections,
  ledgerEventTypes
} from "@ai-native/crm-contracts";
import { createMemoryRepository } from "../test-helpers/repository.js";
import { generateEnterpriseMonthlySettlements } from "./enterprise-settlements.js";

test("generateEnterpriseMonthlySettlements creates one pending settlement from enterprise monthly usage", async () => {
  const repository = createMemoryRepository();
  const enterpriseUser = await repository.createCrmUser({ username: "enterprise-user", newApiUserId: 3001 });
  const regularUser = await repository.createCrmUser({ username: "regular-user", newApiUserId: 3002 });
  await repository.saveUserProfile({
    ...(await repository.getUserProfile(enterpriseUser.id)),
    isEnterprise: true
  });
  await repository.insertLedgerEntry({
    crmUserId: enterpriseUser.id,
    direction: ledgerDirections.debit,
    amountRmb: 3,
    eventType: ledgerEventTypes.imageConsume,
    sourceType: "new_api_consume_log",
    sourceId: null,
    idempotencyKey: "enterprise-2026-06-a",
    operatorCrmUserId: enterpriseUser.id,
    reason: "模型消耗同步",
    isPaid: false,
    createdAt: "2026-06-05 00:00:00"
  });
  await repository.insertLedgerEntry({
    crmUserId: enterpriseUser.id,
    direction: ledgerDirections.debit,
    amountRmb: 2,
    eventType: ledgerEventTypes.imageConsume,
    sourceType: "new_api_consume_log",
    sourceId: null,
    idempotencyKey: "enterprise-2026-06-b",
    operatorCrmUserId: enterpriseUser.id,
    reason: "模型消耗同步",
    isPaid: false,
    createdAt: "2026-06-29 23:59:59"
  });
  await repository.insertLedgerEntry({
    crmUserId: enterpriseUser.id,
    direction: ledgerDirections.debit,
    amountRmb: 9,
    eventType: ledgerEventTypes.imageConsume,
    sourceType: "new_api_consume_log",
    sourceId: null,
    idempotencyKey: "enterprise-2026-07-a",
    operatorCrmUserId: enterpriseUser.id,
    reason: "模型消耗同步",
    isPaid: false,
    createdAt: "2026-07-01 00:00:00"
  });
  await repository.insertLedgerEntry({
    crmUserId: regularUser.id,
    direction: ledgerDirections.debit,
    amountRmb: 7,
    eventType: ledgerEventTypes.imageConsume,
    sourceType: "new_api_consume_log",
    sourceId: null,
    idempotencyKey: "regular-2026-06-a",
    operatorCrmUserId: regularUser.id,
    reason: "模型消耗同步",
    isPaid: false,
    createdAt: "2026-06-10 00:00:00"
  });

  const result = await generateEnterpriseMonthlySettlements({
    repository,
    newApiClient: {
      async getUser(newApiUserId: number) {
        return { id: newApiUserId, username: `newapi-${newApiUserId}` };
      },
      async listConsumeLogs() {
        return { items: [], total: 0 };
      }
    },
    quotaPerRmb: 500000,
    period: "2026-06",
    syncConsumption: false
  });
  const settlements = await repository.listEnterpriseMonthlySettlements({ page: 1, pageSize: 20 });

  assert.equal(result.customersScanned, 1);
  assert.equal(result.settlementsGenerated, 1);
  assert.equal(result.totalUsageRmb, 5);
  assert.equal(settlements.items.length, 1);
  assert.equal(settlements.items[0]?.crmUserId, enterpriseUser.id);
  assert.equal(settlements.items[0]?.crmUsername, "enterprise-user");
  assert.equal(settlements.items[0]?.period, "2026-06");
  assert.equal(settlements.items[0]?.usageRmb, 5);
  assert.equal(settlements.items[0]?.ledgerEntryCount, 2);
  assert.equal(settlements.items[0]?.status, enterpriseMonthlySettlementStatuses.pending);

  const duplicate = await generateEnterpriseMonthlySettlements({
    repository,
    newApiClient: {
      async getUser(newApiUserId: number) {
        return { id: newApiUserId, username: `newapi-${newApiUserId}` };
      },
      async listConsumeLogs() {
        return { items: [], total: 0 };
      }
    },
    quotaPerRmb: 500000,
    period: "2026-06",
    syncConsumption: false
  });
  const afterDuplicate = await repository.listEnterpriseMonthlySettlements({ page: 1, pageSize: 20 });

  assert.equal(duplicate.settlementsGenerated, 0);
  assert.equal(duplicate.settlementsSkipped, 1);
  assert.equal(afterDuplicate.items.length, 1);
});
