import { useEffect, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { formatCurrency, formatDateTime } from '../../lib/format'
import { getProviderIntakeDetail } from './api'
import { INTAKE_STATUS, FILE_KIND_LABELS, quarantineLabel, actorLabel, formatBytes, friendlyIntakeError } from './logic'
import type { IntakeDetailResult } from './types'
import s from './ProviderIntakes.module.css'

// Rebanada 2: detalle read-only (proveedor, solicitud, factura, banca, documentos, historial).
// Las acciones (transiciones, matching, conversión, draft de pago, links) son rebanadas 3-N.
function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className={s.field}><dt>{k}</dt><dd>{v || '—'}</dd></div>
}

export function IntakeDetailModal({ intakeId, onClose }: { intakeId: string; onClose: () => void }) {
  const { showToast } = useToast()
  const [data, setData] = useState<IntakeDetailResult | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      setStatus('loading')
      try {
        const d = await getProviderIntakeDetail(intakeId)
        if (!active) return
        setData(d); setStatus('ready')
      } catch (e) {
        if (!active) return
        setErr(friendlyIntakeError(e)); setStatus('error')
      }
    })()
    return () => { active = false }
  }, [intakeId])

  const intake = data?.intake ?? null

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
                        <button className="small-btn" onClick={() => showToast('En migración', 'La apertura temporal de documentos llega en la siguiente rebanada.', 'info')}>Abrir temporalmente</button>
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
