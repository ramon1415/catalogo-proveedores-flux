import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const request = readFileSync('app/src/features/solicitudes/RequestModal.tsx', 'utf8')
const api = readFileSync('app/src/features/solicitudes/api.ts', 'utf8')
const types = readFileSync('app/src/features/solicitudes/types.ts', 'utf8')
const detail = readFileSync('app/src/features/solicitudes/DetailModal.tsx', 'utf8')
const migrations = readdirSync('supabase/migrations')
const one = (suffix) => {
  const rows = migrations.filter((name) => name.endsWith(suffix))
  assert.equal(rows.length, 1, `expected exactly one ${suffix}, got ${rows.join(',')}`)
  return readFileSync(`supabase/migrations/${rows[0]}`, 'utf8')
}

test('requester prediction is optional, availability-filtered and editable', () => {
  assert.match(request, /fetchPartidaPrediction\(companyId, rfc\)/)
  assert.match(request, /availablePredictionCandidates/)
  assert.match(request, /Partida no disponible/)
  assert.match(request, /No estoy seguro de la partida/)
  assert.match(request, /partida_unsure: isReembolso \? false : partidaUnsure/)
})

test('current PROD atomic reimbursement/document paths remain present', () => {
  assert.match(request, /createReimbursementRequestWithDocuments/)
  assert.match(request, /stagedDocumentPaths/)
  assert.match(request, /createPaymentRequestWithDocument\(payload, stagedDocumentPath\)/)
  assert.doesNotMatch(request, /data = await createPaymentRequest\(payload\)/)
})

test('API forwards partita_unsure through direct and mandatory-document RPCs', () => {
  assert.equal((api.match(/p_partida_unsure: payload\.partida_unsure/g) || []).length, 2)
  assert.match(api, /from\('partida_predictions'\)/)
  assert.match(types, /partida_unsure: boolean/)
  assert.match(types, /export type PartidaPrediction/)
  assert.match(detail, /Partida por confirmar/)
})

test('prediction table is member-readable but anon cannot select', () => {
  const sql = one('_partida_predictions_prod.sql')
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /force row level security/i)
  assert.match(sql, /has_active_company_membership\(current_profile_id\(\), company_id\)/)
  assert.match(sql, /revoke all on table public\.partida_predictions from anon, authenticated/i)
  assert.match(sql, /grant select on table public\.partida_predictions to authenticated, service_role/i)
})

test('partida_unsure forward migration preserves current PROD functions and wrappers', () => {
  const sql = one('_partida_unsure_prod.sql')
  assert.match(sql, /p_partida_unsure boolean default false/)
  assert.match(sql, /invoice_uuid_duplicate/)
  assert.match(sql, /payment_request_has_active_approver_pool/)
  assert.match(sql, /beneficiary_profile_id/)
  assert.match(sql, /request_document_not_found_or_not_owned/)
  assert.match(sql, /p_partida_unsure => p_partida_unsure/)
  assert.match(sql, /atomic_reimbursement_wrapper_regressed/)
})

test('controlled aggregate seed is 98 + 62 and aborts on tenant identity mismatch', () => {
  const sql = one('_partida_predictions_seed_prod.sql')
  assert.match(sql, /partida_prediction_company_identity_mismatch/)
  assert.match(sql, /v_operadora <> 98 or v_fersana <> 62/)
  assert.match(sql, /on conflict \(company_id, rfc_emisor\) do update set/)
  assert.match(sql, /partida_prediction_category_resolution_failed/)
  assert.match(sql, /jsonb_array_elements\(p\.partida_candidates\)/)
  assert.match(sql, /144042c1-e493-4256-a86c-cd088a8898ce/)
  assert.match(sql, /20cd72aa-f281-4985-931b-a83422404b66/)
  assert.doesNotMatch(sql, /9680353c-9b86-4730-82e1-fce664f048a2|68b61801-74c0-44ea-a33b-f20e4bf53aa7/)
})
