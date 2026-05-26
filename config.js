// Configuracion Supabase
// No uses la secret key en frontend.
const SUPABASE_URL = "https://scsirgbuqjcwoaxfacth.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_JNDHMoacW6ySHEtmI1Rgdw_zVZElQL2"

;(function prepareFluxShell() {
  const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase()

  const modules = [
    { file: "proveedores.html", href: "./proveedores.html", icon: "◇", label: "Proveedores" },
    { file: "solicitudes.html", href: "./solicitudes.html", icon: "S", label: "Solicitudes de pago" },
    { file: "layouts.html", href: "./layouts.html", icon: "L", label: "Layouts de pago" },
    { file: "efectivo.html", href: "./efectivo.html", icon: "E", label: "Efectivo y comprobaciones" },
  ]

  const subtitles = {
    "proveedores.html": "Proveedores",
    "solicitudes.html": "Solicitudes de pago",
    "layouts.html": "Layouts de pago",
    "efectivo.html": "Efectivo y comprobaciones",
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

  function applyShell() {
    applyLoginCopy()
    applyDemoNavigation()
    applyBranding()
    loadFluxExtensions()
  }

  function loadFluxExtensions() {
    const enabledPages = ["solicitudes.html", "efectivo.html"]
    if (!enabledPages.includes(pageName)) return
    if (document.querySelector('script[data-flux-extension="cash-flow"]')) return

    const script = document.createElement("script")
    script.src = "./cash_flow_extension.js?v=20260526"
    script.dataset.fluxExtension = "cash-flow"
    document.body.appendChild(script)
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyShell)
  } else {
    applyShell()
  }
})()