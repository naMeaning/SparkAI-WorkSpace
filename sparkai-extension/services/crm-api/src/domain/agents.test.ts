import test from "node:test";
import assert from "node:assert/strict";
import { agentRelationshipBindSources } from "@ai-native/crm-contracts";
import { createMemoryRepository } from "../test-helpers/repository.js";
import { bindCustomerAgent, buildRandomInviteCode, buildUniqueInviteCode, createAgent, ensureAgent } from "./agents.js";

test("buildRandomInviteCode returns a random CRM invite code without exposing the CRM user ID", () => {
  const inviteCode = buildRandomInviteCode(() => "abc123xy");

  assert.equal(inviteCode, "ABC123XY");
  assert.match(inviteCode, /^[A-Z0-9]{8}$/);
  assert.notEqual(inviteCode, "AIUSER2");
});

test("buildUniqueInviteCode retries when a generated invite code is already used", async () => {
  const repository = createMemoryRepository();
  const existingUser = await repository.createCrmUser({ username: "existing", newApiUserId: 1001 });
  await repository.saveAgent({
    crmUserId: existingUser.id,
    status: "active",
    category: "normal",
    inviteCode: "EXIST111",
    parentAgentId: null,
    parentAgentCrmUserId: null,
    level: "standard",
    effectivePaidCustomerCount: 0,
    levelEffectiveAt: null,
    levelExpiresAt: null,
    lastLevelEvaluatedAt: null
  });
  const generated = ["exist111", "fresh222"];

  const inviteCode = await buildUniqueInviteCode(repository, () => generated.shift() || "unused");

  assert.equal(inviteCode, "FRESH222");
});

test("createAgent creates one agent type with an optional direct parent", async () => {
  const repository = createMemoryRepository();
  const parentUser = await repository.createCrmUser({ username: "parent", newApiUserId: 1001 });
  const childUser = await repository.createCrmUser({ username: "child", newApiUserId: 2001 });
  const parent = await createAgent({
    repository,
    input: {
      crmUserId: parentUser.id,
      operatorCrmUserId: 1,
      reason: "open parent agent"
    }
  });
  const child = await createAgent({
    repository,
    input: {
      crmUserId: childUser.id,
      parentAgentCrmUserId: parentUser.id,
      operatorCrmUserId: 1,
      reason: "open child agent"
    }
  });

  assert.match(parent.inviteCode, /^[A-Z0-9]{8}$/);
  assert.notEqual(parent.inviteCode, `AIUSER${parentUser.id.toString(36).toUpperCase()}`);
  assert.equal(child.parentAgentCrmUserId, parentUser.id);
  assert.equal(child.parentAgentId, parent.id);
  assert.equal("agentType" in child, false);
});

test("ensureAgent creates a default normal agent for a new-api mapped CRM user", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({ username: "agent", newApiUserId: 3001 });

  const agent = await ensureAgent({
    repository,
    crmUserId: crmUser.id,
    reason: "session default agent"
  });

  assert.equal(agent.crmUserId, crmUser.id);
  assert.equal(agent.category, "normal");
  assert.equal(agent.level, "standard");
  assert.match(agent.inviteCode, /^[A-Z0-9]{8}$/);
  assert.notEqual(agent.inviteCode, `AIUSER${crmUser.id.toString(36).toUpperCase()}`);
});

test("bindCustomerAgent can bind a customer by invite code through admin relationship management", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({ username: "agent", newApiUserId: 2001 });
  const customerUser = await repository.createCrmUser({ username: "customer", newApiUserId: 3001 });
  const agent = await createAgent({
    repository,
    input: {
      crmUserId: agentUser.id,
      operatorCrmUserId: 1,
      reason: "open agent"
    }
  });

  const relationship = await bindCustomerAgent({
    repository,
    input: {
      customerCrmUserId: customerUser.id,
      inviteCode: agent.inviteCode,
      bindSource: agentRelationshipBindSources.adminBind,
      operatorCrmUserId: 1,
      reason: "admin invite-code bind"
    }
  });

  assert.equal(relationship.customerCrmUserId, customerUser.id);
  assert.equal(relationship.agentCrmUserId, agentUser.id);
  assert.equal(relationship.bindSource, agentRelationshipBindSources.adminBind);
});

test("bindCustomerAgent refuses self-buy and paid customer binding without rebind approval", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({ username: "agent", newApiUserId: 2001 });
  const customerUser = await repository.createCrmUser({ username: "customer", newApiUserId: 3001 });
  const agent = await createAgent({
    repository,
    input: {
      crmUserId: agentUser.id,
      operatorCrmUserId: 1,
      reason: "open agent"
    }
  });

  await assert.rejects(
    () =>
      bindCustomerAgent({
        repository,
        input: {
          customerCrmUserId: agentUser.id,
          agentCrmUserId: agentUser.id,
          bindSource: agentRelationshipBindSources.adminBind,
          operatorCrmUserId: 1,
          reason: "self buy"
        }
      }),
    /agent cannot bind itself/
  );

  await repository.saveUserProfile({
    ...(await repository.getUserProfile(customerUser.id)),
    cumulativePaidRmb: 29.9
  });

  await assert.rejects(
    () =>
      bindCustomerAgent({
        repository,
        input: {
          customerCrmUserId: customerUser.id,
          inviteCode: agent.inviteCode,
          bindSource: agentRelationshipBindSources.adminBind,
          operatorCrmUserId: 1,
          reason: "paid bind"
        }
      }),
    /cannot bind customer relationship after first paid topup/
  );
});
