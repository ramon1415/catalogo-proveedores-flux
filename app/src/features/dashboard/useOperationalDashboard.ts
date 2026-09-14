import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchBudgetAvailability, fetchPaymentRequests, fetchDashboardActivity } from './api'

type Scope = { companyId: string; year: number; revision: number }
type Snapshot = {
  scope: Scope
  budget: PromiseSettledResult<Awaited<ReturnType<typeof fetchBudgetAvailability>>>
  requests: PromiseSettledResult<Awaited<ReturnType<typeof fetchPaymentRequests>>>
  loadedAt: string
}

// El resultado pertenece a una sola carga. Se oculta durante el render que cambia
// empresa/año, antes de ejecutar los efectos, incluso si la siguiente carga falla.
export function useOperationalDashboard(companyId: string | null, year: number, enabled: boolean) {
  const [revision, setRevision] = useState(0)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const scope = useMemo<Scope | null>(
    () => enabled && companyId ? { companyId, year, revision } : null,
    [enabled, companyId, year, revision],
  )
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    if (!scope) return
    let cancelled = false
    void Promise.allSettled([
      fetchBudgetAvailability(scope.companyId, scope.year),
      fetchPaymentRequests(scope.companyId, scope.year),
    ]).then(([budget, requests]) => {
      if (!cancelled) setSnapshot({ scope, budget, requests, loadedAt: new Date().toISOString() })
    })
    return () => { cancelled = true }
  }, [scope])

  const current = scope && snapshot?.scope === scope ? snapshot : null
  const loading = !!scope && !current
  return {
    budgetData: current?.budget.status === 'fulfilled' ? current.budget.value : null,
    reqData: current?.requests.status === 'fulfilled' ? current.requests.value : null,
    budgetError: current?.budget.status === 'rejected',
    reqError: current?.requests.status === 'rejected',
    loading,
    refresh,
    revision,
    loadedAt: current?.loadedAt,
  }
}

export function useDashboardActivity(companyId: string | null, year: number, enabled: boolean, revision: number) {
  const scope = useMemo<Scope | null>(() => enabled && companyId ? { companyId, year, revision } : null, [enabled, companyId, year, revision])
  const [snapshot, setSnapshot] = useState<{
    scope: Scope; data: Awaited<ReturnType<typeof fetchDashboardActivity>> | null; error: boolean; loadedAt: string
  } | null>(null)
  useEffect(() => {
    if (!scope) return
    let cancelled = false
    void fetchDashboardActivity(scope.companyId, scope.year).then(
      data => { if (!cancelled) setSnapshot({ scope, data, error: false, loadedAt: new Date().toISOString() }) },
      () => { if (!cancelled) setSnapshot({ scope, data: null, error: true, loadedAt: '' }) },
    )
    return () => { cancelled = true }
  }, [scope])
  const current = scope && snapshot?.scope === scope ? snapshot : null
  return { data: current?.data ?? null, error: current?.error ?? false, loading: !!scope && !current, loadedAt: current?.loadedAt }
}
