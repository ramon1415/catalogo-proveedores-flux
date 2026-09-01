// Exportes CSV/PDF del corte, espejo de exportCsv/exportPdf del vanilla.
// jsPDF + autotable se cargan on-demand desde los mismos CDN del HTML vanilla
// (el bundle de la SPA no los incluye para no pagar su peso en cada carga).
import { buildCsvContent, downloadBlob, fileStem, formatMoney, statusLabel } from './logic'
// Wordmark Flux (base64 verbatim del vanilla) para el encabezado del PDF.
import { FLUX_PDF_LOGO } from './pdfLogo'
import type { BatchDetailBatch, BatchItem } from './types'

declare global {
  interface Window {
    jspdf?: { jsPDF: new (options?: unknown) => JsPdfDoc }
  }
}

// Tipado mínimo de la superficie de jsPDF/autotable que usa el export.
type JsPdfDoc = {
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } }
  addImage: (data: string, format: string, x: number, y: number, w: number, h: number) => void
  setTextColor: (r: number, g: number, b: number) => void
  setFontSize: (size: number) => void
  text: (text: string, x: number, y: number) => void
  autoTable: (options: Record<string, unknown>) => void
  save: (name: string) => void
}

export function exportBatchCsv(batch: BatchDetailBatch, items: BatchItem[]): void {
  const content = buildCsvContent(batch, items)
  // BOM para que Excel abra el CSV como UTF-8 (igual que el vanilla).
  downloadBlob(new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8' }), `${fileStem(batch)}.csv`)
}

const JSPDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'
const AUTOTABLE_CDN = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) {
      // Si el script ya está en el documento asumimos que cargó o cargará.
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('script_load_failed'))
    document.head.appendChild(script)
  })
}

// Garantiza window.jspdf.jsPDF; devuelve false si los CDN no cargan.
async function ensureJsPdf(): Promise<boolean> {
  if (window.jspdf?.jsPDF) return true
  try {
    await loadScript(JSPDF_CDN)
    await loadScript(AUTOTABLE_CDN)
  } catch {
    return false
  }
  return Boolean(window.jspdf?.jsPDF)
}

// Devuelve false cuando el generador no está disponible (la página muestra el toast).
export async function exportBatchPdf(batch: BatchDetailBatch, items: BatchItem[]): Promise<boolean> {
  const available = await ensureJsPdf()
  if (!available || !window.jspdf?.jsPDF) return false
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  try { doc.addImage(FLUX_PDF_LOGO, 'PNG', pageWidth - 36 - 80, 22, 80, 32) } catch { /* sin logo si falla el decode */ }
  doc.setTextColor(23, 45, 41)
  doc.setFontSize(15)
  doc.text(batch.label || '', 36, 36)
  doc.setFontSize(9)
  doc.setTextColor(96, 110, 104)
  doc.text(`${batch.company_name} | ${batch.period_start} a ${batch.period_end} | ${statusLabel(batch.status)}`, 36, 53)
  doc.autoTable({
    startY: 68,
    head: [['Folio', 'Proveedor', 'Centro / partida', 'Metodo', 'Monto', 'Solicitante', 'Decision', 'Motivo']],
    body: items.map((item) => [
      item.request_number,
      item.provider_name || '-',
      `${item.cost_center || '-'}\n${item.budget_category || '-'}`,
      item.payment_method || '-',
      formatMoney(item.amount, item.currency),
      item.requester_name || '-',
      statusLabel(item.director_status),
      `${item.reject_reason || '-'}${item.rebatch_release_note ? `\nReingreso: ${item.rebatch_release_note}` : ''}`,
    ]),
    styles: { fontSize: 7, cellPadding: 4, overflow: 'linebreak', textColor: [21, 33, 29] },
    headStyles: { fillColor: [23, 45, 41], textColor: [247, 247, 245] },
    alternateRowStyles: { fillColor: [244, 246, 241] },
    didDrawPage: () => {
      doc.setFontSize(7.5)
      doc.setTextColor(150, 160, 155)
      doc.text('Flux Operadora — corte semanal', 36, doc.internal.pageSize.getHeight() - 18)
    },
  })
  doc.save(`${fileStem(batch)}.pdf`)
  return true
}
