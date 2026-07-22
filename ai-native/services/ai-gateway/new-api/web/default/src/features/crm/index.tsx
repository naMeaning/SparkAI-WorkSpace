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
import { crmPageCapabilities } from '@ai-native/crm-contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { AdminSection } from './admin-section'
import { AgentSection } from './agent-section'
import { crmApi } from './api'
import {
  isAdminSection,
  resolveCrmSection,
  sectionDescriptions,
  sectionTitles,
} from './section-config'
import { CrmState } from './shared-ui'

export { resolveCrmSection } from './section-config'

export function CrmPage({ section: requestedSection }: { section?: string }) {
  const { t } = useTranslation()
  const authUserRole = useAuthStore((state) => state.auth.user?.role)
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const isNewApiSuperAdmin = (authUserRole || 0) >= ROLE.SUPER_ADMIN
  const section = resolveCrmSection(requestedSection, isNewApiSuperAdmin)
  const sessionQuery = useQuery({
    queryKey: ['crm', 'session'],
    queryFn: crmApi.session,
  })
  const session = sessionQuery.data
  const isCrmSuperAdmin =
    isNewApiSuperAdmin &&
    Boolean(session?.capabilities.includes(crmPageCapabilities.superAdmin))
  const effectiveSection = useMemo(
    () => resolveCrmSection(section, isCrmSuperAdmin),
    [section, isCrmSuperAdmin]
  )

  async function refreshWorkspace() {
    setRefreshing(true)
    try {
      await queryClient.refetchQueries({ queryKey: ['crm'], type: 'active' })
      toast.success(t('页面数据已刷新'))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('刷新失败，请重试')
      )
    } finally {
      setRefreshing(false)
    }
  }

  let workspaceContent: ReactNode
  if (sessionQuery.isLoading) {
    workspaceContent = (
      <CrmState kind='loading' title={t('正在加载 CRM 工作区')} />
    )
  } else if (sessionQuery.isError || !session) {
    workspaceContent = (
      <CrmState
        kind='error'
        title={t('CRM 工作区加载失败')}
        description={t('请检查登录状态和 CRM 服务后重试。')}
        onRetry={() => {
          void sessionQuery.refetch()
        }}
      />
    )
  } else if (isCrmSuperAdmin && isAdminSection(effectiveSection)) {
    workspaceContent = <AdminSection section={effectiveSection} />
  } else {
    workspaceContent = (
      <AgentSection section={effectiveSection} session={session} />
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t(sectionTitles[effectiveSection])}
      </SectionPageLayout.Title>
      <SectionPageLayout.Description>
        {t(sectionDescriptions[effectiveSection])}
      </SectionPageLayout.Description>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          className='min-w-20'
          disabled={refreshing}
          onClick={() => {
            void refreshWorkspace()
          }}
        >
          <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
          {refreshing ? t('刷新中') : t('刷新')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>{workspaceContent}</SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
