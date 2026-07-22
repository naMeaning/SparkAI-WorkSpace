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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { crmApi } from './api'
import type { SectionFilters } from './section-config'

export function FilterForm(props: {
  children: ReactNode
  onChange: (filters: SectionFilters) => void
}) {
  const { t } = useTranslation()
  return (
    <form
      className='grid w-full min-w-0 grid-cols-1 items-end gap-3 md:flex md:w-auto md:flex-wrap md:justify-end md:gap-2 [&>*]:w-full [&>*]:min-w-0 md:[&>*]:w-auto'
      onSubmit={(event) => {
        event.preventDefault()
        const filters: SectionFilters = {}
        new FormData(event.currentTarget).forEach((value, key) => {
          const text = String(value).trim()
          if (text) filters[key] = text
        })
        props.onChange(filters)
      }}
      onReset={(event) => {
        const form = event.currentTarget
        queueMicrotask(() => {
          const filters: SectionFilters = {}
          new FormData(form).forEach((value, key) => {
            const text = String(value).trim()
            if (text) filters[key] = text
          })
          props.onChange(filters)
        })
      }}
    >
      {props.children}
      <div className='grid grid-cols-2 gap-2 md:flex'>
        <Button size='sm' variant='default' type='submit'>
          <Search className='size-3.5' aria-hidden='true' />
          {t('查询')}
        </Button>
        <Button size='sm' variant='ghost' type='reset'>
          <RotateCcw className='size-3.5' aria-hidden='true' />
          {t('重置')}
        </Button>
      </div>
    </form>
  )
}

export function useCrmAction() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      crmApi.postAction(path, body),
    onSuccess: () => {
      toast.success(t('操作已提交'))
      void queryClient.invalidateQueries({ queryKey: ['crm'] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t('操作失败，请重试')
      )
    },
  })
}

export function useCrmPatchAction() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      crmApi.patchAction(path, body),
    onSuccess: () => {
      toast.success(t('操作已提交'))
      void queryClient.invalidateQueries({ queryKey: ['crm'] })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t('操作失败，请重试')
      )
    },
  })
}
