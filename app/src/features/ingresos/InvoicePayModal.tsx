import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { todayValue } from '../../lib/format'
import { rpcError } from './logic'
import { markInvoicePaid } from './api'
import s from './Ingresos.module.css'

export function InvoicePayModal({
  invoiceId,
  profileId,
  onClose,
  onSaved,
}: {
  invoiceId: string
  profileId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [date, setDate] = useState(todayValue())
  const [method, setMethod] = useState('transfer')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profileId) return showToast('Perfil no identificado', 'No se pudo identificar tu perfil de usuario.', 'error')
    if (!date) return showToast('Fecha requerida', 'Captura fecha de pago.', 'warning')
    setSaving(true)
    try {
      const data = await markInvoicePaid({
        invoiceId,
        paymentDate: date,
        bankReference: reference.trim() || null,
        paymentMethod: method || 'transfer',
        registeredBy: profileId,
        notes: notes.trim() || null,
      })
      showToast('Factura pagada', data?.message || 'Factura marcada como pagada.', 'success')
      onSaved()
    } catch (error) {
      showToast('Operacion no completada', rpcError(error), 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal
        title="Marcar factura pagada"
        subtitle="Registra el cobro asociado a esta factura."
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Marcando...' : 'Marcar pagada'}</button>
          </>
        }
      >
        <div className={s.formGrid}>
          <label>Fecha de pago *
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
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
          <label className={s.fullRow}>Referencia bancaria
            <input value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          <label className={s.fullRow}>Notas
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
      </Modal>
    </form>
  )
}
