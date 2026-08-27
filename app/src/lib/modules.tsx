import { lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import type { ReactNode } from 'react'
import {
  IcSolicitudes, IcLayouts, IcEfectivo, IcIngresos, IcIncidencias, IcProveedores,
  IcDashboard, IcAprobaciones, IcConfig,
} from '../components/ui/icons'

// ── Tipos espejo de las tablas (migración 20260826_platform_module_registry) ──
export type ModuleKind = 'shared' | 'tenant_variant'

export type ModuleRow = { module_key: string; name: string; kind: ModuleKind; active: boolean }
export type ModuleRelease = { id: string; module_key: string; version: number; git_sha: string | null; notes: string | null; released_at: string }
export type CompanyModule = {
  id: string
  company_id: string
  module_key: string
  enabled: boolean
  version: number
  channel: 'stable' | 'canary'
  hold: boolean
  hold_reason: string | null
  held_since: string | null
  updated_at: string
  updated_by: string | null
}

// ── Registro de módulos (fuente única en código) ──
// module_key debe coincidir con la tabla `modules`. `codeVersion` = versión
// presente en el bundle (debe igualar la última release esperada del módulo).
// El nav y las rutas se construyen (F5.b) intersectando este registro con los
// company_modules habilitados de la empresa activa.
export type NavSectionName = 'Operación' | 'General' | 'Configuración'

export type ModuleDef = {
  key: string
  label: string
  section: NavSectionName
  path: string
  // Rutas extra que sirve el mismo módulo (ej. ingresos → /incidencias).
  extraPaths?: string[]
  icon: ReactNode
  kind: ModuleKind
  codeVersion: number
  component: LazyExoticComponent<ComponentType<unknown>>
}

export const MODULE_REGISTRY: ModuleDef[] = [
  {
    key: 'solicitudes', label: 'Solicitudes de pago', section: 'Operación', path: '/solicitudes',
    icon: <IcSolicitudes />, kind: 'shared', codeVersion: 1,
    component: lazy(() => import('../features/solicitudes/SolicitudesPage')),
  },
  {
    key: 'layouts', label: 'Layouts de pago', section: 'Operación', path: '/layouts',
    icon: <IcLayouts />, kind: 'shared', codeVersion: 1,
    component: lazy(() => import('../features/layouts/LayoutsPage')),
  },
  {
    // Nómina (captura N2B en React). company_modules la mantiene APAGADA hasta el
    // QA de Ramón (Edge payroll-materialize desplegada + guards de scope portados).
    key: 'nomina', label: 'Nómina', section: 'Operación', path: '/nomina',
    icon: <IcLayouts />, kind: 'shared', codeVersion: 1,
    component: lazy(() => import('../features/nomina/NominaPage')),
  },
  {
    key: 'efectivo', label: 'Efectivo', section: 'Operación', path: '/efectivo',
    icon: <IcEfectivo />, kind: 'shared', codeVersion: 1,
    component: lazy(() => import('../features/efectivo/EfectivoPage')),
  },
  {
    key: 'ingresos', label: 'Ingresos', section: 'Operación', path: '/ingresos',
    icon: <IcIngresos />, kind: 'tenant_variant', codeVersion: 1,
    component: lazy(() => import('../features/ingresos/IngresosPage')),
  },
  {
    // Incidencias: módulo propio, Operadora-only (via company_modules). Reusa
    // IngresosPage, que se auto-detecta por la ruta /incidencias (isIncidentsPage).
    // Separado de 'ingresos' para que ingresos pueda variar por empresa (Fersana).
    key: 'incidencias', label: 'Incidencias', section: 'Operación', path: '/incidencias',
    icon: <IcIncidencias />, kind: 'shared', codeVersion: 1,
    component: lazy(() => import('../features/ingresos/IngresosPage')),
  },
  {
    key: 'proveedores', label: 'Proveedores', section: 'Operación', path: '/proveedores',
    icon: <IcProveedores />, kind: 'shared', codeVersion: 1,
    component: lazy(() => import('../features/proveedores/ProveedoresPage')),
  },
  {
    key: 'dashboard', label: 'Dashboard', section: 'General', path: '/dashboard',
    icon: <IcDashboard />, kind: 'shared', codeVersion: 1,
    component: lazy(() => import('../features/dashboard/DashboardPage')),
  },
  {
    key: 'aprobaciones', label: 'Aprobaciones', section: 'General', path: '/aprobaciones',
    icon: <IcAprobaciones />, kind: 'shared', codeVersion: 1,
    component: lazy(() => import('../features/aprobaciones/AprobacionesPage')),
  },
  {
    key: 'configuracion', label: 'Configuración', section: 'Configuración', path: '/configuracion',
    icon: <IcConfig />, kind: 'shared', codeVersion: 1,
    component: lazy(() => import('../features/configuracion/ConfiguracionPage')),
  },
]

export const MODULE_BY_KEY: Record<string, ModuleDef> = Object.fromEntries(
  MODULE_REGISTRY.map((m) => [m.key, m]),
)

// Orden de secciones en el nav.
export const SECTION_ORDER: NavSectionName[] = ['Operación', 'General', 'Configuración']

// Agrupa una lista de módulos por sección, respetando SECTION_ORDER.
export function groupBySection(defs: ModuleDef[]): { title: NavSectionName; items: ModuleDef[] }[] {
  return SECTION_ORDER.map((title) => ({ title, items: defs.filter((m) => m.section === title) })).filter(
    (s) => s.items.length > 0,
  )
}

// Módulo cuya ruta (o extraPath) corresponde al pathname actual.
export function moduleForPath(pathname: string): ModuleDef | undefined {
  return MODULE_REGISTRY.find(
    (m) =>
      pathname === m.path ||
      pathname.startsWith(m.path + '/') ||
      (m.extraPaths ?? []).some((p) => pathname === p || pathname.startsWith(p + '/')),
  )
}

// Última versión conocida en código por módulo (para comparar contra la versión
// fijada del tenant y detectar "atrasado" en el tablero de plataforma, F5.d).
export const CODE_VERSIONS: Record<string, number> = Object.fromEntries(
  MODULE_REGISTRY.map((m) => [m.key, m.codeVersion]),
)
