// Configuracion Supabase
// No uses la secret key en frontend.
;(function restoreFluxTheme() {
  // Restaura el tema (claro/oscuro) guardado en localStorage en TODAS las páginas,
  // temprano y de forma consistente (antes iba página por página y faltaba en
  // ingresos.js/layouts.js, por eso se perdía al cambiar de módulo).
  try {
    const saved = localStorage.getItem("flux-theme")
    if (saved) document.documentElement.setAttribute("data-theme", saved)
  } catch (_) {
    // localStorage puede estar bloqueado por el navegador.
  }
})()
;(function installEarlyFluxShellSkeleton() {
  if (document.getElementById("fluxShellReadyStyles")) return
  const style = document.createElement("style")
  style.id = "fluxShellReadyStyles"
  style.textContent = `
     .sidebar .nav:empty{visibility:visible!important;opacity:1!important;pointer-events:none!important;display:block!important;position:relative;min-height:430px;overflow:hidden}
     .sidebar .nav:empty::before{content:"";display:block;width:100%;height:430px;border-radius:10px;opacity:.9;background:
      linear-gradient(90deg,rgba(148,163,184,.18),rgba(148,163,184,.28)) 10px 10px/82px 9px no-repeat,
      linear-gradient(90deg,rgba(20,184,166,.16),rgba(20,184,166,.08)) 0 32px/100% 40px no-repeat,
      linear-gradient(90deg,rgba(20,184,166,.5),rgba(20,184,166,.18)) 0 32px/3px 40px no-repeat,
      linear-gradient(90deg,rgba(148,163,184,.22),rgba(148,163,184,.34)) 22px 45px/155px 12px no-repeat,
      linear-gradient(90deg,rgba(148,163,184,.14),rgba(148,163,184,.24)) 22px 91px/175px 12px no-repeat,
      linear-gradient(90deg,rgba(148,163,184,.14),rgba(148,163,184,.24)) 22px 137px/150px 12px no-repeat,
      linear-gradient(90deg,rgba(148,163,184,.14),rgba(148,163,184,.24)) 22px 183px/165px 12px no-repeat,
      linear-gradient(90deg,rgba(148,163,184,.18),rgba(148,163,184,.28)) 10px 236px/62px 9px no-repeat,
      linear-gradient(90deg,rgba(148,163,184,.14),rgba(148,163,184,.24)) 22px 271px/145px 12px no-repeat,
      linear-gradient(90deg,rgba(148,163,184,.14),rgba(148,163,184,.24)) 22px 317px/170px 12px no-repeat,
      linear-gradient(90deg,rgba(148,163,184,.18),rgba(148,163,184,.28)) 10px 370px/96px 9px no-repeat,
      linear-gradient(90deg,rgba(148,163,184,.14),rgba(148,163,184,.24)) 22px 405px/130px 12px no-repeat;animation:fluxShellSkeletonPulse 1.35s ease-in-out infinite}
     .sidebar .nav:empty::after{content:"";position:absolute;inset:0;transform:translateX(-65%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent);animation:fluxShellSkeletonSweep 1.4s ease-in-out infinite}
    body.flux-shell-ready .sidebar .nav{visibility:visible;opacity:1;pointer-events:auto;transition:opacity 120ms ease}
    body.flux-shell-ready .sidebar .nav::before,
    body.flux-shell-ready .sidebar .nav::after{content:none;display:none}
    @keyframes fluxShellSkeletonPulse{0%,100%{opacity:.72}50%{opacity:1}}
    @keyframes fluxShellSkeletonSweep{0%{transform:translateX(-80%)}100%{transform:translateX(80%)}}
  `
  document.head.appendChild(style)
})()
;(function loadFluxRuntimeConfig() {
  if (window.FLUX_ENV_CONFIG) return
  if (window.__FLUX_RUNTIME_CONFIG_REQUESTED__ && window.FLUX_ENV_CONFIG) return
  window.__FLUX_RUNTIME_CONFIG_REQUESTED__ = true

  const runtimeBase = "./api/runtime-config?v=20260616-loader"

  function setRuntimeError(message) {
    window.FLUX_ENV_CONFIG_ERROR = Object.freeze({
      env: window.FLUX_ENV_CONFIG?.env || "unknown",
      source: "missing-runtime-config",
      message,
    })
  }

  function applyRuntimeConfig(config) {
    if (!config || typeof config !== "object") return false
    window.FLUX_ENV_CONFIG = Object.freeze({
      env: String(config.env || ""),
      source: String(config.source || ""),
      supabaseUrl: String(config.supabaseUrl || ""),
      supabaseAnonKey: String(config.supabaseAnonKey || ""),
    })
    if (config.error || config.message) {
      setRuntimeError(String(config.message || config.error))
    }
    return true
  }

  function requestRuntimeConfig(url, accept) {
    const request = new XMLHttpRequest()
    request.open("GET", url, false)
    if (accept) request.setRequestHeader("Accept", accept)
    request.send(null)
    if (request.status < 200 || request.status >= 300) {
      throw new Error(`runtime_config_http_${request.status}`)
    }
    return request.responseText || ""
  }

  try {
    const jsonText = requestRuntimeConfig(`${runtimeBase}&format=json`, "application/json")
    if (applyRuntimeConfig(JSON.parse(jsonText))) return
  } catch (error) {
    setRuntimeError(`No se pudo cargar runtime config JSON: ${error.message}`)
  }

  try {
    const scriptText = requestRuntimeConfig(runtimeBase, "application/javascript")
    ;(0, eval)(scriptText)
    if (window.FLUX_ENV_CONFIG) return
  } catch (error) {
    setRuntimeError(`No se pudo cargar runtime config JS: ${error.message}`)
  }
})()

const FLUX_FALLBACK_CONFIG = Object.freeze({
  env: "local",
  source: "missing-runtime-config",
  supabaseUrl: "",
  supabaseAnonKey: "",
})

const FLUX_PRODUCTION_HOSTS = new Set(["catalogo-proveedores-flux.vercel.app", "flux.quantta.mx"])
const FLUX_RUNTIME_CONFIG = window.FLUX_ENV_CONFIG || {}

function readFluxConfigValue(...keys) {
  for (const key of keys) {
    const value = FLUX_RUNTIME_CONFIG[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return ""
}

function isFluxProductionHost() {
  return FLUX_PRODUCTION_HOSTS.has(window.location.hostname)
}

function cleanupLegacySupabaseStorage() {
  if (!isFluxProductionHost() || typeof window.localStorage === "undefined") return
  const legacyRefs = [["scsirgbuq", "jcwoaxfacth"].join("")]
  try {
    Object.keys(window.localStorage)
      .filter((key) => legacyRefs.some((ref) => key.includes(ref)))
      .forEach((key) => window.localStorage.removeItem(key))
  } catch (_) {
    // Storage puede estar bloqueado por el navegador.
  }
}

const FLUX_RUNTIME_SUPABASE_URL = readFluxConfigValue("supabaseUrl", "SUPABASE_URL", "FLUX_SUPABASE_URL")
const FLUX_RUNTIME_SUPABASE_ANON_KEY = readFluxConfigValue("supabaseAnonKey", "SUPABASE_ANON_KEY", "FLUX_SUPABASE_ANON_KEY")
const FLUX_ENV = readFluxConfigValue("env", "FLUX_ENV") || FLUX_FALLBACK_CONFIG.env
const FLUX_CONFIG_SOURCE = readFluxConfigValue("source") || (window.FLUX_ENV_CONFIG ? "runtime" : FLUX_FALLBACK_CONFIG.source)
const FLUX_CONFIG_BLOCKED = !FLUX_RUNTIME_SUPABASE_URL || !FLUX_RUNTIME_SUPABASE_ANON_KEY
const SUPABASE_URL = FLUX_CONFIG_BLOCKED ? "" : FLUX_RUNTIME_SUPABASE_URL
const SUPABASE_ANON_KEY = FLUX_CONFIG_BLOCKED ? "" : FLUX_RUNTIME_SUPABASE_ANON_KEY

window.SUPABASE_URL = SUPABASE_URL
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY
window.FLUX_CONFIG = Object.freeze({
  env: FLUX_ENV,
  source: FLUX_CONFIG_SOURCE,
  supabaseUrl: SUPABASE_URL,
  hasSupabaseAnonKey: Boolean(SUPABASE_ANON_KEY),
  usingFallback: false,
  blocked: FLUX_CONFIG_BLOCKED,
})

cleanupLegacySupabaseStorage()

function renderFluxRuntimeConfigError() {
  const message = window.FLUX_ENV_CONFIG_ERROR?.message || "No se pudo cargar la configuracion de ambiente. No se conectara a Supabase."
  console.error("[Flux] Runtime config bloqueado", { env: FLUX_ENV, source: FLUX_CONFIG_SOURCE, message })
  const render = () => {
    if (document.getElementById("fluxRuntimeConfigError")) return
    const box = document.createElement("div")
    box.id = "fluxRuntimeConfigError"
    box.style.cssText = "position:fixed;z-index:99999;left:16px;right:16px;bottom:16px;padding:14px 16px;border:1px solid rgba(244,63,94,.45);border-radius:12px;background:#24111b;color:#fecdd3;font-family:system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.35)"
    box.textContent = message
    document.body?.appendChild(box)
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true })
  else render()
}

function installFluxSupabaseClientFactory() {
  if (!window.supabase?.createClient || window.supabase.__fluxClientFactoryInstalled) return

  const originalCreateClient = window.supabase.createClient.bind(window.supabase)

  window.getFluxSupabaseClient = function getFluxSupabaseClient() {
    if (window.__FLUX_SUPABASE_CLIENT) return window.__FLUX_SUPABASE_CLIENT
    if (window.FLUX_CONFIG?.blocked || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
      renderFluxRuntimeConfigError()
      return null
    }
    window.__FLUX_SUPABASE_CLIENT = originalCreateClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    window.supabaseClient = window.__FLUX_SUPABASE_CLIENT
    return window.__FLUX_SUPABASE_CLIENT
  }

  window.supabase.createClient = function createFluxSupabaseClient(url, anonKey, options) {
    const requestedUrl = String(url || "")
    const legacyDevRef = ["scsirgbuq", "jcwoaxfacth"].join("")
    if (isFluxProductionHost() && requestedUrl.includes(legacyDevRef)) {
      renderFluxRuntimeConfigError()
      return window.getFluxSupabaseClient()
    }
    if (!requestedUrl || requestedUrl === SUPABASE_URL || requestedUrl.includes(".supabase.co")) {
      return window.getFluxSupabaseClient()
    }
    return originalCreateClient(url, anonKey, options)
  }
  window.supabase.__fluxClientFactoryInstalled = true
}

installFluxSupabaseClientFactory()

try {
  const supabaseHost = new URL(SUPABASE_URL).host
  console.info("[Flux] Config", {
    env: window.FLUX_CONFIG.env,
    source: window.FLUX_CONFIG.source,
    supabaseHost,
    usingFallback: window.FLUX_CONFIG.usingFallback,
  })
} catch (_) {
  console.info("[Flux] Config", {
    env: window.FLUX_CONFIG.env,
    source: window.FLUX_CONFIG.source,
    usingFallback: window.FLUX_CONFIG.usingFallback,
  })
}

;(function prepareFluxShell() {
  const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase()
  const urlParams = new URLSearchParams(window.location.search)

  const ROLE_GROUPS = {
    SYSADMIN: "sysadmin",
    ADMIN: "admin_finance",
    DIRECTION: "direction",
    OPERATION: "operation",
    PENDING: "pending",
  }

  const SYSADMIN_ROLES = ["sysadmin", "system_admin", "admin", "superadmin"]
  const ADMIN_ROLES = ["finance", "finanzas", "treasury", "tesoreria", "administracion"]
  const DIRECTION_ROLES = ["approver_2", "aprobador_2", "direccion", "director"]
  const OPERATION_ROLES = ["solicitante", "operator", "default", "seller", "celebraciones", "producciones", "planner"]

  const modules = [
    { key: "requests", section: "Operacion", file: "solicitudes.html", href: "./solicitudes.html", icon: "S", label: "Solicitudes de pago", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION, ROLE_GROUPS.OPERATION] },
    { key: "layouts", section: "Operacion", file: "layouts.html", href: "./layouts.html", icon: "L", label: "Layouts de pago", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "cash", section: "Operacion", file: "efectivo.html", href: "./efectivo.html", icon: "E", label: "Efectivo y comprobaciones", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "payments", section: "Operacion", file: "pagos_comprobaciones.html", href: "./pagos_comprobaciones.html", icon: "$", label: "Pagos y comprobaciones", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION], hidden: true },
    { key: "income", section: "Operacion", file: "ingresos.html", href: "./ingresos.html?tab=income", icon: "I", label: "Ingresos", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "incidents", section: "Operacion", file: "ingresos.html", href: "./ingresos.html?tab=incidents", icon: "V", label: "Incidencias", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "providers", section: "Operacion", file: "proveedores.html", href: "./proveedores.html", icon: "P", label: "Proveedores", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "dashboard", section: "General", file: "dashboard.html", href: "./dashboard.html", icon: "D", label: "Dashboard operativo", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "approvals", section: "General", file: "aprobaciones.html", href: "./aprobaciones.html", icon: "A", label: "Cola de aprobacion", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "approval-batches", section: "General", file: "approval_batches.html", href: "./approval_batches.html", icon: "C", label: "Cortes semanales", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "config", section: "Configuracion", file: "configuracion.html", href: "./configuracion.html", icon: "C", label: "Configuracion", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
  ]

  const navSections = ["Operacion", "General", "Configuracion"]
  const ROLE_CACHE_KEY = "flux-role-state-v1"
  const NAV_HTML_CACHE_KEY = "flux-nav-html-v1"
  const NAV_RENDER_VERSION = "20260624-menu-render-stability"

  const roleState = {
    loaded: false,
    session: null,
    profile: null,
    roles: [],
    group: ROLE_GROUPS.OPERATION,
  }

  let rolePromise = null
  installShellReadyStyles()

  window.FluxAuth = {
    ready: () => resolveRoleAccess(),
    state: roleState,
    getRoles: () => roleState.roles.slice(),
    getProfile: () => roleState.profile,
    getGroup: () => roleState.group,
    hasRole: (roles) => {
      const list = Array.isArray(roles) ? roles : [roles]
      return list.some((role) => roleState.roles.includes(normalizeRole(role)))
    },
    isAdminFinance: () => [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN].includes(roleState.group),
    canApprove: () => [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION].includes(roleState.group),
    canManageProviders: () => [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION].includes(roleState.group),
    canCreateProviders: () => [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION, ROLE_GROUPS.OPERATION].includes(roleState.group),
    canAccessConfigTab: (tab) => canAccessConfigTab(tab),
    isPending: () => roleState.group === ROLE_GROUPS.PENDING,
    isSysadmin: () => roleState.group === ROLE_GROUPS.SYSADMIN,
    defaultRedirect: () => defaultLandingForRole(),
  }

  function navigationHtmlFor(items, activeKey) {
    return navSections
      .map((section) => {
        const sectionItems = items.filter((item) => item.section === section)
        if (!sectionItems.length) return ""
        return `
          <div class="nav-section">
            <div class="nav-section-title">${section}</div>
            ${sectionItems.map((item) => {
              const isActive = activeKey === item.key
              return `<a href="${item.href}" data-flux-nav-key="${item.key}" class="nav-link ${isActive ? "active" : "muted"}"><span>${item.icon}</span> ${item.label}</a>`
            }).join("")}
          </div>
        `
      })
      .join("")
  }

  function normalizeNavHtml(html) {
    return String(html || "")
      .replace(/>\s+</g, "><")
      .replace(/\s{2,}/g, " ")
      .trim()
  }

  function deriveKeyFromHref(href) {
    const cleanHref = String(href || "").replace(/^\.\//, "")
    if (cleanHref === "configuracion.html" || cleanHref === "socios.html") return "config"
    if (cleanHref === "ingresos.html?tab=incidents") return "incidents"
    if (cleanHref.startsWith("ingresos.html")) return "income"
    const match = modules.find((item) => item.href.replace(/^\.\//, "") === cleanHref || item.file === cleanHref)
    return match?.key || ""
  }

  function navHtmlWithActiveState(html, activeKey) {
    const wrapper = document.createElement("div")
    wrapper.innerHTML = html || ""
    wrapper.querySelectorAll(".nav-link").forEach((link) => {
      const key = link.dataset.fluxNavKey || deriveKeyFromHref(link.getAttribute("href"))
      if (key && !link.dataset.fluxNavKey) link.dataset.fluxNavKey = key
      link.classList.toggle("active", key === activeKey)
      link.classList.toggle("muted", key !== activeKey)
    })
    return wrapper.innerHTML
  }

  function navSignatureForItems(items, activeKey) {
    return `${NAV_RENDER_VERSION}:${activeKey}:${items.map((item) => item.key).join("|")}`
  }

  function navSignatureForHtml(html, activeKey) {
    const wrapper = document.createElement("div")
    wrapper.innerHTML = html || ""
    const keys = Array.from(wrapper.querySelectorAll(".nav-link"))
      .map((link) => link.dataset.fluxNavKey || deriveKeyFromHref(link.getAttribute("href")))
      .filter(Boolean)
    return `${NAV_RENDER_VERSION}:${activeKey}:${keys.join("|")}`
  }

  function fallbackFirstPaintModules() {
    return modules.filter((item) => !item.hidden)
  }

  function firstPaintModules() {
    if (roleState.loaded) return modulesForCurrentRole().filter((item) => !item.hidden)
    return fallbackFirstPaintModules()
  }

  function readCachedNavHtml() {
    try {
      return sessionStorage.getItem(NAV_HTML_CACHE_KEY) || ""
    } catch (_) {
      return ""
    }
  }

  function persistNavHtml(html) {
    try {
      if (html && html.trim()) sessionStorage.setItem(NAV_HTML_CACHE_KEY, html)
    } catch (_) {}
  }

  function renderNavigationHtml(nav, html, mode, signature = "") {
    if (!html.trim()) return false
    if (signature && nav.dataset.fluxNavSignature !== signature && normalizeNavHtml(nav.innerHTML) !== normalizeNavHtml(html)) {
      nav.innerHTML = html
    } else if (!signature && normalizeNavHtml(nav.innerHTML) !== normalizeNavHtml(html)) {
      nav.innerHTML = html
    }
    nav.dataset.fluxNavMode = mode
    if (signature) nav.dataset.fluxNavSignature = signature
    nav.setAttribute("aria-busy", mode === "role" || mode === "cache" ? "false" : "true")
    if (mode === "role") persistNavHtml(html)
    return true
  }

  function renderNavigation(nav, items, mode) {
    const activeKey = currentModuleKey()
    return renderNavigationHtml(nav, navigationHtmlFor(items, activeKey), mode, navSignatureForItems(items, activeKey))
  }

  function ensureFirstPaintNavigation() {
    const nav = document.querySelector(".nav")
    if (!nav) return
    if (nav.dataset.fluxNavMode === "role" && nav.innerHTML.trim()) return
    const cachedHtml = !roleState.loaded ? readCachedNavHtml() : ""
    if (cachedHtml.trim()) {
      const activeKey = currentModuleKey()
      const html = navHtmlWithActiveState(cachedHtml, activeKey)
      if (renderNavigationHtml(nav, html, "cache", navSignatureForHtml(html, activeKey))) {
        markShellReady()
        return
      }
    }
    if (renderNavigation(nav, firstPaintModules(), roleState.loaded ? "role" : "base")) {
      markShellReady()
      return
    }
  }

  function applyDemoNavigation() {
    const nav = document.querySelector(".nav")
    if (!nav) return
    if (!roleState.loaded) {
      ensureFirstPaintNavigation()
      return
    }

    const visibleModules = modulesForCurrentRole().filter((item) => !item.hidden)
    if (!visibleModules.length) {
      ensureFirstPaintNavigation()
      return
    }

    renderNavigation(nav, visibleModules, "role")
    markShellReady()
  }

  function applyIncomeCompatibility() {
    if (pageName !== "ingresos.html") return
    if (!window.supabase?.createClient || window.supabase.__fluxIncomeCompatibility) return

    const originalCreateClient = window.supabase.createClient.bind(window.supabase)
    window.supabase.createClient = (...args) => {
      const client = originalCreateClient(...args)
      const originalFrom = client.from.bind(client)

      client.from = (tableName) => {
        const builder = originalFrom(tableName)
        if (tableName === "cost_centers" && builder?.select) {
          const originalSelect = builder.select.bind(builder)
          builder.select = (columns, options) => {
            const safeColumns = typeof columns === "string"
              ? columns
                  .split(",")
                  .map((column) => column.trim())
                  .filter((column) => column && column !== "company_id")
                  .join(",")
              : columns

            return originalSelect(safeColumns, options)
          }
        }
        return builder
      }

      return client
    }

    window.supabase.__fluxIncomeCompatibility = true
  }

  // Cache de roles en sessionStorage: permite pintar el menu al instante en
  // cada navegacion (es MPA) sin esperar a sesion+perfil+roles de Supabase.
  // Solo guarda perfil/roles/grupo; NUNCA tokens de sesion. Siempre se
  // revalida en segundo plano via resolveRoleAccess().
  function hydrateRoleStateFromCache() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(ROLE_CACHE_KEY) || "null")
      if (!cached || !cached.group) return false
      roleState.profile = cached.profile || null
      roleState.roles = Array.isArray(cached.roles) ? cached.roles : []
      roleState.group = cached.group
      roleState.loaded = true
      return true
    } catch (_) { return false }
  }

  function persistRoleStateCache() {
    try {
      sessionStorage.setItem(ROLE_CACHE_KEY, JSON.stringify({
        profile: roleState.profile,
        roles: roleState.roles,
        group: roleState.group,
      }))
    } catch (_) {}
  }

  function clearRoleStateCache() {
    try { sessionStorage.removeItem(ROLE_CACHE_KEY) } catch (_) {}
    try { sessionStorage.removeItem(NAV_HTML_CACHE_KEY) } catch (_) {}
  }

  function applyShell() {
    applyIncomeCompatibility()
    hydrateRoleStateFromCache()
    ensureFirstPaintNavigation()
    hideLegacyNavigation()
    // Pinta el menu desde cache ANTES de loadFluxExtensions(): esa funcion usa
    // XHR sincronos (bloqueantes) por cada extension, lo que retrasaba la
    // aparicion del menu y causaba el parpadeo en cada cambio de seccion.
    if (roleState.loaded) applyDemoNavigation()
    loadFluxExtensions()
    resolveRoleAccess().then(() => {
      applyDemoNavigation()
      applyPostLoginRedirect()
      enforcePageVisibility()
      markShellReady()
      document.dispatchEvent(new CustomEvent("flux:roles-ready", { detail: roleState }))
    })
  }

  function resolveRoleAccess() {
    if (rolePromise) return rolePromise
    rolePromise = loadRoleState()
    return rolePromise
  }

  async function loadRoleState() {
    if (!window.supabase?.createClient) {
      roleState.loaded = true
      return roleState
    }

    try {
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      const { data: { session } } = await client.auth.getSession()
      roleState.session = session || null

      if (!session?.user) {
        // Sin sesion: limpiar todo (incluido el cache) para no mostrar menu
        // con un grupo viejo hidratado.
        roleState.profile = null
        roleState.roles = []
        roleState.group = ROLE_GROUPS.OPERATION
        clearRoleStateCache()
        roleState.loaded = true
        return roleState
      }

      roleState.profile = await resolveProfile(client, session)
      roleState.roles = await resolveRoles(client, roleState.profile)
      roleState.group = groupFromRoles(roleState.roles)
      persistRoleStateCache()
    } catch (_) {
      roleState.roles = []
      roleState.group = ROLE_GROUPS.OPERATION
    }

    roleState.loaded = true
    return roleState
  }

  async function resolveProfile(client, session) {
    const lookups = [
      ["auth_user_id", session.user.id],
      ["email", session.user.email],
    ].filter(([, value]) => value)

    for (const [column, value] of lookups) {
      const { data } = await client
        .from("profiles")
        .select("id,email,full_name,auth_user_id,active")
        .eq(column, value)
        .maybeSingle()
      if (data?.id) return data
    }

    // Usuario nuevo de Google OAuth - crear perfil pendiente de aprobacion
    const email = session.user.email || ""
    const full_name = session.user.user_metadata?.full_name || session.user.user_metadata?.name || email.split("@")[0]
    const { data: newProfile } = await client
      .from("profiles")
      .insert({ email, full_name, auth_user_id: session.user.id, active: true })
      .select("id,email,full_name,auth_user_id,active")
      .single()
    return newProfile || null
  }

  async function resolveRoles(client, profile) {
    if (!profile?.id) return []
    const { data, error } = await client
      .from("user_roles")
      .select("role_id, roles(id,name,description)")
      .eq("profile_id", profile.id)

    if (error) return []

    return (data || [])
      .map((row) => normalizeRole(row.roles?.name || row.name || ""))
      .filter(Boolean)
  }

  function groupFromRoles(roles) {
    const cleanRoles = roles.map(normalizeRole)
    if (cleanRoles.some((role) => SYSADMIN_ROLES.includes(role))) return ROLE_GROUPS.SYSADMIN
    if (cleanRoles.some((role) => ADMIN_ROLES.includes(role))) return ROLE_GROUPS.ADMIN
    if (cleanRoles.some((role) => DIRECTION_ROLES.includes(role))) return ROLE_GROUPS.DIRECTION
    if (cleanRoles.some((role) => OPERATION_ROLES.includes(role))) return ROLE_GROUPS.OPERATION
    return ROLE_GROUPS.PENDING
  }

  function modulesForCurrentRole() {
    if (!roleState.loaded) return []
    const group = roleState.group
    return modules.filter((item) => item.groups.includes(group))
  }

  function currentModuleKey() {
    if (pageName === "configuracion.html") return "config"
    if (pageName === "socios.html") return "config"
    if (pageName === "proveedores.html" && urlParams.get("tab") === "cuentas-origen") return "config"
    if (pageName === "ingresos.html" && urlParams.get("tab") === "incidents") return "incidents"
    if (pageName === "ingresos.html") return "income"
    const match = modules.find((item) => item.file === pageName)
    return match?.key || "requests"
  }

  function applyPostLoginRedirect() {
    if (urlParams.get("post_login") !== "1") return
    const target = defaultLandingForRole()
    if (pageName !== target) {
      window.location.replace(`./${target}`)
      return
    }
    urlParams.delete("post_login")
    const cleanUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams}` : ""}`
    window.history.replaceState({}, "", cleanUrl)
  }

  function defaultLandingForRole() {
    if (roleState.group === ROLE_GROUPS.PENDING) return "pending.html"
    const first = modules.find((m) => !m.hidden && m.groups.includes(roleState.group))
    return first ? first.file : "solicitudes.html"
  }

  function enforcePageVisibility() {
    if (pageName === "index.html" || pageName === "" || pageName === "pending.html") return
    if (!roleState.session) return
    if (roleState.group === ROLE_GROUPS.PENDING) {
      window.location.replace("./pending.html")
      return
    }
    if (isCurrentPageAllowed()) return
    if (pageName !== "solicitudes.html") window.location.replace("./solicitudes.html")
  }

  function isCurrentPageAllowed() {
    if (pageName === "socios.html") return canAccessConfigTab("members")
    if (pageName === "proveedores.html" && urlParams.get("tab") === "cuentas-origen") return canAccessConfigTab("originAccounts")
    const activeKey = currentModuleKey()
    return modulesForCurrentRole().some((item) => item.key === activeKey)
  }

  function canAccessConfigTab(tab) {
    const group = roleState.group
    const tabGroups = {
      members: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.DIRECTION],
      originAccounts: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION],
      budgets: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION],
      system: [ROLE_GROUPS.SYSADMIN],
    }
    return (tabGroups[tab] || []).includes(group)
  }

  function normalizeRole(value) {
    return String(value || "").trim().toLowerCase()
  }

  function markShellReady() {
    document.documentElement?.classList.add("flux-shell-ready")
    document.body?.classList.add("flux-shell-ready")
  }

  function hideLegacyNavigation() {
    const nav = document.querySelector(".nav")
    if (!nav || roleState.loaded) return
    ensureFirstPaintNavigation()
    nav.setAttribute("aria-busy", "true")
  }

  function installShellReadyStyles() {
    if (document.getElementById("fluxShellReadyStyles")) return
    const style = document.createElement("style")
    style.id = "fluxShellReadyStyles"
    style.textContent = `
       .sidebar .nav:empty{visibility:visible!important;opacity:1!important;pointer-events:none!important;display:block!important;position:relative;min-height:430px;overflow:hidden}
       .sidebar .nav:empty::before{content:"";display:block;width:100%;height:430px;border-radius:10px;opacity:.9;background:
        linear-gradient(90deg,rgba(148,163,184,.18),rgba(148,163,184,.28)) 10px 10px/82px 9px no-repeat,
        linear-gradient(90deg,rgba(20,184,166,.16),rgba(20,184,166,.08)) 0 32px/100% 40px no-repeat,
        linear-gradient(90deg,rgba(20,184,166,.5),rgba(20,184,166,.18)) 0 32px/3px 40px no-repeat,
        linear-gradient(90deg,rgba(148,163,184,.22),rgba(148,163,184,.34)) 22px 45px/155px 12px no-repeat,
        linear-gradient(90deg,rgba(148,163,184,.14),rgba(148,163,184,.24)) 22px 91px/175px 12px no-repeat,
        linear-gradient(90deg,rgba(148,163,184,.14),rgba(148,163,184,.24)) 22px 137px/150px 12px no-repeat,
        linear-gradient(90deg,rgba(148,163,184,.14),rgba(148,163,184,.24)) 22px 183px/165px 12px no-repeat,
        linear-gradient(90deg,rgba(148,163,184,.18),rgba(148,163,184,.28)) 10px 236px/62px 9px no-repeat,
        linear-gradient(90deg,rgba(148,163,184,.14),rgba(148,163,184,.24)) 22px 271px/145px 12px no-repeat,
        linear-gradient(90deg,rgba(148,163,184,.14),rgba(148,163,184,.24)) 22px 317px/170px 12px no-repeat,
        linear-gradient(90deg,rgba(148,163,184,.18),rgba(148,163,184,.28)) 10px 370px/96px 9px no-repeat,
        linear-gradient(90deg,rgba(148,163,184,.14),rgba(148,163,184,.24)) 22px 405px/130px 12px no-repeat;animation:fluxShellSkeletonPulse 1.35s ease-in-out infinite}
       .sidebar .nav:empty::after{content:"";position:absolute;inset:0;transform:translateX(-65%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent);animation:fluxShellSkeletonSweep 1.4s ease-in-out infinite}
      body.flux-shell-ready .sidebar .nav{visibility:visible;opacity:1;pointer-events:auto;transition:opacity 120ms ease}
      body.flux-shell-ready .sidebar .nav::before,
      body.flux-shell-ready .sidebar .nav::after{content:none;display:none}
      .sidebar .nav-section{display:flex;flex-direction:column;gap:1px;margin-bottom:14px}
      .sidebar .nav-section-title{padding:9px 10px 4px;font-size:10px;font-weight:800;letter-spacing:.75px;text-transform:uppercase;color:var(--text-3, #666680)}
      @keyframes fluxShellSkeletonPulse{0%,100%{opacity:.72}50%{opacity:1}}
      @keyframes fluxShellSkeletonSweep{0%{transform:translateX(-80%)}100%{transform:translateX(80%)}}
    `
    document.head.appendChild(style)
  }

  const loadedExtensions = new Set()

  function loadExtension(src, key) {
    if (loadedExtensions.has(key)) return
    if (document.querySelector(`script[data-flux-extension="${key}"]`)) return
    loadedExtensions.add(key)

    try {
      const request = new XMLHttpRequest()
      request.open("GET", src, false)
      request.send(null)
      if (request.status >= 200 && request.status < 300 && request.responseText) {
        ;(0, eval)(request.responseText)
        return
      }
    } catch (_) {
      loadedExtensions.delete(key)
    }

    const script = document.createElement("script")
    script.src = src
    script.dataset.fluxExtension = key
    document.body.appendChild(script)
  }

  function loadFluxExtensions() {
    const enabledPages = ["solicitudes.html", "efectivo.html", "layouts.html", "ingresos.html", "dashboard.html"]
    if (!enabledPages.includes(pageName)) return

    if (["efectivo.html", "layouts.html"].includes(pageName)) {
      loadExtension("./cash_flow_extension.js?v=20260603-cash-ux", "cash-flow")
    }
    if (pageName === "solicitudes.html") {
      loadExtension("./solicitudes_cash_detail_patch.js?v=20260603-cash-detail", "solicitudes-cash-detail")
      loadExtension("./solicitudes_ux1_extension.js?v=20260701-reconcile", "solicitudes-ux1")
      loadExtension("./solicitudes_workboard_extension.js?v=20260604-table6col2", "solicitudes-workboard")
      loadExtension("./solicitudes_incident_copy_guard.js?v=20260604-menu-incidents", "solicitudes-incident-copy-guard")
    }
    if (pageName === "layouts.html") {
      loadExtension("./layouts_result_extension.js?v=20260602-ux1", "layouts-result")
      loadExtension("./layouts_ux2_extension.js?v=20260602-ux2", "layouts-ux2")
    }
    if (pageName === "efectivo.html") {
      loadExtension("./efectivo_ux2_extension.js?v=20260602-ux2", "efectivo-ux2")
    }
    if (pageName === "ingresos.html") {
      loadExtension("./ingresos_nav_patch.js?v=20260604-menu-incidents", "ingresos-nav")
      loadExtension("./ingresos_ux_extension.js?v=20260602-ux1", "ingresos-ux")
      loadExtension("./ingresos_ux2_extension.js?v=20260610-unified-tabs", "ingresos-ux2")
      loadExtension("./ingresos_carlos_ux_patch_v2.js?v=20260610-unified-tabs", "ingresos-carlos-ux")
      loadExtension("./ingresos_incidents_guard_patch.js?v=20260610-no-flicker", "ingresos-incidents-guard")
    }
    if (pageName === "dashboard.html") {
      loadExtension("./dashboard_report_downloads_extension.js?v=20260602-ux1", "dashboard-report-downloads")
      loadExtension("./dashboard_demo_extension.js?v=20260602-ux1", "dashboard-demo")
    }
  }

  hydrateRoleStateFromCache()
  ensureFirstPaintNavigation()
  applyIncomeCompatibility()
  loadFluxExtensions()

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyShell)
  } else {
    applyShell()
  }
})()
