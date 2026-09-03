import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const detail = readFileSync('app/src/features/solicitudes/DetailModal.tsx', 'utf8')
const requestModal = readFileSync('app/src/features/solicitudes/RequestModal.tsx', 'utf8')
const editModal = readFileSync('app/src/features/solicitudes/EditModal.tsx', 'utf8')
const api = readFileSync('app/src/features/solicitudes/api.ts', 'utf8')
const migration = readFileSync('supabase/migrations/20260903192500_request_supporting_documents_hotfix.sql', 'utf8')

test('detalle de solicitud respeta el módulo incidencias de la empresa activa', () => {
  assert.ok(detail.includes("const showIncidencias = isEnabled('incidencias')"))
  assert.ok(detail.includes('if (canApprove && showIncidencias)'))
  assert.ok(detail.includes('{canApprove && showIncidencias && ('))
})

test('detalle distingue el documento de origen del comprobante bancario final', () => {
  assert.ok(detail.includes('Factura / comprobante de la solicitud'))
  assert.ok(detail.includes('Documento faltante · adjuntar ahora'))
  assert.ok(detail.includes('Comprobante bancario del pago'))
  assert.ok(detail.includes('no es la factura o comprobante adjunto al crear la solicitud'))
  assert.ok(detail.includes('receiptSummary && (isPaid || receiptSummary?.link)'))
})

test('los comprobantes por renglón del reembolso se pueden abrir desde el detalle', () => {
  assert.ok(detail.includes('onOpenReceipt={openInvoice}'))
  assert.ok(detail.includes('Ver comprobante adjunto'))
  assert.ok(detail.includes("item.deducible ? 'Comprobante faltante' : 'Sin comprobante fiscal'"))
})

test('la solicitud normal sube primero el documento y luego crea/enlaza transaccionalmente', () => {
  assert.ok(requestModal.includes('createPaymentRequestWithDocument'))
  assert.ok(requestModal.includes('removeReceipt'))
  assert.ok(requestModal.includes('`solicitudes/drafts/${profile.id}`'))
  assert.ok(requestModal.includes('data = await createPaymentRequestWithDocument(payload, stagedDocumentPath)'))
  assert.ok(!requestModal.includes('await linkInvoicePath(requestId, path)'))
  assert.ok(api.includes("supabase.rpc('create_payment_request_with_document'"))
  assert.ok(api.includes('export async function removeReceipt'))
})

test('editar obliga a reparar una solicitud histórica sin documento', () => {
  assert.ok(editModal.includes('!request.invoice_storage_path && !file'))
  assert.ok(editModal.includes('Adjunta la factura o comprobante antes de guardar'))
})

test('la migración alinea MIME, RLS y el wrapper transaccional', () => {
  for (const expected of [
    "'text/xml'",
    "'application/xml'",
    'Authenticated can upload request supporting documents',
    'Authenticated can read request supporting documents',
    'Authenticated can delete own staged request documents',
    'create_payment_request_with_document',
    'request_document_not_found_or_not_owned',
    'invoice_storage_path = v_storage_path',
  ]) {
    assert.ok(migration.includes(expected), `falta contrato: ${expected}`)
  }
})
