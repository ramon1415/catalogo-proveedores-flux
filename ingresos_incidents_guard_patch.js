;(function ingresosIncidentsGuardPatch() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "ingresos.html") return

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  function init() {
    // Solo guarda defensiva: explica con un toast cuando una acción del tab
    // (cobro, factura, etc.) aún no tiene su función cargada. La copia del
    // header ya la maneja el HTML base + ingresos_ux2 + carlos_ux unificados;
    // este patch ya NO reescribe títulos (causaba parpadeo).
    document.addEventListener("click", explainUnavailableIncidentAction)
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

  function toast(title, message) {
    if (typeof window.showToast === "function") {
      window.showToast(title, message, "info")
    } else {
      window.alert(`${title}\n${message}`)
    }
  }
})()
