import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { formatCurrency, todayValue } from '../../lib/format'
import { cleanText, friendlyRpcError } from './logic'
import { confirmPaymentLayout } from './api'
import s from './Layouts.module.css'

export function ConfirmPaymentModal({
  layoutId,
  layoutNumber,
  registeredBy,
  onClose,
  onConfirmed,
}: {
  layoutId: string
  layoutNumber: string | null
  registeredBy: string | null
  onClose: () => void
  onConfirmed: () => void | Promise<void>
}) {
  const { showToast } = useToast()
  const [paymentDate, setPaymentDate] = useState(todayValue())
  const [bankReference, setBankReference] = useState('')
  const [storagePath, setStoragePath] = useState('')
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!paymentDate) {
      showToast('Fecha requerida', 'Captura la fecha de pago.', 'warning')
      return
    }
    setSaving(true)
    try {
      const data = await confirmPaymentLayout({
        p_layout_id: layoutId,
        p_payment_date: paymentDate,
        p_bank_reference: cleanText(bankReference) || null,
        p_storage_path: cleanText(storagePath) || null,
        p_registered_by: registeredBy,
      })
      showToast('Pago confirmado', `${data?.paid_count || 0} pagos confirmados por ${formatCurrency(data?.total_paid || 0)}.`, 'success')
      await onConfirmed()
    } catch (error) {
      showToast('No se pudo confirmar pago', friendlyRpcError(error), 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal
        title={`Confirmar pago ${layoutNumber || ''}`.trim()}
        subtitle="Marca el layout como pagado y genera comprobantes internos por cada linea incluida."
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Confirmando...' : 'Confirmar pago'}</button>
          </>
        }
      >
        <div className={s.formGrid}>
          <label>Fecha de pago *
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
          </label>
          <label>Referencia bancaria
            <input type="text" value={bankReference} onChange={(e) => setBankReference(e.target.value)} placeholder="Referencia del banco" />
          </label>
          <label className={s.fullRow}>Ruta de comprobante
            <input type="text" value={storagePath} onChange={(e) => setStoragePath(e.target.value)} placeholder="Opcional, para Storage despues" />
          </label>
        </div>
      </Modal>
    </form>
  )
}
