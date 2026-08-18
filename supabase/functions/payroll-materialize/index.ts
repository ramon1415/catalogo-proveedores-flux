// N3A server trust boundary. This function is intentionally not deployed by the
// N3A draft gate. The canonical N2A parser is imported; browser summaries are
// never accepted as authority.
import "../../../payroll_parser.js";

type ParserIssue = { code: string; source?: string; row?: number; field?: string };
type SpeiRecord = { amountMinor: number; sourceAccount: string };
type PayrollParser = {
  PARSER_VERSION: string;
  PAYROLL_SPEI_CONTRACT_VERSION: string;
  parsePayrollSpeiTxt(input: Uint8Array): {
    parserVersion: string;
    contractVersion: string;
    records: SpeiRecord[];
    issues: ParserIssue[];
  };
};

declare global {
  // Set by the canonical UMD parser imported above.
  var FluxPayrollParser: PayrollParser;
}

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/;

type MaterializeInput = {
  capture_session_id?: string;
  expected_version?: number;
  idempotency_key?: string;
};

type CaptureFile = {
  id: string; kind: string; channel: string | null; storage_bucket: string;
  storage_path: string; mime_type: string; size_bytes: number; sha256: string;
  capability_code: string; parser_version: string | null; parser_contract: string | null;
  record_count: number | null; total_amount_minor: number | null;
  object_size: number | null; object_mime: string | null;
};

type Context = {
  id: string; version: number; reserved_payment_request_id: string; company_id: string;
  capture_state: string; validation_status: string; expires_at: string;
  cost_center_id: string | null; expected_channels: string[]; source_accounts: Array<string | null> | null;
  files: CaptureFile[];
};

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_required_secret:${name}`);
  return value.replace(/\/$/, "");
}

function bearer(req: Request): string {
  const value = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(value)) throw new Error("PAYROLL_AUTH_REQUIRED");
  return value.replace(/^Bearer\s+/i, "");
}

async function apiJson(url: string, init: RequestInit, code: string): Promise<any> {
  const result = await fetch(url, init);
  if (!result.ok) throw new Error(code);
  return await result.json();
}

async function rpc(base: string, key: string, token: string, name: string, body: unknown): Promise<any> {
  return await apiJson(`${base}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, `PAYROLL_RPC_${name.toUpperCase()}_FAILED`);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function hashText(value: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(value));
}

function normalizeAccounts(values: Array<string | null> | null): Set<string> {
  return new Set((values || []).map((value) => String(value || "").replace(/\D/g, ""))
    .filter(Boolean).map((value) => value.padStart(18, "0")));
}

async function verifyFile(base: string, serviceKey: string, context: Context, file: CaptureFile) {
  if (file.storage_bucket !== "payroll-private" || !PATH_RE.test(file.storage_path)) {
    throw new Error("PAYROLL_FILE_PATH_MISMATCH");
  }
  const parts = file.storage_path.split("/");
  if (parts[0] !== context.company_id || parts[1] !== context.reserved_payment_request_id) {
    throw new Error("PAYROLL_FILE_PATH_MISMATCH");
  }
  if (file.object_size === null) throw new Error("PAYROLL_STORAGE_OBJECT_MISSING");
  if (Number(file.object_size) !== Number(file.size_bytes)) throw new Error("PAYROLL_FILE_SIZE_MISMATCH");

  const path = file.storage_path.split("/").map(encodeURIComponent).join("/");
  const downloaded = await fetch(`${base}/storage/v1/object/authenticated/payroll-private/${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!downloaded.ok) throw new Error("PAYROLL_STORAGE_OBJECT_MISSING");
  const bytes = new Uint8Array(await downloaded.arrayBuffer());
  if (bytes.byteLength !== Number(file.size_bytes)) throw new Error("PAYROLL_FILE_SIZE_MISMATCH");
  const mime = (downloaded.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (mime && mime !== file.mime_type.toLowerCase()) throw new Error("PAYROLL_FILE_MIME_MISMATCH");
  const digest = await sha256Hex(bytes);
  if (digest !== file.sha256) throw new Error("PAYROLL_FILE_HASH_MISMATCH");

  if (file.kind === "caratula") throw new Error("PAYROLL_COVER_SHEET_FORMAT_UNVERIFIED");
  if (file.kind === "layout_mismo_banco") throw new Error("PAYROLL_SAME_BANK_FORMAT_UNVERIFIED");
  if (file.kind === "cfdi_vales") throw new Error("PAYROLL_TOKA_FORMAT_UNVERIFIED");
  if (file.kind !== "layout_spei") throw new Error("PAYROLL_FILE_KIND_UNSUPPORTED");

  const parsed = globalThis.FluxPayrollParser.parsePayrollSpeiTxt(bytes);
  if (parsed.issues.length || !parsed.records.length) throw new Error("PAYROLL_SPEI_SERVER_PARSE_FAILED");
  const allowed = normalizeAccounts(context.source_accounts);
  if (!allowed.size || parsed.records.some((record) => !allowed.has(record.sourceAccount))) {
    throw new Error("PAYROLL_SOURCE_ACCOUNT_MISMATCH");
  }
  const total = parsed.records.reduce((sum, record) => {
    if (!Number.isSafeInteger(record.amountMinor) || record.amountMinor <= 0 || !Number.isSafeInteger(sum + record.amountMinor)) {
      throw new Error("PAYROLL_CHANNEL_TOTAL_INVALID");
    }
    return sum + record.amountMinor;
  }, 0);
  return {
    capture_file_id: file.id, kind: file.kind, authority: "server_verified",
    sha256: digest, parser_version: parsed.parserVersion,
    parser_contract: parsed.contractVersion, record_count: parsed.records.length,
    total_amount_minor: total,
    browser_server_match: file.record_count === parsed.records.length && file.total_amount_minor === total,
  };
}

async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return response(405, { error: "METHOD_NOT_ALLOWED" });
  try {
    const base = requiredEnv("SUPABASE_URL");
    const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const token = bearer(req);
    const input = await req.json() as MaterializeInput;
    if (!input.capture_session_id || !Number.isInteger(input.expected_version) || !input.idempotency_key?.trim()) {
      return response(400, { error: "PAYROLL_MATERIALIZATION_INPUT_INVALID" });
    }

    const user = await apiJson(`${base}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    }, "PAYROLL_AUTH_REQUIRED");
    // User-scoped RPC is the certified Finance gate. Director/SysAdmin alone fail here.
    const visible = await rpc(base, serviceKey, token, "get_payroll_capture_sessions", {
      p_session_id: input.capture_session_id,
    });
    if (!Array.isArray(visible) || visible.length !== 1) throw new Error("PAYROLL_FINANCE_REQUIRED");

    const profiles = await apiJson(
      `${base}/rest/v1/profiles?select=id&auth_user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      "PAYROLL_ACTOR_PROFILE_REQUIRED",
    );
    if (!Array.isArray(profiles) || profiles.length !== 1) throw new Error("PAYROLL_ACTOR_PROFILE_REQUIRED");

    const context = await rpc(base, serviceKey, serviceKey, "get_payroll_materialization_context_internal", {
      p_capture_session_id: input.capture_session_id, p_expected_version: input.expected_version,
    }) as Context;
    if (context.capture_state === "materialized") throw new Error("PAYROLL_CAPTURE_ALREADY_MATERIALIZED");
    if (new Date(context.expires_at).getTime() <= Date.now()) throw new Error("PAYROLL_CAPTURE_EXPIRED");
    if (!context.cost_center_id) throw new Error("PAYROLL_CAPTURE_ACCOUNTING_CONTEXT_REQUIRED");
    if (!context.files.length) throw new Error("PAYROLL_REQUIRED_FILES_MISSING");

    const verifiedFiles = [];
    for (const file of context.files) verifiedFiles.push(await verifyFile(base, serviceKey, context, file));

    // Until the cover adapter is certified, verifyFile always fails closed before
    // reaching this transaction. This result shape is the future server-only handoff.
    const result = await rpc(base, serviceKey, serviceKey, "materialize_payroll_capture_internal", {
      p_capture_session_id: context.id,
      p_expected_version: context.version,
      p_idempotency_key_hash: await hashText(input.idempotency_key),
      p_server_result: {
        contract_version: globalThis.FluxPayrollParser.PARSER_VERSION,
        valid: true, issues: [], capture_session_id: context.id, capture_version: context.version,
        actor_profile_id: profiles[0].id, verified_at: new Date().toISOString(),
        parser_versions: [globalThis.FluxPayrollParser.PARSER_VERSION],
        files: verifiedFiles, channels: [], lines: [],
      },
    });
    return response(200, result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "PAYROLL_MATERIALIZATION_FAILED";
    const safe = /^PAYROLL_[A-Z0-9_]+$/.test(code) ? code : "PAYROLL_MATERIALIZATION_FAILED";
    return response(safe.endsWith("REQUIRED") ? 403 : 409, { error: safe });
  }
}

Deno.serve(handler);

export { handler, sha256Hex, verifyFile };
