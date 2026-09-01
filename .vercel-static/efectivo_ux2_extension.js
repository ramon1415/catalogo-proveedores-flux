;(function efectivoUx2Extension() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "efectivo.html") return

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  function init() {
    if (document.getElementById("paymentsGeneralNotice")) return
    const header = document.querySelector(".page-header")
    if (!header) return
    header.insertAdjacentHTML("afterend", `
      <div id="paymentsGeneralNotice" class="notice neutral">
        Efectivo sigue operando fondos, tickets y comprobaciones. Para ver todos los pagos, transferencias y comprobantes en una sola vista, consulta
        <a href="./pagos_comprobaciones.html" style="color:var(--accent-text);font-weight:800;">Pagos y comprobaciones</a>.
      </div>
    `)
  }
})()
