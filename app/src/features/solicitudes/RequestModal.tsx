import { useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { ProviderCombo } from './ProviderCombo'
import { QuickProviderModal } from './QuickProviderModal'
import {
  loadBudgetAvailability, listApproverOptions, createPaymentRequest,
  updateFase2Metadata, uploadReceipt, linkInvoicePath, loadIncidencias,
  loadActiveProfiles, loadEmployeeBankAccount, setBeneficiaryProfile,
  insertReimbursementItems,
} from './api'
import {
  companyName, costCenterName, budgetCategoryLabel, proveedorLabel,
  budgetCategoryAvailabilityLabel, sortAvailabilityRows,
  monthInputToDate, formatCurrencyC, formatMonth, validateReceiptFile,
  candidateMatchesSelection, validateRequestPayload, normalizeRequestType,
  normalizePaymentMethod, requestTypeLabel, paymentMethodLabel, isApproverStaleError,
  friendlyError, normalizeRpcResult, REQUEST_TYPE_OPTIONS, PAYMENT_METHOD_OPTIONS,
  isReimbursement, reimbursementTotals, validateReimbursementItems,
  employeeBankAccountIssues,
} from './logic'
import { ReimbursementSection, emptyReimbursementItem } from './ReimbursementSection'
import { numberValue } from '../../lib/format'
import { parseCfdiFile } from './cfdi'
import { useAuth } from '../../lib/auth'
import { useCompany } from '../../lib/company'
import { useModules } from '../../lib/moduleAccess'
import type {
  Company, CostCenter, BudgetCategory, Proveedor, BudgetAvailabilityRow,
  ApproverCandidate, ApproverSelection, RequestPayload, Profile, IncidentCharge,
  EmployeeBankAccount, ReimbursementDraftItem, ReimbursementItemInsert,
} from './types'
import s from './Solicitudes.module.css'

function defaultMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const INCIDENT_STATUS_LABELS: Record<string, string> = {
  open: 'Abierta', invoiced: 'Facturada', paid: 'Cobrada', cancelled: 'Cancelada',
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
  const { memberships, group } = useAuth()
  const { companyId: activeCompanyId } = useCompany()
  // "Visita/incidencia asociada" es concepto de socios (Operadora). Solo se muestra
  // para empresas con el módulo incidencias habilitado.
  const { isEnabled } = useModules()
  const showIncidencias = isEnabled('incidencias')

  // El usuario solo puede crear para las empresas donde es miembro. Si tiene una
  // sola, queda fija; si tiene varias, arranca en la empresa activa del switcher.
  const myCompanies = useMemo(
    () => companies.filter((c) => memberships.some((m) => m.company_id === c.id)),
    [companies, memberships],
  )
  const lockedCompany = myCompanies.length === 1
  const initialCompanyId =
    activeCompanyId && myCompanies.some((c) => c.id === activeCompanyId)
      ? activeCompanyId
      : lockedCompany
        ? myCompanies[0].id
        : ''

  const [requestType, setRequestType] = useState('provider_payment')
  const [paymentMethod, setPaymentMethod] = useState('transfer')
  const [companyId, setCompanyId] = useState(initialCompanyId)
  const [costCenterId, setCostCenterId] = useState('')
  const [budgetMonth, setBudgetMonth] = useState(defaultMonth())
  const [budgetCategoryId, setBudgetCategoryId] = useState('')
  const [categorySearch, setCategorySearch] = useState('')
  const [proveedorId, setProveedorId] = useState('')
  const [providerSearch, setProviderSearch] = useState('')
  const [amount, setAmount] = useState('')
  // Desglose fiscal (opcional): el budget descuenta el subtotal cuando existe.
  const [subtotal, setSubtotal] = useState('')
  const [taxAmount, setTaxAmount] = useState('')
  const [withholding, setWithholding] = useState('')
  const [cfdiHint, setCfdiHint] = useState('')
  const [currency, setCurrency] = useState('MXN')
  const [exchangeRate, setExchangeRate] = useState('1')
  const [isExtraordinary, setIsExtraordinary] = useState(false)
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileHint, setFileHint] = useState('JPG, PNG, WEBP, PDF o XML · máx. 10 MB')
  const [incidents, setIncidents] = useState<IncidentCharge[]>([])
  const [membersById, setMembersById] = useState<Map<string, string>>(new Map())
  const [incidentId, setIncidentId] = useState('')
  const [incidentLoadState, setIncidentLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  // cash/check delivery
  const [responsibleId, setResponsibleId] = useState(profile?.id ?? '')
  const [dueDate, setDueDate] = useState('')
  const [deliveryMethod, setDeliveryMethod] = useState('cash')

  // ── Reembolso ────────────────────────────────────────────────────────────
  // El beneficiario arranca en el usuario actual; Finanzas/sysadmin puede
  // capturar el reembolso a nombre de otra persona.
  const canChooseBeneficiary = group === 'sysadmin' || group === 'admin_finance'
  const [beneficiaryId, setBeneficiaryId] = useState(profile?.id ?? '')
  const [beneficiaryProfiles, setBeneficiaryProfiles] = useState<Profile[]>([])
  const [bankAccount, setBankAccount] = useState<EmployeeBankAccount | null>(null)
  const [bankLoading, setBankLoading] = useState(false)
  const [items, setItems] = useState<ReimbursementDraftItem[]>([emptyReimbursementItem()])

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

  useEffect(() => {
    if (!showIncidencias) { setIncidentLoadState('ready'); return }
    let active = true
    loadIncidencias()
      .then(({ incidents: rows, membersById: members }) => {
        if (!active) return
        setIncidents(rows)
        setMembersById(members)
        setIncidentLoadState('ready')
      })
      .catch(() => {
        if (!active) return
        setIncidents([])
        setIncidentLoadState('error')
      })
    return () => { active = false }
  }, [showIncidencias])

  const isReembolso = isReimbursement(requestType)

  // Catálogo de beneficiarios. Solo se carga en modo reembolso y solo si el
  // usuario puede elegir a alguien más; en el caso normal basta su propio perfil.
  useEffect(() => {
    if (!isReembolso || !companyId) return
    if (!canChooseBeneficiary) {
      setBeneficiaryProfiles(profile ? [profile] : [])
      return
    }
    let active = true
    loadActiveProfiles(companyId).then((rows) => {
      if (!active) return
      // Se asegura que el propio perfil esté en la lista aunque el select falle.
      const withSelf = profile && !rows.some((r) => r.id === profile.id) ? [profile, ...rows] : rows
      setBeneficiaryProfiles(withSelf)
    })
    return () => { active = false }
  }, [isReembolso, canChooseBeneficiary, profile, companyId])

  // Datos bancarios del beneficiario vigente.
  useEffect(() => {
    if (!isReembolso || !beneficiaryId || !companyId) { setBankAccount(null); return }
    let active = true
    setBankLoading(true)
    loadEmployeeBankAccount(beneficiaryId, companyId)
      .then((account) => { if (active) setBankAccount(account) })
      .finally(() => { if (active) setBankLoading(false) })
    return () => { active = false }
  }, [isReembolso, beneficiaryId, companyId])

  // Totales derivados del desglose: en reembolso mandan sobre monto/partida.
  const reembolsoTotals = useMemo(() => reimbursementTotals(items), [items])
  const effectiveAmount = isReembolso ? String(reembolsoTotals.total || '') : amount
  const effectiveCategoryId = isReembolso ? reembolsoTotals.dominantCategoryId : budgetCategoryId

  const isCashOrCheck = paymentMethod === 'cash' || paymentMethod === 'check'
  const isUsd = currency === 'USD'
  const selectedIncident = incidents.find((incident) => incident.id === incidentId) || null

  function incidentLabel(incident: IncidentCharge): string {
    const receiver = incident.member_id
      ? (membersById.get(incident.member_id) || 'Socio')
      : (incident.external_name || 'Externo')
    return [
      incident.incident_date ? new Intl.DateTimeFormat('es-MX').format(new Date(`${incident.incident_date}T12:00:00`)) : 'Sin fecha',
      receiver,
      incident.description || 'Sin descripcion',
      formatCurrencyC(incident.amount, 'MXN'),
      INCIDENT_STATUS_LABELS[incident.status || ''] || incident.status,
    ].filter(Boolean).join(' | ')
  }

  function notesWithIncidentMarker(): string | null {
    const clean = notes.replace(/\n?\[Visita\/incidencia asociada:[^\]]+\]/g, '').trim()
    const marker = selectedIncident ? `[Visita/incidencia asociada: ${selectedIncident.id} - ${incidentLabel(selectedIncident)}]` : ''
    return [clean, marker].filter(Boolean).join('\n') || null
  }

  const availabilityForCategory = (id: string | null) => budgetRows.find((r) => r.budget_category_id === id) || null
  const categoryById = (id: string) => budgetCategories.find((c) => c.id === id) || null

  const filteredCategoryRows = useMemo(() => {
    // Scoping por responsable: si la empresa usa el modelo (alguna partida tiene
    // responsable), cada quien ve SOLO sus partidas. Sysadmin ve todas. Empresas
    // sin responsables (p.ej. Operadora) no se filtran.
    const myEmail = (profile?.email || '').trim().toLowerCase()
    const usesResponsible = budgetRows.some((r) => (r.responsible_emails?.length ?? 0) > 0 || r.responsible_email)
    const scoped = usesResponsible && group !== 'sysadmin'
      ? budgetRows.filter((r) => {
          const emails = r.responsible_emails?.length
            ? r.responsible_emails
            : [String(r.responsible_email || '').trim().toLowerCase()]
          return emails.includes(myEmail)
        })
      : budgetRows
    const q = categorySearch.trim().toLowerCase()
    if (!q) return scoped
    return scoped.filter((r) => {
      const cat = categoryById(r.budget_category_id!)
      return budgetCategoryAvailabilityLabel(cat, r).toLowerCase().includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetRows, categorySearch, profile, group])

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
    // En reembolso el monto lo manda el desglose, no el input.
    const amt = numberValue(effectiveAmount)
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
  }, [effectiveAmount])

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
    setCfdiHint('')
    if (!f) { setFileHint('JPG, PNG, WEBP, PDF o XML · máx. 10 MB'); return }
    const res = validateReceiptFile(f)
    if (!res.ok) { setFile(null); setFileHint(res.message); return }
    setFileHint(res.message)
    // Autollenado del desglose desde el CFDI (XML). Solo rellena vacíos;
    // nunca pisa lo que el usuario ya capturó.
    if (/\.xml$/i.test(f.name) || f.type.includes('xml')) {
      parseCfdiFile(f).then((cfdi) => {
        if (!cfdi) return
        if (cfdi.subtotal != null) setSubtotal((prev) => prev || String(cfdi.subtotal))
        if (cfdi.traslados != null) setTaxAmount((prev) => prev || String(cfdi.traslados))
        if (cfdi.retenciones != null) setWithholding((prev) => prev || String(cfdi.retenciones))
        if (cfdi.total != null) setAmount((prev) => prev || String(cfdi.total))
        setCfdiHint('Desglose leído del CFDI. Verifica los importes antes de enviar.')
      })
    }
  }

  // Validación local del desglose (espejo de las reglas del RPC).
  function validateFiscalBreakdown(): string {
    const hasAny = subtotal !== '' || taxAmount !== '' || withholding !== ''
    if (!hasAny) return ''
    const sub = numberValue(subtotal)
    if (!(sub > 0)) return 'Captura el subtotal (gasto sin impuestos) del desglose fiscal.'
    const iva = taxAmount === '' ? 0 : numberValue(taxAmount)
    const ret = withholding === '' ? 0 : numberValue(withholding)
    if (iva < 0 || ret < 0) return 'IVA y retenciones no pueden ser negativos.'
    const total = numberValue(amount)
    if (Math.abs(sub + iva - ret - total) > 0.01) {
      return `El desglose no cuadra: ${formatCurrencyC(sub + iva - ret, currency)} (subtotal + IVA − retenciones) vs total ${formatCurrencyC(total, currency)}.`
    }
    return ''
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
  const category = categoryById(effectiveCategoryId)
  const availability = availabilityForCategory(effectiveCategoryId)
  const isNoBudgetCategory = category?.no_presupuestal === true || availability?.no_presupuestal === true
  const proveedor = proveedores.find((p) => p.id === proveedorId) || null
  const approver = candidates.find((c) => c.profile_id === approverId) || null

  function collectPayload(): RequestPayload {
    const cur = currency || 'MXN'
    const selected = candidates.find((c) => c.profile_id === approverId)
    return {
      request_type: normalizeRequestType(requestType || 'provider_payment'),
      payment_method: normalizePaymentMethod(paymentMethod || 'transfer'),
      // En reembolso no hay proveedor: el destinatario es el empleado y se
      // registra aparte, en beneficiary_profile_id.
      proveedor_id: isReembolso ? null : (proveedorId || null),
      company_id: companyId || null,
      approver_id: approverId || null,
      approver_assignment_id: selected?.assignment_id || null,
      cost_center_id: costCenterId || null,
      budget_category_id: effectiveCategoryId || null,
      budget_month: monthInputToDate(budgetMonth),
      amount_requested: numberValue(effectiveAmount),
      currency: cur,
      exchange_rate: cur === 'MXN' ? 1 : numberValue(exchangeRate),
      description: description.trim(),
      notes: notesWithIncidentMarker(),
      requested_by: profile?.id || null,
      is_extraordinary_adjustment: Boolean(canApprove && isExtraordinary),
      responsible_profile_id: responsibleId || null,
      due_date: dueDate || null,
      delivery_method: deliveryMethod || normalizePaymentMethod(paymentMethod),
      // Reembolso: quien cobra es el empleado; el RPC lo persiste en la
      // misma transacción que la solicitud.
      beneficiary_profile_id: isReembolso ? (beneficiaryId || null) : null,
      // Reembolso: el desglose fiscal global es la suma de los renglones
      // deducibles (los no deducibles no llevan IVA acreditable).
      subtotal_amount: isReembolso
        ? reembolsoTotals.subtotal
        : (subtotal === '' ? null : numberValue(subtotal)),
      tax_amount: isReembolso
        ? (reembolsoTotals.subtotal == null ? null : reembolsoTotals.tax ?? 0)
        : (subtotal === '' ? null : (taxAmount === '' ? 0 : numberValue(taxAmount))),
      withholding_amount: isReembolso
        ? (reembolsoTotals.subtotal == null ? null : 0)
        : (subtotal === '' ? null : (withholding === '' ? 0 : numberValue(withholding))),
      invoice_uuid: null,
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

    // Reembolso: se valida el desglose y al beneficiario antes de armar el payload.
    if (isReembolso) {
      if (!beneficiaryId) {
        showToast('Beneficiario requerido', 'Selecciona a quién se le reembolsa.', 'warning')
        return
      }
      const bankIssues = employeeBankAccountIssues(bankAccount)
      if (bankIssues.length) {
        showToast('Datos bancarios incompletos', `Falta ${bankIssues.join(', ')} del beneficiario. Captúralos para poder dispersar.`, 'warning')
        return
      }
      const itemsValidation = validateReimbursementItems(items)
      if (itemsValidation) { showToast('Revisa el desglose', itemsValidation, 'warning'); return }
    }

    const payload = collectPayload()
    const validation = validateRequestPayload(payload, availabilityForCategory, candidates)
    if (validation) { showToast('Revisa la solicitud', validation, 'warning'); return }

    // El desglose fiscal manual no aplica en reembolso: ahí sale de los renglones.
    const fiscalValidation = isReembolso ? '' : validateFiscalBreakdown()
    if (fiscalValidation) { showToast('Desglose fiscal', fiscalValidation, 'warning'); return }

    // Documento obligatorio en toda solicitud (política global). En reembolso
    // los comprobantes van por renglón, ya validados arriba.
    if (!isReembolso && !file) {
      showToast('Documento requerido', 'Adjunta la factura o comprobante antes de enviar la solicitud.', 'warning')
      return
    }

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

      // Reembolso: beneficiario + desglose. Todo posterior a la creación y no
      // bloqueante — la solicitud ya existe, así que los fallos solo se avisan.
      if (isReembolso) {
        // El beneficiario ya viajó en el RPC (transaccional). Este respaldo solo
        // cubre un ambiente sin el parámetro nuevo; si ya quedó grabado, no corre.
        if (!result.beneficiary_profile_id) {
          const beneficiaryWarning = await setBeneficiaryProfile(requestId, beneficiaryId)
          if (beneficiaryWarning) showToast('Beneficiario no registrado', beneficiaryWarning, 'warning')
        }

        const inserts: ReimbursementItemInsert[] = []
        let uploadFailures = 0
        for (const item of items) {
          let storagePath: string | null = null
          if (item.file) {
            try {
              storagePath = await uploadReceipt(item.file, `solicitudes/${requestId}/reembolso`)
            } catch {
              uploadFailures += 1
            }
          }
          inserts.push({
            payment_request_id: requestId,
            company_id: payload.company_id!,
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
        if (uploadFailures) {
          showToast('Comprobantes no subidos', `${uploadFailures} comprobante(s) del desglose no pudieron subirse. El renglón queda registrado sin archivo.`, 'warning')
        }
        const itemsWarning = await insertReimbursementItems(inserts)
        if (itemsWarning) showToast('Desglose no guardado', itemsWarning, 'warning')
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
    setSubtotal(''); setTaxAmount(''); setWithholding(''); setCfdiHint('')
    setIncidentId('')
    setFileHint('JPG, PNG, WEBP, PDF o XML · máx. 10 MB')
    setResponsibleId(profile?.id ?? ''); setDueDate(''); setDeliveryMethod('cash')
    setBeneficiaryId(profile?.id ?? ''); setBankAccount(null); setItems([emptyReimbursementItem()])
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
                  <h3>Datos del pago</h3>
                  <div className={s.formGrid}>
                    <label className={s.fullRow}>Metodo de pago *
                      <select className={s.formControl} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} required>
                        {PAYMENT_METHOD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <span className={s.fieldHint}>Este metodo decide el flujo operativo: transferencia, efectivo, cheque u otro.</span>
                    </label>
                    <label className={s.fullRow}>Tipo de solicitud *
                      <select className={s.formControl} value={requestType} onChange={(e) => setRequestType(e.target.value)} required>
                        {REQUEST_TYPE_OPTIONS.filter(([v]) => v !== 'nomina' || showNomina).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <span className={s.fieldHint}>Define la naturaleza de la solicitud. No determina si entra a layout bancario.</span>
                    </label>
                    <label>Monto solicitado *
                      {/* En reembolso el monto es la suma del desglose: se muestra
                          calculado para que nadie lo edite por separado. */}
                      <input className={s.formControl} type="number" min="0.01" step="0.01" placeholder="0.00"
                        value={isReembolso ? (reembolsoTotals.total || '') : amount}
                        onChange={(e) => setAmount(e.target.value)}
                        readOnly={isReembolso} required />
                      {isReembolso && <span className={s.fieldHint}>Suma de los renglones del desglose de gastos.</span>}
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
                    <div className={`${s.fullRow} ${isReembolso ? s.hidden : ''}`}>
                      <div className={s.fieldHint} style={{ marginBottom: 4 }}>
                        Desglose fiscal (opcional) — si lo capturas, el presupuesto descuenta el subtotal (gasto sin IVA).
                        {cfdiHint && <strong> {cfdiHint}</strong>}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                        <label>Subtotal
                          <input className={s.formControl} type="number" min="0.01" step="0.01" placeholder="0.00" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} />
                        </label>
                        <label>IVA
                          <input className={s.formControl} type="number" min="0" step="0.01" placeholder="0.00" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
                        </label>
                        <label>Retenciones
                          <input className={s.formControl} type="number" min="0" step="0.01" placeholder="0.00" value={withholding} onChange={(e) => setWithholding(e.target.value)} />
                        </label>
                      </div>
                    </div>
                    {canApprove && (
                      <label className={s.checkboxCard}>
                        <input type="checkbox" checked={isExtraordinary} onChange={(e) => setIsExtraordinary(e.target.checked)} />
                        Ajuste extraordinario
                      </label>
                    )}
                    <label className={s.fullRow}>Descripcion *
                      <textarea className={s.formControl} rows={3} placeholder="Concepto de la solicitud..." value={description} onChange={(e) => setDescription(e.target.value)} required />
                    </label>
                    <label className={s.fullRow}>Notas
                      <textarea className={s.formControl} rows={2} placeholder="Notas internas opcionales..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </label>
                    {/* En reembolso los comprobantes van por renglón: cada uno es
                        de un comercio distinto, no hay una factura única. */}
                    <label className={`${s.fullRow} ${isReembolso ? s.hidden : ''}`}>Factura / comprobante *
                      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/xml,application/xml" onChange={(e) => onFile(e.target.files?.[0] ?? null)} required={!isReembolso} />
                      <span className={s.fileHint}>{fileHint}</span>
                    </label>
                  </div>
                </section>

                {isReembolso ? (
                  <ReimbursementSection
                    profiles={beneficiaryProfiles}
                    companyId={companyId}
                    canChooseBeneficiary={canChooseBeneficiary}
                    beneficiaryId={beneficiaryId}
                    onBeneficiaryChange={setBeneficiaryId}
                    bankAccount={bankAccount}
                    bankLoading={bankLoading}
                    onBankLoaded={setBankAccount}
                    items={items}
                    onItemsChange={setItems}
                    categoryRows={filteredCategoryRows}
                    categoryLabel={(id) => {
                      const row = availabilityForCategory(id)
                      return row ? budgetCategoryAvailabilityLabel(categoryById(id), row) : budgetCategoryLabel(categoryById(id))
                    }}
                    categoryDisabled={categoryDisabled}
                    currency={currency}
                  />
                ) : (
                  <section className={s.formSection}>
                    <h3>Proveedor / beneficiario</h3>
                    <div className={`${s.fieldHint} ${s.fullRow}`}>Selecciona el proveedor de forma independiente al presupuesto.</div>
                    <div className={s.formGrid}>
                      <label className={s.fullRow}>Proveedor *
                        <ProviderCombo proveedores={proveedores} value={proveedorId} search={providerSearch} onSelect={onProviderSelect} />
                      </label>
                    </div>
                  </section>
                )}

                <section className={s.formSection}>
                  <h3>Clasificacion presupuestal</h3>
                  <div className={`${s.fieldHint} ${s.fullRow}`}>Empresa, centro de costo, partida y mes para validar presupuesto.</div>
                  <div className={s.formGrid}>
                    <label>Empresa *
                      <select className={s.formControl} value={companyId} onChange={(e) => onCompanyChange(e.target.value)} required disabled={lockedCompany}>
                        {!lockedCompany && <option value="">Seleccionar empresa</option>}
                        {myCompanies.map((c) => <option key={c.id} value={c.id}>{companyName(c)}</option>)}
                      </select>
                    </label>
                    <label>Centro de costo *
                      <select className={s.formControl} value={costCenterId} onChange={(e) => onCostCenterChange(e.target.value)} required>
                        <option value="">Seleccionar centro de costo</option>
                        {costCenters.map((c) => <option key={c.id} value={c.id}>{costCenterName(c)}</option>)}
                      </select>
                    </label>
                    {/* En reembolso la partida se elige por renglón; la de la
                        solicitud sale del renglón de mayor monto. */}
                    <label className={`${s.fullRow} ${isReembolso ? s.hidden : ''}`}>Partida presupuestal *
                      <input className={s.formControl} type="text" placeholder="Filtrar partida por nombre…" style={{ marginBottom: 6 }}
                        value={categorySearch} disabled={categoryDisabled} onChange={(e) => setCategorySearch(e.target.value)} />
                      <select className={s.formControl} value={budgetCategoryId} disabled={categoryDisabled} onChange={(e) => setBudgetCategoryId(e.target.value)} required={!isReembolso}>
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
                  </div>
                </section>

                {showIncidencias && (
                <section className={s.formSection}>
                  <h3>Contexto operativo</h3>
                  <div className={`${s.fieldHint} ${s.fullRow}`}>Campo opcional para relacionar el pago con una visita o incidencia registrada.</div>
                  <div className={s.formGrid}>
                    <label className={s.fullRow}>Visita / Incidencia asociada
                      <select className={s.formControl} value={incidentId} onChange={(e) => setIncidentId(e.target.value)} disabled={incidentLoadState === 'loading'}>
                        <option value="">{incidentLoadState === 'loading' ? 'Cargando visitas/incidencias...' : 'Sin visita/incidencia asociada'}</option>
                        {incidents.map((incident) => <option key={incident.id} value={incident.id}>{incidentLabel(incident)}</option>)}
                      </select>
                    </label>
                    <div className={`${s.contextCard} ${incidentLoadState === 'error' ? s.contextError : selectedIncident ? s.contextSuccess : ''} ${s.fullRow}`}>
                      <strong>{incidentLoadState === 'error'
                        ? 'No se pudieron cargar visitas/incidencias.'
                        : selectedIncident
                          ? 'Visita/incidencia vinculada a esta solicitud.'
                          : incidents.length === 0 && incidentLoadState === 'ready'
                            ? 'No hay visitas/incidencias disponibles.'
                            : 'Asociacion opcional, no requerida para guardar.'}</strong>
                      <span>{selectedIncident
                        ? incidentLabel(selectedIncident)
                        : incidentLoadState === 'error'
                          ? 'Puedes guardar la solicitud sin asociarla.'
                          : 'La referencia seleccionada se guardara en las notas de la solicitud.'}</span>
                    </div>
                  </div>
                </section>
                )}

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
                  <h3>Revisión final</h3>
                  <div className={`${s.fieldHint} ${s.fullRow}`}>Después de completar los datos de la solicitud, selecciona quién realizará la revisión.</div>
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
                  <label>Partida <span className={s.summaryValue}>{category
                    ? (availability ? budgetCategoryAvailabilityLabel(category, availability) : budgetCategoryLabel(category))
                    : 'Sin seleccionar'}</span></label>
                  {isReembolso ? (
                    <label>Beneficiario <span className={s.summaryValue}>
                      {beneficiaryProfiles.find((p) => p.id === beneficiaryId)?.full_name
                        || beneficiaryProfiles.find((p) => p.id === beneficiaryId)?.email
                        || 'Sin seleccionar'}
                    </span></label>
                  ) : (
                    <label>Proveedor <span className={s.summaryValue}>{proveedor ? proveedorLabel(proveedor) : 'Sin seleccionar'}</span></label>
                  )}
                  <label>Mes <span className={s.summaryValue}>{budgetMonth ? formatMonth(`${budgetMonth}-01`) : 'Sin seleccionar'}</span></label>
                  <label>Monto <span className={s.summaryValue}>{formatCurrencyC(numberValue(effectiveAmount), currency)}</span></label>
                  {isReembolso && <label>Gastos <span className={s.summaryValue}>{items.length} renglón(es) en el desglose</span></label>}
                </div>
                <div className={s.summaryNote}>{isNoBudgetCategory
                  ? 'Esta partida no consume presupuesto y seguirá el flujo normal de autorización.'
                  : 'Al guardar, el sistema validara automaticamente la disponibilidad presupuestal.'}</div>
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
