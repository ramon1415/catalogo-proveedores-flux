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
