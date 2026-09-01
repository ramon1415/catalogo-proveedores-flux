;(function layoutsUx2Extension() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "layouts.html") return

  const statusLabels = {
    draft: "Borrador",
    generated: "Generado",
    uploaded: "Subido al banco",
    confirmed: "Confirmado",
    cancelled: "Cancelado",
    included: "Incluida",
    paid: "Pagada",
    bank_rejected: "Rechazada por banco",
    Draft: "Borrador",
    Generated: "Generado",
    Uploaded: "Subido al banco",
    Confirmed: "Confirmado",
    Cancelled: "Cancelado",
    Included: "Incluida",
    Paid: "Pagada",
    "Bank rejected": "Rechazada por banco",
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  function init() {
    installStyles()
    updateLayoutHeaders()
    updateLineHeaders()
    observeTables()
    window.setTimeout(refreshTables, 400)
    window.setTimeout(refreshTables, 1200)
  }

  function installStyles() {
    if (document.getElementById("layoutsUx2Styles")) return
    const style = document.createElement("style")
    style.id = "layoutsUx2Styles"
    style.textContent = `
      .layouts-ux2-note { margin:10px 16px 0; border:1px solid var(--border); border-radius:12px; padding:10px 12px; background:rgba(255,255,255,.018); color:var(--text-3); font-size:12px; }
      .layouts-ux2-source { color:var(--text-3); font-size:11px; line-height:1.35; }
      .layouts-ux2-source strong { display:block; color:var(--text-2); font-size:12px; }
    `
    document.head.appendChild(style)
  }

  function observeTables() {
    const layoutBody = document.getElementById("layoutsTableBody")
    const linesBody = document.getElementById("linesTableBody")
    if (layoutBody) new MutationObserver(() => transformLayoutRows()).observe(layoutBody, { childList: true })
    if (linesBody) new MutationObserver(() => transformLineRows()).observe(linesBody, { childList: true })
  }

  function refreshTables() {
    updateLayoutHeaders()
    updateLineHeaders()
    transformLayoutRows()
    transformLineRows()
  }

  function updateLayoutHeaders() {
    const headers = document.querySelectorAll("#layoutsTableBody")?.[0]?.closest("table")?.querySelectorAll("thead th")
    if (!headers?.length) return
    const labels = ["Folio layout", "Periodo", "Empresa", "Cuenta origen", "Total", "Lineas", "Estatus", "Fecha creacion", "Acciones"]
    headers.forEach((header, index) => { if (labels[index]) header.textContent = labels[index] })
    ensureNote()
  }

  function ensureNote() {
    const tableCard = document.getElementById("layoutsTableBody")?.closest(".table-card")
    if (!tableCard || tableCard.querySelector(".layouts-ux2-note")) return
    const toolbar = tableCard.querySelector(".table-toolbar")
    toolbar?.insertAdjacentHTML("afterend", `<div class="layouts-ux2-note">La tabla principal muestra el resumen operativo. Los datos bancarios y el detalle pesado viven en Ver lineas.</div>`)
  }

  function updateLineHeaders() {
    const headers = document.getElementById("linesTableBody")?.closest("table")?.querySelectorAll("thead th")
    if (!headers?.length) return
    const labels = ["Origen", "Titular", "Destino", "Beneficiario", "Importe", "Referencia", "Concepto", "Solicitud", "Estatus", "Accion"]
    headers.forEach((header, index) => { if (labels[index]) header.textContent = labels[index] })
  }

  function transformLayoutRows() {
    const body = document.getElementById("layoutsTableBody")
    if (!body) return
    Array.from(body.querySelectorAll("tr")).forEach((row) => {
      const cells = Array.from(row.children)
      if (cells.length !== 9 || row.dataset.ux2Layout === "true") {
        translateBadges(row)
        return
      }

      const [layout, period, status, payments, companies, total, generated, file, actions] = cells
      const newCells = [
        layout.innerHTML,
        period.innerHTML,
        `<strong>${escapeHtml(companies.textContent.trim() || "0")}</strong><span class="muted-line">Empresa(s)</span>`,
        `<span class="layouts-ux2-source"><strong>Por solicitud</strong>Ver lineas para revisar cuenta origen</span>`,
        total.innerHTML,
        `<strong>${escapeHtml(payments.textContent.trim() || "0")}</strong><span class="muted-line">Lineas</span>`,
        status.innerHTML,
        generated.innerHTML,
        actions.innerHTML || file.innerHTML,
      ]
      row.innerHTML = newCells.map((content) => `<td>${content}</td>`).join("")
      row.dataset.ux2Layout = "true"
      translateBadges(row)
    })
  }

  function transformLineRows() {
    const body = document.getElementById("linesTableBody")
    if (!body) return
    Array.from(body.querySelectorAll("tr")).forEach(translateBadges)
  }

  function translateBadges(root) {
    root.querySelectorAll(".badge").forEach((badge) => {
      const text = badge.textContent.trim()
      const key = Object.prototype.hasOwnProperty.call(statusLabels, text) ? text : text.toLowerCase()
      if (statusLabels[key]) badge.textContent = statusLabels[key]
    })
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
  }
})()
