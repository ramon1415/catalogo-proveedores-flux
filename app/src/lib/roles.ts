// Espejo fiel de la lógica de roles de `config.js` (vanilla).
// Mantener sincronizado: SYSADMIN_ROLES / ADMIN_ROLES / DIRECTION_ROLES /
// OPERATION_ROLES y groupFromRoles deben coincidir con el backend actual.

export const ROLE_GROUPS = {
  SYSADMIN: 'sysadmin',
  ADMIN: 'admin_finance',
  DIRECTION: 'direction',
  OPERATION: 'operation',
  PENDING: 'pending',
  INACTIVE: 'inactive',
} as const

export type RoleGroup = (typeof ROLE_GROUPS)[keyof typeof ROLE_GROUPS]

const SYSADMIN_ROLES = ['sysadmin', 'system_admin', 'admin', 'superadmin']
const ADMIN_ROLES = ['finance', 'finanzas', 'treasury', 'tesoreria', 'administracion']
const DIRECTION_ROLES = ['approver_2', 'aprobador_2', 'direccion', 'director']
const OPERATION_ROLES = ['solicitante', 'operator', 'default', 'seller', 'celebraciones', 'producciones', 'planner']

export function normalizeRole(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export function groupFromRoles(roles: string[]): RoleGroup {
  const clean = roles.map(normalizeRole)
  if (clean.some((r) => SYSADMIN_ROLES.includes(r))) return ROLE_GROUPS.SYSADMIN
  if (clean.some((r) => ADMIN_ROLES.includes(r))) return ROLE_GROUPS.ADMIN
  if (clean.some((r) => DIRECTION_ROLES.includes(r))) return ROLE_GROUPS.DIRECTION
  if (clean.some((r) => OPERATION_ROLES.includes(r))) return ROLE_GROUPS.OPERATION
  return ROLE_GROUPS.PENDING
}

const ADMIN_FINANCE: RoleGroup[] = [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN]
const MANAGE: RoleGroup[] = [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION]
const CREATE: RoleGroup[] = [...MANAGE, ROLE_GROUPS.OPERATION]
const PENDING_GROUPS: RoleGroup[] = [ROLE_GROUPS.PENDING, ROLE_GROUPS.INACTIVE]

// Predicados de permiso, espejo de FluxAuth.* en config.js.
export const perms = {
  isAdminFinance: (g: RoleGroup) => ADMIN_FINANCE.includes(g),
  canApprove: (g: RoleGroup) => MANAGE.includes(g),
  canManageProviders: (g: RoleGroup) => MANAGE.includes(g),
  canCreateProviders: (g: RoleGroup) => CREATE.includes(g),
  isPending: (g: RoleGroup) => PENDING_GROUPS.includes(g),
  isInactive: (g: RoleGroup) => g === ROLE_GROUPS.INACTIVE,
  isSysadmin: (g: RoleGroup) => g === ROLE_GROUPS.SYSADMIN,
}
