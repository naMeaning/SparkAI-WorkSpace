/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type {
  AgentCategory,
  AgentLevelRule,
  CrmSettingsDto,
  OfflineRechargeAccount,
  OfflineRechargeMethod,
} from '@ai-native/crm-contracts'

type SettingsRatePair = {
  firstOrderRate: number
  repurchaseRate: number
}

export type SettingsUpdatePayload = Omit<
  CrmSettingsDto,
  'parentAgentServiceFeeRules' | 'platformCommissionCaps'
> & {
  parentAgentServiceFeeRules: SettingsRatePair
  platformCommissionCaps: SettingsRatePair
}

type RuleField = 'threshold' | 'first' | 'repurchase'
type OfflineRechargeField = keyof Pick<
  OfflineRechargeAccount,
  'recipientName' | 'account' | 'qrCodeUrl' | 'instructions'
>

export function ruleFieldName(
  category: AgentCategory,
  rule: Pick<AgentLevelRule, 'level'>,
  field: RuleField
): string {
  return `rule.${category}.${rule.level}.${field}`
}

export function offlineRechargeFieldName(
  method: OfflineRechargeMethod,
  field: OfflineRechargeField
): string {
  return `offlineRecharge.${method}.${field}`
}

export function toPercentInputValue(value: number): string {
  const percent = Number(value || 0) * 100
  if (Number.isInteger(percent)) return String(percent)
  return percent.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function formText(form: FormData, key: string, fallback = ''): string {
  const value = form.get(key)
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function formNumber(form: FormData, key: string, fallback: number): number {
  const value = formText(form, key)
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function formRate(form: FormData, key: string, fallback: number): number {
  return Number((formNumber(form, key, fallback * 100) / 100).toFixed(6))
}

export function buildSettingsUpdatePayload(
  settings: CrmSettingsDto,
  form: FormData
): SettingsUpdatePayload {
  return {
    ...settings,
    agentCommissionRuleSets: settings.agentCommissionRuleSets.map(
      (ruleSet) => ({
        ...ruleSet,
        rules: ruleSet.rules.map((rule) => ({
          ...rule,
          effectivePaidCustomerThreshold: formNumber(
            form,
            ruleFieldName(ruleSet.category, rule, 'threshold'),
            rule.effectivePaidCustomerThreshold
          ),
          firstOrderRate: formRate(
            form,
            ruleFieldName(ruleSet.category, rule, 'first'),
            rule.firstOrderRate
          ),
          repurchaseRate: formRate(
            form,
            ruleFieldName(ruleSet.category, rule, 'repurchase'),
            rule.repurchaseRate
          ),
        })),
      })
    ),
    parentAgentServiceFeeRules: {
      firstOrderRate: formRate(
        form,
        'parentFirstOrderRate',
        settings.parentAgentServiceFeeRules.firstOrderRate
      ),
      repurchaseRate: formRate(
        form,
        'parentRepurchaseRate',
        settings.parentAgentServiceFeeRules.repurchaseRate
      ),
    },
    platformCommissionCaps: {
      firstOrderRate: formRate(
        form,
        'platformFirstOrderCap',
        settings.platformCommissionCaps.firstOrderRate
      ),
      repurchaseRate: formRate(
        form,
        'platformRepurchaseCap',
        settings.platformCommissionCaps.repurchaseRate
      ),
    },
    withdrawalMinAmountRmb: formNumber(
      form,
      'withdrawalMinAmountRmb',
      settings.withdrawalMinAmountRmb
    ),
    enterpriseDefaultFixedCommissionPerImage: formNumber(
      form,
      'enterpriseDefaultFixedCommissionPerImage',
      settings.enterpriseDefaultFixedCommissionPerImage
    ),
    offlineRechargeAccounts: settings.offlineRechargeAccounts.map(
      (account) => ({
        ...account,
        recipientName: formText(
          form,
          offlineRechargeFieldName(account.method, 'recipientName'),
          account.recipientName
        ),
        account: formText(
          form,
          offlineRechargeFieldName(account.method, 'account'),
          account.account
        ),
        qrCodeUrl: formText(
          form,
          offlineRechargeFieldName(account.method, 'qrCodeUrl'),
          account.qrCodeUrl
        ),
        instructions: formText(
          form,
          offlineRechargeFieldName(account.method, 'instructions'),
          account.instructions
        ),
      })
    ),
  }
}
