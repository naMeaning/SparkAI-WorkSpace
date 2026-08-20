import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const source = readFileSync(
  fileURLToPath(new URL('./general-error.tsx', import.meta.url)),
  'utf8'
)
const localeDir = fileURLToPath(
  new URL('../../i18n/locales/', import.meta.url)
)

test('general error page does not send users to upstream implementation issues', () => {
  assert.equal(source.includes('QuantumNous/new-api'), false)
  assert.equal(source.includes('GitHub Issues'), false)
})

test('general error locale defaults do not keep upstream issue tracker labels', () => {
  for (const fileName of readdirSync(localeDir)) {
    if (!fileName.endsWith('.json')) continue
    const localeSource = readFileSync(`${localeDir}/${fileName}`, 'utf8')
    assert.equal(localeSource.includes('GitHub Issues'), false, fileName)
  }
})
