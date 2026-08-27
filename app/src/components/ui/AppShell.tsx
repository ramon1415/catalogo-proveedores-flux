import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import s from './AppShell.module.css'
import { Nav } from './Nav/Nav'
import { IcTheme } from './icons'
import { itemForPath } from './Nav/navModel'

export function AppShell() {
  const { pathname } = useLocation()
  const item = itemForPath(pathname)
  const kicker = item ? `${item.label}` : 'Plataforma'

  function toggleTheme() {
    const el = document.documentElement
    el.dataset.theme = el.dataset.theme === 'light' ? 'dark' : 'light'
  }

  return (
    <>
      <Nav />
      <div className={s.content}>
        <div className={s.topbar}>
          <div className={s.kick}>{kicker}</div>
          <button className={s.iconbtn} title="Tema claro / oscuro" onClick={toggleTheme}><IcTheme /></button>
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
