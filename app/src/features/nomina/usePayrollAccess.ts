import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useCompany } from '../../lib/company'
import { supabase } from '../../lib/supabase'

type Access = { can_capture: boolean; can_pay: boolean }
const denied: Access = { can_capture: false, can_pay: false }

// The server decides access for this company. Never carry permission across a
// company/account switch while the next request is loading.
export function usePayrollAccess() {
  const { companyId } = useCompany()
  const { profile } = useAuth()
  const key = `${profile?.id || ''}:${companyId || ''}`
  const [result, setResult] = useState<{ key: string; access: Access } | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!companyId || !profile?.id) return
    void Promise.resolve(supabase.rpc('get_my_payroll_access', { p_company_id: companyId })).then(({ data, error }) => {
      if (!cancelled) setResult({ key, access: error || !data ? denied : data as Access })
    }).catch(() => {
      if (!cancelled) setResult({ key, access: denied })
    })
    return () => { cancelled = true }
  }, [key, companyId, profile?.id])
  return { ...(result?.key === key ? result.access : denied), loading: !!companyId && !!profile?.id && result?.key !== key }
}
