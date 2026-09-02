// Lógica pura del reporte de costo por proyecto. Sin efectos ni DOM.
import type { ProjectTotals, TaggedRequest } from './types'

// Una solicitud rechazada o cancelada nunca llegó a ser costo, así que no suma
// en ninguna columna; sigue apareciendo en el detalle con su badge para que se
// entienda por qué el conteo no cuadra con la suma.
const NON_COST_STATUSES = ['rejected', 'cancelled']

// "Aprobado" = aprobada y todo lo que ya pasó de ahí (scheduled/paid siguen
// estando aprobadas); "pagado" = solo lo efectivamente pagado.
const APPROVED_STATUSES = ['approved', 'scheduled', 'paid']
const PAID_STATUSES = ['paid']

export function isCostRequest(r: TaggedRequest): boolean {
  return !NON_COST_STATUSES.includes(r.status ?? '')
}

export function totalsFor(requests: TaggedRequest[]): ProjectTotals {
  return requests.reduce<ProjectTotals>(
    (acc, r) => {
      acc.count += 1
      if (!isCostRequest(r)) return acc
      const amount = Number(r.amount_requested || 0)
      acc.requested += amount
      if (APPROVED_STATUSES.includes(r.status ?? '')) acc.approved += amount
      if (PAID_STATUSES.includes(r.status ?? '')) acc.paid += amount
      return acc
    },
    { requested: 0, approved: 0, paid: 0, count: 0 },
  )
}

// Años ofrecidos en el filtro: del actual hacia atrás, suficiente para cubrir
// el histórico sin pedir otra consulta solo para poblar el select.
export function yearOptions(span = 5): number[] {
  const current = new Date().getFullYear()
  return Array.from({ length: span }, (_, i) => current - i)
}
