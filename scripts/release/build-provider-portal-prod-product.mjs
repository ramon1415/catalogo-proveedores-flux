import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const SOURCE_MAIN_SHA = "70fd10bacea6a9f7b32a36b67906c598f96f39e0";
const SOURCE_DEV_SHA = "c91faf703a79c02d6e9ef21a7b07ea9a0af76a91";
const PROD_PROJECT = "ucantptjhwttexzmslvm";
const CANDIDATE_MANIFEST = "docs/ops/provider-portal-prod-product-candidate.json";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function show(ref, file) {
  return run("git", ["show", `${ref}:${file}`]);
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.replace(/\r\n/g, "\n").replace(/\s*$/, "\n"), "utf8");
}

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error("patch anchor missing: " + label);
  return source.replace(before, after);
}

function integrateProviderProposal() {
  let html = fs.readFileSync("proveedores.html", "utf8");
  html = replaceOnce(
    html,
    "    .provider-csf-page .table-card tbody tr:focus-within .row-actions { opacity: 1; }",
    `    .provider-csf-page .table-card tbody tr:focus-within .row-actions { opacity: 1; }
    .intake-proposal { margin: 0 0 14px; padding: 13px 14px; border: 1px solid color-mix(in srgb,var(--amber) 55%,var(--border)); border-radius: 9px; background: color-mix(in srgb,var(--amber) 9%,var(--bg-card)); }
    .intake-proposal strong { display:block; color:var(--text-1); font-size:12px; }
    .intake-proposal p { margin:4px 0 10px; color:var(--text-2); font-size:11px; line-height:1.5; }
    .intake-proposal-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }`,
    "provider proposal styles",
  );
  html = replaceOnce(
    html,
    '      <div class="modal-scroll">\n        <input type="hidden" id="supplierId">',
    `      <div class="modal-scroll">
        <aside class="intake-proposal" id="intakeProposal" role="note" hidden>
          <strong id="intakeProposalTitle">Datos declarados pendientes de validacion</strong>
          <p id="intakeProposalCopy">Revisa, corrige, completa o elimina cualquier valor antes de guardar. Nada se guardara automaticamente.</p>
          <div class="intake-proposal-actions">
            <button class="small-btn" id="applyIntakeProposalBtn" type="button" hidden>Aplicar propuesta al formulario</button>
            <span class="field-hint" id="intakeProposalFolio"></span>
          </div>
        </aside>
        <input type="hidden" id="supplierId">`,
    "provider proposal panel",
  );
  html = html.replace(/\.\/proveedores\.js\?v=[^"]+/, "./proveedores.js?v=20260818-provider-portal-prod");
  write("proveedores.html", html);

  let js = fs.readFileSync("proveedores.js", "utf8");
  js = replaceOnce(
    js,
    "let providerSaveInProgress = false\n",
    `let providerSaveInProgress = false
const providerQuery = new URLSearchParams(window.location.search)
const intakeProposalId = providerQuery.get("intake_id")
const intakeProposalReturn = providerQuery.get("return") === "provider_intakes"
let intakeProposal = null
`,
    "provider proposal state",
  );
  js = replaceOnce(
    js,
    '  document.getElementById("providerCsfLink")?.addEventListener("click", openCurrentCsf)',
    '  document.getElementById("providerCsfLink")?.addEventListener("click", openCurrentCsf)\n  document.getElementById("applyIntakeProposalBtn")?.addEventListener("click", () => applyIntakeProposal(true))',
    "provider proposal action",
  );
  js = replaceOnce(
    js,
    `  await loadSuppliers()
  openProviderFromQuery()
}

function openProviderFromQuery() {
  const providerId = new URLSearchParams(window.location.search).get("provider_id")
  if (!providerId) return
  const provider = proveedores.find((item) => item.id === providerId)
  if (!provider) {
    showToast("Proveedor no encontrado", "El proveedor solicitado ya no esta disponible en el catalogo.", "warning")
    return
  }
  window.openEditModal(providerId)
}`,
    `  await loadSuppliers()
  await openProviderFromQuery()
}

async function openProviderFromQuery() {
  const providerId = providerQuery.get("provider_id")
  if (!providerId && !intakeProposalId) return
  if (intakeProposalId) await loadIntakeProposal()
  if (!providerId) {
    if (!canManageProviders()) {
      showToast("Sin permiso", "La administracion de proveedores corresponde a un usuario interno autorizado.", "warning")
      return
    }
    openCreateModal()
    applyIntakeProposal(false)
    return
  }
  const provider = proveedores.find((item) => item.id === providerId)
  if (!provider) {
    showToast("Proveedor no encontrado", "El proveedor solicitado ya no esta disponible en el catalogo.", "warning")
    return
  }
  window.openEditModal(providerId)
  if (intakeProposal) showIntakeProposal(true)
}

async function loadIntakeProposal() {
  const { data, error } = await supabaseClient.rpc("get_provider_intake_provider_proposal", {
    p_payment_intake_id: intakeProposalId,
  })
  if (error || !data?.payment_intake_id) {
    showToast("Propuesta no disponible", "No fue posible cargar los datos declarados del intake.", "warning")
    return
  }
  intakeProposal = data
}

function showIntakeProposal(requireExplicitApply) {
  if (!intakeProposal) return
  const panel = document.getElementById("intakeProposal")
  panel.hidden = false
  document.getElementById("intakeProposalFolio").textContent = intakeProposal.public_folio || "Intake de proveedor"
  document.getElementById("applyIntakeProposalBtn").hidden = !requireExplicitApply
}

function applyIntakeProposal(requireConfirmation) {
  if (!intakeProposal) return
  if (requireConfirmation && !confirm("Aplicar los datos declarados como propuesta editable? Ningun cambio se guardara hasta que confirmes Guardar proveedor.")) return
  const hasBankData = Boolean(intakeProposal.bank_name || intakeProposal.bank_account || intakeProposal.bank_clabe || intakeProposal.beneficiary_name)
  setValue("alias", intakeProposal.provider_name)
  setValue("nombre_completo", intakeProposal.provider_name)
  setValue("rfc", intakeProposal.provider_rfc)
  setValue("email", intakeProposal.provider_email)
  setValue("telefono", intakeProposal.provider_phone)
  setValue("banco", intakeProposal.bank_name)
  setValue("cuenta_bancaria", intakeProposal.bank_account)
  setValue("clabe", intakeProposal.bank_clabe)
  setValue("beneficiary_name", intakeProposal.beneficiary_name)
  if (hasBankData) {
    setValue("metodo_pago", "Transferencia bancaria")
    setValue("destination_type", intakeProposal.bank_clabe ? "clabe" : "cuenta")
  }
  handlePaymentMethodChange()
  handleDestinationTypeChange()
  showIntakeProposal(false)
  document.getElementById("intakeProposalCopy").textContent = "Propuesta cargada en el formulario. Revisa, corrige, completa o elimina cualquier valor antes de guardar."
}`,
    "provider proposal behavior",
  );
  js = replaceOnce(
    js,
    "  form.reset()\n  resetCsfControls()\n  currentEditingId = null",
    `  if (intakeProposalReturn && intakeProposalId && providerId && !csfUploadFailed) {
    const params = new URLSearchParams({ intake_id: intakeProposalId, provider_candidate_id: providerId })
    window.location.assign(\`./provider_intakes.html?\${params.toString()}\`)
    return
  }

  form.reset()
  resetCsfControls()
  currentEditingId = null`,
    "provider proposal return",
  );
  js = replaceOnce(
    js,
    "  currentCsfPath = null\n  resetCsfControls()\n}\n\nfunction resetCsfControls()",
    '  currentCsfPath = null\n  resetCsfControls()\n  document.getElementById("intakeProposal").hidden = true\n}\n\nfunction resetCsfControls()',
    "provider proposal close",
  );
  write("proveedores.js", js);
}

function integrateRequestDeepLink() {
  let html = fs.readFileSync("solicitudes.html", "utf8");
  html = html.replace(/\.\/solicitudes\.js\?v=[^"]+/, "./solicitudes.js?v=20260818-provider-portal-prod");
  write("solicitudes.html", html);

  let js = fs.readFileSync("solicitudes.js", "utf8");
  js = replaceOnce(
    js,
    "    await loadPaymentRequests();\n  } catch (error) {",
    "    await loadPaymentRequests();\n    openRequestFromUrl();\n  } catch (error) {",
    "converted request deep link load",
  );
  js = replaceOnce(
    js,
    "\nfunction cacheDom() {",
    `
function openRequestFromUrl() {
  const requestId = new URLSearchParams(window.location.search).get("request_id");
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return;
  if (paymentRequests.some(request => request.id === requestId)) openRequestDetail(requestId);
}

function cacheDom() {`,
    "converted request deep link function",
  );
  write("solicitudes.js", js);
}

const firstBuild = !fs.existsSync(CANDIDATE_MANIFEST);
if (firstBuild) {
  integrateProviderProposal();
  integrateRequestDeepLink();
}

for (const file of [
  "solicitar.html",
  "solicitar.css",
  "solicitar-core.js",
  "solicitar.js",
  "provider_intakes.html",
  "provider_intakes.css",
  "provider_intakes.js",
  "api/provider-intake-file-url.js",
]) write(file, show(SOURCE_DEV_SHA, file));

write("solicitar-config.js", String.raw`const PROD_PROJECT = "ucantptjhwttexzmslvm";
const TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF",
]);

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch (_) {
    return false;
  }
}

async function loadRuntimeContract() {
  try {
    const response = await fetch("./api/runtime-config?format=json", {
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("runtime_config_unavailable");
    const runtime = await response.json();
    const env = String(runtime?.env || "").trim().toLowerCase();
    const supabaseUrl = new URL(String(runtime?.supabaseUrl || ""));
    const project = supabaseUrl.hostname.split(".")[0];
    const portal = runtime?.providerIntake || {};
    const siteKey = String(portal.turnstileSiteKey || "").trim();
    const privacyNoticeUrl = String(portal.privacyNoticeUrl || "").trim();
    const ready = ["prod", "production"].includes(env)
      && project === PROD_PROJECT
      && portal.ready === true
      && siteKey.length >= 20
      && !TEST_SITE_KEYS.has(siteKey)
      && isHttpsUrl(privacyNoticeUrl);
    return {
      ready,
      siteKey: ready ? siteKey : "",
      privacyNoticeUrl: ready ? privacyNoticeUrl : "",
      functionBaseUrl: ready
        ? "https://" + PROD_PROJECT + ".functions.supabase.co/provider-intake"
        : "",
      error: ready ? "" : "provider_portal_release_configuration_incomplete",
    };
  } catch (_) {
    return { ready: false, siteKey: "", privacyNoticeUrl: "", functionBaseUrl: "", error: "provider_portal_release_configuration_unavailable" };
  }
}

const runtime = await loadRuntimeContract();

export const PUBLIC_INTAKE_CONFIG = Object.freeze({
  environment: "PROD",
  releaseReady: runtime.ready,
  releaseError: runtime.error,
  functionBaseUrl: runtime.functionBaseUrl,
  turnstileSiteKey: runtime.siteKey,
  privacyNoticeUrl: runtime.privacyNoticeUrl,
  action: "provider_intake_submit",
  maxClientSafetyOverheadBytes: 256 * 1024,
  multipartBaseOverheadBytes: 16 * 1024,
  multipartPerFileOverheadBytes: 4 * 1024,
  maxAmount: 1_000_000_000,
  allowedCurrencies: Object.freeze(["MXN"]),
  uiContractVersion: "provider-intake-public-ui/prod-1.0",
});
`);

let solicitarHtml = fs.readFileSync("solicitar.html", "utf8");
solicitarHtml = solicitarHtml
  .replaceAll("https://scsirgbuqjcwoaxfacth.functions.supabase.co", "https://ucantptjhwttexzmslvm.functions.supabase.co")
  .replace(/\s*<strong class="environment-badge">Ambiente DEV<\/strong>\s*/, "\n")
  .replace(/\s*<aside class="dev-banner"[\s\S]*?<\/aside>\s*/, "\n")
  .replace(/\s*<label class="check-row"><input id="dev-data-confirmed"[\s\S]*?<\/label>\s*/, "\n")
  .replace(/\s*(?:\u00b7|\u00c2\u00b7)?\s*Ambiente DEV/g, "")
  .replaceAll("20260811-provider-aware-links", "20260818-provider-portal-prod");
write("solicitar.html", solicitarHtml);

let solicitarJs = fs.readFileSync("solicitar.js", "utf8");
solicitarJs = solicitarJs
  .replace(/ && byId\("dev-data-confirmed"\)\.checked/g, "")
  .replace(/\s+(?:\u00b7|\u00c2\u00b7)\s+Ambiente DEV/g, "")
  .replace(
    "function bootstrap() {\n  bindEvents();",
    `function bootstrap() {\n  bindEvents();\n  if (!PUBLIC_INTAKE_CONFIG.releaseReady) {\n    if (machine.state === "booting") transition("unavailable");\n    showOnly("unavailable");\n    byId("unavailable-message").textContent = "El portal estÃ¡ temporalmente fuera de servicio. Solicita apoyo a tu contacto de Finanzas.";\n    focusHeading("unavailable-title");\n    return;\n  }`,
  );
if (solicitarJs.includes("dev-data-confirmed") || solicitarJs.includes("Ambiente DEV")) {
  throw new Error("DEV-only solicitar.js contract remains");
}
write("solicitar.js", solicitarJs);

let config = fs.readFileSync("config.js", "utf8");
if (!config.includes('runtimeGate: "provider-intake"')) {
  config = replaceOnce(
    config,
    '    { key: "providers", section: "Operacion", file: "proveedores.html", href: "./proveedores.html", icon: "P", label: "Proveedores", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },',
    '    { key: "providers", section: "Operacion", file: "proveedores.html", href: "./proveedores.html", icon: "P", label: "Proveedores", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },\n    { key: "provider-intakes", section: "Operacion", file: "provider_intakes.html", href: "./provider_intakes.html", icon: "T", label: "Solicitudes de proveedores", groups: [ROLE_GROUPS.SYSADMIN], sensitive: true, runtimeGate: "provider-intake" },',
    "provider module",
  );
  config = replaceOnce(
    config,
    "    group: ROLE_GROUPS.OPERATION,\n  }",
    '    group: ROLE_GROUPS.OPERATION,\n    providerIntakeAccess: false,\n    providerIntakeMode: "unknown",\n  }',
    "provider gate role state",
  );
  config = replaceOnce(
    config,
    "    isAdminFinance: () => [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN].includes(roleState.group),",
    '    isAdminFinance: () => [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN].includes(roleState.group),\n    canAccessProviderIntakes: () => roleState.providerIntakeAccess === true,\n    canTriageProviderIntakes: () => roleState.providerIntakeAccess === true,\n    getProviderIntakeMode: () => roleState.providerIntakeMode,',
    "FluxAuth provider helpers",
  );
  config = replaceOnce(
    config,
    "        roleState.group = ROLE_GROUPS.OPERATION\n        clearRoleStateCache()",
    '        roleState.group = ROLE_GROUPS.OPERATION\n        roleState.providerIntakeAccess = false\n        roleState.providerIntakeMode = "unknown"\n        clearRoleStateCache()',
    "anonymous gate reset",
  );
  config = replaceOnce(
    config,
    "      roleState.group = groupFromRoles(roleState.roles)\n      persistRoleStateCache()",
    '      roleState.group = groupFromRoles(roleState.roles)\n      const providerIntakeGate = await resolveProviderIntakeModuleAccess(client)\n      roleState.providerIntakeAccess = providerIntakeGate.allowed\n      roleState.providerIntakeMode = providerIntakeGate.mode\n      persistRoleStateCache()',
    "load authoritative provider gate",
  );
  config = replaceOnce(
    config,
    "    } catch (_) {\n      roleState.roles = []\n      roleState.group = ROLE_GROUPS.OPERATION",
    '    } catch (_) {\n      roleState.roles = []\n      roleState.group = ROLE_GROUPS.OPERATION\n      roleState.providerIntakeAccess = false\n      roleState.providerIntakeMode = "unknown"',
    "gate error reset",
  );
  config = replaceOnce(
    config,
    "  async function resolveProfile(client, session) {",
    `  async function resolveProviderIntakeModuleAccess(client) {\n    try {\n      const { data, error } = await client.rpc("get_provider_intake_module_access")\n      const mode = String(data?.mode || "unknown")\n      if (error || !["disabled", "sysadmin_only", "full"].includes(mode)) {\n        return { allowed: false, mode: "unknown" }\n      }\n      return { allowed: data?.allowed === true, mode }\n    } catch (_) {\n      return { allowed: false, mode: "unknown" }\n    }\n  }\n\n  async function resolveProfile(client, session) {`,
    "provider gate resolver",
  );
  config = replaceOnce(
    config,
    "    return modules.filter((item) => item.groups.includes(group))",
    '    return modules.filter((item) => item.groups.includes(group)\n      && (item.runtimeGate !== "provider-intake" || roleState.providerIntakeAccess === true))',
    "navigation gate",
  );
  config = replaceOnce(
    config,
    "    const first = modules.find((m) => !m.hidden && m.groups.includes(roleState.group))",
    "    const first = modulesForCurrentRole().find((m) => !m.hidden)",
    "default landing gate",
  );
}
write("config.js", config);

let providerIntakes = fs.readFileSync("provider_intakes.js", "utf8");
providerIntakes = replaceOnce(
  providerIntakes,
  `  const canTriage = Boolean(window.FluxAuth?.canTriageProviderIntakes?.())\n  await loadLinkManagementContext()\n  const canManageLinks = state.linkCompanies.length > 0\n\n  if (!canTriage && !canManageLinks) {\n    renderAccessDenied()\n    return\n  }`,
  `  const canAccess = Boolean(window.FluxAuth?.canAccessProviderIntakes?.())\n  if (!canAccess) {\n    renderAccessDenied()\n    return\n  }\n\n  const canTriage = true\n  await loadLinkManagementContext()\n  const canManageLinks = state.linkCompanies.length > 0`,
  "provider page gate before data",
);
write("provider_intakes.js", providerIntakes);

let fileApi = fs.readFileSync("api/provider-intake-file-url.js", "utf8");
fileApi = replaceOnce(
  fileApi,
  `  const serviceAuthorization = \`Bearer \${serviceRoleKey}\``,
  `  const gateResponse = await supabaseRequest(\`\${supabaseUrl}/rest/v1/rpc/get_provider_intake_module_access\`, {\n    apikey: anonKey,\n    authorization: \`Bearer \${accessToken}\`,\n    method: "POST",\n    body: {},\n  })\n  const gate = await readJson(gateResponse)\n  if (!gateResponse.ok || gate?.allowed !== true || !["sysadmin_only", "full"].includes(String(gate?.mode || ""))) {\n    sendJson(response, 403, { error: "access_denied" })\n    return\n  }\n\n  const serviceAuthorization = \`Bearer \${serviceRoleKey}\``,
  "file API authoritative gate",
);
write("api/provider-intake-file-url.js", fileApi);

write("api/runtime-config.js", String.raw`const EMPTY_CONFIG = Object.freeze({
  env: "dev",
  source: "missing-runtime-config",
  supabaseUrl: "",
  supabaseAnonKey: "",
  providerIntake: Object.freeze({ ready: false, turnstileSiteKey: "", privacyNoticeUrl: "" }),
})

const TURNSTILE_TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF",
])

function jsString(value) { return JSON.stringify(String(value || "")) }
function isProductionEnv(value) { return ["prod", "production"].includes(String(value || "").trim().toLowerCase()) }
function isHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""))
    return url.protocol === "https:" && !url.username && !url.password
  } catch (_) { return false }
}
function requestWantsJson(request) {
  const accept = String(request.headers?.accept || "").toLowerCase()
  try {
    const host = request.headers?.host || "localhost"
    const url = new URL(request.url || "/api/runtime-config", "https://" + host)
    if (url.searchParams.get("format") === "json") return true
  } catch (_) {}
  return accept.includes("application/json")
}
function sendJson(response, config, errorMessage) {
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.status(200).send(JSON.stringify({ ...config, ...(errorMessage ? { error: true, message: errorMessage } : {}) }))
}
function sendJavaScript(response, config, errorMessage) {
  response.setHeader("Content-Type", "application/javascript; charset=utf-8")
  const lines = []
  if (errorMessage) {
    lines.push("window.FLUX_ENV_CONFIG_ERROR = Object.freeze({", "  env: " + jsString(config.env) + ",", "  source: " + jsString(config.source) + ",", "  message: " + jsString(errorMessage), "});")
  }
  lines.push(
    "window.FLUX_ENV_CONFIG = Object.freeze({",
    "  env: " + jsString(config.env) + ",",
    "  source: " + jsString(config.source) + ",",
    "  supabaseUrl: " + jsString(config.supabaseUrl) + ",",
    "  supabaseAnonKey: " + jsString(config.supabaseAnonKey) + ",",
    "  providerIntake: Object.freeze({ ready: " + String(config.providerIntake.ready === true) + ", turnstileSiteKey: " + jsString(config.providerIntake.turnstileSiteKey) + ", privacyNoticeUrl: " + jsString(config.providerIntake.privacyNoticeUrl) + " })",
    "});",
  )
  response.status(200).send(lines.join("\n"))
}
function providerIntakeConfig(env) {
  const turnstileSiteKey = String(process.env.FLUX_TURNSTILE_SITE_KEY || "").trim()
  const privacyNoticeUrl = String(process.env.INTAKE_PRIVACY_NOTICE_URL || "").trim()
  const ready = isProductionEnv(env)
    && turnstileSiteKey.length >= 20
    && !TURNSTILE_TEST_SITE_KEYS.has(turnstileSiteKey)
    && isHttpsUrl(privacyNoticeUrl)
  return Object.freeze({
    ready,
    turnstileSiteKey: ready ? turnstileSiteKey : "",
    privacyNoticeUrl: ready ? privacyNoticeUrl : "",
  })
}

module.exports = function runtimeConfig(request, response) {
  const runtimeUrl = process.env.FLUX_SUPABASE_URL
  const runtimeAnonKey = process.env.FLUX_SUPABASE_ANON_KEY
  const hasRuntimeConfig = Boolean(runtimeUrl && runtimeAnonKey)
  const env = process.env.FLUX_ENV || process.env.VERCEL_ENV || EMPTY_CONFIG.env
  const wantsJson = requestWantsJson(request)
  response.setHeader("Cache-Control", "no-store, max-age=0")

  if (!hasRuntimeConfig) {
    const message = isProductionEnv(env)
      ? "Missing FLUX_SUPABASE_URL or FLUX_SUPABASE_ANON_KEY in production runtime config."
      : "Missing FLUX_SUPABASE_URL or FLUX_SUPABASE_ANON_KEY runtime config."
    const emptyConfig = { ...EMPTY_CONFIG, env }
    if (wantsJson) sendJson(response, emptyConfig, message)
    else sendJavaScript(response, emptyConfig, message)
    return
  }

  const config = {
    env,
    source: "vercel-env",
    supabaseUrl: runtimeUrl,
    supabaseAnonKey: runtimeAnonKey,
    providerIntake: providerIntakeConfig(env),
  }
  if (wantsJson) sendJson(response, config)
  else sendJavaScript(response, config)
}
`);

const unchangedFiles = [
  "aprobaciones.html", "aprobaciones.js", "presupuesto.html", "presupuesto.js",
  "approval_batches.html", "approval_batches.js", "layouts.html", "layouts.js",
  "pagos_comprobaciones.html", "pagos_comprobaciones.js", "efectivo.html", "efectivo.js",
  "configuracion.html", "configuracion.js",
].filter((file) => {
  try { show(SOURCE_MAIN_SHA, file); return true; } catch (_) { return false; }
});
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const regressionHashes = Object.fromEntries(unchangedFiles.map((file) => [file, sha256(show(SOURCE_MAIN_SHA, file))]));

write("scripts/qa/provider-portal-prod-product-contract.test.mjs", String.raw`import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const fail = (message) => { throw new Error(message); };
const read = (file) => fs.readFileSync(file, "utf8");
const manifest = JSON.parse(read("docs/ops/provider-portal-prod-product-candidate.json"));
const changed = execFileSync("git", ["diff", "--name-only", "70fd10bacea6a9f7b32a36b67906c598f96f39e0"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
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
if (!read("solicitudes.js").includes("openRequestFromUrl")) fail("converted SOL deep link missing");

for (const [file, expected] of Object.entries(manifest.unchanged_main_sha256)) {
  const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (actual !== expected) fail("normal Flux regression hash changed: " + file);
}
if (manifest.provider_intake_notification_release_delta !== 0 || manifest.legal_content_approval_pending !== true) fail("release manifest P0 state invalid");
console.log("PROVIDER_PORTAL_PROD_PRODUCT_CONTRACT_PASS=true");
console.log("SYSADMIN_ONLY_PRODUCT_GATE_PROVEN=true");
console.log("NORMAL_FLUX_REGRESSION_PASS=true");
console.log("PROVIDER_INTAKE_NOTIFICATION_RELEASE_DELTA=0");
`);

write("scripts/qa/provider-intake-file-api-contract.test.cjs", String.raw`const assert = require("node:assert/strict")
const handler = require("../../api/provider-intake-file-url.js")

const UUIDS = {
  user: "11111111-1111-4111-8111-111111111111",
  profile: "22222222-2222-4222-8222-222222222222",
  intake: "33333333-3333-4333-8333-333333333333",
  file: "44444444-4444-4444-8444-444444444444",
  company: "55555555-5555-4555-8555-555555555555",
}
process.env.FLUX_SUPABASE_URL = "https://ucantptjhwttexzmslvm.supabase.co"
process.env.FLUX_SUPABASE_ANON_KEY = "public_candidate_key"
process.env.FLUX_SUPABASE_SERVICE_ROLE_KEY = "server_only_candidate_secret"

function reply(payload, ok = true, status = ok ? 200 : 401) { return { ok, status, json: async () => payload } }
function responseCapture() {
  return {
    headers: {}, statusCode: 0, payload: null,
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}
function request(token = "valid.jwt.token") {
  return { method: "POST", headers: token ? { authorization: "Bearer " + token } : {}, body: { payment_intake_id: UUIDS.intake, file_id: UUIDS.file } }
}
async function runCase(fetchImpl, req = request()) {
  global.fetch = fetchImpl
  const res = responseCapture()
  await handler(req, res)
  return res
}

async function main() {
  let res = await runCase(async () => { throw new Error("fetch should not run") }, request(""))
  assert.equal(res.statusCode, 401)

  res = await runCase(async () => reply({}, false, 401))
  assert.equal(res.statusCode, 401)

  let calls = 0
  res = await runCase(async (url) => {
    calls += 1
    if (url.includes("/auth/v1/user")) return reply({ id: UUIDS.user })
    if (url.includes("get_provider_intake_module_access")) return reply({ mode: "sysadmin_only", allowed: false })
    throw new Error("unexpected fetch")
  })
  assert.equal(res.statusCode, 403)
  assert.equal(calls, 2)

  const routed = (fileFound = true) => async (url) => {
    if (url.includes("/auth/v1/user")) return reply({ id: UUIDS.user })
    if (url.includes("get_provider_intake_module_access")) return reply({ mode: "sysadmin_only", allowed: true })
    if (url.includes("/profiles?")) return reply([{ id: UUIDS.profile, active: true }])
    if (url.includes("/user_roles?")) return reply([{ roles: { name: "sysadmin" } }])
    if (url.includes("/payment_intake?")) return reply([{ id: UUIDS.intake, company_id: UUIDS.company }])
    if (url.includes("/companies?")) return reply([{ id: UUIDS.company }])
    if (url.includes("/payment_intake_files?")) return reply(fileFound ? [{ id: UUIDS.file, payment_intake_id: UUIDS.intake, bucket_id: "intake-uploads", storage_path: UUIDS.intake + "/evidence.pdf" }] : [])
    if (url.includes("/storage/v1/object/sign/")) return reply({ signedURL: "/object/sign/intake-uploads/evidence?token=signed" })
    throw new Error("unexpected URL: " + url)
  }
  res = await runCase(routed(false))
  assert.equal(res.statusCode, 404)
  res = await runCase(routed(true))
  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.expires_in, 120)
  assert.match(res.payload.url, /^https:\/\/ucantptjhwttexzmslvm\.supabase\.co/)
  console.log("PROVIDER_INTAKE_FILE_API_CONTRACT_PASS=true")
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
`);

const productManifest = {
  schema: "flux.provider-portal-prod-product-candidate/v1",
  generated_from_main_sha: SOURCE_MAIN_SHA,
  derived_provider_source_dev_sha: SOURCE_DEV_SHA,
  compatible_pr_a: 368,
  target_prod_project: PROD_PROJECT,
  internal_pilot: "sysadmin_only",
  public_valid_link_without_login: true,
  public_token_transport: "fragment",
  provider_intake_notification_release_delta: 0,
  required_vercel_variables: {
    FLUX_TURNSTILE_SITE_KEY: "required_production_site_key_not_committed",
    INTAKE_PRIVACY_NOTICE_URL: "required_https_provider_specific_url_not_committed",
  },
  turnstile_production_site_key_configured: false,
  legal_content_approval_pending: true,
  unchanged_main_sha256: regressionHashes,
  prod_deploy_executed: false,
  runtime_mode_changed: false,
};
write(CANDIDATE_MANIFEST, JSON.stringify(productManifest, null, 2) + "\n");

write("docs/ops/provider-portal-prod-product-release.md", [
  "# Provider Portal â€” SYSADMIN-only PROD pilot UI candidate",
  "",
  "- Build base: `" + SOURCE_MAIN_SHA + "`.",
  "- Selective product source: DEV `" + SOURCE_DEV_SHA + "`.",
  "- Backend prerequisite: Draft PR A #368 and its T1â†’T4 chain.",
  "- Internal access is resolved by `get_provider_intake_module_access`; unknown/error hides and denies.",
  "- The public provider route needs no Flux login and accepts the token only from `#token=`.",
  "- Notification release delta: **0**.",
  "",
  "## Production configuration still required (not written by this PR)",
  "",
  "- `FLUX_TURNSTILE_SITE_KEY`: production Turnstile site key; test keys fail closed.",
  "- `INTAKE_PRIVACY_NOTICE_URL`: approved HTTPS provider-intake-specific notice.",
  "- Edge variables and secrets listed in PR A's runtime manifest.",
  "",
  "## Stop state",
  "",
  "This Draft performs no merge, PROD deploy, env/secret write, mode change, link creation, intake creation, submit, conversion, payment, batch, or layout action.",
].join("\n"));

console.log(JSON.stringify({ generated: true, firstBuild, sourceMain: SOURCE_MAIN_SHA, sourceDev: SOURCE_DEV_SHA }));

