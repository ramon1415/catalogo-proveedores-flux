import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  new URL("../../supabase/migrations/037_secure_extraordinary_external_authorization.sql", import.meta.url),
  "utf8",
)
const requestUi = readFileSync(new URL("../../solicitudes_batch_execution.js", import.meta.url), "utf8")
const requestHtml = readFileSync(new URL("../../solicitudes.html", import.meta.url), "utf8")
const batchUi = readFileSync(new URL("../../approval_batches.js", import.meta.url), "utf8")
const batchHtml = readFileSync(new URL("../../approval_batches.html", import.meta.url), "utf8")

test("policy is fail-closed and Operadora cannot be enabled by the migration", () => {
  const schemaSection = migration.slice(
    0,
    migration.indexOf("create or replace function public.set_extraordinary_payment_policy"),
  )
  assert.match(migration, /enabled boolean not null default false/)
  assert.match(migration, /extraordinary_policy_disabled/)
  assert.match(migration, /Operadora policy must remain disabled/)
  assert.doesNotMatch(schemaSection, /insert into public\.extraordinary_payment_policies/i)
})

test("authorization is two-step, idempotent, time-bounded and Director-bound", () => {
  assert.match(migration, /function public\.begin_extraordinary_authorization/)
  assert.match(migration, /function public\.finalize_extraordinary_authorization/)
  assert.match(migration, /external_director_profile_id/)
  assert.match(migration, /idempotency_key_payload_mismatch/)
  assert.match(migration, /valid_until/)
  assert.match(migration, /external_authorization_time_invalid/)
  assert.match(migration, /finance_actor_must_differ_from_external_director/)
  assert.doesNotMatch(migration, /\bauthorization\.(?:[a-z_*])/i)
})

test("evidence remains private and is checked before activation", () => {
  assert.match(migration, /'extraordinary-approval-evidence'[\s\S]*false/)
  assert.match(migration, /allowed_mime_types/)
  assert.match(migration, /evidence_sha256/)
  assert.match(migration, /to_jsonb\(v_object\)->'user_metadata'->>'sha256'/)
  assert.match(requestUi, /metadata: \{ sha256: evidenceSha256 \}/)
  assert.match(migration, /extraordinary_evidence_object_metadata_mismatch/)
  assert.match(migration, /url_ttl_seconds', 120/)
  assert.doesNotMatch(requestUi, /service[_-]?role/i)
})

test("single consumption, ratification, dispute and confirmation guards are server-side", () => {
  assert.match(migration, /consumed_pending_ratification/)
  assert.match(migration, /function public\.extraordinary_consume_layout_line/)
  assert.match(migration, /function public\.ratify_extraordinary_authorization/)
  assert.match(migration, /function public\.dispute_extraordinary_authorization/)
  assert.match(migration, /extraordinary_payment_confirmation_requires_ratification/)
  assert.match(migration, /guard_extraordinary_payment_receipt_insert/)
  assert.match(migration, /guard_extraordinary_request_paid/)
  assert.match(migration, /material_change_invalidated/)
})

test("legacy shortcut is disabled and not granted back", () => {
  assert.match(migration, /authorize_payment_request_extraordinary\(uuid,text,text\)/)
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.authorize_payment_request_extraordinary\(uuid,text,text\)/i,
  )
  assert.match(migration, /has_function_privilege\([\s\S]*authorize_payment_request_extraordinary/)
})

test("UI captures the secure evidence contract and blocks duplicate submission", () => {
  assert.match(requestHtml, /extraordinaryDirector/)
  assert.match(requestHtml, /extraordinaryAuthorizedAt/)
  assert.match(requestHtml, /extraordinaryEvidenceFile/)
  assert.match(requestHtml, /extraordinaryEvidenceAttestation/)
  assert.match(requestUi, /begin_extraordinary_authorization/)
  assert.match(requestUi, /finalize_extraordinary_authorization/)
  assert.match(requestUi, /crypto\.subtle\.digest\("SHA-256"/)
  assert.match(requestUi, /if \(state\.extraordinarySubmitting\) return/)
  assert.doesNotMatch(requestHtml, /omitira la autorizacion|podra continuar inmediatamente/i)
})

test("Director UI can inspect temporary evidence and ratify or dispute without confirming payment", () => {
  assert.match(batchHtml, /Ratificación de contingencias extraordinarias/)
  assert.match(batchUi, /list_extraordinary_regularizations/)
  assert.match(batchUi, /get_extraordinary_authorization_evidence_access/)
  assert.match(batchUi, /createSignedUrl/)
  assert.match(batchUi, /ratify_extraordinary_authorization/)
  assert.match(batchUi, /dispute_extraordinary_authorization/)
  assert.match(batchUi, /no se confirmó ningún pago/i)
  assert.doesNotMatch(batchUi, /service[_-]?role/i)
})
