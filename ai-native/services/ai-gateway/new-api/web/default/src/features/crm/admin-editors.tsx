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
  agentCategories,
  agentStatuses,
  signupTrialGrantStatuses,
  type AgentDto,
  type CrmUserDto,
} from '@ai-native/crm-contracts'
import { useState } from 'react'

import type { StaticDataTableColumn } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

import { crmApi } from './api'
import { agentColumns, userColumns } from './admin-columns'
import { DataSection } from './data-section'
import {
  ActionGroup,
  CheckboxField,
  Field,
  SelectField,
  formNumber,
  formValue,
} from './form-controls'
import { useCrmAction, useCrmPatchAction } from './query-controls'
import { UserPicker } from './user-picker'

export function UserProfileEditor({
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

export function AdminUsersSection() {
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

export function AgentEditor({
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

export function AdminAgentsSection() {
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
