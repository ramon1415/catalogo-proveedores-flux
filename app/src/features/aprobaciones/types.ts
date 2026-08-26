// Filas de las tablas usadas por la Cola de aprobación (subset de columnas que
// consume la pantalla vanilla aprobaciones.js). Portado 1:1.

// `payment_requests` — se selecciona con `*`, aquí el subset que la pantalla lee.
export type PaymentRequest = {
  id: string
  request_number: string | null
  description: string | null
  notes: string | null
  status: string | null
  request_type: string | null
  currency: string | null
  amount_requested: number | null
  proveedor_id: string | null
  company_id: string | null
  cost_center_id: string | null
  budget_category_id: string | null
  budget_month: string | null
  budget_decision: string | null
  is_extraordinary_adjustment: boolean | null
  exception_status: string | null
  exception_action: string | null
  exception_approved_at: string | null
  approved_at: string | null
  approver_id: string | null
  created_at: string | null
  updated_at: string | null
  // Metadato adjuntado en cliente (última decisión relevante en bitácora).
  __approvalEvent?: ApprovalEvent | null
}

// `payment_request_approvals` — bitácora de decisiones (para fechas de historial).
export type ApprovalEvent = {
  payment_request_id: string
  action: string
  from_status: string | null
  to_status: string | null
  comments: string | null
  approval_level: number | null
  created_at: string | null
  actor_profile_id: string | null
}

export type ProviderLite = {
  id: string
  alias: string | null
  nombre_completo: string | null
  rfc: string | null
}

export type Company = { id: string; name: string | null; legal_name: string | null }
export type CostCenter = { id: string; code: string | null; name: string | null }
export type BudgetCategory = {
  id: string
  code: string | null
  name: string | null
  category: string | null
}
export type LayoutLine = {
  id: string
  payment_request_id: string | null
  layout_id: string | null
  status: string | null
}
export type CashFundLite = {
  id: string
  payment_request_id: string | null
  status: string | null
  pending_amount: number | null
}

// Resultado de get_payment_request_approver_details.
export type ApproverDetails = {
  profile_id: string | null
  display_name: string | null
  eligible_roles: string[] | null
  source: string | null
}

export type ApprovalData = {
  requests: PaymentRequest[]
  providers: ProviderLite[]
  companies: Company[]
  centers: CostCenter[]
  categories: BudgetCategory[]
  layoutLines: LayoutLine[]
  cashFunds: CashFundLite[]
  approvalEvents: ApprovalEvent[]
}

export type MainTab = 'decide' | 'history'
export type ColumnKey = 'pending' | 'changes' | 'exceptions' | 'approved' | 'closed'
export type SubFilter = 'all' | ColumnKey

// Acciones que consume el RPC decide_payment_request (p_action).
export type DecisionAction =
  | 'approved'
  | 'rejected'
  | 'changes_requested'
  | 'exception_approved'
  | 'exception_rejected'
  | 'amount_change_requested'
  | 'category_change_requested'
  | 'budget_adjustment_requested'
