const EMPTY_CONFIG = Object.freeze({
  env: "dev",
  source: "missing-runtime-config",
  supabaseUrl: "",
  supabaseAnonKey: "",
})

function jsString(value) {
  return JSON.stringify(String(value || ""))
}

function isProductionEnv(value) {
  return ["prod", "production"].includes(String(value || "").trim().toLowerCase())
}

function resolveRuntimeEnv() {
  const configuredEnv = String(process.env.FLUX_ENV || "").trim()
  if (configuredEnv) return configuredEnv

  const gitBranch = String(process.env.VERCEL_GIT_COMMIT_REF || "").trim().toLowerCase()
  if (gitBranch === "dev") return "dev"

  return process.env.VERCEL_ENV || EMPTY_CONFIG.env
}

function requestWantsJson(request) {
  const accept = String(request.headers?.accept || "").toLowerCase()
  try {
    const host = request.headers?.host || "localhost"
    const url = new URL(request.url || "/api/runtime-config", `https://${host}`)
    if (url.searchParams.get("format") === "json") return true
  } catch (_) {
    // Si no se puede parsear la URL, usar Accept como fallback.
  }
  return accept.includes("application/json")
}

function sendJson(response, config, errorMessage) {
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.status(200).send(JSON.stringify({
    ...config,
    ...(errorMessage ? { error: true, message: errorMessage } : {}),
  }))
}

function sendJavaScript(response, config, errorMessage) {
  response.setHeader("Content-Type", "application/javascript; charset=utf-8")
  const lines = []
  if (errorMessage) {
    lines.push(
      "window.FLUX_ENV_CONFIG_ERROR = Object.freeze({",
      `  env: ${jsString(config.env)},`,
      `  source: ${jsString(config.source)},`,
      `  message: ${jsString(errorMessage)}`,
      "});"
    )
  }
  lines.push(
    "window.FLUX_ENV_CONFIG = Object.freeze({",
    `  env: ${jsString(config.env)},`,
    `  source: ${jsString(config.source)},`,
    `  supabaseUrl: ${jsString(config.supabaseUrl)},`,
    `  supabaseAnonKey: ${jsString(config.supabaseAnonKey)}`,
    "});"
  )
  response.status(200).send(lines.join("\n"))
}

module.exports = function runtimeConfig(request, response) {
  const runtimeUrl = process.env.FLUX_SUPABASE_URL
  const runtimeAnonKey = process.env.FLUX_SUPABASE_ANON_KEY
  const hasRuntimeConfig = Boolean(runtimeUrl && runtimeAnonKey)
  const env = resolveRuntimeEnv()
  const wantsJson = requestWantsJson(request)

  response.setHeader("Cache-Control", "no-store, max-age=0")

  if (!hasRuntimeConfig) {
    const message = isProductionEnv(env)
      ? "Missing FLUX_SUPABASE_URL or FLUX_SUPABASE_ANON_KEY in production runtime config."
      : "Missing FLUX_SUPABASE_URL or FLUX_SUPABASE_ANON_KEY runtime config."
    const emptyConfig = { ...EMPTY_CONFIG, env }

    if (wantsJson) {
      sendJson(response, emptyConfig, message)
      return
    }

    sendJavaScript(response, emptyConfig, message)
    return
  }

  const config = {
    env,
    source: "vercel-env",
    supabaseUrl: runtimeUrl,
    supabaseAnonKey: runtimeAnonKey,
  }

  if (wantsJson) {
    sendJson(response, config)
    return
  }

  sendJavaScript(response, config)
}
