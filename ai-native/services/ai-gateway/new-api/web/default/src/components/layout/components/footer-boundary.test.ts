import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const source = readFileSync(
  fileURLToPath(new URL('./footer.tsx', import.meta.url)),
  'utf8'
)
const localeDir = fileURLToPath(
  new URL('../../../i18n/locales/', import.meta.url)
)

test('default footer does not expose upstream implementation projects', () => {
  for (const forbidden of [
    'QuantumNous/new-api',
    'docs.newapi.pro',
    'new-api-key-tool',
    'footer.newapi',
    'newApiKeyTool',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden)
  }
})

test('footer locale defaults do not keep upstream implementation labels', () => {
  for (const fileName of readdirSync(localeDir)) {
    if (!fileName.endsWith('.json')) continue
    const localeSource = readFileSync(`${localeDir}/${fileName}`, 'utf8')
    for (const forbidden of ['footer.newapi', 'new-api-key-tool']) {
      assert.equal(localeSource.includes(forbidden), false, fileName)
    }
  }
})
