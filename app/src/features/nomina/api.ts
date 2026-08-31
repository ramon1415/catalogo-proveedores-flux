import { supabase } from '../../lib/supabase'
import { BUCKET } from './logic'
import type {
  ApproverCandidate,
  BankAccount,
  CompanyCostCenter,
  CostCenter,
  CaptureSession,
  FileSlotState,
  PayrollSlot,
  SavePayload,
  SubmissionSummary,
} from './types'

// ── Lecturas de contexto contable / cuentas ────────────────────────────────
// loadSourceAccounts() del vanilla: company_bank_accounts activas, tipo bank, MXN.
export async function loadSourceAccounts(companyId: string): Promise<BankAccount[]> {
  if (!companyId) return []
  const { data, error } = await supabase
    .from('company_bank_accounts')
    .select('id,company_id,name,bank_name,currency,account_type,last4,account_number,clabe,active')
    .eq('company_id', companyId)
    .eq('active', true)
    .eq('account_type', 'bank')
    .eq('currency', 'MXN')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as BankAccount[]
}

// loadAccountingScope() del vanilla: cost_centers activos + mapeos company_cost_centers.
export async function loadAccountingScope(companyId: string): Promise<{ costCenters: CostCenter[]; mappings: CompanyCostCenter[] }> {
  if (!companyId) return { costCenters: [], mappings: [] }
  const [centers, mappings] = await Promise.all([
    supabase.from('cost_centers').select('id,name,code,active').eq('active', true).order('name', { ascending: true }),
    supabase
      .from('company_cost_centers')
      .select('company_id,cost_center_id,active')
      .eq('company_id', companyId)
      .eq('active', true),
  ])
  if (centers.error) throw centers.error
  if (mappings.error) throw mappings.error
  return {
    costCenters: (centers.data ?? []) as CostCenter[],
    mappings: (mappings.data ?? []) as CompanyCostCenter[],
  }
}

// ── RPC 1: get_payroll_capture_sessions(p_session_id) ──────────────────────
export async function getCaptureSessions(sessionId: string | null = null): Promise<CaptureSession[]> {
  const { data, error } = await supabase.rpc('get_payroll_capture_sessions', { p_session_id: sessionId })
  if (error) throw error
  return Array.isArray(data) ? (data as CaptureSession[]) : []
}

// ── RPC 2: save_payroll_capture_session_n3g(...) ───────────────────────────
// Devuelve { id, version, cost_center_id, ... }.
export async function saveCaptureSession(payload: SavePayload): Promise<{ id: string; version: number }> {
  const { data, error } = await supabase.rpc('save_payroll_capture_session_n3g', {
    p_session_id: payload.sessionId,
    p_expected_version: payload.expectedVersion,
    p_company_id: payload.companyId,
    p_company_bank_account_id: payload.companyBankAccountId,
    p_cost_center_id: payload.costCenterId,
    p_payroll_subtype: payload.payrollSubtype,
    p_period_start: payload.periodStart,
    p_period_end: payload.periodEnd,
    p_concept: payload.concept,
    p_notes: payload.notes,
    p_expected_channels: payload.expectedChannels,
  })
  if (error) throw error
  return { id: (data as any).id as string, version: (data as any).version as number }
}

// ── RPC 3: reserve_payroll_capture_file(...) ───────────────────────────────
type Reservation = { file_id: string; storage_bucket: string; storage_path: string }

async function reserveFile(sessionId: string, expectedVersion: number, slot: PayrollSlot, fs: FileSlotState): Promise<Reservation> {
  const isSpei = slot === 'layout_spei'
  const summary = fs.parserSummary
  const { data, error } = await supabase.rpc('reserve_payroll_capture_file', {
    p_session_id: sessionId,
    p_expected_version: expectedVersion,
    p_kind: slot,
    p_extension: fs.extension,
    p_mime_type: fs.mimeType,
    p_size_bytes: fs.sizeBytes,
    p_sha256: fs.sha256,
    p_parser_version: isSpei ? summary?.parserVersion ?? null : null,
    p_parser_contract: isSpei ? summary?.contractVersion ?? null : null,
    p_record_count: isSpei ? summary?.recordCount ?? null : null,
    p_total_amount_minor: isSpei ? summary?.totalAmountMinor ?? null : null,
  })
  if (error) throw error
  return data as Reservation
}

// ── RPC 4: confirm_payroll_capture_file(p_file_id, p_sha256) ───────────────
async function confirmFile(fileId: string, sha256: string): Promise<{ version: number }> {
  const { data, error } = await supabase.rpc('confirm_payroll_capture_file', { p_file_id: fileId, p_sha256: sha256 })
  if (error) throw error
  return { version: (data as any).version as number }
}

// Subida en DOS FASES (reserve → storage.upload → confirm), idéntica a
// uploadReservedFile del vanilla. Devuelve la nueva versión de la sesión.
// La ruta de storage la fija el backend en la reservación (no la inventamos).
export async function uploadReservedFile(
  sessionId: string,
  expectedVersion: number,
  slot: PayrollSlot,
  fs: FileSlotState,
): Promise<number> {
  const reservation = await reserveFile(sessionId, expectedVersion, slot, fs)
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(reservation.storage_path, fs.file as File, {
    contentType: fs.mimeType,
    upsert: false,
  })
  if (upErr) throw upErr
  const confirmation = await confirmFile(reservation.file_id, fs.sha256 as string)
  return confirmation.version
}

// ── Materialización (Edge Function payroll-materialize) ────────────────────
// No es uno de los 8 RPCs: el servidor re-descarga y re-interpreta los bytes y
// materializa la solicitud. Idéntico a materializeCapture del vanilla. Flux no
// ejecuta pagos: sólo valida el paquete y crea la corrida en estado draft.
export type MaterializeResult = { status: string; payment_request_id?: string }
export type RevalidateResult = {
  status: 'validated'
  capture_session_id: string
  capture_version: number
  file_count: number
  employee_record_count: number
  channels: string[]
  employee_net_total_minor: number
  treasury_total_minor: number
  provision_base_amount_minor: number
  finance_review_required: boolean
  parser_versions: string[]
  validated_at: string
}

export async function materializeCapture(sessionId: string, expectedVersion: number): Promise<MaterializeResult> {
  const idempotencyKey = `payroll-n3g:${sessionId}:v${expectedVersion}`
  const { data, error } = await supabase.functions.invoke('payroll-materialize', {
    body: { capture_session_id: sessionId, expected_version: expectedVersion, idempotency_key: idempotencyKey },
  })
  if (error) throw error
  if (!data || !['materialized', 'already_materialized'].includes((data as MaterializeResult).status)) {
    throw new Error('PAYROLL_MATERIALIZATION_FAILED')
  }
  return data as MaterializeResult
}

export async function revalidateMaterializedCapture(sessionId: string, expectedVersion: number): Promise<RevalidateResult> {
  const { data, error } = await supabase.functions.invoke('payroll-materialize', {
    body: { capture_session_id: sessionId, expected_version: expectedVersion, mode: 'validate_only' },
  })
  if (error) throw error
  if (!data || (data as RevalidateResult).status !== 'validated') throw new Error('PAYROLL_DEV_REVALIDATION_FAILED')
  return data as RevalidateResult
}

// ── RPC 5: get_payroll_submission_summary(p_payment_request_id) ────────────
export async function getSubmissionSummary(paymentRequestId: string): Promise<SubmissionSummary> {
  const { data, error } = await supabase.rpc('get_payroll_submission_summary', { p_payment_request_id: paymentRequestId })
  if (error) throw error
  return data as SubmissionSummary
}

// ── RPC 6: list_payment_request_approver_options(...) ──────────────────────
// Compartida con Solicitudes; mismos params.
export async function listApproverOptions(
  companyId: string,
  costCenterId: string | null,
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

// ── RPC 7: acknowledge_payroll_toka_funding_variance(p_payment_request_id, p_note)
export async function acknowledgeTokaVariance(paymentRequestId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('acknowledge_payroll_toka_funding_variance', {
    p_payment_request_id: paymentRequestId,
    p_note: note,
  })
  if (error) throw error
}

// ── RPC 8: submit_payroll_for_approval(p_payment_request_id, p_approver_id, p_approver_assignment_id)
export async function submitForApproval(
  paymentRequestId: string,
  approverId: string,
  approverAssignmentId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('submit_payroll_for_approval', {
    p_payment_request_id: paymentRequestId,
    p_approver_id: approverId,
    p_approver_assignment_id: approverAssignmentId,
  })
  if (error) throw error
}
