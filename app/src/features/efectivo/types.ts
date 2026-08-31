// Filas de las tablas usadas por Efectivo (subset de columnas que consume la pantalla).
export type CashFund = {
  id: string
  payment_request_id: string | null
  responsible_profile_id: string | null
  company_id: string | null
  delivery_method: string | null // 'cash' | 'check'
  assigned_amount: number | null
  verified_amount: number | null
  pending_amount: number | null
  due_date: string | null
  status: string | null // active|pending_receipt|receipt_review|blocked|verified|closed|cancelled
  notes: string | null
  created_at: string | null
}

export type Reconciliation = {
  id: string
  cash_fund_id: string | null
  status: string | null // draft|submitted|approved|rejected|correction_requested
  total_tickets: number | null
  returned_amount: number | null
  difference_amount: number | null
  reviewed_at: string | null
  reviewer_comment: string | null
  created_at: string | null
}

export type ReconciliationItem = {
  id: string
  reconciliation_id: string | null
  concept: string | null
  amount: number | null
  ticket_date: string | null
  proveedor_id: string | null
  budget_category_id: string | null
  status: string | null // valid|rejected
  storage_path: string | null
  created_at: string | null
}

export type PaymentRequest = {
  id: string
  request_number: string | null
  description: string | null
}

export type Company = { id: string; name: string | null; legal_name: string | null }
export type BudgetCategory = {
  id: string
  code: string | null
  name: string | null
  nombre: string | null
  active: boolean | null
  activo: boolean | null
}
export type ProviderLite = { id: string; alias: string | null; nombre_completo: string | null; rfc: string | null; activo: boolean | null }
export type ProfileLite = { id: string; full_name: string | null; email: string | null }

export type CashData = {
  cashFunds: CashFund[]
  reconciliations: Reconciliation[]
  reconciliationItems: ReconciliationItem[]
  paymentRequests: PaymentRequest[]
  profiles: ProfileLite[]
  companies: Company[]
  proveedores: ProviderLite[]
  budgetCategories: BudgetCategory[]
}

export type ReviewAction = 'approved' | 'rejected' | 'correction_requested'
export type TicketPayload = {
  reconciliation_id: string
  concept: string
  amount: number
  ticket_date: string | null
  proveedor_id: string | null
  budget_category_id: string | null
  status: 'valid'
  storage_path?: string
}
