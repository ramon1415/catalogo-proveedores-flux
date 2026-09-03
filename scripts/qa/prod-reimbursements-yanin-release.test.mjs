import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const migrationPath =
  'supabase/migrations/20260903032021_prod_reimbursements_yanin_release.sql'
const migration = fs.readFileSync(migrationPath, 'utf8')
const api = fs.readFileSync('app/src/features/solicitudes/api.ts', 'utf8')
const modal = fs.readFileSync('app/src/features/solicitudes/RequestModal.tsx', 'utf8')
const reimbursement = fs.readFileSync(
  'app/src/features/solicitudes/ReimbursementSection.tsx',
  'utf8',
)
const cfdi = fs.readFileSync('app/src/features/solicitudes/cfdi.ts', 'utf8')
const layoutApi = fs.readFileSync('app/src/features/layouts/api.ts', 'utf8')

test('release is one forward transaction and excludes unrelated modules', () => {
  assert.match(migration, /^-- PROD:[\s\S]*\nbegin;/)
  assert.match(migration, /commit;\s*$/)
  assert.doesNotMatch(migration, /\bprojects\b|\bproject_id\b/i)
  assert.doesNotMatch(migration, /budget_category_access_grants/)
  assert.doesNotMatch(migration, /\b\d{18}\b/)
})

test('employee bank data and reimbursement items are company scoped', () => {
  assert.match(
    migration,
    /employee_bank_accounts_pkey[\s\S]*primary key \(profile_id, company_id\)/i,
  )
  assert.match(
    migration,
    /employee_bank_accounts_membership_fkey[\s\S]*foreign key \(profile_id, company_id\)[\s\S]*profile_company_memberships/i,
  )
  assert.match(migration, /alter table public\.employee_bank_accounts force row level security/)
  assert.match(
    migration,
    /reimbursement_items_request_company_fkey[\s\S]*foreign key \(company_id, payment_request_id\)/i,
  )
  assert.match(
    migration,
    /reimbursement_items_company_uuid_unique[\s\S]*\(company_id, upper\(invoice_uuid\)\)/i,
  )
})

test('beneficiary is persisted atomically and constrained to the company', () => {
  assert.match(
    migration,
    /create or replace function public\.create_payment_request\([\s\S]*p_beneficiary_profile_id uuid[\s\S]*p_request_type text/,
  )
  assert.match(
    migration,
    /insert into public\.payment_requests[\s\S]*beneficiary_profile_id[\s\S]*p_beneficiary_profile_id/,
  )
  assert.match(
    migration,
    /beneficiary_company_membership_required/,
  )
  assert.match(migration, /list_reimbursement_beneficiaries/)
})

test('layout uses the employee destination from the same company', () => {
  assert.match(
    migration,
    /employee_bank_accounts eba[\s\S]*eba\.company_id = p_request\.company_id/,
  )
  assert.match(
    migration,
    /employee_bank_accounts beneficiary_bank[\s\S]*beneficiary_bank\.company_id = (?:reimb|candidate)\.company_id/,
  )
  assert.match(
    migration,
    /revoke execute on function public\.payment_request_layout_missing_fields[\s\S]*from public, anon, authenticated/,
  )
  assert.match(
    migration,
    /revoke execute on function public\.approval_batch_payment_layout_candidates[\s\S]*from public, anon, authenticated/,
  )
})

test('Yanin shares Enseres without replacing Alfredo', () => {
  assert.match(migration, /company_cost_center_budget_category_responsibles/)
  assert.match(migration, /'ynavarrete@soportef\.com'/)
  assert.match(migration, /lower\(btrim\(category\.name\)\) = 'enseres'/)
  assert.doesNotMatch(
    migration,
    /update\s+public\.company_cost_center_budget_categories/i,
  )
})

test('React keeps bank and beneficiary reads scoped by company', () => {
  assert.match(api, /loadActiveProfiles\(companyId: string\)/)
  assert.match(api, /p_company_id: companyId/)
  assert.match(api, /loadEmployeeBankAccount\(profileId: string, companyId: string\)/)
  assert.match(api, /onConflict: 'profile_id,company_id'/)
  assert.match(api, /select\('id,payment_request_id,company_id,/)
  assert.match(modal, /loadActiveProfiles\(companyId\)/)
  assert.match(modal, /loadEmployeeBankAccount\(beneficiaryId, companyId\)/)
  assert.match(modal, /company_id: payload\.company_id!/)
  assert.match(reimbursement, /companyId: string/)
  assert.doesNotMatch(reimbursement, /lib\/contpaq/)
  assert.match(cfdi, /TimbreFiscalDigital/)
  assert.match(cfdi, /getAttribute\('UUID'\)/)
  assert.match(layoutApi, /eq\('company_id', row\.company_id\)/)
})
