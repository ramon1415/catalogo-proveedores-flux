import type { BatchOperation, BatchDetail } from './types'

// Etiquetas de estado (espejo de statusLabel del vanilla).
export const STATUS_LABELS: Record<string, string> = {
  awaiting_upload: 'Esperando carga', extracting: 'Extrayendo', review_required: 'Por revisar',
  accepted: 'Aceptada', blocked: 'Bloqueada', ready: 'Listo', available: 'Disponible',
  linked: 'Vinculado', draft: 'Borrador', reserved: 'Reservado', active: 'Activa',
  released: 'Liberado', rejected: 'Rechazado', cancelled: 'Cancelado', expired: 'Expirado',
  unreconciled: 'Pendiente de conciliación', failed: 'Con incidencia',
}
export const statusLabel = (s: string | null | undefined) => STATUS_LABELS[s || ''] || s || '—'

export function statusTone(s: string | null | undefined): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  if (['accepted', 'ready', 'available', 'linked'].includes(s || '')) return 'success'
  if (['failed', 'rejected'].includes(s || '')) return 'danger'
  if (['awaiting_upload', 'extracting', 'reserved', 'review_required', 'blocked'].includes(s || '')) return 'warning'
  if (s === 'draft') return 'info'
  return 'neutral'
}

export const ISSUE_LABELS: Record<string, string> = {
  bank_not_identified: 'Banco no identificado', operation_date_missing: 'Fecha faltante',
  amount_missing_or_invalid: 'Importe inválido', currency_missing_or_invalid: 'Moneda inválida',
  bank_reference_missing: 'Referencia faltante', bank_unique_folio_missing: 'Folio único faltante',
  strong_bank_identity_missing: 'Cuenta origen empresarial completa faltante',
  beneficiary_missing: 'Beneficiario faltante', bank_status_not_operated: 'Estado bancario distinto de Operado',
}
export const issueLabel = (s: string) => ISSUE_LABELS[s] || s

// Mapa `known` de friendlyError del vanilla (match por message y luego code).
const KNOWN_ERRORS: Record<string, string> = {
  upload_contract_incomplete: 'El servidor no devolvió bucket, ruta y documento autorizados.',
  invalid_pdf_signature: 'El archivo no contiene la firma válida %PDF-.',
  invalid_pdf_page_count: 'El PDF no tiene páginas válidas o supera el límite autorizado.',
  secure_id_unavailable: 'El navegador no puede generar una clave idempotente segura.',
  source_pdf_url_unavailable: 'No se pudo generar el acceso temporal al PDF fuente.',
  payment_evidence_identifier_missing: 'El servidor no devolvió un identificador válido para la evidencia.',
  stale_payment_extraction: 'La extracción cambió en otra sesión; se actualizaron los datos.',
  payment_reservation_not_active: 'La reserva ya no está activa; se actualizaron los datos.',
  payment_reservation_not_expired: 'La reserva todavía no venció según el reloj del servidor.',
  payment_reservation_expired_use_expire: 'La reserva ya venció; aplica la acción Expirar reserva.',
  payment_allocation_plan_not_cancellable: 'El plan ya no se puede cancelar; se actualizó la operación.',
  payment_allocation_plan_not_draft: 'El plan ya no está en borrador; se actualizó la operación.',
  bank_payment_operation_not_available: 'La operación bancaria ya no está disponible; se actualizaron los datos.',
  bank_payment_operation_folio_duplicate: 'Ese Folio único BBVA ya identifica otra operación de la empresa.',
  bank_payment_operation_company_account_mismatch: 'La cuenta origen no coincide con una cuenta bancaria activa de la empresa.',
  bank_payment_operation_company_account_ambiguous: 'La cuenta origen coincide con más de una cuenta BBVA activa; corrige el catálogo antes de aceptar.',
  open_allocation_plan_exists: 'La operación ya tiene un plan abierto.',
  bank_payment_operation_capacity_exceeded: 'El remanente de la operación cambió; revisa los importes.',
  payable_snapshot_capacity_exceeded: 'El saldo pagable cambió; revisa los importes.',
  idempotency_key_conflict: 'La misma clave idempotente recibió datos distintos.',
  PGRST202: 'El contrato RPC todavía no está disponible en este ambiente.',
  pdf_runtime_unavailable: 'No se cargaron las dependencias seguras de conciliación. Recarga la página.',
}

export function friendlyBatchError(error: unknown): string {
  const e = error as { message?: string; code?: string; detail?: string } | null
  const message = String(e?.message || '')
  const code = String(e?.code || '')
  for (const [key, copy] of Object.entries(KNOWN_ERRORS)) {
    if (message.includes(key) || code === key) return copy
  }
  if (/permission|42501|row-level|not authorized/i.test(`${message} ${code}`)) {
    return 'No tienes permisos para esta operación.'
  }
  return message || code || String(e?.detail || 'Error no identificado')
}

// ── Normalización de estados (espejo del vanilla) ───────────────────────────
export const operationStatus = (op: BatchOperation) =>
  op.extraction_status || op.operation_status || op.status || 'review_required'

export const batchStatus = (b: { batch_status?: string | null; status?: string | null }) =>
  b.batch_status || b.status || 'awaiting_upload'

// Fusión operations × extractions por extraction_id, precedencia operación.
export function batchOperations(detail: BatchDetail | null): BatchOperation[] {
  if (!detail) return []
  const operations = detail.operations || detail.bank_operations || []
  const extractions = detail.extractions || []
  const byId = new Map(extractions.map((e) => [e.extraction_id, e]))
  const merged = operations.map((op) => {
    const ex = op.extraction_id ? byId.get(op.extraction_id) : undefined
    return { ...(ex || {}), ...op }
  })
  // Extracciones sin operación asociada también se listan.
  const seen = new Set(merged.map((m) => m.extraction_id))
  for (const ex of extractions) {
    if (!seen.has(ex.extraction_id)) merged.push(ex)
  }
  return merged
}

export function safeMinorInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const n = Number(value)
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

export function minorToDecimal(minor: number | null): string | null {
  if (minor == null || !Number.isInteger(minor)) return null
  const sign = minor < 0 ? '-' : ''
  const abs = String(Math.abs(minor)).padStart(3, '0')
  return `${sign}${abs.slice(0, -2)}.${abs.slice(-2)}`
}

export function formatMinor(value: number | string | null | undefined, currency = 'MXN'): string {
  const minor = safeMinorInteger(value)
  if (minor == null) return '—'
  const amount = minor / 100
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency || 'MXN'}`
  }
}

export function formatBatchBytes(size: number): string {
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`
}

export const shortBatchId = (id: string) => id.slice(0, 8).toUpperCase()

export const normalizeText = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Documento fuente del batch: solo el bucket autorizado con ruta canónica.
export function sourceDocumentOf(detail: BatchDetail | null): { storage_bucket: string; storage_path: string } | null {
  const doc = (detail?.document || detail?.documents?.[0] || {}) as { storage_bucket?: string; storage_path?: string }
  if (doc.storage_bucket !== 'payment-batch-documents') return null
  if (!doc.storage_path || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/source\.pdf$/i.test(doc.storage_path)) return null
  return { storage_bucket: doc.storage_bucket, storage_path: doc.storage_path }
}

export function sanitizeFilenamePart(value: string, fallback: string): string {
  const cleaned = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  return cleaned || fallback
}
