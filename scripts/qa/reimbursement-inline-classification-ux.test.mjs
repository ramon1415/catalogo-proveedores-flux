import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const modal = fs.readFileSync('app/src/features/solicitudes/RequestModal.tsx', 'utf8')
const reimbursement = fs.readFileSync('app/src/features/solicitudes/ReimbursementSection.tsx', 'utf8')
const styles = fs.readFileSync('app/src/features/solicitudes/Solicitudes.module.css', 'utf8')

test('reimbursement selects company, center and month next to its expense rows', () => {
  assert.match(reimbursement, /Empresa y periodo del reembolso/)
  assert.match(reimbursement, /Selecciona estos datos una sola vez/)
  assert.match(reimbursement, /<label>Empresa \*/)
  assert.match(reimbursement, /<label>Centro de costo \*/)
  assert.match(reimbursement, /<label>Mes presupuestal \*/)
  assert.ok(
    reimbursement.indexOf('Empresa y periodo del reembolso') < reimbursement.indexOf('Partida presupuestal *'),
    'the shared scope must appear before the per-expense category selector',
  )
})

test('the separate classification card is not rendered for reimbursements', () => {
  assert.match(
    modal,
    /\{!isReembolso && \(\s*<section className=\{s\.formSection\}>\s*<h3>Clasificacion presupuestal<\/h3>/,
  )
  assert.match(modal, /companies=\{myCompanies\}/)
  assert.match(modal, /costCenters=\{costCenters\}/)
  assert.match(modal, /onBudgetMonthChange=\{onMonthChange\}/)
})

test('category permissions and responsive behavior remain in the reimbursement flow', () => {
  assert.match(modal, /categoryRows=\{filteredCategoryRows\}/)
  assert.match(reimbursement, /categoryRows\.map/)
  assert.match(styles, /\.reimbursementScopeGrid \{ grid-template-columns:/)
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.reimbursementScopeGrid \{ grid-template-columns: 1fr; \}/)
})
