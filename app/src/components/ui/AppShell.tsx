import { Outlet, useLocation } from 'react-router-dom'
import s from './AppShell.module.css'
import { Nav } from './Nav/Nav'
import { IcTheme } from './icons'
import { moduleForPath } from '../../lib/modules'

export function AppShell() {
  const { pathname } = useLocation()
  const item = moduleForPath(pathname)
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
          <Outlet />
        </div>
      </div>
    </>
  )
}
