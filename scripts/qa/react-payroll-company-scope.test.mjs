import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

const page = read('app/src/features/nomina/NominaPage.tsx')
const modal = read('app/src/features/nomina/CaptureModal.tsx')
const api = read('app/src/features/nomina/api.ts')
const migration = read('supabase/migrations/20260827225332_payroll_active_company_scope.sql')

assert.match(page, /useCompany\(\)/)
assert.match(page, /session\.company_id === companyId/)
assert.match(page, /loadSourceAccounts\(companyId\)/)
assert.match(page, /loadAccountingScope\(companyId\)/)
assert.doesNotMatch(page, /loadCompanies/)

assert.match(modal, /activeCompanyId: string/)
assert.match(modal, /session\.company_id !== activeCompanyId/)
assert.match(modal, /<select value=\{companyId\}[^>]*disabled>/)

assert.match(api, /\.eq\('company_id', companyId\)/)
assert.doesNotMatch(api, /from\('companies'\)/)

assert.match(migration, /payroll_active_company_access/)
assert.match(migration, /auth\.role\(\) = 'service_role'/)
assert.match(migration, /has_active_company_membership\(public\.current_profile_id\(\), p_company_id\)/)
assert.match(migration, /save_payroll_capture_session_unscoped_internal/)
assert.match(migration, /reserve_payroll_capture_file_unscoped_internal/)
assert.match(migration, /confirm_payroll_capture_file_unscoped_internal/)
assert.match(migration, /get_payroll_capture_sessions_unscoped_internal/)
assert.match(migration, /jsonb_array_elements\(v_unscoped\)/)
assert.match(migration, /payroll_capture_storage_insert_allowed\(name\)/)
assert.match(migration, /payroll_capture_storage_select_allowed\(name\)/)
assert.match(migration, /payroll_storage_company_access\(name\)/)
assert.doesNotMatch(migration, /drop policy if exists payroll_private_finance_insert/)
assert.doesNotMatch(migration, /company_modules[\s\S]*enabled\s*=\s*true/i)
assert.doesNotMatch(migration, /insert\s+into\s+public\.(payroll|payment_requests)/i)

console.log('PASS React payroll active-company scope contract')
