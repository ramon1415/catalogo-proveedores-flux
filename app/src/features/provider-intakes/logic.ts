import type { IntakeStatus } from './types'

export const INTAKE_STATUS: Record<IntakeStatus, { label: string; variant: 'info' | 'warning' | 'danger' | 'success' | 'neutral' }> = {
  received: { label: 'Recibida', variant: 'info' },
  in_review: { label: 'En revisión', variant: 'warning' },
  needs_correction: { label: 'Requiere corrección', variant: 'warning' },
  rejected: { label: 'Rechazada', variant: 'danger' },
  converted: { label: 'Convertida', variant: 'success' },
  cancelled: { label: 'Cancelada', variant: 'neutral' },
}

export const INTAKE_STATUS_ORDER: IntakeStatus[] = [
  'received', 'in_review', 'needs_correction', 'rejected', 'converted', 'cancelled',
]

export function friendlyIntakeError(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo cargar la bandeja de solicitudes de proveedores.'
}

// ── Detalle ────────────────────────────────────────────────────────────────
export const FILE_KIND_LABELS: Record<string, string> = {
  invoice: 'Factura', invoice_xml: 'Factura XML', invoice_pdf: 'Factura PDF',
  csf: 'Constancia de situación fiscal', bank: 'Estado de cuenta', other: 'Documento',
}

const QUARANTINE_LABELS: Record<string, string> = {
  clean: 'Limpio', pending: 'En revisión', quarantined: 'En cuarentena', infected: 'Bloqueado',
}
export const quarantineLabel = (s: string | null | undefined) => QUARANTINE_LABELS[s || ''] || 'Estado no indicado'

const ACTOR_LABELS: Record<string, string> = {
  provider: 'Proveedor', staff: 'Interno', system: 'Sistema', sysadmin: 'SysAdmin',
}
export const actorLabel = (s: string | null | undefined) => ACTOR_LABELS[s || ''] || 'Sistema'

export function formatBytes(n: number | null | undefined): string {
  const b = Number(n || 0)
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}
