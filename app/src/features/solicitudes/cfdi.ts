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
  moneda: string | null
  tipoCambio: number | null
}

type CfdiCompany = { id: string; rfc?: string | null; name?: string | null; legal_name?: string | null }

// Resuelve identidad; nunca concede acceso por el RFC del documento.
export function resolveCfdiCompany(rfc: string | null, companies: CfdiCompany[], allowedIds: string[]) {
  const normalized = (rfc ?? '').trim().toUpperCase()
  if (!normalized) return { company: null, error: 'El CFDI no contiene el RFC del receptor. Revisa la factura.' }
  const matches = companies.filter((c) => (c.rfc ?? '').trim().toUpperCase() === normalized)
  if (matches.length !== 1) return {
    company: null,
    error: matches.length > 1
      ? 'El RFC del receptor está registrado en varias empresas. Pide a Finanzas revisar el catálogo.'
      : 'El RFC del receptor no corresponde a una empresa registrada. Revisa la factura o pide a Finanzas completar el RFC de la empresa.',
  }
  const company = matches[0]
  if (!allowedIds.includes(company.id)) return { company: null, error: 'No tienes acceso a la empresa receptora de esta factura.' }
  return { company, error: '' }
}

export function validateCfdiSelection(
  cfdi: CfdiBreakdown | null, companies: CfdiCompany[], allowedIds: string[], companyId: string, currency: string,
): string {
  if (!cfdi) return '' // PDF, imagen o captura manual.
  const resolved = resolveCfdiCompany(cfdi.rfcReceptor, companies, allowedIds)
  if (resolved.error) return resolved.error
  if (resolved.company!.id !== companyId) {
    const name = resolved.company!.legal_name || resolved.company!.name || 'la empresa receptora'
    return `La factura corresponde a ${name}. Selecciona esa empresa o adjunta la factura correcta.`
  }
  if (!cfdi.moneda || !['MXN', 'USD'].includes(cfdi.moneda)) {
    return 'La moneda del CFDI no es compatible con esta solicitud. Se admiten MXN y USD.'
  }
  if (cfdi.moneda !== currency) return `La factura está en ${cfdi.moneda}. Selecciona esa moneda antes de continuar.`
  return ''
}

export function cfdiCurrencyPrefill(cfdi: CfdiBreakdown, currencyTouched: boolean, exchangeRateTouched: boolean) {
  if (!cfdi.moneda || !['MXN', 'USD'].includes(cfdi.moneda)) return {}
  return {
    currency: currencyTouched ? undefined : cfdi.moneda,
    exchangeRate: exchangeRateTouched ? undefined : cfdi.moneda === 'MXN' ? '1'
      : cfdi.tipoCambio != null && cfdi.tipoCambio > 0 ? String(cfdi.tipoCambio) : '',
  }
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
    const moneda = comprobante.getAttribute('Moneda')?.trim().toUpperCase() || null
    const tipoCambio = num(comprobante.getAttribute('TipoCambio'))

    // Descripción de los conceptos del CFDI (nodo Conceptos/Concepto, no el de
    // nómina). Se juntan las descripciones únicas para proponer el concepto.
    const descripciones: string[] = []
    for (const concepto of Array.from(comprobante.getElementsByTagNameNS('*', 'Concepto'))) {
      const d = concepto.getAttribute('Descripcion')?.trim()
      if (d && !descripciones.includes(d)) descripciones.push(d)
    }
    const conceptos = descripciones.length ? descripciones.join('; ') : null

    if (subtotal == null && total == null) return null
    return { subtotal, total, traslados, retenciones, uuid, rfcEmisor, nombreEmisor, rfcReceptor, fecha, serie, folio, conceptos, moneda, tipoCambio }
  } catch {
    return null
  }
}
