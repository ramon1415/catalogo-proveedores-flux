// Lógica pura del rail de captura de Nómina: config de slots, canales, slots
// requeridos, validación de metadata, inspección local de archivos, mapas de
// estado/error y formateadores. Portado 1:1 desde payroll_capture.js.

import { summarizePayrollSpeiForCapture, parsePayrollSpeiTxt } from './speiParser'
import type {
  BankAccount,
  CompanyCostCenter,
  CostCenter,
  FileSlotState,
  PayrollChannel,
  PayrollSlot,
  PayrollSubtype,
} from './types'

// Gate de rol: Nómina es exclusiva de Finanzas. Mismos roles que el vanilla
// (FINANCE_ROLES en payroll_capture.js). Se computa local desde useAuth().roles.
export const FINANCE_ROLES = ['finance', 'finanzas', 'treasury', 'tesoreria', 'administracion']

export function hasFinanceRole(roles: string[]): boolean {
  return (roles || [])
    .map((role) => String(role).toLowerCase())
    .some((role) => FINANCE_ROLES.includes(role))
}

// Bucket privado de Finanzas (confirmado en reserve_payroll_capture_file y
// payroll_capture.js). NO usar payment-receipts para nómina.
export const BUCKET = 'payroll-private'
export const MAX_BYTES = 25 * 1024 * 1024

type SlotConfig = { kind: PayrollSlot; extension: string; mimes: string[] }

export const SLOT_CONFIG: Record<PayrollSlot, SlotConfig> = {
  caratula: { kind: 'caratula', extension: 'xlsx', mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
  layout_mismo_banco: { kind: 'layout_mismo_banco', extension: 'txt', mimes: ['text/plain'] },
  layout_spei: { kind: 'layout_spei', extension: 'txt', mimes: ['text/plain'] },
  layout_toka: { kind: 'layout_toka', extension: 'txt', mimes: ['text/plain'] },
  cfdi_vales: { kind: 'cfdi_vales', extension: 'xml', mimes: ['application/xml', 'text/xml'] },
}

export const ALL_SLOTS: PayrollSlot[] = Object.keys(SLOT_CONFIG) as PayrollSlot[]

export const CHANNELS: Array<{ value: PayrollChannel; label: string }> = [
  { value: 'banco', label: 'BBVA mismo banco' },
  { value: 'spei', label: 'SPEI' },
  { value: 'vales', label: 'Vales / TOKA' },
]

// Slots requeridos por combinación de canales (requiredSlots del vanilla).
export function requiredSlots(channels: PayrollChannel[]): PayrollSlot[] {
  return ['caratula' as PayrollSlot].concat(
    channels.includes('banco') ? ['layout_mismo_banco'] : [],
    channels.includes('spei') ? ['layout_spei'] : [],
    channels.includes('vales') ? ['layout_toka', 'cfdi_vales'] : [],
  )
}

// Slots que quedan habilitados según los canales seleccionados.
export function enabledSlots(channels: PayrollChannel[]): Record<PayrollSlot, boolean> {
  return {
    caratula: true,
    layout_mismo_banco: channels.includes('banco'),
    layout_spei: channels.includes('spei'),
    layout_toka: channels.includes('vales'),
    cfdi_vales: channels.includes('vales'),
  }
}

// Slots que dependen de un canal (para limpiar al desmarcarlo).
export function slotsForChannel(channel: PayrollChannel): PayrollSlot[] {
  if (channel === 'vales') return ['layout_toka', 'cfdi_vales']
  if (channel === 'banco') return ['layout_mismo_banco']
  return ['layout_spei']
}

// ── Cuentas origen / centros de costo ──────────────────────────────────────

export function accountsForCompany(accounts: BankAccount[], companyId: string): BankAccount[] {
  return accounts.filter((a) => a.company_id === companyId)
}

export function maskAccount(a: BankAccount): string {
  const digits = String(a.last4 || a.account_number || a.clabe || '').replace(/\D/g, '')
  return digits ? '•••• ' + digits.slice(-4) : 'Cuenta enmascarada'
}

export function accountLabel(a: BankAccount): string {
  return [a.name, a.bank_name, maskAccount(a), a.currency].filter(Boolean).join(' · ')
}

export function costCentersForCompany(
  costCenters: CostCenter[],
  mappings: CompanyCostCenter[],
  companyId: string,
): CostCenter[] {
  const allowed = new Set(
    mappings.filter((m) => m.company_id === companyId && m.active !== false).map((m) => m.cost_center_id),
  )
  return costCenters.filter((c) => allowed.has(c.id))
}

export function costCenterLabel(c: CostCenter): string {
  return [c.code, c.name].filter(Boolean).join(' · ')
}

// Candidatos de cuenta origen (account_number + clabe en dígitos) para validar
// el SPEI/TOKA localmente. Igual que selectedSourceAccountCandidates del vanilla.
export function sourceAccountCandidates(account: BankAccount | undefined): string[] {
  if (!account) return []
  return [account.account_number, account.clabe]
    .map((v) => String(v || '').replace(/\D/g, ''))
    .filter(Boolean)
}

// ── Inspección local de archivos (inspectFile del vanilla) ─────────────────

function normalizeAccount18(value: string): string {
  const digits = String(value || '').replace(/\D/g, '')
  return digits ? digits.padStart(18, '0') : ''
}

function isZipSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06) || (bytes[2] === 0x07 && bytes[3] === 0x08))
  )
}

function hasBinaryNull(bytes: Uint8Array): boolean {
  for (let i = 0; i < Math.min(bytes.length, 4096); i += 1) if (bytes[i] === 0) return true
  return false
}

function looksLikeXml(bytes: Uint8Array): boolean {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, 512)).replace(/^\uFEFF/, '').trimStart().startsWith('<')
  } catch {
    return false
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Reproduce inspectFile: valida metadata/firma, calcula SHA-256, y para el SPEI
// corre el parser certificado; para TOKA valida cuenta origen; el resto queda
// en "server_verification_pending".
export async function inspectFile(
  slot: PayrollSlot,
  file: File,
  sourceCandidates: string[],
): Promise<FileSlotState> {
  const config = SLOT_CONFIG[slot]
  const extension = String(file.name || '').split('.').pop()!.toLowerCase()
  const mimeType = file.type || config?.mimes?.[0] || ''
  if (!config || extension !== config.extension || !config.mimes.includes(mimeType) || file.size < 1 || file.size > MAX_BYTES) {
    throw new Error('PAYROLL_FILE_METADATA_INVALID')
  }
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  if (slot === 'caratula' && !isZipSignature(bytes)) throw new Error('PAYROLL_XLSX_SIGNATURE_INVALID')
  if (['layout_mismo_banco', 'layout_spei', 'layout_toka'].includes(slot) && hasBinaryNull(bytes)) {
    throw new Error('PAYROLL_TXT_SIGNATURE_INVALID')
  }
  if (slot === 'cfdi_vales' && !looksLikeXml(bytes)) throw new Error('PAYROLL_XML_SIGNATURE_INVALID')

  const base: FileSlotState = {
    present: true,
    uploadable: true,
    uploaded: false,
    status: 'server_verification_pending',
    file,
    extension,
    mimeType,
    sizeBytes: file.size,
    sha256: await sha256Hex(buffer),
    issueCodes: [],
  }

  if (slot === 'layout_spei') {
    const summary = summarizePayrollSpeiForCapture(buffer, sourceCandidates)
    if (!summary.valid) {
      return { ...base, status: 'parser_error', uploadable: false, parserSummary: summary, issueCodes: ['PARSER_ERROR'] }
    }
    return {
      ...base,
      status: 'parsed',
      parserSummary: summary,
      recordCount: summary.recordCount,
      totalAmountMinor: summary.totalAmountMinor,
    }
  }
  if (slot === 'layout_toka') {
    const parsed = parsePayrollSpeiTxt(buffer)
    const allowed = new Set(sourceCandidates.map(normalizeAccount18))
    if (
      parsed.issues.length ||
      parsed.records.length !== 1 ||
      !allowed.size ||
      parsed.records.some((record) => !allowed.has(record.sourceAccount))
    ) {
      return { ...base, status: 'parser_error', uploadable: false, issueCodes: ['PARSER_ERROR'] }
    }
  }
  return base
}

// Estado de un slot cuando falla el parseo antes de inspeccionar (catch del bind).
export function parserErrorSlot(): FileSlotState {
  return { present: true, status: 'parser_error', uploadable: false, uploaded: false, issueCodes: ['PARSER_ERROR'] }
}

// ── Validación de metadata (validateMetadata del vanilla) ──────────────────

export function validateMetadata(input: {
  isFinance: boolean
  companyId: string
  sourceAccountId: string
  costCenterId: string
  subtype: string
  periodStart: string
  periodEnd: string
  concept: string
  channels: PayrollChannel[]
}): string {
  if (!input.isFinance) return 'La Nómina es exclusiva de Finanzas.'
  if (!input.companyId) return 'Selecciona empresa.'
  if (!input.sourceAccountId) return 'Selecciona cuenta origen.'
  if (!input.costCenterId) return 'Selecciona centro de costo.'
  if (!['ordinaria', 'extraordinaria'].includes(input.subtype)) return 'Selecciona tipo de corrida.'
  if (!input.periodStart || !input.periodEnd || input.periodStart > input.periodEnd) return 'Captura un periodo válido.'
  if (input.concept.trim().length < 3) return 'Captura concepto o descripción.'
  if (!input.channels.length) return 'Declara al menos un canal.'
  return ''
}

// ── Etiquetas y formateadores ──────────────────────────────────────────────

export function captureStateLabel(value: string): string {
  return (
    (
      {
        draft: 'Borrador',
        files_pending: 'Archivos pendientes',
        validation_pending: 'Validación pendiente',
        ready_for_submission: 'Validación completa',
        materialized: 'Materializada',
      } as Record<string, string>
    )[value] || 'Validación pendiente'
  )
}

export function slotLabel(value: PayrollSlot | string): string {
  return (
    (
      {
        caratula: 'Carátula',
        layout_mismo_banco: 'BBVA Nómina 108',
        layout_spei: 'SPEI',
        layout_toka: 'TOKA fondeo',
        cfdi_vales: 'TOKA CFDI',
      } as Record<string, string>
    )[value] || value || 'Captura'
  )
}

export function channelLabel(value: PayrollChannel | string): string {
  return (
    ({ banco: 'BBVA mismo banco', spei: 'SPEI', vales: 'TOKA / vales' } as Record<string, string>)[value] || value
  )
}

export function subtypeLabel(value: PayrollSubtype): string {
  return value === 'extraordinaria' ? 'Extraordinaria' : 'Ordinaria'
}

// Formato de moneda idéntico al vanilla (formatMoney): es-MX / MXN.
export function formatMoney(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n)
}

// Metadata de cada card (título/badge/copy/accept), portada del injectCaptureSection.
export const FILE_CARDS: Array<{ slot: PayrollSlot; title: string; badge: string; copy: string; accept: string }> = [
  {
    slot: 'caratula',
    title: 'Carátula XLSX',
    badge: 'Obligatoria',
    copy: 'Contrato real Operadora Tlacatecpan. Validación final en servidor.',
    accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  {
    slot: 'layout_mismo_banco',
    title: 'BBVA Nómina 108 TXT',
    badge: 'Condicional',
    copy: '108 bytes útiles + CRLF. Validación final en servidor.',
    accept: '.txt,text/plain',
  },
  {
    slot: 'layout_spei',
    title: 'SPEI TXT',
    badge: 'Condicional',
    copy: '128 bytes útiles + CRLF. Diagnóstico local y verificación final en servidor.',
    accept: '.txt,text/plain',
  },
  {
    slot: 'layout_toka',
    title: 'TOKA fondeo TXT',
    badge: 'Condicional',
    copy: 'Transferencia agregada real a TOKA; separada del beneficio por empleado.',
    accept: '.txt,text/plain',
  },
  {
    slot: 'cfdi_vales',
    title: 'TOKA CFDI XML',
    badge: 'Condicional',
    copy: 'CFDI 4.0 + complemento valesdedespensa para beneficio, comisión e IVA.',
    accept: '.xml,application/xml,text/xml',
  },
]

// Mapa de errores del backend → copy amable (friendlyError del vanilla).
const ERROR_MAP: Record<string, string> = {
  payroll_capture_finance_required: 'La captura de nómina es exclusiva de Finanzas.',
  payroll_capture_metadata_invalid: 'La metadata de la corrida no es válida.',
  payroll_capture_source_account_invalid: 'La cuenta origen no pertenece a la empresa o está inactiva.',
  payroll_capture_cost_center_invalid: 'El centro de costo no está habilitado para la empresa.',
  payroll_capture_version_conflict: 'La captura cambió. Recarga antes de continuar.',
  payroll_capture_session_expired: 'La sesión de captura expiró.',
  payroll_capture_materialized_locked: 'La corrida ya fue materializada y sus datos de captura están congelados.',
  payroll_capture_spei_validation_required: 'El TXT SPEI no pasó el diagnóstico certificado.',
  payroll_capture_toka_funding_validation_required: 'El TXT de fondeo TOKA no es válido para esta captura.',
  PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED: 'Finanzas debe reconocer la diferencia de fondeo TOKA antes de enviar.',
  PAYROLL_SERVER_PACKAGE_VALIDATION_FAILED: 'Los archivos no conciliaron entre sí en la verificación del servidor.',
  PAYROLL_SOURCE_ACCOUNT_MISMATCH: 'La cuenta origen codificada en los layouts no coincide con la cuenta seleccionada.',
  PAYROLL_REQUIRED_FILES_MISSING: 'Faltan archivos obligatorios del paquete.',
  PAYROLL_COVER_SHEET_SERVER_PARSE_FAILED: 'La carátula no coincide con el contrato físico certificado.',
  PAYROLL_SAME_BANK_SERVER_PARSE_FAILED: 'El archivo BBVA mismo banco no coincide con Nómina 108.',
  PAYROLL_TOKA_CFDI_SERVER_PARSE_FAILED: 'El CFDI TOKA no coincide con el contrato certificado.',
  PAYROLL_TOKA_FUNDING_SERVER_PARSE_FAILED: 'El TXT de fondeo TOKA no coincide con el contrato certificado.',
}

export function friendlyError(error: unknown): string {
  const message = String((error as { message?: string })?.message || error || 'Error inesperado.')
  const key = Object.keys(ERROR_MAP).find((k) => message.includes(k))
  return key ? ERROR_MAP[key] : message
}
