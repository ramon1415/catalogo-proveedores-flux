// Tipos de la sección Configuración (portados 1:1 de configuracion.js vanilla).

export type ConfigTab = 'members' | 'originAccounts' | 'budgets' | 'contpaq' | 'system'

// ── Cuentas origen ───────────────────────────────────────────────
export type Company = {
  id: string
  name: string | null
  legal_name?: string | null
  active?: boolean | null
}

export type OriginAccount = {
  id: string
  company_id: string | null
  name: string | null
  bank_name: string | null
  currency: string | null
  account_type: string | null
  last4: string | null
  active: boolean | null
  notes: string | null
  account_number: string | null
  clabe: string | null
}

export type OriginAccountPayload = {
  company_id: string | null
  name: string | null
  bank_name: string | null
  account_number: string | null
  clabe: string | null
  currency: string
  account_type: string | null
  notes: string | null
  active: boolean
  last4: string | null
}

// ── Socios ───────────────────────────────────────────────────────
export type Member = {
  id: string
  full_name: string | null
  rfc: string | null
  lineage: string | null
  fee_factor: number | null
  email: string | null
  phone: string | null
  notes: string | null
  active: boolean | null
}

export type MemberPayload = {
  full_name: string | null
  rfc: string | null
  lineage: string | null
  fee_factor: number
  email: string | null
  phone: string | null
  notes: string | null
  active: boolean
}

export type FeeCharge = {
  member_id: string
  description?: string | null
  period_label?: string | null
  amount: number | null
  status?: string | null
  due_date?: string | null
}

export type FeePayment = {
  member_id: string
  payment_date?: string | null
  amount: number | null
  payment_method?: string | null
  notes?: string | null
}

export type IncidentCharge = {
  member_id: string
  incident_date?: string | null
  description?: string | null
  amount: number | null
  status?: string | null
}

export type Invoice = {
  member_id: string
  folio?: string | null
  total: number | null
  status?: string | null
  issue_date?: string | null
}

export type BillingPeriod = { cutoff_date?: string | null }

export type SociosData = {
  members: Member[]
  charges: FeeCharge[]
  payments: FeePayment[]
  incidents: IncidentCharge[]
  invoices: Invoice[]
  periods: BillingPeriod[]
}

export type MemberBalance = {
  pending: number
  historic: number
  openIncidents: number
  pendingInvoices: number
}

export type MemberStatusFilter = 'all' | 'active' | 'inactive'

// ── Gestión de usuarios (Sistema) ────────────────────────────────
export type Profile = {
  id: string
  email: string | null
  full_name: string | null
  created_at: string | null
  active: boolean | null
}

export type UserRow = Profile & {
  roleNames: string[]
  group: string
}

export type RoutingCompany = {
  id: string
  name: string | null
  legal_name: string | null
  active?: boolean | null
}

export type RoutingMembership = {
  id: string
  profile_id: string
  profile_name: string | null
  profile_email: string | null
  company_id: string
  company_name: string | null
  active: boolean
}

export type RoutingAssignment = {
  id: string
  requester_id: string
  requester_name: string | null
  requester_email: string | null
  company_id: string
  company_name: string | null
  approver_id: string
  approver_name: string | null
  approver_email: string | null
  approver_roles: string[] | null
  active: boolean
}

export type ApproverCandidate = {
  profile_id: string
  display_name: string | null
  email: string | null
  eligible_roles: string[] | null
}

export type RoleValue = 'pending' | 'solicitante' | 'finance' | 'director' | 'sysadmin'

// ── Onboarding de tenant (Sistema / SysAdmin) ───────────────────
export type TenantModule = {
  module_key: string
  name: string
  kind: 'shared' | 'tenant_variant'
  active: boolean
}

export type TenantModuleRelease = {
  module_key: string
  version: number
  git_sha: string | null
  notes: string | null
}

export type TenantModuleConfig = {
  company_id: string
  module_key: string
  enabled: boolean
  version: number
  channel: 'stable' | 'canary'
  hold: boolean
  hold_reason: string | null
}

export type TenantModuleDraft = {
  module_key: string
  enabled: boolean
  version: number
  channel: 'stable' | 'canary'
}

// ── Mapeo CONTPAQ ────────────────────────────────────────────────
export type ContpaqCompany = { id: string; name: string; active?: boolean | null }

export type BudgetCategory = {
  id: string
  name: string
  category: string | null
  code: string | null
  active?: boolean | null
}

export type ContpaqAccount = {
  code: string
  name: string
  is_detail: boolean
}

export type ContpaqMappingRow = {
  budget_category_id: string
  contpaq_account_code: string
  needs_review: boolean
}

export type ContpaqFilter = 'todas' | 'revisar' | 'sinmapear'
