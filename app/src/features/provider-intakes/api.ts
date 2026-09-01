import { supabase } from '../../lib/supabase'
import type {
  IntakeFilters, IntakeListResult, IntakeDetailResult, IntakeAction,
  MatchData, LinkTarget, MatchComparison,
  PaymentDraftContext, PaymentDraftForm, ApproverOption,
  LinkManagementContext, LinkProviderResult, ActiveLink,
} from './types'

// Espejo de list_provider_intakes() del vanilla (provider_intakes.js).
export async function listProviderIntakes(f: IntakeFilters): Promise<IntakeListResult> {
  const { data, error } = await supabase.rpc('list_provider_intakes', {
    p_company_id: f.companyId,
    p_statuses: f.status ? [f.status] : [],
    p_date_from: f.dateFrom || null,
    p_date_to: f.dateTo || null,
    p_has_files: f.hasFiles === '' ? null : f.hasFiles === 'true',
    p_folio: f.folio.trim() || null,
    p_provider: f.provider.trim() || null,
    p_sort_direction: f.sort,
    p_page: f.page,
    p_page_size: f.pageSize,
  })
  if (error) throw error
  const r = (data && typeof data === 'object' ? data : {}) as Partial<IntakeListResult>
  return {
    items: Array.isArray(r.items) ? r.items : [],
    summary: r.summary ?? {},
    total: Number(r.total ?? 0),
    page: Number(r.page ?? f.page),
    page_size: Number(r.page_size ?? f.pageSize),
    companies: Array.isArray(r.companies) ? r.companies : [],
  }
}

// Espejo de get_provider_intake_detail() — detalle read-only (rebanada 2).
export async function getProviderIntakeDetail(intakeId: string): Promise<IntakeDetailResult> {
  const { data, error } = await supabase.rpc('get_provider_intake_detail', { p_payment_intake_id: intakeId })
  if (error) throw error
  const r = (data && typeof data === 'object' ? data : {}) as Partial<IntakeDetailResult>
  return {
    intake: r.intake ?? null,
    files: Array.isArray(r.files) ? r.files : [],
    events: Array.isArray(r.events) ? r.events : [],
  }
}

// Espejo de submitAction() — transición de estado o nota interna (rebanada 3).
// Concurrencia optimista: enviamos el estado/updated_at esperados + un action_id
// idempotente, igual que el vanilla, para que un doble click no duplique eventos.
export async function submitIntakeAction(params: {
  intakeId: string
  action: IntakeAction
  notes: string
  expectedStatus: string
  expectedUpdatedAt: string | null
  actionId: string
}): Promise<void> {
  const { intakeId, action, notes, expectedStatus, expectedUpdatedAt, actionId } = params
  const trimmed = notes.trim()
  if (action.kind === 'note') {
    const { error } = await supabase.rpc('add_provider_intake_note', {
      p_payment_intake_id: intakeId,
      p_expected_updated_at: expectedUpdatedAt,
      p_notes: trimmed,
      p_action_id: actionId,
    })
    if (error) throw error
    return
  }
  const { error } = await supabase.rpc('transition_provider_intake', {
    p_payment_intake_id: intakeId,
    p_expected_status: expectedStatus,
    p_expected_updated_at: expectedUpdatedAt,
    p_to_status: action.toStatus,
    p_notes: trimmed || null,
    p_action_id: actionId,
  })
  if (error) throw error
}

// ── Matching de proveedor maestro (rebanada 5) ─────────────────────────────
export async function findProviderIntakeCandidates(intakeId: string, search: string): Promise<MatchData> {
  const { data, error } = await supabase.rpc('find_provider_intake_candidates', {
    p_payment_intake_id: intakeId,
    p_search: search.trim() || null,
    p_limit: 12,
  })
  if (error) throw error
  const r = (data && typeof data === 'object' ? data : {}) as Partial<MatchData>
  return {
    eligible: Boolean(r.eligible),
    current_match: r.current_match ?? null,
    candidates: Array.isArray(r.candidates) ? r.candidates : [],
    duplicate_rfc_count: Number(r.duplicate_rfc_count ?? 0),
    history: Array.isArray(r.history) ? r.history : [],
  }
}

export async function getProviderIntakeLinkTarget(intakeId: string): Promise<LinkTarget | null> {
  const { data, error } = await supabase.rpc('get_provider_intake_link_target', {
    p_payment_intake_id: intakeId,
  })
  if (error) throw error
  const r = data as LinkTarget | null
  return r?.targeted ? r : null
}

export async function getProviderIntakeMatchComparison(intakeId: string, providerId: string): Promise<MatchComparison> {
  const { data, error } = await supabase.rpc('get_provider_intake_match_comparison', {
    p_payment_intake_id: intakeId,
    p_proveedor_id: providerId,
  })
  if (error) throw error
  const r = (data && typeof data === 'object' ? data : {}) as Partial<MatchComparison>
  return {
    provider_alias: r.provider_alias ?? null,
    provider_active: Boolean(r.provider_active),
    rows: Array.isArray(r.rows) ? r.rows : [],
  }
}

// set / replace / clear — la misma RPC; clear = p_proveedor_id null.
export async function setProviderIntakeMatch(params: {
  intakeId: string
  expectedStatus: string
  expectedUpdatedAt: string | null
  expectedCurrentMatch: string | null
  providerId: string | null
  reason: string
  reasonCode: string
  actionId: string
}): Promise<void> {
  const { error } = await supabase.rpc('set_provider_intake_match', {
    p_payment_intake_id: params.intakeId,
    p_expected_status: params.expectedStatus,
    p_expected_updated_at: params.expectedUpdatedAt,
    p_expected_current_match: params.expectedCurrentMatch,
    p_proveedor_id: params.providerId,
    p_reason: params.reason.trim() || null,
    p_reason_code: params.reasonCode,
    p_action_id: params.actionId,
  })
  if (error) throw error
}

// ── Draft de pago + conversión (rebanada 6) ────────────────────────────────
export async function getPaymentDraftContext(intakeId: string): Promise<PaymentDraftContext> {
  const { data, error } = await supabase.rpc('get_provider_intake_payment_draft_context', {
    p_payment_intake_id: intakeId,
  })
  if (error) throw error
  return data as PaymentDraftContext
}

// Guardado parcial permitido; el servidor decide missing_fields/derived_state.
export async function savePaymentDraft(params: {
  intakeId: string
  expectedIntakeStatus: string
  expectedIntakeUpdatedAt: string | null
  expectedDraftVersion: number | null
  form: PaymentDraftForm
  actionId: string
}): Promise<void> {
  const { form } = params
  const { error } = await supabase.rpc('save_provider_intake_payment_draft', {
    p_payment_intake_id: params.intakeId,
    p_expected_intake_status: params.expectedIntakeStatus,
    p_expected_intake_updated_at: params.expectedIntakeUpdatedAt,
    p_expected_draft_version: params.expectedDraftVersion,
    p_cost_center_id: form.cost_center_id,
    p_budget_category_id: form.budget_category_id,
    p_budget_month: form.budget_month,
    p_company_bank_account_id: form.company_bank_account_id,
    p_payment_method: form.payment_method,
    p_requested_by_profile_id: form.requested_by_profile_id,
    p_approver_profile_id: form.approver_profile_id,
    p_approver_assignment_id: form.approver_assignment_id,
    p_final_amount: form.final_amount,
    p_currency: form.currency,
    p_scheduled_payment_date: form.scheduled_payment_date,
    p_internal_concept: form.internal_concept,
    p_internal_notes: form.internal_notes,
    p_amount_change_reason: form.amount_change_reason,
    p_action_id: params.actionId,
  })
  if (error) throw error
}

// La conversión NO reenvía el formulario: el servidor lee el draft persistido.
export async function convertIntakeToPaymentRequest(params: {
  intakeId: string
  expectedIntakeUpdatedAt: string | null
  expectedDraftVersion: number | null
  actionId: string
}): Promise<{ request_number?: string; request_status?: string; budget_decision?: string }> {
  const { data, error } = await supabase.rpc('convert_provider_intake_to_payment_request', {
    p_payment_intake_id: params.intakeId,
    p_expected_intake_updated_at: params.expectedIntakeUpdatedAt,
    p_expected_draft_version: params.expectedDraftVersion,
    p_action_id: params.actionId,
  })
  if (error) throw error
  return (data && typeof data === 'object' ? data : {}) as { request_number?: string; request_status?: string; budget_decision?: string }
}

export async function confirmMasterBanking(params: {
  intakeId: string
  expectedIntakeUpdatedAt: string | null
  expectedProviderUpdatedAt: string | null
  actionId: string
}): Promise<void> {
  const { error } = await supabase.rpc('confirm_provider_intake_master_banking', {
    p_payment_intake_id: params.intakeId,
    p_expected_intake_updated_at: params.expectedIntakeUpdatedAt,
    p_expected_provider_updated_at: params.expectedProviderUpdatedAt,
    p_action_id: params.actionId,
  })
  if (error) throw error
}

export async function listApproverOptions(companyId: string, costCenterId: string, amount: number): Promise<ApproverOption[]> {
  const { data, error } = await supabase.rpc('list_payment_request_approver_options', {
    p_company_id: companyId,
    p_cost_center_id: costCenterId,
    p_amount: amount,
  })
  if (error) throw error
  return Array.isArray(data) ? data as ApproverOption[] : []
}

// ── Gestión de ligas públicas (rebanada 7) ─────────────────────────────────
export async function getLinkManagementContext(): Promise<LinkManagementContext> {
  const { data, error } = await supabase.rpc('get_provider_intake_link_management_context')
  if (error) throw error
  const r = (data && typeof data === 'object' ? data : {}) as Partial<LinkManagementContext>
  return { companies: Array.isArray(r.companies) ? r.companies : [], defaults: r.defaults ?? {} }
}

export async function findLinkProviders(companyId: string, search: string): Promise<LinkProviderResult[]> {
  const { data, error } = await supabase.rpc('find_provider_intake_link_providers', {
    p_company_id: companyId,
    p_search: search,
    p_limit: 12,
  })
  if (error) throw error
  return Array.isArray(data) ? data as LinkProviderResult[] : []
}

export async function getLinkScope(companyId: string, proveedorId: string | null): Promise<ActiveLink | null> {
  const { data, error } = await supabase.rpc('get_provider_intake_link_scope', {
    p_company_id: companyId,
    p_proveedor_id: proveedorId,
  })
  if (error) throw error
  return (data as { active_link?: ActiveLink | null })?.active_link ?? null
}

// El raw_token solo se ve aquí (o al regenerar); nunca se almacena completo.
export async function createIntakeLink(params: {
  companyId: string
  proveedorId: string | null
  label: string
  durationHours: number
  maxSubmissionsPerDay: number
  maxFileMb: number
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_provider_intake_link_v2', {
    p_company_id: params.companyId,
    p_proveedor_id: params.proveedorId,
    p_label: params.label.trim() || null,
    p_duration_hours: params.durationHours,
    p_max_submissions_per_day: params.maxSubmissionsPerDay,
    p_max_file_mb: params.maxFileMb,
  })
  if (error) throw error
  return String((data as { raw_token?: string })?.raw_token || '')
}

export async function revokeIntakeLink(linkId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_provider_intake_link', {
    p_intake_link_id: linkId,
    p_confirmed: true,
  })
  if (error) throw error
}

export async function regenerateIntakeLink(linkId: string, durationHours: number): Promise<string> {
  const { data, error } = await supabase.rpc('regenerate_provider_intake_link_v2', {
    p_intake_link_id: linkId,
    p_confirmed: true,
    p_duration_hours: durationHours,
  })
  if (error) throw error
  return String((data as { raw_token?: string })?.raw_token || '')
}

// Espejo de openTemporaryFile() — enlace firmado de corta duración (rebanada 4).
// La ruta del API vive en la raíz del sitio (Vercel), no bajo /app/: absoluta.
export async function getIntakeFileSignedUrl(intakeId: string, fileId: string): Promise<{ url: string; expiresIn: number }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('auth_required')

  const response = await fetch('/api/provider-intake-file-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ payment_intake_id: intakeId, file_id: fileId }),
    cache: 'no-store',
    credentials: 'same-origin',
  })
  const result = await response.json().catch(() => ({})) as { url?: string; error?: string; expires_in?: number }
  if (!response.ok || !result.url) throw new Error(result.error || 'signed_url_unavailable')

  const url = new URL(result.url)
  if (url.protocol !== 'https:') throw new Error('signed_url_unavailable')
  return { url: url.toString(), expiresIn: Number(result.expires_in || 120) }
}
