// Parseo local del CFDI (XML) para autollenar el desglose fiscal.
// Solo lectura en el navegador: subtotal, total, traslados y retenciones del
// nodo cfdi:Comprobante / cfdi:Impuestos. Si el XML no es un CFDI válido se
// devuelve null y la captura queda manual.
export type CfdiBreakdown = {
  subtotal: number | null
  total: number | null
  traslados: number | null
  retenciones: number | null
  uuid: string | null // folio fiscal (TimbreFiscalDigital) — llave anti doble pago
  rfcEmisor: string | null
}

export async function parseCfdiFile(file: File): Promise<CfdiBreakdown | null> {
  try {
    const text = await file.text()
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (doc.querySelector('parsererror')) return null
    const comprobante = doc.getElementsByTagNameNS('*', 'Comprobante')[0]
      ?? (doc.documentElement?.localName === 'Comprobante' ? doc.documentElement : null)
    if (!comprobante) return null

    const num = (value: string | null): number | null => {
      if (value == null || value === '') return null
      const n = Number(value)
      return Number.isFinite(n) ? n : null
    }

    const subtotal = num(comprobante.getAttribute('SubTotal'))
    const total = num(comprobante.getAttribute('Total'))

    // cfdi:Impuestos al nivel del Comprobante (no el de cada concepto).
    let traslados: number | null = null
    let retenciones: number | null = null
    for (const impuestos of Array.from(comprobante.getElementsByTagNameNS('*', 'Impuestos'))) {
      if (impuestos.parentElement !== comprobante) continue
      traslados = num(impuestos.getAttribute('TotalImpuestosTrasladados'))
      retenciones = num(impuestos.getAttribute('TotalImpuestosRetenidos'))
      break
    }

    const timbre = comprobante.getElementsByTagNameNS('*', 'TimbreFiscalDigital')[0] ?? null
    const uuid = timbre?.getAttribute('UUID')?.trim().toUpperCase() || null
    const emisor = comprobante.getElementsByTagNameNS('*', 'Emisor')[0] ?? null
    const rfcEmisor = emisor?.getAttribute('Rfc')?.trim().toUpperCase() || null

    if (subtotal == null && total == null) return null
    return { subtotal, total, traslados, retenciones, uuid, rfcEmisor }
  } catch {
    return null
  }
}
