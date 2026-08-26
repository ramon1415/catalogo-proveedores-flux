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
      { key: 'solicitudes', label: 'Solicitudes de pago', path: '/solicitudes', icon: <IcSolicitudes />, vanillaHref: '/solicitudes.html' },
      { key: 'layouts', label: 'Layouts de pago', path: '/layouts', icon: <IcLayouts />, vanillaHref: '/layouts.html' },
      { key: 'efectivo', label: 'Efectivo', path: '/efectivo', icon: <IcEfectivo />, vanillaHref: '/efectivo.html' },
      { key: 'ingresos', label: 'Ingresos', path: '/ingresos', icon: <IcIngresos />, vanillaHref: '/ingresos.html?tab=income' },
      { key: 'incidencias', label: 'Incidencias', path: '/incidencias', icon: <IcIncidencias />, vanillaHref: '/ingresos.html?tab=incidents' },
      { key: 'proveedores', label: 'Proveedores', path: '/proveedores', icon: <IcProveedores />, migrated: true },
    ],
  },
  {
    title: 'General',
    items: [
      { key: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: <IcDashboard />, vanillaHref: '/dashboard.html' },
      { key: 'aprobaciones', label: 'Aprobaciones', path: '/aprobaciones', icon: <IcAprobaciones />, vanillaHref: '/aprobaciones.html' },
    ],
  },
  {
    title: 'Configuración',
    items: [
      { key: 'configuracion', label: 'Configuración', path: '/configuracion', icon: <IcConfig />, vanillaHref: '/configuracion.html' },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items)

export function itemForPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((it) => pathname === it.path || pathname.startsWith(it.path + '/'))
}
