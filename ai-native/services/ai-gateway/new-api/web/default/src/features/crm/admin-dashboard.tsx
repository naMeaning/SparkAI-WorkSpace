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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { crmApi } from './api'
import { CrmState, MetricGrid, money } from './shared-ui'

export function AdminDashboard() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['crm', 'admin-dashboard'],
    queryFn: crmApi.dashboardSummary,
  })
  const data = query.data
  if (query.isLoading) {
    return <CrmState kind='loading' title={t('正在加载经营数据')} />
  }
  if (query.isError) {
    return (
      <CrmState
        kind='error'
        title={t('经营数据加载失败')}
        description={t('请重试；账务数据不会在加载失败时显示为零。')}
        onRetry={() => {
          void query.refetch()
        }}
      />
    )
  }
  return (
    <MetricGrid
      items={[
        { label: '用户数', value: data?.userCount ?? '-' },
        { label: '代理数', value: data?.agentCount ?? '-' },
        {
          label: '实付入账',
          value: data ? `${money(data.paidTopupRmb)} 元` : '-',
        },
        {
          label: '冻结佣金',
          value: data ? `${money(data.frozenCommissionRmb)} 元` : '-',
        },
        {
          label: '可提现佣金',
          value: data ? `${money(data.releasableCommissionRmb)} 元` : '-',
        },
        {
          label: '已打款佣金',
          value: data ? `${money(data.releasedCommissionRmb)} 元` : '-',
        },
        {
          label: '待处理提现',
          value: data ? `${money(data.pendingWithdrawalRmb)} 元` : '-',
        },
        {
          label: '需人工对账',
          value: data?.reconcileRequiredAccountEvents ?? '-',
        },
        { label: '待审核充值', value: data?.pendingOfflineRecharges ?? '-' },
        {
          label: '提现队列',
          value: data
            ? `${data.pendingWithdrawals} 待审核 / ${data.approvedWithdrawals} 待打款`
            : '-',
        },
        { label: '打开风控', value: data?.openRiskCases ?? '-' },
      ]}
    />
  )
}
