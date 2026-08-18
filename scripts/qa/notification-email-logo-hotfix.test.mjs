import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderEmail } from "../../supabase/functions/notification-dispatcher/index.ts";

const LOGO_URL = "https://flux.quantta.mx/assets/email/flux-logo-email-white.png";
const LOGO_MARKUP = `<img src="${LOGO_URL}" width="110" alt="Flux" style="display:block;width:110px;max-width:100%;height:auto;border:0;" />`;

function event(eventType, roles = ["requester"]) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    event_type: eventType,
    source_table: "payment_requests",
    source_id: "00000000-0000-0000-0000-000000000002",
    source_folio: "SOL-2026-TEST",
    recipient_type: roles.includes("provider") ? "provider" : "profile",
    recipient_profile_id: roles.includes("provider") ? null : "00000000-0000-0000-0000-000000000003",
    recipient_email: "qa@example.invalid",
    subject: null,
    payload: {
      folio: "SOL-2026-TEST",
      company: "Flux Operadora",
      requester: "QA",
      provider: "Proveedor QA",
      amount: 100,
      currency: "MXN",
      cost_center: "QA",
      budget_category: "QA",
      concept: "QA",
      payment_date: "2026-08-17",
      reference_hint: "QA",
      status: "paid",
      recipient_roles: roles,
    },
    attempt_count: 0,
    priority: "normal",
  };
}

test("the email-safe logo asset is a real 220px transparent PNG", async () => {
  const png = await readFile(new URL("../../assets/email/flux-logo-email-white.png", import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 220);
  assert.equal(png[25], 6, "PNG must use RGBA color type for transparency");
});

test("payment_request.created uses the official logo and keeps zero attachments", () => {
  const rendered = renderEmail(event("payment_request.created"), "real");
  assert.match(rendered.html, new RegExp(LOGO_MARKUP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(rendered.html, />Flux<\/td>/);
  assert.equal(Object.hasOwn(rendered, "attachments"), false);
  assert.equal(rendered.subject, "Nueva solicitud de pago: SOL-2026-TEST");
  assert.match(rendered.html, /Nueva solicitud por revisar/);
  assert.match(rendered.html, /Revisar solicitud/);
  assert.match(rendered.html, /https:\/\/flux\.quantta\.mx\/aprobaciones\.html/);
});

for (const [variant, roles] of [["requester", ["requester"]], ["provider", ["provider"]]]) {
  test(`payment_receipt.linked ${variant} uses the same official logo`, () => {
    const rendered = renderEmail(event("payment_receipt.linked", roles), "real");
    assert.match(rendered.html, new RegExp(LOGO_MARKUP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(rendered.html, />Flux<\/td>/);
  });
}

test("the hotfix does not alter dispatcher, attachment, recipient, or cutoff contracts", async () => {
  const source = await readFile(
    new URL("../../supabase/functions/notification-dispatcher/index.ts", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/<img src="\$\{EMAIL_LOGO_URL\}"/g) || []).length, 1);
  assert.equal((source.match(/\$\{EMAIL_LOGO_HTML\}/g) || []).length, 2);
  assert.equal((source.match(/<td bgcolor="#16322d" style="padding:20px 28px/g) || []).length, 2);
  assert.match(source, /if \(event\.event_type === "payment_receipt\.linked"\) \{[\s\S]*?prepareReceiptAttachment/);
  assert.match(source, /idempotencyKey: `notification\/\$\{event\.id\}`/);
  assert.match(source, /claim_payment_request_created_events_for_dispatcher/);
  assert.match(source, /claim_notification_events_for_dispatcher_v2/);
  assert.match(source, /createdAtAfterExclusive/);
  assert.match(source, /notificationRecipientRoles\(event\)/);
});
