import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getNavGroupsForPath,
  resolveSidebarView,
} from './sidebar-view-registry'

const t = ((value: string) => value) as Parameters<
  NonNullable<ReturnType<typeof resolveSidebarView>>['getNavGroups']
>[0]

test('keeps CRM paths in the primary sidebar instead of a drill-in view', () => {
  const view = resolveSidebarView('/crm/users')

  assert.equal(view, null)
  assert.equal(getNavGroupsForPath('/crm/agent-overview', t, { role: 1 }), null)
  assert.equal(getNavGroupsForPath('/crm/users', t, { role: 100 }), null)
})

test('keeps system settings as the only drill-in workspace', () => {
  const view = resolveSidebarView('/system-settings/site')

  assert.equal(view?.id, 'system-settings')
})
