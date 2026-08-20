import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const source = readFileSync(
  fileURLToPath(new URL('./index.tsx', import.meta.url)),
  'utf8'
)
const localeDir = fileURLToPath(
  new URL('../../i18n/locales/', import.meta.url)
)

test('default about page does not expose upstream implementation repository', () => {
  for (const forbidden of [
    'QuantumNous/new-api',
    'New API Project Repository',
    'One API',
    'songquanpeng',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden)
  }
})

test('about locale defaults do not keep upstream implementation repository labels', () => {
  for (const fileName of readdirSync(localeDir)) {
    if (!fileName.endsWith('.json')) continue
    const localeSource = readFileSync(`${localeDir}/${fileName}`, 'utf8')
    for (const forbidden of [
      'New API Project Repository:',
      'https://github.com/QuantumNous/new-api',
    ]) {
      assert.equal(localeSource.includes(forbidden), false, fileName)
    }
  }
})
