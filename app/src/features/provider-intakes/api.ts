import { supabase } from '../../lib/supabase'
import type { IntakeFilters, IntakeListResult, IntakeDetailResult, IntakeAction } from './types'

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
