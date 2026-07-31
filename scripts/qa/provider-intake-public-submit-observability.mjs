import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import {
  CANONICAL_DEV_PORTAL_ORIGIN,
  CANONICAL_DEV_PORTAL_URL,
  CANONICAL_PUBLIC_SUBMIT_ENDPOINT,
  createCanonicalBrowserSubmitController,
} from "./provider-intake-qa-credential-resolver.mjs"

export const AUTHORIZED_DEV_PROJECT_REF = "scsirgbuqjcwoaxfacth"
export const CANONICAL_IDEMPOTENCY_HEADER = "Idempotency-Key"
export const RESPONSE_HEADER_ALLOWLIST = Object.freeze([
  "content-type", "access-control-allow-origin", "vary", "x-request-id",
  "sb-request-id", "x-deno-execution-id", "cf-ray", "server", "via",
])

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu
const KNOWN_PUBLIC_CODES = new Set([
  "origin_required", "origin_not_allowed", "captcha_failed", "link_not_available",
  "invalid_token_format", "content_type_not_supported", "invalid_request",
  "rate_limit_exceeded", "too_many_requests",
])

export class PublicSubmitObservabilityError extends Error {
  constructor(code, details = {}) {
    super(code)
    this.name = "PublicSubmitObservabilityError"
    this.code = code
    this.details = details
  }
}

function gate(value, code, details = {}) {
  if (!value) throw new PublicSubmitObservabilityError(code, details)
}

function safeText(value) {
  return String(value ?? "").trim()
}

function hashPrefix(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12)
}

function sizeBucket(size) {
  if (size === 0) return "0"
  if (size <= 256) return "1_256"
  if (size <= 1024) return "257_1024"
  if (size <= 4096) return "1025_4096"
  return "4097_PLUS"
}

function payloadSchemaFingerprint(payload) {
  return "sha256:" + hashPrefix(Object.keys(payload || {}).sort().join("|"))
}

export function derivePreviewOrigin(previewUrl) {
  const raw = String(previewUrl ?? "")
  gate(raw === raw.trim() && raw.length > 0, "PREVIEW_ORIGIN_INVALID")
  gate(!/[A-Z]/u.test(raw), "PREVIEW_ORIGIN_INVALID")
  gate(!raw.endsWith("/"), "PREVIEW_ORIGIN_INVALID")
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new PublicSubmitObservabilityError("PREVIEW_ORIGIN_INVALID")
  }
  gate(parsed.protocol === "https:", "PREVIEW_ORIGIN_INVALID")
  gate(parsed.hostname.endsWith(".vercel.app"), "PREVIEW_ORIGIN_INVALID")
  gate(!parsed.port, "PREVIEW_ORIGIN_INVALID")
  gate(parsed.pathname === "/" && !parsed.search && !parsed.hash, "PREVIEW_ORIGIN_INVALID")
  gate(parsed.origin === "https://" + parsed.hostname, "PREVIEW_ORIGIN_INVALID")
  return parsed.origin
}

export function classifyAuthorizedPublicSubmitEndpoint(endpoint) {
  const raw = String(endpoint ?? "")
  gate(raw === raw.trim() && raw.length > 0, "PUBLIC_SUBMIT_ENDPOINT_INVALID")
  gate(!/^https:\/\/[^/?#]+:\d+(?:[/?#]|$)/iu.test(raw), "PUBLIC_SUBMIT_ENDPOINT_INVALID")
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new PublicSubmitObservabilityError("PUBLIC_SUBMIT_ENDPOINT_INVALID")
  }
  gate(parsed.protocol === "https:", "PUBLIC_SUBMIT_ENDPOINT_INVALID")
  gate(parsed.hostname === AUTHORIZED_DEV_PROJECT_REF + ".supabase.co", "UNAUTHORIZED_PROJECT_REF")
  gate(!parsed.port && !parsed.search && !parsed.hash, "PUBLIC_SUBMIT_ENDPOINT_INVALID")
  gate(parsed.pathname === "/functions/v1/provider-intake/submit", "PUBLIC_SUBMIT_ENDPOINT_INVALID")
  return "SUPABASE_DEV_PUBLIC_SUBMIT"
}

function validatePayload(payload) {
  gate(payload && typeof payload === "object" && !Array.isArray(payload), "PUBLIC_SUBMIT_PAYLOAD_INVALID")
  return payload
}

export function buildPublicSubmitRequest({
  endpoint,
  previewOrigin,
  intakeToken,
  idempotencyKey,
  captchaToken,
  payload,
} = {}) {
  classifyAuthorizedPublicSubmitEndpoint(endpoint)
  const origin = derivePreviewOrigin(previewOrigin)
  const token = safeText(intakeToken)
  const idempotency = safeText(idempotencyKey)
  const captcha = safeText(captchaToken)
  gate(TOKEN_PATTERN.test(token), "PUBLIC_SUBMIT_TOKEN_INVALID")
  gate(IDEMPOTENCY_PATTERN.test(idempotency), "CANONICAL_IDEMPOTENCY_HEADER_REQUIRED")
  gate(Boolean(captcha), "PUBLIC_SUBMIT_CAPTCHA_INVALID")
  validatePayload(payload)
  const headers = new Headers()
  headers.set("Content-Type", "application/json")
  headers.set("X-Intake-Token", token)
  headers.set(CANONICAL_IDEMPOTENCY_HEADER, idempotency)
  headers.set("Origin", origin)
  gate(!headers.has("authorization"), "PUBLIC_SUBMIT_AUTHORIZATION_FORBIDDEN")
  gate(!headers.has("apikey"), "PUBLIC_SUBMIT_APIKEY_FORBIDDEN")
  gate(!headers.has("x-idempotency-key"), "CANONICAL_IDEMPOTENCY_HEADER_REQUIRED")
  return new Request(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ payload, captcha_token: captcha, honeypot: "" }),
  })
}

export async function captureFinalizedPublicSubmitRequest(request, {
  previewOrigin,
  sensitiveValues = [],
} = {}) {
  gate(request instanceof Request, "PUBLIC_SUBMIT_FINAL_REQUEST_INVALID")
  const endpointClass = classifyAuthorizedPublicSubmitEndpoint(request.url)
  const expectedOrigin = derivePreviewOrigin(previewOrigin)
  gate(request.method === "POST", "PUBLIC_SUBMIT_FINAL_REQUEST_INVALID")
  gate(request.headers.get("content-type")?.toLowerCase().includes("application/json"), "PUBLIC_SUBMIT_FINAL_REQUEST_INVALID")
  const origin = request.headers.get("origin")
  const token = request.headers.get("x-intake-token")
  const idempotency = request.headers.get("idempotency-key")
  gate(origin === expectedOrigin, "PREVIEW_ORIGIN_INVALID")
  gate(TOKEN_PATTERN.test(safeText(token)), "PUBLIC_SUBMIT_TOKEN_INVALID")
  gate(IDEMPOTENCY_PATTERN.test(safeText(idempotency)), "CANONICAL_IDEMPOTENCY_HEADER_REQUIRED")
  gate(!request.headers.has("x-idempotency-key"), "CANONICAL_IDEMPOTENCY_HEADER_REQUIRED")
  gate(!request.headers.has("authorization"), "PUBLIC_SUBMIT_AUTHORIZATION_FORBIDDEN")
  gate(!request.headers.has("apikey"), "PUBLIC_SUBMIT_APIKEY_FORBIDDEN")
  const body = await request.clone().text()
  let envelope
  try {
    envelope = JSON.parse(body)
  } catch {
    throw new PublicSubmitObservabilityError("PUBLIC_SUBMIT_FINAL_REQUEST_INVALID")
  }
  gate(envelope && typeof envelope === "object" && !Array.isArray(envelope), "PUBLIC_SUBMIT_FINAL_REQUEST_INVALID")
  gate(Boolean(safeText(envelope.captcha_token)), "PUBLIC_SUBMIT_CAPTCHA_INVALID")
  validatePayload(envelope.payload)
  const metadata = {
    method: request.method,
    endpoint_class: endpointClass,
    header_presence: { content_type: true, x_intake_token: true, idempotency_key: true, origin: true },
    content_type_class: "APPLICATION_JSON",
    origin_present: true,
    origin_class: "VERCEL_PREVIEW_ORIGIN",
    origin_format_valid: true,
    origin_value_exported: false,
    token_format_valid: true,
    idempotency_header_name: CANONICAL_IDEMPOTENCY_HEADER,
    idempotency_present: true,
    idempotency_value_exported: false,
    captcha_present: true,
    payload_schema_fingerprint: payloadSchemaFingerprint(envelope.payload),
    body_size_bucket: sizeBucket(Buffer.byteLength(body)),
    authorization_present: false,
    apikey_present: false,
    request_metadata_persisted: false,
  }
  assertSanitizedObservabilityEvidence(metadata, sensitiveValues)
  return Object.freeze(metadata)
}

function contentTypeClass(contentType) {
  const value = safeText(contentType).toLowerCase()
  if (value.includes("application/json")) return "JSON"
  if (value.includes("text/html")) return "HTML"
  if (value.includes("text/plain")) return "TEXT"
  return value ? "OTHER" : "ABSENT"
}

function safePublicCode(body) {
  const candidate = safeText(body?.error || body?.code)
  if (!candidate) return { present: false, value: null }
  return { present: true, value: KNOWN_PUBLIC_CODES.has(candidate) ? candidate : "unrecognized_public_code" }
}

function serverClass(headers) {
  const server = safeText(headers.get("server")).toLowerCase()
  const via = safeText(headers.get("via")).toLowerCase()
  if (server.includes("deno") || server.includes("edge")) return "EDGE"
  if (server.includes("kong") || via.includes("gateway")) return "GATEWAY"
  if (server.includes("cloudflare") || headers.has("cf-ray")) return "PLATFORM"
  return "UNKNOWN"
}

function correlationHeaders(headers) {
  const names = ["x-request-id", "sb-request-id", "x-deno-execution-id", "cf-ray"]
  const present = names.filter((name) => headers.has(name))
  return {
    present,
    fingerprints: Object.fromEntries(present.map((name) => [name, "sha256:" + hashPrefix(headers.get(name))])),
  }
}

export async function capturePublicSubmitResponse(response, {
  previewOrigin,
  sensitiveValues = [],
} = {}) {
  gate(response instanceof Response, "PUBLIC_SUBMIT_RESPONSE_INVALID")
  const expectedOrigin = derivePreviewOrigin(previewOrigin)
  const rawBody = await response.clone().text()
  const type = contentTypeClass(response.headers.get("content-type"))
  let parsed = null
  let jsonParseSuccess = false
  if (type === "JSON") {
    try {
      parsed = JSON.parse(rawBody)
      jsonParseSuccess = Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed))
    } catch {
      jsonParseSuccess = false
    }
  }
  const publicCode = jsonParseSuccess ? safePublicCode(parsed) : { present: false, value: null }
  const allowOrigin = response.headers.get("access-control-allow-origin")
  const correlation = correlationHeaders(response.headers)
  const metadata = {
    status: response.status,
    status_class: String(Math.floor(response.status / 100)) + "XX",
    content_type_class: type,
    json_parse_success: jsonParseSuccess,
    public_error_code_present: publicCode.present,
    public_error_code: publicCode.value,
    message_category: jsonParseSuccess && safeText(parsed?.message) ? "JSON_MESSAGE_PRESENT" : "NO_MESSAGE_EXPORTED",
    body_size_bucket: sizeBucket(Buffer.byteLength(rawBody)),
    access_control_allow_origin_present: Boolean(allowOrigin),
    access_control_allow_origin_class: !allowOrigin
      ? "ABSENT"
      : allowOrigin === expectedOrigin ? "MATCHES_PREVIEW_ORIGIN" : "PRESENT_NONMATCHING",
    vary_contains_origin: /(?:^|,)\s*origin\s*(?:,|$)/iu.test(safeText(response.headers.get("vary"))),
    correlation_headers_present: correlation.present,
    correlation_hash_prefixes: correlation.fingerprints,
    server_class: serverClass(response.headers),
    response_metadata_persisted: false,
    response_body_exported: false,
    response_headers_exported: false,
  }
  assertSanitizedObservabilityEvidence(metadata, sensitiveValues)
  return Object.freeze(metadata)
}

export function classifyPublicSubmitResponse(metadata) {
  gate(metadata && typeof metadata === "object", "PUBLIC_SUBMIT_RESPONSE_INVALID")
  if (metadata.status === 403 && metadata.public_error_code === "origin_required") {
    return { classification: "EDGE_ORIGIN_REQUIRED", classification_confidence: "HIGH" }
  }
  if (metadata.status === 403 && metadata.public_error_code === "origin_not_allowed") {
    return { classification: "EDGE_ORIGIN_NOT_ALLOWED", classification_confidence: "HIGH" }
  }
  if (metadata.status === 403 && metadata.json_parse_success && metadata.public_error_code &&
    metadata.public_error_code !== "unrecognized_public_code") {
    return { classification: "EDGE_APPLICATION_403_OTHER", classification_confidence: "MEDIUM" }
  }
  if (metadata.status === 403 && !metadata.public_error_code &&
    ["GATEWAY", "PLATFORM"].includes(metadata.server_class)) {
    return { classification: "GATEWAY_OR_PLATFORM_403", classification_confidence: "MEDIUM" }
  }
  if (metadata.status === 403) {
    return { classification: "PUBLIC_SUBMIT_403_UNCLASSIFIED", classification_confidence: "LOW" }
  }
  return { classification: "NON_403_RESPONSE", classification_confidence: "HIGH" }
}

export function assertSanitizedObservabilityEvidence(value, sensitiveValues = []) {
  gate(value && typeof value === "object" && !Array.isArray(value), "OBSERVABILITY_EVIDENCE_UNSANITIZED")
  const serialized = JSON.stringify(value).normalize("NFC")
  gate(!UUID_PATTERN.test(serialized), "OBSERVABILITY_EVIDENCE_UNSANITIZED")
  gate(!/"(?:authorization|apikey|x-intake-token)"\s*:\s*"[^"]+"/iu.test(serialized), "OBSERVABILITY_EVIDENCE_UNSANITIZED")
  gate(!/"(?:body|response_body|origin_value)"\s*:\s*"[^"]+"/iu.test(serialized), "OBSERVABILITY_EVIDENCE_UNSANITIZED")
  for (const item of sensitiveValues) {
    if (safeText(item) && serialized.includes(safeText(item).normalize("NFC"))) {
      throw new PublicSubmitObservabilityError("OBSERVABILITY_EVIDENCE_UNSANITIZED")
    }
  }
  return true
}

export function persistSanitizedEvidenceAtomically(destination, evidence, {
  sensitiveValues = [],
} = {}) {
  assertSanitizedObservabilityEvidence(evidence, sensitiveValues)
  const target = path.resolve(String(destination || ""))
  gate(path.isAbsolute(target), "EVIDENCE_PERSISTENCE_FAILURE")
  const directory = path.dirname(target)
  const temporary = path.join(
    directory,
    "." + path.basename(target) + "." + process.pid + "." + crypto.randomBytes(6).toString("hex") + ".tmp",
  )
  let descriptor = null
  try {
    fs.mkdirSync(directory, { recursive: true })
    descriptor = fs.openSync(temporary, "wx", 0o600)
    fs.writeFileSync(descriptor, JSON.stringify(evidence) + "\n", "utf8")
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = null
    fs.renameSync(temporary, target)
  } catch {
    if (descriptor !== null) fs.closeSync(descriptor)
    fs.rmSync(temporary, { force: true })
    throw new PublicSubmitObservabilityError("EVIDENCE_PERSISTENCE_FAILURE")
  }
  return { evidence_persisted: true, destination_class: "LOCAL_SANITIZED_EVIDENCE" }
}

export async function flushResponseEvidenceBeforeThrow(response, {
  previewOrigin,
  evidencePath,
  sensitiveValues = [],
  persist = persistSanitizedEvidenceAtomically,
} = {}) {
  const captured = await capturePublicSubmitResponse(response, { previewOrigin, sensitiveValues })
  const classification = classifyPublicSubmitResponse(captured)
  let persisted
  try {
    persisted = persist(evidencePath, {
      ...captured,
      ...classification,
      response_metadata_persisted: true,
    }, { sensitiveValues })
  } catch (error) {
    if (error instanceof PublicSubmitObservabilityError) throw error
    throw new PublicSubmitObservabilityError("EVIDENCE_PERSISTENCE_FAILURE")
  }
  gate(persisted?.evidence_persisted === true, "EVIDENCE_PERSISTENCE_FAILURE")
  const error = new PublicSubmitObservabilityError(
    "PUBLIC_SUBMIT_" + captured.status + "_" + classification.classification,
    { evidence_persisted: true, classification: classification.classification },
  )
  error.sanitizedEvidence = Object.freeze({
    ...captured, ...classification, response_metadata_persisted: true,
  })
  throw error
}

function syntheticInput(previewUrl) {
  return {
    endpoint: "https://" + AUTHORIZED_DEV_PROJECT_REF + ".supabase.co/functions/v1/provider-intake/submit",
    previewOrigin: previewUrl,
    intakeToken: "v6k_synthetic_intake_token_00000001",
    idempotencyKey: "v6k-synthetic-idempotency-0001",
    captchaToken: "v6k-synthetic-captcha",
    payload: {
      provider_name: "QA Synthetic Provider",
      provider_email: "qa-synthetic@example.invalid",
      concept: "V6K no-write contract",
      amount_requested: 1,
      currency: "MXN",
    },
  }
}

function openLoopback(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
}

function closeLoopback(server) {
  return new Promise((resolve) => server.close(() => resolve()))
}

export async function runPublicSubmitLoopbackNoWrite({ previewUrl } = {}) {
  const input = syntheticInput(previewUrl)
  const request = buildPublicSubmitRequest(input)
  const requestMetadata = await captureFinalizedPublicSubmitRequest(request, {
    previewOrigin: previewUrl,
    sensitiveValues: [input.intakeToken, input.idempotencyKey, input.captchaToken],
  })
  let observed = null
  const server = http.createServer((incoming, outgoing) => {
    const headers = incoming.headers
    observed = {
      method: incoming.method,
      origin_present: Boolean(headers.origin),
      origin_format_valid: headers.origin === derivePreviewOrigin(previewUrl),
      x_intake_token_present: Boolean(headers["x-intake-token"]),
      token_format_valid: TOKEN_PATTERN.test(safeText(headers["x-intake-token"])),
      idempotency_header_name: CANONICAL_IDEMPOTENCY_HEADER,
      idempotency_present: Boolean(headers["idempotency-key"]),
      legacy_idempotency_present: Boolean(headers["x-idempotency-key"]),
      content_type_class: safeText(headers["content-type"]).toLowerCase().includes("application/json")
        ? "APPLICATION_JSON" : "OTHER",
      authorization_present: Boolean(headers.authorization),
      apikey_present: Boolean(headers.apikey),
      service_role_present: Boolean(headers["x-service-role"] || headers["service-role"]),
      body_destroyed: false,
    }
    incoming.on("data", (chunk) => { if (Buffer.isBuffer(chunk)) chunk.fill(0) })
    incoming.on("end", () => {
      observed.body_destroyed = true
      outgoing.statusCode = 204
      outgoing.end()
    })
    incoming.resume()
  })
  let closed = false
  let result = null
  try {
    await openLoopback(server)
    const address = server.address()
    gate(address && typeof address === "object", "WIRE_CONTRACT_LOOPBACK_FAILED")
    const body = await request.clone().arrayBuffer()
    const localRequest = new Request("http://127.0.0.1:" + address.port + "/wire", {
      method: request.method, headers: request.headers, body, duplex: "half",
    })
    const response = await fetch(localRequest)
    gate(response.status === 204, "WIRE_CONTRACT_LOOPBACK_FAILED")
    gate(observed?.method === "POST", "WIRE_CONTRACT_LOOPBACK_FAILED")
    gate(observed.origin_present && observed.origin_format_valid, "WIRE_CONTRACT_LOOPBACK_FAILED")
    gate(observed.x_intake_token_present && observed.token_format_valid, "WIRE_CONTRACT_LOOPBACK_FAILED")
    gate(observed.idempotency_present && !observed.legacy_idempotency_present, "CANONICAL_IDEMPOTENCY_HEADER_REQUIRED")
    gate(observed.content_type_class === "APPLICATION_JSON", "WIRE_CONTRACT_LOOPBACK_FAILED")
    gate(!observed.authorization_present && !observed.apikey_present && !observed.service_role_present, "WIRE_CONTRACT_LOOPBACK_FAILED")
    gate(observed.body_destroyed, "WIRE_CONTRACT_LOOPBACK_FAILED")
    assertSanitizedObservabilityEvidence(observed)
    result = {
      mode: "public-submit-loopback-no-write",
      status: "WIRE_CONTRACT_LOOPBACK_PASS",
      request: requestMetadata,
      wire: observed,
      local_loopback_requests: 1,
      external_network_requests: 0,
      provider_intake_calls: 0,
      dev_writes: 0,
      mutable_execution: false,
      server_closed: false,
    }
  } finally {
    await closeLoopback(server)
    closed = true
  }
  gate(result, "WIRE_CONTRACT_LOOPBACK_FAILED")
  return { ...result, server_closed: closed }
}

export async function runSyntheticResponseMatrix({ previewUrl } = {}) {
  const origin = derivePreviewOrigin(previewUrl)
  const cases = [
    ["origin_required", new Response(JSON.stringify({ error: "origin_required", message: "required" }), { status: 403, headers: { "content-type": "application/json", "access-control-allow-origin": origin, vary: "Origin" } }), "EDGE_ORIGIN_REQUIRED"],
    ["origin_not_allowed", new Response(JSON.stringify({ error: "origin_not_allowed" }), { status: 403, headers: { "content-type": "application/json" } }), "EDGE_ORIGIN_NOT_ALLOWED"],
    ["application_other", new Response(JSON.stringify({ error: "invalid_request" }), { status: 403, headers: { "content-type": "application/json", server: "edge-runtime" } }), "EDGE_APPLICATION_403_OTHER"],
    ["plain_unclassified", new Response("blocked", { status: 403, headers: { "content-type": "text/plain" } }), "PUBLIC_SUBMIT_403_UNCLASSIFIED"],
    ["html_gateway", new Response("<html>blocked</html>", { status: 403, headers: { "content-type": "text/html", server: "kong" } }), "GATEWAY_OR_PLATFORM_403"],
    ["request_id", new Response("blocked", { status: 403, headers: { "content-type": "text/plain", "x-request-id": "synthetic-request-id" } }), "PUBLIC_SUBMIT_403_UNCLASSIFIED"],
    ["captcha", new Response(JSON.stringify({ error: "captcha_failed" }), { status: 400, headers: { "content-type": "application/json" } }), "NON_403_RESPONSE"],
    ["link", new Response(JSON.stringify({ error: "link_not_available" }), { status: 404, headers: { "content-type": "application/json" } }), "NON_403_RESPONSE"],
    ["content_type", new Response(JSON.stringify({ error: "content_type_not_supported" }), { status: 415, headers: { "content-type": "application/json" } }), "NON_403_RESPONSE"],
    ["rate_limit", new Response(JSON.stringify({ error: "rate_limit_exceeded" }), { status: 429, headers: { "content-type": "application/json" } }), "NON_403_RESPONSE"],
    ["edge_exception", new Response("internal", { status: 500, headers: { "content-type": "text/plain", server: "edge-runtime" } }), "NON_403_RESPONSE"],
    ["success", new Response(JSON.stringify({ status: "created" }), { status: 201, headers: { "content-type": "application/json" } }), "NON_403_RESPONSE"],
  ]
  const results = []
  for (const [scenario, response, expected] of cases) {
    const metadata = await capturePublicSubmitResponse(response, { previewOrigin: previewUrl })
    const classification = classifyPublicSubmitResponse(metadata)
    gate(classification.classification === expected, "RESPONSE_CLASSIFICATION_FAILED")
    results.push({
      scenario,
      status: metadata.status,
      classification: classification.classification,
      classification_confidence: classification.classification_confidence,
      metadata_sanitized: true,
    })
  }
  return {
    status: "PASS", cases: results, total: results.length,
    response_bodies_exported: false, headers_exported: false,
  }
}

export async function runPublicSubmitObservabilityAudit({ previewUrl } = {}) {
  const input = syntheticInput(previewUrl)
  const request = buildPublicSubmitRequest(input)
  const requestMetadata = await captureFinalizedPublicSubmitRequest(request, {
    previewOrigin: previewUrl,
    sensitiveValues: [input.intakeToken, input.idempotencyKey, input.captchaToken],
  })
  const matrix = await runSyntheticResponseMatrix({ previewUrl })
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v6k-observability-"))
  const evidencePath = path.join(directory, "response.json")
  let persisted = false
  let failureBlocked = false
  try {
    try {
      await flushResponseEvidenceBeforeThrow(
        new Response(JSON.stringify({ error: "origin_not_allowed" }), {
          status: 403, headers: { "content-type": "application/json" },
        }),
        {
          previewOrigin: previewUrl,
          evidencePath,
          sensitiveValues: [input.intakeToken, input.idempotencyKey, input.captchaToken],
        },
      )
    } catch (error) {
      gate(error?.details?.evidence_persisted === true, "EVIDENCE_PERSISTENCE_FAILURE")
      persisted = fs.existsSync(evidencePath)
    }
    try {
      await flushResponseEvidenceBeforeThrow(
        new Response("blocked", { status: 403, headers: { "content-type": "text/plain" } }),
        {
          previewOrigin: previewUrl,
          evidencePath: path.join(directory, "failure.json"),
          persist: () => { throw new Error("disk-unavailable") },
        },
      )
    } catch (error) {
      failureBlocked = error?.code === "EVIDENCE_PERSISTENCE_FAILURE"
    }
    gate(persisted && failureBlocked, "EVIDENCE_PERSISTENCE_FAILURE")
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
  return {
    mode: "public-submit-observability-audit",
    status: "PASS",
    canonical_idempotency_header: requestMetadata.idempotency_header_name,
    request_capture: requestMetadata,
    response_matrix: matrix,
    evidence_flush_before_throw: true,
    evidence_persistence_failure_blocks: true,
    evidence_temp_file_removed: !fs.existsSync(directory),
    external_network_requests: 0,
    provider_intake_calls: 0,
    dev_writes: 0,
    mutable_execution: false,
  }
}

export function certifyCanonicalBrowserSubmitContract() {
  const controller = createCanonicalBrowserSubmitController({
    portalUrl: CANONICAL_DEV_PORTAL_URL,
    endpoint: CANONICAL_PUBLIC_SUBMIT_ENDPOINT,
    enabled: false,
  })
  const contract = controller.sanitized()
  gate(contract.browser_origin === CANONICAL_DEV_PORTAL_ORIGIN, "CANONICAL_BROWSER_ORIGIN_REQUIRED")
  gate(contract.browser_path === "/solicitar.html", "CANONICAL_BROWSER_ORIGIN_REQUIRED")
  gate(contract.public_submit_calls === 0, "PUBLIC_SUBMIT_OCCURRED_DURING_CRED_A1")
  return Object.freeze({
    mode: "credential-adapter-browser-contract-no-write",
    status: "PASS",
    ...contract,
    runtime_turnstile_prepared: true,
    provider_intake_calls: 0,
    intake_tokens_generated: 0,
    real_captcha_tokens_generated: 0,
    links_created: 0,
    iam_changes: 0,
    dev_writes: 0,
    mutable_execution: false,
  })
}
