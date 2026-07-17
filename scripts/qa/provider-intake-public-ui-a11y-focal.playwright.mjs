import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";

const { Client } = pg;
const phase = process.argv[2] || "focal";
const PREVIEW_URL = process.env.PREVIEW_URL;
const PREVIEW_ORIGIN = process.env.PREVIEW_ORIGIN;
const FUNCTION_BASE_URL = process.env.FUNCTION_BASE_URL;
const TOKEN = process.env.PROVIDER_INTAKE_QA_TOKEN || "";
const DB_URL = process.env.SUPABASE_DEV_DB_URL || "";
const LINK_ID = process.env.QA_LINK_ID;
const RUN_ID = String(process.env.GITHUB_RUN_ID || "local").replace(/[^0-9A-Za-z_-]/g, "");
const WORK_DIR = process.env.FOCAL_WORK_DIR || path.join(process.cwd(), ".a11y-focal-temp");
const OUTPUT_DIR = process.env.FOCAL_OUTPUT_DIR || path.join(WORK_DIR, "evidence");
const RESTORE_FILE = path.join(WORK_DIR, "link-restore.json");
const BASELINE_FILE = path.join(WORK_DIR, "baseline.json");
const LINK_STATE_FILE = path.join(WORK_DIR, "link-state.json");
const SAFE_XML_PATH = path.join(WORK_DIR, "QA_Fase1C_XML_seguro.xml");
const EVIDENCE_JSON = path.join(OUTPUT_DIR, "axe_focal_sanitized.json");

const SAFE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<qaSolicitud>
  <entorno>DEV</entorno>
  <concepto>Reproduccion focal post-fix</concepto>
  <monto moneda="MXN">1.23</monto>
</qaSolicitud>
`;

const report = {
  report_version: "provider-intake-public-ui-a11y-focal/1.0",
  generated_at: new Date().toISOString(),
  run_id: RUN_ID,
  status: "BLOCKED",
  product_head: "d701e0071cf0a93d3055b981c5daf91b300c68fe",
  backend_tree: "379f65801609e40143d948b3de702e391636c512",
  link: { temporary_expiry_extension: false, restored_by_always_step: null },
  scans: {},
  totals: { critical: 0, serious: 0, moderate: 0, minor: 0 },
  interaction: {
    keyboard_filechooser: false,
    focus_visible: false,
    drag_drop: false,
    remove_button: false,
    file_kind: false,
    usage_meter: false,
  },
  flow: {
    fragment_removed: false,
    turnstile_loaded: false,
    submit_requests: 0,
    intake_delta: null,
  },
  console_errors: [],
  external_warnings: [],
  page_errors: [],
  failed_requests: [],
  screenshot: "documents-post-fix-sanitized.png",
  security: {
    submit_allowed: false,
    captcha_allowed: false,
    token_logged: false,
    input_values_captured: false,
    inner_html_captured: false,
    har_generated: false,
    trace_generated: false,
    video_generated: false,
  },
};

function requireEnv(names) {
  for (const name of names) if (!process.env[name]) throw new Error(`missing_${name.toLowerCase()}`);
}

function sanitizeText(value, max = 800) {
  let text = String(value ?? "");
  if (TOKEN) text = text.split(TOKEN).join("[REDACTED_TOKEN]");
  if (DB_URL) text = text.split(DB_URL).join("[REDACTED_DB_URL]");
  return text
    .replace(/#token=[A-Za-z0-9_-]{16,}/gi, "#token=[REDACTED]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/g, "[REDACTED_RFC]")
    .replace(/\b\d{18}\b/g, "[REDACTED_CLABE]")
    .slice(0, max);
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function assertEqual(actual, expected, code) {
  if (actual !== expected) throw new Error(`${code}:${sanitizeText(actual)}`);
}

async function ensureDirs() {
  await fs.mkdir(WORK_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function dbClient() {
  const connection = new URL(DB_URL);
  for (const key of ["sslmode", "ssl", "uselibpqcompat"]) connection.searchParams.delete(key);
  const client = new Client({
    connectionString: connection.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

async function readCounts(client) {
  const result = await client.query(`
    select
      (select count(*)::int from public.payment_intake) as payment_intake,
      (select count(*)::int from public.payment_intake_files) as payment_intake_files,
      (select count(*)::int from storage.objects where bucket_id = 'intake-uploads') as storage_objects
  `);
  return result.rows[0];
}

async function fetchLinkInfo() {
  return fetch(`${FUNCTION_BASE_URL}/link-info`, {
    headers: { "X-Intake-Token": TOKEN, Origin: PREVIEW_ORIGIN },
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
}

async function prepare() {
  requireEnv(["PROVIDER_INTAKE_QA_TOKEN", "SUPABASE_DEV_DB_URL", "QA_LINK_ID"]);
  assert(/^[A-Za-z0-9_-]{32,256}$/.test(TOKEN), "qa_token_format_invalid");
  await ensureDirs();
  await fs.writeFile(SAFE_XML_PATH, SAFE_XML, { encoding: "utf8", mode: 0o600 });
  const client = await dbClient();
  try {
    const result = await client.query(
      "select id, status, expires_at, updated_at from public.intake_links where id = $1",
      [LINK_ID],
    );
    assertEqual(result.rowCount, 1, "qa_link_missing");
    assertEqual(result.rows[0].status, "active", "qa_link_not_active");
    const link = result.rows[0];
    const expired = link.expires_at && new Date(link.expires_at).getTime() <= Date.now();
    if (expired) {
      await fs.writeFile(
        RESTORE_FILE,
        JSON.stringify({
          id: LINK_ID,
          expires_at: new Date(link.expires_at).toISOString(),
          updated_at: new Date(link.updated_at).toISOString(),
        }),
        { encoding: "utf8", mode: 0o600 },
      );
      await client.query(
        "update public.intake_links set expires_at = now() + interval '3 hours', updated_at = now() where id = $1 and status = 'active'",
        [LINK_ID],
      );
    }
    await fs.writeFile(
      LINK_STATE_FILE,
      JSON.stringify({ temporary_expiry_extension: Boolean(expired) }),
      { encoding: "utf8", mode: 0o600 },
    );
    const response = await fetchLinkInfo();
    assertEqual(response.status, 200, "link_info_status");
    assertEqual(response.headers.get("access-control-allow-origin"), PREVIEW_ORIGIN, "cors_origin");
    await fs.writeFile(
      BASELINE_FILE,
      JSON.stringify({ counts: await readCounts(client) }),
      { encoding: "utf8", mode: 0o600 },
    );
    console.log(`qa link | temporary_expiry_extension=${Boolean(expired)}`);
    console.log("CORS | status=PASS");
    console.log("link-info | status=PASS");
  } finally {
    await client.end();
  }
}

async function updateRestoreEvidence(value) {
  try {
    const evidence = JSON.parse(await fs.readFile(EVIDENCE_JSON, "utf8"));
    evidence.link.restored_by_always_step = value;
    await fs.writeFile(EVIDENCE_JSON, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function restore() {
  requireEnv(["SUPABASE_DEV_DB_URL", "QA_LINK_ID"]);
  let snapshot;
  try {
    snapshot = JSON.parse(await fs.readFile(RESTORE_FILE, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      await updateRestoreEvidence(false);
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
      "update public.intake_links set expires_at = $2, updated_at = $3 where id = $1",
      [snapshot.id, snapshot.expires_at, snapshot.updated_at],
    );
    await client.query("commit");
    const result = await client.query(
      "select expires_at = $2::timestamptz as expires_ok, updated_at = $3::timestamptz as updated_ok from public.intake_links where id = $1",
      [snapshot.id, snapshot.expires_at, snapshot.updated_at],
    );
    assert(result.rows[0]?.expires_ok && result.rows[0]?.updated_ok, "link_restore_failed");
    await updateRestoreEvidence(true);
    console.log("link restore | restored=true");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

function monitor(page, label) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = sanitizeText(message.text());
    if (/vercel\.live/i.test(text) || (label === "unavailable" && /status of 404/i.test(text))) {
      report.external_warnings.push({ page: label, message: text });
    } else {
      report.console_errors.push({ page: label, message: text });
    }
  });
  page.on("pageerror", (error) => report.page_errors.push({ page: label, message: sanitizeText(error.message) }));
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
    throw new Error(`navigation_failed:${sanitizeText(error.message)}`);
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
        if (attribute.name.startsWith("aria-")) aria[attribute.name] = attribute.value.slice(0, 160);
      }
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        class: typeof element.className === "string" ? element.className.slice(0, 160) : "",
        role: element.getAttribute("role") || "",
        aria,
      };
    }, selector);
  } catch {
    return {};
  }
}

async function scan(page, label) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = [];
  for (const violation of results.violations) {
    const nodes = [];
    for (const node of violation.nodes) {
      nodes.push({
        target: (node.target || []).slice(0, 3).map((value) => sanitizeText(value, 200)),
        failure_summary: sanitizeText(node.failureSummary, 800),
        ...(await semanticNode(page, node.target)),
      });
    }
    violations.push({
      id: violation.id,
      impact: violation.impact,
      help: sanitizeText(violation.help, 300),
      tags: violation.tags,
      node_count: violation.nodes.length,
      nodes,
    });
  }
  report.scans[label] = { violations };
}

async function openValid(page) {
  const response = await safeGoto(page, `${PREVIEW_URL}#token=${TOKEN}`);
  assertEqual(response?.status(), 200, "preview_status");
  await page.waitForFunction(() => location.hash === "", null, { timeout: 15000 });
  await page.locator("#portal-view:not([hidden])").waitFor({ timeout: 30000 });
  assert(!(await page.content()).includes(TOKEN), "token_in_dom");
  report.flow.fragment_removed = true;
}

async function waitFocus(page, id, code) {
  await page.waitForFunction((value) => document.activeElement?.id === value, id, { timeout: 5000 });
  assertEqual(await page.evaluate(() => document.activeElement?.id), id, code);
}

async function fillToDocuments(page) {
  await page.locator("#provider-name").fill("QA PROVEEDOR FICTICIO");
  await page.locator("#provider-rfc").fill("XAXX010101000");
  await page.locator("#provider-email").fill("qa.proveedor@example.test");
  await page.locator("#next-button").click();
  await waitFocus(page, "step-2-title", "step2_focus");
  await page.locator("#concept").fill("Reproduccion focal post-fix");
  await page.locator("#amount-requested").fill("1.23");
  await page.locator("#next-button").click();
  await waitFocus(page, "step-3-title", "step3_focus");
}

function calculateTotals() {
  const unique = new Map();
  for (const value of Object.values(report.scans)) {
    for (const violation of value.violations) {
      unique.set(`${violation.id}:${violation.impact}`, violation);
    }
  }
  report.totals = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const violation of unique.values()) {
    if (Object.hasOwn(report.totals, violation.impact)) report.totals[violation.impact] += 1;
  }
}

async function verifyNoMutation() {
  const baseline = JSON.parse(await fs.readFile(BASELINE_FILE, "utf8"));
  const client = await dbClient();
  try {
    const current = await readCounts(client);
    const delta = Object.fromEntries(
      Object.keys(current).map((key) => [key, Number(current[key]) - Number(baseline.counts[key])]),
    );
    assert(Object.values(delta).every((value) => value === 0), "focal_created_records");
    report.flow.intake_delta = delta;
  } finally {
    await client.end();
  }
}

async function writeEvidence() {
  report.generated_at = new Date().toISOString();
  const json = JSON.stringify(report, null, 2);
  assert(!TOKEN || !json.includes(TOKEN), "artifact_contains_token");
  assert(!DB_URL || !json.includes(DB_URL), "artifact_contains_db_url");
  await fs.writeFile(EVIDENCE_JSON, `${json}\n`, "utf8");
  const rows = Object.entries(report.scans).flatMap(([view, value]) =>
    value.violations.map((violation) =>
      `| ${view} | ${violation.id} | ${violation.impact} | ${violation.node_count} |`,
    ),
  );
  const markdown = `# Axe focal post-fix - Portal publico DEV

Fecha: ${report.generated_at}
Run ID: ${RUN_ID}
Estado: **${report.status}**

## Axe

- Critical: ${report.totals.critical}.
- Serious: ${report.totals.serious}.
- Moderate: ${report.totals.moderate}.
- Minor: ${report.totals.minor}.

| Vista | Rule ID | Impact | Nodos |
| --- | --- | --- | ---: |
${rows.length ? rows.join("\n") : "| Todas | Ninguna | - | 0 |"}

## Interaccion de documentos

- Selector por teclado: ${report.interaction.keyboard_filechooser}.
- Foco visible: ${report.interaction.focus_visible}.
- Drag and drop: ${report.interaction.drag_drop}.
- Boton Quitar: ${report.interaction.remove_button}.
- file_kind: ${report.interaction.file_kind}.
- Medidor: ${report.interaction.usage_meter}.
- Submit requests: ${report.flow.submit_requests}.
- Delta intakes/archivos/objetos: ${JSON.stringify(report.flow.intake_delta)}.

## Dictamen

${report.status === "PASS" ? "Focal post-fix PASS. Puede iniciar UAT cloud completo." : "Focal no aprobado. Mantener PR Draft y no iniciar UAT transaccional."}
`;
  await fs.writeFile(path.join(OUTPUT_DIR, "AXE_FOCAL_REPORT.md"), markdown, "utf8");
}

async function runFocal() {
  requireEnv(["PROVIDER_INTAKE_QA_TOKEN", "SUPABASE_DEV_DB_URL", "QA_LINK_ID"]);
  await ensureDirs();
  try {
    const state = JSON.parse(await fs.readFile(LINK_STATE_FILE, "utf8"));
    report.link.temporary_expiry_extension = Boolean(state.temporary_expiry_extension);
  } catch {}
  const browser = await chromium.launch({ headless: false, args: ["--disable-dev-shm-usage"] });
  const context = await browser.newContext({
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    viewport: { width: 1366, height: 768 },
  });
  try {
    const unavailable = await context.newPage();
    monitor(unavailable, "unavailable");
    await safeGoto(unavailable, PREVIEW_URL);
    await unavailable.locator("#unavailable-view:not([hidden])").waitFor();
    await scan(unavailable, "unavailable");
    await unavailable.close();

    const page = await context.newPage();
    monitor(page, "primary");
    await openValid(page);
    await scan(page, "step_1");
    await fillToDocuments(page);
    await scan(page, "step_3_before_file");

    const button = page.locator("#choose-files-button");
    await button.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const outline = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });
    report.interaction.focus_visible = outline.style !== "none" && outline.width !== "0px";

    const chooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    const chooser = await chooserPromise;
    await chooser.setFiles(SAFE_XML_PATH);
    report.interaction.keyboard_filechooser = true;
    await page.locator(".file-row").waitFor();
    report.interaction.file_kind =
      (await page.locator("#file-kind-0").inputValue()) === "invoice_xml";
    report.interaction.usage_meter =
      (await page.locator("#usage-copy").textContent()).includes("de 12 MB");
    await scan(page, "step_3_after_file");

    await page.locator(".remove-file").click();
    await page.locator(".file-row").waitFor({ state: "detached" });
    report.interaction.remove_button = true;

    await page.evaluate((xml) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([xml], "QA_Fase1C_XML_drag.xml", { type: "text/xml" }));
      const target = document.querySelector("#dropzone");
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, SAFE_XML);
    await page.locator(".file-row").waitFor();
    report.interaction.drag_drop = true;
    assertEqual(await page.locator("#file-kind-0").inputValue(), "invoice_xml", "drag_file_kind");
    assert((await page.locator("#usage-copy").textContent()).includes("de 12 MB"), "drag_usage");

    assertEqual(await page.locator("#turnstile-widget iframe").count(), 0, "turnstile_iframe");
    report.flow.turnstile_loaded =
      (await page.locator('script[data-intake-turnstile="true"]').count()) > 0;
    assertEqual(report.flow.turnstile_loaded, false, "turnstile_script");
    assertEqual(report.flow.submit_requests, 0, "submit_detected");
    await page.screenshot({
      path: path.join(OUTPUT_DIR, report.screenshot),
      fullPage: true,
      animations: "disabled",
    });

    calculateTotals();
    await verifyNoMutation();
    assertEqual(report.totals.critical, 0, "axe_critical");
    assertEqual(report.totals.serious, 0, "axe_serious");
    assertEqual(report.totals.moderate, 0, "axe_moderate");
    assertEqual(report.totals.minor, 0, "axe_minor");
    assert(Object.values(report.interaction).every(Boolean), "document_interaction_incomplete");
    assertEqual(report.console_errors.length, 0, "console_errors");
    assertEqual(report.page_errors.length, 0, "page_errors");
    report.status = "PASS";
    await writeEvidence();
  } catch (error) {
    calculateTotals();
    report.status = "FAIL";
    report.failure = sanitizeText(error?.message || error);
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
    else if (phase === "focal") await runFocal();
    else if (phase === "restore") await restore();
    else throw new Error("unknown_phase");
  } catch (error) {
    console.error(sanitizeText(error?.message || error));
    process.exitCode = 1;
  }
}

await main();
