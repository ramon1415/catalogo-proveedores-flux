import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { chromium } = require("playwright")
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "flux-matching-visual-"))

const ids = Object.freeze({
  intake: "33333333-3333-4333-8333-333333333333",
  company: "11111111-1111-4111-8111-111111111111",
  providerA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  providerB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  inactive: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
})

const listFixture = {
  summary: { total: 1, received: 0, in_review: 1, needs_correction: 0, rejected: 0, converted: 0, cancelled: 0 },
  total: 1,
  page: 1,
  page_size: 25,
  companies: [{ id: ids.company, name: "COMPANY_A" }],
  items: [{
    id: ids.intake,
    public_folio: "QA_MATCH_RETRY_MAIN",
    company_id: ids.company,
    company_name: "COMPANY_A",
    status: "in_review",
    provider_name: "QA_DECLARED_PROVIDER",
    concept: "QA Gate 2 retry",
    amount_requested: 128450.5,
    currency: "MXN",
    created_at: "2026-07-17T15:30:00.000Z",
    updated_at: "2026-07-18T14:20:00.000Z",
    file_count: 0,
  }],
}

const detailFixture = {
  intake: {
    ...listFixture.items[0],
    provider_rfc: "QAA010101AA1",
    provider_email: "qa-intake@example.invalid",
    provider_phone: "+52 55 0000 0001",
    description: "Fixture sintético aislado.",
    requested_payment_date: "2026-07-24",
    invoice_folio: "F-1051",
    invoice_uuid: "5AD73A63-9290-4D7C-876A-3957C6E57B20",
    invoice_date: "2026-07-17",
    bank_name: "BANCO_QA",
    bank_account_masked: "••••••2468",
    bank_clabe_masked: "••••••••••••••9012",
    beneficiary_name: "QA_BENEFICIARY",
  },
  files: [],
  events: [{
    id: "77777777-7777-4777-8777-777777777777",
    event_type: "status_changed",
    actor_type: "finance",
    actor_name: "QA_TRIAGE_FINANCE_1",
    from_status: "received",
    to_status: "in_review",
    notes: "Revisión iniciada.",
    created_at: "2026-07-18T14:20:00.000Z",
  }],
}

const candidateFixture = {
  payment_intake_id: ids.intake,
  status: "in_review",
  updated_at: detailFixture.intake.updated_at,
  eligible: true,
  current_match: null,
  duplicate_rfc_count: 1,
  candidates: [
    {
      proveedor_id: ids.providerA,
      alias: "QA_MATCH_PROVIDER_A",
      legal_name: "QA_MATCH_PROVIDER_A",
      rfc: "QAA010101AA1",
      payment_method: "Transferencia bancaria",
      bank: "BANCO_QA",
      account_masked: "••••••2468",
      clabe_masked: "••••••••••••••9012",
      active: true,
      selectable: true,
      score: 100,
      confidence: "high",
      reasons: ["RFC exacto", "CLABE exacta", "Cuenta bancaria exacta"],
      differences: ["Razón social distinta"],
    },
    {
      proveedor_id: ids.providerB,
      alias: "QA_MATCH_PROVIDER_B",
      legal_name: "QA_MATCH_PROVIDER_B",
      rfc: "QAB010101AA2",
      payment_method: "Transferencia bancaria",
      bank: "BANCO_QA",
      account_masked: "••••••1357",
      clabe_masked: "••••••••••••••1357",
      active: true,
      selectable: true,
      score: 85,
      confidence: "high",
      reasons: ["Alias QA"],
      differences: ["RFC distinto"],
    },
    {
      proveedor_id: ids.inactive,
      alias: "QA_MATCH_PROVIDER_INACTIVE",
      legal_name: "QA_MATCH_PROVIDER_INACTIVE",
      rfc: "QAI010101AA3",
      payment_method: "Transferencia bancaria",
      bank: "BANCO_QA",
      account_masked: "••••••7777",
      clabe_masked: "••••••••••••••7777",
      active: false,
      selectable: false,
      score: 70,
      confidence: "high",
      reasons: ["Señal exacta sintética"],
      differences: ["Proveedor inactivo"],
    },
  ],
  history: [],
}

const comparisonFixture = {
  payment_intake_id: ids.intake,
  status: "in_review",
  updated_at: detailFixture.intake.updated_at,
  eligible: true,
  proveedor_id: ids.providerA,
  provider_alias: "QA_MATCH_PROVIDER_A",
  provider_active: true,
  rows: [
    { field: "Razón social", declared: "QA_DECLARED_PROVIDER", master: "QA_MATCH_PROVIDER_A", result: "different" },
    { field: "RFC", declared: "QAA010101AA1", master: "QAA010101AA1", result: "match" },
    { field: "Banco", declared: "BANCO_QA", master: "BANCO_QA", result: "match" },
    { field: "Cuenta", declared: "••••••2468", master: "••••••2468", result: "match" },
    { field: "CLABE", declared: "••••••••••••••9012", master: "••••••••••••••9012", result: "match" },
    { field: "Beneficiario", declared: "QA_BENEFICIARY", master: "QA_MATCH_PROVIDER_A", result: "different" },
    { field: "Correo", declared: "qa-intake@example.invalid", master: "qa-provider@example.invalid", result: "different" },
    { field: "Teléfono", declared: "+52 55 0000 0000", master: null, result: "not_reported" },
  ],
}

const mockScript = `
  (() => {
    const params = new URLSearchParams(location.search);
    const terminal = params.get("state") === "terminal";
    const requester = params.get("role") === "requester";
    const session = { access_token: "qa-token", user: { id: "99999999-9999-4999-8999-999999999999", email: "qa@flux.example" } };
    const profile = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "qa@flux.example", full_name: "QA Finanzas", auth_user_id: session.user.id, active: true };
    const list = ${JSON.stringify(listFixture)};
    const detail = ${JSON.stringify(detailFixture)};
    const baseMatch = ${JSON.stringify(candidateFixture)};
    const comparison = ${JSON.stringify(comparisonFixture)};
    if (terminal) {
      list.items[0].status = "rejected";
      list.summary = { total: 1, received: 0, in_review: 0, needs_correction: 0, rejected: 1, converted: 0, cancelled: 0 };
      detail.intake.status = "rejected";
      baseMatch.status = "rejected";
      baseMatch.eligible = false;
    }
    const providers = {
      "${ids.providerA}": {
        proveedor_id: "${ids.providerA}",
        alias: "QA_MATCH_PROVIDER_A",
        legal_name: "QA_MATCH_PROVIDER_A",
        rfc: "QAA010101AA1",
        payment_method: "Transferencia bancaria",
        bank: "BANCO_QA",
        account_masked: "••••••2468",
        clabe_masked: "••••••••••••••9012",
        active: true,
      },
      "${ids.providerB}": {
        proveedor_id: "${ids.providerB}",
        alias: "QA_MATCH_PROVIDER_B",
        legal_name: "QA_MATCH_PROVIDER_B",
        rfc: "QAB010101AA2",
        payment_method: "Transferencia bancaria",
        bank: "BANCO_QA",
        account_masked: "••••••1357",
        clabe_masked: "••••••••••••••1357",
        active: true,
      },
    };
    window.__qaConflict = false;
    window.__qaMutationCount = 0;
    window.__qaRpcCalls = [];
    window.__qaMatch = baseMatch;
    function builder(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        single() { return Promise.resolve({ data: profile, error: null }); },
        maybeSingle() { return Promise.resolve({ data: table === "profiles" ? profile : null, error: null }); },
        then(resolve) {
          const role = requester ? "solicitante" : "finance";
          const data = table === "user_roles" ? [{ role_id: "role", roles: { id: "role", name: role, description: "" } }] : [];
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
        if (name === "find_provider_intake_candidates") return { data: window.__qaMatch, error: null };
        if (name === "get_provider_intake_match_comparison") {
          const provider = providers[args.p_proveedor_id] || providers["${ids.providerA}"];
          return {
            data: {
              ...comparison,
              proveedor_id: provider.proveedor_id,
              provider_alias: provider.alias,
              rows: comparison.rows.map((row) => (
                row.field === "Razón social" ? { ...row, master: provider.alias } : row
              )),
            },
            error: null,
          };
        }
        if (name === "set_provider_intake_match") {
          if (window.__qaConflict) return { data: null, error: { message: "provider_intake_conflict" } };
          window.__qaMutationCount += 1;
          const previous = window.__qaMatch.current_match;
          const next = args.p_proveedor_id ? providers[args.p_proveedor_id] : null;
          detail.intake.updated_at = "2026-07-18T15:0" + window.__qaMutationCount + ":00.000Z";
          window.__qaMatch = {
            ...window.__qaMatch,
            updated_at: detail.intake.updated_at,
            current_match: next,
            history: [{
              event_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              action_kind: previous ? (next ? "match_replace" : "match_clear") : "match_set",
              previous_provider: previous?.alias || null,
              new_provider: next?.alias || null,
              match_confidence: "high",
              reason_code: args.p_reason_code,
              reason: args.p_reason,
              actor_type: "finance",
              created_at: detail.intake.updated_at,
            }],
          };
          return { data: { matched_proveedor_id: next?.proveedor_id || null, idempotent: false }, error: null };
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
    response.end('window.FLUX_ENV_CONFIG=Object.freeze({env:"qa",source:"qa-harness",supabaseUrl:"https://qa.supabase.co",supabaseAnonKey:"qa-anon"});')
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
let screens = 0

try {
  const desktop = await browser.newPage({ viewport: { width: 1366, height: 1000 } })
  await openFirstDetail(desktop, baseUrl)
  await expectMasked(desktop)
  await runAxe(desktop, "candidates")
  await capture(desktop, "01-candidates.png")

  await desktop.getByRole("button", { name: "Comparar" }).first().click()
  await desktop.getByRole("dialog", { name: "Comparar proveedor" }).waitFor()
  await runAxe(desktop, "comparison and confirmation")
  await capture(desktop, "02-comparison-confirmation.png")
  await desktop.getByRole("button", { name: "Confirmar vínculo" }).click()
  await desktop.getByText("Vinculado", { exact: true }).waitFor()
  await runAxe(desktop, "linked")
  await capture(desktop, "03-linked.png")

  const changeButton = desktop.getByRole("button", { name: "Cambiar vínculo" })
  await changeButton.click()
  const providerSearch = desktop.locator("#providerMatchSearch")
  assert.equal(await providerSearch.evaluate((node) => document.activeElement === node), true)
  await providerSearch.fill("QA_MATCH_PROVIDER_B")
  await providerSearch.press("Enter")
  await providerSearch.waitFor({ state: "visible" })
  const candidateCardB = desktop.locator(".candidate-card").filter({ hasText: "QA_MATCH_PROVIDER_B" })
  assert.equal(await candidateCardB.count(), 1)
  const selectProviderB = candidateCardB.getByRole("button", { name: "Seleccionar para cambio" })
  await selectProviderB.click()
  await waitForOpenDialog(desktop)
  await assertReplaceDialog(desktop)
  await runAxe(desktop, "replace dialog")
  await capture(desktop, "04-replace-dialog.png")

  await desktop.keyboard.press("Shift+Tab")
  assert.equal(await desktop.locator("#matchDialog").evaluate((dialog) => dialog.contains(document.activeElement)), true)
  await desktop.keyboard.press("Escape")
  await desktop.waitForFunction(() => !document.querySelector("#matchDialog")?.open)
  assert.equal(await selectProviderB.evaluate((node) => document.activeElement === node), true)

  await selectProviderB.click()
  await waitForOpenDialog(desktop)
  await desktop.locator("#matchReason").fill("QA Gate 2 Retry: reemplazo controlado del proveedor sintético.")
  assert.equal(await desktop.locator("#matchReasonCounter").textContent(), "62 / 500")
  assert.equal(await desktop.evaluate(() => window.__qaMutationCount), 1)
  await desktop.keyboard.press("Escape")
  await desktop.waitForFunction(() => !document.querySelector("#matchDialog")?.open)

  const conflict = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await openFirstDetail(conflict, baseUrl)
  await conflict.getByRole("button", { name: "Comparar" }).first().click()
  await conflict.evaluate(() => { window.__qaConflict = true })
  await conflict.getByRole("button", { name: "Confirmar vínculo" }).click()
  await conflict.getByText("Esta solicitud fue actualizada por otro usuario. Recarga el detalle.").waitFor()
  await runAxe(conflict, "conflict")
  await capture(conflict, "05-conflict.png")

  const terminal = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await openFirstDetail(terminal, `${baseUrl}?state=terminal`, "Revisión requerida")
  await terminal.getByText("Revisión requerida", { exact: true }).waitFor()
  assert.equal(await terminal.getByRole("button", { name: "Confirmar vínculo" }).count(), 0)
  await runAxe(terminal, "terminal readonly")
  await capture(terminal, "06-terminal-readonly.png")

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await openFirstDetail(mobile, baseUrl)
  await runAxe(mobile, "mobile candidates")
  await assertNoViewportOverflow(mobile)
  await capture(mobile, "07-mobile-candidates.png")

  const tablet = await browser.newPage({ viewport: { width: 768, height: 1024 } })
  await openFirstDetail(tablet, baseUrl)
  await assertNoViewportOverflow(tablet)
  await runAxe(tablet, "tablet candidates")
  await capture(tablet, "08-tablet-candidates.png")

  const light = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  await light.addInitScript(() => localStorage.setItem("flux-theme", "light"))
  await openFirstDetail(light, baseUrl)
  assert.equal(await light.locator("html").getAttribute("data-theme"), "light")
  await runAxe(light, "light theme")
  await capture(light, "09-light-theme.png")

  const zoom = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await openFirstDetail(zoom, baseUrl)
  await zoom.evaluate(() => { document.documentElement.style.zoom = "2" })
  assert.equal(await zoom.getByRole("button", { name: "Buscar coincidencias" }).isVisible(), true)
  await assertNoViewportOverflow(zoom, { allowDocumentOverflow: true })
  await runAxe(zoom, "zoom 200")
  await capture(zoom, "10-zoom-200.png")

  const denied = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await denied.goto(`${baseUrl}?role=requester`, { waitUntil: "networkidle" })
  await denied.getByRole("heading", { name: "Acceso restringido" }).waitFor()
  assert.deepEqual(await denied.evaluate(() => window.__qaRpcCalls), [])
  await runAxe(denied, "requester denied")

  process.stdout.write(`${JSON.stringify({
    outputDir,
    screens,
    axe: "zero critical/serious",
    masked: true,
    replacePreflight: {
      changeFocusesSearch: true,
      exactProviderCard: "QA_MATCH_PROVIDER_B",
      dialogOpen: true,
      escape: true,
      focusReturn: true,
      reasonValidatedWithoutReplaceSubmit: true,
      mockedMutationCount: await desktop.evaluate(() => window.__qaMutationCount),
    },
    viewports: [390, 768, 1366],
    themes: ["dark", "light"],
    states: ["candidates", "comparison", "confirmation", "linked", "replace-dialog", "conflict", "terminal", "mobile", "tablet", "zoom-200", "requester-denied"],
  })}\n`)
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}

async function openFirstDetail(page, url, expectedState = "Candidatos encontrados") {
  await page.goto(url, { waitUntil: "networkidle" })
  await page.locator("#triageWorkspace").waitFor({ state: "visible" })
  await page.getByRole("button", { name: /Ver detalle de QA_MATCH_RETRY_MAIN/ }).click()
  await page.getByText(expectedState, { exact: true }).waitFor()
}

async function waitForOpenDialog(page) {
  await page.waitForFunction(() => document.querySelector("#matchDialog")?.open === true)
  await page.locator("#matchTitle").waitFor({ state: "visible" })
  await page.locator("#matchReasonCode").waitFor({ state: "visible" })
  await page.locator("#matchReason").waitFor({ state: "visible" })
  await page.locator("#confirmMatchBtn").waitFor({ state: "visible" })
}

async function assertReplaceDialog(page) {
  assert.equal(await page.locator("#matchDialog").evaluate((dialog) => dialog.open), true)
  assert.equal(await page.locator("#matchTitle").textContent(), "Comparar proveedor")
  assert.match(await page.locator("#matchDescription").textContent(), /Revisa los datos declarados/)
  assert.equal(await page.locator("#confirmMatchBtn").textContent(), "Confirmar cambio")
  assert.match(await page.locator("#matchReasonRequired").textContent(), /obligatoria/)
  await page.locator("#comparisonContent .comparison-summary strong").getByText("QA_MATCH_PROVIDER_B", { exact: true }).waitFor()
  await page.getByText("QA_MATCH_PROVIDER_A", { exact: true }).first().waitFor()
}

async function assertNoViewportOverflow(page, { allowDocumentOverflow = false } = {}) {
  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    dialogWidth: document.querySelector("#detailDialog")?.getBoundingClientRect().width || 0,
  }))
  if (!allowDocumentOverflow) assert.ok(geometry.documentWidth <= geometry.viewport + 1, JSON.stringify(geometry))
  assert.ok(geometry.dialogWidth <= geometry.viewport + 1, JSON.stringify(geometry))
}

async function expectMasked(page) {
  const text = await page.locator("#detailContent").innerText()
  assert.match(text, /••••••••••••••9012/)
  assert.doesNotMatch(text, /\b[0-9]{18}\b/)
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(outputDir, name), fullPage: true })
  screens += 1
}

async function runAxe(page, label) {
  await page.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.3/axe.min.js" })
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    })
    return result.violations
      .filter((violation) => ["critical", "serious"].includes(violation.impact))
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
        targets: violation.nodes.slice(0, 5).map((node) => node.target),
      }))
  })
  assert.deepEqual(violations, [], `${label}: ${JSON.stringify(violations)}`)
}

function mimeType(filePath) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".webp": "image/webp",
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream"
}
