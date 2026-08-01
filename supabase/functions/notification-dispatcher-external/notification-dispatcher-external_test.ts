import {
  canonicalInvocation,
  hmacSha256Hex,
  sha256Hex,
  validHmacConfiguration,
  verifyInvocation,
} from "./auth.ts";
import {
  classifyProviderFailure,
  createExternalDispatcherHandler,
  type ExternalFailureResult,
  type ExternalRepository,
  normalizeSupabaseUrl,
  parseDispatcherBody,
  ProviderError,
  readBoundedBody,
  resendRequestInit,
  type SendInput,
  validDispatcherContentType,
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

Deno.test("HMAC configuration rejects short keys, malformed IDs and whitespace", async () => {
  assert(validHmacConfiguration(keyId, key));
  for (
    const [candidateId, candidateKey] of [
      ["ab", key],
      ["bad key", key],
      [` ${keyId}`, key],
      [keyId, "short-key"],
      [keyId, `${key} `],
    ]
  ) {
    assert(!validHmacConfiguration(candidateId, candidateKey));
    assertEquals(
      await verifyInvocation({
        method: "POST",
        pathname,
        rawBody: '{"limit":1}',
        headers: await signedHeaders(),
        expectedKeyId: candidateId,
        key: candidateKey,
        nowMs: now,
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
      '{"limit":1,"limit":1}',
      '{ "limit": 1 }',
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
  sentOutcomes: Array<"sent" | "already_sent" | Error> = [];
  failedResults: ExternalFailureResult[] = [];
  failedCodes: string[] = [];
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
    const outcome = this.sentOutcomes.shift() || "sent";
    return outcome instanceof Error
      ? Promise.reject(outcome)
      : Promise.resolve(outcome);
  }
  failed(
    _eventId: string,
    _attemptNumber: number,
    safeCode: Parameters<ExternalRepository["failed"]>[2],
  ) {
    this.calls.push("failed");
    this.failedCodes.push(safeCode);
    const retryable = [
      "provider_rate_limited",
      "provider_server_error",
      "provider_network_unavailable",
    ].includes(safeCode);
    const result: ExternalFailureResult = this.failedResults.shift() || {
      result: retryable ? "pending" : "dead_letter",
      retryable,
      manual_review_required: [
        "provider_timeout_unknown",
        "provider_response_invalid",
        "manual_review_required",
      ].includes(safeCode),
      circuit_breaker_required: safeCode === "provider_auth_failed",
    };
    return Promise.resolve(result);
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

Deno.test("sent acknowledgement retries once without a second provider send", async () => {
  const repository = new FakeRepository();
  repository.sentOutcomes = [new Error("response_lost"), "already_sent"];
  let sendCalls = 0;
  const response = await dispatcher(repository, {
    send: () => {
      sendCalls += 1;
      return Promise.resolve("provider-message-test");
    },
  })(await dispatchRequest());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    processed: 1,
    sent: 1,
    failed: 0,
    codes: [],
  });
  assertEquals(sendCalls, 1);
  assertEquals(repository.calls.filter((call) => call === "sent").length, 2);
  assertEquals(repository.calls.includes("failed"), false);
});

Deno.test("two unknown sent acknowledgements require manual review without provider failure or resend", async () => {
  const repository = new FakeRepository();
  repository.sentOutcomes = [
    new Error("ack_unknown_1"),
    new Error("ack_unknown_2"),
  ];
  let sendCalls = 0;
  const response = await dispatcher(repository, {
    send: () => {
      sendCalls += 1;
      return Promise.resolve("provider-message-test");
    },
  })(await dispatchRequest());

  assertEquals(response.status, 503);
  assertEquals((await response.json()).codes, ["manual_review_required"]);
  assertEquals(sendCalls, 1);
  assertEquals(repository.calls.filter((call) => call === "sent").length, 2);
  assertEquals(repository.calls.includes("failed"), false);
});

Deno.test("provider 2xx response ambiguity is terminal manual review", async () => {
  const repository = new FakeRepository();
  const response = await dispatcher(repository, {
    send: () => Promise.reject(new ProviderError("provider_response_invalid")),
  })(await dispatchRequest());

  assertEquals((await response.json()).codes, [
    "provider_response_invalid",
    "manual_review_required",
  ]);
  assertEquals(repository.failedCodes, ["provider_response_invalid"]);
  assertEquals(repository.calls.filter((call) => call === "failed").length, 1);
});

Deno.test("provider authentication failure requires and validates the circuit breaker result", async () => {
  const repository = new FakeRepository();
  const response = await dispatcher(repository, {
    send: () => Promise.reject(new ProviderError("provider_auth_failed")),
  })(await dispatchRequest());

  assertEquals((await response.json()).codes, ["provider_auth_failed"]);
  assertEquals(repository.failedCodes, ["provider_auth_failed"]);
  assertEquals(repository.calls.filter((call) => call === "claim").length, 1);
});

Deno.test("POST-only endpoint rejects GET and OPTIONS without CORS", async () => {
  for (const method of ["GET", "OPTIONS"]) {
    const repository = new FakeRepository();
    const response = await dispatcher(repository, { mode: "disabled" })(
      await dispatchRequest(method),
    );
    assertEquals(response.status, 405);
    assertEquals(response.headers.get("access-control-allow-origin"), null);
    assertEquals(repository.calls, []);
  }
});

Deno.test("disabled endpoint validates content type, canonical body and bounded size before short-circuit", async () => {
  const cases = [
    {
      request: new Request(`https://example.test${pathname}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: '{"limit":1}',
      }),
      status: 415,
    },
    {
      request: new Request(`https://example.test${pathname}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"limit":1,"limit":1}',
      }),
      status: 400,
    },
    {
      request: new Request(`https://example.test${pathname}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "x".repeat(65),
      }),
      status: 413,
    },
  ];
  for (const item of cases) {
    const repository = new FakeRepository();
    const response = await dispatcher(repository, { mode: "disabled" })(
      item.request,
    );
    assertEquals(response.status, item.status);
    assertEquals(repository.calls, []);
  }

  assert(validDispatcherContentType("application/json"));
  assert(validDispatcherContentType("application/json; charset=UTF-8"));
  assert(!validDispatcherContentType("application/json; charset=latin1"));
  assertEquals(
    await readBoundedBody(
      new Request("https://example.test", {
        method: "POST",
        body: "x".repeat(65),
      }),
    ),
    null,
  );
});

Deno.test("Supabase service-role target accepts only an official HTTPS project origin", () => {
  assertEquals(
    normalizeSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co"),
    "https://abcdefghijklmnopqrst.supabase.co",
  );
  for (
    const invalid of [
      "http://abcdefghijklmnopqrst.supabase.co",
      "https://user:pass@abcdefghijklmnopqrst.supabase.co",
      "https://abcdefghijklmnopqrst.supabase.co?redirect=evil",
      "https://abcdefghijklmnopqrst.supabase.co/path",
      "https://evil.example",
      " https://abcdefghijklmnopqrst.supabase.co",
    ]
  ) {
    let failed = false;
    try {
      normalizeSupabaseUrl(invalid);
    } catch {
      failed = true;
    }
    assert(failed, invalid);
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
  assertEquals(classifyProviderFailure(403, null), "provider_auth_failed");
  assertEquals(
    classifyProviderFailure(422, null),
    "provider_contract_rejected",
  );
  assertEquals(classifyProviderFailure(200, null), "provider_response_invalid");
});
