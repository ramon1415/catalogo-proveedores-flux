// Only copy identifiers actually printed on a receipt. Never repair OCR digits,
// pad an identifier, infer a check digit, or use a fiscal subtotal as payable.
export type ConvenioReceiptData = {
  convenio: string | null
  reference: string
  concept: string
  amount: string
  service: string | null
  description: string
}

function unique(values: string[]): string | null {
  const distinct = [...new Set(values)]
  return distinct.length === 1 ? distinct[0] : null
}

function validDate(value: string): boolean {
  const year = 2000 + Number(value.slice(0, 2)), month = Number(value.slice(2, 4)), day = Number(value.slice(4, 6))
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function parseConvenioReceipt(lines: string[]): ConvenioReceiptData {
  const text = lines.join('\n').normalize('NFKC')
  const plain = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  const totalValues = [...plain.matchAll(/TOTAL\s*A\s*PAGAR\s*:?[^$\n]*(?:\n[^$\n]*){0,4}\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)(?![\d.,])/g)]
    .map(match => Number(match[1].replace(/,/g, '')).toFixed(2))
  const amount = unique(totalValues)
  if (!amount || !(Number(amount) > 0)) throw new Error('No se identificó un único Total a pagar. Revisa el recibo y captura el importe.')

  if (/\bCFE\b|COMISION\s*FEDERAL\s*DE\s*ELECTRICIDAD/.test(plain)) {
    const services = [...plain.matchAll(/NO\.?\s*DE\s*SERVICIO\s*:\s*(\d{12})(?!\d)/g)].map(match => match[1])
    const service = unique(services)
    // The CFE coupon prints 01 + service(12) + YYMMDD(6) + pesos(9) + check(1).
    // The first 20 digits are the CIE capture line; the final 10 are its concept.
    const codes = [...plain.matchAll(/(?<![\dA-Z])01(?:[ \t]*\d){28}(?![ \t]*\d|[A-Z])/g)]
      .map(match => match[0].replace(/[ \t]/g, ''))
    const code = unique(codes)
    if (!code || !service) throw new Error('No se pudo leer una sola línea CFE completa de 30 dígitos y su número de servicio. Carga un recibo nítido por solicitud o captura los datos manualmente.')
    if (code.slice(2, 14) !== service || !validDate(code.slice(14, 20))) throw new Error('La línea CFE no coincide con el servicio o contiene una fecha ilegible. Revisa el documento original.')
    const months = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']
    const due = /FECHA\s*LIMITE\s*DE\s*PAGO\s*:\s*(\d{1,2})\s*([A-Z]{3})\s*(20\d{2})/.exec(plain)
    if (due && `${due[3].slice(-2)}${String(months.indexOf(due[2]) + 1).padStart(2, '0')}${due[1].padStart(2, '0')}` !== code.slice(14, 20)) throw new Error('La fecha de la línea CFE no coincide con la fecha límite impresa. Revisa el recibo original.')
    if (Number(code.slice(20, 29)) !== Number(amount)) throw new Error('El importe de la línea CFE no coincide con el Total a pagar. Revisa el recibo antes de continuar.')
    return { convenio: '0578869', reference: code.slice(0, 20), concept: code.slice(20), amount, service, description: `CFE · servicio ${service}` }
  }

  // Other issuers must explicitly label their banking fields. Unknown layouts
  // remain manual; a CFE split is never applied to a different agreement.
  const field = (label: string) => unique([...text.matchAll(new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([^\\n]+)`, 'gi'))].map(match => match[1].trim()))
  const reference = field('(?:REFERENCIA(?: CIE)?|L[IÍ]NEA DE CAPTURA)')
  const concept = field('CONCEPTO(?: CIE| DEL PAGO)?')
  const convenio = field('(?:CONVENIO(?: BBVA| CIE)?|N[UÚ]MERO DE CONVENIO)')
  if (!reference || !concept || !convenio || !/^\d{6,7}$/.test(convenio) || !/^[ -~]{1,20}$/.test(reference) || !/^[ -~]{1,30}$/.test(concept) || /\|/.test(reference + concept)) {
    throw new Error('No se identificaron todos los campos del convenio con certeza. El recibo queda adjunto; completa los datos indicados por el proveedor.')
  }
  return { convenio, reference, concept, amount, service: null, description: '' }
}
