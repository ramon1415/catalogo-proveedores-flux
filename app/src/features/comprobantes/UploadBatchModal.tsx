import { CompanyCaptureContext } from '../../components/ui/CompanyCaptureContext'
import { useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { uploadBatchWorkflow } from './workflows'
import { friendlyBatchError, formatBatchBytes } from './logic'
import { BATCH_IMAGE_MAX_BYTES, BATCH_RECEIPT_ACCEPT, batchReceiptSelectionError } from './receiptInput'
import type { BatchContext, CreateBatchResult } from './types'
import s from './Comprobantes.module.css'

// PDFs keep their original bytes. A JPG/PNG is read locally and stored as a
// single-page PDF, preserving the existing evidence and confirmation contract.
export function UploadBatchModal({ context, defaultCompanyId, onClose, onUploaded, onDuplicate }: {
  context: BatchContext
  defaultCompanyId: string | null
  onClose: () => void
  onUploaded: (batchId: string, pageCount: number, parserVersion: string) => void
  onDuplicate: (batchId: string, created: CreateBatchResult) => void
}) {
  const { showToast } = useToast()
  const companies = context.companies || []
  const [companyId, setCompanyId] = useState(defaultCompanyId || (companies.length === 1 ? companies[0].id : ''))
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ percent: number; text: string } | null>(null)
  const [err, setErr] = useState('')
  const reading = useRef<AbortController | null>(null)
  const submitting = useRef(false)
  useEffect(() => () => { reading.current?.abort(new Error('batch_read_cancelled')) }, [])

  const maxBytes = Number(context.upload_policy?.max_file_bytes || 25 * 1024 * 1024)

  function validate(): string {
    if (!companyId) return 'Selecciona una empresa.'
    if (!file) return 'Selecciona un comprobante PDF, JPG o PNG.'
    return batchReceiptSelectionError(file, maxBytes)
  }

  async function submit() {
    if (submitting.current) return
    const validation = validate()
    if (validation) { setErr(validation); return }
    setErr('')
    submitting.current = true
    const controller = new AbortController()
    reading.current = controller
    setBusy(true)
    try {
      const result = await uploadBatchWorkflow({
        companyId,
        file: file!,
        context,
        signal: controller.signal,
        onProgress: (percent, text) => { if (!controller.signal.aborted) setProgress({ percent, text }) },
      })
      if (controller.signal.aborted) return
      if (result.kind === 'duplicate') {
        onDuplicate(result.batchId, result.created)
        return
      }
      showToast('Batch recibido', `${result.pageCount} comprobante(s) listos para revisar las coincidencias.`, 'success')
      onUploaded(result.batchId, result.pageCount, result.parserVersion)
    } catch (e) {
      if (controller.signal.aborted) return
      const copy = friendlyBatchError(e)
      setErr(copy)
      showToast('No se pudo completar la ingesta', copy, 'error')
    } finally {
      submitting.current = false
      reading.current = null
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className={s.overlay} onClick={() => !busy && onClose()}>
      <div className={`${s.modal} ${s.uploadModal}`} role="dialog" aria-modal="true" aria-labelledby="batch-upload-title" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className={s.modalHead}>
          <div>
            <h2 id="batch-upload-title" style={{ fontSize: '1.1rem' }}>Nuevo batch de comprobantes</h2>
            <p className="muted">Carga un PDF, JPG o PNG. Finanzas revisará las coincidencias antes de confirmar.</p>
            <CompanyCaptureContext company={companies.find(company => company.id === companyId)} />
          </div>
          <button className="small-btn" disabled={busy} onClick={onClose}>Cerrar</button>
        </div>
        <div className={`${s.modalBody} ${s.uploadBody}`}>
          <label className={s.field}>
            Empresa
            <select value={companyId} disabled={busy} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Selecciona…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.legal_name || c.name || c.id}</option>)}
            </select>
          </label>
          <label className={s.field}>
            Comprobante PDF o imagen
            <input
              type="file"
              accept={BATCH_RECEIPT_ACCEPT}
              disabled={busy}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr('') }}
            />
            <span className="muted" style={{ fontSize: '.8rem' }}>
              {file ? `${formatBatchBytes(file.size)} · listo para procesar` : `PDF hasta ${formatBatchBytes(maxBytes)}. JPG/PNG hasta ${formatBatchBytes(Math.min(maxBytes, BATCH_IMAGE_MAX_BYTES))}.`}
            </span>
            <span className="muted" style={{ fontSize: '.8rem' }}>Una imagen completa por pago, sin recortes ni datos borrosos. Para varios pagos, usa un PDF con un comprobante por página.</span>
          </label>

          {progress && (
            <div>
              <div className={s.progressTrack}><div className={s.progressFill} style={{ width: `${progress.percent}%` }} /></div>
              <p className="muted" role="status" style={{ margin: '4px 0 0', fontSize: '.85rem' }}>{progress.text}</p>
            </div>
          )}
          {err && <p className={s.err} role="alert">{err}</p>}
        </div>
          <div className={`${s.formBtns} ${s.uploadActions}`}>
            <button className="secondary-btn" disabled={busy && (progress?.percent || 0) >= 40} onClick={() => {
              if (busy) reading.current?.abort(new Error('batch_read_cancelled'))
              onClose()
            }}>{busy ? 'Cancelar lectura' : 'Cancelar'}</button>
            <button className="primary-btn" disabled={busy} onClick={submit}>{busy ? 'Procesando…' : 'Procesar comprobante'}</button>
          </div>
      </div>
    </div>
  )
}
