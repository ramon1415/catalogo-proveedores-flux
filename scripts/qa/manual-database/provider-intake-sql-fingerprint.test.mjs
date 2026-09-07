import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DEV_PROJECT_REF } from '../database-catalog.mjs'

// Explicit diagnostic for an operator already allowed to execute this internal
// helper. CI checks its definition and restrictive grants without calling it.
test('DEV SQL fingerprint probes preserve UTC equivalence and distinguish material input', () => {
  assert.ok(process.env.FLUX_QA_FINGERPRINT_CATALOG, 'Export database-fingerprint-probes-readonly.sql with an authorized DEV connection and set FLUX_QA_FINGERPRINT_CATALOG')
  const catalog = JSON.parse(readFileSync(process.env.FLUX_QA_FINGERPRINT_CATALOG, 'utf8'))
  assert.equal(catalog.project_ref, DEV_PROJECT_REF)
  assert.equal(catalog.read_only, 'on')
  const age = Date.now() - Date.parse(catalog.captured_at)
  assert.ok(Number.isFinite(age) && age >= -60_000 && age <= 30 * 60_000, 'Fingerprint capture must be fresh (maximum 30 minutes)')
  const probes = catalog.fingerprint_probes
  for (const key of ['base', 'timezone', 'actor', 'status', 'stamp', 'target', 'notes', 'operation', 'trim']) assert.match(probes[key], /^[a-f0-9]{64}$/)
  assert.equal(probes.base, probes.timezone)
  for (const key of ['actor', 'status', 'stamp', 'target', 'notes', 'operation', 'trim']) assert.notEqual(probes.base, probes[key], key)
})
