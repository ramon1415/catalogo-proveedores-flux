import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(new URL('../..', import.meta.url).pathname)
const requestModal = readFileSync(resolve(root, 'app/src/features/solicitudes/RequestModal.tsx'), 'utf8')
const api = readFileSync(resolve(root, 'app/src/features/solicitudes/api.ts'), 'utf8')
const logic = readFileSync(resolve(root, 'app/src/features/solicitudes/logic.ts'), 'utf8')
const detail = readFileSync(resolve(root, 'app/src/features/solicitudes/DetailModal.tsx'), 'utf8')
const migration = readFileSync(resolve(root, 'supabase/migrations/20260923233500_payment_request_attachments.sql'), 'utf8')

test('solicitudes accepts multiple request attachments with supported file types', () => {
  assert.match(requestModal, /type="file"[\s\S]*multiple/)
  assert.match(requestModal, /\.xml/)
  assert.match(requestModal, /\.txt/)
  assert.match(requestModal, /\.ddf/)
  assert.match(logic, /MAX_REQUEST_ATTACHMENTS = 10/)
  assert.match(logic, /PDF, XML, TXT o DDF/)
})

test('all uploaded files are persisted while the first stays legacy-compatible', () => {
  assert.match(requestModal, /for \(const selectedFile of files\)/)
  assert.match(requestModal, /insertRequestAttachments\(/)
  assert.match(requestModal, /linkInvoicePath\(requestId, uploaded\[0\]\.path\)/)
  assert.match(api, /from\('payment_request_attachments'\)\.insert\(rows\)/)
})

test('detail lists attachments and database migration scopes them by company', () => {
  assert.match(detail, /loadRequestAttachments\(request\.id\)/)
  assert.match(detail, /Adjuntos \(\$\{attachments\.length\}\)/)
  assert.match(migration, /create table if not exists public\.payment_request_attachments/)
  assert.match(migration, /has_active_company_membership\(public\.current_profile_id\(\), company_id\)/)
  assert.match(migration, /allowed_mime_types/)
  assert.match(migration, /text\/plain/)
})
