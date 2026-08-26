import type { ReactNode } from 'react'
import {
  IcSolicitudes, IcLayouts, IcEfectivo, IcIngresos, IcIncidencias, IcProveedores,
  IcDashboard, IcAprobaciones, IcConfig,
} from '../icons'

export type NavItem = {
  key: string
  label: string
  path: string
  icon: ReactNode
  migrated?: boolean
  // Página vanilla equivalente (para redirigir mientras la sección no está migrada).
  vanillaHref?: string
}

export type NavSection = { title: string; items: NavItem[] }

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Operación',
    items: [
      { key: 'solicitudes', label: 'Solicitudes de pago', path: '/solicitudes', icon: <IcSolicitudes />, migrated: true },
      { key: 'layouts', label: 'Layouts de pago', path: '/layouts', icon: <IcLayouts />, migrated: true },
      { key: 'efectivo', label: 'Efectivo', path: '/efectivo', icon: <IcEfectivo />, migrated: true },
      { key: 'ingresos', label: 'Ingresos', path: '/ingresos', icon: <IcIngresos />, migrated: true },
      { key: 'incidencias', label: 'Incidencias', path: '/incidencias', icon: <IcIncidencias />, migrated: true },
      { key: 'proveedores', label: 'Proveedores', path: '/proveedores', icon: <IcProveedores />, migrated: true },
    ],
  },
  {
    title: 'General',
    items: [
      { key: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: <IcDashboard />, migrated: true },
      { key: 'aprobaciones', label: 'Aprobaciones', path: '/aprobaciones', icon: <IcAprobaciones />, migrated: true },
    ],
  },
  {
    title: 'Configuración',
    items: [
      { key: 'configuracion', label: 'Configuración', path: '/configuracion', icon: <IcConfig />, migrated: true },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items)

export function itemForPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((it) => pathname === it.path || pathname.startsWith(it.path + '/'))
}
