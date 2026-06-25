;(function bootstrapFluxFirstPaintNav() {
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
  const NAV_RENDER_VERSION = "20260624-menu-render-stability"
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
  const pageName = (window.location.pathname.split("/").pop() || "dashboard.html").toLowerCase()
  const params = new URLSearchParams(window.location.search)

  function currentModuleKey() {
    if (pageName === "configuracion.html" || pageName === "socios.html") return "config"
    if (pageName === "proveedores.html" && params.get("tab") === "cuentas-origen") return "config"
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
    return modules.filter((item) => !item.hidden)
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
