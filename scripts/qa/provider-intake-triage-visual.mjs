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
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "flux-triage-visual-"))

const fixture = {
  summary: { total: 5, received: 2, in_review: 1, needs_correction: 1, rejected: 1, converted: 0, cancelled: 0 },
  total: 2,
  page: 1,
  page_size: 25,
  companies: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Flux Operadora" },
    { id: "22222222-2222-4222-8222-222222222222", name: "Quantta" },
  ],
  items: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      public_folio: "INT-2026-000041",
      company_id: "11111111-1111-4111-8111-111111111111",
      company_name: "Flux Operadora",
      status: "in_review",
      provider_name: "Servicios Horizonte",
      concept: "Producción técnica de evento",
      amount_requested: 128450.5,
      currency: "MXN",
      created_at: "2026-07-16T15:30:00.000Z",
      updated_at: "2026-07-17T14:20:00.000Z",
      file_count: 2,
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      public_folio: "INT-2026-000040",
      company_id: "22222222-2222-4222-8222-222222222222",
      company_name: "Quantta",
      status: "received",
      provider_name: "Logística del Centro",
      concept: "Transportación y maniobras",
      amount_requested: 32780,
      currency: "MXN",
      created_at: "2026-07-15T18:10:00.000Z",
      updated_at: "2026-07-15T18:10:00.000Z",
      file_count: 1,
    },
  ],
}

const detail = {
  intake: {
    id: fixture.items[0].id,
    public_folio: fixture.items[0].public_folio,
    company_id: fixture.items[0].company_id,
    company_name: fixture.items[0].company_name,
    status: "in_review",
    provider_name: "Servicios Horizonte",
    provider_rfc: "SHO260101AB1",
    provider_email: "contacto@horizonte.example",
    provider_phone: "+52 55 0000 0000",
    concept: "Producción técnica de evento",
    description: "Audio, iluminación y operación técnica.",
    amount_requested: 128450.5,
    currency: "MXN",
    requested_payment_date: "2026-07-24",
    invoice_folio: "F-1048",
    invoice_uuid: "5AD73A63-9290-4D7C-876A-3957C6E57B20",
    invoice_date: "2026-07-15",
    bank_name: "Banco de ejemplo",
    bank_account_masked: "••••••2468",
    bank_clabe_masked: "••••••••••••••9012",
    beneficiary_name: "Servicios Horizonte",
    created_at: fixture.items[0].created_at,
    updated_at: fixture.items[0].updated_at,
  },
  files: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      payment_intake_id: fixture.items[0].id,
      original_filename: "factura-julio.pdf",
      mime_type: "application/pdf",
      size_bytes: 245760,
      file_kind: "invoice_pdf",
      quarantine_status: "pending",
      created_at: fixture.items[0].created_at,
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      payment_intake_id: fixture.items[0].id,
      original_filename: "factura-julio.xml",
      mime_type: "application/xml",
      size_bytes: 14380,
      file_kind: "invoice_xml",
      quarantine_status: "pending",
      created_at: fixture.items[0].created_at,
    },
  ],
  events: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      event_type: "status_changed",
      actor_type: "finance",
      actor_name: "Analista Finanzas",
      from_status: "received",
      to_status: "in_review",
      notes: "Validación inicial de documentos.",
      created_at: "2026-07-17T14:20:00.000Z",
    },
    {
      id: "88888888-8888-4888-8888-888888888888",
      event_type: "received",
      actor_type: "public_provider",
      actor_name: "Sistema",
      from_status: null,
      to_status: "received",
      notes: null,
      created_at: fixture.items[0].created_at,
    },
  ],
}

const mockScript = `
  (() => {
    const role = new URLSearchParams(location.search).get("role") === "requester" ? "solicitante" : "finance";
    const session = { access_token: "qa-token", user: { id: "99999999-9999-4999-8999-999999999999", email: "qa@flux.example" } };
    const profile = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "qa@flux.example", full_name: "QA Finanzas", auth_user_id: session.user.id, active: true };
    const listFixture = ${JSON.stringify(fixture)};
    const detailFixture = ${JSON.stringify(detail)};
    window.__qaRpcCalls = [];
    function builder(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        insert() { return api; },
        single() { return Promise.resolve({ data: profile, error: null }); },
        maybeSingle() { return Promise.resolve({ data: table === "profiles" ? profile : null, error: null }); },
        then(resolve) {
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
        if (name === "list_provider_intakes") return { data: listFixture, error: null };
        if (name === "get_provider_intake_detail") return { data: detailFixture, error: null };
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
    const source = body.toString("utf8").replace(
      '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
      `<script>${mockScript}</script>`,
    )
    body = Buffer.from(source)
  }
  response.setHeader("Content-Type", mimeType(filePath))
  response.end(body)
})

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const { port } = server.address()
const baseUrl = `http://127.0.0.1:${port}/provider_intakes.html`
const browser = await chromium.launch({ channel: "chrome", headless: true })

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  await desktop.goto(baseUrl, { waitUntil: "networkidle" })
  await desktop.locator("#triageWorkspace").waitFor({ state: "visible" })
  assert.equal(await desktop.locator("#intakeTableBody tr").count(), 2)
  assert.equal(await desktop.getByRole("link", { name: "Solicitudes de proveedores" }).count(), 1)

  await desktop.getByRole("button", { name: /Ver detalle de INT-2026-000041/ }).click()
  await desktop.locator("#detailDialog").waitFor({ state: "visible" })
  assert.match(await desktop.locator("#detailContent").innerText(), /••••••••••••••9012/)
  assert.doesNotMatch(await desktop.locator("#detailContent").innerText(), /\b123456789012345678\b/)
  await runAxe(desktop, "desktop detail")
  await desktop.screenshot({ path: path.join(outputDir, "desktop-detail.png"), fullPage: true })

  await desktop.getByRole("button", { name: "Pedir corrección" }).click()
  await desktop.locator("#actionDialog").waitFor({ state: "visible" })
  await runAxe(desktop, "desktop action")
  await desktop.screenshot({ path: path.join(outputDir, "desktop-action.png"), fullPage: true })
  await desktop.keyboard.press("Escape")
  await desktop.keyboard.press("Escape")
  await desktop.getByRole("button", { name: "Cambiar tema" }).click()
  await runAxe(desktop, "desktop light list")

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  await mobile.goto(baseUrl, { waitUntil: "networkidle" })
  await mobile.locator("#triageWorkspace").waitFor({ state: "visible" })
  await runAxe(mobile, "mobile list")
  await mobile.screenshot({ path: path.join(outputDir, "mobile-list.png"), fullPage: true })

  const denied = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  await denied.goto(`${baseUrl}?role=requester`, { waitUntil: "networkidle" })
  await denied.getByRole("heading", { name: "Acceso restringido" }).waitFor()
  assert.deepEqual(await denied.evaluate(() => window.__qaRpcCalls), [])
  assert.equal(await denied.getByRole("link", { name: "Solicitudes de proveedores" }).count(), 0)
  await runAxe(denied, "access denied")
  await denied.screenshot({ path: path.join(outputDir, "access-denied.png"), fullPage: true })

  const zoomed = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  await zoomed.goto(baseUrl, { waitUntil: "networkidle" })
  await zoomed.locator("#triageWorkspace").waitFor({ state: "visible" })
  await zoomed.evaluate(() => { document.documentElement.style.zoom = "2" })
  assert.equal(await zoomed.getByRole("button", { name: "Actualizar" }).isVisible(), true)
  assert.equal(await zoomed.getByRole("button", { name: /Ver detalle de INT-2026-000041/ }).isVisible(), true)
  await runAxe(zoomed, "zoom 200 list")
  await zoomed.screenshot({ path: path.join(outputDir, "zoom-200-list.png"), fullPage: true })

  process.stdout.write(`${JSON.stringify({ outputDir, axe: "zero critical/serious", screens: 5, zoom: "200%" })}\n`)
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
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
        samples: violation.nodes.slice(0, 8).map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
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
