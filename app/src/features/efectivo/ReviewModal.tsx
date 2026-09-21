import { CompanyCaptureContext } from '../../components/ui/CompanyCaptureContext'
import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { friendlyRpcError, reviewActionTitle, reviewActionButton } from './logic'
import { reviewReconciliation } from './api'
import type { ReviewAction } from './types'
import s from './Efectivo.module.css'

export function ReviewModal({
  reconciliationId,
  companyName,
  action,
  reviewerProfileId,
  onClose,
  onReviewed,
}: {
  companyName: string | null
  reconciliationId: string
  action: ReviewAction
  reviewerProfileId: string
  onClose: () => void
  onReviewed: () => void
}) {
  const { showToast } = useToast()
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const c = comment.trim()
    if (['rejected', 'correction_requested'].includes(action) && !c) {
      return showToast('Comentario requerido', 'Captura un comentario para rechazar o solicitar corrección.', 'error')
    }
    setSaving(true)
    try {
      await reviewReconciliation(reconciliationId, reviewerProfileId, action, c || null)
      const desc = action === 'approved' ? 'Comprobación aprobada.' : action === 'rejected' ? 'Comprobación rechazada.' : 'Corrección solicitada.'
      showToast('Decisión registrada', desc, 'success')
      onReviewed()
    } catch (error) {
      showToast('No se pudo registrar decisión', friendlyRpcError(error), 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal headerContext={<CompanyCaptureContext name={companyName} />}
        title={reviewActionTitle(action)}
        subtitle={action === 'approved' ? 'El comentario es opcional para aprobar.' : 'Captura un comentario para informar al responsable.'}
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Registrando...' : reviewActionButton(action)}</button>
          </>
        }
      >
        <div className={s.formGrid}>
          <label className={s.fullRow}>Comentario
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comentario para el responsable" />
          </label>
        </div>
      </Modal>
    </form>
  )
}
