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
  assert.match(intakePage, /Portal de proveedores · Fase 2B/)
  assert.match(intakePage, /Prepara, convierte y audita solicitudes desacopladas/)
  assert.match(intakePage, /className="primary-btn"[\s\S]{0,120}>\+ Generar liga de proveedor<\/button>/)
  for (const label of ['Folio', 'Proveedor', 'Estado', 'Desde', 'Hasta', 'Documentos', 'Recepción']) {
    assert.match(intakePage, new RegExp(`className=\\{s\\.filterField\\}>${label}`))
  }
  assert.match(intakePage, /onClick=\{clearFilters\}>Limpiar<\/button>/)
  assert.match(intakePage, /function clearFilters\(\) \{ setFilters\(initialFilters\(companyId\)\) \}/)
  assert.match(intakeCss, /grid-template-columns: repeat\(4, minmax\(150px, 1fr\)\)/)
  assert.match(intakeCss, /@media \(max-width: 1100px\)/)
  assert.match(intakeCss, /@media \(max-width: 680px\)/)
})

test('provider intake KPI cards preserve the legacy theme and readable numbers', () => {
  assert.match(intakeCss, /\.kpis \{[^}]*grid-template-columns: repeat\(7, minmax\(105px, 1fr\)\)/)
  assert.match(intakeCss, /\.kpi \{[^}]*background: var\(--bg-card\);[^}]*color: var\(--text-2\)/)
  assert.match(intakeCss, /\.kpi\.active \{[^}]*border-color: var\(--accent\);[^}]*box-shadow: inset 0 0 0 1px var\(--accent\);[^}]*background: color-mix\(in srgb, var\(--accent\) 8%, var\(--bg-card\)\)/)
  assert.match(intakeCss, /\.kpi strong \{[^}]*color: var\(--text-1\);[^}]*font-size: 23px;[^}]*font-variant-numeric: tabular-nums/)
  assert.match(intakeCss, /\.kpi span \{[^}]*font-size: 11px;[^}]*font-weight: 750/)
})

test('intake and receipts controls use tokenized focus-visible form styling', () => {
  for (const css of [intakeCss, receiptsCss]) {
    assert.match(css, /background: var\(--bg-input\)/)
    assert.match(css, /border-color: var\(--accent\)/)
    assert.match(css, /box-shadow: 0 0 0 3px var\(--accent-dim\)/)
    assert.match(css, /input:not\(\[type='radio'\]\):not\(\[type='checkbox'\]\):not\(\[type='file'\]\)/)
  }
})
