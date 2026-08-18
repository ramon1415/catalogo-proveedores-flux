const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FINANCE_ROLES = new Set([
  "sysadmin",
  "system_admin",
  "admin",
  "superadmin",
  "finance",
  "finanzas",
  "treasury",
  "tesoreria",
  "administracion",
])
const GLOBAL_ROLES = new Set(["sysadmin", "system_admin", "admin", "superadmin"])
const SIGNED_URL_TTL_SECONDS = 120

function sendJson(response, status, payload) {
  response.setHeader("Cache-Control", "no-store, max-age=0")
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.setHeader("Referrer-Policy", "no-referrer")
  response.status(status).json(payload)
}

function requestBody(request) {
  if (request.body && typeof request.body === "object") return request.body
  if (typeof request.body !== "string" || request.body.length > 4096) return null
  try {
    return JSON.parse(request.body)
  } catch (_) {
    return null
  }
}

function bearerToken(request) {
  const authorization = String(request.headers?.authorization || "")
  const match = authorization.match(/^Bearer ([A-Za-z0-9._~-]+)$/)
  return match?.[1] || ""
}

function encodeStoragePath(path) {
  return String(path || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

async function supabaseRequest(url, { apikey, authorization, method = "GET", body } = {}) {
  const headers = {
    apikey,
    Authorization: authorization,
    Accept: "application/json",
  }
  if (body !== undefined) headers["Content-Type"] = "application/json"
  return fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function readJson(response) {
  try {
    return await response.json()
  } catch (_) {
    return null
  }
}

module.exports = async function providerIntakeFileUrl(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST")
    sendJson(response, 405, { error: "method_not_allowed" })
    return
  }

  const supabaseUrl = String(process.env.FLUX_SUPABASE_URL || "").replace(/\/+$/, "")
  const anonKey = String(process.env.FLUX_SUPABASE_ANON_KEY || "")
  const serviceRoleKey = String(process.env.FLUX_SUPABASE_SERVICE_ROLE_KEY || "")
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    sendJson(response, 503, { error: "file_service_unavailable" })
    return
  }

  const body = requestBody(request)
  const intakeId = String(body?.payment_intake_id || "")
  const fileId = String(body?.file_id || "")
  if (!UUID_PATTERN.test(intakeId) || !UUID_PATTERN.test(fileId)) {
    sendJson(response, 400, { error: "invalid_request" })
    return
  }

  const accessToken = bearerToken(request)
  if (!accessToken) {
    sendJson(response, 401, { error: "auth_required" })
    return
  }

  const userResponse = await supabaseRequest(`${supabaseUrl}/auth/v1/user`, {
    apikey: anonKey,
    authorization: `Bearer ${accessToken}`,
  })
  const user = await readJson(userResponse)
  if (!userResponse.ok || !UUID_PATTERN.test(String(user?.id || ""))) {
    sendJson(response, 401, { error: "auth_required" })
    return
  }

  const gateResponse = await supabaseRequest(`${supabaseUrl}/rest/v1/rpc/get_provider_intake_module_access`, {
    apikey: anonKey,
    authorization: `Bearer ${accessToken}`,
    method: "POST",
    body: {},
  })
  const gate = await readJson(gateResponse)
  if (!gateResponse.ok || gate?.allowed !== true || !["sysadmin_only", "full"].includes(String(gate?.mode || ""))) {
    sendJson(response, 403, { error: "access_denied" })
    return
  }

  const serviceAuthorization = `Bearer ${serviceRoleKey}`
  const profileParams = new URLSearchParams({
    select: "id,active",
    auth_user_id: `eq.${user.id}`,
    active: "eq.true",
    limit: "1",
  })
  const profileResponse = await supabaseRequest(
    `${supabaseUrl}/rest/v1/profiles?${profileParams}`,
    { apikey: serviceRoleKey, authorization: serviceAuthorization },
  )
  const profiles = await readJson(profileResponse)
  const profile = Array.isArray(profiles) ? profiles[0] : null
  if (!profileResponse.ok || !UUID_PATTERN.test(String(profile?.id || ""))) {
    sendJson(response, 403, { error: "access_denied" })
    return
  }

  const roleParams = new URLSearchParams({
    select: "roles(name)",
    profile_id: `eq.${profile.id}`,
  })
  const rolesResponse = await supabaseRequest(
    `${supabaseUrl}/rest/v1/user_roles?${roleParams}`,
    { apikey: serviceRoleKey, authorization: serviceAuthorization },
  )
  const roleRows = await readJson(rolesResponse)
  const roles = (Array.isArray(roleRows) ? roleRows : [])
    .map((row) => String(row?.roles?.name || "").trim().toLowerCase())
    .filter(Boolean)
  if (!rolesResponse.ok || !roles.some((role) => FINANCE_ROLES.has(role))) {
    sendJson(response, 403, { error: "access_denied" })
    return
  }

  const intakeParams = new URLSearchParams({
    select: "id,company_id",
    id: `eq.${intakeId}`,
    limit: "1",
  })
  const intakeResponse = await supabaseRequest(
    `${supabaseUrl}/rest/v1/payment_intake?${intakeParams}`,
    { apikey: serviceRoleKey, authorization: serviceAuthorization },
  )
  const intakeRows = await readJson(intakeResponse)
  const intake = Array.isArray(intakeRows) ? intakeRows[0] : null
  if (!intakeResponse.ok || !UUID_PATTERN.test(String(intake?.company_id || ""))) {
    sendJson(response, 404, { error: "file_not_found" })
    return
  }

  const companyParams = new URLSearchParams({
    select: "id",
    id: `eq.${intake.company_id}`,
    active: "eq.true",
    limit: "1",
  })
  const companyResponse = await supabaseRequest(
    `${supabaseUrl}/rest/v1/companies?${companyParams}`,
    { apikey: serviceRoleKey, authorization: serviceAuthorization },
  )
  const companies = await readJson(companyResponse)
  if (!companyResponse.ok || !Array.isArray(companies) || companies.length !== 1) {
    sendJson(response, 403, { error: "access_denied" })
    return
  }

  if (!roles.some((role) => GLOBAL_ROLES.has(role))) {
    const membershipParams = new URLSearchParams({
      select: "id",
      profile_id: `eq.${profile.id}`,
      company_id: `eq.${intake.company_id}`,
      active: "eq.true",
      limit: "1",
    })
    const membershipResponse = await supabaseRequest(
      `${supabaseUrl}/rest/v1/profile_company_memberships?${membershipParams}`,
      { apikey: serviceRoleKey, authorization: serviceAuthorization },
    )
    const memberships = await readJson(membershipResponse)
    if (!membershipResponse.ok || !Array.isArray(memberships) || memberships.length !== 1) {
      sendJson(response, 403, { error: "access_denied" })
      return
    }
  }

  const fileParams = new URLSearchParams({
    select: "id,payment_intake_id,bucket_id,storage_path",
    id: `eq.${fileId}`,
    payment_intake_id: `eq.${intakeId}`,
    bucket_id: "eq.intake-uploads",
    limit: "1",
  })
  const fileResponse = await supabaseRequest(
    `${supabaseUrl}/rest/v1/payment_intake_files?${fileParams}`,
    { apikey: serviceRoleKey, authorization: serviceAuthorization },
  )
  const fileRows = await readJson(fileResponse)
  const file = Array.isArray(fileRows) ? fileRows[0] : null
  if (!fileResponse.ok || !file?.storage_path || file.payment_intake_id !== intakeId) {
    sendJson(response, 404, { error: "file_not_found" })
    return
  }

  const encodedPath = encodeStoragePath(file.storage_path)
  const signResponse = await supabaseRequest(
    `${supabaseUrl}/storage/v1/object/sign/intake-uploads/${encodedPath}`,
    {
      apikey: serviceRoleKey,
      authorization: serviceAuthorization,
      method: "POST",
      body: { expiresIn: SIGNED_URL_TTL_SECONDS },
    },
  )
  const signResult = await readJson(signResponse)
  if (!signResponse.ok || !signResult?.signedURL) {
    sendJson(response, 503, { error: "signed_url_unavailable" })
    return
  }

  const signedUrl = String(signResult.signedURL).startsWith("http")
    ? String(signResult.signedURL)
    : `${supabaseUrl}/storage/v1${signResult.signedURL}`

  sendJson(response, 200, {
    url: signedUrl,
    expires_in: SIGNED_URL_TTL_SECONDS,
  })
}
