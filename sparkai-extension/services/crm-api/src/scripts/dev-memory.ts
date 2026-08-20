import http from "node:http";
import {
  agentCategories,
  ledgerDirections,
  ledgerEventTypes,
  offlineRechargeMethods,
  riskCaseTypes,
  riskTargetTypes,
} from "@ai-native/crm-contracts";
import { createAgent } from "../domain/agents.js";
import { createCrmHandler } from "../server.js";
import { createMemoryRepository } from "../test-helpers/repository.js";
import type { CrmConfig } from "../types.js";
import { createDevNewApiClient } from "./dev-new-api-client.js";

const config: CrmConfig = {
  port: Number(process.env.CRM_API_PORT || process.env.PORT || 17861),
  host: process.env.CRM_API_HOST || "127.0.0.1",
  databaseUrl: "",
  databaseName: "ai_native_crm_memory",
  newApiBaseUrl: process.env.NEW_API_BASE_URL || "http://127.0.0.1:17860",
  newApiAdminUserId: Number(process.env.NEW_API_ADMIN_USER_ID || 0),
  newApiAdminAccessToken: process.env.NEW_API_ADMIN_ACCESS_TOKEN || "",
  quotaPerRmb: 500000,
  crmEmbedTrustSecret: process.env.CRM_EMBED_TRUST_SECRET || "ai-native-crm-local-embed-secret",
  corsAllowedOrigins: ["*"],
  effectiveCustomerMaintenanceIntervalMinutes: 0,
  usageSyncMaintenanceIntervalMinutes: 0,
  enterpriseMonthlySettlementIntervalMinutes: 0,
  attachmentStorageDir: "data/attachments",
  attachmentMaxBytes: 5 * 1024 * 1024,
};

const newApiClient = createDevNewApiClient(config);

const repository = createMemoryRepository();

async function seedDevRepository() {
  const agentUser = await repository.createCrmUser({
    username: "demo-agent",
    email: "agent@example.test",
    newApiUserId: 2001,
  });
  const firstCustomer = await repository.createCrmUser({
    username: "demo-shop",
    email: "shop@example.test",
    newApiUserId: 3001,
  });
  const secondCustomer = await repository.createCrmUser({
    username: "demo-cross-border",
    email: "cross-border@example.test",
    newApiUserId: 3002,
  });

  await createAgent({
    repository,
    input: {
      crmUserId: agentUser.id,
      operatorCrmUserId: 1,
      category: agentCategories.normal,
      reason: "本地界面验证数据",
    },
  });

  for (const [index, user] of [firstCustomer, secondCustomer].entries()) {
    await repository.insertLedgerEntry({
      crmUserId: user.id,
      direction: ledgerDirections.credit,
      amountRmb: 100 + index * 88,
      paidAmountRmb: 100 + index * 88,
      eventType: ledgerEventTypes.accountEvent,
      sourceType: "dev_ui_seed",
      sourceId: index + 1,
      idempotencyKey: `dev-ui-ledger-${user.id}`,
      operatorCrmUserId: 1,
      reason: index === 0 ? "线下充值入账" : "跨境电商账户入账",
      isPaid: true,
    });
  }

  await repository.createOfflineRechargeRequest({
    crmUserId: firstCustomer.id,
    method: offlineRechargeMethods.alipay,
    amountRmb: 360,
    payerName: "示例商户",
    paymentReference: "DEV-UI-RECHARGE",
    paymentEvidenceUrl: "",
    notes: "本地移动端审核界面验证",
  });

  await repository.createRiskCase({
    targetType: riskTargetTypes.user,
    targetId: String(secondCustomer.id),
    riskType: riskCaseTypes.manualReview,
    notes: "本地移动端风控界面验证",
    blocksWithdrawal: false,
    blocksCommissionRelease: false,
    createdByCrmUserId: 1,
  });
}

if (process.env.CRM_DEV_SEED === "true") {
  await seedDevRepository();
}

const server = http.createServer(createCrmHandler({ config, repository, newApiClient }));

server.listen(config.port, config.host, () => {
  console.log(`CRM API memory listening on http://${config.host}:${config.port}`);
  console.log("CRM embedded new-api auth enabled");
  console.log(
    config.newApiAdminUserId && config.newApiAdminAccessToken
      ? "CRM New API service client enabled"
      : "CRM New API service client simulated; set NEW_API_ADMIN_USER_ID and NEW_API_ADMIN_ACCESS_TOKEN for real quota and usage checks",
  );
});
