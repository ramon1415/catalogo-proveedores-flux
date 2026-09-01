// Espejo 1:1 de las llamadas Supabase de approval_batches.js (vanilla).
// Cada función lanza el error crudo para que la UI lo traduzca con friendlyError.
import { supabase } from '../../lib/supabase'
import type {
  BatchDecision, BatchDetail, BatchListRow, BatchView, ClosePreview, Company,
  CreateBatchInput, DirectorCandidate, DirectorRow, EligibleRequest, Regularization,
} from './types'

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

// Query directa a companies (solo Finanzas). Con empresa activa, se acota a ella.
export async function listActiveCompanies(activeCompanyId: string | null): Promise<Company[]> {
  let query = supabase.from('companies').select('id,name,legal_name,active').eq('active', true)
  if (activeCompanyId) query = query.eq('id', activeCompanyId)
  const { data, error } = await query.order('name')
  if (error) throw error
  return asArray<Company>(data)
}

export async function listCompanyDirectors(companyId: string | null): Promise<DirectorRow[]> {
  const { data, error } = await supabase.rpc('list_company_directors', { p_company_id: companyId })
  if (error) throw error
  return asArray<DirectorRow>(data)
}

export async function listDirectorCandidates(companyId: string | null): Promise<DirectorCandidate[]> {
  const { data, error } = await supabase.rpc('list_approval_batch_director_candidates', { p_company_id: companyId })
  if (error) throw error
  return asArray<DirectorCandidate>(data)
}

// La vista decide la RPC; p_status: null trae todos los estatus (filtro client-side).
export async function listBatches(view: BatchView): Promise<BatchListRow[]> {
  const rpc = view === 'finance' ? 'list_finance_approval_batches' : 'list_director_approval_batches'
  const { data, error } = await supabase.rpc(rpc, { p_status: null })
  if (error) throw error
  return asArray<BatchListRow>(data)
}

export async function listRegularizations(companyId: string | null): Promise<Regularization[]> {
  const { data, error } = await supabase.rpc('list_extraordinary_regularizations', { p_company_id: companyId })
  if (error) throw error
  return asArray<Regularization>(data)
}

export async function getBatchDetail(batchId: string): Promise<BatchDetail> {
  const { data, error } = await supabase.rpc('get_approval_batch_detail', { p_batch_id: batchId })
  if (error) throw error
  const r = (data && typeof data === 'object' ? data : {}) as Partial<BatchDetail>
  return { batch: r.batch ?? null, items: asArray(r.items) }
}

// Solo Finanzas + corte en borrador (el llamador aplica el gating).
export async function listBatchEligibleRequests(companyId: string | null): Promise<EligibleRequest[]> {
  const { data, error } = await supabase.rpc('list_batch_eligible_requests', { p_company_id: companyId })
  if (error) throw error
  return asArray<EligibleRequest>(data)
}

// Acceso a evidencia extraordinaria: la RPC entrega bucket/path/ttl y Storage firma la URL.
export async function getRegularizationEvidenceUrl(authorizationId: string): Promise<string> {
  const { data: access, error: accessError } = await supabase.rpc(
    'get_extraordinary_authorization_evidence_access',
    { p_authorization_id: authorizationId },
  )
  if (accessError) throw accessError
  const { data: signed, error: signedError } = await supabase.storage
    .from(access.storage_bucket)
    .createSignedUrl(access.storage_path, Number(access.url_ttl_seconds || 120))
  if (signedError) throw signedError
  return signed.signedUrl
}

export async function previewBatchClose(batchId: string): Promise<ClosePreview> {
  const { data, error } = await supabase.rpc('preview_approval_batch_close', { p_batch_id: batchId })
  if (error) throw error
  return (data && typeof data === 'object' ? data : {}) as ClosePreview
}

export async function createApprovalBatch(input: CreateBatchInput): Promise<{ batch_id?: string; label?: string }> {
  const { data, error } = await supabase.rpc('create_approval_batch', {
    p_company_id: input.companyId,
    p_label: input.label,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_director_id: input.directorId,
    p_notes: input.notes,
  })
  if (error) throw error
  return (data && typeof data === 'object' ? data : {}) as { batch_id?: string; label?: string }
}

export async function addRequestToBatch(batchId: string, paymentRequestId: string): Promise<void> {
  const { error } = await supabase.rpc('add_request_to_approval_batch', {
    p_batch_id: batchId,
    p_payment_request_id: paymentRequestId,
  })
  if (error) throw error
}

export async function removeRequestFromBatch(batchId: string, itemId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_request_from_approval_batch', {
    p_batch_id: batchId,
    p_item_id: itemId,
  })
  if (error) throw error
}

export async function submitApprovalBatch(batchId: string): Promise<void> {
  const { error } = await supabase.rpc('submit_approval_batch', { p_batch_id: batchId })
  if (error) throw error
}

export async function decideApprovalBatchItems(batchId: string, decisions: BatchDecision[]): Promise<void> {
  const { error } = await supabase.rpc('decide_approval_batch_items', {
    p_batch_id: batchId,
    p_decisions: decisions,
  })
  if (error) throw error
}

export async function approveEntireBatch(batchId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_entire_batch', { p_batch_id: batchId })
  if (error) throw error
}

export async function closeApprovalBatch(batchId: string): Promise<{ approved_released_count?: number; blocked_count?: number }> {
  const { data, error } = await supabase.rpc('close_approval_batch', { p_batch_id: batchId })
  if (error) throw error
  return (data && typeof data === 'object' ? data : {}) as { approved_released_count?: number; blocked_count?: number }
}

export async function releaseAndRebatchRejectedRequest(params: {
  rejectedItemId: string
  correctionNote: string
  targetBatchId: string | null
}): Promise<{ new_item_id?: string }> {
  const { data, error } = await supabase.rpc('release_and_rebatch_rejected_request', {
    p_rejected_item_id: params.rejectedItemId,
    p_correction_note: params.correctionNote,
    p_target_batch_id: params.targetBatchId,
  })
  if (error) throw error
  return (data && typeof data === 'object' ? data : {}) as { new_item_id?: string }
}

export async function addCompanyDirector(companyId: string, directorProfileId: string): Promise<{ changed?: boolean }> {
  const { data, error } = await supabase.rpc('add_company_director_for_future_batches', {
    p_company_id: companyId,
    p_director_profile_id: directorProfileId,
  })
  if (error) throw error
  return (data && typeof data === 'object' ? data : {}) as { changed?: boolean }
}

export async function removeCompanyDirector(companyId: string, directorProfileId: string): Promise<{ changed?: boolean }> {
  const { data, error } = await supabase.rpc('remove_company_director_for_future_batches', {
    p_company_id: companyId,
    p_director_profile_id: directorProfileId,
  })
  if (error) throw error
  return (data && typeof data === 'object' ? data : {}) as { changed?: boolean }
}

// ratify usa p_note (opcional, null si vacía); dispute usa p_reason (obligatoria).
export async function decideRegularization(params: {
  authorizationId: string
  decision: 'ratify' | 'dispute'
  idempotencyKey: string
  note: string
}): Promise<void> {
  const rpc = params.decision === 'dispute'
    ? 'dispute_extraordinary_authorization'
    : 'ratify_extraordinary_authorization'
  const args = {
    p_authorization_id: params.authorizationId,
    p_idempotency_key: params.idempotencyKey,
    ...(params.decision === 'dispute' ? { p_reason: params.note } : { p_note: params.note || null }),
  }
  const { error } = await supabase.rpc(rpc, args)
  if (error) throw error
}
