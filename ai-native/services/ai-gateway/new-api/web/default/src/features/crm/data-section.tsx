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
import type { PageResult } from '@ai-native/crm-contracts'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, LoaderCircle, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  StaticDataTable,
  staticDataTableClassNames,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { pageSize, type SectionFilters } from './section-config'
import { CrmState, Panel } from './shared-ui'

export function TablePanel<T>(props: {
  title: string
  data?: PageResult<T>
  loading?: boolean
  fetching?: boolean
  error?: boolean
  onRetry?: () => void
  columns: StaticDataTableColumn<T>[]
  page: number
  onPageChange: (page: number) => void
  search?: string
  onSearchChange?: (value: string) => void
  onSearchSubmit?: () => void
  onSearchReset?: () => void
  actions?: ReactNode
}) {
  const { t } = useTranslation()
  const [toolbarOpen, setToolbarOpen] = useState(false)
  const items = props.data?.items || []
  const total = props.data?.total || 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const hasToolbar = Boolean(props.onSearchChange || props.actions)
  let toolbarLayoutClass = 'lg:max-w-md'
  if (props.onSearchChange && props.actions) {
    toolbarLayoutClass = 'lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]'
  } else if (props.actions) {
    toolbarLayoutClass = 'lg:justify-items-end'
  }

  let tableContent: ReactNode
  if (props.error) {
    tableContent = (
      <CrmState
        kind='error'
        title={t('数据加载失败')}
        description={t('请检查服务状态后重试，当前页面不会丢失搜索条件。')}
        onRetry={props.onRetry}
      />
    )
  } else if (props.loading) {
    tableContent = <CrmState kind='loading' title={t('正在加载数据')} />
  } else if (items.length === 0) {
    tableContent = (
      <CrmState
        kind='empty'
        title={t('暂无数据')}
        description={t('可以调整筛选条件，或稍后刷新页面。')}
      />
    )
  } else {
    tableContent = (
      <StaticDataTable
        columns={props.columns}
        data={items}
        mobileCards
        className={staticDataTableClassNames.embeddedContainer}
      />
    )
  }

  return (
    <Panel title={props.title} bodyClassName='p-0 sm:p-0'>
      {hasToolbar ? (
        <div className='bg-muted/10 border-b p-3 sm:p-4'>
          <div
            className={cn(
              'grid min-w-0 gap-3 lg:items-end',
              toolbarLayoutClass
            )}
          >
            {props.onSearchChange ? (
              <div className='grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2'>
                <Input
                  value={props.search || ''}
                  type='search'
                  aria-label={t('搜索')}
                  onChange={(event) =>
                    props.onSearchChange?.(event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      props.onSearchSubmit?.()
                    }
                  }}
                  placeholder={t('搜索用户名、邮箱或关键字')}
                />
                <Button
                  size='sm'
                  variant='default'
                  type='button'
                  onClick={props.onSearchSubmit}
                >
                  <Search className='size-3.5' aria-hidden='true' />
                  {t('搜索')}
                </Button>
                {props.search ? (
                  <Button
                    size='sm'
                    variant='ghost'
                    type='button'
                    className='col-span-2 sm:col-span-1'
                    onClick={props.onSearchReset}
                  >
                    <X className='size-3.5' aria-hidden='true' />
                    {t('清除搜索')}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {props.actions ? (
              <div className='grid min-w-0 gap-3 lg:justify-items-end'>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  className='w-full justify-between md:hidden'
                  aria-expanded={toolbarOpen}
                  onClick={() => setToolbarOpen((open) => !open)}
                >
                  <span className='inline-flex items-center gap-2'>
                    <SlidersHorizontal className='size-4' aria-hidden='true' />
                    {t('筛选与操作')}
                  </span>
                  <ChevronDown
                    className={cn(
                      'size-4 transition-transform',
                      toolbarOpen && 'rotate-180'
                    )}
                    aria-hidden='true'
                  />
                </Button>
                <div
                  className={cn(
                    'min-w-0 rounded-lg border p-3 md:block md:border-0 md:p-0',
                    toolbarOpen ? 'block' : 'hidden'
                  )}
                >
                  <div className='flex min-w-0 flex-col items-stretch gap-3 md:flex-row md:flex-wrap md:items-end md:justify-end md:gap-2'>
                    {props.actions}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className='min-w-0 p-3 sm:p-4'>
        {props.fetching ? (
          <div
            className='text-muted-foreground mb-2 flex items-center justify-end gap-1.5 text-xs'
            role='status'
            aria-live='polite'
          >
            <LoaderCircle
              className='size-3.5 animate-spin'
              aria-hidden='true'
            />
            {t('正在更新')}
          </div>
        ) : null}
        {tableContent}
        {!props.error && !props.loading && total > 0 ? (
          <div className='mt-3 flex flex-col gap-3 border-t pt-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-2'>
            <span className='text-muted-foreground'>
              {t('共 {{total}} 条，第 {{page}} / {{pageCount}} 页', {
                total,
                page: props.page,
                pageCount,
              })}
            </span>
            <div className='grid grid-cols-2 items-center gap-2 sm:flex'>
              <Button
                size='sm'
                variant='outline'
                disabled={props.page <= 1}
                onClick={() => props.onPageChange(props.page - 1)}
              >
                {t('上一页')}
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={props.page >= pageCount}
                onClick={() => props.onPageChange(props.page + 1)}
              >
                {t('下一页')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  )
}

export function useCrmSessionState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return fallback
    try {
      const stored = window.sessionStorage.getItem(`crm-ui:${key}`)
      return stored === null ? fallback : (JSON.parse(stored) as T)
    } catch {
      return fallback
    }
  })

  useEffect(() => {
    try {
      window.sessionStorage.setItem(`crm-ui:${key}`, JSON.stringify(value))
    } catch {
      // Session storage is optional; the page remains fully usable without it.
    }
  }, [key, value])

  return [value, setValue] as const
}

export function DataSection<T>(props: {
  title: string
  queryKey: string
  queryFn: (
    params: {
      page: number
      pageSize: number
      keyword?: string
    } & SectionFilters
  ) => Promise<PageResult<T>>
  columns: StaticDataTableColumn<T>[]
  searchable?: boolean
  actions?: ReactNode
  filters?: SectionFilters
}) {
  const [page, setPage] = useCrmSessionState(`${props.queryKey}:page`, 1)
  const [draft, setDraft] = useCrmSessionState(
    `${props.queryKey}:search-draft`,
    ''
  )
  const [keyword, setKeyword] = useCrmSessionState(
    `${props.queryKey}:search`,
    ''
  )
  const query = useQuery({
    queryKey: ['crm', props.queryKey, page, keyword, props.filters],
    queryFn: () => props.queryFn({ page, pageSize, keyword, ...props.filters }),
    placeholderData: (previousData) => previousData,
  })
  useEffect(() => {
    setPage(1)
  }, [props.filters, setPage])
  useEffect(() => {
    if (!query.data) return
    const lastPage = Math.max(1, Math.ceil(query.data.total / pageSize))
    if (page > lastPage) setPage(lastPage)
  }, [page, query.data, setPage])
  return (
    <TablePanel
      title={props.title}
      data={query.data}
      loading={query.isLoading}
      fetching={query.isFetching && !query.isLoading}
      error={query.isError}
      onRetry={() => {
        void query.refetch()
      }}
      columns={props.columns}
      page={page}
      onPageChange={setPage}
      search={props.searchable ? draft : undefined}
      onSearchChange={props.searchable ? setDraft : undefined}
      onSearchSubmit={
        props.searchable
          ? () => {
              setPage(1)
              setKeyword(draft)
            }
          : undefined
      }
      onSearchReset={
        props.searchable
          ? () => {
              setPage(1)
              setDraft('')
              setKeyword('')
            }
          : undefined
      }
      actions={props.actions}
    />
  )
}
