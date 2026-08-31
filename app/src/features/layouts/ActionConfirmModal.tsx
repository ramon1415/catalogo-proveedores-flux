import { Modal } from '../../components/ui/Modal'
import s from './Layouts.module.css'

// Espejo de showLayoutActionConfirmation(): confirmación genérica (marcar subido).
export function ActionConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      title={title}
      subtitle="Revisa el alcance antes de continuar."
      onClose={onCancel}
      actions={
        <>
          <button type="button" className={s.secondaryBtn} onClick={onCancel}>Cancelar</button>
          <button type="button" className={s.primaryBtn} onClick={onConfirm}>{confirmLabel}</button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Modal>
  )
}
