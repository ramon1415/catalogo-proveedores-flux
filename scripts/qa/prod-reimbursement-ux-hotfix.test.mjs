import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const modal = fs.readFileSync(
  'app/src/features/solicitudes/RequestModal.tsx',
  'utf8',
)
const reimbursement = fs.readFileSync(
  'app/src/features/solicitudes/ReimbursementSection.tsx',
  'utf8',
)
const styles = fs.readFileSync(
  'app/src/features/solicitudes/Solicitudes.module.css',
  'utf8',
)

test('reimbursement starts with contextual language and no duplicate amount input', () => {
  assert.match(modal, /Nueva solicitud de reembolso/)
  assert.match(modal, /Datos del reembolso/)
  assert.match(modal, /Crear reembolso/)
  assert.ok(
    modal.indexOf('Tipo de solicitud *') < modal.indexOf('Metodo de pago *'),
    'request type must appear before payment method',
  )
  assert.match(modal, /\{!isReembolso && \([\s\S]*<label>Monto solicitado/)
  assert.match(modal, /className=\{isReembolso \? s\.fullRow : ''\}>Moneda/)
  assert.doesNotMatch(modal, /readOnly=\{isReembolso\}/)
})

test('the request body uses the modal spacing instead of edge-to-edge inline overrides', () => {
  assert.match(modal, /<div className=\{s\.modalScroll\}>[\s\S]*<div className=\{s\.requestLayout\}>/)
  assert.doesNotMatch(modal, /className=\{s\.modalScroll\} style=\{\{ padding: 0 \}\}/)
  assert.match(styles, /\.modalScroll::\-webkit\-scrollbar/)
})

test('expense rows use a two-level responsive layout and compact file picker', () => {
  assert.match(reimbursement, /s\.itemDescription/)
  assert.match(reimbursement, /s\.itemAmount/)
  assert.match(reimbursement, /s\.itemCategory/)
  assert.match(reimbursement, /s\.itemNoReceipt/)
  assert.match(reimbursement, /s\.filePickerButton/)
  assert.match(reimbursement, /Sin comprobante fiscal/)
  assert.doesNotMatch(reimbursement, /Sin comprobante fiscal \(no deducible\)/)
  assert.match(styles, /\.itemNoReceipt \{ grid-column: 1 \/ 3; grid-row: 2;/)
  assert.match(styles, /\.itemsFile \{[^}]*grid-column: 3 \/ 5;[^}]*grid-row: 2;/)
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.itemsFile \{ grid-column: 1 \/ -1; grid-row: 4; \}/)
})

test('bank destination is masked in the reimbursement card', () => {
  assert.match(reimbursement, /maskedBankDestination\(bankAccount\)/)
  assert.match(reimbursement, /slice\(-4\)/)
  assert.doesNotMatch(reimbursement, /`CLABE \$\{bankAccount\.clabe\}`/)
  assert.doesNotMatch(reimbursement, /`Cuenta \$\{bankAccount\?\.cuenta\}`/)
})
