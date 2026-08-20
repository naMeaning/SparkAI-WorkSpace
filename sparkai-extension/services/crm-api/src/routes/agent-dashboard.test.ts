import test from "node:test";
import assert from "node:assert/strict";
import { agentRelationshipBindSources, commissionTypes, orderKinds, withdrawalMethods } from "@ai-native/crm-contracts";
import { createAgentWithdrawalRoute, getAgentDashboardRoute, listAgentCustomersRoute } from "./agent-dashboard.js";
import { createMemoryRepository } from "../test-helpers/repository.js";
import { bindCustomerAgent, createAgent } from "../domain/agents.js";

const payout = {
  payoutMethod: withdrawalMethods.alipay,
  payoutAccountName: "张三",
  payoutAccount: "zhangsan@example.com",
  payoutBankName: ""
} as const;

test("getAgentDashboardRoute creates a default normal agent for the CRM user's new-api identity mapping", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({ username: "agent", newApiUserId: 3003 });

  const dashboard = await getAgentDashboardRoute({
    context: { crmUserId: crmUser.id, newApiUserId: 3003, isSuperAdmin: false },
    repository
  });

  assert.equal(dashboard.agent.crmUserId, crmUser.id);
  assert.equal(dashboard.agent.category, "normal");
  assert.equal(dashboard.agent.level, "standard");
  assert.equal((await repository.getAgentByCrmUserId(crmUser.id))?.inviteCode, dashboard.agent.inviteCode);
});

test("getAgentDashboardRoute reports withdrawable commission after active withdrawals", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({ username: "agent", newApiUserId: 3003 });
  const [commission] = await repository.insertCommissionRecords([{
    sourceType: "account_event",
    sourceId: 1,
    beneficiaryCrmUserId: crmUser.id,
    customerCrmUserId: crmUser.id + 10,
    commissionType: commissionTypes.agentDirectCommission,
    orderKind: orderKinds.firstOrder,
    agentLevel: "standard",
    baseAmountRmb: 120,
    rate: 1,
    amountRmb: 120
  }]);
  await repository.updateCommissionStatus(commission.id || 0, "releasable", crmUser.id, "test release");
  await repository.createWithdrawal({ beneficiaryCrmUserId: crmUser.id, amountRmb: 30, ...payout });
  const paid = await repository.createWithdrawal({ beneficiaryCrmUserId: crmUser.id, amountRmb: 20, ...payout });
  await repository.updateWithdrawal(paid.id, {
    status: "approved",
    reviewerCrmUserId: crmUser.id,
    reviewReason: "approved",
    paidReference: ""
  }, "pending");
  await repository.markWithdrawalPaidWithAllocations({
    withdrawalId: paid.id,
    operatorCrmUserId: crmUser.id,
    reviewReason: "paid",
    paidReference: "offline-1"
  });

  const dashboard = await getAgentDashboardRoute({
    context: { crmUserId: crmUser.id, newApiUserId: 3003, isSuperAdmin: false },
    repository
  });

  assert.equal(dashboard.releasableCommissionRmb, 100);
  assert.equal(dashboard.releasedCommissionRmb, 20);
  assert.equal(dashboard.pendingWithdrawalRmb, 30);
  assert.equal(dashboard.paidWithdrawalRmb, 20);
  assert.equal(dashboard.availableCommissionRmb, 70);
});

test("createAgentWithdrawalRoute prevents duplicate withdrawals against the same releasable commission", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({ username: "agent", newApiUserId: 3003 });
  const [commission] = await repository.insertCommissionRecords([{
    sourceType: "account_event",
    sourceId: 1,
    beneficiaryCrmUserId: crmUser.id,
    customerCrmUserId: crmUser.id + 10,
    commissionType: commissionTypes.agentDirectCommission,
    orderKind: orderKinds.firstOrder,
    agentLevel: "standard",
    baseAmountRmb: 250,
    rate: 1,
    amountRmb: 250
  }]);
  await repository.updateCommissionStatus(commission.id || 0, "releasable", crmUser.id, "test release");
  const context = { crmUserId: crmUser.id, newApiUserId: 3003, isSuperAdmin: false };

  const first = await createAgentWithdrawalRoute({
    context,
    repository,
    body: {
      amountRmb: 120,
      payoutMethod: withdrawalMethods.alipay,
      payoutAccountName: "张三",
      payoutAccount: "zhangsan@example.com"
    }
  });

  assert.equal(first.payoutMethod, withdrawalMethods.alipay);
  assert.equal(first.payoutAccountName, "张三");
  assert.equal(first.payoutAccount, "zhangsan@example.com");

  await assert.rejects(
    () => createAgentWithdrawalRoute({
      context,
      repository,
      body: {
        amountRmb: 140,
        payoutMethod: withdrawalMethods.alipay,
        payoutAccountName: "张三",
        payoutAccount: "zhangsan@example.com"
      }
    }),
    /releasable commission balance is insufficient/
  );

  await repository.updateWithdrawal(first.id, {
    status: "rejected",
    reviewerCrmUserId: crmUser.id,
    reviewReason: "reject test",
    paidReference: ""
  }, "pending");
  const second = await createAgentWithdrawalRoute({
    context,
    repository,
    body: {
      amountRmb: 140,
      payoutMethod: withdrawalMethods.bank,
      payoutAccountName: "张三",
      payoutAccount: "6222000000000000",
      payoutBankName: "招商银行"
    }
  });
  assert.equal(second.amountRmb, 140);
  assert.equal(second.payoutMethod, withdrawalMethods.bank);
  assert.equal(second.payoutBankName, "招商银行");
});

test("createAgentWithdrawalRoute atomically rejects concurrent withdrawals above available commission", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({ username: "agent-concurrent", newApiUserId: 3010 });
  const [commission] = await repository.insertCommissionRecords([{
    sourceType: "account_event",
    sourceId: 1,
    beneficiaryCrmUserId: crmUser.id,
    customerCrmUserId: crmUser.id + 10,
    commissionType: commissionTypes.agentDirectCommission,
    orderKind: orderKinds.firstOrder,
    agentLevel: "standard",
    baseAmountRmb: 250,
    rate: 1,
    amountRmb: 250
  }]);
  await repository.updateCommissionStatus(commission.id || 0, "releasable", crmUser.id, "test release");
  const context = { crmUserId: crmUser.id, newApiUserId: 3010, isSuperAdmin: false };
  const body = {
    amountRmb: 160,
    payoutMethod: withdrawalMethods.alipay,
    payoutAccountName: "张三",
    payoutAccount: "zhangsan@example.com"
  };

  const results = await Promise.allSettled([
    createAgentWithdrawalRoute({ context, repository, body }),
    createAgentWithdrawalRoute({ context, repository, body })
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await repository.listWithdrawals({ beneficiaryCrmUserId: crmUser.id })).total, 1);
});

test("createAgentWithdrawalRoute requires payout account information", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({ username: "agent-payout", newApiUserId: 3004 });
  const [commission] = await repository.insertCommissionRecords([{
    sourceType: "account_event",
    sourceId: 1,
    beneficiaryCrmUserId: crmUser.id,
    customerCrmUserId: crmUser.id + 10,
    commissionType: commissionTypes.agentDirectCommission,
    orderKind: orderKinds.firstOrder,
    agentLevel: "standard",
    baseAmountRmb: 250,
    rate: 1,
    amountRmb: 250
  }]);
  await repository.updateCommissionStatus(commission.id || 0, "releasable", crmUser.id, "test release");

  await assert.rejects(
    () => createAgentWithdrawalRoute({
      context: { crmUserId: crmUser.id, newApiUserId: 3004, isSuperAdmin: false },
      repository,
      body: {
        amountRmb: 120,
        payoutMethod: withdrawalMethods.alipay,
        payoutAccountName: "",
        payoutAccount: "zhangsan@example.com"
      }
    }),
    (error) => Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "invalid_request")
  );
});

test("listAgentCustomersRoute returns searchable paginated customer profiles without exposing only IDs", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({ username: "agent", newApiUserId: 2001 });
  const firstCustomer = await repository.createCrmUser({ username: "alice", newApiUserId: 3001 });
  const secondCustomer = await repository.createCrmUser({ username: "bob", newApiUserId: 3002 });
  await createAgent({ repository, input: { crmUserId: agentUser.id, operatorCrmUserId: 1, reason: "open agent" } });
  for (const customer of [firstCustomer, secondCustomer]) {
    await bindCustomerAgent({
      repository,
      input: {
        customerCrmUserId: customer.id,
        agentCrmUserId: agentUser.id,
        bindSource: agentRelationshipBindSources.adminBind,
        operatorCrmUserId: 1,
        reason: "bind customer"
      }
    });
  }

  const result = await listAgentCustomersRoute({
    context: { crmUserId: agentUser.id, newApiUserId: 2001, isSuperAdmin: false },
    repository,
    url: new URL("http://127.0.0.1/crm/agent/customers?page=1&pageSize=1&keyword=ali")
  });

  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 1);
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.customer.username, "alice");
  assert.equal(result.items[0]?.customer.crmUserId, firstCustomer.id);
});
