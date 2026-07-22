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
import type { CrmSessionDto } from '@ai-native/crm-contracts'

import type { CrmSection } from '@/components/layout/config/crm.config'
import { formatLogQuota } from '@/lib/format'

import { crmApi, type NewApiUsageLogDto } from './api'
import {
  agentCommissionColumns,
  agentCustomerColumns,
  agentOfflineRechargeColumns,
  agentTeamColumns,
  agentWithdrawalColumns,
} from './agent-columns'
import { AgentOverview } from './agent-overview'
import { DataSection } from './data-section'

export function AgentSection({
  section,
  session,
}: {
  section: CrmSection
  session: CrmSessionDto
}) {
  if (section === 'agent-overview') return <AgentOverview session={session} />
  if (section === 'agent-customers') {
    return (
      <DataSection
        title='客户列表'
        queryKey='agent-customers'
        queryFn={crmApi.agentCustomers}
        columns={agentCustomerColumns}
        searchable
      />
    )
  }
  if (section === 'agent-team') {
    return (
      <DataSection
        title='团队代理列表'
        queryKey='agent-team'
        queryFn={crmApi.agentSubAgents}
        columns={agentTeamColumns}
      />
    )
  }
  if (section === 'agent-commissions') {
    return (
      <DataSection
        title='佣金记录'
        queryKey='agent-commissions'
        queryFn={crmApi.agentCommissions}
        columns={agentCommissionColumns}
      />
    )
  }
  if (section === 'agent-withdrawals') {
    return (
      <DataSection
        title='提现申请记录'
        queryKey='agent-withdrawals'
        queryFn={crmApi.agentWithdrawals}
        columns={agentWithdrawalColumns}
      />
    )
  }
  if (section === 'agent-offline-recharges') {
    return (
      <DataSection
        title='充值申请记录'
        queryKey='agent-offline-recharges'
        queryFn={crmApi.agentOfflineRecharges}
        columns={agentOfflineRechargeColumns}
      />
    )
  }
  return (
    <DataSection
      title='原生用量流水'
      queryKey='agent-usage'
      queryFn={crmApi.usageLogs}
      columns={[
        {
          id: 'model',
          header: '模型',
          cell: (row: NewApiUsageLogDto) => row.modelName || '-',
        },
        {
          id: 'quota',
          header: '额度',
          cell: (row: NewApiUsageLogDto) => formatLogQuota(row.quota || 0),
        },
        {
          id: 'tokens',
          header: 'Token',
          cell: (row: NewApiUsageLogDto) =>
            `${row.promptTokens || 0} / ${row.completionTokens || 0}`,
        },
        {
          id: 'createdAt',
          header: '时间',
          cell: (row: NewApiUsageLogDto) =>
            row.createdAt ? new Date(row.createdAt).toLocaleString() : '-',
        },
      ]}
    />
  )
}
