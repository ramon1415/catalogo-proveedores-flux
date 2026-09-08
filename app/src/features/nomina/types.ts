// Tipos del rail de captura de Nómina (N2B/N3G). Portado 1:1 desde
// payroll_capture.js + el contrato de las migraciones supabase/*payroll*.
// (Generar db.types.ts con `supabase gen types` reemplazará estos tipos manuales.)

export type PayrollSlot =
  | 'caratula'
  | 'layout_mismo_banco'
  | 'layout_spei'
  | 'layout_toka'
  | 'cfdi_vales'

export type PayrollChannel = 'banco' | 'spei' | 'vales'
export type PayrollSubtype = 'ordinaria' | 'extraordinaria'

export type BankAccount = {
  id: string
  company_id: string
  name: string | null
  bank_name: string | null
  currency: string | null
  account_type: string | null
  last4: string | null
  account_number: string | null
  clabe: string | null
  active: boolean | null
}

export type CostCenter = { id: string; name: string | null; code: string | null; active: boolean | null }
export type CompanyCostCenter = { company_id: string; cost_center_id: string; active: boolean | null }
export type Company = { id: string; name: string | null }

export type CaptureFile = {
  id: string
  kind: PayrollSlot
  channel: string | null
  capability_code: string | null
  parsing_status: string | null
  validation_authority: string | null
  parser_version: string | null
  parser_contract: string | null
  record_count: number | null
  total_amount_minor: number | null
  issue_codes: string[] | null
  uploaded_at: string | null
}

export type CaptureSession = {
  id: string
  company_id: string
  company_bank_account_id: string
  cost_center_id: string | null
  budget_category_id: string | null
  budget_month: string | null
  payroll_subtype: PayrollSubtype
  period_start: string
  period_end: string
  concept: string
  notes: string | null
  expected_channels: PayrollChannel[]
  capture_state: string
  validation_status: string | null
  version: number
  expires_at: string | null
  updated_at: string | null
  materialized_payment_request_id: string | null
  materialized_at: string | null
  server_verification_summary: unknown
  payment_request_number?: string | null
  payment_request_status?: string | null
  finance_confirmation_pending?: boolean
  payment_ready?: boolean
  payment_flow_state?: string | null
  files: CaptureFile[]
}

export type SpeiParserSummary = {
  parserVersion: string
  contractVersion: string
  valid: boolean
  recordCount: number
  totalAmountMinor: number | null
  currency: string
  issues: SpeiIssue[]
}

export type SpeiIssue = {
  code: string
  severity: 'blocking'
  source?: string
  row?: number
  field?: string
}

export type LocalFileDiagnostic = {
  contractVersion: string
  recordCount: number | null
  totalAmountMinor: number | null
  cashAmountMinor?: number | null
  vouchersAmountMinor?: number | null
  benefitAmountMinor?: number | null
  feeAmountMinor?: number | null
  taxAmountMinor?: number | null
  expectedFundingAmountMinor?: number | null
}

export type FileSlotState = {
  present: boolean
  uploadable: boolean
  uploaded: boolean
  status: string
  file?: File
  fileId?: string
  fileName?: string
  extension?: string
  mimeType?: string
  sizeBytes?: number
  sha256?: string
  encodedSourceAccounts?: string[]
  parserSummary?: SpeiParserSummary
  localDiagnostic?: LocalFileDiagnostic
  recordCount?: number | null
  totalAmountMinor?: number | null
  issueCodes: string[]
}

export type FileMap = Partial<Record<PayrollSlot, FileSlotState>>

export type SummaryChannel = {
  channel: PayrollChannel
  amount: number | null
  benefit_amount: number | null
  fee_amount: number | null
  tax_amount: number | null
  expected_funding_amount: number | null
  funding_variance: number | null
  funding_variance_acknowledged: boolean
  funding_variance_acknowledged_at: string | null
}

export type SubmissionSummary = {
  payment_request_id: string
  request_number?: string | null
  status: string
  company_id: string
  cost_center_id: string | null
  amount_requested: number | null
  employee_net: number | null
  currency: string | null
  payroll_subtype: PayrollSubtype
  period_start: string | null
  period_end: string | null
  approver_id: string | null
  approver_assignment_id: string | null
  approver_selection_source: string | null
  submitted_at: string | null
  budget_category_id: string | null
  budget_month: string | null
  budget_decision: string | null
  budget_block_reason: string | null
  budget_available_before: number | null
  budget_available_after: number | null
  budget_shortfall: number | null
  budget_checked_at: string | null
  budget_ready: boolean
  finance_confirmation_pending?: boolean
  payment_ready?: boolean
  payment_flow_state?: string | null
  channels: SummaryChannel[]
}

export type ApproverCandidate = {
  profile_id: string
  assignment_id?: string | null
  source?: string | null
  option_label?: string | null
  display_name?: string | null
  email?: string | null
  eligible_roles?: string[] | null
}

export type SavePayload = {
  sessionId: string | null
  expectedVersion: number | null
  companyId: string
  companyBankAccountId: string
  costCenterId: string
  payrollSubtype: PayrollSubtype
  periodStart: string
  periodEnd: string
  concept: string
  notes: string | null
  expectedChannels: PayrollChannel[]
}
