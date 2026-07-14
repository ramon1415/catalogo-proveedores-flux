import { createProviderIntakeHandler } from "./handler.ts";
import { TurnstileVerifier } from "./captcha.ts";
import { parseAllowedOrigins } from "./cors.ts";
import { prepareStorageFiles, validateIncomingFiles } from "./files.ts";
import type {
  CaptchaVerifier,
  CreateIntakeInput,
  CreateIntakeResult,
  IntakeConfig,
  IntakeRepository,
  LinkResolution,
  PreparedFile,
  StoredFileMetadata,
} from "./types.ts";

function assert(condition: unknown, message = "assertion_failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message = "values_not_equal"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

const config: IntakeConfig = {
  allowedOrigins: ["https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app"],
  allowNoOrigin: false,
  maxFiles: 3,
  maxTotalBytes: 20 * 1024 * 1024,
  maxAmount: 1000000,
  allowedCurrencies: ["MXN"],
  privacyNoticeUrl: "https://example.test/privacy",
  fingerprintWindowSeconds: 86400,
};

const link: LinkResolution = {
  intake_link_id: "11111111-1111-4111-8111-111111111111",
  company_id: "22222222-2222-4222-8222-222222222222",
  company_display_name: "Operadora DEV",
  max_file_mb: 10,
  max_submissions_per_day: 20,
  allowed_file_types: [
    "application/pdf",
    "application/xml",
    "text/xml",
    "image/jpeg",
    "image/png",
    "image/webp",
  ],
};

class FakeRepository implements IntakeRepository {
  resolveCalls = 0;
  createCalls: CreateIntakeInput[] = [];
  uploads: PreparedFile[] = [];
  attached: StoredFileMetadata[] = [];
  removed: string[] = [];
  issues: string[] = [];
  duplicate = false;
  uploadFails = false;
  attachFails = false;
  resolveError: string | null = null;

  async resolveLink(): Promise<LinkResolution> {
    this.resolveCalls += 1;
    if (this.resolveError) throw new Error(this.resolveError);
    return link;
  }

  async createIntake(input: CreateIntakeInput): Promise<CreateIntakeResult> {
    this.createCalls.push(input);
    return {
      payment_intake_id: "33333333-3333-4333-8333-333333333333",
      public_folio: "INT-2026-000001",
      status: "received",
      duplicate: this.duplicate,
    };
  }

  async uploadFile(file: PreparedFile): Promise<void> {
    if (this.uploadFails) throw new Error("upload_failed");
    this.uploads.push(file);
  }

  async removeUploadedFiles(paths: string[]): Promise<void> {
    this.removed.push(...paths);
  }

  async attachFiles(_intakeId: string, files: StoredFileMetadata[]): Promise<void> {
    if (this.attachFails) throw new Error("attach_failed");
    this.attached.push(...files);
  }

  async markUploadIssue(_intakeId: string, issueCode: string): Promise<void> {
    this.issues.push(issueCode);
  }
}

const captcha: CaptchaVerifier = {
  provider: "turnstile",
  verify: async () => true,
};

const origin = config.allowedOrigins[0];
const token = "provider_intake_test_token_abcdefghijklmnopqrstuvwxyz";

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("Origin", origin);
  headers.set("X-Intake-Token", token);
  return new Request(`https://example.test/functions/v1/provider-intake/${path}`, { ...init, headers });
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider_name: "Proveedor de Prueba",
    provider_email: "proveedor@example.invalid",
    concept: "Servicio de prueba",
    amount_requested: 1250.5,
    currency: "MXN",
    ...overrides,
  };
}

function submitRequest(overrides: Record<string, unknown> = {}, headers: HeadersInit = {}): Request {
  return request("submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ payload: payload(overrides), captcha_token: "captcha-test-token", honeypot: "" }),
  });
}

Deno.test("link-info exposes only the public contract", async () => {
  const repository = new FakeRepository();
  const handler = createProviderIntakeHandler({ config, repository, captcha, hashPepper: "pepper-test" });
  const response = await handler(request("link-info", { method: "GET" }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.company.display_name, "Operadora DEV");
  assertEquals(body.link.max_files, 3);
  assert(!JSON.stringify(body).includes("company_id"));
  assert(!JSON.stringify(body).includes("intake_link_id"));
  assert(!JSON.stringify(body).includes("token_hash"));
});

Deno.test("query-string token is ignored", async () => {
  const repository = new FakeRepository();
  const handler = createProviderIntakeHandler({ config, repository, captcha, hashPepper: "pepper-test" });
  const response = await handler(new Request(
    `https://example.test/functions/v1/provider-intake/link-info?t=${token}`,
    { method: "GET", headers: { Origin: origin } },
  ));
  const body = await response.json();

  assertEquals(response.status, 404);
  assertEquals(body.error, "link_not_available");
  assertEquals(repository.resolveCalls, 0);
});

Deno.test("minimal JSON submit creates one intake with hashed identifiers", async () => {
  const repository = new FakeRepository();
  const logs: Record<string, unknown>[] = [];
  const handler = createProviderIntakeHandler({
    config,
    repository,
    captcha,
    hashPepper: "pepper-test",
    now: () => 1720483200000,
    logger: (entry) => logs.push(entry),
  });
  const response = await handler(submitRequest());
  const body = await response.json();

  assertEquals(response.status, 201);
  assertEquals(body, {
    ok: true,
    public_folio: "INT-2026-000001",
    status: "received",
    duplicate: false,
    message: "Solicitud recibida correctamente.",
  });
  assertEquals(repository.createCalls.length, 1);
  assert(/^[0-9a-f]{64}$/.test(repository.createCalls[0].tokenHash));
  assert(/^[0-9a-f]{64}$/.test(repository.createCalls[0].submissionFingerprint));
  assert(/^[0-9a-f]{64}$/.test(repository.createCalls[0].idempotencyKeyHash));
  const logText = JSON.stringify(logs);
  assert(!logText.includes("proveedor@example.invalid"));
  assert(!logText.includes(token));
  assert(!logText.includes("Servicio de prueba"));
});

Deno.test("Idempotency-Key retry returns the existing folio and skips files", async () => {
  const repository = new FakeRepository();
  repository.duplicate = true;
  const handler = createProviderIntakeHandler({ config, repository, captcha, hashPepper: "pepper-test" });
  const response = await handler(submitRequest({}, { "Idempotency-Key": "retry-key-0001" }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.duplicate, true);
  assertEquals(repository.uploads.length, 0);
  assertEquals(repository.attached.length, 0);
});

Deno.test("internal payload fields are rejected before insertion", async () => {
  const repository = new FakeRepository();
  const handler = createProviderIntakeHandler({ config, repository, captcha, hashPepper: "pepper-test" });
  const response = await handler(submitRequest({ company_id: link.company_id }));
  const body = await response.json();

  assertEquals(response.status, 400);
  assertEquals(body.error, "invalid_request");
  assertEquals(repository.createCalls.length, 0);
});

Deno.test("honeypot rejects without resolving or inserting", async () => {
  const repository = new FakeRepository();
  const handler = createProviderIntakeHandler({ config, repository, captcha, hashPepper: "pepper-test" });
  const req = request("submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload: payload(), captcha_token: "captcha-test-token", honeypot: "filled" }),
  });
  const response = await handler(req);

  assertEquals(response.status, 400);
  assertEquals(repository.createCalls.length, 0);
});

Deno.test("invalid amount and email return stable public errors", async () => {
  const repository = new FakeRepository();
  const handler = createProviderIntakeHandler({ config, repository, captcha, hashPepper: "pepper-test" });

  const amountResponse = await handler(submitRequest({ amount_requested: 0 }));
  assertEquals((await amountResponse.json()).error, "invalid_amount");
  const emailResponse = await handler(submitRequest({ provider_email: "not-an-email" }));
  assertEquals((await emailResponse.json()).error, "invalid_email");
  assertEquals(repository.createCalls.length, 0);
});

Deno.test("unauthorized origin is rejected without repository access", async () => {
  const repository = new FakeRepository();
  const handler = createProviderIntakeHandler({ config, repository, captcha, hashPepper: "pepper-test" });
  const req = new Request("https://example.test/functions/v1/provider-intake/link-info", {
    method: "GET",
    headers: { Origin: "https://evil.example", "X-Intake-Token": token },
  });
  const response = await handler(req);

  assertEquals(response.status, 403);
  assertEquals(repository.resolveCalls, 0);
  assertEquals(response.headers.get("access-control-allow-origin"), null);
});

Deno.test("PDF signature and opaque storage metadata are validated", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.7\n% test");
  const file = new File([bytes], "invoice.pdf", { type: "application/pdf" });
  const validated = await validateIncomingFiles([file], ["invoice_pdf"], link, config);

  assertEquals(validated.length, 1);
  assertEquals(validated[0].mimeType, "application/pdf");
  assert(/^[0-9a-f]{64}$/.test(validated[0].sha256));
});

Deno.test("deceptive extension, bad magic, HTML, SVG, ZIP, executable and traversal are rejected", async () => {
  const rejected = [
    new File(["not a pdf"], "invoice.pdf", { type: "application/pdf" }),
    new File(["%PDF-1.7"], "invoice.exe", { type: "application/pdf" }),
    new File(["<html></html>"], "page.html", { type: "text/html" }),
    new File(["<svg></svg>"], "image.svg", { type: "image/svg+xml" }),
    new File(["PK\u0003\u0004"], "archive.zip", { type: "application/zip" }),
    new File(["MZ"], "program.exe", { type: "application/octet-stream" }),
    new File(["%PDF-1.7"], "../invoice.pdf", { type: "application/pdf" }),
  ];

  for (const file of rejected) {
    let failed = false;
    try {
      await validateIncomingFiles([file], ["other"], link, config);
    } catch {
      failed = true;
    }
    assert(failed, `file_should_be_rejected:${file.name}`);
  }
});

Deno.test("upload failure marks the intake for correction and returns no internal ID", async () => {
  const repository = new FakeRepository();
  repository.uploadFails = true;
  const handler = createProviderIntakeHandler({ config, repository, captcha, hashPepper: "pepper-test" });
  const form = new FormData();
  form.set("payload", JSON.stringify(payload()));
  form.set("captcha_token", "captcha-test-token");
  form.set("honeypot", "");
  form.set("file_kinds", JSON.stringify(["invoice_pdf"]));
  form.append("files", new File(["%PDF-1.7\n"], "invoice.pdf", { type: "application/pdf" }));
  const response = await handler(request("submit", { method: "POST", body: form }));
  const body = await response.json();

  assertEquals(response.status, 503);
  assertEquals(body.error, "submit_failed");
  assertEquals(repository.issues, ["storage_upload_failed"]);
  assert(!JSON.stringify(body).includes("33333333-3333-4333-8333-333333333333"));
});

Deno.test("all unavailable link states share the same public response", async () => {
  for (const state of ["missing", "paused", "revoked", "expired"]) {
    const repository = new FakeRepository();
    repository.resolveError = `provider_intake_link_not_available:${state}`;
    const handler = createProviderIntakeHandler({
      config,
      repository,
      captcha,
      hashPepper: "pepper-test",
      logger: () => undefined,
    });
    const response = await handler(request("link-info", { method: "GET" }));
    const body = await response.json();

    assertEquals(response.status, 404);
    assertEquals(body.error, "link_not_available");
    assert(!JSON.stringify(body).includes(state));
  }
});

Deno.test("missing and oversized tokens fail generically before repository access", async () => {
  for (const supplied of ["", "x".repeat(257)]) {
    const repository = new FakeRepository();
    const handler = createProviderIntakeHandler({
      config,
      repository,
      captcha,
      hashPepper: "pepper-test",
      logger: () => undefined,
    });
    const headers: Record<string, string> = { Origin: origin };
    if (supplied) headers["X-Intake-Token"] = supplied;
    const response = await handler(new Request(
      "https://example.test/functions/v1/provider-intake/link-info",
      { method: "GET", headers },
    ));
    assertEquals(response.status, 404);
    assertEquals((await response.json()).error, "link_not_available");
    assertEquals(repository.resolveCalls, 0);
  }
});

Deno.test("full payload is normalized without accepting internal fields", async () => {
  const repository = new FakeRepository();
  const handler = createProviderIntakeHandler({
    config,
    repository,
    captcha,
    hashPepper: "pepper-test",
    logger: () => undefined,
  });
  const response = await handler(submitRequest({
    provider_name: "  Proveedor Completo  ",
    provider_rfc: "abc-010203xyz",
    provider_email: "TEST@EXAMPLE.INVALID",
    provider_phone: "+52 55 1234 5678",
    description: "Servicio integral",
    requested_payment_date: "2026-07-15",
    invoice_folio: "FAC-001",
    invoice_uuid: "550E8400-E29B-41D4-A716-446655440000",
    invoice_date: "2026-07-14",
    bank_name: "Banco de prueba",
    bank_account: "1234-5678",
    bank_clabe: "123 456 789 012 345 678",
    beneficiary_name: "Proveedor Completo",
  }));

  assertEquals(response.status, 201);
  const saved = repository.createCalls[0].submission;
  assertEquals(saved.provider_name, "Proveedor Completo");
  assertEquals(saved.provider_rfc, "ABC010203XYZ");
  assertEquals(saved.provider_email, "test@example.invalid");
  assertEquals(saved.bank_account, "12345678");
  assertEquals(saved.bank_clabe, "123456789012345678");
});

Deno.test("invalid CAPTCHA fails closed before intake creation", async () => {
  const repository = new FakeRepository();
  const failingCaptcha: CaptchaVerifier = { provider: "turnstile", verify: async () => false };
  const handler = createProviderIntakeHandler({
    config,
    repository,
    captcha: failingCaptcha,
    hashPepper: "pepper-test",
    logger: () => undefined,
  });
  const response = await handler(submitRequest());

  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, "captcha_failed");
  assertEquals(repository.createCalls.length, 0);
});

Deno.test("Turnstile validates timestamp hostname and action and fails closed", async () => {
  const now = Date.parse("2026-07-14T12:00:00Z");
  const success = new TurnstileVerifier({
    secret: "test-secret",
    expectedHostname: "catalogo-proveedores-flux-git-dev-quantta-team.vercel.app",
    expectedAction: "provider_intake",
    now: () => now,
    fetchImpl: async () => new Response(JSON.stringify({
      success: true,
      hostname: "catalogo-proveedores-flux-git-dev-quantta-team.vercel.app",
      action: "provider_intake",
      challenge_ts: "2026-07-14T11:59:30Z",
    }), { status: 200 }),
  });
  assertEquals(await success.verify({ token: "captcha-token", remoteIp: "192.0.2.1" }), true);

  const stale = new TurnstileVerifier({
    secret: "test-secret",
    now: () => now,
    fetchImpl: async () => new Response(JSON.stringify({
      success: true,
      challenge_ts: "2026-07-14T10:00:00Z",
    }), { status: 200 }),
  });
  assertEquals(await stale.verify({ token: "captcha-token" }), false);

  const wrongHost = new TurnstileVerifier({
    secret: "test-secret",
    expectedHostname: "expected.example",
    now: () => now,
    fetchImpl: async () => new Response(JSON.stringify({
      success: true,
      hostname: "wrong.example",
      challenge_ts: "2026-07-14T11:59:30Z",
    }), { status: 200 }),
  });
  assertEquals(await wrongHost.verify({ token: "captcha-token" }), false);
});

Deno.test("amount, fiscal, banking, currency and date validation reject bad input", async () => {
  const cases = [
    { amount_requested: -1 },
    { amount_requested: "not-a-number" },
    { amount_requested: 1.234 },
    { amount_requested: config.maxAmount + 1 },
    { provider_rfc: "INVALID" },
    { bank_clabe: "123" },
    { currency: "USD" },
    { requested_payment_date: "2026-02-30" },
    { invoice_uuid: "not-a-uuid" },
  ];
  for (const invalid of cases) {
    const repository = new FakeRepository();
    const handler = createProviderIntakeHandler({
      config,
      repository,
      captcha,
      hashPepper: "pepper-test",
      logger: () => undefined,
    });
    const response = await handler(submitRequest(invalid));
    assertEquals(response.status, 400, JSON.stringify(invalid));
    assertEquals(repository.createCalls.length, 0);
  }
});

Deno.test("oversized text payload and malformed idempotency key are rejected", async () => {
  const repository = new FakeRepository();
  const handler = createProviderIntakeHandler({
    config,
    repository,
    captcha,
    hashPepper: "pepper-test",
    logger: () => undefined,
  });
  const payloadResponse = await handler(submitRequest({ description: "x".repeat(4001) }));
  assertEquals(payloadResponse.status, 400);
  const keyResponse = await handler(submitRequest({}, { "Idempotency-Key": "bad key" }));
  assertEquals(keyResponse.status, 400);
  assertEquals(repository.createCalls.length, 0);
});

Deno.test("PDF XML JPEG PNG and WEBP signatures are accepted", async () => {
  const fixtures = [
    new File([new TextEncoder().encode("%PDF-1.7\n")], "invoice.pdf", { type: "application/pdf" }),
    new File([new TextEncoder().encode("<?xml version=\"1.0\"?><cfdi/>")], "invoice.xml", { type: "application/xml" }),
    new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "photo.jpg", { type: "image/jpeg" }),
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "image.png", { type: "image/png" }),
    new File([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])], "image.webp", { type: "image/webp" }),
  ];
  const kinds = ["invoice_pdf", "invoice_xml", "support", "support", "support"];
  for (let index = 0; index < fixtures.length; index += 1) {
    const validated = await validateIncomingFiles([fixtures[index]], [kinds[index]], link, config);
    assertEquals(validated.length, 1);
    assert(/^[0-9a-f]{64}$/.test(validated[0].sha256));
  }
});

Deno.test("file count, total size, per-file size and non-file multipart entries are rejected", async () => {
  const pdf = () => new File(["%PDF-1.7"], "invoice.pdf", { type: "application/pdf" });
  let failed = false;
  try {
    await validateIncomingFiles([pdf(), pdf(), pdf(), pdf()], ["other", "other", "other", "other"], link, config);
  } catch {
    failed = true;
  }
  assert(failed, "four_files_should_fail");

  failed = false;
  try {
    await validateIncomingFiles([pdf()], ["other"], { ...link, max_file_mb: 0.000001 }, config);
  } catch {
    failed = true;
  }
  assert(failed, "per_file_limit_should_fail");

  failed = false;
  try {
    await validateIncomingFiles([pdf(), pdf()], ["other", "other"], link, { ...config, maxTotalBytes: 5 });
  } catch {
    failed = true;
  }
  assert(failed, "total_limit_should_fail");

  const repository = new FakeRepository();
  const handler = createProviderIntakeHandler({
    config,
    repository,
    captcha,
    hashPepper: "pepper-test",
    logger: () => undefined,
  });
  const form = new FormData();
  form.set("payload", JSON.stringify(payload()));
  form.set("captcha_token", "captcha-test-token");
  form.set("honeypot", "");
  form.set("file_kinds", "[]");
  form.append("files", "not-a-file");
  const response = await handler(request("submit", { method: "POST", body: form }));
  assertEquals(response.status, 400);
  assertEquals(repository.createCalls.length, 0);
});

Deno.test("prepared Storage paths contain only opaque IDs", async () => {
  const file = new File(["%PDF-1.7"], "Proveedor RFC ABC010203XYZ.pdf", { type: "application/pdf" });
  const validated = await validateIncomingFiles([file], ["invoice_pdf"], link, config);
  const intakeId = "33333333-3333-4333-8333-333333333333";
  const prepared = prepareStorageFiles(validated, intakeId)[0];

  assert(new RegExp(`^${intakeId}/[0-9a-f-]{36}\\.pdf$`).test(prepared.storagePath));
  assert(!prepared.storagePath.includes("Proveedor"));
  assert(!prepared.storagePath.includes("ABC010203XYZ"));
});

Deno.test("metadata failure removes only uploaded paths and marks correction", async () => {
  const repository = new FakeRepository();
  repository.attachFails = true;
  const handler = createProviderIntakeHandler({
    config,
    repository,
    captcha,
    hashPepper: "pepper-test",
    logger: () => undefined,
  });
  const form = new FormData();
  form.set("payload", JSON.stringify(payload()));
  form.set("captcha_token", "captcha-test-token");
  form.set("honeypot", "");
  form.set("file_kinds", JSON.stringify(["invoice_pdf"]));
  form.append("files", new File(["%PDF-1.7\n"], "invoice.pdf", { type: "application/pdf" }));
  const response = await handler(request("submit", { method: "POST", body: form }));

  assertEquals(response.status, 503);
  assertEquals(repository.uploads.length, 1);
  assertEquals(repository.removed, [repository.uploads[0].storagePath]);
  assertEquals(repository.issues, ["file_metadata_failed"]);
});

Deno.test("preflight and JSON responses include restrictive security headers", async () => {
  const repository = new FakeRepository();
  const handler = createProviderIntakeHandler({
    config,
    repository,
    captcha,
    hashPepper: "pepper-test",
    logger: () => undefined,
  });
  const preflight = await handler(request("submit", { method: "OPTIONS" }));
  assertEquals(preflight.status, 204);
  assertEquals(preflight.headers.get("access-control-allow-origin"), origin);
  assertEquals(preflight.headers.get("access-control-allow-credentials"), null);
  assert(preflight.headers.get("content-security-policy")?.includes("default-src 'none'"));

  const linkResponse = await handler(request("link-info", { method: "GET" }));
  assertEquals(linkResponse.headers.get("cache-control"), "no-store");
  assertEquals(linkResponse.headers.get("x-content-type-options"), "nosniff");
  assertEquals(linkResponse.headers.get("referrer-policy"), "no-referrer");
});

Deno.test("CORS configuration rejects wildcard, paths and credentials", () => {
  for (const invalid of ["*", "https://example.test/path", "https://user:pass@example.test"]){
    let failed = false;
    try {
      parseAllowedOrigins(invalid);
    } catch {
      failed = true;
    }
    assert(failed, `origin_should_fail:${invalid}`);
  }
  assertEquals(parseAllowedOrigins("https://example.test,https://example.test"), ["https://example.test"]);
});

Deno.test("logs and errors omit token payload banking data and repository details", async () => {
  const repository = new FakeRepository();
  const logs: Record<string, unknown>[] = [];
  const handler = createProviderIntakeHandler({
    config,
    repository,
    captcha,
    hashPepper: "pepper-test",
    logger: (entry) => logs.push(entry),
  });
  const response = await handler(submitRequest({
    bank_clabe: "123456789012345678",
    bank_account: "12345678",
    provider_rfc: "ABC010203XYZ",
  }));
  assertEquals(response.status, 201);
  const logsText = JSON.stringify(logs);
  for (const sensitive of [token, "123456789012345678", "12345678", "ABC010203XYZ", "proveedor@example.invalid"]){
    assert(!logsText.includes(sensitive), `sensitive_log_value:${sensitive}`);
  }

  repository.resolveError = "SQL constraint public.intake_links secret stack";
  const errorResponse = await handler(request("link-info", { method: "GET" }));
  const publicBody = JSON.stringify(await errorResponse.json());
  assertEquals(errorResponse.status, 503);
  assert(!publicBody.includes("constraint"));
  assert(!publicBody.includes("intake_links"));
  assert(!publicBody.includes("stack"));
});
