import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { numberValue, todayValue } from '../../lib/format'
import { formatCurrency, rpcError, validateUploadFile } from './logic'
import type { FileHint } from './logic'
import { registerPayment, uploadReceipt, linkPaymentReceipt } from './api'
import type { MaintenanceFeeCharge } from './types'
import s from './Ingresos.module.css'

export function PaymentModal({
  charge,
  memberName,
  profileId,
  onClose,
  onSaved,
}: {
  charge: MaintenanceFeeCharge
  memberName: string
  profileId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [amount, setAmount] = useState(numberValue(charge.pending_amount).toFixed(2))
  const [date, setDate] = useState(todayValue())
  const [bankReference, setBankReference] = useState('')
  const [method, setMethod] = useState('transfer')
  const [notes, setNotes] = useState('')
  const [hint, setHint] = useState<FileHint>({ file: null, message: '', tone: 'default' })
  const [saving, setSaving] = useState(false)

  const subtitle = `${memberName} — pendiente ${formatCurrency(charge.pending_amount)}.`

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const result = validateUploadFile(e.target.files?.[0] ?? null)
    if (!result.file) e.target.value = ''
    setHint(result)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profileId) return showToast('Perfil no identificado', 'No se pudo identificar tu perfil de usuario.', 'error')
    const amt = numberValue(amount)
    if (!amt || amt <= 0) return showToast('Monto invalido', 'El monto debe ser mayor a cero.', 'warning')
    if (!date) return showToast('Fecha requerida', 'Captura fecha de pago.', 'warning')
    setSaving(true)
    try {
      const data = await registerPayment({
        chargeId: charge.id,
        amount: amt,
        paymentDate: date,
        bankReference: bankReference.trim() || null,
        paymentMethod: method || 'transfer',
        registeredBy: profileId,
        notes: notes.trim() || null,
      })
      const paymentId = data?.payment_id || data?.id || null
      const file = hint.file
      if (file && paymentId) {
        const storagePath = await uploadReceipt(file, `cobros/${charge.id}`)
        if (storagePath) {
          const ok = await linkPaymentReceipt(paymentId, storagePath)
          if (!ok) showToast('Comprobante no vinculado', 'El cobro se registró pero el comprobante no pudo vincularse. Contacta a soporte.', 'warning')
        }
      }
      showToast('Cobro registrado', data?.message || 'Cobro registrado correctamente.', 'success')
      onSaved()
    } catch (error) {
      showToast('Operacion no completada', rpcError(error), 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal
        title="Registrar cobro"
        subtitle={subtitle}
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Registrando...' : 'Registrar cobro'}</button>
          </>
        }
      >
        <div className={s.formGrid}>
          <label>Monto *
            <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label>Fecha de pago *
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>Referencia bancaria
            <input value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
          </label>
          <label>Metodo de pago
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="transfer">Transferencia</option>
              <option value="cash">Efectivo</option>
              <option value="check">Cheque</option>
              <option value="card">Tarjeta</option>
              <option value="other">Otro</option>
            </select>
          </label>
          <label className={s.fullRow}>Notas
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className={s.fullRow}>Comprobante (foto o PDF)
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={onFile} />
            <span className={`${s.hint} ${hint.tone === 'error' ? s.hintError : hint.tone === 'ok' ? s.hintOk : ''}`}>
              {hint.message || 'JPG, PNG, WEBP o PDF · máx. 10 MB'}
            </span>
          </label>
        </div>
      </Modal>
    </form>
  )
}
