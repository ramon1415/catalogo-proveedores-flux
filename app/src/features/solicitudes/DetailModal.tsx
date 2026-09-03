import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { formatDate, formatDateTime, numberValue } from '../../lib/format'
import {
  getApproverDetails, loadApprovalHistory, loadPaymentReceipts, getReceiptUrl,
  decidePaymentRequest, getExecutionContext, loadRequestSummary, loadCashFund,
  loadIncidencias, updateRequestNotes, getReceiptSummary, getEvidenceAccess, createSignedUrl,
  loadReimbursementItems, loadBeneficiaryProfileId, loadEmployeeBankAccount,
} from './api'
import {
  companyName, costCenterName, budgetCategoryLabel, proveedorAlias, formatCurrencyC,
  formatMonth, statusBadge, budgetDecisionBadge, isExceptionRequest, isFinalDecisionStatus,
  isTerminalStatus, decisionButtonsFor, isDecisionCommentRequired, decisionActionLabel,
  friendlyDecisionError, requestTypeLabel, paymentMethodLabel, paymentMethodVariant,
  extraordinaryStatusLabel, extraordinaryCategoryLabel, batchStatusLabel, reviewLabel,
  authorizationBlockReasonLabel, cashFundAvailabilityMessage, executionAuthorizationSourceLabel,
  effectivePaymentType, currentLinkedIncidentId, INCIDENT_STATUS_MAP, normalizeRpcResult,
  rlsHint, isReimbursement,
} from './logic'
import { ExtraordinaryModal, RevokeExtraordinaryModal } from './ExtraordinaryModal'
import { CashFundModal } from './CashFundModal'
import type {
  PaymentRequest, Company, CostCenter, BudgetCategory, Proveedor, Profile,
  ApprovalHistoryRow, PaymentReceiptRow, ExecutionContext, RequestSummary,
  CashFund, IncidentCharge, DecisionAction, ReimbursementItem, EmployeeBankAccount,
} from './types'
import s from './Solicitudes.module.css'

type Fase2Meta = { request_type: string | null; payment_method: string | null } | undefined

export function DetailModal({
  request,
  companies,
  costCenters,
  budgetCategories,
  proveedores,
  profiles,
  fase2,
  canApprove,
  currentProfileId,
  onClose,
  onEdit,
  onChanged,
}: {
  request: PaymentRequest
  companies: Company[]
  costCenters: CostCenter[]
  budgetCategories: BudgetCategory[]
  proveedores: Proveedor[]
  profiles: Profile[]
  fase2: Fase2Meta
  canApprove: boolean
  currentProfileId: string | null
  onClose: () => void
  onEdit: () => void
  onChanged: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { showToast } = useToast()

  const proveedor = proveedores.find((p) => p.id === request.proveedor_id) || null
  const company = companies.find((c) => c.id === request.company_id) || null
  const center = costCenters.find((c) => c.id === request.cost_center_id) || null
  const category = budgetCategories.find((c) => c.id === request.budget_category_id) || null
  const exception = isExceptionRequest(request)
  const isPaid = request.status === 'paid'
  const currency = request.currency || 'MXN'

  const [approverRouting, setApproverRouting] = useState('Cargando...')
  const [history, setHistory] = useState<ApprovalHistoryRow[] | 'loading' | 'error'>('loading')
  const [receipts, setReceipts] = useState<PaymentReceiptRow[] | null>(null)
  const [context, setContext] = useState<ExecutionContext>(null)
  const [summary, setSummary] = useState<RequestSummary | null>(null)
  const [cashFund, setCashFund] = useState<CashFund | null>(null)
  const [receiptSummary, setReceiptSummary] = useState<any | null>(null)

  // Decision state
  const [comment, setComment] = useState('')
  const [decisionError, setDecisionError] = useState('')
  const [deciding, setDeciding] = useState(false)

  // Sub-modals
  const [extraOpen, setExtraOpen] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [cashFundOpen, setCashFundOpen] = useState(false)

  // Reembolso (solo lectura): beneficiario, sus datos bancarios y el desglose.
  const [reimbursementItems, setReimbursementItems] = useState<ReimbursementItem[] | null>(null)
  const [beneficiaryId, setBeneficiaryId] = useState<string | null>(null)
  const [beneficiaryBank, setBeneficiaryBank] = useState<EmployeeBankAccount | null>(null)

  // Incidencias
  const [incidents, setIncidents] = useState<IncidentCharge[] | null>(null)
  const [membersById, setMembersById] = useState<Map<string, string>>(new Map())
  const [selectedIncident, setSelectedIncident] = useState('')
  const [incidentHint, setIncidentHint] = useState('Cargando…')
  const [incidentSaving, setIncidentSaving] = useState(false)

  useEffect(() => {
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
  }, [])

  // Carga paralela al abrir / cambiar de solicitud.
  useEffect(() => {
    let cancelled = false
    setApproverRouting('Cargando...')
    setHistory('loading')
    setReceipts(null)
    setContext(null)
    setCashFund(null)
    setReceiptSummary(null)
    setComment('')
    setDecisionError('')

    ;(async () => {
      // Approver routing
      try {
        const row = await getApproverDetails(request.id)
        if (cancelled) return
        if (!row?.profile_id) setApproverRouting('Aprobador no registrado')
        else {
          const roles = Array.isArray(row.eligible_roles) && row.eligible_roles.length ? ` · ${row.eligible_roles.join(', ')}` : ''
          const source = row.source === 'assigned' ? ' · Configurado por administración' : row.source === 'approval_rules' ? ' · Elegible por reglas' : ''
          setApproverRouting(`${row.display_name || 'Sin nombre'}${roles}${source}`)
        }
      } catch {
        if (!cancelled) setApproverRouting('Aprobador no registrado')
      }

      // Approval history
      try {
        const rows = await loadApprovalHistory(request.id)
        if (!cancelled) setHistory(rows)
      } catch {
        if (!cancelled) setHistory('error')
      }

      // Payment info (paid)
      if (isPaid) {
        try {
          const rows = await loadPaymentReceipts(request.id)
          if (!cancelled) setReceipts(rows)
        } catch (error) {
          if (!cancelled) { setReceipts([]); showToast('Info de pago', rlsHint('payment_receipts', 'select', error), 'warning') }
        }
      }

      // Execution context + summary (batch/extraordinary/cash fund)
      try {
        const [ctx, sum] = await Promise.all([getExecutionContext(request.id), loadRequestSummary(request.id)])
        if (cancelled) return
        setContext(ctx)
        setSummary(sum)
        // Cash fund section only for cash/check requests
        if (['cash', 'check'].includes(effectivePaymentType({ payment_method: fase2?.payment_method, request_type: fase2?.request_type }))) {
          const fund = await loadCashFund(request.id)
          if (!cancelled) setCashFund(fund)
        }
      } catch { /* context is best-effort */ }

      // Receipt (comprobante de pago)
      try {
        const rs = await getReceiptSummary(request.id)
        if (!cancelled) setReceiptSummary(rs)
      } catch { /* best-effort */ }

      // Incidencias (canApprove)
      if (canApprove) {
        try {
          const { incidents: inc, membersById: m } = await loadIncidencias()
          if (cancelled) return
          setIncidents(inc)
          setMembersById(m)
          const currentId = currentLinkedIncidentId(request.notes)
          setSelectedIncident(currentId || '')
          setIncidentHint(currentId ? 'Incidencia actualmente vinculada. Puedes cambiarla o quitarla.' : 'Asocia una incidencia de Ingresos a esta solicitud. Se guardará en notas.')
        } catch (error: any) {
          if (!cancelled) { setIncidents([]); setIncidentHint(error?.message || 'Error al cargar incidencias.') }
        }
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id])

  const isReembolso = isReimbursement(fase2?.request_type ?? request.request_type)

  // Desglose y beneficiario del reembolso. Efecto aparte del principal porque
  // depende de la metadata Fase 2, que puede llegar después del primer render.
  useEffect(() => {
    if (!isReembolso) { setReimbursementItems(null); setBeneficiaryId(null); setBeneficiaryBank(null); return }
    let cancelled = false
    ;(async () => {
      const [rows, profileId] = await Promise.all([
        loadReimbursementItems(request.id),
        loadBeneficiaryProfileId(request.id),
      ])
      if (cancelled) return
      setReimbursementItems(rows)
      setBeneficiaryId(profileId)
      // Los datos bancarios solo se leen si el usuario tiene permiso (RLS);
      // si no, la tarjeta simplemente no los muestra.
      if (profileId) {
        const bank = request.company_id
          ? await loadEmployeeBankAccount(profileId, request.company_id)
          : null
        if (!cancelled) setBeneficiaryBank(bank)
      }
    })()
    return () => { cancelled = true }
  }, [isReembolso, request.id, request.company_id])

  const detailNotice = isPaid
    ? { title: 'Pagada', desc: 'Esta solicitud ya fue pagada.', variant: 'success' as const }
    : exception
      ? { title: 'Excepción presupuestal', desc: 'Requiere revisión por excepción presupuestal.', variant: 'warning' as const }
      : { title: 'Presupuesto disponible', desc: 'Validada automáticamente con presupuesto disponible.', variant: 'info' as const }

  const canEdit = canApprove && !isTerminalStatus(request.status)

  // ── Decision ──────────────────────────────────────────────────────────────
  const finalStatus = isFinalDecisionStatus(request.status)
  const canDecide = canApprove && (!request.approver_id || request.approver_id === currentProfileId)
  const noteClass = isPaid ? 'success' : finalStatus ? 'neutral' : exception ? 'warning' : 'success'
  const noteText = isPaid
    ? 'Esta solicitud ya fue pagada.'
    : finalStatus
      ? 'Esta solicitud ya tiene una decisión registrada.'
      : exception
        ? 'Esta solicitud requiere decisión por excepción presupuestal.'
        : 'Esta solicitud fue validada automáticamente con presupuesto disponible.'

  async function decide(action: DecisionAction) {
    if (!currentProfileId) {
      const message = 'No se pudo identificar el perfil del usuario para registrar la decisión.'
      setDecisionError(message)
      showToast('Perfil no identificado', message, 'error')
      return
    }
    const clean = comment.trim()
    if (isDecisionCommentRequired(request, action) && !clean) {
      setDecisionError('Captura un comentario para registrar esta decisión.')
      return
    }
    setDecisionError('')
    setDeciding(true)
    try {
      const data = await decidePaymentRequest(request.id, currentProfileId, action, clean || null)
      normalizeRpcResult(data)
      showToast('Decisión registrada', `${decisionActionLabel(action)} registrada correctamente.`, action.includes('reject') ? 'warning' : 'success')
      onChanged()
    } catch (error) {
      const message = friendlyDecisionError(error)
      setDecisionError(message)
      showToast('No se pudo registrar la decisión', message, 'error')
    } finally {
      setDeciding(false)
    }
  }

  // ── Incidencia ────────────────────────────────────────────────────────────
  function incidentLabel(inc: IncidentCharge): string {
    const receiver = inc.member_id ? (membersById.get(inc.member_id) || 'Socio') : (inc.external_name || 'Externo')
    return [formatDate(inc.incident_date), receiver, inc.description || 'Sin descripcion', formatCurrencyC(inc.amount, 'MXN'), INCIDENT_STATUS_MAP[inc.status || ''] || inc.status]
      .filter(Boolean).join(' | ')
  }

  async function saveIncident() {
    if (incidentSaving) return
    const inc = (incidents || []).find((i) => i.id === selectedIncident) || null
    const cleanNotes = (request.notes || '').replace(/\n?\[Visita\/incidencia asociada:[^\]]+\]/g, '').trim()
    const marker = inc ? `[Visita/incidencia asociada: ${inc.id} - ${incidentLabel(inc)}]` : ''
    const newNotes = [cleanNotes, marker].filter(Boolean).join('\n') || null
    setIncidentSaving(true)
    try {
      await updateRequestNotes(request.id, newNotes)
      showToast('Incidencia actualizada', inc ? 'Incidencia vinculada correctamente.' : 'Incidencia desvinculada.', 'success')
      onChanged()
    } catch (error: any) {
      showToast('Error', error?.message || 'No se pudo guardar.', 'error')
    } finally {
      setIncidentSaving(false)
    }
  }

  // ── Comprobante / evidencia ───────────────────────────────────────────────
  async function openInvoice(path: string) {
    const url = await getReceiptUrl(path)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
    else showToast('No disponible', 'No se pudo generar el link del comprobante.', 'error')
  }

  async function accessEvidence(evidenceId: string, download: boolean) {
    try {
      const access = await getEvidenceAccess(evidenceId)
      const url = await createSignedUrl(access.storage_bucket, access.storage_path, Number(access.url_ttl_seconds || 300))
      if (!url) throw new Error('evidence_url_unavailable')
      window.open(url, '_blank', 'noopener,noreferrer')
      // Nota: la descarga single-page verificada (pdf-lib) del vanilla se abre en
      // pestaña nueva; ver MIGRATION_NOTES (verificación SHA no portada).
      if (download) showToast('Comprobante', 'Se abrió el comprobante en una pestaña nueva.', 'info')
    } catch (error: any) {
      showToast('No se pudo abrir el comprobante', error?.message || 'Intenta de nuevo.', 'error')
    }
  }

  async function refreshAfterExecution() {
    try {
      const ctx = await getExecutionContext(request.id)
      setContext(ctx)
    } catch { /* ignore */ }
    onChanged()
  }

  const method = effectivePaymentType({ payment_method: fase2?.payment_method, request_type: fase2?.request_type })
  const showCashFundSection = ['cash', 'check'].includes(method)

  const decisionButtons = useMemo(() => decisionButtonsFor(request), [request])

  return (
    <dialog ref={dialogRef} className={`${s.dialog} ${s.detail}`} onCancel={onClose} onClose={onClose}>
      <div className={s.modal}>
        <div className={s.modalHead}>
          <div>
            <h2>{request.request_number || 'Detalle de solicitud'}</h2>
            <p>{`${isReembolso ? 'Reembolso' : proveedorAlias(proveedor)} · ${formatMonth(request.budget_month)}`}</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>

        <div className={s.modalScroll}>
          {/* Fase 2 strip */}
          {fase2 && (
            <div className={`${s.batchMeta}`} style={{ marginBottom: 12 }}>
              <span>Tipo de solicitud: <Badge variant="info">{requestTypeLabel(fase2.request_type)}</Badge></span>
              <span>Metodo de pago: <Badge variant={paymentMethodVariant(fase2.payment_method)}>{paymentMethodLabel(fase2.payment_method)}</Badge></span>
            </div>
          )}

          <div className={`${s.notice} ${s[detailNotice.variant]}`}>
            <span className={s.noticeTitle}>{detailNotice.title}</span>
            <span className={s.noticeDesc}>— {detailNotice.desc}</span>
          </div>

          <div className={s.amountBig}>{formatCurrencyC(request.amount_requested, currency)}</div>

          <div className={s.refGrid}>
            {/* En reembolso no hay proveedor: el destinatario es el empleado. */}
            {isReembolso
              ? <RefCell label="Beneficiario" value={
                  profiles.find((p) => p.id === beneficiaryId)?.full_name
                  || beneficiaryBank?.beneficiary_name
                  || 'Sin beneficiario registrado'
                } />
              : <RefCell label="Proveedor" value={proveedorAlias(proveedor)} />}
            <RefCell label="Empresa" value={companyName(company)} />
            <div className={`${s.refCell} ${s.full}`}>
              <span className={s.refLabel}>Aprobador seleccionado</span>
              <span className={s.refValue}>{approverRouting}</span>
            </div>
            <RefCell label="Centro de costo" value={costCenterName(center)} muted />
            <RefCell label="Mes presupuestal" value={formatMonth(request.budget_month)} muted />
            <div className={`${s.refCell} ${s.full}`}>
              <span className={s.refLabel}>Partida</span>
              <span className={`${s.refValue} ${s.muted}`}>{budgetCategoryLabel(category)}</span>
            </div>
          </div>

          <div className={s.dataSection}>
            <DataRow label="Estatus" value={<Badge variant={statusBadge(request.status).variant}>{statusBadge(request.status).label}</Badge>} />
            <DataRow label="Validación presupuestal" value={<Badge variant={budgetDecisionBadge(request.budget_decision, request.budget_block_reason || '').variant}>{budgetDecisionBadge(request.budget_decision, request.budget_block_reason || '').label}</Badge>} />
            <DataRow label="Descripción" value={request.description || 'Sin descripción'} muted />
            {request.notes && <DataRow label="Notas" value={request.notes} muted />}
            {request.invoice_storage_path && (
              <DataRow label="Comprobante" value={<button type="button" className={s.invoiceLink} onClick={() => openInvoice(request.invoice_storage_path!)}>Ver comprobante</button>} />
            )}
          </div>

          <div className={s.dataSection}>
            <div className={s.sectionHeading}>Impacto presupuestal</div>
            <DataRow label="Disponible antes" value={formatCurrencyC(request.budget_available_before, currency)} muted />
            <DataRow label="Disponible después" value={formatCurrencyC(request.budget_available_after, currency)} muted />
            <DataRow label="Faltante" value={formatCurrencyC(request.budget_shortfall, currency)} muted />
          </div>

          {/* Reembolso: a quién se le paga y qué se le reembolsa (solo lectura) */}
          {isReembolso && (
            <ReimbursementDetailSection
              items={reimbursementItems}
              beneficiaryName={
                profiles.find((p) => p.id === beneficiaryId)?.full_name
                || profiles.find((p) => p.id === beneficiaryId)?.email
                || beneficiaryBank?.beneficiary_name
                || (beneficiaryId ? 'Perfil no disponible' : 'Sin beneficiario registrado')
              }
              bank={beneficiaryBank}
              categories={budgetCategories}
              currency={currency}
            />
          )}

          {/* Panel de ruta de autorización / extraordinarios */}
          {context && summary && <BatchExecutionPanel context={context} onAuthorize={() => setExtraOpen(true)} onRevoke={() => setRevokeOpen(true)} />}

          {/* Comprobante de pago (Finanzas) */}
          {receiptSummary && <ReceiptSection data={receiptSummary} onView={(id) => accessEvidence(id, false)} onDownload={(id) => accessEvidence(id, true)} />}

          {/* Fondo y comprobacion (efectivo/cheque) */}
          {showCashFundSection && summary && (
            <CashFundSection
              context={context}
              fund={cashFund}
              request={summary}
              method={method}
              onCreate={() => setCashFundOpen(true)}
            />
          )}

          {/* Decisión del aprobador */}
          <section className={s.decisionCard}>
            <h3>Decisión del aprobador</h3>
            <p>Registra la acción que seguirá esta solicitud.</p>
            <div className={`${s.decisionNote} ${s[noteClass]}`}>{noteText}</div>
            {finalStatus ? (
              <div className={`${s.decisionNote} ${s.neutral}`}>Esta solicitud ya tiene una decisión registrada.</div>
            ) : !canDecide ? (
              <div className={`${s.decisionNote} ${s.neutral}`}>Solo el aprobador seleccionado puede registrar una decisión.</div>
            ) : (
              <>
                <textarea placeholder={exception ? 'Comentario obligatorio para resolver la excepción...' : 'Comentario para la decisión...'} value={comment} onChange={(e) => setComment(e.target.value)} />
                <div className={s.decisionError}>{decisionError}</div>
                <div className={s.decisionActions}>
                  {decisionButtons.map((b) => (
                    <button key={b.action} type="button" className={`${s.decisionBtn} ${s[b.variant]}`} disabled={deciding} onClick={() => decide(b.action)}>{b.label}</button>
                  ))}
                </div>
              </>
            )}
            <div className={s.approvalHistory}>
              <h4>Historial de decisiones</h4>
              <div className={s.historyList}>
                {history === 'loading' && <div className={s.historyItem}>Cargando historial...</div>}
                {history === 'error' && <div className={s.historyItem}>No fue posible cargar el historial de decisiones.</div>}
                {Array.isArray(history) && history.length === 0 && <div className={s.historyItem}>Aún no hay decisiones registradas.</div>}
                {Array.isArray(history) && history.map((item) => (
                  <div key={item.id} className={s.historyItem}>
                    <strong>{decisionActionLabel(item.action || '')}</strong>
                    {item.comments || 'Sin comentario'}
                    <span>{formatDateTime(item.created_at)} · {item.from_status || '-'} → {item.to_status || '-'}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Información de pago (paid) */}
          {isPaid && (
            <section className={s.decisionCard}>
              <h3>Informacion de pago</h3>
              <p>Datos registrados al confirmar el pago del layout.</p>
              <div className={s.historyList}>
                {receipts === null && <div className={s.historyItem}>Cargando informacion de pago...</div>}
                {receipts?.length === 0 && <div className={s.historyItem}>Pago registrado. La lectura de comprobantes queda como mejora pendiente si no hay recibos disponibles.</div>}
                {receipts?.map((r) => (
                  <div key={r.id} className={s.historyItem}>
                    <strong>{formatCurrencyC(r.amount, 'MXN')}</strong>
                    Fecha de pago: {formatDate(r.payment_date)}
                    <span>Referencia: {r.bank_reference || 'Sin referencia'} · Layout: {r.layout_id || 'Sin layout'}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Incidencia asociada (canApprove) */}
          {canApprove && (
            <div className={s.incidenciaSection}>
              <div className={s.sectionHeading}>Incidencia asociada</div>
              <div className={s.row}>
                <select className={s.formControl} value={selectedIncident} onChange={(e) => setSelectedIncident(e.target.value)}>
                  {incidents === null ? (
                    <option value="">Cargando incidencias…</option>
                  ) : (
                    <>
                      <option value="">Sin incidencia asociada</option>
                      {incidents.map((inc) => <option key={inc.id} value={inc.id}>{incidentLabel(inc)}</option>)}
                    </>
                  )}
                </select>
                <button type="button" className={s.primaryBtn} disabled={incidentSaving} onClick={saveIncident}>{incidentSaving ? 'Guardando…' : 'Asociar'}</button>
              </div>
              <div className={s.fieldHint}>{incidentHint}</div>
            </div>
          )}
        </div>

        <div className={s.modalActions}>
          {canEdit && <button type="button" className={`${s.secondaryBtn} ${s.spacerBtn}`} onClick={onEdit}>Editar solicitud</button>}
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cerrar</button>
        </div>
      </div>

      {extraOpen && summary && context && (
        <ExtraordinaryModal request={summary} context={context} onClose={() => setExtraOpen(false)} onDone={() => { setExtraOpen(false); refreshAfterExecution() }} />
      )}
      {revokeOpen && (
        <RevokeExtraordinaryModal requestId={request.id} onClose={() => setRevokeOpen(false)} onDone={() => { setRevokeOpen(false); refreshAfterExecution() }} />
      )}
      {cashFundOpen && summary && (
        <CashFundModal
          request={summary}
          context={context}
          profiles={profiles}
          currentProfileId={currentProfileId}
          method={method}
          draft={readCashDraft(request.id)}
          onClose={() => setCashFundOpen(false)}
          onDone={() => { setCashFundOpen(false); refreshAfterExecution() }}
        />
      )}
    </dialog>
  )
}

// Desglose del reembolso, solo lectura. El detalle económico real vive aquí:
// el monto de la solicitud es la suma y su partida es solo la del renglón mayor.
function ReimbursementDetailSection({
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
}) {
  const total = (items ?? []).reduce((sum, item) => sum + numberValue(item.amount), 0)
  return (
    <section className={s.decisionCard}>
      <h3>Reembolso a empleado</h3>
      <p>El pago se dispersa a la persona que cubrió el gasto, no a los comercios emisores.</p>
      <div className={s.detailGrid}>
        <DetailCard label="Beneficiario" value={beneficiaryName} />
        <DetailCard
          label="Cuenta destino"
          value={bank
            ? `${bank.banco || 'Sin banco'} · ${bank.clabe ? `CLABE ${bank.clabe}` : bank.cuenta ? `Cuenta ${bank.cuenta}` : 'Sin cuenta'}`
            : 'Sin datos bancarios visibles'}
        />
      </div>
      <div className={s.historyList}>
        {items === null && <div className={s.historyItem}>Cargando desglose…</div>}
        {items?.length === 0 && <div className={s.historyItem}>Esta solicitud no tiene desglose registrado.</div>}
        {items?.map((item) => {
          const category = categories.find((c) => c.id === item.budget_category_id) || null
          return (
            <div key={item.id} className={s.historyItem}>
              <strong>{formatCurrencyC(item.amount, currency)} · {item.descripcion}</strong>
              {budgetCategoryLabel(category)}
              <span>
                {item.deducible ? 'Deducible' : 'No deducible'}
                {' · '}
                {item.invoice_uuid ? `Folio fiscal ${item.invoice_uuid}` : 'Sin folio fiscal'}
              </span>
            </div>
          )
        })}
      </div>
      {items?.length ? (
        <div className={s.summaryNote}>Suma del desglose: {formatCurrencyC(total, currency)}</div>
      ) : null}
    </section>
  )
}

// Metadata local capturada al crear la solicitud (persistCashMetadataIfNeeded).
function readCashDraft(requestId: string): { responsible_profile_id?: string; due_date?: string; delivery_method?: string } | null {
  try {
    const raw = localStorage.getItem(`flux-cash-request-${requestId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function RefCell({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={s.refCell}>
      <span className={s.refLabel}>{label}</span>
      <span className={`${s.refValue} ${muted ? s.muted : ''}`}>{value}</span>
    </div>
  )
}

function DataRow({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className={s.dataRow}>
      <span className={s.dataLabel}>{label}</span>
      <span className={`${s.dataValue} ${muted ? s.muted : ''}`}>{value}</span>
    </div>
  )
}

// ── Panel de ruta de autorización / extraordinarios (batch execution) ───────
function BatchExecutionPanel({ context, onAuthorize, onRevoke }: { context: NonNullable<ExecutionContext>; onAuthorize: () => void; onRevoke: () => void }) {
  const extra = context.extraordinary
  const batch = context.latest_batch
  if (!context.is_finance && !extra && !batch) return null

  if (extra) {
    const secure = extra.secure_contract === true
    const status = extraordinaryStatusLabel(extra.status, secure)
    const tone: 'success' | 'danger' | 'warning' = ['active', 'ratified'].includes(extra.status || '')
      ? 'success'
      : ['disputed', 'legacy_quarantined', 'revoked', 'expired'].includes(extra.status || '')
        ? 'danger'
        : 'warning'
    const resume = secure && extra.status === 'draft' && extra.can_resume
    const revoke = extra.can_revoke
    return (
      <section className={`${s.batchPanel} ${s.extraordinary}`}>
        <div className={s.batchHead}>
          <div>
            <strong>{secure ? 'Contingencia extraordinaria con autorización externa' : 'Autorización extraordinaria histórica'}</strong>
            <span>{extraordinaryCategoryLabel(extra.category)}</span>
          </div>
          <Badge variant={tone}>{status}</Badge>
        </div>
        <div className={s.batchMeta}>
          <span>Registró {extra.authorized_by_name || 'Finanzas'}</span>
          <span>{formatDateTime(extra.authorized_at)}</span>
          {secure && <span>Dirección externa: {extra.external_director_name || 'Sin identificar'}</span>}
          {extra.valid_until && <span>Vigente hasta {formatDateTime(extra.valid_until)}</span>}
          {extra.ratification_due_at && ['consumed_pending_ratification', 'ratified', 'disputed'].includes(extra.status || '') && <span>Ratificación límite {formatDateTime(extra.ratification_due_at)}</span>}
          {extra.evidence_finalized ? <span>Evidencia privada verificada · SHA-256 {String(extra.evidence_sha256 || '').slice(0, 12)}…</span> : secure && extra.status === 'draft' ? <span>Falta cargar y validar la evidencia.</span> : null}
        </div>
        <p>{extra.reason || 'Sin motivo registrado'}</p>
        {extra.status === 'disputed' && <div className={s.batchMeta}><span>Discrepancia: {extra.dispute_reason || 'Requiere revisión.'}</span></div>}
        {(resume || revoke) && (
          <div className={s.batchActions}>
            {resume && <button type="button" className={s.primaryBtn} onClick={onAuthorize}>Continuar carga de evidencia</button>}
            {revoke && <button type="button" className={s.secondaryBtn} onClick={onRevoke}>Revocar autorización</button>}
          </div>
        )}
      </section>
    )
  }

  const batchText = batch ? `${batch.batch_label || 'Corte'} - ${batchStatusLabel(batch.batch_status, batch.director_status)}` : 'Sin corte activo'
  const history = Array.isArray(context.approval_history) ? context.approval_history : []
  return (
    <section className={s.batchPanel}>
      <div className={s.batchHead}>
        <div>
          <strong>Ruta de autorizacion y pago</strong>
          <span>{batchText}</span>
        </div>
        <Badge variant={context.budget_validation_current ? 'success' : 'warning'}>{context.budget_validation_current ? 'Presupuesto validado' : 'Presupuesto por revisar'}</Badge>
      </div>
      {context.direction_approval_stale && (
        <div className={s.batchMeta}><span>Los datos de la solicitud cambiaron despues de la autorizacion de Direccion. Debe enviarse nuevamente a un corte.</span></div>
      )}
      {history.length === 0 ? (
        <div className={s.batchMeta}><span>Aun no se incorpora a un corte semanal.</span></div>
      ) : (
        <div className={s.batchTimeline} aria-label="Historial de revisiones de Direccion">
          {history.map((row, i) => (
            <div key={i} className={s.batchStep}>
              <span className={`${s.batchDot} ${s[(row.director_status || 'pending') as 'approved' | 'rejected' | 'pending'] || ''}`} />
              <div>
                <strong>{reviewLabel(row.review_sequence)} · {row.batch_label || 'Corte'}</strong>
                <span>{batchStatusLabel(row.batch_status, row.director_status)}{row.decided_at ? ` · ${formatDateTime(row.decided_at)}` : ''}</span>
                {row.reject_reason && <small>Motivo: {row.reject_reason}</small>}
                {(row.correction_note || row.resubmission_note) && <small>Correccion: {row.correction_note || row.resubmission_note}</small>}
              </div>
            </div>
          ))}
        </div>
      )}
      {context.can_authorize_extraordinary ? (
        <div className={s.batchActions}><button type="button" className={s.primaryBtn} onClick={onAuthorize}>Registrar autorización externa</button></div>
      ) : (
        <div className={s.batchMeta}><span>{authorizationBlockReasonLabel(context.authorization_block_reason)}</span></div>
      )}
    </section>
  )
}

function ReceiptSection({ data, onView, onDownload }: { data: any; onView: (id: string) => void; onDownload: (id: string) => void }) {
  const link = data?.link && typeof data.link === 'object' ? data.link : null
  const formatMinor = (v: any, currency = 'MXN') => new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN', minimumFractionDigits: 2 }).format(Number(v || 0) / 100)
  return (
    <section className={s.decisionCard}>
      <div className={s.batchHead}>
        <div>
          <h3>Comprobante de pago</h3>
          <p style={{ margin: '3px 0 0' }}>Vista interna de Finanzas. El importe proviene del comprobante bancario vinculado.</p>
        </div>
        <Badge variant={link ? 'success' : 'neutral'}>{link ? 'Pagada' : 'Sin comprobante'}</Badge>
      </div>
      <div className={s.fundSummary}>
        <div><span>Importe aprobado</span><strong>{formatMinor(data.authorized_minor, data.currency)}</strong></div>
        <div><span>Importe pagado</span><strong>{formatMinor(link?.amount_minor || 0, data.currency)}</strong></div>
        <div><span>Estado</span><strong>{link ? 'Pagada' : 'Pendiente de comprobante'}</strong></div>
      </div>
      {link ? (
        <div className={s.historyItem}>
          <strong>{link.request_number || 'Solicitud pagada'}</strong>
          <span>{link.payment_date || 'Sin fecha'} · referencia {link.reference_hint || '—'}</span>
          <div className={s.batchActions} style={{ marginTop: 8 }}>
            <button type="button" className={s.smallBtn} onClick={() => onView(link.evidence_id)}>Ver comprobante</button>
            <button type="button" className={s.smallBtn} onClick={() => onDownload(link.evidence_id)}>Descargar para compartir</button>
          </div>
        </div>
      ) : (
        <div className={`${s.decisionNote} ${s.neutral}`}>Esta solicitud todavía no tiene un comprobante individual vinculado.</div>
      )}
    </section>
  )
}

function CashFundSection({ context, fund, request, method, onCreate }: {
  context: ExecutionContext
  fund: CashFund | null
  request: RequestSummary
  method: string
  onCreate: () => void
}) {
  const canCreate = context?.can_create_cash_fund === true && !fund
  const availabilityMessage = cashFundAvailabilityMessage(context, fund, null)
  const typeLabel = method === 'check' ? 'Cheque' : 'Efectivo'
  const statusLabels: Record<string, string> = { active: 'Activo', pending_receipt: 'Pendiente de comprobar', blocked: 'Bloqueado', receipt_review: 'En revisión', verified: 'Verificado', closed: 'Cerrado', cancelled: 'Cancelado' }
  return (
    <section className={s.decisionCard}>
      <h3>Fondo y comprobacion</h3>
      <p>Esta solicitud se opera como {typeLabel.toLowerCase()}. El fondo se comprueba desde Efectivo y comprobaciones.</p>
      <div className={`${s.decisionNote} ${fund || canCreate ? s.success : s.neutral}`}>{availabilityMessage}</div>
      <div className={s.detailGrid}>
        <DetailCard label="Tipo" value={typeLabel} />
        <DetailCard label="Fecha limite" value={fund ? formatDate(fund.due_date) : 'Pendiente'} />
        <DetailCard label="Importe autorizado" value={formatCurrencyC(request.amount)} />
        <DetailCard label="Actor de ejecucion" value={context?.is_finance === true ? 'Finanzas' : 'Sin rol de Finanzas'} />
        <DetailCard label="Autorizacion" value={executionAuthorizationSourceLabel(context?.execution_authorization_source)} />
        <DetailCard label="Estado del fondo" value={fund ? (statusLabels[fund.status || ''] || fund.status || 'Sin fondo') : 'Sin fondo creado'} />
        <DetailCard label="Monto pendiente" value={fund ? formatCurrencyC(fund.pending_amount) : 'Pendiente de crear fondo'} />
      </div>
      <div className={s.decisionActions}>
        {canCreate && <button type="button" className={`${s.decisionBtn} ${s.approve}`} onClick={onCreate}>{method === 'check' ? 'Registrar entrega de cheque' : 'Registrar entrega de efectivo'}</button>}
        <Link className={`${s.decisionBtn} ${s.change}`} to={`/efectivo${fund ? `?fund_id=${fund.id}` : ''}`}>Ver en Efectivo y comprobaciones</Link>
      </div>
    </section>
  )
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.detailCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
