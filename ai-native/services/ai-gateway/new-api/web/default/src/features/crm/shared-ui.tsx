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
  commissionTypes,
  ledgerEventTypes,
  offlineRechargeMethods,
  orderKinds,
  standardAgentLevelRules,
  withdrawalMethods,
} from '@ai-native/crm-contracts'
import { AlertCircle, Inbox, LoaderCircle, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
import { cn } from '@/lib/utils'

export function money(value: unknown): string {
  return Number(value || 0).toFixed(2)
}

export function discountFold(value: unknown): string {
  const fold = Number(value || 1) * 10
  return `${Number.isInteger(fold) ? fold : fold.toFixed(1)} 折`
}

export function firstTopupBenefitText(
  available: boolean,
  discountRate: number | null | undefined
): string {
  if (available) {
    return discountFold(discountRate)
  }
  return discountRate ? '已使用' : '无'
}

export function rate(value: unknown): string {
  return `${(Number(value || 0) * 100).toFixed(1)}%`
}

export function levelText(value: string | null | undefined): string {
  return (
    standardAgentLevelRules.find((item) => item.level === value)?.label ||
    value ||
    '-'
  )
}

export function statusText(value: string | null | undefined): string {
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

export function eventTypeText(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    [accountEventTypes.adminPaidTopup]: '线下实付入账',
    [accountEventTypes.compensationGrant]: '补偿赠送',
    [accountEventTypes.exceptionAdjustment]: '异常调整',
    [accountEventTypes.onlineTopup]: '线上支付',
  }
  return (value && labels[value]) || value || '-'
}

export function ledgerTypeText(value: string | null | undefined): string {
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

export function commissionText(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    [commissionTypes.agentDirectCommission]: '代理直接佣金',
    [commissionTypes.parentAgentServiceFee]: '直属上级服务费',
    [commissionTypes.enterpriseFixedPerImage]: '大客户固定单张佣金',
  }
  return (value && labels[value]) || value || '-'
}

export function orderKindText(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    [orderKinds.firstOrder]: '首单',
    [orderKinds.repurchase]: '复购',
  }
  return (value && labels[value]) || value || '-'
}

export function offlineMethodText(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    [offlineRechargeMethods.alipay]: '支付宝',
    [offlineRechargeMethods.wechat]: '微信',
  }
  return (value && labels[value]) || value || '-'
}

export function withdrawalMethodText(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    [withdrawalMethods.alipay]: '支付宝',
    [withdrawalMethods.wechat]: '微信',
    [withdrawalMethods.bank]: '银行卡',
  }
  return (value && labels[value]) || value || '-'
}

export function badgeVariant(
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

export function StatusBadge({ status }: { status?: string | null }) {
  return <Badge variant={badgeVariant(status)}>{statusText(status)}</Badge>
}

export function userName(
  username: string | undefined,
  id: number | null | undefined
): string {
  return username || (id ? `#${id}` : '-')
}

export function Panel(props: {
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

export function MetricGrid({
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

export function CrmState(props: {
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
