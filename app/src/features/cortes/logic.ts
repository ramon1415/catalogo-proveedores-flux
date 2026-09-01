// Lógica pura portada 1:1 de approval_batches.js (vanilla). Sin DOM ni efectos.
import type { BadgeVariant } from '../../components/ui/Badge'
import type {
  BatchDetailBatch, BatchItem, BatchListRow, BatchStatus, CurrencyTotal, EligibleRequest,
} from './types'

// Roles que habilitan la vista de Dirección (espejo de resolveUser del vanilla).
const DIRECTOR_ROLES = ['approver_2', 'aprobador_2', 'direccion', 'director']

export function hasDirectorRole(roles: string[]): boolean {
  const clean = roles.map((r) => String(r || '').trim().toLowerCase())
  return DIRECTOR_ROLES.some((role) => clean.includes(role))
}

// Overload tipado: cuando el argumento ya es T[] | null, conserva T.
export function asArray<T>(value: T[] | null | undefined): T[]
export function asArray<T>(value: unknown): T[]
export function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

// UUID para claves idempotentes (el vanilla usa crypto.randomUUID directo).
export function createUuid(): string {
  return crypto.randomUUID()
}

// normalize del vanilla (con trim; difiere del compartido de lib/format).
export function normalize(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

// formatMoney respeta la moneda del ítem (el formatCurrency compartido fija MXN).
export function formatMoney(value: unknown, currency: string | null = 'MXN'): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN', maximumFractionDigits: 2 })
    .format(Number(value || 0))
}

// Fechas con fallback "-" como el vanilla (lib/format usa "Sin fecha").
export function formatDate(value: unknown): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(`${String(value).slice(0, 10)}T12:00:00`))
}

export function formatDateTime(value: unknown): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(String(value)))
}

export function toDateInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

// Periodo por defecto: fin = próximo miércoles (o hoy), inicio = 6 días antes.
export function defaultPeriod(): { start: string; end: string } {
  const today = new Date()
  const end = new Date(today)
  end.setDate(today.getDate() + ((3 - today.getDay() + 7) % 7))
  const start = new Date(end)
  start.setDate(end.getDate() - 6)
  return { start: toDateInput(start), end: toDateInput(end) }
}

// ── Agrupaciones y totales ─────────────────────────────────────────────────
type GroupRow = { label: string; currency: string; total: number }

export function groupTotals<T extends { amount?: number | null; currency?: string | null }>(
  items: T[],
  keyFor: (item: T) => string,
): GroupRow[] {
  const grouped = new Map<string, GroupRow>()
  items.forEach((item) => {
    const label = keyFor(item)
    const currency = item.currency || 'MXN'
    const key = `${label}|${currency}`
    const current = grouped.get(key) || { label, currency, total: 0 }
    current.total += Number(item.amount || 0)
    grouped.set(key, current)
  })
  return Array.from(grouped.values()).sort((a, b) => b.total - a.total)
}

export function totalsByCurrency(items: { amount?: number | null; currency?: string | null }[]): CurrencyTotal[] {
  return groupTotals(items, (item) => String(item.currency || 'MXN').toUpperCase())
    .map((row) => ({ currency: row.label, amount: row.total }))
}

export function formatCurrencyTotals(rows: CurrencyTotal[]): string {
  if (!rows.length) return 'Sin importe'
  return rows.map((row) => formatMoney(row.amount, row.currency)).join(' | ')
}

// ── Etiquetas ──────────────────────────────────────────────────────────────
export function statusLabel(status: string | null | undefined): string {
  return ({
    draft: 'Borrador',
    submitted: 'Pendiente de decisión de Dirección',
    approved: 'Dirección aprobó · pendiente de liberación',
    partially_approved: 'Dirección decidió con rechazos',
    closed: 'Liberado para pago',
    pending: 'Pendiente',
    rejected: 'Rechazada por Dirección',
    active: 'Activo',
    inactive: 'Inactivo',
  } as Record<string, string>)[status || ''] || String(status || '-')
}

// Tono del badge de estatus (mapa del statusBadge vanilla → variantes de Badge).
export function statusVariant(status: string | null | undefined): BadgeVariant {
  if (['approved', 'closed', 'active', 'sent'].includes(status || '')) return 'success'
  if (['rejected', 'partially_approved', 'inactive'].includes(status || '')) return 'danger'
  if (['submitted', 'pending'].includes(status || '')) return 'warning'
  return 'info'
}

export function reviewSequenceLabel(value: unknown): string {
  const sequence = Math.max(1, Number(value || 1))
  return sequence === 1 ? 'Primera revision' : `Revision ${sequence}`
}

export function paymentMethodLabel(value: string | null | undefined): string {
  return ({
    provider_payment: 'Pago a proveedor',
    transfer: 'Transferencia',
    cash: 'Efectivo',
    check: 'Cheque',
    online_purchase: 'Compra en linea',
  } as Record<string, string>)[value || ''] || value || 'Sin metodo'
}

export function classificationLabel(value: string | null | undefined): string {
  return ({
    budget_insufficient: 'Presupuesto insuficiente',
    budget_validation_required: 'Validar presupuesto',
    already_in_open_batch: 'En otro corte',
    pending_direction: 'Pendiente de Direccion',
    rejected_by_direction: 'Rechazada',
    already_authorized: 'Ya autorizada',
    pending_finance_close: 'Pendiente de liberacion',
    already_executed: 'Ya ejecutada',
    extraordinary: 'Extraordinaria',
    invalid_data: 'Informacion pendiente',
  } as Record<string, string>)[value || ''] || 'No elegible'
}

export function classificationReasonLabel(item: EligibleRequest): string {
  const missing = asArray<string>(item.missing_fields).map((field) => ({
    company_id: 'empresa',
    requested_by: 'solicitante',
    proveedor_id: 'proveedor',
    cost_center_id: 'centro de costo',
    budget_category_id: 'partida presupuestal',
    budget_month: 'mes presupuestal',
    amount_requested: 'importe',
    currency: 'moneda',
  } as Record<string, string>)[field] || field)
  if (missing.length) return `Falta: ${missing.join(', ')}.`
  return ({
    sin_disponible: 'El presupuesto disponible no cubre el importe.',
    partida_no_presupuestada: 'La partida no tiene presupuesto configurado.',
    budget_validation_data_missing: 'Faltan datos para validar el presupuesto.',
    payment_request_in_another_open_batch: 'Ya pertenece a otro corte abierto.',
    direction_rejection_requires_correction: 'Registra la correccion antes de enviarla nuevamente.',
    direction_approval_already_current: 'Ya tiene autorizacion vigente de Direccion.',
    finance_close_required: 'Direccion ya decidio; Finanzas debe liberar el corte.',
    payment_request_already_executed: 'Ya existe una ejecucion registrada.',
    extraordinary_authorization_active: 'Tiene una autorizacion extraordinaria activa.',
    request_status_not_batch_eligible: 'El estado actual no permite incorporarla al corte.',
    payroll_uses_separate_flow: 'Nomina utiliza un flujo independiente.',
    minimum_direction_data_missing: 'Faltan datos minimos para presentarla a Direccion.',
  } as Record<string, string>)[item.classification_reason || item.budget_reason || '']
    || 'Revisa el estado y los datos de la solicitud.'
}

export function ineligibleTone(classification: string | null | undefined): BadgeVariant {
  return classification === 'budget_insufficient' || classification === 'rejected_by_direction' ? 'danger' : 'warning'
}

export function regularizationStatusLabel(status: string | null | undefined): string {
  return ({
    consumed_pending_ratification: 'Ratificación pendiente',
    ratified: 'Ratificada',
    disputed: 'Con discrepancia',
  } as Record<string, string>)[status || ''] || status || 'Sin estado'
}

export function extraordinaryCategoryLabel(value: string | null | undefined): string {
  return ({
    operational_emergency: 'Emergencia operativa / fuga',
    urgent_reimbursement: 'Reembolso urgente',
    urgent_termination: 'Desvinculación o finiquito urgente',
    critical_service: 'Servicio crítico',
    other: 'Otro',
  } as Record<string, string>)[value || ''] || value || 'Sin categoría'
}

export function closeBlockReasonLabel(value: string | null | undefined): string {
  return ({
    direction_rejected: 'Rechazada por Dirección.',
    direction_pending: 'Pendiente de decisión de Dirección.',
    request_data_changed_after_direction_decision: 'Los datos materiales cambiaron; requiere nueva revisión.',
    direction_reapproval_required: 'Existe una revisión posterior pendiente o rechazada.',
    payment_request_already_executed: 'La solicitud ya tiene una ejecución registrada.',
    extraordinary_authorization_active: 'La solicitud tiene una contingencia extraordinaria vigente.',
    budget_validation_required: 'El presupuesto ya no es liberable.',
  } as Record<string, string>)[value || ''] || value || 'No cumple la revalidación de liberación.'
}

// Origen de una solicitud elegible (badge + contexto).
export function originBadge(item: EligibleRequest): { label: string; tone: BadgeVariant; context: string } {
  const origin = item.origin || 'new'
  const label = origin === 'resubmission' ? 'Reingreso' : origin === 'material_change_review' ? 'Datos actualizados' : 'Nueva'
  const tone: BadgeVariant = origin === 'new' ? 'info' : 'warning'
  const context = origin === 'new'
    ? ''
    : item.previous_reject_reason || item.previous_correction_note || item.previous_batch_label || 'Requiere nueva revision'
  return { label, tone, context }
}

// ── Filtro y orden de la lista de cortes ───────────────────────────────────
export function filterBatches(batches: BatchListRow[], search: string, status: string): BatchListRow[] {
  const q = normalize(search)
  return batches.filter((batch) => {
    const haystack = normalize(`${batch.label} ${batch.company_name} ${batch.director_name || ''}`)
    return (!q || haystack.includes(q)) && (!status || batch.status === status)
  })
}

// En la vista director, los enviados (pendientes de decisión) van primero.
export function sortDirectorBatches(batches: BatchListRow[]): BatchListRow[] {
  return [...batches].sort((a, b) =>
    Number(b.status === 'submitted') - Number(a.status === 'submitted')
    || String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

// ── Export CSV (encabezados y celdas idénticos al vanilla) ─────────────────
export function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

export function fileStem(batch: BatchDetailBatch): string {
  const company = String(batch.company_name || 'empresa')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  return `corte-semanal-${company}-${batch.period_end}`
}

export function buildCsvContent(batch: BatchDetailBatch, items: BatchItem[]): string {
  const header = ['corte', 'empresa', 'periodo_inicio', 'periodo_fin', 'estatus_corte', 'folio', 'proveedor', 'centro_costo', 'partida', 'metodo_pago', 'moneda', 'monto', 'solicitante', 'decision_director', 'motivo_rechazo', 'estatus_reingreso', 'nota_reingreso']
  const rows = items.map((item) => [
    batch.label, batch.company_name, batch.period_start, batch.period_end, batch.status,
    item.request_number, item.provider_name, item.cost_center, item.budget_category,
    item.payment_method, item.currency, item.amount, item.requester_name,
    item.director_status, item.reject_reason || '', item.rebatch_status, item.rebatch_release_note || '',
  ])
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

// ── Errores → copy operativo (diccionario completo del vanilla, match por substring) ──
const KNOWN_ERRORS: Record<string, string> = {
  finance_role_required: 'Se requiere rol de Finanzas.',
  batch_director_required: 'Solo el director asignado puede decidir este corte.',
  company_director_required: 'Configura un director activo para la empresa.',
  company_director_selection_required: 'Selecciona exactamente un Director responsable para el corte.',
  company_director_not_active_or_ineligible: 'El Director debe estar activo en el pool, con perfil, rol y membresía vigentes.',
  select_company_director: 'Selecciona uno de los directores activos.',
  batch_requires_items: 'Agrega al menos una solicitud al corte.',
  payment_request_not_batch_eligible: 'La solicitud ya no es elegible para este corte.',
  payment_request_in_another_open_batch: 'La solicitud ya pertenece a otro corte abierto.',
  reject_reason_required: 'El motivo de rechazo es obligatorio.',
  director_role_required: 'El perfil seleccionado no tiene un rol activo de Direccion.',
  director_profile_not_found_or_inactive: 'El perfil seleccionado está inactivo o ya no existe.',
  director_company_membership_required: 'El Director necesita una membresía activa en la empresa.',
  last_active_company_director_required: 'No puedes quitar al último Director activo de la empresa.',
  director_self_assignment_not_allowed: 'Quien configura el Director no puede asignarse a sí mismo.',
  company_active_director_conflict: 'La empresa tiene más de un Director activo. Corrige la duplicidad antes de guardar.',
  rebatch_release_note_required: 'La nota de reingreso es obligatoria.',
  rebatch_correction_note_too_short: 'Explica en al menos 10 caracteres que se corrigio.',
  batch_item_already_released: 'Esta solicitud ya fue habilitada para otro corte.',
  batch_requires_at_least_one_approved_item: 'El corte debe conservar al menos una solicitud aprobada.',
  batch_no_releasable_items: 'Ninguna solicitud conserva una autorización vigente para liberarse. Corrige o envía las afectadas a una nueva revisión.',
  batch_has_pending_items: 'Dirección aún no decide todas las solicitudes del corte.',
  registered_external_director_required: 'Solo el Director externo registrado y todavía activo puede decidir esta contingencia.',
  extraordinary_authorization_not_pending_ratification: 'La contingencia ya no está pendiente de ratificación.',
  ratification_window_elapsed: 'La ventana de ratificación terminó. La confirmación permanece bloqueada.',
  extraordinary_authorization_materially_stale: 'La solicitud cambió después de la autorización externa.',
  dispute_reason_too_short: 'Explica la discrepancia en al menos 20 caracteres.',
  extraordinary_evidence_access_denied: 'No tienes permiso para consultar esta evidencia.',
  extraordinary_evidence_not_finalized: 'La evidencia aún no está finalizada.',
  finance_reapproval_required: 'La solicitud cambio despues de la decision anterior. El sistema debe revalidar presupuesto y Direccion debe revisarla nuevamente.',
  request_data_changed_after_direction_decision: 'Los datos de la solicitud cambiaron despues de la autorizacion de Direccion. Debe enviarse nuevamente a un corte.',
  direction_reapproval_required: 'La autorizacion de Direccion ya no esta vigente. La solicitud debe enviarse nuevamente a un corte.',
  payment_request_already_executed: 'La solicitud ya tiene una ejecucion registrada.',
  extraordinary_authorization_active: 'La solicitud tiene una autorizacion extraordinaria activa y no puede liberarse en este corte.',
  batch_close_validation_failed: 'El corte no se libero porque una solicitud ya no supera la revalidacion de presupuesto o de Direccion.',
  batch_contains_ineligible_request: 'El corte contiene una solicitud que ya no cumple presupuesto, datos o estado. Actualiza el detalle para identificarla.',
  batch_enforcement_cannot_be_disabled_in_mvp: 'El control ya esta activo y no puede deshabilitarse desde el MVP.',
  target_batch_must_be_draft: 'El corte destino ya no esta en borrador.',
  target_batch_company_mismatch: 'El corte destino pertenece a otra empresa.',
  payment_request_already_in_target_batch: 'La solicitud ya esta en el corte destino.',
}

export function friendlyError(error: unknown): string {
  const raw = String((error as { message?: string })?.message || error || 'Error no identificado')
  const key = Object.keys(KNOWN_ERRORS).find((item) => raw.includes(item))
  return key ? KNOWN_ERRORS[key] : raw
}

// ── Elegibilidad de directores para el select de "Crear corte" ─────────────
export function eligibleDirectorsForCompany<T extends {
  active: boolean | null
  director_profile_active: boolean | null
  director_role_valid: boolean | null
  director_membership_active: boolean | null
  company_id: string | null
}>(directors: T[], companyId: string): T[] {
  return directors.filter((row) => (
    row.active
    && row.director_profile_active !== false
    && row.director_role_valid !== false
    && row.director_membership_active !== false
    && (!companyId || row.company_id === companyId)
  ))
}

// Estatus del corte para el filtro de la lista (mismo orden que el <select> vanilla).
export const BATCH_STATUS_FILTER_OPTIONS: { value: '' | BatchStatus; label: string }[] = [
  { value: '', label: 'Todos los estatus' },
  { value: 'draft', label: 'Borrador' },
  { value: 'submitted', label: 'Enviado' },
  { value: 'approved', label: 'Aprobado' },
  { value: 'partially_approved', label: 'Con rechazos' },
  { value: 'closed', label: 'Liberado para pago' },
]
