import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  agentCategories,
  defaultCrmSettings,
  offlineRechargeMethods,
  type CrmSettingsDto,
} from '@ai-native/crm-contracts'

import {
  buildSettingsUpdatePayload,
  offlineRechargeFieldName,
  ruleFieldName,
  toPercentInputValue,
} from './settings-form'

function cloneDefaultSettings(): CrmSettingsDto {
  return structuredClone(defaultCrmSettings) as CrmSettingsDto
}

test('builds editable CRM settings payload from operator-facing percent fields', () => {
  const settings = cloneDefaultSettings()
  const firstNormalRule = settings.agentCommissionRuleSets[0].rules[0]
  const form = new FormData()

  form.set(
    ruleFieldName(agentCategories.normal, firstNormalRule, 'threshold'),
    '2'
  )
  form.set(ruleFieldName(agentCategories.normal, firstNormalRule, 'first'), '46.5')
  form.set(
    ruleFieldName(agentCategories.normal, firstNormalRule, 'repurchase'),
    '14.25'
  )
  form.set('parentFirstOrderRate', '11.5')
  form.set('parentRepurchaseRate', '3.5')
  form.set('platformFirstOrderCap', '70')
  form.set('platformRepurchaseCap', '21')
  form.set('withdrawalMinAmountRmb', '120.25')
  form.set('enterpriseDefaultFixedCommissionPerImage', '0.03')
  form.set(
    offlineRechargeFieldName(offlineRechargeMethods.alipay, 'recipientName'),
    '上海测试公司'
  )
  form.set(
    offlineRechargeFieldName(offlineRechargeMethods.alipay, 'account'),
    'pay@example.com'
  )
  form.set(
    offlineRechargeFieldName(offlineRechargeMethods.alipay, 'qrCodeUrl'),
    'https://example.com/pay.png'
  )
  form.set(
    offlineRechargeFieldName(offlineRechargeMethods.alipay, 'instructions'),
    '转账备注填写用户名'
  )

  const payload = buildSettingsUpdatePayload(settings, form)
  const updatedNormalRule = payload.agentCommissionRuleSets[0].rules[0]
  const updatedAlipay = payload.offlineRechargeAccounts.find(
    (account) => account.method === offlineRechargeMethods.alipay
  )

  assert.equal(updatedNormalRule.effectivePaidCustomerThreshold, 2)
  assert.equal(updatedNormalRule.firstOrderRate, 0.465)
  assert.equal(updatedNormalRule.repurchaseRate, 0.1425)
  assert.equal(payload.parentAgentServiceFeeRules.firstOrderRate, 0.115)
  assert.equal(payload.parentAgentServiceFeeRules.repurchaseRate, 0.035)
  assert.equal(payload.platformCommissionCaps.firstOrderRate, 0.7)
  assert.equal(payload.platformCommissionCaps.repurchaseRate, 0.21)
  assert.equal(payload.withdrawalMinAmountRmb, 120.25)
  assert.equal(payload.enterpriseDefaultFixedCommissionPerImage, 0.03)
  assert.equal(updatedAlipay?.recipientName, '上海测试公司')
  assert.equal(updatedAlipay?.account, 'pay@example.com')
  assert.equal(updatedAlipay?.qrCodeUrl, 'https://example.com/pay.png')
  assert.equal(updatedAlipay?.instructions, '转账备注填写用户名')
})

test('formats stored decimal rates as compact percent input values', () => {
  assert.equal(toPercentInputValue(0.45), '45')
  assert.equal(toPercentInputValue(0.135), '13.5')
  assert.equal(toPercentInputValue(0.14255), '14.255')
})
