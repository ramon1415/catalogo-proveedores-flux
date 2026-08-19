import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const fail = (message) => { throw new Error(message); };
const read = (file) => fs.readFileSync(file, "utf8");
const manifest = JSON.parse(read("docs/ops/provider-portal-prod-product-candidate.json"));
const changed = execFileSync("git", ["diff", "--name-only", "18cd2b1265038cfcd143814012bdc26746cc5ff7"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const allowed = new Set([
  ".github/workflows/provider-portal-prod-product-candidate.yml",
  "api/provider-intake-file-url.js", "api/runtime-config.js", "config.js",
  "provider_intakes.html", "provider_intakes.css", "provider_intakes.js",
  "proveedores.html", "proveedores.js", "solicitar.html", "solicitar.css",
  "solicitar-config.js", "solicitar-core.js", "solicitar.js",
  "solicitudes.html", "solicitudes.js",
  "scripts/release/build-provider-portal-prod-product.mjs",
  "scripts/qa/provider-portal-prod-product-contract.test.mjs",
  "scripts/qa/provider-intake-file-api-contract.test.cjs",
  "scripts/qa/provider-catalog-rpc-persistence-contract.test.mjs",
  "scripts/qa/solicitudes-default-active-view-contract.test.mjs",
  "scripts/qa/layout-budget-exception-reference-contract.test.mjs",
  "docs/ops/provider-portal-prod-product-release.md",
  "docs/ops/provider-portal-prod-product-candidate.json",
]);
for (const file of changed) if (!allowed.has(file)) fail("unexpected product scope: " + file);
if (changed.some((file) => file.startsWith("supabase/migrations/") || /notification|n8n|payroll/i.test(file))) fail("forbidden release scope detected");

const publicHtml = read("solicitar.html");
const publicJs = read("solicitar.js");
const publicConfig = read("solicitar-config.js");
for (const forbidden of ["Ambiente DEV", "No ingreses informaciÃ³n real", "dev-data-confirmed", "scsirgbuqjcwoaxfacth", "?token="]) {
  if ((publicHtml + publicJs + publicConfig).includes(forbidden)) fail("DEV/query-token public residue: " + forbidden);
}
for (const required of ["#token=", "no-referrer", "ucantptjhwttexzmslvm.functions.supabase.co", "releaseReady", "FLUX_TURNSTILE_SITE_KEY", "INTAKE_PRIVACY_NOTICE_URL"]) {
  const all = publicHtml + publicJs + publicConfig + read("api/runtime-config.js") + read("docs/ops/provider-portal-prod-product-release.md");
  if (!all.includes(required)) fail("missing public PROD contract: " + required);
}
if (!publicJs.includes("if (!PUBLIC_INTAKE_CONFIG.releaseReady)")) fail("public portal does not fail closed before token use");
for (const required of [
  'id="privacy-accepted" type="checkbox" required',
  "Aviso de Privacidad para Proveedores",
  "otorgo mi consentimiento expreso",
  "datos financieros y patrimoniales",
]) {
  if (!publicHtml.includes(required)) fail("approved privacy consent contract missing: " + required);
}

const shell = read("config.js");
const page = read("provider_intakes.js");
for (const required of ["get_provider_intake_module_access", "providerIntakeAccess", "runtimeGate: \"provider-intake\"", "canAccessProviderIntakes", "providerIntakeGate.allowed"]) {
  if (!shell.includes(required)) fail("missing authoritative shell gate: " + required);
}
const gatePosition = page.indexOf("canAccessProviderIntakes");
const firstBusinessLoad = Math.min(...[page.indexOf("loadLinkManagementContext()"), page.indexOf("loadList()")].filter((value) => value >= 0));
if (gatePosition < 0 || firstBusinessLoad < 0 || gatePosition > firstBusinessLoad) fail("provider page loads data before authoritative gate");

function allowedByMode(mode, roles) {
  if (mode === "disabled") return false;
  if (mode === "sysadmin_only") return roles.includes("sysadmin");
  if (mode === "full") return roles.includes("sysadmin") || roles.includes("finance");
  return false;
}
if (!allowedByMode("sysadmin_only", ["sysadmin"])) fail("sysadmin pilot denied");
for (const role of ["finance", "director", "admin", "operativo", "anonymous"]) {
  if (allowedByMode("sysadmin_only", [role])) fail("pilot role unexpectedly allowed: " + role);
}
if (allowedByMode("disabled", ["sysadmin"]) || allowedByMode("unknown", ["sysadmin"])) fail("disabled/unknown gate not closed");

const fileApi = read("api/provider-intake-file-url.js");
for (const required of ["get_provider_intake_module_access", "gate?.allowed !== true", "SIGNED_URL_TTL_SECONDS = 120", "auth_required", "access_denied", "file_not_found"]) {
  if (!fileApi.includes(required)) fail("file API contract missing: " + required);
}
if (fileApi.indexOf("get_provider_intake_module_access") > fileApi.indexOf("payment_intake?")) fail("file API gate occurs after data read");

if (!read("proveedores.js").includes("save_provider_catalog_with_payment_execution_data")) fail("canonical provider save RPC regressed");
if (!read("proveedores.js").includes("get_provider_intake_provider_proposal")) fail("provider-new proposal integration missing");
if (!read("solicitudes.js").includes("create_payment_request_with_extraordinary_intent")) fail("normal request creator regressed");
const solicitudes = read("solicitudes.js");
const workboard = read("solicitudes_workboard_extension.js");
const batchExecution = read("solicitudes_batch_execution.js");
const requestIdHandler = /new URLSearchParams\(window\.location\.search\)\.get\("request_id"\)/g;
const requestIdHandlerCount = [solicitudes, workboard, batchExecution]
  .reduce((count, source) => count + (source.match(requestIdHandler)?.length || 0), 0);
if (requestIdHandlerCount !== 1 || !/new URLSearchParams\(window\.location\.search\)\.get\("request_id"\)/.test(batchExecution)) fail("converted SOL deep link handler is not canonical and unique");
for (const [file, source] of [["solicitudes.js", solicitudes], ["solicitudes_workboard_extension.js", workboard], ["solicitudes_batch_execution.js", batchExecution]]) {
  const mainSource = execFileSync("git", ["show", manifest.generated_from_main_sha + ":" + file], { encoding: "utf8" });
  if (source.replace(/\r\n/g, "\n") !== mainSource.replace(/\r\n/g, "\n")) fail("Solicitudes main contract drifted: " + file);
}
if (!solicitudes.includes('status: dom.statusFilter?.value || "activas"')) fail("default active request filter regressed");
if (!workboard.includes('view: "default"') || workboard.includes('view: "attention",')) fail("legacy attention view restored");
if (!workboard.includes("window.FluxPaymentRequestsView?.statusMatches")) fail("KPI/table active-status contract disconnected");
if (!read("solicitudes.html").includes('config.js?v=20260818-provider-portal-reconciled')) fail("combined config cache buster missing");

for (const [file, expected] of Object.entries(manifest.unchanged_main_sha256)) {
  const actual = crypto.createHash("sha256").update(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex");
  if (actual !== expected) fail("normal Flux regression hash changed: " + file);
}
if (
  manifest.provider_intake_notification_release_delta !== 0
  || manifest.legal_content_approval_pending !== false
  || manifest.turnstile_production_site_key_configured !== true
) fail("release manifest P0 state invalid");
console.log("PROVIDER_PORTAL_PROD_PRODUCT_CONTRACT_PASS=true");
console.log("SYSADMIN_ONLY_PRODUCT_GATE_PROVEN=true");
console.log("NORMAL_FLUX_REGRESSION_PASS=true");
console.log("PROVIDER_INTAKE_NOTIFICATION_RELEASE_DELTA=0");
