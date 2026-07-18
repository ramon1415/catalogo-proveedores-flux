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
const reflowMetrics = []

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

  const dangerAction = desktop.locator(".current-match-actions .danger-action").filter({ hasText: "Retirar vínculo" })
  const terminalDangerAction = desktop.locator(".detail-actions .danger-action").first()
  assert.equal(await dangerAction.count(), 1)
  assert.equal(await terminalDangerAction.count(), 1)
  const dangerContrast = {
    clear: {
      dark: await inspectDangerAction(desktop, dangerAction, "dark"),
      light: await inspectDangerAction(desktop, dangerAction, "light"),
    },
    terminal: {
      dark: await inspectDangerAction(desktop, terminalDangerAction, "dark"),
      light: await inspectDangerAction(desktop, terminalDangerAction, "light"),
    },
  }
  process.stdout.write(`CONTRAST ${JSON.stringify(dangerContrast)}\n`)
  assertDangerActionContrast(dangerContrast.clear)
  assertDangerActionContrast(dangerContrast.terminal)
  await desktop.evaluate(() => { document.documentElement.dataset.theme = "dark" })

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

  const reflowCases = [
    { name: "desktop-1280", width: 1280, height: 900, theme: "dark" },
    { name: "zoom-200-equivalent-640", width: 640, height: 900, theme: "dark" },
    { name: "zoom-200-short-640", width: 640, height: 450, theme: "light" },
    { name: "tablet-768", width: 768, height: 1024, theme: "dark" },
    { name: "mobile-390", width: 390, height: 844, theme: "light" },
    { name: "reflow-320", width: 320, height: 640, theme: "dark" },
  ]
  for (const testCase of reflowCases) {
    const page = await browser.newPage({ viewport: { width: testCase.width, height: testCase.height } })
    await page.addInitScript((theme) => localStorage.setItem("flux-theme", theme), testCase.theme)
    const { trigger } = await openReplaceDialogForReflow(page, baseUrl)
    await runAxe(page, `reflow ${testCase.name}`)
    await assertBidirectionalContentAccessible(page)
    const metrics = await inspectReflowMetrics(page)
    assertReflowMetrics(metrics, testCase.name)
    assert.equal(metrics.cssZoom.documentElement, "1")
    assert.equal(metrics.cssZoom.body, "1")
    assert.equal(metrics.essentialActions.confirmVisible, true)
    assert.equal(metrics.essentialActions.confirmWithinViewport, true)
    assert.equal(metrics.essentialActions.verticalContentScrollable, true)
    reflowMetrics.push({ ...testCase, ...metrics })
    await page.keyboard.press("Escape")
    await page.waitForFunction(() => !document.querySelector("#matchDialog")?.open)
    assert.equal(await trigger.evaluate((node) => document.activeElement === node), true)
    await page.close()
  }
  process.stdout.write(`REFLOW ${JSON.stringify(reflowMetrics)}\n`)

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
    viewports: [320, 390, 640, 768, 1280, 1366],
    themes: ["dark", "light"],
    dangerContrast,
    reflow: reflowMetrics,
    states: ["candidates", "comparison", "confirmation", "linked", "replace-dialog", "conflict", "terminal", "mobile", "tablet", "reflow", "requester-denied"],
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

async function openReplaceDialogForReflow(page, url) {
  await openFirstDetail(page, url)
  await page.getByRole("button", { name: "Comparar" }).first().click()
  await waitForOpenDialog(page)
  await page.getByRole("button", { name: "Confirmar vínculo" }).click()
  await page.getByText("Vinculado", { exact: true }).waitFor()

  await page.getByRole("button", { name: "Cambiar vínculo" }).click()
  const search = page.locator("#providerMatchSearch")
  assert.equal(await search.evaluate((node) => document.activeElement === node), true)
  await search.fill("QA_MATCH_PROVIDER_B")
  await search.press("Enter")
  const card = page.locator(".candidate-card").filter({ hasText: "QA_MATCH_PROVIDER_B" })
  assert.equal(await card.count(), 1)
  const trigger = card.getByRole("button", { name: "Seleccionar para cambio" })
  await trigger.click()
  await waitForOpenDialog(page)
  await assertReplaceDialog(page)
  return { trigger }
}

async function inspectReflowMetrics(page) {
  await page.locator("#confirmMatchBtn").scrollIntoViewIfNeeded()
  return page.evaluate(() => {
    const dialog = document.querySelector("#matchDialog")
    const shell = dialog?.querySelector(".match-shell")
    const scrollRegion = dialog?.querySelector(".dialog-scroll")
    const confirm = document.querySelector("#confirmMatchBtn")
    const documentElement = document.documentElement
    const body = document.body
    const dialogRect = dialog?.getBoundingClientRect()
    const shellRect = shell?.getBoundingClientRect()
    const confirmRect = confirm?.getBoundingClientRect()
    const scrollStyle = scrollRegion ? getComputedStyle(scrollRegion) : null
    const normalizeZoom = (node) => {
      const value = Number.parseFloat(getComputedStyle(node).zoom)
      return Number.isFinite(value) ? String(value) : "1"
    }

    return {
      viewportWidth: documentElement.clientWidth,
      viewportHeight: documentElement.clientHeight,
      visualViewportWidth: window.visualViewport?.width ?? null,
      visualViewportHeight: window.visualViewport?.height ?? null,
      documentScrollWidth: documentElement.scrollWidth,
      documentScrollHeight: documentElement.scrollHeight,
      bodyScrollWidth: body.scrollWidth,
      bodyScrollHeight: body.scrollHeight,
      cssZoom: {
        documentElement: normalizeZoom(documentElement),
        body: normalizeZoom(body),
      },
      dialog: dialogRect ? {
        left: dialogRect.left,
        right: dialogRect.right,
        width: dialogRect.width,
        top: dialogRect.top,
        bottom: dialogRect.bottom,
        height: dialogRect.height,
      } : null,
      shell: shellRect ? {
        left: shellRect.left,
        right: shellRect.right,
        width: shellRect.width,
        top: shellRect.top,
        bottom: shellRect.bottom,
        height: shellRect.height,
      } : null,
      essentialActions: {
        confirmVisible: Boolean(confirm && !confirm.hidden && confirmRect?.width && confirmRect?.height),
        confirmWithinViewport: Boolean(
          confirmRect &&
          confirmRect.left >= -2 &&
          confirmRect.right <= documentElement.clientWidth + 2 &&
          confirmRect.top >= -2 &&
          confirmRect.bottom <= documentElement.clientHeight + 2
        ),
        verticalContentScrollable: Boolean(
          scrollRegion &&
          (
            scrollRegion.scrollHeight <= scrollRegion.clientHeight + 2 ||
            ["auto", "scroll"].includes(scrollStyle?.overflowY)
          )
        ),
      },
    }
  })
}

function assertReflowMetrics(metrics, label) {
  assert.ok(metrics.dialog, `${label}: missing dialog metrics`)
  assert.ok(metrics.shell, `${label}: missing shell metrics`)
  assert.ok(metrics.documentScrollWidth <= metrics.viewportWidth + 2, `${label}: ${JSON.stringify(metrics)}`)
  assert.ok(metrics.bodyScrollWidth <= metrics.viewportWidth + 2, `${label}: ${JSON.stringify(metrics)}`)
  assert.ok(metrics.dialog.left >= -2, `${label}: ${JSON.stringify(metrics)}`)
  assert.ok(metrics.dialog.right <= metrics.viewportWidth + 2, `${label}: ${JSON.stringify(metrics)}`)
  assert.ok(metrics.dialog.width <= metrics.viewportWidth + 2, `${label}: ${JSON.stringify(metrics)}`)
  assert.ok(metrics.shell.left >= -2, `${label}: ${JSON.stringify(metrics)}`)
  assert.ok(metrics.shell.right <= metrics.viewportWidth + 2, `${label}: ${JSON.stringify(metrics)}`)
  assert.ok(metrics.shell.width <= metrics.viewportWidth + 2, `${label}: ${JSON.stringify(metrics)}`)
}

async function assertBidirectionalContentAccessible(page) {
  const table = page.getByRole("table", {
    name: "Comparación entre datos declarados y proveedor maestro",
  })
  assert.equal(await table.count(), 1)
  const wrapper = page.locator(".comparison-table-wrap")
  const overflow = await wrapper.evaluate((node) => node.scrollWidth > node.clientWidth + 2)
  if (!overflow) return

  await page.locator("#closeMatchBtn").focus()
  let keyboardFocused = false
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab")
    keyboardFocused = await wrapper.evaluate((node) => document.activeElement === node)
    if (keyboardFocused) break
  }
  assert.equal(keyboardFocused, true, "comparison table scroll region is not keyboard reachable")
  const before = await wrapper.evaluate((node) => node.scrollLeft)
  for (let index = 0; index < 8; index += 1) await page.keyboard.press("ArrowRight")
  const after = await wrapper.evaluate((node) => node.scrollLeft)
  assert.ok(after > before, "comparison table scroll region does not respond to keyboard scrolling")
}

async function inspectDangerAction(page, button, theme) {
  await page.evaluate((nextTheme) => {
    document.documentElement.dataset.theme = nextTheme
  }, theme)

  const states = {}
  await button.evaluate((node) => node.blur())
  states.default = await dangerStyle(button)

  await button.hover()
  states.hover = await dangerStyle(button)

  await button.evaluate((node) => node.blur())
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press("Tab")
    if (await button.evaluate((node) => document.activeElement === node)) break
  }
  assert.equal(await button.evaluate((node) => document.activeElement === node), true)
  states.focusVisible = await dangerStyle(button)
  assert.equal(states.focusVisible.focusVisible, true)

  const box = await button.boundingBox()
  assert.ok(box)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  states.active = await dangerStyle(button)
  await page.mouse.move(0, 0)
  await page.mouse.up()

  await button.evaluate((node) => { node.disabled = true })
  states.disabled = await dangerStyle(button)
  await button.evaluate((node) => { node.disabled = false })
  return states
}

async function dangerStyle(button) {
  const raw = await button.evaluate((node) => {
    const parse = (value) => {
      const match = String(value).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
      if (match) return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])]
      const srgb = String(value).match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/)
      return srgb ? [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] === undefined ? 1 : Number(srgb[4])] : [0, 0, 0, 0]
    }
    const composite = (front, back) => {
      const alpha = front[3] + back[3] * (1 - front[3])
      if (!alpha) return [0, 0, 0, 0]
      return [
        (front[0] * front[3] + back[0] * back[3] * (1 - front[3])) / alpha,
        (front[1] * front[3] + back[1] * back[3] * (1 - front[3])) / alpha,
        (front[2] * front[3] + back[2] * back[3] * (1 - front[3])) / alpha,
        alpha,
      ]
    }
    let effective = [0, 0, 0, 0]
    for (let current = node; current; current = current.parentElement) {
      effective = composite(effective, parse(getComputedStyle(current).backgroundColor))
      if (effective[3] >= 0.999) break
    }
    if (effective[3] < 0.999) effective = composite(effective, [255, 255, 255, 1])
    const style = getComputedStyle(node)
    return {
      color: style.color,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
      outlineColor: style.outlineColor,
      outlineWidth: style.outlineWidth,
      opacity: Number(style.opacity),
      focusVisible: node.matches(":focus-visible"),
      effectiveBackground: effective,
    }
  })
  const background = raw.effectiveBackground
  return {
    color: raw.color,
    backgroundColor: raw.backgroundColor,
    effectiveBackground: rgbaLabel(background),
    borderColor: raw.borderColor,
    outlineColor: raw.outlineColor,
    outlineWidth: raw.outlineWidth,
    opacity: raw.opacity,
    focusVisible: raw.focusVisible,
    textContrast: contrastWithOpacity(raw.color, background, raw.opacity),
    borderContrast: contrastWithOpacity(raw.borderColor, background, raw.opacity),
    outlineContrast: contrastWithOpacity(raw.outlineColor, background, raw.opacity),
  }
}

function assertDangerActionContrast(contrast) {
  for (const [theme, states] of Object.entries(contrast)) {
    for (const state of ["default", "hover", "focusVisible", "active"]) {
      assert.ok(states[state].textContrast >= 4.5, `${theme}/${state} text: ${JSON.stringify(states[state])}`)
      assert.ok(states[state].borderContrast >= 3, `${theme}/${state} border: ${JSON.stringify(states[state])}`)
    }
    assert.ok(states.focusVisible.outlineContrast >= 3, `${theme}/focus outline: ${JSON.stringify(states.focusVisible)}`)
  }
}

function contrastWithOpacity(cssColor, background, opacity) {
  const foreground = parseCssColor(cssColor)
  foreground[3] *= opacity
  const rendered = compositeColor(foreground, background)
  return Number(contrastRatio(rendered, background).toFixed(2))
}

function parseCssColor(value) {
  const match = String(value).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
  if (match) return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])]
  const srgb = String(value).match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/)
  assert.ok(srgb, `Unsupported computed color: ${value}`)
  return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] === undefined ? 1 : Number(srgb[4])]
}

function compositeColor(front, back) {
  const alpha = front[3] + back[3] * (1 - front[3])
  return [
    (front[0] * front[3] + back[0] * back[3] * (1 - front[3])) / alpha,
    (front[1] * front[3] + back[1] * back[3] * (1 - front[3])) / alpha,
    (front[2] * front[3] + back[2] * back[3] * (1 - front[3])) / alpha,
    alpha,
  ]
}

function contrastRatio(first, second) {
  const high = Math.max(relativeLuminance(first), relativeLuminance(second))
  const low = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (high + 0.05) / (low + 0.05)
}

function relativeLuminance(color) {
  const channels = color.slice(0, 3).map((value) => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function rgbaLabel(color) {
  return `rgba(${color.slice(0, 3).map((value) => Math.round(value)).join(", ")}, ${Number(color[3].toFixed(3))})`
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
