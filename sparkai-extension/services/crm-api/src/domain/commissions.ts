import {
  agentCategories,
  agentLevels,
  commissionTypes,
  defaultCrmSettings,
  parentAgentServiceFeeRules,
  platformCommissionCaps,
  type AgentCommissionRuleSet,
  type AgentDto,
  type AgentLevel,
  type CommissionType,
  type CrmSettingsDto,
  type OrderKind
} from "@ai-native/crm-contracts";
import type { AgentRelationshipDto, CommissionCreateInput } from "../types.js";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function rateForOrder(rule: { firstOrderRate: number; repurchaseRate: number }, orderKind: OrderKind): number {
  return orderKind === "first_order" ? rule.firstOrderRate : rule.repurchaseRate;
}

export function resolveAgentLevel(effectivePaidCustomerCount: number): AgentLevel {
  const count = Math.max(0, Math.floor(Number(effectivePaidCustomerCount || 0)));
  let selected: AgentLevel = agentLevels.standard;
  for (const rule of defaultCrmSettings.agentCommissionRuleSets[0].rules) {
    if (count >= rule.effectivePaidCustomerThreshold) {
      selected = rule.level;
    }
  }
  return selected;
}

function getRuleSet(settings: CrmSettingsDto, category: AgentDto["category"]): AgentCommissionRuleSet {
  return settings.agentCommissionRuleSets.find((ruleSet) => ruleSet.category === category)
    || settings.agentCommissionRuleSets.find((ruleSet) => ruleSet.category === agentCategories.normal)
    || defaultCrmSettings.agentCommissionRuleSets[0];
}

export function getAgentLevelRule(level: AgentLevel, ruleSet: AgentCommissionRuleSet) {
  return ruleSet.rules.find((rule) => rule.level === level) || ruleSet.rules[0];
}

function buildCommission({
  sourceType,
  sourceId,
  beneficiaryCrmUserId,
  customerCrmUserId,
  commissionType,
  orderKind,
  agentLevel,
  amountRmb,
  rate
}: {
  sourceType: string;
  sourceId: number;
  beneficiaryCrmUserId: number;
  customerCrmUserId: number;
  commissionType: CommissionType;
  orderKind: OrderKind;
  agentLevel: AgentLevel | null;
  amountRmb: number;
  rate: number;
}): CommissionCreateInput {
  return {
    sourceType,
    sourceId,
    beneficiaryCrmUserId,
    customerCrmUserId,
    commissionType,
    orderKind,
    agentLevel,
    baseAmountRmb: amountRmb,
    rate,
    amountRmb: roundMoney(amountRmb * rate)
  };
}

function capForOrder(orderKind: OrderKind): number {
  return orderKind === "first_order"
    ? platformCommissionCaps.firstOrderRate
    : platformCommissionCaps.repurchaseRate;
}

export function calculateStandardCommissions({
  amountRmb,
  orderKind,
  customerCrmUserId,
  relationship,
  agent,
  parentAgent,
  sourceType,
  sourceId,
  settings = defaultCrmSettings
}: {
  amountRmb: number;
  orderKind: OrderKind;
  customerCrmUserId: number;
  relationship: AgentRelationshipDto | null;
  agent: AgentDto | null;
  parentAgent: AgentDto | null;
  sourceType: string;
  sourceId: number;
  settings?: CrmSettingsDto;
}): CommissionCreateInput[] {
  if (!relationship || !agent) return [];
  if (agent.crmUserId === customerCrmUserId) return [];

  const level = agent.level || resolveAgentLevel(agent.effectivePaidCustomerCount);
  const ruleSet = getRuleSet(settings, agent.category || agentCategories.normal);
  const directRate = rateForOrder(getAgentLevelRule(level, ruleSet), orderKind);
  const hasDirectParent = Boolean(agent.parentAgentCrmUserId && parentAgent);
  const parentRate = hasDirectParent && parentAgent?.crmUserId !== customerCrmUserId
    ? rateForOrder(settings.parentAgentServiceFeeRules || parentAgentServiceFeeRules, orderKind)
    : 0;
  const totalRate = directRate + parentRate;

  if (totalRate > capForOrder(orderKind)) {
    throw new Error(`standard commission rate exceeds platform cap: ${totalRate}`);
  }

  const rows = [
    buildCommission({
      sourceType,
      sourceId,
      beneficiaryCrmUserId: agent.crmUserId,
      customerCrmUserId,
      commissionType: commissionTypes.agentDirectCommission,
      orderKind,
      agentLevel: level,
      amountRmb,
      rate: directRate
    })
  ];

  if (hasDirectParent && parentAgent && parentRate > 0) {
    rows.push(
      buildCommission({
        sourceType,
        sourceId,
        beneficiaryCrmUserId: parentAgent.crmUserId,
        customerCrmUserId,
        commissionType: commissionTypes.parentAgentServiceFee,
        orderKind,
        agentLevel: null,
        amountRmb,
        rate: parentRate
      })
    );
  }

  return rows;
}
