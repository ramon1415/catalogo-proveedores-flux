import { Suspense, useState, type CSSProperties } from 'react'
import { CompanySwitcher } from './Nav/CompanySwitcher'
import { useCompany, companyColor } from '../../lib/company'
import { Outlet, useLocation } from 'react-router-dom'
import s from './AppShell.module.css'
import { Nav } from './Nav/Nav'
import { itemForPath } from './Nav/navModel'

export function AppShell() {
  const { pathname } = useLocation()
  const { companyName } = useCompany()
  const item = itemForPath(pathname)
  const kicker = item ? `${item.label}` : 'Plataforma'
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme !== 'light')

  function toggleTheme() {
    const el = document.documentElement
    const next = el.dataset.theme === 'light' ? 'dark' : 'light'
    el.dataset.theme = next
    setDark(next === 'dark')
  }

  return (
    <>
      <Nav />
      <div className={s.content}>
        <div className={s.topbar} style={{ '--company-accent': companyColor(companyName) } as CSSProperties}>
          <div className={s.kick}>{kicker}</div>
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
