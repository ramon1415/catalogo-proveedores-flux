import { DEV_PROJECT_REF, validateCatalog } from './database-catalog.mjs'

export function catalogApiQuery(script) {
  // The exported file is a standalone SQL transaction. Management API owns its
  // read-only transaction and receives only the enclosed SELECT statement.
  const match = script.match(/^BEGIN TRANSACTION READ ONLY;\s*(SELECT jsonb_build_object\([\s\S]*\) AS catalog;)\s*COMMIT;\s*$/)
  if (!match) throw new Error('Read-only catalog transaction guard is missing')
  return match[1]
}

export async function captureDevCatalog(token, script, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.supabase.com/v1/projects/${DEV_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: catalogApiQuery(script), read_only: true }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const message = String(error.message || error.error || 'No detail returned')
      .replaceAll(token, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/[\r\n]/g, ' ').slice(0, 500)
    throw new Error(`DEV catalog request failed (HTTP ${response.status}): ${message}; no database contracts were certified`)
  }
  const data = await response.json()
  return validateCatalog(data[0]?.catalog)
}
