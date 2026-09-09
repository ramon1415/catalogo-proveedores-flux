import { Suspense, useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import s from './AppShell.module.css'
import { Nav } from './Nav/Nav'
import { IcTheme } from './icons'
import { itemForPath } from './Nav/navModel'
import { CompanySwitcher } from './Nav/CompanySwitcher'
import { useCompany, companyColor } from '../../lib/company'

const MOBILE_QUERY = '(max-width: 760px), (hover: none) and (pointer: coarse)'

export function AppShell() {
  const { pathname } = useLocation()
  const { companyName } = useCompany()
  const item = itemForPath(pathname)
  const kicker = item ? `${item.label}` : 'Plataforma'
  const accent = companyColor(companyName)
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY)
    const update = () => { setMobile(media.matches); setMenuOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(closeMenu, [pathname, closeMenu])

  function toggleTheme() {
    const el = document.documentElement
    el.dataset.theme = el.dataset.theme === 'light' ? 'dark' : 'light'
  }

  return (
    <>
      <Nav mobile={mobile} open={menuOpen} onClose={closeMenu} />
      <div className={s.content}>
        {/* Franja del color de la empresa activa: orientación pre-atentiva
            (misma pista que el punto del switcher). El color va por variable
            para que en tema claro el CSS lo oscurezca un poco (más punch sobre
            fondo claro) sin cambiar el tinte del ícono. inset = no altera la
            altura del topbar. */}
        <div className={s.topbar} style={{ '--company-accent': accent } as React.CSSProperties}>
          {mobile && <button type="button" className={s.iconbtn} aria-label="Abrir menú" aria-expanded={menuOpen} aria-controls="flux-navigation" onClick={() => setMenuOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>}
          <div className={s.kick}>{kicker}</div>
          {/* Empresa activa, siempre visible (antes solo en móvil). En desktop
              se alinea a la derecha junto al botón de tema. */}
          <div className={s.company}><CompanySwitcher compact /></div>
          <button type="button" className={s.iconbtn} title="Tema claro / oscuro" aria-label="Tema claro / oscuro" onClick={toggleTheme}><IcTheme /></button>
        </div>
        <div className={s.page}>
          {/* Suspense aquí (no en App) para que el nav/topbar no parpadeen al
              cargar el chunk lazy de cada ruta — solo el área de contenido carga. */}
          <Suspense fallback={<div className="center muted">Cargando…</div>}>
            <Outlet />
          </Suspense>
        </div>
      </div>
    </>
  )
}
