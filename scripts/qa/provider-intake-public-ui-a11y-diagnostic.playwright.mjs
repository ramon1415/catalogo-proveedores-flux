import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";

const { Client } = pg;
const phase = process.argv[2] || "diagnostic";
const PREVIEW_URL = process.env.PREVIEW_URL;
const PREVIEW_ORIGIN = process.env.PREVIEW_ORIGIN;
const FUNCTION_BASE_URL = process.env.FUNCTION_BASE_URL;
const TOKEN = process.env.PROVIDER_INTAKE_QA_TOKEN || "";
const DB_URL = process.env.SUPABASE_DEV_DB_URL || "";
const LINK_ID = process.env.QA_LINK_ID;
const RUN_ID = String(process.env.GITHUB_RUN_ID || "local").replace(/[^0-9A-Za-z_-]/g, "");
const WORK_DIR = process.env.DIAGNOSTIC_WORK_DIR || path.join(process.cwd(), ".a11y-diagnostic-temp");
const OUTPUT_DIR = process.env.DIAGNOSTIC_OUTPUT_DIR || path.join(WORK_DIR, "evidence");
const RESTORE_FILE = path.join(WORK_DIR, "link-restore.json");
const LINK_STATE_FILE = path.join(WORK_DIR, "link-state.json");
const BASELINE_FILE = path.join(WORK_DIR, "baseline.json");
const SAFE_XML_PATH = path.join(WORK_DIR, "QA_Fase1C_XML_seguro.xml");
const SCREENSHOT_PATH = path.join(OUTPUT_DIR, "documents-step-sanitized.png");

const SAFE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<qaSolicitud>
  <entorno>DEV</entorno>
  <concepto>Diagnostico focal de accesibilidad</concepto>
  <monto moneda="MXN">1.23</monto>
</qaSolicitud>
`;

const report = {
  report_version: "provider-intake-public-ui-a11y-diagnostic/1.0",
  generated_at: new Date().toISOString(),
  environment: "DEV",
  pr: 256,
  approved_portal_head: "083332d2ee9ec5dc0f8b3ff8a786f5426b576cc4",
  backend_tree: "379f65801609e40143d948b3de702e391636c512",
  run_id: RUN_ID,
  status: "BLOCKED",
  link: {
    id: LINK_ID,
    temporary_expiry_extension: false,
    restored_by_always_step: null,
  },
  flow: {
    fragment_removed: false,
    link_info_status: null,
    safe_xml_added: false,
    file_kind: null,
    usage_updated: false,
    turnstile_loaded: false,
    submit_requests: 0,
    intake_delta: null,
  },
  scans: {},
  classification: {
    exact_authorized_match: false,
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
    unexpected_blocking_rules: [],
  },
  browser: {
    engine: "chromium",
    headed_under_xvfb: true,
    playwright: "1.55.0",
    axe_core_playwright: "4.10.2",
  },
  console_errors: [],
  external_warnings: [],
  page_errors: [],
  failed_requests: [],
  screenshot: "documents-step-sanitized.png",
  security: {
    submit_allowed: false,
    captcha_allowed: false,
    token_logged: false,
    fragment_in_artifact: false,
    input_values_captured: false,
    inner_html_captured: false,
    har_generated: false,
    trace_generated: false,
    video_generated: false,
  },
};

function requireEnv(names) {
  for (const name of names) {
    if (!process.env[name]) throw new Error(`missing_environment_${name.toLowerCase()}`);
  }
}

function sanitizeText(value, max = 800) {
  let text = String(value ?? "");
  if (TOKEN) text = text.split(TOKEN).join("[REDACTED_TOKEN]");
  if (DB_URL) text = text.split(DB_URL).join("[REDACTED_DB_URL]");
  text = text
    .replace(/#token=[A-Za-z0-9_-]{16,}/gi, "#token=[REDACTED]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/g, "[REDACTED_RFC]")
    .replace(/\b\d{18}\b/g, "[REDACTED_CLABE]")
    .replace(/\bINT-\d{4}-\d{6}\b/g, "INT-****-******");
  return text.slice(0, max);
}

function sanitizeSelector(value) {
  const selector = sanitizeText(value, 220);
  return selector.replace(/[^\w#.[\]="'():>*+~ -]/g, "");
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function assertEqual(actual, expected, code) {
  if (actual !== expected) throw new Error(`${code}:${sanitizeText(actual)}`);
}

async function ensureDirs() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(WORK_DIR, { recursive: true });
}

async function dbClient() {
  const connection = new URL(DB_URL);
  connection.searchParams.delete("sslmode");
  connection.searchParams.delete("ssl");
  connection.searchParams.delete("uselibpqcompat");
  const client = new Client({
    connectionString: connection.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

async function readNoSubmitCounts(client) {
  const result = await client.query(`
    select
      (select count(*)::int from public.payment_intake) as payment_intake,
      (select count(*)::int from public.payment_intake_files) as payment_intake_files,
      (select count(*)::int from storage.objects where bucket_id = 'intake-uploads') as storage_objects
  `);
  return result.rows[0];
}

async function fetchLinkInfo() {
  const response = await fetch(`${FUNCTION_BASE_URL}/link-info`, {
    method: "GET",
    headers: { "X-Intake-Token": TOKEN, Origin: PREVIEW_ORIGIN },
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;
  return {
    status: response.status,
    body,
    allowOrigin: response.headers.get("access-control-allow-origin"),
  };
}

async function prepare() {
  requireEnv([
    "PREVIEW_URL",
    "PREVIEW_ORIGIN",
    "FUNCTION_BASE_URL",
    "PROVIDER_INTAKE_QA_TOKEN",
    "SUPABASE_DEV_DB_URL",
    "QA_LINK_ID",
  ]);
  assert(/^[A-Za-z0-9_-]{32,256}$/.test(TOKEN), "qa_token_format_invalid");
  await ensureDirs();
  await fs.writeFile(SAFE_XML_PATH, SAFE_XML, { encoding: "utf8", mode: 0o600 });

  const client = await dbClient();
  try {
    const result = await client.query(
      `select id, status, expires_at, updated_at
         from public.intake_links
        where id = $1`,
      [LINK_ID],
    );
    assertEqual(result.rowCount, 1, "qa_link_missing");
    const link = result.rows[0];
    assertEqual(link.status, "active", "qa_link_not_active");

    const expired = link.expires_at && new Date(link.expires_at).getTime() <= Date.now();
    if (expired) {
      const snapshot = {
        id: LINK_ID,
        expires_at: new Date(link.expires_at).toISOString(),
        updated_at: new Date(link.updated_at).toISOString(),
      };
      await fs.writeFile(RESTORE_FILE, JSON.stringify(snapshot), {
        encoding: "utf8",
        mode: 0o600,
      });
      await client.query(
        `update public.intake_links
            set expires_at = now() + interval '3 hours',
                updated_at = now()
          where id = $1
            and status = 'active'`,
        [LINK_ID],
      );
      report.link.temporary_expiry_extension = true;
      await fs.writeFile(
        LINK_STATE_FILE,
        JSON.stringify({ temporary_expiry_extension: true }),
        { encoding: "utf8", mode: 0o600 },
      );
      console.log("qa link | temporary_expiry_extension=true");
    } else {
      await fs.writeFile(
        LINK_STATE_FILE,
        JSON.stringify({ temporary_expiry_extension: false }),
        { encoding: "utf8", mode: 0o600 },
      );
      console.log("qa link | temporary_expiry_extension=false");
    }

    const linkInfo = await fetchLinkInfo();
    assertEqual(linkInfo.status, 200, "link_info_status");
    assertEqual(linkInfo.allowOrigin, PREVIEW_ORIGIN, "link_info_cors_origin");
    assertEqual(linkInfo.body?.link?.max_files, 3, "link_info_max_files");
    assertEqual(linkInfo.body?.link?.max_file_mb, 10, "link_info_max_file_mb");
    assertEqual(linkInfo.body?.link?.max_total_mb, 12, "link_info_max_total_mb");
    report.flow.link_info_status = 200;
    await fs.writeFile(
      BASELINE_FILE,
      JSON.stringify({ counts: await readNoSubmitCounts(client) }),
      { encoding: "utf8", mode: 0o600 },
    );
    console.log("CORS | status=PASS");
    console.log("link-info | status=PASS");
    console.log("baseline | captured=true");
  } finally {
    await client.end();
  }
}

async function restore() {
  requireEnv(["SUPABASE_DEV_DB_URL", "QA_LINK_ID"]);
  let snapshot;
  try {
    snapshot = JSON.parse(await fs.readFile(RESTORE_FILE, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      await updateEvidenceLinkState(false);
      console.log("link restore | not_required=true");
      return;
    }
    throw error;
  }

  const client = await dbClient();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(
      `update public.intake_links
          set expires_at = $2,
              updated_at = $3
        where id = $1`,
      [snapshot.id, snapshot.expires_at, snapshot.updated_at],
    );
    await client.query("commit");
    const verified = await client.query(
      `select expires_at = $2::timestamptz as expires_ok,
              updated_at = $3::timestamptz as updated_ok
         from public.intake_links
        where id = $1`,
      [snapshot.id, snapshot.expires_at, snapshot.updated_at],
    );
    assert(verified.rows[0]?.expires_ok && verified.rows[0]?.updated_ok, "link_restore_failed");
    await fs.unlink(RESTORE_FILE);
    await updateEvidenceLinkState(true);
    console.log("link restore | restored=true");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw new Error(`link_restore_failed:${sanitizeText(error?.message)}`);
  } finally {
    await client.end();
  }
}

async function updateEvidenceLinkState(restored) {
  const evidencePath = path.join(OUTPUT_DIR, "axe_diagnostic_sanitized.json");
  try {
    const evidence = JSON.parse(await fs.readFile(evidencePath, "utf8"));
    evidence.link.restored_by_always_step = restored;
    await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function monitorPage(page, label) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = sanitizeText(message.text());
    if (/vercel\.live/i.test(text) || (label === "unavailable" && /status of 404/i.test(text))) {
      report.external_warnings.push({ page: label, message: text });
    } else {
      report.console_errors.push({ page: label, message: text });
    }
  });
  page.on("pageerror", (error) => {
    report.page_errors.push({ page: label, message: sanitizeText(error?.message) });
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    report.failed_requests.push({
      page: label,
      resource: `${url.origin}${url.pathname}`,
      reason: sanitizeText(request.failure()?.errorText || "failed"),
    });
  });
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/submit")) {
      report.flow.submit_requests += 1;
    }
  });
}

async function safeGoto(page, url) {
  try {
    return await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (error) {
    throw new Error(`navigation_failed:${sanitizeText(error?.message)}`);
  }
}

async function semanticNode(page, target) {
  const selector = Array.isArray(target) ? target[0] : target;
  if (typeof selector !== "string") return {};
  try {
    return await page.evaluate((value) => {
      const element = document.querySelector(value);
      if (!element) return {};
      const aria = {};
      for (const attribute of element.attributes) {
        if (attribute.name.startsWith("aria-")) aria[attribute.name] = attribute.value.slice(0, 180);
      }
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        class: typeof element.className === "string" ? element.className.slice(0, 180) : "",
        role: element.getAttribute("role") || "",
        aria,
      };
    }, selector);
  } catch {
    return {};
  }
}

async function scanAxe(page, label) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = [];
  for (const violation of results.violations) {
    const nodes = [];
    for (const node of violation.nodes) {
      const targets = (node.target || []).slice(0, 3).map(sanitizeSelector);
      nodes.push({
        target: targets,
        failure_summary: sanitizeText(node.failureSummary, 900),
        ...(await semanticNode(page, node.target)),
      });
    }
    violations.push({
      id: violation.id,
      impact: violation.impact,
      help: sanitizeText(violation.help, 400),
      help_url: sanitizeText(violation.helpUrl, 500),
      tags: (violation.tags || []).map((tag) => sanitizeText(tag, 80)),
      node_count: violation.nodes.length,
      nodes,
    });
  }
  report.scans[label] = {
    url_fragment_present: await page.evaluate(() => Boolean(location.hash)),
    violation_count: violations.length,
    violations,
  };
}

async function openValid(page) {
  const response = await safeGoto(page, `${PREVIEW_URL}#token=${TOKEN}`);
  assertEqual(response?.status(), 200, "preview_http_status");
  await page.waitForFunction(
    () => location.hash === "" && !location.href.includes("#token="),
    null,
    { timeout: 15000 },
  );
  await page.locator("#portal-view:not([hidden])").waitFor({ timeout: 30000 });
  assert(!(await page.content()).includes(TOKEN), "token_present_in_dom");
  report.flow.fragment_removed = true;
}

async function waitFocus(page, id, code) {
  await page.waitForFunction(
    (expected) => document.activeElement?.id === expected,
    id,
    { timeout: 5000 },
  );
  assertEqual(await page.evaluate(() => document.activeElement?.id), id, code);
}

async function fillToDocuments(page) {
  await page.locator("#provider-name").fill("QA PROVEEDOR FICTICIO");
  await page.locator("#provider-rfc").fill("XAXX010101000");
  await page.locator("#provider-email").fill("qa.proveedor@example.test");
  await page.locator("#provider-phone").fill("5550000000");
  await page.locator("#next-button").click();
  await waitFocus(page, "step-2-title", "step2_focus");
  await page.locator("#concept").fill("Diagnostico focal de accesibilidad");
  await page.locator("#amount-requested").fill("1.23");
  await page.locator("#next-button").click();
  await waitFocus(page, "step-3-title", "step3_focus");
}

function classifyFindings() {
  const blocking = [];
  const moderateRules = new Set();
  const minorRules = new Set();
  for (const [scan, value] of Object.entries(report.scans)) {
    for (const violation of value.violations) {
      if (violation.impact === "critical" || violation.impact === "serious") {
        blocking.push({ scan, ...violation });
      } else if (violation.impact === "moderate") {
        moderateRules.add(`${violation.id}:${violation.impact}`);
      } else if (violation.impact === "minor") {
        minorRules.add(`${violation.id}:${violation.impact}`);
      }
    }
  }

  const targetMatches = (violation, selector) =>
    violation.nodes.some((node) => node.target.some((target) => target.includes(selector)));
  const labelMatches = blocking.some(
    (violation) =>
      violation.id === "label" &&
      violation.impact === "critical" &&
      targetMatches(violation, "#file-input"),
  );
  const nestedMatches = blocking.some(
    (violation) =>
      violation.id === "nested-interactive" &&
      violation.impact === "serious" &&
      (targetMatches(violation, "#dropzone") ||
        targetMatches(violation, "#choose-files-button")),
  );
  const unexpected = blocking.filter((violation) => {
    const expectedLabel =
      violation.id === "label" &&
      violation.impact === "critical" &&
      targetMatches(violation, "#file-input");
    const expectedNested =
      violation.id === "nested-interactive" &&
      violation.impact === "serious" &&
      (targetMatches(violation, "#dropzone") ||
        targetMatches(violation, "#choose-files-button"));
    return !expectedLabel && !expectedNested;
  });

  report.classification = {
    exact_authorized_match: labelMatches && nestedMatches && unexpected.length === 0,
    critical: new Set(
      blocking
        .filter((violation) => violation.impact === "critical")
        .map((violation) => `${violation.id}:${violation.impact}`),
    ).size,
    serious: new Set(
      blocking
        .filter((violation) => violation.impact === "serious")
        .map((violation) => `${violation.id}:${violation.impact}`),
    ).size,
    moderate: moderateRules.size,
    minor: minorRules.size,
    unexpected_blocking_rules: unexpected.map((violation) => ({
      scan: violation.scan,
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.flatMap((node) => node.target).slice(0, 8),
    })),
  };
}

async function verifyNoSubmitDelta() {
  const baseline = JSON.parse(await fs.readFile(BASELINE_FILE, "utf8"));
  const client = await dbClient();
  try {
    const current = await readNoSubmitCounts(client);
    const delta = Object.fromEntries(
      Object.keys(current).map((key) => [key, Number(current[key]) - Number(baseline.counts[key])]),
    );
    assert(Object.values(delta).every((value) => value === 0), "diagnostic_created_business_records");
    report.flow.intake_delta = delta;
  } finally {
    await client.end();
  }
}

async function writeEvidence() {
  await ensureDirs();
  report.generated_at = new Date().toISOString();
  const json = JSON.stringify(report, null, 2);
  assert(!TOKEN || !json.includes(TOKEN), "artifact_contains_token");
  assert(!DB_URL || !json.includes(DB_URL), "artifact_contains_db_url");
  await fs.writeFile(path.join(OUTPUT_DIR, "axe_diagnostic_sanitized.json"), `${json}\n`, "utf8");

  const rows = [];
  for (const [scan, value] of Object.entries(report.scans)) {
    for (const violation of value.violations) {
      const targets = violation.nodes.flatMap((node) => node.target).join(", ");
      rows.push(`| ${scan} | ${violation.id} | ${violation.impact} | ${violation.node_count} | ${targets} |`);
    }
  }
  const markdown = `# Diagnostico Axe sanitizado - Portal publico DEV

Fecha: ${report.generated_at}
Run ID: ${RUN_ID}
Estado: **${report.status}**

## Gate

- Coincidencia exacta autorizada: ${report.classification.exact_authorized_match}.
- Critical: ${report.classification.critical}.
- Serious: ${report.classification.serious}.
- Moderate: ${report.classification.moderate}.
- Minor: ${report.classification.minor}.
- Requests submit: ${report.flow.submit_requests}.
- Delta intakes/archivos/objetos: ${JSON.stringify(report.flow.intake_delta)}.

## Reglas y targets

| Vista | Rule ID | Impact | Nodos | Targets minimos |
| --- | --- | --- | ---: | --- |
${rows.join("\n")}

## Seguridad

- Fragmento retirado antes de evidencia: ${report.flow.fragment_removed}.
- Turnstile cargado: ${report.flow.turnstile_loaded}.
- CAPTCHA y submit: no ejecutados.
- Token, DB URL, valores de inputs, innerHTML, HAR, trace y video: no incluidos.

## Dictamen

${report.classification.exact_authorized_match
    ? "Las reglas critical/serious coinciden exactamente con las dos hipotesis autorizadas. Puede continuar la correccion frontend minima."
    : "Las reglas critical/serious no coinciden exactamente con el gate autorizado. Mantener PR Draft y detener cambios de producto."}
`;
  await fs.writeFile(path.join(OUTPUT_DIR, "AXE_DIAGNOSTIC_REPORT.md"), markdown, "utf8");
}

async function runDiagnostic() {
  requireEnv([
    "PREVIEW_URL",
    "PREVIEW_ORIGIN",
    "FUNCTION_BASE_URL",
    "PROVIDER_INTAKE_QA_TOKEN",
    "SUPABASE_DEV_DB_URL",
    "QA_LINK_ID",
  ]);
  await ensureDirs();
  try {
    const linkState = JSON.parse(await fs.readFile(LINK_STATE_FILE, "utf8"));
    report.link.temporary_expiry_extension = Boolean(linkState.temporary_expiry_extension);
  } catch {
    report.link.temporary_expiry_extension = false;
  }
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    viewport: { width: 1366, height: 768 },
  });

  try {
    const unavailable = await context.newPage();
    monitorPage(unavailable, "unavailable");
    await safeGoto(unavailable, PREVIEW_URL);
    await unavailable.locator("#unavailable-view:not([hidden])").waitFor();
    await scanAxe(unavailable, "unavailable");
    await unavailable.close();

    const page = await context.newPage();
    monitorPage(page, "primary");
    await openValid(page);
    await scanAxe(page, "step_1");
    await fillToDocuments(page);
    assertEqual(await page.locator("#turnstile-widget iframe").count(), 0, "turnstile_loaded_before_review");
    await scanAxe(page, "step_3_before_file");

    await page.locator("#file-input").setInputFiles(SAFE_XML_PATH);
    await page.locator(".file-row").waitFor();
    assertEqual(await page.locator("#file-kind-0").inputValue(), "invoice_xml", "file_kind_not_invoice_xml");
    assert((await page.locator("#usage-copy").textContent()).includes("de 12 MB"), "usage_not_updated");
    report.flow.safe_xml_added = true;
    report.flow.file_kind = "invoice_xml";
    report.flow.usage_updated = true;
    await scanAxe(page, "step_3_after_file");

    assertEqual(await page.locator("#turnstile-widget iframe").count(), 0, "turnstile_loaded_during_diagnostic");
    report.flow.turnstile_loaded =
      (await page.locator('script[data-intake-turnstile="true"]').count()) > 0;
    assertEqual(report.flow.turnstile_loaded, false, "turnstile_script_loaded");
    assertEqual(report.flow.submit_requests, 0, "submit_request_detected");
    assertEqual(await page.evaluate(() => location.hash), "", "fragment_not_removed");
    await page.screenshot({
      path: SCREENSHOT_PATH,
      fullPage: true,
      animations: "disabled",
    });

    classifyFindings();
    await verifyNoSubmitDelta();
    assertEqual(report.console_errors.length, 0, "product_console_errors");
    assertEqual(report.page_errors.length, 0, "page_errors");
    report.status = report.classification.exact_authorized_match ? "PASS_GATE_MATCH" : "FAIL_GATE_MISMATCH";
    await writeEvidence();
    assert(report.classification.exact_authorized_match, "axe_gate_mismatch");
  } catch (error) {
    report.status = "FAIL";
    report.failure = sanitizeText(error?.message || error);
    classifyFindings();
    await writeEvidence().catch(() => {});
    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  try {
    if (phase === "prepare") await prepare();
    else if (phase === "diagnostic") await runDiagnostic();
    else if (phase === "restore") await restore();
    else throw new Error("unknown_phase");
  } catch (error) {
    console.error(sanitizeText(error?.message || error));
    process.exitCode = 1;
  }
}

await main();
