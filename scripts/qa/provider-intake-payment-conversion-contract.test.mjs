import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")

const migrationPath = "supabase/migrations/20260811215129_044_provider_intake_payment_conversion.sql"
const migration = read(migrationPath)
const html = read("provider_intakes.html")
const frontend = read("provider_intakes.js")
const requestsFrontend = read("solicitudes.js")
const requestsHtml = read("solicitudes.html")

const functionDefinition = (name) => {
  const pattern = new RegExp(
    `create function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  )
  const match = migration.match(pattern)
  assert.ok(match, `missing function definition for ${name}`)
  return match[0]
}

test("044 remains followed only by the authorized provider-intake product migrations", () => {
  const active = fs.readdirSync(path.join(root, "supabase", "migrations")).sort()
  assert.deepEqual(active, [
    "20260811035345_flux_dev_authoritative_brownfield_baseline_v2.sql",
    "20260811035346_043_provider_intake_payment_draft.sql",
    "20260811215129_044_provider_intake_payment_conversion.sql",
    "20260811230137_045_provider_intake_ramon_uat_product_improvements.sql",
    "20260812001555_046_provider_aware_intake_links.sql",
  ])
})

test("conversion RPC is authenticated-only security definer with a fixed path", () => {
  const conversion = functionDefinition("convert_provider_intake_to_payment_request")
  assert.match(conversion, /volatile\s+security definer\s+set search_path = public, pg_temp/i)
  assert.match(migration, /revoke all on function public\.convert_provider_intake_to_payment_request[\s\S]*?from public, anon, authenticated, service_role/i)
  assert.match(migration, /grant execute on function public\.convert_provider_intake_to_payment_request[\s\S]*?to authenticated/i)
  assert.match(migration, /aclexplode/)
})

test("intake and draft locks precede readiness and request creation", () => {
  const conversion = functionDefinition("convert_provider_intake_to_payment_request")
  const intakeLock = conversion.indexOf("from public.payment_intake")
  const draftLock = conversion.indexOf("from public.payment_intake_conversion_drafts")
  const readiness = conversion.indexOf("provider_intake_payment_draft_state")
  const creation = conversion.indexOf("public.create_payment_request")
  assert.ok(intakeLock >= 0 && intakeLock < draftLock)
  assert.ok(draftLock < readiness && readiness < creation)
  assert.equal(conversion.match(/for update/g)?.length, 2)
})

test("an existing request link returns idempotently before stale guards", () => {
  const conversion = functionDefinition("convert_provider_intake_to_payment_request")
  const existing = conversion.indexOf("if v_intake.created_payment_request_id is not null")
  const requiredFields = conversion.indexOf("provider_intake_conversion_fields_required")
  assert.ok(existing >= 0 && existing < requiredFields)
  assert.match(conversion, /'created', false/)
  assert.match(conversion, /'idempotent', true/)
})

test("server revalidates frozen 2B.2 preconditions", () => {
  const conversion = functionDefinition("convert_provider_intake_to_payment_request")
  for (const contract of [
    "READY_FOR_CONVERSION",
    "missing_count",
    "blockers_count",
    "company_cost_centers",
    "company_cost_center_budget_categories",
    "company_bank_accounts",
    "has_active_company_membership",
    "list_payment_request_approver_options",
    "amount_change_reason",
  ]) assert.match(conversion, new RegExp(contract))
  assert.match(conversion, /coalesce\(p\.activo, true\)/)
  assert.match(conversion, /v_draft\.requested_by_profile_id is distinct from v_actor_profile_id/)
})

test("canonical Flux creator owns budget routing numbering and submitted state", () => {
  const conversion = functionDefinition("convert_provider_intake_to_payment_request")
  assert.equal(conversion.match(/public\.create_payment_request\(/g)?.length, 1)
  for (const mapping of [
    "p_proveedor_id => v_intake.matched_proveedor_id",
    "p_company_id => v_intake.company_id",
    "p_requested_by => v_draft.requested_by_profile_id",
    "p_approver_id => v_draft.approver_profile_id",
    "p_approver_assignment_id => v_draft.approver_assignment_id",
    "p_amount_requested => v_draft.final_amount",
    "p_currency => v_draft.currency",
  ]) assert.ok(conversion.includes(mapping), `missing mapping: ${mapping}`)
  assert.doesNotMatch(conversion, /insert into public\.payment_requests/i)
})

test("conversion links intake and emits one sanitized append-only event atomically", () => {
  const conversion = functionDefinition("convert_provider_intake_to_payment_request")
  assert.equal(conversion.match(/update public\.payment_intake/g)?.length, 1)
  assert.match(conversion, /status = 'converted'/)
  assert.match(conversion, /created_payment_request_id = v_payment_request\.id/)
  assert.equal(conversion.match(/insert into public\.payment_intake_events/g)?.length, 1)
  assert.match(conversion, /'action_kind', 'convert_to_payment_request'/)
  assert.match(conversion, /'contains_sensitive_fields', false/)
  assert.doesNotMatch(conversion, /'internal_notes'|'amount_change_reason'|'bank_clabe'|'bank_account'/)
})

test("conversion cannot approve pay batch layout notify or mutate provider master", () => {
  assert.doesNotMatch(migration, /insert into public\.(approval_batches|approval_batch_items|payment_layouts|payment_layout_lines|cash_funds|payment_operation_evidence|notification_events)/i)
  assert.doesNotMatch(migration, /update public\.(proveedores|providers|approval_batches|payment_layouts|notification_events)/i)
  assert.doesNotMatch(migration, /status\s*=\s*'(approved|paid|scheduled)'/i)
  assert.doesNotMatch(migration, /enqueue_|send_email|resend|edge_functions/i)
})

test("UI exposes explicit confirmation and calls only the 2B.2 RPC", () => {
  assert.match(html, />Convertir a solicitud de pago</)
  assert.match(html, /id="paymentConversionConfirm"/)
  assert.match(html, /no aprueba, no crea batch, no ejecuta pago ni envía una notificación externa/i)
  assert.match(frontend, /rpc\("convert_provider_intake_to_payment_request"/)
  assert.match(frontend, /p_expected_intake_updated_at: context\.intake\.updated_at/)
  assert.match(frontend, /p_expected_draft_version: context\.draft\?\.version/)
  assert.match(frontend, /paymentConversionInFlight/)
})

test("intake links to the normal request UI and the request URL opens its detail", () => {
  assert.match(frontend, /solicitudes\.html\?request_id=/)
  assert.match(requestsFrontend, /new URLSearchParams\(window\.location\.search\)\.get\("request_id"\)/)
  assert.match(requestsFrontend, /openRequestDetail\(requestId\)/)
  assert.match(requestsHtml, /solicitudes\.js\?v=20260811-provider-intake-2b2/)
})
