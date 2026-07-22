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
  agentCategories,
  riskCaseTypes,
  riskTargetTypes,
} from '@ai-native/crm-contracts'
import { useState } from 'react'

import type { CrmSection } from '@/components/layout/config/crm.config'

import {
  CheckboxField,
  Field,
  SelectField,
  SubmitForm,
  formNumber,
  formValue,
} from './form-controls'
import { useCrmAction } from './query-controls'
import { riskCaseTypeOptions, riskTargetTypeOptions } from './section-config'
import { UserPicker } from './user-picker'

export function AdminForms({ section }: { section: CrmSection }) {
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
