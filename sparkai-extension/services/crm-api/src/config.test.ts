import test from "node:test";
import assert from "node:assert/strict";
import { parseCrmConfig } from "./config.js";

test("parseCrmConfig applies stable local defaults", () => {
  const config = parseCrmConfig({});

  assert.equal(config.port, 17861);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.databaseName, "ai_native_crm");
  assert.equal(config.newApiBaseUrl, "http://127.0.0.1:17860");
  assert.equal(config.databaseUrl, "");
  assert.equal(config.newApiAdminUserId, 0);
  assert.equal(config.newApiAdminAccessToken, "");
  assert.equal(config.quotaPerRmb, 500000);
  assert.equal(config.crmEmbedTrustSecret, "ai-native-crm-local-embed-secret");
  assert.deepEqual(config.corsAllowedOrigins, ["*"]);
  assert.equal(config.effectiveCustomerMaintenanceIntervalMinutes, 0);
  assert.equal(config.usageSyncMaintenanceIntervalMinutes, 0);
  assert.equal(config.enterpriseMonthlySettlementIntervalMinutes, 0);
  assert.equal(config.attachmentStorageDir.endsWith("data/attachments"), true);
  assert.equal(config.attachmentMaxBytes, 5 * 1024 * 1024);
});

test("parseCrmConfig validates numeric configuration", () => {
  assert.throws(
    () => parseCrmConfig({ CRM_API_PORT: "not-a-port" }),
    /CRM_API_PORT must be a positive integer/
  );
  assert.throws(
    () => parseCrmConfig({ NEW_API_ADMIN_USER_ID: "root" }),
    /NEW_API_ADMIN_USER_ID must be a positive integer/
  );
  assert.throws(
    () => parseCrmConfig({ CRM_QUOTA_PER_RMB: "0" }),
    /CRM_QUOTA_PER_RMB must be a positive integer/
  );
  assert.throws(
    () => parseCrmConfig({ CRM_ATTACHMENT_MAX_BYTES: "0" }),
    /CRM_ATTACHMENT_MAX_BYTES must be a positive integer/
  );
});

test("parseCrmConfig preserves PORT compatibility when CRM_API_PORT is absent", () => {
  const config = parseCrmConfig({ PORT: "19061" });

  assert.equal(config.port, 19061);
});

test("parseCrmConfig trims URL and token values", () => {
  const config = parseCrmConfig({
    CRM_API_PORT: "19000",
    CRM_API_HOST: " 0.0.0.0 ",
    CRM_DATABASE_URL: " mysql://root:pass@127.0.0.1:3306/ai_native_crm ",
    CRM_DATABASE_NAME: " ai_native_crm_local ",
    NEW_API_BASE_URL: " http://127.0.0.1:17860/ ",
    NEW_API_ADMIN_USER_ID: "2",
    NEW_API_ADMIN_ACCESS_TOKEN: " token-value ",
    CRM_QUOTA_PER_RMB: "600000",
    CRM_EMBED_TRUST_SECRET: " embed-secret ",
    CRM_ALLOWED_ORIGINS: " https://crm.example.com, http://127.0.0.1:5173/ ",
    CRM_EFFECTIVE_CUSTOMER_MAINTENANCE_INTERVAL_MINUTES: "30",
    CRM_USAGE_SYNC_MAINTENANCE_INTERVAL_MINUTES: "45",
    CRM_ENTERPRISE_MONTHLY_SETTLEMENT_INTERVAL_MINUTES: "120",
    CRM_ATTACHMENT_STORAGE_DIR: " /tmp/ai-native-crm-attachments ",
    CRM_ATTACHMENT_MAX_BYTES: "1024"
  });

  assert.equal(config.port, 19000);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.databaseUrl, "mysql://root:pass@127.0.0.1:3306/ai_native_crm");
  assert.equal(config.databaseName, "ai_native_crm_local");
  assert.equal(config.newApiBaseUrl, "http://127.0.0.1:17860");
  assert.equal(config.newApiAdminUserId, 2);
  assert.equal(config.newApiAdminAccessToken, "token-value");
  assert.equal(config.quotaPerRmb, 600000);
  assert.equal(config.crmEmbedTrustSecret, "embed-secret");
  assert.deepEqual(config.corsAllowedOrigins, ["https://crm.example.com", "http://127.0.0.1:5173"]);
  assert.equal(config.effectiveCustomerMaintenanceIntervalMinutes, 30);
  assert.equal(config.usageSyncMaintenanceIntervalMinutes, 45);
  assert.equal(config.enterpriseMonthlySettlementIntervalMinutes, 120);
  assert.equal(config.attachmentStorageDir, "/tmp/ai-native-crm-attachments");
  assert.equal(config.attachmentMaxBytes, 1024);
});

test("parseCrmConfig requires explicit embedded auth secret in production", () => {
  const config = parseCrmConfig({ NODE_ENV: "production" });

  assert.equal(config.crmEmbedTrustSecret, "");
  assert.deepEqual(config.corsAllowedOrigins, []);
  assert.equal(config.effectiveCustomerMaintenanceIntervalMinutes, 60);
  assert.equal(config.usageSyncMaintenanceIntervalMinutes, 15);
  assert.equal(config.enterpriseMonthlySettlementIntervalMinutes, 1440);
});
