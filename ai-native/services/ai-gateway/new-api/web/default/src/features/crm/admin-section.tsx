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
import type { CrmSection } from '@/components/layout/config/crm.config'

import { ActionColumns } from './action-columns'
import { AdminDashboard } from './admin-dashboard'
import {
  AdminAccountEventsSection,
  AdminAuditSection,
  AdminCommissionsSection,
  AdminEffectiveCustomersSection,
  AdminEnterpriseSection,
  AdminLedgerSection,
  AdminOfflineRechargesSection,
  AdminRiskSection,
  AdminWithdrawalsSection,
} from './admin-data-sections'
import { AdminAgentsSection, AdminUsersSection } from './admin-editors'
import { AdminForms } from './admin-forms'
import { relationshipColumns } from './admin-columns'
import { crmApi } from './api'
import { DataSection } from './data-section'
import { SettingsSection } from './settings-section'

export function AdminSection({ section }: { section: CrmSection }) {
  const actions = ActionColumns()
  const body = (() => {
    if (section === 'admin-dashboard') {
      return <AdminDashboard />
    }
    if (section === 'users') {
      return <AdminUsersSection />
    }
    if (section === 'agents') {
      return <AdminAgentsSection />
    }
    if (section === 'relationships') {
      return (
        <DataSection
          title='归属关系列表'
          queryKey='relationships'
          queryFn={(params) =>
            crmApi.users({ ...params, hasAgentRelationship: true })
          }
          columns={relationshipColumns}
          searchable
        />
      )
    }
    if (section === 'effective-customers') {
      return <AdminEffectiveCustomersSection actions={actions} />
    }
    if (section === 'account-events') {
      return <AdminAccountEventsSection actions={actions} />
    }
    if (section === 'ledger') {
      return <AdminLedgerSection />
    }
    if (section === 'commissions') {
      return <AdminCommissionsSection actions={actions} />
    }
    if (section === 'offline-recharges') {
      return <AdminOfflineRechargesSection actions={actions} />
    }
    if (section === 'withdrawals') {
      return <AdminWithdrawalsSection actions={actions} />
    }
    if (section === 'risk') {
      return <AdminRiskSection actions={actions} />
    }
    if (section === 'enterprise') {
      return <AdminEnterpriseSection actions={actions} />
    }
    if (section === 'audit') {
      return <AdminAuditSection />
    }
    return <SettingsSection />
  })()
  return (
    <div className='grid gap-4'>
      {actions.dialog}
      <AdminForms section={section} />
      {body}
    </div>
  )
}
