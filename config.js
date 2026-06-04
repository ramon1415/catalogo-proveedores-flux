// Configuracion Supabase
// No uses la secret key en frontend.
const SUPABASE_URL = "https://scsirgbuqjcwoaxfacth.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_JNDHMoacW6ySHEtmI1Rgdw_zVZElQL2"

;(function prepareFluxShell() {
  const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase()
  const urlParams = new URLSearchParams(window.location.search)

  const ROLE_GROUPS = {
    SYSADMIN: "sysadmin",
    ADMIN: "admin_finance",
    DIRECTION: "direction",
    OPERATION: "operation",
  }

  const SYSADMIN_ROLES = ["sysadmin", "system_admin", "admin"]
  const ADMIN_ROLES = ["finance", "finanzas", "treasury", "tesoreria"]
  const DIRECTION_ROLES = ["approver_2", "aprobador_2", "direccion", "director"]
  const OPERATION_ROLES = ["solicitante", "operator", "default"]

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
    { key: "config", section: "Configuracion", file: "configuracion.html", href: "./configuracion.html", icon: "C", label: "Configuracion", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
  ]

  const navSections = ["Operacion", "General", "Configuracion"]

  const subtitles = {
    dashboard: "Dashboard operativo",
    providers: "Proveedores",
    requests: "Solicitudes de pago",
    approvals: "Cola de aprobacion",
    layouts: "Layouts de pago",
    payments: "Pagos y comprobaciones",
    cash: "Efectivo y comprobaciones",
    income: "Ingresos",
    incidents: "Incidencias",
    config: "Configuracion",
  }

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
    canAccessConfigTab: (tab) => canAccessConfigTab(tab),
  }

  function applyLoginCopy() {
    if (pageName !== "index.html" && pageName !== "") return

    document.title = "Acceso | Flux Operadora"

    const logo = document.querySelector(".login-card .logo")
    const title = document.querySelector(".login-card h1")
    const description = document.querySelector(".login-card p:not(.note)")
    const note = document.querySelector(".login-card .note")

    if (logo) logo.textContent = "FL"
    if (title) title.textContent = "Flux Operadora"
    if (description) {
      description.textContent = "Centraliza proveedores, presupuesto, solicitudes de pago, layouts y seguimiento financiero en un solo sistema."
    }
    if (note) note.textContent = "Acceso protegido con Supabase Auth."
  }

  function applyDemoNavigation() {
    const nav = document.querySelector(".nav")
    if (!nav) return
    if (!roleState.loaded) {
      nav.innerHTML = ""
      nav.setAttribute("aria-busy", "true")
      return
    }

    const visibleModules = modulesForCurrentRole().filter((item) => !item.hidden)
    const activeKey = currentModuleKey()

    nav.innerHTML = navSections
      .map((section) => {
        const items = visibleModules.filter((item) => item.section === section)
        if (!items.length) return ""
        return `
          <div class="nav-section">
            <div class="nav-section-title">${section}</div>
            ${items.map((item) => {
              const isActive = activeKey === item.key
              return `<a href="${item.href}" class="nav-link ${isActive ? "active" : "muted"}"><span>${item.icon}</span> ${item.label}</a>`
            }).join("")}
          </div>
        `
      })
      .join("")
    nav.setAttribute("aria-busy", "false")
    markShellReady()
  }

  function applyBranding() {
    const logo = document.querySelector(".brand-logo, .brand-badge")
    const title = document.querySelector(".brand-title")
    const subtitle = document.querySelector(".brand-subtitle")
    const activeKey = currentModuleKey()

    if (logo) logo.textContent = "FL"
    if (title) title.textContent = "Flux Operadora"
    if (subtitle && subtitles[activeKey]) subtitle.textContent = subtitles[activeKey]
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

  function applyShell() {
    applyLoginCopy()
    applyBranding()
    applyIncomeCompatibility()
    hideLegacyNavigation()
    loadFluxExtensions()
    resolveRoleAccess().then(() => {
      applyDemoNavigation()
      applyBranding()
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
        roleState.loaded = true
        return roleState
      }

      roleState.profile = await resolveProfile(client, session)
      roleState.roles = await resolveRoles(client, roleState.profile)
      roleState.group = groupFromRoles(roleState.roles)
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

    return null
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
    return ROLE_GROUPS.OPERATION
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
    if ([ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION].includes(roleState.group)) return "dashboard.html"
    return "solicitudes.html"
  }

  function enforcePageVisibility() {
    if (pageName === "index.html" || pageName === "") return
    if (!roleState.session) return
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
    nav.innerHTML = ""
    nav.setAttribute("aria-busy", "true")
  }

  function installShellReadyStyles() {
    if (document.getElementById("fluxShellReadyStyles")) return
    const style = document.createElement("style")
    style.id = "fluxShellReadyStyles"
    style.textContent = `
      html:not(.flux-shell-ready) body:not(.flux-shell-ready) .sidebar .nav,
      body:not(.flux-shell-ready) .sidebar .nav{visibility:hidden!important;opacity:0!important;pointer-events:none!important}
      body.flux-shell-ready .sidebar .nav{visibility:visible;opacity:1;pointer-events:auto;transition:opacity 120ms ease}
      .sidebar .nav-section{display:flex;flex-direction:column;gap:1px;margin-bottom:14px}
      .sidebar .nav-section-title{padding:9px 10px 4px;font-size:10px;font-weight:800;letter-spacing:.75px;text-transform:uppercase;color:var(--text-3, #666680)}
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
      loadExtension("./solicitudes_ux1_extension.js?v=20260602-ux1-provider-live-visits", "solicitudes-ux1")
      loadExtension("./solicitudes_workboard_extension.js?v=20260602-ux1", "solicitudes-workboard")
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
      loadExtension("./ingresos_ux2_extension.js?v=20260604-menu-incidents", "ingresos-ux2")
      loadExtension("./ingresos_carlos_ux_patch_v2.js?v=20260604-menu-incidents", "ingresos-carlos-ux")
      loadExtension("./ingresos_incidents_guard_patch.js?v=20260604-menu-incidents", "ingresos-incidents-guard")
    }
    if (pageName === "dashboard.html") {
      loadExtension("./dashboard_report_downloads_extension.js?v=20260602-ux1", "dashboard-report-downloads")
      loadExtension("./dashboard_demo_extension.js?v=20260602-ux1", "dashboard-demo")
    }
  }

  applyIncomeCompatibility()
  loadFluxExtensions()

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyShell)
  } else {
    applyShell()
  }
})()
