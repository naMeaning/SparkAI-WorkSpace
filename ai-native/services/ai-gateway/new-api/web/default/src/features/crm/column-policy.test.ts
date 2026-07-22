import assert from 'node:assert/strict'
import { test } from 'node:test'

import { crmFeatureSource as source } from './source-test-helper'

test('agent-facing CRM sections do not reuse admin columns that expose internal IDs', () => {
  for (const [section, adminColumns] of [
    ['agent-customers', 'customerColumns'],
    ['agent-team', 'agentColumns'],
    ['agent-commissions', 'commissionColumns'],
    ['agent-withdrawals', 'withdrawalColumns'],
    ['agent-offline-recharges', 'offlineRechargeColumns'],
  ] as const) {
    const marker = `section === '${section}'`
    const start = source.indexOf(marker)
    assert.notEqual(start, -1)
    const localBlock = source.slice(start, start + 500)
    assert.equal(localBlock.includes(`columns={${adminColumns}}`), false)
  }
})

test('risk management form uses operator-facing Chinese option labels', () => {
  assert.equal(source.includes("label='对象类型'"), false)
  assert.equal(source.includes("label='风险类型' name='riskType'"), false)
  assert.equal(source.includes("label='关联对象'"), true)
  assert.equal(source.includes("label='风险原因'"), true)
})

test('settings commission rule editor does not introduce horizontal scrolling', () => {
  const marker = 'function CommissionRuleSetEditor'
  const start = source.indexOf(marker)
  assert.notEqual(start, -1)
  const localBlock = source.slice(start, start + 4500)
  assert.equal(localBlock.includes('min-w-[720px]'), false)
  assert.equal(localBlock.includes('<table'), false)
  assert.equal(localBlock.includes('overflow-x'), false)
  assert.equal(
    localBlock.includes(
      'grid-cols-[5.5rem_minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,1fr)]'
    ),
    false
  )
  assert.equal(localBlock.includes('grid-cols-3'), true)
  assert.equal(localBlock.includes('sm:contents'), true)
  assert.equal(
    localBlock.includes(
      'sm:grid-cols-[minmax(5.5rem,0.8fr)_repeat(3,minmax(0,1fr))]'
    ),
    true
  )
  assert.equal(localBlock.includes('客户门槛'), true)
  assert.equal(localBlock.includes('首单 %'), true)
  assert.equal(localBlock.includes('复购 %'), true)
  assert.equal(localBlock.includes('min-w-0'), true)
})

test('settings commission rule cards only become two-column on wide content containers', () => {
  const marker = 'function SettingsSection'
  const start = source.indexOf(marker)
  assert.notEqual(start, -1)
  const localBlock = source.slice(start, start + 3500)
  assert.equal(localBlock.includes('xl:grid-cols-2'), false)
  assert.equal(localBlock.includes('@6xl/content:grid-cols-2'), true)
})
