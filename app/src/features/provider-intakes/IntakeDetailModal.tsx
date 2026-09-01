import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { formatCurrency, formatDateTime } from '../../lib/format'
import { getProviderIntakeDetail, submitIntakeAction, getIntakeFileSignedUrl } from './api'
import {
  INTAKE_STATUS, FILE_KIND_LABELS, quarantineLabel, actorLabel, formatBytes, friendlyIntakeError,
  availableIntakeActions, validateIntakeAction, TRANSITION_COPY, createUuid,
} from './logic'
import { IntakeMatchSection } from './IntakeMatchSection'
import type { IntakeAction, IntakeDetailResult } from './types'
import s from './ProviderIntakes.module.css'

// Rebanada 2-3: detalle read-only + acciones de flujo (transiciones + nota interna).
// Matching, draft de pago y links son rebanadas 4-N.
function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className={s.field}><dt>{k}</dt><dd>{v || '—'}</dd></div>
}

type PendingAction = { action: IntakeAction; actionId: string }

export function IntakeDetailModal({ intakeId, onClose, onChanged }: { intakeId: string; onClose: () => void; onChanged?: () => void }) {
  const { showToast } = useToast()
  const [data, setData] = useState<IntakeDetailResult | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [notes, setNotes] = useState('')
  const [actionErr, setActionErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [openingFileId, setOpeningFileId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const d = await getProviderIntakeDetail(intakeId)
    setData(d)
    return d
  }, [intakeId])

  useEffect(() => {
    let active = true
    ;(async () => {
      setStatus('loading')
      try {
        await reload()
        if (active) setStatus('ready')
      } catch (e) {
        if (active) { setErr(friendlyIntakeError(e)); setStatus('error') }
      }
    })()
    return () => { active = false }
  }, [reload])

  const intake = data?.intake ?? null
  const actions = useMemo(() => (intake ? availableIntakeActions(intake.status) : []), [intake])

  function startAction(action: IntakeAction) {
    setPending({ action, actionId: createUuid() })
    setNotes('')
    setActionErr('')
  }

  async function confirmAction() {
    if (!pending || !intake) return
    const validation = validateIntakeAction(pending.action, notes.trim())
    if (validation) { setActionErr(validation); return }
    setActionErr('')
    setSaving(true)
    try {
      await submitIntakeAction({
        intakeId: intake.id,
        action: pending.action,
        notes,
        expectedStatus: intake.status,
        expectedUpdatedAt: intake.updated_at,
        actionId: pending.actionId,
      })
      setPending(null)
      setNotes('')
      showToast(
        pending.action.kind === 'note' ? 'Nota agregada' : 'Estado actualizado',
        pending.action.kind === 'note' ? 'El historial conserva la nueva nota interna.' : 'Se registró un único evento de auditoría.',
        'success',
      )
      await reload()
      onChanged?.()
    } catch (e) {
      setActionErr(friendlyIntakeError(e))
    } finally {
      setSaving(false)
    }
  }

  async function openFile(fileId: string) {
    if (!intake || openingFileId) return
    setOpeningFileId(fileId)
    try {
      const { url, expiresIn } = await getIntakeFileSignedUrl(intake.id, fileId)
      window.open(url, '_blank', 'noopener,noreferrer')
      showToast('Enlace temporal generado', `El acceso expira en ${expiresIn} segundos.`, 'info')
    } catch (e) {
      showToast('Documento no disponible', friendlyIntakeError(e), 'error')
    } finally {
      setOpeningFileId(null)
    }
  }

  const actionCopy = pending?.action.kind === 'transition'
    ? TRANSITION_COPY[pending.action.toStatus]
    : { title: 'Agregar nota interna', hint: 'Queda registrada en el historial (mínimo 3 caracteres).', confirm: 'Guardar nota' }

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <div className={s.modalHead}>
          <div>
            <h2>{intake?.public_folio ?? 'Solicitud'}</h2>
            {intake && <p className="muted">{intake.company_name ?? 'Empresa'} · recibida {formatDateTime(intake.created_at)}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {intake && <Badge variant={INTAKE_STATUS[intake.status]?.variant ?? 'neutral'}>{INTAKE_STATUS[intake.status]?.label ?? intake.status}</Badge>}
            <button className="small-btn" onClick={onClose}>Cerrar</button>
          </div>
        </div>

        <div className={s.modalBody}>
          {status === 'loading' && <p className={s.msg}>Cargando detalle…</p>}
          {status === 'error' && <p className={s.msg}>{err}</p>}
          {status === 'ready' && !intake && <p className={s.msg}>La solicitud ya no está disponible.</p>}
          {status === 'ready' && intake && (
            <>
              {/* Barra de acciones de flujo */}
              <div className={s.actionBar}>
                {actions.map((a) => (
                  <button
                    key={a.label}
                    className={a.danger ? 'danger-btn' : 'secondary-btn'}
                    disabled={saving}
                    onClick={() => startAction(a)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              {pending && (
                <div className={s.actionForm}>
                  <div>
                    <strong>{actionCopy.title}</strong>
                    <p className="muted" style={{ margin: '2px 0 0', fontSize: '.85rem' }}>{actionCopy.hint}</p>
                  </div>
                  <textarea
                    rows={3}
                    maxLength={2000}
                    placeholder={pending.action.kind === 'note' ? 'Nota interna…' : 'Comentario (opcional salvo corrección/rechazo)…'}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    autoFocus
                  />
                  {actionErr && <p className={s.actionErr}>{actionErr}</p>}
                  <div className={s.actionFormBtns}>
                    <button className="secondary-btn" disabled={saving} onClick={() => { setPending(null); setActionErr('') }}>Cancelar</button>
                    <button
                      className={pending.action.danger ? 'danger-btn' : 'primary-btn'}
                      disabled={saving}
                      onClick={confirmAction}
                    >
                      {saving ? 'Guardando…' : actionCopy.confirm}
                    </button>
                  </div>
                </div>
              )}

              <div className={s.detailGrid}>
                <section className={s.detailSection}>
                  <h3>Proveedor declarado</h3>
                  <dl>
                    <Field k="Nombre" v={intake.provider_name} />
                    <Field k="RFC" v={intake.provider_rfc} />
                    <Field k="Correo" v={intake.provider_email} />
                    <Field k="Teléfono" v={intake.provider_phone} />
                  </dl>
                </section>
                <section className={s.detailSection}>
                  <h3>Solicitud de pago</h3>
                  <dl>
                    <Field k="Concepto" v={intake.concept} />
                    <Field k="Descripción" v={intake.description} />
                    <Field k="Monto" v={intake.amount_requested != null ? formatCurrency(intake.amount_requested) : null} />
                    <Field k="Fecha solicitada" v={intake.requested_payment_date} />
                  </dl>
                </section>
                <section className={s.detailSection}>
                  <h3>Factura</h3>
                  <dl>
                    <Field k="Folio" v={intake.invoice_folio} />
                    <Field k="UUID" v={intake.invoice_uuid} />
                    <Field k="Fecha" v={intake.invoice_date} />
                  </dl>
                </section>
                <section className={s.detailSection}>
                  <h3>Datos bancarios declarados</h3>
                  <dl>
                    <Field k="Banco" v={intake.bank_name} />
                    <Field k="Beneficiario" v={intake.beneficiary_name} />
                    <Field k="Cuenta" v={intake.bank_account_masked} />
                    <Field k="CLABE" v={intake.bank_clabe_masked} />
                  </dl>
                </section>
              </div>

              <IntakeMatchSection
                intake={intake}
                onChanged={async () => { await reload(); onChanged?.() }}
              />

              <section className={s.detailSection}>
                <h3>Documentos privados</h3>
                {data!.files.length === 0 ? <p className="muted">Esta solicitud no contiene documentos.</p> : (
                  <ul className={s.fileList}>
                    {data!.files.map((f) => (
                      <li key={f.id} className={s.fileItem}>
                        <div>
                          <div>{f.original_filename || 'Documento'}</div>
                          <div className="muted" style={{ fontSize: '.8rem' }}>{FILE_KIND_LABELS[f.file_kind || ''] || 'Documento'} · {f.mime_type || 'Tipo n/d'} · {formatBytes(f.size_bytes)} · {quarantineLabel(f.quarantine_status)}</div>
                        </div>
                        <button className="small-btn" disabled={openingFileId != null} onClick={() => openFile(f.id)}>
                          {openingFileId === f.id ? 'Generando enlace…' : 'Abrir temporalmente'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className={s.detailSection}>
                <h3>Historial</h3>
                {data!.events.length === 0 ? <p className="muted">No hay eventos disponibles.</p> : (
                  <ol className={s.eventList}>
                    {data!.events.map((e, i) => (
                      <li key={i} className={s.eventItem}>
                        <div className={s.eventHead}>
                          <strong>{e.event_type || 'Evento'}</strong>
                          <time className="muted">{formatDateTime(e.created_at)}</time>
                        </div>
                        <div className="muted" style={{ fontSize: '.8rem' }}>{e.actor_name || 'Sistema'} · {actorLabel(e.actor_type)}</div>
                        {e.notes && <p style={{ margin: '4px 0 0' }}>{e.notes}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
