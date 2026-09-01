import { supabase } from '../../lib/supabase'
import { activeRows } from './logic'
import type {
  PaymentRequest, Company, CostCenter, BudgetCategory, Proveedor,
  BudgetAvailabilityRow, ApproverCandidate, ApprovalHistoryRow, PaymentReceiptRow,
  IncidentCharge, Profile, ExecutionContext, RequestSummary, RequestPayload,
  EditPayload, DecisionAction, CashFund,
} from './types'

// Bucket de comprobantes/adjuntos (igual a upload_helper.js), TTL firmado 3600.
const UPLOAD_BUCKET = 'payment-receipts'

const PAYMENT_REQUEST_COLUMNS =
  'id,request_number,proveedor_id,company_id,cost_center_id,budget_category_id,budget_month,amount_requested,currency,exchange_rate,status,description,notes,requested_by,approver_id,submitted_at,budget_decision,budget_block_reason,budget_available_before,budget_available_after,budget_shortfall,budget_checked_at,budget_result,is_extraordinary_adjustment,exception_status,exception_action,exception_reason,exception_approved_by,exception_approved_at,requires_budget_adjustment,operational_comments,invoice_storage_path,created_at,updated_at'

// ── Cargas iniciales (paralelas) ──────────────────────────────────────────
export async function loadCompanies(): Promise<Company[]> {
  const { data, error } = await supabase.from('companies').select('*').order('name', { ascending: true })
  if (error) throw error
  return activeRows((data ?? []) as Company[])
}

export async function loadCostCenters(): Promise<CostCenter[]> {
  const { data, error } = await supabase.from('cost_centers').select('*').order('name', { ascending: true })
  if (error) throw error
  return activeRows((data ?? []) as CostCenter[])
}

export async function loadBudgetCategories(): Promise<BudgetCategory[]> {
  const { data, error } = await supabase.from('budget_categories').select('*').order('code', { ascending: true })
  if (error) throw error
  return activeRows((data ?? []) as BudgetCategory[])
}

export async function loadProveedores(): Promise<Proveedor[]> {
  const { data, error } = await supabase
    .from('proveedores')
    .select('id,alias,nombre_completo,rfc,banco,clabe,cuenta_bancaria,metodo_pago,activo')
    .eq('activo', true)
    .order('alias', { ascending: true })
  if (error) throw error
  return (data ?? []) as Proveedor[]
}

export async function loadProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('id,full_name,email')
  if (error) return []
  return (data ?? []) as Profile[]
}

export async function loadPaymentRequests(): Promise<PaymentRequest[]> {
  const { data, error } = await supabase
    .from('payment_requests')
    .select(PAYMENT_REQUEST_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PaymentRequest[]
}

// Lee metadata Fase 2 (request_type/payment_method) por número de folio.
export async function loadFase2Metadata(
  requestNumbers: string[],
): Promise<Map<string, { request_type: string | null; payment_method: string | null }>> {
  if (!requestNumbers.length) return new Map()
  const { data, error } = await supabase
    .from('payment_requests')
    .select('request_number,request_type,payment_method')
    .in('request_number', requestNumbers)
  if (error) return new Map()
  return new Map((data ?? []).map((row: any) => [row.request_number, { request_type: row.request_type, payment_method: row.payment_method }]))
}

// ── Disponibilidad presupuestal ────────────────────────────────────────────
export async function loadBudgetAvailability(
  companyId: string,
  costCenterId: string,
  budgetMonth: string,
): Promise<BudgetAvailabilityRow[]> {
  const [availRes, relRes] = await Promise.all([
    supabase
      .from('budget_availability')
      .select('*')
      .eq('company_id', companyId)
      .eq('cost_center_id', costCenterId)
      .eq('budget_month', budgetMonth),
    // Responsable por partida (scoping "solo el responsable ve su partida").
    supabase
      .from('company_cost_center_budget_categories')
      .select('budget_category_id, responsible_email')
      .eq('company_id', companyId)
      .eq('cost_center_id', costCenterId),
  ])
  if (availRes.error) throw availRes.error
  if (relRes.error) throw relRes.error
  const respByCat = new Map(
    (relRes.data ?? []).map((r: { budget_category_id: string; responsible_email: string | null }) => [r.budget_category_id, r.responsible_email]),
  )
  return (availRes.data ?? []).map((r) => ({
    ...(r as BudgetAvailabilityRow),
    responsible_email: respByCat.get((r as { budget_category_id: string }).budget_category_id) ?? null,
  }))
}

// ── Aprobadores ────────────────────────────────────────────────────────────
export async function listApproverOptions(
  companyId: string,
  costCenterId: string,
  amount: number,
): Promise<ApproverCandidate[]> {
  const { data, error } = await supabase.rpc('list_payment_request_approver_options', {
    p_company_id: companyId,
    p_cost_center_id: costCenterId,
    p_amount: amount,
  })
  if (error) throw error
  return Array.isArray(data) ? (data as ApproverCandidate[]) : []
}

export async function getApproverDetails(paymentRequestId: string): Promise<any | null> {
  const { data, error } = await supabase.rpc('get_payment_request_approver_details', {
    p_payment_request_id: paymentRequestId,
  })
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

// ── Crear solicitud ────────────────────────────────────────────────────────
export async function createPaymentRequest(payload: RequestPayload): Promise<any> {
  const { data, error } = await supabase.rpc('create_payment_request', {
    p_proveedor_id: payload.proveedor_id,
    p_company_id: payload.company_id,
    p_cost_center_id: payload.cost_center_id,
    p_budget_category_id: payload.budget_category_id,
    p_budget_month: payload.budget_month,
    p_amount_requested: payload.amount_requested,
    p_currency: payload.currency,
    p_exchange_rate: payload.exchange_rate,
    p_description: payload.description,
    p_notes: payload.notes,
    p_requested_by: payload.requested_by,
    p_is_extraordinary_adjustment: payload.is_extraordinary_adjustment,
    p_approver_id: payload.approver_id,
    p_approver_assignment_id: payload.approver_assignment_id,
    p_subtotal_amount: payload.subtotal_amount,
    p_tax_amount: payload.tax_amount,
    p_withholding_amount: payload.withholding_amount,
  })
  if (error) throw error
  return data
}

// Guarda metadata Fase 2 (request_type/payment_method). Devuelve un warning si
// falta la columna en el ambiente (migración 004c), sin lanzar.
export async function updateFase2Metadata(
  requestId: string,
  requestType: string,
  paymentMethod: string,
): Promise<string> {
  try {
    const { error } = await supabase
      .from('payment_requests')
      .update({ request_type: requestType, payment_method: paymentMethod, updated_at: new Date().toISOString() })
      .eq('id', requestId)
    if (!error) return ''
    if (isMissingFase2ColumnError(error)) return 'La solicitud se creo, pero el metodo de pago quedo pendiente de guardarse en este ambiente.'
    return `La solicitud se creo, pero no se pudo guardar la metadata de Fase 2.`
  } catch (error) {
    if (isMissingFase2ColumnError(error)) return 'La solicitud se creo, pero el metodo de pago quedo pendiente de guardarse en este ambiente.'
    return 'La solicitud se creo, pero no se pudo guardar la metadata de Fase 2.'
  }
}

function isMissingFase2ColumnError(error: any): boolean {
  const message = String(error?.message || error || '').toLowerCase()
  const code = String(error?.code || '').toUpperCase()
  return code === 'PGRST204' || message.includes('schema cache') || message.includes('payment_method') || message.includes('request_type')
}

// ── Alta rápida de proveedor (fase2 quick provider) ───────────────────────
export async function quickCreateProvider(payload: Record<string, unknown>): Promise<Proveedor> {
  const { data, error } = await supabase
    .from('proveedores')
    .insert(payload)
    .select('id,alias,nombre_completo,rfc,banco,clabe,cuenta_bancaria,metodo_pago,activo')
    .maybeSingle()
  if (error) throw error
  return data as Proveedor
}

// ── Edición de solicitud ───────────────────────────────────────────────────
export async function updatePaymentRequest(id: string, payload: EditPayload): Promise<void> {
  const { error } = await supabase.from('payment_requests').update(payload).eq('id', id)
  if (error) throw error
}

// ── Decisión del aprobador ─────────────────────────────────────────────────
export async function decidePaymentRequest(
  paymentRequestId: string,
  actorProfileId: string,
  action: DecisionAction,
  comments: string | null,
): Promise<any> {
  const { data, error } = await supabase.rpc('decide_payment_request', {
    p_payment_request_id: paymentRequestId,
    p_actor_profile_id: actorProfileId,
    p_action: action,
    p_comments: comments,
  })
  if (error) throw error
  return data
}

export async function loadApprovalHistory(paymentRequestId: string): Promise<ApprovalHistoryRow[]> {
  const { data, error } = await supabase
    .from('payment_request_approvals')
    .select('id,action,from_status,to_status,comments,approval_level,created_at,actor_profile_id,role_id')
    .eq('payment_request_id', paymentRequestId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ApprovalHistoryRow[]
}

export async function loadPaymentReceipts(paymentRequestId: string): Promise<PaymentReceiptRow[]> {
  const { data, error } = await supabase
    .from('payment_receipts')
    .select('id,layout_id,payment_date,amount,bank_reference,storage_path,created_at')
    .eq('payment_request_id', paymentRequestId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PaymentReceiptRow[]
}

// ── Incidencias (detalle, canApprove) ──────────────────────────────────────
export async function loadIncidencias(): Promise<{ incidents: IncidentCharge[]; membersById: Map<string, string> }> {
  const [inc, members] = await Promise.all([
    supabase
      .from('incident_charges')
      .select('id,member_id,external_name,description,amount,incident_date,status')
      .order('incident_date', { ascending: false })
      .limit(100),
    supabase.from('members').select('id,full_name').eq('active', true),
  ])
  if (inc.error) throw inc.error
  const membersById = new Map<string, string>((members.data ?? []).map((m: any) => [m.id, m.full_name]))
  return { incidents: (inc.data ?? []) as IncidentCharge[], membersById }
}

export async function updateRequestNotes(id: string, notes: string | null): Promise<void> {
  const { error } = await supabase
    .from('payment_requests')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ── Contexto de ejecución / extraordinarios / fondo ────────────────────────
export async function getExecutionContext(requestId: string): Promise<ExecutionContext> {
  const { data, error } = await supabase.rpc('get_payment_request_execution_context', {
    p_payment_request_id: requestId,
  })
  if (error) throw error
  return (data ?? null) as ExecutionContext
}

// Resumen ligero de la solicitud para el panel de ejecución (batch_execution).
export async function loadRequestSummary(requestId: string): Promise<RequestSummary | null> {
  const { data: request, error } = await supabase
    .from('payment_requests')
    .select('id,request_number,company_id,proveedor_id,request_type,payment_method,amount_requested,currency,status')
    .eq('id', requestId)
    .maybeSingle()
  if (error || !request) return null

  const [companyResult, providerResult] = await Promise.all([
    request.company_id
      ? supabase.from('companies').select('name,legal_name').eq('id', request.company_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    request.proveedor_id
      ? supabase.from('proveedores').select('alias,nombre_completo').eq('id', request.proveedor_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
  ])
  const company = companyResult.data || {}
  const provider = providerResult.data || {}
  return {
    id: request.id,
    requestNumber: request.request_number,
    companyName: company.legal_name || company.name || 'Sin empresa',
    providerName: provider.alias || provider.nombre_completo || 'Sin proveedor',
    amount: request.amount_requested,
    currency: request.currency || 'MXN',
    paymentMethod: request.payment_method || request.request_type || '-',
    status: request.status,
  }
}

export async function loadExtraordinaryBadges(
  requestIds: string[],
): Promise<Map<string, { status: string }>> {
  if (!requestIds.length) return new Map()
  const { data, error } = await supabase
    .from('payment_request_extraordinary_authorizations')
    .select('payment_request_id,category,status,authorized_at')
    .in('payment_request_id', requestIds)
    .in('status', ['draft', 'active', 'consumed_pending_ratification', 'ratified', 'disputed'])
    .order('authorized_at', { ascending: true })
  if (error) return new Map()
  return new Map((data ?? []).map((row: any) => [row.payment_request_id, { status: row.status }]))
}

export async function beginExtraordinaryAuthorization(params: {
  requestId: string
  category: string
  reason: string
  directorId: string
  externalAuthorizedAt: string
  idempotencyKey: string
}): Promise<any> {
  const { data, error } = await supabase.rpc('begin_extraordinary_authorization', {
    p_payment_request_id: params.requestId,
    p_category: params.category,
    p_reason: params.reason,
    p_external_director_profile_id: params.directorId,
    p_external_authorized_at: new Date(params.externalAuthorizedAt).toISOString(),
    p_idempotency_key: params.idempotencyKey,
  })
  if (error) throw error
  return data
}

export async function uploadExtraordinaryEvidence(
  bucket: string,
  path: string,
  file: File,
  sha256: string,
): Promise<void> {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: false,
    metadata: { sha256 },
  } as any)
  if (error) throw error
}

export async function finalizeExtraordinaryAuthorization(params: {
  authorizationId: string
  evidenceType: string
  sha256: string
  mimeType: string
  sizeBytes: number
  idempotencyKey: string
}): Promise<any> {
  const { data, error } = await supabase.rpc('finalize_extraordinary_authorization', {
    p_authorization_id: params.authorizationId,
    p_evidence_type: params.evidenceType,
    p_evidence_sha256: params.sha256,
    p_evidence_mime_type: params.mimeType,
    p_evidence_size_bytes: params.sizeBytes,
    p_finance_attests_evidence_matches_request: true,
    p_idempotency_key: `${params.idempotencyKey}:finalize`,
  })
  if (error) throw error
  return data
}

export async function revokeExtraordinary(requestId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_payment_request_extraordinary', {
    p_payment_request_id: requestId,
    p_reason: reason,
  })
  if (error) throw error
}

// ── Comprobante de pago (payment_request_reconciliation_evidence) ──────────
export async function getReceiptSummary(paymentRequestId: string): Promise<any | null> {
  const { data, error } = await supabase.rpc('get_payment_request_receipt_summary', {
    p_payment_request_id: paymentRequestId,
  })
  if (error) return null
  return data
}

export async function getEvidenceAccess(evidenceId: string): Promise<{ storage_bucket: string; storage_path: string; url_ttl_seconds: number }> {
  const { data, error } = await supabase.rpc('get_payment_operation_evidence_access', { p_evidence_id: evidenceId })
  if (error) throw error
  return data
}

export async function createSignedUrl(bucket: string, path: string, ttl: number): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

// ── Fondo de efectivo (cash_flow_extension) ────────────────────────────────
export async function loadCashFund(requestId: string): Promise<CashFund | null> {
  const { data, error } = await supabase
    .from('cash_funds')
    .select('id,payment_request_id,responsible_profile_id,due_date,delivery_method,status,pending_amount,created_at')
    .eq('payment_request_id', requestId)
    .order('created_at', { ascending: false })
  if (error) return null
  return ((data ?? [])[0] as CashFund) || null
}

export async function verifyCashBlock(profileId: string): Promise<any> {
  const { data, error } = await supabase.rpc('verify_cash_block', { p_profile_id: profileId })
  if (error) throw error
  return data ?? {}
}

export async function createCashFund(params: {
  requestId: string
  responsibleProfileId: string
  dueDate: string
  deliveryMethod: string
  deliveredBy: string
  notes: string | null
}): Promise<any> {
  const { data, error } = await supabase.rpc('create_cash_fund', {
    p_payment_request_id: params.requestId,
    p_responsible_profile_id: params.responsibleProfileId,
    p_due_date: params.dueDate,
    p_delivery_method: params.deliveryMethod,
    p_delivered_by: params.deliveredBy,
    p_notes: params.notes,
  })
  if (error) throw error
  return data
}

// ── Storage: subir comprobante / obtener url firmada ───────────────────────
export async function uploadReceipt(file: File, folder: string): Promise<string> {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error(`Error al subir archivo: ${error.message}`)
  return path
}

export async function getReceiptUrl(storagePath: string): Promise<string | null> {
  return createSignedUrl(UPLOAD_BUCKET, storagePath, 3600)
}

export async function linkInvoicePath(requestId: string, storagePath: string): Promise<void> {
  const { error } = await supabase.from('payment_requests').update({ invoice_storage_path: storagePath }).eq('id', requestId)
  if (error) throw error
}
