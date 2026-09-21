import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  handleRequest,
  renderEmail,
  sha256Hex,
  validateAttachmentMetadata,
} from "../../supabase/functions/notification-dispatcher/index.ts";
const dispatcherPath = new URL(
  "../../supabase/functions/notification-dispatcher/index.ts",
  import.meta.url,
);
const dispatcher = readFileSync(dispatcherPath, "utf8");

function emailState(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return { normalized, state: "missing" };
  return {
    normalized,
    state: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? "eligible" : "invalid",
  };
}

function recipientResolution(requester, provider) {
  const requesterResult = emailState(requester);
  const providerResult = emailState(provider);
  const unique = new Set(
    [requesterResult, providerResult]
      .filter((candidate) => candidate.state === "eligible")
      .map((candidate) => candidate.normalized),
  );
  return {
    requester: requesterResult.state,
    provider: providerResult.state,
    unique_recipient_count: unique.size,
  };
}

function fakeRuntime(environment, fetchFn = async () => {
  throw new Error("unexpected_fetch");
}) {
  return {
    env: (name) => environment[name],
    fetch: fetchFn,
  };
}

function receiptEvent(recipientRoles = ["requester"]) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    event_type: "payment_receipt.linked",
    source_table: "payment_request_receipt_links",
    source_id: "22222222-2222-4222-8222-222222222222",
    source_folio: "SOL-2026-0001",
    recipient_type: recipientRoles.includes("requester") ? "usuario_solicitante" : "proveedor",
    recipient_profile_id: recipientRoles.includes("requester")
      ? "33333333-3333-4333-8333-333333333333"
      : null,
    recipient_email: "real@example.com",
    subject: null,
    payload: {
      recipient_roles: recipientRoles,
      folio: "SOL-2026-0001",
      provider: "Proveedor Uno",
      company: "Flux Operadora",
      concept: "Servicios",
      amount: "1234.50",
      currency: "MXN",
      payment_date: "2026-08-05",
      reference_hint: "ABC123",
      status: "paid",
    },
    attempt_count: 0,
    priority: "normal",
  };
}

test("requester and provider templates keep their audience boundaries", () => {
  const requester = renderEmail(receiptEvent(["requester"]), "test_only");
  assert.match(requester.subject, /^\[DEV TEST\] Comprobante de pago disponible/);
  assert.match(requester.text, /Proveedor: Proveedor Uno/);
  assert.match(requester.text, /https:\/\/flux\.quantta\.mx\/solicitudes\.html/);

  const provider = renderEmail(receiptEvent(["provider"]), "real");
  assert.match(provider.subject, /^Comprobante de pago —/);
  assert.doesNotMatch(provider.text, /flux\.quantta\.mx|Solicitante|Centro de costo|Partida|Storage|CLABE/i);
  assert.doesNotMatch(provider.html, /flux\.quantta\.mx|Solicitante|Centro de costo|Partida|Storage|CLABE/i);

  const combined = renderEmail(receiptEvent(["requester", "provider"]), "real");
  assert.match(combined.text, /https:\/\/flux\.quantta\.mx\/solicitudes\.html/);
});

test("receipt-linked HTML matches the branded email-card contract", () => {
  const requester = renderEmail(receiptEvent(["requester"]), "test_only");
  const provider = renderEmail(receiptEvent(["provider"]), "real");

  for (const rendered of [requester, provider]) {
    assert.match(rendered.html, /role="presentation"/);
    assert.match(rendered.html, /max-width:560px/);
    assert.match(rendered.html, /border-radius:14px/);
    assert.match(rendered.html, /background:#16322d/);
    assert.match(rendered.html, />Flux<\/td>/);
    assert.match(rendered.html, /Flux Operadora &middot; Powered by Quantta/);
  }

  assert.match(provider.html, /Empresa pagadora/);
  assert.doesNotMatch(provider.html, /Modo DEV TEST|Abrir solicitud en Flux/);
  assert.match(requester.html, /Modo DEV TEST: este correo fue redirigido al destinatario de prueba\./);
  assert.match(requester.html, /border-left:4px solid #d97706/);
  assert.match(requester.html, /Abrir solicitud en Flux/);
});

test("HTML content is escaped", () => {
  const event = receiptEvent(["provider"]);
  event.payload.company = "<script>alert(1)</script>";
  const rendered = renderEmail(event, "real");
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /&lt;script&gt;/);
});

test("attachment metadata rejects foreign bucket, MIME, size, hash, and unsafe filename", () => {
  const valid = {
    bucket: "payment-batch-documents",
    path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/evidence/33333333-3333-4333-8333-333333333333.pdf",
    mime_type: "application/pdf",
    size_bytes: 512,
    sha256: "a".repeat(64),
    filename: "Comprobante_SOL-2026-0001_Proveedor-Uno.pdf",
  };
  assert.doesNotThrow(() => validateAttachmentMetadata(valid));
  for (const invalid of [
    { ...valid, bucket: "batch-pdfs" },
    { ...valid, mime_type: "text/plain" },
    { ...valid, size_bytes: 26_214_401 },
    { ...valid, sha256: "bad" },
    { ...valid, filename: "../../batch.pdf" },
  ]) assert.throws(() => validateAttachmentMetadata(invalid));
});

test("dispatcher fails closed for method, secret, disabled mode, and missing cutoff", async () => {
  const method = await handleRequest(new Request("https://dispatcher.test", { method: "GET" }), fakeRuntime({}));
  assert.equal(method.status, 405);

  const unauthorized = await handleRequest(
    new Request("https://dispatcher.test", { method: "POST" }),
    fakeRuntime({ NOTIFICATION_DISPATCHER_SECRET: "expected" }),
  );
  assert.equal(unauthorized.status, 401);

  let disabledFetches = 0;
  const disabled = await handleRequest(
    new Request("https://dispatcher.test", {
      method: "POST",
      headers: { "x-notification-dispatcher-secret": "expected" },
    }),
    fakeRuntime({
      NOTIFICATION_DISPATCHER_SECRET: "expected",
      NOTIFICATION_SEND_MODE: "disabled",
    }, async () => {
      disabledFetches += 1;
      throw new Error("unexpected_fetch");
    }),
  );
  assert.equal(disabled.status, 200);
  assert.equal(disabledFetches, 0);

  const missingCutoff = await handleRequest(
    new Request("https://dispatcher.test", {
      method: "POST",
      headers: {
        "x-notification-dispatcher-secret": "expected",
        "content-type": "application/json",
      },
      body: JSON.stringify({ event_types: ["payment_receipt.linked"] }),
    }),
    fakeRuntime({
      NOTIFICATION_DISPATCHER_SECRET: "expected",
      NOTIFICATION_SEND_MODE: "test_only",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      RESEND_API_KEY: "resend",
      NOTIFICATION_FROM_EMAIL: "Flux <notifications@example.com>",
      NOTIFICATION_TEST_EMAIL: "qa@example.com",
    }),
  );
  assert.equal(missingCutoff.status, 500);
  assert.match(await missingCutoff.text(), /notification_cutoff_required/);
});

test("test_only claims after cutoff, authorizes the business recipient, and attaches a verified PDF", async () => {
  const event = receiptEvent(["requester", "provider"]);
  const pdfBytes = new TextEncoder().encode("%PDF-1.4\nreceipt-test\n%%EOF");
  const pdfHash = await sha256Hex(pdfBytes);
  const calls = [];
  const fetchFn = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/rpc/notification_dev_business_recipient_authorized")) return Response.json(true);
    if (url.endsWith("/rpc/claim_notification_events_for_dispatcher_v2")) {
      return Response.json([event]);
    }
    if (url.endsWith("/rpc/get_payment_receipt_notification_attachment")) {
      return Response.json({
        bucket: "payment-batch-documents",
        path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/evidence/33333333-3333-4333-8333-333333333333.pdf",
        mime_type: "application/pdf",
        size_bytes: pdfBytes.length,
        sha256: pdfHash,
        filename: "Comprobante_SOL-2026-0001_Proveedor-Uno.pdf",
      });
    }
    if (url.includes("/storage/v1/object/authenticated/")) {
      return new Response(pdfBytes, { headers: { "content-type": "application/pdf" } });
    }
    if (url === "https://api.resend.com/emails") return Response.json({ id: "resend-message-id" });
    if (url.endsWith("/rpc/mark_notification_processed_for_dispatcher")) return Response.json({ status: "sent" });
    throw new Error(`unexpected_fetch:${url}`);
  };
  const response = await handleRequest(
    new Request("https://dispatcher.test", {
      method: "POST",
      headers: {
        "x-notification-dispatcher-secret": "expected",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        limit: 1,
        event_types: ["payment_receipt.linked"],
        created_at_from: "2026-08-05T20:00:00.000Z",
      }),
    }),
    fakeRuntime({
      NOTIFICATION_DISPATCHER_SECRET: "expected",
      NOTIFICATION_SEND_MODE: "test_only",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      RESEND_API_KEY: "resend",
      NOTIFICATION_FROM_EMAIL: "Flux <notifications@example.com>",
      NOTIFICATION_TEST_EMAIL: "qa@example.com",
    }, fetchFn),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.sent, 1);
  assert.equal(result.events[0].attachment_sha256, pdfHash);
  const claimCall = calls.find((call) => call.url.endsWith("/rpc/claim_notification_events_for_dispatcher_v2"));
  assert.deepEqual(JSON.parse(claimCall.init.body).p_event_types, ["payment_receipt.linked"]);
  assert.equal(JSON.parse(claimCall.init.body).p_created_at_from, "2026-08-05T20:00:00.000Z");
  const resendCall = calls.find((call) => call.url === "https://api.resend.com/emails");
  const resendBody = JSON.parse(resendCall.init.body);
  assert.deepEqual(resendBody.to, [event.recipient_email]);
  assert.ok(calls.some(call => call.url.endsWith("/rpc/notification_dev_business_recipient_authorized")));
  assert.equal(resendBody.attachments.length, 1);
  assert.ok(resendBody.attachments[0].content.length > pdfBytes.length);
  assert.equal(resendCall.init.headers["Idempotency-Key"], `notification/${event.id}`);
  assert.doesNotMatch(JSON.stringify(result), /storage\/v1|payment-batch-documents|evidence\//);
});

test("hash mismatch fails before Resend and records a failed delivery", async () => {
  const event = receiptEvent(["provider"]);
  const pdfBytes = new TextEncoder().encode("%PDF-1.4\nwrong-hash\n%%EOF");
  let resendCalls = 0;
  let failedMarks = 0;
  const fetchFn = async (input) => {
    const url = String(input);
    if (url.endsWith("/rpc/notification_dev_business_recipient_authorized")) return Response.json(true);
    if (url.endsWith("/rpc/claim_notification_events_for_dispatcher_v2")) return Response.json([event]);
    if (url.endsWith("/rpc/get_payment_receipt_notification_attachment")) {
      return Response.json({
        bucket: "payment-batch-documents",
        path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/evidence/33333333-3333-4333-8333-333333333333.pdf",
        mime_type: "application/pdf",
        size_bytes: pdfBytes.length,
        sha256: "a".repeat(64),
        filename: "Comprobante_SOL-2026-0001_Proveedor-Uno.pdf",
      });
    }
    if (url.includes("/storage/v1/object/authenticated/")) {
      return new Response(pdfBytes, { headers: { "content-type": "application/pdf" } });
    }
    if (url === "https://api.resend.com/emails") {
      resendCalls += 1;
      return Response.json({ id: "should-not-send" });
    }
    if (url.endsWith("/rpc/mark_notification_failed_for_dispatcher")) {
      failedMarks += 1;
      return Response.json({ status: "failed" });
    }
    throw new Error(`unexpected_fetch:${url}`);
  };
  const response = await handleRequest(
    new Request("https://dispatcher.test", {
      method: "POST",
      headers: {
        "x-notification-dispatcher-secret": "expected",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        event_types: ["payment_receipt.linked"],
        created_at_from: "2026-08-05T20:00:00.000Z",
      }),
    }),
    fakeRuntime({
      NOTIFICATION_DISPATCHER_SECRET: "expected",
      NOTIFICATION_SEND_MODE: "test_only",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      RESEND_API_KEY: "resend",
      NOTIFICATION_FROM_EMAIL: "Flux <notifications@example.com>",
      NOTIFICATION_TEST_EMAIL: "qa@example.com",
    }, fetchFn),
  );
  const result = await response.json();
  assert.equal(result.failed, 1);
  assert.equal(resendCalls, 0);
  assert.equal(failedMarks, 1);
  assert.match(result.events[0].error, /attachment_hash_mismatch/);
});

test("dispatcher has no wildcard CORS and Resend retries use a stable idempotency header", () => {
  assert.doesNotMatch(dispatcher, /Access-Control-Allow-Origin|corsHeaders/);
  assert.match(dispatcher, /"Idempotency-Key": params\.idempotencyKey/);
  assert.match(dispatcher, /idempotencyKey: `notification\/\$\{event\.id\}`/);
  assert.match(dispatcher, /send_succeeded_but_mark_processed_failed/);
});

test("recipient resolution covers distinct, deduplicated, partial, missing, and invalid cases", () => {
  assert.deepEqual(recipientResolution("a@example.com", "b@example.com"), {
    requester: "eligible",
    provider: "eligible",
    unique_recipient_count: 2,
  });
  assert.deepEqual(recipientResolution(" Same@Example.com ", "same@example.com"), {
    requester: "eligible",
    provider: "eligible",
    unique_recipient_count: 1,
  });
  assert.deepEqual(recipientResolution("a@example.com", ""), {
    requester: "eligible",
    provider: "missing",
    unique_recipient_count: 1,
  });
  assert.deepEqual(recipientResolution("", "b@example.com"), {
    requester: "missing",
    provider: "eligible",
    unique_recipient_count: 1,
  });
  assert.deepEqual(recipientResolution("bad", "also-bad"), {
    requester: "invalid",
    provider: "invalid",
    unique_recipient_count: 0,
  });
});
