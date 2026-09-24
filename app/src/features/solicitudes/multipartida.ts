// Lógica pura de la captura multi-partida (FASE 2) y de la validación de
// presupuesto por partida (FASE 3) de "solicitud multi-partida".
//
// Se mantiene SIN imports runtime (solo tipos) a propósito: así puede probarse
// directamente con `node --test` (type stripping) sin arrastrar el grafo de
// módulos de logic.ts (que importa CSS/format extensionless y no resuelve en el
// runner). RequestModal.tsx y api.ts consumen estas funciones.
//
// Contrato con FASE 1 (ya en dev): la solicitud reparte su BASE (subtotal, sin
// IVA) en N líneas {budget_category_id, cost_center_id?, amount}. La AUSENCIA de
// líneas = una sola partida (payment_requests.budget_category_id). Por eso el
// modo por defecto NO inserta líneas y conserva el comportamiento actual.

export type DistributionLine = {
  key: string
  budgetCategoryId: string
  amount: string // capturado como texto en el formulario
}

// Fila lista para insertar en public.payment_request_distributions.
export type DistributionInsert = {
  payment_request_id: string
  budget_category_id: string
  cost_center_id: string | null
  amount: number
}

// numberValue local (evita importar ../../lib/format, que rompería el runner).
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

let seq = 0
export function emptyDistributionLine(budgetCategoryId = '', amount = ''): DistributionLine {
  seq += 1
  return { key: `dist_${Date.now().toString(36)}_${seq}`, budgetCategoryId, amount }
}

export function distributionLinesTotal(lines: DistributionLine[]): number {
  return round2(lines.reduce((sum, line) => sum + toNumber(line.amount), 0))
}

// Partida dominante (la de mayor monto): es la que sigue viajando en
// payment_requests.budget_category_id y la que rutea al aprobador, igual que el
// patrón del reembolso (reimbursementTotals.dominantCategoryId).
export function dominantDistributionCategory(lines: DistributionLine[]): string {
  let id = ''
  let max = -1
  for (const line of lines) {
    const amount = toNumber(line.amount)
    if (line.budgetCategoryId && amount > max) {
      max = amount
      id = line.budgetCategoryId
    }
  }
  return id
}

// FASE 2 · validación de captura: cada línea con partida y monto>0, sin partidas
// repetidas, y la SUMA debe igualar la BASE del gasto (subtotal sin IVA, no el
// total). Devuelve '' cuando todo cuadra.
export function validateDistributionLines(lines: DistributionLine[], base: number): string {
  if (!lines.length) return 'Agrega al menos una partida a la distribución.'
  const seen = new Set<string>()
  for (const [index, line] of lines.entries()) {
    const position = `Partida ${index + 1}`
    if (!line.budgetCategoryId) return `${position}: selecciona la partida presupuestal.`
    if (!(toNumber(line.amount) > 0)) return `${position}: el monto debe ser mayor a 0.`
    if (seen.has(line.budgetCategoryId)) return `${position}: la partida está repetida. Únela en un solo renglón.`
    seen.add(line.budgetCategoryId)
  }
  if (!(base > 0)) return 'Captura el monto (o subtotal) del gasto antes de repartirlo por partidas.'
  const total = distributionLinesTotal(lines)
  if (Math.abs(total - round2(base)) > 0.01) {
    return `La suma de la distribución (${total.toFixed(2)}) debe igualar la base del gasto (${round2(base).toFixed(2)}).`
  }
  return ''
}

// FASE 3 · presupuesto por partida. `resolve(categoryId)` devuelve el disponible
// de ESA partida (o null si no hay fila de disponibilidad → no se marca, decide
// el servidor). Las partidas no presupuestales / sin partida no consumen y no se
// marcan. Devuelve las líneas que exceden su propio disponible.
export type PartidaBudgetInfo = { available: number; noPresupuestal: boolean } | null
export type DistributionExceedance = {
  index: number
  budgetCategoryId: string
  amount: number
  available: number
}

export function distributionBudgetExceedances(
  lines: DistributionLine[],
  resolve: (categoryId: string) => PartidaBudgetInfo,
): DistributionExceedance[] {
  const out: DistributionExceedance[] = []
  lines.forEach((line, index) => {
    const amount = toNumber(line.amount)
    if (!(amount > 0) || !line.budgetCategoryId) return
    const info = resolve(line.budgetCategoryId)
    if (!info || info.noPresupuestal) return
    if (amount - info.available > 0.01) {
      out.push({ index, budgetCategoryId: line.budgetCategoryId, amount, available: info.available })
    }
  })
  return out
}

// Convierte las líneas de captura a inserts. El centro de costos de la solicitud
// se aplica a cada línea (la tabla lo admite por línea; hoy el formulario maneja
// un solo CC). Descarta líneas vacías por robustez.
export function toDistributionInserts(
  lines: DistributionLine[],
  paymentRequestId: string,
  costCenterId: string | null,
): DistributionInsert[] {
  return lines
    .filter((line) => line.budgetCategoryId && toNumber(line.amount) > 0)
    .map((line) => ({
      payment_request_id: paymentRequestId,
      budget_category_id: line.budgetCategoryId,
      cost_center_id: costCenterId,
      amount: round2(toNumber(line.amount)),
    }))
}
