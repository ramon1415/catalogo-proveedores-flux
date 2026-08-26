import { useAuth } from '../../../lib/auth'
import { useCompany } from '../../../lib/company'
import s from './Nav.module.css'

// Selector de empresa activa. Una sola empresa → chip estático; varias → dropdown.
// Se apoya en profile_company_memberships (via useAuth) + useCompany (activa/persistida).
export function CompanySwitcher() {
  const { memberships } = useAuth()
  const { companyId, setCompany } = useCompany()

  if (memberships.length === 0) return null

  if (memberships.length === 1) {
    const name = memberships[0].company_name
    return (
      <div className={s.companyBar}>
        <div className={s.companyChip}>
          <b>{name.split(' ')[0]}</b>
          {name.split(' ').slice(1).join(' ')}
        </div>
      </div>
    )
  }

  return (
    <div className={s.companyBar}>
      <label className={s.companyLabel}>Empresa</label>
      <select
        className={s.companySelect}
        value={companyId ?? ''}
        onChange={(e) => setCompany(e.target.value)}
        aria-label="Empresa activa"
      >
        {memberships.map((m) => (
          <option key={m.company_id} value={m.company_id}>{m.company_name}</option>
        ))}
      </select>
    </div>
  )
}
