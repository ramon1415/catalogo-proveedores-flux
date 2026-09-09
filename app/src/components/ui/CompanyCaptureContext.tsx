import { companyColor, useCompany } from '../../lib/company'
import fluxMark from '../../assets/favicon-512.png'
import s from './CompanyCaptureContext.module.css'

type CompanyIdentity = { name?: string | null; legal_name?: string | null; display_name?: string | null }

export function CompanyCaptureContext({ name, company, label = 'Empresa', emptyLabel = 'Sin seleccionar' }: { name?: string | null; company?: CompanyIdentity | null; label?: string; emptyLabel?: string }) {
  const displayName = name || company?.name || company?.legal_name || company?.display_name || null
  return (
    <div className={s.context} role="status" aria-live="polite" aria-atomic="true">
      <span className={s.icon} style={{ backgroundColor: companyColor(displayName) }} aria-hidden="true">
        <img src={fluxMark} alt="" />
      </span>
      <div className={s.text}>
        <span className={s.label}>{label}</span>
        <strong className={s.name}>{displayName || emptyLabel}</strong>
      </div>
    </div>
  )
}

export function ActiveCompanyCaptureContext() {
  const { companyName } = useCompany()
  return <CompanyCaptureContext name={companyName} label="Empresa activa" />
}
