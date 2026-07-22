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
import type { CrmUserDto } from '@ai-native/crm-contracts'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import { crmApi } from './api'

export function UserPicker(props: {
  name: string
  label: string
  required?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<CrmUserDto | null>(null)
  const [invalid, setInvalid] = useState(false)
  const listId = `${props.name}-options`
  const inputId = `${props.name}-search`
  const query = useQuery({
    queryKey: ['crm', 'user-picker', props.name, keyword],
    queryFn: () => crmApi.users({ page: 1, pageSize: 8, keyword }),
    enabled: open,
  })

  function search() {
    setKeyword(draft)
    setOpen(true)
  }

  return (
    <div className='grid min-w-0 gap-1.5'>
      <input
        name={props.name}
        type='text'
        className='sr-only'
        tabIndex={-1}
        required={props.required}
        value={selected?.crmUserId || ''}
        onChange={() => {}}
        onInvalid={(event) => {
          event.preventDefault()
          setInvalid(true)
          setOpen(true)
        }}
      />
      <Label htmlFor={inputId}>{props.label}</Label>
      <div
        className='relative'
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setOpen(false)
          }
        }}
      >
        <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-2'>
          <Input
            id={inputId}
            value={draft}
            type='search'
            role='combobox'
            aria-controls={listId}
            aria-expanded={open}
            aria-invalid={invalid}
            aria-autocomplete='list'
            autoComplete='new-password'
            data-form-type='other'
            data-1p-ignore='true'
            data-lpignore='true'
            placeholder={props.placeholder || '搜索用户名 / 邮箱'}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setDraft(event.currentTarget.value)
              if (selected) setSelected(null)
              setInvalid(false)
              setOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                search()
              }
              if (event.key === 'Escape') {
                setOpen(false)
              }
            }}
          />
          <Button type='button' variant='outline' onClick={search}>
            查找
          </Button>
        </div>
        {open ? (
          <div
            id={listId}
            role='listbox'
            className='bg-popover text-popover-foreground absolute top-full z-20 mt-1 grid max-h-44 w-full gap-1 overflow-auto rounded-md border p-1 shadow-md'
          >
            {query.isLoading ? (
              <div className='text-muted-foreground px-2 py-1.5 text-xs'>
                加载中
              </div>
            ) : null}
            {query.data?.items.map((user) => (
              <Button
                key={user.crmUserId}
                type='button'
                variant='ghost'
                role='option'
                aria-selected={selected?.crmUserId === user.crmUserId}
                className={cn(
                  'h-auto min-h-9 w-full justify-start rounded-md px-2 py-1.5 text-left text-xs whitespace-normal',
                  selected?.crmUserId === user.crmUserId &&
                    'bg-accent text-accent-foreground'
                )}
                onClick={() => {
                  setSelected(user)
                  setInvalid(false)
                  setDraft('')
                  setOpen(false)
                }}
              >
                <span className='font-medium'>{user.username || '-'}</span>
                <span className='text-muted-foreground ml-2'>
                  {user.email || `用户 ${user.crmUserId}`}
                </span>
              </Button>
            ))}
            {!query.isLoading && !query.data?.items.length ? (
              <div className='text-muted-foreground px-2 py-1.5 text-xs'>
                暂无匹配用户
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {selected ? (
        <div className='flex min-w-0 items-center gap-2'>
          <Badge variant='secondary' className='max-w-full min-w-0 truncate'>
            已选择 {selected.username || `用户 ${selected.crmUserId}`}
          </Badge>
          <Button
            type='button'
            size='xs'
            variant='ghost'
            onClick={() => {
              setSelected(null)
              setInvalid(Boolean(props.required))
            }}
          >
            <X className='size-3' aria-hidden='true' />
            清除
          </Button>
        </div>
      ) : null}
      {invalid ? (
        <p className='text-destructive text-xs' role='alert'>
          请选择一个用户
        </p>
      ) : null}
    </div>
  )
}
