import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const phase = process.argv[2] || "inspect";
const PROJECT_REF = process.env.PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const FUNCTION_BASE_URL = process.env.FUNCTION_BASE_URL;
const CANONICAL_ORIGIN = process.env.CANONICAL_ORIGIN;
const PREVIEW_ORIGIN = process.env.PREVIEW_ORIGIN;
const CANONICAL_PRIVACY_URL = process.env.CANONICAL_PRIVACY_URL;
const EXPECTED_FUNCTION_ID = process.env.EXPECTED_FUNCTION_ID;
const AUTHORIZED_DEPLOYMENT_VERSION = Number(
  process.env.AUTHORIZED_DEPLOYMENT_VERSION,
);
const EXPECTED_FUNCTION_UPDATED_AT = Number(
  process.env.EXPECTED_FUNCTION_UPDATED_AT,
);
const EXPECTED_BUNDLE_SHA256 = process.env.EXPECTED_BUNDLE_SHA256;
const EXPECTED_BACKEND_TREE = process.env.EXPECTED_BACKEND_TREE;
const OUTPUT_DIR = process.env.POSTMERGE_OUTPUT_DIR;
const BEFORE_FILE = path.join(OUTPUT_DIR, "before.json");
const FINAL_FILE = path.join(OUTPUT_DIR, "postmerge_results_sanitized.json");
const SOURCE_COMPARISON_FILE = path.join(
  OUTPUT_DIR,
  "runtime-source-comparison.json",
);

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeDigest(value) {
  return String(value || "").toLowerCase().replace(/^sha256:/, "");
}

function secretMatch(entry, expectedValue) {
  if (!entry) return { matches: false, field: null };
  const expectedDigest = sha256(expectedValue);
  for (const [field, value] of Object.entries(entry)) {
    if (field === "name" || typeof value !== "string") continue;
    if (
      normalizeDigest(value) === expectedDigest ||
      sha256(value) === expectedDigest
    ) {
      return { matches: true, field };
    }
  }
  return { matches: false, field: null };
}

function secretDescriptor(entry) {
  if (!entry) return null;
  return {
    keys: Object.keys(entry).sort(),
    fingerprint_fields: Object.entries(entry)
      .filter(
        ([field, value]) =>
          typeof value === "string" && /(digest|hash|value)/i.test(field),
      )
      .map(([field, value]) => ({ field, length: value.length })),
  };
}

async function managementFetch(route) {
  const response = await fetch(`https://api.supabase.com${route}`, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      Accept: "application/json",
    },
  });
  const body = await response.json().catch(() => null);
  assert(response.ok && body, `management_api_${response.status}`);
  return body;
}

async function secretState() {
  const secrets = await managementFetch(`/v1/projects/${PROJECT_REF}/secrets`);
  assert(Array.isArray(secrets), "secret_list_invalid");
  const byName = new Map(secrets.map((entry) => [entry.name, entry]));
  const corsEntry = byName.get("INTAKE_ALLOWED_ORIGINS");
  const privacyEntry = byName.get("INTAKE_PRIVACY_NOTICE_URL");
  const corsMatch = secretMatch(corsEntry, CANONICAL_ORIGIN);
  const privacyMatch = secretMatch(privacyEntry, CANONICAL_PRIVACY_URL);
  return {
    response_entry_keys: [...new Set(secrets.flatMap((entry) => Object.keys(entry)))].sort(),
    cors_present: Boolean(corsEntry),
    cors_match: corsMatch.matches,
    cors_match_field: corsMatch.field,
    cors_descriptor: secretDescriptor(corsEntry),
    privacy_present: Boolean(privacyEntry),
    privacy_match: privacyMatch.matches,
    privacy_match_field: privacyMatch.field,
    privacy_descriptor: secretDescriptor(privacyEntry),
    captcha_expected_hostname_absent: !byName.has("CAPTCHA_EXPECTED_HOSTNAME"),
    captcha_expected_action_absent: !byName.has("CAPTCHA_EXPECTED_ACTION"),
  };
}

async function runtimeState() {
  const fn = await managementFetch(
    `/v1/projects/${PROJECT_REF}/functions/provider-intake`,
  );
  return {
    id: fn.id,
    slug: fn.slug,
    status: fn.status,
    version: Number(fn.version),
    verify_jwt: Boolean(fn.verify_jwt),
    created_at: fn.created_at || null,
    updated_at: fn.updated_at || null,
    ezbr_sha256: fn.ezbr_sha256 || null,
    entrypoint_path: fn.entrypoint_path || null,
    import_map_path: fn.import_map_path || null,
    metadata_keys: Object.keys(fn).sort(),
  };
}

async function preflight(origin) {
  const response = await fetch(`${FUNCTION_BASE_URL}/link-info`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "X-Intake-Token",
    },
  });
  return {
    status: response.status,
    allow_origin: response.headers.get("access-control-allow-origin"),
  };
}

async function neutralLinkInfo() {
  const response = await fetch(`${FUNCTION_BASE_URL}/link-info`, {
    method: "GET",
    headers: {
      Origin: CANONICAL_ORIGIN,
      "X-Intake-Token": "A".repeat(32),
    },
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  const body = await response.json().catch(() => null);
  return {
    status: response.status,
    allow_origin: response.headers.get("access-control-allow-origin"),
    error: body?.error || null,
  };
}

async function noTokenBrowser() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleErrors = [];
  const pageErrors = [];
  const turnstileRequests = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("vercel.live") || text.includes("favicon.ico")) return;
    consoleErrors.push(text.slice(0, 300));
  });
  page.on("pageerror", (error) => pageErrors.push(String(error.message).slice(0, 300)));
  page.on("request", (request) => {
    if (request.url().startsWith("https://challenges.cloudflare.com/turnstile")) {
      turnstileRequests.push(request.url().split("?")[0]);
    }
  });
  await page.goto(`${CANONICAL_ORIGIN}/solicitar.html`, {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.locator("#unavailable-view").waitFor({ state: "visible" });
  const result = {
    status_title: (await page.locator("#unavailable-title").textContent())?.trim(),
    status_message: (await page.locator("#unavailable-message").textContent())?.trim(),
    form_visible: await page.locator("#form-view").isVisible(),
    turnstile_script_present:
      (await page.locator('script[data-intake-turnstile="true"]').count()) > 0,
    turnstile_request_count: turnstileRequests.length,
    console_error_count: consoleErrors.length,
    page_error_count: pageErrors.length,
    url_has_fragment: new URL(page.url()).hash.length > 0,
  };
  await browser.close();
  assert(result.status_title === "Este enlace no está disponible.", "no_token_title");
  assert(
    result.status_message ===
      "Solicita un enlace vigente a tu contacto de Finanzas.",
    "no_token_message",
  );
  assert(!result.form_visible, "no_token_form_visible");
  assert(!result.turnstile_script_present, "no_token_turnstile_script");
  assert(result.turnstile_request_count === 0, "no_token_turnstile_request");
  assert(result.console_error_count === 0, "no_token_console_error");
  assert(result.page_error_count === 0, "no_token_page_error");
  assert(!result.url_has_fragment, "no_token_fragment");
  return result;
}

function assertRuntime(runtime) {
  assert(runtime.id === EXPECTED_FUNCTION_ID, "function_id_changed");
  assert(runtime.slug === "provider-intake", "function_slug_changed");
  assert(runtime.status === "ACTIVE", "function_not_active");
  assert(
    Number.isInteger(runtime.version) &&
      runtime.version >= AUTHORIZED_DEPLOYMENT_VERSION,
    "function_configuration_revision_regressed",
  );
  assert(runtime.verify_jwt === false, "function_verify_jwt_changed");
  assert(
    runtime.updated_at === EXPECTED_FUNCTION_UPDATED_AT,
    "function_deployment_timestamp_changed",
  );
  assert(
    runtime.ezbr_sha256 === EXPECTED_BUNDLE_SHA256,
    "function_bundle_hash_changed",
  );
}

async function snapshot() {
  const [
    secrets,
    runtime,
    canonicalPreflight,
    previewPreflight,
    linkInfo,
    browser,
    sourceComparisonRaw,
  ] = await Promise.all([
    secretState(),
    runtimeState(),
    preflight(CANONICAL_ORIGIN),
    preflight(PREVIEW_ORIGIN),
    neutralLinkInfo(),
    noTokenBrowser(),
    fs.readFile(SOURCE_COMPARISON_FILE, "utf8"),
  ]);
  const sourceComparison = JSON.parse(sourceComparisonRaw);
  assert(sourceComparison.runtime_source_match, "runtime_source_mismatch");
  assert(
    sourceComparison.approved_backend_tree === EXPECTED_BACKEND_TREE,
    "runtime_source_tree_mismatch",
  );
  return {
    generated_at: new Date().toISOString(),
    environment: "DEV",
    project_ref: PROJECT_REF,
    merge_commit: "05986aca63f2d98635cbb9b928cd0cebac29315a",
    backend_tree: EXPECTED_BACKEND_TREE,
    secrets,
    runtime,
    cors: {
      canonical_preflight: canonicalPreflight,
      preview_preflight: previewPreflight,
      neutral_link_info: linkInfo,
    },
    browser_no_token: browser,
    runtime_integrity: {
      authorized_deployment_reported_version: AUTHORIZED_DEPLOYMENT_VERSION,
      current_management_api_version: runtime.version,
      deployment_timestamp_unchanged:
        runtime.updated_at === EXPECTED_FUNCTION_UPDATED_AT,
      bundle_hash_match: runtime.ezbr_sha256 === EXPECTED_BUNDLE_SHA256,
      deployed_source_matches_approved_tree:
        sourceComparison.runtime_source_match,
      approved_backend_tree: EXPECTED_BACKEND_TREE,
      classification:
        "platform_configuration_revision_changed_without_runtime_source_or_deployment_timestamp_change",
    },
    security: {
      submit_requests: 0,
      sql_executed: false,
      function_deployed: false,
      qa_token_available: false,
      qa_link_mutated: false,
    },
  };
}

async function inspect() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const result = await snapshot();
  await fs.writeFile(BEFORE_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(
    `inspect | runtime=${result.runtime.status}-v${result.runtime.version} verify_jwt=${result.runtime.verify_jwt} function_id_match=${result.runtime.id === EXPECTED_FUNCTION_ID} cors_match=${result.secrets.cors_match} privacy_match=${result.secrets.privacy_match} captcha_expected_absent=${result.secrets.captcha_expected_hostname_absent && result.secrets.captcha_expected_action_absent}`,
  );
  assertRuntime(result.runtime);
  assert(result.secrets.captcha_expected_hostname_absent, "captcha_hostname_present");
  assert(result.secrets.captcha_expected_action_absent, "captcha_action_present");
}

async function verify() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  let result = null;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    result = await snapshot();
    assertRuntime(result.runtime);
    assert(result.secrets.captcha_expected_hostname_absent, "captcha_hostname_present");
    assert(result.secrets.captcha_expected_action_absent, "captcha_action_present");
    const ready =
      result.secrets.cors_match &&
      result.secrets.privacy_match &&
      result.cors.canonical_preflight.status === 204 &&
      result.cors.canonical_preflight.allow_origin === CANONICAL_ORIGIN &&
      result.cors.preview_preflight.status === 403 &&
      !result.cors.preview_preflight.allow_origin &&
      result.cors.neutral_link_info.status === 404 &&
      result.cors.neutral_link_info.allow_origin === CANONICAL_ORIGIN &&
      result.cors.neutral_link_info.error === "link_not_available";
    if (ready) break;
    if (attempt === 12) throw new Error("postmerge_runtime_not_converged");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  result.status = "PASS";
  result.protected_link_smoke = {
    status: "NOT_RUN",
    reason:
      "PROVIDER_INTAKE_QA_TOKEN was removed after UAT and no protected local source exists; SQL and token rotation were prohibited.",
  };
  await fs.writeFile(FINAL_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(
    `verify | status=PASS canonical_preflight=204 preview_preflight=403 neutral_link_info=404 runtime=${result.runtime.status}-v${result.runtime.version} submits=0`,
  );
}

if (phase === "inspect") await inspect();
else if (phase === "verify") await verify();
else throw new Error("unknown_phase");
