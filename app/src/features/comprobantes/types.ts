// Migración a React de comprobantes_batch.html (vinculación 1:1 comprobante ↔ solicitud).
export type BatchCapabilities = {
  can_ingest?: boolean
  can_review?: boolean
  can_match?: boolean
  can_link?: boolean
}

export type BatchContext = {
  allowed?: boolean
  can_access?: boolean
  block_reason?: string | null
  companies?: { id: string; legal_name?: string | null; name?: string | null }[]
  capabilities?: BatchCapabilities
  upload_policy?: { max_pages?: number; max_file_bytes?: number }
} & BatchCapabilities

export type BatchListItem = {
  id: string
  batch_number: string | null
  public_folio: string | null
  company_name: string | null
  original_file_name: string | null
  created_at: string | null
  batch_status?: string | null
  status?: string | null
}

export type BatchOperation = {
  extraction_id?: string | null
  extraction_status?: string | null
  extraction_updated_at?: string | null
  rejection_reason?: string | null
  bank_operation_id?: string | null
  operation_status?: string | null
  status?: string | null
  reconciliation_status?: string | null
  source_page?: number | null
  page_number?: number | null
  application_date?: string | null
  operation_date?: string | null
  bank_unique_folio?: string | null
  bank_reference?: string | null
  beneficiary_name?: string | null
  payment_reason?: string | null
  concept?: string | null
  amount_minor?: number | string | null
  amount?: string | null
  currency?: string | null
  review_issues?: string[] | null
}

export type BatchDetail = {
  batch?: Record<string, unknown> | null
  ingestion_batch?: Record<string, unknown> | null
  document?: Record<string, unknown> | null
  documents?: Record<string, unknown>[] | null
  operations?: BatchOperation[] | null
  bank_operations?: BatchOperation[] | null
  extractions?: BatchOperation[] | null
  events?: { label?: string | null; event_type?: string | null; actor_name?: string | null; created_at?: string | null }[] | null
}

export type LinkEvidence = {
  id?: string | null
  evidence_id?: string | null
  status?: string | null
  storage_bucket?: string | null
  storage_path?: string | null
}

export type LinkPreview = {
  operation_id?: string | null
  evidence?: LinkEvidence | null
  link?: {
    id?: string | null
    request_number?: string | null
    payment_request_id?: string | null
    amount_minor?: number | string | null
    currency?: string | null
    payment_date?: string | null
    reference_hint?: string | null
    evidence_id?: string | null
  } | null
}

export type ReceiptCandidate = {
  payment_request_id: string
  request_number: string | null
  proveedor_name: string | null
  concept: string | null
  amount_minor: number | string | null
  currency: string | null
  account_match: boolean
}

export type CreateBatchResult = {
  batch_id?: string
  document_id?: string
  storage_bucket?: string
  storage_path?: string
  duplicate?: boolean
  status?: string
  batch_number?: string | null
  public_folio?: string | null
}

// Recibo individual derivado en el navegador (1 página, sha256 verificado).
export type IndividualReceipt = {
  extractionId: string
  bytes: Uint8Array
  blobUrl: string
  pageCount: number
  sha256: string
}
