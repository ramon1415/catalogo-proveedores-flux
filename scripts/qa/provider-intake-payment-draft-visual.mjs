import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import {
  auditAccessibilityPage,
  loadLocalAxeSource,
} from "./provider-intake-matching-accessibility.mjs"

const require = createRequire(import.meta.url)
const { chromium } = require("playwright")
const localAxe = loadLocalAxeSource()
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const outputDir = process.env.PAYMENT_DRAFT_QA_OUTPUT_DIR
  ? path.resolve(process.env.PAYMENT_DRAFT_QA_OUTPUT_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), "flux-payment-draft-visual-"))
fs.mkdirSync(outputDir, { recursive: true })

const ids = Object.freeze({
  intake: "11111111-1111-4111-8111-111111111111",
  company: "22222222-2222-4222-8222-222222222222",
  center: "33333333-3333-4333-8333-333333333333",
  category: "44444444-4444-4444-8444-444444444444",
  account: "55555555-5555-4555-8555-555555555555",
  requester: "66666666-6666-4666-8666-666666666666",
  approver: "77777777-7777-4777-8777-777777777777",
  assignment: "88888888-8888-4888-8888-888888888888",
  provider: "99999999-9999-4999-8999-999999999999",
})

const listFixture = {
  summary: { total: 1, received: 0, in_review: 1, needs_correction: 0, rejected: 0, converted: 0, cancelled: 0 },
  total: 1,
  page: 1,
  page_size: 25,
  companies: [{ id: ids.company, name: "Empresa sintética" }],
  items: [{
    id: ids.intake,
    public_folio: "INT-2026-900001",
    company_id: ids.company,
    company_name: "Empresa sintética",
    status: "in_review",
    provider_name: "Proveedor declarado sintético",
    concept: "Servicio sintético",
    amount_requested: 1250,
    currency: "MXN",
    created_at: "2026-07-20T12:00:00.000Z",
    updated_at: "2026-07-20T12:00:00.000Z",
    file_count: 1,
  }],
}

const detailFixture = {
  intake: {
    ...listFixture.items[0],
    provider_rfc: "SYNTHETIC",
    provider_email: "provider@example.invalid",
    provider_phone: "••••0000",
    description: "Descripción de prueba sin datos reales.",
    requested_payment_date: "2026-08-15",
    invoice_folio: "SYNTH-001",
    invoice_uuid: "SYNTHETIC-INVOICE",
    invoice_date: "2026-07-19",
    bank_name: "Banco sintético",
    beneficiary_name: "Beneficiario sintético",
    bank_account_masked: "••••2468",
    bank_clabe_masked: "••••••••••••••9012",
  },
  files: [{
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    payment_intake_id: ids.intake,
    original_filename: "factura-sintetica.pdf",
    mime_type: "application/pdf",
    size_bytes: 2048,
    file_kind: "invoice_pdf",
    quarantine_status: "accepted",
    created_at: "2026-07-20T12:00:00.000Z",
  }],
  events: [],
}

const baseContext = {
  intake: {
    id: ids.intake,
    public_folio: "INT-2026-900001",
    company_id: ids.company,
    company_name: "Empresa sintética",
    status: "in_review",
    updated_at: "2026-07-20T12:00:00.000Z",
    provider_name: "Proveedor declarado sintético",
    concept: "Servicio sintético",
    description: "Descripción de prueba sin datos reales.",
    amount_requested: 1250,
    currency: "MXN",
    requested_payment_date: "2026-08-15",
    invoice: { folio: "SYNTH-001", uuid: "SYNTHETIC-INVOICE", date: "2026-07-19" },
    bank: { name: "Banco sintético", beneficiary: "Beneficiario sintético", account_masked: "••••2468", clabe_masked: "••••••••••••••9012" },
    created_payment_request_id: null,
  },
  provider: null,
  documents: [{
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "factura-sintetica.pdf",
    mime_type: "application/pdf",
    size_bytes: 2048,
    file_kind: "invoice_pdf",
    quarantine_status: "accepted",
  }],
  draft: null,
  defaults: {
    final_amount: 1250,
    currency: "MXN",
    scheduled_payment_date: "2026-08-15",
    internal_concept: "Servicio sintético",
    requested_by_profile_id: ids.requester,
  },
  state: {
    derived_state: "NOT_STARTED",
    missing_fields: [],
    blockers: [],
    missing_count: 0,
    blockers_count: 0,
    has_draft: false,
    draft_version: null,
    provider_present: false,
    provider_active: false,
    ready_for_conversion: false,
  },
  requester_options: [{
    profile_id: ids.requester,
    display_name: "Finanzas sintético",
    email: "finance@example.invalid",
    company_id: ids.company,
    functional_roles: ["finance"],
  }],
  approver_options: [],
  catalogs: {
    cost_centers: [{ id: ids.center, name: "Centro sintético", code: "SYN" }],
    budget_categories: [{ id: ids.category, cost_center_id: ids.center, name: "Partida sintética", code: "CAT" }],
    origin_accounts: [{ id: ids.account, name: "Cuenta operativa sintética", bank_name: "Banco sintético", currency: "MXN", last4: "1234" }],
    payment_methods: ["transfer", "cash", "check", "other"],
    currencies: ["MXN", "USD"],
  },
  can_view: true,
  can_prepare: true,
  can_save: true,
  ready_for_conversion: false,
}

const mockScript = `
  (() => {
    const params = new URLSearchParams(location.search);
    const initialStatus = params.get("status") || "in_review";
    const initialReady = params.get("draft") === "ready";
    const linked = params.get("provider") === "linked";
    const session = { access_token: "synthetic-token", user: { id: "${ids.requester}", email: "finance@example.invalid" } };
    const profile = { id: "${ids.requester}", email: "finance@example.invalid", full_name: "Finanzas sintético", auth_user_id: session.user.id, active: true };
    const list = ${JSON.stringify(listFixture)};
    const detail = ${JSON.stringify(detailFixture)};
    const baseContext = ${JSON.stringify(baseContext)};
    list.items[0].status = initialStatus;
    detail.intake.status = initialStatus;
    baseContext.intake.status = initialStatus;
    if (initialStatus !== "in_review") {
      baseContext.state.derived_state = "BLOCKED_INTAKE_STATUS";
      baseContext.state.blockers = ["INTAKE_STATUS_NOT_IN_REVIEW"];
      baseContext.can_prepare = false;
      baseContext.can_save = false;
    }
    if (linked) {
      baseContext.provider = {
        proveedor_id: "${ids.provider}",
        display_name: "Proveedor maestro sintético",
        active: true,
        bank: "Banco sintético",
        account_masked: "••••2468",
        clabe_masked: "••••••••••••••9012",
      };
    }
    if (initialReady) {
      baseContext.draft = {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        payment_intake_id: "${ids.intake}",
        company_id: "${ids.company}",
        cost_center_id: "${ids.center}",
        budget_category_id: "${ids.category}",
        budget_month: "2026-08-01",
        company_bank_account_id: "${ids.account}",
        payment_method: "transfer",
        requested_by_profile_id: "${ids.requester}",
        approver_profile_id: "${ids.approver}",
        approver_assignment_id: "${ids.assignment}",
        final_amount: 1250,
        currency: "MXN",
        scheduled_payment_date: "2026-08-15",
        internal_concept: "Servicio sintético",
        internal_notes: "Nota interna sintética",
        amount_change_reason: null,
        version: 2,
        created_at: "2026-07-20T12:00:00.000Z",
        updated_at: "2026-07-20T12:05:00.000Z",
      };
      baseContext.approver_options = [{
        profile_id: "${ids.approver}",
        display_name: "Aprobador sintético",
        email: "approver@example.invalid",
        eligible_roles: ["finance"],
        source: "assigned",
        assignment_id: "${ids.assignment}",
        option_label: "Aprobador sintético · finance",
      }];
      baseContext.state = {
        derived_state: linked ? "READY_FOR_CONVERSION" : "READY_PENDING_PROVIDER",
        missing_fields: [],
        blockers: linked ? [] : ["PROVIDER_REQUIRED_FOR_CONVERSION"],
        missing_count: 0,
        blockers_count: linked ? 0 : 1,
        has_draft: true,
        draft_version: 2,
        provider_present: linked,
        provider_active: linked,
        ready_for_conversion: linked,
      };
      baseContext.ready_for_conversion = linked;
    }
    window.__qaContext = baseContext;
    window.__qaConflict = false;
    window.__qaMockSaveCalls = 0;
    window.__qaRpcCalls = [];
    function builder(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        single() { return Promise.resolve({ data: profile, error: null }); },
        maybeSingle() { return Promise.resolve({ data: table === "profiles" ? profile : null, error: null }); },
        then(resolve) {
          const data = table === "user_roles"
            ? [{ role_id: "role", roles: { id: "role", name: "finance", description: "" } }]
            : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return api;
    }
    const client = {
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        signOut: async () => ({ error: null }),
      },
      from: builder,
      rpc: async (name, args = {}) => {
        window.__qaRpcCalls.push(name);
        if (name === "list_provider_intakes") return { data: list, error: null };
        if (name === "get_provider_intake_detail") return { data: detail, error: null };
        if (name === "find_provider_intake_candidates") {
          return { data: { payment_intake_id: "${ids.intake}", status: initialStatus, updated_at: detail.intake.updated_at, eligible: initialStatus === "in_review", current_match: null, duplicate_rfc_count: 0, candidates: [], history: [] }, error: null };
        }
        if (name === "get_provider_intake_payment_draft_context") {
          return { data: structuredClone(window.__qaContext), error: null };
        }
        if (name === "save_provider_intake_payment_draft") {
          if (window.__qaConflict) return { data: null, error: { message: "provider_intake_conversion_draft_conflict" } };
          window.__qaMockSaveCalls += 1;
          const existing = window.__qaContext.draft;
          const version = existing ? existing.version + 1 : 1;
          window.__qaContext.draft = {
            id: existing?.id || "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            payment_intake_id: "${ids.intake}",
            company_id: "${ids.company}",
            cost_center_id: args.p_cost_center_id,
            budget_category_id: args.p_budget_category_id,
            budget_month: args.p_budget_month,
            company_bank_account_id: args.p_company_bank_account_id,
            payment_method: args.p_payment_method,
            requested_by_profile_id: args.p_requested_by_profile_id,
            approver_profile_id: args.p_approver_profile_id,
            approver_assignment_id: args.p_approver_assignment_id,
            final_amount: args.p_final_amount,
            currency: args.p_currency,
            scheduled_payment_date: args.p_scheduled_payment_date,
            internal_concept: args.p_internal_concept,
            internal_notes: args.p_internal_notes,
            amount_change_reason: args.p_amount_change_reason,
            version,
            created_at: existing?.created_at || "2026-07-20T12:00:00.000Z",
            updated_at: "2026-07-20T12:05:00.000Z",
          };
          window.__qaContext.approver_options = [{
            profile_id: "${ids.approver}",
            display_name: "Aprobador sintético",
            email: "approver@example.invalid",
            eligible_roles: ["finance"],
            source: "assigned",
            assignment_id: "${ids.assignment}",
            option_label: "Aprobador sintético · finance",
          }];
          const missing = [
            ["cost_center_id", args.p_cost_center_id],
            ["budget_category_id", args.p_budget_category_id],
            ["budget_month", args.p_budget_month],
            ["payment_method", args.p_payment_method],
            ["requested_by_profile_id", args.p_requested_by_profile_id],
            ["approver_profile_id", args.p_approver_profile_id],
            ["final_amount", args.p_final_amount],
            ["currency", args.p_currency],
            ["scheduled_payment_date", args.p_scheduled_payment_date],
            ["internal_concept", args.p_internal_concept],
          ].filter(([, value]) => !value).map(([field]) => field);
          if (args.p_payment_method === "transfer" && !args.p_company_bank_account_id) missing.push("company_bank_account_id");
          const derived = missing.length ? "DRAFT_INCOMPLETE" : (window.__qaContext.provider ? "READY_FOR_CONVERSION" : "READY_PENDING_PROVIDER");
          const blockers = derived === "READY_PENDING_PROVIDER" ? ["PROVIDER_REQUIRED_FOR_CONVERSION"] : [];
          window.__qaContext.state = {
            derived_state: derived,
            missing_fields: missing,
            blockers,
            missing_count: missing.length,
            blockers_count: blockers.length,
            has_draft: true,
            draft_version: version,
            provider_present: Boolean(window.__qaContext.provider),
            provider_active: Boolean(window.__qaContext.provider?.active),
            ready_for_conversion: derived === "READY_FOR_CONVERSION",
          };
          return { data: { draft_version: version, state: window.__qaContext.state, idempotent: false }, error: null };
        }
        return { data: {}, error: null };
      },
    };
    window.supabase = { createClient: () => client };
  })();
`

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1")
  if (url.pathname === "/api/runtime-config") {
    response.setHeader("Content-Type", "application/javascript; charset=utf-8")
    response.end('window.FLUX_ENV_CONFIG=Object.freeze({env:"qa",source:"qa-harness",supabaseUrl:"https://qa.invalid",supabaseAnonKey:"synthetic-anon"});')
    return
  }
  const requested = url.pathname === "/" ? "provider_intakes.html" : url.pathname.replace(/^\/+/, "")
  const filePath = path.resolve(root, requested)
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.statusCode = 404
    response.end("Not found")
    return
  }
  let body = fs.readFileSync(filePath)
  if (requested === "provider_intakes.html") {
    body = Buffer.from(body.toString("utf8").replace(
      '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
      `<script>${mockScript}</script>`,
    ))
  }
  response.setHeader("Content-Type", mimeType(filePath))
  response.end(body)
})

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const { port } = server.address()
const baseUrl = `http://127.0.0.1:${port}/provider_intakes.html`
const browser = await chromium.launch({ headless: true })
const evidence = {
  status: "PASS",
  environment: "LOCAL_MOCK_NO_WRITE",
  screenshots: [],
  axe_states: [],
  viewports: [],
  real_mutable_requests: 0,
  mocked_save_calls: 0,
  console_errors: [],
}

try {
  const desktop = await instrumentedPage({ width: 1366, height: 900 })
  await openDraft(desktop, baseUrl)
  await runAxe(desktop, "empty")
  await capture(desktop, "01-empty-draft.png")

  await desktop.locator("#paymentDraftCostCenter").selectOption(ids.center)
  await desktop.locator("#paymentDraftBudgetCategory").selectOption(ids.category)
  await desktop.locator("#paymentDraftBudgetMonth").fill("2026-08")
  await desktop.locator("#paymentDraftPaymentMethod").selectOption("transfer")
  await desktop.locator("#paymentDraftOriginAccount").selectOption(ids.account)
  await desktop.getByRole("button", { name: "Guardar borrador" }).click()
  await desktop.getByText("Borrador guardado. No se creó una solicitud de pago.").waitFor()
  await desktop.locator("#paymentDraftStateLabel").getByText("Borrador incompleto", { exact: true }).waitFor()
  await runAxe(desktop, "incomplete")
  await capture(desktop, "02-incomplete.png")

  await desktop.locator("#paymentDraftApprover").selectOption(ids.approver)
  await desktop.getByRole("button", { name: "Guardar borrador" }).click()
  await desktop.locator("#paymentDraftStateLabel").getByText("Preparada · pendiente de proveedor", { exact: true }).waitFor()
  await runAxe(desktop, "pending provider")
  await capture(desktop, "03-pending-provider.png")

  await desktop.locator("#paymentDraftFinalAmount").fill("1250.123")
  await desktop.getByRole("button", { name: "Guardar borrador" }).click()
  await desktop.getByText("Captura un monto positivo con máximo dos decimales.").waitFor()
  await runAxe(desktop, "validation error")

  await desktop.locator("#paymentDraftFinalAmount").fill("1350")
  await desktop.locator("#paymentDraftAmountReason").fill("Cambio sintético autorizado")
  await desktop.evaluate(() => { window.__qaConflict = true })
  await desktop.getByRole("button", { name: "Guardar borrador" }).click()
  await desktop.getByText("Otra persona actualizó el borrador. Recarga para revisar la versión vigente.").waitFor()
  await runAxe(desktop, "conflict")
  await capture(desktop, "04-conflict.png")

  await desktop.keyboard.press("Escape")
  await desktop.getByText("Hay cambios sin guardar").waitFor()
  await runAxe(desktop, "dirty close")
  await desktop.getByRole("button", { name: "Seguir editando" }).click()
  assert.equal(await desktop.locator("#paymentDraftDialog").evaluate((dialog) => dialog.open), true)

  const linked = await instrumentedPage({ width: 1280, height: 900 })
  await openDraft(linked, `${baseUrl}?draft=ready&provider=linked`)
  await linked.locator("#paymentDraftStateLabel").getByText("Lista para conversión", { exact: true }).waitFor()
  assert.equal(await linked.getByRole("button", { name: /Convertir|Crear payment_request|Aprobar|Enviar a batch/i }).count(), 0)
  await runAxe(linked, "ready")
  await capture(linked, "05-ready-for-conversion.png")

  const blocked = await instrumentedPage({ width: 1280, height: 800 })
  await openDetail(blocked, `${baseUrl}?status=received`)
  await blocked.getByText("Preparación no disponible", { exact: true }).waitFor()
  assert.equal(await blocked.getByRole("button", { name: "Preparar solicitud de pago" }).count(), 0)
  await runAxe(blocked, "blocked")

  for (const viewport of [
    { width: 320, height: 640, name: "320" },
    { width: 390, height: 844, name: "390x844" },
    { width: 768, height: 1024, name: "768x1024" },
    { width: 683, height: 768, name: "zoom-200-equivalent" },
  ]) {
    const page = await instrumentedPage(viewport)
    await openDraft(page, `${baseUrl}?draft=ready`)
    const geometry = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      dialog: document.querySelector("#paymentDraftDialog")?.getBoundingClientRect().width,
    }))
    assert.ok(geometry.document <= geometry.viewport + 2, JSON.stringify({ viewport, geometry }))
    assert.ok(geometry.dialog <= geometry.viewport + 2, JSON.stringify({ viewport, geometry }))
    await runAxe(page, `responsive ${viewport.name}`)
    evidence.viewports.push(viewport.name)
    if (viewport.width === 390) await capture(page, "06-mobile-390.png")
    await page.close()
  }

  evidence.mocked_save_calls = await desktop.evaluate(() => window.__qaMockSaveCalls)
  assert.equal(evidence.real_mutable_requests, 0)
  assert.equal(evidence.console_errors.length, 0)
  assert.ok(evidence.mocked_save_calls >= 2)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}

async function instrumentedPage(viewport) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
  page.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) evidence.real_mutable_requests += 1
  })
  page.on("console", (message) => {
    if (message.type() === "error") evidence.console_errors.push(message.text().replace(/[0-9a-f-]{36}/gi, "[id]"))
  })
  page.on("pageerror", (error) => evidence.console_errors.push(String(error.message || error)))
  return page
}

async function openDetail(page, url) {
  await page.goto(url, { waitUntil: "networkidle" })
  await page.locator("#triageWorkspace").waitFor({ state: "visible" })
  await page.getByRole("button", { name: /Ver detalle de INT-2026-900001/ }).click()
  await page.getByRole("dialog", { name: "INT-2026-900001" }).waitFor()
}

async function openDraft(page, url) {
  await openDetail(page, url)
  const button = page.getByRole("button", { name: /Preparar solicitud de pago|Continuar preparación|Revisar solicitud preparada/ })
  await button.click()
  await page.getByRole("dialog", { name: /Preparar solicitud de pago|Editar solicitud preparada/ }).waitFor()
  await page.locator("#paymentDraftWorkspace").waitFor({ state: "visible" })
}

async function capture(page, name) {
  const destination = path.join(outputDir, name)
  await page.screenshot({ path: destination, fullPage: true })
  evidence.screenshots.push(name)
}

async function runAxe(page, label) {
  const stateAlias = `payment_draft_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
  const result = await auditAccessibilityPage(page, {
    stateAlias,
    environment: "VISUAL_LOCAL",
    evidenceMode: "SANITIZED",
    authorizedOrigin: page.url(),
    localAxe,
  })
  assert.equal(result.critical, 0, label)
  assert.equal(result.serious, 0, label)
  evidence.axe_states.push({ state: label, critical: 0, serious: 0 })
}

function mimeType(filePath) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".webp": "image/webp",
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream"
}
