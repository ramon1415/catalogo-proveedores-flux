;(function ingresosNavPatch() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "ingresos.html") return

  const tabMap = {
    ingresos: "dashboard",
    income: "dashboard",
    balance: "dashboard",
    cuotas: "payments",
    cobros: "payments",
    payments: "payments",
    incidencias: "incidents",
    incidents: "incidents",
    visitas: "incidents",
    facturas: "invoices",
    invoices: "invoices",
    socios: "members",
    members: "members",
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", selectRequestedTab)
  } else {
    selectRequestedTab()
  }

  function selectRequestedTab() {
    const requested = new URLSearchParams(window.location.search).get("tab")
    const tab = tabMap[requested] || null
    if (!tab) return

    const clickTab = () => {
      const button = document.querySelector(`[data-tab="${tab}"]`)
      if (button) button.click()
    }

    window.setTimeout(clickTab, 80)
    window.setTimeout(clickTab, 450)
    window.setTimeout(clickTab, 900)
  }
})()
