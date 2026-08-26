import type { ReactNode } from 'react'
import { useState } from 'react'
import s from './AppShell.module.css'
import { Nav } from './Nav/Nav'
import { IcTheme } from './icons'

export function AppShell({ kicker, children }: { kicker?: string; children: ReactNode }) {
  const [active, setActive] = useState('solicitudes')

  function toggleTheme() {
    const el = document.documentElement
    el.dataset.theme = el.dataset.theme === 'light' ? 'dark' : 'light'
  }

  return (
    <>
      <Nav active={active} onNavigate={setActive} />
      <div className={s.content}>
        <div className={s.topbar}>
          <div className={s.kick}>{kicker ?? 'Operación · Solicitudes'}</div>
          <button className={s.iconbtn} title="Tema claro / oscuro" onClick={toggleTheme}><IcTheme /></button>
        </div>
        <div className={s.page}>{children}</div>
      </div>
    </>
  )
}
