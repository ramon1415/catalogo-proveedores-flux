const EMPTY_CONFIG = Object.freeze({
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
