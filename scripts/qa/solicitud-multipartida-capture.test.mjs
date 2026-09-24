// FASE 2 (captura) + FASE 3 (validación por partida) · solicitud multi-partida.
//
// Prueba las funciones puras de multipartida.ts (sin imports runtime, así que
// resuelven bajo `node --test` con type stripping):
//   1. La suma de las líneas debe igualar la BASE del gasto (subtotal sin IVA):
//      cuadra → '' ; no cuadra / línea inválida / repetida → mensaje.
//   2. La partida dominante (mayor monto) es la que viaja en budget_category_id.
//   3. Validación de presupuesto por partida (FASE 3): una línea que excede el
//      disponible de SU partida se detecta; no-presupuestal / sin disponible no.
//   4. toDistributionInserts arma las filas de payment_request_distributions.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  emptyDistributionLine,
  distributionLinesTotal,
  dominantDistributionCategory,
  validateDistributionLines,
  distributionBudgetExceedances,
  toDistributionInserts,
} from '../../app/src/features/solicitudes/multipartida.ts'

function line(budgetCategoryId, amount) {
  return { ...emptyDistributionLine(budgetCategoryId, String(amount)) }
}

// ── FASE 2 · suma de líneas = base ──────────────────────────────────────────
test('suma de líneas cuadra con la base (subtotal)', () => {
  const lines = [line('cat-A', 6000), line('cat-B', 10461.4)]
  assert.equal(distributionLinesTotal(lines), 16461.4)
  assert.equal(validateDistributionLines(lines, 16461.4), '')
})

test('suma que NO cuadra con la base es inválida', () => {
  const lines = [line('cat-A', 6000), line('cat-B', 9000)]
  const err = validateDistributionLines(lines, 16461.4)
  assert.match(err, /debe igualar la base/)
})

test('tolerancia de centavos: diferencia <= 0.01 cuadra', () => {
  const lines = [line('cat-A', 5487.13), line('cat-B', 10974.27)]
  // 5487.13 + 10974.27 = 16461.40
  assert.equal(validateDistributionLines(lines, 16461.4), '')
})

test('línea sin partida / monto 0 / repetida se rechaza', () => {
  assert.match(validateDistributionLines([line('', 100)], 100), /selecciona la partida/)
  assert.match(validateDistributionLines([line('cat-A', 0)], 100), /mayor a 0/)
  assert.match(
    validateDistributionLines([line('cat-A', 50), line('cat-A', 50)], 100),
    /repetida/,
  )
})

test('base 0 (sin monto) se rechaza', () => {
  assert.match(validateDistributionLines([line('cat-A', 100)], 0), /Captura el monto/)
})

// ── partida dominante ───────────────────────────────────────────────────────
test('la partida dominante es la de mayor monto', () => {
  const lines = [line('cat-A', 6000), line('cat-B', 10461.4)]
  assert.equal(dominantDistributionCategory(lines), 'cat-B')
})

// ── FASE 3 · presupuesto por partida ────────────────────────────────────────
test('detecta la línea que excede el disponible de su partida', () => {
  const lines = [line('cat-A', 6000), line('cat-B', 10461.4)]
  const disponibles = {
    'cat-A': { available: 8000, noPresupuestal: false }, // OK
    'cat-B': { available: 5000, noPresupuestal: false }, // excede
  }
  const exceed = distributionBudgetExceedances(lines, (id) => disponibles[id] ?? null)
  assert.equal(exceed.length, 1)
  assert.equal(exceed[0].budgetCategoryId, 'cat-B')
  assert.equal(exceed[0].amount, 10461.4)
  assert.equal(exceed[0].available, 5000)
})

test('no-presupuestal y partida sin fila de disponibilidad no se marcan', () => {
  const lines = [line('cat-np', 99999), line('cat-x', 99999)]
  const resolve = (id) => (id === 'cat-np' ? { available: 0, noPresupuestal: true } : null)
  assert.deepEqual(distributionBudgetExceedances(lines, resolve), [])
})

test('todas dentro de su disponible → sin excedentes', () => {
  const lines = [line('cat-A', 6000), line('cat-B', 4000)]
  const resolve = () => ({ available: 100000, noPresupuestal: false })
  assert.deepEqual(distributionBudgetExceedances(lines, resolve), [])
})

// ── inserts ─────────────────────────────────────────────────────────────────
test('toDistributionInserts arma las filas ligadas al request y centro de costo', () => {
  const lines = [line('cat-A', 6000), line('cat-B', 10461.4), line('', 0)]
  const rows = toDistributionInserts(lines, 'req-1', 'cc-1')
  assert.equal(rows.length, 2) // descarta la línea vacía
  assert.deepEqual(rows[0], {
    payment_request_id: 'req-1',
    budget_category_id: 'cat-A',
    cost_center_id: 'cc-1',
    amount: 6000,
  })
  assert.equal(rows[1].amount, 10461.4)
})
