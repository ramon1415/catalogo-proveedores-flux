import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  generateApprovalBatchPdfBytes,
  handleRequest,
  prepareApprovalBatchAttachment,
  renderApprovalBatchSubmittedEmail,
} from "../../supabase/functions/approval-batch-submitted-dispatcher/index.ts";

const EVENT_ID = "00000000-0000-0000-0000-000000000010";
const BATCH_ID = "00000000-0000-0000-0000-000000000003";
const DIRECTOR_ID = "00000000-0000-0000-0000-000000000002";

function documentFixture(itemCount = 1) {
  const base = [{
    id: "00000000-0000-0000-0000-000000000011",
    item_id: "00000000-0000-0000-0000-000000000011",
    payment_request_id: "00000000-0000-0000-0000-000000000012",
    request_number: "SOL-2026-0032",
    provider_name: "Ramon",
    provider: "Ramon",
    concept: "Finiquito",
    cost_center: "Rancho San Juan Tlacatecpan",
    budget_category: "602-01-005-000 - Finiquitos o liquidaciones",
    payment_method: "transfer",
    amount: 100,
    currency: "MXN",
    requester_name: "Ramón Hipo",
    director_status: "pending",
    reject_reason: null,
    rebatch_release_note: null,
    scheduled_payment_date: "2026-08-26",
    payment_reference: "REF-0032",
    finance_reviewed_at: "2026-08-24T20:42:00.000Z",
  }];
  const extra = Array.from({ length: Math.max(itemCount - 1, 0) }, (_, index) => ({
    ...base[0],
    id: `00000000-0000-0000-0000-${String(index + 20).padStart(12, "0")}`,
    item_id: `00000000-0000-0000-0000-${String(index + 20).padStart(12, "0")}`,
    payment_request_id: `00000000-0000-0000-0000-${String(index + 120).padStart(12, "0")}`,
    request_number: `SOL-2026-${String(index + 33).padStart(4, "0")}`,
    provider_name: `Proveedor ${index + 2}`,
    provider: `Proveedor ${index + 2}`,
    amount: 100 + index,
  }));
  return {
    event_id: EVENT_ID,
    recipient_email: "director@gmail.example",
    recipient_profile_id: DIRECTOR_ID,
    batch: {
      id: BATCH_ID,
      label: "CORTE DEMO CLIENTE 24/AGO/2026 v1",
      company: "Operadora Tlacatecpan",
      company_name: "Operadora Tlacatecpan",
      period_start: "2026-08-20",
      period_end: "2026-08-26",
      status: "submitted",
      submitted_at: "2026-08-24T21:19:42.614Z",
      director_name: "Ramón",
      director_email: "director@gmail.example",
      item_count: itemCount,
      totals_by_currency: [{ currency: "MXN", amount: 100 + extra.reduce((sum, item) => sum + Number(item.amount), 0) }],
    },
    items: [...base, ...extra],
  };
}

function pdfAscii(bytes) {
  return Buffer.from(bytes).toString("latin1");
}

test("DEV attachment reproduces the PDF exported by approval_batches.js", async () => {
  const document = documentFixture(1);
  const generated = generateApprovalBatchPdfBytes(document);
  const text = pdfAscii(generated.bytes);

  assert.equal(generated.pageCount, 1);
  assert.equal(text.slice(0, 5), "%PDF-");
  assert.match(text, /\/MediaBox \[0 0 792(?:\.0*)? 612(?:\.0*)?\]/);
  assert.match(text, /jsPDF 2\.5\.2/);
  assert.match(text, /CORTE DEMO CLIENTE 24\/AGO\/2026 v1/);
  assert.match(text, /Operadora Tlacatecpan/);
  assert.match(text, /SOL-2026-0032/);
  assert.match(text, /Flux Operadora/);
  assert.match(text, /\/Subtype \/Image/);

  const attachment = await prepareApprovalBatchAttachment(document);
  assert.equal(attachment.filename, "corte-semanal-operadora-tlacatecpan-2026-08-26.pdf");
  assert.equal(attachment.generator, "approval_batches.js/exportPdf@jspdf-2.5.2+autotable-3.8.4");
  assert.equal(attachment.pageCount, 1);
  assert.match(attachment.sha256, /^[0-9a-f]{64}$/);
  assert.ok(attachment.sizeBytes > 10_000);
  assert.match(attachment.content, /^JVBERi0xL/);
  assert.match(pdfAscii(Buffer.from(attachment.content, "base64")), /SOL-2026-0032/);

  const output = process.env.APPROVAL_BATCH_PDF_SAMPLE_PATH;
  if (output) await writeFile(output, generated.bytes);
});

test("DEV system PDF keeps the same jsPDF/AutoTable pagination contract", () => {
  const generated = generateApprovalBatchPdfBytes(documentFixture(40));
  const text = pdfAscii(generated.bytes);
  assert.ok(generated.pageCount >= 2);
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, generated.pageCount);
  assert.match(text, /Folio/);
  assert.match(text, /Proveedor/);
  assert.match(text, /Centro \/ partida/);
  assert.match(text, /Metodo/);
  assert.match(text, /Solicitante/);
  assert.match(text, /Decision/);
  assert.match(text, /Motivo/);
});

test("DEV email states that the attached PDF is the system download and links only to DEV", () => {
  const rendered = renderApprovalBatchSubmittedEmail(documentFixture(1), "test_only", "director");
  assert.match(rendered.subject, /^\[DEV TEST\] Corte semanal por autorizar:/);
  assert.match(rendered.html, /El PDF adjunto es el mismo reporte disponible para descarga dentro del corte/);
  assert.match(rendered.html, /catalogo-proveedores-flux-git-dev-quantta-team\.vercel\.app\/approval_batches\.html\?batch_id=/);
  assert.doesNotMatch(rendered.html, /https:\/\/flux\.quantta\.mx\/approval_batches\.html/);
  assert.match(rendered.html, /Entorno DEV/);
});

test("DEV dispatcher sends the system PDF to the selected Director", async () => {
  const event = {
    id: EVENT_ID,
    event_type: "approval_batch.submitted",
    source_table: "approval_batches",
    source_id: BATCH_ID,
    source_folio: "CORTE DEMO CLIENTE 24/AGO/2026 v1",
    recipient_type: "administrador_sistema",
    recipient_profile_id: DIRECTOR_ID,
    recipient_email: "director@gmail.example",
    subject: "Corte semanal por autorizar",
    payload: {},
    attempt_count: 0,
    priority: "high",
  };
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.endsWith("/rest/v1/rpc/claim_approval_batch_submitted_events_for_dispatcher")) {
      return Response.json([event]);
    }
    if (target.endsWith("/rest/v1/rpc/get_approval_batch_submitted_notification_document")) {
      return Response.json(documentFixture(1));
    }
    if (target === "https://api.resend.com/emails") {
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.to, [event.recipient_email]);
      assert.match(payload.subject, /^\[DEV TEST\] Corte semanal por autorizar:/);
      assert.equal(payload.attachments.length, 1);
      assert.equal(payload.attachments[0].filename, "corte-semanal-operadora-tlacatecpan-2026-08-26.pdf");
      assert.match(payload.attachments[0].content, /^JVBERi0xL/);
      const attached = pdfAscii(Buffer.from(payload.attachments[0].content, "base64"));
      assert.match(attached, /CORTE DEMO CLIENTE 24\/AGO\/2026 v1/);
      assert.match(attached, /SOL-2026-0032/);
      assert.equal(options.headers["Idempotency-Key"], `approval-batch-submitted/${EVENT_ID}`);
      return Response.json({ id: "resend-dev-system-pdf-1" });
    }
    if (target.endsWith("/rest/v1/rpc/mark_notification_processed_for_dispatcher")) {
      return Response.json({ status: "sent" });
    }
    throw new Error(`unexpected_fetch:${target}`);
  };

  const env = new Map([
    ["NOTIFICATION_DISPATCHER_SECRET", "test-secret"],
    ["NOTIFICATION_SEND_MODE", "test_only"],
    ["NOTIFICATION_TEST_EMAIL", "ramon@quantta.mx"],
    ["SUPABASE_URL", "https://scsirgbuqjcwoaxfacth.supabase.co"],
    ["SUPABASE_SERVICE_ROLE_KEY", "service-role-test"],
    ["RESEND_API_KEY", "resend-test"],
    ["NOTIFICATION_FROM_EMAIL", "Flux <notificaciones@example.invalid>"],
  ]);
  const request = new Request("https://example.invalid/functions/v1/approval-batch-submitted-dispatcher", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-notification-dispatcher-secret": "test-secret",
    },
    body: JSON.stringify({ created_at_after: "2026-08-24T20:43:14.805243Z", limit: 1 }),
  });
  const response = await handleRequest(request, {
    env: (name) => env.get(name),
    fetch: fetchMock,
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.mode, "test_only");
  assert.equal(result.delivery_mode, "director");
  assert.equal(result.pdf_generator, "approval_batches.js/exportPdf@jspdf-2.5.2+autotable-3.8.4");
  assert.equal(result.processed, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.events[0].attachment_filename, "corte-semanal-operadora-tlacatecpan-2026-08-26.pdf");
  assert.equal(result.events[0].final_recipient_email, "di******@gmail.example");
  assert.equal(calls.filter((call) => call.target === "https://api.resend.com/emails").length, 1);
});

test("DEV dependency and database contracts are pinned to the system PDF", async () => {
  const deno = JSON.parse(await readFile(
    new URL("../../supabase/functions/approval-batch-submitted-dispatcher/deno.json", import.meta.url),
    "utf8",
  ));
  assert.equal(deno.imports.jspdf, "npm:jspdf@2.5.2");
  assert.equal(deno.imports["jspdf-autotable"], "npm:jspdf-autotable@3.8.4");

  const migration = await readFile(
    new URL("../../supabase/migrations/20260824215919_approval_batch_submitted_system_pdf_parity_dev.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /get_approval_batch_submitted_notification_document/);
  assert.match(migration, /'company_name'/);
  assert.match(migration, /'status', v_batch\.status/);
  assert.match(migration, /'provider_name'/);
  assert.match(migration, /'requester_name'/);
  assert.match(migration, /'director_status'/);
  assert.match(migration, /'reject_reason'/);
  assert.match(migration, /'rebatch_release_note'/);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /update public\.notification_events/i);
  assert.doesNotMatch(migration, /delete from public\.notification_events/i);
});
