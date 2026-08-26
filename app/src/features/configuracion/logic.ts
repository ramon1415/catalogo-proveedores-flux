// Lógica pura portada 1:1 de configuracion.js (vanilla). Sin efectos ni DOM.
import { ROLE_GROUPS } from '../../lib/roles'
import type { RoleGroup } from '../../lib/roles'
import type { BadgeVariant } from '../../components/ui/Badge'
import type {
  ConfigTab,
  OriginAccountPayload,
  Company,
  Member,
  FeeCharge,
  FeePayment,
  IncidentCharge,
  Invoice,
  MemberBalance,
} from './types'

export function normalize(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

export function formatCurrency(value: unknown): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(
    Number(value) || 0,
  )
}

// Espejo de formatNumber() vanilla: 4 decimales máximo.
export function formatNumber(value: unknown): string {
  return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 4 }).format(Number(value) || 0)
}

// Espejo de formatDate() vanilla — devuelve "—" (no "Sin fecha") si vacío/ inválido.
export function formatDate(value: unknown): string {
  if (!value) return '—'
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? '—'
    : new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(d)
}

// ── Tab gating: espejo exacto de canAccessConfigTab() en config.js ──
const TAB_ACCESS: Record<ConfigTab, RoleGroup[]> = {
  members: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.DIRECTION],
  originAccounts: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION],
  budgets: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION],
  contpaq: [ROLE_GROUPS.SYSADMIN, ROLE_GROUPS.ADMIN, ROLE_GROUPS.DIRECTION],
  system: [ROLE_GROUPS.SYSADMIN],
}

export const CONFIG_TABS: ConfigTab[] = ['members', 'originAccounts', 'budgets', 'contpaq', 'system']

export const TAB_LABELS: Record<ConfigTab, string> = {
  members: 'Socios',
  originAccounts: 'Cuentas origen',
  budgets: 'Presupuestos',
  contpaq: 'Mapeo CONTPAQ',
  system: 'Sistema',
}

export const TAB_BADGES: Record<ConfigTab, string> = {
  members: 'Dir',
  originAccounts: 'Adm/Dir',
  budgets: 'Trim.',
  contpaq: 'Adm/Dir',
  system: 'SysAdmin',
}

export function canAccessConfigTab(tab: string, group: RoleGroup): boolean {
  const allowed = TAB_ACCESS[tab as ConfigTab]
  return Boolean(allowed && allowed.includes(group))
}

// Mapa de alias de ?tab= (espejo de tabMap en openInitialTab).
const TAB_QUERY_MAP: Record<string, ConfigTab> = {
  socios: 'members',
  members: 'members',
  cuentas: 'originAccounts',
  cuentas_origen: 'originAccounts',
  'cuentas-origen': 'originAccounts',
  originAccounts: 'originAccounts',
  budgets: 'budgets',
  presupuestos: 'budgets',
  contpaq: 'contpaq',
  system: 'system',
  sistema: 'system',
}

export function resolveRequestedTab(raw: string): string {
  return TAB_QUERY_MAP[raw] || raw
}

// ── Cuentas origen ───────────────────────────────────────────────
export function validateOriginAccount(payload: OriginAccountPayload): string {
  if (!payload.company_id) return 'Selecciona la empresa.'
  if (!payload.name) return 'Captura el nombre de la cuenta.'
  if (!payload.bank_name) return 'Captura el banco.'
  if (!payload.account_number) return 'Captura el numero de cuenta.'
  if (!payload.currency) return 'Selecciona la moneda.'
  return ''
}

export function originCompanyName(company: Company | undefined | null): string {
  return company ? company.legal_name || company.name || 'Empresa sin nombre' : 'Sin empresa'
}

export function originRlsMessage(error: any, operation: 'select' | 'insert' | 'update'): string {
  const msg = error?.message || ''
  const code = error?.code || ''
  const isPerm =
    code === '42501' ||
    msg.toLowerCase().includes('row-level security') ||
    msg.toLowerCase().includes('permission')
  if (code === '23502') return `Falta un dato obligatorio: ${msg}`
  if (code === '23505') return 'Ya existe una cuenta origen con esos datos.'
  if (msg.includes('company_account_type')) return 'Tipo de cuenta no permitido.'
  if (!isPerm) return `Error en cuentas origen: ${msg}`
  if (operation === 'select') return 'No se pudieron cargar las cuentas origen. Falta policy select sobre company_bank_accounts.'
  if (operation === 'insert') return 'No se pudo crear la cuenta origen. Falta policy insert.'
  return 'No se pudo actualizar la cuenta origen. Falta policy update.'
}

// ── Socios ───────────────────────────────────────────────────────
export function memberBalance(
  memberId: string,
  charges: FeeCharge[],
  payments: FeePayment[],
  incidents: IncidentCharge[],
  invoices: Invoice[],
): MemberBalance {
  const c = charges.filter((x) => x.member_id === memberId)
  const p = payments.filter((x) => x.member_id === memberId)
  const i = incidents.filter((x) => x.member_id === memberId)
  const inv = invoices.filter((x) => x.member_id === memberId)
  const totalCharged = c.reduce((sum, x) => sum + Number(x.amount || 0), 0)
  const totalPaid = p.reduce((sum, x) => sum + Number(x.amount || 0), 0)
  const incidentCharges = i.reduce((sum, x) => sum + Number(x.amount || 0), 0)
  const pending = totalCharged + incidentCharges - totalPaid
  const historic = totalCharged + incidentCharges
  const openIncidents = i.filter((x) => x.status && !['resolved', 'paid', 'closed'].includes(x.status)).length
  const pendingInvoices = inv.filter((x) => x.status === 'issued').length
  return { pending: Math.max(0, pending), historic, openIncidents, pendingInvoices }
}

export function memberMatches(m: Member, query: string, status: string, lineage: string): boolean {
  const haystack = normalize([m.full_name, m.rfc, m.email, m.phone].join(' '))
  return (
    haystack.includes(query) &&
    (status === 'all' || (status === 'active' ? m.active !== false : m.active === false)) &&
    (lineage === 'all' || m.lineage === lineage)
  )
}

type BadgeSpec = [label: string, variant: BadgeVariant]

export function chargeStatusBadge(status: string | null | undefined): BadgeSpec {
  const map: Record<string, BadgeSpec> = {
    pending: ['Pendiente', 'warning'],
    partial: ['Parcial', 'warning'],
    paid: ['Pagado', 'success'],
    cancelled: ['Cancelado', 'neutral'],
    voided: ['Anulado', 'neutral'],
  }
  return map[status || ''] || [status || '—', 'neutral']
}

export function incidentStatusBadge(status: string | null | undefined): BadgeSpec {
  const map: Record<string, BadgeSpec> = {
    open: ['Abierta', 'danger'],
    pending: ['Pendiente', 'warning'],
    paid: ['Pagada', 'success'],
    resolved: ['Resuelta', 'success'],
    closed: ['Cerrada', 'neutral'],
    cancelled: ['Cancelada', 'neutral'],
  }
  return map[status || ''] || [status || '—', 'neutral']
}

export function invoiceStatusBadge(status: string | null | undefined): BadgeSpec {
  const map: Record<string, BadgeSpec> = {
    issued: ['Emitida', 'warning'],
    paid: ['Pagada', 'success'],
    cancelled: ['Cancelada', 'neutral'],
    draft: ['Borrador', 'neutral'],
  }
  return map[status || ''] || [status || '—', 'neutral']
}

export function paymentMethodLabel(method: string | null | undefined): string {
  const map: Record<string, string> = {
    transfer: 'Transferencia',
    cash: 'Efectivo',
    check: 'Cheque',
    card: 'Tarjeta',
    spei: 'SPEI',
  }
  return map[method || ''] || method || '—'
}

export function friendlyError(error: any): string {
  const msg = error?.message || String(error || 'Error desconocido')
  if (msg.toLowerCase().includes('row-level security') || error?.code === '42501')
    return 'Operacion bloqueada por RLS. Revisa policies.'
  return msg
}

// ── Gestión de usuarios ──────────────────────────────────────────
export const GROUP_LABELS: Record<string, string> = {
  sysadmin: 'SysAdmin',
  admin_finance: 'Financiero',
  direction: 'Director',
  operation: 'Operativo',
  pending: 'Pendiente',
}

// El vanilla usa "violet" para direction; Badge de React no tiene violet →
// se aproxima a "accent". El resto es idéntico.
export const GROUP_BADGE: Record<string, BadgeVariant> = {
  sysadmin: 'accent',
  admin_finance: 'info',
  direction: 'accent',
  operation: 'success',
  pending: 'warning',
}

export const ROLE_ALIASES: Record<string, string[]> = {
  sysadmin: ['sysadmin', 'superadmin', 'system_admin', 'admin'],
  finance: ['finance', 'finanzas', 'administracion', 'treasury', 'tesoreria'],
  director: ['director', 'direccion', 'approver_2', 'aprobador_2'],
  solicitante: ['solicitante', 'operator', 'default'],
}

export function groupFromRoleNames(roleNames: string[]): string {
  const SYSADMIN = ['sysadmin', 'system_admin', 'admin']
  const ADMIN = ['finance', 'finanzas', 'treasury', 'tesoreria']
  const DIRECTION = ['approver_2', 'aprobador_2', 'direccion', 'director']
  const OPERATION = ['solicitante', 'operator', 'default']
  const n = roleNames.map((r) => r.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''))
  if (n.some((r) => SYSADMIN.includes(r))) return 'sysadmin'
  if (n.some((r) => ADMIN.includes(r))) return 'admin_finance'
  if (n.some((r) => DIRECTION.includes(r))) return 'direction'
  if (n.some((r) => OPERATION.includes(r))) return 'operation'
  return 'pending'
}

// Preselección del radio del dialog según el grupo actual (roleMap vanilla).
export function roleValueFromGroup(group: string): string {
  const roleMap: Record<string, string> = {
    sysadmin: 'sysadmin',
    admin_finance: 'finance',
    direction: 'director',
    operation: 'solicitante',
    pending: 'pending',
  }
  return roleMap[group] || 'pending'
}

export function friendlyRoutingError(error: any): string {
  const message = error?.message || String(error || 'Error desconocido')
  const known: Record<string, string> = {
    routing_admin_required: 'Solo SysAdmin puede administrar el enrutamiento.',
    membership_used_by_active_approver_pool: 'Quita primero los aprobadores activos que usan esta membresía.',
    requester_company_membership_required: 'El solicitante necesita membresía activa en la empresa.',
    approver_company_membership_required: 'El usuario no pertenece a la empresa o su membresía no está activa.',
    approver_role_required: 'El usuario no tiene rol finance/director.',
    approver_not_eligible_for_company: 'El aprobador debe ser finance/director y pertenecer a la empresa.',
    profile_not_found_or_inactive: 'Solo los perfiles activos pueden recibir una membresía.',
    requester_cannot_be_own_pool_approver: 'El solicitante no puede agregarse como su propio aprobador.',
    approver_already_configured: 'Este aprobador ya está configurado para el solicitante y la empresa.',
  }
  const key = Object.keys(known).find((item) => message.includes(item))
  return key ? known[key] : friendlyError(error)
}

// ── Mapeo CONTPAQ ────────────────────────────────────────────────
export function errorMessage(err: any): string {
  return err?.message || String(err)
}
