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
import {
  agentCategories,
  commissionTypes,
  ledgerDirections,
  signupTrialGrantStatuses,
  type AccountEventDto,
  type AgentDto,
  type AuditLogEntryDto,
  type CommissionDto,
  type CrmUserDto,
  type EffectiveCustomerDto,
  type EnterpriseMonthlySettlementDto,
  type LedgerEntryDto,
  type OfflineRechargeRequestDto,
  type RiskCaseDto,
  type WithdrawalDto,
} from '@ai-native/crm-contracts'

import type { StaticDataTableColumn } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'

import {
  auditActionText,
  ledgerSourceText,
  relationshipBindSourceText,
  riskTypeText,
  targetText,
} from './display'
import {
  StatusBadge,
  commissionText,
  eventTypeText,
  firstTopupBenefitText,
  ledgerTypeText,
  levelText,
  money,
  offlineMethodText,
  orderKindText,
  rate,
  userName,
  withdrawalMethodText,
} from './shared-ui'

export const userColumns: StaticDataTableColumn<CrmUserDto>[] = [
  { id: 'id', header: '用户ID', cell: (row) => row.crmUserId },
  { id: 'username', header: '用户名', cell: (row) => row.username || '-' },
  { id: 'email', header: '邮箱', cell: (row) => row.email || '-' },
  {
    id: 'paid',
    header: '累计实付',
    cell: (row) => `${money(row.cumulativePaidRmb)} 元`,
  },
  {
    id: 'discount',
    header: '首充权益',
    cell: (row) =>
      firstTopupBenefitText(
        row.firstTopupDiscountAvailable,
        row.firstTopupDiscountRate
      ),
  },
  {
    id: 'trial',
    header: '试用金',
    cell: (row) =>
      row.signupTrialGrantStatus === signupTrialGrantStatuses.pending
        ? '待发放'
        : '已发放',
  },
  {
    id: 'agent',
    header: '代理',
    cell: (row) => (row.agent ? levelText(row.agent.level) : '-'),
  },
  {
    id: 'risk',
    header: '状态',
    cell: (row) =>
      row.isRisk ? (
        <Badge variant='destructive'>受限</Badge>
      ) : (
        <Badge variant='secondary'>正常</Badge>
      ),
  },
]

export const relationshipColumns: StaticDataTableColumn<CrmUserDto>[] = [
  {
    id: 'customer',
    header: '客户',
    cell: (row) => row.username || '-',
  },
  { id: 'email', header: '邮箱', cell: (row) => row.email || '-' },
  {
    id: 'agent',
    header: '归属代理',
    cell: (row) =>
      row.agentRelationship
        ? userName(
            row.agentRelationship.agentUsername,
            row.agentRelationship.agentCrmUserId
          )
        : '-',
  },
  {
    id: 'source',
    header: '绑定来源',
    cell: (row) =>
      row.agentRelationship
        ? relationshipBindSourceText(row.agentRelationship?.bindSource)
        : '-',
  },
  {
    id: 'discount',
    header: '首充权益',
    cell: (row) =>
      firstTopupBenefitText(
        row.firstTopupDiscountAvailable,
        row.firstTopupDiscountRate
      ),
  },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.agentRelationship?.status} />,
  },
]

export const agentColumns: StaticDataTableColumn<AgentDto>[] = [
  { id: 'id', header: '代理ID', cell: (row) => row.id },
  {
    id: 'user',
    header: '用户',
    cell: (row) => userName(row.username, row.crmUserId),
  },
  { id: 'level', header: '等级', cell: (row) => levelText(row.level) },
  {
    id: 'category',
    header: '类型',
    cell: (row) =>
      row.category === agentCategories.strategic ? '深度合作代理' : '普通代理',
  },
  {
    id: 'customers',
    header: '有效客户',
    cell: (row) => row.effectivePaidCustomerCount,
  },
  {
    id: 'parent',
    header: '上级',
    cell: (row) => userName(row.parentAgentUsername, row.parentAgentCrmUserId),
  },
  {
    id: 'invite',
    header: '邀请码',
    cell: (row) => <Badge variant='outline'>{row.inviteCode}</Badge>,
  },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
]

export const commissionColumns: StaticDataTableColumn<CommissionDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id || '-' },
  {
    id: 'beneficiary',
    header: '受益用户',
    cell: (row) => userName(row.beneficiaryUsername, row.beneficiaryCrmUserId),
  },
  {
    id: 'customer',
    header: '客户',
    cell: (row) => userName(row.customerUsername, row.customerCrmUserId),
  },
  {
    id: 'type',
    header: '类型',
    cell: (row) => commissionText(row.commissionType),
  },
  { id: 'order', header: '订单', cell: (row) => orderKindText(row.orderKind) },
  {
    id: 'rate',
    header: '比例/单价',
    cell: (row) =>
      row.commissionType === commissionTypes.enterpriseFixedPerImage
        ? `${money(row.rate)} 元/张`
        : rate(row.rate),
  },
  { id: 'amount', header: '佣金', cell: (row) => `${money(row.amountRmb)} 元` },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
]

export const withdrawalColumns: StaticDataTableColumn<WithdrawalDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id },
  {
    id: 'user',
    header: '用户',
    cell: (row) => userName(row.beneficiaryUsername, row.beneficiaryCrmUserId),
  },
  { id: 'amount', header: '金额', cell: (row) => `${money(row.amountRmb)} 元` },
  {
    id: 'method',
    header: '方式',
    cell: (row) => withdrawalMethodText(row.payoutMethod),
  },
  { id: 'account', header: '账号', cell: (row) => row.payoutAccount || '-' },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
  { id: 'reason', header: '备注', cell: (row) => row.reviewReason || '-' },
]

export const offlineRechargeColumns: StaticDataTableColumn<OfflineRechargeRequestDto>[] =
  [
    { id: 'id', header: 'ID', cell: (row) => row.id },
    {
      id: 'user',
      header: '用户',
      cell: (row) => userName(row.crmUsername, row.crmUserId),
    },
    {
      id: 'method',
      header: '方式',
      cell: (row) => offlineMethodText(row.method),
    },
    {
      id: 'amount',
      header: '金额',
      cell: (row) => `${money(row.amountRmb)} 元`,
    },
    {
      id: 'reference',
      header: '凭证',
      cell: (row) => row.paymentReference || '-',
    },
    {
      id: 'status',
      header: '状态',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: 'review',
      header: '审核备注',
      cell: (row) => row.reviewReason || '-',
    },
  ]

export const accountEventColumns: StaticDataTableColumn<AccountEventDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id },
  { id: 'type', header: '类型', cell: (row) => eventTypeText(row.eventType) },
  {
    id: 'user',
    header: '用户',
    cell: (row) => userName(row.crmUsername, row.crmUserId),
  },
  { id: 'amount', header: '金额', cell: (row) => `${money(row.amountRmb)} 元` },
  {
    id: 'paid',
    header: '实付',
    cell: (row) => `${money(row.paidAmountRmb)} 元`,
  },
  { id: 'quota', header: '额度变化', cell: (row) => row.quotaDelta },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
  { id: 'reason', header: '原因', cell: (row) => row.reason || '-' },
]

export const ledgerColumns: StaticDataTableColumn<LedgerEntryDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id },
  {
    id: 'user',
    header: '用户',
    cell: (row) => userName(row.crmUsername, row.crmUserId),
  },
  {
    id: 'direction',
    header: '方向',
    cell: (row) =>
      row.direction === ledgerDirections.credit ? '入账' : '扣减',
  },
  { id: 'amount', header: '金额', cell: (row) => `${money(row.amountRmb)} 元` },
  { id: 'type', header: '类型', cell: (row) => ledgerTypeText(row.eventType) },
  {
    id: 'source',
    header: '来源',
    cell: (row) => ledgerSourceText(row.sourceType, row.sourceId),
  },
  { id: 'reason', header: '原因', cell: (row) => row.reason || '-' },
]

export const effectiveColumns: StaticDataTableColumn<EffectiveCustomerDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id },
  {
    id: 'agent',
    header: '代理',
    cell: (row) => userName(row.agentUsername, row.agentCrmUserId),
  },
  {
    id: 'customer',
    header: '客户',
    cell: (row) => userName(row.customerUsername, row.customerCrmUserId),
  },
  {
    id: 'paid',
    header: '首付',
    cell: (row) => `${money(row.firstPaidAmountRmb)} 元`,
  },
  {
    id: 'rate',
    header: '消耗比例',
    cell: (row) => rate(row.paidBalanceConsumedRate),
  },
  {
    id: 'effective',
    header: '有效',
    cell: (row) => (
      <Badge variant={row.isEffective ? 'secondary' : 'outline'}>
        {row.isEffective ? '有效' : '未达标'}
      </Badge>
    ),
  },
  {
    id: 'counted',
    header: '计入等级',
    cell: (row) => (row.countedForLevel ? '是' : '否'),
  },
]

export const enterpriseColumns: StaticDataTableColumn<EnterpriseMonthlySettlementDto>[] =
  [
    { id: 'id', header: 'ID', cell: (row) => row.id },
    { id: 'period', header: '周期', cell: (row) => row.period },
    {
      id: 'user',
      header: '客户',
      cell: (row) => userName(row.crmUsername, row.crmUserId),
    },
    {
      id: 'usage',
      header: '用量金额',
      cell: (row) => `${money(row.usageRmb)} 元`,
    },
    { id: 'count', header: '流水数', cell: (row) => row.ledgerEntryCount },
    {
      id: 'status',
      header: '状态',
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ]

export const riskColumns: StaticDataTableColumn<RiskCaseDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id },
  {
    id: 'target',
    header: '对象',
    cell: (row) => targetText(row.targetType, row.targetId),
  },
  { id: 'type', header: '风险类型', cell: (row) => riskTypeText(row.riskType) },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
  {
    id: 'withdrawal',
    header: '阻断提现',
    cell: (row) => (row.blocksWithdrawal ? '是' : '否'),
  },
  {
    id: 'commission',
    header: '阻断佣金',
    cell: (row) => (row.blocksCommissionRelease ? '是' : '否'),
  },
  { id: 'notes', header: '备注', cell: (row) => row.notes || '-' },
]

export const auditColumns: StaticDataTableColumn<AuditLogEntryDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id },
  {
    id: 'operator',
    header: '操作人',
    cell: (row) => userName(row.operatorUsername, row.operatorCrmUserId),
  },
  {
    id: 'target',
    header: '对象',
    cell: (row) => targetText(row.targetType, row.targetId),
  },
  { id: 'action', header: '动作', cell: (row) => auditActionText(row.action) },
  { id: 'reason', header: '原因', cell: (row) => row.reason || '-' },
  { id: 'time', header: '时间', cell: (row) => row.createdAt || '-' },
]
