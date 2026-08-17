import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  handleRequest,
  readDispatchOptions,
  renderEmail,
} from "../../supabase/functions/notification-dispatcher/index.ts";

const migrationPath = new URL(
  "../../supabase/migrations/20260817230000_payment_request_approver_email_prod.sql",
  import.meta.url,
);
const dispatcherPath = new URL(
  "../../supabase/functions/notification-dispatcher/index.ts",
  import.meta.url,
);
const recoveryPath = new URL(
  "../../.github/workflows/supabase-prod-payment-request-created-recovery.yml",
  import.meta.url,
);
const migration = readFileSync(migrationPath, "utf8");
const dispatcher = readFileSync(dispatcherPath, "utf8");
const recovery = readFileSync(recoveryPath, "utf8");

function fakeRuntime(environment, fetchFn = async () => {
  throw new Error("unexpected_fetch");
}) {
  return {
    env: (name) => environment[name],
    fetch: fetchFn,
  };
}

function createdEvent() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    event_type: "payment_request.created",
    source_table: "payment_requests",
    source_id: "22222222-2222-4222-8222-222222222222",
    source_folio: "SOL-2026-QA01",
    recipient_type: "administrador_sistema",
    recipient_profile_id: "33333333-3333-4333-8333-333333333333",
    recipient_email: "selected-approver@example.com",
    subject: "Nueva solicitud de pago: SOL-2026-QA01",
    payload: {
      folio: "SOL-2026-QA01",
      company: "Flux QA",
      requester: "Solicitante QA",
      provider: "Proveedor QA",
      amount: 123.45,
      currency: "MXN",
      cost_center: "QA",
      budget_category: "Pruebas",
      path: "/solicitudes.html",
    },
    attempt_count: 0,
    priority: "normal",
  };
}

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, ${startMarker} not found$);
  assert.ok(end > start, ${endMarker} not found after ${startMarker}$);
  return source.slice(start, end);
}

test("new forward migration is fail-closed and never writes activation config", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /payment_request_approver_email_prod_producer_drift/);
  assert.match(migration, /payment_request_approver_email_prod_receipt_claim_drift/);
  assert.match(migration, /payment_request_approver_email_prod_status_constraint_drift/);
  assert.match(migration, /payment_request_approver_email_prod_historical_state_not_pristine/);
  assert.doesNotMatch(migration, /vault\.(?:create_secret|update_secret)/);
  assert.doesNotMatch(migration, /2026-08-17T21:20:56\.735024Z/);
  assert.doesNotMatch(migration, /\b(?:delete|truncate)\s+(?:from\s+)?public\./i);
});

test("producer snapshots only selected approver and emits at most one event", () => {
  const producer = block(
    migration,
    "create or replace function public.enqueue_payment_request_created_notification",
    "alter function public.enqueue_payment_request_created_notification",
  );
  assert.match(producer, /new\.approver_id/);
  assert.match(producer, /where id = new\.approver_id/);
  assert.match(producer, /'payment_request\.created:' \|\| new\.id::text \|\| ':approver'/);
  assert.match(producer, /on conflict \(idempotency_key\) do nothing/);
  assert.doesNotMatch(
    producer,
    /enqueue_payment_request_notification_for_roles|requested_by|approver pool|broadcast|fallback/i,
  );
});

test("recipient_email_missing alone becomes terminal no_recipient", () => {
  const producer = block(
    migration,
    "create or replace function public.enqueue_payment_request_created_notification",
    "alter function public.enqueue_payment_request_created_notification",
  );
  assert.equal((producer.match(/'no_recipient'/g) || []).length, 1);
  assert.match(
    producer,
    /nullif\(btrim\(coalesce\(v_profile\.email, ''\)\), ''\) is null then\s+v_status := 'no_recipient';\s+v_last_error := 'recipient_email_missing';/,
  );
  for (const error of [
    "missing_approver_profile_id",
    "approver_profile_not_found",
    "approver_not_eligible_for_company",
    "created_notification_enqueue_failed",
  ]) {
    const at = producer.indexOf($'${error}'$);
    assert.ok(at >= 0, $${error} missing$);
    assert.match(producer.slice(Math.max(0, at - 240), at + 240), /dead_letter/);
  }
  assert.match(migration, /'no_recipient'::text/);
});

test("exclusive claim proves T-1 and T are ineligible while T+1 is eligible", () => {
  const claim = block(
    migration,
    "create function public.claim_payment_request_created_events_for_dispatcher",
    "alter function public.claim_payment_request_created_events_for_dispatcher",
  );
  assert.match(claim, /event\.event_type = 'payment_request\.created'/);
  assert.match(claim, /event\.created_at > p_created_at_after/);
  assert.doesNotMatch(claim, /event\.created_at\s*>=/);
  assert.doesNotMatch(claim, /payment_receipt\.linked|p_event_types/);
  assert.match(claim, /event\.status in \('pending', 'failed'\)/);
  assert.doesNotMatch(claim, /no_recipient/);
  assert.match(claim, /for update skip locked/i);

  const cutoff = Date.parse("2026-08-17T22:00:00.123Z");
  const eligible = (value) => Date.parse(value) > cutoff;
  assert.equal(eligible("2026-08-17T22:00:00.122Z"), false);
  assert.equal(eligible("2026-08-17T22:00:00.123Z"), false);
  assert.equal(eligible("2026-08-17T22:00:00.124Z"), true);
});

test("wake-up is created-only, requires the authoritative cutoff, and stays inert without C4 config", () => {
  const wakeup = block(
    migration,
    "create function public.notification_payment_request_created_dispatch_wakeup_internal",
    "alter function public.notification_payment_request_created_dispatch_wakeup_internal",
  );
  assert.match(wakeup, /new\.event_type <> 'payment_request\.created'/);
  assert.match(wakeup, /notification_payment_request_created_cutoff_at/);
  assert.match(wakeup, /notification_payment_request_created_immediate_enabled/);
  assert.match(wakeup, /lower\(coalesce\(v_enabled, 'false'\)\) <> 'true'/);
  assert.match(wakeup, /new\.created_at <= v_cutoff_at/);
  assert.match(wakeup, /jsonb_build_array\('payment_request\.created'\)/);
  assert.match(wakeup, /select net\.http_post\(/);
  assert.doesNotMatch(wakeup, /payment_receipt\.linked|api\.resend\.com/);
  assert.match(
    migration,
    /payment_request_approver_email_prod_cutoff_or_activation_created/,
  );
});

test("created renderer is branded, internal, and attachment-free", () => {
  const rendered = renderEmail(createdEvent(), "test_only");
  assert.match(rendered.subject, /^\[DEV TEST\] Nueva solicitud de pago:/);
  assert.match(rendered.text, /Nueva solicitud por revisar/);
  assert.match(rendered.text, /Se generó una solicitud de pago que requiere tu revisión\./);
  assert.match(rendered.text, /https:\/\/flux\.quantta\.mx\/aprobaciones\.html/);
  assert.match(rendered.html, /Flux Operadora/);
  assert.match(rendered.html, /Powered by Quantta/);
  assert.match(rendered.html, />Revisar solicitud</);
  assert.doesNotMatch(
    rendered.text + rendered.html,
    /solicitudes\.html|requester_id|approver_id|UUID|CLABE|cuenta bancaria/i,
  );
});

test("created dispatch preserves microseconds and uses only the strict RPC", async () => {
  const exactCutoff = "2026-08-17T22:00:00.123456Z";
  const calls = [];
  const event = createdEvent();
  const fetchFn = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/rpc/claim_payment_request_created_events_for_dispatcher")) {
      return Response.json([event]);
    }
    if (url === "https://api.resend.com/emails") {
      return Response.json({ id: "resend-created-static-test-id" });
    }
    if (url.endsWith("/rpc/mark_notification_processed_for_dispatcher")) {
      return Response.json({ status: "sent" });
    }
    throw new Error($unexpected_fetch:${url}$);
  };

  const response = await handleRequest(
    new Request("https://dispatcher.test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-notification-dispatcher-secret": "expected",
      },
      body: JSON.stringify({
        event_types: ["payment_request.created"],
        created_at_from: exactCutoff,
        limit: 5,
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
  assert.deepEqual(
    { processed: result.processed, sent: result.sent, failed: result.failed },
    { processed: 1, sent: 1, failed: 0 },
  );

  const claimCall = calls.find((call) =>
    call.url.endsWith("/rpc/claim_payment_request_created_events_for_dispatcher")
  );
  assert.ok(claimCall);
  const claimBody = JSON.parse(claimCall.init.body);
  assert.equal(claimBody.p_created_at_after, exactCutoff);
  assert.equal(claimBody.p_limit, 5);
  assert.equal("p_created_at_from" in claimBody, false);
  assert.equal("p_event_types" in claimBody, false);

  const resendCall = calls.find((call) => call.url === "https://api.resend.com/emails");
  assert.ok(resendCall);
  const resendBody = JSON.parse(resendCall.init.body);
  assert.deepEqual(resendBody.to, ["qa@example.com"]);
  assert.equal("attachments" in resendBody, false);
  assert.equal(resendCall.init.headers["Idempotency-Key"], $notification/${event.id}$);
});

test("created event cannot be mixed with another event type", async () => {
  await assert.rejects(
    readDispatchOptions(
      new Request("https://dispatcher.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event_types: ["payment_request.created", "payment_request.approved"],
          created_at_from: "2026-08-17T22:00:00.123456Z",
        }),
      }),
      fakeRuntime({}),
    ),
    /payment_request_created_dispatch_scope_must_be_exclusive/,
  );
});

test("receipt dispatch retains claim v2 and its normalized inclusive input contract", async () => {
  const exactCutoff = "2026-08-06T20:11:17.823134Z";
  let claimBody;
  const fetchFn = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/rpc/claim_notification_events_for_dispatcher_v2")) {
      claimBody = JSON.parse(init.body);
      return Response.json([]);
    }
    throw new Error($unexpected_fetch:${url}$);
  };

  const response = await handleRequest(
    new Request("https://dispatcher.test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-notification-dispatcher-secret": "expected",
      },
      body: JSON.stringify({
        event_types: ["payment_receipt.linked"],
        created_at_from: exactCutoff,
        limit: 5,
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
  assert.deepEqual(claimBody.p_event_types, ["payment_receipt.linked"]);
  assert.equal(claimBody.p_created_at_from, "2026-08-06T20:11:17.823Z");
  assert.equal("p_created_at_after" in claimBody, false);
});

test("migration never redefines the receipt claim, wake-up, resolver, or trigger", () => {
  assert.doesNotMatch(
    migration,
    /create (?:or replace )?function public\.(?:claim_notification_events_for_dispatcher_v2|notification_receipt_linked_dispatch_wakeup_internal|get_payment_receipt_notification_attachment)/i,
  );
  assert.doesNotMatch(
    migration,
    /(?:drop|create) trigger notification_receipt_linked_immediate_dispatch_after_insert/i,
  );
  assert.match(migration, /payment_receipt_linked_regression_detected/);
});

test("recovery is isolated, disabled by default, and reads the one Vault cutoff", () => {
  assert.match(
    recovery,
    /vars\.NOTIFICATION_PROD_PAYMENT_REQUEST_CREATED_RECOVERY_ENABLED == 'true'/,
  );
  assert.match(recovery, /notification_payment_request_created_cutoff_at/);
  assert.match(recovery, /notification_payment_request_created_dispatcher_url/);
  assert.match(recovery, /EVENT_TYPES_JSON: '\["payment_request\.created"\]'/);
  assert.match(recovery, /DISPATCH_LIMIT: '5'/);
  assert.match(recovery, /recovery_fallback/);
  assert.doesNotMatch(recovery, /payment_receipt\.linked/);
  assert.doesNotMatch(
    recovery,
    /payment_request\.(?:approved|rejected|changes_requested|exception_approved|exception_rejected|extraordinary_authorized)/,
  );
  assert.doesNotMatch(
    recovery,
    /20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/,
  );
});

test("dispatcher source contains no created-event fallback or fan-out", () => {
  assert.match(dispatcher, /claim_payment_request_created_events_for_dispatcher/);
  assert.match(dispatcher, /payment_request_created_dispatch_scope_must_be_exclusive/);
  assert.doesNotMatch(
    dispatcher,
    /payment_request\.created[\s\S]{0,500}(?:approver pool|fallback approver|requester email)/i,
  );
});
