// Shapes del payload de dashboard_export_payload y de las tablas históricas.
// Subset de campos que consume la pantalla (1:1 con dashboard.js).

export type KpiEgresos = Record<string, unknown>

export type KpiIngresos = {
  maintenance_expected?: number | null
  maintenance_collected?: number | null
  open_incidents?: number | null
  paid_incidents?: number | null
  issued_invoices?: number | null
  pending_invoices?: number | null
}

export type KpiEfectivo = {
  active_cash_funds?: number | null
  pending_cash_reconciliation?: number | null
  cash_in_review?: number | null
  overdue_cash_funds?: number | null
  cash_assigned_amount?: number | null
  cash_verified_amount?: number | null
  cash_pending_amount?: number | null
}

export type KpiCierre = {
  closure_status?: string | null
  sheet_url?: string | null
  slides_url?: string | null
  pdf_url?: string | null
}

export type Kpis = {
  egresos?: KpiEgresos
  ingresos?: KpiIngresos
  efectivo?: KpiEfectivo
  cierre?: KpiCierre
}

export type BudgetRow = {
  company_id?: string | null
  company?: string | null
  cost_center?: string | null
  budget_category?: string | null
  category_code?: string | null
  budget_amount?: number | null
  committed_amount?: number | null
  executed_amount?: number | null
  available_amount?: number | null
  variance_amount?: number | null
  variance_pct?: number | null
}

export type YtdRow = {
  company?: string | null
  cost_center?: string | null
  budget_category?: string | null
  ytd_budget?: number | null
  ytd_committed?: number | null
  ytd_executed?: number | null
  ytd_available?: number | null
  ytd_variance_amount?: number | null
  ytd_variance_pct?: number | null
}

export type IncomeMemberRow = {
  member_name?: string | null
  lineage?: string | null
  billing_period?: string | null
  expected_amount?: number | null
  paid_amount?: number | null
  pending_amount?: number | null
  status?: string | null
  open_incidents?: number | null
  issued_invoices?: number | null
}

export type ClosureChecklist = {
  can_close?: boolean
  checks?: Record<string, number | null>
  blocking_reasons?: string[]
}

export type DashboardPayload = {
  kpis?: Kpis
  budget_comparison?: BudgetRow[]
  ytd?: YtdRow[]
  income_members?: IncomeMemberRow[]
  closure_checklist?: ClosureChecklist
  closure_comments?: unknown[]
}

// Estado normalizado que consume la pantalla operativa.
export type DashboardState = {
  kpis: Kpis
  budgetComparison: BudgetRow[]
  ytd: YtdRow[]
  incomeMembers: IncomeMemberRow[]
  closureChecklist: ClosureChecklist
  closureComments: unknown[]
}

export type MonthlyClosure = {
  id: string
  period_key: string | null
  status: string | null
  closed_at: string | null
  sheet_url: string | null
  slides_url: string | null
  pdf_url: string | null
}

// Fila cruda de historical_actuals.
export type HistoricalActual = {
  account_code: string | null
  account_name: string | null
  period_month: string | null
  amount: number | null
  // Clasificado al CARGAR con el catálogo de la empresa. El prefijo de cuenta
  // no es portable (OPT: 6xx egresos; SF: 6xx ingresos financieros, 5xx gastos).
  flujo?: 'ingreso' | 'egreso' | null
}

// Mapeo cuenta CONTPAQ → partida/grupo del presupuesto.
export type HistMapeoEntry = { partida: string; grupo: string }
export type HistMapeo = Map<string, HistMapeoEntry>

export type SectionTab = 'income' | 'cash' | 'incidents'

// ── Sección "Presupuesto" (vista public.budget_availability) ────────────────────
// Fila cruda de la vista. Semántica: usado = committed + executed = budgeted − available.
export type BudgetAvailabilityRow = {
  budget_category_id: string | null
  budget_month: string | null // date 'YYYY-MM-DD'
  budgeted: number | null
  committed: number | null
  executed: number | null
  available: number | null
}

export type BudgetCategoryMeta = { id: string; name: string | null; category: string | null }

// Partida agregada (suma de todos los centros de costo del periodo elegido).
export type BudgetPartida = {
  categoryId: string
  name: string
  group: string
  budgeted: number
  committed: number
  executed: number
  used: number      // committed + executed
  available: number // budgeted − used
  pctUsed: number   // used/budgeted*100; Infinity si budgeted<=0 pero hay uso
  over: boolean     // sobregirado: available < 0
  warn: boolean     // cerca del límite: pctUsed >= 90 y no sobregirado
}

export type BudgetTotals = {
  budgeted: number
  committed: number
  executed: number
  used: number
  available: number
  pctUsed: number
}

export type BudgetAggregate = {
  partidas: BudgetPartida[]
  totals: BudgetTotals
  omittedCount: number // partidas sin presupuesto ni uso, omitidas del desglose
  months: string[]     // budget_month distintos disponibles (YYYY-MM-DD), asc
}

// ── Sección "Solicitudes" (tabla public.payment_requests) ───────────────────────
// Fila cruda de payment_requests. Periodo = budget_month (date 'YYYY-MM-DD', día 01)
// para quedar en el MISMO eje que el presupuesto. No existe columna paid_amount en
// el esquema, así que el monto pagado usa amount_requested (ver aggregateRequests).
export type PaymentRequestRow = {
  id: string
  status: string | null
  amount_requested: number | null
  subtotal_amount: number | null
  tax_amount: number | null
  withholding_amount: number | null
  budget_month: string | null // date 'YYYY-MM-DD'
}

// Etapa del embudo "cómo van vs pagadas".
export type RequestStage = { key: string; label: string; count: number; amount: number }
// Línea del desglose por status.
export type RequestStatusLine = { status: string; label: string; count: number; amount: number }

export type RequestsAggregate = {
  total: number
  funnel: RequestStage[]                        // en curso → aprobadas → programadas → pagadas
  rejected: { count: number; amount: number }   // alerta roja
  changesRequested: { count: number; amount: number } // alerta ámbar
  inReview: { count: number; amount: number }   // finance_validation + changes_requested
  byStatus: RequestStatusLine[]
  months: string[]                              // budget_month distintos, asc
}

// ── Sección "Impuestos" (desglose fiscal de payment_requests) ───────────────────
export type TaxesAggregate = {
  iva: number          // suma tax_amount (IVA acreditable)
  retenciones: number  // suma withholding_amount (IVA/ISR por enterar)
  withDetail: number   // N: solicitudes con tax_amount o withholding_amount no null
  total: number        // M: total de solicitudes del periodo
}
