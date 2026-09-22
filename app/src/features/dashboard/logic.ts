// Lógica pura del Dashboard, portada 1:1 de dashboard.js.
import type { BadgeVariant } from '../../components/ui/Badge'
import type { RoleGroup } from '../../lib/roles'
import { ROLE_GROUPS } from '../../lib/roles'
import type {
  DashboardPayload, DashboardState, Kpis, BudgetRow, YtdRow, IncomeMemberRow,
  ClosureChecklist, HistoricalActual, HistMapeo,
  BudgetAvailabilityRow, BudgetCategoryMeta, BudgetAggregate, BudgetPartida, BudgetTotals, BudgetCoverage,
  PaymentRequestRow, RequestAmountSummary, RequestsAggregate, RequestStage, RequestStatusLine, TaxesAggregate, DashboardActivity,
} from './types'

// ── Formateadores es-MX (idénticos a dashboard.js) ──────────────────────────
const moneyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })
const numFmt = new Intl.NumberFormat('es-MX')
const pctFmt = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }
export function money(v: unknown): string { return moneyFmt.format(num(v)) }
export function whole(v: unknown): string { return numFmt.format(num(v)) }
export function pct(v: unknown): string { return `${pctFmt.format(num(v))}%` }
export function ensureArray<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : [] }
export function uniqueSorted(arr: unknown[]): string[] {
  return [...new Set(arr.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b, 'es'))
}
export function normKey(v: unknown): string {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '-')
}
function r2(v: number): number { return Math.round(v * 100) / 100 }

// normalize(data) del vanilla: payload puede venir como string JSON.
export function parsePayload(data: unknown): DashboardPayload {
  if (!data) return {}
  if (typeof data === 'string') {
    try { return JSON.parse(data) } catch { return {} }
  }
  return data as DashboardPayload
}

export function toDashboardState(payload: DashboardPayload): DashboardState {
  return {
    kpis: payload.kpis || {},
    budgetComparison: ensureArray<BudgetRow>(payload.budget_comparison),
    ytd: ensureArray<YtdRow>(payload.ytd),
    incomeMembers: ensureArray<IncomeMemberRow>(payload.income_members),
    closureChecklist: payload.closure_checklist || {},
    closureComments: ensureArray<unknown>(payload.closure_comments),
  }
}

// ── Fechas / periodo ─────────────────────────────────────────────────────────
export function currentPeriodKey(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

export function fmtDateTime(v: unknown): string {
  if (!v) return '—'
  const d = v instanceof Date ? v : new Date(v as string)
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleString('es-MX', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ── Labels (idénticos a dashboard.js) ────────────────────────────────────────
export const checkLabels: Record<string, string> = {
  pending_payment_requests: 'Solicitudes pendientes de atencion',
  approved_without_operation: 'Solicitudes aprobadas sin operacion',
  unconfirmed_layouts: 'Layouts no confirmados',
  unpaid_approved_requests: 'Solicitudes aprobadas sin pago',
  overdue_cash_funds: 'Fondos vencidos',
  cash_reconciliations_in_review: 'Comprobaciones en revision',
  open_incidents: 'Incidencias abiertas',
  issued_unpaid_invoices: 'Facturas emitidas sin pago',
  overdue_maintenance_fees: 'Cuotas vencidas',
  missing_budget_comments: 'Comentarios de presupuesto pendientes',
}

// ── Badges ───────────────────────────────────────────────────────────────────
export type BadgeDesc = { label: string; variant: BadgeVariant }

export function incomeStatusBadge(status: string | null | undefined): BadgeDesc {
  const map: Record<string, [string, BadgeVariant]> = {
    pending: ['Pendiente', 'warning'],
    partial: ['Parcial', 'warning'],
    paid: ['Pagado', 'success'],
    overdue: ['Vencido', 'danger'],
  }
  const [label, variant] = map[status || ''] || [status || '—', 'neutral']
  return { label, variant }
}

export function closureStatusBadge(status: string | null | undefined): BadgeDesc {
  const map: Record<string, [string, BadgeVariant]> = {
    open: ['Abierto', 'info'],
    review: ['En revision', 'warning'],
    closed: ['Cerrado', 'success'],
    cancelled: ['Cancelado', 'neutral'],
    not_created: ['Sin cierre', 'neutral'],
  }
  const [label, variant] = map[status || ''] || [status || '—', 'neutral']
  return { label, variant }
}

// ── Gate de rol (dashboard: SYSADMIN/ADMIN/DIRECTION) ────────────────────────
const DASHBOARD_GROUPS: RoleGroup[] = [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION]
export function canViewDashboard(group: RoleGroup): boolean {
  return DASHBOARD_GROUPS.includes(group)
}

// ── KPIs derivados (renderKpis) ──────────────────────────────────────────────
export function computeKpis(kpis: Kpis, budgetComparison: BudgetRow[], closureChecklist: ClosureChecklist) {
  const inc = kpis.ingresos || {}
  const cash = kpis.efectivo || {}
  const checks = closureChecklist?.checks || {}

  const budget = budgetComparison.reduce((s, r) => s + num(r.budget_amount), 0)
  const executed = budgetComparison.reduce((s, r) => s + num(r.executed_amount), 0)
  const execPct = budget > 0 ? Math.min(100, (executed / budget) * 100) : 0

  const expected = num(inc.maintenance_expected)
  const collected = num(inc.maintenance_collected)
  const collPct = expected > 0 ? Math.min(100, (collected / expected) * 100) : 0

  const active = num(cash.active_cash_funds)
  const pending = num(cash.pending_cash_reconciliation)
  const overdue = num(cash.overdue_cash_funds)
  const verified = active - pending - overdue
  const cashPct = active > 0 ? Math.min(100, (Math.max(0, verified) / active) * 100) : 0

  const openInc = num(inc.open_incidents)
  const paidInc = num(inc.paid_incidents)
  const totalInc = openInc + paidInc
  const incPct = totalInc > 0 ? Math.min(100, (paidInc / totalInc) * 100) : 100
  const blockers = Object.values(checks).filter((v) => num(v) > 0).length

  return {
    executed: money(executed),
    executedSub: `de ${money(budget)} presupuestado · ${pct(execPct)}`,
    execPct,
    collected: money(collected),
    collectedSub: `de ${money(expected)} esperado · ${pct(collPct)}`,
    collPct,
    cash: `${whole(active)} fondos`,
    cashSub: `${whole(Math.max(0, verified))} comprobados · ${whole(pending)} pendientes`,
    cashPct,
    incidents: whole(openInc),
    incidentsSub: `${whole(blockers)} bloqueos de cierre`,
    incPct,
  }
}

// ── Closure (renderClosure) ──────────────────────────────────────────────────
export function computeClosure(kpis: Kpis, closureChecklist: ClosureChecklist) {
  const checks = closureChecklist.checks || {}
  const status = kpis.cierre?.closure_status || 'not_created'
  const canClose = Boolean(closureChecklist.can_close)
  const blockers = ensureArray<string>(closureChecklist.blocking_reasons)
  const statusLabel = canClose
    ? 'Listo para cerrar'
    : `${blockers.length || Object.values(checks).filter((v) => num(v) > 0).length} bloqueos activos`
  const blockersText = blockers.length
    ? blockers.map((k) => checkLabels[k] || k).join(', ')
    : 'Sin bloqueos criticos'
  const checkEntries = Object.entries(checks).map(([key, value]) => ({
    label: checkLabels[key] || key,
    blocks: num(value) > 0,
  }))
  return { status, canClose, blockers, statusLabel, blockersText, checkEntries }
}

// ── Gastos del mes (renderExpenses) ──────────────────────────────────────────
export type ExpenseFilters = { search: string; company: string; costCenter: string; category: string }

export function filterExpenses(rows: BudgetRow[], f: ExpenseFilters): BudgetRow[] {
  const search = f.search.toLowerCase()
  return rows.filter((r) => {
    const hay = [r.company, r.cost_center, r.budget_category, r.category_code].join(' ').toLowerCase()
    if (search && !hay.includes(search)) return false
    if (f.company !== 'todos' && normKey(r.company) !== f.company) return false
    if (f.costCenter !== 'todos' && normKey(r.cost_center) !== f.costCenter) return false
    if (f.category !== 'todos' && normKey(r.budget_category) !== f.category) return false
    return true
  })
}

export function hasBudget(rows: BudgetRow[]): boolean {
  return rows.some((r) => num(r.budget_amount) > 0)
}

// ── YTD (renderYtd) ──────────────────────────────────────────────────────────
export function computeYtdTotals(rows: YtdRow[]) {
  return rows.reduce(
    (acc, r) => {
      acc.budget += num(r.ytd_budget)
      acc.committed += num(r.ytd_committed)
      acc.executed += num(r.ytd_executed)
      acc.available += num(r.ytd_available)
      return acc
    },
    { budget: 0, committed: 0, executed: 0, available: 0 },
  )
}

// ── Ingresos (renderIncome) ──────────────────────────────────────────────────
export type IncomeFilters = { search: string; status: string; lineage: string }

export function filterIncome(rows: IncomeMemberRow[], f: IncomeFilters): IncomeMemberRow[] {
  const search = f.search.toLowerCase()
  return rows.filter((r) => {
    if (search && !String(r.member_name || '').toLowerCase().includes(search)) return false
    if (f.status !== 'todos' && r.status !== f.status) return false
    if (f.lineage !== 'todos' && normKey(r.lineage) !== f.lineage) return false
    return true
  })
}

export function computeIncomeTotals(rows: IncomeMemberRow[]) {
  return rows.reduce(
    (acc, r) => {
      acc.expected += num(r.expected_amount)
      acc.paid += num(r.paid_amount)
      acc.pending += num(r.pending_amount)
      if (num(r.pending_amount) > 0) acc.members++
      return acc
    },
    { expected: 0, paid: 0, pending: 0, members: 0 },
  )
}

// ── Cobranza por socio (renderMemberTable) ───────────────────────────────────
export function filterMembers(rows: IncomeMemberRow[], search: string): IncomeMemberRow[] {
  const s = search.toLowerCase()
  return [...rows]
    .filter((r) => !s || String(r.member_name || '').toLowerCase().includes(s))
    .sort((a, b) => num(b.pending_amount) - num(a.pending_amount))
}

// ── Errores ──────────────────────────────────────────────────────────────────
export function friendlyError(err: any): string {
  const raw = String(err?.message || err || '')
  if (raw.includes('not_allowed_to_view_dashboard')) return 'No tienes permiso para consultar el Dashboard.'
  if (raw.includes('period_key_required')) return 'Selecciona un periodo valido.'
  if (raw.includes('JWT') || raw.includes('permission') || raw.includes('policy')) return 'Sin permiso para esta accion.'
  return raw || 'No se pudo cargar la informacion.'
}

// ── URLs de export ───────────────────────────────────────────────────────────
export function isRealUrl(url: unknown): boolean {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) return false
  if (/example[-_]/i.test(url) || /\/example$/i.test(url)) return false
  return true
}

// ── Gráfica anual operativa (loadYearlyChart) ────────────────────────────────
const MONTHS_SHORT = (year: number, m: number) =>
  new Date(year, m - 1, 1).toLocaleDateString('es-MX', { month: 'short' })

export function buildYearMonths(periodKey: string): { months: string[]; labels: string[]; year: number } {
  const year = Number(periodKey.slice(0, 4))
  const currentMonth = Number(periodKey.slice(5, 7))
  const months: string[] = []
  for (let m = 1; m <= currentMonth; m++) months.push(`${year}-${String(m).padStart(2, '0')}`)
  const labels = months.map((pk) => {
    const m = Number(pk.split('-')[1])
    return MONTHS_SHORT(Number(pk.slice(0, 4)), m)
  })
  return { months, labels, year }
}

export type YearlySeries = { presupuesto: number[]; ejecutado: number[]; esperado: number[]; cobrado: number[] }

export function aggregateYearly(payloads: DashboardPayload[]): YearlySeries {
  const presupuesto: number[] = []
  const ejecutado: number[] = []
  const esperado: number[] = []
  const cobrado: number[] = []
  payloads.forEach((p) => {
    const bc = ensureArray<BudgetRow>(p.budget_comparison)
    presupuesto.push(bc.reduce((s, r) => s + num(r.budget_amount), 0))
    ejecutado.push(bc.reduce((s, r) => s + num(r.executed_amount), 0))
    esperado.push(num(p.kpis?.ingresos?.maintenance_expected))
    cobrado.push(num(p.kpis?.ingresos?.maintenance_collected))
  })
  return { presupuesto, ejecutado, esperado, cobrado }
}

export function hasChartData(s: YearlySeries): boolean {
  return [s.presupuesto, s.ejecutado, s.esperado, s.cobrado].some((serie) => serie.some((v) => v > 0))
}

export function demoChartSeries(count: number): YearlySeries {
  const basePresupuesto = [920000, 880000, 940000, 905000, 960000, 930000, 915000, 950000, 925000, 945000, 910000, 970000]
  const ejecPct = [0.82, 0.91, 0.76, 0.88, 0.79, 0.85, 0.93, 0.81, 0.87, 0.78, 0.9, 0.84]
  const baseEsperado = 480000
  const cobroPct = [0.95, 0.88, 0.92, 1, 0.85, 0.97, 0.9, 0.94, 0.89, 0.98, 0.91, 0.96]
  const presupuesto: number[] = [], ejecutado: number[] = [], esperado: number[] = [], cobrado: number[] = []
  for (let i = 0; i < count; i++) {
    const p = basePresupuesto[i % 12]
    presupuesto.push(p)
    ejecutado.push(Math.round(p * ejecPct[i % 12]))
    esperado.push(baseEsperado)
    cobrado.push(Math.round(baseEsperado * cobroPct[i % 12]))
  }
  return { presupuesto, ejecutado, esperado, cobrado }
}

// ── Presupuesto: disponible vs usado, por partida ────────────────────────────
// Umbral de alerta "cerca del límite" (% usado).
export const BUDGET_WARN_PCT = 90

export const BUDGET_ALL_PERIOD = 'all'

// Etiqueta de mes a partir de 'YYYY-MM-DD' (día 01). En es-MX, capitalizada.
export function budgetMonthLabel(iso: string): string {
  const [y, m] = iso.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  const s = d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// % usado seguro para ordenar/mostrar: Infinity cuando hay uso sin presupuesto.
function budgetPctUsed(budgeted: number, used: number): number {
  if (budgeted > 0) return (used / budgeted) * 100
  return used > 0 ? Infinity : 0
}

// Agrega la vista por partida dentro del periodo elegido ('all' = todo el año, o
// un 'YYYY-MM-DD'). Suma todos los centros de costo. Ordena por % usado desc.
// Omite partidas sin presupuesto NI uso; las que tienen uso sin presupuesto sí se
// listan (aparecen como sobregiradas). Los totales se calculan sobre TODAS las
// filas del periodo (incluidas las omitidas), para que el resumen no pierda monto.
export function aggregateBudget(
  rows: BudgetAvailabilityRow[],
  categories: Map<string, BudgetCategoryMeta>,
  period: string,
): BudgetAggregate {
  const months = [...new Set(rows.map((r) => r.budget_month).filter((m): m is string => !!m))].sort()
  const scoped = period === BUDGET_ALL_PERIOD ? rows : rows.filter((r) => r.budget_month === period)

  type Acc = {
    budgeted: number
    used: number
    executed: number
    available: number
    classification: 'partida' | 'por_clasificar' | 'sin_partida'
  }
  const byCat = new Map<string, Acc>()
  const totals: BudgetTotals = { budgeted: 0, committed: 0, executed: 0, used: 0, available: 0, pctUsed: 0 }

  for (const r of scoped) {
    const classification = r.classification
      || (r.budget_category_id ? 'partida' : 'sin_partida')
    const id = r.budget_category_id
      || (classification === 'por_clasificar' ? '__por_clasificar__' : '__sin_partida__')
    const acc = byCat.get(id) || {
      budgeted: 0, used: 0, executed: 0, available: 0, classification,
    }
    // committed de la vista YA incluye executed. Separa lo pendiente para la
    // barra y conserva el disponible canónico, sin volver a descontar lo pagado.
    const used = num(r.committed)
    const available = r.available == null ? num(r.budgeted) - used : num(r.available)
    acc.budgeted += num(r.budgeted)
    acc.used += used
    acc.executed += num(r.executed)
    acc.available += available
    byCat.set(id, acc)
    totals.budgeted += num(r.budgeted)
    totals.used += used
    totals.executed += num(r.executed)
    totals.available += available
  }
  totals.used = r2(totals.used)
  totals.budgeted = r2(totals.budgeted)
  totals.executed = r2(totals.executed)
  totals.committed = r2(totals.used - totals.executed)
  totals.available = r2(totals.available)
  totals.pctUsed = budgetPctUsed(totals.budgeted, totals.used)

  let omittedCount = 0
  const partidas: BudgetPartida[] = []
  for (const [id, acc] of byCat) {
    const budgeted = r2(acc.budgeted)
    const used = r2(acc.used)
    const executed = r2(acc.executed)
    const committed = r2(used - executed)
    if (budgeted <= 0 && used <= 0) { omittedCount++; continue }
    const available = r2(acc.available)
    const pctUsed = budgetPctUsed(budgeted, used)
    const cat = categories.get(id)
    const fallbackName = acc.classification === 'por_clasificar' ? 'Por clasificar' : 'Sin partida'
    const fallbackGroup = acc.classification === 'por_clasificar' ? 'Clasificación pendiente' : 'Sin grupo'
    partidas.push({
      categoryId: id,
      name: cat?.name || fallbackName,
      group: cat?.category || fallbackGroup,
      classification: acc.classification,
      budgeted, committed, executed, used, available, pctUsed,
      over: budgeted > 0 && available < 0,
      warn: available >= 0 && Number.isFinite(pctUsed) && pctUsed >= BUDGET_WARN_PCT,
    })
  }
  // Prioritize actual overruns. Unallocated spending is informational, not an overrun.
  const priority = (p: BudgetPartida) => p.over ? 3 : p.warn ? 2 : p.budgeted <= 0 ? 1 : 0
  partidas.sort((a, b) => priority(b) - priority(a) || (b.used - a.used))

  return { partidas, totals, omittedCount, months }
}

// These are breakdowns of the global report, not additional amounts to add to it.
export function aggregateBudgetCoverage(rows: BudgetAvailabilityRow[], period: string): BudgetCoverage {
  const scoped = period === BUDGET_ALL_PERIOD ? rows : rows.filter(row => row.budget_month === period)
  const historicalMonths = new Set(
    scoped.filter(row => row.data_source === 'historical').map(row => row.budget_month).filter(Boolean),
  ).size
  const fluxMonths = new Set(
    scoped.filter(row => row.data_source !== 'historical').map(row => row.budget_month).filter(Boolean),
  ).size
  const sourceMode: BudgetCoverage['sourceMode'] = historicalMonths > 0
    ? (fluxMonths > 0 ? 'mixed' : 'historical')
    : 'flux'
  return {
    paid: r2(scoped.reduce((sum, row) => sum + num(row.paid_amount), 0)),
    nonBudget: r2(scoped.reduce((sum, row) => sum + num(row.non_budget_used), 0)),
    payroll: r2(scoped.reduce((sum, row) => sum + num(row.payroll_used), 0)),
    historicalMonths,
    fluxMonths,
    sourceMode,
  }
}

// El buscador filtra el detalle, no altera los indicadores generales del periodo.
export function filterBudgetPartidas(partidas: BudgetPartida[], query: string): BudgetPartida[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const words = normalize(query.trim()).split(/\s+/).filter(Boolean)
  return partidas.filter(row => words.every(word => normalize(`${row.name} ${row.group}`).includes(word)))
}

export function aggregateDashboardActivity(data: DashboardActivity, period: string, today = new Date().toISOString().slice(0, 10)) {
  const incomeRows = data.income.filter(row => row.period === period && !['cancelled', 'cancelado'].includes(row.status || ''))
  // Ingresos genéricos no almacena un tipo de cambio. No sumar otras monedas a MXN.
  const members = incomeRows.filter(row => row.currency?.toUpperCase() === 'MXN')
  const income = computeIncomeTotals(members)
  const incidents = data.incidents.filter(row => row.incident_date?.slice(0, 7) === period)
  const open = incidents.filter(row => row.status === 'open').length
  const invoiced = incidents.filter(row => row.status === 'invoiced').length
  const paid = incidents.filter(row => row.status === 'paid').length
  const funds = data.cash.filter(row => ['active', 'pending_receipt', 'blocked', 'receipt_review'].includes(row.status || ''))
  const cash = {
    active: funds.length,
    pending: funds.filter(row => num(row.pending_amount) > 0).length,
    inReview: funds.filter(row => row.status === 'receipt_review').length,
    overdue: funds.filter(row => num(row.pending_amount) > 0 && !!row.due_date && row.due_date < today).length,
    assigned: r2(funds.reduce((sum, row) => sum + num(row.assigned_amount), 0)),
    verified: r2(funds.reduce((sum, row) => sum + num(row.verified_amount), 0)),
    pendingAmount: r2(funds.reduce((sum, row) => sum + num(row.pending_amount), 0)),
  }
  return {
    members, income, incomeExcluded: incomeRows.length - members.length, cash,
    incidents: { open, invoiced, paid, pending: open + invoiced },
  }
}

// ── Solicitudes (payment_requests) ───────────────────────────────────────────
// Etiquetas por status (es-MX). Alineadas con solicitudes/aprobaciones.
export const REQUEST_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  submitted: 'Enviada',
  pending_approval: 'Pendiente de aprobación',
  finance_validation: 'Validación financiera',
  changes_requested: 'Cambios solicitados',
  approved: 'Aprobada',
  scheduled: 'Programada',
  paid: 'Pagada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
}

// Etapas del embudo. "en curso" agrupa todo lo que sigue en trámite.
const FUNNEL_STAGES: { key: string; label: string; statuses: string[] }[] = [
  { key: 'en_curso', label: 'En curso', statuses: ['draft', 'submitted', 'pending_approval', 'changes_requested', 'finance_validation'] },
  { key: 'aprobadas', label: 'Aprobadas', statuses: ['approved'] },
  { key: 'programadas', label: 'Programadas', statuses: ['scheduled'] },
  { key: 'pagadas', label: 'Pagadas', statuses: ['paid'] },
]

// Filtra por periodo del presupuesto: 'all' = todo el año cargado, o un
// 'YYYY-MM-DD' concreto (comparado contra budget_month).
function scopeRequests(rows: PaymentRequestRow[], period: string): PaymentRequestRow[] {
  return period === BUDGET_ALL_PERIOD ? rows : rows.filter((r) => r.budget_month === period)
}

// El tipo de cambio guardado expresa MXN por unidad de la moneda de origen.
// Una moneda/rate faltante no se interpreta como paridad ni como importe cero.
function requestExchangeRate(row: PaymentRequestRow): number | null {
  const currency = row.currency?.trim().toUpperCase()
  if (currency === 'MXN') return 1
  const rate = Number(row.exchange_rate)
  return currency && Number.isFinite(rate) && rate > 0 ? rate : null
}

export function requestAmountLabel(summary: RequestAmountSummary): string {
  if (summary.count > 0 && summary.unconvertedCount === summary.count) return '—'
  return `${money(summary.amount)}${summary.unconvertedCount > 0 ? ' (parcial)' : ''}`
}

// Agrega payment_requests por etapa del embudo, alertas y desglose por status.
// Monto: amount_requested para todas las etapas (incluidas las pagadas: el
// esquema no tiene columna paid_amount/monto pagado real, así que se declara el
// uso de amount_requested como aproximación del pagado).
export function aggregateRequests(rows: PaymentRequestRow[], period: string): RequestsAggregate {
  const months = [...new Set(rows.map((r) => r.budget_month).filter((m): m is string => !!m))].sort()
  const scoped = scopeRequests(rows, period)

  const byStatusMap = new Map<string, RequestAmountSummary>()
  for (const r of scoped) {
    const st = r.status || 'sin_estatus'
    const acc = byStatusMap.get(st) || { count: 0, amount: 0, unconvertedCount: 0 }
    acc.count += 1
    const rate = requestExchangeRate(r)
    if (rate === null) acc.unconvertedCount += 1
    else acc.amount += r2(num(r.amount_requested) * rate)
    byStatusMap.set(st, acc)
  }
  const pick = (st: string) => byStatusMap.get(st) || { count: 0, amount: 0, unconvertedCount: 0 }
  const combine = (statuses: string[]): RequestAmountSummary => {
    let count = 0, amount = 0, unconvertedCount = 0
    for (const st of statuses) {
      const a = pick(st)
      count += a.count
      amount += a.amount
      unconvertedCount += a.unconvertedCount
    }
    return { count, amount: r2(amount), unconvertedCount }
  }

  const funnel: RequestStage[] = FUNNEL_STAGES.map((stage) => ({
    key: stage.key, label: stage.label, ...combine(stage.statuses),
  }))

  const rejected = combine(['rejected'])
  const changesRequested = combine(['changes_requested'])
  const inReview = combine(['changes_requested', 'finance_validation'])

  const byStatus: RequestStatusLine[] = [...byStatusMap.entries()]
    .map(([status, a]) => ({ status, label: REQUEST_STATUS_LABELS[status] || status, ...a, amount: r2(a.amount) }))
    .sort((a, b) => b.amount - a.amount || b.count - a.count)

  const unconvertedCount = byStatus.reduce((sum, row) => sum + row.unconvertedCount, 0)
  return { total: scoped.length, unconvertedCount, funnel, rejected, changesRequested, inReview, byStatus, months }
}

// ── Impuestos (desglose fiscal de payment_requests) ──────────────────────────
// Desglose registrado de solicitudes aprobadas, programadas o pagadas, en MXN.
// No determina acreditabilidad ni obligaciones fiscales pendientes de enterar.
// N/M se limita a ese mismo alcance; los importes no convertibles se declaran.
export function aggregateTaxes(rows: PaymentRequestRow[], period: string): TaxesAggregate {
  const scoped = scopeRequests(rows, period).filter((r) => ['approved', 'scheduled', 'paid'].includes(r.status || ''))
  let iva = 0, retenciones = 0, withDetail = 0, unconvertedCount = 0
  for (const r of scoped) {
    const hasIva = r.tax_amount !== null && r.tax_amount !== undefined
    const hasRet = r.withholding_amount !== null && r.withholding_amount !== undefined
    if (!hasIva && !hasRet) continue
    withDetail += 1
    const rate = requestExchangeRate(r)
    if (rate === null) { unconvertedCount += 1; continue }
    if (hasIva) iva += r2(num(r.tax_amount) * rate)
    if (hasRet) retenciones += r2(num(r.withholding_amount) * rate)
  }
  return { iva: r2(iva), retenciones: r2(retenciones), withDetail, total: scoped.length, unconvertedCount }
}

// ── Histórico ────────────────────────────────────────────────────────────────
export const YEAR_COLORS = [
  'rgba(148,163,175,VAR)',
  'rgba(74,124,109,VAR)',
  'rgba(245,158,11,VAR)',
  'rgba(46,144,250,VAR)',
  'rgba(224,62,82,VAR)',
]
export function yearColor(i: number, alpha: string): string {
  return YEAR_COLORS[i % YEAR_COLORS.length].replace('VAR', alpha)
}

type CuentaAgg = { nombre: string; fam: string; meses: Record<string, number>; total: number }


// Flujo de una fila histórica: la columna clasificada al cargar manda;
// el prefijo (4/6) queda solo como fallback para filas OPT antiguas.
function flujoDe(r: HistoricalActual): 'ingreso' | 'egreso' | null {
  if (r.flujo === 'ingreso' || r.flujo === 'egreso') return r.flujo
  const fam = String(r.account_code || '')[0]
  return fam === '4' ? 'ingreso' : fam === '6' ? 'egreso' : null
}

// enterHistYear: agrega filas de un año en meses + cuentas.
export function aggregateHistYear(rows: HistoricalActual[], year: number) {
  const meses: Record<number, { ingresos: number; egresos: number }> = {}
  const cuentas = new Map<string, CuentaAgg>()
  for (const r of rows) {
    const m = Number(String(r.period_month).slice(5, 7))
    meses[m] = meses[m] || { ingresos: 0, egresos: 0 }
    const fj = flujoDe(r)
    if (fj === 'ingreso') meses[m].ingresos += num(r.amount)
    else if (fj === 'egreso') meses[m].egresos += num(r.amount)
    if (fj) {
      const code = r.account_code || ''
      const c = cuentas.get(code) || { nombre: r.account_name || '', fam: fj === 'ingreso' ? '4' : '6', meses: {}, total: 0 }
      c.meses[m] = (c.meses[m] || 0) + num(r.amount)
      c.total += num(r.amount)
      cuentas.set(code, c)
    }
  }
  const mm = Object.keys(meses).map(Number).sort((a, b) => a - b)
  const labels = mm.map((m) => new Date(year, m - 1, 1).toLocaleDateString('es-MX', { month: 'short' }))
  const ingresos = mm.map((m) => r2(meses[m].ingresos))
  const egresos = mm.map((m) => r2(meses[m].egresos))
  return { mm, labels, ingresos, egresos, meses, cuentas }
}

// enterAllYears: agrega por año + por año/mes + cuentas.
export function aggregateHistAll(rows: HistoricalActual[]) {
  const anios: Record<string, { ingresos: number; egresos: number }> = {}
  const cuentas = new Map<string, CuentaAgg>()
  const porAnioMes: Record<string, Record<number, { ingresos: number; egresos: number }>> = {}
  for (const r of rows) {
    const y = String(r.period_month).slice(0, 4)
    anios[y] = anios[y] || { ingresos: 0, egresos: 0 }
    const fj = flujoDe(r)
    if (fj === 'ingreso') anios[y].ingresos += num(r.amount)
    else if (fj === 'egreso') anios[y].egresos += num(r.amount)
    if (fj) {
      const code = r.account_code || ''
      const c = cuentas.get(code) || { nombre: r.account_name || '', fam: fj === 'ingreso' ? '4' : '6', meses: {}, total: 0 }
      c.meses[y] = (c.meses[y] || 0) + num(r.amount)
      c.total += num(r.amount)
      cuentas.set(code, c)
    }
    const m = Number(String(r.period_month).slice(5, 7))
    porAnioMes[y] = porAnioMes[y] || {}
    porAnioMes[y][m] = porAnioMes[y][m] || { ingresos: 0, egresos: 0 }
    if (fj === 'ingreso') porAnioMes[y][m].ingresos += num(r.amount)
    else if (fj === 'egreso') porAnioMes[y][m].egresos += num(r.amount)
  }
  const yy = Object.keys(anios).sort()
  return { yy, anios, cuentas, porAnioMes }
}

export function histKpisTotals(keys: (number | string)[], source: Record<any, { ingresos: number; egresos: number }>) {
  let ti = 0, te = 0
  for (const k of keys) { ti += source[k].ingresos; te += source[k].egresos }
  const neto = ti - te
  const promedio = keys.length ? te / keys.length : 0
  return { ingresos: ti, egresos: te, neto, promedio }
}

// ── Matriz "Histórico por cuenta" (renderHistCuentas) ────────────────────────
export type HistMatrixRow = { nombre: string; code?: string; meta?: string | null; meses: Record<string, number>; total: number }
export type HistGrupo = {
  grupo: string
  partidasCount: number
  meses: Record<string, number>
  total: number
  partidas: HistMatrixRow[]
}
export type HistMatrix = {
  periodos: (number | string)[]
  etiquetas: string[]
  titulo: string
  ingresos: { rows: HistMatrixRow[]; total: HistMatrixRow } | null
  egresos: {
    grupos: HistGrupo[]
    sinMapear: HistMatrixRow[]
    sinMapearHeader: string
    total: HistMatrixRow | null
  } | null
}

export function buildHistMatrix(
  ctx: { periodos: (number | string)[]; etiquetas: string[]; cuentas: Map<string, CuentaAgg>; titulo: string },
  mapeo: HistMapeo,
): HistMatrix {
  const { periodos, etiquetas, cuentas, titulo } = ctx
  const keyOf = (k: number | string) => String(k)

  // Ingresos: por cuenta.
  const listaIng = [...cuentas.entries()].filter(([, c]) => c.fam === '4').sort((a, b) => b[1].total - a[1].total)
  let ingresos: HistMatrix['ingresos'] = null
  if (listaIng.length) {
    const sub: Record<string, number> = {}
    let tot = 0
    for (const [, c] of listaIng) {
      tot += c.total
      for (const k of periodos) sub[keyOf(k)] = (sub[keyOf(k)] || 0) + (c.meses[keyOf(k)] || 0)
    }
    ingresos = {
      rows: listaIng.map(([code, c]) => ({ nombre: c.nombre, code, meses: c.meses, total: c.total })),
      total: { nombre: 'Total ingresos', meses: sub, total: tot },
    }
  }

  // Egresos: estructura de presupuesto (grupo → partida) vía mapeo.
  const grupos = new Map<string, { partidas: Map<string, { meses: Record<string, number>; total: number }>; meses: Record<string, number>; total: number }>()
  const sinMapear: [string, CuentaAgg][] = []
  for (const [code, c] of [...cuentas.entries()].filter(([, x]) => x.fam === '6')) {
    const destino = mapeo.get(code.replace(/-/g, ''))
    if (!destino) { sinMapear.push([code, c]); continue }
    const g = grupos.get(destino.grupo) || { partidas: new Map(), meses: {} as Record<string, number>, total: 0 }
    const pa = g.partidas.get(destino.partida) || { meses: {}, total: 0 }
    for (const k of periodos) {
      const kk = keyOf(k)
      const v = c.meses[kk] || 0
      pa.meses[kk] = (pa.meses[kk] || 0) + v
      g.meses[kk] = (g.meses[kk] || 0) + v
    }
    pa.total += c.total
    g.total += c.total
    g.partidas.set(destino.partida, pa)
    grupos.set(destino.grupo, g)
  }

  let egresos: HistMatrix['egresos'] = null
  const hasEgr = grupos.size > 0 || sinMapear.length > 0
  if (hasEgr) {
    const subEgr: Record<string, number> = {}
    let totEgr = 0
    const acum = (meses: Record<string, number>, total: number) => {
      totEgr += total
      for (const k of periodos) subEgr[keyOf(k)] = (subEgr[keyOf(k)] || 0) + (meses[keyOf(k)] || 0)
    }
    const gruposOut: HistGrupo[] = []
    for (const [grupo, g] of [...grupos.entries()].sort((a, b) => b[1].total - a[1].total)) {
      const partidas: HistMatrixRow[] = [...g.partidas.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([partida, pa]) => ({ nombre: partida, meses: pa.meses, total: pa.total }))
      gruposOut.push({ grupo, partidasCount: g.partidas.size, meses: g.meses, total: g.total, partidas })
      acum(g.meses, g.total)
    }
    const sinMapearOut: HistMatrixRow[] = []
    if (sinMapear.length) {
      sinMapear.sort((a, b) => b[1].total - a[1].total)
      for (const [code, c] of sinMapear) {
        sinMapearOut.push({ nombre: c.nombre, code, meta: grupos.size ? 'sin partida' : null, meses: c.meses, total: c.total })
        acum(c.meses, c.total)
      }
    }
    egresos = {
      grupos: gruposOut,
      sinMapear: sinMapearOut,
      sinMapearHeader: grupos.size ? 'Fuera del presupuesto (cuentas sin partida)' : 'Egresos',
      total: { nombre: 'Total egresos', meses: subEgr, total: totEgr },
    }
  }

  return { periodos, etiquetas, titulo, ingresos, egresos }
}

// Helper de formato para celdas de la matriz (fmtK del vanilla).
export function fmtCell(v: number): string {
  return v === 0 ? '—' : moneyFmt.format(r2(v))
}
export function fmtMoney0(v: number): string { return moneyFmt.format(r2(v)) }
