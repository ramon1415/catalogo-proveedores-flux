import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import {
  getLinkPreview, acceptExtraction, findReceiptCandidates, linkReceiptToRequest,
  correctExtraction, rejectExtraction,
} from './api'
import { deriveIndividualReceipt, persistIndividualReceipt, openPersistedEvidence } from './workflows'
import {
  friendlyBatchError, formatMinor, minorToDecimal, safeMinorInteger, issueLabel,
  sourceDocumentOf, statusLabel,
} from './logic'
import { loadPdfRuntime } from './pdfRuntime'
import type { BatchOperation, BatchDetail, BatchCapabilities, LinkPreview, ReceiptCandidate, IndividualReceipt } from './types'
import s from './Comprobantes.module.css'

// Flujo de 4 pasos (vinculación 1:1): revisar comprobante → buscar solicitud
// aprobada → confirmar coincidencia → vincular. El importe y la moneda se
// leen del PDF y NUNCA se capturan durante la vinculación (el servidor
// re-valida todas las reglas duras).
type Props = {
  operation: BatchOperation
  detail: BatchDetail
  capabilities: BatchCapabilities
  onClose: () => void
  onChanged: () => Promise<void> | void
}

export function OperationModal({ operation: initialOperation, detail, capabilities, onClose, onChanged }: Props) {
  const { showToast } = useToast()
  const [operation, setOperation] = useState(initialOperation)
  const [preview, setPreview] = useState<LinkPreview | null>(null)
  const [receipt, setReceipt] = useState<IndividualReceipt | null>(null)
  const [candidates, setCandidates] = useState<ReceiptCandidate[]>([])
  const [searchCompleted, setSearchCompleted] = useState(false)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [operationError, setOperationError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [attested, setAttested] = useState(false)
  const [correctionOpen, setCorrectionOpen] = useState(false)

  const epoch = useRef(0)
  const receiptRef = useRef<IndividualReceipt | null>(null)
  receiptRef.current = receipt

  const can = (name: keyof BatchCapabilities) => capabilities[name] === true
  const contractReady = can('can_match') && can('can_link')

  const extractionId = operation.extraction_id || null
  const operationId = operation.bank_operation_id || null
  const extractionStatus = operation.extraction_status || 'review_required'
  const evidence = preview?.evidence ?? null
  const linked = Boolean(preview?.link?.id)
  const shareable = evidence?.status === 'shareable'
  const sourceDoc = sourceDocumentOf(detail)
  const pageNumber = Math.max(1, Number(operation.page_number || operation.source_page) || 1)
  const rejected = extractionStatus === 'rejected'
  const receiptReviewed = Boolean(receipt && receipt.extractionId === extractionId && receipt.pageCount === 1)

  const refreshPreview = useCallback(async (opId: string | null) => {
    if (!opId) { setPreview(null); return }
    const myEpoch = epoch.current
    try {
      const p = await getLinkPreview(opId)
      if (epoch.current === myEpoch) setPreview(p)
    } catch {
      // El preview es informativo; los errores duros salen en las acciones.
    }
  }, [])

  useEffect(() => { refreshPreview(operationId) }, [operationId, refreshPreview])
  useEffect(() => () => {
    epoch.current += 1
    if (receiptRef.current) URL.revokeObjectURL(receiptRef.current.blobUrl)
  }, [])

  // ── Paso 1: ver + aceptar ────────────────────────────────────────────────
  async function openReceipt() {
    if (busy) return
    const evidenceId = evidence?.id || preview?.link?.evidence_id
    if (evidenceId && shareable) {
      const win = window.open('about:blank', '_blank')
      if (!win) { showToast('Ventana bloqueada', 'Permite ventanas emergentes para abrir el comprobante.', 'warning'); return }
      win.opener = null
      setBusy(true)
      try {
        await openPersistedEvidence({ evidenceId, preview: win, download: false })
      } catch (e) {
        win.close()
        showToast('No se pudo abrir el comprobante', friendlyBatchError(e), 'error')
      } finally { setBusy(false) }
      return
    }
    if (!sourceDoc || !extractionId) return
    try { await loadPdfRuntime() } catch {
      showToast('Runtime PDF no disponible', 'Recarga la página. Si el problema continúa, informa a soporte antes de revisar el comprobante.', 'error')
      return
    }
    const win = window.open('about:blank', '_blank')
    if (!win) { showToast('Ventana bloqueada', 'Permite ventanas emergentes para abrir el comprobante.', 'warning'); return }
    win.opener = null
    setBusy(true)
    try {
      const derived = await deriveIndividualReceipt({
        extractionId,
        storageBucket: sourceDoc.storage_bucket,
        storagePath: sourceDoc.storage_path,
        pageNumber,
      })
      if (receiptRef.current) URL.revokeObjectURL(receiptRef.current.blobUrl)
      setReceipt(derived)
      win.location.replace(derived.blobUrl)
    } catch (e) {
      win.close()
      showToast('No se pudo aislar el comprobante', friendlyBatchError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function accept() {
    if (busy || !extractionId || !receiptReviewed) return
    setBusy(true)
    setOperationError('')
    try {
      let opId = operationId
      if (!opId) {
        const result = await acceptExtraction(extractionId, operation.extraction_updated_at ?? null)
        opId = result?.operation_id ?? null
        if (!opId) throw new Error('bank_payment_operation_identifier_missing')
        setOperation((o) => ({ ...o, bank_operation_id: opId }))
      }
      await persistIndividualReceipt(opId, preview?.evidence ?? null, receipt!)
      showToast('Comprobante revisado', 'Los datos y la evidencia individual quedaron listos para buscar una solicitud.', 'success')
      await refreshPreview(opId)
      await onChanged()
    } catch (e) {
      const copy = friendlyBatchError(e)
      setOperationError(copy)
      showToast('No se pudo aceptar el comprobante', copy, 'error')
      if (operationId) await refreshPreview(operationId)
    } finally {
      setBusy(false)
    }
  }

  // ── Paso 2: candidatos ───────────────────────────────────────────────────
  async function searchCandidates() {
    if (!operationId || !can('can_match') || !shareable || busy) return
    setBusy(true)
    setCandidates([])
    setSearchCompleted(false)
    setSelectedRequestId(null)
    const myEpoch = epoch.current
    try {
      const items = await findReceiptCandidates(operationId)
      if (epoch.current !== myEpoch) return
      setCandidates(items)
      setSearchCompleted(true)
      if (items.length === 1) setSelectedRequestId(items[0].payment_request_id) // auto-selección de match único
    } catch (e) {
      showToast('No se pudieron buscar solicitudes', friendlyBatchError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  // ── Paso 4: vincular ─────────────────────────────────────────────────────
  const candidate = candidates.find((c) => c.payment_request_id === selectedRequestId) ?? null

  async function executeLink() {
    if (!operationId || !candidate || !attested || !can('can_link') || busy) return
    setBusy(true)
    try {
      const result = await linkReceiptToRequest(operationId, candidate.payment_request_id)
      setConfirmOpen(false)
      showToast('Comprobante vinculado', `${result?.request_number || 'La solicitud'} quedó marcada como pagada.`, 'success')
      setCandidates([])
      setSelectedRequestId(null)
      await refreshPreview(operationId)
      await onChanged()
    } catch (e) {
      showToast('No se pudo vincular', friendlyBatchError(e), 'error')
      await refreshPreview(operationId)
    } finally {
      setBusy(false)
    }
  }

  async function openEvidence(action: 'view' | 'download') {
    const evidenceId = evidence?.id || preview?.link?.evidence_id
    if (!evidenceId || busy) return
    const win = action === 'view' ? window.open('about:blank', '_blank') : null
    if (action === 'view' && !win) { showToast('Ventana bloqueada', 'Permite ventanas emergentes para abrir el comprobante.', 'warning'); return }
    if (win) win.opener = null
    setBusy(true)
    try {
      await openPersistedEvidence({
        evidenceId,
        preview: win,
        download: action === 'download',
        linkedRequestId: preview?.link?.payment_request_id ?? null,
        linkedRequestNumber: preview?.link?.request_number ?? null,
      })
    } catch (e) {
      win?.close()
      showToast('No se pudo abrir el comprobante', friendlyBatchError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  // ── Guía de siguiente paso (copys del vanilla) ───────────────────────────
  function nextActionReason(): string {
    if (operationError) return `No se avanzó al paso 2: ${operationError}`
    if (!contractReady) return 'El contrato 1:1 todavía no está instalado en este ambiente. La interfaz permanece en modo seguro.'
    if (linked) return 'Paso 4 de 4: el comprobante está vinculado y la solicitud quedó pagada.'
    if (rejected) return 'Este registro no puede utilizarse como comprobante individual.'
    if (!shareable) return 'Paso 1 de 4: abre el comprobante individual, revisa los datos y confírmalos.'
    if (!searchCompleted) return 'Paso 2 de 4: busca solicitudes aprobadas compatibles. La búsqueda no modifica datos.'
    if (!selectedRequestId) {
      return candidates.length
        ? 'Paso 3 de 4: selecciona la solicitud correcta.'
        : 'No existe una coincidencia exacta. El caso requiere revisión.'
    }
    return 'Paso 3 de 4: revisa la comparación y confirma la coincidencia.'
  }

  const steps: { label: string; hint: string; state: 'done' | 'active' | '' }[] = [
    { label: 'Revisar comprobante', hint: shareable ? 'Datos y página aceptados' : rejected ? 'Revisión cerrada' : 'Compara una sola página', state: shareable ? 'done' : 'active' },
    { label: 'Buscar solicitud aprobada', hint: searchCompleted ? 'Búsqueda terminada' : 'Consulta sin escrituras', state: searchCompleted || linked ? 'done' : shareable ? 'active' : '' },
    { label: 'Confirmar coincidencia', hint: selectedRequestId || linked ? 'Coincidencia seleccionada' : 'Importes de solo lectura', state: linked ? 'done' : selectedRequestId ? 'active' : '' },
    { label: 'Comprobante vinculado', hint: linked ? 'Solicitud pagada' : 'Confirmación humana', state: linked ? 'done' : '' },
  ]

  const showAccept = Boolean(extractionId) && !linked
    && (extractionStatus === 'review_required' || (operationId && !shareable))
  const acceptEnabled = can('can_review') && contractReady && Boolean(operation.extraction_updated_at) && receiptReviewed && !busy
  const showSearch = Boolean(operationId) && shareable && !linked
  const showConfirm = !linked && Boolean(candidate)
  const showCorrection = !linked && ['review_required', 'blocked'].includes(extractionStatus)

  const issues = operation.review_issues || []

  return (
    <div className={s.overlay} onClick={() => !busy && onClose()}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className={s.modalHead}>
          <div>
            <h2 style={{ fontSize: '1.1rem' }}>Comprobante · página {operation.source_page || operation.page_number || '—'}</h2>
            <p className="muted">{operation.bank_unique_folio || operation.bank_reference || 'Sin referencia bancaria'}</p>
          </div>
          <button className="small-btn" disabled={busy} onClick={onClose}>Cerrar</button>
        </div>

        <div className={s.modalBody}>
          {/* Stepper */}
          <ol className={s.steps}>
            {steps.map((st, i) => (
              <li key={st.label} className={`${s.step} ${st.state ? s[st.state] : ''}`}>
                <strong>{i + 1}. {st.label}</strong>
                <span className="muted" style={{ fontSize: '.75rem' }}>{st.hint}</span>
              </li>
            ))}
          </ol>

          <p className={s.bannerNote}>
            <strong>Vinculación 1:1 protegida</strong> — Cada comprobante se vincula con una sola solicitud aprobada.
            El importe y la moneda se leen del PDF y nunca se capturan durante la vinculación.
          </p>

          {/* Datos extraídos */}
          <dl className={s.factGrid}>
            <div><dt>Fecha</dt><dd>{operation.application_date || operation.operation_date || 'Sin fecha'}</dd></div>
            <div><dt>Beneficiario</dt><dd>{operation.beneficiary_name || 'Por identificar'}</dd></div>
            <div><dt>Concepto</dt><dd>{operation.payment_reason || operation.concept || 'Sin concepto'}</dd></div>
            <div><dt>Importe</dt><dd>{formatMinor(operation.amount_minor, operation.currency || 'MXN')}</dd></div>
            <div><dt>Extracción</dt><dd><Badge variant={extractionStatus === 'accepted' ? 'success' : extractionStatus === 'rejected' ? 'danger' : 'warning'}>{statusLabel(extractionStatus)}</Badge></dd></div>
          </dl>

          {/* Aviso de extracción */}
          {extractionStatus === 'blocked' && (
            <p className={s.warnNote}><strong>Extracción bloqueada</strong> — {issues.length ? issues.map(issueLabel).join(' · ') : 'Faltan datos bancarios válidos; revisa el comprobante individual.'}</p>
          )}
          {rejected && (
            <p className={s.err}><strong>Revisión cerrada</strong> — {operation.rejection_reason ? `Motivo: ${operation.rejection_reason}` : 'No puede utilizarse como comprobante individual.'}</p>
          )}
          {extractionStatus === 'accepted' && (
            <p className={s.okNote}><strong>Datos aceptados</strong> — El importe y la moneda del comprobante quedaron inmutables para el matching.</p>
          )}
          {extractionStatus === 'review_required' && issues.length > 0 && (
            <p className={s.warnNote}><strong>Revisión requerida</strong> — {issues.map(issueLabel).join(' · ')}</p>
          )}

          {operationError && <p className={s.err} role="alert">No se pudo continuar al paso 2 — {operationError}</p>}

          {/* Vinculado: resumen final */}
          {linked && preview?.link && (
            <div className={s.linkedCard}>
              <Badge variant="success">Comprobante vinculado</Badge>
              <dl className={s.factGrid}>
                <div><dt>Estado</dt><dd>Pagada</dd></div>
                <div><dt>Importe pagado</dt><dd>{formatMinor(preview.link.amount_minor, preview.link.currency || 'MXN')}</dd></div>
                <div><dt>Fecha de pago</dt><dd>{preview.link.payment_date || '—'}</dd></div>
                <div><dt>Referencia</dt><dd>{preview.link.reference_hint || '—'}</dd></div>
              </dl>
              <div className={s.formBtns} style={{ justifyContent: 'flex-start' }}>
                <button className="secondary-btn" disabled={busy} onClick={() => openEvidence('view')}>Ver comprobante</button>
                <button className="secondary-btn" disabled={busy} onClick={() => openEvidence('download')}>Descargar</button>
              </div>
            </div>
          )}

          {/* Acciones primarias */}
          {!linked && (
            <div className={s.formBtns} style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              <button
                className="secondary-btn"
                disabled={(!sourceDoc && !evidence?.id) || busy}
                title={evidence?.id ? 'Abrir el comprobante privado de una sola página' : sourceDoc ? `Crear y abrir únicamente la página ${pageNumber}` : 'No existe una página privada disponible.'}
                onClick={openReceipt}
              >
                Ver comprobante
              </button>
              {showAccept && (
                <button className="primary-btn" disabled={!acceptEnabled} onClick={accept}>
                  {operationId ? 'Comprobante revisado, continuar' : 'Datos correctos, continuar'}
                </button>
              )}
              {showSearch && (
                <button className="primary-btn" disabled={!can('can_match') || busy} onClick={searchCandidates}>
                  Buscar solicitud aprobada
                </button>
              )}
              {showConfirm && (
                <button
                  className="primary-btn"
                  disabled={!can('can_link') || !candidate || !shareable || busy}
                  onClick={() => { setAttested(false); setConfirmOpen(true) }}
                >
                  Vincular comprobante y marcar solicitud como pagada
                </button>
              )}
            </div>
          )}

          <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>{nextActionReason()}</p>

          {/* Candidatos */}
          {!linked && (
            <div>
              {!operationId && <p className={s.matchNote}><strong>Primero revisa el comprobante.</strong> Aceptar los datos crea la operación bancaria necesaria para buscar la solicitud.</p>}
              {operationId && !shareable && <p className={s.matchNote}><strong>Primero termina la revisión.</strong> La búsqueda solo se habilita cuando el comprobante individual fue aceptado.</p>}
              {operationId && shareable && !searchCompleted && <p className={s.matchNote}><strong>Aún no has buscado solicitudes.</strong> Usa “Buscar solicitud aprobada”. La consulta no cambia estados ni crea registros.</p>}
              {searchCompleted && candidates.length === 0 && (
                <p className={s.err}>
                  <strong>No encontramos una solicitud aprobada que coincida con el proveedor, la moneda y el importe de este comprobante.</strong>{' '}
                  No puedes forzar otro importe. Revisa los datos o remite el caso para análisis.
                </p>
              )}
              {searchCompleted && candidates.length > 0 && (
                <>
                  <p className={s.okNote}>
                    {candidates.length === 1
                      ? 'Encontramos una solicitud aprobada compatible con este comprobante.'
                      : 'Encontramos varias solicitudes compatibles. Selecciona la solicitud correcta.'}
                  </p>
                  <ul className={s.candidateList}>
                    {candidates.map((c) => (
                      <li key={c.payment_request_id}>
                        <label className={s.candidate}>
                          <input
                            type="radio"
                            name="receiptCandidate"
                            checked={selectedRequestId === c.payment_request_id}
                            onChange={() => setSelectedRequestId(c.payment_request_id)}
                          />
                          <div>
                            <strong>{c.request_number || 'Solicitud'}</strong> · {c.proveedor_name || 'Proveedor'}
                            <div className="muted" style={{ fontSize: '.8rem' }}>
                              Solicitud: {formatMinor(c.amount_minor, c.currency || 'MXN')} · Comprobante: {formatMinor(operation.amount_minor, operation.currency || 'MXN')} ·
                              Coincidencia: {c.account_match ? 'Cuenta bancaria' : 'Beneficiario'} · Estado: Aprobada
                            </div>
                          </div>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {candidate && (
                <dl className={s.factGrid} style={{ marginTop: 8 }}>
                  <div><dt>Folio de solicitud</dt><dd>{candidate.request_number || '—'}</dd></div>
                  <div><dt>Proveedor</dt><dd>{candidate.proveedor_name || '—'}</dd></div>
                  <div><dt>Beneficiario del comprobante</dt><dd>{operation.beneficiary_name || '—'}</dd></div>
                  <div><dt>Importe de la solicitud</dt><dd>{formatMinor(candidate.amount_minor, candidate.currency || 'MXN')}</dd></div>
                  <div><dt>Importe del comprobante</dt><dd>{formatMinor(operation.amount_minor, operation.currency || 'MXN')}</dd></div>
                  <div><dt>Fecha del pago</dt><dd>{operation.application_date || '—'}</dd></div>
                  <div><dt>Referencia bancaria</dt><dd>{operation.bank_unique_folio || operation.bank_reference || '—'}</dd></div>
                </dl>
              )}
              {candidate && <p className="muted" style={{ margin: '4px 0 0', fontSize: '.8rem' }}>Los importes provienen del PDF aceptado y del snapshot aprobado. Son de solo lectura.</p>}
            </div>
          )}

          {/* Corrección / rechazo */}
          {showCorrection && (
            <details>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: '.85rem' }}>Corregir datos extraídos o cerrar la revisión</summary>
              <div style={{ marginTop: 8 }}>
                <button
                  className="secondary-btn"
                  disabled={!can('can_review') || !contractReady || busy}
                  onClick={() => setCorrectionOpen(true)}
                >
                  Corregir extracción
                </button>
              </div>
            </details>
          )}
        </div>

        {/* Confirmación de vinculación */}
        {confirmOpen && candidate && (
          <div className={s.overlay} onClick={() => !busy && setConfirmOpen(false)} style={{ zIndex: 70 }}>
            <div className={s.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
              <div className={s.modalHead}>
                <h2 style={{ fontSize: '1.05rem' }}>Confirmar vinculación</h2>
                <button className="small-btn" disabled={busy} onClick={() => setConfirmOpen(false)}>Cerrar</button>
              </div>
              <div className={s.modalBody}>
                <p style={{ margin: 0 }}>
                  Vas a vincular el comprobante de {formatMinor(operation.amount_minor, operation.currency || 'MXN')} con la
                  solicitud {candidate.request_number || 'seleccionada'} y marcarla como pagada. El importe se toma del
                  comprobante y no puede modificarse.
                </p>
                <dl className={s.factGrid}>
                  <div><dt>Solicitud</dt><dd>{candidate.request_number || '—'}</dd></div>
                  <div><dt>Proveedor</dt><dd>{candidate.proveedor_name || '—'}</dd></div>
                  <div><dt>Importe</dt><dd>{formatMinor(operation.amount_minor, operation.currency || 'MXN')}</dd></div>
                  <div><dt>Moneda</dt><dd>{operation.currency || 'MXN'}</dd></div>
                </dl>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '.9rem' }}>
                  <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                  Confirmo que revisé el comprobante individual, la solicitud, el importe y la moneda.
                </label>
                <div className={s.formBtns}>
                  <button className="secondary-btn" disabled={busy} onClick={() => setConfirmOpen(false)}>Cancelar</button>
                  <button className="primary-btn" disabled={!attested || busy} onClick={executeLink}>
                    {busy ? 'Vinculando…' : 'Vincular y marcar como pagada'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {correctionOpen && extractionId && (
          <CorrectionDialog
            operation={operation}
            extractionId={extractionId}
            busy={busy}
            setBusy={setBusy}
            onClose={() => setCorrectionOpen(false)}
            onDone={async () => {
              setCorrectionOpen(false)
              if (receiptRef.current) { URL.revokeObjectURL(receiptRef.current.blobUrl); setReceipt(null) }
              await onChanged()
              onClose()
            }}
          />
        )}
      </div>
    </div>
  )
}

// Diálogo de corrección / rechazo de extracción (flujo secundario).
function CorrectionDialog({ operation, extractionId, busy, setBusy, onClose, onDone }: {
  operation: BatchOperation
  extractionId: string
  busy: boolean
  setBusy: (v: boolean) => void
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { showToast } = useToast()
  const [date, setDate] = useState(operation.application_date || operation.operation_date || '')
  const [amount, setAmount] = useState(minorToDecimal(safeMinorInteger(operation.amount_minor)) || '')
  const [currency, setCurrency] = useState(operation.currency || 'MXN')
  const [reference, setReference] = useState(operation.bank_unique_folio || operation.bank_reference || '')
  const [beneficiary, setBeneficiary] = useState(operation.beneficiary_name || '')
  const [concept, setConcept] = useState(operation.payment_reason || operation.concept || '')
  const [reason, setReason] = useState('')

  function parseAmountMinor(value: string): number | null {
    // Espejo de parseMoneyToMinor: decimal con hasta 2 dígitos → centavos.
    const m = value.trim().replace(/,/g, '').match(/^(\d+)(?:\.(\d{1,2}))?$/)
    if (!m) return null
    return Number(m[1]) * 100 + Number((m[2] || '0').padEnd(2, '0'))
  }

  async function submitCorrection() {
    const amountMinor = parseAmountMinor(amount)
    if (!Number.isInteger(amountMinor) || (amountMinor ?? 0) <= 0 || reason.trim().length < 10) {
      showToast('Corrección incompleta', 'Captura datos válidos y un motivo de al menos 10 caracteres.', 'warning')
      return
    }
    setBusy(true)
    try {
      await correctExtraction({
        extractionId,
        expectedUpdatedAt: operation.extraction_updated_at ?? null,
        applicationDate: date,
        amountMinor: amountMinor!,
        currency,
        bankUniqueFolio: reference,
        beneficiaryName: beneficiary,
        paymentReason: concept,
        reason,
      })
      showToast('Corrección guardada', 'Los datos quedaron auditados y deben revisarse nuevamente.', 'success')
      await onDone()
    } catch (e) {
      showToast('No se pudo corregir', friendlyBatchError(e), 'error')
      await onDone()
    } finally {
      setBusy(false)
    }
  }

  async function markUnusable() {
    if (reason.trim().length < 10) {
      showToast('Motivo requerido', 'Explica por qué la página no es un comprobante individual.', 'warning')
      return
    }
    setBusy(true)
    try {
      await rejectExtraction(extractionId, operation.extraction_updated_at ?? null, reason.trim())
      showToast('Comprobante enviado a revisión', 'La página no podrá vincularse ni compartirse.', 'success')
      await onDone()
    } catch (e) {
      showToast('No se pudo cerrar la revisión', friendlyBatchError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={s.overlay} onClick={() => !busy && onClose()} style={{ zIndex: 70 }}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className={s.modalHead}>
          <h2 style={{ fontSize: '1.05rem' }}>Corregir extracción</h2>
          <button className="small-btn" disabled={busy} onClick={onClose}>Cerrar</button>
        </div>
        <div className={s.modalBody}>
          <div className={s.factGrid}>
            <label className={s.field}>Fecha de aplicación<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className={s.field}>Importe<input type="text" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
            <label className={s.field}>Moneda<input type="text" maxLength={3} required value={currency} onChange={(e) => setCurrency(e.target.value)} /></label>
            <label className={s.field}>Folio único / referencia<input type="text" maxLength={120} required value={reference} onChange={(e) => setReference(e.target.value)} /></label>
            <label className={s.field}>Beneficiario<input type="text" maxLength={180} required value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} /></label>
            <label className={s.field}>Concepto<input type="text" maxLength={500} value={concept} onChange={(e) => setConcept(e.target.value)} /></label>
          </div>
          <label className={s.field}>
            Motivo de la corrección (mínimo 10 caracteres)
            <textarea rows={2} minLength={10} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className={s.formBtns}>
            <button className="danger-btn" disabled={busy} onClick={markUnusable}>No es un comprobante individual</button>
            <button className="secondary-btn" disabled={busy} onClick={onClose}>Cancelar</button>
            <button className="primary-btn" disabled={busy} onClick={submitCorrection}>{busy ? 'Guardando…' : 'Guardar corrección'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
