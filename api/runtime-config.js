const FALLBACK_CONFIG = Object.freeze({
  env: "dev",
  source: "fallback",
  supabaseUrl: "https://scsirgbuqjcwoaxfacth.supabase.co",
  supabaseAnonKey: "sb_publishable_JNDHMoacW6ySHEtmI1Rgdw_zVZElQL2",
})

function jsString(value) {
  return JSON.stringify(String(value || ""))
}

module.exports = function runtimeConfig(request, response) {
  const runtimeUrl = process.env.FLUX_SUPABASE_URL
  const runtimeAnonKey = process.env.FLUX_SUPABASE_ANON_KEY
  const hasRuntimeConfig = Boolean(runtimeUrl && runtimeAnonKey)

  const config = {
    env: process.env.FLUX_ENV || process.env.VERCEL_ENV || FALLBACK_CONFIG.env,
    source: hasRuntimeConfig ? "vercel-env" : FALLBACK_CONFIG.source,
    supabaseUrl: hasRuntimeConfig ? runtimeUrl : FALLBACK_CONFIG.supabaseUrl,
    supabaseAnonKey: hasRuntimeConfig ? runtimeAnonKey : FALLBACK_CONFIG.supabaseAnonKey,
  }

  response.setHeader("Content-Type", "application/javascript; charset=utf-8")
  response.setHeader("Cache-Control", "no-store, max-age=0")
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
