/** A single catalog ID groups every unclassified request. The approved
 * description is a display snapshot, never a new budget category. */
export const SIN_PARTIDA_CODE = 'SIN_PARTIDA'

type Category = { code?: string | null; name?: string | null; category?: string | null }
type Request = { sin_partida_description?: string | null }

export function isSinPartida(category: Category | null | undefined): boolean {
  return category?.code === SIN_PARTIDA_CODE
}

export function requestCategoryLabel(request: Request, category: Category | null | undefined): string {
  if (isSinPartida(category)) {
    const description = request.sin_partida_description?.trim()
    return description ? `Sin partida (${description})` : 'Sin partida'
  }
  if (!category) return 'Sin partida'
  return `${category.name || 'Sin nombre'}${category.category ? ` (${category.category})` : ''}`
}
