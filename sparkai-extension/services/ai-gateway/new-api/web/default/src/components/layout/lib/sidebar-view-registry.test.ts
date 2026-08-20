import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getNavGroupsForPath,
  resolveSidebarView,
} from './sidebar-view-registry'

const t = ((value: string) => value) as Parameters<
  NonNullable<ReturnType<typeof resolveSidebarView>>['getNavGroups']
>[0]

test('keeps ordinary paths in the primary sidebar instead of a drill-in view', () => {
  const view = resolveSidebarView('/dashboard')

  assert.equal(view, null)
  assert.equal(getNavGroupsForPath('/dashboard', t, { role: 1 }), null)
  assert.equal(getNavGroupsForPath('/profile', t, { role: 100 }), null)
})

test('keeps system settings as the only drill-in workspace', () => {
  const view = resolveSidebarView('/system-settings/site')

  assert.equal(view?.id, 'system-settings')
})
