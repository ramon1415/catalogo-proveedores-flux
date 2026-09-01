import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { cleanText, friendlyRpcError } from './logic'
import { rejectPaymentLayoutLine } from './api'
import s from './Layouts.module.css'

export function RejectLineModal({
  lineId,
  actorProfileId,
  onClose,
  onRejected,
}: {
  lineId: string
  actorProfileId: string | null
  onClose: () => void
  onRejected: (message: string) => void | Promise<void>
}) {
  const { showToast } = useToast()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const value = cleanText(reason)
    if (!value) {
      showToast('Motivo requerido', 'Captura el motivo del rechazo bancario.', 'warning')
      return
    }
    setSaving(true)
    try {
      const data = await rejectPaymentLayoutLine({ p_line_id: lineId, p_reason: value, p_actor_profile_id: actorProfileId })
      showToast('Linea rechazada', data?.message || 'La linea fue rechazada y la solicitud regreso a aprobada.', 'success')
      await onRejected(data?.message || '')
    } catch (error) {
      showToast('No se pudo rechazar linea', friendlyRpcError(error), 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal
        title="Rechazar linea bancaria"
        subtitle="La solicitud volvera a aprobada para reprogramarse en un layout futuro."
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Rechazando...' : 'Rechazar linea'}</button>
          </>
        }
      >
        <div className={s.formGrid}>
          <label className={s.fullRow}>Motivo del rechazo *
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Captura el motivo reportado por el banco" required />
          </label>
        </div>
      </Modal>
    </form>
  )
}
