import { supabase } from '../../lib/supabase'
import type { IngresosData, MemberPayload, PeriodPayload, InvoiceType } from './types'

const UPLOAD_BUCKET = 'payment-receipts'

// Cada ruta carga únicamente sus fuentes operativas. Así una falla de cuotas no
// bloquea Incidencias (ni una falla de incidentes bloquea Ingresos).
export async function loadIngresosData(mode: 'income' | 'incidents'): Promise<IngresosData> {
  if (mode === 'incidents') {
    const reqs = await Promise.all([
      supabase.from('members').select('*').order('full_name', { ascending: true }),
      supabase.from('incident_charges').select('*').order('incident_date', { ascending: false }),
      supabase.from('invoices').select('*').eq('invoice_type', 'incident').order('issue_date', { ascending: false }),
      supabase.from('companies').select('id,name,legal_name,active').order('name', { ascending: true }),
      supabase.from('cost_centers').select('id,name,code,active').order('name', { ascending: true }),
      supabase.from('company_cost_centers').select('company_id,cost_center_id,active').eq('active', true),
      supabase.from('budget_categories').select('id,code,name,category,budget_type,active').order('code', { ascending: true }),
    ])
    const err = reqs.find((r) => r.error)?.error
    if (err) throw err
    return {
      members: reqs[0].data ?? [],
      periods: [],
      charges: [],
      payments: [],
      incidents: reqs[1].data ?? [],
      invoices: reqs[2].data ?? [],
      companies: reqs[3].data ?? [],
      costCenters: reqs[4].data ?? [],
      companyCostCenters: reqs[5].data ?? [],
      categories: reqs[6].data ?? [],
    } as IngresosData
  }

  const reqs = await Promise.all([
    supabase.from('members').select('*').order('full_name', { ascending: true }),
    supabase.from('billing_periods').select('*').order('cutoff_date', { ascending: false }),
    supabase.from('maintenance_fee_charges').select('*').order('created_at', { ascending: false }),
    supabase.from('maintenance_fee_payments').select('*').order('created_at', { ascending: false }),
    supabase.from('invoices').select('*').eq('invoice_type', 'maintenance_fee').order('issue_date', { ascending: false }),
    supabase.from('companies').select('id,name,legal_name,active').order('name', { ascending: true }),
    supabase.from('cost_centers').select('id,name,code,active').order('name', { ascending: true }),
    supabase.from('company_cost_centers').select('company_id,cost_center_id,active').eq('active', true),
    supabase.from('budget_categories').select('id,code,name,category,budget_type,active').order('code', { ascending: true }),
  ])
  const err = reqs.find((r) => r.error)?.error
  if (err) throw err
  return {
    members: reqs[0].data ?? [],
    periods: reqs[1].data ?? [],
    charges: reqs[2].data ?? [],
    payments: reqs[3].data ?? [],
    incidents: [],
    invoices: reqs[4].data ?? [],
    companies: reqs[5].data ?? [],
    costCenters: reqs[6].data ?? [],
    companyCostCenters: reqs[7].data ?? [],
    categories: reqs[8].data ?? [],
  } as IngresosData
}

// ── Storage ────────────────────────────────────────────────────────
// Espejo de FluxUpload.uploadReceipt: payment-receipts/{folder}/{ts}_{rand}.{ext}
export async function uploadReceipt(file: File | null, folder: string): Promise<string | null> {
  if (!file) return null
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (error) throw new Error(`Error al subir archivo: ${error.message}`)
  return path
}

// ── Members (tabla directa) ────────────────────────────────────────
export async function saveMember(payload: MemberPayload, editMemberId: string | null): Promise<void> {
  const q = editMemberId
    ? supabase.from('members').update(payload).eq('id', editMemberId)
    : supabase.from('members').insert(payload)
  const { error } = await q
  if (error) throw error
}

// ── Periodos (tabla directa, devuelve id nuevo) ────────────────────
export async function savePeriod(payload: PeriodPayload): Promise<string | null> {
  const { data, error } = await supabase.from('billing_periods').insert(payload).select('id').single()
  if (error) throw error
  return data?.id ?? null
}

// ── RPCs ───────────────────────────────────────────────────────────
export async function generateFees(periodId: string): Promise<{ charges_generated?: number } | null> {
  const { data, error } = await supabase.rpc('generate_maintenance_fees_for_period', { p_billing_period_id: periodId })
  if (error) throw error
  return data ?? null
}

export type PaymentArgs = {
  chargeId: string
  amount: number
  paymentDate: string
  bankReference: string | null
  paymentMethod: string
  registeredBy: string
  notes: string | null
}
export async function registerPayment(a: PaymentArgs): Promise<any> {
  const { data, error } = await supabase.rpc('register_maintenance_fee_payment', {
    p_charge_id: a.chargeId,
    p_amount: a.amount,
    p_payment_date: a.paymentDate,
    p_bank_reference: a.bankReference,
    p_payment_method: a.paymentMethod,
    p_registered_by: a.registeredBy,
    p_notes: a.notes,
  })
  if (error) throw error
  return data
}

// Vincula el comprobante subido al pago recién creado.
export async function linkPaymentReceipt(paymentId: string, storagePath: string): Promise<boolean> {
  const { error } = await supabase.from('maintenance_fee_payments').update({ receipt_storage_path: storagePath }).eq('id', paymentId)
  return !error
}

export type IncidentArgs = {
  memberId: string | null
  externalName: string | null
  externalRfc: string | null
  referredByMemberId: string | null
  companyId: string | null
  costCenterId: string | null
  budgetCategoryId: string | null
  description: string
  amount: number
  incidentDate: string
  registeredBy: string
  notes: string | null
}
export async function createIncident(a: IncidentArgs): Promise<any> {
  const { data, error } = await supabase.rpc('create_incident_charge', {
    p_member_id: a.memberId,
    p_external_name: a.externalName,
    p_external_rfc: a.externalRfc,
    p_referred_by_member_id: a.referredByMemberId,
    p_company_id: a.companyId,
    p_cost_center_id: a.costCenterId,
    p_budget_category_id: a.budgetCategoryId,
    p_description: a.description,
    p_amount: a.amount,
    p_incident_date: a.incidentDate,
    p_registered_by: a.registeredBy,
    p_notes: a.notes,
  })
  if (error) throw error
  return data
}

export type InvoiceArgs = {
  type: InvoiceType
  referenceId: string
  fiscalUuid: string | null
  seriesFolio: string | null
  amount: number
  issueDate: string
  storagePathXml: string | null
  storagePathPdf: string | null
}
export async function createInvoice(a: InvoiceArgs): Promise<any> {
  const { data, error } = await supabase.rpc('create_invoice_record', {
    p_invoice_type: a.type,
    p_reference_id: a.referenceId,
    p_fiscal_uuid: a.fiscalUuid,
    p_series_folio: a.seriesFolio,
    p_amount: a.amount,
    p_issue_date: a.issueDate,
    p_storage_path_xml: a.storagePathXml,
    p_storage_path_pdf: a.storagePathPdf,
  })
  if (error) throw error
  return data
}

export type InvoicePayArgs = {
  invoiceId: string
  paymentDate: string
  bankReference: string | null
  paymentMethod: string
  registeredBy: string
  notes: string | null
}
export async function markInvoicePaid(a: InvoicePayArgs): Promise<any> {
  const { data, error } = await supabase.rpc('mark_invoice_paid', {
    p_invoice_id: a.invoiceId,
    p_payment_date: a.paymentDate,
    p_bank_reference: a.bankReference,
    p_payment_method: a.paymentMethod,
    p_registered_by: a.registeredBy,
    p_notes: a.notes,
  })
  if (error) throw error
  return data
}
