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
  const digits = (value: string | null) => (value ?? '').replace(/[\s-]/g, '')
  if (payload.destination_type === 'clabe' && !/^[0-9]{18}$/.test(digits(payload.clabe))) return PROVIDER_SAVE_ERROR_MESSAGES.clabe_invalida
  if (payload.destination_type === 'cuenta' && !/^[0-9]{1,18}$/.test(digits(payload.cuenta_bancaria))) return 'Cuenta bancaria inválida: captura entre 1 y 18 dígitos; puede llevar espacios o guiones como separadores.'
  // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in bank fields.
  const invalidText = (value: string, max: number) => [...value.trim()].length > max || /[\x00-\x1f\x7f]/.test(value)
  if (invalidText(payload.banco ?? '', 100)) return 'Banco inválido: usa hasta 100 caracteres, sin saltos de línea ni caracteres de control.'
  if (invalidText(payload.beneficiary_name || payload.nombre_completo || payload.alias || '', 180)) return 'Beneficiario inválido: usa hasta 180 caracteres, sin saltos de línea ni caracteres de control.'
  if (payload.destination_type === 'convenio' && invalidText(payload.convenio_number ?? '', 30)) return 'Convenio inválido: usa hasta 30 caracteres, sin saltos de línea ni caracteres de control.'
  return ''
}

// Mensajes controlados: nunca mostrar detalles SQL ni datos de otros proveedores.
export const PROVIDER_SAVE_ERROR_MESSAGES: Record<string, string> = Object.freeze({
  "alias_duplicado": "Ya existe un proveedor con ese alias, incluso si está inactivo. Búscalo en el catálogo con el filtro Todos o Inactivos y edita o reactiva su registro.",
  "proveedores_alias_normalized_uidx": "Ya existe un proveedor con ese alias, incluso si está inactivo. Búscalo en el catálogo con el filtro Todos o Inactivos y edita o reactiva su registro.",
  "proveedores_rfc_normalized_uidx": "Ese RFC ya pertenece a otro proveedor. Busca el registro existente en el catálogo, incluidos los inactivos.",
  "proveedores_clabe_normalized_uidx": "Esa CLABE ya pertenece a otro proveedor. Revisa el registro existente antes de guardar.",
  "proveedores_bank_account_normalized_uidx": "Esa cuenta bancaria ya está registrada para ese banco en otro proveedor. Revisa el registro existente antes de guardar.",
  "rfc_invalido": "RFC inválido: captura 12 o 13 caracteres, sin espacios ni guiones.",
  "proveedores_rfc_format_check": "RFC inválido: captura 12 o 13 caracteres, sin espacios ni guiones.",
  "clabe_invalida": "CLABE inválida: debe contener exactamente 18 dígitos; puede llevar espacios o guiones como separadores.",
  "proveedores_clabe_format_check": "CLABE inválida: debe contener exactamente 18 dígitos.",
  "persona_tipo_invalido": "Selecciona un tipo de persona fiscal válido: física o moral.",
  "provider_core_fields_required": "Completa el alias, el nombre completo y el método de pago.",
  "proveedor_not_found_or_inactive": "El proveedor no existe o está inactivo. Actívalo antes de modificar sus datos bancarios.",
  "proveedor_not_found": "El proveedor ya no está disponible. Actualiza el catálogo antes de continuar.",
  "profile_inactive": "Tu perfil está inactivo. Solicita su activación al administrador.",
  "42501": "Tu usuario no tiene permiso para guardar este proveedor. Solicita que revisen tu acceso.",
  "23505": "Un dato del proveedor ya está registrado. Revisa alias, RFC, CLABE y cuenta bancaria, incluidos los proveedores inactivos.",
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
  const knownCode = Object.keys(PROVIDER_SAVE_ERROR_MESSAGES).filter((code) => !/^\d{5}$/.test(code)).find((code) =>
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

export function validateProviderRfc(rfc: string | null): string {
  if (!rfc?.trim()) return ''
  return /^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$/.test(rfc.trim().toUpperCase())
    ? '' : PROVIDER_SAVE_ERROR_MESSAGES.rfc_invalido
}
