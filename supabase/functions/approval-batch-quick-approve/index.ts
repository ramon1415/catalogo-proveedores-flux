const PROD_ORIGIN = "https://flux.quantta.mx";
const MAX_TOKEN_LENGTH = 4096;
const MAX_BODY_BYTES = 8192;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

type Runtime = {
  env: (name: string) => string | undefined;
  fetch: typeof globalThis.fetch;
};

type TokenPayload = {
  version: number;
  notification_event_id: string;
  batch_id: string;
  director_id: string;
  submitted_at: string;
  snapshot_hash: string;
  expires_at: string;
  jti: string;
};

function corsHeaders(origin: string | null) {
  return origin === PROD_ORIGIN
    ? {
      "Access-Control-Allow-Origin": PROD_ORIGIN,
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
    }
    : { "Vary": "Origin" };
}

function jsonResponse(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function isIsoDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parsePayload(payloadSegment: string): TokenPayload {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(payloadSegment));
  const value = JSON.parse(decoded);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_payload");
  if (value.version !== 1
      || !UUID_PATTERN.test(value.notification_event_id)
      || !UUID_PATTERN.test(value.batch_id)
      || !UUID_PATTERN.test(value.director_id)
      || !isIsoDate(value.submitted_at)
      || !HASH_PATTERN.test(value.snapshot_hash)
      || !isIsoDate(value.expires_at)
      || !HASH_PATTERN.test(value.jti)) {
    throw new Error("invalid_claims");
  }
  return value as TokenPayload;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacIsValid(payloadSegment: string, signatureSegment: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(signatureSegment),
    new TextEncoder().encode(payloadSegment),
  );
}

async function safeText(response: Response) {
  try { return (await response.text()).slice(0, 300); } catch { return ""; }
}

async function rpc(runtime: Runtime, name: string, body: Record<string, unknown>) {
  const url = runtime.env("SUPABASE_URL")?.trim();
  const serviceKey = (
    runtime.env("SUPABASE_SERVICE_ROLE_KEY") || runtime.env("SUPABASESERVICEROLEKEY")
  )?.trim();
  if (!url || !serviceKey) throw new Error("runtime_unavailable");

  const response = await runtime.fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`rpc_failed:${response.status}:${await safeText(response)}`);
  return await response.json();
}

async function quickSecret(runtime: Runtime) {
  const envSecret = runtime.env("APPROVAL_BATCH_QUICK_APPROVE_SECRET")?.trim();
  if (envSecret && envSecret.length >= 32) return envSecret;
  const config = await rpc(runtime, "get_approval_batch_quick_approval_runtime_config", {});
  const secret = typeof config?.secret === "string" ? config.secret.trim() : "";
  if (secret.length < 32) throw new Error("quick_secret_unavailable");
  return secret;
}

function rpcPayload(payload: TokenPayload, jtiHash: string) {
  return {
    p_notification_event_id: payload.notification_event_id,
    p_batch_id: payload.batch_id,
    p_director_id: payload.director_id,
    p_submitted_at: payload.submitted_at,
    p_snapshot_hash: payload.snapshot_hash,
    p_expires_at: payload.expires_at,
    p_token_jti_hash: jtiHash,
  };
}

function publicResult(result: Record<string, unknown>) {
  const allowed = [
    "state", "label", "company", "period_start", "period_end", "item_count",
    "totals_by_currency", "expires_at", "review_url",
  ];
  return Object.fromEntries(allowed.filter((key) => key in result).map((key) => [key, result[key]]));
}

export async function handleRequest(req: Request, runtime: Runtime) {
  const origin = req.headers.get("origin");
  if (origin && origin !== PROD_ORIGIN) return jsonResponse({ state: "invalid" }, 403, origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ state: "invalid" }, 405, origin);

  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return jsonResponse({ state: "invalid" }, 413, origin);

  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return jsonResponse({ state: "invalid" }, 400, origin);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return jsonResponse({ state: "invalid" }, 400, origin);
  }

  const action = (input as Record<string, unknown>).action;
  const token = (input as Record<string, unknown>).token;
  if (!['preview', 'approve'].includes(String(action))
      || typeof token !== "string"
      || token.length < 20
      || token.length > MAX_TOKEN_LENGTH) {
    return jsonResponse({ state: "invalid" }, 400, origin);
  }

  let payload: TokenPayload;
  let payloadSegment: string;
  let signatureSegment: string;
  try {
    const segments = token.split(".");
    if (segments.length !== 2) throw new Error("invalid_token_format");
    [payloadSegment, signatureSegment] = segments;
    payload = parsePayload(payloadSegment);
  } catch {
    return jsonResponse({ state: "invalid" }, 400, origin);
  }

  try {
    const secret = await quickSecret(runtime);
    if (!await hmacIsValid(payloadSegment, signatureSegment, secret)) {
      return jsonResponse({ state: "invalid" }, 401, origin);
    }
    const jtiHash = await sha256Hex(payload.jti);
    const result = await rpc(
      runtime,
      action === "preview"
        ? "preview_approval_batch_quick_approval"
        : "approve_approval_batch_quick",
      rpcPayload(payload, jtiHash),
    );
    return jsonResponse(publicResult(result), 200, origin);
  } catch {
    return jsonResponse({ state: "invalid" }, 400, origin);
  }
}

if (typeof Deno !== "undefined") {
  Deno.serve((req) => handleRequest(req, {
    env: (name) => Deno.env.get(name),
    fetch: globalThis.fetch.bind(globalThis),
  }));
}
