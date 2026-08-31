import { supabase } from '../../lib/supabase'
import { attachApprovalMetadata } from './logic'
import type { ApprovalData, ApprovalEvent, ApproverDetails, DecisionAction, PaymentRequest } from './types'

// Bitácora de decisiones para las fechas del historial (degrada a [] si falla,
// igual que el vanilla: solo emite un warning y continúa).
export async function loadApprovalEvents(requests: PaymentRequest[]): Promise<ApprovalEvent[]> {
  const ids = [...new Set((requests || []).map((request) => request.id).filter(Boolean))]
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('payment_request_approvals')
    .select('payment_request_id,action,from_status,to_status,comments,approval_level,created_at,actor_profile_id')
    .in('payment_request_id', ids)
    .in('action', ['approved', 'exception_approved', 'rejected', 'exception_rejected'])
    .order('created_at', { ascending: false })
  if (error) {
    console.warn('No se pudo cargar bitacora para fechas de aprobacion', error)
    return []
  }
  return (data ?? []) as ApprovalEvent[]
}

// Carga en paralelo idéntica a loadData(): si cualquiera de las 7 consultas
// principales falla, se lanza el error (el vanilla hace `find(r => r.error)`).
export async function loadApprovalData(): Promise<ApprovalData> {
  const [req, prov, comp, cent, cat, lines, funds] = await Promise.all([
    supabase.from('payment_requests').select('*').order('created_at', { ascending: false }),
    supabase.from('proveedores').select('id,alias,nombre_completo,rfc'),
    supabase.from('companies').select('id,name,legal_name'),
    supabase.from('cost_centers').select('id,code,name'),
    supabase.from('budget_categories').select('id,code,name,category'),
    supabase.from('payment_layout_lines').select('id,payment_request_id,layout_id,status'),
    supabase.from('cash_funds').select('id,payment_request_id,status,pending_amount'),
  ])
  const failed = [req, prov, comp, cent, cat, lines, funds].find((r) => r.error)
  if (failed?.error) throw failed.error

  const approvalEvents = await loadApprovalEvents((req.data ?? []) as PaymentRequest[])
  const requests = attachApprovalMetadata((req.data ?? []) as PaymentRequest[], approvalEvents)

  return {
    requests,
    providers: prov.data ?? [],
    companies: comp.data ?? [],
    centers: cent.data ?? [],
    categories: cat.data ?? [],
    layoutLines: lines.data ?? [],
    cashFunds: funds.data ?? [],
    approvalEvents,
  } as ApprovalData
}

// Detalle del aprobador seleccionado (RPC). Devuelve la fila o null.
export async function getApproverDetails(paymentRequestId: string): Promise<ApproverDetails | null> {
  const { data, error } = await supabase.rpc('get_payment_request_approver_details', {
    p_payment_request_id: paymentRequestId,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return (row ?? null) as ApproverDetails | null
}

export async function decidePaymentRequest(
  paymentRequestId: string,
  actorProfileId: string,
  action: DecisionAction,
  comments: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('decide_payment_request', {
    p_payment_request_id: paymentRequestId,
    p_actor_profile_id: actorProfileId,
    p_action: action,
    p_comments: comments,
  })
  if (error) throw error
}
