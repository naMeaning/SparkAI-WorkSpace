import test from "node:test";
import assert from "node:assert/strict";
import { agentCategories, agentLevels, commissionTypes, defaultCrmSettings, type AgentDto, type AgentRelationshipDto } from "@ai-native/crm-contracts";
import { calculateStandardCommissions, resolveAgentLevel } from "./commissions.js";

function agent(input: Partial<AgentDto> = {}): AgentDto {
  return {
    id: input.id || 1,
    crmUserId: input.crmUserId || 2001,
    status: "active",
    inviteCode: input.inviteCode || "AICOMM01X",
    parentAgentId: input.parentAgentId ?? null,
    parentAgentCrmUserId: input.parentAgentCrmUserId ?? null,
    level: input.level || agentLevels.standard,
    effectivePaidCustomerCount: input.effectivePaidCustomerCount || 0,
    levelEffectiveAt: input.levelEffectiveAt ?? null,
    levelExpiresAt: input.levelExpiresAt ?? null,
    lastLevelEvaluatedAt: input.lastLevelEvaluatedAt ?? null,
    category: input.category ?? agentCategories.normal
  };
}

function relationship(input: Partial<AgentRelationshipDto> = {}): AgentRelationshipDto {
  return {
    customerCrmUserId: input.customerCrmUserId || 3001,
    agentCrmUserId: input.agentCrmUserId || 2001,
    bindSource: "invite_code",
    status: "active",
    bindReason: "test"
  };
}

test("resolveAgentLevel uses effective paid customer thresholds", () => {
  assert.equal(resolveAgentLevel(0), "standard");
  assert.equal(resolveAgentLevel(10), "advanced");
  assert.equal(resolveAgentLevel(30), "core");
  assert.equal(resolveAgentLevel(80), "gold");
});

test("calculateStandardCommissions pays direct agent and direct parent independently", () => {
  const rows = calculateStandardCommissions({
    amountRmb: 100,
    orderKind: "first_order",
    customerCrmUserId: 3001,
    relationship: relationship(),
    agent: agent({ level: agentLevels.gold, parentAgentId: 9, parentAgentCrmUserId: 1001 }),
    parentAgent: agent({ id: 9, crmUserId: 1001 }),
    sourceType: "account_event",
    sourceId: 55
  });

  assert.deepEqual(rows.map((row) => [
    row.beneficiaryCrmUserId,
    row.commissionType,
    row.rate,
    row.amountRmb
  ]), [
    [2001, commissionTypes.agentDirectCommission, 0.6, 60],
    [1001, commissionTypes.parentAgentServiceFee, 0.1, 10]
  ]);
});

test("calculateStandardCommissions does not pay parent fee when no parent exists", () => {
  const rows = calculateStandardCommissions({
    amountRmb: 200,
    orderKind: "repurchase",
    customerCrmUserId: 3001,
    relationship: relationship(),
    agent: agent({ level: agentLevels.advanced }),
    parentAgent: null,
    sourceType: "account_event",
    sourceId: 55
  });

  assert.deepEqual(rows.map((row) => [row.commissionType, row.rate, row.amountRmb]), [
    [commissionTypes.agentDirectCommission, 0.15, 30]
  ]);
});

test("calculateStandardCommissions uses the agent category commission rule set", () => {
  const settings = {
    ...defaultCrmSettings,
    agentCommissionRuleSets: defaultCrmSettings.agentCommissionRuleSets.map((ruleSet) =>
      ruleSet.category === agentCategories.strategic
        ? {
            ...ruleSet,
            rules: ruleSet.rules.map((rule) =>
              rule.level === agentLevels.standard
                ? { ...rule, firstOrderRate: 0.58, repurchaseRate: 0.17 }
                : rule
            )
          }
        : ruleSet
    )
  };

  const rows = calculateStandardCommissions({
    amountRmb: 100,
    orderKind: "first_order",
    customerCrmUserId: 3001,
    relationship: relationship(),
    agent: agent({ category: agentCategories.strategic, level: agentLevels.standard }),
    parentAgent: agent({ id: 9, crmUserId: 1001 }),
    sourceType: "account_event",
    sourceId: 55,
    settings
  });

  assert.deepEqual(rows.map((row) => [row.commissionType, row.rate, row.amountRmb]), [
    [commissionTypes.agentDirectCommission, 0.58, 58]
  ]);
});

test("calculateStandardCommissions ignores self-buy relationships", () => {
  const rows = calculateStandardCommissions({
    amountRmb: 100,
    orderKind: "first_order",
    customerCrmUserId: 2001,
    relationship: relationship({ customerCrmUserId: 2001, agentCrmUserId: 2001 }),
    agent: agent({ crmUserId: 2001 }),
    parentAgent: agent({ crmUserId: 1001 }),
    sourceType: "account_event",
    sourceId: 55
  });

  assert.deepEqual(rows, []);
});
