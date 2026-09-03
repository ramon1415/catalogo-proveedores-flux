import { useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import {
  loadActiveProfiles,
  loadBeneficiaryProfileId,
  loadBudgetAvailability,
  loadEmployeeBankAccount,
  loadReimbursementItems,
  updateReimbursementRequest,
  uploadReceipt,
} from './api'
import {
  budgetCategoryAvailabilityLabel,
  budgetCategoryLabel,
  companyName,
  costCenterName,
  employeeBankAccountIssues,
  friendlyError,
  monthInputToDate,
  sortAvailabilityRows,
  validateReimbursementItems,
} from './logic'
import { ReimbursementSection } from './ReimbursementSection'
import { numberValue } from '../../lib/format'
import type {
  BudgetAvailabilityRow,
  BudgetCategory,
  Company,
  CostCenter,
  EmployeeBankAccount,
  PaymentRequest,
  Profile,
  ReimbursementDraftItem,
  ReimbursementUpdateItem,
} from './types'
import s from './Solicitudes.module.css'

function monthValue(value: string | null): string {
  return value ? value.slice(0, 7) : ''
}

export function ReimbursementEditModal({
  request,
  companies,
  costCenters,
  budgetCategories,
  onClose,
  onSaved,
}: {
  request: PaymentRequest
  companies: Company[]
  costCenters: CostCenter[]
  budgetCategories: BudgetCategory[]
  onClose: () => void
  onSaved: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { showToast } = useToast()
  const companyId = request.company_id || ''

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [beneficiaryId, setBeneficiaryId] = useState('')
  const [bankAccount, setBankAccount] = useState<EmployeeBankAccount | null>(null)
  const [bankLoading, setBankLoading] = useState(false)
  const [items, setItems] = useState<ReimbursementDraftItem[]>([])
  const [costCenterId, setCostCenterId] = useState(request.cost_center_id || '')
  const [budgetMonth, setBudgetMonth] = useState(monthValue(request.budget_month))
  const [currency, setCurrency] = useState(request.currency || 'MXN')
  const [exchangeRate, setExchangeRate] = useState(String(request.exchange_rate || 1))
  const [description, setDescription] = useState(request.description || '')
  const [notes, setNotes] = useState(request.notes || '')
  const [paymentMethod, setPaymentMethod] = useState(request.payment_method || 'transfer')
  const [isExtraordinary, setIsExtraordinary] = useState(!!request.is_extraordinary_adjustment)
  const [budgetRows, setBudgetRows] = useState<BudgetAvailabilityRow[]>([])
  const [categoryDisabled, setCategoryDisabled] = useState(true)
  const [categoryHint, setCategoryHint] = useState('Cargando partidas disponibles…')

  const categoryById = (id: string) => budgetCategories.find((category) => category.id === id) || null
  const company = companies.find((candidate) => candidate.id === companyId) || null
  const isUsd = currency === 'USD'

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [profileRows, profileId, persistedItems] = await Promise.all([
          loadActiveProfiles(companyId),
          loadBeneficiaryProfileId(request.id),
          loadReimbursementItems(request.id),
        ])
        if (!active) return
        setProfiles(profileRows)
        setBeneficiaryId(profileId || '')
        setItems(persistedItems.map((item) => ({
          key: item.id,
          descripcion: item.descripcion || '',
          amount: item.amount == null ? '' : String(item.amount),
          budgetCategoryId: item.budget_category_id || '',
          deducible: item.deducible,
          file: null,
          fileHint: item.storage_path
            ? 'Comprobante ya registrado. Selecciona otro archivo sólo para reemplazarlo.'
            : 'XML, PDF o imagen · máx. 10 MB',
          subtotalAmount: item.subtotal_amount,
          taxAmount: item.tax_amount,
          invoiceUuid: item.invoice_uuid,
          cfdiData: item.cfdi_data ?? null,
          existingStoragePath: item.storage_path,
        })))
      } catch (error: any) {
        showToast('No se pudo abrir el reembolso', error?.message || 'Intenta de nuevo.', 'error')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [companyId, request.id, showToast])

  useEffect(() => {
    if (!beneficiaryId || !companyId) { setBankAccount(null); return }
    let active = true
    setBankLoading(true)
    loadEmployeeBankAccount(beneficiaryId, companyId)
      .then((account) => { if (active) setBankAccount(account) })
      .finally(() => { if (active) setBankLoading(false) })
    return () => { active = false }
  }, [beneficiaryId, companyId])

  useEffect(() => {
    const month = monthInputToDate(budgetMonth)
    if (!companyId || !costCenterId || !month) {
      setBudgetRows([])
      setCategoryDisabled(true)
      setCategoryHint('Selecciona centro de costo y mes para cargar las partidas.')
      return
    }
    let active = true
    setCategoryDisabled(true)
    loadBudgetAvailability(companyId, costCenterId, month)
      .then((rows) => {
        if (!active) return
        const sorted = sortAvailabilityRows(rows, categoryById)
        setBudgetRows(sorted)
        setCategoryDisabled(!sorted.length)
        setCategoryHint(sorted.length
          ? `${sorted.length} partidas disponibles para esta combinación.`
          : 'No hay partidas activas para esta combinación.')
      })
      .catch((error) => {
        if (!active) return
        setBudgetRows([])
        setCategoryDisabled(true)
        setCategoryHint(friendlyError(error, 'budget_availability'))
      })
    return () => { active = false }
    // categoryById sólo resuelve etiquetas del catálogo ya cargado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, costCenterId, budgetMonth, budgetCategories])

  const categoryLabel = useMemo(() => (categoryId: string) => {
    const row = budgetRows.find((candidate) => candidate.budget_category_id === categoryId)
    return row
      ? budgetCategoryAvailabilityLabel(categoryById(categoryId), row)
      : budgetCategoryLabel(categoryById(categoryId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetRows, budgetCategories])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (saving || loading) return
    if (!beneficiaryId) {
      showToast('Revisa el reembolso', 'Selecciona al beneficiario.', 'warning')
      return
    }
    if (employeeBankAccountIssues(bankAccount).length) {
      showToast('Revisa el reembolso', 'Completa los datos bancarios del beneficiario.', 'warning')
      return
    }
    if (!costCenterId || !monthInputToDate(budgetMonth)) {
      showToast('Revisa el reembolso', 'Selecciona centro de costo y mes presupuestal.', 'warning')
      return
    }
    if (!description.trim()) {
      showToast('Revisa el reembolso', 'Captura la descripción general.', 'warning')
      return
    }
    const itemsError = validateReimbursementItems(items)
    if (itemsError) {
      showToast('Revisa el desglose', itemsError, 'warning')
      return
    }

    setSaving(true)
    try {
      const persistedItems: ReimbursementUpdateItem[] = []
      for (const item of items) {
        let storagePath = item.existingStoragePath || null
        if (item.file) {
          storagePath = await uploadReceipt(item.file, `solicitudes/${request.id}/reembolso`)
        }
        persistedItems.push({
          budget_category_id: item.budgetCategoryId,
          descripcion: item.descripcion.trim(),
          amount: numberValue(item.amount),
          subtotal_amount: item.subtotalAmount,
          tax_amount: item.taxAmount,
          deducible: item.deducible,
          invoice_uuid: item.invoiceUuid,
          cfdi_data: item.cfdiData,
          storage_path: storagePath,
        })
      }

      await updateReimbursementRequest({
        payment_request_id: request.id,
        beneficiary_profile_id: beneficiaryId,
        cost_center_id: costCenterId,
        budget_month: monthInputToDate(budgetMonth)!,
        currency,
        exchange_rate: numberValue(exchangeRate) || 1,
        description: description.trim(),
        notes: notes.trim() || null,
        payment_method: paymentMethod,
        is_extraordinary_adjustment: isExtraordinary,
        items: persistedItems,
      })
      showToast('Reembolso actualizado', 'Los cambios y el desglose quedaron guardados.', 'success')
      onSaved()
    } catch (error: any) {
      showToast('No se pudo actualizar', friendlyError(error, 'update_reimbursement_request'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialogRef} className={s.dialog} onCancel={onClose} onClose={onClose}>
      <form className={s.modal} onSubmit={onSubmit}>
        <div className={s.modalHead}>
          <div>
            <h2>Editar reembolso</h2>
            <p>{request.request_number || 'Sin folio'} · sólo solicitudes abiertas</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>

        <div className={s.modalScroll}>
          {loading ? (
            <section className={s.formSection}><h3>Cargando reembolso…</h3></section>
          ) : (
            <>
              <section className={s.formSection}>
                <h3>Datos del reembolso</h3>
                <div className={s.formGrid}>
                  <label>Empresa
                    <input className={s.formControl} value={companyName(company)} disabled />
                  </label>
                  <label>Centro de costo *
                    <select className={s.formControl} value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)} required>
                      <option value="">Seleccionar centro de costo</option>
                      {costCenters.map((center) => <option key={center.id} value={center.id}>{costCenterName(center)}</option>)}
                    </select>
                  </label>
                  <label>Mes presupuestal *
                    <input className={s.formControl} type="month" value={budgetMonth} onChange={(event) => setBudgetMonth(event.target.value)} required />
                  </label>
                  <label>Método de pago *
                    <select className={s.formControl} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} required>
                      <option value="transfer">Transferencia</option>
                      <option value="cash">Efectivo</option>
                      <option value="check">Cheque</option>
                      <option value="other">Otro</option>
                    </select>
                  </label>
                  <label>Moneda *
                    <select className={s.formControl} value={currency} onChange={(event) => setCurrency(event.target.value)} required>
                      <option value="MXN">MXN</option>
                      <option value="USD">USD</option>
                    </select>
                  </label>
                  {isUsd && (
                    <label>Tipo de cambio *
                      <input className={s.formControl} type="number" min="0.0001" step="0.0001" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} required />
                    </label>
                  )}
                  <label className={s.checkboxCard}>
                    <input type="checkbox" checked={isExtraordinary} onChange={(event) => setIsExtraordinary(event.target.checked)} />
                    Ajuste extraordinario
                  </label>
                  <label className={s.fullRow}>Descripción *
                    <textarea className={s.formControl} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} required />
                  </label>
                  <label className={s.fullRow}>Notas
                    <textarea className={s.formControl} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
                  </label>
                  <div className={`${s.fieldHint} ${s.fullRow}`}>{categoryHint}</div>
                </div>
              </section>

              <ReimbursementSection
                profiles={profiles}
                companyId={companyId}
                canChooseBeneficiary
                beneficiaryId={beneficiaryId}
                onBeneficiaryChange={setBeneficiaryId}
                bankAccount={bankAccount}
                bankLoading={bankLoading}
                onBankLoaded={setBankAccount}
                items={items}
                onItemsChange={setItems}
                categoryRows={budgetRows}
                categoryLabel={categoryLabel}
                categoryDisabled={categoryDisabled}
                currency={currency}
              />
            </>
          )}
        </div>

        <div className={s.modalActions}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
          <button type="submit" className={s.primaryBtn} disabled={saving || loading}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
