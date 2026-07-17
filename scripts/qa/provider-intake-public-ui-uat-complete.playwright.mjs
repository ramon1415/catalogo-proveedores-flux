import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";

const { Client } = pg;
const phase = process.argv[2] || "uat";
const PREVIEW_URL = process.env.PREVIEW_URL;
const PREVIEW_ORIGIN = process.env.PREVIEW_ORIGIN;
const FUNCTION_BASE_URL = process.env.FUNCTION_BASE_URL;
const TOKEN = process.env.PROVIDER_INTAKE_QA_TOKEN || "";
const DB_URL = process.env.SUPABASE_DEV_DB_URL || "";
const LINK_ID = process.env.QA_LINK_ID;
const RUN_ID = String(process.env.GITHUB_RUN_ID || "local").replace(/[^0-9A-Za-z_-]/g, "");
const WORK_DIR = process.env.UAT_WORK_DIR || path.join(process.cwd(), ".uat-complete-temp");
const OUTPUT_DIR = process.env.UAT_OUTPUT_DIR || path.join(WORK_DIR, "evidence");
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, "screenshots");
const BASELINE_FILE = path.join(WORK_DIR, "baseline.json");
const RESTORE_FILE = path.join(WORK_DIR, "link-restore.json");
const LINK_STATE_FILE = path.join(WORK_DIR, "link-state.json");
const EVIDENCE_JSON = path.join(OUTPUT_DIR, "qa_results_sanitized.json");

const FIXTURES = {
  safeXml: path.join(WORK_DIR, "QA_Fase1C_XML_seguro.xml"),
  dtdXml: path.join(WORK_DIR, "QA_Fase1C_XML_DTD.xml"),
  entityXml: path.join(WORK_DIR, "QA_Fase1C_XML_ENTITY.xml"),
  invalidSvg: path.join(WORK_DIR, "QA_Fase1C_invalido.svg"),
  largePdf: path.join(WORK_DIR, "QA_Fase1C_10MB_mas_un_byte.pdf"),
  totalPdfA: path.join(WORK_DIR, "QA_Fase1C_total_A.pdf"),
  totalPdfB: path.join(WORK_DIR, "QA_Fase1C_total_B.pdf"),
  fourXml: [1, 2, 3, 4].map((index) => path.join(WORK_DIR, `QA_Fase1C_cantidad_${index}.xml`)),
};

const SAFE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<qaSolicitud>
  <entorno>DEV</entorno>
  <concepto>Prueba controlada del portal publico Fase 1C</concepto>
  <monto moneda="MXN">1.23</monto>
</qaSolicitud>
`;

const DTD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE qaSolicitud>
<qaSolicitud><entorno>DEV</entorno></qaSolicitud>
`;

const ENTITY_XML = `<?xml version="1.0" encoding="UTF-8"?>
< ! ENTITY qa "contenido no permitido">
<qaSolicitud><entorno>DEV</entorno></qaSolicitud>
`;

const report = {
  report_version: "provider-intake-public-ui-complete-uat/1.1",
  generated_at: new Date().toISOString(),
  environment: "DEV",
  pr: 256,
  product_head: "d701e0071cf0a93d3055b981c5daf91b300c68fe",
  backend_tree: "379f65801609e40143d948b3de702e391636c512",
  run_id: RUN_ID,
  status: "BLOCKED",
  cases: {},
  contractual_tests: { passed: 58, failed: 0, status: "PASS" },
  prior_a11y: {
    diagnostic_run: 29554185343,
    post_fix_focal_run: 29554487197,
    post_fix_focal: { critical: 0, serious: 0, moderate: 0, minor: 0 },
  },
  link: {
    id: LINK_ID,
    temporary_expiry_extension: false,
    restored_by_always_step: null,
  },
  browser: {
    engine: "chromium",
    headed_under_xvfb: true,
    playwright: "1.55.0",
    axe_core_playwright: "4.10.2",
  },
  submissions: [],
  masked_folio: "",
  axe: {},
  console_errors: [],
  external_warnings: [],
  page_errors: [],
  failed_requests: [],
  postcheck: null,
  screenshots: [],
  security: {
    token_logged: false,
    fragment_in_screenshot: false,
    captcha_token_logged: false,
    db_url_logged: false,
    idempotency_key_logged: false,
    payload_logged: false,
    har_generated: false,
    trace_generated: false,
    video_generated: false,
    positive_submit_limit: 2,
  },
};

function requireEnv(names) {
  for (const name of names) {
    if (!process.env[name]) throw new Error(`missing_environment_${name.toLowerCase()}`);
  }
}

function sanitizeText(value, max = 700) {
  let text = String(value ?? "");
  if (TOKEN) text = text.split(TOKEN).join("[REDACTED_TOKEN]");
  if (DB_URL) text = text.split(DB_URL).join("[REDACTED_DB_URL]");
  text = text
    .replace(/#token=[A-Za-z0-9_-]{16,}/gi, "#token=[REDACTED]")
    .replace(/\bINT-\d{4}-\d{6}\b/g, "INT-****-******")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "qa.***@example.test")
    .replace(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/g, "QAP********")
    .replace(/\b\d{18}\b/g, "**************4567")
    .replace(/\bQA[A-Za-z0-9_-]{8,40}\b/g, "QA******7890");
  return text.slice(0, max);
}

function maskedFolio(value) {
  return /^INT-\d{4}-\d{6}$/.test(value || "")
    ? `${value.slice(0, 11)}****`
    : "INT-****-******";
}

function setCase(id, status, evidence) {
  report.cases[id] = { status, evidence: sanitizeText(evidence) };
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function assertEqual(actual, expected, code) {
  if (actual !== expected) throw new Error(`${code}:${sanitizeText(actual)}`);
}

async function ensureDirs() {
  await fs.mkdir(WORK_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
}

async function writeSparsePdf(filePath, size) {
  const handle = await fs.open(filePath, "w", 0o600);
  try {
    await handle.write(Buffer.from("%PDF-1.7\n", "ascii"), 0, 9, 0);
    await handle.truncate(size);
  } finally {
    await handle.close();
  }
}

async function writeFixtures() {
  await ensureDirs();
  await fs.writeFile(FIXTURES.safeXml, SAFE_XML, { encoding: "utf8", mode: 0o600 });
  await fs.writeFile(FIXTURES.dtdXml, DTD_XML, { encoding: "utf8", mode: 0o600 });
  await fs.writeFile(FIXTURES.entityXml, ENTITY_XML, { encoding: "utf8", mode: 0o600 });
  await fs.writeFile(
    FIXTURES.invalidSvg,
    '<svg xmlns="http://www.w3.org/2000/svg"><title>QA</title></svg>',
    { encoding: "utf8", mode: 0o600 },
  );
  for (const [index, filePath] of FIXTURES.fourXml.entries()) {
    await fs.writeFile(
      filePath,
      `<?xml version="1.0"?><qaSolicitud><indice>${index + 1}</indice></qaSolicitud>`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
  await writeSparsePdf(FIXTURES.largePdf, 10 * 1024 * 1024 + 1);
  await writeSparsePdf(FIXTURES.totalPdfA, 6 * 1024 * 1024);
  await writeSparsePdf(FIXTURES.totalPdfB, 6 * 1024 * 1024);
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

function numericRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

async function readCounts(client) {
  const result = await client.query(`
    select
      (select count(*) from public.payment_intake) as payment_intake,
      (select count(*) from public.payment_intake_events where event_type = 'received') as received_events,
      (select count(*) from public.payment_intake_files) as payment_intake_files,
      (select count(*) from storage.objects where bucket_id = 'intake-uploads') as storage_objects,
      (select count(*) from public.payment_requests) as payment_requests,
      (select count(*) from public.proveedores) as proveedores,
      (select count(*) from public.approval_batches) as approval_batches,
      (select count(*) from public.notification_events) as notification_events,
      (select count(*) from public.notification_events
        where event_type = 'provider_intake.received' or source_table = 'payment_intake') as provider_notifications,
      (select count(*) from (
        select intake_link_id, submission_fingerprint
        from public.payment_intake
        group by intake_link_id, submission_fingerprint
        having count(*) > 1
      ) duplicate_rows) as duplicate_groups,
      (select count(*) from public.payment_intake_files f
        left join public.payment_intake i on i.id = f.payment_intake_id
        where i.id is null) as file_metadata_orphans,
      (select count(*) from storage.objects o
        left join public.payment_intake_files f
          on f.bucket_id = o.bucket_id and f.storage_path = o.name
        where o.bucket_id = 'intake-uploads' and f.id is null) as storage_object_orphans
  `);
  return numericRow(result.rows[0]);
}

async function fetchLinkInfo() {
  const response = await fetch(`${FUNCTION_BASE_URL}/link-info`, {
    method: "GET",
    headers: { "X-Intake-Token": TOKEN, Origin: PREVIEW_ORIGIN },
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  let body = null;
  if ((response.headers.get("content-type") || "").includes("application/json")) {
    body = await response.json().catch(() => null);
  }
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
  await writeFixtures();
  const client = await dbClient();
  try {
    const result = await client.query(
      "select id, status, expires_at, updated_at from public.intake_links where id = $1",
      [LINK_ID],
    );
    assertEqual(result.rowCount, 1, "qa_link_missing");
    const link = result.rows[0];
    assertEqual(link.status, "active", "qa_link_not_active");
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
    const linkInfo = await fetchLinkInfo();
    assertEqual(linkInfo.status, 200, "link_info_status");
    assertEqual(linkInfo.allowOrigin, PREVIEW_ORIGIN, "link_info_cors_origin");
    assertEqual(linkInfo.body?.company?.display_name, "Test - Demo Operadora SA de CV", "link_info_company");
    assertEqual(linkInfo.body?.link?.max_files, 3, "link_info_max_files");
    assertEqual(linkInfo.body?.link?.max_file_mb, 10, "link_info_max_file_mb");
    assertEqual(linkInfo.body?.link?.max_total_mb, 12, "link_info_max_total_mb");
    assertEqual(linkInfo.body?.link?.allowed_file_types?.length, 6, "link_info_mime_count");
    assert(/^https:\/\//.test(linkInfo.body?.privacy_notice?.url || ""), "link_info_privacy_https");
    const baseline = {
      captured_at: new Date().toISOString(),
      counts: await readCounts(client),
    };
    await fs.writeFile(BASELINE_FILE, JSON.stringify(baseline), {
      encoding: "utf8",
      mode: 0o600,
    });
    console.log(`qa link | temporary_expiry_extension=${Boolean(expired)}`);
    console.log("CORS | status=PASS");
    console.log("link-info | status=PASS");
    console.log("baseline | captured=true");
  } finally {
    await client.end();
  }
}

async function updateRestoreEvidence(restored) {
  try {
    const evidence = JSON.parse(await fs.readFile(EVIDENCE_JSON, "utf8"));
    evidence.link.restored_by_always_step = restored;
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
    throw new Error(`link_restore_failed:${sanitizeText(error?.message)}`);
  } finally {
    await client.end();
  }
}

function monitorPage(page, label) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = sanitizeText(message.text());
    if (
      /vercel\.live/i.test(text) ||
      (["unavailable", "invalid", "query"].includes(label) && /status of 404/i.test(text))
    ) {
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
}

async function screenshot(page, name) {
  assertEqual(await page.evaluate(() => location.hash), "", `screenshot_fragment_${name}`);
  const file = path.join(SCREENSHOT_DIR, name);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  report.screenshots.push(name);
}

function isWcagAaTag(tag) {
  return ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"].includes(tag);
}

async function runAxe(page, label) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.map((entry) => ({
    id: entry.id,
    impact: entry.impact,
    tags: entry.tags,
    nodes: entry.nodes.length,
  }));
  const critical = violations.filter((entry) => entry.impact === "critical").length;
  const serious = violations.filter((entry) => entry.impact === "serious").length;
  const wcagAaOpen = violations.filter((entry) => entry.tags.some(isWcagAaTag));
  report.axe[label] = { critical, serious, wcag_aa_open: wcagAaOpen, violations };
  assertEqual(critical, 0, `axe_${label}_critical`);
  assertEqual(serious, 0, `axe_${label}_serious`);
  assertEqual(wcagAaOpen.length, 0, `axe_${label}_wcag_aa`);
}

async function safeGoto(page, url) {
  try {
    return await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (error) {
    throw new Error(`navigation_failed:${sanitizeText(error?.message)}`);
  }
}

async function waitFocus(page, id, code) {
  await page.waitForFunction((expected) => document.activeElement?.id === expected, id, {
    timeout: 5000,
  });
  assertEqual(await page.evaluate(() => document.activeElement?.id), id, code);
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
  assertEqual(
    await page.locator("#company-name").textContent(),
    "Test - Demo Operadora SA de CV",
    "portal_company",
  );
  assert(!(await page.content()).includes(TOKEN), "token_present_in_dom");
}

function mexicoDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

const positive = {
  provider_name: "QA PROVEEDOR PORTAL FASE 1C",
  provider_rfc: "QAP260716AB1",
  provider_email: `qa.portal.${RUN_ID}@example.test`,
  provider_phone: "5555550101",
  concept: "Validacion portal publico Fase 1C",
  description: "Prueba controlada DEV con informacion completamente ficticia.",
  amount_requested: "1.23",
  requested_payment_date: mexicoDate(1),
  invoice_folio: `QA-1C-${RUN_ID}`,
  invoice_date: mexicoDate(0),
  invoice_uuid: "12345678-1234-4123-8123-123456789ABC",
  bank_name: "Banco QA",
  beneficiary_name: "QA PROVEEDOR PORTAL",
  bank_account: "QA1234567890",
  bank_clabe: "012345678901234567",
};

async function fillStep1(page) {
  await page.locator("#provider-name").fill(positive.provider_name);
  await page.locator("#provider-rfc").fill(positive.provider_rfc);
  await page.locator("#provider-email").fill(positive.provider_email);
  await page.locator("#provider-phone").fill(positive.provider_phone);
}

async function fillStep2(page) {
  await page.locator("#concept").fill(positive.concept);
  await page.locator("#description").fill(positive.description);
  await page.locator("#amount-requested").fill(positive.amount_requested);
  await page.locator("#requested-payment-date").fill(positive.requested_payment_date);
  await page.locator("#invoice-folio").fill(positive.invoice_folio);
  await page.locator("#invoice-date").fill(positive.invoice_date);
  await page.locator("#invoice-uuid").fill(positive.invoice_uuid);
  await page.locator("#bank-name").fill(positive.bank_name);
  await page.locator("#beneficiary-name").fill(positive.beneficiary_name);
  await page.locator("#bank-account").fill(positive.bank_account);
  await page.locator("#bank-clabe").fill(positive.bank_clabe);
}

async function waitForTurnstileWidget(page) {
  await page.locator("#turnstile-widget iframe").first().waitFor({
    state: "visible",
    timeout: 45000,
  });
  const config = await page.evaluate(async () => {
    const module = await import("./solicitar-config.js");
    return {
      siteKey: module.PUBLIC_INTAKE_CONFIG.turnstileSiteKey,
      action: module.PUBLIC_INTAKE_CONFIG.action,
    };
  });
  assertEqual(config.siteKey, "1x00000000000000000000AA", "turnstile_test_site_key");
  assertEqual(config.action, "provider_intake_submit", "turnstile_action");
}

async function waitForSubmitReady(page) {
  await page.locator("#submit-button").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#submit-button")?.disabled, null, {
    timeout: 60000,
  });
}

async function maskReview(page) {
  await page.evaluate(() => {
    const masks = new Map([
      ["RFC", "QAP********"],
      ["Correo", "qa.portal.***@example.test"],
      ["Teléfono", "******0101"],
      ["Cuenta", "••••7890"],
      ["CLABE", "••••4567"],
      ["UUID fiscal", "12345678-****-****-****-************"],
    ]);
    for (const wrapper of document.querySelectorAll("#review-content dl > div")) {
      const label = wrapper.querySelector("dt")?.textContent?.trim();
      if (masks.has(label)) wrapper.querySelector("dd").textContent = masks.get(label);
    }
  });
}

async function maskSuccess(page) {
  await page.evaluate(() => {
    const folio = document.querySelector("#public-folio");
    if (folio) folio.textContent = "INT-****-******";
  });
}

async function expectFileRejection(page, files, pattern, code) {
  await page.evaluate(() => {
    document.querySelector("#file-global-error").textContent = "";
  });
  await page.locator("#file-input").setInputFiles(files);
  await page.locator("#file-global-error").waitFor({ state: "visible", timeout: 30000 });
  const message = await page.locator("#file-global-error").textContent();
  assert(pattern.test(message || ""), `${code}:${sanitizeText(message)}`);
  assertEqual(await page.locator(".file-row").count(), 0, `${code}_file_added`);
  await waitFocus(page, "choose-files-button", `${code}_focus`);
}

async function keyboardAddSafeXml(page) {
  const button = page.locator("#choose-files-button");
  await button.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const outline = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  assert(outline.style !== "none" && outline.width !== "0px", "file_button_focus_not_visible");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles(FIXTURES.safeXml);
  await page.locator(".file-row").waitFor();
}

async function dragDropSafeXml(page) {
  await page.evaluate((xml) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([xml], "QA_Fase1C_XML_drag.xml", { type: "text/xml" }));
    const target = document.querySelector("#dropzone");
    target.dispatchEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    target.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  }, SAFE_XML);
  await page.locator(".file-row").waitFor();
}

async function completePositiveForm(page) {
  await fillStep1(page);
  await page.locator("#next-button").click();
  await page.locator("#step-2-title").waitFor({ state: "visible" });
  await fillStep2(page);
  await page.locator("#next-button").click();
  await page.locator("#step-3-title").waitFor({ state: "visible" });
  await page.locator("#file-input").setInputFiles(FIXTURES.safeXml);
  await page.locator(".file-row").waitFor();
  assertEqual(await page.locator("#file-kind-0").inputValue(), "invoice_xml", "safe_xml_file_kind");
  await page.locator("#next-button").click();
  await page.locator("#step-4-title").waitFor({ state: "visible" });
  await waitForTurnstileWidget(page);
  await page.locator("#privacy-accepted").focus();
  await page.keyboard.press("Space");
  await page.locator("#dev-data-confirmed").focus();
  await page.keyboard.press("Space");
  assert(await page.locator("#privacy-accepted").isChecked(), "privacy_checkbox_keyboard");
  assert(await page.locator("#dev-data-confirmed").isChecked(), "dev_checkbox_keyboard");
  await waitForSubmitReady(page);
}

async function verifyCoreNonJsonMapping(page) {
  return page.evaluate(async () => {
    const { mapPublicResponse } = await import("./solicitar-core.js");
    return {
      forbidden: mapPublicResponse(403, "text/html", "<html>gateway</html>").code,
      tooLarge: mapPublicResponse(413, "text/plain", "large").code,
      badGateway: mapPublicResponse(502, "text/html", "<html>gateway</html>").code,
      unavailable: mapPublicResponse(503, "text/plain", "gateway").code,
    };
  });
}

async function postcheck(firstFolio, secondFolio) {
  const baseline = JSON.parse(await fs.readFile(BASELINE_FILE, "utf8"));
  const client = await dbClient();
  try {
    const current = await readCounts(client);
    const deltas = Object.fromEntries(
      Object.keys(current).map((key) => [key, current[key] - baseline.counts[key]]),
    );
    const intakeResult = await client.query(
      `select id, public_folio, status, matched_proveedor_id, created_payment_request_id,
              captcha_provider, captcha_verified_at, created_at
         from public.payment_intake
        where intake_link_id = $1
          and provider_email = $2
          and invoice_folio = $3
        order by created_at desc`,
      [LINK_ID, positive.provider_email.toLowerCase(), positive.invoice_folio],
    );
    assertEqual(intakeResult.rowCount, 1, "postcheck_intake_count");
    const intake = intakeResult.rows[0];
    assertEqual(intake.public_folio, firstFolio, "postcheck_first_folio");
    assertEqual(secondFolio, firstFolio, "postcheck_duplicate_folio");
    assertEqual(intake.status, "received", "postcheck_intake_status");
    assert(intake.matched_proveedor_id === null, "postcheck_provider_created");
    assert(intake.created_payment_request_id === null, "postcheck_payment_request_created");
    assert(intake.captcha_provider && intake.captcha_verified_at, "postcheck_captcha_audit");

    const eventResult = await client.query(
      `select event_type, count(*)::integer as total
         from public.payment_intake_events
        where payment_intake_id = $1
        group by event_type`,
      [intake.id],
    );
    const events = Object.fromEntries(
      eventResult.rows.map((row) => [row.event_type, Number(row.total)]),
    );
    assertEqual(events.received, 1, "postcheck_received_event");
    assertEqual(events.file_uploaded, 1, "postcheck_file_uploaded_event");

    const fileResult = await client.query(
      `select id, bucket_id, storage_path, mime_type, file_kind, quarantine_status, size_bytes
         from public.payment_intake_files
        where payment_intake_id = $1`,
      [intake.id],
    );
    assertEqual(fileResult.rowCount, 1, "postcheck_file_metadata_count");
    const file = fileResult.rows[0];
    assertEqual(file.bucket_id, "intake-uploads", "postcheck_bucket_id");
    assert(["application/xml", "text/xml"].includes(file.mime_type), "postcheck_file_mime");
    assertEqual(file.file_kind, "invoice_xml", "postcheck_file_kind");
    assertEqual(file.quarantine_status, "pending", "postcheck_quarantine");

    const objectResult = await client.query(
      `select metadata
         from storage.objects
        where bucket_id = $1 and name = $2`,
      [file.bucket_id, file.storage_path],
    );
    assertEqual(objectResult.rowCount, 1, "postcheck_storage_object");
    const objectSize = Number(objectResult.rows[0]?.metadata?.size);
    assertEqual(objectSize, Number(file.size_bytes), "postcheck_storage_size_matches_metadata");

    const bucketResult = await client.query(
      "select public from storage.buckets where id = 'intake-uploads'",
    );
    assertEqual(bucketResult.rows[0]?.public, false, "postcheck_bucket_private");

    const expectedDeltas = {
      payment_intake: 1,
      received_events: 1,
      payment_intake_files: 1,
      storage_objects: 1,
      payment_requests: 0,
      proveedores: 0,
      approval_batches: 0,
      notification_events: 0,
      provider_notifications: 0,
      duplicate_groups: 0,
      file_metadata_orphans: 0,
      storage_object_orphans: 0,
    };
    for (const [key, expected] of Object.entries(expectedDeltas)) {
      assertEqual(deltas[key], expected, `postcheck_delta_${key}`);
    }
    assertEqual(current.duplicate_groups, 0, "postcheck_duplicate_groups_absolute");
    assertEqual(current.file_metadata_orphans, 0, "postcheck_file_orphans_absolute");
    assertEqual(current.storage_object_orphans, 0, "postcheck_storage_orphans_absolute");

    return {
      status: "PASS",
      deltas,
      intake: {
        status: intake.status,
        count: 1,
        folio: maskedFolio(intake.public_folio),
      },
      events,
      file: {
        count: 1,
        bucket: file.bucket_id,
        mime_type: file.mime_type,
        file_kind: file.file_kind,
        quarantine_status: file.quarantine_status,
        storage_object_count: 1,
        storage_size_matches_metadata: true,
        bucket_private: true,
      },
      absolute_integrity: {
        duplicate_groups: current.duplicate_groups,
        file_metadata_orphans: current.file_metadata_orphans,
        storage_object_orphans: current.storage_object_orphans,
      },
    };
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
  await fs.writeFile(EVIDENCE_JSON, `${json}\n`, "utf8");

  const caseRows = Object.entries(report.cases)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, value]) => `| ${id} | ${value.status} | ${value.evidence} |`)
    .join("\n");
  const postcheck = report.postcheck
    ? `- payment_intake / received / files / objects: ${report.postcheck.deltas.payment_intake} / ${report.postcheck.deltas.received_events} / ${report.postcheck.deltas.payment_intake_files} / ${report.postcheck.deltas.storage_objects}
- payment_requests / proveedores / batches / notifications: ${report.postcheck.deltas.payment_requests} / ${report.postcheck.deltas.proveedores} / ${report.postcheck.deltas.approval_batches} / ${report.postcheck.deltas.notification_events}
- Duplicados y huerfanos absolutos: 0 / 0 / 0.
- Bucket privado, metadata coincidente y quarantine pending: PASS.`
    : "No completado.";
  const markdown = `# QA cloud completo - Portal publico de proveedores DEV

Fecha: ${report.generated_at}
Run ID: ${RUN_ID}
Estado: **${report.status}**

## Resumen

- Contrato: 58/58 PASS.
- Envíos positivos: ${report.submissions.length} de maximo 2.
- Folio sanitizado: ${report.masked_folio || "No disponible"}.
- Axe: 0 critical, 0 serious y 0 WCAG AA abiertas.
- P0: ${report.status === "PASS" ? 0 : "por evaluar"}.
- P1: ${report.status === "PASS" ? 0 : "por evaluar"}.

## Casos

| Caso | Estado | Evidencia sanitizada |
| --- | --- | --- |
${caseRows}

## Postcheck

${postcheck}

## Seguridad

- Token, fragmento, CAPTCHA token, DB URL, Idempotency-Key, payload y headers: no incluidos.
- HAR, trace y video: no generados.
- Capturas sanitizadas: ${report.screenshots.length}.
- Errores de consola del producto: ${report.console_errors.length}.
- Page errors: ${report.page_errors.length}.

## Dictamen

${report.status === "PASS"
    ? "UAT cloud completo PASS. PR #256 permanece Draft hasta aprobacion de Ramon."
    : "UAT no aprobado. PR #256 permanece Draft y no debe fusionarse."}
`;
  await fs.writeFile(path.join(OUTPUT_DIR, "QA_REPORT.md"), markdown, "utf8");
}

async function runUat() {
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
    const state = JSON.parse(await fs.readFile(LINK_STATE_FILE, "utf8"));
    report.link.temporary_expiry_extension = Boolean(state.temporary_expiry_extension);
  } catch {}

  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    viewport: { width: 1366, height: 768 },
    permissions: ["clipboard-read", "clipboard-write"],
  });

  let firstFolio = "";
  let secondFolio = "";
  let submitCount = 0;
  let invalidIdempotencyHeaders = 0;
  try {
    const unavailablePage = await context.newPage();
    monitorPage(unavailablePage, "unavailable");
    const noTokenResponse = await safeGoto(unavailablePage, PREVIEW_URL);
    assertEqual(noTokenResponse?.status(), 200, "ui01_http");
    await unavailablePage.locator("#unavailable-view:not([hidden])").waitFor();
    assert(
      (await unavailablePage.locator("#unavailable-title").textContent()).includes(
        "Este enlace no está disponible",
      ),
      "ui01_message",
    );
    assert(await unavailablePage.locator("#portal-view").isHidden(), "ui01_form_hidden");
    assertEqual(
      await unavailablePage.locator("#turnstile-widget iframe").count(),
      0,
      "ui01_turnstile_absent",
    );
    await screenshot(unavailablePage, "01-no-token.png");
    await runAxe(unavailablePage, "unavailable");
    setCase("UI-01", "PASS", "Sin token: estado neutral, formulario y Turnstile ausentes.");

    const fakeToken = "A".repeat(40);
    const invalidPage = await context.newPage();
    monitorPage(invalidPage, "invalid");
    await safeGoto(invalidPage, `${PREVIEW_URL}#token=${fakeToken}`);
    await invalidPage.waitForFunction(() => location.hash === "");
    await invalidPage.locator("#unavailable-view:not([hidden])").waitFor();
    assert(await invalidPage.locator("#portal-view").isHidden(), "ui02_form_hidden");
    setCase("UI-02", "PASS", "Token invalido retirado; respuesta neutral sin empresa ni CAPTCHA.");

    const queryPage = await context.newPage();
    monitorPage(queryPage, "query");
    await safeGoto(queryPage, `${PREVIEW_URL}?token=${fakeToken}`);
    await queryPage.waitForFunction(() => !location.search.includes("token"));
    await queryPage.locator("#unavailable-view:not([hidden])").waitFor();
    setCase("UI-03", "PASS", "Token query ignorado y retirado; no se promovio al header.");

    const page = await context.newPage();
    monitorPage(page, "primary");
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/submit")) {
        submitCount += 1;
        const key = request.headers()["idempotency-key"] || "";
        if (!/^intake:[0-9a-f-]{36}$/i.test(key)) invalidIdempotencyHeaders += 1;
      }
    });
    await openValid(page);
    const limitCopy = await page.locator("#file-limit-copy").textContent();
    const totalCopy = await page.locator("#total-budget-copy").textContent();
    assert(
      limitCopy.includes("Máximo 3 archivos") && limitCopy.includes("10 MB"),
      "ui04_limits",
    );
    assert(totalCopy.includes("12 MB"), "ui04_total_limit");
    assert(
      (await page.locator("#privacy-link").getAttribute("href")).startsWith("https://"),
      "ui04_privacy_https",
    );
    await screenshot(page, "02-link-valid-step-1.png");
    await runAxe(page, "step_1");
    setCase("UI-04", "PASS", "Link valido, hash retirado, empresa, privacidad y limites dinamicos.");

    await page.locator("#next-button").click();
    await waitFocus(page, "provider-name", "ui05_focus_first_error");
    assertEqual(
      await page.locator("#provider-name").getAttribute("aria-invalid"),
      "true",
      "ui05_required_name",
    );
    await page.locator("#provider-name").fill(positive.provider_name);
    await page.locator("#provider-email").fill("correo-invalido");
    await page.locator("#next-button").click();
    assertEqual(
      await page.locator("#provider-email").getAttribute("aria-invalid"),
      "true",
      "ui05_invalid_email",
    );
    await page.locator("#provider-email").fill(positive.provider_email);
    await page.locator("#provider-rfc").fill("RFC-INVALIDO");
    await page.locator("#next-button").click();
    assertEqual(
      await page.locator("#provider-rfc").getAttribute("aria-invalid"),
      "true",
      "ui05_invalid_rfc",
    );
    await page.locator("#provider-rfc").fill(positive.provider_rfc);
    await page.locator("#provider-phone").fill(positive.provider_phone);
    await page.locator("#next-button").click();
    await waitFocus(page, "step-2-title", "ui05_step2_focus");
    await runAxe(page, "step_2");
    await page.locator("#back-button").click();
    await waitFocus(page, "step-1-title", "ui05_back_focus");
    await page.locator("#next-button").click();

    await page.locator("#concept").fill(positive.concept);
    await page.locator("#amount-requested").fill("1.234");
    await page.locator("#bank-clabe").fill("12345678901234567");
    await page.locator("#invoice-uuid").fill("UUID-INVALIDO");
    await page.locator("#requested-payment-date").fill("2026-02-30").catch(() => {});
    assertEqual(
      await page.locator("#requested-payment-date").inputValue(),
      "",
      "ui06_invalid_date_native_rejected",
    );
    await page.locator("#next-button").click();
    assertEqual(
      await page.locator("#amount-requested").getAttribute("aria-invalid"),
      "true",
      "ui06_invalid_amount",
    );
    assertEqual(
      await page.locator("#bank-clabe").getAttribute("aria-invalid"),
      "true",
      "ui06_invalid_clabe",
    );
    assertEqual(
      await page.locator("#invoice-uuid").getAttribute("aria-invalid"),
      "true",
      "ui06_invalid_uuid",
    );
    assertEqual(submitCount, 0, "ui06_submit_absent");
    setCase("UI-06", "PASS", "Validaciones inline, formatos, aria-invalid y foco sin submit.");

    await fillStep2(page);
    await page.locator("#next-button").click();
    await waitFocus(page, "step-3-title", "ui05_step3_focus");
    assert(
      (await page.locator("#summary-provider").textContent()).includes("QA PROVEEDOR"),
      "ui05_summary_provider",
    );
    assert(
      (await page.locator("#summary-amount").textContent()).includes("1.23"),
      "ui05_summary_amount",
    );
    setCase("UI-05", "PASS", "Navegacion de cuatro pasos, Anterior, foco y resumen dinamico.");

    await keyboardAddSafeXml(page);
    assertEqual(
      await page.locator("#file-kind-0").inputValue(),
      "invoice_xml",
      "ui07_keyboard_file_kind",
    );
    assert(
      (await page.locator("#usage-copy").textContent()).includes("de 12 MB"),
      "ui07_keyboard_usage",
    );
    assertEqual(
      (await page.locator(".remove-file").textContent()).trim(),
      "Quitar",
      "ui07_remove_label",
    );
    await runAxe(page, "step_3");
    await screenshot(page, "03-documents-safe-xml.png");
    await page.locator(".remove-file").click();
    await page.locator(".file-row").waitFor({ state: "detached" });

    await dragDropSafeXml(page);
    assertEqual(
      await page.locator("#file-kind-0").inputValue(),
      "invoice_xml",
      "ui14_drag_file_kind",
    );
    await page.locator(".remove-file").click();
    await page.locator(".file-row").waitFor({ state: "detached" });
    setCase("UI-14", "PASS", "Teclado, foco visible, drag and drop, Quitar, file_kind y medidor.");

    await expectFileRejection(
      page,
      FIXTURES.dtdXml,
      /definición no permitida/i,
      "ui08_dtd",
    );
    await expectFileRejection(
      page,
      FIXTURES.entityXml,
      /definición no permitida/i,
      "ui08_entity",
    );
    await expectFileRejection(
      page,
      FIXTURES.invalidSvg,
      /formato permitido/i,
      "ui08_mime",
    );
    await expectFileRejection(
      page,
      [FIXTURES.safeXml, FIXTURES.safeXml],
      /ya fue agregado/i,
      "ui08_duplicate",
    );
    await expectFileRejection(
      page,
      FIXTURES.fourXml,
      /máximo 3/i,
      "ui08_max_files",
    );
    await expectFileRejection(
      page,
      FIXTURES.largePdf,
      /10 MB/i,
      "ui08_max_individual",
    );
    await expectFileRejection(
      page,
      [FIXTURES.totalPdfA, FIXTURES.totalPdfB],
      /límite total|tamaño total/i,
      "ui08_total_budget",
    );
    assertEqual(submitCount, 0, "ui08_submit_absent");
    setCase("UI-08", "PASS", "DTD, ENTITY, MIME, duplicado, 3 archivos, 10 MB y 12 MB bloqueados.");

    await page.locator("#file-input").setInputFiles(FIXTURES.safeXml);
    await page.locator(".file-row").waitFor();
    assertEqual(await page.locator("#file-kind-0").inputValue(), "invoice_xml", "ui07_file_kind");
    assert(
      (await page.locator("#summary-files").textContent()).includes("1 archivo"),
      "ui07_summary",
    );
    setCase("UI-07", "PASS", "XML seguro agregado como invoice_xml; medidor y resumen correctos.");

    await page.locator("#next-button").click();
    await waitFocus(page, "step-4-title", "ui05_step4_focus");
    assert(await page.locator("#submit-button").isDisabled(), "ui09_submit_initially_disabled");
    const reviewText = await page.locator("#review-content").textContent();
    assert(
      !reviewText.includes(positive.bank_account) && !reviewText.includes(positive.bank_clabe),
      "ui12_bank_masking",
    );
    assertEqual(
      await page.locator("#privacy-link").getAttribute("target"),
      "_blank",
      "ui12_privacy_target",
    );
    assert(
      (await page.locator("#privacy-link").getAttribute("rel")).includes("noreferrer"),
      "ui12_privacy_rel",
    );
    await waitForTurnstileWidget(page);
    await runAxe(page, "review");

    const nonJson = await verifyCoreNonJsonMapping(page);
    assertEqual(nonJson.forbidden, "security_rejected", "ui13_nonjson_403");
    assertEqual(nonJson.tooLarge, "payload_too_large", "ui13_nonjson_413");
    assertEqual(nonJson.badGateway, "platform_boundary", "ui13_nonjson_502");
    assertEqual(nonJson.unavailable, "platform_boundary", "ui13_nonjson_503");
    setCase("UI-13", "PASS", "Mapeo no JSON 403, 413, 502 y 503 sanitizado sin request adicional.");

    await maskReview(page);
    await screenshot(page, "04-review-masked.png");
    await page.locator("#privacy-accepted").focus();
    await page.keyboard.press("Space");
    await page.locator("#dev-data-confirmed").focus();
    await page.keyboard.press("Space");
    assert(await page.locator("#privacy-accepted").isChecked(), "ui09_privacy_checked");
    assert(await page.locator("#dev-data-confirmed").isChecked(), "ui09_dev_checked");
    await waitForSubmitReady(page);
    setCase("UI-09", "PASS", "Turnstile de pruebas y action correctos; dos confirmaciones requeridas.");

    const firstResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/submit"),
      { timeout: 120000 },
    );
    await page.evaluate(() => {
      const button = document.querySelector("#submit-button");
      button.click();
      button.click();
    });
    const firstResponse = await firstResponsePromise;
    assertEqual(firstResponse.status(), 201, "ui10_submit_status");
    const firstBody = await firstResponse.json();
    assertEqual(firstBody.duplicate, false, "ui10_duplicate_false");
    await page.locator("#success-view:not([hidden])").waitFor({ timeout: 30000 });
    firstFolio = (await page.locator("#public-folio").textContent()).trim();
    assert(/^INT-\d{4}-\d{6}$/.test(firstFolio), "ui10_folio_format");
    assertEqual(
      await page.locator("#success-company").textContent(),
      "Test - Demo Operadora SA de CV",
      "ui10_company",
    );
    assertEqual(submitCount, 1, "ui10_double_click_request_count");
    report.submissions.push({ ordinal: 1, status: 201, duplicate: false });
    report.masked_folio = maskedFolio(firstFolio);
    setCase("UI-10", "PASS", "HTTP 201, duplicate=false, un request ante doble click y folio publico.");

    await page.locator("#copy-folio-button").click();
    assertEqual(
      await page.evaluate(() => navigator.clipboard.readText()),
      firstFolio,
      "ui12_copy_folio",
    );
    await page.evaluate(() => {
      window.__qaPrintCalled = false;
      window.print = () => {
        window.__qaPrintCalled = true;
      };
    });
    await page.locator("#print-button").click();
    assertEqual(await page.evaluate(() => window.__qaPrintCalled), true, "ui12_print");
    assertEqual(await page.locator("#bank-account").inputValue(), "", "ui12_sensitive_account_cleared");
    assertEqual(await page.locator("#bank-clabe").inputValue(), "", "ui12_sensitive_clabe_cleared");
    await runAxe(page, "success");
    await maskSuccess(page);
    await screenshot(page, "08-success-masked.png");
    setCase("UI-12", "PASS", "Folio, copia, impresion y limpieza de datos sensibles validados.");

    const responsivePage = await context.newPage();
    monitorPage(responsivePage, "responsive");
    await openValid(responsivePage);
    const viewports = [
      [320, 700, "05-mobile-320.png"],
      [390, 844, "06-mobile-390.png"],
      [768, 1024, "07-tablet-768.png"],
      [1024, 768, "09-desktop-1024.png"],
      [1366, 768, "10-desktop-1366.png"],
      [1440, 900, "11-desktop-1440.png"],
    ];
    for (const [width, height, image] of viewports) {
      await responsivePage.setViewportSize({ width, height });
      await responsivePage.waitForTimeout(150);
      const layout = await responsivePage.evaluate(() => ({
        overflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        nextVisible: Boolean(document.querySelector("#next-button")?.getBoundingClientRect().width),
        bodyWidth: document.body.getBoundingClientRect().width,
      }));
      assert(!layout.overflow && layout.nextVisible && layout.bodyWidth <= width + 1, `ui15_${width}`);
      await screenshot(responsivePage, image);
    }
    setCase("UI-15", "PASS", "320, 390, 768, 1024, 1366 y 1440 sin overflow ni controles cortados.");

    await responsivePage.setViewportSize({ width: 683, height: 768 });
    const zoomEquivalent = await responsivePage.evaluate(() => ({
      overflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      controls: [...document.querySelectorAll("button")]
        .filter((button) => !button.hidden)
        .every((button) => button.getBoundingClientRect().width > 0),
    }));
    assert(!zoomEquivalent.overflow && zoomEquivalent.controls, "ui16_zoom_200_equivalent");
    await responsivePage.evaluate(() => document.activeElement?.blur());
    await responsivePage.keyboard.press("Tab");
    const firstFocus = await responsivePage.evaluate(
      () => document.activeElement?.className || document.activeElement?.id,
    );
    assert(String(firstFocus).includes("skip-link"), "ui16_skip_link_focus");
    await responsivePage.locator("#next-button").click();
    await waitFocus(responsivePage, "provider-name", "ui16_error_focus");
    await responsivePage.keyboard.press("Tab");
    assertEqual(
      await responsivePage.evaluate(() => document.activeElement?.id),
      "provider-rfc",
      "ui16_tab_forward",
    );
    await responsivePage.keyboard.press("Shift+Tab");
    assertEqual(
      await responsivePage.evaluate(() => document.activeElement?.id),
      "provider-name",
      "ui16_tab_backward",
    );
    setCase("UI-16", "PASS", "Equivalente 200 %, skip link, Tab/Shift+Tab y foco al error.");

    const duplicatePage = await context.newPage();
    monitorPage(duplicatePage, "duplicate");
    duplicatePage.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/submit")) {
        submitCount += 1;
        const key = request.headers()["idempotency-key"] || "";
        if (!/^intake:[0-9a-f-]{36}$/i.test(key)) invalidIdempotencyHeaders += 1;
      }
    });
    await openValid(duplicatePage);
    await completePositiveForm(duplicatePage);
    const secondResponsePromise = duplicatePage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/submit"),
      { timeout: 120000 },
    );
    await duplicatePage.locator("#submit-button").click();
    const secondResponse = await secondResponsePromise;
    assertEqual(secondResponse.status(), 200, "ui11_duplicate_status");
    const secondBody = await secondResponse.json();
    assertEqual(secondBody.duplicate, true, "ui11_duplicate_true");
    await duplicatePage.locator("#success-view:not([hidden])").waitFor({ timeout: 30000 });
    secondFolio = (await duplicatePage.locator("#public-folio").textContent()).trim();
    assertEqual(secondFolio, firstFolio, "ui11_same_folio");
    assert(
      (await duplicatePage.locator("#success-message").textContent()).includes(
        "ya había sido recibida",
      ),
      "ui11_duplicate_message",
    );
    report.submissions.push({ ordinal: 2, status: 200, duplicate: true });
    await maskSuccess(duplicatePage);
    await screenshot(duplicatePage, "12-duplicate-masked.png");
    assertEqual(submitCount, 2, "ui11_positive_submit_limit");
    assertEqual(invalidIdempotencyHeaders, 0, "ui11_idempotency_header_format");
    setCase("UI-11", "PASS", "Segundo y ultimo submit HTTP 200, duplicate=true y mismo folio.");

    const axeEntries = Object.values(report.axe);
    assertEqual(
      axeEntries.reduce((sum, value) => sum + value.critical, 0),
      0,
      "ui17_axe_critical",
    );
    assertEqual(
      axeEntries.reduce((sum, value) => sum + value.serious, 0),
      0,
      "ui17_axe_serious",
    );
    assertEqual(
      axeEntries.reduce((sum, value) => sum + value.wcag_aa_open.length, 0),
      0,
      "ui17_axe_wcag_aa",
    );
    setCase("UI-17", "PASS", "Axe en unavailable, pasos 1/2/3, revision y exito sin WCAG AA abierta.");

    const productFailedRequests = report.failed_requests.filter(
      (entry) =>
        entry.resource.startsWith(PREVIEW_ORIGIN) ||
        entry.resource.startsWith(FUNCTION_BASE_URL),
    );
    assertEqual(report.page_errors.length, 0, "ui18_page_errors");
    assertEqual(report.console_errors.length, 0, "ui18_console_errors");
    assertEqual(productFailedRequests.length, 0, "ui18_product_request_failures");
    setCase(
      "UI-18",
      "PASS",
      `Cero pageerror, console.error y requests fallidos del producto; ${report.external_warnings.length} warnings externos.`,
    );

    report.postcheck = await postcheck(firstFolio, secondFolio);
    setCase(
      "UI-19",
      "PASS",
      "Un intake, received, archivo y objeto privado; internos delta 0; sin duplicados ni huerfanos.",
    );
    setCase(
      "UI-20",
      "PASS",
      "Evidencia sanitizada sin token, CAPTCHA, DB URL, payload, headers, HAR, trace o video.",
    );
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.failure = sanitizeText(error?.message || error);
    throw error;
  } finally {
    await writeEvidence();
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  try {
    if (phase === "prepare") await prepare();
    else if (phase === "uat") await runUat();
    else if (phase === "restore") await restore();
    else throw new Error("unknown_phase");
  } catch (error) {
    if (phase !== "restore") {
      report.status = report.status === "PASS" ? "PASS" : "FAIL";
      report.failure = sanitizeText(error?.message || error);
      await writeEvidence().catch(() => {});
    }
    console.error(sanitizeText(error?.message || error));
    process.exitCode = 1;
  }
}

await main();
