import {
  canonicalInvocation,
  hmacSha256Hex,
  sha256Hex,
  verifyInvocation,
} from "./auth.ts";
import {
  classifyProviderFailure,
  createExternalDispatcherHandler,
  type ExternalRepository,
  parseDispatcherBody,
  resendRequestInit,
  type SendInput,
} from "./index.ts";
import { FIELD_LABELS, renderExternalEmail } from "./renderer.ts";

function assert(
  condition: unknown,
  message = "assertion_failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
    );
  }
}

const now = Date.parse("2026-07-31T12:00:00.000Z");
const timestamp = String(now / 1000);
const invocationId = "123e4567-e89b-42d3-a456-426614174000";
const keyId = "external-test-key";
const key = "synthetic-hmac-key-never-a-secret";
const pathname = "/functions/v1/notification-dispatcher-external";

async function signedHeaders(
  rawBody = '{"limit":1}',
  method = "POST",
): Promise<Headers> {
  const requestHash = await sha256Hex(rawBody);
  const signature = await hmacSha256Hex(
    key,
    canonicalInvocation(method, pathname, timestamp, invocationId, requestHash),
  );
  return new Headers({
    "Content-Type": "application/json",
    "x-flux-key-id": keyId,
    "x-flux-timestamp": timestamp,
    "x-flux-invocation-id": invocationId,
    "x-flux-signature": signature,
  });
}

Deno.test("HMAC canonicalization and constant-time verification accept valid material", async () => {
  const rawBody = '{"limit":1}';
  const verified = await verifyInvocation({
    method: "POST",
    pathname,
    rawBody,
    headers: await signedHeaders(rawBody),
    expectedKeyId: keyId,
    key,
    nowMs: now,
  });
  assertEquals(verified?.invocationId, invocationId);
  assertEquals(verified?.requestHash, await sha256Hex(rawBody));
});

Deno.test("HMAC rejects modified body, unknown key, malformed signature and stale timestamp", async () => {
  const valid = await signedHeaders();
  for (
    const input of [
      {
        rawBody: '{"limit":2}',
        headers: valid,
        expectedKeyId: keyId,
        nowMs: now,
      },
      {
        rawBody: '{"limit":1}',
        headers: valid,
        expectedKeyId: "other-key",
        nowMs: now,
      },
      {
        rawBody: '{"limit":1}',
        headers: new Headers({
          ...Object.fromEntries(valid),
          "x-flux-signature": "00",
        }),
        expectedKeyId: keyId,
        nowMs: now,
      },
      {
        rawBody: '{"limit":1}',
        headers: valid,
        expectedKeyId: keyId,
        nowMs: now + 301_000,
      },
    ]
  ) {
    assertEquals(
      await verifyInvocation({
        method: "POST",
        pathname,
        key,
        ...input,
      }),
      null,
    );
  }
});

Deno.test("closed parser allows only the fixed one-event body", () => {
  assert(parseDispatcherBody('{"limit":1}'));
  for (
    const body of [
      "{}",
      '{"limit":2}',
      '{"limit":1,"lane":"external"}',
      "not-json",
    ]
  ) {
    assert(!parseDispatcherBody(body), body);
  }
});

const receivedPayload = {
  event_version: 1,
  template_version: 1,
  locale: "es-MX",
  public_folio: "INT-2026-000001",
  occurred_on: "2026-07-31",
};

Deno.test("renderer produces the exact received, rejected and correction contracts", () => {
  assertEquals(
    renderExternalEmail("provider_intake.received", receivedPayload).text,
    "Recibimos tu solicitud INT-2026-000001 el 2026-07-31.\nNuestro equipo la revisará y te informará si necesitamos información adicional.\n\nEste correo es informativo y no contiene enlaces.",
  );
  assertEquals(
    renderExternalEmail("provider_intake.rejected", {
      ...receivedPayload,
      external_message: "No fue posible validar la documentación presentada.",
    }).subject,
    "Resultado de tu solicitud — INT-2026-000001",
  );
  const correction = renderExternalEmail(
    "provider_intake.correction_requested",
    {
      ...receivedPayload,
      external_message: "Por favor revisa los documentos indicados.",
      field_codes: ["invoice_pdf", "provider_email"],
    },
  );
  assert(correction.text.includes("Campos por revisar:"));
  assert(correction.text.includes(FIELD_LABELS.invoice_pdf));
  assert(correction.text.includes(FIELD_LABELS.provider_email));
  assert(!correction.text.includes("http"));
});

Deno.test("renderer fails closed on unknown events, keys, codes, links and user HTML", () => {
  const invalid = [
    ["provider_matched", receivedPayload],
    ["provider_intake.received", { ...receivedPayload, company: "internal" }],
    ["provider_intake.rejected", {
      ...receivedPayload,
      external_message: "Consulta https://example.invalid",
    }],
    ["provider_intake.rejected", {
      ...receivedPayload,
      external_message: "Mensaje <b>no permitido</b>",
    }],
    ["provider_intake.rejected", {
      ...receivedPayload,
      external_message: "Escribe a finanzas@example.invalid para continuar.",
    }],
    ["provider_intake.rejected", {
      ...receivedPayload,
      external_message: "El matching interno no fue suficiente.",
    }],
    ["provider_intake.correction_requested", {
      ...receivedPayload,
      external_message: "Corrige el documento indicado.",
      field_codes: ["matching"],
    }],
  ] as const;
  for (const [eventType, payload] of invalid) {
    let failed = false;
    try {
      renderExternalEmail(eventType, payload as Record<string, unknown>);
    } catch {
      failed = true;
    }
    assert(failed, eventType);
  }
  const escaped = renderExternalEmail("provider_intake.rejected", {
    ...receivedPayload,
    external_message: "Revisa términos & condiciones declarados.",
  });
  assert(escaped.html.includes("&amp;"));
});

class FakeRepository implements ExternalRepository {
  calls: string[] = [];
  mode = "test_only";
  registration: "registered" | "replay_detected" = "registered";
  event = {
    id: "33333333-3333-4333-8333-333333333333",
    event_type: "provider_intake.received",
    recipient_email: "synthetic@example.invalid",
    payload: receivedPayload,
  };
  rolloutMode(): Promise<string> {
    this.calls.push("mode");
    return Promise.resolve(this.mode);
  }
  registerInvocation(): Promise<"registered" | "replay_detected"> {
    this.calls.push("register");
    return Promise.resolve(this.registration);
  }
  claim() {
    this.calls.push("claim");
    return Promise.resolve([this.event]);
  }
  reserve() {
    this.calls.push("reserve");
    return Promise.resolve({
      attempt_number: 1,
      provider_idempotency_key:
        "external:provider_intake.received:33333333-3333-4333-8333-333333333333:v1",
    });
  }
  started() {
    this.calls.push("started");
    return Promise.resolve();
  }
  sent() {
    this.calls.push("sent");
    return Promise.resolve();
  }
  failed() {
    this.calls.push("failed");
    return Promise.resolve();
  }
}

function dispatcher(repository: FakeRepository, options: {
  mode?: "disabled" | "test_only" | "pilot";
  send?: (input: SendInput) => Promise<string>;
  logs?: Record<string, unknown>[];
} = {}) {
  return createExternalDispatcherHandler({
    mode: options.mode || "test_only",
    keyId,
    hmacKey: key,
    repository,
    send: options.send || (() => Promise.resolve("provider-message-test")),
    now: () => now,
    logger: (entry) => options.logs?.push(entry),
  });
}

async function dispatchRequest(method = "POST", rawBody = '{"limit":1}') {
  return new Request(`https://example.test${pathname}`, {
    method,
    headers: await signedHeaders(rawBody, method),
    body: method === "POST" ? rawBody : undefined,
  });
}

Deno.test("disabled returns before mode lookup, replay registration, claim or send", async () => {
  const repository = new FakeRepository();
  let sendCalls = 0;
  const response = await dispatcher(repository, {
    mode: "disabled",
    send: () => {
      sendCalls += 1;
      return Promise.resolve("unused");
    },
  })(await dispatchRequest());
  assertEquals(await response.json(), {
    processed: 0,
    sent: 0,
    failed: 0,
    codes: ["external_disabled"],
  });
  assertEquals(repository.calls, []);
  assertEquals(sendCalls, 0);
});

Deno.test("environment and DB mode mismatch returns before replay or claim", async () => {
  const repository = new FakeRepository();
  repository.mode = "pilot";
  const response = await dispatcher(repository)(await dispatchRequest());
  assertEquals((await response.json()).codes, ["external_mode_mismatch"]);
  assertEquals(repository.calls, ["mode"]);
});

Deno.test("invocation replay maps to a uniform unauthorized response and never claims", async () => {
  const repository = new FakeRepository();
  repository.registration = "replay_detected";
  const response = await dispatcher(repository)(await dispatchRequest());
  assertEquals(response.status, 401);
  assertEquals((await response.json()).codes, ["request_not_authorized"]);
  assertEquals(repository.calls, ["mode", "register"]);
});

Deno.test("dispatcher reserves, marks started, sends and completes exactly one event", async () => {
  const repository = new FakeRepository();
  const sends: SendInput[] = [];
  const logs: Record<string, unknown>[] = [];
  const response = await dispatcher(repository, {
    send: (input) => {
      sends.push(input);
      return Promise.resolve("provider-message-test");
    },
    logs,
  })(await dispatchRequest());
  const responseBody = await response.json();
  assertEquals(responseBody, { processed: 1, sent: 1, failed: 0, codes: [] });
  assertEquals(repository.calls, [
    "mode",
    "register",
    "claim",
    "reserve",
    "started",
    "sent",
  ]);
  assertEquals(sends.length, 1);
  assert(
    sends[0].idempotencyKey.startsWith("external:provider_intake.received:"),
  );
  const observable = JSON.stringify({ response: responseBody, logs });
  for (
    const forbidden of [
      repository.event.id,
      repository.event.recipient_email,
      "INT-2026-000001",
      "provider-message-test",
    ]
  ) {
    assert(!observable.includes(forbidden), forbidden);
  }
});

Deno.test("POST-only endpoint rejects GET and OPTIONS without CORS", async () => {
  for (const method of ["GET", "OPTIONS"]) {
    const repository = new FakeRepository();
    const response = await dispatcher(repository)(
      await dispatchRequest(method),
    );
    assertEquals(response.status, 405);
    assertEquals(response.headers.get("access-control-allow-origin"), null);
    assertEquals(repository.calls, []);
  }
});

Deno.test("Resend request uses stable event idempotency and has no attachments", () => {
  const input: SendInput = {
    to: "synthetic@example.invalid",
    subject: "Subject",
    text: "Text",
    html: "<p>Text</p>",
    idempotencyKey:
      "external:provider_intake.received:33333333-3333-4333-8333-333333333333:v1",
  };
  const first = resendRequestInit(
    input,
    "synthetic-key",
    "Flux <noreply@example.invalid>",
  );
  const retry = resendRequestInit(
    input,
    "synthetic-key",
    "Flux <noreply@example.invalid>",
  );
  assertEquals(
    new Headers(first.headers).get("Idempotency-Key"),
    input.idempotencyKey,
  );
  assertEquals(
    new Headers(retry.headers).get("Idempotency-Key"),
    input.idempotencyKey,
  );
  assert(!String(first.body).includes("attachments"));
});

Deno.test("provider errors map only to safe codes", () => {
  assertEquals(classifyProviderFailure(429, null), "provider_rate_limited");
  assertEquals(classifyProviderFailure(503, null), "provider_server_error");
  assertEquals(classifyProviderFailure(401, null), "provider_auth_failed");
  assertEquals(
    classifyProviderFailure(422, null),
    "provider_contract_rejected",
  );
  assertEquals(classifyProviderFailure(200, null), "provider_response_invalid");
});
