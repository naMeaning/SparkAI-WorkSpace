import test from "node:test";
import assert from "node:assert/strict";
import {
  accountEventStatuses,
  accountEventTypes,
  agentCategories,
  agentLevels,
  agentRelationshipStatuses,
  agentStatuses,
  commissionTypes,
  crmModules,
  crmPageCapabilities,
  crmRolePageGroups,
  defaultCrmSettings,
  enterpriseMonthlySettlementStatuses,
  effectiveCustomerRules,
  offlineRechargeMethods,
  offlineRechargeStatuses,
  parentAgentServiceFeeRules,
  platformCommissionCaps,
  riskCaseTypes,
  riskTargetTypes,
  signupTrialGrantStatuses,
  signupTrialGrantRmb,
  inviteFirstTopupDiscountRate,
  standardAgentLevelRules,
  withdrawalMethods,
  withdrawalStatuses
} from "./index.js";
import type {
  AgentCustomerDto,
  AuditLogEntryDto,
  CrmSchedulerHealthDto,
  CrmUserProfileDto,
  CrmUserDto,
  EnterpriseMonthlySettlementDto,
  OfflineRechargeRequestDto,
  PageResult,
  WithdrawalCommissionAllocationDto,
  WithdrawalDto
} from "./index.js";

test("exports scheduler health contracts", () => {
  const health: CrmSchedulerHealthDto = {
    enabled: true,
    intervalMinutes: 5,
    running: false,
    lastStartedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorCode: "",
    lastErrorMessage: ""
  };
  assert.equal(health.intervalMinutes, 5);
});

test("exports CRM modules for the non-payment middle office", () => {
  assert.deepEqual(
    crmModules.map((item) => item.key),
    [
      "dashboard",
      "users",
      "accountEvents",
      "ledger",
      "agents",
      "relationships",
      "effectiveCustomers",
      "commissions",
      "offlineRecharges",
      "withdrawals",
      "enterprise",
      "risk",
      "audit",
      "settings"
    ]
  );
});

test("exports only the approved CRM page capabilities", () => {
  assert.deepEqual(crmPageCapabilities, {
    agent: "agent",
    superAdmin: "super_admin"
  });

  assert.deepEqual(
    crmRolePageGroups.map((item) => [item.key, item.label]),
    [
      ["agent", "我的分销"],
      ["super_admin", "平台管理"]
    ]
  );
});

test("exports single-agent categories, hierarchy and level rules", () => {
  assert.deepEqual(agentCategories, {
    normal: "normal",
    strategic: "strategic"
  });
  assert.equal(agentStatuses.active, "active");
  assert.equal(agentLevels.standard, "standard");
  assert.equal(agentRelationshipStatuses.rebound, "rebound");
  assert.deepEqual(
    standardAgentLevelRules.map((rule) => [
      rule.level,
      rule.effectivePaidCustomerThreshold,
      rule.firstOrderRate,
      rule.repurchaseRate
    ]),
    [
      ["standard", 0, 0.45, 0.135],
      ["advanced", 10, 0.5, 0.15],
      ["core", 30, 0.55, 0.165],
      ["gold", 80, 0.6, 0.18]
    ]
  );
});

test("exports parent service fee and platform caps", () => {
  assert.equal(parentAgentServiceFeeRules.firstOrderRate, 0.1);
  assert.equal(parentAgentServiceFeeRules.repurchaseRate, 0.03);
  assert.equal(platformCommissionCaps.firstOrderRate, 0.7);
  assert.equal(platformCommissionCaps.repurchaseRate, 0.21);
  assert.equal(effectiveCustomerRules.minFirstPaidRmb, 29.9);
  assert.equal(effectiveCustomerRules.minPaidBalanceConsumedRate, 0.3);
});

test("exports trial balance and invite first-topup discount rules", () => {
  assert.equal(signupTrialGrantRmb, 2);
  assert.deepEqual(signupTrialGrantStatuses, {
    pending: "pending",
    granted: "granted"
  });
  assert.equal(inviteFirstTopupDiscountRate, 0.88);
});

test("types CRM users with current distribution profile fields", () => {
  const profile: CrmUserProfileDto = {
    crmUserId: 1,
    phone: "",
    wechat: "",
    remark: "",
    cumulativePaidRmb: 0,
    isEnterprise: false,
    enterprisePriceRmb: null,
    enterpriseFixedCommissionPerImage: null,
    isRisk: false
  };
  const user: CrmUserDto = {
    ...profile,
    username: "alice",
    displayName: "alice",
    email: "alice@example.com",
    newApiRole: 1,
    firstTopupDiscountRate: null,
    firstTopupDiscountAvailable: false,
    signupTrialGrantStatus: signupTrialGrantStatuses.granted,
    createdAt: "2026-07-08T00:00:00.000Z",
    agentRelationship: null,
    agent: null
  };

  assert.equal(user.cumulativePaidRmb, 0);
  assert.deepEqual(Object.keys(profile).sort(), [
    "crmUserId",
    "cumulativePaidRmb",
    "enterpriseFixedCommissionPerImage",
    "enterprisePriceRmb",
    "isEnterprise",
    "isRisk",
    "phone",
    "remark",
    "wechat"
  ]);
});

test("types agent customer lists with searchable customer summaries", () => {
  const page: PageResult<AgentCustomerDto> = {
    items: [{
      customerCrmUserId: 2,
      customer: {
        crmUserId: 2,
        username: "alice",
        email: "alice@example.com",
        createdAt: "2026-07-05T00:00:00.000Z"
      },
      relationship: {
        id: 1,
        customerCrmUserId: 2,
        agentCrmUserId: 1,
        bindSource: "invite_code",
        status: "active",
        bindReason: "用户注册时填写邀请码"
      }
    }],
    total: 1,
    page: 1,
    pageSize: 20
  };

  assert.equal(page.items[0]?.customer.username, "alice");
});

test("exports account events, commission types, and withdrawals", () => {
  assert.equal(accountEventTypes.adminPaidTopup, "admin_paid_topup");
  assert.equal(accountEventTypes.onlineTopup, "online_topup");
  assert.equal(accountEventTypes.signupTrialGrant, "signup_trial_grant");
  assert.equal(accountEventTypes.refund, "refund");
  assert.equal(accountEventStatuses.reconcileRequired, "reconcile_required");
  assert.equal(commissionTypes.agentDirectCommission, "agent_direct_commission");
  assert.equal(commissionTypes.parentAgentServiceFee, "parent_agent_service_fee");
  assert.equal(commissionTypes.enterpriseFixedPerImage, "enterprise_fixed_per_image");
  assert.deepEqual(withdrawalMethods, {
    alipay: "alipay",
    wechat: "wechat",
    bank: "bank"
  });
  assert.equal(withdrawalStatuses.paid, "paid");
});

test("types withdrawal commission allocations and audit request context", () => {
  const allocation: WithdrawalCommissionAllocationDto = {
    id: 1,
    withdrawalId: 2,
    commissionId: 3,
    amountRmb: 12.34,
    createdAt: "2026-07-11T00:00:00.000Z"
  };
  const audit: AuditLogEntryDto = {
    id: 1,
    operatorCrmUserId: 2,
    targetType: "withdrawal",
    targetId: "3",
    action: "withdrawal.paid",
    reason: "线下已打款",
    beforeSnapshot: null,
    afterSnapshot: null,
    requestIp: "203.0.113.10",
    userAgent: "crm-contract-test"
  };

  assert.equal(allocation.amountRmb, 12.34);
  assert.equal(audit.requestIp, "203.0.113.10");
});

test("exports approved risk target and case type contracts", () => {
  assert.deepEqual(riskTargetTypes, {
    user: "user",
    agent: "agent",
    agentRelationship: "agent_relationship",
    accountEvent: "account_event",
    commission: "commission",
    withdrawal: "withdrawal",
    enterpriseMonthlySettlement: "enterprise_monthly_settlement"
  });
  assert.deepEqual(riskCaseTypes, {
    abnormalRegistration: "异常注册",
    relatedAccount: "关联账号",
    abnormalUsage: "异常用量",
    paymentDispute: "支付争议",
    commissionRisk: "佣金风险",
    withdrawalRisk: "提现风险",
    manualReview: "人工复核"
  });
});


test("exports enterprise monthly settlement contracts", () => {
  assert.deepEqual(enterpriseMonthlySettlementStatuses, {
    pending: "pending",
    paid: "paid",
    cancelled: "cancelled"
  });

  const settlement: EnterpriseMonthlySettlementDto = {
    id: 1,
    crmUserId: 2,
    crmUsername: "enterprise-user",
    period: "2026-06",
    usageRmb: 128.5,
    ledgerEntryCount: 7,
    status: enterpriseMonthlySettlementStatuses.pending,
    paidReference: "",
    paidEvidenceUrl: "",
    notes: ""
  };
  assert.equal(settlement.period, "2026-06");
  assert.equal(settlement.status, "pending");
});

test("exports offline recharge request contracts", () => {
  assert.deepEqual(offlineRechargeMethods, {
    alipay: "alipay",
    wechat: "wechat"
  });
  assert.deepEqual(offlineRechargeStatuses, {
    pending: "pending",
    approved: "approved",
    rejected: "rejected"
  });

  const recharge: OfflineRechargeRequestDto = {
    id: 1,
    crmUserId: 2,
    method: offlineRechargeMethods.alipay,
    amountRmb: 100,
    payerName: "张三",
    paymentReference: "支付宝流水号",
    paymentEvidenceUrl: "https://example.com/payments/1.png",
    notes: "首充",
    status: offlineRechargeStatuses.pending,
    reviewerCrmUserId: null,
    reviewReason: "",
    accountEventId: null
  };
  const withdrawal: WithdrawalDto = {
    id: 1,
    beneficiaryCrmUserId: 2,
    amountRmb: 100,
    payoutMethod: withdrawalMethods.alipay,
    payoutAccountName: "张三",
    payoutAccount: "zhangsan@example.com",
    payoutBankName: "",
    status: withdrawalStatuses.paid,
    reviewerCrmUserId: 1,
    reviewReason: "线下已打款",
    paidReference: "银行流水号",
    paidEvidenceUrl: "https://example.com/withdrawals/1.png"
  };
  assert.equal(recharge.paymentEvidenceUrl.endsWith(".png"), true);
  assert.equal(withdrawal.paidEvidenceUrl.endsWith(".png"), true);
});

test("exports default settings from approved rules", () => {
  assert.deepEqual(
    defaultCrmSettings.agentCommissionRuleSets.map((set) => [set.category, set.rules[0].firstOrderRate]),
    [
      ["normal", 0.45],
      ["strategic", 0.45]
    ]
  );
  assert.notEqual(defaultCrmSettings.agentCommissionRuleSets[0].rules, defaultCrmSettings.agentCommissionRuleSets[1].rules);
  assert.equal(defaultCrmSettings.parentAgentServiceFeeRules.firstOrderRate, 0.1);
  assert.equal(defaultCrmSettings.platformCommissionCaps.firstOrderRate, 0.7);
  assert.equal("standardPriceTiers" in defaultCrmSettings, false);
  assert.deepEqual(defaultCrmSettings.offlineRechargeAccounts.map((account) => account.method), ["alipay", "wechat"]);
  assert.equal(defaultCrmSettings.offlineRechargeAccounts[0].qrCodeUrl, "");
});

test("exports only the current contract surface", () => {
  assert.deepEqual(Object.keys(crmPageCapabilities).sort(), ["agent", "superAdmin"]);
  assert.deepEqual(Object.keys(agentCategories).sort(), ["normal", "strategic"]);
});
