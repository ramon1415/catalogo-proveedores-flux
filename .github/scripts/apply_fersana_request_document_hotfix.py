from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:180]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


detail = Path("app/src/features/solicitudes/DetailModal.tsx")
request_modal = Path("app/src/features/solicitudes/RequestModal.tsx")
edit_modal = Path("app/src/features/solicitudes/EditModal.tsx")
api = Path("app/src/features/solicitudes/api.ts")

# ── DetailModal: incidencias por módulo + documentos claramente diferenciados.
replace_once(
    detail,
    "import { formatDate, formatDateTime, numberValue } from '../../lib/format'\n",
    "import { formatDate, formatDateTime, numberValue } from '../../lib/format'\nimport { useModules } from '../../lib/moduleAccess'\n",
)

replace_once(
    detail,
    """  const { showToast } = useToast()

  const proveedor = proveedores.find((p) => p.id === request.proveedor_id) || null""",
    """  const { showToast } = useToast()
  const { isEnabled } = useModules()
  const showIncidencias = isEnabled('incidencias')

  const proveedor = proveedores.find((p) => p.id === request.proveedor_id) || null""",
)

replace_once(
    detail,
    """      // Incidencias (canApprove)
      if (canApprove) {""",
    """      // Incidencias: solo en empresas que tienen habilitado el módulo.
      if (canApprove && showIncidencias) {""",
)

replace_once(
    detail,
    """    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id])""",
    """    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id, canApprove, showIncidencias])""",
)

replace_once(
    detail,
    """            {request.invoice_storage_path && (
              <DataRow label="Comprobante" value={<button type="button" className={s.invoiceLink} onClick={() => openInvoice(request.invoice_storage_path!)}>Ver comprobante</button>} />
            )}""",
    """            {!isReembolso && (
              <DataRow
                label="Factura / comprobante de la solicitud"
                value={request.invoice_storage_path
                  ? <button type="button" className={s.invoiceLink} onClick={() => openInvoice(request.invoice_storage_path!)}>Ver documento adjunto</button>
                  : <button type="button" className={s.invoiceLink} onClick={onEdit}>Documento faltante · adjuntar ahora</button>}
              />
            )}""",
)

replace_once(
    detail,
    """              categories={budgetCategories}
              currency={currency}
            />""",
    """              categories={budgetCategories}
              currency={currency}
              onOpenReceipt={openInvoice}
            />""",
)

replace_once(
    detail,
    """          {receiptSummary && <ReceiptSection data={receiptSummary} onView={(id) => accessEvidence(id, false)} onDownload={(id) => accessEvidence(id, true)} />}""",
    """          {receiptSummary && (isPaid || receiptSummary?.link) && <ReceiptSection data={receiptSummary} onView={(id) => accessEvidence(id, false)} onDownload={(id) => accessEvidence(id, true)} />}""",
)

replace_once(
    detail,
    """          {/* Incidencia asociada (canApprove) */}
          {canApprove && (""",
    """          {/* Incidencia asociada: solo aplica cuando el módulo está habilitado. */}
          {canApprove && showIncidencias && (""",
)

replace_once(
    detail,
    """function ReimbursementDetailSection({
  items,
  beneficiaryName,
  bank,
  categories,
  currency,
}: {
  items: ReimbursementItem[] | null
  beneficiaryName: string
  bank: EmployeeBankAccount | null
  categories: BudgetCategory[]
  currency: string
}) {""",
    """function ReimbursementDetailSection({
  items,
  beneficiaryName,
  bank,
  categories,
  currency,
  onOpenReceipt,
}: {
  items: ReimbursementItem[] | null
  beneficiaryName: string
  bank: EmployeeBankAccount | null
  categories: BudgetCategory[]
  currency: string
  onOpenReceipt: (storagePath: string) => void
}) {""",
)

replace_once(
    detail,
    """              <span>
                {item.deducible ? 'Deducible' : 'No deducible'}
                {' · '}
                {item.invoice_uuid ? `Folio fiscal ${item.invoice_uuid}` : 'Sin folio fiscal'}
              </span>""",
    """              <span>
                {item.deducible ? 'Deducible' : 'No deducible'}
                {' · '}
                {item.invoice_uuid ? `Folio fiscal ${item.invoice_uuid}` : 'Sin folio fiscal'}
              </span>
              {item.storage_path ? (
                <button type="button" className={s.invoiceLink} onClick={() => onOpenReceipt(item.storage_path!)}>Ver comprobante adjunto</button>
              ) : (
                <span>{item.deducible ? 'Comprobante faltante' : 'Sin comprobante fiscal'}</span>
              )}""",
)

replace_once(
    detail,
    """          <h3>Comprobante de pago</h3>
          <p style={{ margin: '3px 0 0' }}>Vista interna de Finanzas. El importe proviene del comprobante bancario vinculado.</p>""",
    """          <h3>Comprobante bancario del pago</h3>
          <p style={{ margin: '3px 0 0' }}>Se vincula después de ejecutar y conciliar el layout; no es la factura o comprobante adjunto al crear la solicitud.</p>""",
)

# ── API: RPC transaccional para solicitud + documento y limpieza de staging.
create_payment_request = """export async function createPaymentRequest(payload: RequestPayload): Promise<any> {
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
    p_invoice_uuid: payload.invoice_uuid,
    p_beneficiary_profile_id: payload.beneficiary_profile_id,
    p_request_type: payload.request_type,
  })
  if (error) throw error
  return data
}
"""

create_payment_request_with_document = create_payment_request + """
export async function createPaymentRequestWithDocument(
  payload: RequestPayload,
  invoiceStoragePath: string,
): Promise<any> {
  const { data, error } = await supabase.rpc('create_payment_request_with_document', {
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
    p_invoice_uuid: payload.invoice_uuid,
    p_beneficiary_profile_id: payload.beneficiary_profile_id,
    p_request_type: payload.request_type,
    p_invoice_storage_path: invoiceStoragePath,
  })
  if (error) throw error
  return data
}
"""
replace_once(api, create_payment_request, create_payment_request_with_document)

replace_once(
    api,
    """export async function uploadReceipt(file: File, folder: string): Promise<string> {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error(`Error al subir archivo: ${error.message}`)
  return path
}

export async function getReceiptUrl""",
    """export async function uploadReceipt(file: File, folder: string): Promise<string> {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error(`Error al subir archivo: ${error.message}`)
  return path
}

export async function removeReceipt(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(UPLOAD_BUCKET).remove([storagePath])
  if (error) throw new Error(`Error al limpiar archivo temporal: ${error.message}`)
}

export async function getReceiptUrl""",
)

# ── RequestModal: subir antes de crear para no dejar solicitudes sin documento.
replace_once(
    request_modal,
    """  loadBudgetAvailability, listApproverOptions, createPaymentRequest,
  updateFase2Metadata, uploadReceipt, linkInvoicePath, loadIncidencias,""",
    """  loadBudgetAvailability, listApproverOptions, createPaymentRequest,
  createPaymentRequestWithDocument, updateFase2Metadata, uploadReceipt, removeReceipt, loadIncidencias,""",
)

replace_once(
    request_modal,
    """    setSubmitting(true)
    try {
      const data = await createPaymentRequest(payload)
      const result = normalizeRpcResult<any>(data)""",
    """    setSubmitting(true)
    let stagedDocumentPath: string | null = null
    try {
      let data: any
      if (isReembolso) {
        data = await createPaymentRequest(payload)
      } else {
        if (!file || !profile?.id) throw new Error('request_document_required')
        stagedDocumentPath = await uploadReceipt(file, `solicitudes/drafts/${profile.id}`)
        data = await createPaymentRequestWithDocument(payload, stagedDocumentPath)
        // Desde aquí el archivo ya quedó enlazado dentro de la misma transacción
        // que creó la solicitud; no debe eliminarse aunque falle un paso posterior.
        stagedDocumentPath = null
      }
      const result = normalizeRpcResult<any>(data)""",
)

replace_once(
    request_modal,
    """      // Adjunto de comprobante.
      if (file) {
        try {
          const path = await uploadReceipt(file, `solicitudes/${requestId}`)
          await linkInvoicePath(requestId, path)
        } catch {
          showToast('Comprobante no vinculado', 'La solicitud se creo, pero el comprobante no pudo subirse o vincularse.', 'warning')
        }
      }

""",
    "",
)

replace_once(
    request_modal,
    """    } catch (error) {
      if (isApproverStaleError(error)) {""",
    """    } catch (error) {
      if (stagedDocumentPath) {
        try { await removeReceipt(stagedDocumentPath) } catch { /* limpieza best-effort */ }
      }
      if (isApproverStaleError(error)) {""",
)

# ── EditModal: las solicitudes históricas sin archivo deben repararse.
replace_once(
    edit_modal,
    """    if (!proveedorId) { showToast('Revisa la solicitud', 'Selecciona un proveedor.', 'warning'); return }
    if (!budgetCategoryId) { showToast('Revisa la solicitud', 'Selecciona una partida presupuestal.', 'warning'); return }

    setSaving(true)""",
    """    if (!proveedorId) { showToast('Revisa la solicitud', 'Selecciona un proveedor.', 'warning'); return }
    if (!budgetCategoryId) { showToast('Revisa la solicitud', 'Selecciona una partida presupuestal.', 'warning'); return }
    if (!request.invoice_storage_path && !file) {
      showToast('Documento requerido', 'Adjunta la factura o comprobante antes de guardar.', 'warning')
      return
    }

    setSaving(true)""",
)

replace_once(
    edit_modal,
    """                <label className={s.fullRow}>Factura / comprobante
                  <input type="file""" ,
    """                <label className={s.fullRow}>Factura / comprobante {request.invoice_storage_path ? '(reemplazo opcional)' : '*'}
                  <input type="file""",
)
