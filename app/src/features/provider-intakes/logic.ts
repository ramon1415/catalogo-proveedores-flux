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

// Espejo de ERROR_MESSAGES del vanilla: código → copy operativo.
const INTAKE_ERROR_MESSAGES: Record<string, string> = {
  provider_intake_conflict: 'Esta solicitud fue actualizada por otro usuario. Recarga el detalle.',
  provider_intake_action_id_conflict: 'La acción no pudo validarse de forma idempotente. Actualiza el detalle.',
  provider_intake_action_id_material_conflict: 'La acción cambió después de iniciarse. Actualiza el detalle.',
  provider_intake_action_id_legacy_conflict: 'La acción no cumple el contrato vigente. Actualiza el detalle.',
  provider_intake_search_too_short: 'Escribe al menos dos caracteres para buscar.',
  provider_intake_comparison_fields_required: 'Selecciona un proveedor para comparar.',
  provider_intake_match_fields_required: 'Faltan datos de confirmación. Actualiza el detalle.',
  provider_intake_match_unchanged: 'El proveedor seleccionado ya es el vínculo actual.',
  provider_intake_match_reason_code_invalid: 'Selecciona un motivo válido.',
  provider_intake_match_reason_required: 'La razón obligatoria debe tener entre 10 y 500 caracteres.',
  provider_intake_match_reason_sensitive: 'Retira datos sensibles del motivo.',
  provider_intake_match_status_invalid: 'El matching solo puede modificarse mientras la solicitud está en revisión.',
  provider_intake_match_converted: 'La solicitud ya fue convertida y el vínculo es de solo lectura.',
  provider_intake_provider_not_found: 'El proveedor maestro ya no está disponible.',
  provider_intake_provider_inactive: 'El proveedor maestro está inactivo y no puede seleccionarse.',
  provider_intake_link_auth_required: 'Tu sesión ya no es válida. Inicia sesión nuevamente.',
  provider_intake_link_access_denied: 'No tienes una asignación activa de Finanzas o Dirección para esta empresa.',
  provider_intake_link_active_exists: 'La empresa ya tiene una liga activa. Revócala o regenérala.',
  provider_intake_link_label_invalid: 'Captura una etiqueta interna válida.',
  provider_intake_link_duration_invalid: 'Selecciona una vigencia entre 4 horas y 7 días.',
  provider_intake_link_not_active: 'La liga ya no está activa. Actualiza el estado.',
  provider_intake_link_not_found: 'La liga ya no está disponible.',
  file_service_unavailable: 'El servicio de documentos temporales aún no está configurado en este ambiente.',
  signed_url_unavailable: 'No se pudo generar el enlace temporal. Inténtalo de nuevo.',
  access_denied: 'No tienes permisos para acceder a este documento.',
  file_not_found: 'El documento no existe o no pertenece a esta solicitud.',
  auth_required: 'Tu sesión ya no es válida. Inicia sesión nuevamente.',
}

export function friendlyIntakeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || '')
  for (const [code, copy] of Object.entries(INTAKE_ERROR_MESSAGES)) {
    if (message.includes(code)) return copy
  }
  return message || 'No fue posible completar la operación. Actualiza la bandeja e inténtalo de nuevo.'
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

// ── Matching (rebanada 5) ───────────────────────────────────────────────────
export const MATCH_CONFIDENCE: Record<string, string> = {
  high: 'Confianza alta', medium: 'Confianza media', low: 'Confianza baja', none: 'Sin puntuación',
}

export const COMPARISON_RESULT: Record<string, string> = {
  match: 'Coincide', different: 'Difiere', not_reported: 'No informado',
}

export const MATCH_REASON_CODES: { value: string; label: string }[] = [
  { value: 'candidate_selected', label: 'Candidato validado' },
  { value: 'manual_search', label: 'Búsqueda manual validada' },
  { value: 'duplicate_resolution', label: 'Duplicado revisado' },
  { value: 'match_corrected', label: 'Corrección de vínculo' },
  { value: 'no_longer_matches', label: 'El vínculo ya no corresponde' },
  { value: 'other', label: 'Otro motivo' },
]

export const MATCH_ACTION_LABELS: Record<string, string> = {
  match_set: 'Vínculo confirmado', match_replace: 'Vínculo reemplazado', match_clear: 'Vínculo retirado',
}

export function matchReadonlyMessage(status: IntakeStatus): string {
  const map: Partial<Record<IntakeStatus, string>> = {
    received: 'Inicia revisión para confirmar un vínculo.',
    needs_correction: 'El vínculo se conserva en solo lectura; retoma revisión para modificarlo.',
    rejected: 'Solicitud terminal en modo solo lectura.',
    converted: 'Solicitud convertida en modo solo lectura.',
    cancelled: 'Solicitud cancelada en modo solo lectura.',
  }
  return map[status] || 'El estado actual no permite modificar el vínculo.'
}

// Validación de la razón del matching (espejo de submitMatch).
export function validateMatchReason(kind: 'set' | 'replace' | 'clear', reason: string): string {
  if ((kind === 'replace' || kind === 'clear') && (reason.length < 10 || reason.length > 500)) {
    return 'La razón obligatoria debe tener entre 10 y 500 caracteres.'
  }
  if (/@|[0-9]{8,}|<[^>]*>/.test(reason)) {
    return 'Retira datos sensibles, números extensos o etiquetas del motivo.'
  }
  return ''
}

export function displayValue(v: string | null | undefined): string {
  return v == null || v === '' ? 'No indicado' : v
}

export function maskedText(v: string | null | undefined): string {
  if (!v) return 'No indicado'
  if (v.length <= 2) return '•'.repeat(v.length)
  if (v.length <= 5) return v[0] + '•'.repeat(v.length - 2) + v[v.length - 1]
  return v.slice(0, 2) + '•'.repeat(Math.min(v.length - 4, 10)) + v.slice(-2)
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
