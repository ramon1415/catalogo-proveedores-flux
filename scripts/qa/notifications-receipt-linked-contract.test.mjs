import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  handleRequest,
  renderEmail,
  sha256Hex,
  validateAttachmentMetadata,
} from "../../supabase/functions/notification-dispatcher/index.ts";

const migrationPath = new URL(
  "../../supabase/migrations/20260806023116_notifications_receipt_linked.sql",
  import.meta.url,
);
const claimFixMigrationPath = new URL(
  "../../supabase/migrations/20260806030202_notifications_receipt_linked_claim_v2_fix.sql",
  import.meta.url,
);
const immediateDispatchMigrationPath = new URL(
  "../../supabase/migrations/20260806212757_notifications_receipt_linked_immediate_dispatch.sql",
  import.meta.url,
);
const matchTextFixMigrationPath = new URL(
  "../../supabase/migrations/20260806224918_notifications_receipt_match_text_diacritics.sql",
  import.meta.url,
);
const financialSourcePath = new URL(
  "../../supabase/migrations/20260805020001_033_payment_batch_final_reconciliation.sql",
  import.meta.url,
);
const dispatcherPath = new URL(
  "../../supabase/functions/notification-dispatcher/index.ts",
  import.meta.url,
);
const prodSchedulerPath = new URL(
  "../../.github/workflows/supabase-prod-notification-dispatcher.yml",
  import.meta.url,
);
const prodReleasePath = new URL(
  "../../.github/workflows/supabase-prod-notifications-receipt-linked-release.yml",
  import.meta.url,
);
const runbookPath = new URL(
  "../../docs/ops/notifications-receipt-linked-dev-runbook.md",
  import.meta.url,
);
const migration = readFileSync(migrationPath, "utf8");
const claimFixMigration = readFileSync(claimFixMigrationPath, "utf8");
const immediateDispatchMigration = readFileSync(immediateDispatchMigrationPath, "utf8");
const matchTextFixMigration = readFileSync(matchTextFixMigrationPath, "utf8");
const financialSource = readFileSync(financialSourcePath, "utf8");
const dispatcher = readFileSync(dispatcherPath, "utf8");
const prodScheduler = readFileSync(prodSchedulerPath, "utf8");
const prodRelease = readFileSync(prodReleasePath, "utf8");
const runbook = readFileSync(runbookPath, "utf8");

function extractFunction(sql, name) {
  const expression = new RegExp(
    `create(?: or replace)? function public\\.${name}\\(`,
    "i",
  );
  const match = expression.exec(sql);
  assert.ok(match, `${name} definition missing`);
  const end = sql.indexOf("\n$$;", match.index);
  assert.notEqual(end, -1, `${name} terminator missing`);
  return sql.slice(match.index, end + 4);
}

function normalizedFinancialFunction(value) {
  return value
    .replace(/^create or replace function/i, "create function")
    .replace(/\n  v_notification jsonb;/, "")
    .replace(
      /\n  v_notification :=\s*\n?\s*public\.enqueue_payment_receipt_linked_notifications_internal\(v_link_id\);/,
      "",
    )
    .replace(
      /\) \|\| jsonb_build_object\(\s*'notification_resolution',\s*v_notification -> 'notification_resolution'\s*\),/,
      "),",
    )
    .replace(/\s+/g, " ")
    .trim();
}

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

test("migration has one transaction and balanced dollar-quoted blocks", () => {
  assert.equal((migration.match(/^begin;$/gim) || []).length, 1);
  assert.equal((migration.match(/^commit;$/gim) || []).length, 1);
  for (const tag of ["$precheck$", "$postcheck$", "$$"]) {
    assert.equal((migration.split(tag).length - 1) % 2, 0, `${tag} must be balanced`);
  }
  assert.doesNotMatch(migration, /insert into public\.payment_intake|update public\.payment_intake|insert into public\.payment_request_receipt_links\s*select/i);
});

test("financial RPC core, locks, errors, idempotency, and return shape are preserved", () => {
  const before = extractFunction(financialSource, "link_payment_receipt_to_request");
  const after = extractFunction(migration, "link_payment_receipt_to_request");
  assert.equal(normalizedFinancialFunction(after), normalizedFinancialFunction(before));
  assert.match(after, /returns jsonb/i);
  assert.match(after, /security definer/i);
  assert.match(after, /set search_path = public, pg_temp/i);
  assert.equal((after.match(/for update;/gi) || []).length, 4);
  assert.match(after, /payment_reconciliation_command_replay/);
  assert.match(after, /payment_reconciliation_store_command/);
  assert.match(after, /payment_request_receipt_links/);
  assert.match(after, /status = 'paid'/);
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
  assert.match(migration, /payment_requests[\s\S]*requested_by/);
  assert.match(migration, /public\.profiles/);
  assert.match(migration, /public\.proveedores/);
  assert.doesNotMatch(migration, /auth\.users|provider_email text not null/);
});

test("no-recipient is audited in financial outbox without a dead-letter notification", () => {
  assert.match(migration, /'notification_resolution', v_notification -> 'notification_resolution'/);
  assert.doesNotMatch(migration, /insert into public\.notification_events[\s\S]{0,1000}'dead_letter'/i);
  assert.match(migration, /where candidate\.resolution = 'eligible'/);
});

test("recipient constraint adds proveedor while preserving Portal audience only when pre-existing", () => {
  assert.match(migration, /if v_existing_constraint like '%external_provider%'/);
  assert.match(migration, /'external_provider'::text,[\s\S]*'proveedor'::text/);
  assert.match(migration, /else[\s\S]*'administrador_sistema'::text,[\s\S]*'proveedor'::text/);
  const nonPortalBranch = migration.match(/else[\s\S]*?end if;/i)?.[0] || "";
  assert.doesNotMatch(nonPortalBranch, /external_provider/);
});

test("notification idempotency is link-scoped, recipient-fingerprinted, and versioned", () => {
  assert.match(migration, /notification:payment_receipt\.linked:%s:%s:v1/);
  assert.match(migration, /md5\(v_recipient\.email_normalized\)/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/i);
  assert.doesNotMatch(migration, /notification:payment_receipt\.linked:[^']*@/);
});

test("attachment resolver is service-only and verifies the complete 1:1 chain", () => {
  const resolver = extractFunction(migration, "get_payment_receipt_notification_attachment");
  for (const required of [
    "payment_receipt.linked",
    "payment_request_receipt_links",
    "bank_payment_operations",
    "payment_operation_evidence",
    "payment-batch-documents",
    "application/pdf",
    "page_count is distinct from 1",
    "single_operation_attested",
    "individual_sha256",
    "file_size_bytes",
  ]) assert.ok(resolver.includes(required), required);
  assert.match(migration, /grant execute on function public\.get_payment_receipt_notification_attachment\(uuid\)\s+to service_role, postgres/i);
  assert.match(migration, /revoke all on function public\.get_payment_receipt_notification_attachment\(uuid\)\s+from public, anon, authenticated, service_role/i);
});

test("claim v2 requires explicit allowlist and cutoff and retains SKIP LOCKED/max attempts", () => {
  const claim = extractFunction(migration, "claim_notification_events_for_dispatcher_v2");
  assert.match(claim, /notification_dispatcher_event_types_required/);
  assert.match(claim, /notification_dispatcher_cutoff_required/);
  assert.match(claim, /event\.created_at >= p_created_at_from/);
  assert.match(claim, /event\.attempt_count < event\.max_attempts/);
  assert.match(claim, /for update skip locked/);
  assert.match(claim, /event\.status in \('pending', 'failed'\)/);
});

test("claim v2 corrective migration removes the PL/pgSQL event_type ambiguity", () => {
  assert.equal((claimFixMigration.match(/^begin;$/gim) || []).length, 1);
  assert.equal((claimFixMigration.match(/^commit;$/gim) || []).length, 1);
  const claim = extractFunction(
    claimFixMigration,
    "claim_notification_events_for_dispatcher_v2",
  );
  assert.match(claim, /btrim\(requested\.event_type\)/);
  assert.match(claim, /coalesce\(requested\.event_type, ''\)/);
  assert.doesNotMatch(
    claim,
    /array_agg\(distinct btrim\(event_type\) order by btrim\(event_type\)\)/,
  );
  assert.match(claim, /event\.event_type = any\(v_event_types\)/);
  assert.match(claim, /event\.created_at >= p_created_at_from/);
  assert.match(claim, /for update skip locked/);
  assert.doesNotMatch(
    claimFixMigration,
    /insert into public\.|delete from public\.|update public\.(?!notification_events)/i,
  );
});

test("payment receipt matcher folds Latin diacritics without widening data or ACL scope", () => {
  assert.equal((matchTextFixMigration.match(/^begin;/gim) || []).length, 1);
  assert.equal((matchTextFixMigration.match(/^commit;/gim) || []).length, 1);
  assert.match(
    matchTextFixMigration,
    /create or replace function public\.payment_receipt_normalize_match_text\(\s*p_value text\s*\)/i,
  );
  assert.match(matchTextFixMigration, /returns text\s+language sql\s+immutable\s+security invoker/i);
  assert.match(matchTextFixMigration, /set search_path to 'public', 'pg_temp'/i);
  assert.match(
    matchTextFixMigration,
    /translate\(\s*lower\(coalesce\(p_value, ''\)\),\s*'áàäâãåéèëêíìïîóòöôõúùüûñç',\s*'aaaaaaeeeeiiiiooooouuuunc'/i,
  );
  assert.match(matchTextFixMigration, /'\[\^\[:alnum:\]\]'/i);
  assert.match(matchTextFixMigration, /'serviciosdemostracionflux'/i);
  assert.doesNotMatch(matchTextFixMigration, /\bunaccent\s*\(/i);
  assert.doesNotMatch(matchTextFixMigration, /security definer/i);
  assert.match(
    matchTextFixMigration,
    /revoke all on function public\.payment_receipt_normalize_match_text\(text\)\s+from public, anon, authenticated/i,
  );
  assert.match(
    matchTextFixMigration,
    /grant execute on function public\.payment_receipt_normalize_match_text\(text\)\s+to service_role/i,
  );
  assert.doesNotMatch(
    matchTextFixMigration,
    /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:payment_requests|bank_payment_operations|proveedores|payment_request_receipt_links)\b/i,
  );
  assert.doesNotMatch(matchTextFixMigration, /link_payment_receipt_to_request\s*\(/i);
});

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
    assert.match(rendered.html, /Flux Operadora ? Powered by Quantta/);
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

test("test_only claims after cutoff, validates PDF hash, attaches in memory, and redirects recipient", async () => {
  const event = receiptEvent(["requester", "provider"]);
  const pdfBytes = new TextEncoder().encode("%PDF-1.4\nreceipt-test\n%%EOF");
  const pdfHash = await sha256Hex(pdfBytes);
  const calls = [];
  const fetchFn = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
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
  assert.deepEqual(resendBody.to, ["qa@example.com"]);
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

test("immediate dispatch is a post-commit pg_net wake-up over the existing ledger", () => {
  const wakeupFunction = extractFunction(
    immediateDispatchMigration,
    "notification_receipt_linked_dispatch_wakeup_internal",
  );
  assert.equal((immediateDispatchMigration.match(/^begin;$/gim) || []).length, 1);
  assert.equal((immediateDispatchMigration.match(/^commit;$/gim) || []).length, 1);
  assert.match(immediateDispatchMigration, /create extension if not exists pg_net\s+with schema extensions/i);
  assert.match(
    immediateDispatchMigration,
    /create trigger notification_receipt_linked_immediate_dispatch_after_insert\s+after insert on public\.notification_events/i,
  );
  assert.match(immediateDispatchMigration, /new\.event_type = 'payment_receipt\.linked'/);
  assert.match(immediateDispatchMigration, /new\.status = 'pending'/);
  assert.match(immediateDispatchMigration, /notification_receipt_linked_immediate_enabled/);
  assert.match(immediateDispatchMigration, /notification_dispatcher_url/);
  assert.match(immediateDispatchMigration, /notification_dispatcher_secret/);
  assert.match(immediateDispatchMigration, /notification_dispatcher_cutoff_at/);
  assert.match(immediateDispatchMigration, /from vault\.decrypted_secrets/);
  assert.match(immediateDispatchMigration, /select net\.http_post\(/);
  assert.match(
    immediateDispatchMigration,
    /'event_types', jsonb_build_array\('payment_receipt\.linked'\)/,
  );
  assert.match(immediateDispatchMigration, /'created_at_from', v_cutoff/);
  assert.match(immediateDispatchMigration, /'limit', 5/);
  assert.match(immediateDispatchMigration, /'x-notification-dispatcher-secret', v_secret/);
  assert.match(immediateDispatchMigration, /timeout_milliseconds := 2000/);
  assert.match(
    wakeupFunction,
    /begin\s+select[\s\S]*from vault\.decrypted_secrets[\s\S]*select net\.http_post\([\s\S]*exception when others then/i,
  );
  assert.match(immediateDispatchMigration, /exception when others then[\s\S]*return new;/i);
  assert.match(immediateDispatchMigration, /revoke all on function[\s\S]*from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(wakeupFunction, /api\.resend\.com|insert into public\.notification_events/i);
  assert.doesNotMatch(immediateDispatchMigration, /created_at_from'\s*,\s*(?:now|clock_timestamp)\(/i);
  assert.doesNotMatch(immediateDispatchMigration, /SUPABASE_SERVICE_ROLE_KEY|sb_secret_|eyJ[A-Za-z0-9_-]{20,}/);
});

test("primary/fallback race claims one event and sends at most once", async () => {
  const event = receiptEvent(["requester"]);
  const pdfBytes = new TextEncoder().encode("%PDF-1.4\nrace-test\n%%EOF");
  const pdfHash = await sha256Hex(pdfBytes);
  let claimed = false;
  let resendCalls = 0;
  let processedMarks = 0;

  const fetchFn = async (input) => {
    const url = String(input);
    if (url.endsWith("/rpc/claim_notification_events_for_dispatcher_v2")) {
      if (claimed) return Response.json([]);
      claimed = true;
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
    if (url === "https://api.resend.com/emails") {
      resendCalls += 1;
      return Response.json({ id: "race-message-id" });
    }
    if (url.endsWith("/rpc/mark_notification_processed_for_dispatcher")) {
      processedMarks += 1;
      return Response.json({ status: "sent" });
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  const environment = {
    NOTIFICATION_DISPATCHER_SECRET: "expected",
    NOTIFICATION_SEND_MODE: "test_only",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    RESEND_API_KEY: "resend",
    NOTIFICATION_FROM_EMAIL: "Flux <notifications@example.com>",
    NOTIFICATION_TEST_EMAIL: "qa@example.com",
  };
  const makeRequest = () => new Request("https://dispatcher.test", {
    method: "POST",
    headers: {
      "x-notification-dispatcher-secret": "expected",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      event_types: ["payment_receipt.linked"],
      created_at_from: "2026-08-05T20:00:00.000Z",
      limit: 5,
    }),
  });

  const responses = await Promise.all([
    handleRequest(makeRequest(), fakeRuntime(environment, fetchFn)),
    handleRequest(makeRequest(), fakeRuntime(environment, fetchFn)),
  ]);
  const results = await Promise.all(responses.map((response) => response.json()));

  assert.equal(results.reduce((sum, result) => sum + result.sent, 0), 1);
  assert.equal(resendCalls, 1);
  assert.equal(processedMarks, 1);
  assert.match(claimFixMigration, /for update skip locked/i);
  assert.match(dispatcher, /idempotencyKey: `notification\/\$\{event\.id\}`/);
});


test("PROD scheduler is permanent, fixed-cutoff, receipt-only, serial, and separately gated", () => {
  assert.match(prodScheduler, /schedule:\s*\n\s*- cron: '3-58\/5 \* \* \* \*'/);
  assert.match(prodScheduler, /workflow_dispatch:/);
  assert.match(prodScheduler, /github\.ref == 'refs\/heads\/main'/);
  assert.match(prodScheduler, /vars\.NOTIFICATION_PROD_SCHEDULER_ENABLED == 'true'/);
  assert.match(prodScheduler, /environment: supabase-production/);
  assert.match(prodScheduler, /cancel-in-progress: false/);
  assert.match(prodScheduler, /permissions:\s*\n\s*contents: read/);
  assert.match(prodScheduler, /PROD_CUTOFF: '2026-08-06T20:11:17\.823134Z'/);
  assert.match(prodScheduler, /EVENT_TYPES_JSON: '\["payment_receipt\.linked"\]'/);
  assert.match(prodScheduler, /DISPATCH_ROLE: recovery_fallback/);
  assert.match(prodScheduler, /dispatch_role=recovery_fallback/);
  assert.match(
    prodScheduler,
    /"event_types":\["payment_receipt\.linked"\],"created_at_from":"2026-08-06T20:11:17\.823134Z","limit":5/,
  );
  assert.equal((prodScheduler.match(/curl --silent/g) || []).length, 1);
  assert.doesNotMatch(prodScheduler, /claim_notification_events_for_dispatcher\(/);
  assert.doesNotMatch(prodScheduler, /upload-artifact|pull_request:|\npush:/);
  assert.doesNotMatch(prodScheduler, /NOTIFICATION_SEND_MODE=(?:real|test_only)/);
});

test("PROD Phase A package is main-only, disabled-first, and exact-four-migration", () => {
  assert.match(prodRelease, /workflow_dispatch:/);
  assert.doesNotMatch(prodRelease, /\nschedule:|pull_request:|\npush:/);
  assert.match(prodRelease, /github\.ref == 'refs\/heads\/main'/);
  assert.match(prodRelease, /environment: supabase-production/);
  assert.match(prodRelease, /receipt_linked_phase_a_disabled/);
  assert.match(prodRelease, /SCHEDULER_ENABLED: \$\{\{ vars\.NOTIFICATION_PROD_SCHEDULER_ENABLED \}\}/);
  assert.match(prodRelease, /NOTIFICATION_SEND_MODE=disabled/);
  assert.doesNotMatch(prodRelease, /NOTIFICATION_SEND_MODE=(?:real|test_only)/);
  assert.match(prodRelease, /NOTIFICATION_EVENT_TYPES=payment_receipt\.linked/);
  assert.match(prodRelease, /NOTIFICATION_CUTOFF_AT=2026-08-06T20:11:17\.823134Z/);
  assert.match(prodRelease, /NOTIFICATION_WORKER_ID=edge-notification-dispatcher-prod/);
  assert.match(
    prodRelease,
    /PRIMARY_MIGRATION: supabase\/migrations\/20260806023116_notifications_receipt_linked\.sql/,
  );
  assert.match(
    prodRelease,
    /CORRECTIVE_MIGRATION: supabase\/migrations\/20260806030202_notifications_receipt_linked_claim_v2_fix\.sql/,
  );
  assert.match(
    prodRelease,
    /WAKEUP_MIGRATION: supabase\/migrations\/20260806212757_notifications_receipt_linked_immediate_dispatch\.sql/,
  );
  assert.match(
    prodRelease,
    /NORMALIZATION_FIX_MIGRATION: supabase\/migrations\/20260806224918_notifications_receipt_match_text_diacritics\.sql/,
  );
  assert.ok(
    prodRelease.indexOf("20260806023116_notifications_receipt_linked.sql")
      < prodRelease.indexOf("20260806030202_notifications_receipt_linked_claim_v2_fix.sql"),
  );
  assert.ok(
    prodRelease.indexOf("20260806030202_notifications_receipt_linked_claim_v2_fix.sql")
      < prodRelease.indexOf("20260806212757_notifications_receipt_linked_immediate_dispatch.sql"),
  );
  assert.ok(
    prodRelease.indexOf("20260806212757_notifications_receipt_linked_immediate_dispatch.sql")
      < prodRelease.indexOf("20260806224918_notifications_receipt_match_text_diacritics.sql"),
  );
  assert.match(prodRelease, /migration_allowlist=exact_four/);
  assert.match(
    prodRelease,
    /migration_order=primary_then_corrective_then_wakeup_then_normalization_fix/,
  );
  assert.match(prodRelease, /notification_receipt_linked_immediate_enabled/);
  assert.match(prodRelease, /wakeup_enabled=false/);
  assert.match(prodRelease, /vault\.create_secret/);
  assert.match(prodRelease, /vault\.update_secret/);
  assert.match(
    prodRelease,
    /supabase functions deploy notification-dispatcher[\s\S]*--no-verify-jwt[\s\S]*--use-api/,
  );
  assert.equal((prodRelease.match(/supabase functions deploy/g) || []).length, 1);
  assert.doesNotMatch(prodRelease, /functions deploy provider-intake/);
  assert.match(prodRelease, /--dry-run/);
  assert.match(prodRelease, /--include-all/);
  assert.match(prodRelease, /phase_b=blocked/);
  assert.match(prodRelease, /unauthenticated_status=401/);
  assert.match(prodRelease, /authenticated_status=200/);
  assert.match(prodRelease, /processed=0 sent=0 failed=0/);
  assert.match(prodRelease, /resend_calls=0/);
  assert.match(prodRelease, /emails=0/);
  assert.doesNotMatch(prodRelease, /upload-artifact/);
});

test("PROD secret contract names are complete and values are never embedded", () => {
  for (const name of [
    "NOTIFICATION_DISPATCHER_SECRET",
    "NOTIFICATION_SEND_MODE",
    "RESEND_API_KEY",
    "NOTIFICATION_FROM_EMAIL",
    "NOTIFICATION_EVENT_TYPES",
    "NOTIFICATION_CUTOFF_AT",
    "NOTIFICATION_WORKER_ID",
  ]) {
    assert.match(prodRelease, new RegExp(name));
  }
  assert.doesNotMatch(prodRelease, /re_[A-Za-z0-9]{20,}|sbp_[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(prodScheduler, /re_[A-Za-z0-9]{20,}|sbp_[A-Za-z0-9]{20,}/);
});

test("release runbook defines fixed cutoff, disabled smoke, and append-only rollback", () => {
  for (const marker of [
    "2026-08-06T20:11:17.823134Z",
    "NOTIFICATION_SEND_MODE=disabled",
    "payment_receipt.linked",
    "processed=0",
    "sent=0",
    "failed=0",
    "No revertir pagos ni receipt links",
    "No borrar notification_events",
    "No borrar delivery_attempts",
    "No hacer replay",
    "Forward-fix",
  ]) {
    assert.ok(runbook.includes(marker), marker);
  }
});
