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
  provider: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  inactive: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
})

const listFixture = {
  summary: { total: 1, received: 0, in_review: 1, needs_correction: 0, rejected: 0, converted: 0, cancelled: 0 },
  total: 1,
  page: 1,
  page_size: 25,
  companies: [{ id: ids.company, name: "Flux Operadora" }],
  items: [{
    id: ids.intake,
    public_folio: "INT-2026-000051",
    company_id: ids.company,
    company_name: "Flux Operadora",
    status: "in_review",
    provider_name: "Servicios Horizonte",
    concept: "Producción técnica",
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
    provider_rfc: "SHO260101AB1",
    provider_email: "contacto@horizonte.example",
    provider_phone: "+52 55 0000 0000",
    description: "Audio e iluminación.",
    requested_payment_date: "2026-07-24",
    invoice_folio: "F-1051",
    invoice_uuid: "5AD73A63-9290-4D7C-876A-3957C6E57B20",
    invoice_date: "2026-07-17",
    bank_name: "Banco de ejemplo",
    bank_account_masked: "••••••2468",
    bank_clabe_masked: "••••••••••••••9012",
    beneficiary_name: "Servicios Horizonte",
  },
  files: [],
  events: [{
    id: "77777777-7777-4777-8777-777777777777",
    event_type: "status_changed",
    actor_type: "finance",
    actor_name: "QA Finanzas",
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
      proveedor_id: ids.provider,
      alias: "HORIZONTE",
      legal_name: "Servicios Horizonte, S.A. de C.V.",
      rfc: "SHO260101AB1",
      payment_method: "Transferencia bancaria",
      bank: "Banco de ejemplo",
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
      proveedor_id: ids.inactive,
      alias: "HORIZONTE LEGACY",
      legal_name: "Servicios Horizonte Legacy",
      rfc: "SHO260101AB1",
      payment_method: "Transferencia bancaria",
      bank: "Banco de ejemplo",
      account_masked: "••••••7777",
      clabe_masked: "••••••••••••••7777",
      active: false,
      selectable: false,
      score: 70,
      confidence: "high",
      reasons: ["RFC exacto"],
      differences: ["CLABE distinta"],
    },
  ],
  history: [],
}

const comparisonFixture = {
  payment_intake_id: ids.intake,
  status: "in_review",
  updated_at: detailFixture.intake.updated_at,
  eligible: true,
  proveedor_id: ids.provider,
  provider_alias: "HORIZONTE",
  provider_active: true,
  rows: [
    { field: "Razón social", declared: "Servicios Horizonte", master: "Servicios Horizonte, S.A. de C.V.", result: "different" },
    { field: "RFC", declared: "SHO260101AB1", master: "SHO260101AB1", result: "match" },
    { field: "Banco", declared: "Banco de ejemplo", master: "Banco de ejemplo", result: "match" },
    { field: "Cuenta", declared: "••••••2468", master: "••••••2468", result: "match" },
    { field: "CLABE", declared: "••••••••••••••9012", master: "••••••••••••••9012", result: "match" },
    { field: "Beneficiario", declared: "Servicios Horizonte", master: "Servicios Horizonte SA", result: "different" },
    { field: "Correo", declared: "contacto@horizonte.example", master: "pagos@horizonte.example", result: "different" },
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
    window.__qaConflict = false;
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
      rpc: async (name) => {
        window.__qaRpcCalls.push(name);
        if (name === "list_provider_intakes") return { data: list, error: null };
        if (name === "get_provider_intake_detail") return { data: detail, error: null };
        if (name === "find_provider_intake_candidates") return { data: window.__qaMatch, error: null };
        if (name === "get_provider_intake_match_comparison") return { data: comparison, error: null };
        if (name === "set_provider_intake_match") {
          if (window.__qaConflict) return { data: null, error: { message: "provider_intake_conflict" } };
          detail.intake.updated_at = "2026-07-18T15:00:00.000Z";
          window.__qaMatch = {
            ...window.__qaMatch,
            updated_at: detail.intake.updated_at,
            current_match: {
              proveedor_id: "${ids.provider}",
              alias: "HORIZONTE",
              legal_name: "Servicios Horizonte, S.A. de C.V.",
              rfc: "SHO260101AB1",
              payment_method: "Transferencia bancaria",
              bank: "Banco de ejemplo",
              account_masked: "••••••2468",
              clabe_masked: "••••••••••••••9012",
              active: true,
            },
            history: [{
              event_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              action_kind: "match_set",
              previous_provider: null,
              new_provider: "HORIZONTE",
              match_confidence: "high",
              reason_code: "candidate_selected",
              reason: null,
              actor_type: "finance",
              created_at: detail.intake.updated_at,
            }],
          };
          return { data: { matched_proveedor_id: "${ids.provider}", idempotent: false }, error: null };
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
const browser = await chromium.launch({ channel: "chrome", headless: true })
let screens = 0

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
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

  const conflict = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await openFirstDetail(conflict, baseUrl)
  await conflict.getByRole("button", { name: "Comparar" }).first().click()
  await conflict.evaluate(() => { window.__qaConflict = true })
  await conflict.getByRole("button", { name: "Confirmar vínculo" }).click()
  await conflict.getByText("Esta solicitud fue actualizada por otro usuario. Recarga el detalle.").waitFor()
  await runAxe(conflict, "conflict")
  await capture(conflict, "04-conflict.png")

  const terminal = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await openFirstDetail(terminal, `${baseUrl}?state=terminal`, "Revisión requerida")
  await terminal.getByText("Revisión requerida", { exact: true }).waitFor()
  assert.equal(await terminal.getByRole("button", { name: "Confirmar vínculo" }).count(), 0)
  await runAxe(terminal, "terminal readonly")
  await capture(terminal, "05-terminal-readonly.png")

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await openFirstDetail(mobile, baseUrl)
  await runAxe(mobile, "mobile candidates")
  await capture(mobile, "06-mobile-candidates.png")

  const zoom = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await openFirstDetail(zoom, baseUrl)
  await zoom.evaluate(() => { document.documentElement.style.zoom = "2" })
  assert.equal(await zoom.getByRole("button", { name: "Buscar coincidencias" }).isVisible(), true)
  await runAxe(zoom, "zoom 200")
  await capture(zoom, "07-zoom-200.png")

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
    states: ["candidates", "comparison", "confirmation", "linked", "conflict", "terminal", "mobile", "zoom-200", "requester-denied"],
  })}\n`)
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}

async function openFirstDetail(page, url, expectedState = "Candidatos encontrados") {
  await page.goto(url, { waitUntil: "networkidle" })
  await page.locator("#triageWorkspace").waitFor({ state: "visible" })
  await page.getByRole("button", { name: /Ver detalle de INT-2026-000051/ }).click()
  await page.getByText(expectedState, { exact: true }).waitFor()
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
