import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { formatCurrency, numberValue } from '../../lib/format'
import { friendlyRpcError } from './logic'
import { submitReconciliation } from './api'
import s from './Efectivo.module.css'

export function SubmitModal({
  reconciliationId,
  assignedAmount,
  totalTickets,
  onClose,
  onSubmitted,
}: {
  reconciliationId: string
  assignedAmount: number
  totalTickets: number
  onClose: () => void
  onSubmitted: () => void
}) {
  const { showToast } = useToast()
  const [returned, setReturned] = useState('0')
  const [saving, setSaving] = useState(false)
  const difference = assignedAmount - totalTickets - numberValue(returned)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await submitReconciliation(reconciliationId, numberValue(returned))
      showToast('Comprobación enviada', 'Comprobación enviada para revisión.', 'success')
      onSubmitted()
    } catch (error) {
      showToast('No se pudo enviar', friendlyRpcError(error), 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal
        title="Enviar comprobación"
        subtitle="Revisa los totales antes de enviarla a revisión."
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Enviando...' : 'Enviar comprobación'}</button>
          </>
        }
      >
        <div className={s.refGrid}>
          <div className={s.refCell}><span className={s.refLabel}>Total tickets</span><span className={s.refValue}>{formatCurrency(totalTickets)}</span></div>
          <div className={s.refCell}><span className={s.refLabel}>Monto asignado</span><span className={s.refValue}>{formatCurrency(assignedAmount)}</span></div>
          <div className={s.refCell}><span className={s.refLabel}>Diferencia</span><span className={s.refValue}>{formatCurrency(difference)}</span></div>
        </div>
        <div className={s.formGrid}>
          <label>Monto devuelto
            <input type="number" min="0" step="0.01" value={returned} onChange={(e) => setReturned(e.target.value)} />
          </label>
        </div>
      </Modal>
    </form>
  )
}
