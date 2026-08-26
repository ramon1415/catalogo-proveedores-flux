// Lógica pura de Ingresos e Incidencias, portada 1:1 de ingresos.js.
import type { BadgeVariant } from '../../components/ui/Badge'
import { formatCurrency, formatDate, normalize, numberValue } from '../../lib/format'
import type {
  IngresosData, Member, BillingPeriod, MaintenanceFeeCharge, IncidentCharge, Invoice,
  Company, CostCenter, BudgetCategory,
} from './types'

export const PENDING = ['pending', 'partial', 'overdue']
export const OPEN_INCIDENTS = ['open', 'invoiced']
export const LINEAGES = ['SNR', 'SNM', 'PSN', 'CSN', 'FSN']

// ── Formateo específico del módulo ─────────────────────────────────
// El vanilla usa "—" para fechas vacías/ inválidas (formatDate compartido usa "Sin fecha").
export function dateCell(value: unknown): string {
  if (!value) return '—'
  const formatted = formatDate(value)
  return formatted === 'Sin fecha' ? '—' : formatted
}

// fee_factor con hasta 3 decimales (formatNum del vanilla).
export function formatFactor(value: unknown): string {
  return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 }).format(numberValue(value))
}

function sum<T>(rows: T[], key: keyof T): number {
  return rows.reduce((s, r) => s + numberValue(r[key]), 0)
}

// ── Labels ─────────────────────────────────────────────────────────
export function chargeLabel(s: string | null): string {
  return ({ pending: 'Pendiente', partial: 'Parcial', paid: 'Pagada', overdue: 'Vencida', cancelled: 'Cancelada' } as Record<string, string>)[s || ''] || s || '—'
}
export function incidentLabel(s: string | null): string {
  return ({ open: 'Abierta', invoiced: 'Facturada', paid: 'Cobrada', cancelled: 'Cancelada' } as Record<string, string>)[s || ''] || s || '—'
}
export function invoiceStatusLabel(s: string | null): string {
  return ({ issued: 'Emitida', paid: 'Pagada', cancelled: 'Cancelada' } as Record<string, string>)[s || ''] || s || '—'
}
export function periodStatusLabel(s: string | null): string {
  return ({ open: 'Abierto', closed: 'Cerrado', cancelled: 'Cancelado' } as Record<string, string>)[s || ''] || s || '—'
}

// ── Badges ─────────────────────────────────────────────────────────
export function badgeVariant(s: string | null): BadgeVariant {
  return (({
    active: 'success', open: 'success', pending: 'warning', partial: 'warning', overdue: 'warning',
    issued: 'warning', invoiced: 'info', paid: 'success', closed: 'success',
    inactive: 'neutral', cancelled: 'neutral', neutral: 'neutral',
  } as Record<string, BadgeVariant>)[s || ''] || 'neutral')
}

// ── Lookups sobre IngresosData ─────────────────────────────────────
export function makeLookups(d: IngresosData) {
  const memberById = (id: string | null): Member | undefined => d.members.find((x) => x.id === id)
  const periodById = (id: string | null): BillingPeriod | undefined => d.periods.find((x) => x.id === id)
  const invoiceById = (id: string | null): Invoice | undefined => d.invoices.find((x) => x.id === id)
  const chargeById = (id: string | null): MaintenanceFeeCharge | undefined => d.charges.find((x) => x.id === id)
  const incidentById = (id: string | null): IncidentCharge | undefined => d.incidents.find((x) => x.id === id)

  const memberName = (id: string | null): string => memberById(id)?.full_name || ''
  const companyName = (id: string | null): string => {
    const c = d.companies.find((x) => x.id === id)
    return c?.legal_name || c?.name || ''
  }
  const periodLabel = (p: BillingPeriod | undefined | null): string =>
    p ? `${p.name || 'Periodo'} ${p.year || ''}`.trim() : 'Sin periodo'
  const centerLabel = (c: CostCenter): string => [c.code, c.name].filter(Boolean).join(' - ') || c.id
  const catLabel = (c: BudgetCategory): string => [c.code, c.name || c.category].filter(Boolean).join(' - ') || c.id

  const receiverType = (i: IncidentCharge | undefined | null): 'member' | 'external' => (i?.member_id ? 'member' : 'external')
  const incidentReceiver = (i: IncidentCharge | undefined | null): string =>
    !i ? 'Sin receptor' : i.member_id ? memberName(i.member_id) || 'Socio no encontrado' : i.external_name || 'Externo'

  const invoiceReceiver = (i: Invoice | undefined | null): string => {
    if (!i) return 'Sin receptor'
    if (i.member_id) return memberName(i.member_id) || 'Socio no encontrado'
    if (i.external_name) return i.external_name
    if (i.charge_id) return memberName(chargeById(i.charge_id)?.member_id ?? null) || 'Socio no encontrado'
    if (i.incident_charge_id) return incidentReceiver(incidentById(i.incident_charge_id))
    return 'Sin receptor'
  }
  const invoiceRef = (i: Invoice): string => {
    if (i.invoice_type === 'maintenance_fee') {
      const c = chargeById(i.charge_id)
      return `Cuota ${periodLabel(periodById(c?.billing_period_id ?? null))}`
    }
    const inc = incidentById(i.incident_charge_id)
    return `Incidencia ${inc?.description || ''}`.trim()
  }

  return {
    memberById, periodById, invoiceById, chargeById, incidentById,
    memberName, companyName, periodLabel, centerLabel, catLabel,
    receiverType, incidentReceiver, invoiceReceiver, invoiceRef,
  }
}

export type Lookups = ReturnType<typeof makeLookups>

// ── Stats ──────────────────────────────────────────────────────────
export function computeStats(d: IngresosData) {
  const activeMembers = d.members.filter((m) => m.active !== false).length
  const pendingCharges = d.charges.filter((c) => PENDING.includes(c.status || '')).length
  const pendingAmount = d.charges.filter((c) => PENDING.includes(c.status || '')).reduce((s, c) => s + numberValue(c.pending_amount), 0)
  const openIncidents = d.incidents.filter((i) => OPEN_INCIDENTS.includes(i.status || '')).length
  const pendingInvoices = d.invoices.filter((i) => i.status === 'issued').length
  return { activeMembers, pendingCharges, pendingAmount, openIncidents, pendingInvoices }
}

// ── Dashboard summary ──────────────────────────────────────────────
export function computeDashboard(d: IngresosData) {
  const expected = sum(d.charges, 'expected_amount')
  const collected = sum(d.charges, 'paid_amount')
  const pending = d.charges.filter((c) => PENDING.includes(c.status || '')).reduce((s, c) => s + numberValue(c.pending_amount), 0)
  const inc = d.incidents.filter((i) => OPEN_INCIDENTS.includes(i.status || '')).reduce((s, i) => s + numberValue(i.amount), 0)
  const inv = d.invoices.filter((i) => i.status === 'issued').reduce((s, i) => s + numberValue(i.amount), 0)
  return { expected, collected, pending, inc, inv }
}

// ── Estado de cuenta de socio ──────────────────────────────────────
export function computeStatement(d: IngresosData, memberId: string) {
  const cs = d.charges.filter((c) => c.member_id === memberId)
  const is = d.incidents.filter((i) => i.member_id === memberId)
  const refs = d.incidents.filter((i) => i.referred_by_member_id === memberId && i.member_id !== memberId)
  const expected = sum(cs, 'expected_amount')
  const paid = sum(cs, 'paid_amount')
  const pending = cs.filter((c) => PENDING.includes(c.status || '')).reduce((s, c) => s + numberValue(c.pending_amount), 0)
  const openInc = is.filter((i) => OPEN_INCIDENTS.includes(i.status || '')).reduce((s, i) => s + numberValue(i.amount), 0)
  const paidInc = is.filter((i) => i.status === 'paid').reduce((s, i) => s + numberValue(i.amount), 0)
  const refOpen = refs.filter((i) => OPEN_INCIDENTS.includes(i.status || '')).reduce((s, i) => s + numberValue(i.amount), 0)
  return { expected, paid, pending, openInc, paidInc, refOpen }
}

// ── Filtros de las tablas ──────────────────────────────────────────
export type MemberFilters = { query: string; status: string; lineage: string }
export function filterMembers(d: IngresosData, f: MemberFilters, quick: string | null): Member[] {
  const q = normalize(f.query)
  return d.members.filter((m) =>
    (!q || normalize([m.full_name, m.rfc, m.email].join(' ')).includes(q)) &&
    (f.status === 'todos' || (f.status === 'active' ? m.active !== false : m.active === false)) &&
    (f.lineage === 'todos' || m.lineage === f.lineage) &&
    (quick !== 'members' || m.active !== false),
  )
}

export type PaymentFilters = { query: string; status: string; period: string }
export function filterPaymentCharges(d: IngresosData, f: PaymentFilters, quick: string | null, lk: Lookups): MaintenanceFeeCharge[] {
  let rows = d.charges.filter((c) => PENDING.includes(c.status || ''))
  if (quick === 'pendingFees' || quick === 'pendingAmount') rows = rows.filter((c) => numberValue(c.pending_amount) > 0)
  const q = normalize(f.query)
  return rows.filter((c) =>
    (!q || normalize([lk.memberName(c.member_id), lk.periodLabel(lk.periodById(c.billing_period_id))].join(' ')).includes(q)) &&
    (f.status === 'todos' || c.status === f.status) &&
    (f.period === 'todos' || c.billing_period_id === f.period),
  )
}

export function chargesForPeriod(d: IngresosData, periodId: string | null): MaintenanceFeeCharge[] {
  return d.charges.filter((c) => c.billing_period_id === periodId)
}

export type IncidentFilters = { query: string; status: string; receiver: string; date: string }
export function filterIncidents(d: IngresosData, f: IncidentFilters, quick: string | null, lk: Lookups): IncidentCharge[] {
  const q = normalize(f.query)
  return d.incidents.filter((i) =>
    (!q || normalize([lk.incidentReceiver(i), i.external_rfc, i.description, lk.memberName(i.referred_by_member_id)].join(' ')).includes(q)) &&
    (f.status === 'todos' || (f.status === 'pending_collection' ? OPEN_INCIDENTS.includes(i.status || '') : i.status === f.status)) &&
    (f.receiver === 'todos' || lk.receiverType(i) === f.receiver) &&
    (!f.date || String(i.incident_date).slice(0, 10) === f.date) &&
    (quick !== 'openIncidents' || OPEN_INCIDENTS.includes(i.status || '')),
  )
}

export type InvoiceFilters = { query: string; type: string; status: string; date: string }
export function filterInvoices(d: IngresosData, f: InvoiceFilters, quick: string | null, lk: Lookups): Invoice[] {
  const q = normalize(f.query)
  return d.invoices.filter((i) =>
    (!q || normalize([lk.invoiceReceiver(i), i.receiver_rfc, i.fiscal_uuid, i.series_folio].join(' ')).includes(q)) &&
    (f.type === 'todos' || i.invoice_type === f.type) &&
    (f.status === 'todos' || i.status === f.status) &&
    (!f.date || String(i.issue_date).slice(0, 10) === f.date) &&
    (quick !== 'pendingInvoices' || i.status === 'issued'),
  )
}

// ── Filtros de catálogo ────────────────────────────────────────────
export function activeMembers(d: IngresosData): Member[] {
  return d.members.filter((m) => m.active !== false)
}
export function activeCompanies(d: IngresosData): Company[] {
  return d.companies.filter((c) => c.active !== false)
}
export function costCentersForCompany(d: IngresosData, companyId: string): CostCenter[] {
  return d.costCenters.filter((c) => !companyId || c.company_id === companyId)
}

// ── Etiquetas de filtro rápido ─────────────────────────────────────
export function quickFilterLabel(quick: string | null): string {
  const labels: Record<string, string> = {
    members: 'Vista filtrada: Socios activos',
    pendingFees: 'Vista filtrada: Cuotas pendientes',
    pendingAmount: 'Vista filtrada: Monto pendiente',
    openIncidents: 'Vista filtrada: Incidencias abiertas',
    pendingInvoices: 'Vista filtrada: Facturas pendientes',
  }
  return (quick && labels[quick]) || 'Vista filtrada'
}

// ── Errores RPC ────────────────────────────────────────────────────
const KNOWN_RPC_ERRORS: Record<string, string> = {
  billing_period_required: 'Selecciona un periodo.',
  billing_period_not_found: 'No se encontro el periodo.',
  billing_period_not_open: 'El periodo no esta abierto.',
  billing_period_total_budget_required: 'Captura presupuesto total.',
  no_active_members: 'No hay socios activos para generar cuotas.',
  charge_required: 'No se encontro la cuota.',
  charge_not_found: 'La cuota no existe.',
  invalid_payment_amount: 'El monto debe ser mayor a cero.',
  payment_date_required: 'Captura fecha de pago.',
  invalid_payment_method: 'Metodo de pago invalido.',
  charge_cancelled: 'La cuota esta cancelada.',
  incident_receiver_required: 'Selecciona socio o captura externo.',
  member_not_found: 'No se encontro el socio.',
  referred_member_not_found: 'No se encontro el socio referidor.',
  description_required: 'Captura descripcion.',
  invalid_incident_amount: 'El monto debe ser mayor a cero.',
  incident_date_required: 'Captura fecha.',
  invalid_invoice_type: 'Tipo de factura invalido.',
  invoice_reference_required: 'No se encontro la referencia de factura.',
  invalid_invoice_amount: 'El monto de factura no puede ser negativo.',
  issue_date_required: 'Captura fecha de emision.',
  incident_charge_not_found: 'No se encontro la incidencia.',
  invoice_required: 'No se encontro la factura.',
  invoice_not_found: 'La factura no existe.',
  invoice_cancelled: 'La factura esta cancelada.',
  invoice_already_paid: 'La factura ya estaba pagada.',
}

export function friendlyError(error: any): string {
  const m = error?.message || String(error || 'Error desconocido')
  if (m.toLowerCase().includes('row-level security') || error?.code === '42501' || m.toLowerCase().includes('permission denied'))
    return 'No tienes permiso para realizar esta accion.'
  return m
}

export function rpcError(error: any): string {
  const m = error?.message || String(error || 'Error desconocido')
  const key = Object.keys(KNOWN_RPC_ERRORS).find((k) => m.includes(k))
  return key ? KNOWN_RPC_ERRORS[key] : friendlyError(error)
}

// ── Validación de archivos (espejo de upload_helper.js) ────────────
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024
const UPLOAD_ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/xml', 'application/xml']

export type FileHint = { file: File | null; message: string; tone: 'ok' | 'error' | 'default' }

// Valida tipo y tamaño como initFileUpload; si es inválido descarta el archivo.
export function validateUploadFile(file: File | null): FileHint {
  if (!file) return { file: null, message: '', tone: 'default' }
  if (!UPLOAD_ACCEPTED.includes(file.type))
    return { file: null, message: 'Tipo no permitido. Usa JPG, PNG, WEBP, PDF o XML.', tone: 'error' }
  if (file.size > UPLOAD_MAX_BYTES)
    return { file: null, message: 'El archivo supera 10 MB. Elige uno más pequeño.', tone: 'error' }
  return { file, message: `${(file.size / 1024).toFixed(0)} KB · listo para subir`, tone: 'ok' }
}

// Reutilizado para el subtítulo del modal de cobro / factura.
export { formatCurrency }
