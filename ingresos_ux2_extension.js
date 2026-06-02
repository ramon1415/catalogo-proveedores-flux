;(function ingresosUx2Extension() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "ingresos.html") return

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  function init() {
    addOperationalNotice()
    addMembersNotice()
  }

  function addOperationalNotice() {
    if (document.getElementById("incomeUx2Notice")) return
    const header = document.querySelector(".page-header")
    if (!header) return
    header.insertAdjacentHTML("afterend", `
      <div id="incomeUx2Notice" class="notice neutral">
        Ingresos e incidencias queda enfocado en operacion: periodos, cuotas, cobros, incidencias y facturas. La administracion e historial principal de socios esta en
        <a href="./socios.html" style="color:var(--accent-text);font-weight:800;">Socios</a>.
      </div>
    `)
  }

  function addMembersNotice() {
    const membersTab = document.getElementById("membersTab")
    if (!membersTab || document.getElementById("membersMovedNotice")) return
    membersTab.insertAdjacentHTML("afterbegin", `
      <div id="membersMovedNotice" class="notice neutral" style="margin-bottom:12px;">
        Esta vista se mantiene por compatibilidad. Para balance completo, pagos, incidencias y facturas por socio, usa el modulo
        <a href="./socios.html" style="color:var(--accent-text);font-weight:800;">Socios</a>.
      </div>
    `)
  }
})()
