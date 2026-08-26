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
}

// Mapeo cuenta CONTPAQ → partida/grupo del presupuesto.
export type HistMapeoEntry = { partida: string; grupo: string }
export type HistMapeo = Map<string, HistMapeoEntry>

export type SectionTab = 'expenses' | 'ytd' | 'income' | 'cash' | 'incidents'
