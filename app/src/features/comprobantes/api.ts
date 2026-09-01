import { supabase } from '../../lib/supabase'
import type {
  BatchContext, BatchListItem, BatchDetail, LinkPreview, ReceiptCandidate,
  CreateBatchResult, LinkEvidence,
} from './types'

// ── Idempotencia (espejo de rpcIdempotent del vanilla) ─────────────────────
// La misma clave se reutiliza en reintentos del mismo comando hasta que la
// RPC tenga éxito; PGRST202 (contrato ausente) reintenta con backoff.
const commandKeys = new Map<string, string>()

export function commandId(): string {
  if (!crypto?.randomUUID) throw new Error('secure_id_unavailable')
  return crypto.randomUUID()
}

async function rpcIdempotent<T>(scope: string, targetId: string, rpcName: string, args: Record<string, unknown>): Promise<T> {
  const key = `${scope}:${targetId}`
  const idempotencyKey = commandKeys.get(key) ?? commandId()
  commandKeys.set(key, idempotencyKey)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabase.rpc(rpcName, { ...args, p_idempotency_key: idempotencyKey })
    if (!error) {
      commandKeys.delete(key)
      return data as T
    }
    if ((error as { code?: string }).code !== 'PGRST202') throw error
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
  }
  throw new Error('rpc_retry_exhausted')
}

// ── Contexto y listas ──────────────────────────────────────────────────────
export async function getBatchContext(): Promise<BatchContext> {
  const { data, error } = await supabase.rpc('get_payment_batch_context')
  if (error) throw error
  return (data ?? {}) as BatchContext
}

export async function listBatches(companyId: string | null): Promise<BatchListItem[]> {
  const { data, error } = await supabase.rpc('list_payment_ingestion_batches', {
    p_company_id: companyId,
    p_status: null,
    p_limit: 50,
  })
  if (error) throw error
  const items = (data as { items?: BatchListItem[] })?.items ?? data
  return Array.isArray(items) ? items : []
}

export async function getBatchDetail(batchId: string): Promise<BatchDetail> {
  const { data, error } = await supabase.rpc('get_payment_ingestion_batch_detail', { p_batch_id: batchId })
  if (error) throw error
  return (data ?? {}) as BatchDetail
}

export async function getLinkPreview(operationId: string): Promise<LinkPreview> {
  const { data, error } = await supabase.rpc('get_payment_receipt_link_preview', { p_operation_id: operationId })
  if (error) throw error
  return (data ?? {}) as LinkPreview
}

// ── Revisión / evidencia ───────────────────────────────────────────────────
export async function acceptExtraction(extractionId: string, expectedUpdatedAt: string | null): Promise<{ operation_id?: string }> {
  return rpcIdempotent('extraction.accept', extractionId, 'accept_payment_document_extraction', {
    p_extraction_id: extractionId,
    p_expected_updated_at: expectedUpdatedAt,
  })
}

export async function prepareEvidence(operationId: string): Promise<LinkEvidence> {
  return rpcIdempotent('evidence.prepare', operationId, 'prepare_payment_operation_evidence', {
    p_operation_id: operationId,
  })
}

export async function finalizeEvidence(evidenceId: string, sha256: string, sizeBytes: number): Promise<LinkEvidence> {
  return rpcIdempotent('evidence.finalize', evidenceId, 'finalize_payment_operation_evidence', {
    p_evidence_id: evidenceId,
    p_derived_sha256: sha256,
    p_file_size_bytes: sizeBytes,
    p_page_count: 1,
  })
}

export async function reviewEvidence(evidenceId: string): Promise<LinkEvidence> {
  return rpcIdempotent('evidence.review', evidenceId, 'review_payment_operation_evidence', {
    p_evidence_id: evidenceId,
    p_shareable: true,
    p_single_operation_attested: true,
    p_reason: 'Datos y comprobante individual revisados por Finanzas',
  })
}

export async function getEvidenceAccess(evidenceId: string): Promise<{ storage_bucket?: string; storage_path?: string }> {
  const { data, error } = await supabase.rpc('get_payment_operation_evidence_access', { p_evidence_id: evidenceId })
  if (error) throw error
  return (data ?? {}) as { storage_bucket?: string; storage_path?: string }
}

// ── Matching / vinculación ─────────────────────────────────────────────────
export async function findReceiptCandidates(operationId: string): Promise<ReceiptCandidate[]> {
  const { data, error } = await supabase.rpc('find_payment_receipt_candidates', {
    p_operation_id: operationId,
    p_limit: 20,
  })
  if (error) throw error
  const items = (data as { items?: ReceiptCandidate[] })?.items ?? data
  return Array.isArray(items) ? items : []
}

export async function linkReceiptToRequest(operationId: string, paymentRequestId: string): Promise<{ request_number?: string }> {
  return rpcIdempotent(`receipt.link`, `${operationId}:${paymentRequestId}`, 'link_payment_receipt_to_request', {
    p_operation_id: operationId,
    p_payment_request_id: paymentRequestId,
  })
}

// ── Corrección / rechazo ───────────────────────────────────────────────────
export async function correctExtraction(params: {
  extractionId: string
  expectedUpdatedAt: string | null
  applicationDate: string
  amountMinor: number
  currency: string
  bankUniqueFolio: string
  beneficiaryName: string
  paymentReason: string
  reason: string
}): Promise<void> {
  await rpcIdempotent('extraction.correct', params.extractionId, 'correct_payment_document_extraction', {
    p_extraction_id: params.extractionId,
    p_expected_updated_at: params.expectedUpdatedAt,
    p_application_date: params.applicationDate,
    p_amount_minor: params.amountMinor,
    p_currency: params.currency.trim().toUpperCase(),
    p_bank_unique_folio: params.bankUniqueFolio.trim().toUpperCase(),
    p_beneficiary_name: params.beneficiaryName.trim(),
    p_payment_reason: params.paymentReason.trim(),
    p_reason: params.reason.trim(),
  })
}

export async function rejectExtraction(extractionId: string, expectedUpdatedAt: string | null, reason: string): Promise<void> {
  await rpcIdempotent('extraction.reject', extractionId, 'reject_payment_document_extraction', {
    p_extraction_id: extractionId,
    p_expected_updated_at: expectedUpdatedAt,
    p_reason: reason,
  })
}

// ── Ingesta ────────────────────────────────────────────────────────────────
export async function createBatch(params: {
  companyId: string
  fileName: string
  fileSizeBytes: number
  sha256: string
}): Promise<CreateBatchResult> {
  const { data, error } = await supabase.rpc('create_payment_ingestion_batch', {
    p_company_id: params.companyId,
    p_file_name: params.fileName,
    p_file_size_bytes: params.fileSizeBytes,
    p_document_sha256: params.sha256,
    p_idempotency_key: commandId(),
  })
  if (error) throw error
  return (data ?? {}) as CreateBatchResult
}

export async function finalizeBatchUpload(batchId: string, pageCount: number): Promise<{ error: unknown | null }> {
  const { error } = await supabase.rpc('finalize_payment_ingestion_upload', {
    p_batch_id: batchId,
    p_page_count: pageCount,
    p_idempotency_key: commandId(),
  })
  return { error }
}

export async function submitExtractions(batchId: string, parserVersion: string, pages: Record<string, unknown>[]): Promise<void> {
  const { error } = await supabase.rpc('submit_payment_document_extractions', {
    p_batch_id: batchId,
    p_parser_version: parserVersion,
    p_pages: pages,
    p_idempotency_key: commandId(),
  })
  if (error) throw error
}

// ── Storage con token de sesión ────────────────────────────────────────────
export async function privateBucket(bucketId: string) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('storage_session_unavailable')
  return supabase.storage.from(bucketId)
}

// Nombre de descarga: {folio}_{proveedor}_Comprobante.pdf
export async function evidenceFilenameParts(paymentRequestId: string): Promise<{ requestNumber: string | null; providerName: string | null }> {
  const { data: request } = await supabase
    .from('payment_requests').select('request_number,proveedor_id').eq('id', paymentRequestId).maybeSingle()
  if (!request) return { requestNumber: null, providerName: null }
  let providerName: string | null = null
  if (request.proveedor_id) {
    const { data: provider } = await supabase
      .from('proveedores').select('alias,nombre_completo').eq('id', request.proveedor_id).maybeSingle()
    providerName = provider?.alias || provider?.nombre_completo || null
  }
  return { requestNumber: request.request_number ?? null, providerName }
}
