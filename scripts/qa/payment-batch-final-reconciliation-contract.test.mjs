import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (name) => fs.readFileSync(path.join(root, name), "utf8")
const migration = read("supabase/migrations/033_payment_batch_final_reconciliation.sql")
const batchClient = read("payment_batch_final_reconciliation.js")
const requestClient = read("payment_request_reconciliation_evidence.js")
const batchHtml = read("comprobantes_batch.html")
const requestsHtml = read("solicitudes.html")
const css = read("payment_batch_final_reconciliation.css")

function functionSource(name) {
  const start = migration.search(new RegExp(
    `create(?:\\s+or\\s+replace)?\\s+function\\s+public\\.${name}\\s*\\(`,
    "i",
  ))
  assert.ok(start >= 0, `missing function ${name}`)
  const bodyStart = migration.indexOf("as $$", start)
  const end = migration.indexOf("\n$$;", bodyStart)
  assert.ok(bodyStart > start && end > bodyStart, `incomplete function ${name}`)
  return migration.slice(start, end + 4)
}

function clientFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}`)
  const end = source.indexOf(`\n  ${nextName}`, start)
  assert.ok(start >= 0 && end > start, `missing client function ${name}`)
  return source.slice(start, end)
}

test("migration 033 is fail-closed on the certified 032 contract", () => {
  assert.match(migration, /begin;\s*do \$precheck\$/i)
  assert.match(migration, /payment_batch_032_required/)
  assert.match(migration, /to_regclass\('public\.payment_allocation_movements'\)/)
  assert.match(migration, /to_regclass\('public\.payment_receipts'\)/)
  assert.match(migration, /payment_reconciliation_command_replay\(uuid,text,text,text,uuid\)/)
  assert.match(migration, /payment_batch_033_objects_already_exist/)
  assert.match(migration, /commit;\s*$/i)
})

test("terminal states extend 032 without reusing unrelated request states", () => {
  assert.match(migration, /bank_payment_operations_status_check[\s\S]*'reconciled'/)
  assert.match(migration, /payment_allocation_plans_status_check[\s\S]*'confirmed'/)
  assert.match(migration, /payment_allocation_reservations_status_check[\s\S]*'consumed'/)
  assert.doesNotMatch(migration, /alter\s+type\s+public\.payment_request_status/i)
})

test("private evidence is versioned, operation-bound and exactly one source page", () => {
  assert.match(migration, /create table public\.payment_operation_evidence/)
  assert.match(migration, /source_page_number integer not null/)
  assert.match(migration, /evidence_kind text not null default 'derived_single_page_pdf'/)
  assert.match(migration, /unique \(operation_id, version\)/)
  assert.match(migration, /payment_operation_documents[\s\S]*page_number = new\.source_page_number/)
  assert.match(migration, /storage_bucket text not null default 'payment-batch-documents'/)
  assert.match(migration, /\/evidence\/\[0-9a-f-\]\{36\}\\\.pdf/)
})

test("evidence lifecycle is controlled and requires human attestation", () => {
  const transition = functionSource("payment_reconciliation_validate_evidence_transition")
  assert.match(transition, /pending_upload' and new\.status = 'pending_review'/)
  assert.match(transition, /pending_review'[\s\S]*new\.status in \('shareable', 'not_shareable'\)/)
  assert.match(transition, /payment_evidence_transition_not_allowed/)
  const review = functionSource("review_payment_operation_evidence")
  assert.match(review, /single_operation_attestation_required/)
  assert.match(review, /evidence_rejection_reason_required/)
  assert.match(review, /append_financial_outbox_event_internal/)
})

test("legacy payment_receipts becomes read-only without row mutation or dual write", () => {
  assert.match(migration, /payment_receipts_read_only_after_reconciliation_cutover/)
  assert.match(migration, /legacy_payment_receipts_read_only_after_cutover/)
  assert.doesNotMatch(migration, /insert\s+into\s+public\.payment_receipts/i)
  assert.doesNotMatch(migration, /update\s+public\.payment_receipts/i)
  assert.doesNotMatch(migration, /delete\s+from\s+public\.payment_receipts/i)
  assert.doesNotMatch(migration, /notification_events/i)
})

test("confirmation implements replay-safe idempotency before financial mutation", () => {
  const confirm = functionSource("confirm_payment_operation")
  const replay = confirm.indexOf("payment_reconciliation_command_replay")
  const firstMovement = confirm.indexOf("insert into public.payment_allocation_movements")
  const store = confirm.indexOf("payment_reconciliation_store_command")
  assert.ok(replay >= 0 && firstMovement > replay && store > firstMovement)
  assert.match(confirm, /idempotency_key_conflict|payment_reconciliation_command_replay/)
  assert.match(confirm, /'confirm:' \|\| public\.payment_reconciliation_payload_hash/)
})

test("canonical lock order is plan, operation, reservation, requests, snapshots", () => {
  const confirm = functionSource("confirm_payment_operation")
  const marker = confirm.indexOf("Canonical lock order")
  const plan = confirm.indexOf("from public.payment_allocation_plans", marker)
  const operation = confirm.indexOf("from public.bank_payment_operations", plan)
  const reservation = confirm.indexOf("from public.payment_allocation_reservations", operation)
  const requests = confirm.indexOf("from public.payment_requests request", reservation)
  const snapshots = confirm.indexOf("from public.payable_snapshots snapshot", requests)
  assert.ok(marker >= 0 && plan > marker && operation > plan)
  assert.ok(reservation > operation && requests > reservation && snapshots > requests)
  assert.match(confirm.slice(plan, snapshots + 180), /for update/g)
})

test("one bank operation is all-or-nothing while batches remain derived", () => {
  const confirm = functionSource("confirm_payment_operation")
  assert.match(confirm, /v_plan\.total_amount_minor\s*<>[\s\S]*v_operation\.amount_minor - v_operation_confirmed/)
  assert.match(confirm, /operation_requires_full_atomic_allocation/)
  assert.match(confirm, /v_item_total <> v_plan\.total_amount_minor/)
  assert.match(migration, /derived_reconciliation_status/)
  assert.match(migration, /'completed'/)
  assert.match(migration, /'partially_completed'/)
  assert.match(migration, /'failed'/)
})

test("request balance is cumulative across snapshot versions and never overpaid", () => {
  const balance = functionSource("payment_request_confirmed_minor")
  assert.match(balance, /join public\.payable_snapshots snapshot/)
  assert.match(balance, /snapshot\.payment_request_id = p_payment_request_id/)
  const confirm = functionSource("confirm_payment_operation")
  assert.match(confirm, /payable_snapshot_not_latest/)
  assert.match(confirm, /payable_snapshot_capacity_exceeded/)
  assert.match(confirm, /payment_request_overpayment_blocked/)
  assert.match(confirm, /if v_request_confirmed = v_request_authorized then[\s\S]*set status = 'paid'/)
  assert.doesNotMatch(confirm, /set status = 'paid'[\s\S]{0,180}v_request_confirmed </)
})

test("state, ledger, evidence link and outbox commit inside one RPC transaction", () => {
  const confirm = functionSource("confirm_payment_operation")
  const movement = confirm.indexOf("insert into public.payment_allocation_movements")
  const link = confirm.indexOf("insert into public.payment_movement_evidence_links")
  const request = confirm.indexOf("update public.payment_requests")
  const reservation = confirm.indexOf("update public.payment_allocation_reservations")
  const plan = confirm.indexOf("update public.payment_allocation_plans")
  const operation = confirm.indexOf("update public.bank_payment_operations")
  const outbox = confirm.indexOf("append_financial_outbox_event_internal")
  assert.ok(movement >= 0 && link > movement && request > link)
  assert.ok(reservation > request && plan > reservation && operation > plan && outbox > operation)
  assert.match(confirm, /'payment\.operation_confirmed'/)
  assert.doesNotMatch(confirm, /\bcommit\b|\brollback\b/i)
})

test("two reviewers and stale balances are revalidated under row locks", () => {
  const preview = functionSource("get_payment_operation_confirmation_preview")
  const confirm = functionSource("confirm_payment_operation")
  assert.match(preview, /payment_reservation_owned_by_another_actor/)
  assert.match(confirm, /v_reservation\.created_by <> v_actor/)
  assert.match(confirm, /payment_reconciliation_snapshot_is_payable/)
  assert.match(confirm, /payment_request_confirmed_minor/)
  assert.match(confirm, /bank_operation_already_reconciled/)
})

test("new tables are RLS-only and browser access is RPC-only", () => {
  for (const table of ["payment_operation_evidence", "payment_movement_evidence_links"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"))
    assert.match(migration, new RegExp(`revoke all on table public\\.${table}[\\s\\S]{0,100}authenticated`, "i"))
  }
  for (const rpc of [
    "get_payment_operation_confirmation_preview",
    "prepare_payment_operation_evidence",
    "finalize_payment_operation_evidence",
    "review_payment_operation_evidence",
    "confirm_payment_operation",
    "get_payment_operation_evidence_access",
    "get_payment_request_reconciliation_summary",
    "get_payment_batch_reconciliation_summary",
  ]) {
    assert.match(migration, new RegExp(`grant execute on function[\\s\\S]{0,100}public\\.${rpc}\\(`, "i"))
  }
  assert.doesNotMatch(batchClient, /\.from\([^)]*\)[\s\S]{0,160}\.(?:insert|update|upsert|delete)\s*\(/i)
  assert.doesNotMatch(requestClient, /\.from\([^)]*\)[\s\S]{0,160}\.(?:insert|update|upsert|delete)\s*\(/i)
  assert.doesNotMatch(`${batchClient}\n${requestClient}`, /\bservice[_-]?role\b/i)
})

test("Storage permits only private derived PDFs for Finance", () => {
  assert.match(migration, /Finance can upload derived payment evidence/)
  assert.match(migration, /Finance can read derived payment evidence/)
  assert.match(migration, /payment_reconciliation_evidence_storage_path_allowed\(name, true\)/)
  assert.match(migration, /payment_reconciliation_evidence_storage_path_allowed\(name, false\)/)
  assert.doesNotMatch(migration, /update\s+to authenticated[\s\S]*derived payment evidence/i)
  assert.doesNotMatch(migration, /storage\.buckets[\s\S]{0,120}\btrue\b/i)
})

test("browser derives one page, never overwrites, and requires review", () => {
  assert.match(batchHtml, /pdf-lib@1\.17\.1/)
  assert.match(batchClient, /copyPages\(sourcePdf, \[pageNumber - 1\]\)/)
  assert.match(batchClient, /evidencePdf\.addPage\(copiedPage\)/)
  assert.match(batchClient, /const existingObject = await bucket\.download\(evidence\.storage_path\)/)
  assert.match(batchClient, /existingPdf\.getPageCount\(\) !== 1/)
  assert.match(batchClient, /finalSha256 !== derivedSha256/)
  assert.match(batchClient, /upsert:\s*false/)
  assert.match(batchClient, /data-payment-final-attestation/)
  assert.match(batchClient, /Aprobar evidencia/)
  assert.match(batchClient, /No es compartible/)
})

test("evidence access is Finance-only and expires after five minutes", () => {
  const access = functionSource("get_payment_operation_evidence_access")
  assert.match(access, /payment_reconciliation_require_finance/)
  assert.match(access, /'url_ttl_seconds', 300/)
  assert.match(batchClient, /createSignedUrl\(data\.storage_path, Number\(data\.url_ttl_seconds \|\| 300\)\)/)
  assert.match(requestClient, /createSignedUrl\(data\.storage_path, Number\(data\.url_ttl_seconds \|\| 300\)\)/)
})

test("provider delivery remains disabled without an auth-to-provider identity link", () => {
  assert.match(migration, /'external_provider_access', false/)
  assert.match(migration, /provider_identity_link_not_implemented/)
  assert.match(batchClient, /Acceso del proveedor:[\s\S]*deshabilitado/)
  assert.match(requestClient, /Acceso externo deshabilitado/)
  assert.doesNotMatch(migration, /provider.*(?:email|rfc).*auth|auth.*provider.*(?:email|rfc)/i)
})

test("request detail exposes Finance balance and downloadable evidence", () => {
  assert.match(requestsHtml, /payment_request_reconciliation_evidence\.js/)
  assert.match(requestClient, /const originalOpenRequestDetail = window\.openRequestDetail/)
  assert.match(requestClient, /get_payment_request_reconciliation_summary/)
  assert.match(requestClient, /Monto autorizado/)
  assert.match(requestClient, /Saldo pendiente/)
  assert.match(requestClient, /data-request-evidence-id/)
})

test("functional assets are isolated extensions rather than visual PR duplication", () => {
  assert.match(batchHtml, /payment_batch_final_reconciliation\.css/)
  assert.match(batchHtml, /payment_batch_final_reconciliation\.js/)
  assert.match(requestsHtml, /payment_batch_final_reconciliation\.css/)
  assert.doesNotMatch(batchClient, /receipt-operation-workflow|receipt-batch-flow-overview/)
})

test("responsive layout and reduced-motion handling cover desktop and mobile", () => {
  assert.match(css, /@media\(max-width:820px\)/)
  assert.match(css, /@media\(max-width:560px\)/)
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/)
  assert.match(css, /payment-final-confirm-dialog/)
  assert.match(css, /payment-request-reconciliation-entry/)
})

test("UI idempotency keys survive an ambiguous in-session retry", () => {
  assert.match(batchClient, /commandKeys:\s*new Map\(\)/)
  assert.match(batchClient, /state\.commandKeys\.get\(mapKey\) \|\| commandId\(\)/)
  assert.match(batchClient, /state\.commandKeys\.set\(mapKey, idempotencyKey\)/)
  assert.match(batchClient, /state\.commandKeys\.delete\(mapKey\)/)
  assert.match(batchClient, /crypto\?\.randomUUID/)
})

test("client refreshes authoritative state only after leaving the busy guard", () => {
  const generate = clientFunction(batchClient, "generateEvidence", "async function reviewEvidence")
  const review = clientFunction(batchClient, "reviewEvidence", "async function openEvidence")
  const confirm = clientFunction(batchClient, "executeConfirmation", "async function rpcIdempotent")
  for (const source of [generate, review, confirm]) {
    assert.match(source, /setBusy\(false\)[\s\S]{0,160}await refreshOperation\(\)/)
  }
})
