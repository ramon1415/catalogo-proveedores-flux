// Diálogo "Habilitar para siguiente corte" (espejo de rebatchDialog + releaseRejectedItem).
import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { releaseAndRebatchRejectedRequest } from './api'
import { friendlyError } from './logic'
import type { BatchItem, BatchListRow } from './types'
import s from './Cortes.module.css'

export function RebatchDialog({
  item,
  draftBatches,
  locked,
  setLocked,
  onClose,
  onReleased,
}: {
  item: BatchItem
  // Cortes destino: borradores de la misma empresa, excluyendo el actual (los arma el padre).
  draftBatches: BatchListRow[]
  locked: boolean
  setLocked: (value: boolean) => void
  onClose: () => void
  onReleased: () => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [targetBatchId, setTargetBatchId] = useState('')
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (locked || saving) return
    const trimmed = note.trim()
    if (trimmed.length < 10) {
      showToast('Nota requerida', 'Explica en al menos 10 caracteres que informacion fue corregida.', 'warning')
      return
    }
    setSaving(true)
    setLocked(true)
    try {
      const data = await releaseAndRebatchRejectedRequest({
        rejectedItemId: item.id,
        correctionNote: trimmed,
        targetBatchId: targetBatchId || null,
      })
      showToast(
        'Reingreso registrado',
        data?.new_item_id
          ? 'La solicitud entro como pendiente en el nuevo corte; requiere nueva aprobacion y cierre.'
          : 'La solicitud quedo disponible para incorporarse a un siguiente corte.',
        'success',
      )
      onClose()
      await onReleased()
    } catch (error) {
      showToast('No se pudo habilitar', friendlyError(error), 'error')
    } finally {
      setSaving(false)
      setLocked(false)
    }
  }

  return (
    <Modal
      title="Habilitar para siguiente corte"
      subtitle="Registra por que la solicitud ya puede volver a revisarse."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className={s.modalGrid}>
          <div className={`${s.full} ${s.rejectContext}`}>
            <strong>Motivo original de Direccion</strong>
            {item.reject_reason || 'Sin motivo registrado.'}
          </div>
          <label className={s.full}>
            Que se corrigio
            <textarea
              className={s.field}
              rows={4}
              required
              minLength={10}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label className={s.full}>
            Destino
            <select className={s.field} value={targetBatchId} onChange={(e) => setTargetBatchId(e.target.value)}>
              <option value="">Dejar disponible para siguiente corte</option>
              {draftBatches.map((batch) => (
                <option key={batch.id} value={batch.id}>{batch.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
          <button type="submit" className={s.primaryBtn} disabled={saving}>Corregir y enviar nuevamente</button>
        </div>
      </form>
    </Modal>
  )
}
