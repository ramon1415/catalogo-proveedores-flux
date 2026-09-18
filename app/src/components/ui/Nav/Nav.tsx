import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import s from './Nav.module.css'
import logoFull from '../../../assets/logo-flux-verde.webp'
import { useAuth } from '../../../lib/auth'
import { useModules } from '../../../lib/moduleAccess'
import { IcUser, IcLogout } from '../icons'
import { NAV_SECTIONS } from './navModel'
import { InstallFluxButton } from '../../../features/install/InstallFluxButton'
import { usePayrollAccess } from '../../../features/nomina/usePayrollAccess'

export function Nav({ mobile = false, open = false, onClose = () => {} }: { mobile?: boolean; open?: boolean; onClose?: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [railExpanded, setRailExpanded] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const collapseAfterSelection = () => {
    setRailExpanded(false)
    onClose()
  }
  const dismissRail = () => {
    setRailExpanded(false)
    menuButtonRef.current?.focus()
  }
  const { profile, session, group, signOut } = useAuth()
  const { isEnabled } = useModules()
  const payrollAccess = usePayrollAccess()
  const sections = NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => (item.moduleKey === 'nomina' ? payrollAccess.can_capture : item.groups.includes(group)) && (!item.moduleKey || isEnabled(item.moduleKey)),
      ),
    }))
    .filter((section) => section.items.length > 0)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!mobile || !dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [mobile, open])

  const content = (
    <>
      <div className={s.brand}>
        {!mobile && <button ref={menuButtonRef} type="button" className={s.menuToggle}
          aria-label={railExpanded ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={railExpanded} aria-controls="flux-menu-sections"
          onClick={() => setRailExpanded(value => !value)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d={railExpanded ? 'M6 6l12 12M6 18 18 6' : 'M4 6h16M4 12h16M4 18h16'} />
          </svg>
          <span>Menú</span>
        </button>}
        <img className={s.full} src={logoFull} alt="Flux" />
        {mobile && <button type="button" className={s.closeMenu} onClick={onClose} aria-label="Cerrar menú">✕</button>}
      </div>

      <nav id="flux-menu-sections" className={s.nav} aria-label="Secciones de Flux">
        {sections.map((sec) => (
          <div key={sec.title}>
            <div className={`${s.sec} ${s.txt}`}>{sec.title}</div>
            {sec.items.map((it) => it.vanillaHref ? (
              <a key={it.key} href={it.vanillaHref} title={it.label} aria-label={it.label} className={s.item} onClick={collapseAfterSelection}>
                {it.icon}
                <span className={s.txt}>{it.label}</span>
              </a>
            ) : (
              <NavLink
                key={it.key}
                to={it.path}
                title={it.label}
                aria-label={it.label}
                onClick={collapseAfterSelection}
                className={({ isActive }) => `${s.item} ${isActive ? s.active : ''}`}
              >
                {it.icon}
                <span className={s.txt}>{it.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className={s.install}><InstallFluxButton labelClassName={s.txt} /></div>
      <div className={s.foot}>
        <div className={s.uicon}><IcUser /></div>
        <div className={`${s.uinfo} ${s.txt}`}>
          <b>{profile?.full_name ?? session?.user.email ?? 'Usuario'}</b>
          <span>{session?.user.email}</span>
        </div>
        <button type="button" className={s.logout} title="Cerrar sesión" aria-label="Cerrar sesión" onClick={signOut}><IcLogout /></button>
      </div>
    </>
  )
  return mobile ? (
    <dialog ref={dialogRef} id="flux-navigation" className={`${s.rail} ${s.drawer}`} aria-label="Menú de Flux"
      onCancel={(event) => { if (event.target === event.currentTarget) onClose() }}
      onClose={(event) => { if (event.target === event.currentTarget) onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      {content}
    </dialog>
  ) : <>
    <aside id="flux-navigation" className={`${s.rail} ${railExpanded ? s.expanded : ''}`}
      onKeyDown={(event) => { if (event.key === 'Escape' && railExpanded) { event.preventDefault(); event.stopPropagation(); dismissRail() } }}>{content}</aside>
    {railExpanded && <button type="button" className={s.menuBackdrop} aria-label="Cerrar menú de navegación" onClick={dismissRail} />}
  </>
}
