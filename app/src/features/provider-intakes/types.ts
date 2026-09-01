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
