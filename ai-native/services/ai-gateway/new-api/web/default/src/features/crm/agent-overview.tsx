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
  offlineRechargeMethods,
  withdrawalMethods,
  type CrmAgentDashboardDto,
  type CrmSessionDto,
} from '@ai-native/crm-contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getSelf } from '@/lib/api'
import { formatQuota } from '@/lib/format'

import { crmApi } from './api'
import { registrationInviteCode } from './display'
import {
  Field,
  SelectField,
  SubmitForm,
  formNumber,
  formValue,
} from './form-controls'
import {
  CrmState,
  MetricGrid,
  Panel,
  discountFold,
  money,
  offlineMethodText,
} from './shared-ui'

export function AgentOverview({ session }: { session: CrmSessionDto }) {
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

export function AgentMetrics({ dashboard }: { dashboard?: CrmAgentDashboardDto }) {
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

export function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className='bg-card/40 min-w-0 rounded-lg border px-3 py-2.5'>
      <div className='text-muted-foreground truncate text-xs'>{label}</div>
      <div className='mt-1 min-w-0 text-sm font-medium break-words'>
        {value}
      </div>
    </div>
  )
}
