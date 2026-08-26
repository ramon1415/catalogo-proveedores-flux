import { NavLink } from 'react-router-dom'
import s from './Nav.module.css'
import isotipo from '../../../assets/favicon-512.png'
import logoFull from '../../../assets/logo-flux-verde.webp'
import { useAuth } from '../../../lib/auth'
import { useModules } from '../../../lib/moduleAccess'
import { groupBySection } from '../../../lib/modules'
import { IcUser, IcLogout } from '../icons'
import { CompanySwitcher } from './CompanySwitcher'

export function Nav() {
  const { profile, session, signOut } = useAuth()
  const { enabled } = useModules()
  const sections = groupBySection(enabled)

  return (
    <aside className={s.rail}>
      <div className={s.brand}>
        <img className={s.iso} src={isotipo} alt="Flux" />
        <img className={s.full} src={logoFull} alt="Flux" />
      </div>
      <CompanySwitcher />

      <nav className={s.nav}>
        {sections.map((sec) => (
          <div key={sec.title}>
            <div className={`${s.sec} ${s.txt}`}>{sec.title}</div>
            {sec.items.map((it) => (
              <NavLink
                key={it.key}
                to={it.path}
                className={({ isActive }) => `${s.item} ${isActive ? s.active : ''}`}
              >
                {it.icon}
                <span className={s.txt}>{it.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className={s.foot}>
        <div className={s.uicon}><IcUser /></div>
        <div className={`${s.uinfo} ${s.txt}`}>
          <b>{profile?.full_name ?? session?.user.email ?? 'Usuario'}</b>
          <span>{session?.user.email}</span>
        </div>
        <button className={s.logout} title="Cerrar sesión" onClick={signOut}><IcLogout /></button>
      </div>
    </aside>
  )
}
