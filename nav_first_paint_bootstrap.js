;(function bootstrapFluxFirstPaintNav() {
  // Hygiene global, deliberadamente pequeña y aditiva.
  // 1) Los controles nativos siguen el tema Flux.
  // 2) Se retiran únicamente avatares estáticos "FL" sin identidad real.
  const hygieneStyleId = "flux-ui-hygiene-native-theme"
  if (!document.getElementById(hygieneStyleId)) {
    const style = document.createElement("style")
    style.id = hygieneStyleId
    style.textContent = '[data-theme="dark"]{color-scheme:dark}[data-theme="light"]{color-scheme:light}'
    document.head.appendChild(style)
  }

  function removeOrphanFluxAvatars() {
    document.querySelectorAll(".topbar-user > .avatar").forEach((avatar) => {
      const label = String(avatar.textContent || "").trim()
      if (label === "FL" && !avatar.dataset.profileAvatar) avatar.remove()
    })
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", removeOrphanFluxAvatars, { once: true })
  } else {
    removeOrphanFluxAvatars()
  }

  // Dashboard anual: el enlace, la URL directa y el copy se controlan aquí
  // para no reemplazar config.js con una versión anterior de las rebanadas.
  const annualParams = new URLSearchParams(window.location.search)
  const annualPage = (window.location.pathname.split("/").pop() || "").toLowerCase() === "dashboard.html"
    && annualParams.get("view") === "anual"

  function cachedFluxGroup() {
    try {
      return String(JSON.parse(sessionStorage.getItem("flux-role-state-v1") || "null")?.group || "")
    } catch (_) {
      return ""
    }
  }

  function syncAnnualDashboardNav(allowed) {
    const nav = document.querySelector(".sidebar .nav")
    if (!nav) return
    let link = nav.querySelector('[data-flux-nav-key="dashboard-anual"]')
    if (!allowed) {
      link?.remove()
      return
    }

    const generalSection = Array.from(nav.querySelectorAll(".nav-section")).find((section) =>
      String(section.querySelector(".nav-section-title")?.textContent || "").trim().toLowerCase() === "general"
    )
    if (!generalSection) return

    if (!link) {
      link = document.createElement("a")
      link.href = "./dashboard.html?view=anual"
      link.dataset.fluxNavKey = "dashboard-anual"
      link.className = "nav-link muted"
      link.innerHTML = "<span>H</span> Dashboard anual"
      const approvals = generalSection.querySelector('[data-flux-nav-key="approvals"]')
      if (approvals) generalSection.insertBefore(link, approvals)
      else generalSection.appendChild(link)
    }

    link.classList.toggle("active", annualPage)
    link.classList.toggle("muted", !annualPage)
    if (annualPage) {
      const operational = nav.querySelector('[data-flux-nav-key="dashboard"]')
      operational?.classList.remove("active")
      operational?.classList.add("muted")
    }
  }

  function applyAnnualDashboardCopy() {
    if (!annualPage) return
    document.title = "Dashboard anual | Flux Operadora"
    const title = document.querySelector(".page-header h1")
    const subtitle = document.querySelector(".page-header p")
    if (title && title.textContent !== "Dashboard anual") title.textContent = "Dashboard anual"
    const copy = "Ejercicios históricos por familia de cuenta contable: ingresos y egresos por año, mes y cuenta."
    if (subtitle && subtitle.textContent !== copy) subtitle.textContent = copy
  }

  function installAnnualDashboardGuard() {
    if (!annualPage || !window.FluxAuth?.ready || window.FluxAuth.__annualDashboardGuardInstalled) return
    const originalReady = window.FluxAuth.ready.bind(window.FluxAuth)
    window.FluxAuth.ready = async function guardedAnnualDashboardReady() {
      const result = await originalReady()
      if (!window.FluxAuth?.isSysadmin?.()) {
        window.location.replace("./dashboard.html")
        return new Promise(() => {})
      }
      syncAnnualDashboardNav(true)
      return result
    }
    window.FluxAuth.__annualDashboardGuardInstalled = true
  }

  syncAnnualDashboardNav(cachedFluxGroup() === "sysadmin")
  document.addEventListener("flux:roles-ready", () => {
    const allowed = window.FluxAuth?.isSysadmin?.() === true
    syncAnnualDashboardNav(allowed)
    if (annualPage && !allowed) window.location.replace("./dashboard.html")
  })

  const finishAnnualSetup = () => {
    installAnnualDashboardGuard()
    applyAnnualDashboardCopy()
    if (!annualPage || !document.body) return
    const observer = new MutationObserver(applyAnnualDashboardCopy)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    window.setTimeout(() => observer.disconnect(), 2500)
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", finishAnnualSetup, { once: true })
  } else {
    finishAnnualSetup()
  }

  // Rebanada 03: extensión aislada. No reemplaza configuracion.html ni
  // configuracion.js, por lo que preserva la gobernanza extraordinaria vigente.
  const contpaqRequestedAtLoad = new URLSearchParams(window.location.search).get("tab") === "contpaq"

  function loadContpaqMapperExtension() {
    const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
    if (pageName !== "configuracion.html") return
    if (document.querySelector('script[data-flux-extension="contpaq-mapper"]')) return
    const script = document.createElement("script")
    script.src = "./contpaq_mapper_extension.js?v=20260825-graph-nn"
    script.async = false
    script.dataset.fluxExtension = "contpaq-mapper"
    document.head.appendChild(script)
  }

  function installContpaqRequestedRouteBridge() {
    if (!contpaqRequestedAtLoad) return
    let activated = false
    let observer = null

    const activate = () => {
      if (activated || window.FluxAuth?.isAdminFinance?.() !== true) return false
      const tab = document.getElementById("contpaqMapperTab")
      if (!tab || tab.disabled || tab.hidden) return false
      activated = true
      observer?.disconnect()
      tab.click()
      return true
    }

    const watch = () => {
      if (activate() || observer || !document.documentElement) return
      observer = new MutationObserver(activate)
      observer.observe(document.documentElement, { childList: true, subtree: true })
      window.setTimeout(() => observer?.disconnect(), 5000)
    }

    document.addEventListener("flux:roles-ready", watch, { once: true })
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", watch, { once: true })
    } else {
      watch()
    }
  }

  function loadAnnualBudgetBucketPatch() {
    if (!annualPage) return
    if (document.querySelector('script[data-flux-extension="annual-budget-buckets"]')) return
    const script = document.createElement("script")
    script.src = "./dashboard_bucket_patch.js?v=20260825-graph-nn"
    script.async = false
    script.dataset.fluxExtension = "annual-budget-buckets"
    document.head.appendChild(script)
  }

  loadContpaqMapperExtension()
  loadAnnualBudgetBucketPatch()
  installContpaqRequestedRouteBridge()

  const nav = document.querySelector(".sidebar .nav")
  if (!nav || nav.dataset.fluxNavMode === "role") return
  if (nav.children.length) {
    nav.dataset.fluxNavMode = nav.dataset.fluxNavMode || "static"
    nav.setAttribute("aria-busy", "false")
    document.documentElement?.classList.add("flux-shell-ready")
    document.body?.classList.add("flux-shell-ready")
    return
  }

  const ROLE_CACHE_KEY = "flux-role-state-v1"
  const NAV_HTML_CACHE_KEY = "flux-nav-html-v1"
  const NAV_RENDER_VERSION = "20260804-receipt-batches"
  const ROLE_GROUPS = {
    SYSADMIN: "sysadmin",
    ADMIN: "admin_finance",
    DIRECTION: "direction",
    OPERATION: "operation",
    PENDING: "pending",
  }
  const modules = [
    { key: "requests", section: "Operacion", file: "solicitudes.html", href: "./solicitudes.html", icon: "S", label: "Solicitudes de pago", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION, ROLE_GROUPS.OPERATION] },
    { key: "layouts", section: "Operacion", file: "layouts.html", href: "./layouts.html", icon: "L", label: "Layouts de pago", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "receipt-batches", section: "Operacion", file: "comprobantes_batch.html", href: "./comprobantes_batch.html", icon: "B", label: "Comprobantes batch", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN], sensitive: true },
    { key: "cash", section: "Operacion", file: "efectivo.html", href: "./efectivo.html", icon: "E", label: "Efectivo y comprobaciones", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "payments", section: "Operacion", file: "pagos_comprobaciones.html", href: "./pagos_comprobaciones.html", icon: "$", label: "Pagos y comprobaciones", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION], hidden: true },
    { key: "income", section: "Operacion", file: "ingresos.html", href: "./ingresos.html?tab=income", icon: "I", label: "Ingresos", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "incidents", section: "Operacion", file: "ingresos.html", href: "./ingresos.html?tab=incidents", icon: "V", label: "Incidencias", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "providers", section: "Operacion", file: "proveedores.html", href: "./proveedores.html", icon: "P", label: "Proveedores", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "dashboard", section: "General", file: "dashboard.html", href: "./dashboard.html", icon: "D", label: "Dashboard operativo", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "dashboard-anual", section: "General", file: "dashboard.html", href: "./dashboard.html?view=anual", icon: "H", label: "Dashboard anual", groups: [ROLE_GROUPS.SYSADMIN] },
    { key: "approvals", section: "General", file: "aprobaciones.html", href: "./aprobaciones.html", icon: "A", label: "Cola de aprobacion", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
    { key: "config", section: "Configuracion", file: "configuracion.html", href: "./configuracion.html", icon: "C", label: "Configuracion", groups: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION] },
  ]
  const navSections = ["Operacion", "General", "Configuracion"]
  const pageName = (window.location.pathname.split("/").pop() || "dashboard.html").toLowerCase()
  const params = new URLSearchParams(window.location.search)

  function currentModuleKey() {
    if (pageName === "configuracion.html" || pageName === "socios.html") return "config"
    if (pageName === "proveedores.html" && params.get("tab") === "cuentas-origen") return "config"
    if (pageName === "dashboard.html" && params.get("view") === "anual") return "dashboard-anual"
    if (pageName === "ingresos.html" && params.get("tab") === "incidents") return "incidents"
    if (pageName === "ingresos.html") return "income"
    const match = modules.find((item) => item.file === pageName)
    return match?.key || "requests"
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

  function readJson(key) {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "null")
    } catch (_) {
      return null
    }
  }

  function deriveKeyFromHref(href) {
    const cleanHref = String(href || "").replace(/^\.\//, "")
    if (cleanHref === "configuracion.html" || cleanHref === "socios.html") return "config"
    if (cleanHref === "dashboard.html?view=anual") return "dashboard-anual"
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

  function modulesForCachedRole() {
    const cachedRole = readJson(ROLE_CACHE_KEY)
    const group = cachedRole?.group
    if (!group) return null
    return modules.filter((item) => !item.hidden && item.groups.includes(group))
  }

  function fallbackModules() {
    return modules.filter((item) => !item.hidden && !item.sensitive && item.key !== "dashboard-anual")
  }

  function readCachedNavHtml() {
    try {
      return sessionStorage.getItem(NAV_HTML_CACHE_KEY) || ""
    } catch (_) {
      return ""
    }
  }

  const activeKey = currentModuleKey()
  const cachedHtml = readCachedNavHtml()
  const fallbackItems = modulesForCachedRole() || fallbackModules()
  const html = cachedHtml.trim()
    ? navHtmlWithActiveState(cachedHtml, activeKey)
    : navigationHtmlFor(fallbackItems, activeKey)

  if (html.trim()) {
    nav.innerHTML = html
    nav.dataset.fluxNavMode = cachedHtml.trim() ? "cache" : "base"
    nav.dataset.fluxNavSignature = cachedHtml.trim()
      ? navSignatureForHtml(html, activeKey)
      : navSignatureForItems(fallbackItems, activeKey)
    nav.setAttribute("aria-busy", cachedHtml.trim() ? "false" : "true")
    document.documentElement?.classList.add("flux-shell-ready")
    document.body?.classList.add("flux-shell-ready")
  }
})()
