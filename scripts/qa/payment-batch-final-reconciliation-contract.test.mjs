import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migration = readFileSync(
  join(root, "supabase", "migrations", "033_payment_batch_final_reconciliation.sql"),
  "utf8",
);
const html = readFileSync(join(root, "comprobantes_batch.html"), "utf8");
const client = readFileSync(join(root, "comprobantes_batch.js"), "utf8");
const helper = readFileSync(
  join(root, "payment_batch_single_page_pdf.js"),
  "utf8",
);
const requestEvidence = readFileSync(
  join(root, "payment_request_reconciliation_evidence.js"),
  "utf8",
);
const requestsHtml = readFileSync(join(root, "solicitudes.html"), "utf8");
const css = readFileSync(
  join(root, "payment_batch_final_reconciliation.css"),
  "utf8",
);

function functionBody(name) {
  const start = migration.search(
    new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`,
      "i",
    ),
  );
  assert.notEqual(start, -1, `Missing SQL function ${name}`);
  const next = migration
    .slice(start + 1)
    .search(/create\s+(?:or\s+replace\s+)?function\s+public\./i);
  return next === -1
    ? migration.slice(start)
    : migration.slice(start, start + 1 + next);
}

test("033 is additive and refuses to run without the 032 baseline", () => {
  assert.match(migration, /payment_batch_032_required/i);
  assert.match(migration, /raise exception/i);
  assert.doesNotMatch(migration, /\b(drop|truncate)\b/i);
});

test("033 creates the append-only extraction correction ledger", () => {
  assert.match(migration, /create table public\.payment_extraction_corrections/i);
  assert.match(
    migration,
    /payment_extraction_corrections[\s\S]*corrected_by[\s\S]*corrected_at/i,
  );
  assert.match(
    migration,
    /payment_extraction_corrections_immutable[\s\S]*payment_receipt_protect_append_only/i,
  );
});

test("033 creates private individual evidence with an exact one-page invariant", () => {
  assert.match(migration, /create table public\.payment_operation_evidence/i);
  assert.match(migration, /page_count\s*=\s*1/i);
  assert.match(migration, /(individual_sha256|sha256)[\s\S]*unique/i);
});

test("033 creates one immutable receipt-to-request link", () => {
  assert.match(
    migration,
    /create table public\.payment_request_receipt_links/i,
  );
  assert.match(
    migration,
    /payment_request_receipt_links[\s\S]*unique\s*\(\s*operation_id\s*\)/i,
  );
  assert.match(
    migration,
    /payment_request_receipt_links[\s\S]*unique\s*\(\s*payment_request_id\s*\)/i,
  );
});

test("one evidence record cannot be linked twice", () => {
  assert.match(
    migration,
    /payment_request_receipt_links[\s\S]*unique\s*\(\s*evidence_id\s*\)/i,
  );
});

test("legacy payment_receipts remains structurally and financially untouched", () => {
  assert.doesNotMatch(
    migration,
    /\b(alter\s+table|insert\s+into|update|delete\s+from)\s+(?:public\.)?payment_receipts\b/i,
  );
});

test("033 does not dual-write notification_events", () => {
  assert.doesNotMatch(migration, /\bnotification_events\b/i);
});

test("the final 1:1 flow has no allocation, movement, or reservation dependency", () => {
  assert.doesNotMatch(
    migration,
    /\b(payment_allocation_plans|payment_allocation_plan_items|payment_reservations|payment_reconciliation_movements)\b/i,
  );
  assert.doesNotMatch(migration, /\b(reserve|release_reservation|expire_reservation)\b/i);
});

test("accepted extraction remains the only source for operation amount and currency", () => {
  const link = functionBody("link_payment_receipt_to_request");
  assert.match(link, /bank_payment_operations[\s\S]*for update/i);
  assert.match(link, /amount_minor/i);
  assert.match(link, /currency/i);
  assert.doesNotMatch(link, /p_amount/i);
  assert.doesNotMatch(link, /p_currency/i);
});

test("candidate search is read-only and stable", () => {
  const search = functionBody("find_payment_receipt_candidates");
  assert.match(search, /stable/i);
  assert.doesNotMatch(
    search,
    /\b(insert\s+into|update\s+public\.|delete\s+from)\b/i,
  );
});

test("candidate search requires exact amount and normalized currency", () => {
  const search = functionBody("find_payment_receipt_candidates");
  assert.match(
    search,
    /snapshot\.amount_minor\s*=\s*v_operation\.amount_minor/i,
  );
  assert.match(
    search,
    /snapshot\.currency\s*=\s*v_operation\.currency/i,
  );
});

test("candidate search returns approved, payable, and unlinked requests only", () => {
  const search = functionBody("find_payment_receipt_candidates");
  assert.match(search, /payment_reconciliation_snapshot_is_payable/i);
  assert.match(search, /payment_request_receipt_links/i);
  assert.match(search, /payment_receipts/i);
  assert.match(search, /(approved|aprob)/i);
});

test("provider compatibility is revalidated during candidate search", () => {
  assert.match(
    functionBody("find_payment_receipt_candidates"),
    /(provider|proveedor)/i,
  );
});

test("final link accepts only operation, request, and idempotency inputs", () => {
  const declaration = migration.match(
    /create\s+(?:or\s+replace\s+)?function\s+public\.link_payment_receipt_to_request\s*\(([\s\S]*?)\)\s*returns/i,
  );
  assert.ok(declaration);
  const args = declaration[1].toLowerCase();
  assert.match(args, /p_operation_id/);
  assert.match(args, /p_payment_request_id/);
  assert.match(args, /p_idempotency_key/);
  assert.doesNotMatch(args, /p_(amount|currency|allocation|reservation)/);
});

test("final link locks every financial authority before validating", () => {
  const link = functionBody("link_payment_receipt_to_request");
  assert.ok((link.match(/for update/gi) || []).length >= 4);
  assert.match(link, /payment_requests/i);
  assert.match(link, /payable_snapshots/i);
  assert.match(link, /payment_operation_evidence/i);
});

test("final link revalidates accepted extraction, approval, exact facts, and provider", () => {
  const link = functionBody("link_payment_receipt_to_request");
  assert.match(link, /accepted/i);
  assert.match(link, /(approved|aprob)/i);
  assert.match(link, /amount_minor/i);
  assert.match(link, /currency/i);
  assert.match(link, /(provider|proveedor)/i);
});

test("final link is idempotent and stores the command result", () => {
  const link = functionBody("link_payment_receipt_to_request");
  assert.match(link, /idempotency/i);
  assert.match(link, /payment_reconciliation_command_replay/i);
  assert.match(link, /payment_reconciliation_store_command/i);
});

test("link, paid state, audit, and outbox share one database transaction", () => {
  const link = functionBody("link_payment_receipt_to_request");
  assert.match(link, /insert into public\.payment_request_receipt_links/i);
  assert.match(link, /update public\.payment_requests/i);
  assert.match(link, /append_financial_outbox_event_internal/i);
  assert.doesNotMatch(link, /\bcommit\b/i);
});

test("the outbox event is financial and contains no full account data", () => {
  const link = functionBody("link_payment_receipt_to_request");
  const outboxStart = link.indexOf(
    "v_event_id := public.append_financial_outbox_event_internal",
  );
  const outboxEnd = link.indexOf("v_result :=", outboxStart);
  assert.notEqual(outboxStart, -1);
  assert.notEqual(outboxEnd, -1);
  const outboxCall = link.slice(outboxStart, outboxEnd);
  assert.match(outboxCall, /payment_receipt\.linked/i);
  assert.doesNotMatch(
    outboxCall,
    /(clabe|account_number|cuenta_completa|cuenta_bancaria)/i,
  );
});

test("evidence preparation and review are separate guarded transitions", () => {
  assert.match(migration, /prepare_payment_operation_evidence/i);
  assert.match(migration, /finalize_payment_operation_evidence/i);
  assert.match(migration, /review_payment_operation_evidence/i);
  assert.match(migration, /payment_receipt_validate_evidence_transition/i);
});

test("storage policies cover only private derived one-page evidence", () => {
  assert.match(migration, /storage\.objects/i);
  assert.match(migration, /payment-batch-documents/i);
  assert.match(migration, /(application\/pdf|pdf)/i);
  assert.doesNotMatch(migration, /grant\s+select\s+on\s+storage\.objects\s+to\s+anon/i);
});

test("RLS is enabled on every 033 table", () => {
  for (const table of [
    "payment_extraction_corrections",
    "payment_operation_evidence",
    "payment_request_receipt_links",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`,
        "i",
      ),
    );
  }
});

test("authenticated users receive RPC execution, not direct table mutation", () => {
  assert.doesNotMatch(
    migration,
    /grant\s+(all|insert|update|delete)[\s\S]{0,120}\bto\s+authenticated\b/i,
  );
  assert.match(
    migration,
    /grant\s+execute\s+on\s+function[\s\S]*link_payment_receipt_to_request/i,
  );
});

test("batch context exposes explicit match and link capabilities", () => {
  const context = functionBody("get_payment_batch_context");
  assert.match(context, /can_match/i);
  assert.match(context, /can_link/i);
});

test("the operator UI presents four plain-language steps", () => {
  for (const label of [
    "Revisar comprobante",
    "Buscar solicitud aprobada",
    "Confirmar coincidencia",
    "Comprobante vinculado",
  ]) {
    assert.match(html, new RegExp(label, "i"));
  }
});

test("the operator UI contains no reservation or partial-allocation controls", () => {
  assert.doesNotMatch(
    html,
    /(Proponer asignación|Reservar|Liberar reserva|Expirar reserva|Cancelar plan|remanente financiero|disponible para reservar)/i,
  );
  assert.doesNotMatch(
    html,
    /id=["'](?:proposePlanBtn|reservePlanBtn|releaseReservationBtn|expireReservationBtn|cancelPlanBtn)["']/i,
  );
});

test("candidate choice is singular and does not expose an editable amount", () => {
  assert.match(client, /type\s*=\s*["']radio["']/i);
  assert.doesNotMatch(client, /receipt-candidate-amount/i);
  assert.doesNotMatch(client, /type\s*=\s*["']number["']/i);
});

test("extraction correction is a separate explicit dialog", () => {
  assert.match(html, /id=["'][^"']*correction[^"']*dialog["']/i);
  assert.match(html, /Motivo de la corrección/i);
  assert.match(client, /correct_payment_document_extraction/i);
});

test("link confirmation has its own explicit confirmation dialog", () => {
  assert.match(html, /id=["'][^"']*(link|confirm)[^"']*dialog["']/i);
  assert.match(html, /Confirmar coincidencia/i);
  assert.match(client, /link_payment_receipt_to_request/i);
});

test("the browser passes no editable financial facts to the final link RPC", () => {
  assert.match(client, /p_operation_id/i);
  assert.match(client, /p_payment_request_id/i);
  assert.doesNotMatch(
    client,
    /link_payment_receipt_to_request[\s\S]{0,600}p_(amount|currency|allocation|reservation)/i,
  );
});

test("the browser fails closed unless server capabilities allow matching and linking", () => {
  assert.match(client, /can_match/i);
  assert.match(client, /can_link/i);
  assert.match(client, /disabled/i);
});

test("the browser has no direct financial DML or privileged credential", () => {
  assert.doesNotMatch(
    client,
    /\.from\s*\(\s*["'`](payment_requests|payment_receipts|payment_request_receipt_links|bank_payment_operations|payment_operation_evidence)["'`]\s*\)\s*\.\s*(insert|update|upsert|delete)/i,
  );
  assert.doesNotMatch(client, /\b(service_role|SUPABASE_SERVICE_ROLE_KEY)\b/i);
});

test("one-page helper physically copies one source page into a new PDF", () => {
  assert.match(helper, /PDFDocument\.load/i);
  assert.match(helper, /PDFDocument\.create/i);
  assert.match(helper, /copyPages/i);
  assert.match(helper, /addPage/i);
});

test("one-page helper validates source type and resulting page count", () => {
  assert.match(helper, /application\/pdf/i);
  assert.match(helper, /getPageCount/i);
  assert.match(helper, /pageCount\s*!==\s*1|getPageCount\(\)\s*!==\s*1/i);
});

test("source batch PDF is fetched only to derive evidence and is never opened for the user", () => {
  assert.match(client, /deriveSinglePageFromUrl/i);
  assert.doesNotMatch(
    client,
    /window\.open\s*\(\s*(?:source|batch|document).*signed/i,
  );
});

test("request detail loads exactly one linked receipt summary", () => {
  assert.match(requestEvidence, /get_payment_request_receipt_summary/i);
  assert.match(requestEvidence, /get_payment_operation_evidence_access/i);
  assert.doesNotMatch(requestEvidence, /(saldo parcial|pago parcial|remanente)/i);
});

test("request evidence download revalidates the one-page PDF", () => {
  assert.match(requestEvidence, /downloadAndVerifySinglePage/i);
  assert.match(requestsHtml, /payment_batch_single_page_pdf\.js/i);
});

test("provider external access remains disabled in this cut", () => {
  assert.match(requestEvidence, /(disabled|deshabilitad|no disponible)/i);
});

test("modal CSS uses one vertical scroll, no horizontal overflow, and responsive layout", () => {
  assert.match(css, /overflow-y\s*:\s*auto/i);
  assert.match(css, /overflow-x\s*:\s*hidden/i);
  assert.match(css, /max-height\s*:/i);
  assert.match(css, /@media\s*\(/i);
});

test("modal title and long references use readable, wrapping styles", () => {
  assert.match(css, /var\(--text-1\)/i);
  assert.match(css, /(overflow-wrap|word-break)\s*:/i);
});

test("removed N:M client module is no longer loaded", () => {
  assert.doesNotMatch(html, /payment_batch_final_reconciliation\.js/i);
  assert.doesNotMatch(client, /(propose_payment_allocation|reserve_payment_allocation)/i);
});

test("final files contain no secrets, database URLs, or mojibake", () => {
  const surface = [
    migration,
    html,
    client,
    helper,
    requestEvidence,
    requestsHtml,
    css,
  ].join("\n");
  assert.doesNotMatch(
    surface,
    /(SUPABASE_SERVICE_ROLE_KEY|postgres(?:ql)?:\/\/|BEGIN PRIVATE KEY)/i,
  );
  assert.doesNotMatch(surface, /(Ã|Â|�)/);
});
