import { useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { ProviderCombo } from './ProviderCombo'
import { QuickProviderModal } from './QuickProviderModal'
import {
  loadBudgetAvailability, listApproverOptions, createPaymentRequest,
  updateFase2Metadata, uploadReceipt, linkInvoicePath,
} from './api'
import {
  companyName, costCenterName, budgetCategoryLabel, proveedorLabel,
  budgetCategoryAvailabilityLabel, getAvailableAmount, sortAvailabilityRows,
  monthInputToDate, formatCurrencyC, formatMonth, validateReceiptFile,
  candidateMatchesSelection, validateRequestPayload, normalizeRequestType,
  normalizePaymentMethod, requestTypeLabel, paymentMethodLabel, isApproverStaleError,
  friendlyError, normalizeRpcResult, REQUEST_TYPE_OPTIONS, PAYMENT_METHOD_OPTIONS,
} from './logic'
import { numberValue } from '../../lib/format'
import type {
  Company, CostCenter, BudgetCategory, Proveedor, BudgetAvailabilityRow,
  ApproverCandidate, ApproverSelection, RequestPayload, Profile,
} from './types'
import s from './Solicitudes.module.css'

function defaultMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function RequestModal({
  companies,
  costCenters,
  budgetCategories,
  proveedores,
  profile,
  canApprove,
  showNomina,
  onProviderCreated,
  onClose,
  onCreated,
}: {
  companies: Company[]
  costCenters: CostCenter[]
  budgetCategories: BudgetCategory[]
  proveedores: Proveedor[]
  profile: Profile | null
  canApprove: boolean
  showNomina: boolean
  onProviderCreated: (p: Proveedor) => void
  onClose: () => void
  onCreated: (requestId: string | null) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { showToast } = useToast()

  const [requestType, setRequestType] = useState('provider_payment')
  const [paymentMethod, setPaymentMethod] = useState('transfer')
  const [companyId, setCompanyId] = useState('')
  const [costCenterId, setCostCenterId] = useState('')
  const [budgetMonth, setBudgetMonth] = useState(defaultMonth())
  const [budgetCategoryId, setBudgetCategoryId] = useState('')
  const [categorySearch, setCategorySearch] = useState('')
  const [proveedorId, setProveedorId] = useState('')
  const [providerSearch, setProviderSearch] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('MXN')
  const [exchangeRate, setExchangeRate] = useState('1')
  const [isExtraordinary, setIsExtraordinary] = useState(false)
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileHint, setFileHint] = useState('JPG, PNG, WEBP, PDF o XML · máx. 10 MB')
  // cash/check delivery
  const [responsibleId, setResponsibleId] = useState(profile?.id ?? '')
  const [dueDate, setDueDate] = useState('')
  const [deliveryMethod, setDeliveryMethod] = useState('cash')

  const [budgetRows, setBudgetRows] = useState<BudgetAvailabilityRow[]>([])
  const [categoryHelp, setCategoryHelp] = useState({ text: 'Selecciona empresa, centro de costo y mes para cargar partidas disponibles.', state: '' })
  const [categoryDisabled, setCategoryDisabled] = useState(true)

  const [candidates, setCandidates] = useState<ApproverCandidate[]>([])
  const [approverId, setApproverId] = useState('')
  const [approverDisabled, setApproverDisabled] = useState(true)
  const [approverPlaceholder, setApproverPlaceholder] = useState('Completa empresa, centro de costo y monto')
  const [approverHelp, setApproverHelp] = useState({ text: 'Cuando completes los datos de la solicitud, mostraremos los aprobadores disponibles.', color: '' })

  const [submitting, setSubmitting] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [success, setSuccess] = useState<{ folio: string; requestType: string; paymentMethod: string; warning: string } | null>(null)

  const approverVersion = useRef(0)
  const pendingSelection = useRef<ApproverSelection | null>(null)
  const amountTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
  }, [])

  const isCashOrCheck = paymentMethod === 'cash' || paymentMethod === 'check'
  const isUsd = currency === 'USD'

  const availabilityForCategory = (id: string | null) => budgetRows.find((r) => r.budget_category_id === id) || null
  const categoryById = (id: string) => budgetCategories.find((c) => c.id === id) || null

  const filteredCategoryRows = useMemo(() => {
    const q = categorySearch.trim().toLowerCase()
    if (!q) return budgetRows
    return budgetRows.filter((r) => {
      const cat = categoryById(r.budget_category_id!)
      return budgetCategoryAvailabilityLabel(cat, r).toLowerCase().includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetRows, categorySearch])

  // ── Carga de partidas al cambiar empresa / CC / mes ──────────────────────
  async function reloadBudgetCategories(nextCompany: string, nextCC: string, nextMonth: string) {
    setBudgetCategoryId('')
    const month = monthInputToDate(nextMonth)
    if (!nextCompany || !nextCC || !month) {
      setBudgetRows([])
      setCategoryDisabled(true)
      setCategorySearch('')
      setCategoryHelp({ text: 'Selecciona empresa, centro de costo y mes para cargar partidas disponibles.', state: '' })
      return
    }
    setCategoryDisabled(true)
    setCategoryHelp({ text: 'Consultando presupuesto activo para la combinacion seleccionada.', state: '' })
    try {
      const data = await loadBudgetAvailability(nextCompany, nextCC, month)
      const rows = sortAvailabilityRows(data, categoryById)
      setBudgetRows(rows)
      if (!rows.length) {
        setCategoryDisabled(true)
        setCategoryHelp({ text: 'No hay partidas presupuestales disponibles para esta empresa, centro de costo y mes.', state: 'warning' })
        return
      }
      setCategoryDisabled(false)
      setCategorySearch('')
      setCategoryHelp({ text: `${rows.length} partidas disponibles para la combinacion seleccionada.`, state: 'success' })
    } catch (error) {
      setBudgetRows([])
      setCategoryDisabled(true)
      setCategoryHelp({ text: friendlyError(error, 'budget_availability'), state: 'error' })
      showToast('Partidas no disponibles', friendlyError(error, 'budget_availability'), 'error')
    }
  }

  // ── Carga de aprobadores (con preservación de selección) ─────────────────
  function resetApprovers(placeholder: string, preservePending: boolean) {
    if (!preservePending) pendingSelection.current = null
    else {
      const sel = candidates.find((c) => c.profile_id === approverId)
      if (sel) pendingSelection.current = { profile_id: sel.profile_id, assignment_id: sel.assignment_id || null, source: sel.source || 'approval_rules' }
    }
    setCandidates([])
    setApproverId('')
    setApproverDisabled(true)
    setApproverPlaceholder(placeholder)
    setApproverHelp({ text: 'Cuando completes los datos de la solicitud, mostraremos los aprobadores disponibles.', color: '' })
  }

  async function loadApprovers() {
    const amt = numberValue(amount)
    const version = ++approverVersion.current
    if (!companyId || !costCenterId || amt <= 0) {
      resetApprovers('Completa empresa, centro de costo y monto', true)
      return
    }
    resetApprovers('Cargando aprobadores disponibles...', true)
    let data: ApproverCandidate[]
    try {
      data = await listApproverOptions(companyId, costCenterId, amt)
    } catch (error) {
      if (version !== approverVersion.current) return
      setApproverPlaceholder('No se pudieron cargar aprobadores')
      setApproverHelp({ text: friendlyError(error, 'list_payment_request_approver_options'), color: 'var(--ruby)' })
      return
    }
    if (version !== approverVersion.current) return
    const previous = pendingSelection.current
    pendingSelection.current = null
    if (!data.length) {
      setCandidates([])
      setApproverDisabled(true)
      setApproverPlaceholder('Sin aprobadores disponibles')
      setApproverHelp({ text: 'No hay aprobadores disponibles para esta empresa y condiciones. Solicita a un administrador configurar uno.', color: 'var(--amber)' })
      return
    }
    setCandidates(data)
    setApproverDisabled(false)
    setApproverPlaceholder('Seleccionar aprobador')
    const preserved = previous ? data.find((c) => candidateMatchesSelection(c, previous)) : null
    let nextId = ''
    if (preserved) nextId = preserved.profile_id
    else if (data.length === 1) nextId = data[0].profile_id
    setApproverId(nextId)
    const source = data[0]?.source
    const sourceHelp = source === 'assigned'
      ? 'Selecciona uno de los aprobadores configurados para ti en esta empresa.'
      : 'No tienes aprobadores configurados. Se muestran usuarios elegibles según las reglas de aprobación.'
    let text = sourceHelp
    if (data.length === 1) text = `Único aprobador disponible para estas condiciones. ${sourceHelp}`
    else if (previous && !preserved) text = `La selección anterior ya no está disponible. ${sourceHelp}`
    const color = previous && !preserved ? 'var(--amber)' : source === 'assigned' ? 'var(--accent-text)' : ''
    setApproverHelp({ text, color })
  }

  // Recarga aprobadores cuando cambian empresa/CC (inmediato) o monto (debounce).
  useEffect(() => {
    loadApprovers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, costCenterId])

  useEffect(() => {
    window.clearTimeout(amountTimer.current)
    amountTimer.current = window.setTimeout(() => loadApprovers(), 300)
    return () => window.clearTimeout(amountTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount])

  function onCompanyChange(v: string) { setCompanyId(v); reloadBudgetCategories(v, costCenterId, budgetMonth) }
  function onCostCenterChange(v: string) { setCostCenterId(v); reloadBudgetCategories(companyId, v, budgetMonth) }
  function onMonthChange(v: string) { setBudgetMonth(v); reloadBudgetCategories(companyId, costCenterId, v) }

  function onCurrencyChange(v: string) {
    setCurrency(v)
    if (v !== 'USD') setExchangeRate('1')
    else if (!exchangeRate || Number(exchangeRate) <= 0) setExchangeRate('1')
  }

  function onFile(f: File | null) {
    setFile(f)
    if (!f) { setFileHint('JPG, PNG, WEBP, PDF o XML · máx. 10 MB'); return }
    const res = validateReceiptFile(f)
    if (!res.ok) { setFile(null); setFileHint(res.message) } else setFileHint(res.message)
  }

  function onProviderSelect(id: string, label: string) {
    setProveedorId(id)
    setProviderSearch(label)
    if (id) {
      // Aplica método de pago preferido del proveedor (bindProviderPreferredMethod).
      const p = proveedores.find((x) => x.id === id)
      if (p?.metodo_pago) setPaymentMethod(normalizePaymentMethod(p.metodo_pago))
    }
  }

  function onQuickCreated(p: Proveedor) {
    onProviderCreated(p)
    onProviderSelect(p.id, proveedorLabel(p))
    setQuickOpen(false)
  }

  // ── Summary panel derived ────────────────────────────────────────────────
  const company = companies.find((c) => c.id === companyId) || null
  const center = costCenters.find((c) => c.id === costCenterId) || null
  const category = categoryById(budgetCategoryId)
  const availability = availabilityForCategory(budgetCategoryId)
  const proveedor = proveedores.find((p) => p.id === proveedorId) || null
  const approver = candidates.find((c) => c.profile_id === approverId) || null

  function collectPayload(): RequestPayload {
    const cur = currency || 'MXN'
    const selected = candidates.find((c) => c.profile_id === approverId)
    return {
      request_type: normalizeRequestType(requestType || 'provider_payment'),
      payment_method: normalizePaymentMethod(paymentMethod || 'transfer'),
      proveedor_id: proveedorId || null,
      company_id: companyId || null,
      approver_id: approverId || null,
      approver_assignment_id: selected?.assignment_id || null,
      cost_center_id: costCenterId || null,
      budget_category_id: budgetCategoryId || null,
      budget_month: monthInputToDate(budgetMonth),
      amount_requested: numberValue(amount),
      currency: cur,
      exchange_rate: cur === 'MXN' ? 1 : numberValue(exchangeRate),
      description: description.trim(),
      notes: notes.trim() || null,
      requested_by: profile?.id || null,
      is_extraordinary_adjustment: Boolean(canApprove && isExtraordinary),
      responsible_profile_id: responsibleId || null,
      due_date: dueDate || null,
      delivery_method: deliveryMethod || normalizePaymentMethod(paymentMethod),
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return

    // Nómina usa el contrato de staging N2B dedicado; no se crea vía este RPC.
    if (normalizeRequestType(requestType) === 'nomina') {
      showToast('Nómina', 'La captura de Nómina se realiza en su flujo dedicado (N2B). No se crea desde este formulario.', 'warning')
      return
    }

    const payload = collectPayload()
    const validation = validateRequestPayload(payload, availabilityForCategory, candidates)
    if (validation) { showToast('Revisa la solicitud', validation, 'warning'); return }

    setSubmitting(true)
    try {
      const data = await createPaymentRequest(payload)
      const result = normalizeRpcResult<any>(data)
      const requestId = result.payment_request_id || result.id || null
      if (!requestId) throw new Error('No se obtuvo el id de la solicitud creada.')

      const warning = await updateFase2Metadata(requestId, payload.request_type, payload.payment_method)

      // Metadata local de efectivo/cheque (persistCashMetadataIfNeeded).
      if (['cash', 'check'].includes(payload.payment_method)) {
        try {
          localStorage.setItem(`flux-cash-request-${requestId}`, JSON.stringify({
            responsible_profile_id: payload.responsible_profile_id,
            due_date: payload.due_date,
            delivery_method: payload.payment_method,
          }))
        } catch { /* ignore */ }
      }

      // Adjunto de comprobante.
      if (file) {
        try {
          const path = await uploadReceipt(file, `solicitudes/${requestId}`)
          await linkInvoicePath(requestId, path)
        } catch {
          showToast('Comprobante no vinculado', 'La solicitud se creo, pero el comprobante no pudo subirse o vincularse.', 'warning')
        }
      }

      const folio = result.request_number || result.payment_request_number || 'Solicitud'
      showToast('Solicitud creada', `${folio} creada correctamente.`, 'success')
      if (warning) showToast('Metodo de pago pendiente', warning, 'warning')
      setSuccess({ folio, requestType: payload.request_type, paymentMethod: payload.payment_method, warning })
      onCreated(requestId)
    } catch (error) {
      if (isApproverStaleError(error)) {
        await loadApprovers()
        setApproverHelp((h) => ({ text: `La lista de aprobadores cambió. Revisa y selecciona nuevamente. ${h.text}`.trim(), color: 'var(--amber)' }))
      }
      showToast('No se pudo crear la solicitud', friendlyError(error, 'create_payment_request'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  function resetForAnother() {
    setSuccess(null)
    setRequestType('provider_payment'); setPaymentMethod('transfer')
    setCompanyId(''); setCostCenterId(''); setBudgetMonth(defaultMonth()); setBudgetCategoryId('')
    setProveedorId(''); setProviderSearch(''); setAmount(''); setCurrency('MXN'); setExchangeRate('1')
    setIsExtraordinary(false); setDescription(''); setNotes(''); setFile(null)
    setFileHint('JPG, PNG, WEBP, PDF o XML · máx. 10 MB')
    setResponsibleId(profile?.id ?? ''); setDueDate(''); setDeliveryMethod('cash')
    setBudgetRows([]); setCategoryDisabled(true); setCategorySearch('')
    setCategoryHelp({ text: 'Selecciona empresa, centro de costo y mes para cargar partidas disponibles.', state: '' })
    resetApprovers('Completa empresa, centro de costo y monto', false)
  }

  return (
    <dialog ref={dialogRef} className={`${s.dialog} ${s.wide}`} onCancel={onClose} onClose={onClose}>
      <form className={s.modal} onSubmit={onSubmit}>
        <div className={s.modalHead}>
          <div>
            <h2>{success ? 'Solicitud creada correctamente' : 'Nueva solicitud de pago'}</h2>
            <p>{success ? 'La solicitud ya fue registrada y esta disponible en la bandeja de solicitudes.' : 'Completa los datos operativos y financieros para validar presupuesto al guardar.'}</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>

        {success ? (
          <div className={s.modalScroll}>
            <section className={s.successPanel} role="status" aria-live="polite">
              <strong>Solicitud creada correctamente</strong>
              <span className={s.successFolio}>Folio: {success.folio}</span>
              <span>La solicitud ya fue registrada y esta disponible en la bandeja de solicitudes.</span>
              <span>Tipo de solicitud: {requestTypeLabel(success.requestType)}</span>
              <span>Metodo de pago: {paymentMethodLabel(success.paymentMethod)}</span>
              {success.warning && <span className={s.successWarning}>{success.warning}</span>}
            </section>
          </div>
        ) : (
          <div className={s.modalScroll} style={{ padding: 0 }}>
            <div className={s.requestLayout} style={{ padding: '0 2px 2px' }}>
              <div className={s.formSections}>
                <section className={s.formSection}>
                  <h3>Datos generales</h3>
                  <div className={s.formGrid}>
                    <label className={s.fullRow}>Tipo de solicitud *
                      <select className={s.formControl} value={requestType} onChange={(e) => setRequestType(e.target.value)} required>
                        {REQUEST_TYPE_OPTIONS.filter(([v]) => v !== 'nomina' || showNomina).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <span className={s.fieldHint}>Define la naturaleza de la solicitud. No determina si entra a layout bancario.</span>
                    </label>
                    <label>Empresa *
                      <select className={s.formControl} value={companyId} onChange={(e) => onCompanyChange(e.target.value)} required>
                        <option value="">Seleccionar empresa</option>
                        {companies.map((c) => <option key={c.id} value={c.id}>{companyName(c)}</option>)}
                      </select>
                    </label>
                    <label>Centro de costo *
                      <select className={s.formControl} value={costCenterId} onChange={(e) => onCostCenterChange(e.target.value)} required>
                        <option value="">Seleccionar centro de costo</option>
                        {costCenters.map((c) => <option key={c.id} value={c.id}>{costCenterName(c)}</option>)}
                      </select>
                    </label>
                    <label className={s.fullRow}>Partida presupuestal *
                      <input className={s.formControl} type="text" placeholder="Filtrar partida por nombre…" style={{ marginBottom: 6 }}
                        value={categorySearch} disabled={categoryDisabled} onChange={(e) => setCategorySearch(e.target.value)} />
                      <select className={s.formControl} value={budgetCategoryId} disabled={categoryDisabled} onChange={(e) => setBudgetCategoryId(e.target.value)} required>
                        <option value="">{categoryDisabled ? 'Selecciona empresa, centro de costo y mes' : 'Seleccionar partida presupuestal'}</option>
                        {filteredCategoryRows.map((r) => (
                          <option key={r.budget_category_id} value={r.budget_category_id!}>
                            {budgetCategoryAvailabilityLabel(categoryById(r.budget_category_id!), r)}
                          </option>
                        ))}
                      </select>
                      <div className={`${s.fieldHint} ${categoryHelp.state ? s[categoryHelp.state as 'success' | 'warning' | 'error'] : ''}`}>{categoryHelp.text}</div>
                    </label>
                    <label>Mes presupuestal *
                      <input className={s.formControl} type="month" value={budgetMonth} onChange={(e) => onMonthChange(e.target.value)} required />
                    </label>
                    <label className={s.fullRow}>Proveedor *
                      <ProviderCombo proveedores={proveedores} value={proveedorId} search={providerSearch} onSelect={onProviderSelect} onPlus={() => setQuickOpen(true)} />
                    </label>
                    <label className={s.fullRow}>Metodo de pago *
                      <select className={s.formControl} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} required>
                        {PAYMENT_METHOD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <span className={s.fieldHint}>Este metodo decide el flujo operativo: transferencia, efectivo, cheque u otro.</span>
                    </label>
                  </div>
                </section>

                <section className={`${s.formSection} ${isCashOrCheck ? '' : s.hidden}`}>
                  <h3>Datos de entrega</h3>
                  <div className={s.formGrid}>
                    <div className={`${s.fieldHint} ${s.fullRow}`}>Estos datos se usan cuando el metodo de pago es efectivo o cheque.</div>
                    <label>Responsable del gasto *
                      <select className={s.formControl} value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
                        {profile?.id
                          ? <option value={profile.id}>{profile.full_name || profile.email || 'Usuario actual'}</option>
                          : <option value="">Seleccionar responsable</option>}
                      </select>
                    </label>
                    <label>Fecha limite de comprobacion *
                      <input className={s.formControl} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                    </label>
                    <label>Metodo de entrega *
                      <select className={s.formControl} value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)}>
                        <option value="cash">Efectivo</option>
                        <option value="check">Cheque</option>
                      </select>
                    </label>
                    <div className={`${s.fieldHint} ${s.fullRow}`}>Se guardara como metadata operativa local hasta que exista el fondo.</div>
                  </div>
                </section>

                <section className={s.formSection}>
                  <h3>Datos financieros</h3>
                  <div className={s.formGrid}>
                    <label>Monto solicitado *
                      <input className={s.formControl} type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                    </label>
                    <label>Moneda *
                      <select className={s.formControl} value={currency} onChange={(e) => onCurrencyChange(e.target.value)} required>
                        <option value="MXN">MXN</option>
                        <option value="USD">USD</option>
                      </select>
                    </label>
                    <label className={isUsd ? '' : s.hidden}>Tipo de cambio *
                      <input className={s.formControl} type="number" min="0.0001" step="0.0001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
                    </label>
                    {canApprove && (
                      <label className={s.checkboxCard}>
                        <input type="checkbox" checked={isExtraordinary} onChange={(e) => setIsExtraordinary(e.target.checked)} />
                        Ajuste extraordinario
                      </label>
                    )}
                  </div>
                </section>

                <section className={s.formSection}>
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

                <section className={s.formSection}>
                  <h3>Revisión</h3>
                  <div className={s.formGrid}>
                    <label className={s.fullRow}>¿Quién revisará esta solicitud? *
                      <select className={s.formControl} value={approverId} disabled={approverDisabled} onChange={(e) => setApproverId(e.target.value)} required>
                        <option value="">{approverPlaceholder}</option>
                        {candidates.map((c) => (
                          <option key={c.profile_id + (c.assignment_id || '')} value={c.profile_id}>
                            {c.option_label || c.display_name || c.email || 'Sin nombre'}
                          </option>
                        ))}
                      </select>
                      <span className={s.fieldHint} style={{ color: approverHelp.color || undefined }}>{approverHelp.text}</span>
                    </label>
                  </div>
                </section>
              </div>

              <aside className={s.summaryPanel}>
                <h3>Resumen</h3>
                <p>Vista previa de la solicitud antes de validar.</p>
                <div className={s.summaryList}>
                  <label>Empresa <span className={s.summaryValue}>{company ? companyName(company) : 'Sin seleccionar'}</span></label>
                  <label>Aprobador seleccionado <span className={s.summaryValue}>{approver
                    ? `${approver.display_name || approver.email}${approver.eligible_roles?.length ? ` · ${approver.eligible_roles.join(', ')}` : ''}${approver.source === 'assigned' ? ' · Configurado' : ' · Elegible por reglas'}`
                    : 'Pendiente de seleccionar'}</span></label>
                  <label>Centro de costo <span className={s.summaryValue}>{center ? costCenterName(center) : 'Sin seleccionar'}</span></label>
                  <label>Partida <span className={s.summaryValue}>{category ? `${budgetCategoryLabel(category)} | Disp. ${formatCurrencyC(getAvailableAmount(availability), 'MXN')}` : 'Sin seleccionar'}</span></label>
                  <label>Proveedor <span className={s.summaryValue}>{proveedor ? proveedorLabel(proveedor) : 'Sin seleccionar'}</span></label>
                  <label>Mes <span className={s.summaryValue}>{budgetMonth ? formatMonth(`${budgetMonth}-01`) : 'Sin seleccionar'}</span></label>
                  <label>Monto <span className={s.summaryValue}>{formatCurrencyC(numberValue(amount), currency)}</span></label>
                </div>
                <div className={s.summaryNote}>Al guardar, el sistema validara automaticamente la disponibilidad presupuestal.</div>
              </aside>
            </div>
          </div>
        )}

        <div className={s.modalActions}>
          {success ? (
            <>
              <button type="button" className={s.secondaryBtn} onClick={resetForAnother}>Crear otra solicitud</button>
              <button type="button" className={s.primaryBtn} onClick={onClose}>Cerrar y ver solicitudes</button>
            </>
          ) : (
            <>
              <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
              <button type="submit" className={s.primaryBtn} disabled={submitting}>{submitting ? 'Creando solicitud...' : 'Crear solicitud'}</button>
            </>
          )}
        </div>
      </form>

      {quickOpen && <QuickProviderModal onClose={() => setQuickOpen(false)} onCreated={onQuickCreated} />}
    </dialog>
  )
}
