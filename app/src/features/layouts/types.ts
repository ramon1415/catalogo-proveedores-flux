// Tipos de la sección Layouts de pago. Subset de columnas que consume la pantalla,
// portado 1:1 de layouts.js + extensiones (layouts_result / layouts_ux2).

export type LayoutStatus = 'draft' | 'generated' | 'uploaded' | 'confirmed' | 'paid' | 'cancelled'
export type LineStatus = 'included' | 'paid' | 'bank_rejected' | 'cancelled'

// Fila de la tabla principal (SELECT de payment_layouts en loadLayouts()).
export type PaymentLayout = {
  id: string
  layout_number: string | null
  name: string | null
  period_start: string | null
  period_end: string | null
  status: LayoutStatus | string | null
  generated_by: string | null
  generated_at: string | null
  storage_path: string | null
  file_name: string | null
  company_count: number | null
  payment_count: number | null
  total_amount: number | null
  created_at: string | null
  updated_at: string | null
}

// Línea del layout (SELECT de payment_layout_lines en fetchLayoutLines()).
export type PaymentLayoutLine = {
  id: string
  layout_id: string | null
  payment_request_id: string | null
  company_id: string | null
  proveedor_id: string | null
  company_bank_account_id: string | null
  source_account_number: string | null
  company_name: string | null
  destination_type: string | null
  destination_value: string | null
  convenio_number: string | null
  beneficiary_name: string | null
  amount: number | null
  payment_reference: string | null
  payment_concept: string | null
  request_number: string | null
  status: LineStatus | string | null
  bank_rejection_reason: string | null
  created_at: string | null
  updated_at: string | null
}

export type LayoutCompany = {
  id: string
  name: string | null
  legal_name: string | null
  active: boolean | null
}

export type CompanyBankAccount = {
  id: string
  name: string | null
  bank_name: string | null
  account_number: string | null
  last4: string | null
  company_id: string | null
  active: boolean | null
}

// Formatos BBVA soportados.
export type BbvaFormat = 'same_bank' | 'interbank' | 'cie'

// Fila de la vista previa de elegibilidad (RPC preview_payment_layout_eligibility).
export type PreviewRow = {
  payment_request_id: string
  request_number?: string | null
  company_id?: string | null
  company_name?: string | null
  provider_name?: string | null
  proveedor_id?: string | null
  amount?: number | null
  currency?: string | null
  classification?: string | null
  source_batch_id?: string | null
  source_batch_label?: string | null
  source_batch_status?: string | null
  source_item_id?: string | null
  extraordinary_category?: string | null
  extraordinary_reason?: string | null
  extraordinary_authorized_by_name?: string | null
  extraordinary_authorized_at?: string | null
  reject_reason?: string | null
  rejected_at?: string | null
  rejected_by_name?: string | null
  latest_correction_note?: string | null
  rebatch_status?: string | null
  target_batch_id?: string | null
  target_batch_label?: string | null
  target_batch_status?: string | null
  missing_fields?: string[] | null
  // Datos de solicitud usados por el diálogo de completado.
  company_bank_account_id?: string | null
  payment_reference?: string | null
  payment_concept?: string | null
  scheduled_payment_date?: string | null
  destination_type?: string | null
  destination_value?: string | null
  beneficiary_name?: string | null
  direction_approval_current?: boolean | null
}

export type EligibilityPreview = Record<string, PreviewRow[] | undefined> & {
  ready_regular?: PreviewRow[]
  ready_extraordinary?: PreviewRow[]
  legacy_eligible?: PreviewRow[]
  rejected_by_direction?: PreviewRow[]
  pending_finance_close?: PreviewRow[]
  pending_director?: PreviewRow[]
  direction_reapproval_required?: PreviewRow[]
  invalid_data?: PreviewRow[]
}

export type PreviewParams = {
  p_period_start: string
  p_period_end: string
  p_company_id: string | null
  p_company_bank_account_id: string | null
}

export type InvalidRequest = {
  payment_request_id?: string | null
  request_number?: string | null
  missing_fields?: string[] | string | null
}

// Resultado del RPC create_payment_layout.
export type CreateLayoutResult = {
  layout_id?: string | null
  layout_number?: string | null
  payment_count?: number | null
  invalid_count?: number | null
  invalid_requests?: InvalidRequest[] | null
  company_count?: number | null
  total_amount?: number | null
  message?: string | null
  ready_regular_count?: number | null
  legacy_count?: number | null
  extraordinary_count?: number | null
  rejected_count?: number | null
  pending_close_count?: number | null
  direction_reapproval_count?: number | null
}

// Diagnóstico "aprobadas no consideradas" (layouts_result_extension).
export type NotIncludedItem = {
  request: {
    id?: string | null
    request_number?: string | null
    request_type?: string | null
    status?: string | null
    company_id?: string | null
    company_bank_account_id?: string | null
    scheduled_payment_date?: string | null
    updated_at?: string | null
    currency?: string | null
    amount_requested?: number | null
  }
  reasons: string[]
}

export type FinanceBatch = { id: string; label: string; company_id: string | null; status?: string | null }

// Resumen por formato (summarizeLayoutFormats).
export type FormatSummaryItem = {
  key: string
  label: string
  count: number
  amount: number
  referenceIssues: number
  validationIssues: number
}
export type FormatSummary = Record<string, FormatSummaryItem>

// Resultado de construir un archivo BBVA (buildBbvaLayoutFiles).
export type LayoutValidation = {
  ok: boolean
  errors: string[]
  lines: string[]
  lineCount: number
  lineLengths: number[]
  hasFinalTerminator: boolean
  hasDoubleFinalTerminator: boolean
  byteLength: number
}
export type BbvaFile = {
  format: BbvaFormat
  label: string
  fileName: string
  content: string
  validation: LayoutValidation
  lineLength: number
}

export type InvalidLine = {
  line_id: string
  payment_request_id: string | null
  request_number: string | null
  missing_fields: string[]
}
