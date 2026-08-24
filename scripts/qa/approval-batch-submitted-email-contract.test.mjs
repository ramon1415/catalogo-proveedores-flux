import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  generateApprovalBatchPdfBytes,
  handleRequest,
  prepareApprovalBatchAttachment,
  renderApprovalBatchSubmittedEmail,
} from "../../supabase/functions/approval-batch-submitted-dispatcher/index.ts";

const EVENT_ID = "00000000-0000-0000-0000-000000000101";
const BATCH_ID = "00000000-0000-0000-0000-000000000202";
const DIRECTOR_ID = "00000000-0000-0000-0000-000000000303";

function sampleDocument(itemCount = 23) {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    item_id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
    request_number: `SOL-2026-${String(index + 1).padStart(4, "0")}`,
    provider: `Proveedor de prueba ${index + 1}`,
    concept: `Servicio operativo correspondiente a la partida ${index + 1}`,
    cost_center: `CC-${String(index + 1).padStart(2, "0")} - Operacion`,
    budget_category: `P-${String(index + 1).padStart(2, "0")} - Servicios`,
    payment_method: index % 2 ? "transfer" : "cash",
    amount: 1000 + index * 37.25,
    currency: "MXN",
    scheduled_payment_date: "2026-08-28",
    payment_reference: `REF-${index + 1}`,
    finance_reviewed_at: "2026-08-24T18:30:00.000Z",
  }));
  return {
    event_id: EVENT_ID,
    recipient_email: "director@example.invalid",
    recipient_profile_id: DIRECTOR_ID,
    batch: {
      id: BATCH_ID,
      label: "Corte OPERADORA TLACATECPAN 2026-W35",
      company: "Operadora Tlacatecpan",
      period_start: "2026-08-24",
      period_end: "2026-08-30",
      submitted_at: "2026-08-24T18:35:00.000Z",
      director_name: "Dirección QA",
      director_email: "director@example.invalid",
      item_count: itemCount,
      totals_by_currency: [{ currency: "MXN", amount: 32785.25 }],
    },
    items,
  };
}

function sampleEvent() {
  return {
    id: EVENT_ID,
    event_type: "approval_batch.submitted",
    source_table: "approval_batches",
    source_id: BATCH_ID,
    source_folio: "Corte OPERADORA TLACATECPAN 2026-W35",
    recipient_type: "administrador_sistema",
    recipient_profile_id: DIRECTOR_ID,
    recipient_email: "director@example.invalid",
    subject: "Corte semanal por autorizar",
    payload: {},
    attempt_count: 0,
    priority: "high",
  };
}

test("PDF is a valid multi-page, ASCII-safe Flux document", async () => {
  const document = sampleDocument(23);
  const { bytes, pageCount } = generateApprovalBatchPdfBytes(document);
  const replay = generateApprovalBatchPdfBytes(document);
  const text = new TextDecoder().decode(bytes);
  assert.deepEqual(replay.bytes, bytes, "the same event snapshot must produce identical PDF bytes on retry");

  assert.equal(pageCount, 3);
  assert.equal(text.slice(0, 8), "%PDF-1.4");
  assert.match(text, /\/Type \/Pages/);
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 3);
  assert.match(text, /Corte semanal para autorizacion/);
  assert.match(text, /SOL-2026-0001/);
  assert.match(text, /Documento informativo/);
  assert.match(text, /%%EOF\n$/);

  const output = process.env.APPROVAL_BATCH_PDF_SAMPLE_PATH;
  if (output) await writeFile(output, bytes);
});

test("attachment has deterministic contract metadata and PDF base64", async () => {
  const attachment = await prepareApprovalBatchAttachment(sampleDocument(2));
  assert.match(attachment.filename, /^Corte_semanal_[A-Za-z0-9._-]+\.pdf$/);
  assert.match(attachment.sha256, /^[0-9a-f]{64}$/);
  assert.ok(attachment.sizeBytes > 500);
  assert.equal(attachment.pageCount, 1);
  assert.match(attachment.content, /^JVBERi0xLjQ/);
});

test("email uses current Flux design, absolute deep link, and PDF copy", () => {
  const rendered = renderApprovalBatchSubmittedEmail(sampleDocument(2), "real");
  assert.equal(rendered.subject, "Corte semanal por autorizar: Corte OPERADORA TLACATECPAN 2026-W35");
  assert.match(rendered.html, /https:\/\/flux\.quantta\.mx\/assets\/email\/flux-logo-email-white\.png/);
  assert.match(rendered.html, /Tienes un corte por autorizar/);
  assert.match(rendered.html, /El PDF adjunto contiene el detalle/);
  assert.match(rendered.html, new RegExp(`approval_batches\\.html\\?batch_id=${BATCH_ID}`));
  assert.match(rendered.html, /Revisar y autorizar corte/);
  assert.doesNotMatch(rendered.html, /DEV TEST/);
  assert.match(rendered.text, /PDF adjunto/);
});

test("dispatcher sends exactly one submitted event to the selected Director with one PDF", async () => {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.endsWith("/rest/v1/rpc/claim_approval_batch_submitted_events_for_dispatcher")) {
      const payload = JSON.parse(options.body);
      assert.deepEqual(Object.keys(payload).sort(), ["p_created_at_after", "p_limit", "p_worker_id"]);
      assert.equal(payload.p_limit, 1);
      return Response.json([sampleEvent()]);
    }
    if (target.endsWith("/rest/v1/rpc/get_approval_batch_submitted_notification_document")) {
      return Response.json(sampleDocument(2));
    }
    if (target === "https://api.resend.com/emails") {
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.to, ["director@example.invalid"]);
      assert.equal(payload.attachments.length, 1);
      assert.match(payload.attachments[0].filename, /^Corte_semanal_/);
      assert.match(payload.attachments[0].content, /^JVBERi0xLjQ/);
      assert.equal(options.headers["Idempotency-Key"], `approval-batch-submitted/${EVENT_ID}`);
      return Response.json({ id: "resend_approval_batch_submitted_1" });
    }
    if (target.endsWith("/rest/v1/rpc/mark_notification_processed_for_dispatcher")) {
      return Response.json({ status: "sent" });
    }
    throw new Error(`unexpected_fetch:${target}`);
  };

  const env = new Map([
    ["NOTIFICATION_DISPATCHER_SECRET", "test-secret"],
    ["NOTIFICATION_SEND_MODE", "real"],
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
    body: JSON.stringify({ created_at_after: "2026-08-24T18:00:00.000Z", limit: 1 }),
  });

  const response = await handleRequest(request, {
    env: (name) => env.get(name),
    fetch: fetchMock,
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual({
    processed: result.processed,
    sent: result.sent,
    failed: result.failed,
    cancelled: result.cancelled,
    mode: result.mode,
    event_type: result.event_type,
  }, {
    processed: 1,
    sent: 1,
    failed: 0,
    cancelled: 0,
    mode: "real",
    event_type: "approval_batch.submitted",
  });
  assert.equal(result.events[0].status, "sent");
  assert.equal(result.events[0].final_recipient_email, "di******@example.invalid");
  assert.equal(calls.filter((call) => call.target === "https://api.resend.com/emails").length, 1);
});

test("migration is exclusive, strict-cutoff, service-only, and does not replay history", async () => {
  const migration = await readFile(
    new URL("../../supabase/migrations/20260824191500_approval_batch_submitted_email_pdf_prod.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /event\.event_type = 'approval_batch\.submitted'/);
  assert.match(migration, /event\.created_at > p_created_at_after/);
  assert.match(migration, /batch\.status = 'submitted'/);
  assert.match(migration, /event\.recipient_profile_id = batch\.director_id/);
  assert.match(migration, /get_approval_batch_submitted_notification_document/);
  assert.match(migration, /notification_approval_batch_submitted_dispatch_after_insert/);
  assert.match(migration, /notification_approval_batch_submitted_cutoff_at/);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /update public\.notification_events[\s\S]*where event_type = 'approval_batch\.submitted'/i);
  assert.doesNotMatch(migration, /delete from public\.notification_events/i);
});
