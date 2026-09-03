import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const requestModal = readFileSync('app/src/features/solicitudes/RequestModal.tsx', 'utf8')
const api = readFileSync('app/src/features/solicitudes/api.ts', 'utf8')
const types = readFileSync('app/src/features/solicitudes/types.ts', 'utf8')
const migration = readFileSync('supabase/migrations/20260903203000_reimbursement_supporting_documents_atomic.sql', 'utf8')

test('reimbursement uploads every selected receipt before creating the request', () => {
  assert.match(requestModal, /createReimbursementRequestWithDocuments/)
  assert.match(requestModal, /uploadReceipt\(item\.file, `solicitudes\/drafts\/\$\{profile\.id\}`\)/)
  assert.match(requestModal, /stagedDocumentPaths\.push\(storagePath\)/)
  assert.match(requestModal, /data = await createReimbursementRequestWithDocuments\(payload, stagedItems\)/)
  assert.doesNotMatch(requestModal, /data = await createPaymentRequest\(payload\)/)
  assert.doesNotMatch(requestModal, /insertReimbursementItems\(inserts\)/)
  assert.doesNotMatch(requestModal, /Comprobantes no subidos/)
})

test('failed staging or RPC removes every unlinked temporary object', () => {
  assert.match(requestModal, /const stagedDocumentPaths: string\[\] = \[\]/)
  assert.match(requestModal, /for \(const path of stagedDocumentPaths\)/)
  assert.match(requestModal, /await removeReceipt\(path\)/)
  assert.match(requestModal, /stagedDocumentPaths\.length = 0/)
})

test('api calls the dedicated atomic reimbursement RPC', () => {
  assert.match(api, /export async function createReimbursementRequestWithDocuments/)
  assert.match(api, /supabase\.rpc\('create_reimbursement_request_with_documents'/)
  assert.match(api, /p_items: items/)
  assert.match(types, /se suben a staging antes de crear el reembolso/)
})

test('database wrapper validates ownership and inserts request plus items in one transaction', () => {
  for (const expected of [
    'security definer',
    'reimbursement_document_not_found_or_not_owned',
    'object.owner = v_auth_user_id',
    'public.create_payment_request(',
    'insert into public.reimbursement_items',
    "p_request_type => 'reimbursement'",
    'grant execute on function public.create_reimbursement_request_with_documents',
    'to authenticated, service_role',
  ]) assert.ok(migration.toLowerCase().includes(expected.toLowerCase()), `missing ${expected}`)
  assert.match(migration, /revoke all on function[\s\S]*from public, anon/i)
})
