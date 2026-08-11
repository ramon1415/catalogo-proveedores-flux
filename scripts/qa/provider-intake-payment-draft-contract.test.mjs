import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")
const bytes = (relative) => fs.readFileSync(path.join(root, relative))

const migrationPath = "supabase/migrations/20260811035346_043_provider_intake_payment_draft.sql"
const expectedMigrationSha256 =
  "be4f0ade8670c7e8b26eb148eba7c38a4e05bf8954c602a8f432431f1ea0c9cc"
const migration = read(migrationPath)
const html = read("provider_intakes.html")
const frontend = read("provider_intakes.js")
const css = read("provider_intakes.css")

const functionDefinition = (name) => {
  const pattern = new RegExp(
    `create function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  )
  const match = migration.match(pattern)
  assert.ok(match, `missing function definition for ${name}`)
  return match[0]
}

test("Migration 043 active source has the certified SHA-256", () => {
  const normalized = bytes(migrationPath).toString("utf8").replace(/\r\n/g, "\n")
  const digest = crypto.createHash("sha256").update(normalized).digest("hex")
  assert.equal(digest, expectedMigrationSha256)
})

test("C1B excludes the deprecated payment-draft ops package", () => {
  const deprecatedOpsPath = path.join(
    root,
    "ops",
    "provider-intake",
    "apply-041-payment-draft",
  )
  assert.equal(fs.existsSync(deprecatedOpsPath), false)
})

test("draft table is unique per intake and company is server-derived", () => {
  assert.match(migration, /create table public\.payment_intake_conversion_drafts/)
  assert.match(migration, /unique \(payment_intake_id\)/)
  assert.match(migration, /payment_intake_id uuid not null[\s\S]*?on delete restrict/)
  assert.match(migration, /company_id uuid not null[\s\S]*?on delete restrict/)
  const save = functionDefinition("save_provider_intake_payment_draft")
  assert.doesNotMatch(save.split("returns jsonb")[0], /p_company_id/)
  assert.match(save, /v_intake\.company_id/)
})

test("draft table has RLS, no policies, and no direct application grants", () => {
  assert.match(migration, /alter table public\.payment_intake_conversion_drafts enable row level security/)
  assert.doesNotMatch(
    migration,
    /create policy[\s\S]*?on public\.payment_intake_conversion_drafts/i,
  )
  assert.match(
    migration,
    /revoke all on table public\.payment_intake_conversion_drafts\s+from public, anon, authenticated, service_role;/i,
  )
  assert.match(migration, /pg_policy[\s\S]*?must have zero policies/i)
})

test("public RPCs are definer functions with fixed paths and authenticated-only grants", () => {
  for (const name of [
    "get_provider_intake_payment_draft_context",
    "save_provider_intake_payment_draft",
  ]) {
    const definition = functionDefinition(name)
    assert.match(definition, /security definer\s+set search_path = public, pg_temp/i)
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to authenticated;`, "i"),
    )
  }
  assert.doesNotMatch(migration, /grant execute[\s\S]{0,180}\bto anon\b/i)
  assert.match(migration, /has_function_privilege\('anon'/)
  assert.match(migration, /has_function_privilege\('service_role'/)
})

test("internal state and fingerprint helpers are invoker-only and ungranted", () => {
  for (const name of [
    "provider_intake_conversion_draft_fingerprint",
    "provider_intake_payment_draft_state",
  ]) {
    const definition = functionDefinition(name)
    assert.match(definition, /security invoker\s+set search_path = public, pg_temp/i)
    assert.doesNotMatch(definition, /security definer/i)
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated, service_role;`, "i"),
    )
  }
})

test("derived state implements the six authorized values", () => {
  const stateFunction = functionDefinition("provider_intake_payment_draft_state")
  for (const state of [
    "NOT_STARTED",
    "DRAFT_INCOMPLETE",
    "READY_PENDING_PROVIDER",
    "READY_FOR_CONVERSION",
    "ALREADY_CONVERTED",
    "BLOCKED_INTAKE_STATUS",
  ]) {
    assert.match(stateFunction, new RegExp(`'${state}'`))
  }
  assert.match(stateFunction, /matched_proveedor_id is null/)
  assert.match(stateFunction, /coalesce\(p\.activo, true\)/)
  assert.match(stateFunction, /created_payment_request_id is not null/)
  assert.match(stateFunction, /status <> 'in_review'/)
})

test("partial save does not require a provider and readiness does", () => {
  const save = functionDefinition("save_provider_intake_payment_draft")
  assert.doesNotMatch(save, /matched_proveedor_id is null[\s\S]{0,100}raise exception/)
  const stateFunction = functionDefinition("provider_intake_payment_draft_state")
  assert.match(stateFunction, /matched_proveedor_id is null[\s\S]*?'READY_PENDING_PROVIDER'/)
  assert.match(stateFunction, /v_provider_active[\s\S]*?'READY_FOR_CONVERSION'/)
})

test("save locks intake and enforces status conversion and optimistic guards", () => {
  const save = functionDefinition("save_provider_intake_payment_draft")
  assert.match(save, /from public\.payment_intake[\s\S]*?for update/)
  assert.match(save, /v_intake\.status <> 'in_review'/)
  assert.match(save, /created_payment_request_id is not null/)
  assert.match(save, /updated_at is distinct from p_expected_intake_updated_at/)
  assert.match(save, /version is distinct from p_expected_draft_version/)
  assert.match(save, /provider_intake_conversion_draft_conflict/)
})

test("requester and approver are revalidated server-side in company scope", () => {
  const save = functionDefinition("save_provider_intake_payment_draft")
  assert.match(save, /p_requested_by_profile_id <> v_actor_profile_id/)
  assert.match(save, /has_active_company_membership/)
  assert.match(save, /is_payment_request_approver_for_company/)
  assert.match(save, /payment_request_has_active_approver_pool/)
  assert.match(save, /payment_request_rule_allows/)
  assert.match(save, /approver_assignments/)
  const context = functionDefinition("get_provider_intake_payment_draft_context")
  assert.match(context, /list_payment_request_approver_options/)
  assert.match(context, /requester_options/)
})

test("catalog validation is company-scoped and origin account is masked catalog data", () => {
  const save = functionDefinition("save_provider_intake_payment_draft")
  assert.match(save, /company_cost_centers/)
  assert.match(save, /company_cost_center_budget_categories/)
  assert.match(save, /cba\.company_id = v_intake\.company_id/)
  assert.match(save, /payment_method not in \('transfer', 'cash', 'check', 'other'\)/)
  const context = functionDefinition("get_provider_intake_payment_draft_context")
  assert.match(context, /'last4', cba\.last4/)
  assert.doesNotMatch(context, /'account_number'|'clabe',\s*cba\./)
})

test("amount validation requires an explicit reason without silent rounding", () => {
  const save = functionDefinition("save_provider_intake_payment_draft")
  assert.match(save, /scale\(p_final_amount\) > 2/)
  assert.match(save, /p_final_amount <= 0/)
  assert.match(save, /p_final_amount is distinct from v_intake\.amount_requested/)
  assert.match(save, /provider_intake_conversion_draft_amount_reason_required/)
  assert.doesNotMatch(save, /round\(p_final_amount/)
})

test("material idempotency distinguishes replay actor material and stale versions", () => {
  const save = functionDefinition("save_provider_intake_payment_draft")
  assert.match(save, /provider_intake_conversion_draft_fingerprint/)
  assert.match(save, /metadata ->> 'action_id' = p_action_id::text/)
  assert.match(save, /provider_intake_conversion_draft_action_actor_conflict/)
  assert.match(save, /provider_intake_conversion_draft_action_material_conflict/)
  assert.match(save, /'idempotent', true/)
  assert.match(save, /'unchanged', true/)
  assert.match(save, /version = v_next_version/)
})

test("one append-only sanitized event is emitted per material save", () => {
  const save = functionDefinition("save_provider_intake_payment_draft")
  assert.equal(save.match(/insert into public\.payment_intake_events/g)?.length, 1)
  assert.match(save, /conversion_draft_created/)
  assert.match(save, /conversion_draft_updated/)
  for (const key of [
    "contract_version",
    "action_id",
    "action_fingerprint",
    "draft_version",
    "derived_state",
    "changed_fields",
    "blockers_count",
    "amount_changed",
    "requester_selected",
    "approver_selected",
    "provider_present",
    "contains_sensitive_fields",
  ]) {
    assert.match(save, new RegExp(`'${key}'`))
  }
  const metadata = save.split("insert into public.payment_intake_events")[1]
  assert.doesNotMatch(
    metadata,
    /'internal_notes'|'amount_change_reason'|'bank_clabe'|'bank_account'|'provider_rfc'|'provider_email'|'provider_phone'/,
  )
})

test("Migration 043 cannot create requests convert intakes mutate providers or notify", () => {
  assert.doesNotMatch(migration, /\bdrop\s+table\b/i)
  assert.doesNotMatch(migration, /^\s*(?:delete\s+from|truncate\s+)/im)
  assert.doesNotMatch(
    migration,
    /\binsert\s+into\s+public\.(payment_requests|proveedores|providers|approval_batches|payment_layouts|payment_layout_lines|notification_events)\b/i,
  )
  assert.doesNotMatch(
    migration,
    /\bupdate\s+public\.(payment_requests|proveedores|providers|approval_batches|payment_layouts|payment_layout_lines|notification_events)\b/i,
  )
  assert.doesNotMatch(migration, /\bupdate\s+public\.payment_intake\b/i)
  assert.doesNotMatch(migration, /\bset\s+status\s*=\s*'converted'/i)
})

test("draft table never stores declared banking document or request identifiers", () => {
  const table = migration.match(
    /create table public\.payment_intake_conversion_drafts \([\s\S]*?\n\);/,
  )?.[0]
  assert.ok(table)
  assert.doesNotMatch(
    table,
    /\bbank_account\b|\bbank_clabe\b|\bclabe\b|\baccount_number\b|\bstorage_path\b|\btoken\b|\bpayment_request_id\b/i,
  )
})

test("context is sanitized and keeps document paths private", () => {
  const context = functionDefinition("get_provider_intake_payment_draft_context")
  assert.match(context, /provider_intake_mask_value\(v_intake\.bank_account\)/)
  assert.match(context, /provider_intake_mask_value\(v_intake\.bank_clabe\)/)
  assert.match(context, /provider_intake_mask_value\(p\.cuenta_bancaria\)/)
  assert.match(context, /provider_intake_mask_value\(p\.clabe\)/)
  assert.doesNotMatch(context, /'storage_path'/)
  assert.doesNotMatch(context, /'bank_account',\s*v_intake|'bank_clabe',\s*v_intake/)
})

test("frontend preserves all authorized draft states for the 2B.2 extension", () => {
  for (const label of [
    "Preparar solicitud de pago",
    "Continuar preparación",
    "Revisar solicitud preparada",
    "Borrador incompleto",
    "Preparada · pendiente de proveedor",
    "Lista para conversión",
    "Solicitud de pago creada",
  ]) {
    assert.match(`${html}\n${frontend}`, new RegExp(label))
  }
  assert.match(html, />Convertir a solicitud de pago</)
  assert.doesNotMatch(html, />\s*(?:Aprobar|Enviar a batch)\s*</i)
})

test("frontend uses context and save RPCs with concurrency and action material", () => {
  assert.match(frontend, /rpc\("get_provider_intake_payment_draft_context"/)
  assert.match(frontend, /rpc\("save_provider_intake_payment_draft"/)
  assert.match(frontend, /p_expected_intake_status/)
  assert.match(frontend, /p_expected_intake_updated_at/)
  assert.match(frontend, /p_expected_draft_version/)
  assert.match(frontend, /p_action_id/)
  assert.match(frontend, /savePaymentDraftBtn\.disabled = true/)
  assert.doesNotMatch(frontend, /alert\s*\(/)
  assert.doesNotMatch(frontend, /service[_-]?role/i)
})

test("modal includes accessible labels dirty-close controls and responsive containment", () => {
  assert.match(html, /id="paymentDraftDialog" aria-labelledby="paymentDraftTitle"/)
  assert.match(html, /id="paymentDraftError" role="alert"/)
  assert.match(html, /id="paymentDraftSuccess" role="status" aria-live="polite"/)
  assert.match(frontend, /addEventListener\("cancel", handlePaymentDraftCancel\)/)
  assert.match(frontend, /restorePaymentDraftFocus/)
  assert.match(frontend, /paymentDraftDirty/)
  assert.match(css, /\.payment-draft-content[\s\S]*?overflow-x: hidden/)
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*?payment-draft-form-grid/)
})
