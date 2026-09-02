import { supabase } from '../../lib/supabase'
import type { DashboardPayload, MonthlyClosure, HistoricalActual, HistMapeo } from './types'
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
