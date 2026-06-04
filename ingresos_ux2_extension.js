;(function ingresosUx2Extension() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "ingresos.html") return

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  function init() {
    applyStableCopy()
    addOperationalNotice()
    addMembersNotice()
    loadCarlosUxPatch()
  }

  function applyStableCopy() {
    const requestedTab = new URLSearchParams(window.location.search).get("tab")
    const isIncidents = requestedTab === "incidents" || requestedTab === "incidencias"
    document.title = `${isIncidents ? "Incidencias" : "Ingresos"} | Flux`
    setText(".brand-subtitle", isIncidents ? "Incidencias" : "Ingresos")
    setText(".topbar-kicker", isIncidents ? "Visitas, incidencias y cargos" : "Cuotas, cobros y balance")
    setText(".page-header h1", isIncidents ? "Incidencias" : "Ingresos")
    setText(".page-header p", isIncidents
      ? "Consulta y registra incidencias, visitas, cargos recuperables y facturas."
      : "Controla balance de ingresos, cuotas de mantenimiento, cobros y facturas.")
    setText("[data-tab='incidents']", "Incidencias")
  }

  function addOperationalNotice() {
    const existing = document.getElementById("incomeUx2Notice")
    if (existing) {
      existing.innerHTML = noticeCopy()
      return
    }

    const header = document.querySelector(".page-header")
    if (!header) return
    header.insertAdjacentHTML("afterend", `
      <div id="incomeUx2Notice" class="notice neutral">
        ${noticeCopy()}
      </div>
    `)
  }

  function noticeCopy() {
    const requestedTab = new URLSearchParams(window.location.search).get("tab")
    const isIncidents = requestedTab === "incidents" || requestedTab === "incidencias"
    if (isIncidents) {
      return `Incidencias queda enfocada en visitas, eventos, cargos recuperables, facturacion y cobro. La vinculacion formal con solicitudes de pago se conectara en la siguiente fase backend.`
    }
    return `Ingresos queda separado de Incidencias: aqui se revisan balance, cuotas y cobros. Incidencias tiene su propia entrada en el menu. La administracion de socios queda en
      <a href="./configuracion.html?tab=members" style="color:var(--accent-text);font-weight:800;">Configuracion > Socios</a>.`
  }

  function addMembersNotice() {
    const membersTab = document.getElementById("membersTab")
    if (!membersTab) return

    const existing = document.getElementById("membersMovedNotice")
    if (existing) {
      existing.innerHTML = membersNoticeCopy()
      return
    }

    membersTab.insertAdjacentHTML("afterbegin", `
      <div id="membersMovedNotice" class="notice neutral" style="margin-bottom:12px;">
        ${membersNoticeCopy()}
      </div>
    `)
  }

  function membersNoticeCopy() {
    return `Esta vista se mantiene por compatibilidad. La administracion principal de socios queda en
      <a href="./configuracion.html?tab=members" style="color:var(--accent-text);font-weight:800;">Configuracion > Socios</a>.`
  }

  function setText(selector, text) {
    const node = document.querySelector(selector)
    if (node) node.textContent = text
  }

  function loadCarlosUxPatch() {
    if (document.querySelector("script[data-flux-extension='ingresos-carlos-ux']")) return
    const script = document.createElement("script")
    script.src = "./ingresos_carlos_ux_patch_v2.js?v=20260603-carlos-ux2"
    script.dataset.fluxExtension = "ingresos-carlos-ux"
    document.body.appendChild(script)
    if (!document.querySelector("script[data-flux-extension='ingresos-default-balance']")) {
      const defaultScript = document.createElement("script")
      defaultScript.src = "./ingresos_default_balance_patch.js?v=20260603-default-balance"
      defaultScript.dataset.fluxExtension = "ingresos-default-balance"
      document.body.appendChild(defaultScript)
    }
  }
})()
