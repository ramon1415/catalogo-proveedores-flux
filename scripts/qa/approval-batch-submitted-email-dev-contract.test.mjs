import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  generateApprovalBatchPdfBytes,
  handleRequest,
  prepareApprovalBatchAttachment,
  renderApprovalBatchSubmittedEmail,
} from "../../supabase/functions/approval-batch-submitted-dispatcher/index.ts";

function referenceDocument(itemCount = 1) {
  const base = {
    event_id: "00000000-0000-0000-0000-000000000001",
    recipient_email: "director@example.invalid",
    recipient_profile_id: "00000000-0000-0000-0000-000000000002",
    batch: {
      id: "00000000-0000-0000-0000-000000000003",
      label: "CORTE DEMO CLIENTE 24/AGO/2026 v1",
      company: "Operadora Tlacatecpan",
      company_name: "Operadora Tlacatecpan",
      status: "submitted",
      period_start: "2026-08-20",
      period_end: "2026-08-26",
      submitted_at: "2026-08-24T21:19:42.614903Z",
      director_name: "Ramón",
      director_email: "director@example.invalid",
      item_count: itemCount,
      totals_by_currency: [{ currency: "MXN", amount: 100 * itemCount }],
    },
    items: Array.from({ length: itemCount }, (_, index) => ({
      item_id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
      request_number: index === 0 ? "SOL-2026-0032" : `SOL-2026-${String(index + 32).padStart(4, "0")}`,
      provider: "Ramon",
      provider_name: "Ramon",
      concept: "",
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
      payment_reference: null,
      finance_reviewed_at: "2026-08-24T21:18:00.000Z",
    })),
  };
  return base;
}

test("DEV attachment uses the same jsPDF/AutoTable contract and filename as the system PDF button", async () => {
  const document = referenceDocument(1);
  const generated = generateApprovalBatchPdfBytes(document);
  const binary = new TextDecoder("latin1").decode(generated.bytes);

  assert.equal(generated.pageCount, 1);
  assert.equal(binary.slice(0, 8), "%PDF-1.3");
  assert.match(binary, /jsPDF 2\.5\.2/);
  assert.match(binary, /CORTE DEMO CLIENTE 24\/AGO\/2026 v1/);
  assert.match(binary, /Operadora Tlacatecpan/);
  assert.match(binary, /SOL-2026-0032/);
  assert.match(binary, /Rancho San Juan Tlacatecpan/);
  assert.match(binary, /Finiquitos o liquidaciones/);
  assert.match(binary, /Ramon/);
  assert.match(binary, /Pendiente/);
  assert.match(binary, /Flux Operadora/);

  const attachment = await prepareApprovalBatchAttachment(document, {
    fetch: async () => new Response("not found", { status: 404 }),
  });
  assert.equal(attachment.filename, "corte-semanal-operadora-tlacatecpan-2026-08-26.pdf");
  assert.match(attachment.sha256, /^[0-9a-f]{64}$/);
  assert.equal(attachment.pageCount, 1);
  assert.match(attachment.content, /^JVBERi0xLjM/);
});

test("DEV system PDF keeps landscape letter pagination for larger cuts", () => {
  const generated = generateApprovalBatchPdfBytes(referenceDocument(35));
  const binary = new TextDecoder("latin1").decode(generated.bytes);
  assert.ok(generated.pageCount >= 2);
  assert.match(binary, /\/MediaBox \[0 0 792\.?0* 612\.?0*\]/);
  assert.match(binary, /Folio/);
  assert.match(binary, /Proveedor/);
  assert.match(binary, /Centro \/ partida/);
  assert.match(binary, /Solicitante/);
  assert.match(binary, /Decision/);
  assert.match(binary, /Motivo/);
});

test("DEV email keeps its test label and links only to the DEV approval UI", () => {
  const rendered = renderApprovalBatchSubmittedEmail(referenceDocument(1), "test_only", "director");
  assert.match(rendered.subject, /^\[DEV TEST\] Corte semanal por autorizar:/);
  assert.match(rendered.html, /flux-logo-email-white\.png/);
  assert.match(rendered.html, /mismo formato disponible en el botón PDF/);
  assert.match(rendered.html, /catalogo-proveedores-flux-git-dev-quantta-team\.vercel\.app\/approval_batches\.html\?batch_id=/);
  assert.doesNotMatch(rendered.html, /https:\/\/flux\.quantta\.mx\/approval_batches\.html/);
  assert.match(rendered.html, /Entorno DEV/);
});

test("DEV dispatcher sends the system-format PDF to the selected Director", async () => {
  const event = {
    id: "00000000-0000-0000-0000-000000000010",
    event_type: "approval_batch.submitted",
    source_table: "approval_batches",
    source_id: "00000000-0000-0000-0000-000000000003",
    source_folio: "CORTE DEMO CLIENTE 24/AGO/2026 v1",
    recipient_type: "administrador_sistema",
    recipient_profile_id: "00000000-0000-0000-0000-000000000002",
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
    if (target.endsWith("/assets/logo-flux-verde.webp")) {
      return new Response("not available in contract test", { status: 404 });
    }
    if (target.endsWith("/rest/v1/rpc/claim_approval_batch_submitted_events_for_dispatcher")) {
      return Response.json([event]);
    }
    if (target.endsWith("/rest/v1/rpc/get_approval_batch_submitted_notification_document")) {
      const document = referenceDocument(1);
      document.recipient_email = event.recipient_email;
      document.batch.director_email = event.recipient_email;
      return Response.json(document);
    }
    if (target === "https://api.resend.com/emails") {
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.to, [event.recipient_email]);
      assert.match(payload.subject, /^\[DEV TEST\] Corte semanal por autorizar:/);
      assert.equal(payload.attachments.length, 1);
      assert.equal(payload.attachments[0].filename, "corte-semanal-operadora-tlacatecpan-2026-08-26.pdf");
      assert.match(payload.attachments[0].content, /^JVBERi0xLjM/);
      return Response.json({ id: "resend-dev-director-system-pdf-1" });
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
  assert.equal(result.processed, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.events[0].attachment_filename, "corte-semanal-operadora-tlacatecpan-2026-08-26.pdf");
  assert.equal(result.events[0].final_recipient_email, "di******@gmail.example");
  assert.equal(calls.filter((call) => call.target === "https://api.resend.com/emails").length, 1);
});

test("DEV migrations remain exclusive and system-PDF fields stay service-only", async () => {
  const foundation = await readFile(
    new URL("../../supabase/migrations/20260824204217_approval_batch_submitted_email_pdf_dev.sql", import.meta.url),
    "utf8",
  );
  const systemPdfFields = await readFile(
    new URL("../../supabase/migrations/20260824224716_approval_batch_submitted_system_pdf_fields_dev.sql", import.meta.url),
    "utf8",
  );
  assert.match(foundation, /event\.event_type = 'approval_batch\.submitted'/);
  assert.match(foundation, /event\.created_at > p_created_at_after/);
  assert.match(systemPdfFields, /'requester_name', requester\.full_name/);
  assert.match(systemPdfFields, /'director_status', item\.director_status/);
  assert.match(systemPdfFields, /'reject_reason', item\.director_reject_reason/);
  assert.match(systemPdfFields, /'company_name', v_company_name/);
  assert.match(systemPdfFields, /grant execute[\s\S]*to service_role/i);
  assert.match(systemPdfFields, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(systemPdfFields, /delete from public\.notification_events/i);
});
