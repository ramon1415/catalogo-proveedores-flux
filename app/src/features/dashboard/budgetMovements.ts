import { supabase } from '../../lib/supabase'

export type BudgetMovement = {
  id: string
  source: 'request' | 'obligation' | 'historical'
  reference: string | null
  title: string
  description: string
  date: string | null
  budget_month: string
  status: string
  amount: number
}

export async function fetchBudgetMovements(companyId: string, year: number, categoryKey: string, period: string): Promise<BudgetMovement[]> {
  const { data, error } = await supabase.rpc('dashboard_budget_movements', {
    p_company_id: companyId, p_year: year, p_category_key: categoryKey,
    p_month: period === 'all' ? null : period,
  })
  if (error) throw error
  if (!Array.isArray(data) || data.some(r => r.amount == null || !Number.isFinite(Number(r.amount)))) {
    throw new Error('budget_movements_invalid_response')
  }
  return data.map(r => ({ ...r, amount: Number(r.amount) }))
}

export function movementTotals(rows: BudgetMovement[]) {
  const cents = (n: number) => Math.round(n * 100)
  return {
    used: rows.reduce((sum, row) => sum + cents(row.amount), 0) / 100,
    executed: rows.filter(row => row.status === 'paid').reduce((sum, row) => sum + cents(row.amount), 0) / 100,
  }
}
