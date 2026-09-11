import { cieReferenceError } from '../layouts/logic'
import type { Proveedor } from './types'

export function isConvenioProvider(provider: Proveedor | null | undefined): boolean {
  return provider?.destination_type === 'convenio'
}

export function convenioConceptError(value: string): string | null {
  const concept = value.trim()
  if (!concept) return 'Captura el concepto que corresponde a este pago por convenio.'
  if (concept.length > 30) return 'El concepto CIE admite hasta 30 caracteres. Revisa el recibo; no se recorta automáticamente.'
  if (!/^[\x20-\x7e]+$/.test(concept) || concept.includes('|')) {
    return 'El concepto CIE no admite acentos, saltos de línea ni el carácter |.'
  }
  return null
}

export function convenioDataError(provider: Proveedor | null | undefined, reference: string, concept: string): string | null {
  if (!isConvenioProvider(provider) || !/^\d{6,7}$/.test((provider?.convenio_number || '').trim())) {
    return 'Selecciona un proveedor con convenio BBVA CIE registrado. Si falta, solicita a Finanzas completar el convenio en Proveedores.'
  }
  return cieReferenceError(reference, provider?.convenio_number) || convenioConceptError(concept)
}

export const CONVENIO_ERRORS: Record<string, string> = {
  convenio_company_not_authorized: 'Tu usuario no tiene acceso para solicitar pagos en esta empresa.',
  convenio_request_locked: 'Los datos CIE están vinculados a un layout o a un pago cerrado. Finanzas debe revisar ese pago antes de cambiar la referencia o el concepto.',
  convenio_provider_required: 'Selecciona un proveedor activo con convenio BBVA CIE registrado.',
  convenio_provider_changed: 'El convenio del proveedor cambió. Actualiza la página y revisa los datos del recibo antes de reenviar.',
  convenio_transfer_required: 'Los pagos de convenio se realizan por transferencia.',
  convenio_mxn_required: 'Los pagos de convenio BBVA CIE deben estar en pesos mexicanos (MXN).',
  convenio_request_type_required: 'Selecciona Convenio en el tipo de solicitud.',
  convenio_request_save_failed: 'No se guardó la solicitud. Revisa tu acceso a la empresa e inténtalo nuevamente.',
  cie_reference_required: 'La referencia CIE es obligatoria. Copia la línea de captura del recibo.',
  cie_reference_too_long: 'La referencia CIE excede 20 caracteres. Revisa el recibo; no se recorta automáticamente.',
  cie_reference_invalid: 'La referencia CIE no admite acentos, saltos de línea ni el carácter |.',
  cie_reference_cfe_requires_20_characters: 'CFE requiere la línea de captura de 20 caracteres, sin espacios. Revisa el recibo; no agregues ceros ni uses una fecha.',
  cie_concept_required: 'Captura el concepto que corresponde a este pago por convenio.',
  cie_concept_too_long: 'El concepto CIE admite hasta 30 caracteres. Revisa el recibo.',
  cie_concept_invalid: 'El concepto CIE no admite acentos, saltos de línea ni el carácter |.',
}
