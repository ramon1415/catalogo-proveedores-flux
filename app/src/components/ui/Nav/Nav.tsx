import { useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import s from './Nav.module.css'
import isotipo from '../../../assets/favicon-512.png'
import logoFull from '../../../assets/logo-flux-verde.webp'
import { useAuth } from '../../../lib/auth'
import { useModules } from '../../../lib/moduleAccess'
import { IcUser, IcLogout } from '../icons'
import { CompanySwitcher } from './CompanySwitcher'
import { NAV_SECTIONS } from './navModel'
import { InstallFluxButton } from '../../../features/install/InstallFluxButton'

export function Nav({ mobile = false, open = false, onClose = () => {} }: { mobile?: boolean; open?: boolean; onClose?: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { profile, session, group, signOut } = useAuth()
  const { isEnabled } = useModules()
  const sections = NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => item.groups.includes(group) && (!item.moduleKey || isEnabled(item.moduleKey)),
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
        <img className={s.iso} src={isotipo} alt="Flux" />
        <img className={s.full} src={logoFull} alt="Flux" />
        {mobile && <button type="button" className={s.closeMenu} onClick={onClose} aria-label="Cerrar menú">✕</button>}
      </div>
      <CompanySwitcher />

      <nav className={s.nav} aria-label="Secciones de Flux">
        {sections.map((sec) => (
          <div key={sec.title}>
            <div className={`${s.sec} ${s.txt}`}>{sec.title}</div>
            {sec.items.map((it) => it.vanillaHref ? (
              <a key={it.key} href={it.vanillaHref} className={s.item} onClick={onClose}>
                {it.icon}
                <span className={s.txt}>{it.label}</span>
              </a>
            ) : (
              <NavLink
                key={it.key}
                to={it.path}
                onClick={onClose}
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
  ) : <aside id="flux-navigation" className={s.rail}>{content}</aside>
}
