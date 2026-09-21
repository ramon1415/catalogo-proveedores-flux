// Aggregate-only text reader. Input must contain ALL PDF pages, grouped into
// visual rows (extractPdfLines), not flattened text or the filename. This is
// prefill, never proof of payment or authorization to submit an obligation.
export type ObligationDocumentKind = 'imss_sipare' | 'imss_sua' | 'imss_ema' | 'isn_cdmx' | 'unknown'
type Issue = { code: string; field: string }
export type ObligationDocument = {
  version: 'obligation-documents-v1'
  kind: ObligationDocumentKind
  taxpayerRfc: string | null
  employerRegistration: string | null
  periodStart: string | null
  periodEnd: string | null
  amountMinor: number | null
  dueDate: string | null
  paymentReference: string | null
  // Payment forms and assessment documents never set a payment date/status.
  isPaymentReceipt: false
  issues: Issue[]
}
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
const compact = (value: string) => normalize(value).replace(/[^A-Z0-9Ñ&]/g, '')
const moneyPattern = /(?<![\d.,])(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?!\d)/g
const months = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

function cents(value: string): number | null {
  const number = Number(value.replace(/[,.]/g, ''))
  return Number.isSafeInteger(number) && number > 0 ? number : null
}
function date(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2199 || month < 1 || month > 12 || day < 1) return null
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? parsed.toISOString().slice(0, 10) : null
}
function period(year: number, month: number): [string, string] | null {
  const start = date(year, month, 1)
  if (!start) return null
  return [start, new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)]
}

export function parseObligationDocument(input: string | string[]): ObligationDocument {
  const raw = Array.isArray(input) ? input.join('\n') : input
  const out: ObligationDocument = { version: 'obligation-documents-v1', kind: 'unknown', taxpayerRfc: null,
    employerRegistration: null, periodStart: null, periodEnd: null, amountMinor: null, dueDate: null,
    paymentReference: null, isPaymentReceipt: false, issues: [] }
  const issue = (code: string, field: string) => out.issues.push({ code, field })
  if (raw.length > 300_000 || !raw.trim()) { issue('DOCUMENT_TEXT_UNAVAILABLE', 'document'); return out }
  const lines = normalize(raw).split(/[\r\n\f]+/).map(line => line.trim().replace(/[\t ]+/g, ' ')).filter(Boolean)
  const text = lines.join('\n')
  const signatures: ObligationDocumentKind[] = []
  if (/FORMATO PARA PAGO DE CUOTAS OBRERO PATRONALES/.test(text) && /LINEA DE CAPTURA SIPARE/.test(text)) signatures.push('imss_sipare')
  if (/^SISTEMA UNICO DE AUTODETERMINACION$/m.test(text) && /^CEDULA DE DETERMINACION DE CUOTAS$/m.test(text)) signatures.push('imss_sua')
  if (/PROPUESTA DE CEDULA DE DETERMINACION DE CUOTAS IMSS/.test(text)) signatures.push('imss_ema')
  if (/FORMATO MULTIPLE DE PAGO A LA TESORERIA/.test(text) && /IMPUESTO SOBRE NOMINAS/.test(text) && /(?:CIUDAD DE MEXICO|CFCDMX)/.test(text)) signatures.push('isn_cdmx')
  if (signatures.length !== 1) { issue(signatures.length ? 'MIXED_DOCUMENT_TYPES' : 'DOCUMENT_TYPE_UNSUPPORTED', 'document'); return out }
  out.kind = signatures[0]

  function unique(values: string[], field: string, required = true): string | null {
    const distinct = [...new Set(values)]
    if (distinct.length === 1) return distinct[0]
    if (distinct.length > 1 || required) issue(distinct.length > 1 ? 'FIELD_CONFLICT' : 'FIELD_MISSING', field)
    return null
  }
  // Corporate RFC only, anchored to its label. Never collect employee RFC/CURP.
  out.taxpayerRfc = unique([...text.matchAll(/\bR\.?\s*F\.?\s*C\.?\s*:?\s*([A-ZÑ&]{3}\s*-?\s*\d{6}\s*-?\s*[A-Z0-9]{3})(?![A-Z0-9])/g)].map(m => compact(m[1])), 'taxpayerRfc')
  if (out.kind !== 'isn_cdmx') {
    out.employerRegistration = unique([...text.matchAll(/\b([A-Z]\d{2}\s*-\s*\d{5}\s*-\s*\d{2}\s*-\s*\d)\b/g)].map(m => compact(m[1])), 'employerRegistration')
  }

  const periods: string[] = []
  if (out.kind === 'imss_sua') {
    for (const m of text.matchAll(/PERIODO DE PROCESO\s*:\s*([A-Z]+)\s*-\s*(\d{4})/g)) {
      const p = period(Number(m[2]), months.indexOf(m[1]) + 1)
      if (p) periods.push(p.join('/'))
    }
  } else if (out.kind === 'isn_cdmx') {
    for (const m of text.matchAll(/\bPERIODO\s*:\s*(\d{4})(\d{2})(?!\d)/g)) {
      const p = period(Number(m[1]), Number(m[2]))
      if (p) periods.push(p.join('/'))
    }
  } else {
    // Period is below a column heading in EMA/SIPARE. Only inspect the bounded
    // heading area; employee movements and salary/UMA dates are unrelated.
    for (let i = 0; i < lines.length; i++) if (/\bPERIODO\b/.test(lines[i])) {
      const window = lines.slice(i, i + 6).join('\n')
      for (const m of window.matchAll(/(?<![\d/\-])(0?[1-9]|1[0-2])\s*-\s*(20\d{2}|21\d{2})(?!\d)/g)) {
        const p = period(Number(m[2]), Number(m[1]))
        if (p) periods.push(p.join('/'))
      }
    }
  }
  const chosenPeriod = unique(periods, 'period')
  if (chosenPeriod) [out.periodStart, out.periodEnd] = chosenPeriod.split('/')

  const totals: string[] = []
  const totalLabel = out.kind === 'imss_ema' ? /\bIMPORTE TOTAL\s*:/ : /\bTOTAL A PAGAR\s*:?/
  for (let i = 0; i < lines.length; i++) {
    const label = totalLabel.exec(lines[i])
    if (!label) continue
    const tail = lines[i].slice(label.index + label[0].length)
    const candidate = tail.match(moneyPattern) ? tail : /^\$?\s*-?\d/.test(lines[i + 1] || '') ? lines[i + 1] : ''
    if (/-\s*\$?\s*\d/.test(candidate)) { issue('FIELD_INVALID', 'amountMinor'); continue }
    const values = candidate.match(moneyPattern) || []
    const value = values.length ? cents(values[values.length - 1]) : null
    if (value !== null) totals.push(String(value))
  }
  const total = unique(totals, 'amountMinor')
  if (total) out.amountMinor = Number(total)

  const dates: string[] = []
  let hasDueDateLabel = false
  for (let i = 0; i < lines.length; i++) {
    const label = /(?:FECHA LIMITE DE PAGO|VIGENCIA HASTA)\s*:?/.exec(lines[i])
    if (!label) continue
    hasDueDateLabel = true
    const inline = lines[i].slice(label.index + label[0].length)
    const datedInline = /\b\d{4}-\d{2}-\d{2}\b|\b\d{2}\/\d{2}\/\d{4}\b/.test(inline)
    const tail = datedInline ? inline : lines.slice(i + 1, i + 6).join('\n')
    // Do not use process dates or infer actual payment from a due date.
    for (const m of tail.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{2})\/(\d{2})\/(\d{4})\b/g)) {
      const value = m[1] ? date(+m[1], +m[2], +m[3]) : date(+m[6], +m[5], +m[4])
      if (value) dates.push(value)
    }
  }
  out.dueDate = unique(dates, 'dueDate', hasDueDateLabel || out.kind !== 'imss_sua')

  if (out.kind === 'imss_sipare' || out.kind === 'isn_cdmx') {
    const references: string[] = []
    for (let i = 0; i < lines.length; i++) if (/LINEA DE CAPTURA/.test(lines[i])) {
      const window = lines.slice(i, i + 6).join('\n')
      const pattern = out.kind === 'imss_sipare'
        ? /\b[A-Z0-9]{8}-[A-Z0-9]{4}-[A-Z0-9]-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{7}(?:-[A-Z0-9]{7}){3}-[A-Z0-9]{4}\b/g
        : /\b88[A-Z0-9]{18}\b/g
      references.push(...(window.match(pattern) || []))
    }
    // Repeated ISN coupon is one reference. Never read its longer barcode as
    // a second obligation or recompute the printed total from its components.
    out.paymentReference = unique(references, 'paymentReference')
  }
  return out
}

export function reconcileImssDocuments(documents: ObligationDocument[], companyRfc?: string) {
  const issues: Issue[] = []
  const add = (code: string, field: string) => issues.push({ code, field })
  if (!companyRfc) add('COMPANY_RFC_REQUIRED', 'company')
  if (!documents.length || documents.some(d => !['imss_sipare', 'imss_sua', 'imss_ema'].includes(d.kind))) add('IMSS_DOCUMENT_SET_REQUIRED', 'document')
  const lines = documents.filter(d => d.kind === 'imss_sipare')
  if (lines.length !== 1) add('IMSS_SINGLE_PAYMENT_FORM_REQUIRED', 'document')
  if (new Set(documents.map(d => d.kind)).size !== documents.length) add('DUPLICATE_DOCUMENT_KIND', 'document')
  for (const doc of documents) {
    issues.push(...doc.issues)
    if (companyRfc && doc.taxpayerRfc !== compact(companyRfc)) add('COMPANY_RFC_MISMATCH', 'taxpayerRfc')
  }
  for (const field of ['taxpayerRfc', 'employerRegistration', 'periodStart', 'periodEnd', 'amountMinor'] as const) {
    if (documents.some(d => d[field] === null) || new Set(documents.map(d => d[field])).size !== 1) add('IMSS_SUPPORT_MISMATCH', field)
  }
  const dueDates = documents.map(d => d.dueDate).filter(Boolean)
  if (new Set(dueDates).size > 1) add('IMSS_SUPPORT_MISMATCH', 'dueDate')
  return { consistent: issues.length === 0, amountMinor: lines.length === 1 ? lines[0].amountMinor : null,
    // This is an input consistency check, not permission to pay/submit.
    issues: issues.filter((item, index) => issues.findIndex(other => other.code === item.code && other.field === item.field) === index) }
}
