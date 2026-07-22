import test from "node:test";
import assert from "node:assert/strict";
import { crmPageCapabilities } from "@ai-native/crm-contracts";
import { createMemoryRepository } from "../test-helpers/repository.js";
import { getSessionRoute } from "./session.js";

test("getSessionRoute treats every CRM user as a normal agent with a new-api identity mapping", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "normal-agent",
    email: "",
    newApiUserId: 2002
  });

  const session = await getSessionRoute({
    context: { crmUserId: crmUser.id, newApiUserId: 2002, isSuperAdmin: false },
    repository
  });

  assert.deepEqual(session.capabilities, [crmPageCapabilities.agent]);
  assert.equal(session.agent?.crmUserId, crmUser.id);
  assert.equal(session.agent?.category, "normal");
  assert.equal((await repository.getAgentByCrmUserId(crmUser.id))?.category, "normal");
});

test("getSessionRoute exposes only platform capability for super admins", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "super-admin",
    email: "",
    newApiUserId: 1001,
    newApiRole: 100
  });

  const session = await getSessionRoute({
    context: { crmUserId: crmUser.id, newApiUserId: 1001, isSuperAdmin: true },
    repository
  });

  assert.deepEqual(session.capabilities, [crmPageCapabilities.superAdmin]);
  assert.deepEqual(session.pageGroups, [{ key: crmPageCapabilities.superAdmin, label: "平台管理" }]);
  assert.equal(session.agent, null);
  assert.equal((await repository.getAgentByCrmUserId(crmUser.id)), null);
});

test("getSessionRoute returns current CRM session fields", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "normal-agent",
    email: "",
    newApiUserId: 2002
  });

  const session = await getSessionRoute({
    context: { crmUserId: crmUser.id, newApiUserId: 2002, isSuperAdmin: false },
    repository
  });

  assert.equal(session.currentUser.crmUserId, crmUser.id);
  assert.equal(session.currentUser.username, "normal-agent");
  assert.equal(session.currentUser.signupTrialGrantStatus, "granted");
});
