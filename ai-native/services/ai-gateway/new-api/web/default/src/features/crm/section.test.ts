import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { resolveCrmSection } from './index'

describe('CRM section resolution', () => {
  test('keeps normal users in agent sections', () => {
    assert.equal(resolveCrmSection('agent-customers', false), 'agent-customers')
    assert.equal(resolveCrmSection('users', false), 'agent-overview')
  })

  test('keeps super admins in platform management sections', () => {
    assert.equal(resolveCrmSection('users', true), 'users')
    assert.equal(resolveCrmSection('agent-customers', true), 'admin-dashboard')
  })
})
