import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const migration = fs.readFileSync(
  'supabase/migrations/20260903014009_budget_category_shared_access.sql',
  'utf8',
)
const api = fs.readFileSync('app/src/features/solicitudes/api.ts', 'utf8')
const modal = fs.readFileSync('app/src/features/solicitudes/RequestModal.tsx', 'utf8')

test('shared budget access is tenant-scoped and membership-bound', () => {
  assert.match(migration, /primary key \(company_id, cost_center_id, budget_category_id, profile_id\)/)
  assert.match(migration, /foreign key \(company_id, cost_center_id, budget_category_id\)[\s\S]*company_cost_center_budget_categories/)
  assert.match(migration, /foreign key \(profile_id, company_id\)[\s\S]*profile_company_memberships/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /profile_id = \(select public\.current_profile_id\(\)\)/)
  assert.match(migration, /has_active_company_membership/)
})

test('authenticated clients only receive select privilege', () => {
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/)
  assert.match(migration, /grant select[\s\S]*to authenticated/)
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*to authenticated/i)
})

test('Yanin gets Enseres without replacing Alfredo as primary responsible', () => {
  assert.match(migration, /ynavarrete@soportef\.com/)
  assert.match(migration, /lower\(btrim\(category\.name\)\) = 'enseres'/)
  assert.doesNotMatch(migration, /update\s+public\.company_cost_center_budget_categories/i)
})

test('React only loads active grants for the current profile and merges them with owner access', () => {
  assert.match(api, /from\('budget_category_access_grants'\)/)
  assert.match(api, /eq\('profile_id', profileId\)/)
  assert.match(api, /eq\('active', true\)/)
  assert.match(api, /has_additional_access:/)
  assert.match(modal, /responsible_email[\s\S]*\|\| r\.has_additional_access === true/)
})
