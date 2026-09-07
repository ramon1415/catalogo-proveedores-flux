// Parseo local del CFDI (XML) para autollenar la solicitud.
// Solo lectura en el navegador. Además del desglose fiscal (subtotal, total,
// traslados, retenciones), extrae los datos que E1 usa para precargar la
// solicitud: RFC del emisor (→ proveedor) y del receptor (→ empresa), UUID
// (→ duplicado), fecha/serie/folio (→ referencia visible) y la descripción de
// los conceptos (→ concepto de la solicitud). Si el XML no es un CFDI válido
// se devuelve null y la captura queda manual.
export type CfdiBreakdown = {
  subtotal: number | null
  total: number | null
  traslados: number | null
  retenciones: number | null
  uuid: string | null
  rfcEmisor: string | null
  rfcReceptor: string | null
  nombreEmisor: string | null
  fecha: string | null
  serie: string | null
  folio: string | null
  conceptos: string | null
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
    const nombreEmisor = emisor?.getAttribute('Nombre')?.trim() || null
    const receptor = comprobante.getElementsByTagNameNS('*', 'Receptor')[0] ?? null
    const rfcReceptor = receptor?.getAttribute('Rfc')?.trim().toUpperCase() || null

    const fecha = comprobante.getAttribute('Fecha')?.trim() || null
    const serie = comprobante.getAttribute('Serie')?.trim() || null
    const folio = comprobante.getAttribute('Folio')?.trim() || null

    // Descripción de los conceptos del CFDI (nodo Conceptos/Concepto, no el de
    // nómina). Se juntan las descripciones únicas para proponer el concepto.
    const descripciones: string[] = []
    for (const concepto of Array.from(comprobante.getElementsByTagNameNS('*', 'Concepto'))) {
      const d = concepto.getAttribute('Descripcion')?.trim()
      if (d && !descripciones.includes(d)) descripciones.push(d)
    }
    const conceptos = descripciones.length ? descripciones.join('; ') : null

    if (subtotal == null && total == null) return null
    return { subtotal, total, traslados, retenciones, uuid, rfcEmisor, nombreEmisor, rfcReceptor, fecha, serie, folio, conceptos }
  } catch {
    return null
  }
}
