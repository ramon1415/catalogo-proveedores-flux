// Migración a React de provider_intakes.html (rebanada 1: lista).
export type IntakeStatus =
  | 'received' | 'in_review' | 'needs_correction' | 'rejected' | 'converted' | 'cancelled'

export type IntakeItem = {
  id: string
  public_folio: string | null
  provider_name: string | null
  company_name: string | null
  amount_requested: number | null
  currency: string | null
  status: IntakeStatus
  created_at: string | null
}

export type IntakeSummary = Partial<Record<IntakeStatus, number>>
export type IntakeCompany = { id: string; name: string | null }

export type IntakeListResult = {
  items: IntakeItem[]
  summary: IntakeSummary
  total: number
  page: number
  page_size: number
  companies: IntakeCompany[]
}

export type IntakeFilters = {
  companyId: string | null
  status: IntakeStatus | ''
  dateFrom: string
  dateTo: string
  hasFiles: '' | 'true' | 'false'
  folio: string
  provider: string
  sort: string // 'desc' | 'asc'
  page: number
  pageSize: number
}

// ── Detalle (rebanada 2) ──────────────────────────────────────────────────
export type IntakeDetailData = {
  id: string
  public_folio: string | null
  company_name: string | null
  created_at: string | null
  updated_at: string | null
  status: IntakeStatus
  provider_name: string | null
  provider_rfc: string | null
  provider_email: string | null
  provider_phone: string | null
  concept: string | null
  description: string | null
  amount_requested: number | null
  currency: string | null
  requested_payment_date: string | null
  invoice_folio: string | null
  invoice_uuid: string | null
  invoice_date: string | null
  bank_name: string | null
  beneficiary_name: string | null
  bank_account_masked: string | null
  bank_clabe_masked: string | null
}

export type IntakeFile = {
  id: string
  original_filename: string | null
  file_kind: string | null
  mime_type: string | null
  size_bytes: number | null
  quarantine_status: string | null
}

export type IntakeEvent = {
  event_type: string | null
  created_at: string | null
  actor_name: string | null
  actor_type: string | null
  notes: string | null
}

export type IntakeDetailResult = {
  intake: IntakeDetailData | null
  files: IntakeFile[]
  events: IntakeEvent[]
}

// ── Matching de proveedor maestro (rebanada 5) ────────────────────────────
export type MatchConfidence = 'high' | 'medium' | 'low' | 'none'

export type CurrentMatch = {
  proveedor_id: string
  alias: string | null
  legal_name: string | null
  active: boolean
  bank: string | null
  clabe_masked: string | null
  account_masked: string | null
}

export type MatchCandidate = CurrentMatch & {
  selectable: boolean
  confidence: MatchConfidence | null
  score: number | null
  reasons: string[] | null
  differences: string[] | null
}

export type MatchHistoryRow = {
  action_kind: string | null
  previous_provider: string | null
  new_provider: string | null
  actor_type: string | null
  created_at: string | null
  reason: string | null
}

export type MatchData = {
  eligible: boolean
  current_match: CurrentMatch | null
  candidates: MatchCandidate[]
  duplicate_rfc_count: number
  history: MatchHistoryRow[]
  error?: string
}

export type LinkTarget = {
  targeted: boolean
  proveedor_id: string
  alias: string | null
  legal_name: string | null
  rfc_masked: string | null
  active: boolean
  bank_review: string | null
  identity_differences: { field: string; declared: string | null; master: string | null }[] | null
}

export type MatchComparison = {
  provider_alias: string | null
  provider_active: boolean
  rows: { field: string; declared: string | null; master: string | null; result: string | null }[]
}

export type MatchKind = 'set' | 'replace' | 'clear'

// ── Gestión de ligas públicas (rebanada 7) ────────────────────────────────
export type LinkCompany = { id: string; name: string | null; active_provider_count: number | null }

export type LinkDefaults = {
  duration_hours?: number
  max_files?: number
  max_file_mb?: number
  max_total_mb?: number
  max_submissions_per_day?: number
  allowed_file_types?: string[]
}

export type LinkManagementContext = {
  companies: LinkCompany[]
  defaults: LinkDefaults
}

export type LinkProviderResult = {
  proveedor_id: string
  alias: string | null
  legal_name: string | null
  rfc_masked: string | null
  bank: string | null
  account_masked: string | null
  clabe_masked: string | null
}

export type ActiveLink = {
  id: string
  status: string | null
  label: string | null
  token_prefix: string | null
  expires_at: string | null
  current_intakes: number | null
}

// ── Draft de pago + conversión (rebanada 6) ───────────────────────────────
export type PaymentDraftDerivedState =
  | 'NOT_STARTED' | 'DRAFT_INCOMPLETE' | 'READY_PENDING_PROVIDER' | 'BLOCKED_BANK_REVIEW'
  | 'READY_FOR_CONVERSION' | 'ALREADY_CONVERTED' | 'BLOCKED_INTAKE_STATUS'

export type PaymentDraftForm = {
  cost_center_id: string | null
  budget_category_id: string | null
  budget_month: string | null // YYYY-MM-01
  company_bank_account_id: string | null
  payment_method: string | null
  requested_by_profile_id: string | null
  approver_profile_id: string | null
  approver_assignment_id: string | null
  final_amount: string | null
  currency: string | null
  scheduled_payment_date: string | null
  internal_concept: string | null
  internal_notes: string | null
  amount_change_reason: string | null
}

export type PaymentDraftContext = {
  can_prepare: boolean
  can_save: boolean
  intake: {
    id: string; company_id: string; company_name: string | null; public_folio: string | null
    status: string; updated_at: string | null
    provider_name: string | null; concept: string | null; description: string | null
    amount_requested: number | null; currency: string | null; requested_payment_date: string | null
    invoice: { folio: string | null; date: string | null } | null
    created_payment_request_id: string | null
  }
  draft: (PaymentDraftForm & { version: number | null }) | null
  defaults: Partial<PaymentDraftForm> & { requested_by_profile_id?: string | null }
  catalogs: {
    cost_centers: { id: string; code: string | null; name: string | null }[]
    budget_categories: { id: string; cost_center_id: string | null; name: string | null; code?: string | null }[]
    origin_accounts: { id: string; name: string | null; bank_name: string | null; last4: string | null }[]
    currencies: string[]
  }
  requester_options: { profile_id: string; display_name: string | null }[]
  approver_options: ApproverOption[]
  provider: { proveedor_id: string; display_name: string | null; active: boolean } | null
  state: {
    derived_state: PaymentDraftDerivedState
    missing_fields: string[]
    blockers: string[]
    banking: {
      material_mismatch: boolean
      difference_fields: string[]
      comparison: { field: string; declared: string | null; master: string | null; different: boolean }[]
      resolution_valid: boolean
      resolution: { created_at: string | null } | null
      provider_updated_at: string | null
    } | null
  }
  error?: string
}

export type ApproverOption = {
  profile_id: string
  display_name: string | null
  option_label: string | null
  assignment_id: string | null
  source: string | null
}

// ── Acciones de flujo (rebanada 3): transiciones de estado + nota interna ──
export type IntakeAction =
  | { kind: 'transition'; toStatus: Exclude<IntakeStatus, 'received' | 'converted' | 'cancelled'>; label: string; danger?: boolean }
  | { kind: 'note'; toStatus: null; label: string; danger?: boolean }
