import { supabase } from '../../lib/supabase'
import type {
  Company,
  OriginAccount,
  OriginAccountPayload,
  Member,
  MemberPayload,
  SociosData,
  Profile,
  UserRow,
  RoutingCompany,
  RoutingMembership,
  RoutingAssignment,
  ApproverCandidate,
  ContpaqCompany,
  BudgetCategory,
  ContpaqAccount,
  ContpaqMappingRow,
} from './types'
import { groupFromRoleNames } from './logic'

// ── Cuentas origen ───────────────────────────────────────────────
export async function loadOriginData(): Promise<{ companies: Company[]; accounts: OriginAccount[] }> {
  const [companiesResult, accountsResult] = await Promise.all([
    supabase.from('companies').select('id,name,legal_name,active').order('name', { ascending: true }),
    supabase
      .from('company_bank_accounts')
      .select('id,company_id,name,bank_name,currency,account_type,last4,active,notes,account_number,clabe')
      .order('name', { ascending: true }),
  ])
  if (companiesResult.error) throw { ...companiesResult.error, __op: 'select' }
  if (accountsResult.error) throw { ...accountsResult.error, __op: 'select' }
  const companies = (companiesResult.data || []).filter((c: Company) => c.active !== false)
  return { companies, accounts: (accountsResult.data || []) as OriginAccount[] }
}

export async function saveOriginAccount(id: string | null, payload: OriginAccountPayload): Promise<void> {
  const result = id
    ? await supabase.from('company_bank_accounts').update(payload).eq('id', id)
    : await supabase.from('company_bank_accounts').insert(payload)
  if (result.error) throw { ...result.error, __op: id ? 'update' : 'insert' }
}

export async function toggleOriginAccount(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('company_bank_accounts').update({ active }).eq('id', id)
  if (error) throw { ...error, __op: 'update' }
}

// ── Socios ───────────────────────────────────────────────────────
export async function loadSocios(): Promise<SociosData> {
  const [members, charges, payments, incidents, invoices, periods] = await Promise.all([
    supabase.from('members').select('*').order('full_name', { ascending: true }),
    supabase.from('maintenance_fee_charges').select('*').order('created_at', { ascending: false }),
    supabase.from('maintenance_fee_payments').select('*').order('created_at', { ascending: false }),
    supabase.from('incident_charges').select('*').order('incident_date', { ascending: false }),
    supabase.from('invoices').select('*').order('issue_date', { ascending: false }),
    supabase.from('billing_periods').select('*').order('cutoff_date', { ascending: false }),
  ])
  const failed = [members, charges, payments, incidents, invoices, periods].find((r) => r.error)
  if (failed?.error) throw failed.error
  return {
    members: (members.data || []) as Member[],
    charges: charges.data || [],
    payments: payments.data || [],
    incidents: incidents.data || [],
    invoices: invoices.data || [],
    periods: periods.data || [],
  }
}

export async function saveMember(id: string | null, payload: MemberPayload): Promise<void> {
  const result = id
    ? await supabase.from('members').update(payload).eq('id', id)
    : await supabase.from('members').insert(payload)
  if (result.error) throw result.error
}

// ── Gestión de usuarios (Sistema) ────────────────────────────────
export async function loadUsers(): Promise<UserRow[]> {
  const { data: profiles, error: pe } = await supabase
    .from('profiles')
    .select('id,email,full_name,created_at,active')
    .order('created_at', { ascending: false })
  if (pe) throw pe

  const { data: userRoles, error: re } = await supabase.from('user_roles').select('profile_id, roles(id,name)')
  if (re) throw re

  const rolesByProfile: Record<string, string[]> = {}
  for (const ur of (userRoles as any[]) || []) {
    if (!rolesByProfile[ur.profile_id]) rolesByProfile[ur.profile_id] = []
    rolesByProfile[ur.profile_id].push(ur.roles?.name || '')
  }

  return ((profiles as Profile[]) || []).map((p) => ({
    ...p,
    roleNames: rolesByProfile[p.id] || [],
    group: groupFromRoleNames(rolesByProfile[p.id] || []),
  }))
}

// Resuelve el rol destino (alias-tolerante), borra roles actuales y asigna el nuevo.
export async function assignRole(profileId: string, selected: string, aliases: string[]): Promise<void> {
  const { data: rolesData, error: re } = await supabase.from('roles').select('id,name')
  if (re) throw re

  let roleRow: { id: string; name: string } | null = null
  if (selected !== 'pending') {
    const lowered = aliases.map((a) => a.toLowerCase())
    roleRow = (rolesData || []).find((r: any) => lowered.includes(String(r.name).toLowerCase())) || null
    if (!roleRow) throw new Error(`No hay un rol equivalente a "${selected}" en la tabla roles.`)
  }

  const { error: de } = await supabase.from('user_roles').delete().eq('profile_id', profileId)
  if (de) throw de

  if (roleRow) {
    const { error: ie } = await supabase.from('user_roles').insert({ profile_id: profileId, role_id: roleRow.id })
    if (ie) throw ie
  }
}

// ── Enrutamiento de aprobadores ──────────────────────────────────
export async function loadApproverRouting(): Promise<{
  companies: RoutingCompany[]
  memberships: RoutingMembership[]
  assignments: RoutingAssignment[]
}> {
  const [companiesResult, membershipsResult, assignmentsResult] = await Promise.all([
    supabase.from('companies').select('id,name,legal_name,active').eq('active', true).order('name'),
    supabase.rpc('list_profile_company_memberships'),
    supabase.rpc('list_approver_assignments'),
  ])
  const failed = [companiesResult, membershipsResult, assignmentsResult].find((r) => r.error)
  if (failed?.error) throw failed.error
  return {
    companies: (companiesResult.data || []) as RoutingCompany[],
    memberships: (membershipsResult.data || []) as RoutingMembership[],
    assignments: (assignmentsResult.data || []) as RoutingAssignment[],
  }
}

export async function setProfileCompanyMembership(
  profileId: string,
  companyId: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_profile_company_membership', {
    p_profile_id: profileId,
    p_company_id: companyId,
    p_active: active,
  })
  if (error) throw error
}

export async function listApproverCandidates(
  companyId: string,
  requesterId: string,
): Promise<ApproverCandidate[]> {
  const { data, error } = await supabase.rpc('list_company_approver_candidates', {
    p_company_id: companyId,
    p_requester_id: requesterId,
  })
  if (error) throw error
  return (data || []) as ApproverCandidate[]
}

export async function addApproverAssignment(
  companyId: string,
  requesterId: string,
  approverId: string,
): Promise<void> {
  const { error } = await supabase.rpc('add_approver_assignment', {
    p_company_id: companyId,
    p_requester_id: requesterId,
    p_approver_id: approverId,
  })
  if (error) throw error
}

export async function removeApproverAssignment(assignmentId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_approver_assignment', { p_assignment_id: assignmentId })
  if (error) throw error
}

// ── Mapeo CONTPAQ ────────────────────────────────────────────────
export async function loadContpaqBase(): Promise<{
  companies: ContpaqCompany[]
  categories: BudgetCategory[]
}> {
  const [companiesR, categoriesR] = await Promise.all([
    supabase.from('companies').select('id,name,active').eq('active', true).order('name'),
    supabase
      .from('budget_categories')
      .select('id,name,category,code,active')
      .eq('active', true)
      .order('category')
      .order('name'),
  ])
  if (companiesR.error) throw companiesR.error
  if (categoriesR.error) throw categoriesR.error
  return {
    companies: (companiesR.data || []) as ContpaqCompany[],
    categories: (categoriesR.data || []) as BudgetCategory[],
  }
}

async function fetchAllRows<T>(
  builderFactory: () => any,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await builderFactory().range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...((data || []) as T[]))
    if (!data || data.length < pageSize) break
  }
  return rows
}

export async function loadContpaqCompanyData(companyId: string): Promise<{
  accounts: ContpaqAccount[]
  mappings: ContpaqMappingRow[]
}> {
  const [accounts, mappings] = await Promise.all([
    fetchAllRows<ContpaqAccount>(() =>
      supabase.from('contpaq_accounts').select('code,name,is_detail').eq('company_id', companyId).order('code'),
    ),
    fetchAllRows<ContpaqMappingRow>(() =>
      supabase
        .from('budget_account_mappings')
        .select('budget_category_id,contpaq_account_code,needs_review')
        .eq('company_id', companyId)
        .order('budget_category_id'),
    ),
  ])
  return { accounts, mappings }
}

export async function deleteContpaqMapping(companyId: string, categoryId: string): Promise<void> {
  const { error } = await supabase
    .from('budget_account_mappings')
    .delete()
    .eq('company_id', companyId)
    .eq('budget_category_id', categoryId)
  if (error) throw error
}

export async function upsertContpaqMapping(
  companyId: string,
  categoryId: string,
  code: string,
  profileId: string | null,
): Promise<void> {
  const { error } = await supabase.from('budget_account_mappings').upsert(
    {
      company_id: companyId,
      budget_category_id: categoryId,
      contpaq_account_code: code,
      needs_review: false,
      updated_by: profileId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id,budget_category_id' },
  )
  if (error) throw error
}

export async function updateBudgetCategoryGroup(categoryId: string, category: string): Promise<void> {
  const { error } = await supabase.from('budget_categories').update({ category }).eq('id', categoryId)
  if (error) throw error
}
