import { useEffect, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { cleanText, friendlyRpcError } from './logic'
import { listFinanceApprovalBatches, releaseAndRebatchRejectedRequest } from './api'
import type { PreviewRow, FinanceBatch } from './types'
import s from './Layouts.module.css'

export function LayoutRebatchModal({
  item,
  onClose,
  onSubmitted,
}: {
  item: PreviewRow
  onClose: () => void
  onSubmitted: () => void | Promise<void>
}) {
  const { showToast } = useToast()
  const [note, setNote] = useState('')
  const [target, setTarget] = useState('')
  const [drafts, setDrafts] = useState<FinanceBatch[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await listFinanceApprovalBatches('draft')
        if (cancelled) return
        setDrafts(data.filter((batch) => batch.company_id === item.company_id))
      } catch (error) {
        if (!cancelled) showToast('No se cargaron cortes', friendlyRpcError(error), 'error')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.company_id])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const value = cleanText(note)
    if (!value || value.length < 10) {
      showToast('Correccion requerida', 'Explica en al menos 10 caracteres que se corrigio.', 'warning')
      return
    }
    setSaving(true)
    try {
      const data = await releaseAndRebatchRejectedRequest({
        p_rejected_item_id: item.source_item_id as string,
        p_correction_note: value,
        p_target_batch_id: target || null,
      })
      showToast(
        'Reingreso registrado',
        data?.new_item_id
          ? 'La solicitud requiere nueva aprobacion y cierre antes de entrar a un layout.'
          : 'La solicitud quedo disponible para el siguiente corte.',
        'success',
      )
      await onSubmitted()
    } catch (error) {
      showToast('No se pudo reenviar', friendlyRpcError(error), 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal
        title="Enviar nuevamente a aprobacion"
        subtitle="El rechazo anterior se conserva; se crea una nueva participacion en corte."
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Registrando...' : 'Corregir y enviar nuevamente'}</button>
          </>
        }
      >
        <div className={s.formGrid}>
          <div className={`${s.fullRow} ${s.rebatchOriginal}`}>
            <strong>{item.request_number || 'Solicitud'}</strong>
            <br />
            Motivo original: {item.reject_reason || 'Sin motivo registrado'}
          </div>
          <label className={s.fullRow}>Que se corrigio *
            <textarea minLength={10} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} required />
          </label>
          <label className={s.fullRow}>Destino
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Dejar disponible para siguiente corte</option>
              {drafts.map((batch) => <option key={batch.id} value={batch.id}>{batch.label}</option>)}
            </select>
          </label>
        </div>
      </Modal>
    </form>
  )
}
