import { Modal } from '../../components/ui/Modal'
import { formatCurrency } from './logic'
import s from './Ingresos.module.css'

export type StatementValues = {
  expected: number
  paid: number
  pending: number
  openInc: number
  paidInc: number
  refOpen: number
}

export function StatementModal({
  title,
  values,
  onClose,
}: {
  title: string
  values: StatementValues
  onClose: () => void
}) {
  const { expected, paid, pending, openInc, paidInc, refOpen } = values
  const pendingColor = pending > 0 ? 'var(--amber)' : 'var(--emerald)'
  const totalDirect = pending + openInc
  const totalColor = totalDirect > 0 ? 'var(--amber)' : 'var(--emerald)'

  return (
    <Modal
      title={title}
      subtitle="Resumen calculado de cuotas e incidencias del socio."
      size="lg"
      onClose={onClose}
      actions={<button type="button" className={s.secondaryBtn} onClick={onClose}>Cerrar</button>}
    >
      <div className={s.statementBody}>
        <div className={s.refGrid}>
          <div className={s.refCell}><span className={s.refLabel}>Cuotas esperadas</span><span className={s.refValue}>{formatCurrency(expected)}</span></div>
          <div className={s.refCell}><span className={s.refLabel}>Cuotas cobradas</span><span className={s.refValue}>{formatCurrency(paid)}</span></div>
          <div className={s.refCell}><span className={s.refLabel}>Cuotas pendientes</span><span className={s.refValue} style={{ color: pendingColor }}>{formatCurrency(pending)}</span></div>
          <div className={s.refCell}><span className={s.refLabel}>Incidencias directas abiertas</span><span className={s.refValue}>{formatCurrency(openInc)}</span></div>
          <div className={s.refCell}><span className={s.refLabel}>Incidencias directas pagadas</span><span className={s.refValue}>{formatCurrency(paidInc)}</span></div>
          <div className={s.refCell}><span className={s.refLabel}>Incidencias referidas abiertas</span><span className={s.refValue}>{formatCurrency(refOpen)}</span></div>
        </div>
        <div className={`${s.refGrid} ${s.refGridSingle}`}>
          <div className={s.refCell}>
            <span className={s.refLabel}>Total por cobrar directo</span>
            <span className={s.refValue} style={{ fontSize: 16, color: totalColor }}>{formatCurrency(totalDirect)}</span>
          </div>
        </div>
        <div className={s.notice}>
          <span className={s.noticeTitle}>Incidencias referidas</span>
          <span>—</span>
          <span className={s.noticeDesc}>Donde el socio es solo referidor no se suman como deuda directa.</span>
        </div>
      </div>
    </Modal>
  )
}
