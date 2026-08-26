// Lógica pura portada 1:1 de proveedores.js (vanilla). Sin efectos ni DOM,
// para poder testear y para que el comportamiento sea idéntico al actual.
import type { Provider, ProviderPayload, DestinationType, StatusFilter } from './types'

export function normalize(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

export function requiresBankDetails(metodoPago: string | null | undefined): boolean {
  return metodoPago === 'Transferencia bancaria'
}

// Filtro de la tabla: mismo haystack y misma semántica de estatus que el vanilla.
export function matchesFilters(p: Provider, query: string, filter: StatusFilter): boolean {
  const haystack = normalize(
    [p.alias, p.nombre_completo, p.rfc, p.banco, p.email, p.telefono, p.metodo_pago].join(' '),
  )
  const matchesQuery = haystack.includes(query)
  const matchesStatus =
    filter === 'todos' ||
    (filter === 'activos' && !!p.activo) ||
    (filter === 'inactivos' && !p.activo)
  return matchesQuery && matchesStatus
}

// Deduce el tipo de destino a partir de los datos capturados (espejo de inferDestinationType).
export function inferDestinationType(f: {
  tipo_cuenta?: string | null
  cuenta_bancaria?: string | null
  clabe?: string | null
  convenio_number?: string | null
}): Exclude<DestinationType, ''> {
  if (f.tipo_cuenta === 'Cuenta') return 'cuenta'
  if (f.cuenta_bancaria && !f.clabe) return 'cuenta'
  if (f.convenio_number) return 'convenio'
  return 'clabe'
}

// Validación de destino idéntica a validateDestination(): devuelve mensaje o "" si ok.
export function validateDestination(payload: ProviderPayload): string {
  if (!requiresBankDetails(payload.metodo_pago)) return ''
  if (!payload.destination_type) return 'Selecciona el tipo de destino de pago: CLABE, cuenta bancaria o convenio.'
  if (!payload.banco) return 'Para transferencia bancaria captura el banco o institucion.'
  if (payload.destination_type === 'clabe' && !payload.clabe) return 'Para destino CLABE captura la CLABE del proveedor.'
  if (payload.destination_type === 'cuenta' && !payload.cuenta_bancaria) return 'Para destino cuenta bancaria captura la cuenta del proveedor.'
  if (payload.destination_type === 'convenio' && !payload.convenio_number) return 'Para destino convenio captura el numero de convenio.'
  return ''
}

// Mapa de códigos de error del RPC → mensaje en español (idéntico al vanilla).
export const PROVIDER_SAVE_ERROR_MESSAGES: Record<string, string> = Object.freeze({
  finance_role_required: 'Los datos bancarios del proveedor solo pueden ser guardados por Finanzas.',
  provider_payment_execution_data_invalid: 'Revisa los datos bancarios del proveedor.',
  provider_create_role_required: 'No tienes permiso para crear proveedores.',
  provider_update_role_required: 'No tienes permiso para actualizar proveedores.',
  provider_payload_contains_unsupported_fields:
    'El formulario contiene campos no admitidos. Actualiza la pagina e intentalo nuevamente.',
  provider_rpc_response_invalid:
    'El proveedor se guardo sin una confirmacion valida. Actualiza el catalogo antes de reintentar.',
})

export function providerSaveErrorCode(error: any): string {
  const candidates = [error?.message, error?.details, error?.hint, error?.code]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean)
  const knownCode = Object.keys(PROVIDER_SAVE_ERROR_MESSAGES).find((code) =>
    candidates.some((c) => c.includes(code)),
  )
  if (knownCode) return knownCode
  const transportCode = candidates.find((c) => /^pgrst\d{3}$/.test(c) || /^[0-9a-z]{5}$/.test(c))
  return transportCode || 'unclassified_save_error'
}

export function messageForSaveError(error: any): string {
  const code = providerSaveErrorCode(error)
  return (
    PROVIDER_SAVE_ERROR_MESSAGES[code] ||
    'No fue posible guardar el proveedor. Verifica la informacion e intentalo nuevamente.'
  )
}
