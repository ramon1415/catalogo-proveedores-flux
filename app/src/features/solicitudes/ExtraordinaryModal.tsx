import { useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import {
  beginExtraordinaryAuthorization, uploadExtraordinaryEvidence, finalizeExtraordinaryAuthorization,
  revokeExtraordinary,
} from './api'
import { friendlyExtraordinaryError, formatCurrencyC } from './logic'
import type { ExecutionContext, RequestSummary } from './types'
import s from './Solicitudes.module.css'

const EVIDENCE_TYPES: Array<[string, string]> = [
  ['whatsapp_export', 'WhatsApp'], ['email', 'Correo'], ['signed_document', 'Documento firmado'], ['other', 'Otro'],
]
const CATEGORIES: Array<[string, string]> = [
  ['operational_emergency', 'Emergencia operativa / fuga'],
  ['urgent_reimbursement', 'Reembolso urgente'],
  ['urgent_termination', 'Desvinculación o finiquito urgente'],
  ['critical_service', 'Servicio crítico'],
  ['other', 'Otro'],
]

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function toLocalDateTimeInput(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export function ExtraordinaryModal({
  request,
  context,
  onClose,
  onDone,
}: {
  request: RequestSummary
  context: NonNullable<ExecutionContext>
  onClose: () => void
  onDone: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { showToast } = useToast()
  const existing = context.extraordinary
  const canResume = existing?.secure_contract === true && existing.status === 'draft' && !!existing.can_resume

  const policy = context.extraordinary_policy || {}
  const directors = context.eligible_external_directors || []
  const allowedCategories = new Set(policy.allowed_categories || [])

  const [director, setDirector] = useState(canResume ? existing?.external_director_profile_id || '' : '')
  const [authorizedAt, setAuthorizedAt] = useState(canResume ? toLocalDateTimeInput(existing?.external_authorized_at || '') : toLocalDateTimeInput(new Date()))
  const [evidenceType, setEvidenceType] = useState('')
  const [category, setCategory] = useState(canResume ? existing?.category || '' : '')
  const [reason, setReason] = useState(canResume ? existing?.reason || '' : '')
  const [file, setFile] = useState<File | null>(null)
  const [attest, setAttest] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [status, setStatus] = useState<{ text: string; tone: 'warning' | 'danger' } | null>(
    canResume ? { text: 'Borrador recuperado. Selecciona el archivo original para completar su validación.', tone: 'warning' } : null,
  )
  const [submitting, setSubmitting] = useState(false)

  // Draft/idempotencia estables durante la vida del modal.
  const draftRef = useRef<any>(canResume ? { authorization_id: existing?.id, storage_bucket: existing?.storage_bucket, storage_path: existing?.storage_path } : null)
  const idempotencyKey = useMemo(() => `external-auth:${request.id}:${crypto.randomUUID()}`, [request.id])

  const lockedFields = canResume

  useEffect(() => {
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!director) return setStatus({ text: 'Selecciona al Director que emitió la autorización externa.', tone: 'danger' })
    if (!authorizedAt) return setStatus({ text: 'Captura la fecha y hora de la autorización.', tone: 'danger' })
    if (!category) return setStatus({ text: 'Selecciona una categoría permitida por la política.', tone: 'danger' })
    if (reason.trim().length < 20) return setStatus({ text: 'Explica el motivo operativo en al menos 20 caracteres.', tone: 'danger' })
    if (!evidenceType) return setStatus({ text: 'Selecciona el canal o tipo de evidencia.', tone: 'danger' })
    if (!file) return setStatus({ text: 'Selecciona la evidencia privada.', tone: 'danger' })
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return setStatus({ text: 'El archivo debe ser PDF, JPG, PNG o WEBP.', tone: 'danger' })
    if (file.size < 1 || file.size > 5242880) return setStatus({ text: 'La evidencia debe pesar entre 1 byte y 5 MB.', tone: 'danger' })
    if (!attest) return setStatus({ text: 'Confirma que la evidencia coincide con la solicitud, importe, moneda y Director.', tone: 'danger' })
    if (!confirm) return setStatus({ text: 'Confirma la urgencia y la vigencia de la autorización externa.', tone: 'danger' })

    setSubmitting(true)
    try {
      const evidenceSha256 = await sha256Hex(file)
      let draft = draftRef.current
      if (!draft) {
        setStatus({ text: 'Paso 1 de 3: validando política, Director, vigencia e idempotencia.', tone: 'warning' })
        draft = await beginExtraordinaryAuthorization({ requestId: request.id, category, reason: reason.trim(), directorId: director, externalAuthorizedAt: authorizedAt, idempotencyKey })
        draftRef.current = draft
      }
      if (!draft?.authorization_id || !draft?.storage_bucket || !draft?.storage_path) throw new Error('extraordinary_draft_storage_contract_missing')

      setStatus({ text: 'Paso 2 de 3: cargando evidencia al repositorio privado.', tone: 'warning' })
      await uploadExtraordinaryEvidence(draft.storage_bucket, draft.storage_path, file, evidenceSha256)

      setStatus({ text: 'Paso 3 de 3: verificando metadatos y activando la vigencia.', tone: 'warning' })
      const finalized = await finalizeExtraordinaryAuthorization({
        authorizationId: draft.authorization_id,
        evidenceType,
        sha256: evidenceSha256,
        mimeType: file.type,
        sizeBytes: file.size,
        idempotencyKey,
      })
      if (finalized?.status !== 'active') throw new Error('extraordinary_authorization_not_activated')

      draftRef.current = null
      showToast('Autorización externa registrada', 'La evidencia quedó privada y la solicitud estará disponible solo durante la vigencia indicada.', 'success')
      onDone()
    } catch (error) {
      const message = friendlyExtraordinaryError(error)
      setStatus({ text: message, tone: 'danger' })
      showToast('No se pudo activar la contingencia', message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const subtitle = canResume
    ? 'Completa la evidencia pendiente. La solicitud aún no está habilitada para layout.'
    : `La autorización tendrá una vigencia máxima de ${Number(policy.authorization_valid_hours || 0)} horas.`

  return (
    <dialog ref={dialogRef} className={`${s.dialog} ${s.narrow}`} onCancel={onClose} onClose={onClose}>
      <form className={s.modal} onSubmit={onSubmit}>
        <div className={s.modalHead}>
          <div>
            <h2>Registrar autorización externa de Dirección</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className={s.modalScroll}>
          <div className={s.formGrid}>
            <div className={`${s.fullRow} ${s.extraWarning}`}>Esta contingencia no sustituye el flujo regular. Registra una autorización que Dirección ya emitió fuera de Flux, conserva evidencia privada y exige ratificación posterior antes de confirmar el pago.</div>
            <div className={`${s.extraSummary} ${s.fullRow}`} aria-label="Resumen de la autorización extraordinaria">
              <div><span>Folio</span><strong>{request.requestNumber || 'Sin folio'}</strong></div>
              <div><span>Empresa</span><strong>{request.companyName || 'Sin empresa'}</strong></div>
              <div><span>Proveedor</span><strong>{request.providerName || 'Sin proveedor'}</strong></div>
              <div><span>Monto</span><strong>{formatCurrencyC(request.amount, request.currency)}</strong></div>
              <div><span>Moneda</span><strong>{request.currency || 'MXN'}</strong></div>
              <div><span>Límite de política</span><strong>{formatCurrencyC(policy.max_amount_mxn || 0, 'MXN')}</strong></div>
            </div>
            <label className={s.fullRow}>Director que autorizó externamente *
              <select className={s.formControl} value={director} disabled={lockedFields} onChange={(e) => setDirector(e.target.value)} required>
                <option value="">Selecciona...</option>
                {directors.map((d) => <option key={d.profile_id} value={d.profile_id}>{d.name || 'Director'}</option>)}
              </select>
            </label>
            <label>Fecha y hora de autorización *
              <input className={s.formControl} type="datetime-local" value={authorizedAt} disabled={lockedFields} onChange={(e) => setAuthorizedAt(e.target.value)} required />
            </label>
            <label>Canal / tipo de evidencia *
              <select className={s.formControl} value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)} required>
                <option value="">Selecciona...</option>
                {EVIDENCE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className={s.fullRow}>Categoría *
              <select className={s.formControl} value={category} disabled={lockedFields} onChange={(e) => setCategory(e.target.value)} required>
                <option value="">Selecciona...</option>
                {CATEGORIES.map(([v, l]) => {
                  const disabled = allowedCategories.size > 0 && !allowedCategories.has(v)
                  return disabled ? null : <option key={v} value={v}>{l}</option>
                })}
              </select>
            </label>
            <label className={s.fullRow}>Motivo operativo *
              <textarea className={s.formControl} minLength={20} maxLength={1500} value={reason} disabled={lockedFields} onChange={(e) => setReason(e.target.value)} required />
            </label>
            <label className={s.fullRow}>Evidencia privada *
              <input className={s.formControl} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
              <span className={s.extraFileHelp}>PDF, JPG, PNG o WEBP; máximo 5 MB. Flux calcula y registra SHA-256 antes de activarla.</span>
            </label>
            <label className={`${s.checkboxCard} ${s.fullRow}`}>
              <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} required /> Confirmo que la evidencia corresponde exactamente a esta solicitud, importe, moneda y Director.
            </label>
            <label className={`${s.checkboxCard} ${s.fullRow}`}>
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} required /> Confirmo que la urgencia no puede esperar al siguiente corte y que la autorización externa aún está vigente.
            </label>
            {status && <div className={`${s.evidenceStatus} ${s.fullRow} ${s[status.tone]}`} role="status" aria-live="polite">{status.text}</div>}
          </div>
        </div>
        <div className={s.modalActions}>
          <button type="button" className={s.secondaryBtn} onClick={onClose} disabled={submitting}>Cancelar</button>
          <button type="submit" className={s.primaryBtn} disabled={submitting}>{submitting ? 'Validando y cargando...' : 'Guardar evidencia y activar'}</button>
        </div>
      </form>
    </dialog>
  )
}

export function RevokeExtraordinaryModal({ requestId, onClose, onDone }: { requestId: string; onClose: () => void; onDone: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { showToast } = useToast()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    if (reason.trim().length < 20) { showToast('Motivo requerido', 'Explica la revocación en al menos 20 caracteres.', 'warning'); return }
    setSaving(true)
    try {
      await revokeExtraordinary(requestId, reason.trim())
      showToast('Extraordinario revocado', 'La autorizacion dejo de habilitar el pago y conserva su historial.', 'success')
      onDone()
    } catch (error) {
      showToast('No se pudo revocar', friendlyExtraordinaryError(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialogRef} className={`${s.dialog} ${s.narrow}`} onCancel={onClose} onClose={onClose}>
      <form className={s.modal} onSubmit={onSubmit}>
        <div className={s.modalHead}>
          <div>
            <h2>Revocar contingencia extraordinaria</h2>
            <p>Solo puede revocarse mientras esté en borrador o vigente y antes de incorporarse a un layout.</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className={s.modalScroll}>
          <div className={s.formGrid}>
            <label className={s.fullRow}>Motivo de revocación *
              <textarea className={s.formControl} minLength={20} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} required />
            </label>
          </div>
        </div>
        <div className={s.modalActions}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
          <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Revocando...' : 'Revocar autorización'}</button>
        </div>
      </form>
    </dialog>
  )
}
