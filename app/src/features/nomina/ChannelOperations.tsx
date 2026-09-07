import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { supabase } from '../../lib/supabase'
import { BUCKET, channelLabel, formatMoney, friendlyError } from './logic'
import type { PayrollChannel } from './types'
import s from './Nomina.module.css'

type ReconciliationChannel = {
  id: string
  channel: PayrollChannel
  amount: number
  currency: string
  dispersion_status: 'pending' | 'dispersed' | 'failed'
  reconciliation_status: 'pending' | 'reconciled' | 'exception'
  receipt_verified: boolean
  receipt_payment_date: string | null
  reference_hint: string | null
}

type ReconciliationSummary = {
  payment_request_id: string
  request_number: string | null
  request_status: string
  amount_requested: number
  currency: string
  all_dispersed: boolean
  all_reconciled: boolean
  can_close_paid: boolean
  channels: ReconciliationChannel[]
}

type ReceiptReservation = {
  run_file_id: string
  storage_bucket: string
  storage_path: string
  mime_type: string
  size_bytes: number
  sha256: string
}

function localIsoDate(): string {
  const now = new Date()
  const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 10)
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function throwFunctionInvokeError(error: unknown): Promise<never> {
  const context = (error as { context?: Response | null })?.context
  if (context && typeof context.clone === 'function') {
    try {
      const payload = (await context.clone().json()) as { error?: unknown }
      const code = typeof payload?.error === 'string' ? payload.error.trim() : ''
      if (code) throw new Error(code)
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith('PAYROLL_')) throw cause
    }
  }
  throw error
}

function dispersionLabel(channel: ReconciliationChannel): string {
  if (channel.reconciliation_status === 'reconciled') return 'Conciliado'
  if (channel.reconciliation_status === 'exception') return 'Excepción'
  if (channel.dispersion_status === 'dispersed') return 'Dispersado'
  if (channel.dispersion_status === 'failed') return 'Falló'
  return 'Pendiente'
}

function stateClass(channel: ReconciliationChannel): string {
  if (channel.reconciliation_status === 'reconciled') return s.stateSuccess
  if (channel.dispersion_status === 'failed' || channel.reconciliation_status === 'exception') return s.stateDanger
  return s.stateWarning
}

export function ChannelOperations({ paymentRequestId }: { paymentRequestId: string }) {
  const { showToast } = useToast()
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyChannelId, setBusyChannelId] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, File | undefined>>({})
  const [dates, setDates] = useState<Record<string, string>>({})
  const [references, setReferences] = useState<Record<string, string>>({})

  const channels = useMemo(() => summary?.channels || [], [summary])

  async function refresh(showError = true) {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_payroll_reconciliation_summary', {
        p_payment_request_id: paymentRequestId,
      })
      if (error) throw error
      const next = data as ReconciliationSummary
      setSummary(next)
      setDates((current) => {
        const copy = { ...current }
        for (const channel of next.channels || []) if (!copy[channel.id]) copy[channel.id] = localIsoDate()
        return copy
      })
    } catch (error) {
      if (showError) showToast('No se pudo cargar la dispersión', friendlyError(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentRequestId])

  async function markDispersed(channel: ReconciliationChannel) {
    if (busyChannelId) return
    const confirmed = window.confirm(
      `Registrar ${channelLabel(channel.channel)} como dispersado por ${formatMoney(channel.amount)}?\n\nFlux NO ejecutará ningún pago. Sólo registra que la dispersión se realizó externamente.`,
    )
    if (!confirmed) return

    setBusyChannelId(channel.id)
    try {
      const { error } = await supabase.rpc('record_payroll_channel_dispersion', {
        p_payment_request_id: paymentRequestId,
        p_payroll_channel_id: channel.id,
        p_action: 'dispersed',
        p_failure_note: null,
      })
      if (error) throw error
      await refresh(false)
      showToast('Dispersión registrada', `${channelLabel(channel.channel)} quedó marcado como dispersado.`, 'success')
    } catch (error) {
      showToast('No se pudo registrar la dispersión', friendlyError(error), 'error')
    } finally {
      setBusyChannelId(null)
    }
  }

  async function uploadReceipt(channel: ReconciliationChannel) {
    if (busyChannelId) return
    const file = files[channel.id]
    const paymentDate = dates[channel.id] || ''
    const reference = (references[channel.id] || '').trim()

    if (!file) {
      showToast('Comprobante requerido', 'Selecciona el PDF del comprobante de este canal.', 'warning')
      return
    }
    if (!file.name.toLowerCase().endsWith('.pdf') || file.size < 100 || file.size > 10 * 1024 * 1024) {
      showToast('PDF no válido', 'El comprobante debe ser un PDF de hasta 10 MB.', 'warning')
      return
    }
    if (!paymentDate) {
      showToast('Fecha requerida', 'Indica la fecha del pago.', 'warning')
      return
    }
    if (reference.length < 3 || reference.length > 120) {
      showToast('Referencia requerida', 'Captura una referencia de 3 a 120 caracteres.', 'warning')
      return
    }

    setBusyChannelId(channel.id)
    try {
      const hash = await sha256Hex(file)
      const { data: reserved, error: reserveError } = await supabase.rpc('reserve_payroll_channel_receipt', {
        p_payment_request_id: paymentRequestId,
        p_payroll_channel_id: channel.id,
        p_mime_type: 'application/pdf',
        p_size_bytes: file.size,
        p_sha256: hash,
        p_original_filename: file.name,
      })
      if (reserveError) throw reserveError
      const reservation = reserved as ReceiptReservation
      if (!reservation?.run_file_id || reservation.storage_bucket !== BUCKET || !reservation.storage_path) {
        throw new Error('PAYROLL_RECEIPT_RESERVATION_INVALID')
      }

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(reservation.storage_path, file, {
        contentType: 'application/pdf',
        upsert: false,
      })
      if (uploadError) throw uploadError

      const { data: verified, error: verifyError } = await supabase.functions.invoke('payroll-receipt-verify', {
        body: { run_file_id: reservation.run_file_id },
      })
      if (verifyError) await throwFunctionInvokeError(verifyError)
      if (!verified || !['verified', 'already_verified'].includes(String((verified as { status?: string }).status || ''))) {
        throw new Error('PAYROLL_RECEIPT_VERIFICATION_FAILED')
      }

      const { error: reconcileError } = await supabase.rpc('reconcile_payroll_channel', {
        p_payment_request_id: paymentRequestId,
        p_payroll_channel_id: channel.id,
        p_receipt_file_id: reservation.run_file_id,
        p_receipt_amount: channel.amount,
        p_payment_date: paymentDate,
        p_reference_hint: reference,
      })
      if (reconcileError) throw reconcileError

      setFiles((current) => ({ ...current, [channel.id]: undefined }))
      setReferences((current) => ({ ...current, [channel.id]: '' }))
      await refresh(false)
      showToast('Comprobante conciliado', `${channelLabel(channel.channel)} quedó validado y conciliado.`, 'success')
    } catch (error) {
      showToast('No se pudo registrar el comprobante', friendlyError(error), 'error')
    } finally {
      setBusyChannelId(null)
    }
  }

  if (loading && !summary) {
    return <div className={s.inlineNotice}>Cargando dispersión y comprobantes por canal…</div>
  }
  if (!summary) return null

  return (
    <section className={s.review}>
      <strong>Dispersión y comprobantes por canal</strong>
      <p>
        Flux no ejecuta pagos. Finanzas registra aquí la dispersión hecha en el banco/TOKA y adjunta el comprobante PDF de cada canal.
      </p>

      <div className={s.fileGrid}>
        {channels.map((channel) => {
          const busy = busyChannelId === channel.id
          const canUpload = channel.dispersion_status === 'dispersed' && channel.reconciliation_status === 'pending'
          return (
            <article key={channel.id} className={s.fileCard}>
              <div className={s.fileCardHead}>
                <div>
                  <strong>{channelLabel(channel.channel)}</strong>
                  <span>{formatMoney(channel.amount)}</span>
                </div>
                <span className={`${s.state} ${stateClass(channel)}`}>{dispersionLabel(channel)}</span>
              </div>

              {channel.reconciliation_status === 'reconciled' ? (
                <p>
                  Comprobante verificado{channel.receipt_payment_date ? ` · pago ${channel.receipt_payment_date}` : ''}
                  {channel.reference_hint ? ` · ref. ${channel.reference_hint}` : ''}.
                </p>
              ) : channel.dispersion_status !== 'dispersed' ? (
                <>
                  <p>Registra este estado sólo después de ejecutar la dispersión fuera de Flux.</p>
                  <button type="button" className={s.secondaryBtn} onClick={() => void markDispersed(channel)} disabled={busy}>
                    {busy ? 'Registrando…' : channel.dispersion_status === 'failed' ? 'Registrar reintento dispersado' : 'Registrar como dispersado'}
                  </button>
                </>
              ) : canUpload ? (
                <div className={s.grid}>
                  <label>
                    Fecha de pago
                    <input
                      type="date"
                      value={dates[channel.id] || ''}
                      onChange={(event) => setDates((current) => ({ ...current, [channel.id]: event.target.value }))}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Referencia
                    <input
                      value={references[channel.id] || ''}
                      maxLength={120}
                      placeholder="Referencia bancaria / TOKA"
                      onChange={(event) => setReferences((current) => ({ ...current, [channel.id]: event.target.value }))}
                      disabled={busy}
                    />
                  </label>
                  <label className={s.fullRow}>
                    Comprobante PDF
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(event) => setFiles((current) => ({ ...current, [channel.id]: event.target.files?.[0] }))}
                      disabled={busy}
                    />
                  </label>
                  <div className={s.fullRow}>
                    <button type="button" className={s.primaryBtn} onClick={() => void uploadReceipt(channel)} disabled={busy}>
                      {busy ? 'Validando comprobante…' : 'Subir y conciliar comprobante'}
                    </button>
                  </div>
                </div>
              ) : (
                <p>Este canal requiere revisión antes de adjuntar un comprobante.</p>
              )}
            </article>
          )
        })}
      </div>

      {summary.all_reconciled && <div className={s.inlineNotice}>Los comprobantes de todos los canales quedaron conciliados.</div>}
    </section>
  )
}
