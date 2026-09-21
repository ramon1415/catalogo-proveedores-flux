// FB-7 · Pipeline de export contable: pagos pagados → pólizas CONTPAQ.
//
// Todo el motor viene vendorizado de flux-contpaq-export (certificado con
// golden tests); aquí solo se orquesta: contrato → asientos → póliza (+ bloque
// fiscal si hay CFDI) → layout → .xls → ledger. Los tipos del barrel
// (export.d.ts) son laxos y en algunos casos no coinciden con la firma real
// del JS, así que este módulo declara las firmas REALES (verificadas contra el
// JS vendorizado) y castea una sola vez — no se toca el motor.
import * as XLSX from 'xlsx'
import * as motor from '../../lib/contpaq/export'
import type { MapeoEmpresa } from '../../lib/contpaq/export'
import type { AccountingExportInsert, PaidRequestRow } from './types'

// ── Firmas reales del motor (la verdad vive en el JS vendorizado) ──
export type ContratoCanonico = {
  control: {
    empresa: string
    companyId?: string
    tipo: string
    fechaFactura?: string
    fechaPago?: string
    referencia: string
    concepto: string
    idempotencyKey: string
    source: { feeder: string; id: string }
  }
  contraparte: Record<string, unknown>
  distribucion: Array<Record<string, unknown>>
  efectivo?: Record<string, unknown>
  cfdi?: Record<string, unknown>
}

type Asiento = { cuenta: string; tipoMovto: 'cargo' | 'abono'; importe: number; referencia: string; concepto: string }
type PolizaConstruida = { header: unknown[]; registros: unknown[][] }
type RegistrosFiscales = { uuid: string; is: unknown[][]; w2: unknown[]; v: unknown[]; ad: unknown[] }
type EmpresaConfigReal = {
  empresa: string
  poliza: { tiposPol: Record<string, { tipoPol: number }> }
  leyenda: unknown[][]
}
type FolioProvider = {
  asignarFolio: (tipoPol: number | string, fecha: string | number | Date) => number
  estado: { ultimos: Record<string, number>; periodo?: string }
}

const paymentRequestAContrato = motor.paymentRequestAContrato as unknown as (
  row: Record<string, unknown>,
  opts?: { empresa?: string },
) => ContratoCanonico
const resolverAsientos = motor.resolverAsientos as unknown as (
  contrato: ContratoCanonico,
  mapeo: MapeoEmpresa,
) => Asiento[]
const resolverFiscal = motor.resolverFiscal as unknown as (
  contrato: ContratoCanonico,
  mapeo: MapeoEmpresa,
  opts?: { empresaConfig?: EmpresaConfigReal },
) => { registrosFiscales: RegistrosFiscales | null }
const buildPoliza = motor.buildPoliza as unknown as (
  poliza: { tipo: string; fecha: string; folio: number; concepto: string; asientos: Asiento[] },
  config: EmpresaConfigReal,
) => PolizaConstruida
const armarPolizaFiscal = motor.armarPolizaFiscal as unknown as (
  poliza: PolizaConstruida,
  fiscales: RegistrosFiscales,
) => PolizaConstruida
const renderLayout = motor.renderLayout as unknown as (
  polizas: PolizaConstruida[],
  config: EmpresaConfigReal,
) => unknown[][]
const crearFolioProvider = motor.crearFolioProvider as unknown as (config?: {
  estado?: { ultimos?: Record<string, number>; periodo?: string }
}) => FolioProvider
const planRegistro = motor.planRegistro as unknown as (
  contrato: ContratoCanonico,
  poliza: PolizaConstruida,
  opts?: { hashFn?: (t: string) => string },
) => AccountingExportInsert & { exported_at: string | null; cancelled_at: null; reversal_of: null }

// ── Config certificada por empresa (solo estas dos tienen golden test) ──
const OPERADORA_ID = '9680353c-9b86-4730-82e1-fce664f048a2'
const SOPORTE_FERSANA_ID = '68b61801-74c0-44ea-a33b-f20e4bf53aa7'

export function empresaConfigDe(companyId: string): EmpresaConfigReal | null {
  if (companyId === OPERADORA_ID) return motor.operadoraConfig as unknown as EmpresaConfigReal
  if (companyId === SOPORTE_FERSANA_ID) return motor.soporteFersanaConfig as unknown as EmpresaConfigReal
  return null
}

// ── Resultado del pipeline (previsualizar y exportar comparten esto) ──
export type PagoListo = {
  row: PaidRequestRow
  contrato: ContratoCanonico
  asientos: Asiento[]
  fiscales: RegistrosFiscales | null
  monto: number
}

export type PagoProblema = {
  row: PaidRequestRow
  // 'mapeo' = faltan cuentas asignadas (accionable en las otras secciones);
  // 'datos' = la fila no alcanza para un contrato/póliza válida.
  kind: 'mapeo' | 'datos'
  faltantes: string[]
  mensaje: string
}

export type ResultadoPipeline = {
  listos: PagoListo[]
  problemas: PagoProblema[]
  yaExportados: PaidRequestRow[]
}

/**
 * Corre el pipeline SIN escribir nada: clasifica cada pago del mes en
 * ya-exportado / listo / con problema, juntando TODOS los faltantes de mapeo
 * (resolverAsientos + resolverFiscal) para que el arreglo sea de una pasada.
 *
 * `providerAccounts` (opcional, proveedor_id → cuenta de gasto) es el override
 * de la cola de revisión de cuentas: cuando un proveedor del lote tiene cuenta
 * resuelta/confirmada, su(s) línea(s) de gasto se cargan a ESA cuenta en vez de
 * la del mapeo por partida. Así el export usa exactamente lo que Finanzas ve en
 * la cola. Solo cambia el CÓDIGO de cuenta del cargo (los importes no), así que
 * la póliza sigue cuadrando por construcción. Sin override → comportamiento
 * idéntico al mapeo por partida (retrocompatible).
 */
export function procesarPagos(
  rows: PaidRequestRow[],
  mapeo: MapeoEmpresa,
  config: EmpresaConfigReal,
  exportadosIds: Set<string>,
  providerAccounts?: Map<string, string>,
): ResultadoPipeline {
  const listos: PagoListo[] = []
  const problemas: PagoProblema[] = []
  const yaExportados: PaidRequestRow[] = []

  for (const row of rows) {
    if (exportadosIds.has(row.id)) {
      yaExportados.push(row)
      continue
    }
    if (!row.paid_at) {
      problemas.push({ row, kind: 'datos', faltantes: [], mensaje: 'Pago sin fecha de pago (paid_at) — no se puede fechar la póliza.' })
      continue
    }

    // Override proveedor→cuenta de la cola de revisión: la solicitud tiene UNA
    // línea de distribución cuya partidaId = budget_category_id; se reemplaza su
    // cuenta de gasto por la del proveedor cuando existe. Se clona el mapeo por
    // fila para no mutar el compartido.
    const cuentaProveedor = row.proveedor_id ? providerAccounts?.get(row.proveedor_id) : undefined
    const mapeoRow: MapeoEmpresa = cuentaProveedor
      ? { ...mapeo, partida: { ...mapeo.partida, [String(row.budget_category_id)]: cuentaProveedor } }
      : mapeo

    let contrato: ContratoCanonico
    try {
      // El adapter espera números (numeric llega como string de supabase) y
      // el proveedor anidado bajo la llave `proveedor`.
      contrato = paymentRequestAContrato({
        ...row,
        amount_requested: Number(row.amount_requested),
        exchange_rate: row.exchange_rate === null || row.exchange_rate === undefined ? undefined : Number(row.exchange_rate),
        proveedor: row.proveedores ?? undefined,
        cfdiParseado: row.cfdi_data ?? undefined,
      })
    } catch (err: unknown) {
      const detalles = (err as { detalles?: string[] }).detalles ?? []
      problemas.push({
        row,
        kind: 'datos',
        faltantes: [],
        mensaje: detalles.length ? detalles.join(' · ') : String((err as Error).message ?? err),
      })
      continue
    }

    // Se corren ambos resolvers aunque el primero truene, para juntar TODOS
    // los faltantes del pago (mapeo contable + mapeo fiscal) en una pasada.
    const faltantes: string[] = []
    let otroError: string | null = null
    let asientos: Asiento[] | null = null
    let fiscales: RegistrosFiscales | null = null
    try {
      asientos = resolverAsientos(contrato, mapeoRow)
    } catch (err: unknown) {
      const f = (err as { faltantes?: string[] }).faltantes
      if (f && f.length) faltantes.push(...f)
      else otroError = String((err as Error).message ?? err)
    }
    if (!otroError) {
      try {
        // Sin CFDI regresa registrosFiscales: null → póliza de egreso simple;
        // con CFDI arma el bloque I/W2/V/AD (decisión: la presencia de
        // cfdi_data decide si la póliza lleva registros fiscales).
        fiscales = resolverFiscal(contrato, mapeoRow, { empresaConfig: config }).registrosFiscales
      } catch (err: unknown) {
        const f = (err as { faltantes?: string[] }).faltantes
        if (f && f.length) faltantes.push(...f.filter((x) => !faltantes.includes(x)))
        else otroError = String((err as Error).message ?? err)
      }
    }

    if (otroError) {
      problemas.push({ row, kind: 'datos', faltantes, mensaje: otroError })
    } else if (faltantes.length > 0) {
      problemas.push({ row, kind: 'mapeo', faltantes, mensaje: `${faltantes.length} mapeo(s) sin asignar.` })
    } else {
      listos.push({ row, contrato, asientos: asientos!, fiscales, monto: Number(row.amount_requested) || 0 })
    }
  }

  return { listos, problemas, yaExportados }
}

export type ExportGenerado = {
  filas: unknown[][]
  ledgerRows: AccountingExportInsert[]
}

/**
 * Construye las pólizas finales con folio consecutivo + las filas del ledger.
 * No escribe nada: el caller descarga el archivo y LUEGO inserta el ledger.
 *
 * Semilla del folio: `foliosPorTipo` = max(folio) por TipoPol ya registrado
 * en accounting_exports para este periodo (incluye cancelados: un folio
 * emitido nunca se re-usa). El provider del motor continúa desde ahí con
 * reinicio mensual.
 */
export function generarExport(
  listos: PagoListo[],
  config: EmpresaConfigReal,
  periodo: string, // 'YYYY-MM'
  foliosPorTipo: Record<string, number>,
): ExportGenerado {
  const provider = crearFolioProvider({ estado: { ultimos: { ...foliosPorTipo }, periodo } })
  const tipoPolEgreso = config.poliza.tiposPol.egreso.tipoPol

  const polizas: PolizaConstruida[] = []
  const ledgerRows: AccountingExportInsert[] = []
  for (const p of listos) {
    const fecha = p.contrato.control.fechaPago!
    const folio = provider.asignarFolio(tipoPolEgreso, fecha)
    // buildPoliza valida estructura Y cuadre (tolerancia 0) — truena con
    // ValidacionError si la póliza descuadra, antes de tocar archivo o ledger.
    const base = buildPoliza(
      { tipo: 'egreso', fecha, folio, concepto: p.contrato.control.concepto, asientos: p.asientos },
      config,
    )
    const poliza = p.fiscales ? armarPolizaFiscal(base, p.fiscales) : base
    polizas.push(poliza)

    const registro = planRegistro(p.contrato, poliza, { hashFn: motor.sha256Sync })
    // Solo las columnas del insert: exported_at/cancelled_at/reversal_of los
    // pone la tabla (default now() / null).
    ledgerRows.push({
      source_feeder: registro.source_feeder,
      source_id: registro.source_id,
      source_kind: registro.source_kind,
      company_id: registro.company_id,
      tipo_pol: registro.tipo_pol,
      folio: registro.folio,
      periodo: registro.periodo,
      uuid_cfdi: registro.uuid_cfdi,
      status: registro.status,
      content_hash: registro.content_hash,
    })
  }

  return { filas: renderLayout(polizas, config), ledgerRows }
}

/** Escribe la matriz de renderLayout a un .xls (hoja 'Datos') y lo descarga. */
export function descargarXls(filas: unknown[][], nombreArchivo: string): void {
  // Celdas tal cual: las fechas ya vienen como serial de Excel (números).
  const ws = XLSX.utils.aoa_to_sheet(filas as unknown[][])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Datos')
  const out = XLSX.write(wb, { bookType: 'xls', type: 'array' }) as ArrayBuffer
  const blob = new Blob([out], { type: 'application/vnd.ms-excel' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Nombre de archivo seguro: polizas_<empresa>_<YYYY-MM>.xls */
export function nombreArchivoExport(empresaNombre: string, mes: string): string {
  const slug = empresaNombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `polizas_${slug || 'empresa'}_${mes}.xls`
}

// ── Agrupación de faltantes para la UI ──
export type FaltantesAgrupados = {
  // tipo ('partida' | 'banco' | 'proveedor' | 'impuesto' | ...) → ids únicos.
  porTipo: Map<string, Set<string>>
  total: number
}

export function agruparFaltantes(problemas: PagoProblema[]): FaltantesAgrupados {
  const porTipo = new Map<string, Set<string>>()
  let total = 0
  for (const p of problemas) {
    for (const f of p.faltantes) {
      const idx = f.indexOf(':')
      const tipo = idx > 0 ? f.slice(0, idx) : 'otro'
      const id = idx > 0 ? f.slice(idx + 1) : f
      if (!porTipo.has(tipo)) porTipo.set(tipo, new Set())
      const set = porTipo.get(tipo)!
      if (!set.has(id)) {
        set.add(id)
        total += 1
      }
    }
  }
  return { porTipo, total }
}
