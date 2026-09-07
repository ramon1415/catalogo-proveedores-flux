import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

export const DEV_PROJECT_REF = 'scsirgbuqjcwoaxfacth'
export function validateCatalog(value, now = Date.now()) {
  assert.equal(value?.project_ref, DEV_PROJECT_REF, 'Only the Flux DEV catalog is accepted')
  assert.equal(value?.read_only, 'on', 'The catalog must be captured in a read-only transaction')
  const age = now - Date.parse(value?.captured_at)
  assert.ok(Number.isFinite(age) && age >= -60_000 && age <= 30 * 60_000, 'Capture a fresh DEV catalog (maximum age 30 minutes)')
  for (const name of ['functions', 'tables', 'constraints', 'indexes', 'policies', 'triggers', 'buckets']) {
    assert.ok(Array.isArray(value[name]) && value[name].length > 0, `Missing catalog ${name}`)
  }
  return value
}
let loaded
export function databaseCatalog() {
  assert.ok(process.env.FLUX_QA_CATALOG, 'Run npm run test:db to capture the DEV catalog, or provide FLUX_QA_CATALOG from database-catalog-readonly.sql')
  return loaded ??= validateCatalog(JSON.parse(readFileSync(process.env.FLUX_QA_CATALOG, 'utf8')))
}
export function functionMetadata(name, identityIncludes) {
  const candidates = databaseCatalog().functions.filter(f => f.schema === 'public' && f.name === name && (!identityIncludes || f.identity.includes(identityIncludes)))
  assert.equal(candidates.length, 1, `Expected one deployed function ${name}${identityIncludes ? ` (${identityIncludes})` : ''}`)
  return candidates[0]
}
export function functionDefinition(name, identityIncludes) {
  const f = functionMetadata(name, identityIncludes)
  // Render catalog attributes explicitly, including PostgreSQL defaults. Preserve the body verbatim.
  const header = f.definition.split(/\bAS \$function\$/)[0].toLowerCase()
    .replace('create or replace function', 'create function')
    .replace(/set search_path to ([^\n]+)/, (_, path) => `set search_path = ${path.replace(/'/g, '')}`)
    .replace(/\b(?:stable|immutable|volatile)\b\s*/g, '')
    .replace(/\bsecurity (?:definer|invoker)\b\s*/g, '')
  const security = f.security_definer ? 'definer' : 'invoker'
  const volatility = { s: 'stable', v: 'volatile', i: 'immutable' }[f.volatility]
  return `${header.replace(/\s*set search_path/, `\n${volatility}\nsecurity ${security}\nset search_path`)}as $$${f.body}\n$$;`
}
export function assertRpcAccess(name, { authenticated = true, service, definer = true, identityIncludes } = {}) {
  const f = functionMetadata(name, identityIncludes)
  assert.equal(f.security_definer, definer, `${name}: security mode`)
  assert.equal(f.authenticated_execute, authenticated, `${name}: authenticated EXECUTE`)
  assert.equal(f.anon_execute, false, `${name}: anon EXECUTE`)
  assert.equal(f.public_execute, false, `${name}: PUBLIC EXECUTE`)
  if (service !== undefined) assert.equal(f.service_execute, service, `${name}: service EXECUTE`)
  assert.ok(f.config?.some(c => c.startsWith('search_path=')), `${name}: fixed search_path`)
}
