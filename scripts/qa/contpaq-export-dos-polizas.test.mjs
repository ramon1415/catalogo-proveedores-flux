// Modo DOS-PÓLIZAS (provisión + pago) del export contable a CONTPAQ.
//
// Valida, contra el ciclo REAL de Operadora
// (docs/contpaq/ciclo_polizas_operadora.md), que:
//  1. Una factura de proveedor SIN retención genera DOS pólizas
//     (provisión diario + pago egreso), ambas CUADRADAS (cargos==abonos,
//     tolerancia 0 en centavos).
//  2. La provisión usa gasto (por partida, base) + IVA acreditable PENDIENTE
//     (11901…) + proveedor por pagar (bruto = base + IVA); el pago usa
//     proveedor por pagar (bruto) → banco (bruto).
//  3. Una factura CON retención (honorarios/PF) sigue generando UNA sola
//     póliza de egreso (egreso-directo INTACTO), en ambos modos.
//
// Corre con `node --test`. Importa el pipeline TS real (Node 24 hace type
// stripping); exportarPolizas.ts importa el barrel vendorizado con extensión
// .js explícita para resolver bajo ESM de Node.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  procesarPagos,
  procesarPagosDosPolizas,
  generarExport,
  generarExportDosPolizas,
} from '../../app/src/features/configuracion/exportarPolizas.ts'
import { operadoraConfig } from '../../app/src/lib/contpaq/serializer/configs/operadora.js'

// ── Fixtures ────────────────────────────────────────────────────────────
// Cuentas de 11 dígitos (Operadora) con nombres reales del catálogo.
const CTA = {
  gasto: '601-01-000-000', //            → 60101000000 gasto por partida
  ivaPendiente: '119-01-100-000', //     → 11901100000 IVA acreditable Pendiente
  ivaPagado: '118-01-100-000', //        → 11801100000 IVA Acreditable Pagado
  ivaRetAcred: '118-05-100-000', //      → 11805100000 IVA retenido acreditable
  proveedor: '201-01-200-100', //        → 20101200100 proveedor por pagar
  banco: '102-01-100-000', //            → 10201100000 BBVA
  retIvaPasivo: '213-08-000-000', //     → 21308000000 IVA Retenido
  retIsrPasivo: '213-09-000-000', //     → 21309000000 ISR Retenido
}

const mapeo = {
  partida: { 'cat-1': CTA.gasto },
  banco: { 'bank-1': CTA.banco },
  proveedor: { 'prov-1': { cuenta: CTA.proveedor, idProveedor: 500 } },
  impuesto: {
    ivaAcreditablePagado: CTA.ivaPagado,
    ivaAcreditablePendiente: CTA.ivaPendiente,
    ivaRetenidoAcreditable: CTA.ivaRetAcred,
    retIvaPasivo: CTA.retIvaPasivo,
    retIsrPasivo: CTA.retIsrPasivo,
  },
}

// Factura de ejemplo: base 80,161 + IVA 16% = 12,825.76 → bruto 92,986.76.
const BASE = 80161
const IVA = 12825.76
const BRUTO = BASE + IVA // 92986.76

function rowBase(overrides = {}) {
  return {
    id: 'pr-1',
    company_id: 'op',
    provider_id: 'prov-1',
    proveedor_id: 'prov-1',
    budget_category_id: 'cat-1',
    cost_center_id: null,
    company_bank_account_id: 'bank-1',
    amount_requested: BRUTO,
    currency: 'MXN',
    exchange_rate: 1,
    concept: 'Servicios junio 2026',
    description: null,
    request_number: 'REQ-1',
    paid_at: '2026-06-20',
    payment_method: 'transfer',
    proveedores: { rfc: 'AAA010101AAA', nombre_completo: 'Proveedor SA de CV', persona_tipo: 'moral' },
    ...overrides,
  }
}

// CFDI SIN retención (factura de empresa).
const cfdiSinRet = {
  uuid: 'UUID-SIN-RET-0001',
  // Total CFDI = subtotal + IVA (sin retenciones).
  comprobante: { subTotal: BASE, total: BRUTO, fecha: '2026-06-15', serie: 'A', folio: '123' },
  emisor: { rfc: 'AAA010101AAA', nombre: 'Proveedor SA de CV' },
  impuestos: {
    traslados: [{ impuesto: '002', base: BASE, importe: IVA, tasaOCuota: 0.16 }],
    retenciones: [],
  },
}

// CFDI CON retención (honorarios / persona física): IVA + ret IVA + ret ISR.
const RET_IVA = 5000
const RET_ISR = 8000
const cfdiConRet = {
  uuid: 'UUID-CON-RET-0001',
  // Total CFDI = subtotal + IVA − retenciones (neto pagado).
  comprobante: { subTotal: BASE, total: BASE + IVA - RET_IVA - RET_ISR, fecha: '2026-06-15', serie: 'B', folio: '77' },
  // El emisor del CFDI debe coincidir con el RFC del proveedor de la solicitud
  // (validación del schema: en un egreso el emisor es el proveedor).
  emisor: { rfc: 'AAA010101AAA', nombre: 'Persona Física' },
  impuestos: {
    traslados: [{ impuesto: '002', base: BASE, importe: IVA, tasaOCuota: 0.16 }],
    retenciones: [
      { impuesto: '002', importe: RET_IVA },
      { impuesto: '001', importe: RET_ISR },
    ],
  },
}

const centavos = (n) => Math.round(n * 100)
function cuadre(asientos) {
  let cargos = 0
  let abonos = 0
  for (const a of asientos) {
    if (a.tipoMovto === 'cargo') cargos += centavos(a.importe)
    else abonos += centavos(a.importe)
  }
  return { cargos, abonos }
}

// ── 1. SIN retención → DOS pólizas, ambas cuadradas ──────────────────────
test('factura SIN retención → dos pólizas (provisión + pago), ambas cuadran', () => {
  const row = rowBase({ cfdi_data: cfdiSinRet })
  const res = procesarPagosDosPolizas([row], mapeo, operadoraConfig, new Set())

  assert.equal(res.problemas.length, 0, 'sin problemas de mapeo/datos')
  assert.equal(res.listos.length, 1)
  const listo = res.listos[0]
  assert.equal(listo.ruta, 'dos-polizas')
  assert.equal(listo.polizas.length, 2, 'exactamente dos pólizas')

  const [provision, pago] = listo.polizas

  // Provisión: diario, fecha de FACTURA, gasto + IVA pendiente + proveedor(bruto).
  assert.equal(provision.tipo, 'diario')
  assert.equal(provision.kind, 'provision')
  assert.equal(provision.fecha, '2026-06-15', 'provisión se fecha con la factura')
  const cargosGasto = provision.asientos.filter((a) => a.cuenta === CTA.gasto && a.tipoMovto === 'cargo')
  assert.equal(cargosGasto.length, 1)
  assert.equal(centavos(cargosGasto[0].importe), centavos(BASE), 'gasto = base')
  const cargoIva = provision.asientos.find((a) => a.cuenta === CTA.ivaPendiente)
  assert.ok(cargoIva && cargoIva.tipoMovto === 'cargo', 'IVA acreditable pendiente en cargo')
  assert.equal(centavos(cargoIva.importe), centavos(IVA), 'IVA pendiente = IVA trasladado')
  const abonoProv = provision.asientos.find((a) => a.cuenta === CTA.proveedor)
  assert.ok(abonoProv && abonoProv.tipoMovto === 'abono', 'proveedor por pagar en abono')
  assert.equal(centavos(abonoProv.importe), centavos(BRUTO), 'proveedor = bruto (base + IVA)')
  const cP = cuadre(provision.asientos)
  assert.equal(cP.cargos, cP.abonos, 'provisión cuadra en centavos (tolerancia 0)')
  assert.equal(cP.cargos, centavos(BRUTO))

  // Pago: egreso, fecha de PAGO, proveedor(bruto) → banco(bruto).
  assert.equal(pago.tipo, 'egreso')
  assert.equal(pago.kind, 'pago')
  assert.equal(pago.fecha, '2026-06-20', 'pago se fecha con la fecha de pago')
  assert.equal(pago.asientos.length, 2)
  const cargoProvPago = pago.asientos.find((a) => a.cuenta === CTA.proveedor)
  assert.ok(cargoProvPago && cargoProvPago.tipoMovto === 'cargo', 'proveedor por pagar en cargo')
  assert.equal(centavos(cargoProvPago.importe), centavos(BRUTO))
  const abonoBanco = pago.asientos.find((a) => a.cuenta === CTA.banco)
  assert.ok(abonoBanco && abonoBanco.tipoMovto === 'abono', 'banco en abono')
  assert.equal(centavos(abonoBanco.importe), centavos(BRUTO))
  const cPago = cuadre(pago.asientos)
  assert.equal(cPago.cargos, cPago.abonos, 'pago cuadra en centavos (tolerancia 0)')
  assert.equal(cPago.cargos, centavos(BRUTO))
})

// ── 2. SIN retención → generarExportDosPolizas emite 2 pólizas al ledger ──
test('SIN retención → export emite provisión (tipoPol 3) + pago (tipoPol 2) al ledger', () => {
  const row = rowBase({ cfdi_data: cfdiSinRet })
  const res = procesarPagosDosPolizas([row], mapeo, operadoraConfig, new Set())
  // buildPoliza valida cuadre con tolerancia 0: si descuadrara, esto tronaría.
  const gen = generarExportDosPolizas(res.listos, operadoraConfig, '2026-06', {})

  assert.equal(gen.ledgerRows.length, 2, 'dos filas de ledger')
  assert.deepEqual(gen.ledgerRows.map((r) => r.source_kind), ['provision', 'pago'])
  assert.deepEqual(gen.ledgerRows.map((r) => r.tipo_pol), [3, 2], 'diario=3, egreso=2')
  assert.deepEqual(gen.ledgerRows.map((r) => r.folio), [1, 1], 'folio 1 por tipo (secuencias independientes)')
  assert.deepEqual(
    gen.ledgerRows.map((r) => r.periodo),
    ['2026-06-01', '2026-06-01'],
    'periodo contable del mes',
  )
  assert.ok(Array.isArray(gen.filas) && gen.filas.length > 0, 'renderLayout produce filas')
})

// ── 3. CON retención → UNA póliza de egreso (egreso-directo intacto) ──────
test('factura CON retención sigue siendo UNA póliza de egreso en modo dos-pólizas', () => {
  const row = rowBase({ id: 'pr-2', cfdi_data: cfdiConRet, amount_requested: BRUTO - RET_IVA - RET_ISR })
  const res = procesarPagosDosPolizas([row], mapeo, operadoraConfig, new Set())

  assert.equal(res.problemas.length, 0)
  assert.equal(res.listos.length, 1)
  const listo = res.listos[0]
  assert.equal(listo.ruta, 'directo', 'con retención NO se parte en dos')
  assert.equal(listo.polizas.length, 1, 'una sola póliza')
  assert.equal(listo.polizas[0].tipo, 'egreso')
  assert.equal(listo.polizas[0].kind, 'directo')
  // Es la póliza de egreso-directo completa: lleva las retenciones en abono.
  const cuentasAbono = listo.polizas[0].asientos.filter((a) => a.tipoMovto === 'abono').map((a) => a.cuenta)
  assert.ok(cuentasAbono.includes(CTA.retIvaPasivo), 'abona ret IVA pasivo')
  assert.ok(cuentasAbono.includes(CTA.retIsrPasivo), 'abona ret ISR pasivo')
  assert.ok(cuentasAbono.includes(CTA.banco), 'abona banco (neto)')
  const c = cuadre(listo.polizas[0].asientos)
  assert.equal(c.cargos, c.abonos, 'egreso-directo cuadra')
})

// ── 4. Egreso-directo (modo default) INTACTO para la misma factura CON ret ─
test('egreso-directo (procesarPagos/generarExport) sigue produciendo UNA póliza', () => {
  const row = rowBase({ id: 'pr-3', cfdi_data: cfdiConRet, amount_requested: BRUTO - RET_IVA - RET_ISR })
  const res = procesarPagos([row], mapeo, operadoraConfig, new Set())
  assert.equal(res.problemas.length, 0)
  assert.equal(res.listos.length, 1)

  const gen = generarExport(res.listos, operadoraConfig, '2026-06', {})
  assert.equal(gen.ledgerRows.length, 1, 'una póliza')
  assert.equal(gen.ledgerRows[0].source_kind, 'directo')
  assert.equal(gen.ledgerRows[0].tipo_pol, 2, 'egreso = 2')
})

// ── 5. Falta la cuenta 11901 → se reporta como faltante de mapeo ─────────
test('SIN retención sin cuenta ivaAcreditablePendiente → faltante de mapeo accionable', () => {
  const row = rowBase({ cfdi_data: cfdiSinRet })
  const mapeoSinIvaPend = { ...mapeo, impuesto: { ...mapeo.impuesto, ivaAcreditablePendiente: undefined } }
  const res = procesarPagosDosPolizas([row], mapeoSinIvaPend, operadoraConfig, new Set())
  assert.equal(res.listos.length, 0)
  assert.equal(res.problemas.length, 1)
  assert.equal(res.problemas[0].kind, 'mapeo')
  assert.ok(
    res.problemas[0].faltantes.includes('impuesto:ivaAcreditablePendiente'),
    'reporta impuesto:ivaAcreditablePendiente',
  )
})
