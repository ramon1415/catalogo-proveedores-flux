import { companyColor } from '../../lib/company'
import fluxMark from '../../assets/favicon-512.png'
import s from './CompanyCaptureContext.module.css'

export function CompanyCaptureContext({ name }: { name?: string | null }) {
  return (
    <div className={s.context} role="status" aria-live="polite" aria-atomic="true">
      <span className={s.icon} style={{ backgroundColor: companyColor(name) }} aria-hidden="true">
        <img src={fluxMark} alt="" />
      </span>
      <div className={s.text}>
        <span className={s.label}>Empresa</span>
        <strong className={s.name}>{name || 'Sin seleccionar'}</strong>
      </div>
    </div>
  )
}
