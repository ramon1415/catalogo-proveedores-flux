// FASE 1 (backbone) · solicitud multi-partida en el export contable a CONTPAQ.
//
// Valida que:
//  1. Una solicitud con 2 líneas de distribución (payment_request_distributions)
//     genera 2 cargos de gasto (a las 2 cuentas correctas) + IVA, y la póliza
//     CUADRA (cargos == abonos, tolerancia 0 en centavos). El armado toma la
//     BASE de la suma de líneas; el IVA se sigue calculando del CFDI.
//  2. Una solicitud SIN líneas → comportamiento idéntico al actual (1 cargo de
//     gasto desde budget_category_id). Retrocompat.
//  3. El modo dos-pólizas también reparte la provisión en N líneas de gasto.
//  4. generarExport (buildPoliza valida cuadre con tolerancia 0) no truena.
//
// Corre con `node --test`. Importa el pipeline TS real (Node 24 type stripping).
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  procesarPagos,
  procesarPagosDosPolizas,
  generarExport,
} from '../../app/src/features/configuracion/exportarPolizas.ts'
import { operadoraConfig } from '../../app/src/lib/contpaq/serializer/configs/operadora.js'

// ── Fixtures ────────────────────────────────────────────────────────────
const CTA = {
  gastoA: '601-01-000-000', //   → 60101000000 gasto partida A
  gastoB: '601-02-000-000', //   → 60102000000 gasto partida B
  ivaPagado: '118-01-100-000', // IVA Acreditable Pagado
  ivaPendiente: '119-01-100-000', // IVA Acreditable Pendiente
  proveedor: '201-01-200-100', // proveedor por pagar
  banco: '102-01-100-000', //    BBVA
}

const mapeo = {
  partida: { 'cat-A': CTA.gastoA, 'cat-B': CTA.gastoB },
  banco: { 'bank-1': CTA.banco },
  proveedor: { 'prov-1': { cuenta: CTA.proveedor, idProveedor: 500 } },
  impuesto: {
    ivaAcreditablePagado: CTA.ivaPagado,
    ivaAcreditablePendiente: CTA.ivaPendiente,
  },
}

// Dos partidas: 6,000 (A) + 10,461.40 (B) = 16,461.40 subtotal.
const BASE_A = 6000
const BASE_B = 10461.4
const SUBTOTAL = BASE_A + BASE_B // 16,461.40
const IVA = Math.round(SUBTOTAL * 0.16 * 100) / 100 // 2,633.82
const TOTAL = SUBTOTAL + IVA // 19,095.22

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

// CFDI sin retención; subtotal = suma de las 2 líneas.
const cfdiSinRet = {
  uuid: 'UUID-MULTIPARTIDA-0001',
  comprobante: { subTotal: SUBTOTAL, total: TOTAL, fecha: '2026-06-15', serie: 'A', folio: '463' },
  emisor: { rfc: 'AAA010101AAA', nombre: 'Proveedor SA de CV' },
  impuestos: {
    traslados: [{ impuesto: '002', base: SUBTOTAL, importe: IVA, tasaOCuota: 0.16 }],
    retenciones: [],
  },
}

function rowBase(overrides = {}) {
  return {
    id: 'pr-mp-1',
    company_id: 'op',
    provider_id: 'prov-1',
    proveedor_id: 'prov-1',
    // budget_category_id deliberately NOT in the mapeo: prueba que, con líneas,
    // el export usa las líneas y NO esta partida.
    budget_category_id: 'cat-UNMAPPED',
    cost_center_id: null,
    company_bank_account_id: 'bank-1',
    amount_requested: TOTAL,
    currency: 'MXN',
    exchange_rate: 1,
    concept: 'Solicitud multi-partida F-463',
    description: null,
    request_number: 'F-463',
    paid_at: '2026-06-20',
    payment_method: 'transfer',
    proveedores: { rfc: 'AAA010101AAA', nombre_completo: 'Proveedor SA de CV', persona_tipo: 'moral' },
    ...overrides,
  }
}

const dosLineas = [
  { budget_category_id: 'cat-A', cost_center_id: null, amount: BASE_A },
  { budget_category_id: 'cat-B', cost_center_id: null, amount: BASE_B },
]

// ── 1. Dos líneas → 2 cargos de gasto (A y B) + IVA, cuadra ───────────────
test('multi-partida: 2 líneas → 2 cargos de gasto (A y B) + IVA, la póliza cuadra', () => {
  const row = rowBase({ cfdi_data: cfdiSinRet, payment_request_distributions: dosLineas })
  const res = procesarPagos([row], mapeo, operadoraConfig, new Set())

  assert.equal(res.problemas.length, 0, 'sin problemas de mapeo/datos')
  assert.equal(res.listos.length, 1)
  const { asientos } = res.listos[0]

  const cargosGasto = asientos.filter((a) => a.tipoMovto === 'cargo' && [CTA.gastoA, CTA.gastoB].includes(a.cuenta))
  assert.equal(cargosGasto.length, 2, 'exactamente 2 cargos de gasto')

  const cargoA = asientos.find((a) => a.cuenta === CTA.gastoA && a.tipoMovto === 'cargo')
  const cargoB = asientos.find((a) => a.cuenta === CTA.gastoB && a.tipoMovto === 'cargo')
  assert.ok(cargoA, 'cargo a cuenta A')
  assert.ok(cargoB, 'cargo a cuenta B')
  assert.equal(centavos(cargoA.importe), centavos(BASE_A), 'cargo A = 6,000')
  assert.equal(centavos(cargoB.importe), centavos(BASE_B), 'cargo B = 10,461.40')

  const cargoIva = asientos.find((a) => a.cuenta === CTA.ivaPagado && a.tipoMovto === 'cargo')
  assert.ok(cargoIva, 'IVA acreditable pagado en cargo')
  assert.equal(centavos(cargoIva.importe), centavos(IVA), 'IVA = 16% del subtotal')

  const abonoBanco = asientos.find((a) => a.cuenta === CTA.banco && a.tipoMovto === 'abono')
  assert.ok(abonoBanco, 'abono a banco')
  assert.equal(centavos(abonoBanco.importe), centavos(TOTAL), 'banco = total (sin retención)')

  const c = cuadre(asientos)
  assert.equal(c.cargos, c.abonos, 'cuadra en centavos (tolerancia 0)')
  assert.equal(c.cargos, centavos(SUBTOTAL) + centavos(IVA), 'cargos = subtotal + IVA')

  // buildPoliza revalida el cuadre con tolerancia 0: si descuadrara, tronaría.
  const gen = generarExport(res.listos, operadoraConfig, '2026-06', {})
  assert.equal(gen.ledgerRows.length, 1, 'una póliza de egreso')
  assert.equal(gen.ledgerRows[0].source_kind, 'directo')
})

// ── 2. Sin líneas → comportamiento actual (1 cargo de gasto). Retrocompat ──
test('sin líneas → 1 solo cargo de gasto desde budget_category_id (retrocompat)', () => {
  const row = rowBase({ id: 'pr-mp-2', budget_category_id: 'cat-A', cfdi_data: cfdiSinRet })
  // sin payment_request_distributions
  const res = procesarPagos([row], mapeo, operadoraConfig, new Set())

  assert.equal(res.problemas.length, 0)
  assert.equal(res.listos.length, 1)
  const { asientos } = res.listos[0]

  const cargosGasto = asientos.filter((a) => a.tipoMovto === 'cargo' && [CTA.gastoA, CTA.gastoB].includes(a.cuenta))
  assert.equal(cargosGasto.length, 1, 'un solo cargo de gasto')
  assert.equal(cargosGasto[0].cuenta, CTA.gastoA)
  assert.equal(centavos(cargosGasto[0].importe), centavos(SUBTOTAL), 'gasto = subtotal completo (una partida)')

  const c = cuadre(asientos)
  assert.equal(c.cargos, c.abonos, 'cuadra')
})

// ── 3. Array vacío → también retrocompat (usa budget_category_id) ─────────
test('líneas [] → retrocompat (no rompe, usa la única partida)', () => {
  const row = rowBase({ id: 'pr-mp-3', budget_category_id: 'cat-A', cfdi_data: cfdiSinRet, payment_request_distributions: [] })
  const res = procesarPagos([row], mapeo, operadoraConfig, new Set())
  assert.equal(res.problemas.length, 0)
  assert.equal(res.listos.length, 1)
  const cargosGasto = res.listos[0].asientos.filter(
    (a) => a.tipoMovto === 'cargo' && [CTA.gastoA, CTA.gastoB].includes(a.cuenta),
  )
  assert.equal(cargosGasto.length, 1, 'un solo cargo de gasto')
})

// ── 4. Modo dos-pólizas también reparte la provisión en N líneas ─────────
test('dos-pólizas: la provisión reparte el gasto en 2 líneas y cuadra', () => {
  const row = rowBase({ id: 'pr-mp-4', cfdi_data: cfdiSinRet, payment_request_distributions: dosLineas })
  const res = procesarPagosDosPolizas([row], mapeo, operadoraConfig, new Set())

  assert.equal(res.problemas.length, 0, 'sin problemas')
  assert.equal(res.listos.length, 1)
  const listo = res.listos[0]
  assert.equal(listo.ruta, 'dos-polizas')
  const [provision, pago] = listo.polizas

  const cargosGasto = provision.asientos.filter(
    (a) => a.tipoMovto === 'cargo' && [CTA.gastoA, CTA.gastoB].includes(a.cuenta),
  )
  assert.equal(cargosGasto.length, 2, 'provisión con 2 cargos de gasto')
  const cP = cuadre(provision.asientos)
  assert.equal(cP.cargos, cP.abonos, 'provisión cuadra')
  const cPago = cuadre(pago.asientos)
  assert.equal(cPago.cargos, cPago.abonos, 'pago cuadra')
})
