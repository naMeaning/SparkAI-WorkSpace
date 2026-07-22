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
import type { CrmSettingsDto } from '@ai-native/crm-contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import { crmApi } from './api'
import {
  buildSettingsUpdatePayload,
  offlineRechargeFieldName,
  ruleFieldName,
  toPercentInputValue,
} from './settings-form'
import { CrmState, Panel, offlineMethodText } from './shared-ui'

export function SettingsNumberField(props: {
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

export function SettingsTextField(props: {
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

export function CommissionRuleSetEditor({
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

export function SettingsGroup(props: {
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

export function SettingsSection() {
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
