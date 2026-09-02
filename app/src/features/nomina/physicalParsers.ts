// Reutiliza los parsers físicos canónicos, sin mantener una segunda
// implementación. Vite incorpora estos UMD desde la raíz del repositorio y
// los ejecuta en el navegador antes de que la captura los consuma.
import '../../../../payroll_real_formats.js'

import { parsePayrollSpeiTxt } from './speiParser'
import type { LocalFileDiagnostic, PayrollSlot } from './types'

type ParserIssue = { code: string }

type CoverResult = {
  valid: boolean
  contractVersion: string
  people?: unknown[]
  totals?: {
    netAmountMinor: number
    cashAmountMinor: number
    vouchersAmountMinor: number
  } | null
  issues?: ParserIssue[]
}

type SameBankResult = {
  valid: boolean
  contractVersion: string
  recordCount?: number
  totalAmountMinor?: number | null
  issues?: ParserIssue[]
}

type TokaCfdiResult = {
  valid: boolean
  contractVersion: string
  recordCount?: number
  benefitAmountMinor?: number | null
  feeAmountMinor?: number | null
  taxAmountMinor?: number | null
  expectedFundingAmountMinor?: number | null
  issues?: ParserIssue[]
}

type RealFormatsApi = {
  parseCoverXlsx(input: ArrayBuffer | ArrayBufferView): Promise<CoverResult>
  parseSameBank108(input: ArrayBuffer | ArrayBufferView): SameBankResult
  parseTokaCfdi(input: ArrayBuffer | ArrayBufferView): TokaCfdiResult
}

type GlobalWithPayrollParser = typeof globalThis & {
  FluxPayrollRealFormats?: RealFormatsApi
}

export type ClassifiedPayrollFile = {
  slot: PayrollSlot
  diagnostic: LocalFileDiagnostic
}

function parser(): RealFormatsApi {
  const value = (globalThis as GlobalWithPayrollParser).FluxPayrollRealFormats
  if (!value) throw new Error('PAYROLL_PHYSICAL_PARSER_NOT_AVAILABLE')
  return value
}

function extensionOf(file: File): string {
  return String(file.name || '').split('.').pop()?.toLowerCase() || ''
}

function normalizeName(value: unknown): string {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export async function classifyPayrollFile(file: File): Promise<ClassifiedPayrollFile | null> {
  const extension = extensionOf(file)
  const buffer = await file.arrayBuffer()
  const physical = parser()

  if (extension === 'xlsx') {
    const cover = await physical.parseCoverXlsx(buffer)
    if (!cover.valid || !cover.totals) return null
    return {
      slot: 'caratula',
      diagnostic: {
        contractVersion: cover.contractVersion,
        recordCount: Array.isArray(cover.people) ? cover.people.length : null,
        totalAmountMinor: cover.totals.netAmountMinor,
        cashAmountMinor: cover.totals.cashAmountMinor,
        vouchersAmountMinor: cover.totals.vouchersAmountMinor,
      },
    }
  }

  if (extension === 'xml') {
    const cfdi = physical.parseTokaCfdi(buffer)
    if (!cfdi.valid) return null
    return {
      slot: 'cfdi_vales',
      diagnostic: {
        contractVersion: cfdi.contractVersion,
        recordCount: cfdi.recordCount ?? null,
        totalAmountMinor: cfdi.benefitAmountMinor ?? null,
        benefitAmountMinor: cfdi.benefitAmountMinor ?? null,
        feeAmountMinor: cfdi.feeAmountMinor ?? null,
        taxAmountMinor: cfdi.taxAmountMinor ?? null,
        expectedFundingAmountMinor: cfdi.expectedFundingAmountMinor ?? null,
      },
    }
  }

  if (extension !== 'txt') return null

  // Nómina 108 tiene un contrato de 110 bytes por renglón; se prueba primero
  // para no interpretar sus offsets como SPEI por accidente.
  const sameBank = physical.parseSameBank108(buffer)
  if (sameBank.valid) {
    return {
      slot: 'layout_mismo_banco',
      diagnostic: {
        contractVersion: sameBank.contractVersion,
        recordCount: sameBank.recordCount ?? null,
        totalAmountMinor: sameBank.totalAmountMinor ?? null,
      },
    }
  }

  const spei = parsePayrollSpeiTxt(buffer)
  if (spei.issues.length || !spei.records.length) return null
  const totalAmountMinor = spei.records.reduce((sum, record) => sum + record.amountMinor, 0)
  const isToka =
    spei.records.length === 1 && normalizeName(spei.records[0].employeeName).includes('TOKA INTERNACIONAL')
  return {
    slot: isToka ? 'layout_toka' : 'layout_spei',
    diagnostic: {
      contractVersion: spei.contractVersion,
      recordCount: spei.records.length,
      totalAmountMinor,
    },
  }
}
