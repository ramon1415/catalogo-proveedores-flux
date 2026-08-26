import { supabase } from '../../lib/supabase'
import type { CashData, ReviewAction, TicketPayload } from './types'

const UPLOAD_BUCKET = 'payment-receipts'

// Carga en paralelo idéntica a loadCashData(). Lanza solo si falla cash_funds
// (fuente principal); el resto degrada a [] como en el vanilla.
export async function loadCashData(): Promise<CashData> {
  const [funds, recs, items, requests, profiles, companies, providers, categories] = await Promise.all([
    supabase.from('cash_funds').select('*').order('created_at', { ascending: false }),
    supabase.from('cash_reconciliations').select('*').order('created_at', { ascending: false }),
    supabase.from('cash_reconciliation_items').select('*').order('created_at', { ascending: true }),
    supabase.from('payment_requests').select('*'),
    supabase.from('profiles').select('*'),
    supabase.from('companies').select('*').order('name', { ascending: true }),
    supabase.from('proveedores').select('*').order('alias', { ascending: true }),
    supabase.from('budget_categories').select('*').order('code', { ascending: true }),
  ])

  if (funds.error) throw funds.error

  return {
    cashFunds: funds.data ?? [],
    reconciliations: recs.error ? [] : recs.data ?? [],
    reconciliationItems: items.error ? [] : items.data ?? [],
    paymentRequests: requests.error ? [] : requests.data ?? [],
    profiles: profiles.error ? [] : profiles.data ?? [],
    companies: companies.error ? [] : companies.data ?? [],
    proveedores: providers.error ? [] : providers.data ?? [],
    budgetCategories: categories.error ? [] : categories.data ?? [],
  } as CashData
}

export async function createReconciliation(fundId: string, submittedBy: string): Promise<void> {
  const { error } = await supabase.rpc('create_cash_reconciliation', {
    p_cash_fund_id: fundId,
    p_submitted_by: submittedBy,
  })
  if (error) throw error
}

async function uploadTicketReceipt(reconciliationId: string, file: File): Promise<string> {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const path = `tickets/${reconciliationId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  })
  if (error) throw error
  return path
}

export async function saveTicket(payload: TicketPayload, file: File | null): Promise<void> {
  const body: TicketPayload = { ...payload }
  if (file) body.storage_path = await uploadTicketReceipt(payload.reconciliation_id, file)
  const { error } = await supabase.from('cash_reconciliation_items').insert(body)
  if (error) throw error
}

export async function submitReconciliation(reconciliationId: string, returnedAmount: number): Promise<void> {
  const { error } = await supabase.rpc('submit_cash_reconciliation', {
    p_reconciliation_id: reconciliationId,
    p_returned_amount: returnedAmount,
  })
  if (error) throw error
}

export async function reviewReconciliation(
  reconciliationId: string,
  reviewerProfileId: string,
  action: ReviewAction,
  comment: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('review_cash_reconciliation', {
    p_reconciliation_id: reconciliationId,
    p_reviewer_profile_id: reviewerProfileId,
    p_action: action,
    p_comment: comment,
  })
  if (error) throw error
}

export type CashBlockResult = { blocked?: boolean; funds?: any[]; total_pending?: number; overdue_count?: number }

export async function verifyCashBlock(profileId: string): Promise<CashBlockResult> {
  const { data, error } = await supabase.rpc('verify_cash_block', { p_profile_id: profileId })
  if (error) throw error
  return (data ?? {}) as CashBlockResult
}

export async function getReceiptUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
