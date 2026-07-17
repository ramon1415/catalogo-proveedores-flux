import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { chromium } = require("playwright")
const axePath = require.resolve("axe-core/axe.min.js")

const requiredEnvironment = [
  "SUPABASE_URL",
  "SUPABASE_DEV_ANON_KEY",
  "SUPABASE_DEV_SERVICE_ROLE_KEY",
  "PREVIEW_URL",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_SHA",
]
for (const name of requiredEnvironment) {
  if (!String(process.env[name] || "").trim()) throw new Error(`missing_environment_${name}`)
}

const supabaseUrl = process.env.SUPABASE_URL.replace(/\/+$/, "")
const anonKey = process.env.SUPABASE_DEV_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY
const previewUrl = process.env.PREVIEW_URL.replace(/\/+$/, "")
const outputDir = path.resolve(process.env.UAT_OUTPUT_DIR || "gate1b-evidence")
const manifestPath = path.resolve(process.env.UAT_MANIFEST || path.join(process.env.RUNNER_TEMP || outputDir, "gate1b-fixtures.json"))
const runTag = `gate1b-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
const cleanupOnly = process.argv.includes("--cleanup-only")
const allowedStatuses = ["received", "in_review", "needs_correction", "rejected", "converted", "cancelled"]
const financeRoleCandidates = ["finance", "finanzas", "treasury", "tesoreria", "administracion"]
const requesterRoleCandidates = ["solicitante", "operator", "default", "seller", "celebraciones", "producciones", "planner"]

fs.mkdirSync(outputDir, { recursive: true })

class GateError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function gateAssert(value, code) {
  if (!value) throw new GateError(code)
}

function safeFailureCode(error) {
  const value = String(error?.code || error?.message || "uat_failed")
  return /^[a-z0-9_-]{1,100}$/i.test(value) ? value : "uat_failed"
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}

function randomPassword() {
  return `Qa1!${crypto.randomBytes(24).toString("base64url")}`
}

function writeManifest(manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), { encoding: "utf8", mode: 0o600 })
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  } catch (_) {
    return { run_tag: runTag, identities: [] }
  }
}

async function fetchJson(url, options = {}, label = "request") {
  const response = await fetch(url, options)
  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch (_) {
      data = null
    }
  }
  return { response, data, textLength: text.length, label }
}

function serviceHeaders(extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: "application/json",
    ...extra,
  }
}

function userHeaders(accessToken, extra = {}) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    ...extra,
  }
}

async function serviceRest(table, query = "", options = {}) {
  const result = await fetchJson(`${supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    ...options,
    headers: serviceHeaders(options.headers),
  }, `rest_${table}`)
  if (!result.response.ok) throw new GateError(`service_rest_${table}_${result.response.status}`)
  return result
}

async function insertRow(table, body) {
  const result = await serviceRest(table, "", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  })
  gateAssert(Array.isArray(result.data) && result.data.length === 1, `insert_${table}_failed`)
  return result.data[0]
}

async function deleteRows(table, filter) {
  const result = await serviceRest(table, filter, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  })
  return Array.isArray(result.data) ? result.data : []
}

async function adminRequest(pathname, options = {}) {
  const result = await fetchJson(`${supabaseUrl}/auth/v1/admin/${pathname}`, {
    ...options,
    headers: serviceHeaders(options.headers),
  }, "auth_admin")
  return result
}

async function listQaUsers() {
  const matches = []
  for (let page = 1; page <= 20; page += 1) {
    const result = await adminRequest(`users?page=${page}&per_page=100`)
    if (!result.response.ok) throw new GateError(`auth_list_${result.response.status}`)
    const users = Array.isArray(result.data?.users) ? result.data.users : []
    matches.push(...users.filter((user) => (
      user?.user_metadata?.qa_run_id === runTag ||
      user?.app_metadata?.qa_run_id === runTag
    )))
    if (users.length < 100) break
  }
  return matches
}

async function createIdentity(alias, role, companyId, manifest) {
  const email = `${alias.toLowerCase().replaceAll("_", "-")}.${process.env.GITHUB_RUN_ID}.${process.env.GITHUB_RUN_ATTEMPT}@example.invalid`
  const password = randomPassword()
  const created = await adminRequest("users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { qa_fixture: true, qa_run_id: runTag, qa_alias: alias },
      app_metadata: { qa_fixture: true, qa_run_id: runTag, qa_alias: alias },
    }),
  })
  gateAssert(created.response.status === 200 || created.response.status === 201, `auth_create_${alias}`)
  gateAssert(created.data?.id, `auth_create_${alias}_missing_id`)

  const fixture = {
    alias,
    auth_user_id: created.data.id,
    profile_id: null,
    user_role_id: null,
    membership_id: null,
    email,
    password,
    company_id: companyId,
    role_id: role.id,
  }
  manifest.identities.push(fixture)
  writeManifest(manifest)

  const profile = await insertRow("profiles", {
    auth_user_id: fixture.auth_user_id,
    full_name: alias,
    email,
    active: true,
  })
  fixture.profile_id = profile.id
  writeManifest(manifest)

  const userRole = await insertRow("user_roles", {
    profile_id: profile.id,
    role_id: role.id,
  })
  fixture.user_role_id = userRole.id
  writeManifest(manifest)

  const membership = await insertRow("profile_company_memberships", {
    profile_id: profile.id,
    company_id: companyId,
    active: true,
  })
  fixture.membership_id = membership.id
  writeManifest(manifest)
  return fixture
}

async function signIn(identity) {
  const result = await fetchJson(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ email: identity.email, password: identity.password }),
  }, "sign_in")
  gateAssert(result.response.ok, `sign_in_${identity.alias}`)
  gateAssert(result.data?.access_token && result.data?.refresh_token, `session_${identity.alias}`)
  return result.data
}

async function rpc(accessToken, name, body) {
  return fetchJson(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: userHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  }, `rpc_${name}`)
}

async function signedFileRequest(accessToken, intakeId, fileId) {
  return fetchJson(`${previewUrl}/api/provider-intake-file-url`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ payment_intake_id: intakeId, file_id: fileId }),
    redirect: "manual",
  }, "signed_file")
}

async function tableState(table) {
  const result = await serviceRest(table, "select=*&limit=10000")
  const rows = Array.isArray(result.data) ? result.data : []
  rows.sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")))
  return { count: rows.length, digest: digest(rows) }
}

async function storageState() {
  const objects = []
  for (let offset = 0; offset < 10000; offset += 1000) {
    const result = await fetchJson(`${supabaseUrl}/storage/v1/object/list/intake-uploads`, {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix: "", limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    }, "storage_list")
    if (!result.response.ok) throw new GateError(`storage_list_${result.response.status}`)
    const page = Array.isArray(result.data) ? result.data : []
    objects.push(...page)
    if (page.length < 1000) break
  }
  objects.sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")))
  return { count: objects.length, digest: digest(objects) }
}

async function businessSnapshot() {
  const tables = [
    "payment_intake",
    "payment_intake_events",
    "payment_intake_files",
    "providers",
    "payment_requests",
    "approval_batches",
    "intake_links",
    "profiles",
    "user_roles",
    "profile_company_memberships",
  ]
  const snapshot = {}
  for (const table of tables) snapshot[table] = await tableState(table)
  snapshot["storage:intake-uploads"] = await storageState()
  return snapshot
}

function compareSnapshots(before, after) {
  const comparison = {}
  let allEqual = true
  for (const name of Object.keys(before)) {
    const equal = before[name]?.count === after[name]?.count && before[name]?.digest === after[name]?.digest
    comparison[name] = {
      baseline_count: before[name]?.count ?? null,
      post_count: after[name]?.count ?? null,
      unchanged: equal,
    }
    allEqual &&= equal
  }
  return { all_equal: allEqual, resources: comparison }
}

async function inventory() {
  const [rolesResult, companiesResult, intakesResult, filesResult] = await Promise.all([
    serviceRest("roles", "select=id,name&order=name"),
    serviceRest("companies", "select=id,active&active=eq.true"),
    serviceRest("payment_intake", "select=id,company_id,status,created_at&order=created_at.desc&limit=10000"),
    serviceRest("payment_intake_files", "select=id,payment_intake_id,bucket_id,storage_path,created_at&bucket_id=eq.intake-uploads&order=created_at.desc&limit=10000"),
  ])
  const roles = rolesResult.data || []
  const companies = companiesResult.data || []
  const intakes = intakesResult.data || []
  const files = (filesResult.data || []).filter((file) => file.storage_path)
  const activeCompanyIds = new Set(companies.map((company) => company.id))
  const intakeById = new Map(intakes.map((intake) => [intake.id, intake]))
  const candidates = files
    .map((file) => ({ file, intake: intakeById.get(file.payment_intake_id) }))
    .filter(({ intake }) => intake && activeCompanyIds.has(intake.company_id))
  const primary = candidates[0]
  gateAssert(primary, "blocked_no_active_company_with_file")

  const companyA = primary.intake.company_id
  const companyBIntake = intakes.find((intake) => (
    intake.company_id !== companyA && activeCompanyIds.has(intake.company_id)
  ))
  const companyB = companyBIntake?.company_id || null
  const companyBFile = companyB
    ? candidates.find(({ intake }) => intake.company_id === companyB)?.file || null
    : null
  const foreignFile = files.find((file) => file.payment_intake_id !== primary.intake.id) || null
  const financeRole = financeRoleCandidates
    .map((candidate) => roles.find((role) => String(role.name || "").trim().toLowerCase() === candidate))
    .find(Boolean)
  const requesterRole = requesterRoleCandidates
    .map((candidate) => roles.find((role) => String(role.name || "").trim().toLowerCase() === candidate))
    .find(Boolean)
  gateAssert(financeRole, "blocked_finance_role_unavailable")
  gateAssert(requesterRole, "blocked_requester_role_unavailable")
  gateAssert(foreignFile, "blocked_foreign_file_fixture_unavailable")

  return {
    roles,
    intakes,
    files,
    financeRole,
    requesterRole,
    companyA,
    companyB,
    companyBIntake,
    companyBFile,
    intakeA: primary.intake,
    fileA: primary.file,
    foreignFile,
    sanitized: {
      active_companies: companies.length,
      companies_with_intakes: new Set(intakes.map((row) => row.company_id)).size,
      companies_with_files: new Set(candidates.map(({ intake }) => intake.company_id)).size,
      intakes: intakes.length,
      files: files.length,
      finance_role_available: Boolean(financeRole),
      requester_role_available: Boolean(requesterRole),
      company_b_suitable: Boolean(companyB),
      company_b_has_file: Boolean(companyBFile),
      foreign_file_fixture_available: Boolean(foreignFile),
    },
  }
}

async function runDirectChecks(data, sessions) {
  const listBody = {
    p_company_id: null,
    p_statuses: [],
    p_date_from: null,
    p_date_to: null,
    p_has_files: null,
    p_folio: null,
    p_provider: null,
    p_sort_direction: "desc",
    p_page: 1,
    p_page_size: 100,
  }
  const financeList = await rpc(sessions.financeA.access_token, "list_provider_intakes", listBody)
  gateAssert(financeList.response.ok, "finance_a_list_denied")
  gateAssert(Array.isArray(financeList.data?.items) && financeList.data.items.length > 0, "finance_a_list_empty")
  gateAssert(
    Array.isArray(financeList.data?.companies) &&
      financeList.data.companies.length === 1 &&
      financeList.data.companies[0].id === data.companyA,
    "finance_a_scope_invalid",
  )

  const financeDetail = await rpc(sessions.financeA.access_token, "get_provider_intake_detail", {
    p_payment_intake_id: data.intakeA.id,
  })
  gateAssert(financeDetail.response.ok, "finance_a_detail_denied")
  gateAssert(financeDetail.data?.intake?.id === data.intakeA.id, "finance_a_detail_mismatch")
  gateAssert(!JSON.stringify(financeDetail.data).includes("storage_path"), "detail_exposes_storage_path")
  gateAssert(
    !financeDetail.data?.intake?.bank_account && !financeDetail.data?.intake?.bank_clabe,
    "detail_exposes_bank_value",
  )

  const signed = await signedFileRequest(sessions.financeA.access_token, data.intakeA.id, data.fileA.id)
  gateAssert(signed.response.ok, "signed_url_denied")
  gateAssert(signed.data?.expires_in === 120, "signed_url_ttl_invalid")
  gateAssert(/^https:\/\//.test(String(signed.data?.url || "")), "signed_url_protocol_invalid")
  gateAssert(!JSON.stringify(signed.data).includes("storage_path"), "signed_response_exposes_storage_path")
  gateAssert(/no-store/i.test(String(signed.response.headers.get("cache-control") || "")), "signed_response_cacheable")
  const signedRead = await fetch(signed.data.url, { headers: { Range: "bytes=0-0" }, redirect: "manual" })
  gateAssert([200, 206].includes(signedRead.status), "signed_url_unreadable")
  await signedRead.arrayBuffer()

  const foreign = await signedFileRequest(
    sessions.financeA.access_token,
    data.intakeA.id,
    data.foreignFile.id,
  )
  gateAssert(foreign.response.status === 404, "foreign_file_not_rejected")

  const requesterList = await rpc(sessions.requesterA.access_token, "list_provider_intakes", listBody)
  gateAssert(!requesterList.response.ok, "requester_list_allowed")
  gateAssert(
    JSON.stringify(requesterList.data || {}).includes("provider_intake_access_denied"),
    "requester_list_wrong_denial",
  )
  const requesterSigned = await signedFileRequest(
    sessions.requesterA.access_token,
    data.intakeA.id,
    data.fileA.id,
  )
  gateAssert(requesterSigned.response.status === 403, "requester_signed_not_403")

  let isolation = {
    status: "BLOCKED",
    reason: "No existe una segunda empresa activa con intakes en DEV.",
    finance_b_created: false,
  }
  if (data.companyB && sessions.financeB) {
    const aToBList = await rpc(sessions.financeA.access_token, "list_provider_intakes", {
      ...listBody,
      p_company_id: data.companyB,
    })
    gateAssert(!aToBList.response.ok, "finance_a_cross_company_list_allowed")
    const aToBDetail = await rpc(sessions.financeA.access_token, "get_provider_intake_detail", {
      p_payment_intake_id: data.companyBIntake.id,
    })
    gateAssert(!aToBDetail.response.ok, "finance_a_cross_company_detail_allowed")

    const bList = await rpc(sessions.financeB.access_token, "list_provider_intakes", listBody)
    gateAssert(bList.response.ok, "finance_b_list_denied")
    gateAssert(
      Array.isArray(bList.data?.companies) &&
        bList.data.companies.length === 1 &&
        bList.data.companies[0].id === data.companyB,
      "finance_b_scope_invalid",
    )
    const bToA = await rpc(sessions.financeB.access_token, "get_provider_intake_detail", {
      p_payment_intake_id: data.intakeA.id,
    })
    gateAssert(!bToA.response.ok, "finance_b_cross_company_detail_allowed")
    isolation = {
      status: "PASS",
      reason: "Se verificó aislamiento bidireccional entre Empresa A y Empresa B.",
      finance_b_created: true,
    }
  }

  return {
    finance_list: true,
    finance_detail: true,
    detail_without_storage_path: true,
    bank_values_masked: true,
    signed_url_ttl_120: true,
    signed_url_readable: true,
    foreign_file_rejected: true,
    requester_rpc_denied: true,
    requester_signed_403: true,
    company_isolation: isolation,
  }
}

async function loginInBrowser(page, identity) {
  await page.goto(`${previewUrl}/index.html`, { waitUntil: "networkidle", timeout: 60_000 })
  const result = await page.evaluate(async ({ email, password }) => {
    const client = window.getFluxSupabaseClient?.() ||
      window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    return { ok: Boolean(data?.session?.access_token) && !error }
  }, { email: identity.email, password: identity.password })
  gateAssert(result.ok, `browser_login_${identity.alias}`)
}

async function runAxe(page, label) {
  await page.addScriptTag({ path: axePath })
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    })
    return result.violations
      .filter((violation) => ["critical", "serious"].includes(violation.impact))
      .map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length }))
  })
  gateAssert(violations.length === 0, `axe_${label}`)
}

async function sanitizeFinancePage(page) {
  await page.evaluate(() => {
    const userName = document.getElementById("userName")
    const userEmail = document.getElementById("userEmail")
    if (userName) userName.textContent = "QA_FINANCE_A"
    if (userEmail) userEmail.textContent = "Identidad temporal DEV"
    const selectedCompany = document.querySelector("#companyFilter option:checked")
    if (selectedCompany) selectedCompany.textContent = "Empresa A"
    document.querySelectorAll("#intakeTableBody tr").forEach((row, rowIndex) => {
      const safe = [
        `INT-QA-${String(rowIndex + 1).padStart(3, "0")}`,
        "Fecha verificada",
        "Empresa A",
        "Proveedor QA",
        "Concepto verificado",
        "$ ••••",
        "Documento disponible",
        null,
        "Antigüedad verificada",
      ]
      Array.from(row.cells).forEach((cell, index) => {
        if (safe[index] !== null && safe[index] !== undefined) cell.textContent = safe[index]
      })
      const button = row.querySelector("button")
      if (button) {
        button.textContent = "Ver detalle"
        button.setAttribute("aria-label", "Ver detalle de solicitud QA")
      }
    })
    const title = document.getElementById("detailTitle")
    const subtitle = document.getElementById("detailSubtitle")
    if (title) title.textContent = "INT-QA-001"
    if (subtitle) subtitle.textContent = "Empresa A · datos verificados"
    document.querySelectorAll(".intake-identity strong").forEach((node) => { node.textContent = "Proveedor QA" })
    document.querySelectorAll(".intake-identity p").forEach((node) => { node.textContent = "Empresa A · antigüedad verificada" })
    document.querySelectorAll(".detail-row dd").forEach((node) => { node.textContent = "Dato verificado y oculto" })
    document.querySelectorAll(".file-name").forEach((node, index) => { node.textContent = `Documento QA ${index + 1}` })
    document.querySelectorAll(".file-meta").forEach((node) => { node.textContent = "Tipo y tamaño verificados · cuarentena verificada" })
    document.querySelectorAll(".event-meta").forEach((node) => { node.textContent = "Evento verificado · actor oculto" })
    document.querySelectorAll(".event-note").forEach((node) => { node.textContent = "Nota interna ocultada" })
  })
}

async function sanitizeRequesterPage(page) {
  await page.evaluate(() => {
    const userName = document.getElementById("userName")
    const userEmail = document.getElementById("userEmail")
    if (userName) userName.textContent = "QA_REQUESTER_A"
    if (userEmail) userEmail.textContent = "Identidad temporal DEV"
  })
}

async function runBrowserChecks(data, identities) {
  const browser = await chromium.launch({ headless: true })
  const mutationRequests = []
  try {
    const financeContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    })
    const financePage = await financeContext.newPage()
    financePage.on("request", (request) => {
      if (/\/rpc\/(transition_provider_intake|add_provider_intake_note)/.test(request.url())) {
        mutationRequests.push("forbidden")
      }
    })
    await loginInBrowser(financePage, identities.financeA)
    await financePage.goto(`${previewUrl}/provider_intakes.html`, { waitUntil: "networkidle", timeout: 60_000 })
    await financePage.locator("#triageWorkspace").waitFor({ state: "visible", timeout: 30_000 })
    gateAssert(
      await financePage.getByRole("link", { name: "Solicitudes de proveedores" }).count() === 1,
      "finance_menu_missing",
    )
    await financePage.locator("#companyFilter").selectOption(data.companyA)
    await financePage.locator("#statusFilter").selectOption([])
    await financePage.locator("#filesFilter").selectOption("true")
    await financePage.waitForFunction(() => (
      document.querySelectorAll("#intakeTableBody .view-intake-btn").length > 0 &&
      !document.getElementById("filterForm")?.getAttribute("aria-busy")?.includes("true")
    ), null, { timeout: 30_000 })
    await financePage.locator("#intakeTableBody .view-intake-btn").first().click()
    await financePage.locator("#detailDialog").waitFor({ state: "visible", timeout: 30_000 })
    await financePage.locator("#detailContent .detail-grid").waitFor({ state: "visible", timeout: 30_000 })
    gateAssert(
      (await financePage.locator("#detailContent").innerText()).length > 50,
      "browser_detail_empty",
    )
    await runAxe(financePage, "finance_desktop")
    await sanitizeFinancePage(financePage)
    await financePage.screenshot({ path: path.join(outputDir, "finance-a-detail-sanitized.png"), fullPage: true })

    const mobilePage = await financeContext.newPage()
    await mobilePage.setViewportSize({ width: 390, height: 844 })
    await mobilePage.goto(`${previewUrl}/provider_intakes.html`, { waitUntil: "networkidle", timeout: 60_000 })
    await mobilePage.locator("#triageWorkspace").waitFor({ state: "visible", timeout: 30_000 })
    await runAxe(mobilePage, "finance_mobile")
    await sanitizeFinancePage(mobilePage)
    await mobilePage.screenshot({ path: path.join(outputDir, "finance-a-mobile-sanitized.png"), fullPage: true })
    await financeContext.close()

    const requesterContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    })
    const requesterPage = await requesterContext.newPage()
    const requesterRpcCalls = []
    requesterPage.on("request", (request) => {
      if (/\/rest\/v1\/rpc\/(list_provider_intakes|get_provider_intake_detail)/.test(request.url())) {
        requesterRpcCalls.push("forbidden")
      }
    })
    await loginInBrowser(requesterPage, identities.requesterA)
    await requesterPage.goto(`${previewUrl}/provider_intakes.html`, { waitUntil: "networkidle", timeout: 60_000 })
    await requesterPage.getByRole("heading", { name: "Acceso restringido" }).waitFor({ timeout: 30_000 })
    gateAssert(requesterRpcCalls.length === 0, "requester_browser_called_rpc")
    gateAssert(
      await requesterPage.getByRole("link", { name: "Solicitudes de proveedores" }).count() === 0,
      "requester_menu_visible",
    )
    await runAxe(requesterPage, "requester_denied")
    await sanitizeRequesterPage(requesterPage)
    await requesterPage.screenshot({ path: path.join(outputDir, "requester-a-denied-sanitized.png"), fullPage: true })
    await requesterContext.close()
  } finally {
    await browser.close()
  }
  gateAssert(mutationRequests.length === 0, "browser_mutation_rpc_detected")
  return {
    finance_real_list_and_detail: true,
    finance_menu_visible: true,
    requester_direct_access_denied: true,
    requester_menu_hidden: true,
    requester_zero_data_rpc: true,
    axe_critical_serious: 0,
    screenshots_sanitized: 3,
    mutation_rpc_requests: 0,
  }
}

async function globalLogout(session) {
  if (!session?.access_token) return
  await fetch(`${supabaseUrl}/auth/v1/logout?scope=global`, {
    method: "POST",
    headers: userHeaders(session.access_token),
  }).catch(() => null)
}

function inFilter(values) {
  return `in.(${values.join(",")})`
}

async function cleanupFixtures(sessions = {}) {
  await Promise.all(Object.values(sessions).map((session) => globalLogout(session)))

  const manifest = readManifest()
  const discoveredUsers = await listQaUsers()
  const authIds = Array.from(new Set([
    ...manifest.identities.map((identity) => identity.auth_user_id).filter(Boolean),
    ...discoveredUsers.map((user) => user.id).filter(Boolean),
  ]))
  let profiles = []
  if (authIds.length) {
    const query = new URLSearchParams({
      select: "id,auth_user_id",
      auth_user_id: inFilter(authIds),
    }).toString()
    profiles = (await serviceRest("profiles", query)).data || []
  }
  const profileIds = Array.from(new Set([
    ...manifest.identities.map((identity) => identity.profile_id).filter(Boolean),
    ...profiles.map((profile) => profile.id).filter(Boolean),
  ]))

  if (profileIds.length) {
    const filter = new URLSearchParams({ profile_id: inFilter(profileIds) }).toString()
    await deleteRows("profile_company_memberships", filter)
    await deleteRows("user_roles", filter)
    await deleteRows("profiles", new URLSearchParams({ id: inFilter(profileIds) }).toString())
  }
  for (const authId of authIds) {
    const deleted = await adminRequest(`users/${authId}`, { method: "DELETE" })
    if (![200, 204, 404].includes(deleted.response.status)) {
      throw new GateError(`auth_delete_${deleted.response.status}`)
    }
  }

  const remainingUsers = await listQaUsers()
  let remainingProfiles = []
  let remainingRoles = []
  let remainingMemberships = []
  if (authIds.length) {
    remainingProfiles = (await serviceRest(
      "profiles",
      new URLSearchParams({ select: "id", auth_user_id: inFilter(authIds) }).toString(),
    )).data || []
  }
  if (profileIds.length) {
    const profileFilter = new URLSearchParams({ select: "id", profile_id: inFilter(profileIds) }).toString()
    remainingRoles = (await serviceRest("user_roles", profileFilter)).data || []
    remainingMemberships = (await serviceRest("profile_company_memberships", profileFilter)).data || []
  }
  gateAssert(remainingUsers.length === 0, "cleanup_auth_users_remaining")
  gateAssert(remainingProfiles.length === 0, "cleanup_profiles_remaining")
  gateAssert(remainingRoles.length === 0, "cleanup_user_roles_remaining")
  gateAssert(remainingMemberships.length === 0, "cleanup_memberships_remaining")

  return {
    auth_users_remaining: remainingUsers.length,
    profiles_remaining: remainingProfiles.length,
    user_roles_remaining: remainingRoles.length,
    memberships_remaining: remainingMemberships.length,
    complete: true,
  }
}

async function refreshRejected(refreshToken) {
  if (!refreshToken) return true
  const result = await fetchJson(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  }, "refresh_after_cleanup")
  return !result.response.ok
}

function publicCounts(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot).map(([name, state]) => [name, state.count]),
  )
}

function writeEvidence(result) {
  const jsonPath = path.join(outputDir, "gate-1b-authenticated-uat.json")
  const markdownPath = path.join(outputDir, "gate-1b-authenticated-uat.md")
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  const lines = [
    "# Gate 1B — UAT autenticada de triage en DEV",
    "",
    `- Resultado: **${result.status}**`,
    `- Ejecución GitHub: ${result.run_id}`,
    `- Commit probado: ${result.commit}`,
    `- Identidades temporales creadas: ${result.identities.created}`,
    `- Sesiones reales verificadas: ${result.identities.real_sessions}`,
    `- Aislamiento por empresa: ${result.direct_checks?.company_isolation?.status || "NO EJECUTADO"}`,
    `- Axe critical/serious: ${result.browser_checks?.axe_critical_serious ?? "NO EJECUTADO"}`,
    `- URL firmada: TTL 120 s = ${Boolean(result.direct_checks?.signed_url_ttl_120)}`,
    `- Archivo ajeno rechazado = ${Boolean(result.direct_checks?.foreign_file_rejected)}`,
    `- Requester rechazado con 403 en archivo = ${Boolean(result.direct_checks?.requester_signed_403)}`,
    `- Deltas de negocio: ${result.deltas?.all_equal ? "cero" : "DETECTADOS"}`,
    `- Limpieza IAM completa: ${Boolean(result.cleanup?.complete)}`,
    `- Sesiones invalidadas: ${Boolean(result.cleanup?.sessions_invalidated)}`,
    "",
    "## Inventario sanitizado",
    "",
    `- Empresas activas: ${result.inventory?.active_companies ?? "n/d"}`,
    `- Empresas con intakes: ${result.inventory?.companies_with_intakes ?? "n/d"}`,
    `- Empresas con archivos: ${result.inventory?.companies_with_files ?? "n/d"}`,
    `- Intakes inspeccionados: ${result.inventory?.intakes ?? "n/d"}`,
    `- Archivos inspeccionados: ${result.inventory?.files ?? "n/d"}`,
    "",
    "No se incluyen nombres, RFC, correos, UUID de registros, rutas de Storage, tokens, contraseñas ni URLs firmadas.",
  ]
  fs.writeFileSync(markdownPath, `${lines.join("\n")}\n`, "utf8")
}

if (cleanupOnly) {
  try {
    const cleanup = await cleanupFixtures()
    process.stdout.write(`${JSON.stringify({ cleanup_only: true, complete: cleanup.complete })}\n`)
    process.exit(0)
  } catch (_) {
    process.stdout.write(`${JSON.stringify({ cleanup_only: true, complete: false })}\n`)
    process.exit(2)
  }
}

const result = {
  gate: "phase-1d-gate-1b-authenticated-uat",
  status: "FAIL",
  run_id: process.env.GITHUB_RUN_ID,
  run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  commit: process.env.GITHUB_SHA,
  preview: previewUrl,
  environment: "DEV",
  inventory: null,
  identities: { created: 0, aliases: [], real_sessions: 0 },
  direct_checks: null,
  browser_checks: null,
  baseline_counts: null,
  post_counts: null,
  deltas: null,
  cleanup: { complete: false },
  privacy: {
    sanitized_artifacts: true,
    contains_names_rfc_emails_record_ids_storage_paths_tokens_passwords_signed_urls: false,
  },
  failure_code: null,
}
const manifest = { run_tag: runTag, identities: [] }
writeManifest(manifest)
let baseline = null
let data = null
let sessions = {}
let testFailure = null

try {
  process.stdout.write('{"phase":"preflight","status":"started"}\n')
  baseline = await businessSnapshot()
  result.baseline_counts = publicCounts(baseline)
  data = await inventory()
  result.inventory = data.sanitized

  const financeA = await createIdentity("QA_FINANCE_A", data.financeRole, data.companyA, manifest)
  const requesterA = await createIdentity("QA_REQUESTER_A", data.requesterRole, data.companyA, manifest)
  let financeB = null
  if (data.companyB) financeB = await createIdentity("QA_FINANCE_B", data.financeRole, data.companyB, manifest)
  const identities = { financeA, requesterA, financeB }
  result.identities = {
    created: financeB ? 3 : 2,
    aliases: financeB ? ["QA_FINANCE_A", "QA_REQUESTER_A", "QA_FINANCE_B"] : ["QA_FINANCE_A", "QA_REQUESTER_A"],
    real_sessions: 0,
  }

  sessions.financeA = await signIn(financeA)
  sessions.requesterA = await signIn(requesterA)
  if (financeB) sessions.financeB = await signIn(financeB)
  result.identities.real_sessions = Object.keys(sessions).length

  process.stdout.write('{"phase":"authenticated_uat","status":"started"}\n')
  result.direct_checks = await runDirectChecks(data, sessions)
  result.browser_checks = await runBrowserChecks(data, identities)
  result.status = result.direct_checks.company_isolation.status === "BLOCKED" ? "BLOCKED" : "PASS"
} catch (error) {
  testFailure = error
  result.status = safeFailureCode(error).startsWith("blocked_") ? "BLOCKED" : "FAIL"
  result.failure_code = safeFailureCode(error)
} finally {
  try {
    result.cleanup = await cleanupFixtures(sessions)
    const refreshResults = await Promise.all(Object.values(sessions).map((session) => refreshRejected(session.refresh_token)))
    result.cleanup.sessions_invalidated = refreshResults.every(Boolean)
    gateAssert(result.cleanup.sessions_invalidated, "cleanup_sessions_still_valid")
  } catch (error) {
    result.cleanup = {
      ...result.cleanup,
      complete: false,
      failure_code: safeFailureCode(error),
    }
    result.status = "FAIL"
    result.failure_code ||= "cleanup_failed"
  }

  try {
    const post = await businessSnapshot()
    result.post_counts = publicCounts(post)
    result.deltas = baseline ? compareSnapshots(baseline, post) : { all_equal: false, resources: {} }
    if (!result.deltas.all_equal) {
      result.status = "FAIL"
      result.failure_code ||= "business_delta_detected"
    }
  } catch (error) {
    result.deltas = { all_equal: false, resources: {}, failure_code: safeFailureCode(error) }
    result.status = "FAIL"
    result.failure_code ||= "post_snapshot_failed"
  }

  if (!result.cleanup.complete) result.status = "FAIL"
  if (testFailure && result.status === "PASS") result.status = "FAIL"
  writeEvidence(result)
}

process.stdout.write(`${JSON.stringify({
  phase: "complete",
  status: result.status,
  cleanup: result.cleanup.complete,
  deltas_zero: Boolean(result.deltas?.all_equal),
})}\n`)
process.exit(result.status === "FAIL" ? 1 : 0)
