import { ActiveCompanyCaptureContext } from '../../components/ui/CompanyCaptureContext'
import { useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { previewReceiptCandidates, privateBucket } from './api'
import { deriveIndividualReceipt } from './workflows'
import { confirmReceiptMatch, nonConflictingMatches } from './reconciliation'
import { ReceiptComparison } from './ReceiptComparison'
import { friendlyBatchError, sourceDocumentOf } from './logic'
import type { BatchCapabilities, BatchDetail, BatchOperation, IndividualReceipt, ReceiptCandidate } from './types'
import s from './Comprobantes.module.css'

type Match = {
  operation: BatchOperation
  candidate: ReceiptCandidate
  receipt: Pick<IndividualReceipt, 'previewDataUrl'>
  status: 'ready' | 'linked' | 'error'
  error?: string
}
type Exception = { operation: BatchOperation; reason: string }
type Scan = { exact: Match[]; exceptions: Exception[]; linked: number }

export function BulkLinkModal({ operations, detail, capabilities, onClose, onLinked, onReview }: {
  operations: BatchOperation[]
  detail: BatchDetail
  capabilities: BatchCapabilities
  onClose: () => void
  onLinked: () => Promise<void> | void
  onReview: (operation: BatchOperation) => void
}) {
  const { showToast } = useToast()
  const [scan, setScan] = useState<Scan | null>(null)
  const [scanErr, setScanErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [revision, setRevision] = useState(0)
  const confirming = useRef(false)
  const sourcePdf = useRef<Blob | null>(null)
  const batchId = String((detail.batch || detail.ingestion_batch)?.id || '')
  const canConfirm = capabilities.can_match === true && capabilities.can_review === true && capabilities.can_link === true

  useEffect(() => {
    let active = true
    sourcePdf.current = null
    setScan(null)
    setScanErr('')
    ;(async () => {
      try {
        if (!canConfirm) throw new Error('finance_role_required')
        const matches: { operation: BatchOperation; candidate: ReceiptCandidate }[] = []
        const exceptions: Exception[] = []
        let linked = 0
        for (const [index, operation] of operations.entries()) {
          if (!active) return
          setProgress(`Buscando coincidencias ${index + 1} de ${operations.length}…`)
          if (!operation.extraction_id) { exceptions.push({ operation, reason: 'Esta página aún no tiene datos listos para comparar.' }); continue }
          try {
            const preview = await previewReceiptCandidates(operation.extraction_id, operation.extraction_updated_at || null)
            if (preview.outcome === 'linked') { linked += 1; continue }
            if (preview.outcome === 'exact' && preview.items.length === 1) matches.push({ operation, candidate: preview.items[0] })
            else exceptions.push({ operation, reason: preview.outcome === 'multiple' ? 'Hay varias solicitudes compatibles.'
              : preview.block_reason ? friendlyBatchError(new Error(preview.block_reason))
                : 'Sin solicitud disponible: verifica los datos, la aprobación y el cierre del corte.' })
          } catch (error) { exceptions.push({ operation, reason: friendlyBatchError(error) }) }
        }
        const safe = nonConflictingMatches(matches)
        exceptions.push(...safe.conflicts.map(match => ({ operation: match.operation, reason: 'Otra página compite por la misma solicitud o referencia bancaria. Requiere revisión.' })))
        const exact: Match[] = []
        if (safe.exact.length) {
          const source = sourceDocumentOf(detail)
          if (!source) throw new Error('source_pdf_download_unavailable')
          // One source download per batch, bounded sequential derivation.
          const bucket = await privateBucket(source.storage_bucket)
          const downloaded = await bucket.download(source.storage_path)
          if (downloaded.error || !downloaded.data) throw downloaded.error || new Error('source_pdf_download_unavailable')
          if (!active) return
          sourcePdf.current = downloaded.data
          for (const [index, match] of safe.exact.entries()) {
            if (!active) return
            setProgress(`Preparando comprobantes ${index + 1} de ${safe.exact.length}…`)
            try {
              const receipt = await deriveIndividualReceipt({ extractionId: match.operation.extraction_id!, storageBucket: source.storage_bucket, storagePath: source.storage_path,
                pageNumber: Number(match.operation.page_number || match.operation.source_page || 1), sourcePdf: downloaded.data, previewWidth: 600 })
              // Keep only a compact rendered preview. Retaining hundreds of
              // individual PDF blobs/byte arrays exhausts mobile memory.
              exact.push({ ...match, receipt: { previewDataUrl: receipt.previewDataUrl }, status: 'ready' })
              URL.revokeObjectURL(receipt.blobUrl)
            } catch (error) { exceptions.push({ operation: match.operation, reason: friendlyBatchError(error) }) }
          }
        }
        if (active) { setScan({ exact, exceptions, linked }); setProgress('') }
      } catch (error) {
        if (active) setScanErr(friendlyBatchError(error))
      }
    })()
    return () => { active = false; sourcePdf.current = null }
    // Freeze the review set while confirming. A refresh or reopening explicitly
    // loads current props; parent refreshes must not restart scans mid-payment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, revision])

  async function linkAll() {
    if (!scan || !canConfirm || busy || confirming.current) return
    const ready = scan.exact.filter(match => match.status === 'ready')
    if (!ready.length) return
    confirming.current = true
    setBusy(true)
    let linked = 0
    let failed = 0
    try {
      for (const [index, match] of ready.entries()) {
        setProgress(`Confirmando ${index + 1} de ${ready.length}…`)
        let error = ''
        let receipt: IndividualReceipt | null = null
        try {
          const source = sourceDocumentOf(detail)
          if (!source || !sourcePdf.current) throw new Error('source_pdf_download_unavailable')
          // Derive one PDF at a time from the same immutable source Blob that
          // produced the displayed preview; release it after confirmation.
          receipt = await deriveIndividualReceipt({ extractionId: match.operation.extraction_id!, storageBucket: source.storage_bucket, storagePath: source.storage_path,
            pageNumber: Number(match.operation.page_number || match.operation.source_page || 1), sourcePdf: sourcePdf.current, previewWidth: 600 })
          await confirmReceiptMatch({ ...match, receipt })
          linked += 1
        }
        catch (failure) { error = friendlyBatchError(failure); failed += 1 }
        finally { if (receipt) URL.revokeObjectURL(receipt.blobUrl) }
        setScan(current => current && ({ ...current, exact: current.exact.map(item => item.operation.extraction_id === match.operation.extraction_id
          ? { ...item, status: error ? 'error' : 'linked', error } : item) }))
      }
      showToast(failed ? 'Conciliación parcial' : 'Conciliación confirmada', `${linked} comprobantes vinculados${failed ? `; ${failed} requieren revisión. El motivo aparece en cada comprobante.` : ' y sus solicitudes marcadas como pagadas.'}`, failed ? 'warning' : 'success')
      await onLinked()
    } finally { setBusy(false); confirming.current = false; setProgress('') }
  }

  async function expandReceipt(match: Match) {
    const source = sourceDocumentOf(detail)
    if (busy || !source || !sourcePdf.current) return
    const win = window.open('about:blank', '_blank')
    if (!win) { showToast('Ventana bloqueada', 'Permite ventanas emergentes para ampliar el PDF.', 'warning'); return }
    win.opener = null
    setBusy(true)
    try {
      const receipt = await deriveIndividualReceipt({ extractionId: match.operation.extraction_id!, storageBucket: source.storage_bucket, storagePath: source.storage_path,
        pageNumber: Number(match.operation.page_number || match.operation.source_page || 1), sourcePdf: sourcePdf.current })
      win.location.replace(receipt.blobUrl)
      setTimeout(() => URL.revokeObjectURL(receipt.blobUrl), 60000)
    } catch (error) { win.close(); showToast('No se pudo ampliar el comprobante', friendlyBatchError(error), 'error') }
    finally { setBusy(false) }
  }

  const readyCount = scan?.exact.filter(match => match.status === 'ready').length || 0
  return (
    <div className={s.overlay} onClick={() => !busy && onClose()}>
      <div className={`${s.modal} ${s.operationModal}`} role="dialog" aria-modal="true" aria-labelledby="bulk-reconciliation-title" onClick={e => e.stopPropagation()}>
        <div className={`${s.modalHead} ${s.operationHeader}`}>
          <div><span className={s.modalEyebrow}>Conciliación automática</span><h2 id="bulk-reconciliation-title">Confirma las coincidencias</h2><p className="muted">Flux ya buscó las solicitudes. Revisa las parejas propuestas.</p><ActiveCompanyCaptureContext /></div>
          <button className={s.closeButton} aria-label="Cerrar conciliación" disabled={busy} onClick={onClose}>×</button>
        </div>
        <div className={`${s.modalBody} ${s.operationBody}`}>
          {progress && <p className={s.matchNote} role="status">{progress}</p>}
          {scanErr && <p className={s.err} role="alert">{scanErr}</p>}
          {scan && <>
            <p className={s.okNote}>{readyCount} coincidencias por confirmar · {scan.exceptions.length} por revisar · {scan.linked + scan.exact.filter(match => match.status === 'linked').length} vinculadas.</p>
            {scan.exact.map(match => <article className={s.batchMatch} key={match.operation.extraction_id}>
              {match.status === 'linked' ? <p className={s.okNote}>{match.candidate.request_number} · Comprobante vinculado y solicitud pagada.</p>
                : <ReceiptComparison operation={match.operation} candidate={match.candidate} receipt={match.receipt} onExpand={() => { void expandReceipt(match) }} />}
              {match.error && <p className={s.err} role="alert">{match.error}</p>}
            </article>)}
            {scan.exceptions.length > 0 && <section aria-label="Comprobantes que requieren revisión">
              <h3>Requieren revisión</h3>
              <ul className={s.candidateList}>{scan.exceptions.map((item, index) => <li className={s.exceptionRow} key={item.operation.extraction_id || index}>
                <div><strong>Página {item.operation.page_number || item.operation.source_page || '—'} · {item.operation.beneficiary_name}</strong><p>{item.reason}</p></div>
                <button className="secondary-btn" disabled={busy} onClick={() => onReview(item.operation)}>Revisar caso</button>
              </li>)}</ul>
            </section>}
          </>}
        </div>
        <div className={s.operationActions}>
          <p className={s.confirmationCopy}>Al confirmar validas que cada página corresponde a un solo pago y que las solicitudes e importes mostrados son correctos. Se vincularán y marcarán como pagadas.</p>
          <div className={s.operationActionButtons}>
            {(scanErr || (scan && !readyCount)) && <button className="secondary-btn" disabled={busy} onClick={() => setRevision(value => value + 1)}>Actualizar coincidencias</button>}
            <button className="primary-btn" disabled={!readyCount || !canConfirm || busy} onClick={linkAll}>{busy ? 'Confirmando…' : `Confirmar ${readyCount} coincidencias`}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
