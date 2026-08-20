import test from "node:test";
import assert from "node:assert/strict";
import { ledgerEventTypes } from "@ai-native/crm-contracts";
import { createMemoryRepository } from "../test-helpers/repository.js";
import { runUsageSyncMaintenance } from "./usage-sync-maintenance.js";

test("runUsageSyncMaintenance syncs new-api usage for CRM business users only", async () => {
  const repository = createMemoryRepository();
  await repository.createCrmUser({ username: "super-sync", newApiUserId: 1001, newApiRole: 100 });
  const crmUser = await repository.createCrmUser({ username: "customer", newApiUserId: 3001 });
  const requestedNewApiUserIds: number[] = [];

  const result = await runUsageSyncMaintenance({
    repository,
    quotaPerRmb: 500000,
    newApiClient: {
      async getUser(newApiUserId: number) {
        requestedNewApiUserIds.push(newApiUserId);
        return { id: newApiUserId, username: `newapi-${newApiUserId}` };
      },
      async listConsumeLogs() {
        return {
          items: [
            {
              id: "usage-1",
              model_name: "gpt-image-2",
              content: "image generation",
              quota: 500000,
              prompt_tokens: 10,
              completion_tokens: 0,
              created_at: 1710000000
            }
          ],
          total: 1
        };
      }
    }
  });

  const ledger = await repository.listLedger({ page: 1, pageSize: 20 });
  assert.deepEqual(requestedNewApiUserIds, [crmUser.newApiUserId]);
  assert.equal(result.usersScanned, 1);
  assert.equal(result.usersSynced, 1);
  assert.equal(result.usageLogsSynced, 1);
  assert.equal(result.syncFailures.length, 0);
  assert.equal(ledger.items.length, 1);
  assert.equal(ledger.items[0]?.crmUserId, crmUser.id);
  assert.equal(ledger.items[0]?.eventType, ledgerEventTypes.imageConsume);
  assert.equal(ledger.items[0]?.amountRmb, 1);
});
