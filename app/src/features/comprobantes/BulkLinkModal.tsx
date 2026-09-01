import { useEffect, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { findReceiptCandidates, linkReceiptToRequest, getLinkPreview } from './api'
import { friendlyBatchError, formatMinor } from './logic'
import type { BatchOperation, ReceiptCandidate } from './types'
import s from './Comprobantes.module.css'

// Reducción de clicks a nivel batch: busca candidatos para TODAS las
// operaciones shareable sin vincular y ofrece vincular en bloque SOLO las
// coincidencias únicas y exactas. Los casos ambiguos (0 o >1 candidatos)
// permanecen manuales — el gate de auditoría se conserva: confirmación humana
// única con atestación y los importes siguen siendo inmutables del PDF.
type ExactMatch = {
  operation: BatchOperation
  candidate: ReceiptCandidate
}

type Scan = {
  exact: ExactMatch[]
  ambiguous: number
  none: number
  skipped: number
}

export function BulkLinkModal({ operations, onClose, onLinked }: {
  operations: BatchOperation[]
  onClose: () => void
  onLinked: () => Promise<void> | void
}) {
  const { showToast } = useToast()
  const [scan, setScan] = useState<Scan | null>(null)
  const [scanErr, setScanErr] = useState('')
  const [attested, setAttested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const exact: ExactMatch[] = []
        let ambiguous = 0
        let none = 0
        let skipped = 0
        for (const op of operations) {
          if (!op.bank_operation_id) { skipped += 1; continue }
          // Solo operaciones con evidencia shareable y sin vínculo previo.
          const preview = await getLinkPreview(op.bank_operation_id).catch(() => null)
          if (!preview || preview.evidence?.status !== 'shareable' || preview.link?.id) { skipped += 1; continue }
          const candidates = await findReceiptCandidates(op.bank_operation_id)
          if (candidates.length === 1) exact.push({ operation: op, candidate: candidates[0] })
          else if (candidates.length > 1) ambiguous += 1
          else none += 1
        }
        if (active) setScan({ exact, ambiguous, none, skipped })
      } catch (e) {
        if (active) setScanErr(friendlyBatchError(e))
      }
    })()
    return () => { active = false }
  }, [operations])

  async function linkAll() {
    if (!scan || !attested || busy) return
    setBusy(true)
    let linked = 0
    let failed = 0
    try {
      for (const { operation, candidate } of scan.exact) {
        setProgress(`Vinculando ${linked + failed + 1} de ${scan.exact.length}…`)
        try {
          await linkReceiptToRequest(operation.bank_operation_id!, candidate.payment_request_id)
          linked += 1
        } catch {
          failed += 1 // el detalle del error se ve al reabrir la operación
        }
      }
      if (failed === 0) {
        showToast('Vinculación en bloque completada', `${linked} comprobantes quedaron vinculados y sus solicitudes marcadas como pagadas.`, 'success')
      } else {
        showToast('Vinculación parcial', `${linked} vinculados; ${failed} fallaron y requieren revisión manual.`, 'warning')
      }
      await onLinked()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={s.overlay} onClick={() => !busy && onClose()}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className={s.modalHead}>
          <div>
            <h2 style={{ fontSize: '1.05rem' }}>Vincular coincidencias exactas</h2>
            <p className="muted">Solo se vinculan matches únicos; los ambiguos permanecen manuales.</p>
          </div>
          <button className="small-btn" disabled={busy} onClick={onClose}>Cerrar</button>
        </div>
        <div className={s.modalBody}>
          {!scan && !scanErr && <p className={s.msg}>Buscando coincidencias exactas… La consulta no modifica datos.</p>}
          {scanErr && <p className={s.err}>{scanErr}</p>}
          {scan && (
            <>
              <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
                {scan.exact.length} con coincidencia exacta · {scan.ambiguous} ambiguas (manual) · {scan.none} sin coincidencia · {scan.skipped} sin revisar o ya vinculadas.
              </p>
              {scan.exact.length === 0 ? (
                <p className={s.matchNote}>No hay coincidencias exactas pendientes. Revisa cada operación manualmente.</p>
              ) : (
                <>
                  <ul className={s.candidateList}>
                    {scan.exact.map(({ operation, candidate }) => (
                      <li key={operation.bank_operation_id} className={s.candidate} style={{ cursor: 'default' }}>
                        <div>
                          <strong>{candidate.request_number || 'Solicitud'}</strong> · {candidate.proveedor_name || 'Proveedor'}
                          <div className="muted" style={{ fontSize: '.8rem' }}>
                            Comprobante pág. {operation.source_page || operation.page_number || '—'} ·{' '}
                            {formatMinor(operation.amount_minor, operation.currency || 'MXN')} ·{' '}
                            Coincidencia: {candidate.account_match ? 'Cuenta bancaria' : 'Beneficiario'}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '.9rem' }}>
                    <input type="checkbox" checked={attested} disabled={busy} onChange={(e) => setAttested(e.target.checked)} />
                    Confirmo que revisé las {scan.exact.length} coincidencias listadas: comprobante, solicitud, importe y moneda.
                  </label>
                  {progress && <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>{progress}</p>}
                  <div className={s.formBtns}>
                    <button className="secondary-btn" disabled={busy} onClick={onClose}>Cancelar</button>
                    <button className="primary-btn" disabled={!attested || busy} onClick={linkAll}>
                      {busy ? 'Vinculando…' : `Vincular ${scan.exact.length} y marcar como pagadas`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
