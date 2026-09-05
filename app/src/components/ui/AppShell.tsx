import { Suspense, useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import s from './AppShell.module.css'
import { Nav } from './Nav/Nav'
import { IcTheme } from './icons'
import { itemForPath } from './Nav/navModel'
import { CompanySwitcher } from './Nav/CompanySwitcher'

const MOBILE_QUERY = '(max-width: 760px), (hover: none) and (pointer: coarse)'

export function AppShell() {
  const { pathname } = useLocation()
  const item = itemForPath(pathname)
  const kicker = item ? `${item.label}` : 'Plataforma'
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
        <div className={s.topbar}>
          {mobile && <button type="button" className={s.iconbtn} aria-label="Abrir menú" aria-expanded={menuOpen} aria-controls="flux-navigation" onClick={() => setMenuOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>}
          <div className={s.kick}>{kicker}</div>
          {mobile && <div className={s.company}><CompanySwitcher compact /></div>}
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
