import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  auditActionText,
  ledgerSourceText,
  registrationInviteCode,
  relationshipBindSourceText,
  riskTypeText,
  targetText,
} from './display'

describe('CRM display text', () => {
  test('uses the New API affiliate code as the registration invite code', () => {
    assert.equal(registrationInviteCode({ data: { aff_code: 'vrTx' } }), 'vrTx')
    assert.equal(registrationInviteCode({ data: { aff_code: '' } }), '-')
    assert.equal(registrationInviteCode(undefined), '-')
  })

  test('renders relationship bind sources in Chinese', () => {
    assert.equal(relationshipBindSourceText('invite_code'), '邀请码绑定')
    assert.equal(relationshipBindSourceText('admin_bind'), '管理员绑定')
    assert.equal(relationshipBindSourceText('admin_rebind'), '管理员改绑')
  })

  test('renders ledger source types in Chinese', () => {
    assert.equal(ledgerSourceText('account_event', 12), '入账事件 #12')
    assert.equal(ledgerSourceText('new_api_consume_log', null), '模型消耗')
    assert.equal(ledgerSourceText('crm_signup_trial_grant', 8), '注册试用金 #8')
    assert.equal(ledgerSourceText('commission', 3), '佣金 #3')
    assert.equal(ledgerSourceText('withdrawal', 5), '提现 #5')
  })

  test('renders audit and risk targets in Chinese', () => {
    assert.equal(targetText('user', '42'), '用户 42')
    assert.equal(targetText('user_profile', '42'), '用户资料 42')
    assert.equal(targetText('agent_relationship', '9'), '客户归属 9')
    assert.equal(targetText('risk_case', '7'), '风控单 7')
    assert.equal(
      targetText('enterprise_monthly_settlement', '2026-07'),
      '大客户月结 2026-07'
    )
  })

  test('renders audit actions in Chinese', () => {
    assert.equal(auditActionText('user_profile.update'), '更新用户资料')
    assert.equal(auditActionText('account_event.create'), '创建入账事件')
    assert.equal(auditActionText('account_event.refund'), '登记退款')
    assert.equal(auditActionText('risk_case.create'), '创建风控单')
    assert.equal(auditActionText('withdrawal.paid'), '登记打款')
  })

  test('renders risk types in Chinese without leaking internal enum values', () => {
    assert.equal(riskTypeText('异常注册'), '异常注册')
    assert.equal(riskTypeText('abnormal_registration'), '异常注册')
    assert.equal(riskTypeText('commission_risk'), '佣金风险')
    assert.equal(riskTypeText('seed_internal_case'), '其他风险')
  })
})
