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
