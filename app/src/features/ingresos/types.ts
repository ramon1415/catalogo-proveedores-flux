// Filas de las tablas usadas por Ingresos e Incidencias (subset de columnas que consume la pantalla).
// Portado 1:1 de las consultas de ingresos.js.

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

export type BillingPeriod = {
  id: string
  year: number | null
  name: string | null
  cutoff_date: string | null
  total_budget: number | null
  status: string | null // open | closed | cancelled
  created_by: string | null
  created_at: string | null
}

export type MaintenanceFeeCharge = {
  id: string
  member_id: string | null
  billing_period_id: string | null
  expected_amount: number | null
  paid_amount: number | null
  pending_amount: number | null
  status: string | null // pending | partial | paid | overdue | cancelled
  invoice_id: string | null
  created_at: string | null
}

// Cargada en paralelo por paridad de red; no se renderiza directamente en el vanilla.
export type MaintenanceFeePayment = {
  id: string
  charge_id: string | null
  amount: number | null
  payment_date: string | null
  receipt_storage_path: string | null
  created_at: string | null
}

export type IncidentCharge = {
  id: string
  member_id: string | null
  external_name: string | null
  external_rfc: string | null
  referred_by_member_id: string | null
  company_id: string | null
  cost_center_id: string | null
  budget_category_id: string | null
  description: string | null
  amount: number | null
  incident_date: string | null
  status: string | null // open | invoiced | paid | cancelled
  invoice_id: string | null
  notes: string | null
}

export type Invoice = {
  id: string
  invoice_type: string | null // maintenance_fee | incident
  status: string | null // issued | paid | cancelled
  fiscal_uuid: string | null
  series_folio: string | null
  amount: number | null
  issue_date: string | null
  payment_date: string | null
  receiver_rfc: string | null
  member_id: string | null
  external_name: string | null
  charge_id: string | null
  incident_charge_id: string | null
}

export type Company = { id: string; name: string | null; legal_name: string | null; active: boolean | null }
export type CostCenter = { id: string; name: string | null; code: string | null; company_id: string | null; active: boolean | null }
export type BudgetCategory = {
  id: string
  code: string | null
  name: string | null
  category: string | null
  budget_type: string | null
  active: boolean | null
}

export type IngresosData = {
  members: Member[]
  periods: BillingPeriod[]
  charges: MaintenanceFeeCharge[]
  payments: MaintenanceFeePayment[]
  incidents: IncidentCharge[]
  invoices: Invoice[]
  companies: Company[]
  costCenters: CostCenter[]
  categories: BudgetCategory[]
}

// Tabs internos del módulo (idénticos a los data-tab del vanilla).
export type IngresosTab = 'dashboard' | 'members' | 'periods' | 'payments' | 'incidents' | 'invoices'

// Filtro rápido disparado por las stat cards.
export type QuickFilter = 'members' | 'pendingFees' | 'pendingAmount' | 'openIncidents' | 'pendingInvoices' | null

export type InvoiceType = 'maintenance_fee' | 'incident'

// Payload de members.insert / members.update
export type MemberPayload = {
  full_name: string
  rfc: string | null
  lineage: string | null
  fee_factor: number
  email: string | null
  phone: string | null
  notes: string | null
  active: boolean
  updated_at: string
}

export type PeriodPayload = {
  year: number
  name: string
  cutoff_date: string
  total_budget: number
  status: string
  created_by: string
}
