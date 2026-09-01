;(function solicitudesIncidentCopyGuard() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "solicitudes.html") return

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", normalizeSoon)
  } else {
    normalizeSoon()
  }
  document.addEventListener("flux:roles-ready", normalizeSoon)

  function normalizeSoon() {
    ;[0, 120, 450, 900].forEach((delay) => window.setTimeout(applyProductionSafety, delay))
  }

  function applyProductionSafety() {
    normalizeCopy()
    hideDemoControlsInProduction()
    normalizeEmptyStateCopy()
    guardProductionFallback()
  }

  function normalizeCopy() {
    replaceText(document.body, /Ingresos\s+e\s+incidencias/g, "Incidencias")
    replaceText(document.body, /visitas\s*\/\s*incidencias/gi, "incidencias")
    replaceText(document.body, /Visita\s*\/\s*Incidencia asociada/g, "Incidencia / Visita asociada")
  }

  function hideDemoControlsInProduction() {
    if (!isProductionEnv()) return
    document.querySelectorAll("[data-demo-quick-provider], #demoFillBtn, .demo-fill-btn").forEach((node) => {
      node.remove()
    })
  }

  function normalizeEmptyStateCopy() {
    replaceText(document.body, /No hay solicitudes para mostrar/g, "Sin solicitudes registradas")
    replaceText(document.body, /Crea una nueva solicitud de pago para iniciar la bandeja\./g, "Cuando se cree una solicitud aparecera en esta bandeja.")
  }

  function guardProductionFallback() {
    if (!isProductionHost() || !window.FLUX_CONFIG?.usingFallback) return

    setDashboardCountsToZero()
    disableRequestActions()
    renderBlockedFallbackMessage()
  }

  function setDashboardCountsToZero() {
    ;["totalRequests", "approvableRequests", "blockedRequests", "paidRequests", "requestedAmount"].forEach((id) => {
      const node = document.getElementById(id)
      if (!node) return
      node.textContent = id === "requestedAmount" ? "$0.00" : "0"
    })
  }

  function disableRequestActions() {
    document.getElementById("newRequestBtn")?.setAttribute("disabled", "disabled")
    document.getElementById("submitRequestBtn")?.setAttribute("disabled", "disabled")
  }

  function renderBlockedFallbackMessage() {
    const tableBody = document.getElementById("requestsTableBody")
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="12">
            <div class="empty-state">
              <strong>Sin solicitudes registradas</strong>
              La configuracion de produccion no pudo confirmarse. Para evitar mostrar datos de otro ambiente, la bandeja queda vacia hasta recargar la configuracion runtime.
            </div>
          </td>
        </tr>`
    }

    const messageBox = document.getElementById("messageBox")
    if (messageBox) {
      messageBox.classList.remove("hidden")
      messageBox.style.color = "var(--ruby)"
      messageBox.textContent = "Configuracion de produccion incompleta: no se mostraran datos de fallback."
    }
  }

  function isProductionEnv() {
    return String(window.FLUX_CONFIG?.env || window.FLUX_ENV || "").toLowerCase() === "prod"
  }

  function isProductionHost() {
    return ["catalogo-proveedores-flux.vercel.app", "flux.quantta.mx"].includes(window.location.hostname)
  }

  function replaceText(root, pattern, replacement) {
    if (!root) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach((node) => {
      node.nodeValue = node.nodeValue.replace(pattern, replacement)
    })
  }
})()
