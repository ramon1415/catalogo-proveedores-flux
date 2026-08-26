// Lógica pura portada 1:1 de aprobaciones.js (vanilla). Sin DOM ni efectos.
import type { BadgeVariant } from '../../components/ui/Badge'
import { normalize } from '../../lib/format'
import type {
  PaymentRequest, ProviderLite, Company, ApprovalEvent,
  ColumnKey, DecisionAction, ApproverDetails,
} from './types'

export { normalize }

export function byId<T extends { id: string }>(list: T[], id: string | null | undefined): T | undefined {
  return list.find((item) => item.id === id)
}

// Formateo de moneda respetando `currency` (espejo del vanilla, que difiere del
// formatCurrency compartido: éste fija MXN).
export function formatCurrency(value: unknown, currency: string | null | undefined = 'MXN'): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(
    Number(value || 0),
  )
}

// ── Metadata de eventos de aprobación ─────────────────────────
export function attachApprovalMetadata(
  requests: PaymentRequest[],
  events: ApprovalEvent[],
): PaymentRequest[] {
  const byRequest = new Map<string, ApprovalEvent>()
  ;(events || []).forEach((event) => {
    if (!event.payment_request_id || byRequest.has(event.payment_request_id)) return
    byRequest.set(event.payment_request_id, event)
  })
  return (requests || []).map((request) => ({
    ...request,
    __approvalEvent: byRequest.get(request.id) || null,
  }))
}

// ── Clasificación ─────────────────────────────────────────────
export function isPending(r: PaymentRequest): boolean {
  return r.status === 'submitted' || r.status === 'pending_approval' || r.status === 'finance_validation'
}
export function isChanges(r: PaymentRequest): boolean {
  return (
    r.status === 'changes_requested' ||
    r.exception_status === 'changes_requested' ||
    ['amount_change_requested', 'category_change_requested', 'budget_adjustment_requested'].includes(
      r.exception_action || '',
    )
  )
}
export function isException(r: PaymentRequest): boolean {
  return (
    r.budget_decision === 'bloqueado' ||
    r.is_extraordinary_adjustment === true ||
    ['pending', 'requested'].includes(r.exception_status || '')
  )
}
export function columnKey(r: PaymentRequest): ColumnKey {
  if (r.status === 'approved') return 'approved'
  if (r.status === 'rejected' || r.status === 'cancelled') return 'closed'
  if (isChanges(r)) return 'changes'
  if (isException(r)) return 'exceptions'
  return 'pending'
}

// Filas relevantes para la bandeja (misma ventana de 100 días para el historial).
export function approvalRows(requests: PaymentRequest[]): PaymentRequest[] {
  const cutoff = Date.now() - 100 * 24 * 60 * 60 * 1000
  return requests.filter((r) => {
    if (['paid', 'cancelled'].includes(r.status || '')) return false
    if (isPending(r) || isException(r) || isChanges(r)) return true
    if (r.status === 'approved' || r.status === 'rejected') {
      const t = new Date(historyRelevantDate(r) || r.created_at || '').getTime()
      return Number.isNaN(t) || t >= cutoff
    }
    return false
  })
}

// ── Búsqueda ──────────────────────────────────────────────────
export function matchSearch(
  r: PaymentRequest,
  q: string,
  providers: ProviderLite[],
  companies: Company[],
): boolean {
  if (!q) return true
  const provider = byId(providers, r.proveedor_id)
  const company = byId(companies, r.company_id)
  return normalize(
    [r.request_number, r.description, provider?.alias, provider?.nombre_completo, company?.legal_name, company?.name].join(' '),
  ).includes(q)
}

// ── Fechas de historial ───────────────────────────────────────
export type DateMeta = { label: string; value: string }

export function approvalDateMeta(request: PaymentRequest): DateMeta | null {
  const event = request.__approvalEvent
  if (event?.created_at) return { label: decisionDateLabel(event.action), value: event.created_at }
  if (request.exception_approved_at) return { label: 'Excepción autorizada', value: request.exception_approved_at }
  if (request.approved_at) return { label: 'Aprobada', value: request.approved_at }
  if ((request.status === 'approved' || request.status === 'rejected') && request.updated_at) {
    return {
      label: request.status === 'rejected' ? 'Rechazada/actualizada' : 'Aprobada/actualizada',
      value: request.updated_at,
    }
  }
  return null
}

export function historyRelevantDate(request: PaymentRequest): string | null {
  return approvalDateMeta(request)?.value || request.updated_at || request.created_at || null
}

export function decisionDateLabel(action: string): string {
  const labels: Record<string, string> = {
    approved: 'Aprobada',
    exception_approved: 'Excepción autorizada',
    rejected: 'Rechazada',
    exception_rejected: 'Excepción rechazada',
  }
  return labels[action] || 'Decision'
}

// ── Badges ────────────────────────────────────────────────────
// El componente Badge no expone la variante `violet`; para la excepción
// presupuestal el vanilla usa violet, así que devolvemos un marcador especial
// que la página pinta con una clase local.
export type BudgetBadgeDesc = { label: string; variant: BadgeVariant | 'violet' }

export function statusBadge(status: string | null): { label: string; variant: BadgeVariant } {
  const map: Record<string, BadgeVariant> = {
    approved: 'success',
    rejected: 'danger',
    changes_requested: 'warning',
    submitted: 'neutral',
    pending_approval: 'neutral',
    finance_validation: 'info',
  }
  return { label: statusLabel(status), variant: map[status || ''] ?? 'neutral' }
}

export function budgetBadge(r: PaymentRequest): BudgetBadgeDesc {
  if (r.budget_decision === 'aprobable') return { label: 'Aprobable', variant: 'success' }
  if (r.budget_decision === 'bloqueado') return { label: 'Excepcion', variant: 'violet' }
  return { label: r.budget_decision || 'Sin validar', variant: 'neutral' }
}

// ── Labels y formato ──────────────────────────────────────────
export function typeLabel(type: string | null): string {
  const m: Record<string, string> = {
    provider_payment: 'Transferencia',
    cash: 'Efectivo',
    check: 'Cheque',
    reimbursement: 'Reembolso',
    deposit_refund: 'Devolucion de deposito',
    other: 'Otro',
  }
  return m[type || 'provider_payment'] || type || 'Transferencia'
}

export function statusLabel(status: string | null): string {
  const m: Record<string, string> = {
    submitted: 'Pendiente',
    pending_approval: 'Pendiente',
    finance_validation: 'Validacion financiera',
    changes_requested: 'Cambios solicitados',
    approved: 'Aprobada',
    rejected: 'Rechazada',
    paid: 'Pagada',
    cancelled: 'Cancelada',
  }
  return m[status || ''] || status || 'Sin estatus'
}

export function decisionLabel(action: string): string {
  const m: Record<string, string> = {
    approved: 'Aprobacion',
    rejected: 'Rechazo',
    changes_requested: 'Solicitud de cambios',
    exception_approved: 'Excepcion autorizada',
    exception_rejected: 'Excepcion rechazada',
    amount_change_requested: 'Cambio de monto solicitado',
    category_change_requested: 'Cambio de partida solicitado',
    budget_adjustment_requested: 'Ajuste presupuestal solicitado',
  }
  return m[action] || action
}

export function formatMonth(value: string | null): string {
  if (!value) return 'Sin mes'
  const [year, month] = String(value).split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(date)
}

// ── Detalle de aprobador ──────────────────────────────────────
export function approverDetailLabel(row: ApproverDetails | null | undefined): string {
  if (!row?.profile_id) return 'Sin revisor asignado'
  const roles = Array.isArray(row.eligible_roles) && row.eligible_roles.length ? ` · ${row.eligible_roles.join(', ')}` : ''
  const source =
    row.source === 'assigned'
      ? ' · Configurado por administración'
      : row.source === 'approval_rules'
        ? ' · Elegible por reglas'
        : ''
  return `${row.display_name || 'Sin nombre'}${roles}${source}`
}

// ── Acciones de decisión ──────────────────────────────────────
export type DecisionVariant = 'approve' | 'reject' | 'change' | 'exception'
export type DecisionButton = { label: string; action: DecisionAction; variant: DecisionVariant }
export type DecisionActionsResult =
  | { kind: 'message'; text: string }
  | { kind: 'buttons'; buttons: DecisionButton[] }

export function decisionActionsFor(
  request: PaymentRequest,
  canApprove: boolean,
  profileId: string | null | undefined,
): DecisionActionsResult {
  if (!canApprove) return { kind: 'message', text: 'Sin permisos de aprobacion' }
  if (request.approver_id && request.approver_id !== profileId) {
    return { kind: 'message', text: 'Asignada a otro aprobador' }
  }
  if (['approved', 'rejected', 'paid', 'cancelled'].includes(request.status || '') && !isException(request)) {
    return { kind: 'message', text: 'Esta solicitud ya tiene una decision registrada' }
  }
  if (isException(request)) {
    return {
      kind: 'buttons',
      buttons: [
        { label: 'Autorizar excepcion', action: 'exception_approved', variant: 'approve' },
        { label: 'Rechazar excepcion', action: 'exception_rejected', variant: 'reject' },
        { label: 'Cambio de monto', action: 'amount_change_requested', variant: 'change' },
        { label: 'Cambio de partida', action: 'category_change_requested', variant: 'change' },
        { label: 'Ajuste presupuestal', action: 'budget_adjustment_requested', variant: 'exception' },
      ],
    }
  }
  return {
    kind: 'buttons',
    buttons: [
      { label: 'Aprobar', action: 'approved', variant: 'approve' },
      { label: 'Rechazar', action: 'rejected', variant: 'reject' },
      { label: 'Solicitar cambios', action: 'changes_requested', variant: 'change' },
    ],
  }
}

export function requiresComment(action: string): boolean {
  return action !== 'approved'
}

// ── Errores ───────────────────────────────────────────────────
const DECISION_ERROR_MESSAGES: Record<string, string> = {
  actor_cannot_approve: 'Tu rol no tiene permiso para aprobar.',
  actor_cannot_reject: 'Tu rol no tiene permiso para rechazar.',
  comments_required_for_changes_requested: 'El comentario es obligatorio para solicitar cambios.',
  comments_required_for_exception_action: 'El comentario es obligatorio para decisiones de excepcion.',
  selected_approver_only: 'Solo el aprobador seleccionado para esta solicitud puede registrar la decisión.',
  approver_assignment_snapshot_invalid: 'No se pudo validar el origen administrativo del aprobador seleccionado.',
  selected_approver_cannot_approve: 'El aprobador seleccionado ya no cumple la regla para aprobar.',
  selected_approver_cannot_approve_exception: 'El aprobador seleccionado no puede autorizar esta excepción.',
  selected_approver_cannot_reject: 'El aprobador seleccionado ya no cumple la regla para rechazar.',
  selected_approver_cannot_request_changes: 'El aprobador seleccionado ya no cumple la regla para solicitar cambios.',
  selected_approver_cannot_request_budget_adjustment: 'El aprobador seleccionado no puede solicitar este ajuste.',
  actor_profile_must_match_current_profile: 'La sesión no coincide con el perfil que intenta decidir.',
}

export function friendlyDecisionError(error: any): string {
  const msg = error?.message || String(error || '')
  return DECISION_ERROR_MESSAGES[msg] || friendlyError(error)
}

export function friendlyError(error: any): string {
  const msg = error?.message || String(error || 'Error desconocido')
  if (msg.includes('not_allowed') || msg.includes('row-level security') || error?.code === '42501')
    return 'No tienes permiso para realizar esta accion.'
  return msg
}
