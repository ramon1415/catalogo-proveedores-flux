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
    addMembersNotice()
    loadCarlosUxPatch()
  }

  // Texto unificado: coincide con el HTML base y con el patch carlos para
  // que no haya parpadeo entre escritores. Ambas entradas del menú son iguales.
  function applyStableCopy() {
    document.title = "Ingresos e incidencias | Flux"
    setText(".brand-subtitle", "Ingresos e incidencias")
    setText(".topbar-kicker", "CUOTAS, COBROS, BALANCE E INCIDENCIAS")
    setText(".page-header h1", "Ingresos e incidencias")
    setText(".page-header p", "Controla cuotas de mantenimiento, periodos de cobro, pagos, balance e incidencias.")
    setText("[data-tab='dashboard']", "Balance")
    setText("[data-tab='payments']", "Cuotas")
    setText("[data-tab='incidents']", "Incidencias")
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
    script.src = "./ingresos_carlos_ux_patch_v2.js?v=20260610-unified-tabs"
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
