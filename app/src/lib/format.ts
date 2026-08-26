// Formateadores es-MX compartidos entre features (portados del vanilla).

export function numberValue(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function formatCurrency(value: unknown): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(
    numberValue(value),
  )
}

export function compactCurrency(value: unknown): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(numberValue(value))
}

export function formatDate(value: unknown): string {
  if (!value) return 'Sin fecha'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? 'Sin fecha'
    : new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

export function formatDateTime(value: unknown): string {
  if (!value) return 'Sin fecha'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime())
    ? 'Sin fecha'
    : new Intl.DateTimeFormat('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
}

export function normalize(value: unknown): string {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export function todayValue(): string {
  return new Date().toISOString().slice(0, 10)
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
