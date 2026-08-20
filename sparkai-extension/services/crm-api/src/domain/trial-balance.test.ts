import test from "node:test";
import assert from "node:assert/strict";
import { ledgerEventTypes, signupTrialGrantStatuses } from "@ai-native/crm-contracts";
import { createMemoryRepository } from "../test-helpers/repository.js";
import { grantSignupTrialBalance } from "./trial-balance.js";

test("concurrent signup trial grants call New API quota exactly once", async () => {
  const repository = createMemoryRepository();
  const user = await repository.createCrmUser({
    username: "trial-concurrent",
    newApiUserId: 7001,
    signupTrialGrantStatus: signupTrialGrantStatuses.pending
  });
  let quotaCalls = 0;
  const newApiClient = {
    async manageUserQuota() {
      quotaCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { ok: true };
    }
  };
  const input = {
    repository,
    newApiClient,
    crmUserId: user.id,
    newApiUserId: 7001,
    quotaPerRmb: 500000,
    operatorCrmUserId: user.id
  };

  const results = await Promise.allSettled([
    grantSignupTrialBalance(input),
    grantSignupTrialBalance(input)
  ]);

  assert.equal(quotaCalls, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const ledger = await repository.listLedger({
    eventType: ledgerEventTypes.signupTrialGrant,
    page: 1,
    pageSize: 10
  });
  assert.equal(ledger.total, 1);
  assert.equal(
    (await repository.getCrmUserById(user.id))?.signupTrialGrantStatus,
    signupTrialGrantStatuses.granted
  );
});
