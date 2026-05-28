;(function dashboardReportDownloads() {
  const reportNames = {
    sheet: "Excel",
    slides: "PowerPoint",
    pdf: "PDF",
  }

  const reportStructures = {
    sheet: [
      ["KPIs", "Periodo", "Solicitado", "Pagado", "Pendiente pago", "Ingresos cobrados", "Ingresos pendientes", "Balance neto", "Bloqueos", "Ultima actualizacion"],
      ["Gastos mes", "Empresa", "Centro de costo", "Partida", "Codigo", "Presupuesto", "Comprometido", "Ejecutado", "Disponible", "Variacion $", "Variacion %"],
      ["YTD", "Empresa", "Centro de costo", "Partida", "Presupuesto YTD", "Comprometido YTD", "Ejecutado YTD", "Disponible YTD", "Variacion $", "Variacion %"],
      ["Ingresos", "Socio", "Estirpe", "Periodo", "Fecha corte", "Esperado", "Cobrado", "Pendiente", "Estatus", "Incidencias abiertas", "Facturas pendientes"],
      ["Efectivo", "Fondos activos", "Pendientes de comprobar", "En revision", "Vencidos", "Monto entregado", "Monto comprobado", "Monto pendiente"],
      ["Cierre", "Revision", "Resultado", "Estatus", "Comentario"],
      ["Diccionario", "Campo", "Descripcion", "Fuente"],
    ],
    slides: [
      "Portada",
      "Resumen ejecutivo",
      "KPIs principales",
      "Gastos del mes",
      "Top desviaciones",
      "Ingresos y cuotas",
      "Efectivo y comprobaciones",
      "Incidencias y facturas",
      "Checklist de cierre",
      "Siguientes pasos",
    ],
    pdf: [
      "Portada",
      "Resumen ejecutivo",
      "Indicadores principales",
      "Egresos del periodo",
      "Ingresos del periodo",
      "Efectivo y comprobaciones",
      "Incidencias y facturacion",
      "Checklist de cierre",
      "Comentarios ejecutivos",
      "Evidencia de exportacion",
      "Siguientes pasos",
    ],
  }

  function init() {
    document.addEventListener("click", interceptDownload, true)
    window.setInterval(updateDownloadLabels, 1000)
    updateDownloadLabels()
  }

  function interceptDownload(event) {
    const button = event.target.closest("[data-download-report]")
    if (!button) return

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    downloadReport(button.dataset.downloadReport)
  }

  function updateDownloadLabels() {
    const labels = {
      sheet: "Descargar Excel ejemplo",
      slides: "Descargar PowerPoint ejemplo",
      pdf: "Descargar PDF ejemplo",
    }

    Object.entries(labels).forEach(([type, label]) => {
      document.querySelectorAll(`[data-download-report="${type}"]`).forEach((button) => {
        if (button.textContent !== label) button.textContent = label
      })
    })
  }

  function downloadReport(type) {
    const period = normalizePeriod(document.getElementById("periodInput")?.value) || "2026-05"
    const file = buildReportFile(type, period)
    if (!file) return

    const url = URL.createObjectURL(file.blob)
    const link = document.createElement("a")
    link.href = url
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)

    showToastSafe(
      "Descarga generada",
      `Se genero un ejemplo temporal en formato ${reportNames[type] || "archivo"}.`,
      "success",
    )
  }

  function buildReportFile(type, period) {
    if (type === "sheet") {
      return {
        name: `Flux_Operadora_Sheet_Maestro_Ejemplo_${period}.xls`,
        blob: new Blob([buildExcelHtml(period)], {
          type: "application/vnd.ms-excel;charset=utf-8",
        }),
      }
    }

    if (type === "slides") {
      return {
        name: `Flux_Operadora_Presentacion_Mensual_Ejemplo_${period}.ppt`,
        blob: new Blob([buildPowerPointHtml(period)], {
          type: "application/vnd.ms-powerpoint;charset=utf-8",
        }),
      }
    }

    if (type === "pdf") {
      return {
        name: `Flux_Operadora_Reporte_Cierre_Ejemplo_${period}.pdf`,
        blob: buildPdfBlob(period),
      }
    }

    return null
  }

  function buildExcelHtml(period) {
    const tables = reportStructures.sheet
      .map((section) => {
        const [title, ...columns] = section
        return `
          <h2>${escapeHtml(title)}</h2>
          <table>
            <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
            <tbody><tr>${columns.map((column, index) => `<td>${escapeHtml(sampleValue(title, column, index, period))}</td>`).join("")}</tr></tbody>
          </table>
        `
      })
      .join("")

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; color: #111827; }
            h1 { color: #0f766e; }
            h2 { margin-top: 24px; color: #1f2937; }
            table { border-collapse: collapse; margin-bottom: 18px; width: 100%; }
            th { background: #0f766e; color: white; font-weight: 700; }
            th, td { border: 1px solid #cbd5e1; padding: 8px; font-size: 12px; }
          </style>
        </head>
        <body>
          <h1>Flux Operadora - Sheet maestro vivo</h1>
          <p>Periodo: ${escapeHtml(period)}</p>
          <p>Ejemplo temporal. El archivo real se generara en Google Sheets mediante n8n.</p>
          ${tables}
        </body>
      </html>
    `
  }

  function buildPowerPointHtml(period) {
    const slides = reportStructures.slides
      .map((title, index) => {
        const bullets = slideBullets(title)
        return `
          <section class="slide">
            <p class="eyebrow">Flux Operadora | ${escapeHtml(period)}</p>
            <h1>${escapeHtml(index === 0 ? "Reporte operativo mensual" : title)}</h1>
            <h2>${escapeHtml(index === 0 ? title : "Contenido esperado")}</h2>
            <ul>${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>
          </section>
        `
      })
      .join("")

    return `
      <!doctype html>
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:p="urn:schemas-microsoft-com:office:powerpoint">
        <head>
          <meta charset="utf-8">
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #09090f; color: #f8fafc; }
            .slide { page-break-after: always; width: 10in; height: 5.625in; box-sizing: border-box; padding: .6in; background: #111122; border-bottom: 8px solid #14b8a6; }
            .eyebrow { color: #5eead4; text-transform: uppercase; letter-spacing: 1px; font-size: 14px; }
            h1 { font-size: 34px; margin: 18px 0 12px; }
            h2 { color: #c4b5fd; font-size: 20px; }
            li { margin: 10px 0; font-size: 18px; }
          </style>
        </head>
        <body>${slides}</body>
      </html>
    `
  }

  function buildPdfBlob(period) {
    const lines = [
      "Flux Operadora",
      `Reporte de cierre ejemplo - ${period}`,
      "",
      "Documento no editable usado como evidencia final del cierre.",
      "",
      ...reportStructures.pdf.map((item, index) => `${index + 1}. ${item}`),
      "",
      "La exportacion real se conectara con n8n y Google Drive.",
    ]

    const stream = [
      "BT",
      "/F1 20 Tf",
      "50 760 Td",
      `(${pdfEscape(lines[0])}) Tj`,
      "/F1 12 Tf",
      ...lines.slice(1).map((line) => `0 -22 Td (${pdfEscape(line)}) Tj`),
      "ET",
    ].join("\n")

    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ]

    let pdf = "%PDF-1.4\n"
    const offsets = [0]
    objects.forEach((object, index) => {
      offsets.push(pdf.length)
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    })
    const xref = pdf.length
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, "0")} 00000 n \n`
    })
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`

    return new Blob([pdf], { type: "application/pdf" })
  }

  function sampleValue(section, column, index, period) {
    if (/periodo/i.test(column)) return period
    if (/empresa/i.test(column)) return "Operadora Tlacatecpan"
    if (/centro/i.test(column)) return "Rancho San Juan Tlacatecpan"
    if (/partida/i.test(column)) return "Nomina / mantenimiento"
    if (/codigo/i.test(column)) return "602-01-001-000"
    if (/socio/i.test(column)) return "Socio ejemplo"
    if (/estatus/i.test(column)) return section === "Cierre" ? "OK" : "Pendiente"
    if (/fecha|actualizacion/i.test(column)) return new Date().toISOString().slice(0, 10)
    if (/bloqueos|incidencias|facturas|fondos|revision|vencidos/i.test(column)) return "0"
    if (/monto|solicitado|pagado|pendiente|ingresos|balance|presupuesto|comprometido|ejecutado|disponible|variacion|esperado|cobrado|entregado|comprobado/i.test(column)) return "$0.00"
    if (/campo/i.test(column)) return "period_key"
    if (/descripcion/i.test(column)) return "Periodo operativo en formato YYYY-MM"
    if (/fuente/i.test(column)) return "dashboard_export_payload"
    return index === 0 ? "Ejemplo" : ""
  }

  function slideBullets(title) {
    const common = {
      Portada: ["Flux Operadora", "Reporte operativo mensual", "Periodo y fecha de generacion"],
      "Resumen ejecutivo": ["Lectura del periodo", "Alertas principales", "Siguientes decisiones"],
      "KPIs principales": ["Solicitado", "Pagado", "Pendiente", "Ingresos cobrados", "Balance"],
      "Gastos del mes": ["Comparativo operativo", "Partidas principales", "Monto ejecutado"],
      "Top desviaciones": ["Top 5 variaciones", "Comentarios ejecutivos", "Nota de presupuesto si aplica"],
      "Ingresos y cuotas": ["Esperado", "Cobrado", "Pendiente", "Socios con saldo"],
      "Efectivo y comprobaciones": ["Fondos activos", "Vencidos", "En revision", "Pendiente por comprobar"],
      "Incidencias y facturas": ["Incidencias abiertas", "Facturas pendientes", "Incidencias cobradas"],
      "Checklist de cierre": ["Bloqueos", "Advertencias", "Puede cerrar Si/No"],
      "Siguientes pasos": ["Resolver bloqueos", "Confirmar layouts", "Conectar n8n y Drive"],
    }
    return common[title] || ["Contenido ejecutivo", "Resumen del periodo", "Acciones siguientes"]
  }

  function normalizePeriod(value) {
    const text = String(value || "").trim().slice(0, 7)
    const month = Number(text.slice(5, 7))
    return /^\d{4}-\d{2}$/.test(text) && month >= 1 && month <= 12 ? text : ""
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
  }

  function pdfEscape(value) {
    return String(value ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
  }

  function showToastSafe(title, message, type = "info") {
    if (typeof window.showToast === "function") {
      window.showToast(title, message, type)
      return
    }

    const stack = document.getElementById("toastStack")
    if (!stack) return
    const toast = document.createElement("div")
    toast.className = `toast ${type}`
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`
    stack.appendChild(toast)
    window.setTimeout(() => toast.remove(), 5000)
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init)
  else init()
})()
