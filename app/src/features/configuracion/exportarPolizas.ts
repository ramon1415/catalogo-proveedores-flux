// FB-7 · Pipeline de export contable: pagos pagados → pólizas CONTPAQ.
//
// Todo el motor viene vendorizado de flux-contpaq-export (certificado con
// golden tests); aquí solo se orquesta: contrato → asientos → póliza (+ bloque
// fiscal si hay CFDI) → layout → .xls → ledger. Los tipos del barrel
// (export.d.ts) son laxos y en algunos casos no coinciden con la firma real
// del JS, así que este módulo declara las firmas REALES (verificadas contra el
// JS vendorizado) y castea una sola vez — no se toca el motor.
import * as XLSX from 'xlsx'
// Import con extensión .js explícita: bundler (tsc/Vite) lo resuelve al barrel
// vendorizado y, además, permite cargar este módulo bajo `node --test` (ESM de
// Node exige extensión en specifiers relativos).
import * as motor from '../../lib/contpaq/export.js'
import type { MapeoEmpresa } from '../../lib/contpaq/export.js'
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
  opts?: { hashFn?: (t: string) => string; kind?: 'provision' | 'pago' | 'directo' },
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
  // Modo dos-pólizas: filas separadas por tipo de póliza, para descargar el
  // layout de diario (provisiones) y el de pago (egresos) en archivos aparte.
  // null cuando ese tipo no tiene pólizas en el lote. En egreso-directo van undefined.
  filasDiario?: unknown[][] | null
  filasPago?: unknown[][] | null
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

// ════════════════════════════════════════════════════════════════════════
// MODO DOS-PÓLIZAS (provisión + pago) — ADITIVO, no toca el egreso-directo.
//
// Reproduce fielmente el ciclo REAL de Operadora para facturas de proveedor
// SIN retención (ver docs/contpaq/ciclo_polizas_operadora.md):
//
//   Provisión (diario, tipoPol 3, fecha = fecha de factura):
//     CARGO  gasto (por partida, base)                    ← distribucion
//     CARGO  IVA acreditable PENDIENTE (11901…)           ← impuesto.ivaAcreditablePendiente
//     ABONO  proveedor por pagar (201012xx) por el BRUTO  ← proveedor[businessId].cuenta
//   Pago (egreso, tipoPol 2, fecha = fecha de pago):
//     CARGO  proveedor por pagar (mismo bruto)
//     CARGO  IVA acreditable PAGADO (11801…)   ← traspaso por flujo (si hay IVA)
//     ABONO  banco (mismo bruto)
//     ABONO  IVA acreditable PENDIENTE (11901…) ← traspaso por flujo (si hay IVA)
//   (el traspaso IVA pendiente→pagado se reconoce EN CADA PAGO, verificado en
//    pólizas reales jul/ago 2026; sin IVA el pago es sólo proveedor→banco.)
//
// DECISIÓN (fiel a los datos reales): una factura CON retención
// (honorarios / persona física) NO se parte en dos — se mantiene en
// egreso-directo (una sola póliza), tal como hoy. El combo
// dos-pólizas-con-retención no está atestiguado en la contabilidad de
// Operadora, así que aquí una factura con retención de IVA/ISR se enruta a la
// MISMA lógica de egreso-directo (resolverAsientos + resolverFiscal).
// Una solicitud SIN CFDI tampoco se provisiona (no hay factura que
// provisionar) → egreso-directo.
//
// IVA por flujo: al provisionar queda en 11901 (pendiente) y al pagar se
// traspasa a 11801 (acreditable) dentro de la póliza de pago. Esta regla fue
// confirmada contra pólizas reales de Operadora de junio/julio.
// ════════════════════════════════════════════════════════════════════════

export type ModoPoliza = 'egreso-directo' | 'dos-polizas'

/** Una póliza a construir dentro de un pago: etapa, tipo, fecha y asientos. */
export type PolizaPlan = {
  tipo: 'egreso' | 'diario'
  kind: 'directo' | 'provision' | 'pago'
  fecha: string
  concepto: string
  asientos: Asiento[]
  fiscales: RegistrosFiscales | null
}

/** Resultado listo del modo dos-pólizas: 1 o 2 pólizas planificadas por pago. */
export type PagoListoDos = {
  row: PaidRequestRow
  contrato: ContratoCanonico
  monto: number
  // 'dos-polizas' → [provisión (diario), pago (egreso)];
  // 'directo'     → [egreso único] (factura con retención, o pago sin CFDI).
  ruta: 'dos-polizas' | 'directo'
  polizas: PolizaPlan[]
}

export type ResultadoPipelineDos = {
  listos: PagoListoDos[]
  problemas: PagoProblema[]
  yaExportados: PaidRequestRow[]
}

// Claves SAT (mismas que resolver.js).
const SAT_ISR = '001'
const SAT_IVA = '002'

/** Centavos enteros (misma regla que validate.js / resolver.js). */
function cent(importe: number): number {
  return Math.round((Number(importe) || 0) * 100)
}

type ImpuestosCent = {
  ivaTrasladoCent: number
  retIvaCent: number
  retIsrCent: number
  // Mensaje si el CFDI trae un impuesto que el resolver no soporta (IEPS…):
  // igual que resolver.js, preferimos tronar claro a contabilizar mal.
  noSoportado: string | null
}

/**
 * Suma los impuestos del CFDI en centavos, separados por clave SAT — misma
 * semántica que impuestosCfdi() del resolver, replicada en la capa app porque
 * el resolver no la exporta y la provisión (diario) no pasa por resolverAsientos
 * (que solo soporta 'egreso').
 */
function impuestosDeCfdi(cfdi: Record<string, unknown> | undefined): ImpuestosCent {
  const imp = (cfdi?.impuestos ?? {}) as {
    traslados?: Array<Record<string, unknown>>
    retenciones?: Array<Record<string, unknown>>
  }
  let ivaTrasladoCent = 0
  let retIvaCent = 0
  let retIsrCent = 0
  let noSoportado: string | null = null
  for (const t of imp.traslados ?? []) {
    const c = cent(Number(t.importe ?? 0))
    if (t.impuesto === SAT_IVA) ivaTrasladoCent += c
    else if (c !== 0) noSoportado = `CFDI con traslado no soportado "${String(t.impuesto)}" (este modo solo maneja IVA 002).`
  }
  for (const r of imp.retenciones ?? []) {
    const c = cent(Number(r.importe ?? 0))
    if (r.impuesto === SAT_IVA) retIvaCent += c
    else if (r.impuesto === SAT_ISR) retIsrCent += c
    else if (c !== 0) noSoportado = `CFDI con retención no soportada "${String(r.impuesto)}" (este modo solo maneja IVA 002 / ISR 001).`
  }
  return { ivaTrasladoCent, retIvaCent, retIsrCent, noSoportado }
}

/**
 * Planifica las DOS pólizas (provisión + pago) de una factura SIN retención.
 * Cuadra POR CONSTRUCCIÓN: el bruto (base + IVA) se calcula una sola vez y se
 * usa idéntico en el abono proveedor (provisión) y en el cargo/abono del pago,
 * todo en centavos enteros.
 *
 * Junta TODOS los faltantes de mapeo (partida / impuesto:ivaAcreditablePendiente
 * / proveedor / banco) en una pasada, igual que resolverAsientos.
 */
function planProvisionYPago(
  contrato: ContratoCanonico,
  mapeoRow: MapeoEmpresa,
  imp: ImpuestosCent,
): { polizas: PolizaPlan[] | null; faltantes: string[]; error: string | null } {
  const faltantes: string[] = []
  const referencia = contrato.control.referencia
  const concepto = contrato.control.concepto
  const fechaFactura = contrato.control.fechaFactura
  const fechaPago = contrato.control.fechaPago
  if (!fechaFactura) {
    return { polizas: null, faltantes, error: 'Factura sin fecha (cfdi.comprobante.fecha) — la provisión no se puede fechar.' }
  }
  const mk = (cuenta: string | undefined, tipoMovto: 'cargo' | 'abono', importeCent: number): Asiento => ({
    cuenta: cuenta as string,
    tipoMovto,
    importe: importeCent / 100,
    referencia,
    concepto,
  })

  // ── Provisión (diario) ──
  const asientosProvision: Asiento[] = []
  let baseCent = 0
  for (const linea of contrato.distribucion) {
    const l = linea as { partidaId?: unknown; importeBase?: unknown }
    const cuenta = mapeoRow.partida?.[String(l.partidaId)]
    if (!cuenta) faltantes.push(`partida:${String(l.partidaId)}`)
    const c = cent(Number(l.importeBase))
    baseCent += c
    asientosProvision.push(mk(cuenta, 'cargo', c))
  }
  if (imp.ivaTrasladoCent > 0) {
    const cuentaIva = mapeoRow.impuesto?.ivaAcreditablePendiente
    if (!cuentaIva) faltantes.push('impuesto:ivaAcreditablePendiente')
    asientosProvision.push(mk(cuentaIva, 'cargo', imp.ivaTrasladoCent))
  }
  const businessId = (contrato.contraparte as { businessId?: unknown })?.businessId
  const prov = businessId != null ? mapeoRow.proveedor?.[String(businessId)] : undefined
  if (!prov?.cuenta) faltantes.push(`proveedor:${businessId ?? '?'}`)
  const brutoCent = baseCent + imp.ivaTrasladoCent
  asientosProvision.push(mk(prov?.cuenta, 'abono', brutoCent))

  // ── Pago (egreso) ──
  // Verificado en pólizas reales de Operadora jul/ago 2026: además de
  // proveedor→banco, el pago mueve el IVA de "acreditable pendiente/por
  // acreditar" (11901…, impuesto.ivaAcreditablePendiente) a "acreditable
  // pagado" (11801…, impuesto.ivaAcreditablePagado). El traspaso por flujo se
  // reconoce EN CADA PAGO (no mensual). Sin IVA, el pago es sólo proveedor→banco.
  const cuentaOrigenId = (contrato.efectivo as { cuentaOrigenId?: unknown } | undefined)?.cuentaOrigenId
  const cuentaBanco = mapeoRow.banco?.[String(cuentaOrigenId)]
  if (!cuentaBanco) faltantes.push(`banco:${String(cuentaOrigenId)}`)
  const asientosPago: Asiento[] = [mk(prov?.cuenta, 'cargo', brutoCent)]
  if (imp.ivaTrasladoCent > 0) {
    const cuentaIvaPagado = mapeoRow.impuesto?.ivaAcreditablePagado
    if (!cuentaIvaPagado) faltantes.push('impuesto:ivaAcreditablePagado')
    asientosPago.push(mk(cuentaIvaPagado, 'cargo', imp.ivaTrasladoCent))
  }
  asientosPago.push(mk(cuentaBanco, 'abono', brutoCent))
  if (imp.ivaTrasladoCent > 0) {
    // ivaAcreditablePendiente ya se validó como faltante en la provisión.
    asientosPago.push(mk(mapeoRow.impuesto?.ivaAcreditablePendiente, 'abono', imp.ivaTrasladoCent))
  }

  if (faltantes.length > 0) return { polizas: null, faltantes, error: null }

  const polizas: PolizaPlan[] = [
    { tipo: 'diario', kind: 'provision', fecha: fechaFactura, concepto, asientos: asientosProvision, fiscales: null },
    { tipo: 'egreso', kind: 'pago', fecha: fechaPago!, concepto, asientos: asientosPago, fiscales: null },
  ]
  return { polizas, faltantes, error: null }
}

/**
 * Pipeline del modo DOS-PÓLIZAS (paralelo a procesarPagos, sin escribir nada).
 * Enruta cada pago:
 *  - factura SIN retención (con CFDI) → provisión (diario) + pago (egreso);
 *  - factura CON retención / pago SIN CFDI → egreso-directo (una póliza),
 *    reutilizando resolverAsientos + resolverFiscal — comportamiento idéntico
 *    al modo por default.
 * `providerAccounts` funciona igual que en procesarPagos (override
 * proveedor→cuenta de gasto de la cola de revisión).
 */
export function procesarPagosDosPolizas(
  rows: PaidRequestRow[],
  mapeo: MapeoEmpresa,
  config: EmpresaConfigReal,
  exportadosIds: Set<string>,
  providerAccounts?: Map<string, string>,
): ResultadoPipelineDos {
  const listos: PagoListoDos[] = []
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

    const cuentaProveedor = row.proveedor_id ? providerAccounts?.get(row.proveedor_id) : undefined
    const mapeoRow: MapeoEmpresa = cuentaProveedor
      ? { ...mapeo, partida: { ...mapeo.partida, [String(row.budget_category_id)]: cuentaProveedor } }
      : mapeo

    let contrato: ContratoCanonico
    try {
      contrato = paymentRequestAContrato({
        ...row,
        amount_requested: Number(row.amount_requested),
        exchange_rate: row.exchange_rate === null || row.exchange_rate === undefined ? undefined : Number(row.exchange_rate),
        proveedor: row.proveedores ?? undefined,
        cfdiParseado: row.cfdi_data ?? undefined,
      })
    } catch (err: unknown) {
      const detalles = (err as { detalles?: string[] }).detalles ?? []
      problemas.push({ row, kind: 'datos', faltantes: [], mensaje: detalles.length ? detalles.join(' · ') : String((err as Error).message ?? err) })
      continue
    }

    const imp = impuestosDeCfdi(contrato.cfdi)
    if (imp.noSoportado) {
      problemas.push({ row, kind: 'datos', faltantes: [], mensaje: imp.noSoportado })
      continue
    }
    const conRetencion = imp.retIvaCent > 0 || imp.retIsrCent > 0
    const tieneFactura = Boolean(contrato.cfdi)

    if (!tieneFactura || conRetencion) {
      // Ruta EGRESO-DIRECTO: reutiliza el motor certificado tal cual.
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
        listos.push({
          row,
          contrato,
          monto: Number(row.amount_requested) || 0,
          ruta: 'directo',
          polizas: [{ tipo: 'egreso', kind: 'directo', fecha: contrato.control.fechaPago!, concepto: contrato.control.concepto, asientos: asientos!, fiscales }],
        })
      }
      continue
    }

    // Ruta DOS-PÓLIZAS: factura sin retención → provisión + pago.
    const plan = planProvisionYPago(contrato, mapeoRow, imp)
    if (plan.error) {
      problemas.push({ row, kind: 'datos', faltantes: plan.faltantes, mensaje: plan.error })
    } else if (plan.faltantes.length > 0) {
      problemas.push({ row, kind: 'mapeo', faltantes: plan.faltantes, mensaje: `${plan.faltantes.length} mapeo(s) sin asignar.` })
    } else {
      listos.push({ row, contrato, monto: Number(row.amount_requested) || 0, ruta: 'dos-polizas', polizas: plan.polizas! })
    }
  }

  return { listos, problemas, yaExportados }
}

/**
 * Construye las pólizas finales del modo dos-pólizas + las filas del ledger.
 * Asigna folio de tipo DIARIO a la provisión (fecha de factura) y de tipo
 * EGRESO al pago (fecha de pago) con el mismo folio provider (reinicio mensual,
 * consecutivo por tipo). Cada póliza lleva su source_kind ('provision' | 'pago'
 * | 'directo') en el ledger, para la idempotencia por etapa (F3).
 *
 * NOTA (scope MVP): asume que la provisión y el pago caen en el MISMO mes
 * contable que el periodo seleccionado. Una provisión con fecha de factura de
 * un mes distinto al del pago es un caso multi-periodo (folio/periodo por mes)
 * que queda como follow-up.
 */
export function generarExportDosPolizas(
  listos: PagoListoDos[],
  config: EmpresaConfigReal,
  periodo: string, // 'YYYY-MM'
  foliosPorTipo: Record<string, number>,
): ExportGenerado {
  const provider = crearFolioProvider({ estado: { ultimos: { ...foliosPorTipo }, periodo } })
  const tipoPolEgreso = config.poliza.tiposPol.egreso.tipoPol
  const diarioCfg = config.poliza.tiposPol.diario
  if (!diarioCfg) {
    throw new Error(
      `La empresa "${config.empresa}" no tiene un tipo de póliza 'diario' configurado; ` +
        'es requerido para la provisión del modo dos-pólizas.',
    )
  }
  const tipoPolDiario = diarioCfg.tipoPol

  const polizas: PolizaConstruida[] = [] // todas, en orden original (provisión→pago por pago)
  const polizasDiario: PolizaConstruida[] = [] // solo provisiones (para el archivo de diario)
  const polizasPago: PolizaConstruida[] = [] // solo egresos (para el archivo de pago)
  const ledgerRows: AccountingExportInsert[] = []
  for (const p of listos) {
    for (const plan of p.polizas) {
      const tipoPol = plan.tipo === 'diario' ? tipoPolDiario : tipoPolEgreso
      const folio = provider.asignarFolio(tipoPol, plan.fecha)
      // buildPoliza valida estructura Y cuadre (tolerancia 0): truena antes de
      // tocar archivo o ledger si alguna póliza descuadra.
      const base = buildPoliza(
        { tipo: plan.tipo, fecha: plan.fecha, folio, concepto: plan.concepto, asientos: plan.asientos },
        config,
      )
      const poliza = plan.fiscales ? armarPolizaFiscal(base, plan.fiscales) : base
      polizas.push(poliza)
      if (plan.tipo === 'diario') polizasDiario.push(poliza)
      else polizasPago.push(poliza)

      const registro = planRegistro(p.contrato, poliza, { hashFn: motor.sha256Sync, kind: plan.kind })
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
  }

  // renderLayout incluye la leyenda; cada archivo se renderiza sobre su propio
  // subconjunto para que diario y pago sean layouts CONTPAQ independientes.
  return {
    filas: renderLayout(polizas, config),
    filasDiario: polizasDiario.length ? renderLayout(polizasDiario, config) : null,
    filasPago: polizasPago.length ? renderLayout(polizasPago, config) : null,
    ledgerRows,
  }
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
export function nombreArchivoExport(empresaNombre: string, mes: string, sufijo = ''): string {
  const slug = empresaNombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `polizas_${slug || 'empresa'}_${mes}${sufijo}.xls`
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
