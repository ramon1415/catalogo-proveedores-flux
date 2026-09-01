// Diálogo de confirmación genérico (espejo de confirmActionDialog del vanilla).
// El cuerpo llega como ReactNode ya armado con ConfirmRow/ConfirmTotals.
import type { ReactNode } from 'react'
import { Modal } from '../../components/ui/Modal'
import { formatMoney, totalsByCurrency } from './logic'
import s from './Cortes.module.css'

export function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.confirmRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

// Una fila por moneda; con varias monedas el label lleva el sufijo de la divisa.
export function ConfirmTotals({ items, label }: { items: { amount?: number | null; currency?: string | null }[]; label: string }) {
  const totals = totalsByCurrency(items)
  if (!totals.length) return <ConfirmRow label={label} value="Sin importe" />
  return (
    <>
      {totals.map((row) => (
        <ConfirmRow
          key={row.currency}
          label={totals.length > 1 ? `${label} ${row.currency}` : label}
          value={formatMoney(row.amount, row.currency)}
        />
      ))}
    </>
  )
}

export function ConfirmDialog({
  title,
  confirmLabel,
  children,
  onCancel,
  onConfirm,
}: {
  title: string
  confirmLabel: string
  children: ReactNode
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      title={title}
      subtitle="Revisa el alcance antes de continuar."
      onClose={onCancel}
      actions={(
        <>
          <button type="button" className={s.secondaryBtn} onClick={onCancel}>Cancelar</button>
          <button type="button" className={s.primaryBtn} onClick={onConfirm}>{confirmLabel}</button>
        </>
      )}
    >
      <div className={s.confirmSummary}>{children}</div>
    </Modal>
  )
}
