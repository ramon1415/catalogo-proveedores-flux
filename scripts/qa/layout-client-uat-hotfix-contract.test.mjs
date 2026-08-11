import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
const html = read("layouts.html")
const js = read("layouts.js")
const migration = read(
  "supabase/migrations/20260810165344_layout_client_uat_preserve_approval_repair_sol_0008_0009.sql",
)

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} must exist`)
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`)
  return source.slice(start, end)
}

test("Nuevo Layout has one scoped vertical scroll and no nested preview scroll", () => {
  assert.match(
    html,
    /#newLayoutDialog \.modal-scroll[^}]*overflow-x:hidden;overflow-y:auto[^}]*overscroll-behavior:contain/i,
  )
  assert.match(
    html,
    /#newLayoutDialog \.layout-preview-list\{[^}]*max-height:none;overflow:visible/i,
  )
  assert.match(html, /#newLayoutDialog[^}]*max-height:calc\(100dvh - 16px\)[^}]*overflow:hidden/i)
  assert.match(html, /id="layoutCreatedResult"[^>]*aria-live="polite"/i)
})

test("completion reevaluates inside the same modal without resetting its fields", () => {
  const completion = functionBody(js, "submitLayoutCompletion", "layoutCompletionFieldError")
  assert.match(completion, /if \(dom\.layoutCompletionDialog\?\.open\) dom\.layoutCompletionDialog\.close\(\)/)
  assert.match(completion, /await reviewLayoutEligibility\(\)/)
  assert.doesNotMatch(completion, /resetNewLayoutForm\s*\(/)
  for (const field of [
    "layoutPeriodStart",
    "layoutPeriodEnd",
    "layoutName",
    "layoutCompanyId",
    "layoutBankAccountId",
  ]) {
    assert.match(js, new RegExp(`dom\\.${field}`))
  }
  assert.match(js, /requestId !== activeLayoutPreviewRequestId \|\| paramsKey !== layoutPreviewParamsKey\(\)/)
})

test("create uses the returned layout id and cannot create a second layout", () => {
  const create = functionBody(js, "submitNewLayout", "setNewLayoutCreationBusy")
  assert.match(create, /if \(activeCreatedLayout\)[\s\S]*return/)
  assert.match(create, /const layoutId = cleanText\(data\?\.layout_id\)/)
  assert.match(create, /activeCreatedLayout = \{[\s\S]*id: layoutId/)
  assert.match(create, /await fetchLayoutLines\(layoutId\)/)
  assert.match(create, /singleReadyCreatedLayoutFormat\(activeCreatedLayout\.lines\)/)
  assert.match(create, /await downloadLayoutBbvaFormat\(layoutId, autoFormat\)/)
  assert.match(js, /Crear y descargar layout con \$\{ready\.length\}/)
  assert.match(js, /data-created-layout-action="download"/)
})

test("null payment concept preserves the stored value with no concept/description fallback", () => {
  const rpcStart = migration.indexOf(
    "create or replace function public.complete_payment_request_layout_data",
  )
  const rpcEnd = migration.indexOf("\n      $rpc_body$", rpcStart + 1)
  const rpc = migration.slice(rpcStart, rpcEnd)
  assert.ok(rpc, "corrected completion RPC must be installed")
  assert.match(
    rpc,
    /if p_payment_concept is null then\s+v_concept := v_request_before\.payment_concept;\s+else\s+v_concept := nullif\(btrim\(p_payment_concept\), ''\);/i,
  )
  assert.doesNotMatch(
    rpc,
    /v_concept := coalesce\([\s\S]*v_request_before\.concept[\s\S]*v_request_before\.description/i,
  )
  assert.match(rpc, /operational_update_changed_approval_material_timestamp/)
  assert.match(rpc, /operational_update_invalidated_direction_approval/)
})

test("repair is fail-closed, targets exactly 0008/0009, and restores snapshot watermarks only", () => {
  assert.match(migration, /TARGET_REQUEST_FINGERPRINT_DRIFT/g)
  assert.match(migration, /v_target_count <> 2/)
  assert.match(migration, /v_stale_count <> 2 or v_repaired_count <> 0/)
  assert.match(
    migration,
    /set approval_material_updated_at = snapshot\.source_approval_material_updated_at/,
  )
  assert.doesNotMatch(
    migration,
    /set approval_material_updated_at = snapshot\.source_approval_material_updated_at[\s\S]{0,120}updated_at\s*=/i,
  )
  assert.doesNotMatch(
    migration,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    "forward data repair must derive generated ids from immutable natural fingerprints",
  )
  assert.match(migration, /SOL-2026-0008/)
  assert.match(migration, /SOL-2026-0009/)
  assert.match(migration, /v_ready_count <> 2/)
  assert.match(
    migration,
    /array\['SOL-2026-0008','SOL-2026-0009'\]::text\[\]/,
  )
})

test("materiality guard preserves operational exclusions and economic materiality", () => {
  for (const field of [
    "company_bank_account_id",
    "old.due_date",
    "old.scheduled_payment_date",
    "old.payment_reference",
  ]) {
    assert.ok(
      migration.includes(`position('${field}' in v_source) > 0`),
      `${field} must remain an excluded operational field`,
    )
  }
  assert.match(migration, /position\('old\.amount_requested' in v_source\) = 0/)
  assert.match(migration, /position\('old\.company_id' in v_source\) = 0/)
  assert.doesNotMatch(
    migration,
    /create or replace function public\.mark_payment_request_material_change/i,
  )
})
