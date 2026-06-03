;(function ingresosUx2Extension() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "ingresos.html") return

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  function init() {
    applyVisitsCopy()
    addOperationalNotice()
    addMembersNotice()
    observeIncomeCopy()
  }

  function applyVisitsCopy() {
    document.title = "Ingresos y visitas/incidencias | Flux"
    replaceText(document.body, "Ingresos e incidencias", "Ingresos y visitas/incidencias")
    replaceText(document.body, "Incidencias", "Visitas / Incidencias")
    replaceText(document.body, "incidencias", "visitas/incidencias")
    replaceText(document.body, "Nueva visita/visitas/incidencias", "Nueva visita/incidencia")
    replaceText(document.body, "Visitas / Incidencias abiertas", "Visitas/incidencias abiertas")
    patchIncidentTabNotice()
  }

  function replaceText(root, from, to) {
    if (!root || !from || from === to) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach((node) => {
      if (node.nodeValue.includes(from)) node.nodeValue = node.nodeValue.split(from).join(to)
    })
  }

  function patchIncidentTabNotice() {
    const tab = document.getElementById("incidentsTab")
    if (!tab || document.getElementById("visitsIncidentsNotice")) return
    tab.insertAdjacentHTML("afterbegin", `
      <div id="visitsIncidentsNotice" class="notice neutral" style="margin-bottom:12px;">
        Una visita/incidencia debe agrupar pagos asociados. En esta tanda solo se ajusta la UX; la vinculacion real con solicitudes queda pendiente de backend/SQL.
      </div>
    `)
  }

  function observeIncomeCopy() {
    const observer = new MutationObserver(() => {
      applyVisitsCopy()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  function addOperationalNotice() {
    if (document.getElementById("incomeUx2Notice")) return
    const header = document.querySelector(".page-header")
    if (!header) return
    header.insertAdjacentHTML("afterend", `
      <div id="incomeUx2Notice" class="notice neutral">
        Ingresos y visitas/incidencias queda enfocado en operacion: periodos, cuotas, cobros, visitas/incidencias y facturas. La administracion e historial principal de socios esta en
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
