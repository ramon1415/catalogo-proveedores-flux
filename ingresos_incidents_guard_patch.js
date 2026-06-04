;(function ingresosIncidentsGuardPatch() {
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
    normalizeCopySoon()
    document.addEventListener("flux:income-data-ready", normalizeCopySoon)
    document.addEventListener("flux:roles-ready", normalizeCopySoon)
    document.addEventListener("click", explainUnavailableIncidentAction)
  }

  function normalizeCopySoon() {
    ;[0, 120, 450, 900, 1400].forEach((delay) => window.setTimeout(normalizeCopy, delay))
  }

  function normalizeCopy() {
    replaceText(document.body, /(?:visitas\s*\/\s*)+incidencias/gi, "incidencias")
    replaceText(document.body, /ingresos\s+(?:e|y)\s+incidencias/gi, isIncidentMode ? "Incidencias" : "Ingresos")
    setText("[data-tab='incidents']", "Incidencias")
    if (isIncidentMode) {
      setText(".brand-subtitle", "Incidencias")
      setText(".page-header h1", "Incidencias")
      setText(".topbar-kicker", "VISITAS, INCIDENCIAS Y CARGOS RECUPERABLES")
    }
  }

  function explainUnavailableIncidentAction(event) {
    const incidentOpen = event.target.closest("[data-open-incident-ui]")
    if (incidentOpen && typeof window.openIncidentModal !== "function") {
      event.preventDefault()
      toast("Incidencias", "La captura de nueva incidencia no esta disponible en esta carga. Actualiza la pantalla e intentalo de nuevo.")
      return
    }

    const button = event.target.closest("button[data-action]")
    if (!button || button.disabled) return

    const action = button.dataset.action
    const checks = {
      "pay": [window.openPaymentModal, "Registro de cobro pendiente de carga. Actualiza la pantalla e intentalo de nuevo."],
      "view-payments": [window.showPaymentHistory, "Historial de pagos pendiente de carga. Actualiza la pantalla e intentalo de nuevo."],
      "invoice-charge": [window.openInvoiceModal, "Emision de factura de cuota pendiente de carga. Actualiza la pantalla e intentalo de nuevo."],
      "invoice-incident": [window.openInvoiceModal, "Emision de factura desde incidencia pendiente de carga. Actualiza la pantalla e intentalo de nuevo."],
      "pay-invoice": [window.openInvoicePayModal, "Registro de pago de incidencia pendiente de carga. Actualiza la pantalla e intentalo de nuevo."],
    }
    const check = checks[action]
    if (!check || typeof check[0] === "function") return

    event.preventDefault()
    toast("Accion no disponible", check[1])
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

  function setText(selector, text) {
    const node = document.querySelector(selector)
    if (node && node.textContent !== text) node.textContent = text
  }

  function toast(title, message) {
    if (typeof window.showToast === "function") {
      window.showToast(title, message, "info")
    } else {
      window.alert(`${title}\n${message}`)
    }
  }
})()
