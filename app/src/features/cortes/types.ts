// Migración a React de approval_batches.html/.js (Cortes semanales).
// Los tipos reflejan los payloads reales de las RPCs del vanilla.

export type BatchStatus = 'draft' | 'submitted' | 'approved' | 'partially_approved' | 'closed'
export type ItemDecisionStatus = 'pending' | 'approved' | 'rejected'
export type RebatchStatus = 'blocked' | 'released' | null

export type BatchView = 'finance' | 'director'

export type CurrencyTotal = { currency: string; amount: number }

// Fila de list_finance_approval_batches / list_director_approval_batches.
export type BatchListRow = {
  id: string
  company_id: string | null
  company_name: string | null
  director_name: string | null
  label: string | null
  status: BatchStatus
  period_start: string | null
  period_end: string | null
  created_at: string | null
  item_count: number | null
  totals_by_currency: CurrencyTotal[] | null
}

// batch de get_approval_batch_detail.
export type BatchDetailBatch = {
  id: string
  company_id: string | null
  company_name: string | null
  label: string | null
  status: BatchStatus
  period_start: string | null
  period_end: string | null
  director_name: string | null
  notes: string | null
  submitted_at: string | null
  decided_at: string | null
  closed_at: string | null
  can_director_decide: boolean | null
}

// item de get_approval_batch_detail.
export type BatchItem = {
  id: string
  payment_request_id: string | null
  request_number: string | null
  provider_name: string | null
  cost_center: string | null
  budget_category: string | null
  payment_method: string | null
  amount: number | null
  currency: string | null
  requester_name: string | null
  company_name?: string | null
  director_status: ItemDecisionStatus
  reject_reason: string | null
  rebatch_status: RebatchStatus
  rebatch_release_note: string | null
  resubmission_note: string | null
  review_sequence: number | null
  previous_item_id: string | null
  previous_reject_reason: string | null
  previous_batch_label: string | null
  previous_rejected_at: string | null
  previous_correction_note: string | null
}

export type BatchDetail = { batch: BatchDetailBatch | null; items: BatchItem[] }

// Fila de list_batch_eligible_requests (elegibles y no elegibles vienen juntas).
export type EligibleRequest = {
  id: string
  request_number: string | null
  provider_name: string | null
  cost_center: string | null
  budget_category: string | null
  payment_method: string | null
  amount: number | null
  currency: string | null
  requester_name: string | null
  budget_available: number | null
  origin: 'new' | 'resubmission' | 'material_change_review' | null
  review_sequence: number | null
  previous_reject_reason: string | null
  previous_correction_note: string | null
  previous_batch_label: string | null
  eligible: boolean | null
  classification: string | null
  classification_reason: string | null
  budget_reason: string | null
  missing_fields: string[] | null
}

export type Company = { id: string; name: string | null; legal_name: string | null; active: boolean | null }

// Fila de list_company_directors (pool de directores para cortes futuros).
export type DirectorRow = {
  company_id: string | null
  director_profile_id: string
  director_name: string | null
  director_email: string | null
  active: boolean | null
  director_profile_active: boolean | null
  director_role_valid: boolean | null
  director_membership_active: boolean | null
}

// Fila de list_approval_batch_director_candidates.
export type DirectorCandidate = {
  profile_id: string
  name: string | null
  email: string | null
  roles: string[] | null
  assigned_active: boolean | null
}

// Fila de list_extraordinary_regularizations.
export type Regularization = {
  authorization_id: string
  request_number: string | null
  amount: number | null
  currency: string | null
  category: string | null
  status: string | null
  consumed_at: string | null
  ratification_due_at: string | null
  can_decide: boolean | null
}

export type RegularizationDecision = 'ratify' | 'dispute'

// Respuesta de preview_approval_batch_close.
export type ClosePreviewItem = {
  request_number: string | null
  reason?: string | null
  amount?: number | null
  currency?: string | null
}

export type ClosePreview = {
  can_close: boolean | null
  ready_count: number | null
  blocked_count: number | null
  pending_count: number | null
  ready_items: ClosePreviewItem[] | null
  blocked_items: ClosePreviewItem[] | null
}

export type BatchDecision = {
  item_id: string
  status: 'approved' | 'rejected'
  reject_reason: string | null
}

// Estado local por ítem mientras Dirección captura decisiones.
export type DecisionDraft = { status: '' | 'approved' | 'rejected'; reason: string }

export type CreateBatchInput = {
  companyId: string
  label: string | null
  periodStart: string
  periodEnd: string
  directorId: string
  notes: string | null
}

export type AddingProgress = { current: number; total: number } | null
