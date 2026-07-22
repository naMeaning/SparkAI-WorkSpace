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
import { createFileRoute, redirect } from '@tanstack/react-router'

import {
  CRM_ADMIN_SECTIONS,
  CRM_AGENT_SECTIONS,
  CRM_DEFAULT_ADMIN_SECTION,
  CRM_DEFAULT_AGENT_SECTION,
} from '@/components/layout/config/crm.config'
import { CrmPage } from '@/features/crm'
import { isNewApiSuperAdmin } from '@/lib/crm-access'
import { useAuthStore } from '@/stores/auth-store'

function defaultSectionForRole(role?: number) {
  return isNewApiSuperAdmin(role)
    ? CRM_DEFAULT_ADMIN_SECTION
    : CRM_DEFAULT_AGENT_SECTION
}

export const Route = createFileRoute('/_authenticated/crm/$section')({
  beforeLoad: ({ params }) => {
    const role = useAuthStore.getState().auth.user?.role
    const isSuperAdmin = isNewApiSuperAdmin(role)
    const isAgentSection = (CRM_AGENT_SECTIONS as readonly string[]).includes(
      params.section
    )
    const isAdminSection = (CRM_ADMIN_SECTIONS as readonly string[]).includes(
      params.section
    )

    if (isSuperAdmin ? isAdminSection : isAgentSection) {
      return
    }

    throw redirect({
      to: '/crm/$section',
      params: { section: defaultSectionForRole(role) },
    })
  },
  component: CrmSectionRoute,
})

function CrmSectionRoute() {
  const params = Route.useParams()
  return <CrmPage section={params.section} />
}
