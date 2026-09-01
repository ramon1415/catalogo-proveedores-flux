import type { IntakeStatus, IntakeAction } from './types'

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

// ── Acciones de flujo (rebanada 3) ───────────────────────────────────────────
// Espejo exacto del vanilla: transiciones válidas por estado + nota siempre.
export function availableIntakeActions(status: IntakeStatus): IntakeAction[] {
  const actions: IntakeAction[] = []
  if (status === 'received') actions.push({ kind: 'transition', toStatus: 'in_review', label: 'Iniciar revisión' })
  if (status === 'in_review') {
    actions.push({ kind: 'transition', toStatus: 'needs_correction', label: 'Pedir corrección' })
    actions.push({ kind: 'transition', toStatus: 'rejected', label: 'Rechazar', danger: true })
  }
  if (status === 'needs_correction') {
    actions.push({ kind: 'transition', toStatus: 'in_review', label: 'Retomar revisión' })
    actions.push({ kind: 'transition', toStatus: 'rejected', label: 'Rechazar', danger: true })
  }
  actions.push({ kind: 'note', toStatus: null, label: 'Agregar nota interna' })
  return actions
}

// Copys para el diálogo de confirmación por transición.
export const TRANSITION_COPY: Record<string, { title: string; hint: string; confirm: string }> = {
  in_review: { title: 'Iniciar / retomar revisión', hint: 'La solicitud pasa a revisión interna. Puedes dejar una nota opcional.', confirm: 'Confirmar revisión' },
  needs_correction: { title: 'Pedir corrección', hint: 'Explica al proveedor qué debe corregir (mínimo 10 caracteres).', confirm: 'Solicitar corrección' },
  rejected: { title: 'Rechazar solicitud', hint: 'El rechazo es definitivo. Explica el motivo operativo (mínimo 10 caracteres).', confirm: 'Rechazar' },
}

// Validación idéntica al vanilla (validateAction).
export function validateIntakeAction(action: IntakeAction, notes: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(notes) || /<[^>]*>/.test(notes)) {
    return 'El comentario contiene caracteres o etiquetas no permitidos.'
  }
  if (notes.length > 2000) return 'El comentario no puede exceder 2000 caracteres.'
  if (action.kind === 'note' && notes.length < 3) return 'Escribe una nota de al menos 3 caracteres.'
  if (action.kind === 'transition' && (action.toStatus === 'needs_correction' || action.toStatus === 'rejected') && notes.length < 10) {
    return 'Explica el motivo operativo en al menos 10 caracteres.'
  }
  return ''
}

export function createUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // Fallback determinístico-suficiente para navegadores viejos.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (c?.getRandomValues?.(new Uint8Array(1))?.[0] ?? Math.floor(Math.random() * 256)) % 16
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
