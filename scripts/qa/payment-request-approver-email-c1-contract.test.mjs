import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  handleRequest,
  readDispatchOptions,
  renderEmail,
} from "../../supabase/functions/notification-dispatcher/index.ts";

const migrationPath = new URL("../../supabase/migrations/20260817211201_payment_request_approver_email_c1.sql", import.meta.url);
const dispatcherPath = new URL(
  "../../supabase/functions/notification-dispatcher/index.ts",
  import.meta.url,
);
const schedulerPath = new URL(
  "../../.github/workflows/supabase-dev-notification-dispatcher-scheduler.yml",
  import.meta.url,
);
const migration = readFileSync(migrationPath, "utf8");
const dispatcher = readFileSync(dispatcherPath, "utf8");

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

test("migration defines a created-only claim with a strictly exclusive cutoff", () => {
  const start = migration.indexOf(
    "create or replace function public.claim_payment_request_created_events_for_dispatcher",
  );
  const end = migration.indexOf(
    "revoke all on function public.claim_payment_request_created_events_for_dispatcher",
  );
  assert.ok(start >= 0 && end > start);
  const claim = migration.slice(start, end);
  assert.match(claim, /event\.event_type = 'payment_request\.created'/);
  assert.match(claim, /event\.created_at > p_created_at_after/);
  assert.doesNotMatch(claim, /event\.created_at\s*>=/);
  assert.doesNotMatch(claim, /payment_receipt\.linked|p_event_types/);
  assert.match(claim, /for update skip locked/i);
  assert.match(claim, /event\.status in \('pending', 'failed'\)/);
  assert.match(claim, /event\.recipient_profile_id is not null/);
});

test("migration adds an isolated post-commit wake-up and preserves receipt scope", () => {
  assert.match(
    migration,
    /create trigger notification_payment_request_created_immediate_dispatch_after_insert[\s\S]*after insert on public\.notification_events/i,
  );
  assert.match(migration, /new\.event_type = 'payment_request\.created'/);
  assert.match(migration, /notification_payment_request_created_cutoff_at/);
  assert.match(migration, /notification_payment_request_created_immediate_enabled/);
  assert.match(migration, /'event_types', jsonb_build_array\('payment_request\.created'\)/);
  assert.match(migration, /'created_at_from', v_cutoff/);
  assert.match(migration, /from vault\.decrypted_secrets/);
  assert.match(migration, /select net\.http_post\(/);
  assert.doesNotMatch(
    migration,
    /create or replace function public\.notification_receipt_linked_dispatch_wakeup_internal/,
  );
  assert.doesNotMatch(
    migration,
    /drop trigger if exists notification_receipt_linked_immediate_dispatch_after_insert/,
  );
});

test("created renderer is branded, approver-facing, internal, and attachment-free", () => {
  const rendered = renderEmail(createdEvent(), "test_only");
  assert.match(rendered.subject, /^\[DEV TEST\] Nueva solicitud de pago:/);
  assert.match(rendered.text, /Nueva solicitud por revisar/);
  assert.match(rendered.text, /Se generó una solicitud de pago que requiere tu revisión\./);
  assert.match(rendered.text, /https:\/\/flux\.quantta\.mx\/aprobaciones\.html/);
  assert.match(rendered.html, /Flux Operadora/);
  assert.match(rendered.html, /Powered by Quantta/);
  assert.match(rendered.html, />Revisar solicitud</);
  assert.doesNotMatch(rendered.text + rendered.html, /solicitudes\.html|requester_id|approver_id|UUID/i);
});

test("created dispatch preserves microseconds and uses the exclusive RPC", async () => {
  const exactCutoff = "2026-08-17T21:30:15.123456Z";
  const calls = [];
  const event = createdEvent();
  const fetchFn = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/rpc/claim_payment_request_created_events_for_dispatcher")) {
      return Response.json([event]);
    }
    if (url === "https://api.resend.com/emails") {
      return Response.json({ id: "resend-created-test-id" });
    }
    if (url.endsWith("/rpc/mark_notification_processed_for_dispatcher")) {
      return Response.json({ status: "sent" });
    }
    throw new Error(`unexpected_fetch:${url}`);
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
  assert.equal(result.processed, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);

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
  assert.equal(resendCall.init.headers["Idempotency-Key"], `notification/${event.id}`);
});

test("payment_request.created cannot be mixed with any other event type", async () => {
  const optionsRuntime = fakeRuntime({});
  await assert.rejects(
    readDispatchOptions(
      new Request("https://dispatcher.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event_types: ["payment_request.created", "payment_request.approved"],
          created_at_from: "2026-08-17T21:30:15.123456Z",
        }),
      }),
      optionsRuntime,
    ),
    /payment_request_created_dispatch_scope_must_be_exclusive/,
  );
});

test("receipt routing keeps the legacy v2 claim and normalized cutoff contract", async () => {
  const exactCutoff = "2026-08-06T20:11:17.823134Z";
  let claimBody;
  const fetchFn = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/rpc/claim_notification_events_for_dispatcher_v2")) {
      claimBody = JSON.parse(init.body);
      return Response.json([]);
    }
    throw new Error(`unexpected_fetch:${url}`);
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

test("permanent recovery contract is created-only when present", () => {
  if (!existsSync(schedulerPath)) return;
  const scheduler = readFileSync(schedulerPath, "utf8");
  assert.match(scheduler, /dispatch_payment_request_created:/);
  assert.match(scheduler, /EVENT_TYPES_JSON: '\["payment_request\.created"\]'/);
  assert.match(scheduler, /created_at_from/);
  assert.match(scheduler, /limit/);
  assert.match(scheduler, /recovery_fallback/);
  assert.doesNotMatch(
    scheduler.slice(scheduler.indexOf("dispatch_payment_request_created:")),
    /payment_request\.(?:approved|rejected|changes_requested|exception_approved|exception_rejected|extraordinary_authorized)/,
  );
});

test("dispatcher source contains no created-event fallback or recipient fan-out", () => {
  assert.match(dispatcher, /claim_payment_request_created_events_for_dispatcher/);
  assert.match(dispatcher, /payment_request_created_dispatch_scope_must_be_exclusive/);
  assert.doesNotMatch(
    dispatcher,
    /payment_request\.created[\s\S]{0,500}(?:approver pool|fallback approver|requester email)/i,
  );
});
