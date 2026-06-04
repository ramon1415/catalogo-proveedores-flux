;(function ingresosDefaultBalancePatch() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "ingresos.html") return

  const requested = new URLSearchParams(window.location.search).get("tab")
  if (requested !== "payments") return

  const clickBalance = () => {
    const balanceButton = document.querySelector('[data-tab="dashboard"]')
    if (balanceButton) balanceButton.click()
  }

  ;[20, 80, 160, 320, 700, 1100, 1500].forEach((delay) => window.setTimeout(clickBalance, delay))
})()
