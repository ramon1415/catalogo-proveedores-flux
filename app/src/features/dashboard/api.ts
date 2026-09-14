import { supabase } from '../../lib/supabase'
import { usesLegacyIncome } from '../../lib/tenantConfig'
import type {
  DashboardPayload, MonthlyClosure, HistoricalActual, HistMapeo,
  BudgetAvailabilityRow, BudgetCategoryMeta, PaymentRequestRow, DashboardActivity,
  DashboardCashFund, DashboardIncident, DashboardIncomeRow,
} from './types'
import { parsePayload } from './logic'

// RPC principal: dashboard_export_payload(p_period_key). Devuelve JSON (a veces
// como string), por eso se normaliza con parsePayload().
export async function fetchDashboardPayload(periodKey: string): Promise<DashboardPayload> {
  const { data, error } = await supabase.rpc('dashboard_export_payload', { p_period_key: periodKey })
  if (error) throw error
  return parsePayload(data)
}

// Historial de cierres mensuales (dialog Historial).
export async function fetchClosures(): Promise<MonthlyClosure[]> {
  const { data, error } = await supabase
    .from('monthly_closures')
    .select('id,period_key,status,closed_at,sheet_url,slides_url,pdf_url')
    .order('period_key', { ascending: false })
    .limit(24)
  if (error) throw error
  return (data ?? []) as MonthlyClosure[]
}

// Paginación idéntica a fetchAllRows() del vanilla.
async function fetchAllRows<T>(
  builderFactory: () => any,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await builderFactory().range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < pageSize) break
  }
  return rows
}

// Años disponibles en historical_actuals de la empresa activa. El filtro por
// company_id es obligatorio: sin él, al cargar el histórico de otra empresa
// las series se mezclarían (RLS acota por membresía, no por empresa activa).
export async function fetchHistoricalPeriods(companyId: string): Promise<{ period_month: string | null }[]> {
  return fetchAllRows<{ period_month: string | null }>(() =>
    supabase
      .from('historical_actuals')
      .select('period_month')
      .eq('company_id', companyId)
      .order('period_month', { ascending: false }),
  )
}

// Filas de un año concreto.
export async function fetchHistoricalYear(companyId: string, year: number): Promise<HistoricalActual[]> {
  return fetchAllRows<HistoricalActual>(() =>
    supabase
      .from('historical_actuals')
      .select('account_code,account_name,period_month,amount,flujo')
      .eq('company_id', companyId)
      .gte('period_month', `${year}-01-01`)
      .lt('period_month', `${year + 1}-01-01`)
      .order('period_month'),
  )
}

// Todas las filas (vista "Todos los años").
export async function fetchHistoricalAll(companyId: string): Promise<HistoricalActual[]> {
  return fetchAllRows<HistoricalActual>(() =>
    supabase
      .from('historical_actuals')
      .select('account_code,account_name,period_month,amount,flujo')
      .eq('company_id', companyId)
      .order('period_month'),
  )
}

// ── Presupuesto: disponible vs usado (vista public.budget_availability) ─────────
// Lee la vista (RLS por membresía + security_invoker) acotada a la empresa activa
// y al año seleccionado, y trae el catálogo de partidas para los nombres. El filtro
// por company_id es obligatorio igual que en el histórico: RLS acota por membresía
// (varias empresas), no por empresa activa. La agregación por partida/periodo se
// hace en cliente (ver aggregateBudget) para reagrupar sin refetch al cambiar mes.
export async function fetchBudgetAvailability(
  companyId: string,
  year: number,
): Promise<{ rows: BudgetAvailabilityRow[]; categories: Map<string, BudgetCategoryMeta> }> {
  const [rows, catRes] = await Promise.all([
    fetchAllRows<BudgetAvailabilityRow>(() =>
      supabase
        .from('budget_availability')
        .select('budget_category_id,budget_month,budgeted,committed,executed,available')
        .eq('company_id', companyId)
        .gte('budget_month', `${year}-01-01`)
        .lt('budget_month', `${year + 1}-01-01`)
        .order('budget_month')
        .order('cost_center_id')
        .order('budget_category_id'),
    ),
    supabase.from('budget_categories').select('id,name,category').limit(2000),
  ])
  if (catRes.error) throw catRes.error
  const categories = new Map<string, BudgetCategoryMeta>(
    ((catRes.data ?? []) as BudgetCategoryMeta[]).map((c) => [c.id, c]),
  )
  return { rows, categories }
}

// ── Solicitudes: payment_requests de la empresa activa / año seleccionado ───────
// Periodo por budget_month (mismo eje que el presupuesto). El filtro por
// company_id es obligatorio igual que en presupuesto/histórico: RLS acota por
// membresía (varias empresas), no por empresa activa. La agregación por
// etapa/periodo se hace en cliente (aggregateRequests/aggregateTaxes).
export async function fetchPaymentRequests(companyId: string, year: number): Promise<PaymentRequestRow[]> {
  return fetchAllRows<PaymentRequestRow>(() =>
    supabase
      .from('payment_requests')
      .select('id,status,amount_requested,subtotal_amount,tax_amount,withholding_amount,currency,exchange_rate,budget_month')
      .eq('company_id', companyId)
      .gte('budget_month', `${year}-01-01`)
      .lt('budget_month', `${year + 1}-01-01`)
      .order('budget_month')
      .order('id'),
  )
}

// Fuentes operativas con RLS. El RPC antiguo agrega todas las empresas y no puede
// alimentar sus indicadores. Socios/cuotas solo pertenece a la variante explícita
// de Operadora; las demás empresas consultan sus propios ingresos registrados.
export async function fetchDashboardActivity(companyId: string, year: number): Promise<DashboardActivity> {
  if (!companyId) throw new Error('Selecciona una empresa.')
  const legacyIncome = usesLegacyIncome(companyId)
  const [cash, incidents, income] = await Promise.all([
    fetchAllRows<DashboardCashFund>(() => supabase.from('cash_funds')
      .select('id,status,assigned_amount,verified_amount,pending_amount,due_date')
      .eq('company_id', companyId).in('status', ['active', 'pending_receipt', 'blocked', 'receipt_review']).order('id')),
    fetchAllRows<DashboardIncident>(() => supabase.from('incident_charges')
      .select('id,status,incident_date').eq('company_id', companyId)
      .gte('incident_date', `${year}-01-01`).lt('incident_date', `${year + 1}-01-01`).order('id')),
    fetchDashboardIncome(companyId, year, legacyIncome),
  ])
  return { legacyIncome, cash, incidents, income }
}

async function fetchDashboardIncome(companyId: string, year: number, legacy: boolean): Promise<DashboardIncomeRow[]> {
  if (legacy) {
    type Fee = {
      id: string; expected_amount: number; paid_amount: number; pending_amount: number; status: string
      members: { full_name: string; lineage: string | null } | null
      billing_periods: { name: string; cutoff_date: string }
    }
    const fees = await fetchAllRows<Fee>(() => supabase.from('maintenance_fee_charges')
      .select('id,expected_amount,paid_amount,pending_amount,status,members(full_name,lineage),billing_periods!inner(name,cutoff_date)')
      .gte('billing_periods.cutoff_date', `${year}-01-01`).lt('billing_periods.cutoff_date', `${year + 1}-01-01`).order('id'))
    return fees.map(row => ({
      id: row.id, period: row.billing_periods.cutoff_date.slice(0, 7), currency: 'MXN',
      member_name: row.members?.full_name || 'Socio', lineage: row.members?.lineage,
      billing_period: row.billing_periods.name, expected_amount: row.expected_amount,
      paid_amount: row.paid_amount, pending_amount: row.pending_amount, status: row.status,
    }))
  }
  type Entry = { id: string; period: string; payer_name: string; amount: number; currency: string | null; status: string }
  const entries = await fetchAllRows<Entry>(() => supabase.from('tenant_income_entries')
    .select('id,period,payer_name,amount,currency,status').eq('company_id', companyId)
    .gte('period', `${year}-01`).lt('period', `${year + 1}-01`).order('id'))
  return entries.map(row => ({
    id: row.id, period: row.period, currency: row.currency, member_name: row.payer_name,
    billing_period: row.period, expected_amount: row.amount,
    paid_amount: row.status === 'cobrado' ? row.amount : 0,
    pending_amount: row.status === 'pendiente' ? row.amount : 0,
    status: row.status === 'cobrado' ? 'paid' : row.status === 'pendiente' ? 'pending' : 'cancelled',
  }))
}

// Carga el mapeo cuenta CONTPAQ → partida/grupo. Degrada a mapa vacío si las
// tablas del mapper aún no existen (mismo comportamiento que loadHistMapeo).
export async function loadHistMapeo(): Promise<HistMapeo> {
  const mapeo: HistMapeo = new Map()
  try {
    const [mapR, catR] = await Promise.all([
      supabase.from('budget_account_mappings').select('budget_category_id,contpaq_account_code').limit(2000),
      supabase.from('budget_categories').select('id,name,category').limit(500),
    ])
    if (mapR.error || catR.error) return mapeo
    const cats = new Map((catR.data ?? []).map((c: any) => [c.id, c]))
    for (const m of (mapR.data ?? []) as any[]) {
      const cat = cats.get(m.budget_category_id)
      if (cat) mapeo.set(m.contpaq_account_code, { partida: cat.name, grupo: cat.category || 'Sin grupo' })
    }
  } catch {
    /* mapper aún no instalado en esta base */
  }
  return mapeo
}
