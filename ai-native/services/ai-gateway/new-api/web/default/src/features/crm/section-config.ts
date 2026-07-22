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
import { riskCaseTypes, riskTargetTypes } from '@ai-native/crm-contracts'

import {
  CRM_ADMIN_SECTIONS,
  CRM_AGENT_SECTIONS,
  CRM_DEFAULT_ADMIN_SECTION,
  CRM_DEFAULT_AGENT_SECTION,
  type CrmSection,
} from '@/components/layout/config/crm.config'

export const pageSize = 20

export type SectionFilters = Record<
  string,
  string | number | boolean | null | undefined
>

export const sectionTitles: Record<CrmSection, string> = {
  'agent-overview': '经营概览',
  'agent-customers': '我的客户',
  'agent-team': '团队代理',
  'agent-commissions': '佣金明细',
  'agent-withdrawals': '提现记录',
  'agent-offline-recharges': '线下充值',
  'agent-usage': '用量流水',
  'admin-dashboard': '经营概览',
  users: '分销档案',
  agents: '代理管理',
  relationships: '客户归属',
  'effective-customers': '有效客户',
  'account-events': '入账事件',
  ledger: '账本流水',
  commissions: '佣金管理',
  'offline-recharges': '线下充值审核',
  withdrawals: '提现审核',
  risk: '风控',
  enterprise: '大客户',
  audit: '审计日志',
  settings: '分销规则',
}

export const sectionDescriptions: Record<CrmSection, string> = {
  'agent-overview':
    '查看分销收益、可提现佣金与收款信息。模型余额和原生用量仍由 New API 提供。',
  'agent-customers': '查看当前归属客户与邀请关系。',
  'agent-team': '查看直属团队代理、等级与有效客户进度。',
  'agent-commissions': '查看佣金来源、冻结、可提现和已结清状态。',
  'agent-withdrawals': '跟踪提现审核、打款与驳回记录。',
  'agent-offline-recharges': '提交并跟踪线下充值申请，不在此页面展示模型余额。',
  'agent-usage': '直接查看 New API 原生用量流水。',
  'admin-dashboard':
    '聚合分销经营、结算待办与风控状态；CRM 账本不等同于用户模型余额。',
  users:
    '维护分销资料、首充权益和风险标记；账号身份、角色与 quota 仍在用户管理中维护。',
  agents: '维护代理类型、层级与启停状态。',
  relationships: '管理客户与代理的唯一归属关系。',
  'effective-customers': '复核付费与消耗条件，决定客户是否计入代理等级。',
  'account-events':
    '跟踪 CRM 业务入账与 New API quota 协同状态；不明确结果必须人工对账。',
  ledger: '查看 CRM 业务账本流水；这里的金额不是 New API 用户余额快照。',
  commissions: '管理佣金冻结、释放、阻断、追回与提现结清。',
  'offline-recharges':
    '审核线下到账凭证，通过后协同增加 New API quota 并写入 CRM 账本。',
  withdrawals: '审核提现并登记线下打款凭证。',
  risk: '处理分销、佣金与提现风险；模型调用限制仍需在 New API 执行。',
  enterprise: '生成并审核大客户月结单，登记线下收款结果。',
  audit: '追踪 CRM 运营动作、对象与原因。',
  settings: '配置分销佣金、提现门槛与线下收款信息。',
}

export const riskTargetTypeOptions = [
  { value: riskTargetTypes.user, label: '用户' },
  { value: riskTargetTypes.agent, label: '代理' },
  { value: riskTargetTypes.agentRelationship, label: '客户归属' },
  { value: riskTargetTypes.accountEvent, label: '入账事件' },
  { value: riskTargetTypes.commission, label: '佣金' },
  { value: riskTargetTypes.withdrawal, label: '提现' },
  {
    value: riskTargetTypes.enterpriseMonthlySettlement,
    label: '大客户月结',
  },
]

export const riskCaseTypeOptions = [
  { value: riskCaseTypes.abnormalRegistration, label: '异常注册' },
  { value: riskCaseTypes.relatedAccount, label: '关联账号' },
  { value: riskCaseTypes.abnormalUsage, label: '异常用量' },
  { value: riskCaseTypes.paymentDispute, label: '支付争议' },
  { value: riskCaseTypes.commissionRisk, label: '佣金风险' },
  { value: riskCaseTypes.withdrawalRisk, label: '提现风险' },
  { value: riskCaseTypes.manualReview, label: '人工复核' },
]

export function isAdminSection(
  section: string
): section is (typeof CRM_ADMIN_SECTIONS)[number] {
  return CRM_ADMIN_SECTIONS.includes(
    section as (typeof CRM_ADMIN_SECTIONS)[number]
  )
}

// oxlint-disable-next-line react/only-export-components -- routes and regression tests share this pure resolver.
export function resolveCrmSection(
  section?: string,
  isSuperAdmin = false
): CrmSection {
  if (isSuperAdmin) {
    if (section && isAdminSection(section)) {
      return section
    }
    return CRM_DEFAULT_ADMIN_SECTION
  }
  if (
    section &&
    CRM_AGENT_SECTIONS.includes(section as (typeof CRM_AGENT_SECTIONS)[number])
  ) {
    return section as CrmSection
  }
  return CRM_DEFAULT_AGENT_SECTION
}
