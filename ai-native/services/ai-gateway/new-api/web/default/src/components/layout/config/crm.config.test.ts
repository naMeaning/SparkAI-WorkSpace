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
import { test } from 'node:test'

import { CRM_VIEW } from './crm.config'

const t = ((value: string) => value) as Parameters<
  typeof CRM_VIEW.getNavGroups
>[0]

test('CRM admin navigation exposes every section as a direct link', () => {
  const groups = CRM_VIEW.getNavGroups(t, { role: 100 })
  const items = groups.flatMap((group) => group.items)

  assert.deepEqual(
    groups.map((group) => group.title),
    ['平台管理', '资金与结算', '风控与治理']
  )
  assert.equal(
    items.every((item) => !item.items),
    true
  )
  assert.equal(items[0]?.url, '/crm/admin-dashboard')
  assert.equal(new Set(items.map((item) => item.url)).size, 14)
  assert.deepEqual(
    items
      .filter(
        (item) =>
          item.url !== undefined &&
          ['/crm/users', '/crm/settings'].includes(item.url)
      )
      .map((item) => item.title),
    ['分销档案', '分销规则']
  )
})

test('CRM agent navigation keeps My Distribution pages directly discoverable', () => {
  const groups = CRM_VIEW.getNavGroups(t, { role: 1 })
  const items = groups.flatMap((group) => group.items)

  assert.deepEqual(
    groups.map((group) => group.title),
    ['我的分销', '资金与用量']
  )
  assert.equal(
    items.every((item) => !item.items),
    true
  )
  assert.equal(items[0]?.url, '/crm/agent-overview')
  assert.equal(new Set(items.map((item) => item.url)).size, 7)
})
