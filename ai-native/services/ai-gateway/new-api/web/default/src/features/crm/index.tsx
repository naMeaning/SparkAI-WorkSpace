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
import {
  accountEventTypes,
  accountEventStatuses,
  agentCategories,
  agentStatuses,
  commissionStatuses,
  commissionTypes,
  crmPageCapabilities,
  enterpriseMonthlySettlementStatuses,
  ledgerDirections,
  ledgerEventTypes,
  offlineRechargeMethods,
  offlineRechargeStatuses,
  orderKinds,
  riskCaseTypes,
  riskStatuses,
  riskTargetTypes,
  signupTrialGrantStatuses,
  standardAgentLevelRules,
  withdrawalMethods,
  withdrawalStatuses,
  type AccountEventDto,
  type AgentCustomerDto,
  type AgentDto,
  type AuditLogEntryDto,
  type CommissionDto,
  type CrmAgentDashboardDto,
  type CrmSettingsDto,
  type CrmSessionDto,
  type CrmUserDto,
  type EffectiveCustomerDto,
  type EnterpriseMonthlySettlementDto,
  type LedgerEntryDto,
  type OfflineRechargeRequestDto,
  type PageResult,
  type RiskCaseDto,
  type WithdrawalDto,
} from '@ai-native/crm-contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ChevronDown,
  Inbox,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  StaticDataTable,
  staticDataTableClassNames,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { SectionPageLayout } from '@/components/layout'
import {
  CRM_ADMIN_SECTIONS,
  CRM_AGENT_SECTIONS,
  CRM_DEFAULT_ADMIN_SECTION,
  CRM_DEFAULT_AGENT_SECTION,
  type CrmSection,
} from '@/components/layout/config/crm.config'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { TitledCard } from '@/components/ui/titled-card'
import { getSelf } from '@/lib/api'
import { formatLogQuota, formatQuota } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { crmApi, type NewApiUsageLogDto } from './api'
import {
  auditActionText,
  ledgerSourceText,
  registrationInviteCode,
  relationshipBindSourceText,
  riskTypeText,
  targetText,
} from './display'
import {
  buildSettingsUpdatePayload,
  offlineRechargeFieldName,
  ruleFieldName,
  toPercentInputValue,
} from './settings-form'

const pageSize = 20

type SectionFilters = Record<
  string,
  string | number | boolean | null | undefined
>

const sectionTitles: Record<CrmSection, string> = {
  'agent-overview': '经营概览',
  'agent-customers': '我的客户',
  'agent-team': '团队代理',
  'agent-commissions': '佣金明细',
  'agent-withdrawals': '提现记录',
  'agent-offline-recharges': '线下充值',
  'agent-usage': '用量流水',
  'admin-dashboard': '经营概览',
  users: '分销档案',
  agents: '代理管理',
  relationships: '客户归属',
  'effective-customers': '有效客户',
  'account-events': '入账事件',
  ledger: '账本流水',
  commissions: '佣金管理',
  'offline-recharges': '线下充值审核',
  withdrawals: '提现审核',
  risk: '风控',
  enterprise: '大客户',
  audit: '审计日志',
  settings: '分销规则',
}

const sectionDescriptions: Record<CrmSection, string> = {
  'agent-overview':
    '查看分销收益、可提现佣金与收款信息。模型余额和原生用量仍由 New API 提供。',
  'agent-customers': '查看当前归属客户与邀请关系。',
  'agent-team': '查看直属团队代理、等级与有效客户进度。',
  'agent-commissions': '查看佣金来源、冻结、可提现和已结清状态。',
  'agent-withdrawals': '跟踪提现审核、打款与驳回记录。',
  'agent-offline-recharges': '提交并跟踪线下充值申请，不在此页面展示模型余额。',
  'agent-usage': '直接查看 New API 原生用量流水。',
  'admin-dashboard':
    '聚合分销经营、结算待办与风控状态；CRM 账本不等同于用户模型余额。',
  users:
    '维护分销资料、首充权益和风险标记；账号身份、角色与 quota 仍在用户管理中维护。',
  agents: '维护代理类型、层级与启停状态。',
  relationships: '管理客户与代理的唯一归属关系。',
  'effective-customers': '复核付费与消耗条件，决定客户是否计入代理等级。',
  'account-events':
    '跟踪 CRM 业务入账与 New API quota 协同状态；不明确结果必须人工对账。',
  ledger: '查看 CRM 业务账本流水；这里的金额不是 New API 用户余额快照。',
  commissions: '管理佣金冻结、释放、阻断、追回与提现结清。',
  'offline-recharges':
    '审核线下到账凭证，通过后协同增加 New API quota 并写入 CRM 账本。',
  withdrawals: '审核提现并登记线下打款凭证。',
  risk: '处理分销、佣金与提现风险；模型调用限制仍需在 New API 执行。',
  enterprise: '生成并审核大客户月结单，登记线下收款结果。',
  audit: '追踪 CRM 运营动作、对象与原因。',
  settings: '配置分销佣金、提现门槛与线下收款信息。',
}

const riskTargetTypeOptions = [
  { value: riskTargetTypes.user, label: '用户' },
  { value: riskTargetTypes.agent, label: '代理' },
  { value: riskTargetTypes.agentRelationship, label: '客户归属' },
  { value: riskTargetTypes.accountEvent, label: '入账事件' },
  { value: riskTargetTypes.commission, label: '佣金' },
  { value: riskTargetTypes.withdrawal, label: '提现' },
  {
    value: riskTargetTypes.enterpriseMonthlySettlement,
    label: '大客户月结',
  },
]

const riskCaseTypeOptions = [
  { value: riskCaseTypes.abnormalRegistration, label: '异常注册' },
  { value: riskCaseTypes.relatedAccount, label: '关联账号' },
  { value: riskCaseTypes.abnormalUsage, label: '异常用量' },
  { value: riskCaseTypes.paymentDispute, label: '支付争议' },
  { value: riskCaseTypes.commissionRisk, label: '佣金风险' },
  { value: riskCaseTypes.withdrawalRisk, label: '提现风险' },
  { value: riskCaseTypes.manualReview, label: '人工复核' },
]

function isAdminSection(
  section: string
): section is (typeof CRM_ADMIN_SECTIONS)[number] {
  return CRM_ADMIN_SECTIONS.includes(
    section as (typeof CRM_ADMIN_SECTIONS)[number]
  )
}

// oxlint-disable-next-line react/only-export-components -- routes and regression tests share this pure resolver.
export function resolveCrmSection(
  section?: string,
  isSuperAdmin = false
): CrmSection {
  if (isSuperAdmin) {
    if (section && isAdminSection(section)) {
      return section
    }
    return CRM_DEFAULT_ADMIN_SECTION
  }
  if (
    section &&
    CRM_AGENT_SECTIONS.includes(section as (typeof CRM_AGENT_SECTIONS)[number])
  ) {
    return section as CrmSection
  }
  return CRM_DEFAULT_AGENT_SECTION
}

function money(value: unknown): string {
  return Number(value || 0).toFixed(2)
}

function discountFold(value: unknown): string {
  const fold = Number(value || 1) * 10
  return `${Number.isInteger(fold) ? fold : fold.toFixed(1)} 折`
}

function firstTopupBenefitText(
  available: boolean,
  discountRate: number | null | undefined
): string {
  if (available) {
    return discountFold(discountRate)
  }
  return discountRate ? '已使用' : '无'
}

function rate(value: unknown): string {
  return `${(Number(value || 0) * 100).toFixed(1)}%`
}

function levelText(value: string | null | undefined): string {
  return (
    standardAgentLevelRules.find((item) => item.level === value)?.label ||
    value ||
    '-'
  )
}

function statusText(value: string | null | undefined): string {
  if (!value) return '-'
  const labels: Record<string, string> = {
    active: '启用',
    disabled: '停用',
    pending: '待处理',
    approved: '已通过',
    rejected: '已驳回',
    paid: '已打款',
    cancelled: '已取消',
    completed: '已完成',
    frozen: '冻结',
    releasable: '可提现',
    released: '已打款结清',
    blocked: '已阻断',
    clawed_back: '已追回',
    open: '打开',
    reviewing: '复核中',
    resolved: '已解决',
    ignored: '已忽略',
    quota_applying: '额度处理中',
    quota_applied: '额度已处理',
    local_applying: '本地入账中',
    reconcile_required: '需人工对账',
  }
  return labels[value] || value
}

function eventTypeText(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    [accountEventTypes.adminPaidTopup]: '线下实付入账',
    [accountEventTypes.compensationGrant]: '补偿赠送',
    [accountEventTypes.exceptionAdjustment]: '异常调整',
    [accountEventTypes.onlineTopup]: '线上支付',
  }
  return (value && labels[value]) || value || '-'
}

function ledgerTypeText(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    [ledgerEventTypes.onlineTopup]: '线上支付入账',
    [ledgerEventTypes.accountEvent]: '入账事件',
    [ledgerEventTypes.signupTrialGrant]: '注册试用金',
    [ledgerEventTypes.imageConsume]: '模型消耗',
    [ledgerEventTypes.refund]: '退款',
    [ledgerEventTypes.commissionFreeze]: '佣金冻结',
    [ledgerEventTypes.commissionRelease]: '佣金释放',
    [ledgerEventTypes.commissionWithdrawal]: '佣金提现',
    [ledgerEventTypes.commissionClawback]: '佣金追回',
  }
  return (value && labels[value]) || value || '-'
}

function commissionText(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    [commissionTypes.agentDirectCommission]: '代理直接佣金',
    [commissionTypes.parentAgentServiceFee]: '直属上级服务费',
    [commissionTypes.enterpriseFixedPerImage]: '大客户固定单张佣金',
  }
  return (value && labels[value]) || value || '-'
}

function orderKindText(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    [orderKinds.firstOrder]: '首单',
    [orderKinds.repurchase]: '复购',
  }
  return (value && labels[value]) || value || '-'
}

function offlineMethodText(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    [offlineRechargeMethods.alipay]: '支付宝',
    [offlineRechargeMethods.wechat]: '微信',
  }
  return (value && labels[value]) || value || '-'
}

function withdrawalMethodText(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    [withdrawalMethods.alipay]: '支付宝',
    [withdrawalMethods.wechat]: '微信',
    [withdrawalMethods.bank]: '银行卡',
  }
  return (value && labels[value]) || value || '-'
}

function badgeVariant(
  status: string | null | undefined
): React.ComponentProps<typeof Badge>['variant'] {
  if (!status) {
    return 'outline'
  }
  if (
    [
      'active',
      'approved',
      'paid',
      'completed',
      'released',
      'releasable',
      'resolved',
    ].includes(status)
  ) {
    return 'secondary'
  }
  if (
    ['rejected', 'disabled', 'blocked', 'clawed_back', 'open'].includes(status)
  ) {
    return 'destructive'
  }
  return 'outline'
}

function StatusBadge({ status }: { status?: string | null }) {
  return <Badge variant={badgeVariant(status)}>{statusText(status)}</Badge>
}

function userName(
  username: string | undefined,
  id: number | null | undefined
): string {
  return username || (id ? `#${id}` : '-')
}

function Panel(props: {
  title: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <TitledCard
      title={props.title}
      action={props.actions}
      density='compact'
      disableHoverEffect
      className={cn('min-w-0', props.className)}
      contentClassName={cn('min-w-0', props.bodyClassName)}
    >
      {props.children}
    </TitledCard>
  )
}

function MetricGrid({
  items,
}: {
  items: Array<{ label: string; value: ReactNode; hint?: ReactNode }>
}) {
  return (
    <div className='grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4'>
      {items.map((item) => (
        <div
          key={item.label}
          className='bg-card/60 min-w-0 rounded-xl border px-3 py-3 sm:px-4'
        >
          <div className='text-muted-foreground truncate text-xs'>
            {item.label}
          </div>
          <div className='mt-1.5 min-w-0 text-base leading-6 font-semibold tabular-nums sm:mt-2 sm:text-xl sm:leading-7'>
            {item.value}
          </div>
          {item.hint ? (
            <div className='text-muted-foreground mt-1 text-xs'>
              {item.hint}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function CrmState(props: {
  kind: 'loading' | 'empty' | 'error'
  title: string
  description?: string
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  let icon = <Inbox className='size-5' aria-hidden='true' />
  if (props.kind === 'loading') {
    icon = <LoaderCircle className='size-5 animate-spin' aria-hidden='true' />
  } else if (props.kind === 'error') {
    icon = <AlertCircle className='size-5' aria-hidden='true' />
  }

  return (
    <div
      className={cn(
        'flex min-h-32 flex-col items-center justify-center gap-3 rounded-lg border px-4 py-8 text-center',
        props.kind === 'error'
          ? 'border-destructive/30 bg-destructive/5'
          : 'bg-muted/15 border-dashed'
      )}
      role={props.kind === 'error' ? 'alert' : 'status'}
      aria-live='polite'
    >
      <div
        className={cn(
          'flex size-10 items-center justify-center rounded-full',
          props.kind === 'error'
            ? 'bg-destructive/10 text-destructive'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {icon}
      </div>
      <div className='max-w-md'>
        <div className='text-sm font-medium'>{props.title}</div>
        {props.description ? (
          <div className='text-muted-foreground mt-1 text-xs leading-5'>
            {props.description}
          </div>
        ) : null}
      </div>
      {props.onRetry ? (
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={props.onRetry}
        >
          <RefreshCw className='size-4' aria-hidden='true' />
          {t('重新加载')}
        </Button>
      ) : null}
    </div>
  )
}

function ActionGroup(props: { children: ReactNode; className?: string }) {
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

function Field(props: {
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

function SelectField(props: {
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

function CheckboxField(props: {
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

function formValue(form: FormData, key: string) {
  return String(form.get(key) || '').trim()
}

function formNumber(form: FormData, key: string) {
  return Number(formValue(form, key))
}

function SubmitForm(props: {
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

function UserPicker(props: {
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

function FilterForm(props: {
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

function useCrmAction() {
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

function useCrmPatchAction() {
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

function TablePanel<T>(props: {
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

function useCrmSessionState<T>(key: string, fallback: T) {
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

function DataSection<T>(props: {
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

function AgentOverview({ session }: { session: CrmSessionDto }) {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const [rechargeMethod, setRechargeMethod] = useState<string>(
    offlineRechargeMethods.alipay
  )
  const [rechargeAmountRmb, setRechargeAmountRmb] = useState(0)
  const selfQuery = useQuery({
    queryKey: ['new-api', 'self'],
    queryFn: getSelf,
  })
  const dashboardQuery = useQuery({
    queryKey: ['crm', 'agent-dashboard'],
    queryFn: crmApi.agentDashboard,
  })
  const settingsQuery = useQuery({
    queryKey: ['crm', 'offline-recharge-settings'],
    queryFn: crmApi.offlineRechargeSettings,
  })
  const createRecharge = useMutation({
    mutationFn: crmApi.createOfflineRecharge,
    onSuccess: () => {
      toast.success(t('充值申请已提交'))
      void queryClient.invalidateQueries({ queryKey: ['crm'] })
    },
  })
  const createWithdrawal = useMutation({
    mutationFn: crmApi.createWithdrawal,
    onSuccess: () => {
      toast.success(t('提现申请已提交'))
      void queryClient.invalidateQueries({ queryKey: ['crm'] })
    },
  })
  const newApiSelf = selfQuery.data as
    | { data?: { quota?: number; aff_code?: string } }
    | undefined
  const overviewLoading =
    selfQuery.isLoading || dashboardQuery.isLoading || settingsQuery.isLoading
  const overviewError =
    selfQuery.isError ||
    dashboardQuery.isError ||
    settingsQuery.isError ||
    (!selfQuery.isLoading && !newApiSelf?.data)

  if (overviewLoading) {
    return <CrmState kind='loading' title={t('正在加载分销经营数据')} />
  }

  if (overviewError) {
    return (
      <CrmState
        kind='error'
        title={t('分销经营数据加载失败')}
        description={t(
          '为避免显示错误金额，页面不会使用空数据代替余额或佣金。'
        )}
        onRetry={() => {
          void Promise.all([
            selfQuery.refetch(),
            dashboardQuery.refetch(),
            settingsQuery.refetch(),
          ])
        }}
      />
    )
  }

  const dashboard = dashboardQuery.data
  const user = session.currentUser
  const quota = Number(newApiSelf?.data?.quota ?? 0)
  const collectionAccounts = settingsQuery.data?.accounts || []
  const collectionAccount =
    collectionAccounts.find((account) => account.method === rechargeMethod) ||
    collectionAccounts[0] ||
    null
  const collectionAccountReady = Boolean(
    collectionAccount?.recipientName && collectionAccount.account
  )
  const firstTopupPayable =
    user.firstTopupDiscountAvailable &&
    user.firstTopupDiscountRate &&
    rechargeAmountRmb > 0
      ? rechargeAmountRmb * Number(user.firstTopupDiscountRate)
      : null
  return (
    <div className='grid gap-4'>
      <AgentMetrics dashboard={dashboard} />
      <Panel title='账户资产'>
        <div className='grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4'>
          <Info
            label='账户余额'
            value={selfQuery.isLoading ? '加载中' : formatQuota(quota)}
          />
          <Info
            label='首充权益'
            value={
              user.firstTopupDiscountAvailable
                ? discountFold(user.firstTopupDiscountRate)
                : '无'
            }
          />
          <Info
            label='注册邀请码'
            value={
              selfQuery.isLoading
                ? '加载中'
                : registrationInviteCode(newApiSelf)
            }
          />
        </div>
      </Panel>
      <Panel title='收款信息'>
        <div className='grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4'>
          <Info label='充值方式' value={offlineMethodText(rechargeMethod)} />
          <Info
            label='付款备注'
            value={
              user.username || user.displayName || `用户 ${user.crmUserId}`
            }
          />
          <Info
            label='收款方'
            value={collectionAccount?.recipientName || '-'}
          />
          <Info label='收款账号' value={collectionAccount?.account || '-'} />
          <Info
            label='二维码链接'
            value={
              collectionAccount?.qrCodeUrl ? (
                <a
                  href={collectionAccount.qrCodeUrl}
                  target='_blank'
                  rel='noreferrer'
                  className='text-primary underline-offset-4 hover:underline'
                >
                  查看二维码
                </a>
              ) : (
                '-'
              )
            }
          />
          <Info
            label='转账说明'
            value={collectionAccount?.instructions || '转账后提交付款信息'}
          />
          <Info
            label='首充实付'
            value={
              firstTopupPayable === null
                ? '无'
                : `${money(firstTopupPayable)} 元，按充值金额入账`
            }
          />
        </div>
      </Panel>
      <SubmitForm
        title='线下充值申请'
        buttonText='提交充值'
        disabled={!collectionAccountReady}
        submitContent={
          !collectionAccountReady ? (
            <div
              className='border-warning/30 bg-warning/5 text-muted-foreground rounded-lg border px-3 py-2 text-xs leading-5'
              role='alert'
            >
              {t('收款账户尚未配置完整，请联系平台管理员后再提交。')}
            </div>
          ) : null
        }
        onSubmit={async (form) => {
          await createRecharge.mutateAsync({
            method: formValue(form, 'method'),
            amountRmb: formNumber(form, 'amountRmb'),
            payerName: formValue(form, 'payerName'),
            paymentReference: formValue(form, 'paymentReference'),
            paymentEvidenceUrl: formValue(form, 'paymentEvidenceUrl'),
            notes: formValue(form, 'notes'),
          })
        }}
      >
        <SelectField
          label='方式'
          name='method'
          defaultValue={
            collectionAccount?.method || offlineRechargeMethods.alipay
          }
          onChange={setRechargeMethod}
          required
        >
          {collectionAccounts.length ? (
            collectionAccounts.map((account) => (
              <option key={account.method} value={account.method}>
                {account.label || offlineMethodText(account.method)}
              </option>
            ))
          ) : (
            <>
              <option value={offlineRechargeMethods.alipay}>支付宝</option>
              <option value={offlineRechargeMethods.wechat}>微信</option>
            </>
          )}
        </SelectField>
        <Field
          label='金额'
          name='amountRmb'
          type='number'
          min='0.01'
          step='0.01'
          required
          onChange={(value) => setRechargeAmountRmb(Number(value || 0))}
        />
        <Field label='付款人' name='payerName' />
        <Field label='付款凭证号' name='paymentReference' required />
        <Field label='凭证链接' name='paymentEvidenceUrl' />
        <div className='grid gap-1.5 md:col-span-2'>
          <Label htmlFor='notes'>备注</Label>
          <Textarea id='notes' name='notes' />
        </div>
      </SubmitForm>
      <SubmitForm
        title='提现申请'
        buttonText='申请提现'
        onSubmit={async (form) => {
          await createWithdrawal.mutateAsync({
            amountRmb: formNumber(form, 'amountRmb'),
            payoutMethod: formValue(form, 'payoutMethod'),
            payoutAccountName: formValue(form, 'payoutAccountName'),
            payoutAccount: formValue(form, 'payoutAccount'),
            payoutBankName: formValue(form, 'payoutBankName'),
          })
        }}
      >
        <Field
          label='金额'
          name='amountRmb'
          type='number'
          min='0.01'
          step='0.01'
          required
        />
        <SelectField
          label='收款方式'
          name='payoutMethod'
          defaultValue={withdrawalMethods.alipay}
          required
        >
          <option value={withdrawalMethods.alipay}>支付宝</option>
          <option value={withdrawalMethods.wechat}>微信</option>
          <option value={withdrawalMethods.bank}>银行卡</option>
        </SelectField>
        <Field label='收款人' name='payoutAccountName' required />
        <Field label='收款账号' name='payoutAccount' required />
        <Field label='开户行' name='payoutBankName' />
      </SubmitForm>
    </div>
  )
}

function AgentMetrics({ dashboard }: { dashboard?: CrmAgentDashboardDto }) {
  return (
    <MetricGrid
      items={[
        { label: '直属客户', value: dashboard?.customerCount ?? '-' },
        { label: '团队代理', value: dashboard?.subAgentCount ?? '-' },
        {
          label: '冻结佣金',
          value: `${money(dashboard?.frozenCommissionRmb)} 元`,
        },
        {
          label: '可提现佣金',
          value: `${money(dashboard?.availableCommissionRmb)} 元`,
        },
        {
          label: '已释放待提现',
          value: `${money(dashboard?.releasableCommissionRmb)} 元`,
        },
        {
          label: '提现处理中',
          value: `${money(dashboard?.pendingWithdrawalRmb)} 元`,
        },
        { label: '已打款', value: `${money(dashboard?.paidWithdrawalRmb)} 元` },
      ]}
    />
  )
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className='bg-card/40 min-w-0 rounded-lg border px-3 py-2.5'>
      <div className='text-muted-foreground truncate text-xs'>{label}</div>
      <div className='mt-1 min-w-0 text-sm font-medium break-words'>
        {value}
      </div>
    </div>
  )
}

function AdminDashboard() {
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

const userColumns: StaticDataTableColumn<CrmUserDto>[] = [
  { id: 'id', header: '用户ID', cell: (row) => row.crmUserId },
  { id: 'username', header: '用户名', cell: (row) => row.username || '-' },
  { id: 'email', header: '邮箱', cell: (row) => row.email || '-' },
  {
    id: 'paid',
    header: '累计实付',
    cell: (row) => `${money(row.cumulativePaidRmb)} 元`,
  },
  {
    id: 'discount',
    header: '首充权益',
    cell: (row) =>
      firstTopupBenefitText(
        row.firstTopupDiscountAvailable,
        row.firstTopupDiscountRate
      ),
  },
  {
    id: 'trial',
    header: '试用金',
    cell: (row) =>
      row.signupTrialGrantStatus === signupTrialGrantStatuses.pending
        ? '待发放'
        : '已发放',
  },
  {
    id: 'agent',
    header: '代理',
    cell: (row) => (row.agent ? levelText(row.agent.level) : '-'),
  },
  {
    id: 'risk',
    header: '状态',
    cell: (row) =>
      row.isRisk ? (
        <Badge variant='destructive'>受限</Badge>
      ) : (
        <Badge variant='secondary'>正常</Badge>
      ),
  },
]

const relationshipColumns: StaticDataTableColumn<CrmUserDto>[] = [
  {
    id: 'customer',
    header: '客户',
    cell: (row) => row.username || '-',
  },
  { id: 'email', header: '邮箱', cell: (row) => row.email || '-' },
  {
    id: 'agent',
    header: '归属代理',
    cell: (row) =>
      row.agentRelationship
        ? userName(
            row.agentRelationship.agentUsername,
            row.agentRelationship.agentCrmUserId
          )
        : '-',
  },
  {
    id: 'source',
    header: '绑定来源',
    cell: (row) =>
      row.agentRelationship
        ? relationshipBindSourceText(row.agentRelationship?.bindSource)
        : '-',
  },
  {
    id: 'discount',
    header: '首充权益',
    cell: (row) =>
      firstTopupBenefitText(
        row.firstTopupDiscountAvailable,
        row.firstTopupDiscountRate
      ),
  },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.agentRelationship?.status} />,
  },
]

const agentColumns: StaticDataTableColumn<AgentDto>[] = [
  { id: 'id', header: '代理ID', cell: (row) => row.id },
  {
    id: 'user',
    header: '用户',
    cell: (row) => userName(row.username, row.crmUserId),
  },
  { id: 'level', header: '等级', cell: (row) => levelText(row.level) },
  {
    id: 'category',
    header: '类型',
    cell: (row) =>
      row.category === agentCategories.strategic ? '深度合作代理' : '普通代理',
  },
  {
    id: 'customers',
    header: '有效客户',
    cell: (row) => row.effectivePaidCustomerCount,
  },
  {
    id: 'parent',
    header: '上级',
    cell: (row) => userName(row.parentAgentUsername, row.parentAgentCrmUserId),
  },
  {
    id: 'invite',
    header: '邀请码',
    cell: (row) => <Badge variant='outline'>{row.inviteCode}</Badge>,
  },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
]

const agentTeamColumns: StaticDataTableColumn<AgentDto>[] = [
  {
    id: 'user',
    header: '用户',
    cell: (row) => userName(row.username, row.crmUserId),
  },
  { id: 'level', header: '等级', cell: (row) => levelText(row.level) },
  {
    id: 'category',
    header: '类型',
    cell: (row) =>
      row.category === agentCategories.strategic ? '深度合作代理' : '普通代理',
  },
  {
    id: 'customers',
    header: '有效客户',
    cell: (row) => row.effectivePaidCustomerCount,
  },
  {
    id: 'parent',
    header: '上级',
    cell: (row) => userName(row.parentAgentUsername, row.parentAgentCrmUserId),
  },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
]

const agentCustomerColumns: StaticDataTableColumn<AgentCustomerDto>[] = [
  {
    id: 'username',
    header: '客户',
    cell: (row) => row.customer.username || '-',
  },
  { id: 'email', header: '邮箱', cell: (row) => row.customer.email || '-' },
  {
    id: 'agent',
    header: '代理',
    cell: (row) =>
      userName(row.relationship.agentUsername, row.relationship.agentCrmUserId),
  },
  {
    id: 'source',
    header: '绑定来源',
    cell: (row) => relationshipBindSourceText(row.relationship.bindSource),
  },
]

const commissionColumns: StaticDataTableColumn<CommissionDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id || '-' },
  {
    id: 'beneficiary',
    header: '受益用户',
    cell: (row) => userName(row.beneficiaryUsername, row.beneficiaryCrmUserId),
  },
  {
    id: 'customer',
    header: '客户',
    cell: (row) => userName(row.customerUsername, row.customerCrmUserId),
  },
  {
    id: 'type',
    header: '类型',
    cell: (row) => commissionText(row.commissionType),
  },
  { id: 'order', header: '订单', cell: (row) => orderKindText(row.orderKind) },
  {
    id: 'rate',
    header: '比例/单价',
    cell: (row) =>
      row.commissionType === commissionTypes.enterpriseFixedPerImage
        ? `${money(row.rate)} 元/张`
        : rate(row.rate),
  },
  { id: 'amount', header: '佣金', cell: (row) => `${money(row.amountRmb)} 元` },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
]

const agentCommissionColumns: StaticDataTableColumn<CommissionDto>[] = [
  {
    id: 'customer',
    header: '客户',
    cell: (row) => userName(row.customerUsername, row.customerCrmUserId),
  },
  {
    id: 'type',
    header: '类型',
    cell: (row) => commissionText(row.commissionType),
  },
  { id: 'order', header: '订单', cell: (row) => orderKindText(row.orderKind) },
  {
    id: 'rate',
    header: '比例/单价',
    cell: (row) =>
      row.commissionType === commissionTypes.enterpriseFixedPerImage
        ? `${money(row.rate)} 元/张`
        : rate(row.rate),
  },
  { id: 'amount', header: '佣金', cell: (row) => `${money(row.amountRmb)} 元` },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
]

const withdrawalColumns: StaticDataTableColumn<WithdrawalDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id },
  {
    id: 'user',
    header: '用户',
    cell: (row) => userName(row.beneficiaryUsername, row.beneficiaryCrmUserId),
  },
  { id: 'amount', header: '金额', cell: (row) => `${money(row.amountRmb)} 元` },
  {
    id: 'method',
    header: '方式',
    cell: (row) => withdrawalMethodText(row.payoutMethod),
  },
  { id: 'account', header: '账号', cell: (row) => row.payoutAccount || '-' },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
  { id: 'reason', header: '备注', cell: (row) => row.reviewReason || '-' },
]

const agentWithdrawalColumns: StaticDataTableColumn<WithdrawalDto>[] = [
  { id: 'amount', header: '金额', cell: (row) => `${money(row.amountRmb)} 元` },
  {
    id: 'method',
    header: '方式',
    cell: (row) => withdrawalMethodText(row.payoutMethod),
  },
  { id: 'account', header: '账号', cell: (row) => row.payoutAccount || '-' },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
  { id: 'reason', header: '备注', cell: (row) => row.reviewReason || '-' },
]

const offlineRechargeColumns: StaticDataTableColumn<OfflineRechargeRequestDto>[] =
  [
    { id: 'id', header: 'ID', cell: (row) => row.id },
    {
      id: 'user',
      header: '用户',
      cell: (row) => userName(row.crmUsername, row.crmUserId),
    },
    {
      id: 'method',
      header: '方式',
      cell: (row) => offlineMethodText(row.method),
    },
    {
      id: 'amount',
      header: '金额',
      cell: (row) => `${money(row.amountRmb)} 元`,
    },
    {
      id: 'reference',
      header: '凭证',
      cell: (row) => row.paymentReference || '-',
    },
    {
      id: 'status',
      header: '状态',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: 'review',
      header: '审核备注',
      cell: (row) => row.reviewReason || '-',
    },
  ]

const agentOfflineRechargeColumns: StaticDataTableColumn<OfflineRechargeRequestDto>[] =
  [
    {
      id: 'method',
      header: '方式',
      cell: (row) => offlineMethodText(row.method),
    },
    {
      id: 'amount',
      header: '金额',
      cell: (row) => `${money(row.amountRmb)} 元`,
    },
    {
      id: 'reference',
      header: '凭证',
      cell: (row) => row.paymentReference || '-',
    },
    {
      id: 'status',
      header: '状态',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: 'review',
      header: '审核备注',
      cell: (row) => row.reviewReason || '-',
    },
  ]

const accountEventColumns: StaticDataTableColumn<AccountEventDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id },
  { id: 'type', header: '类型', cell: (row) => eventTypeText(row.eventType) },
  {
    id: 'user',
    header: '用户',
    cell: (row) => userName(row.crmUsername, row.crmUserId),
  },
  { id: 'amount', header: '金额', cell: (row) => `${money(row.amountRmb)} 元` },
  {
    id: 'paid',
    header: '实付',
    cell: (row) => `${money(row.paidAmountRmb)} 元`,
  },
  { id: 'quota', header: '额度变化', cell: (row) => row.quotaDelta },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
  { id: 'reason', header: '原因', cell: (row) => row.reason || '-' },
]

const ledgerColumns: StaticDataTableColumn<LedgerEntryDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id },
  {
    id: 'user',
    header: '用户',
    cell: (row) => userName(row.crmUsername, row.crmUserId),
  },
  {
    id: 'direction',
    header: '方向',
    cell: (row) =>
      row.direction === ledgerDirections.credit ? '入账' : '扣减',
  },
  { id: 'amount', header: '金额', cell: (row) => `${money(row.amountRmb)} 元` },
  { id: 'type', header: '类型', cell: (row) => ledgerTypeText(row.eventType) },
  {
    id: 'source',
    header: '来源',
    cell: (row) => ledgerSourceText(row.sourceType, row.sourceId),
  },
  { id: 'reason', header: '原因', cell: (row) => row.reason || '-' },
]

const effectiveColumns: StaticDataTableColumn<EffectiveCustomerDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id },
  {
    id: 'agent',
    header: '代理',
    cell: (row) => userName(row.agentUsername, row.agentCrmUserId),
  },
  {
    id: 'customer',
    header: '客户',
    cell: (row) => userName(row.customerUsername, row.customerCrmUserId),
  },
  {
    id: 'paid',
    header: '首付',
    cell: (row) => `${money(row.firstPaidAmountRmb)} 元`,
  },
  {
    id: 'rate',
    header: '消耗比例',
    cell: (row) => rate(row.paidBalanceConsumedRate),
  },
  {
    id: 'effective',
    header: '有效',
    cell: (row) => (
      <Badge variant={row.isEffective ? 'secondary' : 'outline'}>
        {row.isEffective ? '有效' : '未达标'}
      </Badge>
    ),
  },
  {
    id: 'counted',
    header: '计入等级',
    cell: (row) => (row.countedForLevel ? '是' : '否'),
  },
]

const enterpriseColumns: StaticDataTableColumn<EnterpriseMonthlySettlementDto>[] =
  [
    { id: 'id', header: 'ID', cell: (row) => row.id },
    { id: 'period', header: '周期', cell: (row) => row.period },
    {
      id: 'user',
      header: '客户',
      cell: (row) => userName(row.crmUsername, row.crmUserId),
    },
    {
      id: 'usage',
      header: '用量金额',
      cell: (row) => `${money(row.usageRmb)} 元`,
    },
    { id: 'count', header: '流水数', cell: (row) => row.ledgerEntryCount },
    {
      id: 'status',
      header: '状态',
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ]

const riskColumns: StaticDataTableColumn<RiskCaseDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id },
  {
    id: 'target',
    header: '对象',
    cell: (row) => targetText(row.targetType, row.targetId),
  },
  { id: 'type', header: '风险类型', cell: (row) => riskTypeText(row.riskType) },
  {
    id: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
  {
    id: 'withdrawal',
    header: '阻断提现',
    cell: (row) => (row.blocksWithdrawal ? '是' : '否'),
  },
  {
    id: 'commission',
    header: '阻断佣金',
    cell: (row) => (row.blocksCommissionRelease ? '是' : '否'),
  },
  { id: 'notes', header: '备注', cell: (row) => row.notes || '-' },
]

const auditColumns: StaticDataTableColumn<AuditLogEntryDto>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id },
  {
    id: 'operator',
    header: '操作人',
    cell: (row) => userName(row.operatorUsername, row.operatorCrmUserId),
  },
  {
    id: 'target',
    header: '对象',
    cell: (row) => targetText(row.targetType, row.targetId),
  },
  { id: 'action', header: '动作', cell: (row) => auditActionText(row.action) },
  { id: 'reason', header: '原因', cell: (row) => row.reason || '-' },
  { id: 'time', header: '时间', cell: (row) => row.createdAt || '-' },
]

type ActionDialogField = {
  name: string
  label: string
  defaultValue?: string
  required?: boolean
  type?: string
}

type ActionDialogState = {
  title: string
  path: string
  method?: 'POST' | 'PATCH'
  body?: Record<string, unknown>
  fields: ActionDialogField[]
}

function ActionColumns() {
  const action = useCrmAction()
  const patch = useCrmPatchAction()
  const { t } = useTranslation()
  const [dialog, setDialog] = useState<ActionDialogState | null>(null)
  const submitting = action.isPending || patch.isPending
  const openActionDialog = (next: ActionDialogState) => setDialog(next)
  const confirmAction = (
    path: string,
    body: Record<string, unknown> = {},
    title = '确认操作'
  ) => {
    openActionDialog({
      title,
      path,
      method: 'POST',
      body,
      fields: [
        {
          name: 'reason',
          label: '操作原因',
          defaultValue: String(
            body.reason || body.reviewReason || body.notes || ''
          ),
          required: true,
        },
      ],
    })
  }
  const confirmPatchAction = (
    path: string,
    body: Record<string, unknown> = {},
    title = '确认操作'
  ) => {
    openActionDialog({
      title,
      path,
      method: 'PATCH',
      body,
      fields: [
        {
          name: 'notes',
          label: '处理备注',
          defaultValue: String(body.notes || body.reason || ''),
          required: true,
        },
      ],
    })
  }
  const submitDialog = async (form: FormData) => {
    if (!dialog) return
    const fieldBody: Record<string, unknown> = {}
    dialog.fields.forEach((field) => {
      fieldBody[field.name] = formValue(form, field.name)
    })
    const reason = String(fieldBody.reason || '')
    const payload = {
      path: dialog.path,
      body: {
        ...dialog.body,
        ...fieldBody,
        ...(reason ? { reason, reviewReason: reason, notes: reason } : {}),
      },
    }
    if (dialog.method === 'PATCH') {
      await patch.mutateAsync(payload)
    } else {
      await action.mutateAsync(payload)
    }
    setDialog(null)
  }
  const destructiveDialog = Boolean(
    dialog &&
    (/\/(reject|cancel|refund|block|clawback)$/.test(dialog.path) ||
      dialog.body?.action === 'cancel' ||
      dialog.body?.isRefunded === true ||
      dialog.body?.isRelatedAccount === true ||
      dialog.body?.isRisk === true)
  )
  return {
    dialog: dialog ? (
      <Dialog
        open={Boolean(dialog)}
        onOpenChange={(open) => {
          if (!open && !submitting) setDialog(null)
        }}
        title={dialog.title}
        description={t('请核对操作原因。提交后会写入 CRM 审计日志。')}
        footer={
          <>
            <Button
              variant='outline'
              disabled={submitting}
              onClick={() => setDialog(null)}
            >
              {t('取消')}
            </Button>
            <Button
              type='submit'
              form='crm-action-dialog-form'
              variant={destructiveDialog ? 'destructive' : 'default'}
              disabled={submitting}
            >
              {submitting ? t('提交中') : t('确认提交')}
            </Button>
          </>
        }
      >
        <form
          id='crm-action-dialog-form'
          className='grid gap-3'
          aria-busy={submitting}
          onSubmit={(event) => {
            event.preventDefault()
            void submitDialog(new FormData(event.currentTarget)).catch(() => {
              // The shared mutation reports the error and the dialog stays open.
            })
          }}
        >
          {dialog.fields.map((field) => (
            <Field
              key={field.name}
              label={field.label}
              name={field.name}
              type={field.type}
              required={field.required}
              defaultValue={field.defaultValue}
            />
          ))}
        </form>
      </Dialog>
    ) : null,
    offline: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: OfflineRechargeRequestDto) =>
        row.status === offlineRechargeStatuses.pending ? (
          <ActionGroup>
            <Button
              size='sm'
              variant='default'
              onClick={() =>
                confirmAction(
                  `/crm/admin/offline-recharge-requests/${row.id}/approve`,
                  { reviewReason: '已核对到账' }
                )
              }
            >
              通过
            </Button>
            <Button
              size='sm'
              variant='destructive'
              onClick={() =>
                confirmAction(
                  `/crm/admin/offline-recharge-requests/${row.id}/reject`,
                  { reviewReason: '未通过审核' }
                )
              }
            >
              驳回
            </Button>
          </ActionGroup>
        ) : (
          '-'
        ),
    } satisfies StaticDataTableColumn<OfflineRechargeRequestDto>,
    withdrawal: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: WithdrawalDto) => (
        <ActionGroup>
          {row.status === 'pending' ? (
            <>
              <Button
                size='sm'
                variant='default'
                onClick={() =>
                  confirmAction(`/crm/admin/withdrawals/${row.id}/approve`, {
                    reviewReason: '审核通过',
                  })
                }
              >
                通过
              </Button>
              <Button
                size='sm'
                variant='destructive'
                onClick={() =>
                  confirmAction(`/crm/admin/withdrawals/${row.id}/reject`, {
                    reviewReason: '审核驳回',
                  })
                }
              >
                驳回
              </Button>
            </>
          ) : null}
          {row.status === 'approved' ? (
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                openActionDialog({
                  title: '登记线下已打款',
                  path: `/crm/admin/withdrawals/${row.id}/mark-paid`,
                  body: { reviewReason: '线下已打款' },
                  fields: [
                    {
                      name: 'paidReference',
                      label: '打款凭证号',
                      required: true,
                    },
                    { name: 'paidEvidenceUrl', label: '凭证链接' },
                    {
                      name: 'reviewReason',
                      label: '处理备注',
                      defaultValue: '线下已打款',
                      required: true,
                    },
                  ],
                })
              }
            >
              已打款
            </Button>
          ) : null}
        </ActionGroup>
      ),
    } satisfies StaticDataTableColumn<WithdrawalDto>,
    commission: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: CommissionDto) =>
        row.id ? (
          <ActionGroup>
            {row.status === commissionStatuses.frozen ? (
              <Button
                size='sm'
                variant='default'
                onClick={() =>
                  confirmAction(`/crm/admin/commissions/${row.id}/release`, {
                    reason: '释放佣金',
                  })
                }
              >
                释放
              </Button>
            ) : null}
            {row.status === commissionStatuses.frozen ? (
              <Button
                size='sm'
                variant='destructive'
                onClick={() =>
                  confirmAction(`/crm/admin/commissions/${row.id}/block`, {
                    reason: '阻断佣金',
                  })
                }
              >
                阻断
              </Button>
            ) : null}
            {row.status !== commissionStatuses.clawedBack ? (
              <Button
                size='sm'
                variant='destructive'
                onClick={() =>
                  confirmAction(`/crm/admin/commissions/${row.id}/clawback`, {
                    reason: '追回佣金',
                  })
                }
              >
                追回
              </Button>
            ) : null}
          </ActionGroup>
        ) : (
          '-'
        ),
    } satisfies StaticDataTableColumn<CommissionDto>,
    accountEvent: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: AccountEventDto) => (
        <ActionGroup>
          {row.status === accountEventStatuses.quotaApplying ||
          row.status === accountEventStatuses.localApplying ||
          row.status === accountEventStatuses.reconcileRequired ? (
            <>
              <Button
                size='sm'
                variant='default'
                onClick={() =>
                  confirmAction(
                    `/crm/admin/account-events/${row.id}/reconcile`,
                    {
                      action: 'confirm_quota_applied',
                      reason: '已确认模型服务额度已入账',
                    }
                  )
                }
              >
                {row.status === accountEventStatuses.localApplying
                  ? '继续本地入账'
                  : '确认额度并入账'}
              </Button>
              {(row.status === accountEventStatuses.quotaApplying ||
                row.status === accountEventStatuses.reconcileRequired) &&
              !row.newApiResult ? (
                <Button
                  size='sm'
                  variant='destructive'
                  onClick={() =>
                    confirmAction(
                      `/crm/admin/account-events/${row.id}/reconcile`,
                      {
                        action: 'cancel',
                        reason: '已确认模型服务额度未入账',
                      }
                    )
                  }
                >
                  确认未执行并取消
                </Button>
              ) : null}
            </>
          ) : null}
          {row.status === accountEventStatuses.completed &&
          (row.eventType === accountEventTypes.adminPaidTopup ||
            row.eventType === accountEventTypes.onlineTopup) ? (
            <Button
              size='sm'
              variant='destructive'
              onClick={() =>
                confirmAction(`/crm/admin/account-events/${row.id}/refund`, {
                  reason: '人工登记退款',
                })
              }
            >
              登记退款
            </Button>
          ) : null}
        </ActionGroup>
      ),
    } satisfies StaticDataTableColumn<AccountEventDto>,
    effective: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: EffectiveCustomerDto) => (
        <ActionGroup>
          <Button
            size='sm'
            variant='outline'
            disabled={action.isPending}
            onClick={() =>
              action.mutate({
                path: '/crm/admin/effective-customers/sync-consumption',
                body: { customerCrmUserId: row.customerCrmUserId },
              })
            }
          >
            同步消耗
          </Button>
          <Button
            size='sm'
            variant='default'
            onClick={() =>
              confirmAction('/crm/admin/effective-customers/evaluate', {
                agentId: row.agentId,
                customerCrmUserId: row.customerCrmUserId,
                reason: '复核有效客户',
              })
            }
          >
            复核
          </Button>
          <Button
            size='sm'
            variant='destructive'
            onClick={() =>
              confirmAction('/crm/admin/effective-customers/evaluate', {
                agentId: row.agentId,
                customerCrmUserId: row.customerCrmUserId,
                isRefunded: true,
                reason: '客户已退款，取消有效客户资格',
              })
            }
          >
            退款
          </Button>
          <Button
            size='sm'
            variant='destructive'
            onClick={() =>
              confirmAction('/crm/admin/effective-customers/evaluate', {
                agentId: row.agentId,
                customerCrmUserId: row.customerCrmUserId,
                isRelatedAccount: true,
                reason: '关联账号，不计入有效客户',
              })
            }
          >
            关联账号
          </Button>
          <Button
            size='sm'
            variant='destructive'
            onClick={() =>
              confirmAction('/crm/admin/effective-customers/evaluate', {
                agentId: row.agentId,
                customerCrmUserId: row.customerCrmUserId,
                isRisk: true,
                reason: '风险客户，不计入有效客户',
              })
            }
          >
            风险
          </Button>
        </ActionGroup>
      ),
    } satisfies StaticDataTableColumn<EffectiveCustomerDto>,
    risk: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: RiskCaseDto) => (
        <ActionGroup>
          {[
            [riskStatuses.reviewing, '复核中'],
            [riskStatuses.resolved, '解决'],
            [riskStatuses.ignored, '忽略'],
          ].map(([status, label]) => {
            let variant: 'default' | 'destructive' | 'outline' = 'outline'
            if (status === riskStatuses.resolved) variant = 'default'
            if (status === riskStatuses.ignored) variant = 'destructive'

            return (
              <Button
                key={status}
                size='sm'
                variant={variant}
                onClick={() =>
                  confirmPatchAction(
                    `/crm/admin/risk-cases/${row.id}`,
                    { status, notes: row.notes || label },
                    '更新风控单状态'
                  )
                }
              >
                {label}
              </Button>
            )
          })}
        </ActionGroup>
      ),
    } satisfies StaticDataTableColumn<RiskCaseDto>,
    enterprise: {
      id: 'actions',
      header: '操作',
      mobileLabel: '可用操作',
      mobileFullWidth: true,
      cell: (row: EnterpriseMonthlySettlementDto) =>
        row.status === enterpriseMonthlySettlementStatuses.pending ? (
          <ActionGroup>
            <Button
              size='sm'
              variant='default'
              onClick={() =>
                openActionDialog({
                  title: '登记大客户月结已收款',
                  path: `/crm/admin/enterprise/monthly-settlements/${row.id}/mark-paid`,
                  body: {},
                  fields: [
                    {
                      name: 'paidReference',
                      label: '线下收款凭证',
                      defaultValue: row.paidReference || '',
                      required: true,
                    },
                    {
                      name: 'paidEvidenceUrl',
                      label: '凭证链接',
                      defaultValue: row.paidEvidenceUrl || '',
                    },
                    {
                      name: 'notes',
                      label: '备注',
                      defaultValue: '线下已收款',
                    },
                  ],
                })
              }
            >
              已收款
            </Button>
            <Button
              size='sm'
              variant='destructive'
              onClick={() =>
                confirmAction(
                  `/crm/admin/enterprise/monthly-settlements/${row.id}/cancel`,
                  { notes: '取消月结单' }
                )
              }
            >
              取消
            </Button>
          </ActionGroup>
        ) : (
          '-'
        ),
    } satisfies StaticDataTableColumn<EnterpriseMonthlySettlementDto>,
  }
}

type CrmActionColumns = ReturnType<typeof ActionColumns>

function UserProfileEditor({
  selectedUser,
  onClose,
}: {
  selectedUser: CrmUserDto
  onClose: () => void
}) {
  const patch = useCrmPatchAction()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !patch.isPending) onClose()
      }}
      title={`编辑用户资料：${selectedUser.username || selectedUser.crmUserId}`}
      contentClassName='sm:max-w-3xl'
      footer={
        <>
          <Button
            variant='outline'
            disabled={patch.isPending}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            type='submit'
            form='crm-user-profile-form'
            disabled={patch.isPending}
          >
            {patch.isPending ? '保存中' : '保存资料'}
          </Button>
        </>
      }
    >
      <form
        id='crm-user-profile-form'
        className='grid min-w-0 gap-4 sm:grid-cols-2'
        aria-busy={patch.isPending}
        onSubmit={async (event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          try {
            await patch.mutateAsync({
              path: `/crm/admin/users/${selectedUser.crmUserId}/profile`,
              body: {
                phone: formValue(form, 'phone'),
                wechat: formValue(form, 'wechat'),
                remark: formValue(form, 'remark'),
                isEnterprise: form.has('isEnterprise'),
                enterprisePriceRmb:
                  formValue(form, 'enterprisePriceRmb') === ''
                    ? null
                    : formNumber(form, 'enterprisePriceRmb'),
                enterpriseFixedCommissionPerImage:
                  formValue(form, 'enterpriseFixedCommissionPerImage') === ''
                    ? null
                    : formNumber(form, 'enterpriseFixedCommissionPerImage'),
                isRisk: form.has('isRisk'),
              },
            })
            onClose()
          } catch {
            // The shared mutation handler reports the error; keep the editor open.
          }
        }}
      >
        <Field label='手机号' name='phone' defaultValue={selectedUser.phone} />
        <Field label='微信' name='wechat' defaultValue={selectedUser.wechat} />
        <Field label='备注' name='remark' defaultValue={selectedUser.remark} />
        <Field
          label='大客户特价'
          name='enterprisePriceRmb'
          type='number'
          min='0'
          step='0.0001'
          defaultValue={selectedUser.enterprisePriceRmb ?? ''}
        />
        <Field
          label='固定佣金'
          name='enterpriseFixedCommissionPerImage'
          type='number'
          min='0'
          step='0.0001'
          defaultValue={selectedUser.enterpriseFixedCommissionPerImage ?? ''}
        />
        <CheckboxField
          label='大客户'
          name='isEnterprise'
          defaultChecked={selectedUser.isEnterprise}
        />
        <CheckboxField
          label='风险用户'
          name='isRisk'
          defaultChecked={selectedUser.isRisk}
        />
      </form>
    </Dialog>
  )
}

function AdminUsersSection() {
  const [selectedUser, setSelectedUser] = useState<CrmUserDto | null>(null)
  const action = useCrmAction()
  const userActions: StaticDataTableColumn<CrmUserDto> = {
    id: 'actions',
    header: '操作',
    mobileLabel: '可用操作',
    mobileFullWidth: true,
    cell: (row) => (
      <ActionGroup>
        <Button
          size='sm'
          variant='outline'
          onClick={() => setSelectedUser(row)}
        >
          编辑资料
        </Button>
        {row.signupTrialGrantStatus === signupTrialGrantStatuses.pending ? (
          <Button
            size='sm'
            variant='outline'
            disabled={action.isPending}
            onClick={() =>
              action.mutate({
                path: `/crm/admin/users/${row.crmUserId}/signup-trial/retry`,
                body: {},
              })
            }
          >
            重试试用金
          </Button>
        ) : null}
      </ActionGroup>
    ),
  }
  return (
    <div className='grid gap-4'>
      {selectedUser ? (
        <UserProfileEditor
          selectedUser={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      ) : null}
      <DataSection
        title='用户列表'
        queryKey='users'
        queryFn={crmApi.users}
        columns={[...userColumns, userActions]}
        searchable
      />
    </div>
  )
}

function AgentEditor({
  selectedAgent,
  onClose,
}: {
  selectedAgent: AgentDto
  onClose: () => void
}) {
  const patch = useCrmPatchAction()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !patch.isPending) onClose()
      }}
      title={`编辑代理：${selectedAgent.username || selectedAgent.crmUserId}`}
      contentClassName='sm:max-w-2xl'
      footer={
        <>
          <Button
            variant='outline'
            disabled={patch.isPending}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            type='submit'
            form='crm-agent-editor-form'
            disabled={patch.isPending}
          >
            {patch.isPending ? '保存中' : '保存代理'}
          </Button>
        </>
      }
    >
      <form
        id='crm-agent-editor-form'
        className='grid min-w-0 gap-4 sm:grid-cols-2'
        aria-busy={patch.isPending}
        onSubmit={async (event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          try {
            await patch.mutateAsync({
              path: `/crm/admin/agents/${selectedAgent.id}`,
              body: {
                category: formValue(form, 'category'),
                status: formValue(form, 'status'),
                parentAgentCrmUserId:
                  formNumber(form, 'parentAgentCrmUserId') || undefined,
                reason: formValue(form, 'reason') || '管理员调整代理',
              },
            })
            onClose()
          } catch {
            // The shared mutation handler reports the error; keep the editor open.
          }
        }}
      >
        <SelectField
          label='类型'
          name='category'
          defaultValue={selectedAgent.category}
          required
        >
          <option value={agentCategories.normal}>普通代理</option>
          <option value={agentCategories.strategic}>深度合作代理</option>
        </SelectField>
        <SelectField
          label='状态'
          name='status'
          defaultValue={selectedAgent.status}
          required
        >
          <option value={agentStatuses.active}>启用</option>
          <option value={agentStatuses.disabled}>停用</option>
        </SelectField>
        <UserPicker
          name='parentAgentCrmUserId'
          label='直属上级'
          placeholder='搜索新直属上级，留空保持不变'
        />
        <Field label='原因' name='reason' defaultValue='管理员调整代理' />
      </form>
    </Dialog>
  )
}

function AdminAgentsSection() {
  const [selectedAgent, setSelectedAgent] = useState<AgentDto | null>(null)
  const agentActions: StaticDataTableColumn<AgentDto> = {
    id: 'actions',
    header: '操作',
    mobileLabel: '可用操作',
    mobileFullWidth: true,
    cell: (row) => (
      <ActionGroup>
        <Button
          size='sm'
          variant='outline'
          onClick={() => setSelectedAgent(row)}
        >
          编辑代理
        </Button>
      </ActionGroup>
    ),
  }
  return (
    <div className='grid gap-4'>
      {selectedAgent ? (
        <AgentEditor
          selectedAgent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      ) : null}
      <DataSection
        title='代理列表'
        queryKey='agents'
        queryFn={crmApi.agents}
        columns={[...agentColumns, agentActions]}
      />
    </div>
  )
}

function AdminEffectiveCustomersSection({
  actions,
}: {
  actions: CrmActionColumns
}) {
  const action = useCrmAction()
  const [filters, setFilters] = useState<SectionFilters>({
    countedForLevel: false,
  })
  return (
    <DataSection
      title='有效客户名单'
      queryKey='effective-customers'
      queryFn={crmApi.effectiveCustomers}
      columns={[...effectiveColumns, actions.effective]}
      filters={filters}
      actions={
        <>
          <Button
            size='sm'
            variant='outline'
            disabled={action.isPending}
            onClick={() =>
              action.mutate({
                path: '/crm/admin/effective-customers/maintenance',
                body: { syncConsumption: true },
              })
            }
          >
            运行维护
          </Button>
          <FilterForm onChange={setFilters}>
            <SelectField label='状态' name='countedForLevel'>
              <option value='false'>待复核</option>
              <option value='true'>已计入</option>
              <option value=''>全部</option>
            </SelectField>
          </FilterForm>
        </>
      }
    />
  )
}

function AdminAccountEventsSection({ actions }: { actions: CrmActionColumns }) {
  const [filters, setFilters] = useState<SectionFilters>({})
  return (
    <DataSection
      title='入账事件队列'
      queryKey='account-events'
      queryFn={crmApi.accountEvents}
      columns={[...accountEventColumns, actions.accountEvent]}
      filters={filters}
      actions={
        <FilterForm onChange={setFilters}>
          <UserPicker name='crmUserId' label='用户' />
          <SelectField label='类型' name='eventType'>
            <option value=''>全部类型</option>
            <option value={accountEventTypes.adminPaidTopup}>
              线下实付入账
            </option>
            <option value={accountEventTypes.compensationGrant}>
              补偿赠送
            </option>
            <option value={accountEventTypes.exceptionAdjustment}>
              异常调整
            </option>
            <option value={accountEventTypes.onlineTopup}>线上支付</option>
          </SelectField>
          <SelectField label='状态' name='status'>
            <option value=''>全部状态</option>
            <option value={accountEventStatuses.pending}>待处理</option>
            <option value={accountEventStatuses.quotaApplying}>
              额度处理中
            </option>
            <option value={accountEventStatuses.completed}>已完成</option>
            <option value={accountEventStatuses.reconcileRequired}>
              需人工对账
            </option>
            <option value={accountEventStatuses.cancelled}>已取消</option>
          </SelectField>
        </FilterForm>
      }
    />
  )
}

function AdminLedgerSection() {
  const [filters, setFilters] = useState<SectionFilters>({})
  return (
    <DataSection
      title='业务账本流水'
      queryKey='ledger'
      queryFn={crmApi.ledger}
      columns={ledgerColumns}
      filters={filters}
      actions={
        <FilterForm onChange={setFilters}>
          <UserPicker name='crmUserId' label='用户' />
          <SelectField label='事件' name='eventType'>
            <option value=''>全部事件</option>
            <option value={ledgerEventTypes.accountEvent}>入账事件</option>
            <option value={ledgerEventTypes.signupTrialGrant}>
              注册试用金
            </option>
            <option value={ledgerEventTypes.imageConsume}>模型消耗</option>
            <option value={ledgerEventTypes.refund}>退款</option>
            <option value={ledgerEventTypes.commissionFreeze}>佣金冻结</option>
            <option value={ledgerEventTypes.commissionRelease}>佣金释放</option>
            <option value={ledgerEventTypes.commissionWithdrawal}>
              提现打款
            </option>
            <option value={ledgerEventTypes.commissionClawback}>
              佣金追回
            </option>
          </SelectField>
          <SelectField label='方向' name='direction'>
            <option value=''>全部方向</option>
            <option value={ledgerDirections.credit}>入账</option>
            <option value={ledgerDirections.debit}>扣减</option>
          </SelectField>
        </FilterForm>
      }
    />
  )
}

function AdminCommissionsSection({ actions }: { actions: CrmActionColumns }) {
  const [filters, setFilters] = useState<SectionFilters>({})
  return (
    <DataSection
      title='佣金记录'
      queryKey='commissions'
      queryFn={crmApi.commissions}
      columns={[...commissionColumns, actions.commission]}
      filters={filters}
      actions={
        <FilterForm onChange={setFilters}>
          <UserPicker name='beneficiaryCrmUserId' label='受益用户' />
          <SelectField label='状态' name='status'>
            <option value=''>全部状态</option>
            <option value={commissionStatuses.frozen}>冻结中</option>
            <option value={commissionStatuses.releasable}>可提现</option>
            <option value={commissionStatuses.released}>已打款</option>
            <option value={commissionStatuses.blocked}>已阻断</option>
            <option value={commissionStatuses.clawedBack}>已追回</option>
          </SelectField>
        </FilterForm>
      }
    />
  )
}

function AdminOfflineRechargesSection({
  actions,
}: {
  actions: CrmActionColumns
}) {
  const [filters, setFilters] = useState<SectionFilters>({})
  return (
    <DataSection
      title='充值审核队列'
      queryKey='offline-recharges'
      queryFn={crmApi.offlineRecharges}
      columns={[...offlineRechargeColumns, actions.offline]}
      filters={filters}
      actions={
        <FilterForm onChange={setFilters}>
          <SelectField label='状态' name='status'>
            <option value=''>全部状态</option>
            <option value={offlineRechargeStatuses.pending}>待审核</option>
            <option value={offlineRechargeStatuses.approved}>已入账</option>
            <option value={offlineRechargeStatuses.rejected}>已驳回</option>
          </SelectField>
        </FilterForm>
      }
    />
  )
}

function AdminWithdrawalsSection({ actions }: { actions: CrmActionColumns }) {
  const [filters, setFilters] = useState<SectionFilters>({})
  return (
    <DataSection
      title='提现审核队列'
      queryKey='withdrawals'
      queryFn={crmApi.withdrawals}
      columns={[...withdrawalColumns, actions.withdrawal]}
      filters={filters}
      actions={
        <FilterForm onChange={setFilters}>
          <UserPicker name='beneficiaryCrmUserId' label='用户' />
          <SelectField label='状态' name='status'>
            <option value=''>全部状态</option>
            <option value={withdrawalStatuses.pending}>待审核</option>
            <option value={withdrawalStatuses.approved}>待打款</option>
            <option value={withdrawalStatuses.rejected}>已驳回</option>
            <option value={withdrawalStatuses.paid}>已打款</option>
            <option value={withdrawalStatuses.cancelled}>已取消</option>
          </SelectField>
        </FilterForm>
      }
    />
  )
}

function AdminRiskSection({ actions }: { actions: CrmActionColumns }) {
  const [filters, setFilters] = useState<SectionFilters>({})
  return (
    <DataSection
      title='风控工单'
      queryKey='risk'
      queryFn={crmApi.riskCases}
      columns={[...riskColumns, actions.risk]}
      filters={filters}
      actions={
        <FilterForm onChange={setFilters}>
          <SelectField label='状态' name='status'>
            <option value=''>全部状态</option>
            <option value={riskStatuses.open}>打开</option>
            <option value={riskStatuses.reviewing}>复核中</option>
            <option value={riskStatuses.resolved}>已解决</option>
            <option value={riskStatuses.ignored}>已忽略</option>
          </SelectField>
          <SelectField label='关联对象' name='targetType'>
            <option value=''>全部对象</option>
            <option value={riskTargetTypes.user}>用户</option>
            <option value={riskTargetTypes.agent}>代理</option>
            <option value={riskTargetTypes.commission}>佣金</option>
            <option value={riskTargetTypes.withdrawal}>提现</option>
          </SelectField>
          <Field label='对象标识' name='targetId' />
        </FilterForm>
      }
    />
  )
}

function AdminEnterpriseSection({ actions }: { actions: CrmActionColumns }) {
  const action = useCrmAction()
  const [filters, setFilters] = useState<SectionFilters>({})
  return (
    <div className='grid gap-4'>
      <SubmitForm
        title='生成月结单'
        buttonText='生成'
        submitContent={
          <CheckboxField
            label='生成前同步模型消耗'
            name='syncConsumption'
            defaultChecked
            className='w-full sm:w-auto'
          />
        }
        onSubmit={async (form) => {
          await action.mutateAsync({
            path: '/crm/admin/enterprise/monthly-settlements/generate',
            body: {
              period: formValue(form, 'period') || undefined,
              syncConsumption: form.has('syncConsumption'),
            },
          })
        }}
      >
        <Field label='账期' name='period' type='month' />
      </SubmitForm>
      <DataSection
        title='大客户月结'
        queryKey='enterprise'
        queryFn={crmApi.enterpriseSettlements}
        columns={[...enterpriseColumns, actions.enterprise]}
        filters={filters}
        actions={
          <FilterForm onChange={setFilters}>
            <Field label='账期' name='period' type='month' />
            <SelectField label='状态' name='status'>
              <option value=''>全部状态</option>
              <option value={enterpriseMonthlySettlementStatuses.pending}>
                待收款
              </option>
              <option value={enterpriseMonthlySettlementStatuses.paid}>
                已收款
              </option>
              <option value={enterpriseMonthlySettlementStatuses.cancelled}>
                已取消
              </option>
            </SelectField>
          </FilterForm>
        }
      />
      <DataSection
        title='大客户名单'
        queryKey='enterprise-users'
        queryFn={(params) => crmApi.users({ ...params, enterpriseOnly: true })}
        columns={userColumns}
        searchable
      />
    </div>
  )
}

function AdminAuditSection() {
  const [filters, setFilters] = useState<SectionFilters>({})
  return (
    <DataSection
      title='操作记录'
      queryKey='audit'
      queryFn={crmApi.auditLogs}
      columns={auditColumns}
      filters={filters}
      actions={
        <FilterForm onChange={setFilters}>
          <UserPicker name='operatorCrmUserId' label='操作人' />
          <SelectField label='关联对象' name='targetType'>
            <option value=''>全部对象</option>
            <option value='user'>用户</option>
            <option value='user_profile'>用户资料</option>
            <option value='agent'>代理</option>
            <option value='account_event'>入账事件</option>
            <option value='commission'>佣金</option>
            <option value='withdrawal'>提现</option>
            <option value='risk_case'>风控单</option>
            <option value='enterprise_monthly_settlement'>大客户月结</option>
            <option value='settings'>系统设置</option>
          </SelectField>
          <Field label='对象标识' name='targetId' />
          <Field label='动作' name='action' />
        </FilterForm>
      }
    />
  )
}

function AdminForms({ section }: { section: CrmSection }) {
  const action = useCrmAction()
  const [riskCreateTargetType, setRiskCreateTargetType] = useState<string>(
    riskTargetTypes.user
  )
  if (section === 'agents') {
    return (
      <SubmitForm
        title='创建代理'
        buttonText='创建'
        onSubmit={async (form) => {
          await action.mutateAsync({
            path: '/crm/admin/agents',
            body: {
              crmUserId: formNumber(form, 'crmUserId'),
              parentAgentCrmUserId:
                formNumber(form, 'parentAgentCrmUserId') || undefined,
              category: formValue(form, 'category'),
              reason: formValue(form, 'reason') || '创建代理',
            },
          })
        }}
      >
        <UserPicker name='crmUserId' label='代理用户' required />
        <UserPicker name='parentAgentCrmUserId' label='直属上级' />
        <SelectField
          label='类型'
          name='category'
          defaultValue={agentCategories.normal}
        >
          <option value={agentCategories.normal}>普通代理</option>
          <option value={agentCategories.strategic}>深度合作代理</option>
        </SelectField>
        <Field label='原因' name='reason' />
      </SubmitForm>
    )
  }
  if (section === 'relationships') {
    return (
      <SubmitForm
        title='绑定客户归属'
        buttonText='绑定'
        fieldsClassName='grid gap-4'
        submitContent={
          <CheckboxField
            label='允许改绑'
            name='allowRebind'
            defaultChecked
            className='w-full sm:w-auto'
          />
        }
        onSubmit={async (form) => {
          await action.mutateAsync({
            path: '/crm/admin/agent-relationships',
            body: {
              customerCrmUserId: formNumber(form, 'customerCrmUserId'),
              agentCrmUserId: formNumber(form, 'agentCrmUserId') || undefined,
              inviteCode: formValue(form, 'inviteCode') || undefined,
              allowRebind: form.has('allowRebind'),
              reason: formValue(form, 'reason') || '管理员绑定客户归属',
            },
          })
        }}
      >
        <div className='grid min-w-0 gap-4 lg:grid-cols-2'>
          <UserPicker name='customerCrmUserId' label='客户' required />
          <UserPicker name='agentCrmUserId' label='代理' required />
        </div>
        <div className='grid min-w-0 gap-4 lg:grid-cols-2'>
          <Field label='邀请码' name='inviteCode' />
          <Field label='原因' name='reason' />
        </div>
      </SubmitForm>
    )
  }
  if (section === 'account-events') {
    return (
      <SubmitForm
        title='创建入账事件'
        buttonText='创建'
        onSubmit={async (form) => {
          await action.mutateAsync({
            path: '/crm/admin/account-events',
            body: {
              eventType: formValue(form, 'eventType'),
              crmUserId: formNumber(form, 'crmUserId'),
              amountRmb: formNumber(form, 'amountRmb'),
              reason: formValue(form, 'reason') || '人工入账',
            },
          })
        }}
      >
        <SelectField
          label='类型'
          name='eventType'
          defaultValue={accountEventTypes.adminPaidTopup}
        >
          <option value={accountEventTypes.adminPaidTopup}>线下实付入账</option>
          <option value={accountEventTypes.compensationGrant}>补偿赠送</option>
          <option value={accountEventTypes.exceptionAdjustment}>
            异常调整
          </option>
        </SelectField>
        <UserPicker name='crmUserId' label='用户' required />
        <Field label='金额' name='amountRmb' type='number' required />
        <Field label='原因' name='reason' />
      </SubmitForm>
    )
  }
  if (section === 'risk') {
    return (
      <SubmitForm
        title='创建风控单'
        buttonText='创建'
        onSubmit={async (form) => {
          await action.mutateAsync({
            path: '/crm/admin/risk-cases',
            body: {
              targetType: formValue(form, 'targetType'),
              targetId: formValue(form, 'targetId'),
              riskType: formValue(form, 'riskType'),
              notes: formValue(form, 'notes'),
              blocksWithdrawal: formValue(form, 'blocksWithdrawal') === 'true',
              blocksCommissionRelease:
                formValue(form, 'blocksCommissionRelease') === 'true',
            },
          })
        }}
      >
        <SelectField
          label='关联对象'
          name='targetType'
          defaultValue={riskTargetTypes.user}
          onChange={setRiskCreateTargetType}
          required
        >
          {riskTargetTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        {riskCreateTargetType === riskTargetTypes.user ? (
          <UserPicker name='targetId' label='对象用户' required />
        ) : (
          <Field label='对象标识' name='targetId' required />
        )}
        <SelectField
          label='风险原因'
          name='riskType'
          defaultValue={riskCaseTypes.abnormalRegistration}
          required
        >
          {riskCaseTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label='阻断提现'
          name='blocksWithdrawal'
          defaultValue='false'
        >
          <option value='false'>否</option>
          <option value='true'>是</option>
        </SelectField>
        <SelectField
          label='阻断佣金'
          name='blocksCommissionRelease'
          defaultValue='false'
        >
          <option value='false'>否</option>
          <option value='true'>是</option>
        </SelectField>
        <Field label='备注' name='notes' required />
      </SubmitForm>
    )
  }
  return null
}

function AgentSection({
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

function AdminSection({ section }: { section: CrmSection }) {
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

function SettingsNumberField(props: {
  label: string
  name: string
  defaultValue: string | number
  min?: string
  max?: string
  step?: string
  className?: string
}) {
  return (
    <div className={cn('grid gap-1.5', props.className)}>
      <Label htmlFor={props.name}>{props.label}</Label>
      <Input
        id={props.name}
        name={props.name}
        type='number'
        min={props.min || '0'}
        max={props.max}
        step={props.step || '1'}
        required
        defaultValue={props.defaultValue}
      />
    </div>
  )
}

function SettingsTextField(props: {
  label: string
  name: string
  defaultValue?: string
  placeholder?: string
}) {
  return (
    <div className='grid gap-1.5'>
      <Label htmlFor={props.name}>{props.label}</Label>
      <Input
        id={props.name}
        name={props.name}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
      />
    </div>
  )
}

function CommissionRuleSetEditor({
  ruleSet,
}: {
  ruleSet: CrmSettingsDto['agentCommissionRuleSets'][number]
}) {
  return (
    <section className='bg-muted/20 min-w-0 overflow-hidden rounded-lg p-3 sm:p-4'>
      <h4 className='mb-3 min-w-0 truncate text-sm font-semibold sm:mb-4'>
        {ruleSet.label}佣金阶梯
      </h4>
      <div className='min-w-0 text-sm'>
        <div className='text-muted-foreground bg-muted/40 hidden items-center gap-x-2 rounded-lg px-2 py-2 text-xs font-medium sm:grid sm:grid-cols-[minmax(5.5rem,0.8fr)_repeat(3,minmax(0,1fr))]'>
          <div className='min-w-0 truncate'>等级</div>
          <div className='min-w-0 truncate'>有效客户门槛</div>
          <div className='min-w-0 truncate'>首单佣金 %</div>
          <div className='min-w-0 truncate'>复购佣金 %</div>
        </div>
        <div className='divide-y'>
          {ruleSet.rules.map((rule) => (
            <div
              key={rule.level}
              className='grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(5.5rem,0.8fr)_repeat(3,minmax(0,1fr))] sm:items-center sm:gap-x-2 sm:px-2 sm:py-2.5'
            >
              <div className='min-w-0 truncate font-medium'>{rule.label}</div>
              <div className='grid min-w-0 grid-cols-3 gap-2 sm:contents'>
                <label className='grid min-w-0 gap-1'>
                  <span className='text-muted-foreground truncate text-[11px] sm:sr-only'>
                    客户门槛
                  </span>
                  <Input
                    className='min-w-0 px-2'
                    name={ruleFieldName(ruleSet.category, rule, 'threshold')}
                    type='number'
                    min='0'
                    step='1'
                    required
                    defaultValue={rule.effectivePaidCustomerThreshold}
                  />
                </label>
                <label className='grid min-w-0 gap-1'>
                  <span className='text-muted-foreground truncate text-[11px] sm:sr-only'>
                    首单 %
                  </span>
                  <Input
                    className='min-w-0 px-2'
                    name={ruleFieldName(ruleSet.category, rule, 'first')}
                    type='number'
                    min='0'
                    max='100'
                    step='0.01'
                    required
                    defaultValue={toPercentInputValue(rule.firstOrderRate)}
                  />
                </label>
                <label className='grid min-w-0 gap-1'>
                  <span className='text-muted-foreground truncate text-[11px] sm:sr-only'>
                    复购 %
                  </span>
                  <Input
                    className='min-w-0 px-2'
                    name={ruleFieldName(ruleSet.category, rule, 'repurchase')}
                    type='number'
                    min='0'
                    max='100'
                    step='0.01'
                    required
                    defaultValue={toPercentInputValue(rule.repurchaseRate)}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function SettingsGroup(props: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('min-w-0', props.className)}>
      <h4 className='mb-3 text-sm font-semibold'>{props.title}</h4>
      {props.children}
    </section>
  )
}

function SettingsSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['crm', 'settings'],
    queryFn: crmApi.settings,
  })
  const settings = query.data
  const mutation = useMutation({
    mutationFn: crmApi.updateSettings,
    onSuccess: (next) => {
      toast.success(t('设置已保存'))
      queryClient.setQueryData(['crm', 'settings'], next)
      void queryClient.invalidateQueries({ queryKey: ['crm'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t('设置保存失败'))
    },
  })

  if (query.isLoading) {
    return <CrmState kind='loading' title={t('正在加载系统设置')} />
  }

  if (query.isError || !settings) {
    return (
      <CrmState
        kind='error'
        title={t('系统设置加载失败')}
        description={
          query.error instanceof Error
            ? query.error.message
            : t('请检查 CRM 服务后重试。')
        }
        onRetry={() => {
          void query.refetch()
        }}
      />
    )
  }

  return (
    <Panel title='佣金和基础设置'>
      <form
        key={`settings-${query.dataUpdatedAt}`}
        className='grid gap-5'
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate(
            buildSettingsUpdatePayload(
              settings,
              new FormData(event.currentTarget)
            )
          )
        }}
      >
        <div className='grid min-w-0 gap-4 @6xl/content:grid-cols-2'>
          {settings.agentCommissionRuleSets.map((ruleSet) => (
            <CommissionRuleSetEditor key={ruleSet.category} ruleSet={ruleSet} />
          ))}
        </div>

        <div className='border-border/70 grid gap-5 border-y py-5 lg:grid-cols-3 lg:gap-0 lg:divide-x'>
          <SettingsGroup title='直属上级服务费' className='lg:pe-5'>
            <div className='grid gap-3 sm:grid-cols-2'>
              <SettingsNumberField
                label='首单服务费 %'
                name='parentFirstOrderRate'
                max='100'
                step='0.01'
                defaultValue={toPercentInputValue(
                  settings.parentAgentServiceFeeRules.firstOrderRate
                )}
              />
              <SettingsNumberField
                label='复购服务费 %'
                name='parentRepurchaseRate'
                max='100'
                step='0.01'
                defaultValue={toPercentInputValue(
                  settings.parentAgentServiceFeeRules.repurchaseRate
                )}
              />
            </div>
          </SettingsGroup>
          <SettingsGroup title='平台封顶' className='lg:px-5'>
            <div className='grid gap-3 sm:grid-cols-2'>
              <SettingsNumberField
                label='首单总佣金封顶 %'
                name='platformFirstOrderCap'
                max='100'
                step='0.01'
                defaultValue={toPercentInputValue(
                  settings.platformCommissionCaps.firstOrderRate
                )}
              />
              <SettingsNumberField
                label='复购总佣金封顶 %'
                name='platformRepurchaseCap'
                max='100'
                step='0.01'
                defaultValue={toPercentInputValue(
                  settings.platformCommissionCaps.repurchaseRate
                )}
              />
            </div>
          </SettingsGroup>
          <SettingsGroup title='运营基础设置' className='lg:ps-5'>
            <div className='grid gap-3 sm:grid-cols-2'>
              <SettingsNumberField
                label='最低提现金额'
                name='withdrawalMinAmountRmb'
                step='0.01'
                defaultValue={settings.withdrawalMinAmountRmb}
              />
              <SettingsNumberField
                label='大客户默认单张佣金'
                name='enterpriseDefaultFixedCommissionPerImage'
                step='0.0001'
                defaultValue={settings.enterpriseDefaultFixedCommissionPerImage}
              />
            </div>
          </SettingsGroup>
        </div>

        <SettingsGroup title='线下收款信息'>
          <div className='grid gap-5 lg:grid-cols-2 lg:gap-0 lg:divide-x'>
            {settings.offlineRechargeAccounts.map((account) => (
              <div
                key={account.method}
                className='grid min-w-0 gap-3 lg:first:pe-5 lg:last:ps-5'
              >
                <Badge variant='outline' className='mb-1 w-fit'>
                  {account.label || offlineMethodText(account.method)}
                </Badge>
                <SettingsTextField
                  label='收款方'
                  name={offlineRechargeFieldName(
                    account.method,
                    'recipientName'
                  )}
                  defaultValue={account.recipientName}
                  placeholder='公司或个人收款名称'
                />
                <SettingsTextField
                  label='收款账号'
                  name={offlineRechargeFieldName(account.method, 'account')}
                  defaultValue={account.account}
                  placeholder='支付宝账号、微信号或收款账号'
                />
                <SettingsTextField
                  label='二维码链接'
                  name={offlineRechargeFieldName(account.method, 'qrCodeUrl')}
                  defaultValue={account.qrCodeUrl}
                  placeholder='收款二维码图片 URL'
                />
                <SettingsTextField
                  label='转账说明'
                  name={offlineRechargeFieldName(
                    account.method,
                    'instructions'
                  )}
                  defaultValue={account.instructions}
                  placeholder='例如：转账备注填写用户名'
                />
              </div>
            ))}
          </div>
        </SettingsGroup>

        <div className='bg-background/90 sticky bottom-0 z-10 -mx-3 flex justify-end border-t px-3 py-3 backdrop-blur sm:-mx-4 sm:px-4'>
          <Button
            type='submit'
            disabled={mutation.isPending}
            className='w-full sm:w-auto sm:min-w-32'
          >
            <SlidersHorizontal className='size-4' />
            {mutation.isPending ? '保存中' : '保存设置'}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

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
