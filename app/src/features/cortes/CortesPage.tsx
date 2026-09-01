// Migración a React de approval_batches.html/.js — Cortes semanales.
// Orquesta vistas Finanzas/Dirección, detalle, decisiones, elegibles,
// reingresos, directores y contingencias extraordinarias (espejo 1:1 del vanilla).
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useCompany } from '../../lib/company'
import { perms } from '../../lib/roles'
import { Badge } from '../../components/ui/Badge'
import { useToast } from '../../components/ui/Toast'
import {
  addRequestToBatch, approveEntireBatch, closeApprovalBatch, decideApprovalBatchItems,
  getBatchDetail, getRegularizationEvidenceUrl, listActiveCompanies, listBatchEligibleRequests,
  listBatches, listCompanyDirectors, listRegularizations, previewBatchClose,
  removeRequestFromBatch, submitApprovalBatch,
} from './api'
import {
  BATCH_STATUS_FILTER_OPTIONS, asArray, closeBlockReasonLabel, extraordinaryCategoryLabel,
  filterBatches, formatCurrencyTotals, formatDate, formatDateTime, formatMoney, friendlyError,
  hasDirectorRole, regularizationStatusLabel, sortDirectorBatches, statusLabel, statusVariant,
} from './logic'
import { exportBatchCsv, exportBatchPdf } from './exports'
import { BatchDetail } from './BatchDetail'
import { ConfirmDialog, ConfirmRow, ConfirmTotals } from './ConfirmDialog'
import { CreateBatchDialog } from './CreateBatchDialog'
import { DirectorDialog } from './DirectorDialog'
import { RebatchDialog } from './RebatchDialog'
import { RegularizationDialog } from './RegularizationDialog'
import type {
  AddingProgress, BatchDetail as BatchDetailData, BatchListRow, BatchView, Company,
  DecisionDraft, DirectorRow, EligibleRequest, Regularization, RegularizationDecision,
} from './types'
import s from './Cortes.module.css'

type ConfirmRequest = { title: string; body: ReactNode; confirmLabel: string; resolve: (v: boolean) => void }

export default function CortesPage() {
  const { roles, group, loading } = useAuth()
  const { companyId } = useCompany()
  const { showToast } = useToast()

  // Gating espejo del vanilla: Finanzas = sysadmin/admin; Dirección = roles direccion.
  const isFinance = perms.isAdminFinance(group)
  const isDirector = hasDirectorRole(roles)
  const isAuthorized = isFinance || isDirector

  // La vista inicial depende del rol; null hasta que auth resuelva.
  const [view, setView] = useState<BatchView | null>(null)
  const [batches, setBatches] = useState<BatchListRow[]>([])
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const [detail, setDetail] = useState<BatchDetailData | null>(null)
  const [detailMsg, setDetailMsg] = useState('Selecciona un corte.')
  const [eligible, setEligible] = useState<EligibleRequest[]>([])
  const [ineligible, setIneligible] = useState<EligibleRequest[]>([])
  const [selectedEligibleIds, setSelectedEligibleIds] = useState<Set<string>>(new Set())
  const [addingProgress, setAddingProgress] = useState<AddingProgress>(null)
  const [decisions, setDecisions] = useState<Record<string, DecisionDraft>>({})

  const [companies, setCompanies] = useState<Company[]>([])
  const [directors, setDirectors] = useState<DirectorRow[]>([])
  const [regularizations, setRegularizations] = useState<Regularization[]>([])
  const [regsLoaded, setRegsLoaded] = useState(false)

  const [mutating, setMutatingState] = useState(false)
  const mutatingRef = useRef(false)
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [directorOpen, setDirectorOpen] = useState(false)
  const [rebatchItemId, setRebatchItemId] = useState<string | null>(null)
  const [regDialog, setRegDialog] = useState<{ row: Regularization; decision: RegularizationDecision } | null>(null)

  const itemsSectionRef = useRef<HTMLDivElement | null>(null)
  // batch_id en la URL selecciona el corte al entrar (igual que el vanilla).
  const initialBatchIdRef = useRef<string | null>(new URLSearchParams(window.location.search).get('batch_id'))

  function setLocked(value: boolean) {
    mutatingRef.current = value
    setMutatingState(value)
  }

  // Candado global anti doble-submit: cualquier error cae al toast genérico
  // "No se pudo completar" con el copy de friendlyError (espejo de handleDetailAction).
  async function runLocked(fn: () => Promise<void>) {
    if (mutatingRef.current) return
    setLocked(true)
    try {
      await fn()
    } catch (error) {
      showToast('No se pudo completar', friendlyError(error), 'error')
    } finally {
      setLocked(false)
    }
  }

  function askConfirmation(title: string, body: ReactNode, confirmLabel: string): Promise<boolean> {
    return new Promise((resolve) => setConfirmReq({ title, body, confirmLabel, resolve }))
  }

  function settleConfirm(confirmed: boolean) {
    confirmReq?.resolve(confirmed)
    setConfirmReq(null)
  }

  // ── Cargas ───────────────────────────────────────────────────────────────
  async function openBatch(batchId: string) {
    if (selectedIdRef.current !== batchId) setSelectedEligibleIds(new Set())
    selectedIdRef.current = batchId
    setSelectedId(batchId)
    setDetail(null)
    setDetailMsg('Cargando detalle...')
    try {
      const data = await getBatchDetail(batchId)
      let nextEligible: EligibleRequest[] = []
      let nextIneligible: EligibleRequest[] = []
      // Elegibles solo para Finanzas con corte en borrador.
      if (isFinance && data.batch?.status === 'draft') {
        const rows = await listBatchEligibleRequests(data.batch.company_id)
        const included = new Set(asArray(data.items).map((item) => item.payment_request_id))
        const candidates = rows.filter((item) => !included.has(item.id))
        nextEligible = candidates.filter((item) => item.eligible !== false)
        nextIneligible = candidates.filter((item) => item.eligible === false)
      }
      // Depura la selección contra los elegibles vigentes.
      const eligibleIds = new Set(nextEligible.map((item) => item.id))
      setSelectedEligibleIds((prev) => new Set(Array.from(prev).filter((id) => eligibleIds.has(id))))
      // Las decisiones capturadas se reinician al recargar detalle (como el vanilla,
      // que reconstruye el DOM completo).
      const drafts: Record<string, DecisionDraft> = {}
      asArray(data.items).forEach((item) => {
        if (item.director_status === 'pending') drafts[item.id] = { status: '', reason: '' }
      })
      setDecisions(drafts)
      setEligible(nextEligible)
      setIneligible(nextIneligible)
      setDetail(data)
    } catch (error) {
      setDetail(null)
      setDetailMsg(friendlyError(error))
      showToast('No se pudo abrir el corte', friendlyError(error), 'error')
    }
  }

  async function loadBatches(preferredId?: string | null) {
    if (!view) return
    setBatchesLoading(true)
    try {
      let rows = await listBatches(view)
      // La empresa activa acota los cortes visibles (sustituye a ACTIVE_COMPANY_ID).
      if (companyId) rows = rows.filter((batch) => batch.company_id === companyId)
      if (view === 'director') rows = sortDirectorBatches(rows)
      setBatches(rows)
      const want = preferredId ?? selectedIdRef.current
      if (want && rows.some((batch) => batch.id === want)) await openBatch(want)
      else if (rows.length) await openBatch(rows[0].id)
      else {
        selectedIdRef.current = null
        setSelectedId(null)
        setDetail(null)
        setDetailMsg('No hay cortes disponibles en esta vista.')
      }
    } catch (error) {
      setBatches([])
      setDetail(null)
      setDetailMsg(friendlyError(error))
      showToast('No se pudieron cargar cortes', friendlyError(error), 'error')
    } finally {
      setBatchesLoading(false)
    }
  }

  async function loadDirectors() {
    if (!isFinance) return
    try {
      setDirectors(await listCompanyDirectors(companyId))
    } catch (error) {
      showToast('No se cargaron directores', friendlyError(error), 'warning')
    }
  }

  async function loadRegularizations() {
    if (!isAuthorized) return
    try {
      setRegularizations(await listRegularizations(companyId))
    } catch (error) {
      setRegularizations([])
      showToast('No se cargaron contingencias', friendlyError(error), 'warning')
    } finally {
      setRegsLoaded(true)
    }
  }

  async function reloadSelected() {
    await loadBatches()
  }

  async function refreshAll() {
    await loadDirectors()
    await loadBatches()
    await loadRegularizations()
  }

  // Vista inicial según rol, una sola vez cuando auth resuelve.
  useEffect(() => {
    if (loading || view !== null || !isAuthorized) return
    setView(isDirector ? 'director' : 'finance')
  }, [loading, isAuthorized, isDirector, view])

  // Referencias (empresas + directores) para Finanzas.
  useEffect(() => {
    if (loading || !isFinance) return
    listActiveCompanies(companyId)
      .then(setCompanies)
      .catch((error) => showToast('No se pudo iniciar', friendlyError(error), 'error'))
    loadDirectors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isFinance, companyId])

  // Contingencias extraordinarias para cualquier rol autorizado.
  useEffect(() => {
    if (loading || !isAuthorized) return
    loadRegularizations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isAuthorized, companyId])

  // Cortes: se recargan al cambiar vista o empresa activa.
  useEffect(() => {
    if (loading || !isAuthorized || !view) return
    const initial = initialBatchIdRef.current
    initialBatchIdRef.current = null
    loadBatches(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isAuthorized, view, companyId])

  // ── Acciones del detalle ─────────────────────────────────────────────────
  function focusBatchItems() {
    const section = itemsSectionRef.current
    if (!section) return
    section.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => section.focus({ preventScroll: true }), 250)
  }

  async function runRpcAction(action: () => Promise<void>, successTitle: string) {
    await action()
    showToast(successTitle, 'La operacion se registro correctamente.', 'success')
    await reloadSelected()
  }

  function handleRemoveItem(itemId: string) {
    runLocked(async () => {
      if (!selectedIdRef.current) return
      await runRpcAction(() => removeRequestFromBatch(selectedIdRef.current!, itemId), 'Solicitud retirada')
    })
  }

  function handleSubmitBatch() {
    runLocked(async () => {
      const batch = detail?.batch
      const items = asArray(detail?.items)
      if (!batch || !items.length) throw new Error('Agrega al menos una solicitud antes de enviar el corte.')
      const confirmed = await askConfirmation(
        'Enviar corte a Direccion',
        (
          <>
            <p>Vas a enviar {items.length} solicitudes a {batch.director_name || 'Direccion'} para autorizacion.</p>
            <div className={s.confirmList}>
              <ConfirmRow label="Empresa" value={batch.company_name || '-'} />
              <ConfirmRow label="Corte" value={batch.label || '-'} />
              <ConfirmRow label="Solicitudes" value={String(items.length)} />
              <ConfirmRow label="Director" value={batch.director_name || 'Sin asignar'} />
              <ConfirmTotals items={items} label="Importe" />
            </div>
            <div className={s.confirmWarning}>El corte quedara bloqueado para edicion y pasara a decision de Direccion.</div>
          </>
        ),
        `Enviar ${items.length} solicitudes`,
      )
      if (!confirmed) return
      await runRpcAction(() => submitApprovalBatch(selectedIdRef.current!), 'Corte enviado')
    })
  }

  function handleApproveAll() {
    runLocked(async () => {
      const batch = detail?.batch
      const pending = asArray(detail?.items).filter((item) => item.director_status === 'pending')
      if (!pending.length) throw new Error('No hay solicitudes pendientes de decision.')
      const confirmed = await askConfirmation(
        'Autorizar corte semanal',
        (
          <>
            <p>Esta accion autoriza la continuacion operativa de todos los pagos del corte.</p>
            <div className={s.confirmList}>
              <ConfirmRow label="Empresa" value={batch?.company_name || '-'} />
              <ConfirmRow label="Corte" value={batch?.label || '-'} />
              <ConfirmRow label="Solicitudes" value={String(pending.length)} />
              <ConfirmTotals items={pending} label="Importe" />
            </div>
            <div className={s.confirmWarning}>Confirma que revisaste el corte completo antes de aprobarlo.</div>
          </>
        ),
        `Aprobar ${pending.length} solicitudes`,
      )
      if (!confirmed) return
      await runRpcAction(() => approveEntireBatch(selectedIdRef.current!), 'Corte aprobado')
    })
  }

  function handleSaveDecisions() {
    runLocked(async () => {
      if (detail?.batch?.status !== 'submitted') throw new Error('El corte ya no esta pendiente de decision.')
      const items = asArray(detail?.items)
      const pendingItems = items.filter((item) => item.director_status === 'pending')
      const decisionRows = pendingItems.map((item) => {
        const draft = decisions[item.id]
        const reason = draft?.reason.trim() || ''
        if (!draft || !['approved', 'rejected'].includes(draft.status)) {
          throw new Error('Selecciona una decision para cada solicitud.')
        }
        if (draft.status === 'rejected' && !reason) throw new Error('Captura el motivo para cada solicitud rechazada.')
        return { item_id: item.id, status: draft.status as 'approved' | 'rejected', reject_reason: reason || null }
      })
      if (!decisionRows.length) throw new Error('No hay decisiones pendientes.')
      const itemsById = new Map(items.map((item) => [item.id, item]))
      const approvedItems = decisionRows
        .filter((decision) => decision.status === 'approved')
        .map((decision) => itemsById.get(decision.item_id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
      const rejectedItems = decisionRows
        .filter((decision) => decision.status === 'rejected')
        .map((decision) => {
          const item = itemsById.get(decision.item_id)
          return item ? { ...item, reason: decision.reject_reason } : null
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item?.id))
      const decisionWarning = approvedItems.length
        ? 'Las solicitudes aprobadas continuaran al flujo operativo. Esta accion no se puede deshacer desde esta pantalla.'
        : 'Todas las solicitudes quedaran rechazadas y bloqueadas. Finanzas podra corregirlas y enviarlas nuevamente.'
      const confirmed = await askConfirmation(
        'Guardar decisiones del corte',
        (
          <>
            <p>Revisa las decisiones antes de guardarlas.</p>
            <div className={s.confirmList}>
              <ConfirmRow label="Aprobadas" value={String(approvedItems.length)} />
              <ConfirmTotals items={approvedItems} label="Total aprobado" />
              <ConfirmRow label="Rechazadas" value={String(rejectedItems.length)} />
              <ConfirmTotals items={rejectedItems} label="Total rechazado" />
            </div>
            {rejectedItems.length > 0 && (
              <div>
                <strong>Solicitudes rechazadas</strong>
                <div className={s.confirmList}>
                  {rejectedItems.map((item) => (
                    <div key={item.id}>
                      <strong>{item.request_number || '-'}</strong>
                      <br />
                      {item.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className={s.confirmWarning}>{decisionWarning}</div>
          </>
        ),
        'Guardar decisiones',
      )
      if (!confirmed) return
      await runRpcAction(
        () => decideApprovalBatchItems(selectedIdRef.current!, decisionRows),
        'Decisiones guardadas',
      )
    })
  }

  function handleCloseBatch() {
    runLocked(async () => {
      const items = asArray(detail?.items)
      const rejected = items.filter((item) => item.director_status === 'rejected').length
      // El servidor revalida cada solicitud antes de liberar (preview obligado).
      const preview = await previewBatchClose(selectedIdRef.current!)
      const ready = Number(preview?.ready_count || 0)
      const blocked = Number(preview?.blocked_count || 0)
      const pendingCount = Number(preview?.pending_count || 0)
      if (pendingCount > 0) throw new Error('batch_has_pending_items')
      if (!preview?.can_close || ready === 0) throw new Error('batch_no_releasable_items')
      const readyItems = asArray(preview?.ready_items)
      const blockedItems = asArray(preview?.blocked_items)
      const confirmed = await askConfirmation(
        'Liberar corte para pago',
        (
          <>
            <p>El servidor revalidó cada solicitud. Solo las vigentes se liberarán; las demás conservarán su decisión e historial.</p>
            <div className={s.confirmList}>
              <ConfirmRow label="Pagos por liberar" value={String(ready)} />
              <ConfirmRow label="Bloqueadas" value={String(blocked)} />
              <ConfirmRow label="Rechazos incluidos" value={String(rejected)} />
              <ConfirmTotals items={readyItems} label="Importe por liberar" />
            </div>
            {blockedItems.length > 0 && (
              <div>
                <strong>Se conservarán bloqueadas</strong>
                <div className={s.confirmList}>
                  {blockedItems.slice(0, 8).map((item, index) => (
                    <div key={`${item.request_number}-${index}`}>
                      <strong>{item.request_number || '-'}</strong>
                      <br />
                      {closeBlockReasonLabel(item.reason)}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className={s.confirmWarning}>Los cambios materiales requieren una nueva revisión de Dirección. Un ítem bloqueado no impide liberar los válidos.</div>
          </>
        ),
        `Liberar ${ready} pagos`,
      )
      if (!confirmed) return
      const data = await closeApprovalBatch(selectedIdRef.current!)
      showToast(
        'Corte liberado',
        `${Number(data?.approved_released_count || ready)} pagos pueden continuar y ${Number(data?.blocked_count || blocked)} permanecen bloqueados.`,
        'success',
      )
      await reloadSelected()
    })
  }

  function handleAddSelected() {
    runLocked(async () => {
      // Bucle secuencial: se detiene en el primer error y reporta el avance parcial.
      const eligibleIds = new Set(eligible.map((item) => item.id))
      const ids = Array.from(selectedEligibleIds).filter((id) => eligibleIds.has(id))
      if (!ids.length) throw new Error('Selecciona al menos una solicitud.')
      let added = 0
      let failure: unknown = null
      const addedIds = new Set<string>()
      setAddingProgress({ current: 1, total: ids.length })
      for (const [index, requestId] of ids.entries()) {
        setAddingProgress({ current: index + 1, total: ids.length })
        try {
          await addRequestToBatch(selectedIdRef.current!, requestId)
          added += 1
          addedIds.add(requestId)
        } catch (error) {
          failure = error
          break
        }
      }
      setAddingProgress(null)
      if (failure) setSelectedEligibleIds(new Set(ids.filter((id) => !addedIds.has(id))))
      else setSelectedEligibleIds(new Set())
      await reloadSelected()
      focusBatchItems()
      if (failure) {
        showToast('Incorporacion parcial', `Se agregaron ${added} de ${ids.length}. ${friendlyError(failure)}`, 'warning')
        return
      }
      showToast('Solicitudes agregadas', `${added} solicitudes fueron incorporadas al corte.`, 'success')
    })
  }

  function handleExportCsv() {
    runLocked(async () => {
      if (!detail?.batch) return
      exportBatchCsv(detail.batch, asArray(detail.items))
    })
  }

  function handleExportPdf() {
    runLocked(async () => {
      if (!detail?.batch) return
      const ok = await exportBatchPdf(detail.batch, asArray(detail.items))
      if (!ok) showToast('PDF no disponible', 'No se cargo el generador de PDF.', 'error')
    })
  }

  function handleDecisionChange(itemId: string, status: '' | 'approved' | 'rejected') {
    setDecisions((prev) => ({
      ...prev,
      // Al salir de "rechazada" se limpia el motivo (espejo de syncDecisionUi).
      [itemId]: { status, reason: status === 'rejected' ? prev[itemId]?.reason ?? '' : '' },
    }))
  }

  function handleReasonChange(itemId: string, reason: string) {
    setDecisions((prev) => ({ ...prev, [itemId]: { status: prev[itemId]?.status ?? '', reason } }))
  }

  function toggleEligible(id: string) {
    if (addingProgress) return
    setSelectedEligibleIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllEligible(checked: boolean) {
    setSelectedEligibleIds(checked ? new Set(eligible.map((item) => item.id)) : new Set())
  }

  // ── Contingencias extraordinarias ────────────────────────────────────────
  async function openRegularizationEvidence(row: Regularization) {
    try {
      const url = await getRegularizationEvidenceUrl(row.authorization_id)
      const link = document.createElement('a')
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.click()
    } catch (error) {
      showToast('No se abrió la evidencia', friendlyError(error), 'error')
    }
  }

  function openRegularizationDialog(row: Regularization, decision: RegularizationDecision) {
    if (!row.can_decide || !['ratify', 'dispute'].includes(decision)) return
    setRegDialog({ row, decision })
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return <div className={s.empty}>Cargando...</div>
  }

  if (!isAuthorized) {
    return (
      <div className={s.gate} role="status">
        <h2>Acceso restringido</h2>
        <p>No tienes permisos para administrar o autorizar cortes semanales.</p>
        <Link className={s.primaryBtn} style={{ textDecoration: 'none' }} to="/dashboard">Volver al dashboard</Link>
      </div>
    )
  }

  const filteredBatches = filterBatches(batches, search, statusFilter)
  const pendingRegs = regularizations.filter((row) => row.status === 'consumed_pending_ratification').length
  const rebatchItem = rebatchItemId
    ? asArray(detail?.items).find((row) => row.id === rebatchItemId) ?? null
    : null
  const rebatchDraftBatches = detail?.batch
    ? batches.filter((batch) => batch.status === 'draft'
      && batch.company_id === detail.batch?.company_id
      && batch.id !== detail.batch?.id)
    : []

  return (
    <>
      <div className={s.phead}>
        <div>
          <h1>Cortes semanales</h1>
          <p className="muted">{view === 'finance' ? 'Preparacion por Finanzas' : 'Decision de Direccion'}</p>
        </div>
        <div className={s.toolbar}>
          {isFinance && view === 'finance' && (
            <>
              <button className={s.secondaryBtn} type="button" onClick={() => setDirectorOpen(true)}>Configurar directores</button>
              <button className={s.primaryBtn} type="button" onClick={() => setCreateOpen(true)}>Crear corte</button>
            </>
          )}
          <button className={s.secondaryBtn} type="button" disabled={batchesLoading} onClick={refreshAll}>Actualizar</button>
        </div>
      </div>

      <div className={s.toolbar} style={{ marginBottom: 10 }}>
        <div className={s.tabs}>
          {isFinance && (
            <button
              className={`${s.tab} ${view === 'finance' ? s.tabActive : ''}`}
              type="button"
              onClick={() => {
                if (view === 'finance') return
                selectedIdRef.current = null
                setSelectedId(null)
                setDetail(null)
                setEligible([])
                setIneligible([])
                setSelectedEligibleIds(new Set())
                setView('finance')
              }}
            >
              Finanzas
            </button>
          )}
          <button
            className={`${s.tab} ${view === 'director' ? s.tabActive : ''}`}
            type="button"
            onClick={() => {
              if (view === 'director') return
              selectedIdRef.current = null
              setSelectedId(null)
              setDetail(null)
              setEligible([])
              setIneligible([])
              setSelectedEligibleIds(new Set())
              setView('director')
            }}
          >
            Direccion
          </button>
        </div>
      </div>

      <section className={s.regCard} aria-labelledby="regularizationTitle">
        <div className={s.regHead}>
          <div>
            <h2 id="regularizationTitle">Ratificación de contingencias extraordinarias</h2>
            <p>Dirección revisa la evidencia después del consumo y antes de confirmar el pago.</p>
          </div>
          <Badge variant={pendingRegs ? 'warning' : 'success'}>
            {pendingRegs} {pendingRegs === 1 ? 'pendiente' : 'pendientes'}
          </Badge>
        </div>
        <div className={s.regList}>
          {!regsLoaded && <div className={s.regEmpty}>Consultando contingencias...</div>}
          {regsLoaded && !regularizations.length && (
            <div className={s.regEmpty}>No hay contingencias consumidas por ratificar.</div>
          )}
          {regularizations.map((row) => (
            <div key={row.authorization_id} className={s.regRow}>
              <div>
                <strong>{row.request_number || 'Solicitud'}</strong>
                <small>{formatMoney(row.amount, row.currency)}</small>
              </div>
              <div>
                <strong>{extraordinaryCategoryLabel(row.category)}</strong>
                <small>{regularizationStatusLabel(row.status)}</small>
              </div>
              <div>
                <strong>Consumida {formatDateTime(row.consumed_at)}</strong>
                <small>Ratificar antes de {formatDateTime(row.ratification_due_at)}</small>
              </div>
              <div className={s.regActions}>
                <button
                  className={s.secondaryBtn}
                  type="button"
                  disabled={mutating}
                  onClick={() => openRegularizationEvidence(row)}
                >
                  Ver evidencia
                </button>
                {row.can_decide && row.status === 'consumed_pending_ratification' && (
                  <>
                    <button
                      className={s.secondaryBtn}
                      type="button"
                      disabled={mutating}
                      onClick={() => openRegularizationDialog(row, 'dispute')}
                    >
                      Registrar discrepancia
                    </button>
                    <button
                      className={s.primaryBtn}
                      type="button"
                      disabled={mutating}
                      onClick={() => openRegularizationDialog(row, 'ratify')}
                    >
                      Ratificar
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={s.workspace}>
        <div className={s.listPanel}>
          <div className={s.listControls}>
            <input
              className={s.field}
              type="search"
              placeholder="Buscar corte o empresa"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className={s.field} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {BATCH_STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className={s.list}>
            {batchesLoading && !batches.length && <div className={s.empty}>Cargando cortes...</div>}
            {!batchesLoading && !filteredBatches.length && (
              <div className={s.empty}>No hay cortes para los filtros actuales.</div>
            )}
            {filteredBatches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                className={[
                  s.listItem,
                  batch.id === selectedId ? s.listItemActive : '',
                  view === 'director' && batch.status === 'submitted' ? s.listItemAttention : '',
                ].join(' ')}
                onClick={() => openBatch(batch.id)}
              >
                <span className={s.listHead}>
                  <strong>{batch.label}</strong>
                  <Badge variant={statusVariant(batch.status)}>{statusLabel(batch.status)}</Badge>
                </span>
                <span className={s.listMeta}>
                  <span>{batch.company_name || 'Sin empresa'}</span>
                  <span>{formatDate(batch.period_end)}</span>
                </span>
                <span className={s.listMeta}>
                  <span>{Number(batch.item_count || 0)} solicitudes</span>
                  <span>{formatCurrencyTotals(asArray(batch.totals_by_currency))}</span>
                </span>
                {view === 'director' && batch.status === 'submitted' && (
                  <span className={s.listMeta}><strong>Pendiente de decision</strong></span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className={s.detail}>
          {detail ? (
            <BatchDetail
              detail={detail}
              isFinance={isFinance}
              mutating={mutating}
              eligible={eligible}
              ineligible={ineligible}
              selectedEligibleIds={selectedEligibleIds}
              addingProgress={addingProgress}
              decisions={decisions}
              itemsSectionRef={itemsSectionRef}
              onToggleEligible={toggleEligible}
              onSelectAllEligible={selectAllEligible}
              onClearSelection={() => setSelectedEligibleIds(new Set())}
              onAddSelected={handleAddSelected}
              onRemoveItem={handleRemoveItem}
              onSubmitBatch={handleSubmitBatch}
              onApproveAll={handleApproveAll}
              onSaveDecisions={handleSaveDecisions}
              onCloseBatch={handleCloseBatch}
              onOpenRebatch={setRebatchItemId}
              onExportCsv={handleExportCsv}
              onExportPdf={handleExportPdf}
              onDecisionChange={handleDecisionChange}
              onReasonChange={handleReasonChange}
            />
          ) : (
            <div className={s.empty}>{detailMsg}</div>
          )}
        </div>
      </section>

      {createOpen && (
        <CreateBatchDialog
          companies={companies}
          directors={directors}
          onClose={() => setCreateOpen(false)}
          onCreated={async (batchId) => {
            await loadBatches(batchId)
          }}
        />
      )}

      {directorOpen && (
        <DirectorDialog
          companies={companies}
          directors={directors}
          activeCompanyId={companyId}
          onClose={() => setDirectorOpen(false)}
          onPoolChanged={loadDirectors}
          askConfirmation={askConfirmation}
        />
      )}

      {rebatchItem && (
        <RebatchDialog
          item={rebatchItem}
          draftBatches={rebatchDraftBatches}
          locked={mutating}
          setLocked={setLocked}
          onClose={() => setRebatchItemId(null)}
          onReleased={reloadSelected}
        />
      )}

      {regDialog && (
        <RegularizationDialog
          row={regDialog.row}
          decision={regDialog.decision}
          locked={mutating}
          setLocked={setLocked}
          onClose={() => setRegDialog(null)}
          onSaved={loadRegularizations}
        />
      )}

      {confirmReq && (
        <ConfirmDialog
          title={confirmReq.title}
          confirmLabel={confirmReq.confirmLabel}
          onCancel={() => settleConfirm(false)}
          onConfirm={() => settleConfirm(true)}
        >
          {confirmReq.body}
        </ConfirmDialog>
      )}
    </>
  )
}
