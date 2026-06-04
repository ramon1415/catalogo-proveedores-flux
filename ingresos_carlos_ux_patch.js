;(function ingresosCarlosUxPatch() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "ingresos.html") return

  const params = new URLSearchParams(window.location.search)
  const requestedTab = (params.get("tab") || "income").toLowerCase()
  const isIncidentMode = ["incidents", "incidencias", "visitas"].includes(requestedTab)

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  function init() {
    window.setTimeout(applyMode, 60)
    window.setTimeout(applyMode, 350)
    window.setTimeout(applyMode, 850)
  }

  function applyMode() {
    normalizeCopy()
    if (isIncidentMode) {
      applyIncidentMode()
    } else {
      applyIncomeMode()
    }
  }

  function normalizeCopy() {
    setText("[data-tab='incidents']", "Incidencias")
    replaceRepeatedText(document.body, /(visitas\/)+incidencias/g, "incidencias")
    replaceRepeatedText(document.body, /(Visitas\/)+Incidencias/g, "Incidencias")
  }

  function applyIncomeMode() {
    document.title = "Ingresos | Flux"
    setText(".brand-subtitle", "Ingresos")
    setText(".topbar-kicker", "CUOTAS, COBROS Y BALANCE")
    setText(".page-header h1", "Ingresos")
    setText(".page-header p", "Controla cuotas de mantenimiento, periodos de cobro, pagos e historico de ingresos.")

    setText("[data-tab='dashboard']", "Balance")
    setText("[data-tab='periods']", "Cuotas")

    showTabButton("dashboard")
    showTabButton("periods")
    hideTabButton("members")
    hideTabButton("payments")
    hideTabButton("incidents")
    hideTabButton("invoices")

    ensureNotice("incomeModeNotice", "Ingresos queda enfocado en balance y cuotas. Socios y cuentas origen viven en Configuracion; Incidencias tiene su propia entrada en el menu.")
    adjustDashboardActionsForIncome()
    addPeriodsContext()

    const targetTab = ["cuotas", "periods"].includes(requestedTab) ? "periods" : "dashboard"
    clickTab(targetTab)
  }

  function applyIncidentMode() {
    document.title = "Incidencias | Flux"
    setText(".brand-subtitle", "Incidencias")
    setText(".topbar-kicker", "VISITAS, INCIDENCIAS Y CARGOS RECUPERABLES")
    setText(".page-header h1", "Incidencias")
    setText(".page-header p", "Registra visitas, incidencias y cargos recuperables. La relacion formal con solicitudes de pago queda preparada para la siguiente tanda backend.")

    hideTabButton("dashboard")
    hideTabButton("members")
    hideTabButton("periods")
    hideTabButton("payments")
    showTabButton("incidents")
    showTabButton("invoices")
    setText("[data-tab='invoices']", "Facturas")

    ensureNotice("incidentModeNotice", "Una incidencia representa una visita o evento. Hoy se captura el cargo recuperable; la vinculacion multiple con solicitudes de pago queda pendiente de backend/SQL.")
    addIncidentStepper()
    clickTab("incidents")
  }

  function adjustDashboardActionsForIncome() {
    const headers = Array.from(document.querySelectorAll(".panel-header h2"))
    const quickHeader = headers.find((node) => normalize(node.textContent) === "acciones rapidas")
    const card = quickHeader ? quickHeader.closest(".table-card") : null
    if (!card || card.dataset.incomeReadOnly === "true") return

    card.dataset.incomeReadOnly = "true"
    card.innerHTML = `
      <div class="panel-header">
        <div>
          <h2>Balance operativo</h2>
          <p>Vista de lectura para entender cobrado, pendiente y facturacion.</p>
        </div>
      </div>
      <div class="summary-list">
        <div class="summary-row"><span>Captura de socios</span><strong>Configuracion</strong></div>
        <div class="summary-row"><span>Cuotas y cobros</span><strong>Tab Cuotas</strong></div>
        <div class="summary-row"><span>Incidencias</span><strong>Modulo separado</strong></div>
      </div>
    `
  }

  function addPeriodsContext() {
    const periodsTab = document.getElementById("periodsTab")
    if (!periodsTab || document.getElementById("incomePeriodsContext")) return
    periodsTab.insertAdjacentHTML("afterbegin", `
      <div id="incomePeriodsContext" class="notice neutral" style="margin-bottom:12px;">
        Cuotas concentra periodos, cuotas generadas y cobros relacionados. El factor de participacion se administra desde Configuracion > Socios.
      </div>
    `)
  }

  function addIncidentStepper() {
    const incidentsTab = document.getElementById("incidentsTab")
    if (!incidentsTab || document.getElementById("incidentFlowStepper")) return
    incidentsTab.insertAdjacentHTML("afterbegin", `
      <div id="incidentFlowStepper" class="notice neutral" style="margin-bottom:12px;">
        <strong>Flujo esperado:</strong> Apertura de incidencia -> solicitudes asociadas -> factura -> pago/cierre. En esta version la asociacion a solicitudes es solo visual.
      </div>
    `)
  }

  function ensureNotice(id, copy) {
    const existing = document.getElementById(id)
    if (existing) {
      existing.textContent = copy
      return
    }

    const genericNotice = document.getElementById("incomeUx2Notice")
    if (genericNotice) genericNotice.remove()

    const otherNotice = document.getElementById(isIncidentMode ? "incomeModeNotice" : "incidentModeNotice")
    if (otherNotice) otherNotice.remove()

    const header = document.querySelector(".page-header")
    if (!header) return
    header.insertAdjacentHTML("afterend", `<div id="${id}" class="notice neutral">${copy}</div>`)
  }

  function clickTab(tab) {
    const button = document.querySelector(`[data-tab="${tab}"]`)
    if (button && !button.classList.contains("active")) button.click()
  }

  function showTabButton(tab) {
    const button = document.querySelector(`[data-tab="${tab}"]`)
    if (button) button.hidden = false
  }

  function hideTabButton(tab) {
    const button = document.querySelector(`[data-tab="${tab}"]`)
    if (button) button.hidden = true
  }

  function setText(selector, text) {
    const node = document.querySelector(selector)
    if (node && node.textContent !== text) node.textContent = text
  }

  function replaceRepeatedText(root, pattern, to) {
    if (!root) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach((node) => {
      node.nodeValue = node.nodeValue.replace(pattern, to)
    })
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase()
  }
})()
