import type { CrmConfig } from "./types.js";

type CrmEnv = Record<string, string | undefined>;

function trimValue(value: unknown): string {
  return String(value ?? "").trim();
}

function parseOptionalPositiveInteger(env: CrmEnv, key: string, defaultValue: number): number {
  const raw = trimValue(env[key]);
  if (raw === "") return defaultValue;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${key} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function parseOptionalNonNegativeInteger(env: CrmEnv, key: string, defaultValue: number): number {
  const raw = trimValue(env[key]);
  if (raw === "") return defaultValue;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  return value;
}

function trimTrailingSlash(url: unknown): string {
  const trimmed = trimValue(url);
  if (trimmed === "") return "";
  return trimmed.replace(/\/+$/, "");
}

function trimTrailingPathSeparator(pathValue: unknown): string {
  const trimmed = trimValue(pathValue);
  if (trimmed === "") return "";
  return trimmed.replace(/[\\/]+$/, "");
}

function parseCorsAllowedOrigins(env: CrmEnv, isProduction: boolean): string[] {
  const raw = trimValue(env.CRM_ALLOWED_ORIGINS);
  if (!raw) return isProduction ? [] : ["*"];
  return Array.from(new Set(
    raw
      .split(",")
      .map((origin) => trimTrailingSlash(origin))
      .filter(Boolean)
  ));
}

export function parseCrmConfig(env: CrmEnv = process.env): CrmConfig {
  const nodeEnv = trimValue(env.NODE_ENV).toLowerCase();
  const isProduction = nodeEnv === "production";
  return {
    port: parseOptionalPositiveInteger(env, "CRM_API_PORT", parseOptionalPositiveInteger(env, "PORT", 17861)),
    host: trimValue(env.CRM_API_HOST) || "127.0.0.1",
    databaseUrl: trimValue(env.CRM_DATABASE_URL),
    databaseName: trimValue(env.CRM_DATABASE_NAME) || "ai_native_crm",
    newApiBaseUrl: trimTrailingSlash(env.NEW_API_BASE_URL) || "http://127.0.0.1:17860",
    newApiAdminUserId: parseOptionalPositiveInteger(env, "NEW_API_ADMIN_USER_ID", 0),
    newApiAdminAccessToken: trimValue(env.NEW_API_ADMIN_ACCESS_TOKEN),
    quotaPerRmb: parseOptionalPositiveInteger(env, "CRM_QUOTA_PER_RMB", 500000),
    crmEmbedTrustSecret: trimValue(env.CRM_EMBED_TRUST_SECRET) || (isProduction ? "" : "ai-native-crm-local-embed-secret"),
    corsAllowedOrigins: parseCorsAllowedOrigins(env, isProduction),
    effectiveCustomerMaintenanceIntervalMinutes: parseOptionalNonNegativeInteger(
      env,
      "CRM_EFFECTIVE_CUSTOMER_MAINTENANCE_INTERVAL_MINUTES",
      isProduction ? 60 : 0
    ),
    usageSyncMaintenanceIntervalMinutes: parseOptionalNonNegativeInteger(
      env,
      "CRM_USAGE_SYNC_MAINTENANCE_INTERVAL_MINUTES",
      isProduction ? 15 : 0
    ),
    enterpriseMonthlySettlementIntervalMinutes: parseOptionalNonNegativeInteger(
      env,
      "CRM_ENTERPRISE_MONTHLY_SETTLEMENT_INTERVAL_MINUTES",
      isProduction ? 1440 : 0
    ),
    attachmentStorageDir: trimTrailingPathSeparator(env.CRM_ATTACHMENT_STORAGE_DIR) || "data/attachments",
    attachmentMaxBytes: parseOptionalPositiveInteger(env, "CRM_ATTACHMENT_MAX_BYTES", 5 * 1024 * 1024)
  };
}
