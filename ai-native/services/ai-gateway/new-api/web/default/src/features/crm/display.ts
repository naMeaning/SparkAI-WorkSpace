import {
  agentRelationshipBindSources,
  riskCaseTypes,
} from '@ai-native/crm-contracts'

export function registrationInviteCode(value: unknown): string {
  if (!value || typeof value !== 'object' || !('data' in value)) return '-'
  const data = value.data
  if (!data || typeof data !== 'object' || !('aff_code' in data)) return '-'
  const code = typeof data.aff_code === 'string' ? data.aff_code.trim() : ''
  return code || '-'
}

function withOptionalId(label: string, id?: number | string | null): string {
  const text = id === undefined || id === null ? '' : String(id).trim()
  return text ? `${label} #${text}` : label
}

function withPlainId(label: string, id?: number | string | null): string {
  const text = id === undefined || id === null ? '' : String(id).trim()
  return text ? `${label} ${text}` : label
}

export function relationshipBindSourceText(
  value: string | null | undefined
): string {
  const labels: Record<string, string> = {
    [agentRelationshipBindSources.inviteCode]: '邀请码绑定',
    [agentRelationshipBindSources.adminBind]: '管理员绑定',
    [agentRelationshipBindSources.adminRebind]: '管理员改绑',
  }
  return (value && labels[value]) || value || '-'
}

export function ledgerSourceText(
  sourceType: string | null | undefined,
  sourceId?: number | string | null
): string {
  const labels: Record<string, string> = {
    account_event: '入账事件',
    new_api_consume_log: '模型消耗',
    crm_signup_trial_grant: '注册试用金',
    commission: '佣金',
    withdrawal: '提现',
  }
  const label = (sourceType && labels[sourceType]) || sourceType || '-'
  return withOptionalId(label, sourceId)
}

export function targetText(
  targetType: string | null | undefined,
  targetId?: number | string | null
): string {
  const labels: Record<string, string> = {
    user: '用户',
    user_profile: '用户资料',
    agent: '代理',
    agent_relationship: '客户归属',
    account_event: '入账事件',
    commission: '佣金',
    withdrawal: '提现',
    risk_case: '风控单',
    enterprise_monthly_settlement: '大客户月结',
  }
  const label = (targetType && labels[targetType]) || targetType || '-'
  return withPlainId(label, targetId)
}

export function auditActionText(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    'user_profile.update': '更新用户资料',
    'agent.create': '创建代理',
    'agent.update': '更新代理',
    'agent_relationship.bind': '绑定客户归属',
    'agent_relationship.rebind': '改绑客户归属',
    'account_event.create': '创建入账事件',
    'account_event.reconcile_complete': '完成入账对账',
    'account_event.reconcile_cancel': '取消入账对账',
    'account_event.refund': '登记退款',
    'commission.release': '释放佣金',
    'commission.block': '阻断佣金',
    'commission.clawback': '追回佣金',
    'withdrawal.approve': '通过提现审核',
    'withdrawal.reject': '驳回提现',
    'withdrawal.paid': '登记打款',
    'risk_case.create': '创建风控单',
    'risk_case.update': '更新风控单',
    'enterprise_monthly_settlement.generate': '生成大客户月结',
  }
  return (value && labels[value]) || value || '-'
}

export function riskTypeText(value: string | null | undefined): string {
  if (!value) return '-'
  const labels: Record<string, string> = {
    abnormal_registration: riskCaseTypes.abnormalRegistration,
    related_account: riskCaseTypes.relatedAccount,
    abnormal_usage: riskCaseTypes.abnormalUsage,
    payment_dispute: riskCaseTypes.paymentDispute,
    commission_risk: riskCaseTypes.commissionRisk,
    withdrawal_risk: riskCaseTypes.withdrawalRisk,
    manual_review: riskCaseTypes.manualReview,
  }
  if (labels[value]) return labels[value]
  if (/[\u4e00-\u9fff]/.test(value)) return value
  return '其他风险'
}
