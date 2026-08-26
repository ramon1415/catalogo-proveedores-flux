// Lógica pura de Efectivo, portada 1:1 de efectivo.js.
import type { BadgeVariant } from '../../components/ui/Badge'
import { normalize, numberValue } from '../../lib/format'
import type {
  CashData, CashFund, Reconciliation, ReconciliationItem, ReviewAction,
  Company, BudgetCategory, ProviderLite, ProfileLite, PaymentRequest,
} from './types'

export const ACTIVE_FUND_STATUSES = ['active', 'pending_receipt', 'receipt_review', 'blocked']
export const PENDING_FUND_STATUSES = ['pending_receipt', 'blocked']
const REVIEW_ROLES = ['admin', 'finance', 'finanzas', 'approver_2', 'aprobador_2', 'sysadmin', 'system_admin', 'treasury', 'tesoreria']

export function normalizeRole(value: unknown): string {
  return normalize(value).replace(/\s+/g, '_')
}

export function canReview(roles: string[]): boolean {
  return roles.some((role) => REVIEW_ROLES.includes(normalizeRole(role)))
}

// ── Badges ─────────────────────────────────────────────
type BadgeDesc = { label: string; variant: BadgeVariant }

export function fundStatusBadge(status: string | null): BadgeDesc {
  const labels: Record<string, string> = { active: 'Activo', pending_receipt: 'Por comprobar', blocked: 'Bloqueado', receipt_review: 'En revisión', verified: 'Verificado', closed: 'Cerrado', cancelled: 'Cancelado' }
  const variants: Record<string, BadgeVariant> = { active: 'accent', pending_receipt: 'warning', blocked: 'danger', receipt_review: 'info', verified: 'success', closed: 'neutral', cancelled: 'neutral' }
  const s = status || 'neutral'
  return { label: labels[s] || s, variant: variants[s] || 'neutral' }
}

export function reconciliationStatusBadge(status: string | null): BadgeDesc {
  const labels: Record<string, string> = { draft: 'Borrador', submitted: 'En revisión', approved: 'Aprobada', rejected: 'Rechazada', correction_requested: 'Corrección' }
  const variants: Record<string, BadgeVariant> = { draft: 'neutral', submitted: 'info', approved: 'success', rejected: 'danger', correction_requested: 'warning' }
  const s = status || 'neutral'
  return { label: labels[s] || s, variant: variants[s] || 'neutral' }
}

export function itemStatusBadge(status: string | null): BadgeDesc {
  return status === 'rejected' ? { label: 'Rechazado', variant: 'danger' } : { label: 'Válido', variant: 'success' }
}

// ── Labels ─────────────────────────────────────────────
export function methodLabel(method: string | null): string {
  return ({ cash: 'Efectivo', check: 'Cheque' } as Record<string, string>)[method || ''] || 'Sin método'
}
export function fundStatusLabel(status: string | null): string {
  return (
    ({ active: 'Activo', pending_receipt: 'Pendiente de comprobar', blocked: 'Bloqueado', receipt_review: 'En revisión', verified: 'Verificado', closed: 'Cerrado', cancelled: 'Cancelado' } as Record<string, string>)[status || ''] ||
    status || 'Sin estatus'
  )
}
export function reviewActionTitle(action: ReviewAction): string {
  return ({ approved: 'Aprobar comprobación', rejected: 'Rechazar comprobación', correction_requested: 'Solicitar corrección' } as Record<string, string>)[action] || 'Revisar comprobación'
}
export function reviewActionButton(action: ReviewAction): string {
  return ({ approved: 'Aprobar', rejected: 'Rechazar', correction_requested: 'Solicitar corrección' } as Record<string, string>)[action] || 'Registrar decisión'
}

// ── Lookups sobre CashData ─────────────────────────────
export function makeLookups(d: CashData, currentProfile: ProfileLite | null) {
  const fundById = (id: string | null) => d.cashFunds.find((x) => x.id === id) || null
  const reconciliationById = (id: string | null) => d.reconciliations.find((x) => x.id === id) || null
  const reconciliationForFund = (fundId: string): Reconciliation | null =>
    d.reconciliations
      .filter((x) => x.cash_fund_id === fundId)
      .sort((a, b) => +new Date(b.created_at || 0) - +new Date(a.created_at || 0))[0] || null
  const itemsForReconciliation = (id: string): ReconciliationItem[] =>
    d.reconciliationItems
      .filter((x) => x.reconciliation_id === id)
      .sort((a, b) => +new Date(a.ticket_date || a.created_at || 0) - +new Date(b.ticket_date || b.created_at || 0))
  const totalValidTickets = (id: string) =>
    itemsForReconciliation(id).filter((x) => x.status !== 'rejected').reduce((s, x) => s + numberValue(x.amount), 0)
  const paymentRequestById = (id: string | null): PaymentRequest | null => d.paymentRequests.find((x) => x.id === id) || null
  const profileById = (id: string | null): ProfileLite | null =>
    d.profiles.find((x) => x.id === id) || (currentProfile?.id === id ? currentProfile : null)
  const companyById = (id: string | null): Company | null => d.companies.find((x) => x.id === id) || null
  const providerById = (id: string | null): ProviderLite | null => d.proveedores.find((x) => x.id === id) || null
  const budgetCategoryById = (id: string | null): BudgetCategory | null => d.budgetCategories.find((x) => x.id === id) || null

  const profileName = (id: string | null) => {
    const p = profileById(id)
    return p ? p.full_name || p.email || 'Responsable' : 'Sin responsable'
  }
  const companyName = (id: string | null) => {
    const c = companyById(id)
    return c ? c.legal_name || c.name || 'Empresa' : 'Sin empresa'
  }
  const providerLabel = (p: ProviderLite | null) => (p ? p.alias || p.nombre_completo || p.rfc || 'Proveedor' : 'Sin proveedor')
  const providerName = (id: string | null) => (id ? providerLabel(providerById(id)) : 'Sin proveedor')
  const budgetCategoryLabel = (c: BudgetCategory | null) =>
    c ? `${c.code ? `${c.code} - ` : ''}${c.name || c.nombre || 'Sin nombre'}` : 'Sin partida'
  const budgetCategoryName = (id: string | null) => (id ? budgetCategoryLabel(budgetCategoryById(id)) : 'Sin partida')

  return {
    fundById, reconciliationById, reconciliationForFund, itemsForReconciliation, totalValidTickets,
    paymentRequestById, profileById, companyById, providerById, budgetCategoryById,
    profileName, companyName, providerLabel, providerName, budgetCategoryLabel, budgetCategoryName,
  }
}

// ── Stats ──────────────────────────────────────────────
export function computeStats(d: CashData) {
  const activeCount = d.cashFunds.filter((f) => ACTIVE_FUND_STATUSES.includes(f.status || '')).length
  const pendingCount = d.cashFunds.filter((f) => PENDING_FUND_STATUSES.includes(f.status || '')).length
  const reviewIds = new Set(
    [
      ...d.cashFunds.filter((f) => f.status === 'receipt_review').map((f) => f.id),
      ...d.reconciliations.filter((r) => r.status === 'submitted').map((r) => r.cash_fund_id),
    ].filter(Boolean),
  )
  const closedCount = d.cashFunds.filter((f) => f.status === 'closed').length
  const pendingAmount = d.cashFunds
    .filter((f) => !['closed', 'cancelled'].includes(f.status || ''))
    .reduce((s, f) => s + numberValue(f.pending_amount), 0)
  return { activeCount, pendingCount, reviewCount: reviewIds.size, closedCount, pendingAmount }
}

// ── Filtros de la tabla ────────────────────────────────
export type CashFilters = { query: string; status: string; method: string; responsibleId: string; companyId: string }

export function filterFunds(
  d: CashData,
  f: CashFilters,
  helpers: { paymentRequestById: (id: string | null) => PaymentRequest | null; profileName: (id: string | null) => string; companyName: (id: string | null) => string },
): CashFund[] {
  const q = normalize(f.query)
  return d.cashFunds.filter((fund) => {
    const request = helpers.paymentRequestById(fund.payment_request_id)
    const searchable = normalize(
      [request?.request_number, request?.description, fund.notes, helpers.profileName(fund.responsible_profile_id), helpers.companyName(fund.company_id)].join(' '),
    )
    return (
      searchable.includes(q) &&
      (f.status === 'todos' || fund.status === f.status) &&
      (f.method === 'todos' || fund.delivery_method === f.method) &&
      (f.responsibleId === 'todos' || fund.responsible_profile_id === f.responsibleId) &&
      (f.companyId === 'todos' || fund.company_id === f.companyId)
    )
  })
}

// ── Errores RPC ────────────────────────────────────────
const KNOWN_RPC_ERRORS: Record<string, string> = {
  cash_fund_not_found: 'No se encontró el fondo.',
  cash_fund_not_open_for_reconciliation: 'Este fondo ya no permite comprobación.',
  open_reconciliation_already_exists: 'Ya existe una comprobación abierta para este fondo.',
  not_allowed_to_create_reconciliation: 'No tienes permiso para crear esta comprobación.',
  reconciliation_has_no_amounts: 'Agrega al menos un ticket o registra monto devuelto.',
  reconciliation_exceeds_assigned_amount: 'La suma de tickets y devuelto excede el fondo asignado.',
  only_draft_or_correction_can_be_submitted: 'Solo se pueden enviar comprobaciones en borrador o corrección.',
  not_allowed_to_review_reconciliation: 'No tienes permiso para revisar esta comprobación.',
  only_submitted_reconciliations_can_be_reviewed: 'Solo se pueden revisar comprobaciones enviadas.',
  review_comment_required: 'Captura un comentario para rechazar o solicitar corrección.',
  profile_not_found: 'No se pudo identificar el perfil del usuario.',
}

export function friendlyError(error: any): string {
  const message = error?.message || String(error || 'Error desconocido')
  if (message.toLowerCase().includes('row-level security') || error?.code === '42501')
    return 'La operación fue bloqueada por RLS. Revisa policies para usuarios autenticados.'
  if (message.toLowerCase().includes('permission denied')) return 'Faltan permisos para ejecutar la operación.'
  return message
}

export function friendlyRpcError(error: any): string {
  const message = error?.message || String(error || 'Error desconocido')
  const key = Object.keys(KNOWN_RPC_ERRORS).find((k) => message.includes(k))
  return key ? KNOWN_RPC_ERRORS[key] : friendlyError(error)
}

export function rlsHint(table: string, operation: string, error: any): string {
  const message = error?.message || ''
  if (message.toLowerCase().includes('row-level security') || error?.code === '42501' || message.toLowerCase().includes('permission denied'))
    return `Operación ${operation} bloqueada por RLS en ${table}.`
  return message || `No se pudo ejecutar ${operation} en ${table}.`
}
