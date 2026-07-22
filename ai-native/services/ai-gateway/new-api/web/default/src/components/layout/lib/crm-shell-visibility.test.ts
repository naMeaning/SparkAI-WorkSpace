import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isCrmWorkspacePath,
  shouldExposeNewApiAccountNavigation,
  shouldExposeNewApiShellNavigation,
} from './crm-shell-visibility'

test('recognizes only CRM workspace paths', () => {
  assert.equal(isCrmWorkspacePath('/crm'), true)
  assert.equal(isCrmWorkspacePath('/crm/admin-dashboard'), true)
  assert.equal(isCrmWorkspacePath('/crmfoo'), false)
  assert.equal(isCrmWorkspacePath('/dashboard'), false)
})

test('hides New API shell navigation inside CRM workspace', () => {
  assert.equal(shouldExposeNewApiShellNavigation('/crm/users', true), false)
  assert.equal(shouldExposeNewApiShellNavigation('/dashboard', true), true)
  assert.equal(shouldExposeNewApiShellNavigation('/dashboard', false), false)
  assert.equal(
    shouldExposeNewApiShellNavigation('/dashboard', true, false),
    false
  )
})

test('hides New API account navigation inside CRM workspace', () => {
  assert.equal(shouldExposeNewApiAccountNavigation('/crm/users'), false)
  assert.equal(shouldExposeNewApiAccountNavigation('/crm/admin-dashboard'), false)
  assert.equal(shouldExposeNewApiAccountNavigation('/dashboard'), true)
  assert.equal(shouldExposeNewApiAccountNavigation('/profile'), true)
  assert.equal(shouldExposeNewApiAccountNavigation('/profile', false), false)
})
