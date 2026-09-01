// Diálogo de ratificación/discrepancia de contingencias extraordinarias
// (espejo de regularizationDialog + submitRegularization del vanilla).
import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { decideRegularization } from './api'
import { createUuid, extraordinaryCategoryLabel, formatDateTime, formatMoney, friendlyError } from './logic'
import type { Regularization, RegularizationDecision } from './types'
import s from './Cortes.module.css'

export function RegularizationDialog({
  row,
  decision,
  locked,
  setLocked,
  onClose,
  onSaved,
}: {
  row: Regularization
  decision: RegularizationDecision
  locked: boolean
  setLocked: (value: boolean) => void
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()
  const isDispute = decision === 'dispute'

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (locked || saving) return
    const trimmed = note.trim()
    if (isDispute && trimmed.length < 20) {
      showToast('Motivo requerido', 'Explica la discrepancia en al menos 20 caracteres.', 'warning')
      return
    }
    setSaving(true)
    setLocked(true)
    try {
      await decideRegularization({
        authorizationId: row.authorization_id,
        decision,
        // Clave idempotente por intento (mismo formato del vanilla).
        idempotencyKey: `regularization:${row.authorization_id}:${decision}:${createUuid()}`,
        note: trimmed,
      })
      showToast(
        isDispute ? 'Discrepancia registrada' : 'Contingencia ratificada',
        isDispute
          ? 'La confirmación del pago sigue bloqueada.'
          : 'La ratificación quedó auditada; no se confirmó ningún pago.',
        isDispute ? 'warning' : 'success',
      )
      onClose()
      await onSaved()
    } catch (error) {
      showToast('No se guardó la decisión', friendlyError(error), 'error')
    } finally {
      setSaving(false)
      setLocked(false)
    }
  }

  // Mientras guarda, el diálogo no se puede cerrar (mismo gating del vanilla).
  function handleClose() {
    if (saving) return
    onClose()
  }

  return (
    <Modal
      title={isDispute ? 'Registrar discrepancia' : 'Ratificar contingencia'}
      subtitle={isDispute
        ? 'La confirmación del pago permanecerá bloqueada.'
        : 'La ratificación habilita la confirmación posterior; no confirma el pago.'}
      onClose={handleClose}
    >
      <form onSubmit={submit}>
        <div className={s.modalGrid}>
          <div className={`${s.full} ${s.rejectContext}`}>
            <strong>{row.request_number || 'Solicitud'}</strong>
            {formatMoney(row.amount, row.currency)}
            <br />
            {extraordinaryCategoryLabel(row.category)} · consumida {formatDateTime(row.consumed_at)}
          </div>
          <label className={s.full}>
            Nota de decisión
            <textarea
              className={s.field}
              rows={4}
              maxLength={1000}
              required={isDispute}
              minLength={isDispute ? 20 : 0}
              placeholder={isDispute
                ? 'Explica la discrepancia en al menos 20 caracteres.'
                : 'Nota opcional de ratificación.'}
              value={note}
              autoFocus
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" className={s.secondaryBtn} disabled={saving} onClick={handleClose}>Cancelar</button>
          <button type="submit" className={s.primaryBtn} disabled={saving}>
            {isDispute ? 'Registrar discrepancia' : 'Ratificar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
