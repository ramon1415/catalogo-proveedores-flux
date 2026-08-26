import type { ReactNode } from 'react'
import s from './Nav.module.css'
import isotipo from '../../../assets/favicon-512.png'
import logoFull from '../../../assets/logo-flux-verde.webp'
import { useAuth } from '../../../lib/auth'
import { useCompany } from '../../../lib/company'
import {
  IcSolicitudes, IcLayouts, IcEfectivo, IcIngresos, IcIncidencias, IcProveedores,
  IcDashboard, IcAprobaciones, IcConfig, IcUser, IcLogout,
} from '../icons'

type Item = { key: string; label: string; icon: ReactNode }
type Section = { title: string; items: Item[] }

const SECTIONS: Section[] = [
  { title: 'Operación', items: [
    { key: 'solicitudes', label: 'Solicitudes de pago', icon: <IcSolicitudes /> },
    { key: 'layouts', label: 'Layouts de pago', icon: <IcLayouts /> },
    { key: 'efectivo', label: 'Efectivo', icon: <IcEfectivo /> },
    { key: 'ingresos', label: 'Ingresos', icon: <IcIngresos /> },
    { key: 'incidencias', label: 'Incidencias', icon: <IcIncidencias /> },
    { key: 'proveedores', label: 'Proveedores', icon: <IcProveedores /> },
  ]},
  { title: 'General', items: [
    { key: 'dashboard', label: 'Dashboard', icon: <IcDashboard /> },
    { key: 'aprobaciones', label: 'Aprobaciones', icon: <IcAprobaciones /> },
  ]},
  { title: 'Configuración', items: [
    { key: 'configuracion', label: 'Configuración', icon: <IcConfig /> },
  ]},
]

export function Nav({ active = 'solicitudes', onNavigate }: { active?: string; onNavigate?: (key: string) => void }) {
  const { profile, session, signOut } = useAuth()
  const { companyName } = useCompany()

  return (
    <aside className={s.rail}>
      <div className={s.brand}>
        <img className={s.iso} src={isotipo} alt="Flux" />
        <img className={s.full} src={logoFull} alt="Flux" />
        {companyName && (
          <div className={`${s.ctx} ${s.txt}`}><b>{companyName.split(' ')[0]}</b>{companyName.split(' ').slice(1).join(' ')}</div>
        )}
      </div>

      <nav className={s.nav}>
        {SECTIONS.map((sec) => (
          <div key={sec.title}>
            <div className={`${s.sec} ${s.txt}`}>{sec.title}</div>
            {sec.items.map((it) => (
              <button
                key={it.key}
                className={`${s.item} ${active === it.key ? s.active : ''}`}
                onClick={() => onNavigate?.(it.key)}
              >
                {it.icon}
                <span className={s.txt}>{it.label}</span>
              </button>
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
