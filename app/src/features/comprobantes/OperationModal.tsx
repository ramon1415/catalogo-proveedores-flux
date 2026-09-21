import { ActiveCompanyCaptureContext } from '../../components/ui/CompanyCaptureContext'
import { useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { getLinkPreview, previewReceiptCandidates, correctExtraction, rejectExtraction } from './api'
import { deriveIndividualReceipt, openPersistedEvidence } from './workflows'
import { confirmReceiptMatch } from './reconciliation'
import { ReceiptComparison } from './ReceiptComparison'
import { friendlyBatchError, formatMinor, minorToDecimal, safeMinorInteger, issueLabel, sourceDocumentOf } from './logic'
import type { BatchOperation, BatchDetail, BatchCapabilities, ReceiptCandidatePreview, IndividualReceipt } from './types'
import s from './Comprobantes.module.css'

type Props = {
  operation: BatchOperation
  detail: BatchDetail
  capabilities: BatchCapabilities
  onClose: () => void
  onStartNewBatch: () => void
  onChanged: () => Promise<void> | void
}

const NON_CORRECTABLE_ISSUES = new Set(['bank_not_identified', 'bank_status_not_operated', 'strong_bank_identity_missing'])

export function OperationModal({ operation, detail, capabilities, onClose, onStartNewBatch, onChanged }: Props) {
  const { showToast } = useToast()
  const [proposal, setProposal] = useState<ReceiptCandidatePreview | null>(null)
  const [receipt, setReceipt] = useState<IndividualReceipt | null>(null)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [operationError, setOperationError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const confirming = useRef(false)
  const sourceDoc = sourceDocumentOf(detail)
  const extractionId = operation.extraction_id || null
  const extractionStatus = operation.extraction_status || 'review_required'
  const pageNumber = Math.max(1, Number(operation.page_number || operation.source_page) || 1)
  const preview = proposal?.link_preview
  const linked = Boolean(preview?.link?.id)
  const issues = operation.review_issues || []
  const requiresOriginalBbvaPdf = extractionStatus === 'blocked' && issues.some(issue => NON_CORRECTABLE_ISSUES.has(issue))
  const canConfirm = capabilities.can_match === true && capabilities.can_review === true && capabilities.can_link === true
  const candidates = proposal?.items || []
  const candidate = candidates.find(c => c.payment_request_id === selectedRequestId) || null

  // Both operations are read-only. No acceptance, evidence attestation or
  // linking runs in an effect. Closing this screen leaves payment data intact.
  useEffect(() => {
    let active = true
    let derived: IndividualReceipt | null = null
    setProposal(null)
    setReceipt(null)
    setSelectedRequestId(null)
    setOperationError('')
    setLoading(true)
    ;(async () => {
      try {
        if (!extractionId) throw new Error('payment_extraction_not_found')
        if (capabilities.can_match !== true) throw new Error('finance_role_required')
        const results = await Promise.allSettled([
          previewReceiptCandidates(extractionId, operation.extraction_updated_at || null),
          sourceDoc ? deriveIndividualReceipt({ extractionId, storageBucket: sourceDoc.storage_bucket, storagePath: sourceDoc.storage_path, pageNumber })
            : Promise.reject(new Error('source_pdf_download_unavailable')),
        ])
        if (results[1].status === 'fulfilled') derived = results[1].value
        if (!active) { if (derived) URL.revokeObjectURL(derived.blobUrl); return }
        if (results[0].status === 'fulfilled') {
          const next = results[0].value
          setProposal(next)
          if (next.outcome === 'exact' && next.items.length === 1) setSelectedRequestId(next.items[0].payment_request_id)
        }
        setReceipt(derived)
        const failure = results.find(result => result.status === 'rejected')
        if (failure?.status === 'rejected') setOperationError(friendlyBatchError(failure.reason))
      } catch (error) {
        if (active) setOperationError(friendlyBatchError(error))
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false; if (derived) URL.revokeObjectURL(derived.blobUrl) }
  }, [extractionId, operation.extraction_updated_at, operation.bank_operation_id, sourceDoc?.storage_bucket, sourceDoc?.storage_path, pageNumber, capabilities.can_match, revision])

  async function executeLink() {
    if (confirming.current || busy || loading || !canConfirm || !candidate || !receipt || operationError || proposal?.outcome === 'blocked') return
    confirming.current = true
    setBusy(true)
    try {
      const result = await confirmReceiptMatch({ operation, candidate, receipt })
      const next = await getLinkPreview(operation.bank_operation_id || extractionId!)
      setProposal({ items: [], outcome: 'linked', link_preview: next })
      showToast('Conciliación confirmada', `${result.request_number || candidate.request_number || 'La solicitud'} quedó marcada como pagada.`, 'success')
      await onChanged()
    } catch (error) {
      const copy = friendlyBatchError(error)
      setOperationError(copy)
      showToast('No se pudo completar la conciliación', copy, 'error')
      await onChanged()
    } finally { confirming.current = false; setBusy(false) }
  }

  async function openEvidence(action: 'view' | 'download') {
    const evidenceId = preview?.link?.evidence_id || preview?.evidence?.id
    if (!evidenceId || busy) return
    const win = action === 'view' ? window.open('about:blank', '_blank') : null
    if (action === 'view' && !win) { showToast('Ventana bloqueada', 'Permite ventanas emergentes para abrir el comprobante.', 'warning'); return }
    if (win) win.opener = null
    setBusy(true)
    try {
      await openPersistedEvidence({ evidenceId, preview: win, download: action === 'download', linkedRequestId: preview?.link?.payment_request_id, linkedRequestNumber: preview?.link?.request_number })
    } catch (error) {
      win?.close()
      showToast('No se pudo abrir el comprobante', friendlyBatchError(error), 'error')
    } finally { setBusy(false) }
  }

  const showCorrection = !linked && !requiresOriginalBbvaPdf && ['review_required', 'blocked'].includes(extractionStatus)

  return (
    <div className={s.overlay} onClick={() => !busy && onClose()}>
      <div className={`${s.modal} ${s.operationModal}`} role="dialog" aria-modal="true" aria-labelledby="operation-modal-title" onClick={e => e.stopPropagation()}>
        <div className={`${s.modalHead} ${s.operationHeader}`}>
          <div>
            <span className={s.modalEyebrow}>Conciliación automática</span>
            <h2 id="operation-modal-title">{linked ? 'Comprobante vinculado' : 'Confirma la coincidencia'}</h2>
            <p className="muted">Flux compara el monto, la moneda y el beneficiario o cuenta bancaria.</p>
            <ActiveCompanyCaptureContext />
          </div>
          <button className={s.closeButton} aria-label="Cerrar revisión" title="Cerrar" disabled={busy} onClick={onClose}>×</button>
        </div>
        <div className={`${s.modalBody} ${s.operationBody}`}>
          {loading && <p className={s.matchNote} role="status">Buscando la solicitud y preparando el comprobante automáticamente…</p>}
          {operationError && <p className={s.err} role="alert">{operationError}</p>}
          {!canConfirm && <p className={s.warnNote}>Necesitas permisos de Finanzas en esta empresa para confirmar la conciliación.</p>}
          {linked && preview?.link ? (
            <div className={s.linkedCard}>
              <Badge variant="success">Conciliación confirmada</Badge>
              <strong>{preview.link.request_number || 'Solicitud'} · Pagada</strong>
              <p>{formatMinor(preview.link.amount_minor, preview.link.currency || 'MXN')} · {preview.link.payment_date}</p>
              <div className={s.formBtns}>
                <button className="secondary-btn" disabled={busy} onClick={() => openEvidence('view')}>Ver comprobante</button>
                <button className="secondary-btn" disabled={busy} onClick={() => openEvidence('download')}>Descargar</button>
              </div>
            </div>
          ) : (
            <>
              {proposal?.outcome === 'exact' && <p className={s.okNote}>Encontramos una coincidencia. Revisa ambos documentos y confirma si es correcta.</p>}
              {proposal?.outcome === 'none' && <p className={s.warnNote}>No encontramos una solicitud disponible con estos datos. Verifica que esté aprobada y que su corte esté cerrado; si ya cumple, revisa el beneficiario, la moneda y el importe.</p>}
              {proposal?.outcome === 'blocked' && <p className={s.warnNote}>{proposal.block_reason ? friendlyBatchError(new Error(proposal.block_reason)) : 'Este comprobante requiere revisión.'} {issues.map(issueLabel).join(' · ')}</p>}
              {extractionStatus === 'rejected' && <p className={s.err}>Este comprobante fue rechazado. {operation.rejection_reason}</p>}
              {candidates.length > 1 && <fieldset className={s.candidateOptions}>
                <legend>Hay varias solicitudes compatibles. Elige la correcta.</legend>
                {candidates.map(item => <label className={s.candidate} key={item.payment_request_id}>
                  <input type="radio" name="receiptCandidate" checked={selectedRequestId === item.payment_request_id} disabled={busy} onChange={() => setSelectedRequestId(item.payment_request_id)} />
                  <span><strong>{item.request_number}</strong> · {item.proveedor_name}<small>{item.concept} · {formatMinor(item.amount_minor, item.currency || 'MXN')}</small></span>
                </label>)}
              </fieldset>}
              <ReceiptComparison operation={operation} receipt={receipt} candidate={candidate} loading={loading} />
              {showCorrection && <details className={s.correctionDisclosure}>
                <summary>¿Los datos leídos son incorrectos?</summary>
                <button className="secondary-btn" disabled={busy || loading || !receipt || capabilities.can_review !== true} onClick={() => setCorrectionOpen(true)}>Corregir datos para continuar</button>
              </details>}
              {requiresOriginalBbvaPdf && <button className="secondary-btn" disabled={busy} onClick={onStartNewBatch}>Subir comprobante BBVA original</button>}
            </>
          )}
        </div>
        {!linked && <div className={s.operationActions}>
          <p className={s.confirmationCopy}>Al confirmar validas que esta página corresponde a un solo pago y que la solicitud, el importe y la moneda son correctos.</p>
          <div className={s.operationActionButtons}>
            {!loading && (operationError || proposal?.outcome === 'none') && <button className="secondary-btn" disabled={busy} onClick={() => setRevision(value => value + 1)}>Actualizar coincidencias</button>}
            <button className="primary-btn" disabled={busy || loading || !canConfirm || !candidate || !receipt || Boolean(operationError) || proposal?.outcome === 'blocked'} onClick={executeLink}>{busy ? 'Confirmando…' : 'Confirmar y marcar pagada'}</button>
          </div>
        </div>}
        {correctionOpen && extractionId && <CorrectionDialog operation={operation} extractionId={extractionId} busy={busy} setBusy={setBusy} onClose={() => setCorrectionOpen(false)} onDone={async () => { setCorrectionOpen(false); await onChanged(); setRevision(value => value + 1) }} />}
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
          <div><h2 style={{ fontSize: '1.05rem' }}>Corregir extracción</h2><ActiveCompanyCaptureContext /></div>
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
