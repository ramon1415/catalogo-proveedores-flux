// Tipos de la sección Configuración (portados 1:1 de configuracion.js vanilla).

export type ConfigTab = 'members' | 'originAccounts' | 'budgets' | 'contpaq' | 'system' | 'empresas' | 'proyectos'

// ── Proyectos ────────────────────────────────────────────────────
// Catálogo por empresa que Finanzas da de alta; las solicitudes lo referencian
// de forma opcional para poder sumar el costo de un esfuerzo que cruza varias
// facturas/proveedores.
export type Project = {
  id: string
  company_id: string
  name: string
  description: string | null
  active: boolean
  created_at?: string | null
  updated_at?: string | null
}

export type ProjectPayload = {
  name: string
  description: string | null
}

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
  role_key: 'operator' | 'finance' | 'director' | 'sysadmin' | null
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

export type RoleValue = 'pending' | 'operator' | 'finance' | 'director' | 'sysadmin'

export type CompanyAccessRequest = {
  id: string
  profile_id: string
  profile_name: string | null
  profile_email: string | null
  company_id: string
  company_name: string | null
  status: 'pending' | 'approved' | 'rejected'
  requested_at: string
  reviewed_at: string | null
  approved_role: 'solicitante' | 'operator' | 'finance' | 'director' | null
  current_roles: string[] | null
}

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

// Sub-secciones del tab Mapeo CONTPAQ.
export type ContpaqSubTab = 'partidas' | 'impuestos' | 'proveedores' | 'bancos' | 'exportar'

// Llaves fiscales fijas que consume el módulo contable (mapeoEmpresa.impuestos).
export type TaxKey =
  | 'ivaAcreditablePagado'
  | 'ivaRetenidoAcreditable'
  | 'retIvaPasivo'
  | 'retIsrPasivo'
  | 'ivaPendiente'
  | 'ajusteRedondeo'
  | 'noDeducibles'

export type TaxMappingRow = {
  tax_key: TaxKey
  contpaq_account_code: string
  needs_review: boolean
}

export type ProviderMappingRow = {
  proveedor_id: string
  contpaq_account_code: string | null
  contpaq_provider_id: string | null
}

export type BankMappingRow = {
  company_bank_account_id: string
  contpaq_account_code: string
}

// Referencia de solo-lectura importada de CONTPAQ para el picker de terceros.
export type ContpaqTercero = {
  id_contpaq: string
  nombre: string
  rfc: string | null
  tipo_tercero: 'proveedor' | 'cliente'
}

// Proveedor Flux (columnas reales de la tabla proveedores).
export type ProveedorRow = {
  id: string
  alias: string | null
  nombre_completo: string | null
  rfc: string | null
  activo: boolean | null
}

// Cuenta bancaria de la empresa (subset para el mapeo de bancos).
export type BankAccountRow = {
  id: string
  company_id: string | null
  name: string | null
  bank_name: string | null
  last4: string | null
  active: boolean | null
}

// ── Export contable (FB-7) ───────────────────────────────────────
// Fila de payment_requests pagada, con lo que consume el adapter del motor.
export type PaidRequestRow = {
  id: string
  company_id: string | null
  provider_id: string | null
  proveedor_id: string | null
  budget_category_id: string | null
  cost_center_id: string | null
  company_bank_account_id: string | null
  amount_requested: number | string | null
  currency: string | null
  exchange_rate: number | string | null
  concept: string | null
  description: string | null
  request_number: string | null
  paid_at: string | null
  payment_method: string | null
  cfdi_data: Record<string, unknown> | null
  proveedores: { rfc: string | null; nombre_completo: string | null; persona_tipo: string | null } | null
}

// Predicción histórica proveedor(RFC)→cuenta de gasto (seed del histórico),
// insumo de la cola de revisión de cuentas del export.
export type PartidaPredictionRow = {
  rfc_emisor: string
  cuenta_gasto_dominante: string | null
  share_dominante: number | string | null
  n_cfdis: number | null
  is_confident: boolean | null
}

// Fila del ledger accounting_exports (subset que consume el export).
export type AccountingExportRow = {
  source_feeder: string
  source_id: string
  source_kind: string | null
  status: string
  tipo_pol: number
  folio: number
}

// Fila a insertar en accounting_exports (salida de planRegistro del motor).
export type AccountingExportInsert = {
  source_feeder: string
  source_id: string
  source_kind: string
  company_id: string | null
  tipo_pol: number
  folio: number
  periodo: string
  uuid_cfdi: string | null
  status: string
  content_hash: string
}
