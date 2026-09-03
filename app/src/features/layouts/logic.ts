// Lógica pura de Layouts de pago, portada 1:1 de layouts.js
// (+ helpers de layouts_result_extension.js). Aquí viven los generadores de
// archivos bancarios BBVA (PAGOSBBV / PAGOSINT / CIE): fidelidad
// carácter-a-carácter — anchos, relleno, orden y separadores exactos.

import type { BadgeVariant } from '../../components/ui/Badge'
import type {
  PaymentLayout, PaymentLayoutLine, CompanyBankAccount, BbvaFormat, PreviewRow,
  FormatSummary, FormatSummaryItem, LayoutValidation, BbvaFile, InvalidLine, NotIncludedItem,
} from './types'

// ── Constantes de formato (idénticas a layouts.js) ─────────────────────────
export const CXC_FILE_EXTENSION = 'txt'
export const CXC_MIME_TYPE = 'text/plain;charset=utf-8'
export const CXC_CURRENCY = 'MXP'
export const CXC_ACCOUNT_LENGTH = 18
export const CXC_CURRENCY_LENGTH = 3
export const CXC_AMOUNT_LENGTH = 16
export const CXC_CONCEPT_LENGTH = 30
export const CXC_LINE_LENGTH = CXC_ACCOUNT_LENGTH * 2 + CXC_CURRENCY_LENGTH + CXC_AMOUNT_LENGTH + CXC_CONCEPT_LENGTH
export const CXC_LINE_BREAK = '\r\n'
export const CXC_LINE_PATTERN = /^\d{18}\d{18}MXP\d{13}\.\d{2}[A-Z0-9 .,&/-]{30}$/

export const BBVA_FORMAT_SAME_BANK: BbvaFormat = 'same_bank'
export const BBVA_FORMAT_INTERBANK: BbvaFormat = 'interbank'
export const BBVA_FORMAT_CIE: BbvaFormat = 'cie'

export const BBVA_INTERBANK_BENEFICIARY_LENGTH = 30
export const BBVA_INTERBANK_REFERENCE_LENGTH = 5
export const BBVA_INTERBANK_REFERENCE_INPUT_RULE = '1 a 5 digitos; el TXT completa con ceros a la izquierda'
export const BBVA_INTERBANK_CONCEPT_LENGTH = 37
export const BBVA_INTERBANK_INDICATOR = 'H'
export const BBVA_INTERBANK_LINE_LENGTH =
  CXC_ACCOUNT_LENGTH * 2 + CXC_CURRENCY_LENGTH + CXC_AMOUNT_LENGTH +
  BBVA_INTERBANK_BENEFICIARY_LENGTH + BBVA_INTERBANK_REFERENCE_LENGTH + BBVA_INTERBANK_CONCEPT_LENGTH + 1
export const BBVA_INTERBANK_LINE_PATTERN = /^\d{18}\d{18}MXP\d{13}\.\d{2}[A-Z0-9 .,&/-]{30}\d{5}[A-Z0-9 .,&/-]{37}H$/

export const BBVA_CIE_CONCEPT_LENGTH = 30
export const BBVA_CIE_CONVENIO_LENGTH = 7
export const BBVA_CIE_REFERENCE_LENGTH = 20
export const BBVA_CIE_LINE_LENGTH =
  BBVA_CIE_CONCEPT_LENGTH + BBVA_CIE_CONVENIO_LENGTH + CXC_ACCOUNT_LENGTH + CXC_AMOUNT_LENGTH +
  BBVA_CIE_CONCEPT_LENGTH + BBVA_CIE_REFERENCE_LENGTH
// eslint-disable-next-line no-control-regex
export const BBVA_CIE_LINE_PATTERN = /^[\x20-\x7e]{30}\d{7}\d{18}\d{13}\.\d{2}[\x20-\x7e]{30}[\x20-\x7e]{20}$/
export const BBVA_CIE_TRASH_CHARACTERS = 'áéíóúÁÉÍÓÚ.ñÑ!#$%&/()=\'?¿¡'
export const BBVA_CIE_REPLACEMENT_CHARACTERS = 'aeiouAEIOU nN             '

// ── Utilidades base ────────────────────────────────────────────────────────
export function numberValue(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
export function notBlank(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== ''
}
export function cleanText(value: unknown): string {
  return String(value ?? '').trim()
}

export function normalizeCxcText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 .,&/\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function cxcDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

export function sanitizeCxcFileToken(value: unknown): string {
  const token = normalizeCxcText(value).replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return token || 'LAYOUT'
}

// ── Detección de formato ───────────────────────────────────────────────────
export function normalizeDestinationType(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export const BBVA_CLABE_BANK_CODE = '012'

export function isBbvaDestinationClabe(value: unknown): boolean {
  const digits = cxcDigits(value)
  return digits.length === CXC_ACCOUNT_LENGTH && digits.startsWith(BBVA_CLABE_BANK_CODE)
}

export function detectBbvaLayoutFormat(line: Pick<PaymentLayoutLine, 'destination_type' | 'destination_value'>): BbvaFormat {
  const type = normalizeDestinationType(line.destination_type)
  if (['cuenta', 'cuenta_bancaria', 'cuenta_bbva', 'mismo_banco', 'bbva'].includes(type)) return BBVA_FORMAT_SAME_BANK
  // Una CLABE 012 pertenece a BBVA. Enviarla en PAGOSINT provoca que
  // Net Cash la busque como banco interbancario para un registro de misma institución.
  if (type === 'clabe' && isBbvaDestinationClabe(line.destination_value)) return BBVA_FORMAT_SAME_BANK
  if (['clabe', 'interbancario', 'transferencia_interbancaria', 'tarjeta', 'tdc'].includes(type)) return BBVA_FORMAT_INTERBANK
  if (type === 'convenio') return BBVA_FORMAT_CIE
  throw new Error('Tipo de destino no soportado para layout BBVA; define cuenta, CLABE o convenio.')
}

export function bbvaFormatLabel(format: BbvaFormat | string): string {
  if (format === BBVA_FORMAT_INTERBANK) return 'PAGOSINT'
  if (format === BBVA_FORMAT_CIE) return 'CIE'
  return 'PAGOSBBV'
}

// ── Formateadores de campo (PAGOSBBV / PAGOSINT) ───────────────────────────
export function formatCxcAccount(value: unknown, label: string): string {
  const digits = cxcDigits(value)
  if (!digits) throw new Error(`${label} requerida`)
  if (digits.length > CXC_ACCOUNT_LENGTH) throw new Error(`${label} excede ${CXC_ACCOUNT_LENGTH} digitos`)
  return digits.padStart(CXC_ACCOUNT_LENGTH, '0')
}

export function formatCxcAmount(value: unknown): string {
  const text = numberValue(value).toFixed(2)
  if (text.length > CXC_AMOUNT_LENGTH) throw new Error('monto excede 16 caracteres')
  return text
}

export function formatBbvaText(value: unknown, length: number, label: string): string {
  const text = normalizeCxcText(value)
  if (!text) throw new Error(`${label} requerido`)
  return text.slice(0, length).padEnd(length, ' ')
}

export function formatBbvaReference(value: unknown): string {
  const digits = cxcDigits(value)
  if (!digits) throw new Error('referencia numerica PAGOSINT requerida')
  if (digits.length > BBVA_INTERBANK_REFERENCE_LENGTH) throw new Error('referencia numerica PAGOSINT acepta maximo 5 digitos')
  return digits.padStart(BBVA_INTERBANK_REFERENCE_LENGTH, '0')
}

// ── Formateadores CIE ──────────────────────────────────────────────────────
export function formatBbvaCieConvenio(value: unknown): string {
  const input = String(value ?? '').trim()
  if (!/^\d{6,7}$/.test(input)) throw new Error('convenio CIE debe contener 6 o 7 digitos')
  return input.padStart(BBVA_CIE_CONVENIO_LENGTH, '0')
}

export function formatBbvaCieSourceAccount(value: unknown): string {
  const input = String(value ?? '').trim()
  if (!/^\d+$/.test(input)) throw new Error('cuenta origen CIE debe ser numerica')
  if (input.length === CXC_ACCOUNT_LENGTH) {
    if (!/^0{8}\d{10}$/.test(input)) throw new Error('cuenta origen CIE normalizada no representa una entrada de 9 o 10 digitos')
    return input
  }
  if (![9, 10].includes(input.length)) throw new Error('cuenta origen CIE debe contener 9 o 10 digitos')
  return input.padStart(CXC_ACCOUNT_LENGTH, '0')
}

export function formatBbvaCieAmount(value: unknown): string {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('importe CIE debe ser numerico y mayor a cero')
  const text = amount.toFixed(2)
  if (!/^\d{1,13}\.\d{2}$/.test(text)) throw new Error('importe CIE excede la mascara 0000000000000.00')
  return text.padStart(CXC_AMOUNT_LENGTH, '0')
}

export function replaceBbvaCieTrash(value: unknown): string {
  const replacements = new Map(
    Array.from(BBVA_CIE_TRASH_CHARACTERS, (character, index) => [
      character,
      BBVA_CIE_REPLACEMENT_CHARACTERS[index],
    ] as const),
  )
  return Array.from(String(value ?? ''), (character) => replacements.get(character) ?? character).join('')
}

export function normalizeBbvaCieText(value: unknown): string {
  return replaceBbvaCieTrash(value).toUpperCase()
}

export function formatBbvaCieText(value: unknown, length: number, label: string): string {
  const replaced = replaceBbvaCieTrash(value)
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7e]/.test(replaced)) throw new Error(`${label} contiene caracteres fuera del contrato ASCII portable`)
  const text = replaced.toUpperCase()
  if (!text.trim()) throw new Error(`${label} requerido`)
  if (text.includes('|')) throw new Error(`${label} contiene caracter | no permitido`)
  return text.slice(0, length).padEnd(length, ' ')
}

// ── Serializadores de registro ─────────────────────────────────────────────
export function buildBbvaSameBankRecord85(line: PaymentLayoutLine): string {
  const row = [
    formatCxcAccount(line.destination_value, 'cuenta destino'),
    formatCxcAccount(line.source_account_number, 'cuenta origen'),
    CXC_CURRENCY,
    formatCxcAmount(line.amount).padStart(CXC_AMOUNT_LENGTH, '0'),
    formatBbvaText(line.payment_concept, CXC_CONCEPT_LENGTH, 'concepto PAGOSBBV'),
  ].join('')

  if (row.length !== CXC_LINE_LENGTH) throw new Error(`cxc_line_length_invalid_${row.length}`)
  if (!CXC_LINE_PATTERN.test(row)) throw new Error('cxc_line_invalid_characters')
  return row
}

export function buildBbvaInterbankRecord128(line: PaymentLayoutLine): string {
  const row = [
    formatCxcAccount(line.destination_value, 'cuenta destino interbancaria'),
    formatCxcAccount(line.source_account_number, 'cuenta origen'),
    CXC_CURRENCY,
    formatCxcAmount(line.amount).padStart(CXC_AMOUNT_LENGTH, '0'),
    formatBbvaText(line.beneficiary_name, BBVA_INTERBANK_BENEFICIARY_LENGTH, 'titular PAGOSINT'),
    formatBbvaReference(line.payment_reference),
    formatBbvaText(line.payment_concept, BBVA_INTERBANK_CONCEPT_LENGTH, 'motivo PAGOSINT'),
    BBVA_INTERBANK_INDICATOR,
  ].join('')

  if (row.length !== BBVA_INTERBANK_LINE_LENGTH) throw new Error(`bbva_interbank_line_length_invalid_${row.length}`)
  if (!BBVA_INTERBANK_LINE_PATTERN.test(row)) throw new Error('bbva_interbank_line_invalid_characters')
  return row
}

export function serializeBbvaCieLine(line: PaymentLayoutLine): string {
  const concept = formatBbvaCieText(line.payment_concept, BBVA_CIE_CONCEPT_LENGTH, 'concepto CIE')
  const row = [
    concept,
    formatBbvaCieConvenio(line.convenio_number),
    formatBbvaCieSourceAccount(line.source_account_number),
    formatBbvaCieAmount(line.amount),
    concept,
    formatBbvaCieText(line.payment_reference, BBVA_CIE_REFERENCE_LENGTH, 'referencia CIE'),
  ].join('')

  if (row.length !== BBVA_CIE_LINE_LENGTH) throw new Error(`cie_line_length_invalid_${row.length}`)
  if (row.includes('|')) throw new Error('registro CIE contiene caracter | no permitido')
  if (!BBVA_CIE_LINE_PATTERN.test(row)) throw new Error('cie_line_invalid_characters')
  return row
}

// ── Construcción de contenido ──────────────────────────────────────────────
export function buildBbvaContent(lines: PaymentLayoutLine[], recordBuilder: (line: PaymentLayoutLine) => string): string {
  const rows = lines.map(recordBuilder)
  return rows.length ? `${rows.join(CXC_LINE_BREAK)}${CXC_LINE_BREAK}` : ''
}
export function buildCxcContent(lines: PaymentLayoutLine[]): string {
  return buildBbvaContent(lines, buildBbvaSameBankRecord85)
}
export function buildBbvaInterbankContent(lines: PaymentLayoutLine[]): string {
  return buildBbvaContent(lines, buildBbvaInterbankRecord128)
}
export function buildBbvaCieContent(lines: PaymentLayoutLine[]): string {
  return buildBbvaContent(lines, serializeBbvaCieLine)
}

// ── Parsers de línea ───────────────────────────────────────────────────────
export function parseCxcLine(line: string) {
  return {
    destinationAccount: line.slice(0, 18),
    sourceAccount: line.slice(18, 36),
    currency: line.slice(36, 39),
    amount: line.slice(39, 55),
    concept: line.slice(55, 85),
  }
}
export function parseBbvaInterbankLine(line: string) {
  return {
    destinationAccount: line.slice(0, 18),
    sourceAccount: line.slice(18, 36),
    currency: line.slice(36, 39),
    amount: line.slice(39, 55),
    beneficiary: line.slice(55, 85),
    numericReference: line.slice(85, 90),
    concept: line.slice(90, 127),
    indicator: line.slice(127, 128),
  }
}
export function parseBbvaCieLine(line: string) {
  return {
    concept: line.slice(0, 30),
    convenio: line.slice(30, 37),
    sourceAccount: line.slice(37, 55),
    amount: line.slice(55, 71),
    reason: line.slice(71, 101),
    reference: line.slice(101, 121),
  }
}

// ── Validación por campo ───────────────────────────────────────────────────
function validateBbvaSameBankFields(line: string, lineNumber: number, errors: string[]) {
  const fields = parseCxcLine(line)
  if (!/^\d{18}$/.test(fields.destinationAccount)) errors.push(`Layout invalido: cuenta destino de linea ${lineNumber} debe tener 18 digitos sin espacios.`)
  if (!/^\d{18}$/.test(fields.sourceAccount)) errors.push(`Layout invalido: cuenta origen de linea ${lineNumber} debe tener 18 digitos sin espacios.`)
  if (fields.currency !== CXC_CURRENCY) errors.push(`Layout invalido: moneda de linea ${lineNumber} debe ser ${CXC_CURRENCY}.`)
  if (!/^\d{13}\.\d{2}$/.test(fields.amount)) errors.push(`Layout invalido: importe de linea ${lineNumber} debe medir 16 caracteres con punto decimal y 2 decimales.`)
  if (!/^[A-Z0-9 .,&/-]{30}$/.test(fields.concept)) errors.push(`Layout invalido: concepto de linea ${lineNumber} contiene caracteres no permitidos.`)
}

function validateBbvaInterbankFields(line: string, lineNumber: number, errors: string[]) {
  const fields = parseBbvaInterbankLine(line)
  if (!/^\d{18}$/.test(fields.destinationAccount)) errors.push(`Layout PAGOSINT invalido: cuenta destino de linea ${lineNumber} debe tener 18 digitos sin espacios.`)
  if (!/^\d{18}$/.test(fields.sourceAccount)) errors.push(`Layout PAGOSINT invalido: cuenta origen de linea ${lineNumber} debe tener 18 digitos sin espacios.`)
  if (fields.currency !== CXC_CURRENCY) errors.push(`Layout PAGOSINT invalido: moneda de linea ${lineNumber} debe ser ${CXC_CURRENCY}.`)
  if (!/^\d{13}\.\d{2}$/.test(fields.amount)) errors.push(`Layout PAGOSINT invalido: importe de linea ${lineNumber} debe medir 16 caracteres con punto decimal y 2 decimales.`)
  if (!/^[A-Z0-9 .,&/-]{30}$/.test(fields.beneficiary)) errors.push(`Layout PAGOSINT invalido: titular de linea ${lineNumber} contiene caracteres no permitidos.`)
  if (!/^\d{5}$/.test(fields.numericReference)) errors.push(`Layout PAGOSINT invalido: referencia numerica de linea ${lineNumber} debe ocupar 5 posiciones numericas; ${BBVA_INTERBANK_REFERENCE_INPUT_RULE}.`)
  if (!/^[A-Z0-9 .,&/-]{37}$/.test(fields.concept)) errors.push(`Layout PAGOSINT invalido: motivo de linea ${lineNumber} contiene caracteres no permitidos.`)
  if (fields.indicator !== BBVA_INTERBANK_INDICATOR) errors.push(`Layout PAGOSINT invalido: indicador de linea ${lineNumber} debe ser ${BBVA_INTERBANK_INDICATOR}.`)
}

function validateBbvaCieFields(line: string, lineNumber: number, errors: string[]) {
  const fields = parseBbvaCieLine(line)
  // eslint-disable-next-line no-control-regex
  if (!/^[\x20-\x7e]{30}$/.test(fields.concept)) errors.push(`Layout CIE invalido: concepto inicial de linea ${lineNumber} no cumple 30 posiciones ASCII.`)
  if (!/^\d{7}$/.test(fields.convenio)) errors.push(`Layout CIE invalido: convenio de linea ${lineNumber} debe ocupar 7 posiciones numericas.`)
  if (!/^\d{18}$/.test(fields.sourceAccount)) errors.push(`Layout CIE invalido: cuenta origen de linea ${lineNumber} debe ocupar 18 posiciones numericas.`)
  if (!/^\d{13}\.\d{2}$/.test(fields.amount)) errors.push(`Layout CIE invalido: importe de linea ${lineNumber} debe cumplir 0000000000000.00.`)
  if (fields.reason !== fields.concept) errors.push(`Layout CIE invalido: concepto duplicado de linea ${lineNumber} no coincide.`)
  // eslint-disable-next-line no-control-regex
  if (!/^[\x20-\x7e]{20}$/.test(fields.reference)) errors.push(`Layout CIE invalido: referencia de linea ${lineNumber} no cumple 20 posiciones ASCII.`)
}

type ContentValidatorOptions = {
  formatLabel: string
  lineLength: number
  linePattern: RegExp
  validateLine: (line: string, lineNumber: number, errors: string[]) => void
}

export function validateBbvaContent(content: string, options: ContentValidatorOptions): LayoutValidation {
  const errors: string[] = []
  const hasContent = typeof content === 'string' && content.length > 0
  const hasFinalTerminator = hasContent && content.endsWith(CXC_LINE_BREAK)
  const hasDoubleFinalTerminator = hasContent && content.endsWith(`${CXC_LINE_BREAK}${CXC_LINE_BREAK}`)

  if (!hasContent) errors.push(`Layout ${options.formatLabel} invalido: el archivo no tiene lineas para descargar.`)
  if (hasContent && content.charCodeAt(0) === 0xfeff) errors.push(`Layout ${options.formatLabel} invalido: el archivo tiene BOM al inicio.`)
  if (hasContent && (content.startsWith('\r') || content.startsWith('\n'))) errors.push(`Layout ${options.formatLabel} invalido: existe una linea vacia al inicio del archivo.`)
  if (hasContent && !hasFinalTerminator) errors.push(`Layout ${options.formatLabel} invalido: el ultimo registro debe cerrar con CRLF.`)
  if (hasDoubleFinalTerminator) errors.push(`Layout ${options.formatLabel} invalido: existe una linea vacia real al final del archivo.`)
  if (hasContent && content.includes('|')) errors.push(`Layout ${options.formatLabel} invalido: el archivo contiene el separador | y debe ser ancho fijo.`)

  const contentWithoutCrLf = hasContent ? content.split(CXC_LINE_BREAK).join('') : ''
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u00a0\u2000-\u200f\u2028\u2029\ufeff]/.test(contentWithoutCrLf)) {
    errors.push(`Layout ${options.formatLabel} invalido: el archivo contiene caracteres invisibles o no permitidos.`)
  }
  if (/[\r\n]/.test(contentWithoutCrLf)) {
    errors.push(`Layout ${options.formatLabel} invalido: los saltos de linea deben ser CRLF.`)
  }

  const body = hasContent && hasFinalTerminator ? content.slice(0, -CXC_LINE_BREAK.length) : content || ''
  const lines = body ? body.split(CXC_LINE_BREAK) : []
  const lineLengths = lines.map((line) => line.length)

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    if (!line) {
      errors.push(`Layout ${options.formatLabel} invalido: linea ${lineNumber} esta vacia.`)
      return
    }
    if (line.length !== options.lineLength) {
      errors.push(`Layout ${options.formatLabel} invalido: linea ${lineNumber} tiene longitud ${line.length}, esperada ${options.lineLength}.`)
    }
    options.validateLine(line, lineNumber, errors)
    if (!options.linePattern.test(line)) errors.push(`Layout ${options.formatLabel} invalido: linea ${lineNumber} no cumple la estructura esperada.`)
  })

  return {
    ok: errors.length === 0,
    errors,
    lines,
    lineCount: lines.length,
    lineLengths,
    hasFinalTerminator,
    hasDoubleFinalTerminator,
    byteLength: content ? (typeof TextEncoder === 'function' ? new TextEncoder().encode(content).length : content.length) : 0,
  }
}

export function validateCxcContent(content: string): LayoutValidation {
  return validateBbvaContent(content, { formatLabel: 'PAGOSBBV', lineLength: CXC_LINE_LENGTH, linePattern: CXC_LINE_PATTERN, validateLine: validateBbvaSameBankFields })
}
export function validateBbvaInterbankContent(content: string): LayoutValidation {
  return validateBbvaContent(content, { formatLabel: 'PAGOSINT', lineLength: BBVA_INTERBANK_LINE_LENGTH, linePattern: BBVA_INTERBANK_LINE_PATTERN, validateLine: validateBbvaInterbankFields })
}
export function validateBbvaCieContent(content: string): LayoutValidation {
  return validateBbvaContent(content, { formatLabel: 'CIE', lineLength: BBVA_CIE_LINE_LENGTH, linePattern: BBVA_CIE_LINE_PATTERN, validateLine: validateBbvaCieFields })
}

// ── Nombre de archivo ──────────────────────────────────────────────────────
export function buildBbvaFileName(layout: Pick<PaymentLayout, 'layout_number' | 'name'>, format: BbvaFormat): string {
  const folio = sanitizeCxcFileToken(layout.layout_number || layout.name || 'LAYOUT')
  const today = new Date().toISOString().slice(0, 10).split('-').join('')
  const prefix = format === BBVA_FORMAT_INTERBANK ? 'PAGOSINT' : format === BBVA_FORMAT_CIE ? 'PAGOSCIE' : 'PAGOSBBV'
  return `${prefix}_FLUX_${folio}_${today}.${CXC_FILE_EXTENSION}`
}

export function mergeLayoutFileName(currentValue: string | null | undefined, nextFileName: string): string {
  const names = String(currentValue || '')
    .split(' + ')
    .map((item) => item.trim())
    .filter(Boolean)
  if (!names.includes(nextFileName)) names.push(nextFileName)
  return names.join(' + ') || nextFileName
}

// ── Construcción de todos los archivos de un layout ────────────────────────
export function buildBbvaLayoutFiles(lines: PaymentLayoutLine[], layout: Pick<PaymentLayout, 'layout_number' | 'name'>): BbvaFile[] {
  const groups = new Map<BbvaFormat, PaymentLayoutLine[]>([
    [BBVA_FORMAT_SAME_BANK, []],
    [BBVA_FORMAT_INTERBANK, []],
    [BBVA_FORMAT_CIE, []],
  ])

  lines.forEach((line) => {
    const format = detectBbvaLayoutFormat(line)
    groups.get(format)!.push(line)
  })

  return Array.from(groups.entries())
    .filter(([, groupLines]) => groupLines.length)
    .map(([format, groupLines]) => {
      let content: string
      let validation: LayoutValidation
      let lineLength: number

      if (format === BBVA_FORMAT_SAME_BANK) {
        content = buildCxcContent(groupLines)
        validation = validateCxcContent(content)
        lineLength = CXC_LINE_LENGTH
      } else if (format === BBVA_FORMAT_INTERBANK) {
        content = buildBbvaInterbankContent(groupLines)
        validation = validateBbvaInterbankContent(content)
        lineLength = BBVA_INTERBANK_LINE_LENGTH
      } else {
        content = buildBbvaCieContent(groupLines)
        validation = validateBbvaCieContent(content)
        lineLength = BBVA_CIE_LINE_LENGTH
      }

      return { format, label: bbvaFormatLabel(format), fileName: buildBbvaFileName(layout, format), content, validation, lineLength }
    })
}

// ── Validación de líneas (pre-generación) ──────────────────────────────────
export function collectBbvaCieLineIssues(line: PaymentLayoutLine): string[] {
  const issues: string[] = []
  const checks = [
    () => formatBbvaCieSourceAccount(line.source_account_number),
    () => formatBbvaCieConvenio(line.convenio_number),
    () => formatBbvaCieAmount(line.amount),
    () => formatBbvaCieText(line.payment_concept, BBVA_CIE_CONCEPT_LENGTH, 'concepto CIE'),
    () => formatBbvaCieText(line.payment_reference, BBVA_CIE_REFERENCE_LENGTH, 'referencia CIE'),
  ]
  checks.forEach((check) => {
    try { check() } catch (error: any) { issues.push(error.message) }
  })
  return issues
}

export function validateLayoutLines(lines: PaymentLayoutLine[]): InvalidLine[] {
  return lines
    .filter((line) => line.status !== 'bank_rejected')
    .map((line): InvalidLine => {
      const missing: string[] = []
      let format: BbvaFormat | null = null

      try { format = detectBbvaLayoutFormat(line) } catch (error: any) { missing.push(error.message) }

      if (format === BBVA_FORMAT_CIE) {
        missing.push(...collectBbvaCieLineIssues(line))
        return { line_id: line.id, payment_request_id: line.payment_request_id, request_number: line.request_number, missing_fields: missing }
      }

      const sourceDigits = cxcDigits(line.source_account_number)
      const destinationDigits = cxcDigits(line.destination_value)
      const amount = numberValue(line.amount)
      const amountText = formatCxcAmount(line.amount)
      const conceptText = normalizeCxcText(line.payment_concept)
      const beneficiaryText = normalizeCxcText(line.beneficiary_name)
      const referenceDigits = cxcDigits(line.payment_reference)

      if (!sourceDigits) missing.push('cuenta origen requerida')
      else if (sourceDigits.length > CXC_ACCOUNT_LENGTH) missing.push('cuenta origen excede 18 digitos')

      if (!destinationDigits) missing.push('cuenta destino requerida')
      else if (destinationDigits.length > CXC_ACCOUNT_LENGTH) missing.push('cuenta destino excede 18 digitos')

      if (!amount) missing.push('monto requerido')
      else if (amountText.length > CXC_AMOUNT_LENGTH) missing.push('monto excede 16 caracteres')

      if (!notBlank(line.payment_concept)) missing.push('concepto requerido')
      else if (!conceptText) missing.push('concepto sin caracteres validos para BBVA')

      if (format === BBVA_FORMAT_INTERBANK) {
        if (!notBlank(line.beneficiary_name)) missing.push('titular requerido para PAGOSINT')
        else if (!beneficiaryText) missing.push('titular sin caracteres validos para PAGOSINT')
        if (!referenceDigits) missing.push('referencia numerica requerida para PAGOSINT')
        else if (referenceDigits.length > BBVA_INTERBANK_REFERENCE_LENGTH) missing.push('referencia numerica para PAGOSINT acepta maximo 5 digitos')
      }

      return { line_id: line.id, payment_request_id: line.payment_request_id, request_number: line.request_number, missing_fields: missing }
    })
    .filter((item) => item.missing_fields.length)
}

export function invalidLineNeedsPagosintReference(item: { missing_fields?: string[] } | null | undefined): boolean {
  const missing = item?.missing_fields || []
  return missing.some((field) => String(field).includes('referencia numerica') && String(field).includes('PAGOSINT'))
}

export function formatInvalidLayoutLineMessage(item: InvalidLine): string {
  const request = item.request_number || item.payment_request_id || 'la solicitud'
  const missing = item.missing_fields || []
  if (invalidLineNeedsPagosintReference(item)) {
    return `La solicitud ${request} requiere referencia numerica para generar PAGOSINT. Da clic en Completar referencia.`
  }
  return `No se puede generar el archivo BBVA. Solicitud ${request}: ${missing.join(', ')}.`
}

// ── Resumen de formatos ────────────────────────────────────────────────────
export function summarizeLayoutFormats(lines: PaymentLayoutLine[]): FormatSummary {
  const summary: FormatSummary = {
    [BBVA_FORMAT_SAME_BANK]: { key: BBVA_FORMAT_SAME_BANK, label: 'PAGOSBBV', count: 0, amount: 0, referenceIssues: 0, validationIssues: 0 },
    [BBVA_FORMAT_INTERBANK]: { key: BBVA_FORMAT_INTERBANK, label: 'PAGOSINT', count: 0, amount: 0, referenceIssues: 0, validationIssues: 0 },
    [BBVA_FORMAT_CIE]: { key: BBVA_FORMAT_CIE, label: 'CIE', count: 0, amount: 0, referenceIssues: 0, validationIssues: 0 },
    unsupported: { key: 'unsupported', label: 'No soportado', count: 0, amount: 0, referenceIssues: 0, validationIssues: 0 },
  }

  for (const line of lines || []) {
    if (line.status === 'bank_rejected') continue
    const amount = numberValue(line.amount)
    try {
      const format = detectBbvaLayoutFormat(line)
      summary[format].count += 1
      summary[format].amount += amount
      if (format === BBVA_FORMAT_INTERBANK && lineNeedsPagosintReferenceCompletion(line)) summary[format].referenceIssues += 1
      if (format === BBVA_FORMAT_CIE && collectBbvaCieLineIssues(line).length) summary[format].validationIssues += 1
    } catch {
      summary.unsupported.count += 1
      summary.unsupported.amount += amount
    }
  }

  return summary
}

// ── PAGOSINT: detección de líneas a completar ──────────────────────────────
export function isPagosintLine(line: PaymentLayoutLine): boolean {
  try { return detectBbvaLayoutFormat(line) === BBVA_FORMAT_INTERBANK } catch { return false }
}

export function lineNeedsPagosintReferenceCompletion(line: PaymentLayoutLine): boolean {
  if (line.status !== 'included' || !isPagosintLine(line)) return false
  const referenceDigits = cxcDigits(line.payment_reference)
  return !referenceDigits || referenceDigits.length > BBVA_INTERBANK_REFERENCE_LENGTH
}

export function pagosintLineIssues(line: PaymentLayoutLine): string[] {
  const issues: string[] = []
  const referenceDigits = cxcDigits(line.payment_reference)
  if (!referenceDigits) issues.push('referencia numerica')
  else if (referenceDigits.length > BBVA_INTERBANK_REFERENCE_LENGTH) issues.push('referencia numerica mayor a 5 digitos')
  if (!notBlank(line.beneficiary_name) || !normalizeCxcText(line.beneficiary_name)) issues.push('titular')
  if (!notBlank(line.payment_concept) || !normalizeCxcText(line.payment_concept)) issues.push('motivo')
  return issues
}

export function lineNeedsPagosintCompletion(line: PaymentLayoutLine): boolean {
  if (line.status !== 'included' || !isPagosintLine(line)) return false
  return pagosintLineIssues(line).length > 0
}

// ── Máscaras / display ─────────────────────────────────────────────────────
export function maskSensitiveSuffix(value: unknown, visible = 4): string {
  const text = String(value || '')
  return text ? `****${text.slice(-visible)}` : '****'
}

export function maskCxcLine(line: string): string {
  const fields = parseCxcLine(line.padEnd(CXC_LINE_LENGTH, ' '))
  const mask = (value: string) => (value ? `****${String(value).slice(-4)}` : '****')
  return [
    `destino ${mask(fields.destinationAccount)}`,
    `origen ${mask(fields.sourceAccount)}`,
    `moneda ${fields.currency || '---'}`,
    `importe ${fields.amount || '---'}`,
    `concepto ${fields.concept.trim().slice(0, 18) || '---'}`,
  ].join(' | ')
}

export function maskBbvaLine(line: string, format: BbvaFormat | string): string {
  if (format === BBVA_FORMAT_CIE) {
    const fields = parseBbvaCieLine(line.padEnd(BBVA_CIE_LINE_LENGTH, ' '))
    return [
      `convenio ${maskSensitiveSuffix(fields.convenio, 2)}`,
      `origen ${maskSensitiveSuffix(fields.sourceAccount, 4)}`,
      `importe ${fields.amount || '---'}`,
      `concepto ${fields.concept.trim().slice(0, 18) || '---'}`,
      `ref ${maskSensitiveSuffix(fields.reference.trim(), 3)}`,
    ].join(' | ')
  }
  if (format === BBVA_FORMAT_INTERBANK) {
    const fields = parseBbvaInterbankLine(line.padEnd(BBVA_INTERBANK_LINE_LENGTH, ' '))
    const mask = (value: string) => (value ? `****${String(value).slice(-4)}` : '****')
    return [
      `destino ${mask(fields.destinationAccount)}`,
      `origen ${mask(fields.sourceAccount)}`,
      `moneda ${fields.currency || '---'}`,
      `importe ${fields.amount || '---'}`,
      `titular ${fields.beneficiary.trim().slice(0, 18) || '---'}`,
      `ref ${fields.numericReference || '---'}`,
      `motivo ${fields.concept.trim().slice(0, 18) || '---'}`,
      `ind ${fields.indicator || '---'}`,
    ].join(' | ')
  }
  return maskCxcLine(line)
}

export function layoutSourceAccountDisplay(line: PaymentLayoutLine): string {
  return normalizeDestinationType(line.destination_type) === 'convenio'
    ? maskSensitiveSuffix(line.source_account_number, 4)
    : line.source_account_number || ''
}

export function layoutDestinationDisplay(line: PaymentLayoutLine): string {
  return normalizeDestinationType(line.destination_type) === 'convenio'
    ? `CONVENIO ${maskSensitiveSuffix(line.convenio_number, 2)}`
    : line.destination_value || ''
}

// ── Campos faltantes / etiquetas de preview ────────────────────────────────
export function requestOwnedLayoutFields(): string[] {
  return [
    'scheduled_payment_date', 'company_bank_account_id', 'company_bank_account_id_not_found',
    'company_bank_account_company_mismatch', 'company_bank_account_inactive', 'source_account_number',
    'source_account_number_invalid', 'payment_reference', 'payment_reference_invalid',
    'payment_concept', 'payment_concept_invalid',
  ]
}
export function providerExecutionLayoutFields(): string[] {
  return [
    'beneficiary_name', 'beneficiary_name_invalid', 'destination_type', 'destination_type_invalid',
    'clabe', 'clabe_invalid', 'cuenta_bancaria', 'cuenta_bancaria_invalid',
    'convenio_number', 'convenio_number_invalid', 'banco', 'banco_invalid',
  ]
}
export function providerRecordLayoutFields(): string[] {
  return ['proveedor_id', 'proveedor_not_found', 'proveedor_inactive']
}

export function formatMissingFields(fields: unknown): string {
  const values = Array.isArray(fields) ? fields : fields ? [fields] : ['datos incompletos']
  const labels: Record<string, string> = {
    payment_reference: 'referencia de pago requerida',
    payment_concept: 'concepto de pago requerido',
    company_bank_account_id: 'cuenta origen requerida',
    company_bank_account_id_not_found: 'cuenta origen no encontrada',
    company_bank_account_company_mismatch: 'la cuenta origen no pertenece a la empresa',
    company_bank_account_inactive: 'cuenta origen inactiva',
    source_account_number: 'numero de cuenta origen requerido',
    source_account_number_invalid: 'numero de cuenta origen invalido',
    scheduled_payment_date: 'fecha programada requerida',
    company_id: 'empresa requerida',
    company_not_found: 'empresa no encontrada',
    company_inactive: 'empresa inactiva',
    company_name: 'nombre de empresa requerido',
    proveedor_id: 'proveedor requerido',
    proveedor_not_found: 'proveedor no encontrado',
    proveedor_inactive: 'proveedor inactivo',
    beneficiary_name: 'beneficiario requerido',
    beneficiary_name_invalid: 'beneficiario invalido',
    destination_type: 'tipo de cuenta destino requerido',
    destination_type_invalid: 'tipo de cuenta destino invalido',
    clabe: 'CLABE del proveedor requerida',
    clabe_invalid: 'CLABE del proveedor invalida',
    cuenta_bancaria: 'cuenta del proveedor requerida',
    cuenta_bancaria_invalid: 'cuenta del proveedor invalida',
    convenio_number: 'numero de convenio requerido',
    convenio_number_invalid: 'numero de convenio invalido',
    banco: 'banco del proveedor requerido',
    banco_invalid: 'banco del proveedor invalido',
    payment_reference_invalid: 'referencia de pago invalida',
    payment_concept_invalid: 'concepto de pago invalido',
    unsupported_layout_currency: 'moneda no compatible con layout',
    invalid_amount: 'importe invalido',
    budget_revalidation_required: 'presupuesto por revalidar',
    finance_reapproval_required: 'revalidacion de presupuesto requerida',
    direction_reapproval_required: 'nueva autorizacion de Direccion requerida',
    extraordinary_reauthorization_required: 'revocar y autorizar nuevamente el extraordinario',
  }
  return values.map((field) => labels[field as string] || field || 'datos incompletos').join(', ')
}

// formatDate del vanilla layouts.js: devuelve '-' (no 'Sin fecha') para vacíos.
export function formatDate(value: unknown): string {
  if (!value) return '-'
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? '-' : new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(d)
}

export function extraordinaryCategoryLabel(value: string | null | undefined): string {
  return (({
    operational_emergency: 'Emergencia operativa / fuga',
    urgent_reimbursement: 'Reembolso urgente',
    urgent_termination: 'Desvinculacion o finiquito urgente',
    critical_service: 'Servicio critico',
    other: 'Otro',
  } as Record<string, string>)[value as string]) || value || 'Autorizado por Finanzas'
}

export function aggregatePreviewTotals(rows: PreviewRow[]): { currency: string; amount: number }[] {
  const totals = new Map<string, number>()
  rows.forEach((row) => {
    const currency = String(row.currency || 'MXN').toUpperCase()
    totals.set(currency, (totals.get(currency) || 0) + Number(row.amount || 0))
  })
  return Array.from(totals, ([currency, amount]) => ({ currency, amount }))
}

export function formatPreviewMoney(value: unknown, currency = 'MXN'): string {
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN', maximumFractionDigits: 2 }).format(Number(value || 0))
  } catch {
    return `${Number(value || 0).toFixed(2)} ${currency || 'MXN'}`
  }
}

export function layoutAccountLabel(account: CompanyBankAccount): string {
  const suffix = account.account_number ? `cta ${account.account_number}` : account.last4 ? `termina ${account.last4}` : 'sin numero'
  return [account.name || 'Cuenta origen', account.bank_name, suffix].filter(Boolean).join(' - ')
}

// ── Badges ─────────────────────────────────────────────────────────────────
// Nota: layouts_ux2_extension traduce el badge "Draft" (inglés) → "Borrador".
// Se hornea aquí. El resto de estatus ya son español en el vanilla y no se
// traducen (translateBadges no matchea sus claves).
type BadgeDesc = { label: string; variant: BadgeVariant }
export function layoutStatusBadge(status: string | null | undefined): BadgeDesc {
  const map: Record<string, [string, BadgeVariant]> = {
    draft: ['Borrador', 'warning'],
    generated: ['Generado', 'info'],
    uploaded: ['Subido', 'accent'],
    confirmed: ['Confirmado', 'success'],
    paid: ['Pagado', 'success'],
    cancelled: ['Cancelado', 'neutral'],
  }
  const [label, variant] = map[status || ''] || [status || '-', 'neutral']
  return { label, variant }
}
export function lineStatusBadge(status: string | null | undefined): BadgeDesc {
  const map: Record<string, [string, BadgeVariant]> = {
    included: ['Incluido', 'info'],
    paid: ['Pagado', 'success'],
    bank_rejected: ['Rechazado', 'danger'],
    cancelled: ['Cancelado', 'neutral'],
  }
  const [label, variant] = map[status || ''] || [status || '-', 'neutral']
  return { label, variant }
}

// ── Filtro de la tabla principal ───────────────────────────────────────────
export function filterLayouts(layouts: PaymentLayout[], query: string, status: string): PaymentLayout[] {
  const q = String(query || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  return layouts.filter((l) => {
    const searchable = String([l.layout_number, l.name, l.period_start, l.period_end, l.file_name].join(' '))
      .toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    return searchable.includes(q) && (status === 'todos' || l.status === status)
  })
}

// ── Diagnóstico "aprobadas no consideradas" (layouts_result_extension) ──────
export function statusLabelShort(status: string | null | undefined): string {
  const labels: Record<string, string> = { draft: 'borrador', generated: 'generado', uploaded: 'subido', confirmed: 'confirmado', cancelled: 'cancelado' }
  return labels[status || ''] || status || 'sin estatus'
}

export function resultFormatDate(value: unknown): string {
  if (!value) return 'sin fecha'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

type ExclusionContext = {
  periodStart: string
  periodEnd: string
  companyId: string | null
  bankAccountId: string | null
  lines: { layout_id?: string | null; layout?: { layout_number?: string | null; status?: string | null } }[]
}

export function exclusionReasons(request: NotIncludedItem['request'], context: ExclusionContext): string[] {
  const reasons: string[] = []
  const type = request.request_type || 'provider_payment'
  const effectiveDate = (request.scheduled_payment_date || request.updated_at || '').slice(0, 10)

  if (type === 'cash' || type === 'check') {
    reasons.push(type === 'cash' ? 'Es solicitud de efectivo; se opera en Efectivo y comprobaciones.' : 'Es solicitud de cheque; se opera en Efectivo y comprobaciones.')
  } else if (!['provider_payment', 'transfer', 'transferencia', '', null].includes(type)) {
    reasons.push('El tipo de solicitud no corresponde a layout de pago por transferencia.')
  }

  if (context.companyId && request.company_id !== context.companyId) {
    reasons.push('No coincide con la empresa seleccionada en el filtro.')
  }
  if (context.bankAccountId && request.company_bank_account_id !== context.bankAccountId) {
    reasons.push('No coincide con la cuenta origen seleccionada en el filtro.')
  }

  if (!effectiveDate) {
    reasons.push('No tiene fecha programada ni fecha de actualizacion para ubicarla en el periodo.')
  } else if (effectiveDate < context.periodStart || effectiveDate > context.periodEnd) {
    reasons.push(`Fuera del periodo seleccionado (${resultFormatDate(effectiveDate)}).`)
  }

  if (request.currency && request.currency !== 'MXN') {
    reasons.push('La moneda no es MXN.')
  }
  if (Number(request.amount_requested || 0) <= 0) {
    reasons.push('El monto solicitado no es mayor a cero.')
  }

  const previousLine = context.lines.find((line) => line.layout_id !== undefined)
  if (previousLine?.layout) {
    reasons.push(`Ya esta ligada al layout ${previousLine.layout.layout_number || 'sin folio'} (${statusLabelShort(previousLine.layout.status)}).`)
  }

  return reasons
}

// Etiquetas de faltantes del panel de resultado (layouts_result_extension).
export const RESULT_FIELD_LABELS: Record<string, string> = {
  company_bank_account_id: 'Falta seleccionar cuenta origen en la solicitud.',
  source_account_number: 'La cuenta origen seleccionada no tiene numero de cuenta capturado.',
  destination_type: 'Falta definir el tipo de destino de pago del proveedor: CLABE, cuenta o convenio.',
  destination_value: 'Falta capturar el destino de pago del proveedor.',
  beneficiary_name: 'Falta beneficiario para layout en el proveedor.',
  company_name: 'Falta nombre de la empresa origen.',
  proveedor_id: 'Falta proveedor en la solicitud.',
  clabe: 'El proveedor esta configurado para CLABE, pero no tiene CLABE capturada.',
  cuenta_bancaria: 'El proveedor esta configurado para cuenta bancaria, pero no tiene cuenta capturada.',
  convenio_number: 'El proveedor esta configurado para convenio, pero no tiene numero de convenio.',
  payment_reference: 'Falta referencia de pago en la solicitud.',
  payment_concept: 'Falta concepto de pago en la solicitud.',
  amount: 'Falta monto del pago.',
  amount_requested: 'Falta monto solicitado.',
}
export const RESULT_SHORT_LABELS: Record<string, string> = {
  company_bank_account_id: 'Cuenta origen',
  source_account_number: 'Numero de cuenta origen',
  destination_type: 'Tipo de destino',
  destination_value: 'Destino de pago',
  beneficiary_name: 'Beneficiario',
  company_name: 'Empresa origen',
  proveedor_id: 'Proveedor',
  clabe: 'CLABE',
  cuenta_bancaria: 'Cuenta bancaria',
  convenio_number: 'Convenio',
  payment_reference: 'Referencia de pago',
  payment_concept: 'Concepto de pago',
  amount: 'Monto',
  amount_requested: 'Monto solicitado',
}
export function resultMissingFields(fields: unknown): string[] {
  const list = Array.isArray(fields) ? fields : String(fields || 'datos incompletos').split(',')
  return list.map((field) => String(field).trim()).filter(Boolean)
}
export function humanizeField(field: string): string {
  return String(field || 'datos incompletos').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
export function resultShortLabel(field: string): string {
  return RESULT_SHORT_LABELS[field] || humanizeField(field)
}

// ── Errores ────────────────────────────────────────────────────────────────
export function friendlyError(error: any): string {
  const message = error?.message || String(error || 'Error desconocido')
  if (message.toLowerCase().includes('failed to fetch') || message.toLowerCase().includes('url scheme')) {
    return 'No se pudo conectar con Supabase. Revisa la conexion y vuelve a intentar.'
  }
  if (message.includes('cxc_line_length_invalid_')) return `Layout invalido: una linea no tiene ${CXC_LINE_LENGTH} caracteres.`
  if (message.includes('cxc_line_invalid_characters')) return 'Layout invalido: una linea contiene caracteres no permitidos.'
  if (message.toLowerCase().includes('row-level security') || error?.code === '42501') return 'La operacion fue bloqueada por RLS. Revisa policies.'
  if (message.toLowerCase().includes('permission denied')) return 'Faltan permisos para ejecutar la operacion.'
  return message
}

const KNOWN_RPC_ERRORS: Record<string, string> = {
  layout_not_found: 'No se encontro el layout.',
  actor_profile_not_found: 'No se pudo identificar el perfil del usuario.',
  registered_by_profile_not_found: 'No se pudo identificar el perfil del usuario.',
  layout_must_be_generated_first: 'Primero genera el archivo CxC BBVA antes de marcar el layout como subido.',
  invalid_layout_status_for_upload: 'El layout no esta en un estado valido para marcarse como subido.',
  invalid_layout_status_for_confirmation: 'El layout no esta en un estado valido para confirmar pago.',
  no_included_lines_to_confirm: 'No hay lineas pendientes para confirmar pago.',
  payment_date_required: 'Captura la fecha de pago.',
  line_not_found: 'No se encontro la linea del layout.',
  line_already_paid: 'La linea ya fue pagada y no puede rechazarse.',
  rejection_reason_required: 'Captura el motivo del rechazo bancario.',
  generated_by_profile_not_found: 'No se pudo identificar tu perfil de usuario.',
  no_valid_payment_requests: 'No hay solicitudes validas para este periodo.',
  period_dates_required: 'Captura fecha inicio y fecha fin.',
  invalid_period_range: 'La fecha inicio no puede ser mayor a la fecha fin.',
  company_not_found: 'La empresa seleccionada no existe.',
  company_bank_account_not_found_or_inactive: 'La cuenta origen no existe o esta inactiva.',
  company_bank_account_not_found_inactive_or_company_mismatch: 'La cuenta origen debe estar activa y pertenecer a la empresa de la solicitud.',
  finance_role_required: 'Se requiere rol de Finanzas.',
  finance_reapproval_required: 'La solicitud requiere revalidacion de presupuesto por un cambio material.',
  rebatch_correction_note_too_short: 'Explica en al menos 10 caracteres que se corrigio.',
  payment_request_in_another_open_batch: 'La solicitud ya pertenece a otro corte abierto.',
  target_batch_must_be_draft: 'El corte destino ya no esta en borrador.',
  target_batch_company_mismatch: 'El corte destino pertenece a otra empresa.',
  payment_request_already_in_target_batch: 'La solicitud ya esta en el corte destino.',
  closed_batch_authorization_required: 'El pago regular requiere aprobacion de Direccion y corte cerrado.',
  payment_request_layout_data_locked: 'La solicitud ya fue pagada o tiene una ejecucion y sus datos de layout estan bloqueados.',
  payment_reference_must_be_numeric: 'La referencia debe contener solo digitos.',
  payment_reference_too_long: 'La referencia acepta de 1 a 5 digitos.',
  payment_concept_too_long: 'El concepto acepta hasta 120 caracteres.',
  payment_concept_invalid_characters: 'El concepto contiene caracteres no permitidos.',
  payment_request_provider_not_found_or_inactive: 'El proveedor no existe o está inactivo.',
  proveedor_not_found_or_inactive: 'El proveedor no existe o está inactivo.',
  approval_material_timestamp_changed_by_execution_data: 'No se guardó: los datos operativos intentaron alterar la autorización de Dirección.',
  operational_update_changed_approval_material_timestamp: 'No se guardó: los datos operativos intentaron alterar la autorización de Dirección.',
  operational_update_invalidated_direction_approval: 'No se guardó: la autorización de Dirección no pudo conservarse.',
  payment_execution_rpc_required: 'Los datos de ejecución solo pueden modificarse mediante el flujo autorizado de Finanzas.',
  provider_payment_execution_rpc_required: 'Los datos bancarios del proveedor solo pueden modificarse mediante el flujo autorizado de Finanzas.',
  provider_payment_execution_data_invalid: 'Corrige los datos bancarios del proveedor antes de continuar.',
}

export function friendlyRpcError(error: any): string {
  const message = error?.message || String(error || 'Error desconocido')
  const key = Object.keys(KNOWN_RPC_ERRORS).find((k) => message.includes(k))
  if (key) return KNOWN_RPC_ERRORS[key]
  return friendlyError(error)
}

// friendlyError del panel de resultado (layouts_result_extension) — subconjunto.
const RESULT_KNOWN_ERRORS: Record<string, string> = {
  generated_by_profile_not_found: 'No se pudo identificar tu perfil de usuario.',
  no_valid_payment_requests: 'No hay solicitudes validas para este periodo.',
  period_dates_required: 'Captura fecha inicio y fecha fin.',
  invalid_period_range: 'La fecha inicio no puede ser mayor a la fecha fin.',
  company_not_found: 'La empresa seleccionada no existe.',
  company_bank_account_not_found_or_inactive: 'La cuenta origen no existe o esta inactiva.',
}
export function resultFriendlyError(error: any): string {
  const message = error?.message || String(error || 'Error desconocido')
  const key = Object.keys(RESULT_KNOWN_ERRORS).find((item) => message.includes(item))
  if (key) return RESULT_KNOWN_ERRORS[key]
  if (message.toLowerCase().includes('row-level security') || error?.code === '42501') return 'La operacion fue bloqueada por permisos.'
  return message
}

export function rlsHint(table: string, operation: string, error: any): string {
  const message = error?.message || ''
  if (message.toLowerCase().includes('row-level security') || error?.code === '42501' || message.toLowerCase().includes('permission denied')) {
    return `Operacion ${operation} bloqueada por RLS en ${table}.`
  }
  return message
}

export function pagosintSaveHint(error: any): string {
  const raw = String(error?.message || error?.hint || error || '')
  const message = raw.toLowerCase()
  if (message.includes('row-level security') || error?.code === '42501' || message.includes('permission denied')) {
    return 'No se pudo guardar la referencia PAGOSINT porque la operacion fue bloqueada por permisos en payment_layout_lines.'
  }
  if (message.includes('not_authorized_to_update_layout_lines')) return 'Tu usuario no tiene permisos para completar referencias PAGOSINT en este layout.'
  if (message.includes('payment_layout_line_not_found')) return 'La linea del layout ya no existe o cambio; vuelve a abrir el layout e intenta de nuevo.'
  if (message.includes('pagosint_reference_only_for_interbank_lines')) return 'La referencia numerica solo aplica a lineas interbancarias PAGOSINT.'
  if (message.includes('pagosint_reference_required')) return 'Captura una referencia numerica de 1 a 5 digitos para PAGOSINT.'
  if (message.includes('pagosint_reference_too_long')) return 'La referencia PAGOSINT acepta maximo 5 digitos.'
  if (message.includes('persistida') || message.includes('reaparecio')) return raw
  return raw || 'No se pudo guardar la referencia PAGOSINT.'
}

// ── Helpers de resumen de preview ──────────────────────────────────────────
function previewRowsOf(preview: import('./types').EligibilityPreview, key: string): PreviewRow[] {
  const value = preview?.[key]
  return Array.isArray(value) ? value : []
}
export function readyPreviewRows(preview: import('./types').EligibilityPreview): PreviewRow[] {
  return [
    ...previewRowsOf(preview, 'ready_regular'),
    ...previewRowsOf(preview, 'ready_extraordinary'),
    ...previewRowsOf(preview, 'legacy_eligible'),
  ]
}
export function noReadyPreviewMessage(preview: import('./types').EligibilityPreview): string {
  const invalid = previewRowsOf(preview, 'invalid_data')
  const pendingClose = previewRowsOf(preview, 'pending_finance_close')
  const pendingDirector = previewRowsOf(preview, 'pending_director')
  const directionReapproval = previewRowsOf(preview, 'direction_reapproval_required')
  return invalid.length
    ? 'Completa los datos pendientes'
    : pendingClose.length
      ? 'Finanzas debe cerrar el corte'
      : pendingDirector.length
        ? 'Pendiente de decisión de Dirección'
        : directionReapproval.length
          ? 'Requiere nueva autorización de Dirección'
          : 'No hay pagos liberados'
}
export function findInvalidPreviewRequest(preview: import('./types').EligibilityPreview, requestId: string): PreviewRow | null {
  return previewRowsOf(preview, 'invalid_data').find((row) => row.payment_request_id === requestId) || null
}
export function findRejectedPreviewItem(preview: import('./types').EligibilityPreview, itemId: string): PreviewRow | null {
  return previewRowsOf(preview, 'rejected_by_direction').find((row) => row.source_item_id === itemId) || null
}

// ── Params de preview / clave de comparación ───────────────────────────────
export function layoutPreviewParamsKey(params: { p_period_start?: string; p_period_end?: string; p_company_id?: string | null; p_company_bank_account_id?: string | null }): string {
  return JSON.stringify([
    params.p_period_start || '',
    params.p_period_end || '',
    params.p_company_id || '',
    params.p_company_bank_account_id || '',
  ])
}
