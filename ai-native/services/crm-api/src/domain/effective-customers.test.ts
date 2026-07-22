import test from "node:test";
import assert from "node:assert/strict";
import { agentLevels, effectiveCustomerRules } from "@ai-native/crm-contracts";
import { createMemoryRepository } from "../test-helpers/repository.js";
import { createAgent } from "./agents.js";
import {
  evaluateEffectiveCustomerCandidate,
  refreshAgentLevelFromEffectiveCustomers
} from "./effective-customers.js";
import { runEffectiveCustomerMaintenance } from "./effective-customer-maintenance.js";

test("refreshAgentLevelFromEffectiveCustomers upgrades agents from counted effective customers", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({ username: "agent", newApiUserId: 2001 });
  const agent = await createAgent({ repository, input: { crmUserId: agentUser.id, operatorCrmUserId: 1, reason: "agent" } });

  for (let index = 0; index < 10; index += 1) {
    const customer = await repository.createCrmUser({ username: `customer-${index}`, newApiUserId: 3000 + index });
    await repository.saveEffectiveCustomer({
      agentId: agent.id,
      customerCrmUserId: customer.id,
      firstPaidEventId: index + 1,
      firstPaidAmountRmb: effectiveCustomerRules.minFirstPaidRmb,
      firstPaidAt: "2026-01-01 00:00:00",
      sevenDayCheckedAt: "2026-01-08 00:00:00",
      paidBalanceConsumedRate: effectiveCustomerRules.minPaidBalanceConsumedRate,
      isRefunded: false,
      isRelatedAccount: false,
      isRisk: false,
      isEffective: true,
      countedForLevel: true
    });
  }

  const refreshed = await refreshAgentLevelFromEffectiveCustomers({
    repository,
    agentCrmUserId: agentUser.id,
    evaluatedAt: "2026-01-08 00:00:00"
  });

  assert.equal(refreshed.effectivePaidCustomerCount, 10);
  assert.equal(refreshed.level, agentLevels.advanced);
  assert.equal(refreshed.levelEffectiveAt, "2026-01-08 00:00:00");
  assert.equal(refreshed.lastLevelEvaluatedAt, "2026-01-08 00:00:00");
});

test("refreshAgentLevelFromEffectiveCustomers can count only the retention window", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({ username: "retention-agent", newApiUserId: 2101 });
  const agent = await createAgent({ repository, input: { crmUserId: agentUser.id, operatorCrmUserId: 1, reason: "agent" } });

  for (let index = 0; index < 10; index += 1) {
    const customer = await repository.createCrmUser({ username: `old-customer-${index}`, newApiUserId: 3100 + index });
    await repository.saveEffectiveCustomer({
      agentId: agent.id,
      customerCrmUserId: customer.id,
      firstPaidEventId: index + 1,
      firstPaidAmountRmb: effectiveCustomerRules.minFirstPaidRmb,
      firstPaidAt: "2026-01-01 00:00:00",
      sevenDayCheckedAt: "2026-01-08 00:00:00",
      paidBalanceConsumedRate: effectiveCustomerRules.minPaidBalanceConsumedRate,
      isRefunded: false,
      isRelatedAccount: false,
      isRisk: false,
      isEffective: true,
      countedForLevel: true
    });
  }

  const refreshed = await refreshAgentLevelFromEffectiveCustomers({
    repository,
    agentCrmUserId: agentUser.id,
    evaluatedAt: "2026-05-01 00:00:00",
    firstPaidAtFrom: "2026-02-01 00:00:00"
  });

  assert.equal(refreshed.effectivePaidCustomerCount, 0);
  assert.equal(refreshed.level, agentLevels.standard);
});

test("runEffectiveCustomerMaintenance evaluates due candidates and rechecks expired agent levels", async () => {
  const repository = createMemoryRepository();
  const activeAgentUser = await repository.createCrmUser({ username: "active-agent", newApiUserId: 2201 });
  const expiredAgentUser = await repository.createCrmUser({ username: "expired-agent", newApiUserId: 2202 });
  const activeAgent = await createAgent({ repository, input: { crmUserId: activeAgentUser.id, operatorCrmUserId: 1, reason: "active" } });
  const expiredAgent = await createAgent({ repository, input: { crmUserId: expiredAgentUser.id, operatorCrmUserId: 1, reason: "expired" } });
  await repository.saveAgent({
    ...expiredAgent,
    level: agentLevels.advanced,
    effectivePaidCustomerCount: 10,
    levelEffectiveAt: "2026-01-08 00:00:00",
    levelExpiresAt: "2026-04-07 00:00:00",
    lastLevelEvaluatedAt: "2026-01-08 00:00:00"
  });

  const activeCustomer = await repository.createCrmUser({ username: "active-customer", newApiUserId: 3201 });
  await repository.saveEffectiveCustomer({
    agentId: activeAgent.id,
    customerCrmUserId: activeCustomer.id,
    firstPaidEventId: 1,
    firstPaidAmountRmb: effectiveCustomerRules.minFirstPaidRmb,
    firstPaidAt: "2026-04-20 00:00:00",
    sevenDayCheckedAt: null,
    paidBalanceConsumedRate: effectiveCustomerRules.minPaidBalanceConsumedRate,
    isRefunded: false,
    isRelatedAccount: false,
    isRisk: false,
    isEffective: false,
    countedForLevel: false
  });

  for (let index = 0; index < 10; index += 1) {
    const customer = await repository.createCrmUser({ username: `expired-old-customer-${index}`, newApiUserId: 3300 + index });
    await repository.saveEffectiveCustomer({
      agentId: expiredAgent.id,
      customerCrmUserId: customer.id,
      firstPaidEventId: index + 10,
      firstPaidAmountRmb: effectiveCustomerRules.minFirstPaidRmb,
      firstPaidAt: "2026-01-01 00:00:00",
      sevenDayCheckedAt: "2026-01-08 00:00:00",
      paidBalanceConsumedRate: effectiveCustomerRules.minPaidBalanceConsumedRate,
      isRefunded: false,
      isRelatedAccount: false,
      isRisk: false,
      isEffective: true,
      countedForLevel: true
    });
  }

  const result = await runEffectiveCustomerMaintenance({
    repository,
    newApiClient: {
      async getUser() {
        throw new Error("sync should be disabled");
      },
      async listConsumeLogs() {
        throw new Error("sync should be disabled");
      }
    },
    quotaPerRmb: 500000,
    evaluatedAt: "2026-05-01 00:00:00",
    syncConsumption: false
  });

  assert.equal(result.candidatesScanned, 11);
  assert.equal(result.candidatesEvaluated, 11);
  assert.equal(result.agentsRechecked, 1);
  assert.equal(result.agentsDowngraded, 1);
  assert.equal((await repository.getEffectiveCustomerByAgentAndCustomer(activeAgent.id, activeCustomer.id))?.countedForLevel, true);
  assert.equal((await repository.getAgentByCrmUserId(activeAgentUser.id))?.effectivePaidCustomerCount, 1);
  assert.equal((await repository.getAgentByCrmUserId(expiredAgentUser.id))?.level, agentLevels.standard);
  assert.equal((await repository.getAgentByCrmUserId(expiredAgentUser.id))?.effectivePaidCustomerCount, 0);
});

test("evaluateEffectiveCustomerCandidate counts only candidates that pass observation and consumption rules", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({ username: "agent", newApiUserId: 2001 });
  const agent = await createAgent({ repository, input: { crmUserId: agentUser.id, operatorCrmUserId: 1, reason: "agent" } });
  const customer = await repository.createCrmUser({ username: "customer", newApiUserId: 3001 });
  await repository.saveEffectiveCustomer({
    agentId: agent.id,
    customerCrmUserId: customer.id,
    firstPaidEventId: 1,
    firstPaidAmountRmb: effectiveCustomerRules.minFirstPaidRmb,
    firstPaidAt: "2026-01-01 00:00:00",
    sevenDayCheckedAt: null,
    paidBalanceConsumedRate: 0,
    isRefunded: false,
    isRelatedAccount: false,
    isRisk: false,
    isEffective: false,
    countedForLevel: false
  });

  const early = await evaluateEffectiveCustomerCandidate({
    repository,
    agentId: agent.id,
    customerCrmUserId: customer.id,
    paidBalanceConsumedRate: 1,
    evaluatedAt: "2026-01-07 23:59:59"
  });
  assert.equal(early.effectiveCustomer.isEffective, false);
  assert.equal(early.effectiveCustomer.countedForLevel, false);

  const passed = await evaluateEffectiveCustomerCandidate({
    repository,
    agentId: agent.id,
    customerCrmUserId: customer.id,
    paidBalanceConsumedRate: effectiveCustomerRules.minPaidBalanceConsumedRate,
    evaluatedAt: "2026-01-08 00:00:00"
  });

  assert.equal(passed.effectiveCustomer.isEffective, true);
  assert.equal(passed.effectiveCustomer.countedForLevel, true);
  assert.equal(passed.effectiveCustomer.sevenDayCheckedAt, "2026-01-08 00:00:00");
  assert.equal(passed.agent.effectivePaidCustomerCount, 1);
});

test("evaluateEffectiveCustomerCandidate removes counted customers when refund or risk flags appear", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({ username: "agent", newApiUserId: 2001 });
  const agent = await createAgent({ repository, input: { crmUserId: agentUser.id, operatorCrmUserId: 1, reason: "agent" } });
  const customer = await repository.createCrmUser({ username: "customer", newApiUserId: 3001 });
  await repository.saveEffectiveCustomer({
    agentId: agent.id,
    customerCrmUserId: customer.id,
    firstPaidEventId: 1,
    firstPaidAmountRmb: effectiveCustomerRules.minFirstPaidRmb,
    firstPaidAt: "2026-01-01 00:00:00",
    sevenDayCheckedAt: "2026-01-08 00:00:00",
    paidBalanceConsumedRate: 1,
    isRefunded: false,
    isRelatedAccount: false,
    isRisk: false,
    isEffective: true,
    countedForLevel: true
  });
  await refreshAgentLevelFromEffectiveCustomers({ repository, agentCrmUserId: agentUser.id, evaluatedAt: "2026-01-08 00:00:00" });

  const result = await evaluateEffectiveCustomerCandidate({
    repository,
    agentId: agent.id,
    customerCrmUserId: customer.id,
    paidBalanceConsumedRate: 1,
    isRefunded: true,
    evaluatedAt: "2026-01-09 00:00:00"
  });

  assert.equal(result.effectiveCustomer.isRefunded, true);
  assert.equal(result.effectiveCustomer.isEffective, false);
  assert.equal(result.effectiveCustomer.countedForLevel, false);
  assert.equal(result.agent.effectivePaidCustomerCount, 0);
});
