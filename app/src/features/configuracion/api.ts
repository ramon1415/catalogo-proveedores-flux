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
  CompanyAccessRequest,
  TenantModule,
  TenantModuleRelease,
  TenantModuleConfig,
  TenantModuleDraft,
  ContpaqCompany,
  BudgetCategory,
  ContpaqAccount,
  ContpaqMappingRow,
  TaxKey,
  TaxMappingRow,
  ProviderMappingRow,
  BankMappingRow,
  ContpaqTercero,
  ProveedorRow,
  BankAccountRow,
  PaidRequestRow,
  PartidaPredictionRow,
  AccountingExportRow,
  AccountingExportInsert,
  Project,
  ProjectPayload,
} from './types'
import { groupFromRoleNames } from './logic'
import { normalizarRfc, type ProviderMappingLite, type PartidaPredictionLite } from './cuentaReview'

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

// Activa/desactiva el perfil global; no toca roles ni membresías (histórico intacto).
export async function setProfileActive(profileId: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ active }).eq('id', profileId)
  if (error) throw error
}

// ── Solicitudes de acceso por empresa ───────────────────────────
export async function listCompanyAccessRequests(): Promise<CompanyAccessRequest[]> {
  const { data, error } = await supabase.rpc('list_company_access_requests')
  if (error) throw error
  return (data || []) as CompanyAccessRequest[]
}

export async function approveCompanyAccessRequest(
  requestId: string,
  role: 'operator' | 'finance' | 'director',
): Promise<void> {
  const { error } = await supabase.rpc('approve_company_access_request', {
    p_request_id: requestId,
    p_role: role,
  })
  if (error) throw error
}

export async function rejectCompanyAccessRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('reject_company_access_request', { p_request_id: requestId })
  if (error) throw error
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

export async function setProfileCompanyRole(
  profileId: string,
  companyId: string,
  role: 'operator' | 'finance' | 'director',
  active = true,
): Promise<void> {
  const { error } = await supabase.rpc('set_profile_company_role', {
    p_profile_id: profileId,
    p_company_id: companyId,
    p_role: role,
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

// ── Onboarding de tenant (Sistema / SysAdmin) ───────────────────
// Reutiliza el registro y las RLS de F5.a. No crea empresas, perfiles, roles ni
// membresias; únicamente siembra/actualiza company_modules para una empresa
// existente después de la confirmación explícita del sysadmin.
export async function loadTenantOnboarding(): Promise<{
  companies: RoutingCompany[]
  modules: TenantModule[]
  releases: TenantModuleRelease[]
  configs: TenantModuleConfig[]
}> {
  const [companiesResult, modulesResult, releasesResult, configsResult] = await Promise.all([
    supabase.from('companies').select('id,name,legal_name,active').eq('active', true).order('name'),
    supabase.from('modules').select('module_key,name,kind,active').eq('active', true).order('name'),
    supabase.from('module_releases').select('module_key,version,git_sha,notes').order('module_key').order('version'),
    supabase
      .from('company_modules')
      .select('company_id,module_key,enabled,version,channel,hold,hold_reason')
      .order('module_key'),
  ])
  const failed = [companiesResult, modulesResult, releasesResult, configsResult].find((result) => result.error)
  if (failed?.error) throw failed.error
  return {
    companies: (companiesResult.data || []) as RoutingCompany[],
    modules: (modulesResult.data || []) as TenantModule[],
    releases: (releasesResult.data || []) as TenantModuleRelease[],
    configs: (configsResult.data || []) as TenantModuleConfig[],
  }
}

export async function saveTenantModuleConfiguration(
  companyId: string,
  drafts: TenantModuleDraft[],
  profileId: string | null,
): Promise<void> {
  if (!companyId || !drafts.length) throw new Error('TENANT_ONBOARDING_CONFIGURATION_EMPTY')
  const now = new Date().toISOString()
  const rows = drafts.map((draft) => ({
    company_id: companyId,
    module_key: draft.module_key,
    enabled: draft.enabled,
    version: draft.version,
    channel: draft.channel,
    updated_by: profileId,
    updated_at: now,
  }))
  const { error } = await supabase
    .from('company_modules')
    .upsert(rows, { onConflict: 'company_id,module_key' })
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

// ── Mapeo CONTPAQ: impuestos / proveedores / bancos ─────────────
// Catálogo de proveedores Flux activos (compartido entre empresas del grupo).
export async function loadContpaqProveedores(): Promise<ProveedorRow[]> {
  const { data, error } = await supabase
    .from('proveedores')
    .select('id,alias,nombre_completo,rfc,activo')
    .eq('activo', true)
    .order('alias', { ascending: true })
  if (error) throw error
  return (data || []) as ProveedorRow[]
}

// Capas extra del mapeoEmpresa por empresa: impuestos, proveedores, bancos y
// la referencia de terceros CONTPAQ para el picker.
export async function loadContpaqCompanyExtras(companyId: string): Promise<{
  taxMappings: TaxMappingRow[]
  providerMappings: ProviderMappingRow[]
  bankMappings: BankMappingRow[]
  terceros: ContpaqTercero[]
  bankAccounts: BankAccountRow[]
}> {
  const [taxR, provR, bankR, tercR, cuentasR] = await Promise.all([
    supabase
      .from('tax_account_mappings')
      .select('tax_key,contpaq_account_code,needs_review')
      .eq('company_id', companyId),
    supabase
      .from('provider_account_mappings')
      .select('proveedor_id,contpaq_account_code,contpaq_provider_id')
      .eq('company_id', companyId),
    supabase
      .from('bank_account_mappings')
      .select('company_bank_account_id,contpaq_account_code')
      .eq('company_id', companyId),
    fetchAllRows<ContpaqTercero>(() =>
      supabase
        .from('contpaq_terceros')
        .select('id_contpaq,nombre,rfc,tipo_tercero')
        .eq('company_id', companyId)
        .order('id_contpaq'),
    ),
    supabase
      .from('company_bank_accounts')
      .select('id,company_id,name,bank_name,last4,active')
      .eq('company_id', companyId)
      .eq('active', true)
      .order('name'),
  ])
  if (taxR.error) throw taxR.error
  if (provR.error) throw provR.error
  if (bankR.error) throw bankR.error
  if (cuentasR.error) throw cuentasR.error
  return {
    taxMappings: (taxR.data || []) as TaxMappingRow[],
    providerMappings: (provR.data || []) as ProviderMappingRow[],
    bankMappings: (bankR.data || []) as BankMappingRow[],
    terceros: tercR,
    bankAccounts: (cuentasR.data || []) as BankAccountRow[],
  }
}

// Al guardar manualmente una cuenta la discrepancia queda resuelta: needs_review → false.
export async function upsertTaxMapping(companyId: string, taxKey: TaxKey, code: string): Promise<void> {
  const { error } = await supabase.from('tax_account_mappings').upsert(
    {
      company_id: companyId,
      tax_key: taxKey,
      contpaq_account_code: code,
      needs_review: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id,tax_key' },
  )
  if (error) throw error
}

export async function deleteTaxMapping(companyId: string, taxKey: TaxKey): Promise<void> {
  const { error } = await supabase
    .from('tax_account_mappings')
    .delete()
    .eq('company_id', companyId)
    .eq('tax_key', taxKey)
  if (error) throw error
}

export async function upsertProviderMapping(
  companyId: string,
  proveedorId: string,
  code: string | null,
  terceroId: string | null,
): Promise<void> {
  const { error } = await supabase.from('provider_account_mappings').upsert(
    {
      company_id: companyId,
      proveedor_id: proveedorId,
      contpaq_account_code: code,
      contpaq_provider_id: terceroId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id,proveedor_id' },
  )
  if (error) throw error
}

export async function deleteProviderMapping(companyId: string, proveedorId: string): Promise<void> {
  const { error } = await supabase
    .from('provider_account_mappings')
    .delete()
    .eq('company_id', companyId)
    .eq('proveedor_id', proveedorId)
  if (error) throw error
}

export async function upsertBankMapping(companyId: string, bankAccountId: string, code: string): Promise<void> {
  const { error } = await supabase.from('bank_account_mappings').upsert(
    {
      company_id: companyId,
      company_bank_account_id: bankAccountId,
      contpaq_account_code: code,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id,company_bank_account_id' },
  )
  if (error) throw error
}

// ── Cola de revisión de cuentas contables (export CONTPAQ) ──────
// Insumos para perfilar proveedor→cuenta en el export: la capa autoritativa
// (provider_account_mappings) + el histórico seedeado (partida_predictions).
export async function loadCuentaReviewData(companyId: string): Promise<{
  providerMappings: Map<string, ProviderMappingLite>
  predictions: Map<string, PartidaPredictionLite>
}> {
  const [provR, predR] = await Promise.all([
    supabase
      .from('provider_account_mappings')
      .select('proveedor_id,contpaq_account_code,contpaq_provider_id')
      .eq('company_id', companyId),
    supabase
      .from('partida_predictions')
      .select('rfc_emisor,cuenta_gasto_dominante,share_dominante,n_cfdis,is_confident')
      .eq('company_id', companyId),
  ])
  if (provR.error) throw provR.error
  if (predR.error) throw predR.error

  const providerMappings = new Map<string, ProviderMappingLite>()
  for (const p of (provR.data || []) as ProviderMappingRow[]) {
    providerMappings.set(p.proveedor_id, { code: p.contpaq_account_code, terceroId: p.contpaq_provider_id })
  }
  const predictions = new Map<string, PartidaPredictionLite>()
  for (const r of (predR.data || []) as PartidaPredictionRow[]) {
    predictions.set(normalizarRfc(r.rfc_emisor), {
      cuentaDominante: r.cuenta_gasto_dominante,
      share: r.share_dominante === null ? null : Number(r.share_dominante),
      nCfdis: r.n_cfdis,
      confident: Boolean(r.is_confident),
    })
  }
  return { providerMappings, predictions }
}

// Finanzas confirma la cuenta de un proveedor desde el export. Via RPC
// SECURITY DEFINER que valida rol finance y hace un upsert que fija SOLO la
// cuenta (preserva el contpaq_provider_id/tercero de la sección Proveedores).
export async function confirmProviderAccount(
  companyId: string,
  proveedorId: string,
  code: string,
): Promise<void> {
  const { error } = await supabase.rpc('confirm_provider_account', {
    p_company_id: companyId,
    p_proveedor_id: proveedorId,
    p_account_code: code,
  })
  if (error) throw error
}

// ── Export contable (FB-7) ──────────────────────────────────────
// Pagos PAGADOS de la empresa dentro del mes elegido (filtro por paid_at —
// la columna existe en payment_requests), con el proveedor anidado que
// consume paymentRequestAContrato. Orden por paid_at: el folio consecutivo
// se asigna en orden de pago.
export async function loadPaidRequestsForExport(
  companyId: string,
  mesInicio: string, // 'YYYY-MM-01' (inclusive)
  mesFin: string, // primer día del mes siguiente (exclusivo)
): Promise<PaidRequestRow[]> {
  const { data, error } = await supabase
    .from('payment_requests')
    .select(
      'id,company_id,provider_id,proveedor_id,budget_category_id,cost_center_id,company_bank_account_id,' +
        'amount_requested,currency,exchange_rate,concept,description,request_number,paid_at,payment_method,' +
        'cfdi_data,proveedores(rfc,nombre_completo,persona_tipo)',
    )
    .eq('company_id', companyId)
    .eq('status', 'paid')
    .gte('paid_at', mesInicio)
    .lt('paid_at', mesFin)
    .order('paid_at', { ascending: true })
  if (error) throw error
  return (data || []) as unknown as PaidRequestRow[]
}

// Ledger vigente de esos pagos (idempotencia por source+kind) + folios ya
// usados en el periodo (semilla del folio provider: max(folio) por tipo_pol,
// contando también cancelados para nunca re-usar un folio emitido).
export async function loadExportLedger(
  companyId: string,
  periodo: string, // 'YYYY-MM-01'
  sourceIds: string[],
): Promise<{ exportadosIds: Set<string>; foliosPorTipo: Record<string, number> }> {
  const [porSourceR, porPeriodoR] = await Promise.all([
    sourceIds.length
      ? supabase
          .from('accounting_exports')
          .select('source_feeder,source_id,source_kind,status,tipo_pol,folio')
          .eq('source_feeder', 'flux')
          .in('source_id', sourceIds)
      : Promise.resolve({ data: [] as AccountingExportRow[], error: null }),
    supabase
      .from('accounting_exports')
      .select('tipo_pol,folio,status')
      .eq('company_id', companyId)
      .eq('periodo', periodo),
  ])
  if (porSourceR.error) throw porSourceR.error
  if (porPeriodoR.error) throw porPeriodoR.error

  const exportadosIds = new Set<string>()
  for (const r of (porSourceR.data || []) as AccountingExportRow[]) {
    // Vigente = status 'exported' de la etapa 'directo' (filas pre-F3 sin
    // source_kind cuentan como 'directo' — misma regla que el motor).
    if (r.status === 'exported' && (r.source_kind ?? 'directo') === 'directo') {
      exportadosIds.add(String(r.source_id))
    }
  }
  const foliosPorTipo: Record<string, number> = {}
  for (const r of (porPeriodoR.data || []) as { tipo_pol: number; folio: number }[]) {
    const clave = String(r.tipo_pol)
    if ((foliosPorTipo[clave] ?? 0) < r.folio) foliosPorTipo[clave] = r.folio
  }
  return { exportadosIds, foliosPorTipo }
}

// Registro en el ledger de las pólizas ya descargadas. Se llama DESPUÉS de
// generar el archivo: si truena, el archivo ya existe y la UI lo dice.
export async function insertAccountingExports(rows: AccountingExportInsert[]): Promise<void> {
  const { error } = await supabase.from('accounting_exports').insert(rows)
  if (error) throw error
}

export async function deleteBankMapping(companyId: string, bankAccountId: string): Promise<void> {
  const { error } = await supabase
    .from('bank_account_mappings')
    .delete()
    .eq('company_id', companyId)
    .eq('company_bank_account_id', bankAccountId)
  if (error) throw error
}

// ── Proyectos ────────────────────────────────────────────────────
// El catálogo se administra por empresa. Se traen activos e inactivos: el tab
// necesita ver los desactivados para poder reactivarlos.
export async function loadProjects(companyId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id,company_id,name,description,active,created_at,updated_at')
    .eq('company_id', companyId)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Project[]
}

export async function createProject(companyId: string, payload: ProjectPayload): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({ company_id: companyId, name: payload.name, description: payload.description })
    .select('id,company_id,name,description,active,created_at,updated_at')
    .single()
  if (error) throw error
  return data as Project
}

export async function updateProject(id: string, payload: ProjectPayload): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ name: payload.name, description: payload.description, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// Nunca se borra: un proyecto con gastos históricos debe conservarse para que
// el reporte de costo siga cuadrando. Desactivar solo lo saca del selector.
export async function setProjectActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
