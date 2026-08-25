import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  generateApprovalBatchPdfBytes,
  handleRequest,
  prepareApprovalBatchAttachment,
  renderApprovalBatchSubmittedEmail,
} from "../../supabase/functions/approval-batch-submitted-dispatcher/index.ts";
import { SYSTEM_PDF_LOGO_DATA_URL } from "../../supabase/functions/approval-batch-submitted-dispatcher/pdf_logo.ts";

const EVENT_ID = "00000000-0000-0000-0000-000000000101";
const BATCH_ID = "00000000-0000-0000-0000-000000000202";
const DIRECTOR_ID = "00000000-0000-0000-0000-000000000303";

function referenceDocument(itemCount = 1) {
  return {
    event_id: EVENT_ID,
    recipient_email: "director@example.invalid",
    recipient_profile_id: DIRECTOR_ID,
    batch: {
      id: BATCH_ID,
      label: "CORTE DEMO CLIENTE 24/AGO/2026 v3",
      company: "Operadora Tlacatecpan",
      company_name: "Operadora Tlacatecpan",
      status: "submitted",
      period_start: "2026-06-01",
      period_end: "2026-08-26",
      submitted_at: "2026-08-24T23:25:00.000000Z",
      director_name: "Dirección QA",
      director_email: "director@example.invalid",
      item_count: itemCount,
      totals_by_currency: [{ currency: "MXN", amount: 100 * itemCount }],
    },
    items: Array.from({ length: itemCount }, (_, index) => ({
      item_id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
      request_number: index === 0 ? "SOL-2026-0100" : `SOL-2026-${String(index + 100).padStart(4, "0")}`,
      provider: "ramon 4",
      provider_name: "ramon 4",
      concept: "",
      cost_center: "Rancho San Juan Tlacatecpan",
      budget_category: "AUTO-RSJT-2026-ROW-034 - Mantenimiento Corporativo (Legal)",
      payment_method: "transfer",
      amount: 100,
      currency: "MXN",
      requester_name: "Ramón Hipo",
      director_status: "pending",
      reject_reason: null,
      rebatch_release_note: null,
      scheduled_payment_date: "2026-08-26",
      payment_reference: null,
      finance_reviewed_at: "2026-08-24T23:24:00.000Z",
    })),
  };
}

function sampleEvent() {
  return {
    id: EVENT_ID,
    event_type: "approval_batch.submitted",
    source_table: "approval_batches",
    source_id: BATCH_ID,
    source_folio: "CORTE DEMO CLIENTE 24/AGO/2026 v3",
    recipient_type: "administrador_sistema",
    recipient_profile_id: DIRECTOR_ID,
    recipient_email: "director@example.invalid",
    subject: "Corte semanal por autorizar",
    payload: {},
    attempt_count: 0,
    priority: "high",
  };
}

test("PROD attachment uses the UAT-approved jsPDF/AutoTable system PDF contract", async () => {
  const document = referenceDocument(1);
  const generated = generateApprovalBatchPdfBytes(document);
  const binary = new TextDecoder("latin1").decode(generated.bytes);

  assert.equal(generated.pageCount, 1);
  assert.equal(binary.slice(0, 8), "%PDF-1.3");
  assert.match(binary, /jsPDF 2\.5\.2/);
  assert.match(binary, /CORTE DEMO CLIENTE 24\/AGO\/2026 v3/);
  assert.match(binary, /Operadora Tlacatecpan/);
  assert.match(binary, /SOL-2026-0100/);
  assert.match(binary, /Rancho San Juan Tlacatecpan/);
  assert.match(binary, /Mantenimiento Corporativo/);
  assert.match(binary, /ramon 4/);
  assert.match(binary, /Pendiente/);
  assert.match(binary, /Flux Operadora/);
  assert.match(binary, /\/Subtype \/Image/);

  const attachment = await prepareApprovalBatchAttachment(document, {
    fetch: async () => new Response("not available in contract test", { status: 404 }),
  });
  assert.equal(attachment.filename, "corte-semanal-operadora-tlacatecpan-2026-08-26.pdf");
  assert.match(attachment.sha256, /^[0-9a-f]{64}$/);
  assert.ok(attachment.sizeBytes > 500);
  assert.equal(attachment.pageCount, 1);
  assert.match(attachment.content, /^JVBERi0xLjM/);
});

test("embedded UAT Flux wordmark is 300x120 and has no PNG alpha/transparency chunk", () => {
  assert.match(SYSTEM_PDF_LOGO_DATA_URL, /^data:image\/png;base64,/);
  const png = Buffer.from(SYSTEM_PDF_LOGO_DATA_URL.split(",", 2)[1], "base64");
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 300);
  assert.equal(png.readUInt32BE(20), 120);
  assert.notEqual(png[25], 4, "grayscale+alpha PNG is not allowed");
  assert.notEqual(png[25], 6, "RGBA PNG is not allowed");
  assert.equal(png.includes(Buffer.from("tRNS", "ascii")), false, "PNG transparency chunk is not allowed");
});

test("PROD system PDF keeps landscape letter pagination and approved columns", () => {
  const generated = generateApprovalBatchPdfBytes(referenceDocument(35));
  const binary = new TextDecoder("latin1").decode(generated.bytes);
  assert.ok(generated.pageCount >= 2);
  assert.match(binary, /\/MediaBox \[0 0 792\.?0* 612\.?0*\]/);
  assert.match(binary, /Folio/);
  assert.match(binary, /Proveedor/);
  assert.match(binary, /Centro \/ partida/);
  assert.match(binary, /Metodo/);
  assert.match(binary, /Monto/);
  assert.match(binary, /Solicitante/);
  assert.match(binary, /Decision/);
  assert.match(binary, /Motivo/);
});

test("PROD email keeps Flux design, real subject and production deep link", () => {
  const rendered = renderApprovalBatchSubmittedEmail(referenceDocument(1), "real", "director");
  assert.equal(rendered.subject, "Corte semanal por autorizar: CORTE DEMO CLIENTE 24/AGO/2026 v3");
  assert.match(rendered.html, /https:\/\/flux\.quantta\.mx\/assets\/email\/flux-logo-email-white\.png/);
  assert.match(rendered.html, /Tienes un corte por autorizar/);
  assert.match(rendered.html, /mismo formato disponible en el botón PDF/);
  assert.match(rendered.html, new RegExp(`https:\\/\\/flux\\.quantta\\.mx\\/approval_batches\\.html\\?batch_id=${BATCH_ID}`));
  assert.match(rendered.html, /Revisar y autorizar corte/);
  assert.doesNotMatch(rendered.subject, /DEV TEST/);
  assert.doesNotMatch(rendered.html, /Entorno DEV|Modo DEV TEST/);
  assert.match(rendered.text, /PDF adjunto/);
});

test("PROD dispatcher sends exactly one system-format PDF to the selected Director", async () => {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.endsWith("/assets/logo-flux-verde.webp")) {
      return new Response("not available in contract test", { status: 404 });
    }
    if (target.endsWith("/rest/v1/rpc/claim_approval_batch_submitted_events_for_dispatcher")) {
      const payload = JSON.parse(options.body);
      assert.deepEqual(Object.keys(payload).sort(), ["p_created_at_after", "p_limit", "p_worker_id"]);
      assert.equal(payload.p_limit, 1);
      assert.equal(payload.p_created_at_after, "2026-08-24T20:09:43.572799Z");
      return Response.json([sampleEvent()]);
    }
    if (target.endsWith("/rest/v1/rpc/get_approval_batch_submitted_notification_document")) {
      return Response.json(referenceDocument(1));
    }
    if (target === "https://api.resend.com/emails") {
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.to, ["director@example.invalid"]);
      assert.doesNotMatch(payload.subject, /DEV TEST/);
      assert.equal(payload.attachments.length, 1);
      assert.equal(payload.attachments[0].filename, "corte-semanal-operadora-tlacatecpan-2026-08-26.pdf");
      assert.match(payload.attachments[0].content, /^JVBERi0xLjM/);
      assert.equal(options.headers["Idempotency-Key"], `approval-batch-submitted/${EVENT_ID}`);
      return Response.json({ id: "resend_prod_director_system_pdf_1" });
    }
    if (target.endsWith("/rest/v1/rpc/mark_notification_processed_for_dispatcher")) {
      return Response.json({ status: "sent" });
    }
    throw new Error(`unexpected_fetch:${target}`);
  };

  const env = new Map([
    ["NOTIFICATION_DISPATCHER_SECRET", "test-secret"],
    ["NOTIFICATION_SEND_MODE", "real"],
    ["APPROVAL_BATCH_SUBMITTED_DELIVERY_MODE", "director"],
    ["SUPABASE_URL", "https://example.supabase.co"],
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
    body: JSON.stringify({ created_at_after: "2026-08-24T20:09:43.572799Z", limit: 1 }),
  });

  const response = await handleRequest(request, {
    env: (name) => env.get(name),
    fetch: fetchMock,
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.processed, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.cancelled, 0);
  assert.equal(result.mode, "real");
  assert.equal(result.delivery_mode, "director");
  assert.equal(result.event_type, "approval_batch.submitted");
  assert.equal(result.events[0].status, "sent");
  assert.equal(result.events[0].attachment_filename, "corte-semanal-operadora-tlacatecpan-2026-08-26.pdf");
  assert.equal(result.events[0].final_recipient_email, "di******@example.invalid");
  assert.equal(calls.filter((call) => call.target === "https://api.resend.com/emails").length, 1);
});

test("PROD migrations keep strict cutoff/service-only guardrails and add only system-PDF fields", async () => {
  const foundation = await readFile(
    new URL("../../supabase/migrations/20260824200842_approval_batch_submitted_email_pdf_prod.sql", import.meta.url),
    "utf8",
  );
  const systemPdfFields = await readFile(
    new URL("../../supabase/migrations/20260824233945_approval_batch_submitted_system_pdf_fields_prod.sql", import.meta.url),
    "utf8",
  );

  assert.match(foundation, /event\.event_type = 'approval_batch\.submitted'/);
  assert.match(foundation, /event\.created_at > p_created_at_after/);
  assert.match(foundation, /batch\.status = 'submitted'/);
  assert.match(foundation, /event\.recipient_profile_id = batch\.director_id/);
  assert.match(foundation, /notification_approval_batch_submitted_cutoff_at/);
  assert.match(foundation, /grant execute[\s\S]*to service_role/i);

  assert.match(systemPdfFields, /'requester_name', requester\.full_name/);
  assert.match(systemPdfFields, /'director_status', item\.director_status/);
  assert.match(systemPdfFields, /'reject_reason', item\.director_reject_reason/);
  assert.match(systemPdfFields, /'company_name', v_company_name/);
  assert.match(systemPdfFields, /grant execute[\s\S]*to service_role/i);
  assert.match(systemPdfFields, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(systemPdfFields, /delete from public\.notification_events/i);
  assert.doesNotMatch(systemPdfFields, /update public\.notification_events[\s\S]*where event_type = 'approval_batch\.submitted'/i);
});
