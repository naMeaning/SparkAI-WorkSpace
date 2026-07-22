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
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const source = readFileSync(
  fileURLToPath(new URL('./index.tsx', import.meta.url)),
  'utf8'
)

function assertContainsAll(label: string, needles: string[]) {
  for (const needle of needles) {
    assert.equal(
      source.includes(needle),
      true,
      `${label} should include ${needle}`
    )
  }
}

test('CRM admin forms use searchable user selection instead of raw CRM id fields', () => {
  assertContainsAll('user picker', [
    'function UserPicker',
    'queryFn: () => crmApi.users',
    "<UserPicker name='crmUserId'",
    "<UserPicker name='customerCrmUserId'",
    "<UserPicker name='agentCrmUserId'",
    "<UserPicker name='parentAgentCrmUserId'",
  ])
})

test('CRM user picker keeps search results collapsed until the operator interacts', () => {
  const marker = 'function UserPicker'
  const start = source.indexOf(marker)
  assert.notEqual(start, -1)
  const localBlock = source.slice(start, start + 4200)

  assertContainsAll('user picker dropdown behavior', [
    'const [open, setOpen] = useState(false)',
    'enabled: open',
    "type='search'",
    "role='combobox'",
    'aria-expanded={open}',
    "autoComplete='new-password'",
    "data-form-type='other'",
    "data-1p-ignore='true'",
    "data-lpignore='true'",
    "role='listbox'",
    'setOpen(false)',
  ])
  assert.equal(localBlock.includes('{open ? ('), true)
  assert.equal(
    localBlock.includes(
      "className='bg-popover text-popover-foreground absolute top-full z-20 mt-1 grid max-h-44 w-full gap-1 overflow-auto rounded-md border p-1 shadow-md'"
    ),
    true
  )
})

test('CRM admin pages expose currently supported operation endpoints', () => {
  assertContainsAll('operation endpoints', [
    '/crm/admin/users/${selectedUser.crmUserId}/profile',
    '/crm/admin/users/${row.crmUserId}/signup-trial/retry',
    '/crm/admin/account-events/${row.id}/reconcile',
    '/crm/admin/account-events/${row.id}/refund',
    '/crm/admin/effective-customers/evaluate',
    '/crm/admin/effective-customers/sync-consumption',
    '/crm/admin/effective-customers/maintenance',
    '/crm/admin/commissions/${row.id}/block',
    '/crm/admin/risk-cases/${row.id}',
    '/crm/admin/enterprise/monthly-settlements/${row.id}/mark-paid',
    '/crm/admin/enterprise/monthly-settlements/${row.id}/cancel',
  ])
})

test('CRM admin pages keep dedicated filter controls for operational review queues', () => {
  assertContainsAll('filter controls', [
    "name='status'",
    "name='eventType'",
    "name='direction'",
    "name='beneficiaryCrmUserId'",
    "name='operatorCrmUserId'",
    "name='targetType'",
    "name='targetId'",
    "name='period'",
    'countedForLevel',
  ])
})

test('agent recharge flow shows collection account and first topup payment context', () => {
  assertContainsAll('agent recharge context', [
    '收款信息',
    '收款方',
    '收款账号',
    '二维码链接',
    '转账说明',
    '付款备注',
    '首充实付',
  ])
})

test('agent balances come from New API while CRM financial queries fail closed', () => {
  assertContainsAll('asset boundary', [
    "queryKey: ['new-api', 'self']",
    'queryFn: getSelf',
    'formatQuota(quota)',
    "label='账户余额'",
    "queryKey: ['crm', 'agent-dashboard']",
    '为避免显示错误金额，页面不会使用空数据代替余额或佣金。',
    'collectionAccountReady',
    '收款账户尚未配置完整，请联系平台管理员后再提交。',
  ])
})

test('CRM operational actions use in-app dialogs instead of browser prompts', () => {
  assert.equal(source.includes('window.prompt'), false)
  assert.equal(source.includes('<Dialog'), true)
})

test('account event reconciliation uses explicit quota confirmation without automatic retry', () => {
  assertContainsAll('account event reconciliation', [
    'accountEventStatuses.quotaApplying',
    'accountEventStatuses.localApplying',
    'accountEventStatuses.reconcileRequired',
    "action: 'confirm_quota_applied'",
    "action: 'cancel'",
  ])
  assert.equal(source.includes("action: 'complete_local'"), false)
})

test('commission labels distinguish withdrawable amounts from paid amounts', () => {
  assertContainsAll('commission labels', [
    "released: '已打款结清'",
    "label: '已释放待提现'",
    "label: '已打款佣金'",
    '<option value={commissionStatuses.released}>已打款</option>',
  ])
})

test('CRM user profile editor does not expose obsolete model-service restriction controls', () => {
  assert.equal(source.includes('crmBanned'), false)
  assert.equal(source.includes('限制模型服务'), false)
})

test('CRM admin action dialog is mounted with the admin section body', () => {
  assert.match(
    source,
    /<div className='grid gap-4'>\s*\{actions\.dialog\}\s*<AdminForms/s
  )
})

test('risk case creation uses user picker only for user targets', () => {
  assertContainsAll('risk target selector', [
    'riskCreateTargetType',
    'setRiskCreateTargetType',
    'riskCreateTargetType === riskTargetTypes.user',
    "<Field label='对象标识' name='targetId' required />",
  ])
})

test('customer relationship page uses relationship-specific columns', () => {
  assertContainsAll('relationship columns', [
    'const relationshipColumns',
    "header: '客户'",
    "header: '归属代理'",
    "header: '绑定来源'",
    "header: '首充权益'",
    'relationshipBindSourceText(row.agentRelationship?.bindSource)',
    'columns={relationshipColumns}',
  ])
  assert.equal(
    source.includes("title='归属关系列表'\n          queryKey='relationships'"),
    true
  )
  assert.equal(
    source.includes(
      "title='客户归属'\n          queryKey='relationships'\n          queryFn={(params) =>\n            crmApi.users({ ...params, hasAgentRelationship: true })\n          }\n          columns={userColumns}"
    ),
    false
  )
})

test('CRM table actions use full-width mobile groups with explicit risk hierarchy', () => {
  assertContainsAll('responsive action groups', [
    'function ActionGroup',
    'mobileFullWidth: true',
    "mobileLabel: '可用操作'",
    "variant='destructive'",
    '<ActionGroup>',
  ])
})

test('customer relationship binding form uses a balanced responsive layout without dropping controls', () => {
  const marker = "if (section === 'relationships')"
  const start = source.indexOf(marker)
  assert.notEqual(start, -1)
  const localBlock = source.slice(start, start + 2200)

  assertContainsAll('relationship binding controls', [
    "<UserPicker name='customerCrmUserId' label='客户' required />",
    "<UserPicker name='agentCrmUserId' label='代理' required />",
    "<Field label='邀请码' name='inviteCode' />",
    "<Field label='原因' name='reason' />",
    "name='allowRebind'",
    '允许改绑',
    "buttonText='绑定'",
  ])
  assert.equal(localBlock.includes("fieldsClassName='grid gap-4'"), true)
  assert.equal(
    localBlock.includes("className='grid min-w-0 gap-4 lg:grid-cols-2'"),
    true
  )
})

test('CRM submit forms separate fields from the full-width action footer', () => {
  const marker = 'function SubmitForm'
  const start = source.indexOf(marker)
  assert.notEqual(start, -1)
  const localBlock = source.slice(start, start + 1800)

  assert.equal(
    localBlock.includes(
      "props.fieldsClassName ||\n            'grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4'"
    ),
    true
  )
  assert.equal(
    localBlock.includes(
      "'flex flex-col items-stretch gap-3 border-t pt-4 sm:flex-row sm:items-center',"
    ),
    true
  )
  assert.equal(
    localBlock.includes(
      "props.submitContent ? 'sm:justify-between' : 'sm:justify-end'"
    ),
    true
  )
  assert.equal(
    localBlock.includes("className='w-full sm:w-auto sm:min-w-32'"),
    true
  )
  assert.equal(localBlock.includes('min-h-10'), false)
})

test('CRM panels reuse the compact shared card surface instead of redefining one locally', () => {
  const marker = 'function Panel'
  const start = source.indexOf(marker)
  assert.notEqual(start, -1)
  const localBlock = source.slice(start, start + 900)

  assert.equal(
    source.includes("import { TitledCard } from '@/components/ui/titled-card'"),
    true
  )
  assert.equal(localBlock.includes("density='compact'"), true)
  assert.equal(localBlock.includes('disableHoverEffect'), true)
  assert.equal(localBlock.includes('bg-card/45'), false)
})

test('high-risk review actions require in-app confirmation before submit', () => {
  assert.doesNotMatch(
    source,
    /action\.mutate\(\{\s*path: '\/crm\/admin\/effective-customers\/evaluate'/s
  )
  assert.doesNotMatch(
    source,
    /patch\.mutate\(\{\s*path: `\/crm\/admin\/risk-cases\/\$\{row\.id\}`/s
  )
  assertContainsAll('review confirmation dialogs', [
    "reason: '复核有效客户'",
    "reason: '客户已退款，取消有效客户资格'",
    "reason: '关联账号，不计入有效客户'",
    "reason: '风险客户，不计入有效客户'",
    "method: 'PATCH'",
    "'更新风控单状态'",
    "label: '处理备注'",
  ])
})

test('agent management exposes edit controls for existing agents', () => {
  assertContainsAll('agent edit controls', [
    'function AgentEditor',
    '`/crm/admin/agents/${selectedAgent.id}`',
    'title={`编辑代理：',
    "label='类型'",
    "name='category'",
    "label='状态'",
    "name='status'",
    "<UserPicker name='parentAgentCrmUserId'",
    'columns={[...agentColumns, agentActions]}',
  ])
})
