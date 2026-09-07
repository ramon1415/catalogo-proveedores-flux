import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
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

test("evidence retry adopts an existing validated object after an upload timeout", () => {
  assert.match(client, /evidenceBytes\s*=\s*existingBytes/i);
  assert.match(client, /evidenceSha256\s*=\s*await sha256Hex\(existingBytes\)/i);
  assert.doesNotMatch(client, /existing_evidence_hash_mismatch/i);
  assert.match(client, /upsert:\s*false/i);
});

  test("the evidence contract accepts evidence_id responses", () => {
    assert.match(
      client,
      /const evidenceId = evidence\.id \?\? evidence\.evidence_id/,
    );
    assert.match(
      client,
      /normalizeEvidenceIdentifier\(\s*await rpcIdempotent\("evidence\.prepare"/,
    );
  });

  test("the evidence contract remains compatible with id responses", () => {
    assert.match(
      client,
      /return evidence\.id === evidenceId \? evidence : \{ \.\.\.evidence, id: evidenceId \}/,
    );
    assert.match(
      client,
      /normalizeEvidenceIdentifier\(\s*await rpcIdempotent\("evidence\.(finalize|review)"/,
    );
  });

  test("the evidence contract fails closed when both identifiers are absent", () => {
    assert.match(
      client,
      /if \(!evidenceId\) throw new Error\("payment_evidence_identifier_missing"\)/,
    );
    assert.match(
      client,
      /payment_evidence_identifier_missing:\s*"El servidor no devolvió un identificador válido para la evidencia\."/,
    );
  });

test("critical PDF runtime is versioned locally for finance and request evidence", () => {
  const pdfLib = readFileSync(join(root, "pdf-lib-1.17.1.min.js"));
  const pdfJs = readFileSync(join(root, "pdfjs-3.11.174.min.js"));
  const pdfWorker = readFileSync(join(root, "pdfjs-worker-3.11.174.min.js"));

  assert.ok(pdfLib.byteLength > 500_000);
  assert.ok(pdfJs.byteLength > 300_000);
  assert.ok(pdfWorker.byteLength > 1_000_000);
  assert.match(html, /\.\/pdfjs-3\.11\.174\.min\.js/);
  assert.match(html, /\.\/pdf-lib-1\.17\.1\.min\.js/);
  assert.match(requestsHtml, /\.\/pdf-lib-1\.17\.1\.min\.js/);
  assert.match(client, /\.\/pdfjs-worker-3\.11\.174\.min\.js/);
  assert.doesNotMatch(`${html}\n${requestsHtml}\n${client}`, /cdn\.jsdelivr\.net\/npm\/(?:pdf-lib|pdfjs-dist)/);
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
