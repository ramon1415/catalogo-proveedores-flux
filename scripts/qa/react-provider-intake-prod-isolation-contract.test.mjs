import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const app = read('app/src/App.tsx')
const tokens = read('app/src/theme/tokens.css')
const intakePage = read('app/src/features/provider-intakes/ProviderIntakesPage.tsx')
const intakeCss = read('app/src/features/provider-intakes/ProviderIntakes.module.css')

test('production promotion switches only provider intake to React', () => {
  assert.match(app, /lazy\(\(\) => import\('\.\/features\/provider-intakes\/ProviderIntakesPage'\)\)/)
  assert.match(app, /path="solicitudes-proveedores" element=\{<ProviderIntakesPage \/>\}/)
  assert.match(app, /path="comprobantes-batch" element=\{<LegacyModuleFrame/)
  assert.match(app, /path="cortes-semanales" element=\{<LegacyModuleFrame/)
  assert.doesNotMatch(app, /features\/comprobantes\/ComprobantesPage/)
  assert.doesNotMatch(app, /features\/cortes\/CortesPage/)
})

test('provider intake keeps the validated controls, filters, and KPI styling', () => {
  for (const className of ['primary-btn', 'secondary-btn', 'small-btn', 'danger-btn']) {
    assert.match(tokens, new RegExp(`\\.${className}`))
  }
  assert.match(intakePage, /Portal de proveedores · Fase 2B/)
  assert.match(intakePage, /className="primary-btn"[\s\S]{0,120}>\+ Generar liga de proveedor<\/button>/)
  assert.match(intakePage, /onClick=\{clearFilters\}>Limpiar<\/button>/)
  assert.match(intakeCss, /grid-template-columns: repeat\(7, minmax\(105px, 1fr\)\)/)
  assert.match(intakeCss, /@media \(max-width: 680px\)/)
})
