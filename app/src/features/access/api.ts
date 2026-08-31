import { supabase } from '../../lib/supabase'

export type CompanyAccessResult = {
  request_id?: string
  status: 'pending' | 'approved' | 'already_member'
  company_id: string
  company_name: string
}

export async function requestCompanyAccess(code: string): Promise<CompanyAccessResult> {
  const { data, error } = await supabase.rpc('request_company_access', { p_code: code })
  if (error) throw error
  return data as CompanyAccessResult
}
