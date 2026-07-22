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
  type AgentCustomerDto,
  type AgentDto,
  type CommissionDto,
  type OfflineRechargeRequestDto,
  type WithdrawalDto,
} from '@ai-native/crm-contracts'

import type { StaticDataTableColumn } from '@/components/data-table'

import { relationshipBindSourceText } from './display'
import {
  StatusBadge,
  commissionText,
  levelText,
  money,
  offlineMethodText,
  orderKindText,
  rate,
  userName,
  withdrawalMethodText,
} from './shared-ui'

export const agentTeamColumns: StaticDataTableColumn<AgentDto>[] = [
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
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
]

export const agentCustomerColumns: StaticDataTableColumn<AgentCustomerDto>[] = [
  {
    id: 'username',
    header: '客户',
    cell: (row) => row.customer.username || '-',
  },
  { id: 'email', header: '邮箱', cell: (row) => row.customer.email || '-' },
  {
    id: 'agent',
    header: '代理',
    cell: (row) =>
      userName(row.relationship.agentUsername, row.relationship.agentCrmUserId),
  },
  {
    id: 'source',
    header: '绑定来源',
    cell: (row) => relationshipBindSourceText(row.relationship.bindSource),
  },
]

export const agentCommissionColumns: StaticDataTableColumn<CommissionDto>[] = [
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

export const agentWithdrawalColumns: StaticDataTableColumn<WithdrawalDto>[] = [
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

export const agentOfflineRechargeColumns: StaticDataTableColumn<OfflineRechargeRequestDto>[] =
  [
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
