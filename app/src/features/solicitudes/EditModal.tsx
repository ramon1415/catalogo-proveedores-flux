import { useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../lib/auth'
import { ProviderCombo } from './ProviderCombo'
import { loadBudgetAvailability, updatePaymentRequest, uploadReceipt } from './api'
import {
  companyName, costCenterName, budgetCategoryLabel, proveedorLabel,
  budgetCategoryAvailabilityLabel, sortAvailabilityRows, monthInputToDate,
  validateReceiptFile, friendlyError,
} from './logic'
import { numberValue } from '../../lib/format'
import type {
  PaymentRequest, Company, CostCenter, BudgetCategory, Proveedor, BudgetAvailabilityRow, EditPayload,
} from './types'
import s from './Solicitudes.module.css'

export function EditModal({
  request,
  companies,
  costCenters,
  budgetCategories,
  proveedores,
  onClose,
  onSaved,
}: {
  request: PaymentRequest
  companies: Company[]
  costCenters: CostCenter[]
  budgetCategories: BudgetCategory[]
  proveedores: Proveedor[]
  onClose: () => void
  onSaved: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { showToast } = useToast()
  const { profile } = useAuth()

  const [companyId, setCompanyId] = useState(request.company_id || '')
  const [costCenterId, setCostCenterId] = useState(request.cost_center_id || '')
  const [budgetMonth, setBudgetMonth] = useState(request.budget_month ? request.budget_month.slice(0, 7) : '')
  const [budgetCategoryId, setBudgetCategoryId] = useState(request.budget_category_id || '')
  const [categorySearch, setCategorySearch] = useState('')
  const [proveedorId, setProveedorId] = useState(request.proveedor_id || '')
  const initProv = proveedores.find((p) => p.id === request.proveedor_id) || null
  const [providerSearch, setProviderSearch] = useState(initProv ? proveedorLabel(initProv) : '')
  const [amount, setAmount] = useState(request.amount_requested != null ? String(request.amount_requested) : '')
  const [currency, setCurrency] = useState(request.currency || 'MXN')
  const [exchangeRate, setExchangeRate] = useState(request.exchange_rate != null ? String(request.exchange_rate) : '1')
  const [isExtraordinary, setIsExtraordinary] = useState(!!request.is_extraordinary_adjustment)
  const [description, setDescription] = useState(request.description || '')
  const [notes, setNotes] = useState(request.notes || '')
  const [file, setFile] = useState<File | null>(null)
  const [fileHint, setFileHint] = useState('JPG, PNG, WEBP, PDF o XML · máx. 10 MB')

  const [budgetRows, setBudgetRows] = useState<BudgetAvailabilityRow[]>([])
  const [categoryHelp, setCategoryHelp] = useState('Selecciona empresa, centro de costo y mes para cargar partidas disponibles.')
  const [categoryDisabled, setCategoryDisabled] = useState(true)
  const [saving, setSaving] = useState(false)

  const categoryById = (id: string) => budgetCategories.find((c) => c.id === id) || null
  const isUsd = currency === 'USD'

  useEffect(() => {
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
    // Carga inicial de partidas preservando la categoría actual.
    void reloadCategories(request.company_id || '', request.cost_center_id || '', request.budget_month ? request.budget_month.slice(0, 7) : '', request.budget_category_id || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function reloadCategories(nextCompany: string, nextCC: string, nextMonth: string, keepCategory = '') {
    if (!keepCategory) setBudgetCategoryId('')
    const month = monthInputToDate(nextMonth)
    if (!nextCompany || !nextCC || !month) {
      setBudgetRows([])
      setCategoryDisabled(true)
      setCategoryHelp('Selecciona empresa, centro de costo y mes para cargar partidas disponibles.')
      return
    }
    setCategoryDisabled(true)
    try {
      if (!profile?.id) throw new Error('No se pudo identificar el perfil activo.')
      const data = await loadBudgetAvailability(nextCompany, nextCC, month, profile.id)
      const rows = sortAvailabilityRows(data, categoryById)
      setBudgetRows(rows)
      if (!rows.length) {
        setCategoryDisabled(true)
        setCategoryHelp('No hay partidas activas para empresa, centro de costo y mes seleccionados.')
        return
      }
      setCategoryDisabled(false)
      setCategorySearch('')
      setCategoryHelp(`${rows.length} partidas disponibles para esta combinación.`)
      if (keepCategory) setBudgetCategoryId(keepCategory)
    } catch (error) {
      setBudgetRows([])
      setCategoryDisabled(false)
      setCategoryHelp(friendlyError(error, 'budget_availability'))
    }
  }

  const filteredRows = useMemo(() => {
    const q = categorySearch.trim().toLowerCase()
    if (!q) return budgetRows
    return budgetRows.filter((r) => budgetCategoryAvailabilityLabel(categoryById(r.budget_category_id!), r).toLowerCase().includes(q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetRows, categorySearch])

  function onFile(f: File | null) {
    setFile(f)
    if (!f) { setFileHint('JPG, PNG, WEBP, PDF o XML · máx. 10 MB'); return }
    const res = validateReceiptFile(f)
    if (!res.ok) { setFile(null); setFileHint(res.message) } else setFileHint(res.message)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    if (!proveedorId) { showToast('Revisa la solicitud', 'Selecciona un proveedor.', 'warning'); return }
    if (!budgetCategoryId) { showToast('Revisa la solicitud', 'Selecciona una partida presupuestal.', 'warning'); return }

    setSaving(true)
    const payload: EditPayload = {
      proveedor_id: proveedorId,
      company_id: companyId,
      cost_center_id: costCenterId,
      budget_category_id: budgetCategoryId,
      budget_month: monthInputToDate(budgetMonth),
      amount_requested: numberValue(amount),
      currency,
      exchange_rate: numberValue(exchangeRate) || 1,
      is_extraordinary_adjustment: isExtraordinary,
      description: description.trim(),
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    try {
      if (file) payload.invoice_storage_path = await uploadReceipt(file, `solicitudes/${request.id}`)
      await updatePaymentRequest(request.id, payload)
      showToast('Solicitud actualizada', 'Los cambios se guardaron correctamente.', 'success')
      onSaved()
    } catch (error: any) {
      showToast('Error al guardar', error?.message || 'No se pudo actualizar la solicitud.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialogRef} className={s.dialog} onCancel={onClose} onClose={onClose}>
      <form className={s.modal} onSubmit={onSubmit}>
        <div className={s.modalHead}>
          <div>
            <h2>Editar solicitud</h2>
            <p>{`${request.request_number || 'Sin folio'} · editando todos los campos`}</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className={s.modalScroll} style={{ padding: 0 }}>
          <div style={{ padding: '0 2px 2px' }}>
            <section className={s.formSection}>
              <h3>Datos generales</h3>
              <div className={s.formGrid}>
                <label>Empresa *
                  <select className={s.formControl} value={companyId} onChange={(e) => { setCompanyId(e.target.value); reloadCategories(e.target.value, costCenterId, budgetMonth) }} required>
                    {companies.map((c) => <option key={c.id} value={c.id}>{companyName(c)}</option>)}
                  </select>
                </label>
                <label>Centro de costo *
                  <select className={s.formControl} value={costCenterId} onChange={(e) => { setCostCenterId(e.target.value); reloadCategories(companyId, e.target.value, budgetMonth) }} required>
                    {costCenters.map((c) => <option key={c.id} value={c.id}>{costCenterName(c)}</option>)}
                  </select>
                </label>
                <label className={s.fullRow}>Partida presupuestal *
                  <input className={s.formControl} type="text" placeholder="Filtrar partida por nombre…" style={{ marginBottom: 6 }}
                    value={categorySearch} disabled={categoryDisabled} onChange={(e) => setCategorySearch(e.target.value)} />
                  <select className={s.formControl} value={budgetCategoryId} disabled={categoryDisabled} onChange={(e) => setBudgetCategoryId(e.target.value)} required>
                    <option value="">{categoryDisabled ? 'Selecciona empresa, centro de costo y mes' : 'Seleccionar partida presupuestal'}</option>
                    {filteredRows.map((r) => (
                      <option key={r.budget_category_id} value={r.budget_category_id!}>{budgetCategoryAvailabilityLabel(categoryById(r.budget_category_id!), r)}</option>
                    ))}
                  </select>
                  <div className={s.fieldHint}>{categoryHelp}</div>
                </label>
                <label>Mes presupuestal *
                  <input className={s.formControl} type="month" value={budgetMonth} onChange={(e) => { setBudgetMonth(e.target.value); reloadCategories(companyId, costCenterId, e.target.value) }} required />
                </label>
                <label className={s.fullRow}>Proveedor *
                  <ProviderCombo proveedores={proveedores} value={proveedorId} search={providerSearch} onSelect={(id, label) => { setProveedorId(id); setProviderSearch(label) }} />
                </label>
              </div>
            </section>

            <section className={s.formSection} style={{ marginTop: 12 }}>
              <h3>Datos financieros</h3>
              <div className={s.formGrid}>
                <label>Monto solicitado *
                  <input className={s.formControl} type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                </label>
                <label>Moneda *
                  <select className={s.formControl} value={currency} onChange={(e) => { setCurrency(e.target.value); if (e.target.value !== 'USD') setExchangeRate('1') }} required>
                    <option value="MXN">MXN</option>
                    <option value="USD">USD</option>
                  </select>
                </label>
                <label className={isUsd ? '' : s.hidden}>Tipo de cambio *
                  <input className={s.formControl} type="number" min="0.0001" step="0.0001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
                </label>
                <label className={s.checkboxCard}>
                  <input type="checkbox" checked={isExtraordinary} onChange={(e) => setIsExtraordinary(e.target.checked)} /> Ajuste extraordinario
                </label>
              </div>
            </section>

            <section className={s.formSection} style={{ marginTop: 12 }}>
              <h3>Descripcion</h3>
              <div className={s.formGrid}>
                <label className={s.fullRow}>Descripcion *
                  <textarea className={s.formControl} rows={3} placeholder="Concepto de la solicitud..." value={description} onChange={(e) => setDescription(e.target.value)} required />
                </label>
                <label className={s.fullRow}>Notas
                  <textarea className={s.formControl} rows={2} placeholder="Notas internas opcionales..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
                <label className={s.fullRow}>Factura / comprobante
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/xml,application/xml" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
                  <span className={s.fileHint}>{fileHint}</span>
                </label>
              </div>
            </section>
          </div>
        </div>
        <div className={s.modalActions}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
          <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Guardando...' : 'Guardar cambios'}</button>
        </div>
      </form>
    </dialog>
  )
}
