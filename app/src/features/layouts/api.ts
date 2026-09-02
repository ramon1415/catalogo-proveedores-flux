import { supabase } from '../../lib/supabase'
import type {
  PaymentLayout, PaymentLayoutLine, LayoutCompany, CompanyBankAccount,
  EligibilityPreview, PreviewParams, CreateLayoutResult, FinanceBatch, NotIncludedItem,
} from './types'
import { exclusionReasons } from './logic'

// ── SELECTs de tablas ──────────────────────────────────────────────────────
export async function loadLayouts(): Promise<PaymentLayout[]> {
  const { data, error } = await supabase
    .from('payment_layouts')
    .select('id,layout_number,name,period_start,period_end,status,generated_by,generated_at,storage_path,file_name,company_count,payment_count,total_amount,created_at,updated_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as PaymentLayout[]) || []
}

// Líneas usadas para calcular pendientes PAGOSINT + resúmenes por formato.
export async function loadLayoutIssueLines(layoutIds: string[]) {
  return supabase
    .from('payment_layout_lines')
    .select('id,layout_id,company_id,destination_type,destination_value,convenio_number,source_account_number,payment_reference,beneficiary_name,payment_concept,amount,status')
    .in('layout_id', layoutIds)
}

export async function loadLayoutCatalogs(): Promise<{ companies: LayoutCompany[]; accounts: CompanyBankAccount[] }> {
  const [companiesResult, accountsResult] = await Promise.all([
    supabase.from('companies').select('id,name,legal_name,active').eq('active', true).order('name', { ascending: true }),
    supabase.from('company_bank_accounts').select('id,name,bank_name,account_number,last4,company_id,active').eq('active', true).order('name', { ascending: true }),
  ])
  if (companiesResult.error) throw companiesResult.error
  if (accountsResult.error) throw accountsResult.error
  return {
    companies: (companiesResult.data as LayoutCompany[]) || [],
    accounts: (accountsResult.data as CompanyBankAccount[]) || [],
  }
}

export async function fetchLayoutLines(layoutId: string) {
  return supabase
    .from('payment_layout_lines')
    .select('id,layout_id,payment_request_id,company_id,proveedor_id,company_bank_account_id,source_account_number,company_name,destination_type,destination_value,convenio_number,beneficiary_name,amount,payment_reference,payment_concept,request_number,status,bank_rejection_reason,created_at,updated_at')
    .eq('layout_id', layoutId)
    .order('source_account_number', { ascending: true })
    .order('company_name', { ascending: true })
    .order('beneficiary_name', { ascending: true })
    .order('request_number', { ascending: true }) as unknown as Promise<{ data: PaymentLayoutLine[] | null; error: any }>
}

// ── RPCs ───────────────────────────────────────────────────────────────────
export async function previewEligibility(params: PreviewParams): Promise<EligibilityPreview> {
  const { data, error } = await supabase.rpc('preview_payment_layout_eligibility', params as any)
  if (error) throw error
  return (data || {}) as EligibilityPreview
}

export async function createLayout(params: {
  p_period_start: string
  p_period_end: string
  p_generated_by: string
  p_name: string | null
  p_company_id: string | null
  p_company_bank_account_id: string | null
}): Promise<CreateLayoutResult> {
  const { data, error } = await supabase.rpc('create_payment_layout', params as any)
  if (error) throw error
  return (data || {}) as CreateLayoutResult
}

export async function completeProviderPaymentExecutionData(params: {
  p_proveedor_id: string | null
  p_destination_type: string | null
  p_clabe: string | null
  p_cuenta_bancaria: string | null
  p_convenio_number: string | null
  p_beneficiary_name: string | null
  p_banco: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('complete_provider_payment_execution_data', params as any)
  if (error) throw error
}

// Reembolsos: el destinatario del dinero es un empleado, no el proveedor de la
// solicitud. `preview_payment_layout_eligibility` no devuelve ni request_type ni
// beneficiary_profile_id, así que el diálogo de completado lo consulta aparte
// para no escribir la CLABE del empleado sobre un registro de `proveedores`.
export async function loadReimbursementBeneficiary(paymentRequestId: string): Promise<{
  isReimbursement: boolean
  beneficiaryProfileId: string | null
  beneficiaryName: string | null
  banco: string | null
  clabe: string | null
  cuenta: string | null
} | null> {
  const { data, error } = await supabase
    .from('payment_requests')
    .select('request_type,beneficiary_profile_id')
    .eq('id', paymentRequestId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { request_type: string | null; beneficiary_profile_id: string | null }
  const isReimbursement = String(row.request_type || '').trim().toLowerCase() === 'reimbursement'
  if (!isReimbursement) {
    return { isReimbursement: false, beneficiaryProfileId: null, beneficiaryName: null, banco: null, clabe: null, cuenta: null }
  }
  let banco: string | null = null
  let clabe: string | null = null
  let cuenta: string | null = null
  let beneficiaryName: string | null = null
  if (row.beneficiary_profile_id) {
    const bank = await supabase
      .from('employee_bank_accounts')
      .select('banco,clabe,cuenta,beneficiary_name')
      .eq('profile_id', row.beneficiary_profile_id)
      .maybeSingle()
    if (!bank.error && bank.data) {
      const account = bank.data as { banco: string | null; clabe: string | null; cuenta: string | null; beneficiary_name: string | null }
      banco = account.banco
      clabe = account.clabe
      cuenta = account.cuenta
      beneficiaryName = account.beneficiary_name
    }
  }
  return { isReimbursement: true, beneficiaryProfileId: row.beneficiary_profile_id, beneficiaryName, banco, clabe, cuenta }
}

export async function completePaymentRequestLayoutData(params: {
  p_payment_request_id: string
  p_company_bank_account_id: string | null
  p_payment_reference: string | null
  p_payment_concept: string | null
  p_scheduled_payment_date: string | null
}): Promise<any> {
  const { data, error } = await supabase.rpc('complete_payment_request_layout_data', params as any)
  if (error) throw error
  return data
}

export async function listFinanceApprovalBatches(status = 'draft'): Promise<FinanceBatch[]> {
  const { data, error } = await supabase.rpc('list_finance_approval_batches', { p_status: status })
  if (error) throw error
  return Array.isArray(data) ? (data as FinanceBatch[]) : []
}

export async function releaseAndRebatchRejectedRequest(params: {
  p_rejected_item_id: string
  p_correction_note: string
  p_target_batch_id: string | null
}): Promise<any> {
  const { data, error } = await supabase.rpc('release_and_rebatch_rejected_request', params as any)
  if (error) throw error
  return data
}

export async function markPaymentLayoutUploaded(layoutId: string, actorProfileId: string | null): Promise<any> {
  const { data, error } = await supabase.rpc('mark_payment_layout_uploaded', {
    p_layout_id: layoutId,
    p_actor_profile_id: actorProfileId,
    p_comments: null,
  })
  if (error) throw error
  return data
}

export async function confirmPaymentLayout(params: {
  p_layout_id: string
  p_payment_date: string
  p_bank_reference: string | null
  p_storage_path: string | null
  p_registered_by: string | null
}): Promise<any> {
  const { data, error } = await supabase.rpc('confirm_payment_layout', params as any)
  if (error) throw error
  return data
}

export async function updatePagosintReference(params: {
  p_line_id: string
  p_payment_reference: string
  p_beneficiary_name: string
  p_payment_concept: string
}): Promise<any> {
  const { data, error } = await supabase.rpc('update_payment_layout_line_pagosint_reference', params as any)
  if (error) throw error
  return data
}

export async function rejectPaymentLayoutLine(params: {
  p_line_id: string
  p_reason: string
  p_actor_profile_id: string | null
}): Promise<any> {
  const { data, error } = await supabase.rpc('reject_payment_layout_line', params as any)
  if (error) throw error
  return data
}

// UPDATE directo tras descargar un archivo (file_name + status = generated).
export async function updateLayoutFileState(layoutId: string, fileName: string): Promise<{ error: any }> {
  return supabase
    .from('payment_layouts')
    .update({ file_name: fileName, status: 'generated', updated_at: new Date().toISOString() })
    .eq('id', layoutId)
}

// ── Diagnóstico "aprobadas no consideradas" (layouts_result_extension) ──────
export async function collectCandidateDiagnostics(args: {
  data: CreateLayoutResult
  periodStart: string
  periodEnd: string
  companyId: string | null
  bankAccountId: string | null
}): Promise<{ notIncluded: NotIncludedItem[] }> {
  const { data, periodStart, periodEnd, companyId, bankAccountId } = args
  try {
    const [requestsResult, linesResult, layoutsResult] = await Promise.all([
      supabase
        .from('payment_requests')
        .select('id,request_number,request_type,status,company_id,company_bank_account_id,scheduled_payment_date,updated_at,currency,amount_requested,payment_reference,payment_concept,proveedor_id')
        .eq('status', 'approved')
        .limit(1000),
      supabase.from('payment_layout_lines').select('id,payment_request_id,layout_id,status').limit(2000),
      supabase.from('payment_layouts').select('id,layout_number,status').limit(1000),
    ])

    if (requestsResult.error || linesResult.error || layoutsResult.error) return { notIncluded: [] }

    const invalidIds = new Set((data.invalid_requests || []).map((item) => item.payment_request_id).filter(Boolean))
    const includedIds = new Set(
      (linesResult.data || []).filter((line: any) => line.layout_id === data.layout_id).map((line: any) => line.payment_request_id),
    )
    const layoutsById = new Map((layoutsResult.data || []).map((layout: any) => [layout.id, layout]))
    const linesByRequest = new Map<string, any[]>()
    ;(linesResult.data || []).forEach((line: any) => {
      const layout = layoutsById.get(line.layout_id)
      if (!layout || layout.status === 'cancelled') return
      if (!linesByRequest.has(line.payment_request_id)) linesByRequest.set(line.payment_request_id, [])
      linesByRequest.get(line.payment_request_id)!.push({ ...line, layout })
    })

    const notIncluded = (requestsResult.data || [])
      .filter((request: any) => !invalidIds.has(request.id) && !includedIds.has(request.id))
      .map((request: any) => {
        const reasons = exclusionReasons(request, {
          periodStart,
          periodEnd,
          companyId,
          bankAccountId,
          lines: linesByRequest.get(request.id) || [],
        })
        return reasons.length ? { request, reasons } : null
      })
      .filter(Boolean) as NotIncludedItem[]

    return { notIncluded }
  } catch {
    return { notIncluded: [] }
  }
}

// ── Descarga de archivo de texto (Blob + anchor), idéntica al vanilla ───────
export function downloadTextFile(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
