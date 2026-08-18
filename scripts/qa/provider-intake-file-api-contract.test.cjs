const assert = require("node:assert/strict")
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
