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
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

import { Panel } from './shared-ui'

export function ActionGroup(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid min-w-0 grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2 sm:flex sm:flex-wrap',
        '[&>[data-slot=button]]:w-full sm:[&>[data-slot=button]]:w-auto',
        props.className
      )}
    >
      {props.children}
    </div>
  )
}

export function Field(props: {
  label: string
  name: string
  type?: string
  required?: boolean
  placeholder?: string
  defaultValue?: string | number
  min?: string
  step?: string
  onChange?: (value: string) => void
}) {
  return (
    <div className='grid min-w-0 gap-1.5'>
      <Label htmlFor={props.name}>{props.label}</Label>
      <Input
        id={props.name}
        name={props.name}
        type={props.type || 'text'}
        required={props.required}
        placeholder={props.placeholder}
        defaultValue={props.defaultValue}
        min={props.min}
        step={props.step}
        onChange={(event) => props.onChange?.(event.currentTarget.value)}
      />
    </div>
  )
}

export function SelectField(props: {
  label: string
  name: string
  children: ReactNode
  required?: boolean
  defaultValue?: string
  onChange?: (value: string) => void
}) {
  return (
    <div className='grid min-w-0 gap-1.5'>
      <Label htmlFor={props.name}>{props.label}</Label>
      <NativeSelect
        id={props.name}
        name={props.name}
        required={props.required}
        defaultValue={props.defaultValue}
        onChange={(event) => props.onChange?.(event.currentTarget.value)}
        className='w-full'
      >
        {props.children}
      </NativeSelect>
    </div>
  )
}

export function CheckboxField(props: {
  label: string
  name: string
  defaultChecked?: boolean
  className?: string
}) {
  const id = `crm-${props.name}`
  return (
    <Label
      htmlFor={id}
      className={cn(
        'bg-muted/25 hover:bg-muted/35 flex min-h-10 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
        props.className
      )}
    >
      <Checkbox
        id={id}
        name={props.name}
        value='on'
        defaultChecked={props.defaultChecked}
      />
      <span className='min-w-0 leading-5'>{props.label}</span>
    </Label>
  )
}

export function formValue(form: FormData, key: string) {
  return String(form.get(key) || '').trim()
}

export function formNumber(form: FormData, key: string) {
  return Number(formValue(form, key))
}

export function SubmitForm(props: {
  title: string
  buttonText: string
  children: ReactNode
  onSubmit: (form: FormData) => Promise<void>
  fieldsClassName?: string
  submitContent?: ReactNode
  disabled?: boolean
}) {
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { t } = useTranslation()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    try {
      await props.onSubmit(new FormData(event.currentTarget))
      event.currentTarget.reset()
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : t('提交失败，请检查后重试')
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Panel title={props.title}>
      <form className='grid gap-4' onSubmit={submit}>
        <div
          className={
            props.fieldsClassName ||
            'grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4'
          }
        >
          {props.children}
        </div>
        {submitError ? (
          <Alert variant='destructive'>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}
        <div
          className={cn(
            'flex flex-col items-stretch gap-3 border-t pt-4 sm:flex-row sm:items-center',
            props.submitContent ? 'sm:justify-between' : 'sm:justify-end'
          )}
        >
          {props.submitContent}
          <Button
            type='submit'
            disabled={submitting || props.disabled}
            className='w-full sm:w-auto sm:min-w-32'
          >
            {submitting ? t('提交中') : props.buttonText}
          </Button>
        </div>
      </form>
    </Panel>
  )
}
