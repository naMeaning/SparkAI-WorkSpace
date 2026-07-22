import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { registerFormSchema } from './constants'

const baseRegisterForm = {
  username: 'demo-user',
  email: '',
  password: 'password123',
  confirmPassword: 'password123',
}

describe('auth form schemas', () => {
  test('keeps optional affiliate code for registration payloads', () => {
    const result = registerFormSchema.safeParse({
      ...baseRegisterForm,
      aff_code: 'ABCD1234',
    })

    assert.equal(result.success, true)
    assert.equal(result.data.aff_code, 'ABCD1234')
  })

  test('allows registration without affiliate code', () => {
    const result = registerFormSchema.safeParse(baseRegisterForm)

    assert.equal(result.success, true)
    assert.equal(result.data.aff_code, undefined)
  })
})
