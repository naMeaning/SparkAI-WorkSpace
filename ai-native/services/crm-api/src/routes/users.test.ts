import test from "node:test";
import assert from "node:assert/strict";
import { agentRelationshipBindSources, signupTrialGrantStatuses } from "@ai-native/crm-contracts";
import { createMemoryRepository } from "../test-helpers/repository.js";
import { combineUserRecord, getUser, listUsers, updateUserProfile } from "./users.js";

test("combineUserRecord keeps only CRM distribution profile fields aligned with contracts", () => {
  const user = combineUserRecord(
    {
      crmUserId: 2,
      phone: "13800000000",
      wechat: "alice-wechat",
      remark: "vip",
      cumulativePaidRmb: 299,
      isEnterprise: true,
      enterprisePriceRmb: 0.1,
      enterpriseFixedCommissionPerImage: 0.02,
      isRisk: false
    },
    {
      crmUser: {
        id: 2,
        username: "alice-crm",
        email: "alice@example.com",
        newApiUserId: 1001,
        newApiRole: 1,
        firstTopupDiscountRate: null,
        firstTopupDiscountUsedAt: null,
        signupTrialGrantStatus: signupTrialGrantStatuses.granted
      },
      agent: {
        id: 1,
        crmUserId: 2,
        status: "active",
        category: "normal",
        inviteCode: "AICRMRT01",
        parentAgentId: null,
        parentAgentCrmUserId: null,
        level: "standard",
        effectivePaidCustomerCount: 0,
        levelEffectiveAt: null,
        levelExpiresAt: null,
        lastLevelEvaluatedAt: null
      }
    }
  );

  assert.equal(user.username, "alice-crm");
  assert.equal(user.email, "alice@example.com");
  assert.equal(user.remark, "vip");
  assert.equal(user.enterpriseFixedCommissionPerImage, 0.02);
  assert.equal(user.signupTrialGrantStatus, signupTrialGrantStatuses.granted);
  assert.deepEqual(Object.keys(user).sort(), [
    "agent",
    "agentRelationship",
    "createdAt",
    "crmUserId",
    "cumulativePaidRmb",
    "displayName",
    "email",
    "enterpriseFixedCommissionPerImage",
    "enterprisePriceRmb",
    "firstTopupDiscountAvailable",
    "firstTopupDiscountRate",
    "isEnterprise",
    "isRisk",
    "newApiRole",
    "phone",
    "remark",
    "signupTrialGrantStatus",
    "username",
    "wechat"
  ]);
});

test("updateUserProfile writes profile changes and audit", async () => {
  const repository = createMemoryRepository();

  const profile = await updateUserProfile({
    crmUserId: 2,
    operatorCrmUserId: 1,
    repository,
    patch: {
      phone: "13800000000",
      isEnterprise: true,
      enterpriseFixedCommissionPerImage: 0.03
    }
  });

  assert.equal(profile.phone, "13800000000");
  assert.equal(profile.isEnterprise, true);
  assert.equal((await repository.listAuditLogs()).items.length, 1);
});

test("listUsers returns default normal agents for CRM users with new-api identity mappings", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "agent-user",
    email: "",
    newApiUserId: 2001
  });

  const result = await listUsers({
    url: new URL("http://127.0.0.1/crm/admin/users?page=1&pageSize=20"),
    repository
  });

  assert.equal(result.items[0]?.agent?.crmUserId, crmUser.id);
  assert.equal(result.items[0]?.agent?.category, "normal");
  assert.equal((await repository.getAgentByCrmUserId(crmUser.id))?.category, "normal");
});

test("listUsers excludes super admin accounts from business user management", async () => {
  const repository = createMemoryRepository();
  await repository.createCrmUser({
    username: "agent-user",
    email: "",
    newApiUserId: 2001
  });

  const result = await listUsers({
    url: new URL("http://127.0.0.1/crm/admin/users?page=1&pageSize=20"),
    repository
  });

  assert.deepEqual(result.items.map((item) => item.username), ["agent-user"]);
  assert.equal(result.items.some((item) => item.crmUserId === 1), false);
});

test("listUsers filters relationship and enterprise pages before pagination", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({
    username: "agent-user",
    email: "",
    newApiUserId: 2001
  });
  const relationshipUser = await repository.createCrmUser({
    username: "relationship-user",
    email: "",
    newApiUserId: 2002
  });
  const enterpriseUser = await repository.createCrmUser({
    username: "enterprise-user",
    email: "",
    newApiUserId: 2003
  });
  await repository.saveUserProfile({
    ...(await repository.getUserProfile(enterpriseUser.id)),
    isEnterprise: true,
    enterprisePriceRmb: 0.12
  });
  await repository.saveAgent({
    crmUserId: agentUser.id,
    status: "active",
    category: "normal",
    inviteCode: "CRMAGENT01",
    parentAgentId: null,
    parentAgentCrmUserId: null,
    level: "standard",
    effectivePaidCustomerCount: 0,
    levelEffectiveAt: null,
    levelExpiresAt: null,
    lastLevelEvaluatedAt: null
  });
  await repository.saveAgentRelationship(relationshipUser.id, {
    customerCrmUserId: relationshipUser.id,
    agentCrmUserId: agentUser.id,
    bindSource: agentRelationshipBindSources.adminBind,
    status: "active",
    bindReason: "admin bind"
  });
  const relationshipPage = await listUsers({
    url: new URL("http://127.0.0.1/crm/admin/users?page=1&pageSize=20&hasAgentRelationship=true"),
    repository
  });
  const enterprisePage = await listUsers({
    url: new URL("http://127.0.0.1/crm/admin/users?page=1&pageSize=20&enterpriseOnly=true"),
    repository
  });

  assert.deepEqual(relationshipPage.items.map((item) => item.crmUserId), [relationshipUser.id]);
  assert.equal(relationshipPage.total, 1);
  assert.deepEqual(enterprisePage.items.map((item) => item.crmUserId), [enterpriseUser.id]);
  assert.equal(enterprisePage.total, 1);
});

test("getUser rejects unknown CRM users", async () => {
  const repository = createMemoryRepository();

  await assert.rejects(
    () => getUser({
      crmUserId: 404,
      repository
    }),
    /CRM user was not found/
  );
});

test("getUser returns a default normal agent profile for CRM users", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "single-user",
    email: "",
    newApiUserId: 3001
  });

  const user = await getUser({
    crmUserId: crmUser.id,
    repository
  });

  assert.equal(user.agent?.crmUserId, crmUser.id);
  assert.equal(user.agent?.category, "normal");
});

test("getUser returns CRM distribution profile fields for mapped users", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "single-user",
    email: "",
    newApiUserId: 3001
  });

  const user = await getUser({
    crmUserId: crmUser.id,
    repository
  });

  assert.equal(user.username, "single-user");
  assert.equal(user.cumulativePaidRmb, 0);
  assert.equal(user.signupTrialGrantStatus, signupTrialGrantStatuses.granted);
});
