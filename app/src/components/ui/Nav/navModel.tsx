import type { ReactNode } from 'react'
import { ROLE_GROUPS } from '../../../lib/roles'
import type { RoleGroup } from '../../../lib/roles'
import {
  IcSolicitudes, IcLayouts, IcReceiptBatches, IcEfectivo, IcIngresos, IcIncidencias,
  IcProveedores, IcProviderIntakes, IcDashboard, IcDashboardAnnual, IcAprobaciones,
  IcApprovalBatches, IcConfig,
} from '../icons'

const ALL_ACTIVE: RoleGroup[] = [
  ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION, ROLE_GROUPS.OPERATION,
]
const MANAGE: RoleGroup[] = [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION]
const FINANCE: RoleGroup[] = [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN]

export type NavItem = {
  key: string
  label: string
  path: string
  icon: ReactNode
  groups: RoleGroup[]
  // Clave del registro de módulos que controla su visibilidad. Los puentes
  // vanilla sin moduleKey permanecen disponibles según el rol actual.
  moduleKey?: string
  migrated?: boolean
  vanillaHref?: string
}

export type NavSection = { title: string; items: NavItem[] }

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Operación',
    items: [
      { key: 'solicitudes', label: 'Solicitudes de pago', path: '/solicitudes', icon: <IcSolicitudes />, groups: ALL_ACTIVE, moduleKey: 'solicitudes', migrated: true },
      { key: 'layouts', label: 'Layouts de pago', path: '/layouts', icon: <IcLayouts />, groups: MANAGE, moduleKey: 'layouts', migrated: true },
      { key: 'comprobantes-batch', label: 'Comprobantes batch', path: '/comprobantes-batch', icon: <IcReceiptBatches />, groups: FINANCE },
      { key: 'efectivo', label: 'Efectivo y comprobaciones', path: '/efectivo', icon: <IcEfectivo />, groups: MANAGE, moduleKey: 'efectivo', migrated: true },
      { key: 'ingresos', label: 'Ingresos', path: '/ingresos', icon: <IcIngresos />, groups: MANAGE, moduleKey: 'ingresos', migrated: true },
      { key: 'incidencias', label: 'Incidencias', path: '/incidencias', icon: <IcIncidencias />, groups: MANAGE, moduleKey: 'incidencias', migrated: true },
      { key: 'proveedores', label: 'Proveedores', path: '/proveedores', icon: <IcProveedores />, groups: MANAGE, moduleKey: 'proveedores', migrated: true },
      { key: 'solicitudes-proveedores', label: 'Solicitudes de proveedores', path: '/solicitudes-proveedores', icon: <IcProviderIntakes />, groups: MANAGE },
    ],
  },
  {
    title: 'General',
    items: [
      { key: 'dashboard', label: 'Dashboard operativo', path: '/dashboard', icon: <IcDashboard />, groups: MANAGE, moduleKey: 'dashboard', migrated: true },
      { key: 'dashboard-anual', label: 'Dashboard anual', path: '/dashboard-anual', icon: <IcDashboardAnnual />, groups: MANAGE, moduleKey: 'dashboard', migrated: true },
      { key: 'aprobaciones', label: 'Cola de aprobación', path: '/aprobaciones', icon: <IcAprobaciones />, groups: MANAGE, moduleKey: 'aprobaciones', migrated: true },
      { key: 'cortes-semanales', label: 'Cortes semanales', path: '/cortes-semanales', icon: <IcApprovalBatches />, groups: MANAGE },
    ],
  },
  {
    title: 'Configuración',
    items: [
      { key: 'configuracion', label: 'Configuración', path: '/configuracion', icon: <IcConfig />, groups: MANAGE, moduleKey: 'configuracion', migrated: true },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items)

export function itemForPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((it) => pathname === it.path || pathname.startsWith(it.path + '/'))
}
