// Filas de la tabla `proveedores`. Campos usados por la pantalla vanilla.
// (Generar db.types.ts con `supabase gen types` reemplazará este manual.)
export type Provider = {
  id: string
  alias: string | null
  nombre_completo: string | null
  tipo_proveedor: string | null
  metodo_pago: string | null
  tipo_cuenta: string | null
  destination_type: string | null
  beneficiary_name: string | null
  banco: string | null
  clabe: string | null
  cuenta_bancaria: string | null
  convenio_number: string | null
  rfc: string | null
  persona_tipo: string | null
  email: string | null
  telefono: string | null
  notas: string | null
  es_personal_eventual: boolean | null
  activo: boolean | null
  csf_file_path: string | null
  csf_uploaded_at: string | null
  csf_uploaded_by: string | null
  updated_at: string | null
}

// Payload que consume el RPC save_provider_catalog_with_payment_execution_data.
export type ProviderPayload = {
  alias: string | null
  nombre_completo: string | null
  metodo_pago: string | null
  tipo_cuenta: string | null
  destination_type: string | null
  beneficiary_name: string | null
  banco: string | null
  clabe: string | null
  cuenta_bancaria: string | null
  convenio_number: string | null
  rfc: string | null
  persona_tipo: string | null
  email: string | null
  telefono: string | null
  tipo_proveedor: string | null
  notas: string | null
  es_personal_eventual: boolean
  activo: boolean
  updated_at: string
}

export type StatusFilter = 'todos' | 'activos' | 'inactivos'
export type DestinationType = '' | 'clabe' | 'cuenta' | 'convenio'
