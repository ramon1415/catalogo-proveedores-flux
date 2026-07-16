type Snapshot = {
  active_links: number;
  payment_intake: number;
  payment_intake_files: number;
  payment_intake_events: number;
  storage_objects: number;
  payment_requests: number;
  proveedores: number;
  approval_batches: number;
  notification_events: number;
  intake_notifications: number;
  converted_intakes: number;
  duplicate_public_folios: number;
  duplicate_idempotency_keys: number;
  duplicate_storage_paths: number;
  intakes_without_received: number;
  files_without_objects: number;
  objects_without_metadata: number;
  bucket_public: boolean | null;
  bucket_file_size_limit: number | null;
  bucket_mime_count: number;
};

type HttpObservation = {
  http: number;
  content_type: string;
  error: string | null;
  duplicate: boolean;
  request_id_present: boolean;
  max_total_mb: number | null;
};

type Check = {
  id: string;
  status: "PASS" | "FAIL";
  observed: Record<string, boolean | number | string | null>;
};

type RetestStage =
  | "startup"
  | "initial_snapshot"
  | "link_info"
  | "under_limit_request"
  | "over_limit_request"
  | "qa07_post_snapshot"
  | "safe_xml_request"
  | "safe_xml_post_snapshot"
  | "dtd_request"
  | "final_snapshot"
  | "write_final_evidence";

type SanitizedErrorCode =
  | "required_environment_missing"
  | "read_only_postcheck_failed"
  | "invalid_snapshot"
  | "unexpected_check_count"
  | "network_request_failed"
  | "evidence_write_failed"
  | "sanitized_execution_error";

let currentStage: RetestStage = "startup";

const projectRef = "scsirgbuqjcwoaxfacth";
const functionTree = "379f65801609e40143d948b3de702e391636c512";
const expectedMaxTotalMb = 12;
const expectedMaxFileBytes = 10 * 1024 * 1024;
const expectedMimeCount = 6;
const expectedCore = {
  payment_requests: 73,
  proveedores: 22,
  approval_batches: 8,
  notification_events: 322,
};
const baseUrl =
  "https://scsirgbuqjcwoaxfacth.functions.supabase.co/provider-intake";
const allowedOrigin =
  "https://catalogo-proveedores-flux-git-feature-ramon-4c89bf-quantta-team.vercel.app";

function sanitizeError(error: unknown): SanitizedErrorCode {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("invalid_snapshot")) {
    return "invalid_snapshot";
  }

  switch (message) {
    case "required_environment_missing":
    case "read_only_postcheck_failed":
    case "unexpected_check_count":
    case "network_request_failed":
    case "evidence_write_failed":
      return message;
    default:
      return "sanitized_execution_error";
  }
}

async function writeEvidenceFile(
  evidenceFile: string,
  evidence: unknown,
): Promise<void> {
  try {
    await Deno.writeTextFile(
      evidenceFile,
      JSON.stringify(evidence, null, 2) + "\n",
    );
  } catch {
    throw new Error("evidence_write_failed");
  }
}

async function writeFailureEvidence(error: unknown): Promise<void> {
  const evidenceFile = Deno.env.get("EVIDENCE_FILE")?.trim();
  if (!evidenceFile) {
    return;
  }

  const evidence = {
    metadata: {
      project_ref: projectRef,
      workflow_run_id: Deno.env.get("GITHUB_RUN_ID")?.trim() || "unavailable",
      head_sha: Deno.env.get("GITHUB_SHA")?.trim() || "unavailable",
      function_tree: functionTree,
      secrets_printed: false,
      migrations_executed: false,
    },
    summary: {
      result: "ERROR",
      passed: 0,
      failed: 0,
    },
    diagnostic: {
      failed_stage: currentStage,
      error_code: sanitizeError(error),
    },
  };

  try {
    await Deno.writeTextFile(
      evidenceFile,
      JSON.stringify(evidence, null, 2) + "\n",
    );
  } catch {
    // The console remains sanitized even when evidence cannot be written.
  }
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error("required_environment_missing");
  }
  return value;
}

function numberField(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("invalid_snapshot_" + field);
  }
  return value;
}

function nullableNumberField(value: unknown, field: string): number | null {
  if (value === null) return null;
  return numberField(value, field);
}

function booleanOrNullField(value: unknown, field: string): boolean | null {
  if (value === null || typeof value === "boolean") return value;
  throw new Error("invalid_snapshot_" + field);
}

function parseSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_snapshot");
  }
  const row = value as Record<string, unknown>;
  return {
    active_links: numberField(row.active_links, "active_links"),
    payment_intake: numberField(row.payment_intake, "payment_intake"),
    payment_intake_files: numberField(
      row.payment_intake_files,
      "payment_intake_files",
    ),
    payment_intake_events: numberField(
      row.payment_intake_events,
      "payment_intake_events",
    ),
    storage_objects: numberField(row.storage_objects, "storage_objects"),
    payment_requests: numberField(row.payment_requests, "payment_requests"),
    proveedores: numberField(row.proveedores, "proveedores"),
    approval_batches: numberField(row.approval_batches, "approval_batches"),
    notification_events: numberField(
      row.notification_events,
      "notification_events",
    ),
    intake_notifications: numberField(
      row.intake_notifications,
      "intake_notifications",
    ),
    converted_intakes: numberField(row.converted_intakes, "converted_intakes"),
    duplicate_public_folios: numberField(
      row.duplicate_public_folios,
      "duplicate_public_folios",
    ),
    duplicate_idempotency_keys: numberField(
      row.duplicate_idempotency_keys,
      "duplicate_idempotency_keys",
    ),
    duplicate_storage_paths: numberField(
      row.duplicate_storage_paths,
      "duplicate_storage_paths",
    ),
    intakes_without_received: numberField(
      row.intakes_without_received,
      "intakes_without_received",
    ),
    files_without_objects: numberField(
      row.files_without_objects,
      "files_without_objects",
    ),
    objects_without_metadata: numberField(
      row.objects_without_metadata,
      "objects_without_metadata",
    ),
    bucket_public: booleanOrNullField(row.bucket_public, "bucket_public"),
    bucket_file_size_limit: nullableNumberField(
      row.bucket_file_size_limit,
      "bucket_file_size_limit",
    ),
    bucket_mime_count: numberField(row.bucket_mime_count, "bucket_mime_count"),
  };
}

async function readSnapshot(databaseUrl: string): Promise<Snapshot> {
  const sql = [
    "begin read only;",
    "select json_build_object(",
    "  'active_links', (select count(*)::integer from public.intake_links where status = 'active'),",
    "  'payment_intake', (select count(*)::integer from public.payment_intake),",
    "  'payment_intake_files', (select count(*)::integer from public.payment_intake_files),",
    "  'payment_intake_events', (select count(*)::integer from public.payment_intake_events),",
    "  'storage_objects', (select count(*)::integer from storage.objects where bucket_id = 'intake-uploads'),",
    "  'payment_requests', (select count(*)::integer from public.payment_requests),",
    "  'proveedores', (select count(*)::integer from public.proveedores),",
    "  'approval_batches', (select count(*)::integer from public.approval_batches),",
    "  'notification_events', (select count(*)::integer from public.notification_events),",
    "  'intake_notifications', (select count(*)::integer from public.notification_events where event_type = 'provider_intake.received'),",
    "  'converted_intakes', (select count(*)::integer from public.payment_intake where status = 'converted' or created_payment_request_id is not null),",
    "  'duplicate_public_folios', (select count(*)::integer from (select public_folio from public.payment_intake group by public_folio having count(*) > 1) d),",
    "  'duplicate_idempotency_keys', (select count(*)::integer from (select intake_link_id, idempotency_key from public.payment_intake group by intake_link_id, idempotency_key having count(*) > 1) d),",
    "  'duplicate_storage_paths', (select count(*)::integer from (select storage_path from public.payment_intake_files group by storage_path having count(*) > 1) d),",
    "  'intakes_without_received', (select count(*)::integer from public.payment_intake pi where not exists (select 1 from public.payment_intake_events pie where pie.payment_intake_id = pi.id and pie.event_type = 'received')),",
    "  'files_without_objects', (select count(*)::integer from public.payment_intake_files pif where not exists (select 1 from storage.objects so where so.bucket_id = pif.bucket_id and so.name = pif.storage_path)),",
    "  'objects_without_metadata', (select count(*)::integer from storage.objects so where so.bucket_id = 'intake-uploads' and not exists (select 1 from public.payment_intake_files pif where pif.bucket_id = so.bucket_id and pif.storage_path = so.name)),",
    "  'bucket_public', (select public from storage.buckets where id = 'intake-uploads'),",
    "  'bucket_file_size_limit', (select file_size_limit::bigint from storage.buckets where id = 'intake-uploads'),",
    "  'bucket_mime_count', coalesce((select cardinality(allowed_mime_types)::integer from storage.buckets where id = 'intake-uploads'), 0)",
    ")::text;",
    "commit;",
  ].join("\n");

  const command = new Deno.Command("psql", {
    args: [
      databaseUrl,
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-c",
      sql,
    ],
    env: {
      PGOPTIONS:
        "-c default_transaction_read_only=on -c statement_timeout=30000",
    },
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  if (!output.success) {
    throw new Error("read_only_postcheck_failed");
  }
  const raw = new TextDecoder().decode(output.stdout).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid_snapshot");
  }
  return parseSnapshot(parsed);
}

function buildPayload(runId: string, suffix: string): Record<string, unknown> {
  return {
    provider_name: "QA Focal DEV",
    provider_email: "qa-focal-" + runId + "@example.invalid",
    concept: "Provider intake focal retest " + suffix,
    amount_requested: 1,
    currency: "MXN",
  };
}

function buildMultipart(
  runId: string,
  suffix: string,
  file: File,
  fileKind: string,
  honeypot: string,
  captchaToken: string,
): FormData {
  const form = new FormData();
  form.set("payload", JSON.stringify(buildPayload(runId, suffix)));
  form.set("captcha_token", captchaToken);
  form.set("honeypot", honeypot);
  form.set("file_kinds", JSON.stringify([fileKind]));
  form.append("files", file);
  return form;
}

async function observeResponse(response: Response): Promise<HttpObservation> {
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  let error: string | null = null;
  let duplicate = false;
  let requestIdPresent = false;
  let maxTotalMb: number | null = null;

  if (contentType === "application/json") {
    try {
      const body = await response.json() as Record<string, unknown>;
      error = typeof body.error === "string" ? body.error : null;
      duplicate = body.duplicate === true;
      requestIdPresent = typeof body.request_id === "string";
      if (body.link && typeof body.link === "object") {
        const link = body.link as Record<string, unknown>;
        maxTotalMb = typeof link.max_total_mb === "number"
          ? link.max_total_mb
          : null;
      }
    } catch {
      error = "invalid_json_response";
    }
  } else {
    await response.arrayBuffer();
  }

  return {
    http: response.status,
    content_type: contentType,
    error,
    duplicate,
    request_id_present: requestIdPresent,
    max_total_mb: maxTotalMb,
  };
}

async function callFunction(
  route: "link-info" | "submit",
  token: string,
  init: RequestInit = {},
): Promise<HttpObservation> {
  const headers = new Headers(init.headers);
  headers.set("Origin", allowedOrigin);
  headers.set("X-Intake-Token", token);
  let response: Response;
  try {
    response = await fetch(baseUrl + "/" + route, {
      ...init,
      headers,
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new Error("network_request_failed");
  }
  return await observeResponse(response);
}

function addCheck(
  checks: Check[],
  id: string,
  passed: boolean,
  observed: Record<string, boolean | number | string | null>,
): void {
  checks.push({ id, status: passed ? "PASS" : "FAIL", observed });
}

function unchanged(
  before: Snapshot,
  after: Snapshot,
  fields: Array<keyof Snapshot>,
): boolean {
  return fields.every((field) => before[field] === after[field]);
}

async function main(): Promise<void> {
  const qaToken = requiredEnv("PROVIDER_INTAKE_QA_TOKEN");
  const captchaToken = requiredEnv("PROVIDER_INTAKE_CAPTCHA_TEST_TOKEN");
  const databaseUrl = requiredEnv("SUPABASE_DEV_DB_URL");
  const evidenceFile = requiredEnv("EVIDENCE_FILE");
  const runId = requiredEnv("GITHUB_RUN_ID");
  const headSha = requiredEnv("GITHUB_SHA");

  const checks: Check[] = [];

  currentStage = "initial_snapshot";
  const initial = await readSnapshot(databaseUrl);

  currentStage = "link_info";
  const linkInfo = await callFunction("link-info", qaToken, { method: "GET" });
  addCheck(
    checks,
    "QA-07-01-link-limit",
    linkInfo.http === 200 && linkInfo.max_total_mb === expectedMaxTotalMb,
    {
      http: linkInfo.http,
      content_type: linkInfo.content_type,
      max_total_mb: linkInfo.max_total_mb,
    },
  );

  currentStage = "under_limit_request";
  const underFile = new File(
    [new Uint8Array(expectedMaxFileBytes)],
    "qa-under-total-limit.bin",
    { type: "application/octet-stream" },
  );
  const under = await callFunction("submit", qaToken, {
    method: "POST",
    body: buildMultipart(
      runId,
      "under-limit",
      underFile,
      "other",
      "qa-stop",
      "not-used",
    ),
  });
  addCheck(
    checks,
    "QA-07-02-request-under-12mb",
    under.http === 400 &&
      under.content_type === "application/json" &&
      under.error === "invalid_request",
    {
      http: under.http,
      content_type: under.content_type,
      error: under.error,
    },
  );

  currentStage = "over_limit_request";
  const overBytes = Math.floor(12.5 * 1024 * 1024);
  const overFile = new File(
    [new Uint8Array(overBytes)],
    "qa-over-total-limit.bin",
    { type: "application/octet-stream" },
  );
  const over = await callFunction("submit", qaToken, {
    method: "POST",
    body: buildMultipart(
      runId,
      "over-limit",
      overFile,
      "other",
      "qa-stop",
      "not-used",
    ),
  });
  addCheck(
    checks,
    "QA-07-03-request-12_5mb",
    over.http === 413 &&
      over.content_type === "application/json" &&
      over.error === "payload_too_large",
    {
      http: over.http,
      content_type: over.content_type,
      error: over.error,
    },
  );

  currentStage = "qa07_post_snapshot";
  const afterQa07 = await readSnapshot(databaseUrl);
  const persistenceFields: Array<keyof Snapshot> = [
    "payment_intake",
    "payment_intake_files",
    "payment_intake_events",
    "storage_objects",
  ];
  addCheck(
    checks,
    "QA-07-04-no-persistence",
    unchanged(initial, afterQa07, persistenceFields),
    {
      intake_delta: afterQa07.payment_intake - initial.payment_intake,
      file_delta: afterQa07.payment_intake_files -
        initial.payment_intake_files,
      event_delta: afterQa07.payment_intake_events -
        initial.payment_intake_events,
      object_delta: afterQa07.storage_objects - initial.storage_objects,
    },
  );

  currentStage = "safe_xml_request";
  const safeXml = new File(
    ['<?xml version="1.0" encoding="UTF-8"?><cfdi Version="4.0"/>'],
    "qa-safe.xml",
    { type: "application/xml" },
  );
  const safe = await callFunction("submit", qaToken, {
    method: "POST",
    headers: {
      "Idempotency-Key": "bad",
    },
    body: buildMultipart(
      runId,
      "safe-xml",
      safeXml,
      "invoice_xml",
      "",
      captchaToken,
    ),
  });
  addCheck(
    checks,
    "QA-08-01-safe-xml-http",
    safe.http === 400 &&
      safe.content_type === "application/json" &&
      safe.error === "invalid_request" &&
      safe.request_id_present,
    {
      http: safe.http,
      content_type: safe.content_type,
      error: safe.error,
      request_id_present: safe.request_id_present,
    },
  );

  currentStage = "safe_xml_post_snapshot";
  const afterSafe = await readSnapshot(databaseUrl);
  addCheck(
    checks,
    "QA-08-02-safe-xml-persistence",
    unchanged(afterQa07, afterSafe, persistenceFields),
    {
      intake_delta: afterSafe.payment_intake - afterQa07.payment_intake,
      file_delta: afterSafe.payment_intake_files -
        afterQa07.payment_intake_files,
      event_delta: afterSafe.payment_intake_events -
        afterQa07.payment_intake_events,
      object_delta: afterSafe.storage_objects - afterQa07.storage_objects,
    },
  );

  currentStage = "dtd_request";
  const unsafeXml = new File(
    [
      '<?xml version="1.0"?><!DOCTYPE cfdi [<!ENTITY external SYSTEM "https://example.invalid/value">]><cfdi>&external;</cfdi>',
    ],
    "qa-dtd.xml",
    { type: "application/xml" },
  );
  const dtd = await callFunction("submit", qaToken, {
    method: "POST",
    headers: {
      "Idempotency-Key": "qa-focal-" + runId + "-dtd",
    },
    body: buildMultipart(
      runId,
      "dtd-entity",
      unsafeXml,
      "invoice_xml",
      "",
      captchaToken,
    ),
  });
  const dtdAccepted = (
    dtd.http === 415 &&
    dtd.content_type === "application/json" &&
    dtd.error === "file_type_not_allowed"
  ) || dtd.http === 403;
  addCheck(
    checks,
    "QA-08-03-dtd-entity-http",
    dtdAccepted,
    {
      http: dtd.http,
      content_type: dtd.content_type,
      error: dtd.error,
    },
  );

  currentStage = "final_snapshot";
  const final = await readSnapshot(databaseUrl);
  addCheck(
    checks,
    "QA-08-04-dtd-no-persistence",
    unchanged(initial, final, persistenceFields),
    {
      intake_delta: final.payment_intake - initial.payment_intake,
      file_delta: final.payment_intake_files - initial.payment_intake_files,
      event_delta: final.payment_intake_events -
        initial.payment_intake_events,
      object_delta: final.storage_objects - initial.storage_objects,
    },
  );

  addCheck(
    checks,
    "QA-13-01-payment-requests",
    final.payment_requests === expectedCore.payment_requests,
    { count: final.payment_requests, expected: expectedCore.payment_requests },
  );
  addCheck(
    checks,
    "QA-13-02-proveedores",
    final.proveedores === expectedCore.proveedores,
    { count: final.proveedores, expected: expectedCore.proveedores },
  );
  addCheck(
    checks,
    "QA-13-03-approval-batches",
    final.approval_batches === expectedCore.approval_batches,
    { count: final.approval_batches, expected: expectedCore.approval_batches },
  );
  addCheck(
    checks,
    "QA-13-04-notification-events",
    final.notification_events === expectedCore.notification_events,
    {
      count: final.notification_events,
      expected: expectedCore.notification_events,
    },
  );

  const duplicateTotal = final.duplicate_public_folios +
    final.duplicate_idempotency_keys +
    final.duplicate_storage_paths;
  addCheck(
    checks,
    "QA-15-01-no-duplicates",
    duplicateTotal === 0,
    {
      duplicate_public_folios: final.duplicate_public_folios,
      duplicate_idempotency_keys: final.duplicate_idempotency_keys,
      duplicate_storage_paths: final.duplicate_storage_paths,
    },
  );

  const orphanTotal = final.intakes_without_received +
    final.files_without_objects +
    final.objects_without_metadata;
  addCheck(
    checks,
    "QA-15-02-no-orphans",
    orphanTotal === 0,
    {
      intakes_without_received: final.intakes_without_received,
      files_without_objects: final.files_without_objects,
      objects_without_metadata: final.objects_without_metadata,
    },
  );

  const generalInvariants = final.active_links === 1 &&
    final.bucket_public === false &&
    final.bucket_file_size_limit === expectedMaxFileBytes &&
    final.bucket_mime_count === expectedMimeCount &&
    final.converted_intakes === 0 &&
    final.intake_notifications === 0;
  addCheck(
    checks,
    "QA-15-03-general-invariants",
    generalInvariants,
    {
      active_links: final.active_links,
      bucket_public: final.bucket_public,
      bucket_file_size_limit: final.bucket_file_size_limit,
      bucket_mime_count: final.bucket_mime_count,
      converted_intakes: final.converted_intakes,
      intake_notifications: final.intake_notifications,
    },
  );

  if (checks.length !== 15) {
    throw new Error("unexpected_check_count");
  }

  const passed = checks.filter((check) => check.status === "PASS").length;
  const failed = checks.length - passed;
  const evidence = {
    metadata: {
      project_ref: projectRef,
      branch: "feature/ramon-provider-intake-edge-function",
      head_sha: headSha,
      workflow_run_id: runId,
      function_name: "provider-intake",
      function_tree: functionTree,
      function_version_expected_minimum: 18,
      max_total_mb: expectedMaxTotalMb,
      generated_at_utc: new Date().toISOString(),
      scope: ["QA-07", "QA-08", "QA-13", "QA-15"],
      secrets_printed: false,
      migrations_executed: false,
      storage_admin_changes: false,
      new_links_created: false,
    },
    summary: {
      total: checks.length,
      passed,
      failed,
      p0: 0,
      p1: failed,
      result: failed === 0 ? "PASS" : "FAIL",
    },
    checks,
  };

  currentStage = "write_final_evidence";
  await writeEvidenceFile(evidenceFile, evidence);
  console.log(
    "Focal retest completed: " + passed + " PASS / " + failed + " FAIL.",
  );

  if (failed > 0) {
    Deno.exit(1);
  }
}

try {
  await main();
} catch (error) {
  await writeFailureEvidence(error);
  console.error("Focal retest stopped at sanitized stage: " + currentStage);
  Deno.exit(1);
}
