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
import { useState, useEffect, useCallback } from 'react'
import { Receipt } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getSelf } from '@/lib/api'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { BillingHistoryDialog } from './components/dialogs/billing-history-dialog'
import { WalletStatsCard } from './components/wallet-stats-card'
import type { UserWalletData } from './types'

interface WalletProps {
  initialShowHistory?: boolean
}

export function Wallet(props: WalletProps) {
  const { t } = useTranslation()
  const [user, setUser] = useState<UserWalletData | null>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [billingDialogOpen, setBillingDialogOpen] = useState(false)

  // Fetch and refresh user data
  const fetchUser = useCallback(async () => {
    try {
      setUserLoading(true)
      const response = await getSelf()
      if (response.success && response.data) {
        setUser(response.data as UserWalletData)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch user data:', error)
    } finally {
      setUserLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  useEffect(() => {
    if (props.initialShowHistory) {
      setBillingDialogOpen(true)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [props.initialShowHistory])

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Wallet')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setBillingDialogOpen(true)}
            className='gap-2'
          >
            <Receipt className='h-4 w-4' />
            {t('Billing History')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5'>
            <WalletStatsCard user={user} loading={userLoading} />
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <BillingHistoryDialog
        open={billingDialogOpen}
        onOpenChange={setBillingDialogOpen}
      />
    </>
  )
}
