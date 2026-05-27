// Configuracion Supabase
// No uses la secret key en frontend.
const SUPABASE_URL = "https://scsirgbuqjcwoaxfacth.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_JNDHMoacW6ySHEtmI1Rgdw_zVZElQL2"

;(function prepareFluxShell() {
  const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase()

  const modules = [
    { file: "proveedores.html", href: "./proveedores.html", icon: "P", label: "Proveedores" },
    { file: "solicitudes.html", href: "./solicitudes.html", icon: "S", label: "Solicitudes de pago" },
    { file: "layouts.html", href: "./layouts.html", icon: "L", label: "Layouts de pago" },
    { file: "efectivo.html", href: "./efectivo.html", icon: "E", label: "Efectivo y comprobaciones" },
    { file: "ingresos.html", href: "./ingresos.html", icon: "I", label: "Ingresos e incidencias" },
  ]

  const subtitles = {
    "proveedores.html": "Proveedores",
    "solicitudes.html": "Solicitudes de pago",
    "layouts.html": "Layouts de pago",
    "efectivo.html": "Efectivo y comprobaciones",
    "ingresos.html": "Ingresos e incidencias",
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

    nav.innerHTML = modules
      .map((item) => {
        const isActive = pageName === item.file
        return `<a href="${item.href}" class="nav-link ${isActive ? "active" : "muted"}"><span>${item.icon}</span> ${item.label}</a>`
      })
      .join("")
  }

  function applyBranding() {
    const logo = document.querySelector(".brand-logo, .brand-badge")
    const title = document.querySelector(".brand-title")
    const subtitle = document.querySelector(".brand-subtitle")

    if (logo) logo.textContent = "FL"
    if (title) title.textContent = "Flux Operadora"
    if (subtitle && subtitles[pageName]) subtitle.textContent = subtitles[pageName]
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
    applyDemoNavigation()
    applyBranding()
    applyIncomeCompatibility()
    loadFluxExtensions()
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
    const enabledPages = ["solicitudes.html", "efectivo.html", "layouts.html", "ingresos.html"]
    if (!enabledPages.includes(pageName)) return

    loadExtension("./cash_flow_extension.js?v=20260526-3", "cash-flow")
    if (pageName === "solicitudes.html") {
      loadExtension("./solicitudes_workboard_extension.js?v=20260527-4", "solicitudes-workboard")
    }
    if (pageName === "layouts.html") {
      loadExtension("./layouts_result_extension.js?v=20260527-2", "layouts-result")
    }
    if (pageName === "ingresos.html") {
      loadExtension("./ingresos_ux_extension.js?v=20260527-1", "ingresos-ux")
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
