import { useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { uploadBatchWorkflow } from './workflows'
import { friendlyBatchError, formatBatchBytes } from './logic'
import type { BatchContext, CreateBatchResult } from './types'
import s from './Comprobantes.module.css'

// Ingesta de un PDF BBVA multi-página: firma %PDF-, sha256, extracción local
// con el parser vendored, y subida al bucket que autoriza el servidor.
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

  const maxBytes = Number(context.upload_policy?.max_file_bytes || 25 * 1024 * 1024)

  function validate(): string {
    if (!companyId) return 'Selecciona una empresa.'
    if (!file) return 'Selecciona un archivo PDF.'
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) return 'Solo se admite PDF válido.'
    if (file.size < 1 || file.size > maxBytes) return `El PDF debe pesar máximo ${formatBatchBytes(maxBytes)}.`
    return ''
  }

  async function submit() {
    if (busy) return
    const validation = validate()
    if (validation) { setErr(validation); return }
    setErr('')
    setBusy(true)
    try {
      const result = await uploadBatchWorkflow({
        companyId,
        file: file!,
        context,
        onProgress: (percent, text) => setProgress({ percent, text }),
      })
      if (result.kind === 'duplicate') {
        onDuplicate(result.batchId, result.created)
        return
      }
      showToast('Batch recibido', `${result.pageCount} página(s) fueron procesadas con ${result.parserVersion}.`, 'success')
      onUploaded(result.batchId, result.pageCount, result.parserVersion)
    } catch (e) {
      const copy = friendlyBatchError(e)
      setErr(copy)
      showToast('No se pudo completar la ingesta', copy, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={s.overlay} onClick={() => !busy && onClose()}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className={s.modalHead}>
          <div>
            <h2 style={{ fontSize: '1.1rem' }}>Nuevo batch de comprobantes</h2>
            <p className="muted">Solo PDF. El límite y bucket los autoriza el servidor.</p>
          </div>
          <button className="small-btn" disabled={busy} onClick={onClose}>Cerrar</button>
        </div>
        <div className={s.modalBody}>
          <label className={s.field}>
            Empresa
            <select value={companyId} disabled={busy} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Selecciona…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.legal_name || c.name || c.id}</option>)}
            </select>
          </label>
          <label className={s.field}>
            Archivo PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={busy}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr('') }}
            />
            <span className="muted" style={{ fontSize: '.8rem' }}>
              {file ? `${formatBatchBytes(file.size)} · listo para procesar` : 'Solo PDF. El límite y bucket los autoriza el servidor.'}
            </span>
          </label>

          {progress && (
            <div>
              <div className={s.progressTrack}><div className={s.progressFill} style={{ width: `${progress.percent}%` }} /></div>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: '.85rem' }}>{progress.text}</p>
            </div>
          )}
          {err && <p className={s.err} role="alert">{err}</p>}

          <div className={s.formBtns}>
            <button className="secondary-btn" disabled={busy} onClick={onClose}>Cancelar</button>
            <button className="primary-btn" disabled={busy} onClick={submit}>{busy ? 'Procesando…' : 'Procesar PDF'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
