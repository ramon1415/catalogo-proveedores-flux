import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const tokens = read('app/src/theme/tokens.css')
const intakePage = read('app/src/features/provider-intakes/ProviderIntakesPage.tsx')
const intakeCss = read('app/src/features/provider-intakes/ProviderIntakes.module.css')
const receiptsCss = read('app/src/features/comprobantes/Comprobantes.module.css')

test('migrated React button classes have complete shared styling', () => {
  for (const className of ['primary-btn', 'secondary-btn', 'small-btn', 'danger-btn']) {
    assert.match(tokens, new RegExp(`\\.${className}`))
  }
  assert.match(tokens, /\.primary-btn:focus-visible/)
  assert.match(tokens, /\.primary-btn:disabled/)
  assert.match(tokens, /\.danger-btn:hover:not\(:disabled\)/)
})

test('provider intake restores the primary links action and responsive filter grid', () => {
  assert.match(intakePage, /className="primary-btn"[\s\S]{0,120}>Administrar ligas<\/button>/)
  assert.match(intakeCss, /grid-template-columns: repeat\(4, minmax\(150px, 1fr\)\)/)
  assert.match(intakeCss, /@media \(max-width: 1100px\)/)
  assert.match(intakeCss, /@media \(max-width: 680px\)/)
})

test('intake and receipts controls use tokenized focus-visible form styling', () => {
  for (const css of [intakeCss, receiptsCss]) {
    assert.match(css, /background: var\(--bg-input\)/)
    assert.match(css, /border-color: var\(--accent\)/)
    assert.match(css, /box-shadow: 0 0 0 3px var\(--accent-dim\)/)
    assert.match(css, /input:not\(\[type='radio'\]\):not\(\[type='checkbox'\]\):not\(\[type='file'\]\)/)
  }
})
