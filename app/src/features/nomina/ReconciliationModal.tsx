import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { channelLabel, formatMoney, friendlyError } from './logic'
import {
  closePayrollAsPaid,
  getReconciliationQueue,
  getReconciliationSummary,
  reconcileChannelReceipt,
} from './api'
import type { ReconChannel, ReconQueueRow, ReconSummary } from './types'
import s from './Nomina.module.css'

// Comprobación de nómina por canal (N4B) en React. Una corrida genera varios
// pagos (BBVA/SPEI/TOKA); Finanzas sube UN comprobante por canal. Reutiliza el
// backend existente (reserve → upload → verify → reconcile → close). No muestra
// detalle por persona: sólo el monto del canal.

type ChannelDraft = { file: File | null; amount: string; date: string; reference: string; saving: boolean }

function emptyDraft(): ChannelDraft {
  return { file: null, amount: '', date: '', reference: '', saving: false }
}

export function ReconciliationModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { showToast } = useToast()
  const [queue, setQueue] = useState<ReconQueueRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [summary, setSummary] = useState<ReconSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, ChannelDraft>>({})

  async function loadQueue() {
    setLoading(true)
    try {
      setQueue(await getReconciliationQueue())
    } catch (error) {
      showToast('No se pudo cargar', friendlyError(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadQueue() }, [])

  async function selectRun(id: string) {
    setSelectedId(id)
    setSummary(null)
    setDrafts({})
    try {
      setSummary(await getReconciliationSummary(id))
    } catch (error) {
      showToast('No se pudo cargar la corrida', friendlyError(error), 'error')
    }
  }

  function patch(channelId: string, next: Partial<ChannelDraft>) {
    setDrafts((prev) => ({ ...prev, [channelId]: { ...(prev[channelId] || emptyDraft()), ...next } }))
  }

  async function reconcile(channel: ReconChannel) {
    const d = drafts[channel.id] || emptyDraft()
    if (!d.file) return showToast('Falta comprobante', 'Selecciona el comprobante PDF del canal.', 'warning')
    if (d.file.type !== 'application/pdf' || d.file.size < 100 || d.file.size > 10485760) {
      return showToast('Comprobante inválido', 'Debe ser PDF y pesar máximo 10 MB.', 'warning')
    }
    const amount = Number(d.amount)
    if (!Number.isFinite(amount) || amount <= 0) return showToast('Falta importe', 'Captura el importe del comprobante.', 'warning')
    if (!d.date) return showToast('Falta fecha', 'Captura la fecha de pago.', 'warning')
    if (d.reference.trim().length < 3) return showToast('Falta referencia', 'Captura la referencia bancaria.', 'warning')

    patch(channel.id, { saving: true })
    try {
      const next = await reconcileChannelReceipt({
        paymentRequestId: summary!.payment_request_id,
        channelId: channel.id,
        file: d.file,
        amount,
        paymentDate: d.date,
        reference: d.reference.trim(),
      })
      setSummary(next)
      showToast('Canal conciliado', `${channelLabel(channel.channel)} verificado.`, 'success')
      await loadQueue()
      onChanged()
    } catch (error) {
      showToast('No se pudo conciliar', friendlyError(error), 'error')
    } finally {
      patch(channel.id, { saving: false })
    }
  }

  const allReconciled = useMemo(
    () => !!summary && summary.channels.length > 0 && summary.channels.every((c) => c.reconciliation_status === 'reconciled'),
    [summary],
  )

  async function closePaid() {
    if (!summary) return
    if (!window.confirm('Confirma el cierre. Flux registrará la nómina como Pagada; no ejecuta ningún pago.')) return
    try {
      await closePayrollAsPaid(summary.payment_request_id)
      showToast('Nómina cerrada', 'Registrada como Pagada.', 'success')
      setSelectedId(null)
      setSummary(null)
      await loadQueue()
      onChanged()
    } catch (error) {
      showToast('No se pudo cerrar', friendlyError(error), 'error')
    }
  }

  return (
    <Modal title="Comprobación de nómina" subtitle="Sube un comprobante por canal. Finanzas descarga, paga y comprueba; no muestra detalle por persona." size="lg" onClose={onClose}>
      <div className={s.reconLayout}>
        <aside className={s.reconQueue}>
          {loading && <div className={s.boardEmpty}>Cargando…</div>}
          {!loading && !queue.length && <div className={s.boardEmpty}>No hay nóminas por comprobar.</div>}
          {queue.map((row) => (
            <button
              key={row.payment_request_id}
              type="button"
              className={`${s.reconQueueItem} ${selectedId === row.payment_request_id ? s.reconQueueActive : ''}`}
              onClick={() => void selectRun(row.payment_request_id)}
            >
              <strong>{row.request_number || 'Nómina'}</strong>
              <span>{row.company_name || 'Empresa'}</span>
              <span>{formatMoney(Number(row.amount_requested ?? 0))} · {Number(row.reconciled_count ?? 0)}/{Number(row.channel_count ?? 0)} conciliados</span>
            </button>
          ))}
        </aside>

        <section className={s.reconDetail}>
          {!summary && <div className={s.boardEmpty}>Selecciona una nómina para comprobar sus pagos.</div>}
          {summary && (
            <>
              <div className={s.reconHead}>
                <div>
                  <strong>{summary.request_number || 'Nómina'}</strong>
                  <span className="muted">{summary.company_name || ''}</span>
                </div>
                <span className={`${s.state} ${summary.request_status === 'paid' ? s.stateSuccess : s.stateWarning}`}>
                  {summary.request_status === 'paid' ? 'Pagada' : 'Por comprobar'}
                </span>
              </div>

              {summary.channels.map((channel) => {
                const done = channel.reconciliation_status === 'reconciled'
                const d = drafts[channel.id] || emptyDraft()
                return (
                  <article key={channel.id} className={s.reconCard}>
                    <div className={s.reconCardHead}>
                      <div>
                        <strong>{channelLabel(channel.channel)}</strong>
                        <span>{formatMoney(Number(channel.amount ?? 0))}</span>
                      </div>
                      <span className={`${s.state} ${done ? s.stateSuccess : s.stateWarning}`}>{done ? 'Conciliado' : 'Pendiente'}</span>
                    </div>
                    {done ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Fecha: {channel.receipt_payment_date || '—'} · Referencia: {channel.reference_hint || '—'}
                      </div>
                    ) : (
                      <div className={s.reconForm}>
                        <label className={s.fullRow}>Comprobante PDF
                          <input type="file" accept="application/pdf,.pdf" disabled={d.saving}
                            onChange={(e) => patch(channel.id, { file: e.target.files?.[0] ?? null })} />
                        </label>
                        <label>Importe
                          <input type="number" step="0.01" min="0.01" inputMode="decimal" placeholder="0.00" value={d.amount} disabled={d.saving}
                            onChange={(e) => patch(channel.id, { amount: e.target.value })} />
                        </label>
                        <label>Fecha de pago
                          <input type="date" value={d.date} disabled={d.saving} onChange={(e) => patch(channel.id, { date: e.target.value })} />
                        </label>
                        <label className={s.fullRow}>Referencia bancaria
                          <input type="text" maxLength={120} placeholder="Referencia del comprobante" value={d.reference} disabled={d.saving}
                            onChange={(e) => patch(channel.id, { reference: e.target.value })} />
                        </label>
                        <div className={s.reconFormActions}>
                          <button type="button" className={s.primaryBtn} disabled={d.saving} onClick={() => void reconcile(channel)}>
                            {d.saving ? 'Verificando…' : 'Verificar y conciliar'}
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                )
              })}

              {allReconciled && summary.request_status !== 'paid' && (
                <div className={s.reconClose}>
                  <button type="button" className={s.primaryBtn} onClick={() => void closePaid()}>Cerrar como pagada</button>
                  <small>Todos los canales están conciliados.</small>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </Modal>
  )
}
