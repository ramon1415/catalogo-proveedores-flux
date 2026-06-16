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

module.exports = function runtimeConfig(request, response) {
  const runtimeUrl = process.env.FLUX_SUPABASE_URL
  const runtimeAnonKey = process.env.FLUX_SUPABASE_ANON_KEY
  const hasRuntimeConfig = Boolean(runtimeUrl && runtimeAnonKey)
  const env = process.env.FLUX_ENV || process.env.VERCEL_ENV || EMPTY_CONFIG.env

  response.setHeader("Content-Type", "application/javascript; charset=utf-8")
  response.setHeader("Cache-Control", "no-store, max-age=0")

  if (!hasRuntimeConfig) {
    const message = isProductionEnv(env)
      ? "Missing FLUX_SUPABASE_URL or FLUX_SUPABASE_ANON_KEY in production runtime config."
      : "Missing FLUX_SUPABASE_URL or FLUX_SUPABASE_ANON_KEY runtime config."

    response.status(200).send(
      [
        "window.FLUX_ENV_CONFIG_ERROR = Object.freeze({",
        `  env: ${jsString(env)},`,
        `  source: ${jsString(EMPTY_CONFIG.source)},`,
        `  message: ${jsString(message)}`,
        "});",
        "window.FLUX_ENV_CONFIG = Object.freeze({",
        `  env: ${jsString(env)},`,
        `  source: ${jsString(EMPTY_CONFIG.source)},`,
        `  supabaseUrl: ${jsString(EMPTY_CONFIG.supabaseUrl)},`,
        `  supabaseAnonKey: ${jsString(EMPTY_CONFIG.supabaseAnonKey)}`,
        "});",
      ].join("\n")
    )
    return
  }

  const config = {
    env,
    source: "vercel-env",
    supabaseUrl: runtimeUrl,
    supabaseAnonKey: runtimeAnonKey,
  }

  response.status(200).send(
    [
      "window.FLUX_ENV_CONFIG = Object.freeze({",
      `  env: ${jsString(config.env)},`,
      `  source: ${jsString(config.source)},`,
      `  supabaseUrl: ${jsString(config.supabaseUrl)},`,
      `  supabaseAnonKey: ${jsString(config.supabaseAnonKey)}`,
      "});",
    ].join("\n")
  )
}
