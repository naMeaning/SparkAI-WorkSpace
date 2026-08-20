import type { IncomingMessage } from "node:http";
import {
  agentCategories,
  agentLevels,
  defaultCrmSettings,
  offlineRechargeMethods,
  platformCommissionCaps,
  type AgentCommissionRuleSet,
  type AgentLevelRule,
  type CrmSettingsDto,
  type OfflineRechargeAccount,
  type OfflineRechargeMethod
} from "@ai-native/crm-contracts";
import { httpError, readJsonBody } from "../http.js";
import type { CrmRepository } from "../types.js";

function assertCommissionCaps(settings: CrmSettingsDto): void {
  for (const ruleSet of settings.agentCommissionRuleSets) {
    for (const rule of ruleSet.rules) {
      const firstTotal = rule.firstOrderRate + settings.parentAgentServiceFeeRules.firstOrderRate;
      const repurchaseTotal = rule.repurchaseRate + settings.parentAgentServiceFeeRules.repurchaseRate;
      if (firstTotal > platformCommissionCaps.firstOrderRate || firstTotal > settings.platformCommissionCaps.firstOrderRate) {
        throw httpError("first-order commission settings exceed the platform cap", 400, "commission_cap_exceeded");
      }
      if (repurchaseTotal > platformCommissionCaps.repurchaseRate || repurchaseTotal > settings.platformCommissionCaps.repurchaseRate) {
        throw httpError("repurchase commission settings exceed the platform cap", 400, "commission_cap_exceeded");
      }
    }
  }
}

function normalizeRule(rule: AgentLevelRule): AgentLevelRule {
  if (!Object.values(agentLevels).includes(rule.level)) {
    throw httpError("agent level rule is invalid", 400, "invalid_request");
  }
  return {
    level: rule.level,
    label: String(rule.label || rule.level),
    effectivePaidCustomerThreshold: Number(rule.effectivePaidCustomerThreshold || 0),
    firstOrderRate: Number(rule.firstOrderRate),
    repurchaseRate: Number(rule.repurchaseRate)
  };
}

function normalizeRuleSets(value: unknown): AgentCommissionRuleSet[] {
  const rawRuleSets = Array.isArray(value) ? value : defaultCrmSettings.agentCommissionRuleSets;
  const ruleSets = rawRuleSets.map((ruleSet) => ({
    category: ruleSet.category,
    label: String(ruleSet.label || ruleSet.category),
    rules: Array.isArray(ruleSet.rules) ? ruleSet.rules.map(normalizeRule) : []
  }));
  for (const category of Object.values(agentCategories)) {
    if (!ruleSets.some((ruleSet) => ruleSet.category === category)) {
      throw httpError("agent commission rule sets must include every agent category", 400, "invalid_request");
    }
  }
  return ruleSets;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isOfflineRechargeMethod(value: unknown): value is OfflineRechargeMethod {
  return Object.values(offlineRechargeMethods).includes(value as OfflineRechargeMethod);
}

function normalizeOfflineRechargeAccount(value: unknown, fallback: OfflineRechargeAccount): OfflineRechargeAccount {
  const record = value && typeof value === "object" ? value as Partial<OfflineRechargeAccount> : {};
  if (record.method !== undefined && !isOfflineRechargeMethod(record.method)) {
    throw httpError("offline recharge account method is invalid", 400, "invalid_request");
  }
  return {
    method: fallback.method,
    label: text(record.label) || fallback.label,
    recipientName: text(record.recipientName),
    account: text(record.account),
    qrCodeUrl: text(record.qrCodeUrl),
    instructions: text(record.instructions)
  };
}

function normalizeOfflineRechargeAccounts(value: unknown): OfflineRechargeAccount[] {
  const rawAccounts = Array.isArray(value) ? value : defaultCrmSettings.offlineRechargeAccounts;
  return defaultCrmSettings.offlineRechargeAccounts.map((fallback) => {
    const configured = rawAccounts.find((account) => {
      return account && typeof account === "object" && (account as { method?: unknown }).method === fallback.method;
    });
    return normalizeOfflineRechargeAccount(configured, fallback);
  });
}

function normalizeSettings(value: Partial<CrmSettingsDto>): CrmSettingsDto {
  const settings = {
    ...defaultCrmSettings,
    ...value,
    agentCommissionRuleSets: normalizeRuleSets(value.agentCommissionRuleSets),
    parentAgentServiceFeeRules: value.parentAgentServiceFeeRules || defaultCrmSettings.parentAgentServiceFeeRules,
    platformCommissionCaps: value.platformCommissionCaps || defaultCrmSettings.platformCommissionCaps,
    effectiveCustomerRules: value.effectiveCustomerRules || defaultCrmSettings.effectiveCustomerRules,
    withdrawalMinAmountRmb: Number(value.withdrawalMinAmountRmb ?? defaultCrmSettings.withdrawalMinAmountRmb),
    enterpriseDefaultFixedCommissionPerImage: Number(
      value.enterpriseDefaultFixedCommissionPerImage ?? defaultCrmSettings.enterpriseDefaultFixedCommissionPerImage
    ),
    offlineRechargeAccounts: normalizeOfflineRechargeAccounts(value.offlineRechargeAccounts)
  };
  assertCommissionCaps(settings);
  return settings;
}

export async function getSettingsRoute({ repository }: { repository: Pick<CrmRepository, "getSettings"> }) {
  return repository.getSettings();
}

export async function updateSettingsRoute({
  req,
  repository,
  operatorCrmUserId
}: {
  req: IncomingMessage;
  repository: Pick<CrmRepository, "getSettings" | "saveSettings" | "insertAuditLog">;
  operatorCrmUserId: number;
}) {
  const body = await readJsonBody(req);
  const current = await repository.getSettings();
  const next = normalizeSettings({ ...current, ...body });
  const saved = await repository.saveSettings(next, operatorCrmUserId);
  await repository.insertAuditLog({
    operatorCrmUserId,
    targetType: "settings",
    targetId: "crm_settings",
    action: "settings.update",
    reason: "更新 CRM 系统设置",
    before: current,
    after: saved
  });
  return saved;
}
