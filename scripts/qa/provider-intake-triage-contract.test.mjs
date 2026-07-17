import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")
const migration = read("supabase/migrations/029_provider_intake_triage.sql")
const html = read("provider_intakes.html")
const client = read("provider_intakes.js")
const styles = read("provider_intakes.css")
const config = read("config.js")
const apiSource = read("api/provider-intake-file-url.js")
const require = createRequire(import.meta.url)
const fileUrlHandler = require(path.join(root, "api/provider-intake-file-url.js"))

const IDS = Object.freeze({
  user: "11111111-1111-4111-8111-111111111111",
  profile: "22222222-2222-4222-8222-222222222222",
  company: "33333333-3333-4333-8333-333333333333",
  intake: "44444444-4444-4444-8444-444444444444",
  file: "55555555-5555-4555-8555-555555555555",
})

test("migration exposes only the four authenticated triage RPCs", () => {
  for (const functionName of [
    "list_provider_intakes",
    "get_provider_intake_detail",
    "transition_provider_intake",
    "add_provider_intake_note",
  ]) {
    assert.match(migration, new RegExp(`create function public\\.${functionName}\\(`, "i"))
    assert.match(migration, new RegExp(`grant execute on function public\\.${functionName}\\(`, "i"))
  }
  assert.match(migration, /security definer/gi)
  assert.match(migration, /set search_path = public, pg_temp/gi)
  assert.match(migration, /from public, anon, authenticated, service_role;/i)
  assert.doesNotMatch(migration, /grant execute[\s\S]{0,180}\bto anon\b/i)
})

test("transition allowlist excludes conversion and enforces comments, concurrency, and idempotency", () => {
  assert.match(migration, /status = 'received' and p_to_status = 'in_review'/)
  assert.match(migration, /status = 'in_review' and p_to_status in \('needs_correction', 'rejected'\)/)
  assert.match(migration, /status = 'needs_correction' and p_to_status in \('in_review', 'rejected'\)/)
  assert.doesNotMatch(migration, /p_to_status\s*=\s*'converted'/)
  assert.match(migration, /p_to_status in \('needs_correction', 'rejected'\)/)
  assert.match(migration, /length\(v_notes\) < 10/)
  assert.match(migration, /v_intake\.updated_at is distinct from p_expected_updated_at/)
  assert.match(migration, /payment_intake_events_action_id_uidx/)
  assert.match(migration, /event_type,\s*actor_profile_id,\s*actor_type,\s*from_status,\s*to_status,\s*notes,\s*metadata/s)
})

test("detail contract masks bank values and excludes private storage paths", () => {
  const detailStart = migration.indexOf("create function public.get_provider_intake_detail")
  const transitionStart = migration.indexOf("create function public.transition_provider_intake")
  const detailSql = migration.slice(detailStart, transitionStart)
  assert.match(detailSql, /bank_account_masked/)
  assert.match(detailSql, /bank_clabe_masked/)
  assert.doesNotMatch(detailSql, /'bank_account',\s*v_intake\.bank_account/)
  assert.doesNotMatch(detailSql, /'bank_clabe',\s*v_intake\.bank_clabe/)
  assert.doesNotMatch(detailSql, /'storage_path'/)
  assert.doesNotMatch(detailSql, /'intake_link_id'/)
})

test("migration contains no forbidden domain mutations or destructive table operations", () => {
  assert.doesNotMatch(migration, /\b(delete|truncate)\s+(from\s+)?public\.(payment_intake|payment_requests|proveedores|approval_batches)\b/i)
  assert.doesNotMatch(migration, /\bdrop\s+table\b/i)
  assert.doesNotMatch(migration, /\binsert\s+into\s+public\.(payment_requests|proveedores|approval_batches)\b/i)
  assert.doesNotMatch(migration, /\bupdate\s+public\.(payment_requests|proveedores|approval_batches)\b/i)
})

test("client uses server RPCs and never updates intake tables directly", () => {
  assert.match(client, /\.rpc\("list_provider_intakes"/)
  assert.match(client, /\.rpc\("get_provider_intake_detail"/)
  assert.match(client, /\.rpc\("transition_provider_intake"/)
  assert.match(client, /\.rpc\("add_provider_intake_note"/)
  assert.doesNotMatch(client, /\.from\(["']payment_intake["']\)/)
  assert.doesNotMatch(client, /\binnerHTML\b/)
  assert.doesNotMatch(client, /service_role|serviceRole/i)
  assert.doesNotMatch(client, /console\.(log|info|debug|error)/)
})

test("navigation is role-scoped and hidden from unvalidated first paint", () => {
  assert.match(config, /file: "provider_intakes\.html"[\s\S]{0,240}groups: \[ROLE_GROUPS\.SYSADMIN, ROLE_GROUPS\.ADMIN\][\s\S]{0,80}sensitive: true/)
  assert.match(config, /canTriageProviderIntakes/)
  assert.match(config, /!item\.sensitive/)
  assert.match(client, /canTriageProviderIntakes/)
  assert.match(client, /No se consultó ninguna solicitud/)
})

test("HTML and CSS provide labeled filters, table semantics, dialogs, focus, and responsive layouts", () => {
  assert.match(html, /<caption id="intakeTableCaption">/)
  assert.match(html, /<th scope="col">/g)
  assert.match(html, /aria-live="polite"/g)
  assert.match(html, /<dialog class="intake-dialog"/)
  assert.match(html, /<dialog class="action-dialog"/)
  assert.match(html, /for="actionNotes"/)
  assert.match(html, /id="statusFilterHint"/)
  assert.match(styles, /:focus-visible/)
  assert.match(styles, /@media \(max-width: 760px\)/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
})

test("signed URL server function keeps privileged credentials server-side and uses a short TTL", () => {
  assert.match(apiSource, /FLUX_SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(apiSource, /SIGNED_URL_TTL_SECONDS = 120/)
  assert.match(apiSource, /\/auth\/v1\/user/)
  assert.match(apiSource, /profile_company_memberships/)
  assert.match(apiSource, /payment_intake_files/)
  assert.match(apiSource, /payment_intake_id: `eq\.\$\{intakeId\}`/)
  assert.match(apiSource, /bucket_id: "eq\.intake-uploads"/)
  assert.match(apiSource, /Cache-Control", "no-store/)
  assert.doesNotMatch(client, /FLUX_SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(html, /service_role/i)
})

test("authorized finance member receives one 120-second signed URL", { concurrency: false }, async () => {
  const originalFetch = global.fetch
  const calls = []
  process.env.FLUX_SUPABASE_URL = "https://project.supabase.co"
  process.env.FLUX_SUPABASE_ANON_KEY = "anon-key"
  process.env.FLUX_SUPABASE_SERVICE_ROLE_KEY = "service-key"
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    if (String(url).includes("/auth/v1/user")) return jsonResponse({ id: IDS.user })
    if (String(url).includes("/rest/v1/profiles?")) return jsonResponse([{ id: IDS.profile, active: true }])
    if (String(url).includes("/rest/v1/user_roles?")) return jsonResponse([{ roles: { name: "finance" } }])
    if (String(url).includes("/rest/v1/payment_intake?")) return jsonResponse([{ id: IDS.intake, company_id: IDS.company }])
    if (String(url).includes("/rest/v1/companies?")) return jsonResponse([{ id: IDS.company }])
    if (String(url).includes("/rest/v1/profile_company_memberships?")) return jsonResponse([{ id: IDS.profile }])
    if (String(url).includes("/rest/v1/payment_intake_files?")) {
      return jsonResponse([{
        id: IDS.file,
        payment_intake_id: IDS.intake,
        bucket_id: "intake-uploads",
        storage_path: `${IDS.intake}/${IDS.file}.pdf`,
      }])
    }
    if (String(url).includes("/storage/v1/object/sign/")) return jsonResponse({ signedURL: "/object/sign/intake-uploads/file?token=short-lived" })
    return jsonResponse({}, 404)
  }

  try {
    const response = responseRecorder()
    await fileUrlHandler(requestFor(IDS.intake, IDS.file), response)
    assert.equal(response.statusCode, 200)
    assert.equal(response.payload.expires_in, 120)
    assert.match(response.payload.url, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign\//)
    assert.equal(calls.filter((call) => call.url.includes("/storage/v1/object/sign/")).length, 1)
    assert.doesNotMatch(JSON.stringify(response.payload), /service-key/)
  } finally {
    global.fetch = originalFetch
  }
})

test("requester role is rejected before any intake or file lookup", { concurrency: false }, async () => {
  const originalFetch = global.fetch
  const calls = []
  process.env.FLUX_SUPABASE_URL = "https://project.supabase.co"
  process.env.FLUX_SUPABASE_ANON_KEY = "anon-key"
  process.env.FLUX_SUPABASE_SERVICE_ROLE_KEY = "service-key"
  global.fetch = async (url) => {
    calls.push(String(url))
    if (String(url).includes("/auth/v1/user")) return jsonResponse({ id: IDS.user })
    if (String(url).includes("/rest/v1/profiles?")) return jsonResponse([{ id: IDS.profile, active: true }])
    if (String(url).includes("/rest/v1/user_roles?")) return jsonResponse([{ roles: { name: "solicitante" } }])
    return jsonResponse({}, 500)
  }

  try {
    const response = responseRecorder()
    await fileUrlHandler(requestFor(IDS.intake, IDS.file), response)
    assert.equal(response.statusCode, 403)
    assert.deepEqual(response.payload, { error: "access_denied" })
    assert.equal(calls.some((url) => url.includes("payment_intake?")), false)
    assert.equal(calls.some((url) => url.includes("payment_intake_files?")), false)
  } finally {
    global.fetch = originalFetch
  }
})

test("file from another intake is rejected and never signed", { concurrency: false }, async () => {
  const originalFetch = global.fetch
  const calls = []
  process.env.FLUX_SUPABASE_URL = "https://project.supabase.co"
  process.env.FLUX_SUPABASE_ANON_KEY = "anon-key"
  process.env.FLUX_SUPABASE_SERVICE_ROLE_KEY = "service-key"
  global.fetch = async (url) => {
    calls.push(String(url))
    if (String(url).includes("/auth/v1/user")) return jsonResponse({ id: IDS.user })
    if (String(url).includes("/rest/v1/profiles?")) return jsonResponse([{ id: IDS.profile, active: true }])
    if (String(url).includes("/rest/v1/user_roles?")) return jsonResponse([{ roles: { name: "sysadmin" } }])
    if (String(url).includes("/rest/v1/payment_intake?")) return jsonResponse([{ id: IDS.intake, company_id: IDS.company }])
    if (String(url).includes("/rest/v1/companies?")) return jsonResponse([{ id: IDS.company }])
    if (String(url).includes("/rest/v1/payment_intake_files?")) return jsonResponse([])
    return jsonResponse({}, 500)
  }

  try {
    const response = responseRecorder()
    await fileUrlHandler(requestFor(IDS.intake, IDS.file), response)
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.payload, { error: "file_not_found" })
    assert.equal(calls.some((url) => url.includes("/storage/v1/object/sign/")), false)
  } finally {
    global.fetch = originalFetch
  }
})

function requestFor(intakeId, fileId) {
  return {
    method: "POST",
    headers: { authorization: "Bearer valid.user.token" },
    body: { payment_intake_id: intakeId, file_id: fileId },
  }
}

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload },
  }
}
