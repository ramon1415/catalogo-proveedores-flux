import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  generateApprovalBatchPdfBytes,
  handleRequest,
  prepareApprovalBatchAttachment,
  renderApprovalBatchSubmittedEmail,
} from "../../supabase/functions/approval-batch-submitted-dispatcher/index.ts";

function documentFixture(itemCount = 23) {
  return {
    event_id: "00000000-0000-0000-0000-000000000001",
    recipient_email: "director@example.invalid",
    recipient_profile_id: "00000000-0000-0000-0000-000000000002",
    batch: {
      id: "00000000-0000-0000-0000-000000000003",
      label: "Corte DEV QA 2026-W35",
      company: "Flux DEV",
      period_start: "2026-08-24",
      period_end: "2026-08-30",
      submitted_at: "2026-08-24T20:44:00.000Z",
      director_name: "Dirección QA",
      director_email: "director@example.invalid",
      item_count: itemCount,
      totals_by_currency: [{ currency: "MXN", amount: 32785.25 }],
    },
    items: Array.from({ length: itemCount }, (_, index) => ({
      item_id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
      request_number: `SOL-DEV-${String(index + 1).padStart(4, "0")}`,
      provider: `Proveedor DEV ${index + 1}`,
      concept: `Servicio operativo ${index + 1}`,
      cost_center: "CC-01 - Operación",
      budget_category: "P-01 - Servicios",
      payment_method: "transfer",
      amount: 1000 + index * 37.25,
      currency: "MXN",
      scheduled_payment_date: "2026-08-28",
      payment_reference: `REF-${index + 1}`,
      finance_reviewed_at: "2026-08-24T20:42:00.000Z",
    })),
  };
}

test("DEV PDF is deterministic, horizontal, and paginated", async () => {
  const doc = documentFixture(23);
  const first = generateApprovalBatchPdfBytes(doc);
  const second = generateApprovalBatchPdfBytes(doc);
  const text = new TextDecoder().decode(first.bytes);
  assert.equal(first.pageCount, 3);
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(text.slice(0, 8), "%PDF-1.4");
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 3);
  assert.match(text, /Corte semanal para autorizacion/);
  assert.match(text, /SOL-DEV-0001/);
  assert.match(text, /Documento informativo/);

  const attachment = await prepareApprovalBatchAttachment(doc);
  assert.match(attachment.filename, /^Corte_semanal_[A-Za-z0-9._-]+\.pdf$/);
  assert.match(attachment.sha256, /^[0-9a-f]{64}$/);
  assert.equal(attachment.pageCount, 3);
  assert.match(attachment.content, /^JVBERi0xLjQ/);
});

test("DEV email keeps its test label and links only to the DEV approval UI", () => {
  const rendered = renderApprovalBatchSubmittedEmail(documentFixture(2), "test_only", "director");
  assert.match(rendered.subject, /^\[DEV TEST\] Corte semanal por autorizar:/);
  assert.match(rendered.html, /flux-logo-email-white\.png/);
  assert.match(rendered.html, /Tienes un corte por autorizar/);
  assert.match(rendered.html, /Revisar y autorizar corte/);
  assert.match(rendered.html, /catalogo-proveedores-flux-git-dev-quantta-team\.vercel\.app\/approval_batches\.html\?batch_id=/);
  assert.doesNotMatch(rendered.html, /https:\/\/flux\.quantta\.mx\/approval_batches\.html/);
  assert.match(rendered.html, /Entorno DEV/);
  assert.doesNotMatch(rendered.html, /redirigido al destinatario de prueba/);
});

test("DEV dispatcher sends to the selected Director instead of the global test mailbox", async () => {
  const event = {
    id: "00000000-0000-0000-0000-000000000010",
    event_type: "approval_batch.submitted",
    source_table: "approval_batches",
    source_id: "00000000-0000-0000-0000-000000000003",
    source_folio: "Corte DEV QA 2026-W35",
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
    if (target.endsWith("/rest/v1/rpc/claim_approval_batch_submitted_events_for_dispatcher")) {
      return Response.json([event]);
    }
    if (target.endsWith("/rest/v1/rpc/get_approval_batch_submitted_notification_document")) {
      const document = documentFixture(2);
      document.recipient_email = event.recipient_email;
      document.batch.director_email = event.recipient_email;
      return Response.json(document);
    }
    if (target === "https://api.resend.com/emails") {
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.to, [event.recipient_email]);
      assert.notDeepEqual(payload.to, ["ramon@quantta.mx"]);
      assert.match(payload.subject, /^\[DEV TEST\] Corte semanal por autorizar:/);
      assert.match(payload.html, /Entorno DEV/);
      assert.equal(payload.attachments.length, 1);
      assert.match(payload.attachments[0].content, /^JVBERi0xLjQ/);
      return Response.json({ id: "resend-dev-director-1" });
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
  assert.equal(result.events[0].final_recipient_email, "di******@gmail.example");
  assert.equal(calls.filter((call) => call.target === "https://api.resend.com/emails").length, 1);
});

test("DEV migration is exclusive, service-only, and replay-safe", async () => {
  const migration = await readFile(
    new URL("../../supabase/migrations/20260824204217_approval_batch_submitted_email_pdf_dev.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /event\.event_type = 'approval_batch\.submitted'/);
  assert.match(migration, /event\.created_at > p_created_at_after/);
  assert.match(migration, /batch\.status = 'submitted'/);
  assert.match(migration, /event\.recipient_profile_id = batch\.director_id/);
  assert.match(migration, /notification_approval_batch_submitted_dispatch_after_insert/);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /update public\.notification_events[\s\S]*where event_type = 'approval_batch\.submitted'/i);
  assert.doesNotMatch(migration, /delete from public\.notification_events/i);
});
