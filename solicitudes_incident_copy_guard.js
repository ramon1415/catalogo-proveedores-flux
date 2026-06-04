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
    ;[0, 120, 450, 900].forEach((delay) => window.setTimeout(normalizeCopy, delay))
  }

  function normalizeCopy() {
    replaceText(document.body, /Ingresos\s+e\s+incidencias/g, "Incidencias")
    replaceText(document.body, /visitas\s*\/\s*incidencias/gi, "incidencias")
    replaceText(document.body, /Visita\s*\/\s*Incidencia asociada/g, "Incidencia / Visita asociada")
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
