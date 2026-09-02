// Tipos de la sección Reportes.

// ── Costo por proyecto ───────────────────────────────────────────
export type ProjectRow = {
  id: string
  name: string
  description: string | null
  active: boolean
}

// Solicitud etiquetada con un proyecto. Es un subconjunto de payment_requests:
// solo lo que el reporte necesita listar y sumar.
export type TaggedRequest = {
  id: string
  request_number: string | null
  project_id: string
  amount_requested: number | null
  status: string | null
  created_at: string | null
  proveedor_id: string | null
  beneficiary_profile_id: string | null
}

export type ProjectCostData = {
  projects: ProjectRow[]
  requests: TaggedRequest[]
  // Nombre a mostrar en la columna "Proveedor / Beneficiario", por id.
  proveedorNames: Map<string, string>
  profileNames: Map<string, string>
}

export type ProjectTotals = {
  requested: number
  approved: number
  paid: number
  count: number
}
