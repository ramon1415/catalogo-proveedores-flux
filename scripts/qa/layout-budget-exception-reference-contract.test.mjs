import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const root = new URL("../../", import.meta.url)
const migration = readFileSync(
  new URL(
    "supabase/migrations/20260817204224_honor_approved_budget_exceptions_in_layout.sql",
    root,
  ),
  "utf8",
)
const layouts = readFileSync(new URL("layouts.js", root), "utf8")
const layoutsHtml = readFileSync(new URL("layouts.html", root), "utf8")
const workboard = readFileSync(
  new URL("solicitudes_workboard_extension.js", root),
  "utf8",
)
const paymentMethod = readFileSync(
  new URL("fase2_request_payment_method_extension.js", root),
  "utf8",
)
const config = readFileSync(new URL("config.js", root), "utf8")
const solicitudesHtml = readFileSync(new URL("solicitudes.html", root), "utf8")
const topLevelMigration = migration.replace(
  /\$(\w*)\$[\s\S]*?\$\1\$/g,
  "$dollar_quoted_body$",
)

const document = {
  documentElement: { dataset: {} },
  addEventListener() {},
  getElementById() { return null },
  body: { appendChild() {} },
}
const window = {
  supabase: { createClient() { return {} } },
  setTimeout,
  clearTimeout,
}
window.window = window
const context = vm.createContext({
  window,
  document,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "synthetic",
  TextEncoder,
  Blob,
  URL,
  console: { info() {}, warn() {}, error() {} },
  setTimeout,
  clearTimeout,
})
vm.runInContext(`${layouts}
globalThis.__layoutReferenceContract = {
  layoutReferenceIssue,
  layoutReferenceIssueLabel,
}
`, context)
const referenceContract = context.__layoutReferenceContract

test("migration is forward-only, transactional, fingerprinted, and data-neutral", () => {
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/)
  assert.match(migration, /set local lock_timeout = '5s'/)
  assert.match(migration, /set local statement_timeout = '60s'/)
  for (const hash of [
    "241637d5bc5dd587d966bcbfffd85b8cec58978952f712c3f174b6144abc2472",
    "89b12fc886516e1cf16b66ba33e6a060f06eedbcc6d10ff69b9ac758d2c373c0",
    "2f38024c350de268f4519192b5d51cb381583d602264476ee2c6adf63246f00d",
    "74f99a3db18afddb5cc4c1842dfbca1603b2f1666c0810d0b1ea18bfe5b16458",
    "24a6a9d4fddb6c946c898a2b24f5aa14f246b67f1c02c9fc950282c1d7cd8342",
    "c7abedf75ef40f0e7650e2ce4d31403f176784aff84d4aab141f048a4d242cd6",
    "89cf39fd568f7c49c539b1be87733b7db3eb5d5420f9048b29828466d12a48e2",
    "b4c5c8bbe6dbc6dae35a09a2dc7f7ae19d59e1e13469813f536573e0237851d3",
    "677c5b642951b1308fd4626abedb75dc7c02ba3865d610b58c6c0f0f38db335f",
    "ab3f0bc9ced52e807f7bfcb4681e8772bfe200409cf0256ed3b149558d3d3db3",
    "aa39c36de335f2a13ef0f879f73a63b2dd8a5e2b30b06923046082a5bcbdb51f",
    "76db4af562a13306150bebd4b464c67de1eb5e03cdd8f6179b8449ffb19fb93c",
    "a8e383045c06183c2532bfc2dcd6a1700df93f3e90ab7442b4e78dbb692219e1",
    "467b687e5a3777f9642eedcf2cf30743a584cc619d1a02a9f21082ccb96771db",
    "0a8390233d9a1368dc51595ced06421897fa0089ec609b3fa16c090bf3de0543",
    "0c6355cc5e28b6fbf5bd5291a15d15cad20541edfa8800b55a70fc1021a81665",
  ]) assert.match(migration, new RegExp(hash))
  assert.doesNotMatch(topLevelMigration, /\b(?:drop|truncate|cascade)\b/i)
  assert.doesNotMatch(
    topLevelMigration,
    /\b(?:insert\s+into|update\s+public\.|delete\s+from|merge\s+into)\b/i,
  )
  assert.doesNotMatch(migration, /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)
  assert.doesNotMatch(migration, /SOL-2026-/)
})

test("approved budget exception is proven server-side and fails closed", () => {
  for (const marker of [
    "p_request.status::text = 'approved'",
    "p_request.budget_decision = 'bloqueado'",
    "p_request.budget_block_reason = 'sin_disponible'",
    "p_request.exception_status = 'approved'",
    "p_request.exception_action = 'exception_approved'",
    "p_request.exception_approved_at >= p_request.approval_material_updated_at",
    "approval.payment_request_id = p_request.id",
    "approval.actor_profile_id = p_request.exception_approved_by",
    "approval.created_at = p_request.exception_approved_at",
    "approval.budget_decision_snapshot = 'bloqueado'",
    "approval.budget_block_reason_snapshot = 'sin_disponible'",
    "and not exists (",
    "(later.created_at, later.id) > (approval.created_at, approval.id)",
    "competing.created_at = approval.created_at",
  ]) assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))

  assert.doesNotMatch(migration, /actor\.active/)
  assert.match(migration, /public\.decide_payment_request\(uuid,uuid,text,text\)/)
  assert.match(migration, /revoke all on function public\.payment_request_has_current_approved_budget_exception[\s\S]*from public, anon, authenticated/i)
  assert.match(migration, /grant execute on function public\.payment_request_has_current_approved_budget_exception[\s\S]*to service_role/i)
})

test("budget exception changes only the budget gate and never becomes 01C", () => {
  assert.match(migration, /not \(b\.budget_validation_current or b\.budget_exception_current\)/)
  assert.match(migration, /m\.budget_validation_current[\s\S]*or m\.budget_exception_current/)
  assert.match(migration, /m\.extraordinary_authorization_id is null[\s\S]*not \([\s\S]*m\.budget_validation_current[\s\S]*or m\.budget_exception_current/)
  assert.doesNotMatch(migration, /create (?:or replace )?function public\.(?:begin|finalize|revoke|ratify|dispute)_payment_request_extraordinary/i)
  assert.doesNotMatch(migration, /insert\s+into\s+public\.payment_request_extraordinary/i)

  const executionGate = migration.indexOf("when b.has_execution then 'already_executed'")
  const extraordinaryGate = migration.indexOf("when b.extraordinary_authorization_id is not null")
  const batchGate = migration.indexOf("when b.source_batch_status in ('draft', 'submitted')")
  const budgetGate = migration.indexOf("when not (b.budget_validation_current or b.budget_exception_current)")
  const missingGate = migration.indexOf("when cardinality(b.missing_fields) > 0 then 'invalid_data'", extraordinaryGate + 1)
  assert.ok(executionGate < extraordinaryGate)
  assert.ok(extraordinaryGate < batchGate)
  assert.ok(batchGate < budgetGate)
  assert.ok(budgetGate < missingGate)
})

test("reference contract is rail-aware across DB, Layouts, and workboard", () => {
  for (const value of ["1", "7", "42", "12345", " 42 "]) {
    assert.equal(referenceContract.layoutReferenceIssue(value, "clabe"), null, value)
  }
  for (const value of ["", "na", "12A", "123456"]) {
    assert.notEqual(referenceContract.layoutReferenceIssue(value, "clabe"), null, value)
  }
  assert.equal(
    referenceContract.layoutReferenceIssue("REF20260812TEST", "convenio"),
    null,
  )
  assert.equal(
    referenceContract.layoutReferenceIssue("OPERATIVA 123", "cuenta"),
    null,
  )
  for (const value of ["REF|01", "REFERENCIA-CIE-MAYOR-20", "REF €"]) {
    assert.equal(
      referenceContract.layoutReferenceIssue(value, "convenio"),
      "payment_reference_invalid",
      value,
    )
  }

  assert.match(migration, /function public\.payment_layout_reference_issue/)
  assert.match(migration, /p_destination_type[\s\S]*= 'clabe'[\s\S]*'\^\[0-9\]\{1,5\}\$'/)
  assert.match(migration, /p_destination_type[\s\S]*= 'convenio'[\s\S]*char_length[\s\S]*> 20/)
  assert.match(migration, /octet_length\(convert_to/)
  assert.match(migration, /payment_reference_cie_invalid/)
  assert.ok(
    (migration.match(/public\.payment_layout_reference_issue\(/g) || []).length >= 6,
  )
  assert.match(workboard, /function paymentReferenceReadiness\(value, destinationType\)/)
  assert.match(workboard, /destinationType === "clabe"[\s\S]*!\/\^\\d\{1,5\}\$\//)
  assert.match(workboard, /destinationType === "convenio"/)
  assert.match(workboard, /Referencia invalida: captura de 1 a 5 digitos/)
  assert.match(workboard, /Referencia CIE invalida/)
  assert.match(workboard, /input\.pattern = "\[0-9\]\{1,5\}"/)
  assert.match(workboard, /input\.maxLength = 20/)
  assert.ok(
    workboard.indexOf("if (!referenceReadiness.complete)")
      < workboard.indexOf('.from("payment_requests").update(payload)'),
  )
  assert.match(layouts, /"payment_reference_invalid"/)
  assert.match(layouts, /function layoutReferenceIssue\(value, destinationType\)/)
  assert.doesNotMatch(
    layoutsHtml,
    /id="layoutCompletionReference"[^>]*(?:pattern|maxlength)=/,
  )
})

test("preview exposes budget authorization provenance without changing RPC signatures", () => {
  const candidateHeader = migration.match(
    /create or replace function public\.approval_batch_payment_layout_candidates_pre_037[\s\S]*?\nlanguage sql/,
  )?.[0] || ""
  assert.match(migration, /budget_authorization_source/)
  assert.match(migration, /then 'approved_exception'/)
  assert.match(migration, /then 'live_budget'/)
  assert.match(migration, /then 'extraordinary'/)
  assert.match(migration, /candidate\.classification = 'ready_extraordinary'/)
  const extraordinaryNull = migration.search(
    /when candidate\.extraordinary_authorization_id is not null\r?\n\s+then null/,
  )
  const approvedExceptionSource = migration.indexOf(
    "when public.payment_request_has_current_approved_budget_exception(request)",
  )
  const liveBudgetSource = migration.indexOf(
    "public.approval_batch_budget_validation(request.id) ->> 'status'",
  )
  assert.ok(extraordinaryNull > 0)
  assert.ok(extraordinaryNull < approvedExceptionSource)
  assert.ok(approvedExceptionSource < liveBudgetSource)
  assert.doesNotMatch(candidateHeader, /budget_authorization_source text/i)
  assert.match(layouts, /budgetAuthorizationSourceLabel\(row\.budget_authorization_source\)/)
  assert.match(layouts, /approved_exception: "Excepcion aprobada"/)
  assert.match(layouts, /Autorizacion presupuestal:/)
})

test("workboard describes data completeness without claiming final eligibility", () => {
  assert.doesNotMatch(workboard, /Lista para layout de pago/)
  assert.match(workboard, /Datos de pago completos/)
  assert.match(workboard, /La elegibilidad final se confirma en Revisar solicitudes/)
  assert.match(workboard, /PAGOSINT: captura de 1 a 5 digitos/)
  assert.match(workboard, /CIE: hasta 20 caracteres ASCII/)
})

test("approved exception completes the weekly-cut lifecycle without bypassing it", () => {
  assert.match(
    migration,
    /create or replace function public\.approval_batch_request_eligibility/,
  )
  assert.match(
    migration,
    /v_budget_exception_current[\s\S]*payment_request_has_current_approved_budget_exception/,
  )
  assert.match(
    migration,
    /<> 'aprobable'[\s\S]*and not v_budget_exception_current/,
  )
  assert.match(
    migration,
    /v_classification := 'ready_for_batch'[\s\S]*v_eligible := true/,
  )
  assert.match(migration, /'budget_authorization_source'/)
  assert.match(
    migration,
    /create or replace function public\.approval_batch_item_release_block_reason/,
  )
  assert.match(
    migration,
    /v_budget ->> 'status'[\s\S]*<> 'aprobable'[\s\S]*and not public\.payment_request_has_current_approved_budget_exception\([\s\S]*v_request/,
  )
  assert.match(
    migration,
    /create or replace function public\.release_and_rebatch_rejected_request/,
  )
  const rebatch = migration.match(
    /create or replace function public\.release_and_rebatch_rejected_request[\s\S]*?\n\$\$;/,
  )?.[0] || ""
  assert.match(
    rebatch,
    /v_budget ->> 'status'[\s\S]*<> 'aprobable'[\s\S]*and not public\.payment_request_has_current_approved_budget_exception\([\s\S]*v_request/,
  )
  assert.match(
    migration,
    /v_release_block_oid[\s\S]*v_rebatch_oid[\s\S]*function properties or ACL mismatch/,
  )
})

test("Layout preview shows authoritative reason and no longer labels all failures as data", () => {
  assert.match(layouts, /layoutClassificationReasonLabel\(row\.classification_reason\)/)
  assert.match(layouts, /sin_disponible: "Presupuesto vigente insuficiente"/)
  assert.match(layouts, /incomplete_layout_data: "Faltan datos de pago"/)
  assert.match(layouts, /previewMetric\("No elegibles"/)
  assert.match(layouts, /renderPreviewSection\("Solicitudes no elegibles"/)
  assert.doesNotMatch(layouts, /<strong>Falta completar<\/strong>/)
})

test("legacy payment method fallback matches the canonical DB contract", () => {
  assert.match(paymentMethod, /select\("id,request_number,request_type,payment_method,status,company_id,created_at"\)/)
  assert.match(paymentMethod, /normalizePaymentMethodForLayout\(request\.payment_method, request\.request_type\)/)
  assert.match(paymentMethod, /if \(requestTypeKey === "cash"\) return "cash"/)
  assert.match(paymentMethod, /if \(requestTypeKey === "check"\) return "check"/)
  assert.match(paymentMethod, /return "transfer"/)
  assert.doesNotMatch(paymentMethod, /function normalizePaymentMethodForLayout\(value\) \{[\s\S]{0,120}if \(!key\) return ""/)
})

test("cache busters deliver every changed browser asset", () => {
  assert.match(config, /solicitudes_workboard_extension\.js\?v=20260818-default-active/)
  assert.match(solicitudesHtml, /config\.js\?v=20260818-provider-portal-reconciled/)
  assert.match(layoutsHtml, /layouts\.js\?v=20260903-bbva-clabe-mixed/)
  assert.match(layoutsHtml, /fase2_request_payment_method_extension\.js\?v=20260821-detalle-fix/)
})
