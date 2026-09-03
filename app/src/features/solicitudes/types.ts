// Tipos de la sección Solicitudes de pago. Subset de columnas que consumen la
// pantalla vanilla (solicitudes.js) y sus extensiones runtime.

export type PaymentRequest = {
  id: string
  request_number: string | null
  proveedor_id: string | null
  company_id: string | null
  cost_center_id: string | null
  budget_category_id: string | null
  budget_month: string | null
  amount_requested: number | null
  currency: string | null
  exchange_rate: number | null
  status: string | null
  description: string | null
  notes: string | null
  requested_by: string | null
  approver_id: string | null
  submitted_at: string | null
  budget_decision: string | null
  budget_block_reason: string | null
  budget_available_before: number | null
  budget_available_after: number | null
  budget_shortfall: number | null
  budget_checked_at: string | null
  budget_result: unknown
  is_extraordinary_adjustment: boolean | null
  exception_status: string | null
  exception_action: string | null
  exception_reason: string | null
  exception_approved_by: string | null
  exception_approved_at: string | null
  requires_budget_adjustment: boolean | null
  operational_comments: string | null
  invoice_storage_path: string | null
  // Metadata de Fase 2 (extensión payment_method). Puede faltar en ambientes
  // sin la migración 004c; se lee de forma perezosa en detalle/tabla.
  request_type?: string | null
  payment_method?: string | null
  // Reembolsos: empleado que cobra. En el resto de tipos va null y el
  // destinatario del dinero sigue siendo el proveedor.
  beneficiary_profile_id?: string | null
  created_at: string | null
  updated_at: string | null
}

export type Company = {
  id: string
  name?: string | null
  legal_name?: string | null
  display_name?: string | null
  active?: boolean | null
  activo?: boolean | null
  is_active?: boolean | null
}

export type CostCenter = {
  id: string
  code?: string | null
  name?: string | null
  display_name?: string | null
  active?: boolean | null
  activo?: boolean | null
  is_active?: boolean | null
}

export type BudgetCategory = {
  id: string
  code?: string | null
  name?: string | null
  category?: string | null
  active?: boolean | null
  activo?: boolean | null
  is_active?: boolean | null
}

export type Proveedor = {
  id: string
  alias: string | null
  nombre_completo: string | null
  rfc: string | null
  banco: string | null
  clabe?: string | null
  cuenta_bancaria?: string | null
  metodo_pago?: string | null
  activo?: boolean | null
}

// Fila de la vista budget_availability. Las columnas de disponible varían por
// ambiente; getAvailableAmount() prueba varios nombres, igual que el vanilla.
export type BudgetAvailabilityRow = {
  budget_category_id: string | null
  company_id?: string | null
  cost_center_id?: string | null
  budget_month?: string | null
  responsible_email?: string | null
  has_additional_access?: boolean
  [key: string]: unknown
}

// Candidato devuelto por list_payment_request_approver_options.
export type ApproverCandidate = {
  profile_id: string
  assignment_id?: string | null
  source?: string | null // 'assigned' | 'approval_rules'
  option_label?: string | null
  display_name?: string | null
  email?: string | null
  eligible_roles?: string[] | null
}

export type ApproverSelection = {
  profile_id: string
  assignment_id: string | null
  source: string
}

export type ApprovalHistoryRow = {
  id: string
  action: string | null
  from_status: string | null
  to_status: string | null
  comments: string | null
  approval_level: number | null
  created_at: string | null
  actor_profile_id: string | null
  role_id: string | null
}

export type PaymentReceiptRow = {
  id: string
  layout_id: string | null
  payment_date: string | null
  amount: number | null
  bank_reference: string | null
  storage_path: string | null
  created_at: string | null
}

export type Profile = { id: string; full_name: string | null; email: string | null }

// ── Reembolsos ─────────────────────────────────────────────────────────────
// Datos bancarios del empleado. Viven en su propia tabla (no en profiles, que
// es legible por cualquier autenticado): cada quien ve/edita los suyos y
// Finanzas los lee para dispersar.
export type EmployeeBankAccount = {
  profile_id: string
  company_id: string
  banco: string | null
  clabe: string | null
  cuenta: string | null
  beneficiary_name: string | null
  updated_at?: string | null
}

// Renglón persistido del desglose (reimbursement_items).
export type ReimbursementItem = {
  id: string
  payment_request_id: string
  company_id: string
  budget_category_id: string | null
  descripcion: string
  amount: number | null
  subtotal_amount: number | null
  tax_amount: number | null
  deducible: boolean
  invoice_uuid: string | null
  cfdi_data?: unknown
  storage_path: string | null
  created_at?: string | null
}

// Renglón en captura (cliente). El adjunto todavía no está en Storage, así que
// se guarda el File y se sube después de crear la solicitud.
export type ReimbursementDraftItem = {
  key: string
  descripcion: string
  amount: string
  budgetCategoryId: string
  deducible: boolean
  file: File | null
  fileHint: string
  // Autollenado del CFDI del renglón (parseCfdiFile + parser certificado).
  subtotalAmount: number | null
  taxAmount: number | null
  invoiceUuid: string | null
  cfdiData: unknown | null
}

// Payload de insert de un renglón (sin id/created_at, que pone la BD).
export type ReimbursementItemInsert = {
  payment_request_id: string
  company_id: string
  // NOT NULL en la BD: la partida atribuye el gasto a su área también cuando
  // el renglón no es deducible.
  budget_category_id: string
  descripcion: string
  amount: number
  subtotal_amount: number | null
  tax_amount: number | null
  deducible: boolean
  invoice_uuid: string | null
  cfdi_data: unknown | null
  storage_path: string | null
}

export type IncidentCharge = {
  id: string
  member_id: string | null
  external_name: string | null
  description: string | null
  amount: number | null
  incident_date: string | null
  status: string | null
}

// Contexto de ejecución (get_payment_request_execution_context) usado por el
// panel de ruta de autorización / extraordinarios / fondo de efectivo.
export type ExecutionContext = {
  is_finance?: boolean
  extraordinary?: ExtraordinaryContext | null
  latest_batch?: BatchContext | null
  approval_history?: BatchHistoryRow[] | null
  direction_approval_stale?: boolean
  budget_validation_current?: boolean
  can_authorize_extraordinary?: boolean
  authorization_block_reason?: string | null
  extraordinary_policy?: ExtraordinaryPolicy | null
  eligible_external_directors?: Array<{ profile_id: string; name?: string | null }> | null
  can_create_cash_fund?: boolean
  cash_fund_block_reason?: string | null
  execution_authorization_source?: string | null
} | null

export type ExtraordinaryContext = {
  id?: string
  status?: string
  secure_contract?: boolean
  category?: string | null
  reason?: string | null
  authorized_by_name?: string | null
  authorized_at?: string | null
  external_director_name?: string | null
  external_director_profile_id?: string | null
  external_authorized_at?: string | null
  valid_until?: string | null
  ratification_due_at?: string | null
  evidence_finalized?: boolean
  evidence_sha256?: string | null
  dispute_reason?: string | null
  can_resume?: boolean
  can_revoke?: boolean
  storage_bucket?: string | null
  storage_path?: string | null
}

export type BatchContext = {
  batch_label?: string | null
  batch_status?: string | null
  director_status?: string | null
}

export type BatchHistoryRow = {
  review_sequence?: number | null
  batch_label?: string | null
  batch_status?: string | null
  director_status?: string | null
  decided_at?: string | null
  reject_reason?: string | null
  correction_note?: string | null
  resubmission_note?: string | null
}

export type ExtraordinaryPolicy = {
  allowed_categories?: string[]
  authorization_valid_hours?: number
  max_amount_mxn?: number
}

export type RequestSummary = {
  id: string
  requestNumber: string | null
  companyName: string
  providerName: string
  amount: number | null
  currency: string
  paymentMethod: string
  status: string | null
}

export type CashFund = {
  id: string
  payment_request_id: string | null
  responsible_profile_id: string | null
  due_date: string | null
  delivery_method: string | null
  status: string | null
  pending_amount: number | null
  created_at: string | null
}

export type StatusFilter =
  | 'todos' | 'activas' | 'submitted' | 'approved' | 'changes_requested'
  | 'finance_validation' | 'scheduled' | 'paid' | 'rejected' | 'cancelled'
export type BudgetDecisionFilter = 'todos' | 'aprobable' | 'excepciones'

// Payload que consume create_payment_request + metadata Fase 2.
export type RequestPayload = {
  request_type: string
  payment_method: string
  proveedor_id: string | null
  company_id: string | null
  approver_id: string | null
  approver_assignment_id: string | null
  cost_center_id: string | null
  budget_category_id: string | null
  budget_month: string | null
  amount_requested: number
  currency: string
  exchange_rate: number
  description: string
  notes: string | null
  requested_by: string | null
  is_extraordinary_adjustment: boolean
  responsible_profile_id: string | null
  due_date: string | null
  delivery_method: string
  // Desglose fiscal (opcional). Si hay subtotal, el budget lo descuenta a él;
  // sin desglose se sigue descontando el total (transición conservadora).
  subtotal_amount: number | null
  tax_amount: number | null
  withholding_amount: number | null
  invoice_uuid: string | null
  // Reembolsos: el RPC ya los conoce, así que el beneficiario se persiste en
  // la MISMA transacción que la solicitud (antes iba en un UPDATE posterior,
  // que podía dejar la solicitud sin destinatario si fallaba).
  beneficiary_profile_id: string | null
}

export type EditPayload = {
  proveedor_id: string
  company_id: string
  cost_center_id: string
  budget_category_id: string
  budget_month: string | null
  amount_requested: number
  currency: string
  exchange_rate: number
  is_extraordinary_adjustment: boolean
  description: string
  notes: string | null
  updated_at: string
  invoice_storage_path?: string
}

export type DecisionAction =
  | 'approved' | 'rejected' | 'changes_requested'
  | 'exception_approved' | 'exception_rejected'
  | 'amount_change_requested' | 'category_change_requested' | 'budget_adjustment_requested'

// Proyecto (catálogo opcional que administra Finanzas en Configuración). En la
// solicitud solo se necesita lo mínimo para pintar el selector.
export type ProjectOption = {
  id: string
  name: string
}
