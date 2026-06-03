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
  }

  function applyStableCopy() {
    document.title = "Ingresos e incidencias | Flux"
    setText(".brand-subtitle", "Ingresos e incidencias")
    setText(".topbar-kicker", "Socios, cuotas de mantenimiento, cobros e incidencias")
    setText(".page-header h1", "Ingresos e incidencias")
    setText(".page-header p", "Controla socios, cuotas de mantenimiento, cobros, visitas/incidencias y facturas.")
    setText("[data-tab='incidents']", "Visitas / Incidencias")
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
    return `Este modulo concentra periodos, cuotas, cobros, visitas/incidencias y facturas. El historial completo por socio esta en
      <a href="./socios.html" style="color:var(--accent-text);font-weight:800;">Socios</a>.`
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
    return `Esta vista se mantiene por compatibilidad. Para balance completo, pagos, incidencias y facturas por socio, usa el modulo
      <a href="./socios.html" style="color:var(--accent-text);font-weight:800;">Socios</a>.`
  }

  function setText(selector, text) {
    const node = document.querySelector(selector)
    if (node) node.textContent = text
  }
})()
