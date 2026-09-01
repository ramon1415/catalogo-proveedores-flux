import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const page = fs.readFileSync(path.join(root, 'app/src/features/comprobantes/ComprobantesPage.tsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'app/src/features/comprobantes/Comprobantes.module.css'), 'utf8')

test('Comprobantes DEV preserves the complete operational guidance from the approved view', () => {
  assert.match(page, /Comprobantes bancarios · BBVA PDF V1/)
  assert.match(page, /Vinculación 1:1 protegida/)
  assert.match(page, /FLOW_STEPS/)
  assert.match(page, /¿Ya aparece un lote\?/)
  assert.match(page, /Flux abrirá el lote original para evitar duplicados/)
})

test('Comprobantes DEV keeps enriched KPI cards and the guided empty state', () => {
  assert.match(page, /subtitle: 'Batches visibles'/)
  assert.match(page, /subtitle: 'Requieren atención'/)
  assert.match(page, /className=\{s\.emptyState\}/)
  assert.match(css, /\.kpis \{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/)
  assert.match(css, /\.kpi\.processing::before/)
  assert.match(css, /\.emptyState/)
})

test('Visual parity does not remove operational batch actions', () => {
  for (const action of ['setUploadOpen(true)', 'refreshAll', 'setSelectedId(b.id)', 'setOperation(op)', 'setBulkOpen(true)']) {
    assert.ok(page.includes(action), `missing operational action: ${action}`)
  }
})
