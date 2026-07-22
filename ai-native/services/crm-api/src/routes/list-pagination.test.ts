import test from "node:test";
import assert from "node:assert/strict";
import {
  accountEventStatuses,
  accountEventTypes,
  agentRelationshipBindSources,
  commissionStatuses,
  ledgerDirections,
  ledgerEventTypes,
  withdrawalStatuses,
  withdrawalMethods
} from "@ai-native/crm-contracts";
import { createAgent } from "../domain/agents.js";
import { createMemoryRepository } from "../test-helpers/repository.js";
import { listAccountEventsRoute } from "./account-events.js";
import { listAgentCommissionsRoute, listAgentSubAgentsRoute, listAgentWithdrawalsRoute } from "./agent-dashboard.js";
import { listAgentsRoute } from "./agents.js";
import { listAuditLogsRoute } from "./audit-logs.js";
import { listCommissionsRoute } from "./commissions.js";
import { listLedger } from "./ledger.js";
import { listRiskCasesRoute } from "./risk-cases.js";
import { listWithdrawalsRoute } from "./withdrawals.js";

function pagedUrl(path: string): URL {
  return new URL(`http://127.0.0.1${path}?page=2&pageSize=2`);
}

const payout = {
  payoutMethod: withdrawalMethods.alipay,
  payoutAccountName: "张三",
  payoutAccount: "zhangsan@example.com",
  payoutBankName: ""
} as const;

test("admin list routes return real page metadata instead of fixed limits", async () => {
  const repository = createMemoryRepository();
  const admin = await repository.createCrmUser({ username: "admin", newApiUserId: 1, newApiRole: 100 });
  const agentUsers = [];
  for (let index = 0; index < 3; index += 1) {
    const user = await repository.createCrmUser({ username: `agent-${index}`, newApiUserId: 100 + index });
    agentUsers.push(user);
    await createAgent({ repository, input: { crmUserId: user.id, operatorCrmUserId: admin.id, reason: "seed agent" } });
    await repository.createAccountEvent({
      eventType: accountEventTypes.adminPaidTopup,
      crmUserId: user.id,
      operatorCrmUserId: admin.id,
      amountRmb: 10,
      paidAmountRmb: 10,
      discountAmountRmb: 0,
      commissionBaseRmb: 10,
      quotaDelta: 100,
      idempotencyKey: `seed-${index}`,
      reason: "seed"
    });
    await repository.insertLedgerEntry({
      crmUserId: user.id,
      direction: ledgerDirections.credit,
      amountRmb: 10,
      paidAmountRmb: 10,
      discountAmountRmb: 0,
      commissionBaseRmb: 10,
      eventType: ledgerEventTypes.accountEvent,
      sourceType: "seed",
      idempotencyKey: `ledger-${index}`,
      isPaid: true
    });
    await repository.insertAuditLog({
      operatorCrmUserId: admin.id,
      targetType: "seed",
      targetId: index,
      action: "seed",
      reason: "seed"
    });
    await repository.insertCommissionRecords([{
      sourceType: "seed",
      sourceId: index + 1,
      beneficiaryCrmUserId: user.id,
      customerCrmUserId: user.id,
      commissionType: "agent_direct_commission",
      orderKind: "first_order",
      agentLevel: "standard",
      baseAmountRmb: 10,
      rate: 0.45,
      amountRmb: 4.5
    }]);
    await repository.createWithdrawal({ beneficiaryCrmUserId: user.id, amountRmb: 1, ...payout });
    await repository.createRiskCase({
      targetType: "user",
      targetId: String(user.id),
      riskType: "seed",
      notes: "seed",
      blocksWithdrawal: false,
      blocksCommissionRelease: false,
      createdByCrmUserId: admin.id
    });
  }

  const checks = [
    await listAgentsRoute({ repository, url: pagedUrl("/crm/admin/agents") }),
    await listAccountEventsRoute({ repository, url: pagedUrl("/crm/admin/account-events") }),
    await listLedger({ repository, url: pagedUrl("/crm/admin/ledger") }),
    await listCommissionsRoute({ repository, url: pagedUrl("/crm/admin/commissions") }),
    await listWithdrawalsRoute({ repository, url: pagedUrl("/crm/admin/withdrawals") }),
    await listRiskCasesRoute({ repository, url: pagedUrl("/crm/admin/risk-cases") }),
    await listAuditLogsRoute({ repository, url: pagedUrl("/crm/admin/audit-logs") })
  ];

  for (const result of checks) {
    assert.equal(result.page, 2);
    assert.equal(result.pageSize, 2);
    assert.ok(result.total >= 3);
    assert.ok(result.items.length > 0);
    assert.ok(result.items.length <= 2);
  }
});

test("admin finance and audit lists include usernames for display", async () => {
  const repository = createMemoryRepository();
  const admin = await repository.createCrmUser({ username: "admin", newApiUserId: 1, newApiRole: 100 });
  const user = await repository.createCrmUser({ username: "customer-a", newApiUserId: 100 });
  const agentUser = await repository.createCrmUser({ username: "agent-a", newApiUserId: 101 });
  await repository.createAccountEvent({
    eventType: accountEventTypes.adminPaidTopup,
    crmUserId: user.id,
    operatorCrmUserId: admin.id,
    amountRmb: 10,
    paidAmountRmb: 10,
    discountAmountRmb: 0,
    commissionBaseRmb: 10,
    quotaDelta: 100,
    idempotencyKey: "display-user-event",
    reason: "seed"
  });
  await repository.insertLedgerEntry({
    crmUserId: user.id,
    direction: ledgerDirections.credit,
    amountRmb: 10,
    paidAmountRmb: 10,
    discountAmountRmb: 0,
    commissionBaseRmb: 10,
    eventType: ledgerEventTypes.accountEvent,
    sourceType: "seed",
    idempotencyKey: "display-user-ledger",
    operatorCrmUserId: admin.id,
    isPaid: true
  });
  await repository.insertAuditLog({
    operatorCrmUserId: admin.id,
    targetType: "user",
    targetId: user.id,
    action: "user_profile.update",
    reason: "seed"
  });
  await repository.insertCommissionRecords([{
    sourceType: "seed",
    sourceId: 1,
    beneficiaryCrmUserId: agentUser.id,
    customerCrmUserId: user.id,
    commissionType: "agent_direct_commission",
    orderKind: "first_order",
    agentLevel: "standard",
    baseAmountRmb: 10,
    rate: 0.45,
    amountRmb: 4.5
  }]);
  await repository.createWithdrawal({ beneficiaryCrmUserId: user.id, amountRmb: 1, ...payout });

  const firstPage = new URL("http://127.0.0.1/crm/admin/list?page=1&pageSize=20");
  const events = await listAccountEventsRoute({ repository, url: firstPage });
  const ledger = await listLedger({ repository, url: firstPage });
  const commissions = await listCommissionsRoute({ repository, url: firstPage });
  const withdrawals = await listWithdrawalsRoute({ repository, url: firstPage });
  const audits = await listAuditLogsRoute({ repository, url: firstPage });

  assert.equal(events.items[0]?.crmUsername, "customer-a");
  assert.equal(events.items[0]?.operatorUsername, "admin");
  assert.equal(ledger.items[0]?.crmUsername, "customer-a");
  assert.equal(ledger.items[0]?.operatorUsername, "admin");
  assert.equal(commissions.items[0]?.beneficiaryUsername, "agent-a");
  assert.equal(commissions.items[0]?.customerUsername, "customer-a");
  assert.equal(withdrawals.items[0]?.beneficiaryUsername, "customer-a");
  assert.equal(audits.items[0]?.operatorUsername, "admin");
});

test("admin finance and audit lists support operational filters", async () => {
  const repository = createMemoryRepository();
  const admin = await repository.createCrmUser({ username: "admin", newApiUserId: 1 });
  const firstUser = await repository.createCrmUser({ username: "first-user", newApiUserId: 100 });
  const secondUser = await repository.createCrmUser({ username: "second-user", newApiUserId: 101 });

  await repository.createAccountEvent({
    eventType: accountEventTypes.adminPaidTopup,
    crmUserId: firstUser.id,
    operatorCrmUserId: admin.id,
    amountRmb: 10,
    paidAmountRmb: 10,
    discountAmountRmb: 0,
    commissionBaseRmb: 10,
    quotaDelta: 100,
    idempotencyKey: "filter-paid",
    reason: "seed"
  });
  const pendingEvent = await repository.createAccountEvent({
    eventType: accountEventTypes.compensationGrant,
    crmUserId: secondUser.id,
    operatorCrmUserId: admin.id,
    amountRmb: 5,
    paidAmountRmb: 0,
    discountAmountRmb: 0,
    commissionBaseRmb: 0,
    quotaDelta: 50,
    idempotencyKey: "filter-grant",
    reason: "seed"
  });
  await repository.markAccountEventQuotaApplying(pendingEvent.id);

  await repository.insertLedgerEntry({
    crmUserId: firstUser.id,
    direction: ledgerDirections.credit,
    amountRmb: 10,
    eventType: ledgerEventTypes.accountEvent,
    sourceType: "seed",
    idempotencyKey: "filter-credit",
    isPaid: true
  });
  await repository.insertLedgerEntry({
    crmUserId: secondUser.id,
    direction: ledgerDirections.debit,
    amountRmb: 2,
    eventType: ledgerEventTypes.imageConsume,
    sourceType: "seed",
    idempotencyKey: "filter-debit",
    isPaid: false
  });

  await repository.insertAuditLog({
    operatorCrmUserId: admin.id,
    targetType: "user",
    targetId: firstUser.id,
    action: "user_profile.update",
    reason: "seed"
  });
  await repository.insertAuditLog({
    operatorCrmUserId: secondUser.id,
    targetType: "withdrawal",
    targetId: 99,
    action: "withdrawal.paid",
    reason: "seed"
  });

  await repository.insertCommissionRecords([{
    sourceType: "seed",
    sourceId: 1,
    beneficiaryCrmUserId: firstUser.id,
    customerCrmUserId: secondUser.id,
    commissionType: "agent_direct_commission",
    orderKind: "first_order",
    agentLevel: "standard",
    baseAmountRmb: 10,
    rate: 0.45,
    amountRmb: 4.5
  }]);
  await repository.insertCommissionRecords([{
    sourceType: "seed",
    sourceId: 2,
    beneficiaryCrmUserId: secondUser.id,
    customerCrmUserId: firstUser.id,
    commissionType: "agent_direct_commission",
    orderKind: "first_order",
    agentLevel: "standard",
    baseAmountRmb: 10,
    rate: 0.45,
    amountRmb: 4.5
  }]);
  const frozenCommission = await listCommissionsRoute({
    repository,
    url: new URL(`http://127.0.0.1/crm/admin/commissions?page=1&pageSize=20&beneficiaryCrmUserId=${firstUser.id}&status=${commissionStatuses.frozen}`)
  });

  await repository.createWithdrawal({ beneficiaryCrmUserId: firstUser.id, amountRmb: 1, ...payout });
  await repository.createWithdrawal({ beneficiaryCrmUserId: secondUser.id, amountRmb: 1, ...payout });

  const events = await listAccountEventsRoute({
    repository,
    url: new URL(`http://127.0.0.1/crm/admin/account-events?page=1&pageSize=20&crmUserId=${secondUser.id}&eventType=${accountEventTypes.compensationGrant}&status=${accountEventStatuses.quotaApplying}`)
  });
  const ledger = await listLedger({
    repository,
    url: new URL(`http://127.0.0.1/crm/admin/ledger?page=1&pageSize=20&crmUserId=${secondUser.id}&eventType=${ledgerEventTypes.imageConsume}&direction=${ledgerDirections.debit}`)
  });
  const audits = await listAuditLogsRoute({
    repository,
    url: new URL(`http://127.0.0.1/crm/admin/audit-logs?page=1&pageSize=20&operatorCrmUserId=${secondUser.id}&targetType=withdrawal&action=withdrawal.paid`)
  });
  const withdrawals = await listWithdrawalsRoute({
    repository,
    url: new URL(`http://127.0.0.1/crm/admin/withdrawals?page=1&pageSize=20&beneficiaryCrmUserId=${secondUser.id}&status=${withdrawalStatuses.pending}`)
  });

  assert.deepEqual(events.items.map((item) => item.crmUserId), [secondUser.id]);
  assert.deepEqual(ledger.items.map((item) => item.crmUserId), [secondUser.id]);
  assert.deepEqual(audits.items.map((item) => item.targetType), ["withdrawal"]);
  assert.deepEqual(frozenCommission.items.map((item) => item.beneficiaryCrmUserId), [firstUser.id]);
  assert.deepEqual(withdrawals.items.map((item) => item.beneficiaryCrmUserId), [secondUser.id]);
});

test("agent list routes return page metadata for team, commissions, and withdrawals", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({ username: "agent", newApiUserId: 2000 });
  await createAgent({ repository, input: { crmUserId: agentUser.id, operatorCrmUserId: agentUser.id, reason: "seed parent" } });
  for (let index = 0; index < 3; index += 1) {
    const user = await repository.createCrmUser({ username: `child-${index}`, newApiUserId: 3000 + index });
    await createAgent({
      repository,
      input: { crmUserId: user.id, parentAgentCrmUserId: agentUser.id, operatorCrmUserId: agentUser.id, reason: "seed child" }
    });
    await repository.insertCommissionRecords([{
      sourceType: "seed",
      sourceId: index + 1,
      beneficiaryCrmUserId: agentUser.id,
      customerCrmUserId: user.id,
      commissionType: "agent_direct_commission",
      orderKind: "first_order",
      agentLevel: "standard",
      baseAmountRmb: 10,
      rate: 0.45,
      amountRmb: 4.5
    }]);
    await repository.createWithdrawal({ beneficiaryCrmUserId: agentUser.id, amountRmb: index + 1, ...payout });
  }
  await repository.saveAgentRelationship(agentUser.id, {
    customerCrmUserId: agentUser.id,
    agentCrmUserId: agentUser.id,
    bindSource: agentRelationshipBindSources.adminBind,
    status: "active",
    bindReason: "self seed"
  });

  const context = { crmUserId: agentUser.id, newApiUserId: 2000, isSuperAdmin: false };
  const checks = [
    await listAgentSubAgentsRoute({ context, repository, url: pagedUrl("/crm/agent/sub-agents") }),
    await listAgentCommissionsRoute({ context, repository, url: pagedUrl("/crm/agent/commissions") }),
    await listAgentWithdrawalsRoute({ context, repository, url: pagedUrl("/crm/agent/withdrawals") })
  ];

  for (const result of checks) {
    assert.equal(result.page, 2);
    assert.equal(result.pageSize, 2);
    assert.equal(result.total, 3);
    assert.equal(result.items.length, 1);
  }
  const subAgents = await listAgentSubAgentsRoute({ context, repository, url: new URL("http://127.0.0.1/crm/agent/sub-agents?page=1&pageSize=20") });
  assert.deepEqual(subAgents.items.map((agent) => agent.username).sort(), ["child-0", "child-1", "child-2"]);
});
