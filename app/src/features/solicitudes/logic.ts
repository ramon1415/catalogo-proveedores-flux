// Lógica pura de Solicitudes de pago, portada 1:1 de solicitudes.js y de las
// extensiones runtime (fase2_request_payment_method_extension.js,
// solicitudes_batch_execution.js, cash_flow_extension.js). Sin DOM ni efectos.
import type { BadgeVariant } from '../../components/ui/Badge'
import { normalize, numberValue } from '../../lib/format'
import type {
  PaymentRequest, Company, CostCenter, BudgetCategory, Proveedor,
  BudgetAvailabilityRow, ApproverCandidate, ApproverSelection,
  DecisionAction, RequestPayload, EmployeeBankAccount, ReimbursementDraftItem,
} from './types'

export const ACTIVE_REQUEST_STATUSES = [
  'submitted', 'approved', 'changes_requested', 'finance_validation', 'scheduled',
]

export const STATUS_FILTER_LABELS: Record<string, string> = {
  todos: 'Todas',
  activas: 'Activas',
  submitted: 'Submitted',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  finance_validation: 'Finance validation',
  scheduled: 'Scheduled',
  paid: 'Pagadas',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}
// Roles finanzas exactos (ADMIN_ROLES en config.js). Gobierna la opción Nómina
// y el checkbox de ajuste extraordinario en la extensión Fase 2.
const FINANCE_ROLES = ['finance', 'finanzas', 'treasury', 'tesoreria', 'administracion']
export function hasFinanceRole(roles: string[]): boolean {
  return roles.map((r) => normalize(r).replace(/\s+/g, '_')).some((r) => FINANCE_ROLES.includes(r))
}

// ── Filtros de estatus / decisión ─────────────────────────────────────────
export function isActiveRequest(request: PaymentRequest): boolean {
  return ACTIVE_REQUEST_STATUSES.includes(request?.status ?? '')
}

export function isExceptionRequest(request: PaymentRequest): boolean {
  return request?.budget_decision === 'bloqueado' || request?.is_extraordinary_adjustment === true
}

export function statusMatches(request: PaymentRequest, filter: string): boolean {
  if (filter === 'todos') return true
  if (filter === 'activas') return isActiveRequest(request)
  return request.status === filter
}

export function budgetDecisionMatches(request: PaymentRequest, filter: string): boolean {
  if (filter === 'todos') return true
  if (filter === 'excepciones') return isExceptionRequest(request)
  return request.budget_decision === filter
}

export function isFinalDecisionStatus(status: string | null): boolean {
  return ['approved', 'rejected', 'changes_requested', 'scheduled', 'paid', 'cancelled'].includes(status ?? '')
}

export function isTerminalStatus(status: string | null): boolean {
  return ['paid', 'cancelled', 'rejected', 'approved', 'scheduled'].includes(status ?? '')
}

// ── Badges (label + variante del componente Badge) ─────────────────────────
type BadgeDesc = { label: string; variant: BadgeVariant }

// React Badge no tiene variante "violet"; se mapea a "accent" (ver MIGRATION_NOTES).
export function statusBadge(status: string | null): BadgeDesc {
  const map: Record<string, BadgeDesc> = {
    submitted: { label: 'Enviada', variant: 'info' },
    approved: { label: 'Aprobada', variant: 'success' },
    paid: { label: 'Pagado', variant: 'success' },
    rejected: { label: 'Rechazada', variant: 'danger' },
    cancelled: { label: 'Cancelada', variant: 'warning' },
    changes_requested: { label: 'Con corrección', variant: 'warning' },
    finance_validation: { label: 'En revisión', variant: 'info' },
    scheduled: { label: 'Programado', variant: 'info' },
  }
  return map[status ?? ''] ?? { label: status || 'Sin estatus', variant: 'neutral' }
}

export function budgetDecisionBadge(decision: string | null, reason = ''): BadgeDesc {
  if (decision === 'aprobable' && reason === 'no_presupuestal') {
    return { label: 'No presupuestal', variant: 'success' }
  }
  if (decision === 'aprobable') return { label: 'Aprobable', variant: 'success' }
  if (decision === 'bloqueado') return { label: reason ? `Excepción: ${reason}` : 'Excepción', variant: 'accent' }
  return { label: decision ? decision : 'Sin validar', variant: 'neutral' }
}

// ── Etiquetas de nombres (idénticas al vanilla) ────────────────────────────
export function companyName(company: Company | null | undefined): string {
  if (!company) return 'Sin empresa'
  return company.name || company.legal_name || company.display_name || 'Sin nombre'
}

export function costCenterName(center: CostCenter | null | undefined): string {
  if (!center) return 'Sin centro'
  const code = center.code ? `${center.code} - ` : ''
  return `${code}${center.name || center.display_name || 'Sin nombre'}`
}

export function budgetCategoryLabel(category: BudgetCategory | null | undefined): string {
  if (!category) return 'Sin partida'
  const section = category.category ? ` (${category.category})` : ''
  return `${category.name || 'Sin nombre'}${section}`
}

export function proveedorAlias(p: Proveedor | null | undefined): string {
  if (!p) return 'Sin proveedor'
  return p.alias || p.nombre_completo || 'Sin alias'
}

export function proveedorLabel(p: Proveedor | null | undefined): string {
  if (!p) return 'Sin proveedor'
  const alias = p.alias || p.nombre_completo || 'Proveedor'
  const name = p.nombre_completo && p.nombre_completo !== alias ? ` - ${p.nombre_completo}` : ''
  const rfc = p.rfc ? ` | RFC ${p.rfc}` : ''
  const bank = p.banco ? ` | ${p.banco}` : ''
  return `${alias}${name}${rfc}${bank}`
}

// ── Disponibilidad presupuestal ────────────────────────────────────────────
export function getAvailableAmount(row: BudgetAvailabilityRow | null | undefined): number {
  if (!row) return 0
  const candidates = [
    row.available_amount, row.amount_available, row.disponible, row.available,
    row.budget_available, row.current_available, row.remaining_amount, row.available_before,
  ]
  const first = candidates.find((v) => v !== null && v !== undefined && v !== '')
  return numberValue(first)
}

export function budgetCategoryAvailabilityLabel(
  category: BudgetCategory | null | undefined,
  row: BudgetAvailabilityRow,
): string {
  const label = budgetCategoryLabel(category)
  if (category?.no_presupuestal === true || row.no_presupuestal === true) {
    return `${label} | No presupuestal`
  }
  const available = formatCurrencyC(getAvailableAmount(row), 'MXN')
  return `${label} | Disponible ${available}`
}

// Conserva por categoría la fila con mayor disponible (dedupeAvailabilityRows).
export function dedupeAvailabilityRows(rows: BudgetAvailabilityRow[]): BudgetAvailabilityRow[] {
  const byCategory = new Map<string, BudgetAvailabilityRow>()
  rows.forEach((row) => {
    const id = row.budget_category_id
    if (!id) return
    const current = byCategory.get(id)
    if (!current || getAvailableAmount(row) > getAvailableAmount(current)) byCategory.set(id, row)
  })
  return Array.from(byCategory.values())
}

export function sortAvailabilityRows(
  rows: BudgetAvailabilityRow[],
  categoryById: (id: string) => BudgetCategory | null,
): BudgetAvailabilityRow[] {
  return dedupeAvailabilityRows(rows)
    .filter((r) => r.budget_category_id)
    .sort((a, b) =>
      budgetCategoryLabel(categoryById(a.budget_category_id!)).localeCompare(
        budgetCategoryLabel(categoryById(b.budget_category_id!)),
        'es',
      ),
    )
}

// ── activeRows / helpers de select ─────────────────────────────────────────
export function activeRows<T extends { active?: unknown; activo?: unknown; is_active?: unknown }>(rows: T[]): T[] {
  return rows.filter((row) => row.active !== false && row.activo !== false && row.is_active !== false)
}

export function monthInputToDate(value: string): string | null {
  return value ? `${value}-01` : null
}

// ── Formateo de moneda con currency (formatCurrency del vanilla) ───────────
export function formatCurrencyC(value: unknown, currency = 'MXN'): string {
  const amount = numberValue(value)
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN', maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `$${amount.toFixed(2)} ${currency || 'MXN'}`
  }
}

export function formatMonth(value: unknown): string {
  if (!value) return 'Sin mes'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 'Sin mes'
  return new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(date)
}

// ── Aprobadores ────────────────────────────────────────────────────────────
export function candidateMatchesSelection(candidate: ApproverCandidate | null, selection: ApproverSelection | null): boolean {
  if (!candidate || !selection) return false
  if (candidate.profile_id !== selection.profile_id) return false
  if ((candidate.source || 'approval_rules') !== selection.source) return false
  if (selection.source === 'assigned') return (candidate.assignment_id || null) === selection.assignment_id
  return true
}

export function validateApproverSelection(
  approverId: string,
  assignmentId: string | null,
  candidates: ApproverCandidate[],
): string {
  if (!approverId) return 'Selecciona quién revisará esta solicitud.'
  const selected = candidates.find((c) => c.profile_id === approverId)
  if (!selected) return 'La lista de aprobadores cambió. Revisa las opciones y selecciona nuevamente.'
  if (selected.source === 'assigned' && assignmentId !== (selected.assignment_id || null)) {
    return 'La opción configurada perdió su referencia. Revisa las opciones y selecciona nuevamente.'
  }
  return ''
}

export const APPROVER_STALE_KEYS = [
  'approver_assignment_id_required',
  'approver_assignment_not_active',
  'approver_assignment_snapshot_mismatch',
  'approver_assignment_not_allowed_without_pool',
  'approver_not_in_configured_pool',
  'approver_must_come_from_configured_pool',
  'approver_not_allowed_by_approval_rules',
  'configured_approver_no_longer_eligible',
]

export function isApproverStaleError(error: any): boolean {
  const message = String(error?.message || error || '')
  return APPROVER_STALE_KEYS.some((key) => message.includes(key))
}

// ── Validación del payload de creación (fase2) ─────────────────────────────
export function validateRequestPayload(
  payload: RequestPayload,
  availabilityForCategory: (id: string | null) => BudgetAvailabilityRow | null,
  candidates: ApproverCandidate[],
): string {
  if (!payload.request_type) return 'Selecciona el tipo de solicitud.'
  if (!payload.payment_method) return 'Selecciona el metodo de pago.'
  if (!payload.company_id) return 'Selecciona una empresa.'
  if (!payload.cost_center_id) return 'Selecciona un centro de costo.'
  if (!payload.budget_category_id) return 'Selecciona una partida presupuestal.'
  if (!availabilityForCategory(payload.budget_category_id))
    return 'La partida seleccionada no esta disponible para la empresa, centro de costo y mes.'
  if (!payload.budget_month) return 'Selecciona el mes presupuestal.'
  // En un reembolso el destinatario es un empleado (beneficiary_profile_id),
  // no un proveedor del catálogo: el combo ni siquiera se muestra.
  if (!payload.proveedor_id && payload.request_type !== 'reimbursement')
    return 'Selecciona un proveedor.'
  if (!payload.amount_requested || payload.amount_requested <= 0) return 'El monto solicitado debe ser mayor a 0.'
  if (!payload.currency) return 'Selecciona la moneda.'
  if (!payload.exchange_rate || payload.exchange_rate <= 0) return 'El tipo de cambio debe ser mayor a 0.'
  if (!payload.description) return 'Captura una descripcion.'
  if (['cash', 'check'].includes(payload.payment_method) && !payload.responsible_profile_id)
    return 'Selecciona el responsable del gasto.'
  if (['cash', 'check'].includes(payload.payment_method) && !payload.due_date)
    return 'Captura la fecha limite de comprobacion.'
  return validateApproverSelection(payload.approver_id || '', payload.approver_assignment_id, candidates)
}

// ── Reembolsos ─────────────────────────────────────────────────────────────
export function isReimbursement(raw: unknown): boolean {
  return normalizeRequestType(raw) === 'reimbursement'
}

// La CLABE se guarda como texto (conserva ceros iniciales); aquí solo se
// normalizan separadores para validar los 18 dígitos.
export function normalizeClabe(value: string): string {
  return String(value || '').replace(/[\s-]/g, '')
}

export function isValidClabe(value: string): boolean {
  return /^[0-9]{18}$/.test(normalizeClabe(value))
}

// Qué le falta a la cuenta del empleado para poder dispersarle. Sin banco,
// beneficiario y CLABE (o cuenta) el layout no puede armar la línea.
export function employeeBankAccountIssues(account: EmployeeBankAccount | null): string[] {
  if (!account) return ['Sin datos bancarios registrados']
  const issues: string[] = []
  if (!String(account.beneficiary_name || '').trim()) issues.push('nombre del beneficiario')
  if (!String(account.banco || '').trim()) issues.push('banco')
  const clabe = String(account.clabe || '').trim()
  const cuenta = String(account.cuenta || '').trim()
  if (!clabe && !cuenta) issues.push('CLABE o cuenta')
  else if (clabe && !isValidClabe(clabe)) issues.push('CLABE de 18 dígitos')
  return issues
}

export type ReimbursementTotals = {
  total: number
  subtotal: number | null
  tax: number | null
  dominantCategoryId: string
}

// Totales de la solicitud a partir del desglose:
//  · total    = suma de TODOS los renglones (incluye no deducibles, p.ej. propinas)
//  · IVA      = el de los renglones DEDUCIBLES únicamente (una propina no
//    acredita IVA), y
//  · subtotal = base de TODOS los renglones: base del CFDI en los deducibles y
//    el monto completo en los no deducibles (una nota es 100% base, sin IVA).
//    Equivale a total − IVA, y es lo que exige create_payment_request, que
//    valida subtotal + IVA − retenciones == amount_requested (±0.01);
//    mandar solo la base de los deducibles truena con fiscal_breakdown_mismatch.
//    `deducible` no cambia ni el budget ni la identidad: marca el tratamiento
//    contable (cuenta destino, IVA acreditable / DIOT).
//    Si un renglón deducible no cuadra contra su propio CFDI (importes editados
//    a mano, retenciones) se devuelve null y el presupuesto descuenta el total,
//    como en el resto de tipos.
//  · partida  = la del renglón de mayor monto, para que el gate presupuestal
//    siga teniendo una sola partida contra la cual validar.
export function reimbursementTotals(items: ReimbursementDraftItem[]): ReimbursementTotals {
  let total = 0
  let deducibleTotal = 0
  let deducibleSubtotal = 0
  let tax = 0
  let hasFiscal = false
  let dominantCategoryId = ''
  let dominantAmount = -1
  for (const item of items) {
    const amount = numberValue(item.amount)
    if (!(amount > 0)) continue
    total += amount
    if (item.deducible && item.subtotalAmount != null) {
      hasFiscal = true
      deducibleTotal += amount
      deducibleSubtotal += item.subtotalAmount
      tax += item.taxAmount ?? 0
    }
    if (item.budgetCategoryId && amount > dominantAmount) {
      dominantAmount = amount
      dominantCategoryId = item.budgetCategoryId
    }
  }
  // Los renglones deducibles deben cuadrar contra su propio CFDI; si no, no se
  // manda desglose fiscal global.
  const fiscalOk = hasFiscal && Math.abs(deducibleSubtotal + tax - deducibleTotal) <= 0.01
  return {
    total: round2(total),
    subtotal: fiscalOk ? round2(total - tax) : null,
    tax: fiscalOk ? round2(tax) : null,
    dominantCategoryId,
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// Validación del desglose. La partida es obligatoria en TODOS los renglones,
// deducibles o no: es la que atribuye el gasto a su área (un gasto de RH sin
// factura sigue siendo de RH), y la columna es NOT NULL en la BD. Lo único que
// cambia al marcar "sin comprobante fiscal" es que no se exige el adjunto.
export function validateReimbursementItems(items: ReimbursementDraftItem[]): string {
  if (!items.length) return 'Agrega al menos un gasto al desglose del reembolso.'
  for (const [index, item] of items.entries()) {
    const position = `Gasto ${index + 1}`
    if (!item.descripcion.trim()) return `${position}: captura la descripción del gasto.`
    if (!(numberValue(item.amount) > 0)) return `${position}: el monto debe ser mayor a 0.`
    if (!item.budgetCategoryId) {
      return `${position}: selecciona la partida presupuestal (obligatoria también en gastos sin comprobante).`
    }
    if (item.deducible && !item.file) {
      return `${position}: adjunta el comprobante o márcalo como "sin comprobante fiscal".`
    }
  }
  const total = items.reduce((sum, item) => sum + numberValue(item.amount), 0)
  if (!(total > 0)) return 'La suma del desglose debe ser mayor a 0.'
  return ''
}

// ── Decisiones del aprobador ───────────────────────────────────────────────
export function decisionButtonsFor(request: PaymentRequest): Array<{ label: string; action: DecisionAction; variant: 'approve' | 'reject' | 'change' | 'adjust' }> {
  if (isExceptionRequest(request)) {
    return [
      { label: 'Autorizar excepción', action: 'exception_approved', variant: 'approve' },
      { label: 'Rechazar excepción', action: 'exception_rejected', variant: 'reject' },
      { label: 'Solicitar cambio de monto', action: 'amount_change_requested', variant: 'change' },
      { label: 'Solicitar cambio de partida', action: 'category_change_requested', variant: 'change' },
      { label: 'Solicitar ajuste presupuestal', action: 'budget_adjustment_requested', variant: 'adjust' },
    ]
  }
  return [
    { label: 'Aprobar', action: 'approved', variant: 'approve' },
    { label: 'Rechazar', action: 'rejected', variant: 'reject' },
    { label: 'Solicitar cambios', action: 'changes_requested', variant: 'change' },
  ]
}

export function isDecisionCommentRequired(request: PaymentRequest, action: DecisionAction): boolean {
  if (action === 'approved' && !isExceptionRequest(request)) return false
  return (
    action === 'rejected' ||
    action === 'changes_requested' ||
    action.startsWith('exception_') ||
    action === 'amount_change_requested' ||
    action === 'category_change_requested' ||
    action === 'budget_adjustment_requested'
  )
}

export function decisionActionLabel(action: string): string {
  const labels: Record<string, string> = {
    approved: 'Aprobada',
    rejected: 'Rechazada',
    changes_requested: 'Cambios solicitados',
    exception_approved: 'Excepción autorizada',
    exception_rejected: 'Excepción rechazada',
    amount_change_requested: 'Cambio de monto solicitado',
    category_change_requested: 'Cambio de partida solicitado',
    budget_adjustment_requested: 'Ajuste presupuestal solicitado',
  }
  return labels[action] || action || 'Decisión'
}

// ── Fase 2: request_type / payment_method ──────────────────────────────────
export const REQUEST_TYPE_OPTIONS: Array<[string, string]> = [
  ['provider_payment', 'Pago a proveedor'],
  ['online_purchase', 'Compra en linea'],
  ['reimbursement', 'Reembolso'],
  ['nomina', 'Nómina'],
]

export const PAYMENT_METHOD_OPTIONS: Array<[string, string]> = [
  ['transfer', 'Transferencia'],
  ['cash', 'Efectivo'],
  ['check', 'Cheque'],
  ['other', 'Otro'],
]

const REQUEST_TYPE_LABELS: Record<string, string> = {
  provider_payment: 'Pago a proveedor',
  supplier_payment: 'Pago a proveedor',
  online_purchase: 'Compra en linea',
  reimbursement: 'Reembolso',
  nomina: 'Nómina',
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  transfer: 'Transferencia',
  cash: 'Efectivo',
  check: 'Cheque',
  other: 'Otro',
}

export function normalizeRequestType(raw: unknown): string {
  const key = normalize(raw)
  if (key === 'online_purchase') return 'online_purchase'
  if (key === 'reimbursement') return 'reimbursement'
  if (key === 'nomina' || key === 'payroll') return 'nomina'
  return 'provider_payment'
}

export function normalizePaymentMethod(raw: unknown): string {
  const key = normalize(raw)
  if (!key) return 'transfer'
  if (key.includes('transfer') || key.includes('bancaria') || key.includes('clabe') || key.includes('spei')) return 'transfer'
  if (key.includes('efectivo') || key === 'cash') return 'cash'
  if (key.includes('cheque') || key === 'check') return 'check'
  return 'other'
}

export function requestTypeLabel(raw: unknown): string {
  return REQUEST_TYPE_LABELS[normalizeRequestType(raw)] || 'Pago a proveedor'
}

export function paymentMethodLabel(raw: unknown): string {
  return PAYMENT_METHOD_LABELS[normalizePaymentMethod(raw)] || 'Otro'
}

export function paymentMethodVariant(raw: unknown): BadgeVariant {
  const method = normalizePaymentMethod(raw)
  if (method === 'transfer') return 'success'
  if (method === 'cash') return 'warning'
  if (method === 'check') return 'info'
  return 'neutral'
}

export function effectivePaymentType(request: { payment_method?: string | null; request_type?: string | null }): string {
  const paymentMethod = String(request?.payment_method || '').trim().toLowerCase()
  if (['cash', 'check'].includes(paymentMethod)) return paymentMethod
  const requestType = String(request?.request_type || '').trim().toLowerCase()
  if (['cash', 'check'].includes(requestType)) return requestType
  return requestType || 'provider_payment'
}

// ── Etiquetas del panel de ejecución / extraordinarios (batch_execution) ───
export function extraordinaryStatusLabel(status: string | undefined, secure: boolean): string {
  if (!secure) {
    return (
      ({
        legacy_consumed_unverified: 'Histórico consumido · sin verificación nueva',
        legacy_quarantined: 'Histórico en cuarentena',
        revoked: 'Histórico revocado',
      } as Record<string, string>)[status ?? ''] || 'Histórico contenido'
    )
  }
  return (
    ({
      draft: 'Evidencia pendiente',
      active: 'Vigente · lista para layout',
      consumed_pending_ratification: 'Consumida · ratificación pendiente',
      ratified: 'Ratificada',
      revoked: 'Revocada',
      expired: 'Vencida',
      disputed: 'En discrepancia',
    } as Record<string, string>)[status ?? ''] || status || 'Sin estado'
  )
}

export function extraordinaryCategoryLabel(value: string | null | undefined): string {
  return (
    ({
      operational_emergency: 'Emergencia operativa / fuga',
      urgent_reimbursement: 'Reembolso urgente',
      urgent_termination: 'Desvinculacion o finiquito urgente',
      critical_service: 'Servicio critico',
      other: 'Otro',
    } as Record<string, string>)[value ?? ''] || value || 'Sin categoria'
  )
}

export function batchStatusLabel(batchStatus: string | null | undefined, directorStatus: string | null | undefined): string {
  if (directorStatus === 'rejected') return 'Rechazada por Dirección'
  return (
    ({
      draft: 'Borrador',
      submitted: 'Pendiente de decisión de Dirección',
      approved: 'Dirección aprobó · pendiente de liberación',
      partially_approved: 'Dirección decidió con rechazos · pendiente de liberación',
      closed: 'Aprobada y liberada para pago',
    } as Record<string, string>)[batchStatus ?? ''] || batchStatus || 'Sin estado'
  )
}

export function reviewLabel(value: number | null | undefined): string {
  const sequence = Math.max(1, Number(value || 1))
  return sequence === 1 ? 'Primera revision' : `Revision ${sequence}`
}

export function authorizationBlockReasonLabel(value: string | null | undefined): string {
  return (
    ({
      finance_role_required: 'Solo Finanzas puede autorizar extraordinarios.',
      extraordinary_policy_disabled: 'La contingencia extraordinaria está deshabilitada para esta empresa.',
      external_director_not_active_for_company: 'La empresa no tiene un Director activo elegible para esta contingencia.',
      extraordinary_authorization_already_open: 'La solicitud ya tiene una contingencia abierta o pendiente de ratificación.',
      payment_request_must_be_finance_approved: 'La solicitud requiere validacion de presupuesto antes de continuar.',
      finance_reapproval_required: 'Los datos cambiaron y requieren revalidacion de presupuesto.',
      direction_reapproval_required: 'Los datos cambiaron despues de la autorizacion de Direccion. Debe enviarse nuevamente a un corte.',
      payment_request_already_executed: 'La solicitud ya tiene ejecucion registrada.',
      extraordinary_authorization_already_active: 'La solicitud ya tiene autorizacion extraordinaria activa.',
      direction_rejected_request_cannot_be_extraordinary: 'Un rechazo de Direccion no puede omitirse como extraordinario.',
      submitted_batch_request_cannot_be_extraordinary: 'El corte ya fue enviado a Direccion.',
      remove_request_from_draft_batch_first: 'Retira primero la solicitud del corte en borrador.',
      batch_approved_request_cannot_be_extraordinary: 'La solicitud ya fue decidida dentro de un corte.',
    } as Record<string, string>)[value ?? ''] || 'No disponible para autorizacion extraordinaria.'
  )
}

export function cashFundAvailabilityMessage(
  context: { can_create_cash_fund?: boolean; cash_fund_block_reason?: string | null } | null,
  fund: unknown,
  error: unknown,
): string {
  if (fund) return 'El fondo ya fue creado.'
  if (error || !context) return 'No se pudo confirmar si la solicitud esta autorizada para crear un fondo.'
  if (context.can_create_cash_fund === true) return 'Autorizada y liberada para crear fondo.'
  return (
    ({
      finance_role_required: 'Solo Finanzas puede crear el fondo.',
      cash_fund_batch_not_closed: 'Dirección aprobó; Finanzas debe liberar el corte.',
      cash_fund_direction_pending: 'Pendiente de decisión de Dirección.',
      cash_fund_direction_rejected: 'La solicitud fue rechazada por Dirección.',
      cash_fund_material_change_requires_reapproval: 'Los datos cambiaron y requieren una nueva revisión de Dirección.',
      cash_fund_extraordinary_not_current: 'La autorización extraordinaria ya no está vigente.',
      cash_fund_already_exists: 'El fondo ya fue creado.',
      cash_fund_execution_not_authorized: 'La solicitud todavía no está autorizada para crear un fondo.',
      payment_request_must_be_cash_or_check: 'Solo solicitudes de efectivo o cheque pueden generar fondo.',
    } as Record<string, string>)[context.cash_fund_block_reason ?? ''] ||
    'La solicitud todavía no está autorizada para crear un fondo.'
  )
}

export function executionAuthorizationSourceLabel(source: string | null | undefined): string {
  return (
    ({
      closed_batch: 'Corte cerrado',
      extraordinary: 'Autorización extraordinaria',
      legacy_approved: 'Aprobación heredada',
    } as Record<string, string>)[source ?? ''] || 'No autorizada'
  )
}

// ── Incidencias (detalle) ──────────────────────────────────────────────────
export const INCIDENT_STATUS_MAP: Record<string, string> = {
  open: 'Abierta', invoiced: 'Facturada', paid: 'Pagada', cancelled: 'Cancelada',
}

// Extrae el id de incidencia vinculada de notes: "[Visita/incidencia asociada: <id> ...]".
export function currentLinkedIncidentId(notes: string | null): string | null {
  const marker = (notes || '').match(/\[Visita\/incidencia asociada: ([^\s\]]+)/)
  return marker ? marker[1] : null
}

// ── Mapas de errores (idénticos al vanilla) ────────────────────────────────
const ROUTING_ERRORS: Record<string, string> = {
  fiscal_subtotal_invalid: 'El subtotal del desglose fiscal debe ser mayor a 0.',
  fiscal_breakdown_invalid: 'IVA y retenciones no pueden ser negativos.',
  fiscal_breakdown_mismatch: 'El desglose fiscal no cuadra con el total (subtotal + IVA − retenciones).',
  fiscal_subtotal_required: 'Captura el subtotal para registrar IVA o retenciones.',
  company_scope_required: 'Tu perfil no tiene membresía activa en la empresa seleccionada.',
  approver_id_required: 'Selecciona quién revisará esta solicitud.',
  approver_assignment_id_required: 'Selecciona uno de los aprobadores configurados para ti.',
  approver_assignment_not_allowed_without_pool: 'La opción elegida ya no corresponde al origen disponible. Vuelve a cargar los aprobadores.',
  approver_assignment_not_active: 'El aprobador configurado fue desactivado. Selecciona otra opción.',
  approver_assignment_snapshot_mismatch: 'La opción seleccionada no coincide con la empresa o el solicitante.',
  approver_not_in_configured_pool: 'El aprobador ya no pertenece a tu lista configurada.',
  approver_must_come_from_configured_pool: 'Debes elegir un aprobador de tu lista configurada.',
  approver_not_allowed_by_approval_rules: 'El aprobador ya no cumple las reglas para esta empresa, centro de costo y monto.',
  configured_approver_no_longer_eligible: 'El aprobador configurado ya no tiene membresía o rol elegible.',
  approver_not_eligible_for_company: 'El aprobador ya no es elegible para esta empresa.',
  requester_company_membership_required: 'El solicitante no tiene membresía activa en la empresa.',
  requester_cannot_be_own_approver: 'El solicitante no puede aprobar su propia solicitud.',
}

export function friendlyError(error: any, operation = ''): string {
  const message = error?.message || String(error || 'Error desconocido')
  // create_payment_request todavía exige proveedor. En un reembolso el
  // destinatario es un empleado y mandar un proveedor "de relleno" contaminaría
  // el catálogo, así que se falla con un mensaje que nombra el bloqueo.
  if (message.includes('proveedor_id es obligatorio')) {
    return 'El servidor todavía exige un proveedor al crear la solicitud, y un reembolso se paga a un empleado. '
      + 'Falta liberar el ajuste de create_payment_request para reembolsos; avisa a sistemas antes de reintentar.'
  }
  const routingKey = Object.keys(ROUTING_ERRORS).find((key) => message.includes(key))
  if (routingKey) return ROUTING_ERRORS[routingKey]
  if (message.toLowerCase().includes('row-level security') || error?.code === '42501') {
    return `${operation ? `${operation}: ` : ''}la operacion fue bloqueada por RLS. Revisa policies para usuarios autenticados.`
  }
  if (message.toLowerCase().includes('permission denied')) {
    return `${operation ? `${operation}: ` : ''}faltan permisos para ejecutar la operacion.`
  }
  return message
}

const DECISION_ERRORS: Record<string, string> = {
  payment_request_not_found: 'No se encontró la solicitud.',
  actor_profile_not_found: 'No se pudo identificar el perfil del usuario para registrar la decisión.',
  invalid_action: 'La acción seleccionada no es válida.',
  comments_required_for_exception_action: 'El comentario es obligatorio para decisiones de excepción.',
  comments_required_for_changes_requested: 'El comentario es obligatorio para solicitar cambios.',
  exception_action_not_allowed_for_approvable_request: 'Esta solicitud es aprobable; no admite una acción de excepción.',
  normal_approval_not_allowed_for_budget_exception: 'Una excepción presupuestal no puede aprobarse como solicitud normal.',
  invalid_exception_action: 'La acción no es válida para una excepción presupuestal.',
  actor_has_no_role: 'Tu usuario no tiene un rol asignado para decidir solicitudes.',
  approval_rule_not_found: 'No existe una regla de aprobación activa para tu rol, monto y alcance.',
  actor_cannot_approve: 'Tu rol no tiene permiso para aprobar esta solicitud.',
  actor_cannot_approve_exception: 'Tu rol no tiene permiso para autorizar excepciones presupuestales.',
  actor_cannot_reject: 'Tu rol no tiene permiso para rechazar esta solicitud.',
  actor_cannot_request_changes: 'Tu rol no tiene permiso para solicitar cambios.',
  actor_cannot_request_budget_adjustment: 'Tu rol no tiene permiso para solicitar ajuste presupuestal.',
  selected_approver_only: 'Solo el aprobador seleccionado para esta solicitud puede registrar la decisión.',
  approver_assignment_snapshot_invalid: 'No se pudo validar el origen administrativo del aprobador seleccionado.',
  selected_approver_cannot_approve: 'El aprobador seleccionado ya no cumple la regla para aprobar esta solicitud.',
  selected_approver_cannot_approve_exception: 'El aprobador seleccionado no puede autorizar esta excepción.',
  selected_approver_cannot_reject: 'El aprobador seleccionado no cumple la regla para rechazar esta solicitud.',
  selected_approver_cannot_request_changes: 'El aprobador seleccionado no cumple la regla para solicitar cambios.',
  selected_approver_cannot_request_budget_adjustment: 'El aprobador seleccionado no puede solicitar este ajuste presupuestal.',
  actor_profile_must_match_current_profile: 'La sesión no coincide con el perfil que intenta decidir.',
}

export function friendlyDecisionError(error: any): string {
  const message = error?.message || String(error || 'Error desconocido')
  const key = Object.keys(DECISION_ERRORS).find((item) => message.includes(item))
  if (key) return DECISION_ERRORS[key]
  return friendlyError(error, 'decide_payment_request')
}

// friendlyError de las extensiones extraordinarias (batch_execution).
const EXTRAORDINARY_ERRORS: Record<string, string> = {
  finance_role_required: 'Se requiere rol de Finanzas.',
  extraordinary_policy_disabled: 'La política extraordinaria está deshabilitada para esta empresa.',
  extraordinary_amount_exceeds_policy: 'El importe o la moneda exceden la política extraordinaria de la empresa.',
  extraordinary_category_not_allowed: 'La categoría no está permitida por la política de la empresa.',
  extraordinary_reason_too_short: 'Explica el motivo operativo en al menos 20 caracteres.',
  external_authorization_time_invalid: 'La fecha de autorización es futura, anterior al último cambio material o ya venció.',
  external_director_not_active_for_company: 'El Director seleccionado ya no está activo para la empresa.',
  finance_actor_must_differ_from_external_director: 'Finanzas y el Director externo deben ser personas distintas.',
  invalid_idempotency_key: 'No se pudo establecer la clave idempotente. Cierra y vuelve a abrir el diálogo.',
  idempotency_key_payload_mismatch: 'La clave idempotente ya corresponde a otros datos. Cierra y vuelve a abrir el diálogo.',
  extraordinary_authorization_already_open: 'Ya existe una contingencia abierta para esta solicitud.',
  request_has_rejection_or_open_batch: 'La solicitud tiene un rechazo o un corte abierto y no puede usar la contingencia.',
  budget_revalidation_required: 'El presupuesto debe revalidarse antes de registrar la contingencia.',
  evidence_request_match_attestation_required: 'Confirma que la evidencia coincide con la solicitud.',
  invalid_evidence_type: 'Selecciona un tipo de evidencia permitido.',
  invalid_evidence_sha256: 'No se pudo validar la huella SHA-256 del archivo.',
  invalid_evidence_file: 'La evidencia debe ser PDF, JPG, PNG o WEBP y pesar como máximo 5 MB.',
  extraordinary_evidence_object_not_found: 'La evidencia no quedó disponible en el repositorio privado.',
  extraordinary_evidence_object_metadata_mismatch: 'El tipo o tamaño cargado no coincide con el archivo validado.',
  extraordinary_authorization_expired_or_stale: 'La autorización externa venció o la solicitud cambió antes de activarse.',
  extraordinary_policy_no_longer_matches: 'La política cambió y esta contingencia ya no cumple sus límites.',
  extraordinary_draft_storage_contract_missing: 'El servidor no devolvió una ruta privada válida para la evidencia.',
  extraordinary_authorization_not_activated: 'La evidencia se procesó, pero la autorización no quedó activa.',
  finance_reapproval_required: 'Los datos cambiaron y requieren revalidacion de presupuesto.',
  payment_request_must_be_finance_approved: 'La solicitud requiere validacion de presupuesto antes de continuar.',
  payment_request_already_executed: 'La solicitud ya tiene ejecucion registrada.',
  extraordinary_authorization_already_active: 'Ya existe una autorizacion extraordinaria activa.',
  direction_rejected_request_cannot_be_extraordinary: 'No se puede omitir un rechazo previo de Direccion.',
  submitted_batch_request_cannot_be_extraordinary: 'No se puede autorizar mientras el corte esta enviado.',
  remove_request_from_draft_batch_first: 'Retira primero la solicitud del corte en borrador.',
  batch_approved_request_cannot_be_extraordinary: 'La solicitud ya fue aprobada dentro de un corte.',
  extraordinary_already_materialized: 'No se puede revocar porque ya fue incorporado a un layout, fondo de efectivo o registro de pago.',
}

export function friendlyExtraordinaryError(error: any): string {
  const raw = String(error?.message || error || 'Error no identificado')
  const key = Object.keys(EXTRAORDINARY_ERRORS).find((item) => raw.includes(item))
  return key ? EXTRAORDINARY_ERRORS[key] : raw
}

export function rlsHint(table: string, operation: string, error: any): string {
  const message = error?.message || ''
  if (message.toLowerCase().includes('row-level security') || error?.code === '42501' || message.toLowerCase().includes('permission denied')) {
    return `Operacion ${operation} bloqueada por RLS en ${table}; haria falta una policy para usuarios autenticados.`
  }
  return message
}

// Validación de adjunto de comprobante (upload_helper.js): tipo + tamaño.
const UPLOAD_ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/xml', 'application/xml']
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024
export function validateReceiptFile(file: File): { ok: boolean; message: string } {
  if (!UPLOAD_ACCEPTED.includes(file.type)) return { ok: false, message: 'Tipo no permitido. Usa JPG, PNG, WEBP, PDF o XML.' }
  if (file.size > UPLOAD_MAX_BYTES) return { ok: false, message: 'El archivo supera 10 MB. Elige uno más pequeño.' }
  return { ok: true, message: `${(file.size / 1024).toFixed(0)} KB · listo para subir` }
}

export function normalizeRpcResult<T = any>(data: any): T {
  if (Array.isArray(data)) return (data[0] || {}) as T
  return (data || {}) as T
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function isValidRequestId(value: string | null): boolean {
  return !!value && UUID_RE.test(value)
}

// Filtro de tabla: haystack idéntico al vanilla (NFD via normalize()).
export function requestSearchHaystack(
  request: PaymentRequest,
  proveedor: Proveedor | null,
  company: Company | null,
  center: CostCenter | null,
  category: BudgetCategory | null,
): string {
  return normalize(
    [
      request.request_number,
      request.description,
      request.notes,
      proveedorLabel(proveedor),
      companyName(company),
      costCenterName(center),
      budgetCategoryLabel(category),
    ].join(' '),
  )
}
