import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  new URL('../../supabase/migrations/20260827231436_payroll_service_role_claim_compat.sql', import.meta.url),
  'utf8',
)

assert.match(migration, /auth\.jwt\(\) ->> 'role'/)
assert.doesNotMatch(migration, /auth\.role\(\)/)
assert.doesNotMatch(migration, /current_user/)
assert.match(migration, /set search_path = ''/)
assert.match(migration, /get_payroll_capture_sessions_unscoped_internal/)
assert.match(migration, /has_active_company_membership\(v_actor, \(item ->> 'company_id'\)::uuid\)/)
assert.doesNotMatch(migration, /company_modules/)
assert.doesNotMatch(migration, /insert\s+into|update\s+public\.|delete\s+from/i)

console.log('PASS payroll service-role claim compatibility contract')
