;(function bootstrapFluxFirstPaintNav() {
  const nav = document.querySelector(".sidebar .nav")
  if (!nav || nav.dataset.fluxNavMode === "role") return

  const path = (window.location.pathname.split("/").pop() || "dashboard.html").toLowerCase()
  const params = new URLSearchParams(window.location.search)
  const items = [
    { key: "dashboard", section: "General", href: "./dashboard.html", icon: "D", label: "Dashboard operativo" },
    { key: "requests", section: "Operacion", href: "./solicitudes.html", icon: "S", label: "Solicitudes de pago" },
    { key: "providers", section: "Operacion", href: "./proveedores.html", icon: "P", label: "Proveedores" },
    { key: "approvals", section: "General", href: "./aprobaciones.html", icon: "A", label: "Aprobaciones" },
    { key: "layouts", section: "Operacion", href: "./layouts.html", icon: "L", label: "Layouts de pago" },
    { key: "cash", section: "Operacion", href: "./efectivo.html", icon: "E", label: "Efectivo y comprobaciones" },
    { key: "income", section: "Operacion", href: "./ingresos.html?tab=income", icon: "I", label: "Ingresos" },
    { key: "config", section: "Configuracion", href: "./configuracion.html", icon: "C", label: "Configuracion" },
  ]
  const sections = ["Operacion", "General", "Configuracion"]

  function activeKey() {
    if (path === "configuracion.html" || path === "socios.html") return "config"
    if (path === "proveedores.html" && params.get("tab") === "cuentas-origen") return "config"
    if (path === "ingresos.html") return "income"
    const match = {
      dashboard: "dashboard.html",
      requests: "solicitudes.html",
      providers: "proveedores.html",
      approvals: "aprobaciones.html",
      layouts: "layouts.html",
      cash: "efectivo.html",
      config: "configuracion.html",
    }
    return Object.keys(match).find((key) => match[key] === path) || "dashboard"
  }

  const current = activeKey()
  const html = sections.map((section) => {
    const sectionItems = items.filter((item) => item.section === section)
    if (!sectionItems.length) return ""
    return `
      <div class="nav-section">
        <div class="nav-section-title">${section}</div>
        ${sectionItems.map((item) => `<a href="${item.href}" class="nav-link ${item.key === current ? "active" : "muted"}"><span>${item.icon}</span> ${item.label}</a>`).join("")}
      </div>
    `
  }).join("")

  if (html.trim()) {
    nav.innerHTML = html
    nav.dataset.fluxNavMode = "base"
    nav.setAttribute("aria-busy", "true")
    document.documentElement?.classList.add("flux-shell-ready")
    document.body?.classList.add("flux-shell-ready")
  }
})()
