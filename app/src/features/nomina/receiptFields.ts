import { receiptAmountMinor } from './receiptAmount.ts'

export type ReceiptFields = { amount: string; paymentDate: string; reference: string; currency: string | null }

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
const nextLabel = /\s+(?=(?:fecha|importe|monto|moneda|referencia|folio|clave de rastreo|cuenta|beneficiario|concepto|comision|iva|estado|empresa|periodo)\b\s*[^:]*:)/i

// Only labelled data is eligible. Do not infer a payment date from a payroll
// period, use the channel's expected amount, or sum individual employee rows.
function values(lines: string[], labels: RegExp[]): string[] {
  const found: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = normalize(lines[i])
    for (const label of labels) {
      for (const match of line.matchAll(new RegExp(label.source, 'gi'))) {
        const rest = line.slice(match.index! + match[0].length).replace(/^\s*[:=]\s*/, '').trim()
        const value = rest || normalize(lines[i + 1] || '')
        if (value) found.push(value.split(nextLabel)[0].trim())
      }
    }
  }
  return found
}

function choose(lines: string[], groups: RegExp[][], parse: (value: string) => string | null): string {
  for (const group of groups) {
    const candidates = values(lines, group)
    if (!candidates.length) continue
    const parsed = candidates.map(parse)
    const unique = [...new Set(parsed)]
    // A present but invalid/ambiguous explicit label must not fall back to a
    // lower-priority amount/date elsewhere in the document.
    return unique.length === 1 && unique[0] !== null ? unique[0] : ''
  }
  return ''
}

function amount(value: string): string | null {
  const clean = normalize(value).replace(/^(?:MXN|MXP|USD|EUR|M\.N\.)\s*/i, '').replace(/^\$\s*/, '')
  const match = clean.match(/^(\d[\d.,]*)(?=\s|$)/)
  if (!match) return null
  if (/\d/.test(clean.slice(match[0].length))) return null
  let decimal = match[1]
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(decimal)) decimal = decimal.replace(/,/g, '')
  else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(decimal)) decimal = decimal.replace(/\./g, '').replace(',', '.')
  else if (/^\d+,\d{1,2}$/.test(decimal)) decimal = decimal.replace(',', '.')
  const minor = receiptAmountMinor(decimal)
  return minor === null ? null : `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`
}

const months: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4,
  may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8,
  sep: 9, sept: 9, septiembre: 9, setiembre: 9, oct: 10, octubre: 10,
  nov: 11, noviembre: 11, dic: 12, diciembre: 12,
}

export function isReceiptDate(value: string): boolean {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function paymentDate(value: string): string | null {
  const text = normalize(value).toLowerCase()
  let year: string, month: string, day: string
  const iso = text.match(/^(20\d{2})[/-](\d{1,2})[/-](\d{1,2})(?=\s|$|t)/)
  const numeric = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})(?=\s|$)/)
  const named = text.match(/^(\d{1,2})(?:\s+de\s+|[ /-])([a-z]+)\.?(?:\s+de\s+|[ /-])(20\d{2})(?=\s|$)/)
  if (iso) [, year, month, day] = iso
  else if (numeric) [, day, month, year] = numeric
  else if (named && months[named[2]]) { day = named[1]; month = String(months[named[2]]); year = named[3] }
  else return null
  const result = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  return isReceiptDate(result) ? result : null
}

function reference(value: string): string | null {
  const text = normalize(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._ /-]{2,119}$/.test(text) || /^(?:no aplica|sin referencia|pendiente|n\/a)$/i.test(text)) return null
  return text
}

export function parseReceiptFields(lines: string[]): ReceiptFields {
  const parsedAmount = choose(lines, [
    [/\b(?:importe|monto)\s+total(?:\s+(?:pagado|transferido|dispersado))?\b\s*/i, /\btotal\s+(?:pagado|transferido|dispersado)\b\s*/i],
    [/\b(?:importe|monto|cantidad)(?:\s+(?:pagado|transferido|de\s+(?:la\s+)?(?:operacion|transferencia|prueba)|del\s+pago))?\b\s*/i],
    [/^total\b\s*/i],
  ], amount)
  const date = choose(lines, [
    [/\bfecha(?:\s+y\s+hora)?\s+(?:de\s+)?(?:pago|aplicacion)\b\s*/i],
    [/\bfecha(?:\s+y\s+hora)?\s+(?:de\s+)?(?:operacion|transferencia|liquidacion)\b\s*/i],
    [/^fecha(?:\s+y\s+hora)?\s*(?=[:=]|\d)/i],
  ], paymentDate)
  const ref = choose(lines, [
    [/\bclave\s+de\s+rastreo\b\s*/i],
    [/\bfolio\s+unico\b\s*/i],
    [/\breferencia(?:\s+(?:numerica|bancaria|de\s+pago))?\b\s*/i],
    [/\b(?:folio(?:\s+de\s+internet)?|numero\s+de\s+operacion|autorizacion)\b\s*/i],
  ], reference)
  const currencyCodes = [...new Set(lines.flatMap((line) => normalize(line).match(/\b(?:MXN|MXP|USD|EUR)\b/gi) || []).map((code) => code.toUpperCase().replace('MXP', 'MXN')))]
  return { amount: parsedAmount, paymentDate: date, reference: ref, currency: currencyCodes.length === 1 ? currencyCodes[0] : currencyCodes.length > 1 ? 'AMBIGUOUS' : null }
}
