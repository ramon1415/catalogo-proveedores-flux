import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  generateApprovalBatchPdfBytes,
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

test("DEV email is test-only branded and never links to PROD approval UI", () => {
  const rendered = renderApprovalBatchSubmittedEmail(documentFixture(2), "test_only");
  assert.match(rendered.subject, /^\[DEV TEST\] Corte semanal por autorizar:/);
  assert.match(rendered.html, /flux-logo-email-white\.png/);
  assert.match(rendered.html, /Tienes un corte por autorizar/);
  assert.match(rendered.html, /Revisar y autorizar corte/);
  assert.match(rendered.html, /catalogo-proveedores-flux-git-dev-quantta-team\.vercel\.app\/approval_batches\.html\?batch_id=/);
  assert.doesNotMatch(rendered.html, /https:\/\/flux\.quantta\.mx\/approval_batches\.html/);
  assert.match(rendered.html, /Modo DEV TEST/);
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
