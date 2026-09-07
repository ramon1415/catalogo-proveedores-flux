import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { DEV_PROJECT_REF, validateCatalog } from './database-catalog.mjs'

// This runner captures schema metadata only. It never executes a migration or a payment RPC.
const root = fileURLToPath(new URL('../../', import.meta.url))
let temporary
try {
  let catalogPath = process.env.FLUX_QA_CATALOG
  if (!catalogPath) {
    const token = process.env.SUPABASE_ACCESS_TOKEN
    if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required to read DEV; or supply a fresh FLUX_QA_CATALOG exported with database-catalog-readonly.sql')
    const query = readFileSync(new URL('./database-catalog-readonly.sql', import.meta.url), 'utf8')
    if (!query.startsWith('BEGIN TRANSACTION READ ONLY;') || !query.trimEnd().endsWith('COMMIT;')) throw new Error('Read-only catalog transaction guard is missing')
    const response = await fetch(`https://api.supabase.com/v1/projects/${DEV_PROJECT_REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, read_only: true }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`DEV catalog request failed (HTTP ${response.status}); no database contracts were certified`)
    const data = await response.json()
    const catalog = validateCatalog(data[0]?.catalog)
    temporary = mkdtempSync(join(tmpdir(), 'flux-dev-catalog-'))
    catalogPath = join(temporary, 'catalog.json')
    writeFileSync(catalogPath, JSON.stringify(catalog), { mode: 0o600 })
  }
  const catalog = validateCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')))
  console.log(`DEV catalog: ${catalog.captured_at}; PostgreSQL ${catalog.server_version}; read_only=${catalog.read_only}`)
  const files = readdirSync(new URL('./database/', import.meta.url)).filter(n => n.endsWith('.test.mjs')).sort().map(n => `scripts/qa/database/${n}`)
  // Credentials are used only by the capture above, never inherited by the test process.
  const childEnv = { ...process.env, FLUX_QA_CATALOG: catalogPath }
  delete childEnv.SUPABASE_ACCESS_TOKEN
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: root, env: childEnv, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true })
}
