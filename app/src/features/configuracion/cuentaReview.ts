// Cola de revisión de cuentas contables (paso de export CONTPAQ).
//
// Perfilamiento proveedor→cuenta de gasto: para cada proveedor del lote a
// exportar resuelve una cuenta contable SUGERIDA con esta precedencia y la
// clasifica en dos cubetas (segura / a revisar):
//
//   🟢 Segura – confirmada: existe fila en provider_account_mappings para
//      (empresa, proveedor) → esa cuenta es autoritativa.
//   🟢 Segura – sugerida por historial: sin mapping confirmado, pero el
//      proveedor tiene RFC y hay partida_predictions con is_confident=true →
//      se usa cuenta_gasto_dominante (señal más confiable que la partida).
//   🟡 A revisar: cualquier otro caso — sin RFC, sin match, o match con
//      is_confident=false (baja confianza). Con dominante de baja confianza se
//      pre-carga como valor tentativo (amarillo); si no, el campo va vacío y
//      Finanzas debe capturarla.
//
// Módulo PURO y testeable: sin DB, sin React. La UI (ExportarSection) le pasa
// los mapeos + predicciones ya cargados y las ediciones locales de Finanzas.
import type { PaidRequestRow } from './types'

export type CuentaReviewOrigen = 'confirmada' | 'sugerida' | 'sugerida_baja' | 'sin_dato'
export type CuentaReviewBucket = 'segura' | 'revisar'

export type CuentaReviewRow = {
  proveedorId: string
  nombre: string
  rfc: string | null
  // Cuenta EFECTIVA: edición local de Finanzas si la hay, si no la resuelta por
  // precedencia. Es exactamente lo que se usará en el export (ver override).
  cuenta: string
  origen: CuentaReviewOrigen
  bucket: CuentaReviewBucket
  // Texto de origen/confianza para la UI ("Historial 100% · 45 facturas").
  detalle: string
  // Ya hay (o se acaba de crear) un mapping confirmado para este proveedor.
  confirmada: boolean
  // Cuántas solicitudes del lote pertenecen a este proveedor.
  nSolicitudes: number
}

export type ProviderMappingLite = { code: string | null; terceroId: string | null }
export type PartidaPredictionLite = {
  cuentaDominante: string | null
  share: number | null
  nCfdis: number | null
  confident: boolean
}

/** RFC normalizado (upper + trim) para casar con partida_predictions. */
export function normalizarRfc(rfc: string | null | undefined): string {
  return (rfc ?? '').trim().toUpperCase()
}

function pctTxt(share: number | null): string {
  if (share === null || Number.isNaN(share)) return '—'
  return `${Math.round(share * 100)}%`
}

export type ConstruirReviewOpts = {
  providerMappings: Map<string, ProviderMappingLite> // proveedor_id → mapping
  predictions: Map<string, PartidaPredictionLite> // rfc normalizado → predicción
  // Ediciones locales de Finanzas (proveedor_id → cuenta tecleada) y proveedores
  // confirmados en la sesión (aún sin recargar de DB).
  edits: Map<string, string>
  confirmados: Set<string>
  // Fallback de nombre cuando la solicitud no trae el proveedor anidado.
  nombreProveedor?: Map<string, string>
}

/**
 * Construye la cola de revisión: una fila por proveedor ÚNICO del lote (keyed
 * por proveedor_id, que es la columna que casa con provider_account_mappings).
 * Las solicitudes sin proveedor_id (solo provider_id → tabla providers legacy)
 * no entran a la cola: caen al mapeo por partida existente.
 */
export function construirReview(rows: PaidRequestRow[], opts: ConstruirReviewOpts): CuentaReviewRow[] {
  const porProveedor = new Map<string, { rfc: string | null; nombre: string; n: number }>()
  for (const r of rows) {
    const pid = r.proveedor_id
    if (!pid) continue
    const prev = porProveedor.get(pid)
    if (prev) {
      prev.n += 1
      if (!prev.rfc && r.proveedores?.rfc) prev.rfc = r.proveedores.rfc
    } else {
      porProveedor.set(pid, {
        rfc: r.proveedores?.rfc ?? null,
        nombre: r.proveedores?.nombre_completo ?? opts.nombreProveedor?.get(pid) ?? pid,
        n: 1,
      })
    }
  }

  const review: CuentaReviewRow[] = []
  for (const [pid, info] of porProveedor) {
    const mapping = opts.providerMappings.get(pid)
    const pred = info.rfc ? opts.predictions.get(normalizarRfc(info.rfc)) : undefined
    const edited = opts.edits.get(pid)
    const confirmadoSesion = opts.confirmados.has(pid)
    const tieneMappingDb = Boolean(mapping?.code)

    let origen: CuentaReviewOrigen
    let cuenta: string
    let detalle: string

    if (confirmadoSesion || tieneMappingDb) {
      origen = 'confirmada'
      cuenta = edited ?? mapping?.code ?? ''
      detalle = 'Confirmada'
    } else if (pred?.confident && pred.cuentaDominante) {
      origen = 'sugerida'
      cuenta = edited ?? pred.cuentaDominante
      detalle = `Historial ${pctTxt(pred.share)} · ${pred.nCfdis ?? 0} facturas`
    } else if (pred?.cuentaDominante) {
      origen = 'sugerida_baja'
      cuenta = edited ?? pred.cuentaDominante
      detalle = `Baja confianza ${pctTxt(pred.share)} · ${pred.nCfdis ?? 0} facturas`
    } else {
      origen = 'sin_dato'
      cuenta = edited ?? ''
      detalle = info.rfc ? 'Sin historial' : 'Sin RFC'
    }

    const bucket: CuentaReviewBucket = origen === 'confirmada' || origen === 'sugerida' ? 'segura' : 'revisar'
    review.push({
      proveedorId: pid,
      nombre: info.nombre,
      rfc: info.rfc,
      cuenta,
      origen,
      bucket,
      detalle,
      confirmada: origen === 'confirmada',
      nSolicitudes: info.n,
    })
  }

  // A revisar primero (lo accionable arriba), luego por nombre.
  review.sort((a, b) =>
    a.bucket === b.bucket ? a.nombre.localeCompare(b.nombre) : a.bucket === 'revisar' ? -1 : 1,
  )
  return review
}

/**
 * Mapa proveedor_id → cuenta efectiva para el override del pipeline de export.
 * Solo incluye proveedores con cuenta resuelta (no vacía): así el export usa
 * EXACTAMENTE la cuenta que Finanzas ve en la cola de revisión.
 */
export function overrideDesdeReview(review: CuentaReviewRow[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of review) {
    const c = r.cuenta.trim()
    if (c) m.set(r.proveedorId, c)
  }
  return m
}

/** Proveedores 🟡 (a revisar) sin confirmar — para la advertencia del export. */
export function pendientesDeRevision(review: CuentaReviewRow[]): CuentaReviewRow[] {
  return review.filter((r) => r.bucket === 'revisar')
}
