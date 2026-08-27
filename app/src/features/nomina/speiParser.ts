// Parser certificado del layout SPEI, portado 1:1 desde payroll_parser.js
// (window.FluxPayrollParser). Sólo se portan las funciones que el rail de
// captura consume: parsePayrollSpeiTxt y summarizePayrollSpeiForCapture, más
// sus helpers puros. El resto de FluxPayrollParser (carátula, mismo banco,
// CFDI, materialización) queda del lado servidor y NO se replica aquí.

import type { SpeiIssue, SpeiParserSummary } from './types'

const PARSER_VERSION = 'payroll-normalized-v1'
const PAYROLL_SPEI_CONTRACT_VERSION = 'bbva-simulator-pagos-interbancarios-128-v1'
const PAYROLL_SPEI_RECORD_BYTES = 130
const PAYROLL_SPEI_USEFUL_BYTES = 128
const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER)

const ISSUE_CODES = {
  LAYOUT_LINE_INVALID: 'PAYROLL_LAYOUT_LINE_INVALID',
  SPEI_BYTE_CONTRACT_INVALID: 'PAYROLL_SPEI_BYTE_CONTRACT_INVALID',
  SOURCE_ACCOUNT_MISMATCH: 'PAYROLL_SOURCE_ACCOUNT_MISMATCH',
} as const

type SpeiRecord = {
  sourceRow: number
  clabe: string
  sourceAccount: string
  currency: string
  amount: string
  amountMinor: number
  employeeName: string
  accountType: string
  destinationBank: string
  paymentReference: string
  numericReference: string
  indicator: string
}

function issue(code: string, source?: string, row?: number | null, field?: string): SpeiIssue {
  const value: SpeiIssue = { code, severity: 'blocking' }
  if (source) value.source = source
  if (Number.isInteger(row) && (row as number) > 0) value.row = row as number
  if (field) value.field = field
  return value
}

function normalizeText(value: unknown): string {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ')
}

function normalizeAccount(value: unknown): string {
  return normalizeText(value).replace(/\D/g, '')
}

type MoneyResult = { ok: true; valueMinor: number } | { ok: false; code: string }

function parseMoneyMinor(value: string): MoneyResult {
  if (typeof value !== 'string') return { ok: false, code: ISSUE_CODES.LAYOUT_LINE_INVALID }
  const raw = value.trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) {
    return { ok: false, code: ISSUE_CODES.LAYOUT_LINE_INVALID }
  }
  const normalized = raw.replace(/,/g, '')
  const parts = normalized.split('.')
  const major = BigInt(parts[0])
  const fraction = (parts[1] || '').padEnd(2, '0')
  const minor = major * 100n + BigInt(fraction || '0')
  if (minor > MAX_SAFE_MINOR) return { ok: false, code: ISSUE_CODES.LAYOUT_LINE_INVALID }
  return { ok: true, valueMinor: Number(minor) }
}

function payrollSpeiBytes(input: ArrayBuffer | ArrayBufferView | string): Uint8Array | null {
  if (typeof input === 'string') {
    const bytes = new Uint8Array(input.length)
    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index)
      if (code > 255) return null
      bytes[index] = code
    }
    return bytes
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  return null
}

function payrollAscii(bytes: Uint8Array, start: number, end: number): string {
  let value = ''
  for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index])
  return value
}

function speiContractIssue(row: number | null, field: string): SpeiIssue {
  return issue(ISSUE_CODES.SPEI_BYTE_CONTRACT_INVALID, 'layout_spei_txt', row, field)
}

type SpeiParseResult = {
  parserVersion: string
  contractVersion: string
  records: SpeiRecord[]
  issues: SpeiIssue[]
}

export function parsePayrollSpeiTxt(input: ArrayBuffer | ArrayBufferView | string): SpeiParseResult {
  const bytes = payrollSpeiBytes(input)
  const issues: SpeiIssue[] = []
  const records: SpeiRecord[] = []
  if (!bytes || bytes.length === 0) {
    return { parserVersion: PARSER_VERSION, contractVersion: PAYROLL_SPEI_CONTRACT_VERSION, records, issues: [speiContractIssue(null, 'source')] }
  }
  if (
    (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff)
  ) {
    issues.push(speiContractIssue(null, 'bom'))
  }
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    if (byte > 0x7f || (byte < 0x20 && byte !== 0x0d && byte !== 0x0a)) {
      issues.push(speiContractIssue(null, 'encoding'))
      break
    }
  }
  if (bytes.length % PAYROLL_SPEI_RECORD_BYTES !== 0) issues.push(speiContractIssue(null, 'record_length'))
  if (issues.length > 0) {
    return { parserVersion: PARSER_VERSION, contractVersion: PAYROLL_SPEI_CONTRACT_VERSION, records, issues }
  }

  const lineCount = bytes.length / PAYROLL_SPEI_RECORD_BYTES
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const row = lineIndex + 1
    const offset = lineIndex * PAYROLL_SPEI_RECORD_BYTES
    if (bytes[offset + PAYROLL_SPEI_USEFUL_BYTES] !== 0x0d || bytes[offset + PAYROLL_SPEI_USEFUL_BYTES + 1] !== 0x0a) {
      issues.push(speiContractIssue(row, 'crlf'))
      continue
    }
    const line = payrollAscii(bytes, offset, offset + PAYROLL_SPEI_USEFUL_BYTES)
    const destination = line.slice(0, 18)
    const sourceAccount = line.slice(18, 36)
    const currency = line.slice(36, 39)
    const amount = line.slice(39, 55)
    const beneficiary = line.slice(55, 85)
    const accountType = line.slice(85, 87)
    const destinationBank = line.slice(87, 90)
    const paymentReference = line.slice(90, 120)
    const numericReference = line.slice(120, 127)
    const indicator = line.slice(127, 128)
    const amountResult = parseMoneyMinor(amount)
    const fieldChecks: Array<[string, boolean]> = [
      ['destination_account', /^\d{18}$/.test(destination)],
      ['source_account', /^\d{18}$/.test(sourceAccount)],
      ['currency', currency === 'MXP'],
      ['amount', /^\d{13}\.\d{2}$/.test(amount) && amountResult.ok && amountResult.valueMinor > 0],
      ['beneficiary', /^[\x20-\x7e]{30}$/.test(beneficiary) && beneficiary === beneficiary.toUpperCase()],
      ['account_type', accountType === '40'],
      ['destination_bank', /^\d{3}$/.test(destinationBank) && destinationBank === destination.slice(0, 3)],
      ['payment_reference', /^[\x20-\x7e]{30}$/.test(paymentReference) && paymentReference === paymentReference.toUpperCase()],
      ['numeric_reference', /^(?:\d{7}| {7})$/.test(numericReference)],
      ['indicator', indicator === 'H'],
    ]
    const invalidFields = fieldChecks.filter((entry) => !entry[1])
    invalidFields.forEach((entry) => issues.push(speiContractIssue(row, entry[0])))
    if (invalidFields.length > 0) continue
    records.push({
      sourceRow: row,
      clabe: destination,
      sourceAccount,
      currency,
      amount,
      amountMinor: amountResult.ok ? amountResult.valueMinor : 0,
      employeeName: beneficiary.trimEnd(),
      accountType,
      destinationBank,
      paymentReference: paymentReference.trimEnd(),
      numericReference: numericReference.trim(),
      indicator,
    })
  }
  return { parserVersion: PARSER_VERSION, contractVersion: PAYROLL_SPEI_CONTRACT_VERSION, records, issues }
}

function safeCaptureIssues(items: SpeiIssue[]): SpeiIssue[] {
  return (items || []).map((item) => {
    const safe: SpeiIssue = { code: item.code, severity: 'blocking' }
    if (item.source) safe.source = item.source
    if (Number.isInteger(item.row) && (item.row as number) > 0) safe.row = item.row
    if (item.field) safe.field = item.field
    return safe
  })
}

function normalizeAllowedSourceAccounts(values: string[]): Set<string> {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map(normalizeAccount)
      .filter((value) => value.length > 0 && value.length <= 18)
      .map((value) => value.padStart(18, '0')),
  )
}

export function summarizePayrollSpeiForCapture(
  input: ArrayBuffer | ArrayBufferView | string,
  allowedSourceAccounts: string[],
): SpeiParserSummary {
  const parsed = parsePayrollSpeiTxt(input)
  const issues = safeCaptureIssues(parsed.issues)
  const allowed = normalizeAllowedSourceAccounts(allowedSourceAccounts)

  if (
    parsed.records.length > 0 &&
    (allowed.size === 0 || parsed.records.some((record) => !allowed.has(record.sourceAccount)))
  ) {
    issues.push(issue(ISSUE_CODES.SOURCE_ACCOUNT_MISMATCH, 'source_account'))
  }

  let totalMinor = 0
  if (issues.length === 0) {
    for (const record of parsed.records) {
      if (!Number.isSafeInteger(record.amountMinor) || record.amountMinor <= 0) {
        issues.push(issue(ISSUE_CODES.SPEI_BYTE_CONTRACT_INVALID, 'layout_spei_txt', record.sourceRow, 'amount'))
        break
      }
      totalMinor += record.amountMinor
      if (!Number.isSafeInteger(totalMinor)) {
        issues.push(issue(ISSUE_CODES.SPEI_BYTE_CONTRACT_INVALID, 'layout_spei_txt', null, 'total'))
        break
      }
    }
  }

  return {
    parserVersion: PARSER_VERSION,
    contractVersion: PAYROLL_SPEI_CONTRACT_VERSION,
    valid: issues.length === 0 && parsed.records.length > 0,
    recordCount: issues.length === 0 ? parsed.records.length : 0,
    totalAmountMinor: issues.length === 0 ? totalMinor : null,
    currency: 'MXN',
    issues: safeCaptureIssues(issues),
  }
}
