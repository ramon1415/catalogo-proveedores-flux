import { Suspense, useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import s from './AppShell.module.css'
import { Nav } from './Nav/Nav'
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
  // Tema actual, para pintar sol (claro) o luna (oscuro) en el botón. El default
  // sin data-theme es oscuro (tokens en :root).
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme !== 'light')
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
    const next = el.dataset.theme === 'light' ? 'dark' : 'light'
    el.dataset.theme = next
    setDark(next === 'dark')
  }

  return (
    <>
      <Nav mobile={mobile} open={menuOpen} onClose={closeMenu} />
      <div className={s.content}>
        {/* La franja y el punto conservan el mismo tinte de empresa en ambos temas. */}
        <div className={s.topbar} style={{ '--company-accent': accent } as React.CSSProperties}>
          {mobile && <button type="button" className={s.iconbtn} aria-label="Abrir menú" aria-expanded={menuOpen} aria-controls="flux-navigation" onClick={() => setMenuOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>}
          <div className={s.kick}>{kicker}</div>
          {/* Empresa activa, siempre visible (antes solo en móvil). En desktop
              se alinea a la derecha junto al botón de tema. */}
          <div className={s.company}><CompanySwitcher compact /></div>
          <button type="button" className={s.iconbtn} title="Tema claro / oscuro" aria-label={dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'} onClick={toggleTheme}>
            {dark
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" /></svg>}
          </button>
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
