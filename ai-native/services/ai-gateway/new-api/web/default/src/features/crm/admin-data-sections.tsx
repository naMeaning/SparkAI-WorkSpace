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
  accountEventStatuses,
  accountEventTypes,
  commissionStatuses,
  enterpriseMonthlySettlementStatuses,
  ledgerDirections,
  ledgerEventTypes,
  offlineRechargeStatuses,
  riskStatuses,
  riskTargetTypes,
  withdrawalStatuses,
} from '@ai-native/crm-contracts'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

import type { CrmActionColumns } from './action-columns'
import {
  accountEventColumns,
  auditColumns,
  commissionColumns,
  effectiveColumns,
  enterpriseColumns,
  ledgerColumns,
  offlineRechargeColumns,
  riskColumns,
  userColumns,
  withdrawalColumns,
} from './admin-columns'
import { crmApi } from './api'
import { DataSection } from './data-section'
import {
  CheckboxField,
  Field,
  SelectField,
  SubmitForm,
  formValue,
} from './form-controls'
import { FilterForm, useCrmAction } from './query-controls'
import type { SectionFilters } from './section-config'
import { UserPicker } from './user-picker'

export function AdminEffectiveCustomersSection({
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

export function AdminAccountEventsSection({ actions }: { actions: CrmActionColumns }) {
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

export function AdminLedgerSection() {
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

export function AdminCommissionsSection({ actions }: { actions: CrmActionColumns }) {
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

export function AdminOfflineRechargesSection({
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

export function AdminWithdrawalsSection({ actions }: { actions: CrmActionColumns }) {
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

export function AdminRiskSection({ actions }: { actions: CrmActionColumns }) {
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

export function AdminEnterpriseSection({ actions }: { actions: CrmActionColumns }) {
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

export function AdminAuditSection() {
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
