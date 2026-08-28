import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const pageUrl = new URL('../../app/src/features/solicitudes/SolicitudesPage.tsx', import.meta.url)
const source = await readFile(pageUrl, 'utf8')

test('solicitudes deriva KPIs, filas y modales desde la empresa activa', () => {
  assert.match(source, /const scopedRequests = useMemo\(/)
  assert.match(source, /request\.company_id === activeCompanyId/)
  assert.match(source, /allowedCompanyIds\.has\(request\.company_id \|\| ''\)/)
  assert.match(source, /const active = scopedRequests\.filter\(isActiveRequest\)/)
  assert.match(source, /return scopedRequests\.filter\(\(r\) =>/)
  assert.match(source, /detailId \? scopedRequests\.find/)
  assert.match(source, /editId \? scopedRequests\.find/)
})

test('los controles rápidos no pueden volver a Empresa: Todas', () => {
  assert.doesNotMatch(source, /setCompanyFilter\('todos'\)/)
  assert.doesNotMatch(source, /<option value="todos">Empresa: Todas<\/option>/)
  assert.match(source, /<select value=\{companyFilter\} disabled aria-label="Empresa activa">/)
})
