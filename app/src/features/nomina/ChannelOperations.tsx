import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { IcAprobaciones, IcDownload, IcFile } from '../../components/ui/icons'
import { supabase } from '../../lib/supabase'
import { BUCKET, channelLabel, formatMoney, friendlyError } from './logic'
import type { PayrollChannel } from './types'
import s from './Nomina.module.css'
import { getReceiptFileUrl } from './api'
import { receiptAmountMinor } from './receiptAmount'
import { isReceiptDate } from './receiptFields'
import { emptyReceiptDraft, useReceiptAutofill } from './useReceiptAutofill'

type ReconciliationChannel = {
  id: string
  channel: PayrollChannel
  amount: number
  currency: string
  dispersion_status: 'pending' | 'dispersed' | 'failed'
  reconciliation_status: 'pending' | 'reconciled' | 'exception'
  receipt_verified: boolean
  receipt_file_id: string | null
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

export function ChannelOperations({ paymentRequestId, canPay = false, onChanged }: { paymentRequestId: string; canPay?: boolean; onChanged?: () => void | Promise<void> }) {
  const { showToast } = useToast()
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyChannelId, setBusyChannelId] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const { drafts, selectReceipt, updateReceipt, clearReceipt } = useReceiptAutofill(paymentRequestId)

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
    if (!canPay || summary?.request_status !== 'approved' || busyChannelId || closing) return
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
    if (!canPay || summary?.request_status !== 'approved' || busyChannelId || closing) return
    const draft = drafts[channel.id] || emptyReceiptDraft()
    if (draft.reading || draft.invalid) return
    const file = draft.file
    const paymentDate = draft.paymentDate
    const reference = draft.reference.trim()
    const amountMinor = receiptAmountMinor(draft.amount)

    if (draft.currency && draft.currency !== channel.currency) {
      showToast('Revisa la moneda', 'La moneda del PDF no coincide con la del canal o contiene varias monedas. Selecciona el comprobante correcto.', 'warning')
      return
    }
    if (amountMinor === null || amountMinor !== Math.round(Number(channel.amount) * 100)) {
      showToast('Revisa el importe', `El importe del comprobante debe coincidir con ${formatMoney(channel.amount)}.`, 'warning')
      return
    }

    if (!file) {
      showToast('Comprobante requerido', 'Selecciona el PDF del comprobante de este canal.', 'warning')
      return
    }
    if (!file.name.toLowerCase().endsWith('.pdf') || file.size < 100 || file.size > 10 * 1024 * 1024) {
      showToast('PDF no válido', 'El comprobante debe ser un PDF de hasta 10 MB.', 'warning')
      return
    }
    if (!isReceiptDate(paymentDate)) {
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
        p_receipt_amount: amountMinor / 100,
        p_payment_date: paymentDate,
        p_reference_hint: reference,
      })
      if (reconcileError) throw reconcileError

      clearReceipt(channel.id)
      await refresh(false)
      showToast('Comprobante conciliado', `${channelLabel(channel.channel)} quedó validado y conciliado.`, 'success')
    } catch (error) {
      showToast('No se pudo registrar el comprobante', friendlyError(error), 'error')
    } finally {
      setBusyChannelId(null)
    }
  }

  async function closeAsPaid() {
    if (!canPay || closing || busyChannelId || !summary?.can_close_paid || summary.request_status === 'paid') return
    const confirmed = window.confirm(
      'Los tres canales están conciliados. ¿Cerrar esta nómina como pagada?\n\nFlux no ejecutará ningún pago; sólo cerrará la corrida con los comprobantes ya validados.',
    )
    if (!confirmed) return

    setClosing(true)
    try {
      const { error } = await supabase.rpc('close_payroll_as_paid', {
        p_payment_request_id: paymentRequestId,
      })
      if (error) throw error
      await refresh(false)
      await onChanged?.()
      showToast('Nómina cerrada como pagada', 'Los tres comprobantes quedaron conciliados y la corrida quedó cerrada.', 'success')
    } catch (error) {
      showToast('No se pudo cerrar la nómina', friendlyError(error), 'error')
    } finally {
      setClosing(false)
    }
  }

  async function downloadReceipt(fileId: string) {
    try {
      const url = await getReceiptFileUrl(fileId)
      const link = document.createElement('a')
      link.href = url
      link.rel = 'noopener'
      link.click()
    } catch (error) {
      showToast('No se pudo descargar el comprobante', friendlyError(error), 'error')
    }
  }

  if (loading && !summary) {
    return <div className={s.inlineNotice}>Cargando dispersión y comprobantes por canal…</div>
  }
  if (!summary) return null

  return (
    <section className={s.receiptsPanel}>
      <div className={s.receiptsHeading}>
        <div>
          <h3>Dispersión y comprobantes por canal</h3>
          <p>Tesorería registra el pago realizado en el banco o en TOKA y adjunta el PDF de cada canal.</p>
        </div>
        <span className={s.privatePill}>{channels.filter((channel) => channel.reconciliation_status === 'reconciled').length} de {channels.length} conciliados</span>
      </div>

      <div className={s.receiptList}>
        {channels.map((channel) => {
          const busy = busyChannelId === channel.id
          const draft = drafts[channel.id] || emptyReceiptDraft()
          const currencyMismatch = Boolean(draft.currency && draft.currency !== channel.currency)
          const amountMismatch = Boolean(draft.amount && receiptAmountMinor(draft.amount) !== Math.round(Number(channel.amount) * 100))
          const canUpload = channel.dispersion_status === 'dispersed' && channel.reconciliation_status === 'pending'
          const editable = canPay && summary.request_status === 'approved'
          return (
            <article key={channel.id} className={s.receiptCard}>
              <div className={s.receiptCardHead}>
                <div className={s.fileIdentity}>
                  <span className={s.fileIcon}><IcFile size={18} /></span>
                  <div className={s.fileInfo}>
                    <strong>{channelLabel(channel.channel)}</strong>
                    <span>{channel.reconciliation_status === 'reconciled' ? 'PDF · Comprobante verificado' : 'Comprobante PDF pendiente'}</span>
                  </div>
                </div>
                <div className={s.receiptAmount}>
                  <strong>{formatMoney(channel.amount)}</strong>
                  <span>{channel.currency}</span>
                </div>
                <span className={`${s.state} ${stateClass(channel)}`}>{dispersionLabel(channel)}</span>
              </div>

              {channel.reconciliation_status === 'reconciled' ? (
                <div className={s.receiptBody}>
                  <dl className={s.receiptDetails}>
                    <div>
                      <dt>Fecha de pago</dt>
                      <dd>{channel.receipt_payment_date?.split('-').reverse().join('/') || 'Sin fecha'}</dd>
                    </div>
                    <div>
                      <dt>Referencia</dt>
                      <dd>{channel.reference_hint || 'Sin referencia'}</dd>
                    </div>
                  </dl>
                  {channel.receipt_file_id && (
                    <button type="button" className={s.secondaryBtn} aria-label={`Descargar comprobante ${channelLabel(channel.channel)}`} onClick={() => void downloadReceipt(channel.receipt_file_id!)}>
                      <IcDownload size={15} /> Descargar PDF
                    </button>
                  )}
                </div>
              ) : !editable ? (
                <p>En espera de comprobación por Tesorería.</p>
              ) : channel.dispersion_status !== 'dispersed' ? (
                <div className={s.receiptBody}>
                  <p>Registra este estado sólo después de ejecutar la dispersión fuera de Flux.</p>
                  <button type="button" className={s.secondaryBtn} onClick={() => void markDispersed(channel)} disabled={busy || closing}>
                    {busy ? 'Registrando…' : channel.dispersion_status === 'failed' ? 'Registrar reintento dispersado' : 'Registrar como dispersado'}
                  </button>
                </div>
              ) : canUpload ? (
                <div className={`${s.grid} ${s.receiptForm}`}>
                  <label className={s.fullRow}>
                    Comprobante PDF
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(event) => void selectReceipt(channel.id, event.target.files?.[0])}
                      disabled={busy || closing}
                    />
                  </label>
                  <p className={s.formNotice} role="status" aria-live="polite">
                    {draft.notice || 'Adjunta el PDF para completar importe, fecha y referencia automáticamente.'}
                  </p>
                  <label>
                    Importe del comprobante
                    <input type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.amount}
                      onChange={(event) => updateReceipt(channel.id, 'amount', event.target.value)} disabled={busy || closing || draft.reading} />
                  </label>
                  <label>
                    Fecha de pago
                    <input
                      type="date"
                      value={draft.paymentDate}
                      onChange={(event) => updateReceipt(channel.id, 'paymentDate', event.target.value)}
                      disabled={busy || closing || draft.reading}
                    />
                  </label>
                  <label className={s.fullRow}>
                    Referencia
                    <input
                      value={draft.reference}
                      maxLength={120}
                      placeholder="Referencia bancaria / TOKA"
                      onChange={(event) => updateReceipt(channel.id, 'reference', event.target.value)}
                      disabled={busy || closing || draft.reading}
                    />
                  </label>
                  {amountMismatch && <p className={s.formNotice} role="alert">El importe no coincide con {formatMoney(channel.amount)}. Revisa el comprobante.</p>}
                  {currencyMismatch && <p className={s.formNotice} role="alert">La moneda del PDF no coincide con {channel.currency} o contiene varias monedas. Selecciona el comprobante correcto.</p>}
                  <div className={s.fullRow}>
                    <button type="button" className={s.primaryBtn} onClick={() => void uploadReceipt(channel)} disabled={busy || closing || draft.reading || !draft.file || draft.invalid || currencyMismatch}>
                      {draft.reading ? 'Leyendo comprobante…' : busy ? 'Validando comprobante…' : 'Subir y conciliar comprobante'}
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

      {summary.request_status === 'paid' ? (
        <div className={s.receiptSuccess} role="status">
          <span aria-hidden="true"><IcAprobaciones size={18} /></span>
          Nómina pagada · los comprobantes de BBVA, SPEI y TOKA quedaron conciliados.
        </div>
      ) : canPay && summary.can_close_paid ? (
        <div className={`${s.approval} ${s.receiptFooter}`}>
          <div>
            <strong>Comprobación completa</strong>
            <p>Los tres canales están conciliados. Cierra la corrida para registrarla como pagada.</p>
          </div>
          <button type="button" className={s.primaryBtn} onClick={() => void closeAsPaid()} disabled={closing || Boolean(busyChannelId)}>
            {closing ? 'Cerrando…' : 'Cerrar nómina como pagada'}
          </button>
        </div>
      ) : summary.all_reconciled ? (
        <div className={s.receiptSuccess}>Los comprobantes de todos los canales quedaron conciliados.</div>
      ) : null}
    </section>
  )
}
