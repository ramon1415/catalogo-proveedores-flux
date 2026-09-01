import s from '../Configuracion.module.css'

// Placeholder fiel al vanilla: la pestaña Presupuestos aún no tiene funcionalidad.
export function BudgetsTab() {
  return (
    <div className={s.panel}>
      <div className={s.pendingCard}>
        <h2>Presupuestos</h2>
        <p>
          Carga trimestral de presupuestos por empresa, centro de costo, partida y periodo. Pendiente de conexion con
          modelo presupuestal final.
        </p>
        <div className={`${s.notice} ${s.warning}`}>
          <span className={s.noticeIcon}>·</span>
          <span>
            <span className={s.noticeTitle}>Pendiente</span> —{' '}
            <span className={s.noticeDesc}>
              Permitira cargar presupuesto base trimestral para alimentar Dashboard, comparativos y cierre mensual.
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
